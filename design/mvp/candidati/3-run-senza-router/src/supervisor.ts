// supervisor.ts: the launchd KeepAlive process and the `harness` CLI entry. Holds no state of its
// own beyond in-flight promises: everything it decides is re-derivable from the store on restart.
// It never calls a model. It moves data between three deep modules: github, store, runs.

import { openStore, type Store } from './store'
import { openRuns, type Runs } from './runs'
import { openGitHub, type GitHub } from './github'

export interface Config {
  repos: string[]                      // 1-3 of Vlad's repos
  vlad: string                         // GitHub login; the only `explicit` author in the MVP
  storePath: string                    // ~/.harness/harness.sqlite
  journalPath: string                  // ~/.harness/atomic.sqlite
  slots: number                        // 3 concurrent attempts; +1 reserved for attempts unblocked by Vlad's answer
  tickMs: number                       // 15_000; GitHub poll every 4th tick (60 s)
  rules: { id: string; text: string; enabled: boolean }[]   // semantic policies for the router prompt
}

/** Boot, reconcile, then tick forever. Every step is idempotent, so a crash mid-tick is a no-op rerun. */
export async function supervise(cfg: Config, signal: AbortSignal): Promise<void> {
  throw new Error('not implemented')
  // const store = openStore(cfg.storePath)
  // const github = openGitHub({ repos: cfg.repos, vlad: cfg.vlad, token: keychainToken })
  // const runs = openRuns({ journal, cwdFor, model, routerBudget, recall: (id) => render(store.recall(id)), publish: github.publish })
  // runs.onSettled((e) => { store.applyRunEnded(e) })          // replies, gates, next attempts all derive from here
  // await sleepUntilLeaseExpired(cfg.journalPath)               // ~120 s after an unclean exit (ground-atomic-host.md 2.3)
  // await runs.reconcile(store.liveRuns())
  // while (!signal.aborted) { await tick(store, runs, github, cfg); await sleep(cfg.tickMs) }
}

/**
 * One pass. Order matters only for latency, not correctness:
 *  1. store.heartbeat()                                     (watchdog liveness)
 *  2. poll (every 4th tick): for t of github.poll(cursor) -> store.intake(t);
 *       passed-through + live -> runs.steerLive(attempt, card)
 *     cursor.advance only after every trigger of the page was taken in
 *  3. stops: for s of store.pendingStops() -> runs.stop(s.attempt)        (re-issued until RunEnded)
 *  4. watchdog verdicts since last seq: 'stuck' -> store.stop(ticket, evidence) + gate 'stuck'
 *  5. router: pack = store.nextRouterBatch(); if pack -> runs.start({kind:'router-batch', pack})
 *  6. attempts: for spec of store.runnableAttempts(free slots) -> store.markStarted; runs.start(spec)
 *  7. outbox: for r of store.pendingReplies() -> github.reply(r) -> store.settleReply
 *       (FIFO per thread; GitHub down -> leave pending, no failure count)
 */
export async function tick(store: Store, runs: Runs, github: GitHub, cfg: Config): Promise<void> {
  throw new Error('not implemented')
}

/**
 * `harness <cmd>`. Every command except `supervise` opens the store directly, does one store
 * method, prints, exits. The running supervisor sees the change on its next tick: no IPC.
 *   status | attention | answer <gate> <text> | stop <ticket> | recall <id> | mode <m>
 *   ask <text>     -> store.intake({thread:'local:ask', kind:'local', author: vlad, addressed: true})
 *   init | launchd install | supervise | watchdog
 */
export async function main(argv: string[]): Promise<number> {
  throw new Error('not implemented')
}
