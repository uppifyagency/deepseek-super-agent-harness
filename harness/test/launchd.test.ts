import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { DISPOSE_WINDOW_MS, EXIT_TIMEOUT_SECONDS, daemonJob, daemonLoop, describe, readHeartbeat, renderPlist, takeRunLock, writeHeartbeat } from '../src/launchd.ts'
import { loadConfig } from '../src/config.ts'
import type { ServiceState } from '../src/launchd.ts'

const run = promisify(execFile)
const dir = () => mkdtempSync(join(tmpdir(), 'harness-launchd-'))
const LAUNCHD = fileURLToPath(new URL('../src/launchd.ts', import.meta.url))
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

test('the daemon plist lints, runs this Node under env -i, and carries no token', async () => {
  process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'fake-pat'
  process.env.GH_TOKEN = 'fake-gh'
  try {
    const home = dir()
    const plist = renderPlist(daemonJob({ home, serviceLabel: 'it.delera.harness.test' }, 60))
    const path = join(home, 'job.plist')
    writeFileSync(path, plist)
    await run('plutil', ['-lint', path])
    assert.ok(!plist.includes('TOKEN'), 'no TOKEN anywhere in the plist')
    const parsed = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', path])).stdout)
    const args: string[] = parsed.ProgramArguments
    assert.deepEqual(args.slice(0, 2), ['/usr/bin/env', '-i'])
    assert.ok(args.includes(process.execPath), 'runs the Node that installed it')
    assert.deepEqual(args.slice(-3), ['run', '--every', '60'])
    const env: Record<string, string> = parsed.EnvironmentVariables
    for (const k of ['HARNESS_HOME', 'PATH', 'ATOMIC_CODING_AGENT_DIR', 'HOME']) assert.ok(env[k], `${k} set`)
    assert.equal(env.HARNESS_HOME, home)
    assert.ok(env.PATH.startsWith(`${join(process.execPath, '..')}:`), 'this Node first on PATH')
    for (const [k, v] of Object.entries(env)) assert.ok(args.includes(`${k}=${v}`), `env -i passes ${k}`)
    assert.equal(parsed.KeepAlive, true)
    assert.equal(parsed.RunAtLoad, true)
    assert.equal(parsed.ThrottleInterval, 30)
    assert.equal(parsed.ExitTimeOut, EXIT_TIMEOUT_SECONDS)
    assert.equal(parsed.ProcessType, 'Standard', 'Background throttles startup, and every KeepAlive respawn is a startup')
    assert.ok(DISPOSE_WINDOW_MS < EXIT_TIMEOUT_SECONDS * 1000, 'run exits on its own before launchd sends SIGKILL')
    assert.equal(parsed.StandardOutPath, join(home, 'logs', 'daemon.log'))
  } finally {
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    delete process.env.GH_TOKEN
  }
})

test('plist values are XML-escaped', async () => {
  const home = join(dir(), 'a&b <c> "d"')
  const path = join(dir(), 'job.plist')
  writeFileSync(path, renderPlist(daemonJob({ home, serviceLabel: 'x' }, 5)))
  const parsed = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', path])).stdout)
  assert.equal(parsed.EnvironmentVariables.HARNESS_HOME, home)
})

async function holder(home: string, script: string, ...argv: string[]): Promise<ChildProcess> {
  const file = join(dir(), script)
  writeFileSync(file, `import { takeRunLock } from ${JSON.stringify(LAUNCHD)}\nconsole.log(takeRunLock(process.argv.at(-1)).ok)\nsetInterval(() => {}, 1000)\n`)
  const child = spawn(process.execPath, [file, ...argv, home], { stdio: ['ignore', 'pipe', 'inherit'] })
  const line = await new Promise<string>((resolve, reject) => {
    child.stdout!.once('data', (d) => resolve(String(d).trim()))
    child.once('exit', (code) => reject(new Error(`lock holder exited with ${code}`)))
  })
  assert.equal(line, 'true', 'child took the lock')
  return child
}

const exited = (c: ChildProcess) => new Promise((r) => c.once('exit', r))

test('a second run is refused while a live harness run holds the lock', async () => {
  const home = dir()
  const child = await holder(home, 'cli.ts', 'run')
  try {
    assert.deepEqual(takeRunLock(home), { ok: false, holder: child.pid })
  } finally { child.kill(); await exited(child) }
})

test('harness work is refused while a run holds the lock of its home', async () => {
  const home = dir()
  writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: ['uppifyagency/harness-sandbox'], allowedActors: ['uppifyagency'] }))
  const child = await holder(home, 'cli.ts', 'run')
  try {
    const r = await run(process.execPath, [CLI, 'work'], { env: { ...process.env, HARNESS_HOME: home } }).then(() => ({ code: 0, stderr: '' }), (e) => ({ code: e.code as number, stderr: String(e.stderr) }))
    assert.deepEqual(r, { code: 3, stderr: `already running (pid ${child.pid})\n` })
  } finally { child.kill(); await exited(child) }
})

test('a hand-run tick is refused while the daemon holds the lock: one sender per home', async () => {
  const home = dir()
  writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: ['o/r'], allowedActors: ['vlad'] }))
  const child = await holder(home, 'cli.ts', 'run')
  try {
    const r = await run(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'tick'], { env: { ...process.env, HARNESS_HOME: home } }).catch((e) => e)
    assert.equal(r.code, 3)
    assert.match(r.stderr, new RegExp(`daemon \\(pid ${child.pid}\\) runs this home's ticks`))
  } finally { child.kill(); await exited(child) }
})

test('the lock of a dead run is reclaimed', async () => {
  const home = dir()
  const child = await holder(home, 'cli.ts', 'run')
  child.kill('SIGKILL')
  await exited(child)
  const lock = takeRunLock(home)
  assert.ok(lock.ok)
  lock.release()
})

test('a run.lock naming a live pid does not block: only the kernel lock counts', async () => {
  const home = dir()
  const other = spawn('sleep', ['30'])
  try {
    writeFileSync(join(home, 'run.lock'), String(other.pid))
    const lock = takeRunLock(home)
    assert.ok(lock.ok, 'pid reuse and leftover files do not block the daemon')
    lock.release()
  } finally { other.kill(); await exited(other) }
})

test('release frees the lock for the next run', async () => {
  const home = dir()
  const first = takeRunLock(home)
  assert.ok(first.ok)
  first.release()
  const next = await holder(home, 'cli.ts', 'run')
  try {
    assert.deepEqual(takeRunLock(home), { ok: false, holder: next.pid })
  } finally { next.kill(); await exited(next) }
})

test('six runs racing for the lock of a SIGKILLed run: exactly one holds it, every time', async () => {
  const racer = join(dir(), 'cli.ts')
  writeFileSync(racer, `import { takeRunLock } from ${JSON.stringify(LAUNCHD)}\nconst at = Number(process.argv.at(-2))\nwhile (Date.now() < at) {}\nconsole.log(takeRunLock(process.argv.at(-1)).ok)\nsetInterval(() => {}, 1000)\n`)
  for (let trial = 0; trial < 5; trial++) {
    const home = dir()
    const dead = await holder(home, 'cli.ts', 'run')
    dead.kill('SIGKILL')
    await exited(dead)
    const at = Date.now() + 1000
    const kids = Array.from({ length: 6 }, () => spawn(process.execPath, [racer, 'run', String(at), home], { stdio: ['ignore', 'pipe', 'inherit'] }))
    try {
      const said = await Promise.all(kids.map((k) => new Promise<string>((r) => { k.stdout!.once('data', (d) => r(String(d).trim())); k.once('exit', (c) => r(`exit ${c}`)) })))
      assert.deepEqual(said.filter((x) => x !== 'false'), ['true'], `trial ${trial}: ${said.join(' ')}`)
    } finally { await Promise.all(kids.map((k) => { if (k.exitCode === null) { k.kill('SIGKILL'); return exited(k) } })) }
  }
})

test('a relative HARNESS_HOME is written into the plist as an absolute path', () => {
  const job = daemonJob({ home: 'rel/home', serviceLabel: 'x' }, 5)
  assert.equal(job.env.HARNESS_HOME, join(process.cwd(), 'rel/home'))
  assert.equal(job.log, join(process.cwd(), 'rel/home', 'logs', 'daemon.log'))
})

test('stop during a step: the next step never starts, no idle heartbeat, the loop ends', async () => {
  const calls: string[] = []
  let finishTick = () => {}
  const loop = daemonLoop({
    steps: [() => { calls.push('tick'); return new Promise<void>((r) => { finishTick = r }) }, async () => { calls.push('startRuns') }],
    beat: (b) => calls.push(`beat ${b.tick} ${b.busySince ? 'busy' : 'idle'}`),
    everyMs: 60_000,
    onError: (e) => { throw e },
  })
  await new Promise((r) => setImmediate(r))
  loop.stop()
  finishTick()
  await loop.done
  assert.deepEqual(calls, ['beat 0 busy', 'tick'])
})

test('the heartbeat keeps beating while a step is still running, and says since when it is busy', async () => {
  const beats: { tick: number; busySince?: string }[] = []
  let finish = () => {}
  const loop = daemonLoop({ steps: [() => new Promise<void>((r) => { finish = r })], beat: (b) => beats.push(b), everyMs: 20, onError: (e) => { throw e } })
  await new Promise((r) => setTimeout(r, 150))
  assert.ok(beats.length >= 4, `beats during one long step: ${beats.length}`)
  assert.ok(beats.every((b) => b.tick === 0 && b.busySince === beats[0].busySince), 'same lap, same busySince')
  finish()
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(beats.at(-1)!.tick, 1)
  loop.stop()
  await loop.done
})

test('stop during the sleep ends the loop at once', async () => {
  let beats = 0
  const loop = daemonLoop({ steps: [async () => {}], beat: () => { beats++ }, everyMs: 60_000, onError: (e) => { throw e } })
  await new Promise((r) => setTimeout(r, 20))
  const t0 = Date.now()
  loop.stop()
  await loop.done
  assert.equal(beats, 2, 'one beat when the lap starts, one when it ends')
  assert.ok(Date.now() - t0 < 1000, 'no 60 s wait')
})

test('heartbeat round-trips and a malformed one reads as missing', () => {
  const home = dir()
  assert.equal(readHeartbeat(home), undefined)
  writeHeartbeat(home, { pid: 7, since: '2026-11-02T09:00:00.000Z', at: '2026-11-02T10:00:00.000Z', tick: 3, everyMs: 60_000 })
  assert.deepEqual(readHeartbeat(home), { pid: 7, since: '2026-11-02T09:00:00.000Z', at: '2026-11-02T10:00:00.000Z', tick: 3, everyMs: 60_000 })
  writeFileSync(join(home, 'heartbeat.json'), '{"pid":')
  assert.equal(readHeartbeat(home), undefined)
})

test('describe says what service status prints', () => {
  const now = Date.parse('2026-11-02T10:01:00.000Z')
  const hb = { pid: 42, since: '2026-11-02T09:00:00.000Z', at: '2026-11-02T10:00:48.000Z', tick: 9, everyMs: 60_000 }
  const cases: [ServiceState, typeof hb | undefined, string][] = [
    [{ kind: 'absent' }, undefined, 'not installed'],
    [{ kind: 'unloaded' }, hb, 'installed, not loaded'],
    [{ kind: 'loaded' }, hb, 'installed, not running'],
    [{ kind: 'running', pid: 42 }, hb, 'running pid=42 last heartbeat 12s ago'],
    [{ kind: 'running', pid: 43 }, hb, 'running pid=43, no heartbeat yet'],
    [{ kind: 'running', pid: 42 }, undefined, 'running pid=42, no heartbeat yet'],
  ]
  for (const [s, h, want] of cases) assert.equal(describe(s, h, now), want)
})

test('the default service label is it.delera.harness for ~/.harness and distinct and stable for any other home', () => {
  const user = dir()
  const homes = [join(user, '.harness'), join(user, 'lane-a'), join(user, 'lane-b')]
  for (const h of homes) { mkdirSync(h); writeFileSync(join(h, 'config.json'), JSON.stringify({ repos: ['o/r'], allowedActors: ['vlad'] })) }
  const saved = process.env.HOME
  process.env.HOME = user
  try {
    const labels = homes.map((h) => loadConfig(h).serviceLabel)
    assert.equal(labels[0], 'it.delera.harness')
    assert.equal(new Set(labels).size, 3, 'no two homes share a label')
    assert.equal(loadConfig(`${homes[1]}/`).serviceLabel, labels[1], 'same home, same label')
    writeFileSync(join(homes[2], 'config.json'), JSON.stringify({ repos: ['o/r'], allowedActors: ['vlad'], serviceLabel: 'it.delera.harness.l7' }))
    assert.equal(loadConfig(homes[2]).serviceLabel, 'it.delera.harness.l7', 'an explicit label wins')
  } finally { process.env.HOME = saved }
})
