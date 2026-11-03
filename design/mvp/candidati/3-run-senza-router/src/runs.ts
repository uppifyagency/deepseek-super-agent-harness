// runs.ts: the ONLY file that imports @bastani/atomic. Three workflow definitions, one way to
// start them, one way they come back (RunEnded). Atomic's journal is this file's private state;
// the store holds only what classify() reports.
//
// Atomic APIs relied on (cite: AT = ~/src/ext/atomic-0.9.63/packages):
//   run(def, inputs, opts) -> Promise<RunResult>         AT/workflows/src/runs/foreground/sdk-run.ts:16-24
//   RunOpts.runId, budget, journal, onStageSessionEvent  AT/workflows/src/runs/foreground/executor-types.ts:131,165
//   RunOpts.continuation {source: RunSnapshot}           executor-types.ts:34-40,136 (resume path, UNVERIFIED)
//   StageOptions schema/context/noTools/customTools/excludedTools/gitWorktreeDir
//                                                        AT/workflows/src/shared/authoring-contract-stage.ts:179-217
//   StageContext.steer(text)                             authoring-contract-stage.ts:384
//   RunResult {status, result, failure}                  AT/workflows/src/shared/authoring-contract-ui.ts:464-479
//   budget stop = status 'running' + failure.disposition 'active_blocked' + result.status 'budget_exceeded'
//                                                        ground-atomic.md section 3 (engine/run.ts:1210-1231)

import type { AttemptId, AttemptOutcome, AttemptSpec, BatchId, Budget, RouterOutput, RouterPack, RunEnded } from './domain'

export interface Runs {
  /** Fire and forget. Idempotent by id: an id that is live in this process is not started twice. */
  start(r: { kind: 'router-batch'; pack: RouterPack } | { kind: 'ticket-attempt'; spec: AttemptSpec }): void
  /** Pass-through without an LLM turn: the workflow body runs in this process and registers its live
   *  work-stage StageContext; steer() queues the card into that session. Best effort: the input is
   *  already in the store and goes into the next attempt's brief if the steer is lost. */
  steerLive(attempt: AttemptId, card: string): boolean
  /** cancellationRegistry.abort(runId). Called every tick while a stop is pending (durable stop). */
  stop(attempt: AttemptId, reason: string): void
  /** Settled runs, already classified. Exactly one callback per started run, including failures. */
  onSettled(fn: (e: RunEnded) => void): void
  /**
   * Boot only, after waiting out the ~120 s journal lease (ground-atomic-host.md 2.3).
   * batches: never resumed; reported router-batch-failed so the store releases them and the next
   *   tick reruns the same BatchId (decisions are first-write-wins, so a rerun is harmless).
   * attempts: Atomic terminal -> classify; resumable -> run(..., {runId, continuation}) ;
   *   otherwise failed{crash, retryable:true} -> attempt n+1 in the same worktree.
   */
  reconcile(live: { batches: BatchId[]; attempts: AttemptSpec[] }): Promise<void>
  /** Concurrency is the supervisor's slot count; this reports what is live in-process. */
  live(): { batches: number; attempts: number }
}

export interface RunsOptions {
  journal: string                      // ~/.harness/atomic.sqlite (not the store)
  cwdFor(repo: string): string         // resume is cwd-scoped (ground-atomic.md gotcha 3)
  model: 'anthropic/claude-opus-5-5'   // Vlad: every role opus, effort medium
  thinking: 'medium'
  routerBudget: Budget                 // small: e.g. 10 min, 300k tokens, $3
  recall(id: string): string | undefined          // the router's only tool, backed by store.recall
  publish(spec: AttemptSpec, headSha: string): Promise<number>   // host step, see github.ts
}

export function openRuns(o: RunsOptions): Runs {
  throw new Error('not implemented')
  // start(router-batch): run(routerBatch, { pack: render(pack), batch }, { runId: `rb-${batch}-${n}`, journal,
  //                       budget: o.routerBudget, executionMode: 'non_interactive' })
  //   .then(r => r.status === 'completed' ? {kind:'router-batch', output: parseRouterOutput(r.result)}
  //                                       : {kind:'router-batch-failed'})
  // start(ticket-attempt): run(ticketAttempt, spec, { runId: spec.attempt, journal, budget: spec.budget,
  //                       executionMode: 'non_interactive', onStageSessionEvent -> progress table for watchdog })
  //   .then(r => ({ kind:'ticket-attempt', attempt, outcome: classify(r, spec.budget) }))
  //   .catch(e => ({ kind:'ticket-attempt', attempt, outcome: failed{error, retryable:true} }))
  // No `ui` adapter is passed on purpose: no workflow here calls ctx.ui. A human ask ends the run.
}

/** The single place Atomic statuses are read. */
export function classify(r: { status: string; result?: Record<string, unknown>; failure?: { disposition?: string; retryable?: boolean } }, budget: Budget): AttemptOutcome {
  throw new Error('not implemented')
  // TODO result.status 'budget_exceeded' (with status 'running') -> parked{ gate kind 'budget', raise: 2x budget }
  // TODO result.outcome 'done' -> needs result.verdict from the verify stage (parseVerdict) else failed{verify-failed}
  // TODO result.outcome 'parked' -> parked{ gate from work stage output (question | irreversible) }
  // TODO cancelled/killed -> failed{stopped, retryable:false}; failed -> failed{error, retryable: failure.retryable ?? false}
}

/*
 * routerBatch = workflow({ name: 'harness-router-batch', inputs: { batch, pack }, outputs: { decisions, replies, notes },
 *   run: async (ctx) => {
 *     const s = ctx.stage('route', { schema: RouterOutputSchema, context: 'fresh', model, noTools: 'builtin',
 *                                    customTools: [recallTool(o.recall)] })
 *     // noTools:'builtin' = the router CANNOT execute (article 2.1), by construction, not by prompt.
 *     // The guard extension (guard.ts) also blocks everything except `recall` in this stage.
 *     return await s.prompt(ROUTER_PROMPT + ctx.inputs.pack)   // ROUTER_PROMPT: semantic rules, norms, output contract
 *   } })
 *
 * ticketAttempt = workflow({ name: 'harness-ticket-attempt', inputs: AttemptSpec, outputs: { outcome, verdict, gate, headSha, pr, summary },
 *   run: async (ctx) => {
 *     const work = ctx.stage('work', { gitWorktreeDir: spec.worktreeDir, baseBranch, model, schema: WorkOutputSchema,
 *                                      customTools: [handBackTool, unsubscribeTool] })     // write to store in-process
 *     liveStages.set(spec.attempt, work)                                                   // for steerLive
 *     const w = await work.prompt('/skill:poteto-mode ' + WORKER_PREAMBLE + spec.brief)
 *     // WORKER_PREAMBLE: full autonomy; commit, never push; verification is the next stage; no /loop;
 *     //   todo.md; when you need Vlad, stop and return {status:'needs_human', question}; keep pstack fan-out <= 1.
 *     liveStages.delete(spec.attempt)
 *     if (w.status === 'needs_human') return { outcome: 'parked', gate: w.gate, summary: w.summary }
 *     const head = await ctx.tool('head', { attempt }, () => git(['rev-parse', 'HEAD']))
 *     const v = await ctx.stage('verify', { context: 'fresh', gitWorktreeDir: spec.worktreeDir, excludedTools: ['edit', 'write'],
 *                                           schema: VerdictSchema, model }).prompt(VERIFY_BRIEF(spec, head))
 *     if (v.result === 'FAIL') return { outcome: 'failed', summary: v.evidence }
 *     const pr = await ctx.tool('publish', { attempt, head }, () => o.publish(spec, head))  // push by sha + PR find-or-open by marker
 *     return { outcome: 'done', verdict: v, headSha: head, pr, summary: w.summary }
 *   } })
 *
 * watchdogJudge = workflow({ name: 'harness-watchdog-judge', inputs: { card }, outputs: { verdict, evidence },
 *   run: (ctx) => ctx.stage('judge', { context: 'fresh', noTools: 'all', schema: JudgeSchema, model }).prompt(JUDGE + card) })
 *   // used by watchdog.ts through judgeProgress(); its own tiny budget.
 */

export function judgeProgress(card: string, journal: string): Promise<{ verdict: 'progressing' | 'stuck' | 'drifting'; evidence: string }> {
  throw new Error('not implemented')
}

export function parseRouterOutput(raw: unknown): RouterOutput {
  throw new Error('not implemented')   // typebox Value.Parse at the boundary; drops items for unknown trigger ids
}
