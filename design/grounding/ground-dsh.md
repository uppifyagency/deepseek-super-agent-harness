# dsh-superagent service layer: grounding for new types

Repo: `riferimenti/dsh-superagent/repo` (paths below relative to it). Every claim was re-read in `src/` during this session; the prior analyses (`../analisi/dsh-code.md`, `dsh-docs.md`) were used as a map and are correct except where noted in "Corrections to the prior analysis". Method: pstack `how`, done as a single explorer+explainer pass (the subsystem is concentrated in ~12 files).

---

## Overview

The service layer is a **synchronous, transactional domain core** (`src/core/*`, no I/O) wrapped by an **app layer** that supplies SQLite persistence (`app/store.ts`), a **durable effect queue** in the same database (`app/effects.ts`), an **outbox** of reply receipts (`app/outbox.ts`), a **Policy** built from settings (`policy.ts`), **Sources** that poll and turn native events into Triggers (`sources/*`), and a loopback **panel API** (`app/http.ts`, `app/views/*`).

The core talks to the outside world only through ports (`core/ports.ts`): `Repositories` (sync, `atomic`), `SourceScope`, `Policy`, `Assessor`, `Executor`, `Outbox`, plus an `emit` hook and a `prepareTicket` hook (`core/part.ts:7-18`). Every port method on the core side only **enqueues**; the real work happens later from the effect queue after commit. That is the pattern to port.

The execution layer (DSH) enters at exactly three port implementations (`DshExecutor`, `MasterAssessor`, and `Sessions` as the main-Session transport) plus the LLM tool surface. The main LLM Session is not just "a client": **it is the assessor and the router**, and the tools it calls (`orchestrator_route`, `orchestrator_eval_decide`, `orchestrator_reply`) are the only callers of `Engine.decide` and `Engine.reply` for most flows. Replacing DSH means replacing that decision loop too.

---

## Key Concepts and exact types (Q1)

All from `src/core/model.ts` unless stated. Trimmed of doc comments.

### Refs
```ts
// model.ts:5-12
export interface ActorRef { source: string; id: string }
export interface ThreadRef { source: string; id: string }
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`
```

### Trigger (immutable event)
```ts
// model.ts:23-39
export interface Trigger {
  id: string
  source: string
  threads: ThreadRef[]            // threads[0] is the primary thread that hosts its Eval
  actor: ActorRef
  human: boolean                  // source-declared
  addressed?: 'mention' | 'direct'
  at: string
  text: string                    // untrusted
  channel?: ChannelRef            // reply address
  url?: string
  meta: Record<string, unknown>   // source-native, core never interprets
}
```
Plus a mutable side record, stored in its own table:
```ts
// model.ts:42-61
export interface TriggerDisposition {
  filtered?: Reason
  evalId?: string
  decisionId?: string
  fanout: string[]          // tickets it reached
  context?: string[]        // subset of fanout reached only via context-follow
  requeued?: true
  handbacks?: { ticketId: string; reason: string; at: string }[]
  acked?: string[]          // tickets whose worker took it up
  at: string
}
```

### Thread (the Eval consistency boundary, and the holder of Subscriptions)
```ts
// model.ts:157-182
export interface Thread {
  key: string
  ref: ThreadRef
  createdAt: string
  lastAt?: string
  subscriptions: string[]   // ticket ids  <- this IS the Subscription
  context?: string[]        // subset of subscriptions that are read-only context follows
  correlated: string[]      // other thread keys that shared a trigger
  pending: string[]         // debounce buffer of trigger ids
  evaluating?: Evaluation   // at most one Eval per thread
  expired?: number
  meta: Record<string, unknown> // source-owned; label, facts, cursors
}
```

### Subscription
There is **no Subscription type**. A subscription is a ticket id in `Thread.subscriptions` (`model.ts:164`), qualified by membership in `Thread.context` (`model.ts:169`). A separate but overlapping relation is `Ticket.follows: Follow[]` (`model.ts:297`, `:314`):
```ts
export interface Follow { thread: string; own: boolean; closed?: { at: string; outcome: 'merged' | 'closed' } }
```
`bind` both subscribes and adds a Follow (`tickets.ts:61-72`); `followForContext` subscribes and adds to `Thread.context` (`tickets.ts:407-415`); `subscribe` on a context thread promotes it to a full subscription (`tickets.ts:417-422`).

### Eval (Evaluation) and its result (Decision)
```ts
// model.ts:136-154
export interface Evaluation {
  id: string; threadKey: string; triggerIds: string[]
  primary?: string            // the admissible trigger that gave the batch its strength
  strength: Strength          // 'explicit' | 'inferred'  (model.ts:96)
  actor: ActorRef; basis: MandateBasis; policyVersion: string
  startedAt: string
  delivered?: string          // when the candidate reached the assessor session
  deadline: string            // counted from delivery
  pausedAt?: string
}
// model.ts:190-209
export type DecisionKind = 'ignore' | 'accept' | 'reopen' | 'stop' | 'unavailable'  // reopen is legacy
export interface Decision {
  id: string; evalId: string; threadKey: string; triggerIds: string[]
  policyVersion: string; at: string
  kind: DecisionKind
  reason: Reason[]
  strength: Strength
  ticketId?: string
  mandate?: Mandate
  audit?: Record<string, unknown>   // rule assessments, direction, evidence, would_accept, proposal
  dismissed?: true
}
```
The assessor's input and output (`core/ports.ts:7`, `:30-46`):
```ts
export type GateResult = { admissible: false; reason: string } | { admissible: true; strength: Strength; basis: MandateBasis }
export interface Candidate { evalId: string; thread: Thread; triggers: Trigger[]; strength: Strength; policyVersion: string; tickets: Ticket[] }
export type AssessmentOutcome =
  | { kind: 'ignore'; reason: string | Reason; audit?: Record<string, unknown> }
  | { kind: 'unavailable'; reason: string | Reason; audit?: Record<string, unknown> }
  | { kind: 'accept'; title: string; scope: string; reason: string | Reason; acknowledgement?: string; rules?: string[];
      audit?: Record<string, unknown>; name?: string; note?: string }
  | { kind: 'stop'; ticketId: string; reason: string | Reason; audit?: Record<string, unknown> }
// evals.ts:12
export type Outcome = AssessmentOutcome & { evalId?: string }
```
The raw LLM assessment that becomes an `AssessmentOutcome` (`policy.ts:30-33`, `:13-24`):
```ts
export interface Assessment {
  decision: 'accept' | 'ignore' | 'unavailable'; rule_assessments: RuleAssessment[]; direction: unknown
  title: string; scope: string; reason: string; intent_evidence?: string | null; acknowledgement?: string | null; worktree_name?: string
}
// RuleAssessment = { rule_id, reason, matched: boolean }
// AdmissionDirection = { implementation_requested: boolean; target_basis: 'specified'|'existing-standard'|'undetermined';
//                        requires_design_decision: boolean; evidence: string }
```
`Reason` (`core/reasons.ts:29`): `{ code: ReasonCode | (string & {}); values?: Record<string,string>; triggerId?: string }`.

### Mandate
```ts
// model.ts:96-133
export type Strength = 'explicit' | 'inferred'
export type AdmissionCell = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'
export type AcceptMode = 'off' | 'observe' | 'auto'
interface Received { source?: string; scope?: Record<string, unknown>; row?: string }
export type MandateBasis = Received & { sender?: string; rules?: string[] } & (
  | { via: 'addressed'; addressed: 'mention' | 'direct' }
  | { via: 'followup'; authority?: string }
  | { via: 'admission'; cell: AdmissionCell; addressed?: 'mention' | 'direct'; observation?: { mode: AcceptMode } }
  | { via: 'listed'; addressed?: 'mention' | 'direct'; observation?: { mode?: AcceptMode }; authority?: string }  // legacy
  | { via: 'bot'; addressed?: 'mention' | 'direct'; observation: { mode: AcceptMode } }
)
export interface Mandate { strength: Strength; policyVersion: string; basis: MandateBasis; actor: ActorRef; scope: string }
```

### Policy (port) and settings (config)
```ts
// core/ports.ts:17-27
export interface Policy {
  version: string
  paused: boolean
  gate(trigger: Trigger, thread: Thread, tickets: Ticket[]): GateResult
  revalidate(mandate: Mandate): boolean
  admitsInferred(rules: readonly string[]): boolean
  evalTimeoutMs: number
}
// core/ports.ts:10-14
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string }
export interface SourceScope { scope(input: { source: string; meta: Record<string, unknown> }): ScopeResult }
```
Config is zod (`policy.ts:67-109`): `Settings = { paused, sources: Record<id,{enabled,config}>, policy: { rules: Rule[], sources: Record<kind, { allowed: {id,name?}[], admission: Record<row, AdmissionRow>, ...bots } > }, eval: { mode: 'off'|'observe'|'auto' (default 'observe'), timeoutSeconds, model }, executor: {...} }`. `Rule = { id, name, enabled, instruction }` (`policy.ts:67`). The concrete Policy is built by `settingsPolicy(settings, sources)` (`policy.ts:167-242`). `policyVersion = key('mandate-v3', JSON{rules, mode, sources})` (`policy.ts:111-118`).

Admission table (`admission.ts:8-13`):
```ts
export type Admission = 'explicit' | 'inferred' | 'ignore'
ADMISSION_OPTIONS = { listedUnaddressed: ['inferred','ignore'], unlistedAddressed: ['explicit','inferred','ignore'], unlistedUnaddressed: ['inferred','ignore'] }
ADMISSION_DEFAULTS = { listedUnaddressed: 'inferred', unlistedAddressed: 'ignore', unlistedUnaddressed: 'ignore' }
```

### Accept mode
`AcceptMode = 'off' | 'observe' | 'auto'` (`model.ts:103`), stored as `settings.eval.mode` (`policy.ts:84`).

### Ticket
```ts
// model.ts:271-315
export type TicketEndBy = 'executor' | 'human'
export type TicketOutcome = 'completed' | 'merged' | 'closed' | 'dropped' | 'stopped'
export interface Attention { id: string; question: string; triggerId?: string }
export interface Ticket {
  id: string; title: string; decisionId: string
  mandate: Mandate
  channels: ChannelRef[]
  ended?: { at: string; by: TicketEndBy; outcome: TicketOutcome; reason?: string }
  attention?: Attention              // the human_action question
  assignments: Assignment[]
  inputs: TicketInput[]
  undelivered: string[]              // input ids
  follows?: Follow[]
  answers?: string[]                 // trigger ids the worker answered
  createdAt: string; updatedAt: string
  origin: { triggerId: string; triggerIds: string[] }
  execution?: Execution              // { name, directory, assignment }  <- executor-owned
  delivery?: { error: string; at: string }
}
export type AssignmentState = 'pending' | 'running' | 'ended'
export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'
export interface Assignment {
  id: string; state: AssignmentState; createdAt: string; startedAt?: string; endedAt?: string; endedReason?: string
  report?: { state: ReportState; summary: string; at: string }
  deliveredAt?: string; idleAt?: string
}
export type TicketInput =
  | { id; kind: 'trigger'; triggerId; at; note?; human?: true; context?: true; readAt?: string | null; deliveredTo?: string; deliveredAt?: string }
  | { id; kind: 'policy-changed'; from; to; at; effect?: PolicyEffect }
  | { id; kind: 'reopen'; decisionId; at }      // legacy
  | { id; kind: 'resumed'; triggerId; at }
  | { id; kind: 'text'; text; at }
  | { id; kind: 'note'; text; at }
export interface PolicyEffect {
  rules?: { id: string; name: string; change: 'changed' | 'disabled'; instruction?: string }[]
  proactive?: false; requesterAllowed?: false; requester?: ActorRef
}
```

### Ticket states
There is **no stored ticket state enum**. State is: open (`ended` absent) or ended with `TicketOutcome`; per-assignment `AssignmentState` and `ReportState`; and a **derived** display stage (`core/stage.ts:5-21`):
```ts
export type TicketStage = { stage: 'person'; action: 'delivery' | 'answer' | 'review' | 'blocked' | 'failed' }
  | { stage: 'working'; action?: 'queued' } | { stage: 'idle' } | { stage: 'ended' }
```
First matching row wins: ended, delivery failed, attention set, latest report ready, blocked/failed with `waitsForPerson`, no or pending assignment, waiting or ended assignment, else working. `canRetry` = open and (`waitsForPerson` or `delivery`) (`stage.ts:24-26`).

### human_action
Not a domain type. It is a **tool argument** of the worker's `orchestrator_report` (`app/tools/executor.ts:80`): `z.string().trim().min(1).max(1000).nullish()`, mapped to `WorkerReport.question` (`executor.ts:93`). Tri-state: string asks, `null` clears, omitted keeps (`core/assignments.ts:13-14`). It becomes `Ticket.attention` with id `key('attention', ticketId, question, at)` (`assignments.ts:114`). It also appears on the main Session's `orchestrator_reply` (`tools/main.ts:231`) where it must equal the current `attention.question` (`replies.ts:77`).
```ts
// core/assignments.ts:11-20
export interface WorkerReport { state: ReportState; summary: string; question?: string | null; askedBy?: string; answers?: string }
```

### Reply / outbox entry
```ts
// core/ports.ts:72-83
export interface OutboundMessage { id: string; channel: ChannelRef; text: string; kind: 'acknowledgement' | 'reply' | 'notice'; ticketId?: string }
export type ReplyStatus = 'pending' | 'sent' | 'dropped'
export interface Outbox { send(message: OutboundMessage): void; status(id: string): ReplyStatus | undefined; withdraw(id: string): void }
// core/replies.ts:14-18
export type ReplyRequest =
  | { purpose: 'acknowledgement'; ticketId: string; triggerId: string; text: string }
  | { purpose: 'answer' | 'result' | 'attention'; ticketId?: string; triggerId?: string; question?: string; text: string }
export interface Reply { id: string; status: ReplyStatus; reused: boolean }
// app/store.ts:16-20
export type DropReason = 'channelGone' | 'channelIgnored'
export interface Receipt extends OutboundMessage { status: ReplyStatus; dropped?: { at: string; reason: DropReason } }
```

### Effect
```ts
// app/effects.ts:5, 11-39
export class Later extends Error {}                  // "not now": reschedule without counting a failure
export interface EffectPayloads {
  assessment: { triggerId: string }                  // key = evalId
  launch: { ticketId: string; assignmentId: string } // key = assignmentId
  delivery: { ticketId: string }                     // key = ticketId
  relay: { text: string }                            // key = request id; steer into main Session
  notice: { value: Record<string, unknown>; summary: string } // key = notice name; inject without waking
  reply: Record<string, never>                       // key = outbox message id
}
export type EffectKind = keyof EffectPayloads
interface Handler<K> { run(payload, key): Promise<void>; limit(): number; retry: readonly [number, number]; ordered: boolean; quiet: boolean }
interface Row { key: string; value: string; seq: number; generation: number; attempts: number; due: number }
```
Table: `effect(kind, key, value, seq, generation, attempts, error, due, since, PRIMARY KEY(kind,key))` (`store.ts:80-82`).

### Domain events (emit hook)
`DomainEvents` (`core/ports.ts:86-103`): `trigger.received`, `eval.started`, `decision.recorded`, `ticket.created`, `ticket.resumed`, `ticket.ended`, `assignment.started`, `assignment.ended`, `thread.subscribed`, `thread.unsubscribed`, `trigger.requeued`, `trigger.followup`, `policy.changed`. Emitted **synchronously inside the transaction** (`part.ts:64-66`).

### Event source contract
`SourceKind<C>` (`sources/kind.ts:85-113`): `kind, title, description, schema, fields, health, scope?(input, config): ScopeResult, channel?: SourceChannel<C>, threadContext?, find?, repliesTo?, policy?: SourcePolicyPart, refreshLabels?, environment?`. `SourceChannel.send(host, message): Promise<'sent' | 'gone'>` must be idempotent by id (`kind.ts:46-56`). Sources get a `SourceContext` (`sources/host.ts:31-66`) with `receive(trigger)`, `atomic`, source-scoped KV `state`, `threads.describe/patch`, `tickets.bindThread/threadClosed`, `notify(message)`, `report(health)`.

---

## How It Works: lifecycle (Q2)

### Storage
One SQLite file `<stateDir>/orchestrator.sqlite`, WAL, `synchronous=FULL` (`store.ts:64`). Tables (`store.ts:72-86`): `trigger(id, value, at)`, `disposition(id, value)`, `thread(key, value)`, `ticket(id, value)`, `decision(id, thread, value)`, `outbox(id, value)`, `trigger_thread(thread, id, at, human)` (timeline index), `effect(...)`, `kv(key, value)`. Aggregates are JSON blobs; generated columns plus partial indexes define working sets: `ticket.open`, `ticket.active`, `thread.active`, `thread.subscribed`, `outbox.dropped`, `outbox.pending` (`store.ts:30-44`). Settings and Source cursors live in `kv`.

Transactions: `Store.atomic` is a nested SAVEPOINT; `afterCommit` callbacks run only after the outermost release, and are dropped on rollback (`store.ts:140-162`). Every `Engine` command is `repo.atomic(() => part.method())` (`core/engine.ts:48-257`). `evaluateDue` uses **one transaction per thread or ticket**, not one for the pass (`engine.ts:75-85`).

### Step by step

| # | Step | Owner | Writes (same txn) |
|---|---|---|---|
| 1 | Source polls and builds a Trigger with a content-derived id | `sources/github*.ts`, `sources/feishu*.ts` (`github-trigger.ts:68,84,99,104`, `feishu-trigger.ts:18`) | Source cursors in `kv`, advanced after `receive` returns |
| 2 | `SourceContext.receive` -> `Passes.receive` -> `Engine.receive` | `app/passes.ts:34-39`, `core/engine.ts:48` | one txn |
| 3 | Intake: dedupe, scope filter, save trigger, update threads (`lastAt`, `correlated`), fan out to subscribed tickets as `TicketInput`s, save disposition, queue on primary thread's `pending` unless a ticket owns it, wake ended tickets, emit | `core/intake.ts:19-62` | `trigger`, `trigger_thread`, `disposition`, `thread`, `ticket`, plus `effect` rows (`delivery`/`launch` via `Executor`, `relay`/`notice` via the emit hook in `runtime.ts:138-153`) |
| 4 | Pass every 2 s: `effects.kick()` then `evaluateDue` | `app/passes.ts:63-68`, `engine.ts:75` | per thread txn |
| 5 | `Evals.start`: drop owned follow-ups, ignore triggers that already started a ticket, run `policy.gate` per trigger, keep the strongest; none -> `ignore` Decision; else set `thread.evaluating`, update dispositions, `assessor.request` | `core/evals.ts:71-119` | `thread`, `disposition`, `decision` (ignore case), `effect(assessment)` |
| 6 | Assessment effect handler builds the candidate card and steers it into the main LLM Session, then `candidateDelivered` starts the deadline | `app/assessment.ts:96-104`, `evals.ts:48-55` | `thread` |
| 7 | LLM decides via tools: explicit -> `orchestrator_route` (`tools/main.ts:88-122`); inferred -> `orchestrator_eval_decide` -> `MasterAssessor.decide` -> `assessmentOutcome` (`policy.ts:40-61`) -> `Engine.decide` | app tools | one txn per routed item |
| 8 | `Evals.decide`: refuse stale evalId, return earlier Decision on replayed accept, `leftToWorkers` unless stop, held Eval or `directEval`, `admitsInferred` check, `decideEval`: policy version mismatch -> reassess/unavailable; stop needs explicit + live ticket; accept -> Mandate + `Tickets.create` | `evals.ts:131-316` | `decision`, `disposition`, `thread`, `ticket` |
| 9 | `Tickets.create`: channels from batch, `prepareTicket` (executor fills `execution`), first Assignment, subscribe every thread of the batch, auto acknowledgement, `executor.start` | `tickets.ts:37-56` | `ticket`, `thread`, `outbox` + `effect(reply)`, `effect(launch)` |
| 10 | Launch and delivery (execution layer) report back through `assignmentStarted`, `inputsDelivered`, `inputsRead`, `turnEnded`, `deliveryFailed` | `executor/dsh.ts`, `assignments.ts:34-79` | `ticket` |
| 11 | Worker `orchestrator_report` -> `Engine.report`: attention set/replace/clear (withdraw old attention reply), answers, held automatic inputs dropped on blocked/failed, end on `dropped` or on `ready` (completed, or `followsDone` outcome) + relay to main Session | `tools/executor.ts:74-101`, `assignments.ts:99-133` | `ticket`, `outbox`, `effect(relay)`, txn wraps PR claim + report + relay (`executor.ts:90`) |
| 12 | Source sees PR close -> `threadClosed` -> end ticket `merged`/`closed` when `followsDone` and not `unfinished` | `sources/github-pull.ts`, `tickets.ts:77-101`, `:370-379` | `ticket`, `disposition`, `thread` |
| 13 | `Tickets.end`: set `ended`, clear undelivered/attention/delivery, end assignments, `letGo` untaken human messages back to Eval, emit, `executor.stop` (afterCommit) | `tickets.ts:345-363`, `:294-309` | `ticket`, `disposition`, `thread` |
| 14 | Replies: worker `orchestrator_ack` or main Session `orchestrator_reply` -> `Engine.reply` -> `Replies` purpose rules -> `Outbox.send` | `replies.ts:36-92`, `tools/main.ts:224-240` | `outbox` + `effect(reply)` |
| 15 | `reply` effect handler: wait (`Later`) if Source off or an earlier message to the same ticket+conversation is pending (<3 failures); drop if channel not allowed; `SourceRegistry.send`; settle `sent` or `dropped(channelGone)` | `app/outbox.ts:39-51`, `store.ts:259-288` | `outbox` |

PR end notices to chat channels are queued from the emit hook on `ticket.ended` (`runtime.ts:148-152`).

---

## The seam with the execution layer (Q3)

### Every call from `src/` into DSH / Cordis / executor / sessions

Core ports (the clean seam):
1. `Executor.start / deliver / stop` (`core/ports.ts:59-69`), called from `tickets.ts:54,177-178,244,268,326,362`, `assignments.ts:42,89`. Implemented by `DshExecutor` (`executor/dsh.ts:279-283`, `:357-369`).
2. `EngineOptions.prepareTicket` (`part.ts:15`), called in `tickets.ts:49`; implemented as `DshExecutor.prepare` -> `ticketExecution` (worktree name, directory, assignment text) (`dsh.ts:97-111`, `runtime.ts:138`).
3. `Assessor.request / release` (`ports.ts:49-53`), called from `evals.ts:68,118,324`; implemented by `MasterAssessor`, which steers into the main DSH Session (`assessment.ts:96-104`, `runtime.ts:133`).
4. Executor callbacks into the Engine: `EngineForExecutor` (`engine.ts:269-270`): `assignmentStarted, inputsDelivered, inputsRead, turnEnded, deliveryFailed, assignmentInterrupted, report, markUnrelated, handback, followForContext, reply`.

App-layer touch points:
5. Main-Session transport: `Sessions.relay` / `notify` enqueue `relay` / `notice` effects whose handlers call `prompt(... 'steer')` / `inject` on the DSH agent (`sessions.ts:99-105`, `:170-173`). Callers: runtime emit hook (`runtime.ts:140-146`), worker report tool (`tools/executor.ts:98`), follow tool (`:61`), settings save/pause (`settings.ts:173-211`), panel unsubscribe (`http.ts:175`).
6. LLM tool surfaces: `tools/main.ts` (13 tools, the router/assessor's API) and `tools/executor.ts` (6 worker tools), registered on DSH sessions (`runtime.ts:124`).
7. `AgentDelivery`: at-most-once message delivery by scanning DSH persisted history (`app/delivery.ts:45-85`).
8. Startup/shutdown: `sessions.install`, `executor.install`, `sessions.ensure(masterId)`, `executor.resume()` (`runtime.ts:208-216`); shutdown cancels agents, drains, flushes `ctx.sessionPersistence` (`runtime.ts:230-252`).
9. Panel: `ctx.webServer.register` with loopback check (`http.ts:231-237`), `sessionController.modelCatalog` (`http.ts:226`), `executor.activeCount()` (`http.ts:107,158`), `sessions.status()` (`http.ts:130`), `sessions.delivery(...)` (`http.ts:175`).
10. Resources: `sessionController.inspect(worker-<id>)` for worker event reads (`resources.ts:115`), model catalog (`:192,198`).
11. Role models: `ctx.llm.resolveCallConfig`, `sessionPersistence.flush` (`role-models.ts:9,43`).
12. Setup: `context.subprocess` for worker probe and env verify (`app/setup.ts:74,93`); `infra/environment.ts` `runAsWorker` via DSH subprocess.
13. Sources: `ThreadContext.image(agent: Agent, ...)` takes a DSH Agent (`sources/kind.ts:73,81`, `feishu-image.ts:4-6`); source plugins register via `ctx.orchestrator` Cordis service (`github.ts:113-115`, `feishu.ts:133-136`).
14. `policy.ts:11` imports `WORKER_COMMANDS` from `infra/environment.ts` for the executor settings schema.

### Portable as-is
- `src/core/*` entirely (model, ports, engine, part, intake, evals, tickets, assignments, replies, stage, ids, reasons, errors, memory). Pure TS, only `node:crypto`.
- `policy.ts` (except the `ExecutorConfigSchema` block and its `WORKER_COMMANDS` import), `admission.ts`, `kv.ts`, `limits.ts`.
- `app/store.ts`, `app/migration.ts`, `app/store-read.ts`, `app/effects.ts`, `app/outbox.ts`, `app/passes.ts` (all `node:sqlite` plus core).
- `sources/*` except the `image` hook signature and the Cordis plugin `apply` wrappers; `sources/registry.ts`, `poll.ts`, channels.
- `app/views/*` and the route table in `app/http.ts` (swap `ctx.webServer` and the few `sessions`/`executor` calls).

### Entangled with DSH
- `executor/dsh.ts`, `executor/background.ts` (replace with Atomic).
- `app/sessions.ts`, `app/delivery.ts`, `app/role-models.ts`, `app/retry-health.ts`, `app/prompts.ts` + `context.ts` + `skill-files.ts` (session prompt composition).
- `app/assessment.ts` (MasterAssessor: the deliver-to-session half is DSH; `decide`, `assessmentOutcome`, card building are portable).
- `app/tools/*` (logic portable, registration and `Agent` types are DSH).
- `app/runtime.ts` (composition root; Cordis `Service`).
- Effect kinds `assessment`, `relay`, `notice`, `launch`, `delivery` are execution-layer effects that happen to live in the service-layer queue. Only `reply` is purely service-layer.

### Where the domain model leaks executor concepts
`Ticket.execution` (`model.ts:305,315`), `Assignment.deliveredAt/idleAt` (`:227-232`), `TicketInput.readAt/deliveredTo` (`:244-246`), `Assignment` itself ("binding between a ticket and one executor instance", `:217`), and the `inputsRead`/`turnEnded` callbacks. These encode "an LLM session took a message into a step", which drives `letGo`, `unfinished`, `requeueUntaken` and `interrupted`. An Atomic-backed executor must produce equivalent facts or these rules change meaning.

---

## Specific mechanisms (Q4)

### Mandate revalidation on resume
`Policy.revalidate` (`policy.ts:213-240`). Called only in three places:
- `Tickets.wake` before resuming an ended ticket (`tickets.ts:257`); failure -> `refuse` drops waiting inputs and `letGo` sends untaken human messages to Eval (`:311-316`).
- `Tickets.attachable` when attaching to an ended ticket (`tickets.ts:113`) -> `UserError('mandateRevoked')`.
- `policyEffects` to compute what to tell live tickets on a Policy change (`policy.ts:155-161`); it **notifies, never revokes** live tickets.
Not called on retry, on host restart, or on a running ticket's next input. Rules: source must still listen to `basis.scope`; `followup` passes if explicit, else needs auto + rules enabled; `bot` needs bot still listed; `admission` needs the current cell to grant at least the original strength (sender added to list moves cell); other non-bot bases need sender still allowed; any basis with `observation` needs `mode === 'auto'` and all `basis.rules` enabled.

### Observe mode
Three enforcement points:
1. Gate: `mode === 'off'` makes inferred candidates inadmissible (`policy.ts:179,184,206,209`). In `observe` and `auto` they are admitted and assessed; the basis records `observation: { mode }`.
2. `assessmentOutcome`: an inferred accept outside `auto` is converted to `{ kind: 'ignore', reason: { code: 'observed' }, audit: { ..., would_accept: true, proposal: { title, scope, worktree_name } } }` (`policy.ts:55-58`). That is app-layer, not core.
3. Core backstop: `Evals.decide` throws `UserError('notExplicit')` for a non-explicit accept unless `policy.admitsInferred(rules)` (mode auto, non-empty rules, all enabled) (`evals.ts:152-154`, `policy.ts:212`).
Explicit requests are unaffected by mode. Mode is part of `policyVersion`, so switching modes reassesses running Evals (`policy.ts:117`, `evals.ts:218-221`) and can send `proactive: false` to live inferred tickets (`policy.ts:160`).

### Content-derived ids
`key(...values) = sha256(JSON.stringify(values)).slice(0, 32)` (`core/ids.ts:3-5`). Uses:
- Triggers: `key('github-comment', url, id, version)`, `key('github-issue', n)`, `key('github-ci', ...)`, `key('feishu', message_id)` (`github-trigger.ts:68,84,99,104`, `feishu-trigger.ts:18`). Intake returns `duplicate` on a known id (`intake.ts:23`).
- Eval: `key('eval', thread, policyVersion, at, ...pending)` (`evals.ts:107`). **Includes time.** Direct eval: `key('eval', thread, 'direct', trigger, kind, ticket?, at)` (`:277`). Ignore record: `key('eval', thread, 'ignored', version, at, ...ids)` (`:248`).
- `decision = key('decision', evalId)` (`evals.ts:329`), `ticket = key('ticket', evalId)` (`:311`), `assignment = key('assignment', ticketId, index)` (`tickets.ts:382`).
- Inputs: `key('input', ticketId, 'trigger', triggerId)` (`intake.ts:50`); attached/note variants (`tickets.ts:140,143`); `resumed` (`:265`); `restart` (`:323`); `policy` with `at` (`:206`); `note` with `at` (`:399`); status request is a plain string `status:<ticket>:<updatedAt>` (`:153`).
- Outbox: `key('ack', triggerId)` (`replies.ts:44,56`), `key('attention-reply', attentionId)` (`:47,79`), `key('reply', triggerId ?? ticketId, text)` (`:79`), `key('pr-terminal', ...)` (`github-pull.ts:104`).
- Attention: `key('attention', ticketId, question, at)` (`assignments.ts:114`).
Replay protection for accepts does not rely on the eval id: `Evals.accepted` scans the thread's accept Decisions and returns the earlier one for a trigger that already started a ticket (`evals.ts:137-146`, `:258-265`).

### "Save then do" effects
- `Effects.enqueue` upserts a row **inside the caller's transaction** (`effects.ts:61-66`) and calls `kick()`, which schedules `dispatch` on a microtask (`:84-88`). Because Engine commands are fully synchronous, the microtask runs after the outermost `atomic` has returned, so after commit. There is no explicit post-commit hook for effects; the guarantee comes from sync code plus the microtask. If a txn rolls back, the row is rolled back with it.
- Coalescing: `ON CONFLICT(kind,key) DO UPDATE` bumps `generation`, resets `attempts` and `due`, keeps `seq` (`effects.ts:62-63`). Completion deletes only the row matching `(kind,key,seq,generation)` so a re-enqueue during a run survives (`:134-135`).
- `Later` reschedules at `retry[0]` without counting a failure (`:138-139`); other errors back off exponentially to `retry[1]` (`:141-143`). Defaults 2 s..60 s; `launch` and `reply` 5 s..300 s (`dsh.ts:271-272`, `outbox.ts:24`). Ordered kinds (`relay`, `notice`) run one at a time and a failed head blocks the rest (`effects.ts:109-113`, `sessions.ts:104-105`).
- Health error after 3 consecutive failures, except `quiet` kinds (`effects.ts:7,155`).
- Non-durable side effects use `Store.afterCommit` instead: `DshExecutor.stop` cancels the worker turn there (`dsh.ts:363-368`). A crash between commit and that callback loses the cancel.
- Outbox: `INSERT OR IGNORE` receipt + `reply` effect in one txn (`outbox.ts:31`, `store.ts:267-270`); external idempotency via GitHub HTML marker and Feishu `--idempotency-key` (prior analysis, `github-channel.ts:34-39`, `feishu-channel.ts:23`).

### 100-word reply cap
`IM_WORDS = 100`, counted with `Intl.Segmenter('zh', { granularity: 'word' })`, word-like segments only (`infra/text.ts:2-16`). Enforced at:
- Worker `orchestrator_ack` text via `AcknowledgementSchema` (`tools/tool.ts:16-17`, `tools/executor.ts:33`): all channels.
- Accept acknowledgement from assessments: `checkedImText` (`assessment.ts:276`); explicit route acknowledgement is checked with `AcknowledgementSchema` through the route item field-check table (`tools/main.ts:53`, `:65`).
- `orchestrator_ticket_note` text (`tools/main.ts:181`).
- `Outbox.send` for `kind === 'reply'` **only when `channel.source === 'feishu'`** (`outbox.ts:29`), and again at send time in `feishu-channel.ts:22`.
- Routing notes: `NOTE_WORDS = 30` (`tools/main.ts:18`).
Not enforced: GitHub replies from `orchestrator_reply` (schema allows 20000 chars, `tools/main.ts:232`), notices, the core `Replies` part.

### Reserved human slot
`WorkerSlots.reserve(ticketId, by)` throws `Later` when `used() >= max() + (by === 'person' ? 1 : 0)` (`dsh.ts:192-196`). `person` is chosen only on **delivery** when any undelivered input is `fromPerson` (`dsh.ts:307-308`), and `fromPerson` counts every `text` input as a person's, including status requests and restart recovery notes (`dsh.ts:38`). Launches use `'launch'` (`:274`) and their concurrency is `slots.launches()` = max minus running and wake reservations (`:177-180`, `:271`). So it is one shared extra slot beyond `maxWorkers`, used only to wake an existing ticket's worker for a person's message, not a slot held empty in advance and not available to new tickets.

---

## Gotchas a type designer would get wrong from names (Q5)

1. **Subscription is not an entity.** It is `Thread.subscriptions: string[]`, qualified by `Thread.context`, and distinct from `Ticket.follows` (which governs ticket end). Three relations, two aggregates, no join table.
2. **Ticket "state" is derived.** No status column; the panel's state is `ticketStage()` computed from `ended`, `delivery`, `attention`, latest report and assignment state. `ended` is set and then can be **deleted** on resume (`tickets.ts:262`): an ended ticket is not terminal unless `ended.by === 'human'`.
3. **Mandate is immutable but not permanent.** `revalidate` gates only resume and attach. Live tickets keep running after a Policy change; they get a `policy-changed` Input.
4. **Eval ids include a timestamp.** "Content-derived" means deterministic given inputs including `at`, not replay-stable. Replay protection for accepts is a separate scan of Decisions.
5. **Decision `ignore` means many things**: observe-mode would-accept, explicit routing to an existing ticket (`routed`), invalid stops (`stopUnknown`, `stopNotExplicit`), started-ticket replays. Read `reason[].code` and `audit.would_accept`. `unavailable` covers timeout and policy change, and the triggers are requeued.
6. **`strength` is per batch.** An Eval takes the strongest admissible trigger; the Mandate's actor is that trigger's actor, not the thread starter. `Ticket.origin.triggerId` is `Evaluation.primary`.
7. **Follow-up ownership** (`followupOwners`, `model.ts:75-88`): a person's message that reached a live ticket is decided by that ticket's worker; the main Session may only stop it (`part.ts:32-35`). A type for "trigger routing" needs this owner concept, plus handback and `letGo`.
8. **`reply` id includes text** (`replies.ts:79`): two different texts answering the same trigger are two messages. Attention and ack ids do not include text, so the first text wins.
9. **`withdraw` deletes the receipt** (`store.ts:287-288`); `settle` recreates it if the send was in flight (`:278-281`). "Receipts are never deleted" is not quite true.
10. **Accept mode lives in `eval`, not `policy`, in settings**, yet it is hashed into `policyVersion`. Models and concurrency are not.
11. **Explicit tickets have `scope = title`** (`tools/main.ts:96`). `Mandate.scope` is advisory prompt text, never checked in code.
12. **`human` and `addressed` are Source-declared** booleans that the Policy trusts. A port must keep that responsibility in the source adapter.
13. **Effects are in the service DB but most kinds are execution-layer.** Porting the queue is easy; deciding which kinds Atomic absorbs (launch, delivery, assessment) versus which stay (reply, maybe relay/notice) is the real design call.
14. **`Executor.stop` is not durable** (afterCommit). With Atomic, stop should be a durable signal.
15. **The LLM is the decision API.** `orchestrator_route`, `orchestrator_eval_decide`, `orchestrator_reply` are the callers of `Engine.decide/reply`. If the new harness replaces the main Session, it must reimplement these tool contracts (including batch semantics: each route item is its own txn and failures do not undo others, `tools/main.ts:84-87,125`).
16. **`human_action` is a tool field, `attention` is the domain field, `question` is the core field.** Same concept, three names.
17. **Automatic inputs are held** (not queued) while a ticket waits for a person (`tickets.ts:238`), and `note` counts as automatic while `text` does not (`tickets.ts:14`).

---

## Where Things Live

| Concern | File |
|---|---|
| Types | `src/core/model.ts`, `src/core/ports.ts`, `src/core/stage.ts`, `src/core/reasons.ts` |
| Engine commands and role interfaces | `src/core/engine.ts` (`EngineFor*` at `:261-270`) |
| Intake / Eval / Ticket / Assignment / Reply logic | `src/core/intake.ts`, `evals.ts`, `tickets.ts`, `assignments.ts`, `replies.ts` |
| Policy, gate, revalidate, assessment validation | `src/policy.ts`, `src/admission.ts` |
| SQLite, transactions, receipts | `src/app/store.ts` |
| Effect queue | `src/app/effects.ts` |
| Outbox | `src/app/outbox.ts` |
| Pass loop | `src/app/passes.ts` |
| Composition and emit hook | `src/app/runtime.ts` |
| Panel API | `src/app/http.ts`, `src/app/views/*` |
| Source contract | `src/sources/kind.ts`, `src/sources/host.ts`, `src/sources/registry.ts` |
| Execution layer | `src/executor/dsh.ts`, `src/app/sessions.ts`, `src/app/assessment.ts`, `src/app/tools/*` |

## Corrections to the prior analysis
- `dsh-code.md` describes a 100-word cap on "Feishu replies"; it is right, and it should be stressed that GitHub replies are uncapped.
- `dsh-code.md` says effects dispatch "after the synchronous transaction commits"; true, but by microtask ordering, not an explicit commit hook (`effects.ts:84-88`).
- `dsh-code.md` lists ids as fully content-derived; eval, policy-input, note-input and attention ids include a timestamp.
- Line counts: `src/` now totals 15,205 lines (this checkout) versus 15,587 in the analysis; file:line citations above are from this checkout.
