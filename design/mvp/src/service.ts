// service.ts: the harness as pure rules over the log, behind ONE object. Exports openHarness and
// the port types only; folds and deciders are module-private (package.json "exports" hides them).
// No Atomic import, no GitHub import: both sides talk to this file through the ports below.

import type {
  AtomicRunId, Decision, EventId, GateId, GateSpec, Outcome, ReplyText, Repo, RunKey, RunSpec,
  Text, ThreadRef, TicketId, TriggerBody,
} from './domain.ts'
import type { Log, View } from './log.ts'

// ---------- ports (the only public surface) ----------

/** What the GitHub source hands in, already parsed from gh JSON (boundary: github.ts). */
export type TriggerDraft = Omit<TriggerBody, 'text'> & { thread: ThreadRef & { kind: 'issue' }; text: string; merged?: number }
export type IngestResult = 'duplicate' | 'filtered' | 'to-ticket' | 'to-router'

/** The engine's view of the daemon. Implemented here, called by engine.ts. Every method is idempotent. */
export interface EngineHost {
  report(run: RunKey, r: EngineReport): void
  /** Atomic HostInput lands here. Records gate.opened once; resolves with the answer, now or later. */
  ask(a: { atomic: AtomicRunId; stage: string; spec: GateSpec }, signal: AbortSignal): Promise<string | undefined>
  spec(run: RunKey): { spec: RunSpec; brief: string }
  /** Follow-ups the daemon routed to this ticket and not yet delivered, then live ones. */
  follow(ticket: TicketId, signal: AbortSignal): AsyncIterable<{ input: EventId; text: string }>
}
export type EngineReport =
  | { kind: 'bound'; atomic: AtomicRunId }
  | { kind: 'progress'; stage: string; summary: string }
  | { kind: 'delivered'; input: EventId }
  | { kind: 'ended'; outcome: Outcome }

/** The router session's view. Cards are previews + next-hop ids (Inline & Spill, Chain of Recall). */
export interface Card { id: string; kind: string; preview: string; next: readonly { id: string; rel: string }[] }
export interface RouterBatch {
  evals: readonly { eval: EventId; cards: readonly Card[] }[]          // need a decision
  asks: readonly { ticket: TicketId; gate: GateId; card: Card }[]       // requester gates: say it in the issue
  results: readonly { ticket: TicketId; card: Card }[]                  // ended visible runs: report in the issue
  seen: readonly Card[]                                                 // routed in code; non-waking, for context
}
export interface RouterPort {
  next(signal: AbortSignal): Promise<RouterBatch>
  decide(evalId: EventId, d: Decision): { ok: true; ticket?: TicketId } | { ok: false; problem: string }
  reply(ticket: TicketId, purpose: 'ack' | 'ask' | 'result', text: string): { ok: true } | { ok: false; problem: string }
  recall(id: string): Card | undefined
}

export type Intent =
  | { kind: 'run'; run: RunKey; spec: RunSpec }
  | { kind: 'stop'; run: RunKey; reason: string }
  | { kind: 'reply'; id: EventId; issue: ThreadRef & { kind: 'issue' }; text: ReplyText }

export type AttentionItem =
  | { kind: 'gate'; ticket: TicketId; gate: GateId; spec: GateSpec; age: string }
  | { kind: 'would-accept'; issue: string; title: string; decided: EventId }
  | { kind: 'failed'; ticket: TicketId; run: RunKey; evidence: string }
  | { kind: 'stuck'; ticket: TicketId; run: RunKey; evidence: string }
  | { kind: 'reply-gone'; ticket: TicketId; intent: EventId }

export interface Harness {
  ingest(t: TriggerDraft): IngestResult
  pending(): readonly Intent[]                                          // the outbox IS this fold
  settle(intent: EventId, r: { result: 'sent' | 'gone'; url?: string }): void
  liveRuns(): readonly { run: RunKey; atomic?: AtomicRunId; spec: RunSpec }[]
  engineHost(): EngineHost
  routerPort(): RouterPort
  human: {
    attention(): readonly AttentionItem[]
    answer(gate: GateId, answer: string, requestId: string): void
    /** Talk to the router from the terminal: a `trigger` on system:operator, explicit and addressed, never filtered. */
    ask(text: string, requestId: string): void
    stop(ticket: TicketId, requestId: string): void
    policy(mode: 'off' | 'observe' | 'auto', requestId: string): void
    tickets(): readonly { id: TicketId; title: string; stage: Stage }[]
  }
  /** Reactions: called by the daemon for each tail event; appends follow-on facts. Idempotent. */
  react(e: EventId): void
}
export type Stage = 'waiting-human' | 'working' | 'verifying' | 'queued' | 'idle' | 'closed'

/**
 * Who does what, decided by Vlad on 02/11/2026.
 *   router:   a dedicated Claude Code session, Opus (Vlad's plan), see router.ts
 *   worker:   an Atomic stage, Sol on the Codex login, "provider/id:effort"
 *   verifier: a fresh `claude -p`, Opus, read-only, inside the workflow's verify step
 * Writer (Sol) and verifier (Opus) are different model families: pstack's independence rule holds.
 */
export interface ModelRoles {
  router: { runtime: 'claude-code'; model: 'opus' }
  worker: { runtime: 'atomic'; model: string }        // 'openai-codex/gpt-6.1-sol:high'
  verifier: { runtime: 'claude-code'; model: 'opus' }
}
export const DEFAULT_MODELS: ModelRoles = {
  router: { runtime: 'claude-code', model: 'opus' },
  worker: { runtime: 'atomic', model: 'openai-codex/gpt-6.1-sol:high' },
  verifier: { runtime: 'claude-code', model: 'opus' },
}

export interface HarnessConfig { repos: readonly Repo[]; botLogin: string; owner: string; models: ModelRoles; defaultBudget: { maxCostUsd: number; maxDurationMs: number } }

export function openHarness(log: Log, config: HarnessConfig): Harness {
  throw new Error('not implemented')
  // Each method = log.transact(<private decider>) or log.read.view(<private view>). Nothing else.
}

// ---------- private: views (state is only these folds) ----------

interface IssueState { subscriber?: TicketId; unrouted: EventId[]; openEval?: EventId }
interface TicketState {
  repo: Repo; title: string; visibility: 'visible' | 'silent' | 'revealed'
  runs: { key: RunKey; spec: RunSpec; atomic?: AtomicRunId; outcome?: Outcome }[]  // at most one without outcome
  gates: Map<GateId, { spec: GateSpec; run: RunKey; answer?: string }>
  inputs: { id: EventId; delivered: boolean }[]
  closed?: string
}
declare const issueView: View<IssueState>      // part = threadKey(issue)
declare const ticketView: View<TicketState>    // part = ticket id
declare const runIndex: View<{ ticket: TicketId; key: RunKey } | undefined>  // part = AtomicRunId: HostInput -> RunKey
declare const policyView: View<{ mode: 'off' | 'observe' | 'auto'; maxWorkers: number; version: string }>
declare const outboxView: View<{ pending: Map<EventId, Intent>; held: Set<EventId> }>  // part 'all'

// ---------- private: deciders (pure: Reader in, Drafts out) ----------
//
// intake(t)
//   1. `trigger` (by source). Existing id -> 'duplicate'.
//   2. CODE FILTER (stage one of two): repo listed; not our own bot; human or allow-listed bot;
//      addressed, or on a thread with a subscriber; actor == owner for accept-capable triggers.
//      -> `trigger.filtered` {pass, reason}. Fail -> 'filtered'.
//   3. merged PR on a ticket's correlated thread -> `ticket.closed merged` (no LLM).
//   4. subscriber ticket open AND no open requester gate -> `input.routed` on ticket thread
//      -> 'to-ticket' (router sees it in `seen`, not woken).
//   5. else issue.unrouted += trigger -> 'to-router' (LLM stage two decides).
//
// next(): one `eval.opened` per issue with unrouted triggers and no open eval (batching falls out).
//
// decide(eval, d)       observe mode lives ONLY here: accept under 'observe' is stored as would-accept.
//   accept  -> decided + ticket.opened + subscribed(issue and correlates) + run.intended(attempt 1)
//   route   -> decided + subscribed + input.routed      answer -> decided + gate.answered (by router)
//   stop    -> decided + stop.intended                   ignore -> decided
//
// react(e)
//   input.routed, ticket open, no live run      -> run.intended(n+1, forkFrom = last workerSession)
//   run.ended done                              -> silent: reveal; router batch gets a `result`
//   run.ended budget                            -> gate.opened {budget, operator, raise: x2} (by daemon)
//   gate.answered on a budget gate, yes         -> stop.intended(old) + run.intended(n+1, raise, forkFrom)
//   run.ended failed retryable & attempt < 3    -> run.intended(n+1, forkFrom)
//   run.ended failed otherwise                  -> attention 'failed'; silent ticket -> closed discarded
//   gate.opened requester on a silent ticket    -> stop.intended + closed discarded (speculation never asks)
//   watchdog.judged stuck|drifting              -> stop.intended + attention 'stuck'
//   policy.set off                              -> stop.intended for every live run
//
// outbox pending: run.intended w/o run.ended, and live runs < maxWorkers (FIFO by seq; a run already
//   bound is never "pending start"); stop.intended w/o run.ended; reply.intended w/o reply.settled,
//   held while ticket is silent.
//
// composeReply(text): GitHub norms (markdown, <= 1500 chars, leading one-line status, hidden marker
//   `<!-- harness:<intentId> -->` appended by github.ts, not by the LLM). The only ReplyText constructor.
//
// gateIdOf(atomic, stage, spec) = hash(atomic, stage, spec.kind, spec.question): a stage that
//   re-asks after a daemon restart or Atomic resume gets the SAME gate and the stored answer.
export type { Text }
