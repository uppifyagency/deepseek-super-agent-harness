// decide.ts: every rule that turns facts into new facts. Pure: (Reader, input) -> Draft[].
// Each function is passed to log.transact by service.ts and nothing else calls the log.
// Rules that run "after X happens" are deciders over X's event (see `react`), never callbacks.

import type {
  ChannelRef, Decision, DraftBy, Draft, Event, EventId, GateId, ReplyPurpose, ReplyText, RunId,
  SourceId, TicketId, TriggerBody, ThreadRef,
} from './events'
import type { Reader } from './log'

/** Intake: one source trigger. Fast path entirely in code, no LLM. */
export type IngestResult =
  | { kind: 'duplicate' } | { kind: 'filtered'; reason: string }
  | { kind: 'passed-through'; tickets: TicketId[] } | { kind: 'queued-for-router' }
export function intake(read: Reader, thread: ThreadRef, source: SourceId, body: TriggerBody): readonly Draft[] {
  throw new Error('not implemented')
  // TODO 1. draft `trigger` (by source). If its id exists -> [] (caller reports duplicate).
  // TODO 2. policy.gate -> `trigger.gated` (cause: trigger). The result is recorded, so a later
  //         policy change never re-gates history; `simulate` re-gates a copy instead.
  // TODO 3. for each subscriber of thread and correlates: `input.routed` on work:<ticket>
  //         (context = mode === 'context'). Own subscriber present -> Router is skipped (pass-through).
  //         Ticket closed and human message -> wake rule: mandateValidity first, refuse -> unrouted.
}

/**
 * Router wake-up: open one Eval per thread with unrouted triggers and no open Eval. The batch is
 * everything that accumulated while the Router was busy: batching falls out of the inbox fold.
 * Eval id is content-addressed over (thread, sorted triggers, policyVersion, attempt), where
 * attempt = count of prior `unavailable` decisions on the same set. No clock, so replay-stable.
 */
export function openEvals(read: Reader): readonly Draft<'eval.started'>[] {
  throw new Error('not implemented')
  // TODO keep the strongest admissible trigger per batch (dsh Evals.start); none -> `decided ignore`
}

/**
 * Router decision for one Eval, its own transaction. Replays return the same events (same id).
 * Observe mode lives here and only here: an inferred `accept` under mode 'observe' is written as
 * `{kind:'observe', wouldAccept}`. Under 'off' inferred never reaches an Eval (gate refuses).
 */
export type RouterDecision =
  | { kind: 'accept'; title: string; scope: string; acknowledgement?: string; rules?: string[]; silent?: boolean }
  | { kind: 'route'; ticket: TicketId } | { kind: 'stop'; ticket: TicketId } | { kind: 'ignore'; reason: string }
export function decide(read: Reader, evalId: EventId, d: RouterDecision): readonly Draft[] {
  throw new Error('not implemented')
  // TODO stale eval (a later eval or decided exists) -> UserError('staleEval')
  // TODO policyVersion changed since eval.started -> decided unavailable(policy-changed)
  // TODO accept & explicit, or accept & inferred & admitsInferred -> decided accept +
  //      ticket.opened (work:<hash('ticket', decidedId)>) + subscribed(own) on every batch thread
  //      + run.intended(attempt 1) + reply.intended(acknowledgement) unless silent
  // TODO stop needs explicit strength and a live run -> stop.intended
}

/** Channel norms, the only constructor of ReplyText. IM: 100 words (Intl.Segmenter), GitHub: structured sections. */
export type ReplyCheck = { ok: true; text: ReplyText } | { ok: false; problem: 'too-long' | 'unstructured' | 'empty' }
export function composeReply(channel: ChannelRef, purpose: ReplyPurpose, text: string): ReplyCheck {
  throw new Error('not implemented')
}

/** Router `reply` tool. Workers have no path here: reply.intended is not a worker kind. */
export function reply(read: Reader, ticket: TicketId, purpose: ReplyPurpose, text: string, inReplyTo?: EventId): readonly Draft[] {
  throw new Error('not implemented')
  // TODO purpose 'gate' must quote an open gate's question; 'acknowledgement' once per trigger
}

/** What the executor port says. Each variant is a WorkerReport; `fromWorker` maps it to events. */
export type WorkerReport =
  | { kind: 'started' }
  | { kind: 'progress'; summary: string }
  | { kind: 'took'; input: EventId }
  | { kind: 'unsubscribe'; thread: ThreadRef; reason: string }
  | { kind: 'handback'; trigger: EventId; reason: string }
  | { kind: 'ended'; outcome: import('./events').Outcome }
export function fromWorker(read: Reader, run: RunId, r: WorkerReport): readonly DraftBy<'worker'>[] {
  throw new Error('not implemented')
  // TODO reports for a run whose ticket view says ended are dropped (late duplicates after reconcile)
  // TODO 'ended' id = idOf(run.ended for run): exactly one per run, so a crash-then-reconcile double report collapses
}

/**
 * Reactions: deciders keyed on one stored event, run by service.ts for every new event in tail
 * order. Idempotent by construction (their drafts cite the event, so ids repeat).
 *   run.ended done     -> silent ticket: ticket.revealed + reply(result); visible: reply(result);
 *                         ticket.closed completed when follows are done (PR merged arrives as trigger)
 *   run.ended parked   -> gate.opened (+ reply 'gate' to requester channel when audience is requester)
 *   run.ended failed   -> retryable & attempts left & mandate valid -> run.intended(n+1); else gate to operator
 *                         silent ticket failing -> ticket.closed discarded (stay quiet, drop held replies)
 *   gate.answered      -> continuation next-attempt -> run.intended(n+1, answer in brief); resume -> run.intended(same run, raise)
 *   policy.set         -> input.routed(policy-changed note) to open tickets; open Evals -> decided unavailable
 *   watchdog.judged stuck|drifting -> stop.intended + gate to operator
 *   env.seen online    -> nothing: held runs leave `held` in effectsView by fold alone
 *   input.routed while no run is live and ticket open -> run.intended(n+1)
 */
export function react(read: Reader, e: Event): readonly Draft[] {
  throw new Error('not implemented')
}

/** Human commands from the panel. requestId makes repeated clicks one event. */
export function answerGate(read: Reader, gate: GateId, answer: string, requestId: string, by: string): readonly Draft[] {
  throw new Error('not implemented')
}
export function setPolicy(read: Reader, settings: unknown, requestId: string): readonly Draft[] {
  throw new Error('not implemented')
  // TODO parse settings with zod at this boundary; version = hash('policy-v1', canonical settings)
}
