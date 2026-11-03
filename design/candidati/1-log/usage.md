# harness (candidate 1, log-centric): usage

Written before the types. The `.ts` files are derived from this page.

## README

The harness is one process with one SQLite file. Everything it knows is in an append-only,
content-addressed event log. Every event belongs to a Thread: a GitHub issue or PR (source
thread), a Ticket (work thread, one per Ticket), or a harness-wide stream (`policy`, `watchdog`,
`env:<id>`). Tickets, subscriptions, mandate validity, run status, pending replies and the
panel are folds over that log. Nothing else is stored, except caches of those folds that the
harness rebuilds by replay.

Four kinds of callers write to the log, and none of them writes rows directly:

| Caller | Enters through | Writes |
|---|---|---|
| Sources (GitHub poller) | `harness.ingest(draft)` | `trigger`, plus the fast-path `input.routed` fan-out |
| Router LLM session (tools) | `harness.router.*` | `decided`, `reply.intended`, `subscribed` |
| Executor (Atomic, behind a port) | the `ExecutorSink` it was given | `run.*`, `gate.opened`, `handed.back`, `unsubscribed` |
| Humans (panel, channel replies) | `harness.panel.*` or a source trigger | `gate.answered`, `stop.intended`, `policy.set` |

Effects are events too. `reply.intended`, `run.intended` and `stop.intended` are saved first;
reactors read the "pending intents" fold and do the work; the outcome comes back as
`reply.settled`, `run.started`, `run.ended`. A crash between the two leaves the intent pending,
so the reactor does it again with the same idempotency key (the intent's event id).

```ts
import { openHarness } from './service'

const harness = await openHarness({
  dbPath: '~/.harness/log.sqlite',
  sources: [githubSource({ repo: 'uppify/<altro-repo>' })],
  envs,                                              // endpoint daemons / local worktree host
  maxRuns: 4,
  executor: (sink) => atomicExecutor({ journal: '~/.harness/atomic.sqlite', sink, envs,
                                       secrets, worker: 'claude-p', verifierModel: 'opus' }),
})
const stop = harness.run()   // starts pollers, reactors, router inbox wake-ups
```

## Call site 1: GitHub source turns a webhook-less poll into triggers

```ts
// sources/github.ts (inside the poller loop)
for (const c of await gh.newComments(cursor)) {
  const r = harness.ingest({
    source: 'github',
    thread: { kind: 'source', source: 'github', id: `${repo}#${c.issueNumber}` },
    native: { id: c.id, version: c.updatedAt },        // identity: edited comment = new trigger
    actor: { source: 'github', id: c.user.login },
    human: c.user.type !== 'Bot',
    addressed: c.body.includes('@harness') ? 'mention' : undefined,
    text: c.body,                                       // the log spills it; events carry a preview
    channel: { source: 'github', thread: `${repo}#${c.issueNumber}`, address: { issue: String(c.issueNumber) } },
  })
  // r.kind: 'duplicate' (same id already in the log) | 'filtered' | 'passed-through' | 'queued-for-router'
}
cursor.advance()   // after ingest returned: replaying the same page later is a no-op
```

## Call site 2: the Router session's tool handlers

```ts
// router/tools.ts: the Router never executes; it only reads cards and appends decisions.
tool('inbox', async () => {
  const batch = await harness.router.next()          // every gated, unrouted trigger, all threads
  return batch.cards                                  // inline previews + next-hop ids, never full text
})

tool('recall', ({ id }) => harness.recall(id))        // Chain of Recall: follow cause/effect ids

tool('route', ({ evalId, decision }) =>
  harness.router.decide(evalId, decision))           // one transaction per item; replays return the first result
  // decision: { kind: 'accept', title, scope, visibility: 'silent' }  -> speculative ticket
  //         | { kind: 'route', ticket }  | { kind: 'ignore', reason } | { kind: 'stop', ticket }

tool('reply', ({ ticket, purpose, text }) =>
  harness.router.reply({ ticket, purpose, text }))   // channel norms checked here: IM 100 words, GitHub structured
```

## Call site 3: the panel and the Watchdog

```ts
// http/panel.ts
app.get('/attention', () => harness.panel.attention())  // empty when nothing needs a person
app.post('/gates/:id', (req) =>
  harness.panel.answer(req.params.id, req.body.answer, req.body.requestId))
app.post('/policy/preview', (req) =>
  harness.panel.simulate(req.body.settings))         // re-fold history under the new policy, fast path only

// watchdog/main.ts: separate process, read-only log handle plus append for its own kinds
// Not part of Harness: it opens the same SQLite file read-only and appends only `watchdog.judged`
// through a tiny writer (openWatchdog), so a wedged harness process cannot silence it.
for await (const run of watchdog.live()) {           // liveRuns() fold over the tail
  const v = await judgeProgress(run.recentEvents)    // its own LLM session: progress and drift, not just liveness
  watchdog.judge(run.id, v)                          // 'stuck' -> react() emits stop.intended + operator gate
}
```

## What the Executor sees (the narrow port)

```ts
const exec: Executor = atomicExecutor({ sink, ... })
await exec.start(runId, spec, brief)  // idempotent by runId; Atomic runId = our RunId
await exec.stop(runId)        // idempotent; re-issued by the reactor after a crash
await exec.reconcile(liveRunIds)  // on boot: resume, or report the end Atomic already reached
// everything it learns flows back as sink.report(runId, WorkerReport)
```
