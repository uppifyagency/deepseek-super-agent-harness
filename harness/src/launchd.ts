// launchd.ts: the LaunchAgents (daemon and watchdog: render, install, status), the one-run-per-home lock, the heartbeat.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessConfig } from './config.ts'

export interface Job {
  label: string
  program: readonly string[]
  env: Readonly<Record<string, string>>
  log: string
  schedule: { kind: 'keep-alive'; throttleSeconds: number } | { kind: 'interval'; seconds: number }
  exitTimeoutSeconds: number
}

/** Standard, not Background: under Background the first heartbeat came 3 times later (12.5 s vs 4.2 s) and startup used 4 times the CPU, with no saving at idle (measured 02/11, design/mvp/e2e/a1/logs/fix2/processtype.tsv). */
const PROCESS_TYPE = 'Standard'

/** engine.dispose() took 18 to 58 ms, and at most 1.5 s when the verify tool ignored cancellation (measured 02/11, e2e/a1). */
export const EXIT_TIMEOUT_SECONDS = 10
export const DISPOSE_WINDOW_MS = (EXIT_TIMEOUT_SECONDS - 3) * 1000
const BOOTOUT_DEADLINE_MS = (EXIT_TIMEOUT_SECONDS + 5) * 1000

export function daemonEnv(home: string): Record<string, string> {
  const user = userInfo().username
  const thisNodeBin = dirname(process.execPath)
  const env: Record<string, string> = {
    HOME: homedir(),
    USER: user,
    LOGNAME: user,
    SHELL: process.env.SHELL ?? '/bin/zsh',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    PATH: [thisNodeBin, join(homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HARNESS_HOME: home,
    ATOMIC_CODING_AGENT_DIR: process.env.ATOMIC_CODING_AGENT_DIR ?? join(homedir(), '.atomic', 'agent'),
  }
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR
  return env
}

export const DAEMON_EVERY_S = 60

export function daemonJob(config: Pick<HarnessConfig, 'home' | 'serviceLabel'>, every: number): Job {
  const home = resolve(config.home)
  return {
    label: config.serviceLabel,
    program: [process.execPath, fileURLToPath(new URL('./cli.ts', import.meta.url)), 'run', '--every', String(every)],
    env: daemonEnv(home),
    log: join(home, 'logs', 'daemon.log'),
    schedule: { kind: 'keep-alive', throttleSeconds: 30 },
    exitTimeoutSeconds: EXIT_TIMEOUT_SECONDS,
  }
}

export const WATCHDOG_INTERVAL_SECONDS = 120

/** it.delera.harness.w3 -> it.delera.harness.watchdog.w3; any other label gets a `.watchdog` suffix. */
export function watchdogLabel(serviceLabel: string): string {
  const prefix = 'it.delera.harness'
  if (serviceLabel === prefix) return `${prefix}.watchdog`
  return serviceLabel.startsWith(`${prefix}.`) ? `${prefix}.watchdog.${serviceLabel.slice(prefix.length + 1)}` : `${serviceLabel}.watchdog`
}

/** One check per interval (article 6: scheduled messages). Outcomes go to watchdog.log; this log keeps stray output. */
export function watchdogJob(config: Pick<HarnessConfig, 'home' | 'serviceLabel'>): Job {
  const home = resolve(config.home)
  return {
    label: watchdogLabel(config.serviceLabel),
    program: [process.execPath, fileURLToPath(new URL('./cli.ts', import.meta.url)), 'watchdog', '--once'],
    env: daemonEnv(home),
    log: join(home, 'logs', 'watchdog.out'),
    schedule: { kind: 'interval', seconds: WATCHDOG_INTERVAL_SECONDS },
    exitTimeoutSeconds: EXIT_TIMEOUT_SECONDS,
  }
}

export function plistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const str = (s: string) => `<string>${xml(s)}</string>`

/**
 * ProgramArguments start with `/usr/bin/env -i K=V ...`, so node starts with exactly job.env even when the
 * user's launchd domain carries a token (`launchctl setenv`): plist keys can add or override inherited
 * variables but never delete them; `env -i` can.
 */
export function renderPlist(job: Job): string {
  const vars = Object.entries(job.env)
  const args = ['/usr/bin/env', '-i', ...vars.map(([k, v]) => `${k}=${v}`), ...job.program]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(job.label)}
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    ${str(a)}`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${vars.map(([k, v]) => `    <key>${xml(k)}</key>${str(v)}`).join('\n')}
  </dict>
  <key>WorkingDirectory</key>${str(job.env.HOME ?? homedir())}
  <key>RunAtLoad</key><true/>
${job.schedule.kind === 'keep-alive'
    ? `  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>${job.schedule.throttleSeconds}</integer>`
    : `  <key>KeepAlive</key><false/>\n  <key>StartInterval</key><integer>${job.schedule.seconds}</integer>`}
  <key>ExitTimeOut</key><integer>${job.exitTimeoutSeconds}</integer>
  <key>ProcessType</key>${str(PROCESS_TYPE)}
  <key>StandardOutPath</key>${str(job.log)}
  <key>StandardErrorPath</key>${str(job.log)}
</dict>
</plist>
`
}

export type ServiceState =
  | { kind: 'absent' }
  | { kind: 'unloaded' }
  | { kind: 'loaded' }
  | { kind: 'running'; pid: number; startedAt?: number }

const NOT_LOADED = 113
const NO_SUCH_PROCESS = 3
const target = (label: string) => `gui/${process.getuid!()}/${label}`

function launchctl(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('launchctl', args, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` })
    })
  })
}

function check(r: { code: number; out: string }, what: string): void {
  if (r.code !== 0) throw new Error(`launchctl ${what} failed (${r.code}): ${r.out.trim()}`)
}

export async function state(label: string): Promise<ServiceState> {
  const r = await launchctl('print', target(label))
  if (r.code === NOT_LOADED) return existsSync(plistPath(label)) ? { kind: 'unloaded' } : { kind: 'absent' }
  check(r, 'print')
  const pid = /^\s*pid = (\d+)$/m.exec(r.out)
  if (!pid) return { kind: 'loaded' }
  const age = await new Promise<number | undefined>((res) => execFile('ps', ['-o', 'etime=', '-p', pid[1]], (_e, out) => res(parseEtime(String(out ?? '')))))
  return { kind: 'running', pid: Number(pid[1]), ...(age !== undefined ? { startedAt: Date.now() - age } : {}) }
}

/** `ps -o etime=`: [[dd-]hh:]mm:ss -> ms. */
export function parseEtime(out: string): number | undefined {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(out)
  return m ? (((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000 : undefined
}

export async function install(job: Job): Promise<ServiceState> {
  mkdirSync(dirname(job.log), { recursive: true })
  const path = plistPath(job.label)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, renderPlist(job))
  execFileSync('plutil', ['-lint', `${path}.tmp`], { stdio: 'pipe' })
  renameSync(`${path}.tmp`, path)
  await bootout(job.label)
  check(await launchctl('bootstrap', `gui/${process.getuid!()}`, path), 'bootstrap')
  return state(job.label)
}

/**
 * bootout returns before teardown ends, and a bootstrap right after fails with "5: Input/output error":
 * wait until launchd forgets the label.
 */
async function bootout(label: string): Promise<void> {
  const r = await launchctl('bootout', target(label))
  if (r.code === NO_SUCH_PROCESS || r.code === NOT_LOADED) return
  check(r, 'bootout')
  const deadline = Date.now() + BOOTOUT_DEADLINE_MS
  while ((await launchctl('print', target(label))).code !== NOT_LOADED) {
    if (Date.now() > deadline) throw new Error(`${label} still loaded ${BOOTOUT_DEADLINE_MS / 1000} s after bootout`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

export async function uninstall(label: string): Promise<void> {
  await bootout(label)
  rmSync(plistPath(label), { force: true })
}

export async function installService(config: Pick<HarnessConfig, 'home' | 'serviceLabel'>, every = DAEMON_EVERY_S): Promise<void> {
  await install(daemonJob(config, every))
  await install(watchdogJob(config))
}

export async function uninstallService(config: Pick<HarnessConfig, 'serviceLabel'>): Promise<void> {
  await uninstall(watchdogLabel(config.serviceLabel))
  await uninstall(config.serviceLabel)
}

export async function restart(label: string): Promise<ServiceState> {
  const r = await launchctl('kickstart', '-k', target(label))
  if (r.code !== NOT_LOADED) check(r, 'kickstart')
  return state(label)
}

/**
 * After stop() no further step starts and the sleep ends at once; a step already running finishes on its own.
 * beat() runs on its own timer every everyMs, not after a lap: a router turn can take 10 minutes, and the
 * event loop keeps beating through it. Only a frozen or blocked process stops beating. `busySince` is when
 * the lap in progress started (undefined while sleeping), so an await that never settles is visible too.
 */
export function daemonLoop(o: { steps: readonly (() => Promise<void>)[]; beat(b: { tick: number; busySince?: string }): void; everyMs: number; onError(e: unknown): void }): { stop(): void; done: Promise<void> } {
  let stopping = false
  let wake = () => {}
  let tick = 0
  let busySince: string | undefined
  const beat = () => o.beat({ tick, ...(busySince ? { busySince } : {}) })
  const timer = setInterval(beat, o.everyMs)
  const done = (async () => {
    while (!stopping) {
      busySince = new Date().toISOString()
      beat()
      try { for (const step of o.steps) { if (stopping) break; await step() } } catch (e) { o.onError(e) }
      if (stopping) break
      tick++
      busySince = undefined
      beat()
      await new Promise<void>((r) => { const t = setTimeout(r, o.everyMs); wake = () => { clearTimeout(t); r() } })
    }
    clearInterval(timer)
  })()
  return { stop() { stopping = true; wake() }, done }
}

export interface Heartbeat { pid: number; since: string; at: string; tick: number; everyMs: number; busySince?: string }

export function writeHeartbeat(home: string, hb: Heartbeat): void {
  const path = join(home, 'heartbeat.json')
  writeFileSync(`${path}.tmp`, JSON.stringify(hb) + '\n')
  renameSync(`${path}.tmp`, path)
}

export function readHeartbeat(home: string): Heartbeat | undefined {
  try {
    const hb = JSON.parse(readFileSync(join(home, 'heartbeat.json'), 'utf8')) as Partial<Heartbeat>
    return typeof hb.pid === 'number' && typeof hb.since === 'string' && typeof hb.at === 'string' && typeof hb.tick === 'number' && typeof hb.everyMs === 'number' ? hb as Heartbeat : undefined
  } catch { return undefined }
}

export function describe(s: ServiceState, hb: Heartbeat | undefined, now: number): string {
  switch (s.kind) {
    case 'absent': return 'not installed'
    case 'unloaded': return 'installed, not loaded'
    case 'loaded': return 'installed, not running'
    case 'running':
      if (!hb || hb.pid !== s.pid) return `running pid=${s.pid}, no heartbeat yet`
      return `running pid=${s.pid} last heartbeat ${Math.round((now - Date.parse(hb.at)) / 1000)}s ago`
  }
}

export type LockResult = { ok: true; release(): void } | { ok: false; holder?: number }

/** Open handles hold the locks: a collected DatabaseSync would close and drop its lock. */
const heldLocks = new Set<DatabaseSync>()
const SQLITE_BUSY = 5
/** With no wait, six processes racing for a free lock all got BUSY (measured 02/11): SQLite retries for this long. */
const LOCK_WAIT_MS = 1000

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

/**
 * One `run` per home: an exclusive SQLite transaction on run.lock.db, held for the life of the process.
 * The kernel drops the lock when the process dies, SIGKILL included, so there is never a stale lock
 * to take over. run.lock only names the holder, for the refusal message.
 */
export function takeRunLock(home: string): LockResult {
  const db = new DatabaseSync(join(home, 'run.lock.db'), { timeout: LOCK_WAIT_MS })
  try { db.exec('BEGIN EXCLUSIVE') } catch (err) {
    db.close()
    if ((err as { errcode?: number }).errcode !== SQLITE_BUSY) throw err
    return { ok: false, holder: lockHolder(home) }
  }
  heldLocks.add(db)
  const pidFile = join(home, 'run.lock')
  writeFileSync(`${pidFile}.tmp`, String(process.pid))
  renameSync(`${pidFile}.tmp`, pidFile)
  return {
    ok: true,
    release: () => {
      if (!heldLocks.delete(db)) return
      rmSync(pidFile, { force: true })
      db.close()
    },
  }
}

/** The holder writes run.lock just after it takes the lock: a reader in between sees no file or a dead pid. */
function lockHolder(home: string): number | undefined {
  for (let i = 0; i < 50; i++) {
    try {
      const pid = Number(readFileSync(join(home, 'run.lock'), 'utf8'))
      if (pid > 0 && alive(pid)) return pid
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  return undefined
}
