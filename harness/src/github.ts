// github.ts: the only file that talks to GitHub. Parses gh JSON into TriggerDrafts at the boundary;
// no wire type leaves this file. Reads with Vlad's gh login; writes PRs with the bot token (unit 6).
//
// Polling, no webhooks (one Mac, no public endpoint). Three repo-wide feeds, each sorted by update:
//   issues (incl. PR bodies), issue comments (incl. PR conversation), PR review comments.
// The cursor is a cache: losing it re-polls history, which the log dedupes by content id.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Repo, ThreadRef } from './domain.ts'
import { MARKER } from './config.ts'
import type { TriggerDraft } from './service.ts'

const run = promisify(execFile)

interface GhUser { login: string; type: string }
interface GhIssue { number: number; title: string; body: string | null; user: GhUser; created_at: string; updated_at: string; html_url: string; pull_request?: unknown }
interface GhComment { id: number; body: string | null; user: GhUser; created_at: string; updated_at: string; html_url: string; issue_url?: string; pull_request_url?: string }

type Feed = 'issues' | 'issues/comments' | 'pulls/comments'
const FEEDS: Feed[] = ['issues', 'issues/comments', 'pulls/comments']

async function gh<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const args = ['api', '--paginate', '-X', 'GET', path, ...Object.entries(params).flatMap(([k, v]) => ['-f', `${k}=${v}`])]
  const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })
  // --paginate concatenates JSON arrays: "[...][...]" -> one array
  return JSON.parse(`[${stdout.trim().replace(/\]\s*\[/g, '],[')}]`).flat() as T[]
}

const numberFrom = (url: string) => Number(url.slice(url.lastIndexOf('/') + 1))

/**
 * Version = hash of the text, not updated_at: an issue's updated_at moves on every new comment, which
 * would re-ingest an unchanged body as a fake edit. Only a real edit of the text is a new fact.
 */
const versionOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** "Fixes #12", "closes #3": a PR body links the PR thread to the issue thread. */
export function correlatesOf(repo: Repo, body: string): ThreadRef[] {
  const out = new Map<number, ThreadRef>()
  for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)) {
    out.set(Number(m[1]), { kind: 'issue', repo, number: Number(m[1]) })
  }
  return [...out.values()]
}

export function issueToDraft(repo: Repo, i: GhIssue): TriggerDraft {
  const body = `${i.title}\n\n${i.body ?? ''}`
  return {
    thread: { kind: 'issue', repo, number: i.number },
    native: { id: `${i.pull_request ? 'pr' : 'issue'}:${repo}#${i.number}`, version: versionOf(body) },
    actor: i.user.login, human: i.user.type !== 'Bot',
    text: body, url: i.html_url, createdAt: i.created_at,
    correlates: i.pull_request ? correlatesOf(repo, i.body ?? '') : [],
  }
}

export function commentToDraft(repo: Repo, feed: Feed, c: GhComment): TriggerDraft {
  const number = numberFrom(c.issue_url ?? c.pull_request_url ?? '')
  return {
    thread: { kind: 'issue', repo, number },
    native: { id: `${feed === 'pulls/comments' ? 'review' : 'comment'}:${c.id}`, version: versionOf(c.body ?? '') },
    actor: c.user.login, human: c.user.type !== 'Bot',
    text: c.body ?? '', url: c.html_url, createdAt: c.created_at,
    correlates: [],
  }
}

/**
 * Re-read this much before the cursor on every poll. Observed 02/11 on harness-sandbox: a list call
 * 2 s after an edit returned the old body (counted as duplicate) while the cursor moved past it.
 * Duplicates are free (content ids), missed edits are not.
 */
const OVERLAP_MS = 5 * 60 * 1000

export interface Cursor { [repoFeed: string]: string }

export function readCursor(home: string): Cursor {
  try { return JSON.parse(readFileSync(join(home, 'cursor.json'), 'utf8')) as Cursor } catch { return {} }
}

function writeCursor(home: string, c: Cursor): void {
  const tmp = join(home, 'cursor.json.tmp')
  writeFileSync(tmp, JSON.stringify(c, null, 2))
  renameSync(tmp, join(home, 'cursor.json'))
}

/**
 * One poll of every feed of one repo since its cursor. Hands drafts to `ingest` oldest first and
 * advances the cursor only after ingest returned for the whole feed (a crash re-polls, never skips).
 * `since` reaches OVERLAP_MS back, so recent items repeat on purpose; the log dedupes them.
 */
export async function pollRepo(home: string, repo: Repo, ingest: (d: TriggerDraft) => void): Promise<number> {
  const cursor = readCursor(home)
  let n = 0
  for (const feed of FEEDS) {
    const key = `${repo}:${feed}`
    const params: Record<string, string> = { per_page: '100', sort: 'updated', direction: 'asc' }
    if (feed === 'issues') params.state = 'all'
    if (cursor[key]) params.since = new Date(Date.parse(cursor[key]) - OVERLAP_MS).toISOString()
    const items = await gh<GhIssue & GhComment>(`/repos/${repo}/${feed}`, params)
    items.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    for (const it of items) {
      ingest(feed === 'issues' ? issueToDraft(repo, it) : commentToDraft(repo, feed, it))
      n++
    }
    if (items.length) cursor[key] = items[items.length - 1].updated_at
    writeCursor(home, cursor)
  }
  return n
}

/**
 * Post one reply, idempotent by intent id: the hidden marker `<!-- harness:<intent> -->` is searched
 * first, so a crash between POST and reply.settled never posts twice. The marker is also how the
 * code filter recognizes the harness's own comments (own-message).
 */
export async function send(to: ThreadRef, text: string, intent: string): Promise<{ result: 'sent' | 'gone'; url?: string }> {
  if (to.kind !== 'issue') throw new Error(`send: only issue threads go to GitHub, got ${to.kind}`)
  const marker = `${MARKER}${intent} -->`
  const base = `/repos/${to.repo}/issues/${to.number}/comments`
  try {
    const found = await gh<GhComment>(base, { per_page: '100' })
    const hit = found.find((c) => (c.body ?? '').includes(marker))
    if (hit) return { result: 'sent', url: hit.html_url }
    const { stdout } = await run('gh', ['api', '-X', 'POST', base, '-f', `body=${text}\n\n${marker}`], { maxBuffer: 8 * 1024 * 1024 })
    return { result: 'sent', url: (JSON.parse(stdout) as GhComment).html_url }
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err)
    if (/HTTP 404|HTTP 410/.test(msg)) return { result: 'gone' }
    throw err
  }
}

/** The bot's token, read from Vlad's Keychain at call time (service from config). Never stored, never logged. */
export async function botToken(service: string): Promise<string> {
  const { stdout } = await run('security', ['find-generic-password', '-s', service, '-w'])
  return stdout.trim()
}

/**
 * Find or open the PR for a branch, as the bot. Idempotent by the hidden marker in the body: a crash
 * between creating the PR and recording it finds the same PR on the next try.
 */
export async function openPullRequest(o: { repo: Repo; branch: string; base: string; title: string; body: string; marker: string; token: string }): Promise<{ number: number; url: string }> {
  const env = { ...process.env, GH_TOKEN: o.token }
  const list = await run('gh', ['pr', 'list', '-R', o.repo, '--head', o.branch, '--state', 'all', '--json', 'number,url,body'], { env, maxBuffer: 8 * 1024 * 1024 })
  const hit = (JSON.parse(list.stdout) as { number: number; url: string; body: string }[]).find((p) => p.body.includes(o.marker))
  if (hit) return { number: hit.number, url: hit.url }
  const created = await run('gh', ['pr', 'create', '-R', o.repo, '--head', o.branch, '--base', o.base, '--title', o.title, '--body', `${o.body}\n\n${o.marker}`], { env })
  const url = created.stdout.trim().split('\n').pop()!
  return { number: numberFrom(url), url }
}
