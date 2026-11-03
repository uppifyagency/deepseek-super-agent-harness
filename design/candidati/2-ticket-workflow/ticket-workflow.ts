// ticket-workflow.ts: one accepted Ticket = one long-lived Atomic workflow run.
// Lives (re-exported) at <engineCwd>/.atomic/workflows/ticket-v1.ts so that an engine
// session can resolve it BY NAME on resume (durable/resume-runtime.ts:263-270).
//
// Replay rules this file must obey (ground-atomic.md section 2):
//  - the body re-runs from the top on resume; only ctx.* results are cached
//    -> the body is a pure function of inputs + ctx.* results. No Date, no random, no I/O.
//  - ctx.tool is at-least-once -> every side effect carries an OpKey and the callee dedupes.
//  - ui replay keys hash the author callsite -> a shipped ticket-vN.ts is frozen; changes
//    go into ticket-v(N+1).ts, old versions stay registered until their runs end.
// TicketCtx enforces the first two by construction: the body never sees Atomic's ctx.

import type {
  TicketId, Mandate, AttemptBudget, OpKey, TicketEnd, TriggerRef, Proposal, PauseAction,
} from "./domain";
import type { ParkAnswer, WaitingFor, InboxItem } from "./inbox";

// ---------- inputs: what the run is born with --------------------------------

/** Typebox-validated workflow inputs. Revalidated by Atomic on resume (resume-runtime.ts:279-288). */
export interface TicketInputs {
  readonly ticketId: TicketId;
  readonly mandate: Mandate;
  readonly brief: Brief;
  readonly budget: AttemptBudget;
  readonly environment: Environment;
}

/** pstack's Orchestrate brief shape (orchestrate.md:40-53), plus the unattended additions. */
export interface Brief {
  readonly goal: string;
  readonly acceptance: readonly string[];
  readonly context: readonly TriggerRef[];          // refs + previews; full text via read_trigger
  readonly verify: readonly string[];               // commands or a driver skill path
  readonly forbidden: readonly string[];            // pause-always list, verbatim
  readonly standing: string;                        // host standing orders, autonomy grant included
  readonly followUps: readonly InboxItem[];         // grows across parks
}

/** Where the work happens. v1: a git worktree on this machine. Daemons later (article 5.2). */
export type Environment =
  | { readonly kind: "local-worktree"; readonly repo: string; readonly dir: string; readonly baseBranch: string };

// ---------- worker and verifier outcomes (stage schemas) ---------------------

/** Worker stage final answer (typebox schema on ctx.stage, authoring-contract-stage.ts:179). */
export type WorkerOutcome =
  | { readonly kind: "ready"; readonly summary: string; readonly branch: string; readonly headSha: string; readonly ran: readonly string[] }
  | { readonly kind: "needs_human"; readonly summary: string; readonly question: string; readonly options: readonly string[]; readonly default?: string }
  | { readonly kind: "wants"; readonly action: PauseAction; readonly why: string }      // pause-always: host gates it
  | { readonly kind: "failed"; readonly summary: string; readonly evidence: readonly string[] };

/** Verifier stage final answer. A different stage, fresh context, never the author (shipping.md:7). */
export interface Verdict {
  readonly verdict: "pass" | "fail" | "blocked";
  readonly sha: string;                              // must equal WorkerOutcome.headSha to count
  readonly evidence: readonly string[];
  readonly verifier: "independent-stage";            // same model family under Vlad's opus-only override
}

/** What one attempt (child workflow `attempt-v1`) yields to the Ticket body. */
export type AttemptResult =
  | { readonly kind: "verified"; readonly branch: string; readonly sha: string; readonly summary: string; readonly verdict: Verdict }
  | { readonly kind: "needs_human"; readonly question: string; readonly options: readonly string[] }
  | { readonly kind: "budget"; readonly spentUsd: number; readonly cap: AttemptBudget }   // child status "blocked", exited (primitives/workflow.ts:160-191)
  | { readonly kind: "failed"; readonly evidence: readonly string[] };

// ---------- reports: the only way out of the run ------------------------------

/**
 * Body -> service. Delivered by ctx.tool (at-least-once), deduped by OpKey in the service.
 * The service turns them into replies (Router role: workers never talk to humans).
 */
export type TicketReport =
  | { readonly kind: "started"; readonly attemptNo: number }
  | { readonly kind: "question"; readonly attemptNo: number; readonly question: string; readonly options: readonly string[] }
  | { readonly kind: "done"; readonly attemptNo: number; readonly pr: { number: number; url: string }; readonly verified: Extract<AttemptResult, { kind: "verified" }> }
  | { readonly kind: "failed"; readonly attemptNo: number; readonly evidence: readonly string[] }
  | { readonly kind: "ended"; readonly end: TicketEnd };

// ---------- the narrowed ctx -----------------------------------------------

/**
 * The only surface a Ticket body sees. Every method is one durable Atomic primitive
 * with its replay key and OpKey already decided, so a body edit cannot introduce a
 * non-replay-safe call.
 */
export interface TicketCtx {
  readonly ticketId: TicketId;
  readonly mandate: Mandate;
  readonly brief: Brief;
  /** ctx.workflow(attemptV1, { inputs, budget }). Fresh child per attemptNo; worktree is reused. */
  attempt(attemptNo: number, brief: Brief, budget?: AttemptBudget): Promise<AttemptResult>;
  /** ctx.tool("publish", ...) with OpKey `${ticket}:publish:${attemptNo}`: push branch, find-or-open PR. Host token. */
  publish(attemptNo: number, r: Extract<AttemptResult, { kind: "verified" }>): Promise<{ number: number; url: string }>;
  /** ctx.tool("report", ...) -> ServicePort.report. */
  report(r: TicketReport): Promise<void>;
  /** ctx.ui.input(encodePark(...)) answered by the Bridge. Tracks n and `after` internally. */
  park(waitingFor: WaitingFor, question?: string): Promise<ParkAnswer>;
  /** report({kind:"ended"}) then return outputs. Never ctx.exit("blocked"): that status is reserved for budget. */
  finish(end: TicketEnd): TicketOutputs;
}

export interface TicketOutputs { readonly end: TicketEnd }

export function defineTicketWorkflow(
  name: `ticket-v${number}`,
  body: (t: TicketCtx) => Promise<TicketOutputs>,
): unknown /* Atomic WorkflowDefinition */ {
  // TODO workflow({ name, description, inputs: TicketInputsSchema, outputs: { end },
  //   // no `budget`: the root run must never take the active_blocked path
  //   // (engine/run.ts:1210-1231 returns status "running", onRunEnd not called).
  //   run: async (ctx) => body(makeTicketCtx(ctx)) })
  throw new Error("not implemented");
}

function makeTicketCtx(ctx: unknown /* WorkflowRunContext<TicketInputs> */): TicketCtx {
  // TODO
  //  parkN = 0; after = 0 as InboxSeq
  //  park(w, q): parkN++; ans = JSON.parse(await ctx.ui.input(encodePark({v:1, ticket, n: parkN, after, waitingFor: w, question: q})));
  //              after = ans.through; return ans
  //    one callsite for every park -> stable author-callsite hash; distinct `n` -> distinct keys
  //  attempt(no, brief, budget = inputs.budget):
  //    res = await ctx.workflow(attemptV1, { inputs: { ticketId, attemptNo: no, brief, environment }, budget, stageName: `attempt-${no}` })
  //    res.exited && res.status === "blocked" -> { kind: "budget", ... }   (attempt-v1 never exits blocked itself)
  //    res.exited (other)                     -> { kind: "failed", evidence: [res.exitReason] }
  //    else                                   -> res.outputs.result   (field is NOT named `status`: returned-run-status.ts:5-27
  //                                                                    would reread needs_human as blocked)
  //    child throws (classified failure)      -> { kind: "failed" } via try/catch, still deterministic: the child
  //                                              checkpoint replays the same failure
  //  report(r): ctx.tool("report", { r, op: opKey(r) }, () => port().report(ticketId, opKey(r), r))
  //  publish: ctx.tool("publish", ..., { maxAttempts: 5, backoffRate: 2 }) -> port().publish(...)
  throw new Error("not implemented");
}

// ---------- the attempt child workflow ---------------------------------------

/**
 * attempt-v1: worker stage then verifier stage, both Atomic Pi agents (no Claude Code:
 * extension/wiring.ts:573-588). pstack loads as native SKILL.md through the `skills`
 * settings path; there is no SessionStart hook, so the brief carries the poteto-mode
 * routing mandate and the autonomy grant verbatim.
 *
 * Pause-always is enforced by capability, not prompt: the stage has no GitHub token,
 * no channel, no deploy credential (the service process env holds none of them, because
 * stage tools inherit process.env, ground-atomic gotcha 10). It can only commit locally.
 * Pushing and PRs happen in the parent via TicketCtx.publish with host-held credentials.
 */
export interface AttemptInputs {
  readonly ticketId: TicketId;
  readonly attemptNo: number;
  readonly brief: Brief;
  readonly environment: Environment;
}
export interface AttemptOutputs { readonly result: AttemptResult }

export const workerStageOptions = {
  // gitWorktreeDir: environment.dir   -> reused across attempts and resumes, never auto-removed
  // customTools: [read_trigger, read_thread, read_ticket, inbox_peek, handback, unsubscribe]
  //   inbox_peek lets a mid-turn worker see follow-ups early; it changes nothing. Consumption
  //   is only the parent's park answer, so peek + park may show an item twice (by id).
  // schema: WorkerOutcomeSchema
} as const;

export function attemptBody(inputs: AttemptInputs): Promise<AttemptOutputs> {
  // TODO
  //  w = await ctx.stage(`worker`, { ...workerStageOptions, schema }).prompt(renderBrief(inputs.brief))
  //  if w.kind === "wants"       -> { kind: "needs_human", question: gateQuestion(w), options: ["approve", "decline"] }
  //  if w.kind !== "ready"       -> map 1:1
  //  v = await ctx.stage(`verifier`, { context: "fresh", gitWorktreeDir, schema: VerdictSchema, excludedTools: ["write","edit"] })
  //        .prompt(renderVerify(inputs.brief, w))
  //  confirmDone(w, v) -> verified | failed (fail) | needs_human (blocked: verifier could not run, pstack "BLOCKED: independent review")
  throw new Error("not implemented");
}

/** The only constructor of `verified`. pass + same SHA, else not done. */
export function confirmDone(
  w: Extract<WorkerOutcome, { kind: "ready" }>,
  v: Verdict,
): AttemptResult { throw new Error("not implemented"); }

// ---------- the service port seen from inside the run --------------------------

/**
 * In-process calls from ctx.tool callbacks and custom stage tools into the service.
 * Reached through globalThis[Symbol.for("superagent/port@1")] because the engine session
 * may load ticket-v1.ts through its own module loader (separate module instance);
 * Atomic uses the same Symbol.for seam itself (host-input.ts:56).
 * Every mutating method is idempotent on OpKey.
 */
export interface ServicePort {
  report(ticket: TicketId, op: OpKey, r: TicketReport): void;
  publish(ticket: TicketId, op: OpKey, branch: string, sha: string, body: Proposal): Promise<{ number: number; url: string }>;
  handback(ticket: TicketId, trigger: string, reason: string): void;     // trigger -> Router again
  unsubscribe(ticket: TicketId, thread: string): void;
  readTrigger(id: string): { text: string; neighbours: readonly TriggerRef[] };
}
export function port(): ServicePort { throw new Error("not implemented"); }
