// events.ts: THE list. Every fact the harness knows is one of these kinds.
// Adding a kind means adding one entry to `Kinds`; folds get a compile error until they handle it
// (exhaustive switch over `Event['kind']`). No other module lists kinds.

type Brand<T, B extends string> = T & { readonly __brand: B }

export type Hash = Brand<string, 'Hash'>              // sha256(JSON) truncated, see log.ts idOf
export type EventId = Brand<string, 'EventId'>
export type Seq = Brand<number, 'Seq'>                 // append order; folds run in Seq order
export type Iso = Brand<string, 'Iso'>
export type SourceId = 'github' | 'feishu'
export type TicketId = Brand<string, 'TicketId'>       // = hash('ticket', id of the accepting `decided` event)
export type RunId = Brand<string, 'RunId'>             // = id of its `run.intended` event; also Atomic's runId
export type GateId = Brand<string, 'GateId'>           // = id of its `gate.opened` event
export type EnvId = Brand<string, 'EnvId'>
export type ThreadKey = Brand<string, 'ThreadKey'>     // threadKey(ref), the only serializer

/** Every stream is a Thread. A Ticket IS a work thread: there is no Ticket table. */
export type ThreadRef =
  | { kind: 'source'; source: SourceId; id: string }   // github:owner/repo#12
  | { kind: 'work'; ticket: TicketId }
  | { kind: 'system'; name: 'policy' | 'watchdog' }
  | { kind: 'env'; env: EnvId }

export interface ActorRef { source: SourceId | 'panel'; id: string }
export interface ChannelRef { source: SourceId; thread: string; address: Record<string, string> }

/** Inline & Spill: events carry a preview; the full text lives in the blob store under its hash. */
export interface Text { preview: string; length: number; blob?: Hash }

/** Who may write what. Encoded in `Kinds[k].by`, enforced by `Draft<K>`'s type. */
export type Role = 'source' | 'harness' | 'router' | 'worker' | 'human' | 'watchdog'

// ---------- bodies ----------

export interface TriggerBody {
  native: { id: string; version?: string }  // identity; never a timestamp of ours
  actor: ActorRef
  human: boolean                            // source-declared, trusted by the gate
  addressed?: 'mention' | 'direct'
  text: Text                                // untrusted
  channel?: ChannelRef
  url?: string
  correlates: ThreadRef[]                   // other threads this event also belongs to (PR <-> issue)
  meta: Record<string, unknown>             // source-native, folds never read it
}

export type Strength = 'explicit' | 'inferred'
export type AcceptMode = 'off' | 'observe' | 'auto'
export type MandateBasis =
  | { via: 'addressed'; addressed: 'mention' | 'direct'; sender: string }
  | { via: 'admission'; cell: 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'; sender: string; rules: string[] }
  | { via: 'bot'; bot: string; rules: string[] }
  | { via: 'followup'; ticket: TicketId }

export type GateResult =
  | { admissible: false; reason: string }
  | { admissible: true; strength: Strength; basis: MandateBasis }

/** Immutable grant. Its validity is NOT stored: `mandateValidity(m, policy)` in fold.ts. */
export interface Mandate {
  strength: Strength
  basis: MandateBasis
  actor: ActorRef
  scope: string                 // advisory prompt text
  policyVersion: Hash
  grantedBy: EventId            // the `decided` event
}

export interface TicketSeed { title: string; scope: string; acknowledgement?: string }

export type Decision =
  | { kind: 'accept'; seed: TicketSeed; visibility: Visibility }
  | { kind: 'observe'; wouldAccept: TicketSeed; rules: string[] }  // accept under mode 'observe'
  | { kind: 'route'; ticket: TicketId }                            // subscribe an existing ticket
  | { kind: 'stop'; ticket: TicketId }
  | { kind: 'ignore'; reason: string }
  | { kind: 'unavailable'; reason: 'timeout' | 'policy-changed' }  // triggers return to the inbox

/** silent = speculative execution: replies are held until `ticket.revealed`, dropped on discard. */
export type Visibility = 'visible' | 'silent'

/**
 * pstack's ledger row, accepted only from a non-author. Built only by `independentVerdict()`.
 * Keyed by (repo, sha), not by PR: a speculative ticket is verified before any PR exists.
 * (graft from candidate 3; pstack's own ledger needs a PR number, store.ts:1685)
 */
export type IndependentVerdict = Brand<{
  repo: string; sha: string; pr?: number
  verdict: 'live-ui-verified' | 'unit-test-verified'
  evidence: string; verifier: string; author: string
}, 'IndependentVerdict'>

export interface Evidence { summary: string; pointers: string[] }   // SHA, PR, path:line, trail row

/**
 * Every human ask is a Gate. A worker never waits inside a run: it parks (ends) and the answer
 * starts the next attempt, which resumes the same Claude Code session (`RunSpec.resumeSession`),
 * so the worker keeps its context across the question.
 *   question:     the worker asked (pstack `orch gate park`)
 *   irreversible: the PreToolUse hook denied a pause-always action (force-push, deploy, delete, outbound message)
 *   budget:       the attempt hit its budget; the answer may raise it for the next attempt
 * There is no "resume the same Atomic run" continuation: Atomic's session resume takes no budget,
 * so a budget stop is always a new attempt with `raise` (graft from candidate 2).
 */
export interface GateSpec {
  kind: 'question' | 'irreversible' | 'budget'
  question: string
  options?: string[]
  default?: string
  audience: 'requester' | 'operator'        // requester: asked in the channel; operator: panel only
  raise?: Budget                            // only for kind 'budget': proposed budget for attempt n+1
}

export interface Budget { maxDurationMs: number; maxTokens: number; maxCost: number }

/** `session` is the worker's Claude Code session id; the next attempt resumes it. */
export type Outcome =
  | { kind: 'done'; verdict: IndependentVerdict; deliverable: { pr?: number; branch: string; sha: string }; session: string }
  | { kind: 'parked'; gate: GateSpec; evidence: Evidence; session?: string }
  | { kind: 'failed'; cause: 'error' | 'crash' | 'verifier-failed' | 'stuck' | 'stopped'; evidence: Evidence; retryable: boolean; session?: string }

export interface RunSpec {
  ticket: TicketId
  attempt: number
  env: EnvId
  brief: Text                               // pstack Orchestrate brief, built by fold.ts briefOf()
  budget: Budget
  /**
   * 'silent' (speculative): the worker may not ask (a parked outcome closes the ticket as
   * discarded), and failures are not announced. A verified result IS the confirmation, so publish
   * runs as usual and `run.ended done` reveals the ticket.
   */
  visibility: Visibility
  resumeSession?: string                   // previous attempt's Outcome.session, folded by ticketView
  /**
   * Names only. Values are resolved by the executor for HOST steps (publish: push + find-or-open
   * PR with a marker). They never enter the worker's process env or prompt: the worker can only
   * commit in its worktree, so pause-always holds by capability, not only by the hook.
   * (graft from candidate 2; article 8.4: use credentials without seeing them)
   */
  hostSecrets: string[]
}

export type ReplyPurpose = 'acknowledgement' | 'answer' | 'result' | 'gate'
export type ReplyText = Brand<string, 'ReplyText'>   // passed channel norms, see decide.ts composeReply

// ---------- the one list ----------

interface Kinds {
  // source threads
  'trigger':         { by: 'source';  body: TriggerBody }
  'trigger.gated':   { by: 'harness'; body: { trigger: EventId; result: GateResult; policyVersion: Hash } }
  'eval.started':    { by: 'harness'; body: { triggers: EventId[]; strength: Strength; basis: MandateBasis; attempt: number } }
  'decided':         { by: 'router' | 'harness'; body: { eval: EventId; decision: Decision } }
  'subscribed':      { by: 'harness' | 'router'; body: { ticket: TicketId; mode: 'own' | 'context' } }
  'unsubscribed':    { by: 'worker' | 'router' | 'human'; body: { ticket: TicketId; reason: string } }
  'handed.back':     { by: 'worker';  body: { trigger: EventId; ticket: TicketId; reason: string } }
  // work threads (one per ticket)
  'ticket.opened':   { by: 'harness'; body: { mandate: Mandate; seed: TicketSeed; visibility: Visibility; channels: ChannelRef[]; origin: EventId[] } }
  'input.routed':    { by: 'harness'; body: { trigger: EventId; preview: Text; context: boolean } }
  'input.taken':     { by: 'worker';  body: { input: EventId } }
  'run.intended':    { by: 'harness'; body: RunSpec }
  'run.started':     { by: 'worker';  body: { run: RunId } }
  'run.reported':    { by: 'worker';  body: { run: RunId; summary: string; evidence?: Evidence } }
  'run.ended':       { by: 'worker';  body: { run: RunId; outcome: Outcome } }
  'gate.opened':     { by: 'harness'; body: { run: RunId; spec: GateSpec } }
  'gate.answered':   { by: 'human';   body: { gate: GateId; answer: string; requestId: string } }
  'stop.intended':   { by: 'harness' | 'router' | 'human'; body: { run: RunId; reason: string; requestId?: string } }
  'reply.intended':  { by: 'harness' | 'router'; body: { channel: ChannelRef; purpose: ReplyPurpose; text: ReplyText; inReplyTo?: EventId } }
  'reply.settled':   { by: 'harness'; body: { intent: EventId; status: 'sent' | 'dropped'; reason?: string } }
  'ticket.revealed': { by: 'harness' | 'router'; body: { because: EventId } }
  'ticket.closed':   { by: 'harness' | 'human'; body: { outcome: 'completed' | 'merged' | 'closed' | 'discarded' | 'stopped'; reason: string } }
  // system and env threads
  'policy.set':      { by: 'human';   body: { settings: unknown; version: Hash; requestId: string } }
  'env.seen':        { by: 'harness'; body: { online: boolean; probe: string } }
  'watchdog.judged': { by: 'watchdog'; body: { run: RunId; verdict: 'progressing' | 'stuck' | 'drifting'; evidence: Evidence; window: string } }
}

export type Kind = keyof Kinds
export type BodyOf<K extends Kind> = Kinds[K]['body']
export type AuthorOf<K extends Kind> = Kinds[K]['by']

/** What a writer proposes. No id, seq or time: the log assigns them. */
export type Draft<K extends Kind = Kind> = K extends Kind
  ? { thread: ThreadRef; kind: K; by: AuthorOf<K>; cause: readonly EventId[]; body: BodyOf<K> }
  : never

/** A draft whose author is fixed: the worker sink can only build worker kinds, etc. */
export type DraftBy<R extends Role> = Extract<Draft, { by: R }>

/**
 * A stored fact. Invariant: id = idOf(thread, kind, by, cause, body). `at` is recorded but is not
 * part of the identity, so replaying the same inputs yields the same ids (see log.ts).
 */
export type Event<K extends Kind = Kind> = K extends Kind
  ? Draft<K> & { id: EventId; seq: Seq; at: Iso; key: ThreadKey }
  : never

export function threadKey(ref: ThreadRef): ThreadKey {
  throw new Error('not implemented')
  // TODO switch(ref.kind): 'source' -> `${source}:${id}`, 'work' -> `work:${ticket}`, 'system' -> `sys:${name}`, 'env' -> `env:${env}`
}
