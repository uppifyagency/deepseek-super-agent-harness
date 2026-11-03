// store.ts: the ONLY owner of harness state (one SQLite file, WAL). Every write is one method,
// one transaction, idempotent by content id. Tables are private to this file:
//   triggers, thread_owner(thread, ticket, mode own|context), tickets, attempts, gates, decisions,
//   notes, outbox(intent, thread, text, status), stops(ticket, reason), meta(heartbeat, cursors, mode)
// The watchdog process writes only `watchdog_verdicts` through openWatchdogWriter (watchdog.ts).

import type {
  Applied, AttemptId, AttemptSpec, BatchId, Card, Decision, Gate, GateId, Intake, IntentId,
  Mandate, Mode, ReplyDraft, ReplyText, RouterPack, RunEnded, ThreadKey, TicketId, TicketStage, Trigger,
} from './domain'

export interface Store {
  // ----- intake (supervisor poll loop) -----
  cursor(source: 'github'): { since: string; advance(to: string): void }
  /** Dedupe, code filter (config + mode), pass-through to the owning ticket, else pending. */
  intake(t: Trigger): Intake

  // ----- scheduling (pure reads) -----
  /** All pending triggers as one batch, or null if none pending or a router run is live. Marks the batch live. */
  nextRouterBatch(): RouterPack | null
  /** Queued attempts whose mandate still holds (mayStart), up to `free` slots; answered gates first. */
  runnableAttempts(free: number): AttemptSpec[]
  markStarted(run: AttemptId | BatchId): void

  // ----- outcomes (the only entry for model output) -----
  /**
   * One transaction. router-batch: applyDecision per item, notes, replies through composeReply into
   * the outbox, triggers leave `pending`; a replayed batch id is a no-op (first result wins).
   * router-batch-failed: batch released, its triggers stay pending, so the next tick reruns them.
   * ticket-attempt: outcome row; done -> ticket closed(done) + result card for the next batch;
   * parked -> gate row (+ macOS notification intent); failed retryable -> attempt n+1 queued once.
   */
  applyRunEnded(e: RunEnded): void

  // ----- outbox (save then do) -----
  pendingReplies(): { intent: IntentId; thread: ThreadKey; text: ReplyText }[]
  settleReply(intent: IntentId, status: 'sent' | 'gone'): void

  // ----- Vlad (CLI or a GitHub reply routed by intake) -----
  attention(): { gate: Gate; ticket: TicketId; card: Card }[]
  answer(gate: GateId, text: string): void          // queues attempt n+1 with the answer in its brief
  stop(ticket: TicketId, reason: string): void      // durable: re-read by the supervisor until the run ends
  pendingStops(): { ticket: TicketId; attempt?: AttemptId }[]
  setMode(mode: Mode): void
  status(): { open: { ticket: TicketId; stage: TicketStage; line: string }[]; wouldAccept: Card[]; spentUsd: number }

  // ----- Chain of Recall -----
  recall(id: string): Card | undefined

  // ----- crash recovery and liveness -----
  /** Runs the store believes are live. Used once at boot by reconcile(). */
  liveRuns(): { batches: BatchId[]; attempts: AttemptSpec[] }
  heartbeat(): void
  watchdogVerdicts(sinceSeq: number): { attempt: AttemptId; verdict: 'stuck' | 'drifting'; evidence: string; seq: number }[]
}

export function openStore(path: string): Store {
  throw new Error('not implemented')
  // node:sqlite DatabaseSync, PRAGMA journal_mode=WAL, synchronous=FULL; every method = BEGIN IMMEDIATE ... COMMIT
}

// ---------- pure policy, exported for tests only via store.test.ts ----------

/**
 * Observe mode and the dsh backstops, in one place.
 *   inferred accept + mode !== 'auto'      -> would-accept (observe) or refused (off)
 *   stop on an inferred trigger            -> refused stop-not-explicit
 *   route/stop on an unknown/closed ticket -> refused unknown-ticket
 */
export function applyDecision(d: Decision, t: Trigger, mode: Mode, open: ReadonlySet<TicketId>, policyVersion: string): Applied {
  throw new Error('not implemented')
}

/**
 * Revalidation happens at every run boundary, which in this design is every attempt.
 * False when: mode went to 'off', the repo left config, an inferred mandate's rules were disabled,
 * or a stop is pending. A refused start closes the ticket and opens an operator gate.
 */
export function mayStart(m: Mandate, mode: Mode, enabledRules: ReadonlySet<string>, repoListed: boolean): boolean {
  throw new Error('not implemented')
}

/**
 * GitHub norms: structured, links to PR/SHA/evidence, <= 600 words. Silent tickets: no reply
 * until a passing verdict. Every reply carries `<!-- harness:intent=<IntentId> -->` so a resend finds itself.
 */
export function composeReply(r: ReplyDraft, silent: boolean): { ok: true; text: ReplyText } | { ok: false; problem: string } {
  throw new Error('not implemented')
}
