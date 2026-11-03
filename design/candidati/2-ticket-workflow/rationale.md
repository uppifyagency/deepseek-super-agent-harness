# Candidate 2: the Ticket is the workflow

## Problem

We need an always-on service that hears GitHub (IM later), decides whether it is authorized
to act, runs the work durably in isolation, verifies before saying done, and answers where the
person wrote. dsh-superagent gives us a proven service layer (Trigger, Thread, two-stage Eval,
Mandate + Policy, accept mode, outbox, effect queue) whose execution half (Assignment,
`Ticket.execution`, `readAt`, `turnEnded`, non-durable stop) is welded to DSH sessions
(ground-dsh.md "Where the domain model leaks executor concepts"). Atomic 0.9.63 has a real
durable engine but no RPC to start a run or answer a gate, resume only through
`session.workflows.resume`, a budget stop that reports `status: "running"`, at-least-once tools,
and bodies that replay from the top (ground-atomic.md sections 2-4). pstack defines "done" as
a verdict from a non-author keyed by SHA and enforces nothing itself (ground-pstack.md 3-5).
The non-obvious part: where execution state lives, and how a service pushes events into an
engine that has no inbound API.

## Usage (caller's view)

See `usage.md`. Three call sites: a Source calling `receive(trigger)`, the Ticket workflow body
(`ticket-v1.ts`), the panel/Watchdog reading `ticketView(id)`.

## Shape

**Module map** (five files, one import direction):

```
domain.ts           pure types + route(): Trigger, Thread(subscribers), Mandate, Policy, Eval,
                    Decision, Ticket(identity only), OutboundReply, Effect
inbox.ts            InboxItem, Inbox (service table), ParkRequest/ParkAnswer, Bridge (Atomic adapter)
ticket-workflow.ts  TicketInputs, Brief, Environment, WorkerOutcome, Verdict, AttemptResult,
                    TicketReport, TicketCtx, defineTicketWorkflow, attempt-v1, ServicePort
ticket-v1.ts        the frozen body
engine.ts           only importer of @bastani/atomic: ensureRunning, stop, ticketView, recoverAll
service.ts          receive, Router (Eval), createTicket, onReport -> replies, startHarness
```

**Load-bearing decisions.**

1. **One Ticket = one root Atomic run, `runId = ticketId`.** The journal owns every execution
   fact: attempt number, worker outcome, verdict, open question, spend, parked-or-working,
   crashed. The service `Ticket` row is identity + Mandate + channels. No status column, no
   Assignment, no attention field; `TicketView` is derived from `getRun`/`getStages` +
   pending prompts (per single source of truth). dsh traps 2, 14, 16 disappear because the
   state they describe is no longer stored twice.
2. **Park is the only inbound door.** `TicketCtx.park()` = `ctx.ui.input(encodePark({ticket,
   n, after, waitingFor, question}))`. The Bridge (host UI adapter) settles it from the
   service Inbox with refs + previews. The cached answer is the consumption record, so a
   replay re-delivers the same batches in the same order, and "which inputs were taken"
   (dsh `readAt`, `letGo`, `requeueUntaken`) is a journal read. Keys are stable because the
   park has one callsite and `n` is a loop counter (durable/ui-primitive.ts:71-90).
3. **Gates are not a primitive.** Question = `report({kind:"question"})` (outbox) + park with
   `waitingFor: "human"`. The answer is a Trigger on the Ticket's Thread, so GitHub, IM and
   the panel answer the same way, and Atomic's "no RPC answer" gap stops mattering. This also
   honours "workers never talk to humans": the body reports, the service replies.
4. **Budget lives on attempt children, never on the root.** Root definition has no budget and
   config budget is 0. Each attempt is `ctx.workflow(attempt-v1, {budget})`; exhaustion
   surfaces to the parent as `{status:"blocked", exited:true}` (engine/primitives/workflow.ts:
   160-191). The parent asks, parks, and runs attempt N+1 with a raised cap. We never need to
   resume an `active_blocked` root, and never meet the missing `onRunEnd` on that path.
   The worktree (`gitWorktreeDir`, reused, never auto-removed) carries code across attempts.
5. **Crash recovery = `ensureRunning(ticket)`, one idempotent verb.** Start with `run()` in
   process (no RPC start exists), resume with `session.workflows.resume(runId)` on one engine
   session bound to the Bridge as `humanInput` (sdk.md:281-295, 363). Same `engineCwd` and
   journal forever. `owned_elsewhere` during the 120 s lease throws `Later` into the effect
   queue. The service effect `ensureRun` is committed with the Ticket row, so a run can never
   exist without its Ticket.
6. **TicketCtx hides Atomic's replay rules.** The body sees `attempt/publish/report/park/finish`,
   each one ctx primitive with its OpKey and replay key already fixed. It cannot call
   `Date.now`-dependent services or raw `ctx.ui`. The child's result field is `result`, not
   `status`, so `returned-run-status.ts` never rereads `needs_human` as blocked.
7. **Pause-always by capability.** Stage tools inherit `process.env`, so the process holds no
   GitHub token, channel or deploy credential in env. The worker can only commit in its
   worktree. Push + PR happen in `publish` (ctx.tool, host-held token, find-or-open by branch).
   Merge stays human (autopilot-full.md:9).
8. **"Done" has one constructor.** `confirmDone(worker, verdict)` returns `verified` only on
   `pass` at the same SHA, from a fresh-context verifier stage. Under Vlad's opus-only
   override, independence is "different agent, same model"; the type says so.
9. **Speculative execution is a Mandate field.** `delivery: "silent"`: no ack, any question,
   budget stop or failure ends `discarded` without a word; only a verified result is announced.

**Interface depth.** Public surface: `receive`, `ticketView`, `ensureRunning`, `stop`, plus
the four-verb `TicketCtx` for workflow authors. Hidden: lease timing, run-vs-resume choice,
park keys and batch semantics, OpKey dedupe, budget-to-question translation, status derivation
from three Atomic fields, the two Atomic host-input shapes.

**Atomic gaps, and how each is crossed.**

| Gap (ground-atomic.md) | Crossing |
|---|---|
| No RPC start | in-process `run()`, not awaited (sdk-run.ts:16-53) |
| No RPC gate answer | Bridge as `RunOpts.ui` and as session `humanInput`; gate = report + park |
| Resume only via `session.workflows.resume` | one engine session, same cwd + journal, `modelOwner` set on `run()` |
| Budget stop is `running` + `active_blocked` | budget only on child attempts; parent sees `blocked` |
| At-least-once tools | OpKey per verb; service `op` table; GitHub find-or-open + HTML marker |
| Body re-runs from top | TicketCtx; frozen `ticket-vN.ts`; port via `Symbol.for` global |
| Zero-progress runs not resumable | `ensureRunning` deletes and restarts under the same id |
| Worktrees never cleaned | `cleanup` effect on `ended` |

## Synthesis decision

## Tradeoffs accepted

- We accept thousands of parked runs held as pending promises in one process in exchange for
  zero duplicated execution state. A Ticket waiting a week for review is a live `awaiting_input`
  run.
- We accept that a mid-turn worker learns of follow-ups late (at most via `inbox_peek`) in
  exchange for one consumption record. Stop is the exception: it is `cancellationRegistry.abort`
  / `quit`, not an Inbox item.
- We accept fresh worker context per attempt (transcript does not cross a budget raise) in
  exchange for never resuming an `active_blocked` root. Code, the PR and the pstack resume note
  in the worktree carry over.
- We accept that editing a body means a new `ticket-vN.ts` file and two live versions, in
  exchange for cached gate answers that survive deploys.
- We accept an Atomic-agent worker (pstack as native SKILL.md, no hooks, no Claude Code) in
  exchange for metering, admission and durable stages on every worker turn.

## Alternatives considered

- **Service owns Ticket state, Atomic runs one workflow per assignment (dsh shape).** Hides
  less: two state machines (service stage + run status) must agree after every crash, and the
  `readAt/letGo` rules need executor facts Atomic does not emit. Lost on single source of truth.
- **Follow-ups via `steer`/Intercom into the live stage.** Faster delivery, but not journaled,
  lost on crash, and a body cannot replay it. Lost on durability.
- **Gates as `ctx.ui.select` answered from a panel API.** A second inbound path beside the
  Inbox; human replies in GitHub would need translation into gate answers. Lost on "one way".
- **Worker via `claude -p` in `ctx.tool`.** Keeps Claude Code hooks and pstack's real plugin,
  but loses budget metering and admission and makes the turn an opaque at-least-once tool.
  Strong runner-up; it is a local change inside `attempt-v1` if the pilot says the Pi agent
  cannot follow pstack.

## Implementation reconciliation

## Open questions and risks

- **Spike 0, load-bearing:** can `session.workflows.resume` adopt a run started by standalone
  `run()` with `modelOwner` set? sdk.md says stored runs need a recorded session owner. If
  not, does `run(def, inputs, {runId: crashed, journal})` replay it (unverified,
  ground-atomic open question 1)? If neither, start every run through the engine session's
  workflow tool, which is ugly.
- Does the session load `ticket-v1.ts` through its own module loader? If so the ServicePort must
  be the `Symbol.for` global, and custom stage tools defined in the file must reach it the same way.
- Memory and lease renewal cost of ~1000 parked runs in one process: measure before trusting.
- Should a `wants: merge` after approval be executed by the host (a fifth verb), or does a human
  always click merge? This sketch says human.
- Is "same model, fresh stage" acceptable as the independent verifier for v1?
- AGPL `mupdf` via `@bastani/atomic`: legal answer needed before network deployment.

## Next implementation step

Spike 0: a 40-line script that starts `ticket-v1` with `run()`, parks it, kills the process,
and resumes it from a fresh `createAgentSession` with the Bridge bound, asserting the park
answer replays and the next park reaches the Bridge.

## Directions considered and rejected (summary)

1. Execution state in the service, Atomic as a stateless task runner (rejected: double state).
2. Live steering into stages as the delivery path (rejected: not durable).
3. A gate primitive separate from the Inbox (rejected: two inbound paths).
4. Budget on the root run, resumed with a raised cap (rejected: session resume takes no budget,
   `onRunEnd` silent on that path).
5. Router as an Atomic long-lived run too (rejected: the Router's durability is the Eval
   deadline + requeue, and one global run would serialize every Ticket's start).
