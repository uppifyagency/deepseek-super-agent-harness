// daemon.ts: composition root, launchd entry (`node daemon.ts`), CLI (`harness ...`), attention page.
// Owns no state of its own: every loop keeps only a seq cursor, and losing it means re-reacting,
// which is idempotent.

import { openLog } from './log.ts'
import { openHarness, type Harness } from './service.ts'
import { openEngine, type Engine } from './engine.ts'
import { openRouter, type Router } from './router.ts'
import { githubSource, type GitHub } from './github.ts'

export async function main(home = `${process.env.HOME}/.harness`): Promise<void> {
  throw new Error('not implemented')
  // assert env: PI_CODING_AGENT_DIR=$HOME/.atomic/agent, GH_CONFIG_DIR=<empty>, GIT_CONFIG_NOSYSTEM=1
  //   (refuse to start otherwise: the credential boundary is a precondition, not a hope)
  // const config = parseConfig(`${home}/config.json`)            // zod at the boundary
  // const log = openLog(`${home}/log.sqlite`, VIEWS)
  // const harness = openHarness(log, config)
  // const engine = await openEngine({ home, host: harness.engineHost() })
  // const router = await openRouter(harness.routerPort(), { home })
  // await engine.recover(harness.liveRuns())
  // runLoops({ harness, engine, router, github, log }); serveAttention(harness, 4777); heartbeat()
}

/**
 * Five loops, one process, no shared mutable state beyond the log:
 *  1. poll:     every 60 s github.poll(harness.ingest)
 *  2. react:    for e of log.tail -> harness.react(e.id)
 *  3. effects:  on every tail event, for intent of harness.pending():
 *                 run -> engine.start   stop -> engine.stop   reply -> github.send -> harness.settle
 *               (reply FIFO per issue; a thrown send is retried on the next pass)
 *  4. router:   for (;;) router.wake(await routerPort.next(signal))   one turn at a time; batching
 *               is whatever accumulated while the previous turn ran
 *  5. heartbeat: every 30 s write ~/.harness/alive {pid, seq: log head, at}. The watchdog reads it.
 */
declare function runLoops(x: { harness: Harness; engine: Engine; router: Router; github: GitHub }): () => Promise<void>

/**
 * 127.0.0.1:4777 only. GET /attention (HTML + JSON), POST /gates/:id {answer, requestId},
 * POST /tickets/:id/stop, POST /policy. The `harness` CLI is a fetch client of the same routes,
 * so there is one implementation of every human command (harness.human.*).
 */
declare function serveAttention(h: Harness, port: number): void

// Graceful shutdown (SIGTERM from launchd): stop loops, `engine.dispose()` (Atomic stops runs at their
// last checkpoint and releases leases, sdk.md:373-379). Next boot's `recover` resumes them explicitly,
// because startup recovery skips runs stopped by a clean shutdown (operations.md:848).
