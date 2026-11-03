// domain.ts: every type the harness reasons about. No I/O, no Atomic, no GitHub wire types.
// Continuity lives here (in the store), never in an LLM context: each run gets a Pack built
// from these types and returns typed outputs that are parsed back into them.

type Brand<T, B extends string> = T & { readonly __brand: B }

/** sha256(JSON) prefix of the content that defines the thing, never a clock (make-operations-idempotent). */
export type TriggerId = Brand<string, 'TriggerId'>   // = id('trigger', repo, nativeKind, nativeId, nativeVersion)
export type ThreadKey = Brand<string, 'ThreadKey'>   // = `${repo}#${number}` (issue or PR), or `local:ask`
export type TicketId = Brand<string, 'TicketId'>     // = id('ticket', batchId, first trigger)
export type BatchId = Brand<string, 'BatchId'>       // = id('batch', sorted pending trigger ids, policyVersion)
export type AttemptId = Brand<string, 'AttemptId'>   // = id('attempt', ticket, n); also the Atomic runId
export type GateId = Brand<string, 'GateId'>         // = id('gate', attempt)
export type IntentId = Brand<string, 'IntentId'>     // = id('reply', cause, purpose); GitHub marker
export type Sha = Brand<string, 'Sha'>
export type PolicyVersion = Brand<string, 'PolicyVersion'>

export type Mode = 'off' | 'observe' | 'auto'
export type Strength = 'explicit' | 'inferred'
export type Visibility = 'visible' | 'silent'     // silent = speculative: speaks only after a passing verdict

/** Parsed by github.ts from the native payload. `human` and `addressed` are source-declared. */
export interface Trigger {
  id: TriggerId
  thread: ThreadKey
  kind: 'issue' | 'comment' | 'review' | 'ci' | 'pr-state' | 'local'
  author: string
  human: boolean
  addressed: boolean                 // @harness mention or `agent` label, set by the code filter
  text: Spill                        // untrusted
  url?: string
}

/** Inline & Spill: cards carry `preview` (<= 280 chars); `full` is read only through recall(). */
export interface Spill { preview: string; chars: number; full: string }

/** Fast path result. Computed by code from config + thread ownership, never by an LLM. */
export type Intake =
  | { kind: 'duplicate' }
  | { kind: 'dropped'; reason: 'repo-not-listed' | 'bot' | 'own-reply' | 'mode-off-unaddressed' }
  | { kind: 'passed-through'; ticket: TicketId; live?: AttemptId; answers?: GateId }
  | { kind: 'pending'; strength: Strength }      // waits for the next router batch

/** Immutable grant from Vlad's policy. Revalidated by `mayStart` before EVERY attempt run. */
export interface Mandate {
  strength: Strength
  basis: 'addressed' | 'inferred-rule' | 'followup'
  actor: string
  policyVersion: PolicyVersion
  rules: readonly string[]           // semantic rules the router cited (inferred only)
}

/** What the router-batch run returns per trigger. Parsed from the stage's schema output. */
export type Decision =
  | { trigger: TriggerId; kind: 'accept'; title: string; scope: string; visibility: Visibility; rules: string[] }
  | { trigger: TriggerId; kind: 'route'; ticket: TicketId }           // attach to an existing ticket
  | { trigger: TriggerId; kind: 'stop'; ticket: TicketId }
  | { trigger: TriggerId; kind: 'ignore'; reason: string }

/** After policy: observe turns an inferred accept into `would-accept`. Only `applyDecision` builds this. */
export type Applied =
  | { kind: 'ticket-opened'; ticket: TicketId; mandate: Mandate }
  | { kind: 'would-accept'; title: string; rules: string[] }
  | { kind: 'routed'; ticket: TicketId } | { kind: 'stopped'; ticket: TicketId }
  | { kind: 'ignored'; reason: string } | { kind: 'refused'; reason: 'stop-not-explicit' | 'unknown-ticket' | 'inferred-not-admitted' }

/** Short durable memory the router writes for its future selves (replaces the long-lived context). */
export type NoteOp = { op: 'add'; text: string; about: (TicketId | ThreadKey)[] } | { op: 'drop'; index: number }
export const MAX_NOTES = 30

/** Reply text that passed channel norms. Only `composeReply` (store.ts) builds it. */
export type ReplyText = Brand<string, 'ReplyText'>
export interface ReplyDraft { thread: ThreadKey; purpose: 'ack' | 'answer' | 'result' | 'question'; text: string; cause: TriggerId | AttemptId }

// ---------- tickets and attempts ----------

export interface Budget { maxDurationMs: number; maxTokens: number; maxCost: number }

/** Every human ask ends the attempt. The answer starts attempt n+1 in the same worktree. */
export interface Gate {
  id: GateId
  kind: 'question' | 'irreversible' | 'budget' | 'stuck'
  question: string
  raise?: Budget                     // budget gates: proposed budget for attempt n+1
}

/** pstack's "independent verdict": from the verify stage only (fresh context, no edit tools). */
export type Verdict = Brand<{ result: 'PASS' | 'PASS+NOTES'; headSha: Sha; baseSha: Sha; patchId: string; evidence: string; sameModel: true }, 'Verdict'>

/** The typed output of one ticket-attempt run, after classify(). `done` cannot exist without a Verdict. */
export type AttemptOutcome =
  | { kind: 'done'; verdict: Verdict; branch: string; pr: number; summary: string }
  | { kind: 'parked'; gate: Gate; summary: string }
  | { kind: 'failed'; cause: 'verify-failed' | 'error' | 'stopped' | 'crash'; retryable: boolean; summary: string }

/** Derived from rows (open/closed + last attempt + open gate), never stored as a status column. */
export type TicketStage =
  | { stage: 'queued' } | { stage: 'running'; attempt: AttemptId }
  | { stage: 'waiting-vlad'; gate: Gate } | { stage: 'closed'; how: 'done' | 'merged' | 'stopped' | 'discarded' | 'failed' }

// ---------- what runs see and return ----------

/** Chain of Recall: every card inlines next-hop ids. recall(id) returns the card for any id. */
export interface Card { id: string; line: string; body?: string; next: string[] }

/** Input of one router-batch run. Rendered text is what the model reads; ids are for the journal. */
export interface RouterPack {
  batch: BatchId
  pending: readonly Card[]           // triggers to decide (waking)
  results: readonly Card[]           // attempts that ended since the last batch (async ReAct)
  seen: readonly Card[]              // passed-through triggers since last batch, one line each (non-waking)
  open: readonly Card[]              // every open ticket, one line each
  recent: readonly Card[]            // last 20 decisions, one line each
  notes: readonly string[]           // router memory, <= MAX_NOTES
  norms: string                      // GitHub reply norms: structured, complete, link evidence
}

export interface RouterOutput { decisions: Decision[]; replies: ReplyDraft[]; notes: NoteOp[] }

/** Input of one ticket-attempt run. */
export interface AttemptSpec {
  attempt: AttemptId
  ticket: TicketId
  n: number
  repo: string
  worktreeDir: string                // stable per ticket: attempt n+1 continues the same branch
  branch: string
  baseBranch: string
  brief: string                      // ticket card + inputs since last attempt + previous outcome + gate answer
  visibility: Visibility
  budget: Budget
}

/** What a settled run reports back to the supervisor. The only path from Atomic into the store. */
export type RunEnded =
  | { kind: 'router-batch'; batch: BatchId; output: RouterOutput }
  | { kind: 'router-batch-failed'; batch: BatchId; error: string }     // supervisor reruns the same batch
  | { kind: 'ticket-attempt'; attempt: AttemptId; outcome: AttemptOutcome }
