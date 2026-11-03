// domain.ts: every type the actors, the postbox and the policy share. No I/O.
// Invariant owners are named on each type. Ids are content-derived and replay-stable:
// none of them contains a timestamp (fixes dsh trap 4).

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TriggerId = Brand<string, "TriggerId">; // key(source, native id, version)
export type ThreadKey = Brand<string, "ThreadKey">; // `${source}:${id}`
export type WorkerId = Brand<string, "WorkerId">;   // key("worker", routerTurnId, spawnOrdinal)
export type ActorId = "router" | WorkerId;
export type LetterId = Brand<string, "LetterId">;   // key(to, cause); re-posting the same cause is a no-op
export type TurnId = Brand<string, "TurnId">;       // key(actor, n)
export type OpId = Brand<string, "OpId">;           // key(turnId, "op", ordinal)
export type GateId = Brand<string, "GateId">;       // key(turnId, "gate", ordinal)
export type VerdictId = Brand<string, "VerdictId">; // minted only by the verifier op handler (actors.ts)
export type EnvId = Brand<string, "EnvId">;         // key(workerId, "env")
export type EndpointId = Brand<string, "EndpointId">;
export type Sha = Brand<string, "Sha">;

export interface PersonRef { source: string; id: string }
export interface ChannelRef { source: string; thread: ThreadKey; address: Record<string, string> }

// ---------- Trigger and Thread (ported from dsh model.ts:23-39, 157-182, trimmed) ----------

/** Immutable. Parsed by a Source at the boundary; `text` is untrusted. */
export interface Trigger {
  id: TriggerId;
  source: string;
  threads: readonly ThreadKey[]; // [0] is primary
  actor: PersonRef;
  human: boolean;                // source-declared (dsh trap 12: the source adapter owns it)
  addressed?: "mention" | "direct";
  at: string;
  text: string;
  channel?: ChannelRef;
  url?: string;
  meta: Readonly<Record<string, unknown>>;
}

/** Only source-owned facts. Who listens to a thread lives in the routing table, not here. */
export interface Thread { key: ThreadKey; lastAt: string; closed?: "merged" | "closed"; meta: Record<string, unknown> }

/**
 * The routing table row. Many-to-many. Owned by postbox.ts; written only by committed commands.
 * owner: waking pass-through. context: non-waking copy (read-only follow).
 */
export interface Subscription { thread: ThreadKey; worker: WorkerId; role: "owner" | "context" }

// ---------- Authority ----------

export type Strength = "explicit" | "inferred";
export type AcceptMode = "off" | "observe" | "auto";

/** Fast-path result, computed once at intake and stored on the delivery. The LLM never writes it. */
export type Admission =
  | { pass: false; reason: string }
  | { pass: true; strength: Strength; basis: MandateBasis };

/** As dsh model.ts:147-153, minus the legacy `listed` variant. */
export type MandateBasis = { sender?: string; rules?: readonly string[] } & (
  | { via: "addressed"; addressed: "mention" | "direct" }
  | { via: "followup"; authority?: string }
  | { via: "admission"; cell: "listedUnaddressed" | "unlistedAddressed" | "unlistedUnaddressed"; mode: AcceptMode }
  | { via: "bot"; mode: AcceptMode }
);

/** Immutable. Minted by policy.mint from stored Admissions; revalidated at every Worker turn claim. */
export interface Mandate { strength: Strength; policyVersion: string; basis: MandateBasis; actor: PersonRef; scope: string }

// ---------- The Worker and its charter (= the Ticket) ----------

export type Delivery = "announced" | "speculative";

export interface EnvRequest { repo: string; base: string; endpoint?: EndpointId }

/** The Ticket. Written once at spawn; only `title`/`brief` can be amended by the Router. */
export interface Charter {
  worker: WorkerId;
  title: string;
  brief: string;                  // rendered into the pstack brief shape (GOAL..STANDING) by actors.ts
  mandate: Mandate;
  channels: readonly ChannelRef[]; // where the Router replies about this worker
  env: EnvRequest;
  delivery: Delivery;
  budget: { usdCap: number; turnMinutes: number };
  origin: readonly TriggerId[];
}

export type WorkerEnd =
  | { outcome: "done"; verdict: VerdictId }
  | { outcome: "failed" | "stopped" | "revoked" | "discarded"; reason: string };

/** Actor state the postbox owns. Everything else about a worker (stage, waiting-on) is derived. */
export interface WorkerRecord { charter: Charter; ended?: WorkerEnd; carry?: string; turns: number; spentUsd: number }

// ---------- Environments ----------

/** First-class. Status is written only by endpoint heartbeats (edges.ts) through the postbox. */
export interface Environment {
  id: EnvId;
  endpoint: EndpointId;
  repo: string;
  path: string;   // worktree path on the endpoint
  branch: string;
  status: "provisioning" | "online" | "offline";
}

// ---------- Async ops ----------

export type OpSpec =
  | { op: "verify"; sha: Sha | "HEAD"; pr?: number }        // independent verifier session
  | { op: "exec"; command: readonly string[]; timeoutMs: number }; // long command on the worker's env

export type OpResult =
  | { op: "verify"; verdict: VerdictId; pass: boolean; sha: Sha; evidence: string }
  | { op: "exec"; exitCode: number; tail: string }
  | { op: "stopped"; reason: string }
  | { op: "error"; error: string };

// ---------- Gates (human decisions) ----------

export type GateKind =
  | "question"     // the Worker asked
  | "irreversible" // the environment hook denied a pause-always action
  | "budget";      // the turn engine stopped on budget

export interface Gate {
  id: GateId;
  worker: WorkerId;
  kind: GateKind;
  question: string;
  options?: readonly string[];
  default?: string;
  resolution?: { answer: string; by: PersonRef | "default"; trigger?: TriggerId };
}

// ---------- Worker outcome ----------

/** "done" carries a verdict id; "blocked" always points at a gate. Blocked-on-environment is not a report: it is derived. */
export type WorkerReport =
  | { state: "progress"; summary: string }
  | { state: "done"; summary: string; verdict: VerdictId }
  | { state: "blocked"; summary: string; gate: GateId }
  | { state: "failed"; summary: string; evidence: readonly string[] };

// ---------- Letters (mailbox contents), per actor kind ----------

interface TriggerLetter { kind: "trigger"; trigger: TriggerId; admission: Admission }

export type RouterLetter =
  | TriggerLetter                                                   // no owner yet: waking
  | { kind: "seen"; trigger: TriggerId; deliveredTo: readonly WorkerId[] } // non-waking global view
  | { kind: "report"; from: WorkerId; report: WorkerReport }
  | { kind: "handback"; from: WorkerId; trigger: TriggerId; reason: string }
  | { kind: "gate.opened"; gate: GateId }                           // Router must ask the human
  | { kind: "ended"; worker: WorkerId; end: WorkerEnd }
  | { kind: "rejected"; turn: TurnId; command: number; reason: string }
  | { kind: "nudge"; from: "watchdog" | "operator"; text: string };

export type WorkerLetter =
  | (TriggerLetter & { role: "owner" | "context" })
  | { kind: "op.finished"; op: OpId; result: OpResult }
  | { kind: "gate.answered"; gate: GateId; answer: string; by: PersonRef | "default" }
  | { kind: "env"; env: EnvId; status: Environment["status"] }
  | { kind: "policy.changed"; from: string; to: string; summary: string }
  | { kind: "rejected"; turn: TurnId; command: number; reason: string }
  | { kind: "nudge"; from: "watchdog" | "operator" | "router"; text: string };

export type LetterFor<A extends ActorId> = A extends "router" ? RouterLetter : WorkerLetter;

/** One durable mailbox row. `wakes: false` letters ride along in the next batch but never start a turn. */
export interface Envelope<L> { id: LetterId; seq: number; wakes: boolean; human: boolean; letter: L }

// ---------- Commands (the only way an actor acts) ----------

export type RouterCommand =
  | { do: "spawn"; triggers: readonly TriggerId[]; title: string; brief: string; env: EnvRequest; delivery: Delivery; ack?: string }
  | { do: "route"; trigger: TriggerId; to: WorkerId; note?: string } // subscribe owner + deliver; reopens an ended worker
  | { do: "subscribe"; worker: WorkerId; thread: ThreadKey; role: "owner" | "context" }
  | { do: "stop"; worker: WorkerId; because: TriggerId }              // needs an explicit trigger
  | { do: "reply"; about: { trigger: TriggerId } | { worker: WorkerId } | { gate: GateId };
      purpose: "ack" | "answer" | "result" | "ask"; text: string }
  | { do: "ignore"; triggers: readonly TriggerId[]; reason: string }
  | { do: "nudge"; worker: WorkerId; text: string };

export type WorkerCommand =
  | { do: "start"; op: OpSpec }   // returns OpId at once (deterministic), applied at commit
  | { do: "stop"; op: OpId }
  | { do: "subscribe"; thread: ThreadKey }    // context role only; ownership is the Router's call
  | { do: "unsubscribe"; thread: ThreadKey }
  | { do: "handback"; trigger: TriggerId; reason: string }
  | { do: "ask"; question: string; options?: readonly string[]; default?: string }
  | { do: "resolve"; gate: GateId; answer: string; trigger: TriggerId }
  | { do: "report"; report: WorkerReport };

export type CommandFor<A extends ActorId> = A extends "router" ? RouterCommand : WorkerCommand;

/** What a turn engine returns. `carry` is the Worker's note to its own next turn (Router: unused). */
export interface TurnOutput<A extends ActorId> { commands: readonly CommandFor<A>[]; carry?: string; usd: number }

// ---------- Turns ----------

/** Opened by postbox.claim with a fixed batch; at most one open turn per actor (partial unique index). */
export interface Turn<A extends ActorId = ActorId> {
  id: TurnId;
  actor: A;
  n: number;
  batch: readonly Envelope<LetterFor<A>>[];
  attempt: number;           // engine run id = key(turn.id, attempt)
  engineRun?: string;        // Atomic runId while open; used for resume after crash
}
