// domain.ts: THE list of facts (Kinds) and the domain types. No I/O, no Atomic types.
// Carried over from design/src/events.ts, trimmed to the MVP: GitHub only, one machine, no envs.

type Brand<T, B extends string> = T & { readonly __brand: B }
export type Hash = Brand<string, 'Hash'>
export type EventId = Brand<string, 'EventId'>        // idOf(draft): content address, no clock
export type Seq = Brand<number, 'Seq'>
export type Repo = Brand<string, 'Repo'>              // "owner/name", only repos listed in config
export type TicketId = Brand<string, 'TicketId'>      // = hash('ticket', accepting `decided` id)
export type RunKey = Brand<string, 'RunKey'>          // = id of its `run.intended`. OURS, stable on replay
export type AtomicRunId = Brand<string, 'AtomicRunId'> // Atomic's UUID, learned via `run.bound`. THEIRS
export type GateId = Brand<string, 'GateId'>          // = hash(atomicRun, stage, kind, question): re-asks collapse

export type ThreadRef =
  | { kind: 'issue'; repo: Repo; number: number }     // GitHub issue or PR (same number space)
  | { kind: 'ticket'; ticket: TicketId }              // a work thread; there is no ticket table
  | { kind: 'system'; name: 'policy' | 'watchdog' | 'operator' }  // operator: Vlad via `harness ask` (graft from candidate 3)

/** Inline & Spill: events carry a preview; the tail lives in the blob table under its hash. */
export interface Text { preview: string; length: number; blob?: Hash }

/** Who may author which kind. Enforced by `DraftBy<R>`: the engine cannot build `reply.intended`. */
export type Role = 'source' | 'daemon' | 'router' | 'engine' | 'human' | 'watchdog'

export interface TriggerBody {
  native: { id: string; version: string }            // native id + hash of the text: only a real edit is a new fact
  actor: string; human: boolean; addressed: boolean  // addressed = a handle (`/harness`) as a whole token
  text: Text; url: string
  correlates: ThreadRef[]                            // PR <-> issue via "Fixes #n" and branch name
}

export type Decision =
  | { kind: 'accept'; title: string; scope: string; silent: boolean }   // silent = speculative
  | { kind: 'would-accept'; title: string; scope: string }              // what observe mode records
  | { kind: 'route'; ticket: TicketId }
  | { kind: 'answer'; gate: GateId; text: string }                      // human replied in the issue
  | { kind: 'stop'; ticket: TicketId }
  | { kind: 'ignore'; reason: string }

export interface Budget { maxCostUsd: number; maxDurationMs: number }   // becomes Atomic WorkflowBudget

/** Everything the engine needs to run one attempt. The brief is built from the log, never by the LLM. */
export interface RunSpec {
  ticket: TicketId; attempt: number; repo: Repo; baseBranch: string
  brief: Text                                        // pstack Orchestrate brief + autonomy grant
  budget: Budget
  forkFrom?: string                                  // previous attempt's worker sessionId (context carry)
  startFrom?: string                                 // previous attempt's head: attempt n+1 continues its commits
  feedback?: Text                                    // why the previous attempt was not accepted (verifier evidence)
  inputs?: EventId[]                                 // input.routed follow-ups this attempt's brief carries (delivered by it)
  models: { worker: string; verifier: string }       // from HarnessConfig.models, frozen per attempt
}

/** Every human ask is a Gate. It stays INSIDE the Atomic run (awaiting_input); Atomic keeps it durable. */
export interface GateSpec {
  kind: 'question' | 'irreversible' | 'budget'
  audience: 'requester' | 'operator'                // requester: router asks in the issue; operator: CLI/page only
  question: string; options?: string[]; raise?: Budget
}

/** Only `independentVerdict()` (engine.ts) builds one: verifier stage != worker stage, bound to sha. */
export type IndependentVerdict = Brand<{
  repo: Repo; sha: string; patchId: string; verdict: 'unit-test-verified' | 'live-ui-verified' | 'inspected'; evidence: string
  workerModel: string; verifierModel: string
  sameFamily: boolean   // provider of worker vs verifier; false with the 02/11 roles (Sol works, Opus verifies)
}, 'IndependentVerdict'>

export type Outcome =
  | { kind: 'done'; verdict: IndependentVerdict; pr: number; url: string; sha: string; summary: string; workerSession: string }
  | { kind: 'budget'; spentUsd: number; workerSession?: string; sha?: string }  // Atomic stopped the attempt at its budget: a budget gate asks Vlad
  | { kind: 'failed'; cause: 'error' | 'verifier-failed' | 'stopped' | 'stuck'; retryable: boolean; evidence: string; workerSession?: string; sha?: string }

/** What Atomic reported for a run, summed over its stages. Cost is the provider's figure (API-equivalent on a subscription). */
export interface Usage { costUsd: number; input: number; output: number; cacheRead: number; turns: number; durationMs: number; verifierUsd?: number }

export type ReplyText = Brand<string, 'ReplyText'>   // only composeReply() builds one (GitHub norms)
export type ReplyPurpose = 'ack' | 'ask' | 'result' | 'answer'

interface Kinds {
  'trigger':         { by: 'source'; body: TriggerBody }
  'trigger.filtered':{ by: 'daemon'; body: { trigger: EventId; pass: boolean; reason: string; policy: Hash } }
  'eval.opened':     { by: 'daemon'; body: { triggers: EventId[]; policy: Hash } }
  'decided':         { by: 'router' | 'daemon'; body: { eval: EventId; decision: Decision } }
  'subscribed':      { by: 'daemon'; body: { ticket: TicketId } }
  'ticket.opened':   { by: 'daemon'; body: { title: string; scope: string; repo: Repo; visibility: 'visible' | 'silent'; origin: EventId[] } }
  'ticket.promoted': { by: 'daemon'; body: { via: 'handle' | 'delivered' } }
  'input.routed':    { by: 'daemon'; body: { trigger: EventId; preview: Text } }
  'input.delivered': { by: 'engine'; body: { input: EventId; run: RunKey } }
  'run.intended':    { by: 'daemon'; body: RunSpec }
  'run.bound':       { by: 'engine'; body: { run: RunKey; atomic: AtomicRunId } }
  'run.progress':    { by: 'engine'; body: { run: RunKey; stage: string; summary: string } }
  'run.ended':       { by: 'engine'; body: { run: RunKey; outcome: Outcome; usage?: Usage } }
  'gate.opened':     { by: 'engine' | 'daemon'; body: { run: RunKey; gate: GateId; spec: GateSpec; to?: ThreadRef } }  // to: the issue where the requester is asked
  'gate.answered':   { by: 'human' | 'router'; body: { gate: GateId; answer: string; requestId: string } }
  'stop.intended':   { by: 'daemon' | 'router' | 'human'; body: { run: RunKey; reason: string } }
  'reply.intended':  { by: 'router' | 'daemon'; body: { to: ThreadRef; purpose: ReplyPurpose; text: ReplyText } }  // to: an issue, or system:operator (harness ask)
  'reply.settled':   { by: 'daemon'; body: { intent: EventId; result: 'sent' | 'gone'; url?: string } }
  'ticket.closed':   { by: 'daemon' | 'human'; body: { outcome: 'merged' | 'closed' | 'discarded' | 'stopped'; reason?: string } }
  'policy.set':      { by: 'human'; body: { mode: 'off' | 'observe' | 'auto'; maxWorkers: 1 | 2 | 3; requestId: string } }
  'speculative.set': { by: 'daemon'; body: { repo: Repo; enabled: boolean } }
  'watchdog.judged': { by: 'watchdog'; body: { run: RunKey; verdict: 'progressing' | 'stuck' | 'drifting' | 'no-verdict'; evidence: string } }
}
export type Kind = keyof Kinds
export type Draft<K extends Kind = Kind> = K extends Kind
  ? { thread: ThreadRef; kind: K; by: Kinds[K]['by']; cause: readonly EventId[]; body: Kinds[K]['body'] } : never
export type DraftBy<R extends Role> = Extract<Draft, { by: R }>
export type Event<K extends Kind = Kind> = K extends Kind ? Draft<K> & { id: EventId; seq: Seq; at: string } : never

/** The only serializer of ThreadRef: storage key and part of every event id. */
export function threadKey(t: ThreadRef): string {
  switch (t.kind) {
    case 'issue': return `issue:${t.repo}#${t.number}`
    case 'ticket': return `ticket:${t.ticket}`
    case 'system': return `system:${t.name}`
  }
}
