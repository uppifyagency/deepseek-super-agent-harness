// domain.ts: service-owned state. Only what Atomic's journal cannot hold.
// Pure types + pure functions. No I/O, no Atomic import.
// Ported from dsh src/core/model.ts with the execution layer removed
// (no Assignment, no Ticket.execution, no TicketInput.readAt, no stored stage).

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TriggerId = Brand<string, "TriggerId">;   // key(source-kind, native ids...)
export type ThreadKey = Brand<string, "ThreadKey">;   // `${source}:${id}`
export type EvalId = Brand<string, "EvalId">;         // key('eval', thread, sorted triggerIds, policyVersion), NO timestamp
export type TicketId = Brand<string, "TicketId">;     // UUID-shaped key('ticket', evalId). Also the Atomic runId.
export type InboxSeq = Brand<number, "InboxSeq">;     // per-Ticket monotone, assigned at append
export type OpKey = Brand<string, "OpKey">;           // `${ticketId}:${verb}:${attemptNo}[:${n}]`, idempotency for at-least-once tools
export type PolicyVersion = Brand<string, "PolicyVersion">;

/** Source-provided text. Never interpolated into a prompt without `preview()` or a read tool. */
export type Untrusted = Brand<string, "Untrusted">;

export interface ActorRef { readonly source: string; readonly id: string }
export interface ThreadRef { readonly source: string; readonly id: string }
export interface ChannelRef {
  readonly source: string;
  readonly thread: string;
  readonly address: Readonly<Record<string, string>>;
}

// ---------- Trigger: immutable event --------------------------------------

export interface Trigger {
  readonly id: TriggerId;
  readonly source: string;
  /** threads[0] is the primary thread: the one that hosts its Eval. */
  readonly threads: readonly [ThreadRef, ...ThreadRef[]];
  readonly actor: ActorRef;
  readonly human: boolean;                       // source-declared, trusted by Policy
  readonly addressed?: "mention" | "direct";     // source-declared
  readonly at: string;
  readonly text: Untrusted;
  readonly channel?: ChannelRef;
  readonly url?: string;
  readonly meta: Readonly<Record<string, unknown>>;  // source-native, core never reads
}

/** Inline & Spill: what enters any prompt. Full text only via read_trigger(id). */
export interface TriggerRef {
  readonly id: TriggerId;
  readonly thread: ThreadKey;
  readonly actor: ActorRef;
  readonly at: string;
  readonly preview: string;                      // first 50 chars, sanitized
  readonly spilled: boolean;
}

// ---------- Thread and subscription ---------------------------------------

/**
 * A subscription is an edge Thread -> Ticket. Many-to-many. Stored on the Thread
 * (single owner of the edge); Ticket.threads is derived by index, never written.
 * `owner`: the Ticket decides follow-ups (fast path, Router skipped).
 * `context`: the Ticket sees follow-ups but the Router still evaluates them.
 */
export type SubscriptionRole = "owner" | "context";

export interface Thread {
  readonly key: ThreadKey;
  readonly ref: ThreadRef;
  readonly subscribers: ReadonlyMap<TicketId, SubscriptionRole>;
  /** Triggers waiting for an Eval (no owner subscriber when they arrived). */
  readonly pending: readonly TriggerId[];
  /** At most one Eval in flight per Thread. */
  readonly evaluating?: EvalId;
  readonly correlated: readonly ThreadKey[];
  readonly meta: Readonly<Record<string, unknown>>;  // source-owned
}

/** Pure routing decision for one Trigger. The whole fast path. */
export type Route =
  | { readonly kind: "filtered"; readonly reason: Reason }
  | { readonly kind: "pass-through"; readonly to: readonly { ticket: TicketId; role: SubscriptionRole }[]; readonly alsoEval: boolean }
  | { readonly kind: "eval"; readonly thread: ThreadKey };

export function route(t: Trigger, threads: readonly Thread[], scope: ScopeResult): Route {
  // TODO: scope.listened false -> filtered
  //       collect subscribers over all threads (dedupe by ticket, owner beats context)
  //       any owner -> pass-through, alsoEval = false
  //       only context -> pass-through + alsoEval = true (Router still sees it)
  //       none -> eval on threads[0]
  throw new Error("not implemented");
}

// ---------- Policy, Mandate, accept mode ----------------------------------

export type AcceptMode = "off" | "observe" | "auto";
export type Strength = "explicit" | "inferred";
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string };

/** Ported verbatim from dsh model.ts:147-153 (legacy `listed` dropped). */
export type MandateBasis = { source?: string; row?: string; sender?: string; rules?: readonly string[] } & (
  | { via: "addressed"; addressed: "mention" | "direct" }
  | { via: "followup"; authority?: string }
  | { via: "admission"; cell: "listedUnaddressed" | "unlistedAddressed" | "unlistedUnaddressed"; observation?: { mode: AcceptMode } }
  | { via: "bot"; observation: { mode: AcceptMode } }
);

/**
 * Immutable record of what is authorized and why. Revalidated by the Ticket workflow
 * at every wake from park (not only on resume, unlike dsh tickets.ts:257).
 * `delivery: "silent"` is speculative execution: no ack, no question, deliver only a
 * verified result, otherwise discard without a word (article 3.4).
 */
export interface Mandate {
  readonly strength: Strength;
  readonly policyVersion: PolicyVersion;
  readonly basis: MandateBasis;
  readonly actor: ActorRef;
  readonly scope: string;                 // advisory prompt text
  readonly delivery: "announce" | "silent";
  /** What the run may do without asking. Everything else in PauseAction needs a gate. */
  readonly autonomy: readonly ("open-pr" | "push-branch" | "comment")[];
}

export type PauseAction = "merge" | "force-push" | "deploy" | "delete-data" | "message-outsider";

export interface Policy {
  readonly version: PolicyVersion;
  readonly paused: boolean;
  readonly mode: AcceptMode;
  /** Fast filter. Pure. dsh policy.ts:167-242. */
  gate(t: Trigger, thread: Thread): { admissible: false; reason: string } | { admissible: true; strength: Strength; basis: MandateBasis };
  revalidate(m: Mandate): boolean;
  admitsInferred(rules: readonly string[]): boolean;
  readonly budgetFor: (m: Mandate) => AttemptBudget;
}

/** Per-attempt cap. Becomes the Atomic child workflow `budget` (budget.ts:12-17). */
export interface AttemptBudget { readonly maxCostUsd: number; readonly maxDurationMs: number; readonly maxTokens: number }

// ---------- Eval and Decision (slow filter) --------------------------------

export interface Eval {
  readonly id: EvalId;
  readonly thread: ThreadKey;
  readonly triggers: readonly TriggerId[];      // the batch (article 2.1)
  readonly primary: TriggerId;
  readonly strength: Strength;
  readonly basis: MandateBasis;
  readonly policyVersion: PolicyVersion;
  readonly deadlineAt: string;
}

export type Decision =
  | { readonly kind: "ignore"; readonly evalId: EvalId; readonly reason: Reason; readonly wouldAccept?: Proposal }
  | { readonly kind: "unavailable"; readonly evalId: EvalId; readonly reason: Reason }           // triggers requeued
  | { readonly kind: "accept"; readonly evalId: EvalId; readonly ticket: TicketId; readonly mandate: Mandate; readonly proposal: Proposal; readonly ack?: string }
  | { readonly kind: "stop"; readonly evalId: EvalId; readonly ticket: TicketId; readonly reason: Reason };

export interface Proposal { readonly title: string; readonly goal: string; readonly acceptance: readonly string[] }
export interface Reason { readonly code: string; readonly values?: Readonly<Record<string, string>> }

// ---------- Ticket: identity only ------------------------------------------

/**
 * Ticket = service-side identity of one Atomic run. No status, no stage, no attempt,
 * no attention: those are journal facts read through engine.ticketView().
 * `ended` is set exactly once, by the service, when the run's terminal TicketEnd
 * report lands (or when a quit is confirmed). It is a cache of the journal for indexes;
 * the journal wins on disagreement.
 */
export interface Ticket {
  readonly id: TicketId;
  readonly decision: EvalId;
  readonly title: string;
  readonly mandate: Mandate;
  readonly channels: readonly ChannelRef[];      // where to reply; first is home
  readonly origin: TriggerId;
  readonly workflow: TicketWorkflowName;         // pinned version, e.g. "ticket-v1" (= .atomic/workflows/ticket-v1.ts)
  readonly ended?: { readonly at: string; readonly end: TicketEnd };
}

export type TicketWorkflowName = `ticket-v${number}`;
export type TicketEnd = "merged" | "closed" | "completed" | "stopped" | "revoked" | "discarded" | "failed";

// ---------- Outbound: replies, effects -------------------------------------

/** Per-channel norms are a type, not a prompt line. IM text is capped at the boundary. */
export type ReplyBody =
  | { readonly channel: "im"; readonly text: ImText }          // <= 100 words, Intl.Segmenter count
  | { readonly channel: "github"; readonly sections: readonly { heading: string; body: string }[] };
export type ImText = Brand<string, "ImText">;
export function imText(raw: string): ImText | { tooLong: number } { throw new Error("not implemented"); }

export interface OutboundReply {
  readonly id: string;                           // key(purpose, ticket, opKey | triggerId)
  readonly ticket?: TicketId;
  readonly to: ChannelRef;
  readonly purpose: "ack" | "result" | "question" | "notice";
  readonly body: ReplyBody;
  readonly status: "pending" | "sent" | "dropped";
}

/** Service effect queue (dsh app/effects.ts). Only service-layer kinds survive the port. */
export type Effect =
  | { readonly kind: "assess"; readonly key: EvalId }
  | { readonly kind: "reply"; readonly key: string }              // outbox id
  | { readonly kind: "ensureRun"; readonly key: TicketId }        // start or resume, idempotent
  | { readonly kind: "quit"; readonly key: TicketId }             // durable stop, retried until journal terminal
  | { readonly kind: "cleanup"; readonly key: TicketId };         // remove worktree after end
