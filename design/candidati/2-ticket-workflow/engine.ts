// engine.ts: the only module that imports @bastani/atomic. Owns every crossing of
// Atomic's embedding gaps. Everything else asks it three things: make this Ticket's run
// exist and be live, stop it, tell me what it is doing.

import type { TicketId, Ticket, TicketEnd } from "./domain";
import type { Bridge, WaitingFor } from "./inbox";
import type { TicketInputs } from "./ticket-workflow";

/** Derived, never stored. Single source of truth: the Atomic journal. */
export type TicketView =
  | { readonly ticketId: TicketId; readonly phase: "starting" }                        // ensureRun effect queued, no run yet
  | { readonly ticketId: TicketId; readonly phase: "working"; readonly attemptNo: number; readonly stage: "worker" | "verifier" | "publish"; readonly silentForMs: number; readonly spend: Spend }
  | { readonly ticketId: TicketId; readonly phase: "waiting"; readonly waitingFor: WaitingFor; readonly question?: string; readonly since: string; readonly spend: Spend }
  | { readonly ticketId: TicketId; readonly phase: "crashed"; readonly resumableAt: string }   // lease expired or not yet
  | { readonly ticketId: TicketId; readonly phase: "ended"; readonly end: TicketEnd };

export interface Spend { readonly usd: number; readonly tokens: number; readonly ms: number }

export interface Engine {
  /**
   * Idempotent. Converges to "a live run with runId = ticket.id exists in this process".
   *  getRun(id) missing             -> run(def, inputs, { runId, cwd: engineCwd, journal, ui: bridge.forRun(id),
   *                                         modelOwner: engineSession owner id, executionMode: "non_interactive" })
   *                                    not awaited: the promise settles when the Ticket ends (days)
   *  live in this process           -> noop
   *  crashed / released             -> session.workflows.resume(id)    (sdk.md:363, public path; resumeDurableWorkflow
   *                                    is not exported, sdk-surface.ts:25-58)
   *  owned_elsewhere (lease < 120 s)-> throw Later (effect retries; lease-expiry.ts:2-3)
   *  not resumable, zero progress   -> fresh run() under the same id after deleteDurableWorkflowIfSafe
   *                                    (resume-eligibility.ts:66-71)
   *  ended                          -> noop (service learns the end from the "ended" report)
   */
  ensureRunning(ticket: Ticket, inputs: TicketInputs): Promise<void>;
  /** Durable stop. cancellationRegistry.abort(id) for run()-started runs, session.workflows.quit(id) for adopted ones.
   *  The service's `quit` effect retries this until ticketView says ended. */
  stop(ticket: TicketId, reason: string): Promise<"stopped" | "not-running">;
  ticketView(ticket: TicketId): Promise<TicketView>;
  /** Boot: every non-ended service Ticket -> ensureRunning, with backoff through the lease window. */
  recoverAll(open: readonly Ticket[]): Promise<void>;
  dispose(): Promise<void>;
}

export interface EngineConfig {
  /** Holds .atomic/workflows/ticket-v*.ts, .atomic/settings.json (skills path -> pstack, defaultConcurrency,
   *  workflows.budget = 0 so the root never inherits a config budget: budget.ts:54-83). Same cwd forever:
   *  resume from another cwd forks to a new run id (resume-runtime.ts:289-315). */
  readonly engineCwd: string;
  readonly journalPath: string;
  readonly bridge: Bridge;
  /** admission.limits.session: max concurrent stage sessions. Parked runs hold none. */
  readonly maxLiveSessions: number;
}

export function createEngine(cfg: EngineConfig): Promise<Engine> {
  // TODO
  //  session = await createAgentSession({ cwd: cfg.engineCwd, journal: { path: cfg.journalPath },
  //                                       sessionManager: SessionManager.inMemory(),
  //                                       extensionBindings: { humanInput: cfg.bridge.hostInput } })
  //  views: session.workflows.getRun / getStages for status, pending prompts (awaitingInput) -> decodePark
  //         gives waitingFor + question; spend from RunSnapshot budgetState.accounting
  //  phase mapping (never from RunResult.status alone, ground-atomic gotcha 1):
  //    awaitingInput with a park prompt        -> waiting
  //    running, no prompt                      -> working
  //    "crashed" (lease expired)               -> crashed
  //    completed/failed/killed/cancelled       -> ended (end from outputs.end, else "failed"/"stopped")
  //    running + failure.disposition active_blocked -> impossible on a root with no budget; assert + health error
  throw new Error("not implemented");
}
