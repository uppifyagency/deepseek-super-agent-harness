// service.ts: composition root and the public surface. Ported service layer from dsh
// (core/intake, evals, tickets-minus-execution, replies; app/store, effects, outbox).
// Synchronous transactional core + after-commit effects, exactly as dsh (effects.ts:61-88).

import type {
  Trigger, TicketId, Ticket, Decision, Eval, OpKey, Reason, OutboundReply, Policy, ThreadKey,
} from "./domain";
import type { Inbox } from "./inbox";
import type { Engine, TicketView } from "./engine";
import type { TicketReport, ServicePort } from "./ticket-workflow";

export type ReceiveResult =
  | { readonly kind: "duplicate" }
  | { readonly kind: "filtered"; readonly reason: Reason }
  | { readonly kind: "queued"; readonly thread: ThreadKey }                     // waits for an Eval
  | { readonly kind: "delivered"; readonly tickets: readonly TicketId[] };     // pass-through to Inboxes

export interface Harness {
  /** Source entry point. One service transaction: dedupe, route(), append to Inboxes or Thread.pending. */
  receive(t: Trigger): ReceiveResult;
  ticketView(id: TicketId): Promise<TicketView>;
  openTicketViews(): Promise<readonly (TicketView & { silentForMs?: number })[]>;
  /** Idempotent; also the Watchdog's repair verb. */
  ensureRunning(id: TicketId): Promise<void>;
  stop(): Promise<void>;
}

export interface HarnessConfig { readonly stateDir: string; readonly repoRoot: string; readonly settings: unknown }
export function startHarness(cfg: HarnessConfig): Promise<Harness> {
  // TODO boot order matters:
  //  1 open service.sqlite (store, effects, outbox, inbox)
  //  2 bridge = createBridge({ inbox, ticket, revalidate: policy.revalidate, closedOutcome })
  //  3 install ServicePort on globalThis[Symbol.for("superagent/port@1")]   (before any run can replay a ctx.tool)
  //  4 engine = await createEngine({ engineCwd, journalPath, bridge, ... })
  //  5 engine.recoverAll(open tickets)      6 effects.start()      7 sources.start()
  throw new Error("not implemented");
}

// ---------- Router: the Eval loop (slow filter) --------------------------------

/**
 * The Router never executes and has no tools. Its LLM call is an Atomic stage in a
 * throwaway run: run(assessV1, { card }, { journal: { memory: true } }) with
 * `noTools: "all"` and a typebox Assessment schema. Durability of an Eval is the
 * service's: Eval row + deadline -> `unavailable` + requeue (dsh evals.ts), not the journal.
 */
export interface Router {
  /** Effect `assess`: build the candidate card from refs (Inline & Spill), call the assessor, then decide(). */
  assess(e: Eval): Promise<void>;
  /** One transaction. accept -> createTicket. observe -> ignore + wouldAccept. stop -> effect quit. */
  decide(e: Eval, outcome: AssessmentOutcome): Decision;
}

export type AssessmentOutcome =
  | { readonly kind: "ignore"; readonly reason: Reason }
  | { readonly kind: "unavailable"; readonly reason: Reason }
  | { readonly kind: "accept"; readonly title: string; readonly goal: string; readonly acceptance: readonly string[]; readonly ack?: string; readonly silent: boolean }
  | { readonly kind: "stop"; readonly ticket: TicketId; readonly reason: Reason };

/**
 * Inside decide(accept), one transaction:
 *   Ticket row (id = key('ticket', evalId) as UUID) + subscribe every thread of the batch as owner
 *   + ack reply (skipped when silent) + effect ensureRun(ticketId).
 * Crash before commit: nothing happened. Crash after commit: the effect retries ensureRunning,
 * which is idempotent on runId. No window where a run exists without its Ticket row.
 */
export function createTicket(e: Eval, o: Extract<AssessmentOutcome, { kind: "accept" }>, p: Policy): Ticket {
  throw new Error("not implemented");
}

// ---------- reports in, replies out --------------------------------------------

/**
 * ServicePort.report. Dedupe on OpKey (table op(key) INSERT OR IGNORE, same txn as effects).
 *   started  -> nothing outward (silence is the default; article 4.2)
 *   question -> reply(purpose "question") to the Ticket's home channel
 *   done     -> reply(purpose "result"), GitHub: structured sections with verification evidence
 *               (verdict, sha, commands); IM: <= 100 words + PR link
 *   failed   -> reply(purpose "result") with evidence refs
 *   ended    -> Ticket.ended, unsubscribe all threads, effect cleanup (worktree), letGo
 *               untaken human triggers back to Eval (dsh tickets.ts:294-309)
 * Silent Tickets: only `done` produces a reply; `ended: discarded` produces nothing.
 */
export function onReport(ticket: Ticket, op: OpKey, r: TicketReport): readonly OutboundReply[] {
  throw new Error("not implemented");
}

/** Per-channel rendering. IM over cap -> one compress call through the Router assessor, then hard cut. */
export function renderReply(ticket: Ticket, r: TicketReport): OutboundReply["body"] {
  throw new Error("not implemented");
}

export function servicePort(deps: { inbox: Inbox; engine: Engine }): ServicePort { throw new Error("not implemented"); }
