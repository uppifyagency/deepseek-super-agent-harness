// postbox.ts: the one owner of durable actor state.
// Owns: mailboxes, routing table, worker records (charters), turns, gates, ops, environments,
// verdict ledger, and the effect queue rows (outbox, op start/stop, env provisioning).
// Everything is one SQLite file; every public method is one transaction (dsh Store.atomic port).
// Callers never see tables. Internals (sql, row codecs) are not exported.

import type {
  ActorId, Admission, EndpointId, EnvId, Environment, Gate, GateId, OpId, PersonRef, RouterLetter, Subscription, ThreadKey, Trigger, TriggerId,
  Turn, TurnId, TurnOutput, VerdictId, WorkerId, WorkerLetter, WorkerRecord,
} from "./domain";
import type { Policy } from "./policy";

export type IntakeOutcome =
  | { kind: "duplicate" }
  | { kind: "dropped"; reason: string }
  | { kind: "routed"; to: readonly WorkerId[] }
  | { kind: "router" };

/** System-originated letters (not from an actor's commands). Cause makes the LetterId, so posting twice is a no-op. */
export type SystemPost =
  | { to: WorkerId; cause: OpId; letter: Extract<WorkerLetter, { kind: "op.finished" }> }
  | { to: WorkerId; cause: string; letter: Extract<WorkerLetter, { kind: "env" | "policy.changed" | "gate.answered" | "nudge" }> }
  | { to: "router"; cause: string; letter: Extract<RouterLetter, { kind: "nudge" }> };

export interface CommitResult { applied: number; rejected: readonly { command: number; reason: string }[] }

/** Read model for the panel and the Watchdog. Derived on read; never stored. */
export interface Inspection {
  router: { unread: number; openTurn?: { id: TurnId; ageMs: number } };
  workers: readonly {
    id: WorkerId; title: string; stage: WorkerStage; unread: number; turns: number; spentUsd: number;
    openTurn?: { id: TurnId; ageMs: number }; lastReport?: string; env?: Environment; gates: readonly Gate[];
  }[];
}

/** Derived, first matching row wins (dsh stage.ts idea, rebuilt on actor facts). */
export type WorkerStage =
  | { stage: "ended" }
  | { stage: "person"; gate: GateId }               // open gate
  | { stage: "waiting-env"; env: EnvId }            // env offline: not runnable
  | { stage: "waiting-op"; ops: readonly OpId[] }   // idle, ops in flight
  | { stage: "working" }                            // open turn
  | { stage: "queued" }                             // waking letters, no slot yet
  | { stage: "idle" };

export interface Postbox {
  /**
   * Fast path + routing, one txn. Dedupe by trigger id; Policy.admit per trigger (pure);
   * look up owner/context subscribers of every thread in trigger.threads;
   * owners -> waking trigger letter; context -> non-waking; Router -> `seen` (non-waking) if any owner,
   * else waking trigger letter. Admission is stored on the letter so the Router cannot invent authority.
   */
  intake(trigger: Trigger): IntakeOutcome;

  /** Letters from the outside world: op completions, env status, panel answers, Watchdog nudges. */
  post(p: SystemPost): void;

  /**
   * Pick one runnable actor and open its turn with a fixed batch (all unread letters, waking or not).
   * Runnable = has a waking unread letter, no open turn, not ended, env online (workers), mandate
   * still valid (else: end as revoked, notify Router, return the next one), worker slot available.
   * Human-woken workers may use the reserved slot (dsh dsh.ts:192-196, made explicit).
   * Workers are provisioned lazily here: no env row yet -> enqueue env.ensure effect, not runnable.
   */
  claim(): Turn | undefined;

  /**
   * Close a turn, one txn: validate each command against actor kind, charter and policy (pure,
   * policy.check); apply valid ones; turn each rejection into a `rejected` letter to the same actor;
   * mark the batch read; store carry and spend; enqueue effects (replies, op start/stop, env cleanup).
   * Idempotent on turn id: a second commit of the same turn returns the first result.
   */
  commit<A extends ActorId>(turn: Turn<A>, output: TurnOutput<A>): CommitResult;

  /** Engine gave up (crash without resumable progress, endpoint lost): batch goes back unread, attempt + 1. */
  abandon(turn: TurnId, reason: string): void;

  /** Record the engine run id for an open turn, so restart can resume it instead of re-running. */
  attach(turn: TurnId, engineRun: string): void;

  /** Open turns left by a previous process. The scheduler resumes these before claiming new ones. */
  orphans(): readonly Turn[];

  /** Ledger write; the only way to mint a VerdictId. Keyed (repo, sha), last write per key wins. */
  recordVerdict(v: { worker: WorkerId; repo: string; sha: string; pass: boolean; evidence: string; verifier: string }): VerdictId;

  /** Endpoint daemon heartbeat. Status flips post `env` letters to every worker bound to that endpoint. */
  endpointSeen(endpoint: EndpointId, online: boolean): void;

  /** Panel or Watchdog: resolve a gate by a person; posts gate.answered to the owning worker. */
  answer(gate: GateId, answer: string, by: PersonRef): void;

  /** Panel or Watchdog: durable stop of a worker (ends it, cancels its ops via effects). */
  stopWorker(worker: WorkerId, reason: string): void;

  /** Chain of Recall: rendered object with inline previews and next-hop ids. Read-only. */
  recall(ref: RecallRef): Recalled;

  inspect(): Inspection;
}

export type RecallRef =
  | { kind: "trigger"; id: TriggerId }
  | { kind: "thread"; key: ThreadKey }
  | { kind: "worker"; id: WorkerId }
  | { kind: "gate"; id: GateId };

/** Inline & Spill result: a bounded body plus ids the model can follow. */
export interface Recalled { title: string; body: string; spilled: boolean; next: readonly RecallRef[] }

export function openPostbox(path: string, policy: Policy): Postbox {
  // TODO: node:sqlite, WAL, synchronous=FULL (dsh store.ts:64). Tables:
  //   trigger(id, value) | thread(key, value)
  //   subscription(thread, worker, role, PRIMARY KEY(thread, worker))   <- the routing table
  //   worker(id, charter, ended, carry, turns, spent_usd)
  //   letter(id PRIMARY KEY, actor, seq, wakes, human, value, read_turn NULL)
  //   turn(id, actor, n, batch_first_seq, batch_last_seq, attempt, engine_run, closed)
  //     + UNIQUE INDEX one_open_turn ON turn(actor) WHERE closed = 0
  //   gate(id, worker, value) | op(id, worker, spec, state, result) | env(id, worker, endpoint, value)
  //   verdict(repo, sha, value, PRIMARY KEY(repo, sha))
  //   effect(kind, key, value, seq, generation, attempts, due)   <- dsh effects.ts, as-is
  //   outbox(id, value)                                            <- dsh outbox receipts, as-is
  throw new Error("not implemented");
}

/** Pure. Shared by claim() and inspect() so "runnable" and "stage" can never disagree. */
export function workerStage(
  w: WorkerRecord,
  facts: { openGate?: GateId; env?: Environment; openTurn: boolean; wakingUnread: boolean; opsInFlight: readonly OpId[] },
): WorkerStage {
  // TODO: ended -> person(gate) -> waiting-env (env offline or provisioning) -> working (open turn)
  //       -> queued (waking unread) -> waiting-op -> idle
  throw new Error("not implemented");
}

// ---------- internal, not exported from the package index ----------

/** Pure routing decision for intake. Subscriptions in, deliveries out. */
function route(trigger: Trigger, admission: Admission, subs: readonly Subscription[]): readonly { to: ActorId; wakes: boolean; role?: "owner" | "context" }[] {
  // TODO: if !admission.pass -> [] (dropped, disposition recorded only)
  //       owners = subs.filter(owner); ctx = subs.filter(context)
  //       owners.length ? [...owners wakes, ...ctx no-wake, router `seen` no-wake]
  //                     : [...ctx no-wake, router trigger wakes]
  throw new Error("not implemented");
}
