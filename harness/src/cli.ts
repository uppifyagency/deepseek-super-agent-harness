#!/usr/bin/env node
// cli.ts: `harness <command>`. Thin: parse argv, open the log, call the harness, print.
//
//   harness init --repo owner/name[:listen] ... --allow <login> ...   write ~/.harness/config.json
//   harness poll [--once] [--every <seconds>]                           GitHub -> log (read-only)
//   harness recall <id | issue:owner/name#n>                            Chain of Recall
//   harness status                                                      mode, policy, filter counts
//   harness                                                             what needs Vlad (empty when nothing)
//   harness tick | run [--every <s>]                                    poll -> router -> outbox (+ runs, in `run`), once or forever
//   harness work                                                        plan runs for open tickets, run them in Atomic, wait
//   harness ask "<text>"                                                talk to the router from the terminal
//   harness policy off|observe|auto [--workers 1|2|3]                   accept mode, parallel workers
//   harness answer <gate> <text>                                        answer a worker's question from the terminal
//   harness mcp                                                         the router's MCP server (stdio)
//   harness service install [--every <s>] | uninstall | status | restart   keep `run` alive under launchd, with its watchdog
//   harness watchdog --once                                             one watchdog check (launchd runs it every 120 s)
//   harness doctor                                                      every prerequisite: ok, or manca + the fixing command
//   harness setup [--yes] [--repo ..] [--allow ..] [--label ..] ...      do what it can alone, then doctor

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { harnessHome, loadConfig } from './config.ts'
import { pollRepo, send } from './github.ts'
import { serveMcp } from './mcp.ts'
import { wakeRouter } from './router.ts'
import type { Harness } from './service.ts'
import type { HarnessConfig } from './config.ts'
import { openLog } from './log.ts'
import { openHarness, VIEWS } from './service.ts'
import { openEngine } from './engine.ts'
import { doctor, setup } from './setup.ts'
import type { Engine } from './engine.ts'
import { DAEMON_EVERY_S, DISPOSE_WINDOW_MS, daemonLoop, describe, installService, readHeartbeat, restart, state, takeRunLock, uninstallService, watchdogLabel, writeHeartbeat } from './launchd.ts'
import { daemonHealth, lastWake, readRouterWakes, routerHealth, showDaemon, watchdogOnce } from './watchdog.ts'

function flags(args: string[], name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[++i])
  return out
}

/** One router turn if there is work; every wake is recorded in router-runs.jsonl (cost, time, denials). */
async function routeOnce(h: Harness, home: string): Promise<void> {
  if (!h.routerHasWork()) return
  const r = await wakeRouter({ home, rotateAboveUsd: loadConfig(home).routerRotateAboveUsd })
  appendFileSync(join(home, 'router-runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...r, text: r.text.slice(0, 300) }) + '\n')
  console.log(`router: ok=${r.ok}${r.rotated ? ' (new session)' : ''} cost=$${r.costUsd?.toFixed(4)} time=${((r.durationMs ?? 0) / 1000).toFixed(1)}s turns=${r.turns} denied=${JSON.stringify(r.denied)}`)
  if (!r.ok) console.log(`router failed: ${r.text}`)
}

/** Send every pending GitHub reply; operator replies stay for `harness ask` to print. */
async function drainOutbox(h: Harness): Promise<void> {
  for (const [intent, item] of Object.entries(h.pending())) {
    if (item.to.kind !== 'issue') continue
    const r = await send(item.to, item.text, intent)
    h.settle(intent, r.result, r.url)
    console.log(`reply ${r.result}: ${r.url ?? intent}`)
  }
}

async function tick(h: Harness, config: HarnessConfig): Promise<void> {
  for (const { repo } of config.repos) {
    const counts: Record<string, number> = {}
    const n = await pollRepo(config.home, repo, (d) => { const r = h.ingest(d); counts[r] = (counts[r] ?? 0) + 1 })
    console.log(`${new Date().toISOString()} ${repo}: ${n} items ${JSON.stringify(counts)}`)
  }
  await routeOnce(h, config.home)
  await drainOutbox(h)
}

async function driveRuns(h: Harness, engine: Engine): Promise<void> {
  for (const run of h.intendStops()) if (h.runsToStop().includes(run)) console.log(`run ${run} stop: ${await engine.stop(run)}`)
  for (const run of h.planRuns()) console.log(`run intended: ${run}`)
  for (const r of h.liveRuns()) {
    if (!r.atomic || engine.owns(r.run)) continue
    await engine.resume(r.run, r.atomic)
    console.log(`run ${r.run} resuming ${r.atomic} (after Atomic's lease)`)
  }
  for (const run of h.runsToStart()) {
    const { spec } = h.runSpec(run)
    await engine.start(run)
    console.log(`run ${run} started (ticket ${spec.ticket}, attempt ${spec.attempt}, ${spec.models.worker})`)
  }
}

function holdRunLock(home: string): boolean {
  const lock = takeRunLock(home)
  if (!lock.ok) {
    console.error(lock.holder ? `already running (pid ${lock.holder})` : 'already running (the lock is changing hands, pid not known yet)')
    return false
  }
  process.on('exit', lock.release)
  return true
}

async function service([sub, ...rest]: string[], config: HarnessConfig): Promise<number> {
  const every = Number(flags(rest, '--every')[0] ?? DAEMON_EVERY_S)
  const watchdog = watchdogLabel(config.serviceLabel)
  if (sub === 'install' && Number.isInteger(every) && every > 0) await installService(config, every)
  else if (sub === 'uninstall') await uninstallService(config)
  else if (sub === 'restart') await restart(config.serviceLabel)
  else if (sub !== 'status') { console.error('usage: harness service install [--every <s>] | uninstall | status | restart'); return 1 }
  console.log(`${config.serviceLabel}: ${describe(await state(config.serviceLabel), readHeartbeat(config.home), Date.now())}`)
  const w = await state(watchdog)
  console.log(`${watchdog}: ${w.kind === 'absent' ? 'not installed' : w.kind === 'unloaded' ? 'installed, not loaded' : w.kind === 'running' ? `checking now, pid=${w.pid}` : 'loaded, next check within 120 s'}`)
  return 0
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv
  const home = harnessHome()

  if (cmd === 'init') {
    const repos = flags(args, '--repo').map((r) => { const [repo, listen] = r.split(':'); return { repo, listen: listen ?? 'explicit' } })
    const allowedActors = flags(args, '--allow')
    if (repos.length === 0 || allowedActors.length === 0) { console.error('usage: harness init --repo owner/name[:explicit|candidates|ignore] --allow <login>'); return 1 }
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const path = join(home, 'config.json')
    if (existsSync(path) && !args.includes('--force')) { console.error(`${path} exists (use --force)`); return 1 }
    writeFileSync(path, JSON.stringify({ repos, allowedActors, handles: ['/harness'] }, null, 2) + '\n', { mode: 0o600 })
    console.log(`wrote ${path}`)
    return 0
  }
  if (cmd === 'doctor') return doctor(home)
  if (cmd === 'setup') return setup(home, args)

  const config = loadConfig(home)
  if (cmd === 'service') return service(args, config)
  if (cmd === 'watchdog') {
    if (!args.includes('--once')) { console.error('usage: harness watchdog --once'); return 1 }
    console.log(await watchdogOnce(config))
    return 0
  }
  const log = openLog(join(home, 'log.sqlite'), VIEWS)
  const harness = openHarness(log, config)
  try {
    switch (cmd) {
      case 'poll': {
        const every = Number(flags(args, '--every')[0] ?? 60)
        do {
          for (const { repo } of config.repos) {
            const counts: Record<string, number> = {}
            const n = await pollRepo(home, repo, (d) => { const r = harness.ingest(d); counts[r] = (counts[r] ?? 0) + 1 })
            console.log(`${new Date().toISOString()} ${repo}: ${n} items ${JSON.stringify(counts)}`)
          }
          if (args.includes('--once')) break
          await new Promise((r) => setTimeout(r, every * 1000))
        } while (true)
        return 0
      }
      case 'recall': {
        const card = harness.recall(args[0] ?? '')
        if (!card) { console.error(`not found: ${args[0]}`); return 4 }
        console.log(`${card.kind} ${card.id}\n${card.preview}`)
        for (const n of card.next) console.log(`  -> ${n.rel.padEnd(16)} ${n.id}  ${n.preview}`)
        return 0
      }
      case 'status': {
        console.log(JSON.stringify(harness.status(), null, 2))
        return 0
      }
      case undefined:
      case 'attention': {
        const items = harness.attention()
        for (const i of items) {
          if (i.kind === 'would-accept') console.log(`WOULD  ${i.thread}  "${i.title}"  (${i.scope})`)
          else if (i.kind === 'gate') console.log(`ASK    ${i.thread}  ${i.question}${i.options.length ? `  [${i.options.join(' | ')}]` : ''}  -> harness answer ${i.gate} "<answer>"`)
          else if (i.kind === 'discarded') console.log(`DISCARDED  ${i.thread}  "${i.title}"  ${i.reason}`)
          else if (i.kind === 'stuck') console.log(`STUCK  ${i.thread}  ${i.reason.replace(/\s+/g, ' ').slice(0, 300)}`)
          else console.log(`GONE   ${i.thread}  reply ${i.intent}`)
        }
        const router = routerHealth(readRouterWakes(home))
        if (router.kind === 'down') console.log(`ROUTER down since ${router.since}  ${router.failures} failed wakes: ${router.last}`)
        const daemon = daemonHealth(await state(config.serviceLabel), readHeartbeat(home), Date.now(), lastWake())
        if (daemon.kind === 'stale' || daemon.kind === 'hung' || daemon.kind === 'boot-hung') console.log(`DAEMON ${showDaemon(daemon)}: the watchdog restarts it at its next check`)
        return 0
      }
      case 'tick': {
        const lock = takeRunLock(home)
        if (!lock.ok) { console.error(`the daemon (pid ${lock.holder}) runs this home's ticks`); return 3 }
        try { await tick(harness, config) } finally { lock.release() }
        return 0
      }
      case 'run': {
        const every = Number(flags(args, '--every')[0] ?? DAEMON_EVERY_S)
        const since = new Date().toISOString()
        if (!holdRunLock(home)) return 3
        const beat = (b: { tick: number; busySince?: string }) => writeHeartbeat(home, { pid: process.pid, since, at: new Date().toISOString(), everyMs: every * 1000, ...b })
        // Opening Atomic stalled 2 minutes in five homes at once (02/11): beat through it, so the watchdog sees a live, busy daemon.
        const booting = { tick: 0, busySince: new Date().toISOString() }
        beat(booting)
        const bootBeat = setInterval(() => beat(booting), every * 1000)
        const engine = await openEngine(home, harness, config).finally(() => clearInterval(bootBeat))
        const loop = daemonLoop({
          steps: [() => tick(harness, config), () => driveRuns(harness, engine)],
          beat,
          everyMs: every * 1000,
          onError: (err) => console.error(`tick failed: ${String(err)}`),
        })
        let stopping: Promise<never> | undefined
        const stop = () => {
          stopping ??= (async () => {
            loop.stop()
            const disposed = await Promise.race([engine.dispose().then(() => true), new Promise<false>((r) => setTimeout(r, DISPOSE_WINDOW_MS, false))])
            if (!disposed) console.error(`engine.dispose() unfinished after ${DISPOSE_WINDOW_MS / 1000} s, exiting before launchd's SIGKILL`)
            process.exit(0)
          })()
        }
        process.once('SIGTERM', stop)
        process.once('SIGINT', stop)
        await loop.done
        return await stopping!
      }
      case 'work': {
        if (!holdRunLock(home)) return 3
        const engine = await openEngine(home, harness, config)
        try {
          await driveRuns(harness, engine)
          await engine.idle()
        } finally { await engine.dispose() }
        for (const r of Object.values(harness.runs())) console.log(JSON.stringify(r))
        return 0
      }
      case 'ask': {
        const text = args.join(' ').trim()
        if (!text) { console.error('usage: harness ask "<text>"'); return 1 }
        harness.ask(text, randomUUID())
        await routeOnce(harness, config.home)
        for (const [intent, item] of Object.entries(harness.pending())) {
          if (item.to.kind !== 'system') continue
          console.log(item.text)
          harness.settle(intent, 'sent')
        }
        // Two senders can post the same reply (send() checks, then posts): only the lock holder sends to GitHub.
        const lock = takeRunLock(home)
        if (lock.ok) { try { await drainOutbox(harness) } finally { lock.release() } }
        return 0
      }
      case 'answer': {
        const [gate, ...rest] = args
        const r = harness.answer(gate ?? '', rest.join(' '), 'human', randomUUID())
        console.log(r.ok ? (r.already ? 'already answered' : 'answered') : r.problem)
        return r.ok ? 0 : 1
      }
      case 'policy': {
        const m = args[0]
        const w = flags(args, '--workers')[0]
        if ((m !== 'off' && m !== 'observe' && m !== 'auto') || (w !== undefined && !['1', '2', '3'].includes(w))) { console.error('usage: harness policy off|observe|auto [--workers 1|2|3]'); return 1 }
        harness.setPolicy(m, randomUUID(), w === undefined ? undefined : Number(w) as 1 | 2 | 3)
        console.log(`mode: ${harness.status().mode}, workers: ${harness.status().maxWorkers}`)
        return 0
      }
      case 'mcp': { await serveMcp(harness, home); return 0 }
      default:
        console.error('usage: harness [attention] | init | setup | doctor | poll [--once] | tick | run | ask "<text>" | recall <id> | status | policy <mode> | mcp | service <sub> | watchdog --once')
        return 1
    }
  } finally {
    log.close()
  }
}

process.exitCode = await main(process.argv.slice(2))
