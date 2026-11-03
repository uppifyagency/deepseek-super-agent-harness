// actors.ts: how a turn runs. The scheduler loop, the two turn engines, and the op runners.
// Engine-agnostic at one seam: TurnEngine. The Router engine is a direct LLM call (no shell).
// The Worker engine is an Atomic run whose body is one `claude -p` session on the worker's
// environment (pstack native, Claude Code hooks enforce pause-always). Verify ops are Atomic runs too.

import type {
  ActorId, Charter, Environment, OpId, OpSpec, Turn, TurnOutput, WorkerId,
} from "./domain";
import type { Postbox, Recalled, RecallRef } from "./postbox";
import type { EndpointPort } from "./edges";

/** The one engine seam. `run` must be safe to call again with the same turn after a crash. */
export interface TurnEngine<A extends ActorId> {
  run(turn: Turn<A>, ctx: TurnContext, signal: AbortSignal): Promise<EngineOutcome<A>>;
}

export interface TurnContext {
  /** Inline & Spill rendering of the batch, carry note and charter, within a token budget. */
  prompt: string;
  recall(ref: RecallRef): Recalled; // Router tool surface: read_trigger / read_thread / read_worker / read_gate
  charter?: Charter;
  env?: Environment;
  attach(engineRun: string): void;  // -> postbox.attach
}

/** Engine-neutral turn result. `fromAtomic` is the only place that knows Atomic's status quirks. */
export type EngineOutcome<A extends ActorId> =
  | { kind: "finished"; output: TurnOutput<A> }
  | { kind: "budget"; output: TurnOutput<A>; spentUsd: number } // commands so far + a budget gate
  | { kind: "env-lost" }                                        // endpoint went offline mid-turn
  | { kind: "failed"; error: string; retryable: boolean };

/**
 * Main loop. One process. Order per tick:
 *   1. resume orphans (open turns from a crashed process) through their engine,
 *   2. claim runnable actors up to slot limits and run their turns concurrently,
 *   3. commit or abandon each outcome.
 * Effects (replies, op start/stop, env.ensure) drain from the postbox effect queue elsewhere (edges.ts).
 */
export async function runScheduler(
  postbox: Postbox,
  engines: { router: TurnEngine<"router">; worker: TurnEngine<WorkerId> },
  signal: AbortSignal,
): Promise<void> {
  // TODO:
  // for (const t of postbox.orphans()) spawnTurn(t)               // engine resumes via t.engineRun
  // loop until signal: while ((t = postbox.claim())) spawnTurn(t); await wake (letter posted | turn done | 2 s)
  // spawnTurn(t):
  //   out = await engineFor(t.actor).run(t, buildContext(t), childSignal)
  //   finished -> postbox.commit(t, out.output)
  //   budget   -> postbox.commit(t, { ...out.output, commands: [...out.output.commands, budgetAsk] })
  //               where budgetAsk = { do: "ask", question: "Raise budget?", default: "no" } unless
  //               settings.budget.autoRaiseOnce applies (then a policy-owned raise, no human)
  //   env-lost -> postbox.abandon(t.id, "env-lost")  (env flips offline; the worker waits; no LLM retry)
  //   failed   -> retryable ? postbox.abandon(t.id, error) : postbox.commit(t, failedReport(error))
  throw new Error("not implemented");
}

/** Router engine: one LLM call with tool use limited to recall + buffered command tools. No Bash exists. */
export function routerEngine(llm: { model: string; system: string }): TurnEngine<"router"> {
  // TODO: Messages API loop. Tools: read_trigger/read_thread/read_worker/read_gate (-> ctx.recall),
  // and one `commands` tool whose input schema is RouterCommand[] (zod -> JSON schema).
  // Durability comes from the Turn row, not from an engine: a crash before commit re-runs the call
  // with the same fixed batch; ids are key(turn.id, ordinal) so nothing duplicates.
  throw new Error("not implemented");
}

/**
 * Worker engine: Atomic `run(workerTurn, inputs, { runId: key(turn.id, attempt), journal, budget })`.
 * Body (Atomic workflow, sketched):
 *   const r = await ctx.tool("session", { turn }, () => endpoint.exec(env, claudeP(turn)), { timeoutMs })
 *   const out = await ctx.tool("collect", { turn }, () => endpoint.readTurnBuffer(env, turn.id))
 *   return { outputs: { commands: out.commands, carry: out.carry, usd: r.usd, sessionId: r.sessionId } }
 * claudeP: `claude -p --resume <sessionId?> --output-format json` with cwd = env.path, the pstack
 * plugin installed, the brief in pstack's GOAL..STANDING shape plus a full-autonomy grant, the
 * `harness` MCP server (buffers commands into <env>/.harness/turn-<id>.json), and a PreToolUse hook
 * that asks the daemon `policy.classify` and, on "gate", denies and buffers an `ask` of kind irreversible.
 */
export function workerEngine(deps: { endpoint: EndpointPort; journal: string }): TurnEngine<WorkerId> {
  // TODO: crash resume. If ctx has turn.engineRun: session.workflows.resume(runId) after lease expiry
  // (~120 s, owned_elsewhere until then). Not resumable (zero progress) -> start fresh with attempt + 1.
  // The `session` tool is at-least-once: a resumed turn may re-run claude -p; --resume keeps that cheap.
  throw new Error("not implemented");
}

/** Only place that reads Atomic RunResult. budget stop = status "running" + active_blocked + budget_exceeded. */
export function fromAtomic<A extends ActorId>(result: {
  status: string;
  failure?: { disposition?: string; retryable?: boolean };
  result?: { status?: string };
  outputs?: unknown;
}): EngineOutcome<A> {
  // TODO: completed -> finished(parse outputs, zod)
  //       running && failure.disposition === "active_blocked" && result.status === "budget_exceeded" -> budget
  //       failed/killed with endpoint-unreachable code -> env-lost
  //       else failed { retryable: failure.retryable ?? false }
  throw new Error("not implemented");
}

/**
 * Op runner, driven by `op.start` effects. Results come back only as letters (postbox.post op.finished).
 * verify: independent session (fresh claude -p, pstack verify/review, never the author's session) on a
 *         read-only checkout of the sha; postbox.recordVerdict mints the VerdictId; then post the letter.
 * exec:   endpoint.exec with timeout; post exitCode + output tail.
 * stop:   `op.stop` effect aborts via cancellationRegistry.abort(runId) or endpoint kill; posts { op: "stopped" }.
 */
export function opRunner(deps: { postbox: Postbox; endpoint: EndpointPort; journal: string }): {
  start(worker: WorkerId, op: OpId, spec: OpSpec): Promise<void>;
  stop(op: OpId): Promise<void>;
} {
  throw new Error("not implemented");
}

