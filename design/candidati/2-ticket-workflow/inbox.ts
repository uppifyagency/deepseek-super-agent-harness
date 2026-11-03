// inbox.ts: the one door from the service into a running Ticket workflow.
//
// Atomic 0.9.63 has no API to push a message into a run and no RPC to answer a gate
// (ground-atomic.md section 4). What it does have: `ctx.ui.*` answers come from a
// host-supplied adapter, and are durably cached by a key built from the prompt text,
// the author callsite and a per-key ordinal (durable/ui-primitive.ts:71-90).
// So a "park" is `ctx.ui.input(parkMessage)`; this module's Bridge is the adapter, and
// it settles the promise when the Ticket's Inbox has something past `after`.
// The cached answer IS the delivery record: replay re-delivers the same batch.
//
// Gates are not a separate mechanism. A question to a human = report({kind:"question"})
// (an outbox reply) followed by an ordinary park. The answer arrives as a Trigger.

import type { TicketId, InboxSeq, TriggerRef, TriggerId, Ticket, TicketEnd } from "./domain";
import type { WorkflowUIAdapter as AtomicWorkflowUIAdapter } from "@bastani/atomic/workflows";
import type { HostInput as AtomicHostInput } from "@bastani/atomic";

// ---------- what can wake a parked Ticket ----------------------------------

export type InboxItem =
  | { readonly seq: InboxSeq; readonly kind: "trigger"; readonly ref: TriggerRef; readonly role: "owner" | "context" }
  | { readonly seq: InboxSeq; readonly kind: "thread-closed"; readonly thread: string; readonly outcome: "merged" | "closed" }
  | { readonly seq: InboxSeq; readonly kind: "policy-changed"; readonly to: string }
  | { readonly seq: InboxSeq; readonly kind: "environment-online"; readonly env: string }
  | { readonly seq: InboxSeq; readonly kind: "router-note"; readonly text: string };   // Router relaying cross-task info

/** Why the run is parked. Part of the park prompt text, so the journal itself says why. */
export type WaitingFor = "human" | "events" | "environment";

/** Encoded into the `ctx.ui.input` prompt string. Must be a pure function of cached values. */
export interface ParkRequest {
  readonly v: 1;
  readonly ticket: TicketId;
  readonly n: number;                 // park ordinal in this run, from the body loop counter
  readonly after: InboxSeq;           // highest seq already consumed (from the previous answer)
  readonly waitingFor: WaitingFor;
  readonly question?: string;         // shown on the panel; the reply already went out
}

/** The JSON string returned to `ctx.ui.input`. Journaled verbatim, so refs only (Inline & Spill). */
export type ParkAnswer =
  | { readonly v: 1; readonly kind: "items"; readonly through: InboxSeq; readonly items: readonly InboxItem[] }
  | { readonly v: 1; readonly kind: "revoked"; readonly through: InboxSeq }                 // Policy.revalidate failed at wake
  | { readonly v: 1; readonly kind: "closed"; readonly through: InboxSeq; readonly outcome: TicketEnd };

export const PARK_PREFIX = "superagent.park:";
export function encodePark(r: ParkRequest): string { return PARK_PREFIX + JSON.stringify(r); }
export function decodePark(prompt: string): ParkRequest | undefined { throw new Error("not implemented"); }

// ---------- the Inbox (service-owned table) --------------------------------

/**
 * Per-Ticket append-only queue in service.sqlite. Single writer: the service transaction
 * that routes a Trigger (pass-through) or records a policy/env/thread event.
 * Consumption is NOT stored here: the journal's park answers are the consumption log.
 * `consumedThrough(ticket)` is derived by reading the latest park answer from the journal
 * (engine.ticketView). This avoids a second copy that could disagree after a crash.
 */
export interface Inbox {
  /** Inside the caller's service transaction. Idempotent on (ticket, item identity). */
  append(ticket: TicketId, item: Omit<InboxItem, "seq">): InboxSeq;
  /** Items with seq > after, oldest first. Used by the Bridge and by the worker's inbox_peek tool. */
  since(ticket: TicketId, after: InboxSeq): readonly InboxItem[];
  /** Resolves on the next append for this ticket. In-memory wakeup only; durability is the table. */
  onAppend(ticket: TicketId, fn: () => void): () => void;
}

// ---------- the Bridge: Atomic adapter backed by the Inbox ------------------

/**
 * Implements both host-input shapes Atomic uses, so one object serves runs started by
 * `run()` and runs adopted after a crash by `session.workflows.resume()`:
 *  - `WorkflowUIAdapter` (authoring-contract-ui.ts:85-91) passed as `RunOpts.ui` on start.
 *    No run id in the call, so `forRun(ticket)` closes over it.
 *  - `HostInput` (coding-agent core/extensions/host-input.ts:27-33) bound on the engine
 *    session via `session.bindExtensions({ humanInput })`. Calls carry
 *    `options.workflowRunId`, which equals the TicketId by construction.
 *
 * Every non-park prompt is a bug in a workflow body (TicketCtx makes it unreachable).
 * The Bridge answers it with `undefined` (HostInput) so the gate stays pending, and
 * raises a health error. Never approval by default (sdk.md:281-295).
 */
export interface Bridge {
  forRun(ticket: TicketId): AtomicWorkflowUIAdapter;
  readonly hostInput: AtomicHostInput;
}

export interface BridgeDeps {
  readonly inbox: Inbox;
  readonly ticket: (id: TicketId) => Ticket | undefined;
  readonly revalidate: (t: Ticket) => boolean;
  readonly closedOutcome: (t: Ticket) => TicketEnd | undefined;    // all owned threads closed?
}

export function createBridge(deps: BridgeDeps): Bridge {
  // TODO input(prompt, opts):
  //   req = decodePark(prompt); if !req -> health error, return pending-forever / undefined
  //   wait loop (honour opts.signal: on abort just return; Atomic keeps the gate pending):
  //     t = deps.ticket(req.ticket)
  //     if !deps.revalidate(t)          -> resolve {kind:"revoked", through: latestSeq}
  //     if deps.closedOutcome(t)        -> resolve {kind:"closed", ...}
  //     items = inbox.since(req.ticket, req.after)
  //     if items.length > 0             -> resolve {kind:"items", through: max seq, items}
  //     await inbox.onAppend(req.ticket)
  //   Batching falls out: everything appended while the worker was busy arrives as one batch
  //   (article 2.1 batching, applied per Ticket instead of per Router turn).
  throw new Error("not implemented");
}

/** Full text for a ref. Exposed to worker stages as the read_trigger custom tool. */
export type ReadTrigger = (id: TriggerId) => { readonly text: string; readonly neighbours: readonly TriggerRef[] };
