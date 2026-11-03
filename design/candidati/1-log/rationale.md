# Candidate 1: log-centric harness

## Problem

We port dsh's service layer (sources, Trigger/Thread/subscription, two-stage Eval, Mandate and
Policy, accept mode, effects and outbox, panel) and put Atomic 0.9.63 under it as the durable
executor, with pstack as the method inside each worker. The shape is not obvious because dsh
keeps the same facts in several mutable places: `Thread.subscriptions`, `Ticket.follows`,
`TriggerDisposition`, the effect table, the outbox. Its ids include timestamps (eval, attention,
policy input), so they are not replay-stable. Stop is an `afterCommit` callback and is lost on a
crash. Mandate is revalidated only on resume and attach. Atomic adds a second durable store with
its own statuses: a budget stop reads as `running`, there is no RPC to start a run or answer a
gate, tools run at least once, resume runs the body again from the top, and UI replay keys include
the call site. pstack says "done" only from a verdict by an agent that did not write the code,
keyed by PR and SHA, and it cannot enforce its own pause-always list. The design has to keep one
answer to "what is true now" across all of that.

## Usage (caller's view)

See `usage.md`. Four writers (sources, Router tools, executor sink, panel) and one reader surface
(`recall`, `attention`, `router.next`). Every caller goes through `Harness`. None of them sees a
row, a queue or a status column.

## Shape

**One log, one writer.** `log.ts` owns the SQLite file. The only write path is
`log.transact(decider)`. It runs a pure decider against the head inside `BEGIN IMMEDIATE`, appends
the drafts, and updates the materialized folds in the same transaction. Every fact is an `Event` on
a Thread (`events.ts`). Source threads hold triggers, gate results, Evals, decisions and
subscriptions. Each Ticket is its own work thread, holding the mandate, routed inputs, runs, gates,
replies and closure. `system:policy`, `system:watchdog` and `env:<id>` hold everything else.
(per separate-before-serializing-shared-state: one serialized writer is the real invariant here;
SQLite already gives it.)

**Ticket, subscription, Run status, mandate validity, outbox and panel are folds** (`fold.ts`).
`ThreadState.subscribers` is the result of `subscribed`/`unsubscribed` events. dsh's three
relations (`subscriptions`, `context`, `follows`) become one event pair with a mode.
`TicketState.runs[].status` is folded from `run.*`. Pending effects are intents with no outcome
event yet. The panel is `attentionView`. Mandate validity is a pure function of
(Mandate, PolicyState). It is checked at every `run.intended`, not only on resume, because it
costs nothing to compute. (per single-source-of-truth: derive instead of sync)

**Content-addressed ids give replay stability.** `idOf = hash(thread, kind, author, sorted causes,
body)`. `at` and `seq` are excluded. Bodies carry no clock of ours: source triggers carry the
native id and version, panel commands carry a client `requestId`, Eval identity carries an
`attempt` counted from the fold. The same input therefore yields the same event, and
`transact` skips ids that already exist. Re-polling a page, re-running a reaction after a crash, or
a double click all collapse into one event. Derived ids follow the same rule: `TicketId =
hash('ticket', decidedId)`, `RunId = id of run.intended`, `GateId = id of gate.opened`. The Atomic
runId is our RunId, so the two stores join on one key. (per make-operations-idempotent)

**"Save then do" falls out.** An effect is an `*.intended` event. Reactors in `service.ts` read
`effectsView.pending`, act with the intent id as the external idempotency key (GitHub marker,
Feishu idempotency key), and append the outcome (`reply.settled`, `run.started`, `run.ended`).
After a crash the intent is still pending, so the reactor does it again. Stop is durable for the
same reason: `stop.intended` stays pending and is re-issued until `run.ended` exists. That fixes
dsh trap 14. There is no separate effect table, outbox table or coalescing generation counter.

**Observe mode and speculation are the same mechanism at two points.** Observe is in `decide()`
only. An inferred accept under mode `observe` is stored as `decided {observe, wouldAccept}`; no
ticket, run or reply follows from it, and `attentionView` lists it. Speculative execution
("silently reproduce and fix") is `visibility: 'silent'`. The ticket runs, and its
`reply.intended` events are folded into `held`. A verified `done` adds `ticket.revealed`, which
releases them. A failure adds `ticket.closed discarded`, which drops them, so the bot stays
silent. Because history is a log, `panel.simulate(settings)` can re-gate every stored trigger
under a candidate policy before anyone switches to `auto`. That replay is cheap because the fast
path is pure code.

**Two-stage filter and pass-through.** Stage 1 is `PolicyState.gate`, pure and LLM-free. Its
result is stored as `trigger.gated`, so a later policy change never rewrites history. If the
thread has an `own` subscriber, `intake` writes `input.routed` to that ticket's work thread and
the Router never sees the trigger (fast path). Otherwise the trigger stays in
`ThreadState.unrouted`. `router.next()` opens one Eval per thread over everything that piled up
while the Router was busy. Batching is a property of the fold, not a separate queue.
`handed.back` puts a trigger back into `unrouted`.

**Chain of Recall is the event DAG.** Each event's `cause` list plus a reverse index gives the
next hops. `recall(id)` returns a `Card` (preview plus next-hop ids). Long text is spilled to the
`blob` table at write time (`log.spill`), so events carry only previews. (per article 3.3)

**Workers never talk to humans; the types enforce it.** `Kinds[k].by` fixes the author of each
kind. The executor sink can only produce `DraftBy<'worker'>`, and `reply.intended` is authored by
`router | harness`. The only constructor of `ReplyText` is `composeReply`, which applies channel
norms (IM: 100 words, GitHub: structured). Only `independentVerdict()` constructs an
`IndependentVerdict`, and it refuses a verdict whose verifier is the author. A `done` outcome
cannot exist without one. (per type-system-discipline)

**Every human ask is a Gate, and a gate ends the run.** The worker never waits inside Atomic:
`ctx.ui` is not used. A parked run returns `needs_human`. `classify` turns it into
`Outcome.parked`, `react` opens the gate, and the answer produces `run.intended(attempt n+1)`
with the answer in the brief. A budget stop (`running` + `active_blocked` + `budget_exceeded`)
becomes a parked outcome with an operator gate whose continuation is `resume` with a raised
budget. This removes our dependence on Atomic's call-site UI replay keys and on the missing
gate RPC, and it frees the worker slot while a person thinks.

**Atomic is behind a three-method port** (`executor.ts`): `start`, `stop`, `reconcile` in; `sink.report`
out. Atomic's journal stays private to the executor. `reconcile` at boot re-reports what Atomic
reached during the crash window. Because `run.ended` has one id per run, a double report
collapses. `classify` is the only reader of Atomic statuses.

**Module map.** `events.ts` (the one list of kinds, ids, bodies) -> `log.ts` (storage,
transact, ids, spill; private) -> `fold.ts` (views and pure derivations) -> `decide.ts`
(deciders and reactions, pure) -> `service.ts` (the only export: composition, three loops,
`Harness`). `executor.ts` plugs in through `Executor`/`ExecutorSink`. Any flow traces in three
files: the caller's `Harness` method, its decider, the fold it changes.

**Interface depth.** The public surface is `openHarness` plus `Harness`: 10 methods. Behind it
sit dedupe, gating, pass-through, batching, Eval lifecycle, mandate checks, replay safety, outbox
ordering, durable stop, speculation, observe, crash reconciliation and the Atomic status
mapping. Callers never coordinate two calls to finish one operation.

## Synthesis decision

## Tradeoffs accepted

- We accept two durable stores (harness log and Atomic journal) in exchange for keeping Atomic
  replaceable. The join key is RunId, and `reconcile` is the only place where they can disagree.
- We accept losing the worker's live context at every human gate (a new attempt, not a paused run)
  in exchange for no Atomic UI replay coupling, free slots, and gate answers that live only in our
  log. pstack's `resume.mjs` checkpoint and the brief carry continuity.
- We accept that content addressing turns "same content, same causes" into "same fact". Two real
  actions that look identical must differ in body (`requestId`, native version). A bug in the
  identity inputs silently dedupes a legitimate event.
- We accept fold cost and event-schema evolution (versioned views, replay on version bump, no
  in-place migration of old events) in exchange for no state that can drift from history.
- We accept `trigger.gated` as a stored fact, which looks redundant next to a pure gate, so that
  history does not change when the policy does.
- We accept a single serialized writer. This looks like a bottleneck, but the load is a team's
  GitHub traffic plus worker reports, and SQLite WAL handles that.

## Alternatives considered

- **Aggregate tables plus a side event stream (dsh as is).** It keeps the mutable `Thread`,
  `Ticket` and `effect` rows and emits domain events alongside. The interface is the same size,
  but it hides less: subscription lives in three relations, there are two ways to learn state, and
  the ids are not replay-stable. It lost on split ownership.
- **Atomic's journal as the log** (each Ticket is one long Atomic run, gates are `ctx.ui`). It has
  the fewest stores. It loses because there is no start or answer RPC, UI replay keys break when
  the workflow file changes, the harness facts (triggers, policy, outbox) do not fit run-scoped
  events, and Atomic could no longer be replaced.
- **Event log with gates as in-run `ctx.ui` waits.** It keeps the worker's context across a
  question. It lost because it gives two ways to ask a human (gate vs parked outcome) and holds a
  slot for hours.

## Implementation reconciliation

## Open questions and risks

- Does the worker run as `claude -p` from `ctx.tool` (pstack hooks and a PreToolUse guard work;
  Atomic budget metering does not see its tokens) or as Atomic's native agent loading SKILL.md
  (metered; no Claude Code hooks, so the pause-always guard has to be ported)? The port hides the
  choice. The budget story depends on it.
- How does a running `claude -p` worker receive `input.routed` mid-run? This sketch says through
  a run-scoped MCP `inbox`/`took` tool. Untaken inputs at run end start attempt n+1. Is that
  latency acceptable for review comments?
- How do we retain or compact the log? Spilled blobs grow without bound. Should snapshots plus
  archived segments come before the first month of operation?
- Does the AGPL `mupdf` pulled in by Atomic block a network deployment?
- The verifier is "a different agent, same model" under the opus-only rule. Is that independent
  enough to auto-reveal speculative work?

## Next implementation step

Write `log.ts` (`transact`, `idOf`, view rebuild) with a property test: replaying the stored
drafts into an empty log gives identical ids and identical view values.

## Directions considered and rejected

- Mutable aggregates with emitted events (dsh as is): split ownership, unstable ids.
- Atomic journal as the single store: missing RPCs, call-site replay keys, not replaceable.
- In-run human gates through `ctx.ui`: two ways to ask, slot held, replay coupling.
- A separate outbox or effect table next to the log: a second source of truth for "what is pending".
- A per-ticket actor process owning ticket state: needs routing and supervision for a gain that
  SQLite's single writer already gives.
