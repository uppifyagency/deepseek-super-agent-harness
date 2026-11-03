// setup.ts: `harness doctor` and `harness setup`, both reading one ordered list of prerequisites.

import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Interface } from 'node:readline'
import { parseArgs } from 'node:util'
import { DEFAULT_PSTACK_DIR, loadConfig, parseConfig } from './config.ts'
import type { HarnessConfig } from './config.ts'
import { ATOMIC_DIR } from './engine.ts'
import { openLog } from './log.ts'
import { openHarness, policyView, VIEWS } from './service.ts'
import type { Mode } from './service.ts'
import { daemonEnv, install, installService, watchdogJob, watchdogLabel } from './launchd.ts'

interface Step {
  label: string
  /** The command that fixes it, or undefined when it holds. Read-only, so doctor can run every step at once. */
  missing(): Promise<string | undefined>
  apply?(): Promise<void>
}

/** One shared reader over stdin, so a piped "repo\nlogin\nTOKEN\n" feeds the prompts and the token in order. */
interface Input {
  ask(question: string): Promise<string>
  secret(question: string): Promise<string>
  handOff<T>(child: () => Promise<T>): Promise<T>
  close(): void
}

const PROBE_TIMEOUT_MS = 2500
const NODE_MIN = '26.13.0'
const ATOMIC_TESTED = '0.9.63'
const PSTACK_REPO = 'https://github.com/michael-denyer/pstack-claude'
const ATOMIC_INSTALL = `npm i -g @bastani/atomic@${ATOMIC_TESTED}`
const USAGE = 'uso: harness setup [--yes] [--mode observe|auto] --repo owner/name[:explicit|candidates|ignore] --allow <login> [--label <l>] [--handle <h>] [--keychain <servizio>] [--pstack <dir>]'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const render = (want: Record<string, unknown>) => JSON.stringify(want, null, 2) + '\n'
const versionParts = (v: string) => v.split('.').map(Number)

function atLeast(version: string, min: string): boolean {
  const v = versionParts(version)
  const m = versionParts(min)
  for (let i = 0; i < 3; i++) if (v[i] !== m[i]) return v[i] > m[i]
  return true
}

/** Vlad's Mac runs 0.9.64 since 02/11: an exact match would fail a working Mac and make setup downgrade it. */
function atomicOk(version: string | undefined): boolean {
  if (version === undefined) return false
  const v = versionParts(version)
  const pin = versionParts(ATOMIC_TESTED)
  return v[0] === pin[0] && v[1] === pin[1] && v[2] >= pin[2]
}

const atomicBelowTested = (version: string | undefined) => version === undefined || !atLeast(version, ATOMIC_TESTED)

function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined
  } catch { return undefined }
}

function atomicVersion(): string | undefined {
  try {
    const pkg = jsonObject(readFileSync(join(ATOMIC_DIR, 'package.json'), 'utf8'))
    return typeof pkg?.version === 'string' ? pkg.version : undefined
  } catch { return undefined }
}

const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).filter(Boolean).some((dir) => {
  try { accessSync(join(dir, name), constants.X_OK); return true } catch { return false }
})

function atomicFix(): string | undefined {
  const version = atomicVersion()
  if (atomicBelowTested(version)) return ATOMIC_INSTALL
  if (!atomicOk(version)) return `Atomic ${version} e' piu' nuovo delle versioni provate; per tornare a quella provata: ${ATOMIC_INSTALL}`
  const bin = dirname(process.execPath)
  return onPath('atomic') ? undefined : `atomic ${version} e' in ${bin}, che non e' nel PATH: export PATH="${bin}:$PATH"`
}

/** git clone accepts an absent or empty root; `mkdir -p <root>/plugins/pstack` leaves one git refuses. */
type CloneRoot = 'ready' | 'clonable' | 'empty-dirs' | 'occupied'

function onlyDirs(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).every((e) => e.isDirectory() && onlyDirs(join(dir, e.name)))
}

function cloneRoot(pstackDir: string, root: string): CloneRoot {
  if (existsSync(join(pstackDir, 'skills', 'poteto-mode', 'SKILL.md')) && existsSync(join(pstackDir, 'pi', 'index.ts'))) return 'ready'
  if (!existsSync(root) || readdirSync(root).length === 0) return 'clonable'
  return onlyDirs(root) ? 'empty-dirs' : 'occupied'
}

/** rmdir fails on a file or a non-empty directory, so a file that appeared since cloneRoot stops it. */
function removeEmptyDirs(dir: string): void {
  for (const name of readdirSync(dir)) removeEmptyDirs(join(dir, name))
  rmdirSync(dir)
}

function probe(cmd: string, args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, env }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout })
    }).stdin?.end()
  })
}

function interactive(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    spawn(cmd, args, { stdio: 'inherit' }).on('error', () => resolve(1)).on('exit', (code) => resolve(code ?? 1))
  })
}

/** Under a pipe a login is left to the user: the re-check fails and setup prints the command. */
function login(input: Input, cmd: string, args: string[], hint?: string): () => Promise<void> {
  return async () => {
    if (!process.stdin.isTTY) return
    if (hint) console.log(hint)
    await input.handOff(() => interactive(cmd, args))
  }
}

/** Fed to `security -i` on stdin, never on argv where `ps` shows it. */
async function storeToken(service: string, token: string): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(token)) { console.error('token non valido: solo lettere, cifre e _ (ghp_..., github_pat_...)'); return }
  const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] })
  const exited = new Promise<number>((resolve) => { child.on('error', () => resolve(1)).on('exit', (code) => resolve(code ?? 1)) })
  child.stdin.end(`add-generic-password -U -s ${service} -a ${userInfo().username} -w ${token}\n`)
  const code = await exited
  if (code !== 0) console.error(`security -i e' uscito con codice ${code}`)
}

function currentMode(home: string): Mode {
  const path = join(home, 'log.sqlite')
  if (!existsSync(path)) return policyView.init.mode
  const log = openLog(path, VIEWS)
  try { return log.read.view(policyView, 'policy').mode } finally { log.close() }
}

function applyMode(home: string, mode: Mode | undefined): void {
  if (mode === undefined || mode === currentMode(home)) return
  const log = openLog(join(home, 'log.sqlite'), VIEWS)
  try { openHarness(log, loadConfig(home)).setPolicy(mode, randomUUID()) } finally { log.close() }
}

function loaded(home: string): HarnessConfig | undefined {
  try { return loadConfig(home) } catch { return undefined }
}

type Print = () => Promise<{ code: number; stdout: string }>

const launchctlPrint = (label: string): Print => () => probe('launchctl', ['print', `gui/${process.getuid!()}/${label}`], process.env as Record<string, string>)

type LastExit = { code: number } | { signal: string }

const failed = (exit: LastExit | undefined): exit is LastExit => exit !== undefined && !('code' in exit && exit.code === 0)
const describe = (exit: LastExit) => 'code' in exit ? `codice ${exit.code}` : `segnale ${exit.signal}`

/**
 * launchctl prints "last terminating signal = Killed: 9" and no exit code for a process killed by a signal,
 * and "last exit code = (never exited)" for one that has not exited yet.
 */
function readPrint({ code, stdout }: { code: number; stdout: string }): { pid: boolean; runs: number; exit?: LastExit } | undefined {
  if (code !== 0) return undefined
  const exitCode = /^\s*last exit code = (-?\d+)/m.exec(stdout)?.[1]
  const signal = /^\s*last terminating signal = (.+)$/m.exec(stdout)?.[1]
  return {
    pid: /^\s*pid = \d+$/m.test(stdout),
    runs: Number(/^\s*runs = (\d+)$/m.exec(stdout)?.[1] ?? 0),
    exit: exitCode !== undefined ? { code: Number(exitCode) } : signal !== undefined ? { signal } : undefined,
  }
}

export async function serviceProblem(label: string, log: string, print = launchctlPrint(label)): Promise<string | undefined> {
  const p = readPrint(await print())
  if (!p?.pid) return 'harness service install'
  return p.runs > 1 && p.exit !== undefined && 'code' in p.exit && p.exit.code !== 0 ? `il servizio riparte di continuo (ultima uscita con ${describe(p.exit)}, ${p.runs} avvii): guarda ${shellQuote(log)}` : undefined
}

export async function watchdogProblem(label: string, log: string, print = launchctlPrint(label)): Promise<string | undefined> {
  const p = readPrint(await print())
  if (!p) return 'harness service install'
  return failed(p.exit) ? `l'ultimo controllo del watchdog e' uscito con ${describe(p.exit)}: guarda ${shellQuote(log)}` : undefined
}

/** A path as one word for the shell, for the commands doctor prints. */
export function shellQuote(path: string): string {
  return /^[\w@%+=:,./~-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`
}

function steps(home: string, want: Record<string, unknown> | undefined, mode: Mode | undefined, input: Input): Step[] {
  const config = want ? parseConfig(want, home) : loaded(home)
  const path = join(home, 'config.json')
  const pstackDir = config?.pstackDir ?? DEFAULT_PSTACK_DIR
  const pstackRoot = pstackDir.slice(0, -'/plugins/pstack'.length)
  const clone = `git clone ${PSTACK_REPO} ${shellQuote(pstackRoot)}`
  const user = userInfo().username
  const env = daemonEnv(resolve(home))
  return [
    { label: 'macOS', missing: async () => process.platform === 'darwin' ? undefined : "l'harness gira solo su macOS" },
    {
      label: `Node >= ${NODE_MIN}`,
      missing: async () => atLeast(process.versions.node, NODE_MIN) ? undefined : `nvm install ${NODE_MIN} && nvm alias default ${NODE_MIN}`,
    },
    {
      label: `Atomic globale, 0.9.x da ${ATOMIC_TESTED} in su`,
      missing: async () => atomicFix(),
      apply: async () => { if (atomicBelowTested(atomicVersion())) await interactive(join(dirname(process.execPath), 'npm'), ['i', '-g', `@bastani/atomic@${ATOMIC_TESTED}`]) },
    },
    {
      label: `pstack in ${pstackDir}`,
      missing: async () => ({
        ready: undefined,
        clonable: clone,
        'empty-dirs': `find ${shellQuote(pstackRoot)} -depth -type d -empty -delete && ${clone}`,
        occupied: `${pstackRoot} esiste e non e' un clone completo di pstack-claude: spostala, o scegli un'altra cartella con --pstack`,
      })[cloneRoot(pstackDir, pstackRoot)],
      apply: async () => {
        const at = cloneRoot(pstackDir, pstackRoot)
        if (at === 'empty-dirs') removeEmptyDirs(pstackRoot)
        if (at === 'clonable' || at === 'empty-dirs') await interactive('git', ['clone', PSTACK_REPO, pstackRoot])
      },
    },
    {
      label: 'login Codex di Atomic',
      missing: async () => jsonObject((await probe('atomic', ['auth', 'check', '--provider', 'openai-codex', '--no-refresh', '--json'], env)).stdout)?.status === 'ready' ? undefined : 'atomic, poi /login (OpenAI Codex)',
      apply: login(input, 'atomic', [], 'Si apre Atomic: scrivi /login, scegli OpenAI Codex, poi esci.'),
    },
    {
      label: 'Claude Code con il login del piano',
      missing: async () => {
        const s = jsonObject((await probe('claude', ['auth', 'status', '--json'], env)).stdout)
        return s?.loggedIn === true && s.authMethod === 'claude.ai' ? undefined : 'claude auth login'
      },
      apply: login(input, 'claude', ['auth', 'login']),
    },
    {
      label: 'gh autenticato',
      missing: async () => (await probe('gh', ['auth', 'status'], env)).code === 0 ? undefined : 'gh auth login',
      apply: login(input, 'gh', ['auth', 'login']),
    },
    {
      label: `config.json${mode ? ` e modo ${mode}` : ''}`,
      missing: async () => {
        if (want) { try { if (readFileSync(path, 'utf8') !== render(want)) return 'harness setup' } catch { return 'harness setup' } }
        else { try { loadConfig(home) } catch (e) { return existsSync(path) ? `${message(e)}; harness setup` : 'harness setup' } }
        return mode && currentMode(home) !== mode ? `harness policy ${mode}` : undefined
      },
      apply: (want || mode) && (async () => {
        if (want) {
          mkdirSync(home, { recursive: true, mode: 0o700 })
          writeFileSync(`${path}.tmp`, render(want), { mode: 0o600 })
          renameSync(`${path}.tmp`, path)
        }
        applyMode(home, mode)
      }),
    },
    {
      label: `token del bot nel Portachiavi${config ? ` (${config.botKeychainService})` : ''}`,
      missing: async () => {
        if (!config) return 'harness setup'
        const svc = config.botKeychainService
        return (await probe('security', ['find-generic-password', '-s', svc], env)).code === 0 ? undefined : `security add-generic-password -s ${svc} -a ${user} -w`
      },
      apply: config && (async () => storeToken(config.botKeychainService, await input.secret('Token del bot GitHub (non viene mostrato): '))),
    },
    {
      label: `servizio launchd${config ? ` (${config.serviceLabel})` : ''}`,
      missing: async () => {
        if (!config) return 'harness setup'
        return serviceProblem(config.serviceLabel, join(config.home, 'logs', 'daemon.log'))
      },
      apply: config && (async () => installService(config)),
    },
    {
      label: `watchdog launchd${config ? ` (${watchdogLabel(config.serviceLabel)})` : ''}`,
      missing: async () => {
        if (!config) return 'harness setup'
        return watchdogProblem(watchdogLabel(config.serviceLabel), join(config.home, 'logs', 'watchdog.out'))
      },
      apply: config && (async () => { await install(watchdogJob(config)) }),
    },
  ]
}

function openInput(): Input {
  let rl: Interface | undefined
  let ended = false
  const lines: string[] = []
  const waiting: ((line: string) => void)[] = []
  const next = (): Promise<string> => {
    if (!rl) {
      rl = createInterface({ input: process.stdin, terminal: false })
      rl.on('line', (line) => { const w = waiting.shift(); if (w) w(line); else lines.push(line) })
      rl.on('close', () => { ended = true; for (const w of waiting.splice(0)) w('') })
    }
    const line = lines.shift()
    if (line !== undefined) return Promise.resolve(line)
    if (ended) return Promise.resolve('')
    return new Promise((r) => waiting.push(r))
  }
  return {
    async ask(question) {
      process.stdout.write(question)
      const line = (await next()).trim()
      if (!process.stdin.isTTY) process.stdout.write('\n')
      return line
    },
    async secret(question) {
      if (!process.stdin.isTTY) { process.stdout.write(question); const line = (await next()).trim(); process.stdout.write('\n'); return line }
      const echo = (on: boolean) => execFileSync('stty', [on ? 'echo' : '-echo'], { stdio: ['inherit', 'ignore', 'ignore'] })
      const interrupted = () => { echo(true); process.stdout.write('\n'); process.exit(130) }
      process.once('SIGINT', interrupted)
      try {
        echo(false)
        process.stdout.write(question)
        return (await next()).trim()
      } finally {
        process.off('SIGINT', interrupted)
        echo(true)
        process.stdout.write('\n')
      }
    },
    async handOff(child) {
      rl?.pause()
      try { return await child() } finally { rl?.resume() }
    },
    close() { rl?.close() },
  }
}

export async function doctor(home: string): Promise<number> {
  const list = steps(home, undefined, undefined, openInput())
  const fixes = await Promise.all(list.map((s) => s.missing()))
  list.forEach((s, i) => console.log(fixes[i] === undefined ? `ok     ${s.label}` : `manca  ${s.label}: ${fixes[i]}`))
  return fixes.every((f) => f === undefined) ? 0 : 1
}

async function wanted(home: string, argv: string[], input: Input): Promise<{ want?: Record<string, unknown>; mode?: Mode }> {
  let f
  try {
    f = parseArgs({
      args: argv,
      options: {
        yes: { type: 'boolean' },
        mode: { type: 'string' },
        repo: { type: 'string', multiple: true },
        allow: { type: 'string', multiple: true },
        label: { type: 'string' },
        handle: { type: 'string', multiple: true },
        keychain: { type: 'string' },
        pstack: { type: 'string' },
      },
    }).values
  } catch (e) { throw new Error(`${message(e)}\n${USAGE}`) }
  if (f.mode !== undefined && f.mode !== 'observe' && f.mode !== 'auto') throw new Error(`--mode vuole observe o auto, non "${f.mode}"\n${USAGE}`)
  const mode = f.mode
  const repoEntry = (r: string) => { const [repo, listen] = r.split(':'); return { repo, listen: listen ?? 'explicit' } }
  const path = join(home, 'config.json')
  const existing = existsSync(path) ? jsonObject(readFileSync(path, 'utf8')) : {}
  if (!existing) throw new Error(`${path}: non e' un oggetto JSON valido`)
  const flagged: Record<string, unknown> = {}
  if (f.repo) flagged.repos = f.repo.map(repoEntry)
  if (f.allow) flagged.allowedActors = f.allow
  if (f.label) flagged.serviceLabel = f.label
  if (f.handle) flagged.handles = f.handle
  if (f.keychain) flagged.botKeychainService = f.keychain
  if (f.pstack) flagged.pstackDir = resolve(f.pstack)
  const loads = loaded(home) !== undefined
  if (loads && Object.keys(flagged).length === 0) return { mode }
  if (!loads) {
    const merged = { ...existing, ...flagged }
    if ((merged.repos === undefined || merged.allowedActors === undefined) && f.yes) throw new Error(`con --yes servono --repo e --allow\n${USAGE}`)
    if (merged.repos === undefined) flagged.repos = [repoEntry(await input.ask('Repo da seguire (owner/name): '))]
    if (merged.allowedActors === undefined) flagged.allowedActors = (await input.ask('Login autorizzati a dare lavoro (separati da spazi): ')).split(/\s+/).filter(Boolean)
  }
  const want = { handles: ['/harness'], ...existing, ...flagged }
  parseConfig(want, home)
  return { want, mode }
}

export async function setup(home: string, argv: string[]): Promise<number> {
  const input = openInput()
  try {
    let asked
    try { asked = await wanted(home, argv, input) } catch (e) { console.error(message(e)); return 1 }
    for (const step of steps(home, asked.want, asked.mode, input)) {
      const fix = await step.missing()
      if (fix === undefined) { console.log(`gia' fatto  ${step.label}`); continue }
      if (!step.apply) { console.log(`manca  ${step.label}: ${fix}`); return 1 }
      try { await step.apply() } catch (e) { console.error(message(e)) }
      const after = await step.missing()
      if (after !== undefined) { console.log(`manca  ${step.label}: ${after}`); return 1 }
      console.log(`fatto       ${step.label}`)
    }
  } finally { input.close() }
  console.log('')
  return doctor(home)
}
