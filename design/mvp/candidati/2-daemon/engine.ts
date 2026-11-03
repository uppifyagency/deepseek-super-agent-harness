// engine.ts: THE seam. Daemon side sees `Engine` (4 methods) and implements `EngineHost`
// (service.ts). Everything Atomic-shaped stays here and in ticket.workflow.ts / router.ts.
// Atomic owns: execution, worktrees, budgets, the durable journal, stage replay, HIL durability.
// The daemon owns: WHEN a run starts or stops, WHICH follow-up reaches it, WHO answers its gates.

import type { AtomicRunId, Budget, IndependentVerdict, Outcome, RunKey, RunSpec, TicketId, EventId } from './domain.ts'
import type { EngineHost } from './service.ts'

export interface Engine {
  /** Idempotent by RunKey: a run whose inputs.runKey already exists in the journal is re-bound, not restarted. */
  start(run: RunKey, spec: RunSpec): Promise<void>
  /** session.workflows.quit. Idempotent; the daemon re-issues it until `run.ended` exists. */
  stop(run: RunKey, reason: string): Promise<void>
  /** Boot only, the ONE resume path: config sets resumeInFlight "never" so Atomic never races us. */
  recover(live: readonly { run: RunKey; atomic?: AtomicRunId; spec: RunSpec }[]): Promise<void>
  dispose(): Promise<void>
}

export interface EngineOptions { home: string; host: EngineHost; leaseWaitMs?: number /* default 130_000 */ }

export async function openEngine(o: EngineOptions): Promise<Engine> {
  throw new Error('not implemented')
  // installBridge({ spec: o.host.spec, follow: o.host.follow, report: o.host.report })   (see TicketBridge)
  //
  // const { session } = await createAgentSession({            // the ENGINE session (sdk.md:130-150)
  //   cwd: o.home,                                             // discovers .atomic/workflows/harness-ticket.ts
  //   settingsManager: SettingsManager.inMemory({ workflows: {
  //     resumeInFlight: 'never',                               // config-loader.ts:64,186
  //     workflowNotifications: { enabled: false },             // no triggerTurn steer into a session nobody prompts
  //     heartbeatIntervalMinutes: 0 } }),
  //   extensionFactories: [guardExtension],                    // rerun in every stage (sdk.md:465-467)
  //   extensionBindings: { humanInput: hostInputAdapter(o.host) },   // inherited by stages (sdk.md:475)
  // })
  // This session NEVER gets an LLM turn. Its full default tool set is kept on purpose: stage tool
  // selections can only narrow the parent's (sdk.md:471), so narrowing here would starve workers.
  // The guard blocks every tool call at depth 0 as a fail-safe (no orchestrationContext => block).
  //
  // start(run, spec):
  //   existing = (await session.workflows.listRuns({ includeDurable: true })).find(r => r.inputs.runKey === run)
  //   if existing -> host.report(run, { kind:'bound', atomic: existing.runId }); watch(existing.runId); return
  //   await session.prompt(`/workflow harness-ticket runKey=${run} --no-picker`)
  //     // registered slash command, executed with NO provider turn (agent-session-prompt.ts:197-204,
  //     // workflow-command-registration.ts:270-276). `/workflow` has no budget flag, so the budget
  //     // rides in the spec and is applied to the child attempt workflow (ticket.workflow.ts).
  //   find the new run by inputs.runKey in observe() frames -> report 'bound' -> watch(atomicId)
  //
  // watch(atomic): session.workflows.observe frames -> 'progress' on stage completion;
  //   on terminal: await waitForSettled(atomic); host.report(run, { kind:'ended', outcome: classify(getRun(atomic)) })
  //   awaiting_input needs no handling here: the HostInput adapter already raised the gate.
  //
  // stop(run): atomic = bound id; session.workflows.quit(atomic); not found -> report ended{failed, stopped}
  //
  // recover(live): sleep until every journal lease is older than ~120 s (journal-backend.ts:794-802),
  //   then for each: bound & resumable -> session.workflows.resume(atomic) (sdk.md:120,162) + watch;
  //   bound & terminal -> report ended(classify); not bound -> start(run, spec) (idempotent by runKey).
}

/**
 * HostInput -> EngineHost.ask (sdk.md:239-297). Requests carry workflowRunId + workflowStageId.
 *   questionnaire / input / select (ask_user_question from a pstack worker) -> GateSpec 'question', audience 'requester'
 *   confirm raised by guardExtension -> GateSpec 'irreversible', audience 'operator'; only literal "yes" -> true
 * The answer may arrive days later; the stage stays awaiting_input in Atomic's journal meanwhile.
 * After a daemon restart the resumed stage re-asks; gateIdOf makes it the same gate, already answered or not.
 */
declare function hostInputAdapter(host: EngineHost): unknown /* HostInput */

/**
 * The one guard extension, loaded in the engine session and every stage (wiring.ts:612-620).
 * tool_call (event-results.ts:17-26), fail-closed by throwing:
 *   depth 0 (engine session itself)                        -> block everything
 *   bash: git push, gh pr merge|close, gh api -X (non-GET), security, gh auth token, rm -rf outside cwd,
 *         curl/wget with -d|-X POST                        -> ctx.ui.confirm -> operator gate
 *   edit/write outside the stage cwd                       -> block
 *   verify stage: edit/write/bash git commit               -> block (belt over excludedTools)
 * String matching is bypassable (security.md:34-40): the real boundary is that the engine process
 * env has GH_CONFIG_DIR=<empty dir>, GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=<no credential helper>,
 * so a worker cannot push even if it evades the hook. Only ticket.workflow.ts `publish` (plain
 * ctx.tool JS, not an LLM tool) spawns git/gh with a token read from the keychain at call time.
 */
declare const guardExtension: unknown /* ExtensionFactory */

/** The only reader of Atomic run statuses (cf. design/src/executor.ts classify). */
declare function classify(run: { status: string; result?: Record<string, unknown>; error?: string; exitReason?: string }, budget: Budget): Outcome
//   result.status 'done' & independentVerdict ok          -> done
//   active_blocked / budget_exceeded                       -> budget (spentUsd from run stats)
//   result.status 'verifier-failed'                         -> failed{verifier-failed, retryable: true}
//   killed/quit                                             -> failed{stopped, retryable: false}
//   failed                                                  -> failed{error, retryable: failure.retryable}

/** Refuses a verdict whose stage session id equals the worker's; binds to sha. The only constructor. */
declare function independentVerdict(row: unknown, workerSession: string): { ok: true; v: IndependentVerdict } | { ok: false; why: string }

/**
 * In-process bridge for ticket.workflow.ts. Workflow modules are loaded by Atomic's module loader,
 * so the definition cannot import the daemon's instances; it reads this from globalThis under a
 * Symbol.for key. This is the narrowest possible crossing: three functions, typed here.
 */
export interface TicketBridge {
  spec(run: RunKey): { spec: RunSpec; brief: string }
  follow(ticket: TicketId, signal: AbortSignal): AsyncIterable<{ input: EventId; text: string }>
  delivered(run: RunKey, input: EventId): void
}
export const BRIDGE = Symbol.for('it.delera.harness.bridge')
export function bridge(): TicketBridge {
  const b = (globalThis as Record<symbol, unknown>)[BRIDGE]
  if (!b) throw new Error('harness bridge missing: harness-ticket runs only inside the harness daemon')
  return b as TicketBridge
}
