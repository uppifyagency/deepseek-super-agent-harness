// edges.ts: the boundary. Sources in, channels out, endpoints, and the public Harness surface.
// External data is parsed into domain types here and nowhere else (boundary-discipline).
// This file is the package index: nothing else is importable from outside.

import type { ChannelRef, EndpointId, Environment, GateId, PersonRef, Thread, ThreadKey, Trigger, TurnId, WorkerId } from "./domain";
import type { Inspection, IntakeOutcome } from "./postbox";
import type { Settings } from "./policy";

// ---------- Sources (ported from dsh sources/kind.ts, minus Cordis and the DSH Agent hook) ----------

export interface Source<C = unknown> {
  kind: string;                            // "github" | "feishu" | ...
  start(ctx: SourceContext, config: C, signal: AbortSignal): Promise<void>;
  /** Must be idempotent by message id (GitHub hidden marker, Feishu idempotency key). */
  send(channel: ChannelRef, message: { id: string; text: string }): Promise<"sent" | "gone">;
}

/** Everything a source may do. No mailbox, routing or actor concepts leak here. */
export interface SourceContext {
  intake(trigger: Trigger): IntakeOutcome;
  thread(key: ThreadKey): Thread | undefined;
  patchThread(key: ThreadKey, patch: Partial<Pick<Thread, "closed" | "meta">>): void;
  state: { get(key: string): string | undefined; set(key: string, value: string): void }; // cursors
  health(status: "ok" | { error: string }): void;
}

// ---------- Endpoints (stateless daemons near the environments) ----------

/**
 * The daemon keeps no session state. It holds credentials and runs commands on behalf of the
 * harness: git push / gh pr create go through capability shims that call back to the daemon, so
 * tokens never enter the model's context (article 8.4). `exec` rejects with EndpointLost when offline.
 */
export interface EndpointPort {
  ensureEnv(worker: WorkerId, req: { repo: string; base: string; endpoint?: EndpointId }): Promise<Environment>;
  exec(env: Environment, argv: readonly string[], opts: { timeoutMs: number; signal?: AbortSignal; stdin?: string }):
    Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readTurnBuffer(env: Environment, turn: TurnId): Promise<unknown>; // parsed by actors.ts (zod)
  headSha(env: Environment): Promise<string>;
  release(env: Environment): Promise<void>;                         // worktree cleanup (Atomic never does it)
  heartbeats(signal: AbortSignal): AsyncIterable<{ endpoint: EndpointId; online: boolean }>;
}

// ---------- The public surface ----------

export interface HarnessConfig {
  db: string;
  journal: string;
  settings: Settings;
  sources: readonly Source[];
  endpoints: readonly EndpointPort[];
  slots: { workers: number; humanReserve: number };
  router: { model: string };
}

/** Seven methods. Everything else (mailboxes, turns, effects, engines) is behind this. */
export interface Harness {
  run(signal: AbortSignal): Promise<void>;           // scheduler + effect queue + sources + heartbeats
  answer(gate: GateId, answer: { text: string; by: PersonRef }): void;
  stopWorker(worker: WorkerId, reason: string): void;
  nudge(to: "router" | WorkerId, text: string, from: "watchdog" | "operator"): void;
  stopTurn(turn: TurnId): void;                      // Watchdog: abort a stuck turn (abandon -> retry)
  setSettings(settings: Settings): void;             // new policy version; posts policy.changed letters
  inspect(): Inspection;                             // panel and Watchdog read model
}

export async function openHarness(config: HarnessConfig): Promise<Harness> {
  // TODO: parse settings (zod) -> settingsPolicy -> openPostbox(db, policy)
  //       engines: routerEngine(config.router), workerEngine({ endpoint, journal })
  //       effect handlers (dsh effects.ts port; Later = retry without counting a failure):
  //         reply      -> source.send, settle outbox receipt (dsh outbox.ts)
  //         op.start   -> opRunner.start      op.stop -> opRunner.stop (durable stop, dsh trap 14)
  //         env.ensure -> endpoint.ensureEnv, then postbox.post env letter
  //         env.release-> endpoint.release
  //       panel HTTP routes call the same seven methods; nothing else.
  throw new Error("not implemented");
}
