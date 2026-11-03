// workspace.ts: the harness's own clones and worktrees. The only file that runs git for a run.
//   <home>/repos/<owner>/<name>           one clone per repo, fetched before each attempt
//   <home>/worktrees/<ticket>-a<attempt>  one detached worktree per attempt, outside the clone
// Atomic creates worktrees only when the workflow starts inside the source repo, and the engine
// session starts in <home>, so the host creates it and the stage just runs there (cwd).

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { RunSpec } from './domain.ts'

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

export interface Workspace { worktree: string; base: string }

export function worktreeOf(home: string, spec: RunSpec): string {
  return join(home, 'worktrees', `${spec.ticket.slice(0, 12)}-a${spec.attempt}`)
}

/**
 * Every git operation on a repo's clone goes through one queue per clone: concurrent attempts would
 * otherwise race on the clone itself, on the fetch's ref locks and on .git/worktrees. Only the daemon
 * process touches clones, so an in-process queue is the whole invariant.
 */
const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
  queues.set(key, next)
  return next
}

/** Idempotent: the same attempt gets the same worktree at the same base, created once. */
export function prepare(home: string, spec: RunSpec): Promise<Workspace> {
  const clone = join(home, 'repos', spec.repo)
  return serial(clone, async () => {
    if (!existsSync(join(clone, '.git'))) {
      mkdirSync(dirname(clone), { recursive: true })
      await run('gh', ['repo', 'clone', spec.repo, clone, '--', '--quiet'])
    }
    const worktree = worktreeOf(home, spec)
    if (existsSync(join(worktree, '.git'))) {
      await excludeHarnessDirs(worktree)
      return { worktree, base: readFileSync(await baseFile(worktree), 'utf8').trim() }
    }
    await git(clone, 'fetch', '--quiet', 'origin', spec.baseBranch)
    const base = await git(clone, 'rev-parse', `origin/${spec.baseBranch}`)
    // Attempt n+1 continues the previous attempt's commits (they live in the clone's object store).
    await git(clone, 'worktree', 'add', '--detach', '--quiet', worktree, spec.startFrom ?? base)
    writeFileSync(await baseFile(worktree), base + '\n')
    await excludeHarnessDirs(worktree)
    if (spec.attempt > 1) await removeIn(clone, worktreeOf(home, { ...spec, attempt: spec.attempt - 1 }))
    return { worktree, base }
  })
}

/** The daemon removes an attempt's worktree when its run is final; Atomic never cleans worktrees. */
export function removeWorktree(home: string, spec: RunSpec): Promise<void> {
  const clone = join(home, 'repos', spec.repo)
  return serial(clone, () => removeIn(clone, worktreeOf(home, spec)))
}

async function removeIn(clone: string, worktree: string): Promise<void> {
  if (existsSync(worktree)) await git(clone, 'worktree', 'remove', '--force', worktree)
}

/** `git patch-id --stable` of base..HEAD: the identity of the change, independent of commit metadata. */
export async function patchId(worktree: string, base: string): Promise<string> {
  const diff = await git(worktree, 'diff', '--binary', `${base}..HEAD`)
  const p = execFile('git', ['patch-id', '--stable'], { cwd: worktree })
  const out = new Promise<string>((res, rej) => { let o = ''; p.stdout!.on('data', (d) => { o += d }); p.on('close', () => res(o.trim().split(/\s+/)[0] ?? '')); p.on('error', rej) })
  p.stdin!.end(diff + '\n')
  return out
}

/**
 * Push a sha to a branch with the BOT's token. The token goes through git's env config (never argv,
 * never a remote URL, never the worktree's config), so no file and no `ps` line ever holds it.
 */
export async function pushBranch(worktree: string, repo: string, sha: string, branch: string, token: string): Promise<void> {
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64')
  await run('git', ['push', '--quiet', `https://github.com/${repo}.git`, `${sha}:refs/heads/${branch}`], {
    cwd: worktree,
    // Vlad's global config has a gh credential helper for github.com: with it, a rejected bot token would
    // fall back to Vlad's account. No global or system config at all for this push.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` },
  })
}

/** Per-worktree file in its own git dir: survives restarts, invisible to the worker's `git status`. */
async function baseFile(worktree: string): Promise<string> {
  return join(await git(worktree, 'rev-parse', '--absolute-git-dir'), 'harness-base')
}

/**
 * Atomic leaves .atomic/ in a stage's cwd and pstack's trail lives in .audit/. Git ignores a worktree's own
 * info/ and reads the common dir's instead (gitrepository-layout, "info").
 */
export async function excludeHarnessDirs(worktree: string): Promise<void> {
  const path = await git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude')
  const have = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const missing = HARNESS_DIRS.filter((d) => !have.split('\n').includes(d))
  if (!missing.length) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${have}${have && !have.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
}
const HARNESS_DIRS = ['/.atomic/', '/.audit/']

/** What the worker left: head, commits since base, uncommitted paths. */
export async function inspect(worktree: string, base: string): Promise<{ sha: string; commits: number; dirty: string[] }> {
  const sha = await git(worktree, 'rev-parse', 'HEAD')
  const commits = Number(await git(worktree, 'rev-list', '--count', `${base}..HEAD`))
  const dirty = (await git(worktree, 'status', '--porcelain')).split('\n').filter(Boolean)
  return { sha, commits, dirty }
}
