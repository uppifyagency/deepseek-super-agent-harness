// executor.ts: the narrow port and its Atomic adapter. Atomic is replaceable: nothing outside this
// file imports @bastani/atomic. Atomic's own journal is executor-private state; the harness log
// holds only what the port reports. On disagreement after a crash, `reconcile` re-reports.

import type { Budget, EnvId, EventId, IndependentVerdict, Outcome, RunId, RunSpec, Text } from './events'
import type { WorkerReport } from './decide'

/** Input side of the port. All three are idempotent by RunId. */
export interface Executor {
  /** Start or reattach. Calling twice for the same run must not start two. */
  start(run: RunId, spec: RunSpec, brief: string): Promise<void>
  /** Durable because the caller re-issues it from the pending `stop.intended` until run.ended appears. */
  stop(run: RunId, reason: string): Promise<void>
  /** Boot: for every run the log thinks is live, resume it or report the end Atomic already reached. */
  reconcile(live: readonly { run: RunId; spec: RunSpec; brief: string }[]): Promise<void>
}

/** Output side. The only way executor facts enter the log (as worker-authored events). */
export interface ExecutorSink { report(run: RunId, r: WorkerReport): void }

export interface EnvironmentPort {
  /** Probe the endpoint daemon (or local worktree host). Feeds `env.seen`. */
  probe(env: EnvId): Promise<{ online: boolean; probe: string }>
  /** Worktree path for a ticket on that env; created once, reused across attempts, removed on close. */
  worktree(env: EnvId, run: RunId): Promise<string>
}

export interface AtomicExecutorOptions {
  journal: string                           // Atomic SqlRunJournal path; never the harness log
  sink: ExecutorSink
  envs: EnvironmentPort
  secrets: (names: readonly string[]) => Record<string, string>   // host steps only (publish); never the worker's env
  // The worker is always `claude -p` inside ctx.tool: pstack runs as the real plugin and the
  // PreToolUse hook enforces pause-always. Atomic's native agent has no Claude Code hooks.
  verifierModel: string                     // a different agent from the author; same family under Vlad's opus-only rule
}

export function atomicExecutor(o: AtomicExecutorOptions): Executor {
  throw new Error('not implemented')
  // start: run(ticketWorkflow, { brief, ticket, attempt }, { runId: run, journal: o.journal, budget,
  //          executionMode: 'non_interactive', onStageEnd -> sink.report(progress) })
  //        and NO ui adapter: the workflow never calls ctx.ui (every human ask parks the run).
  //        On settle: sink.report(run, { kind: 'ended', outcome: classify(result) }).
  // stop:  cancellationRegistry.abort(run, reason); if Atomic has no live run, report ended{stopped}.
  // reconcile: for each live run, store.run(run): terminal -> report ended(classify);
  //        running with checkpoints -> session.workflows.resume(run) after the 120 s lease;
  //        zero-progress -> report ended{failed, cause:'crash', retryable:true} (harness starts attempt n+1).
}

/**
 * The single place Atomic's statuses are read. Budget stop is status 'running' +
 * failure.disposition 'active_blocked' + result.status 'budget_exceeded': it becomes a `parked`
 * outcome with a `budget` gate proposing `raise`. The answer starts attempt n+1; the blocked
 * Atomic run is cancelled, never resumed (session resume takes no budget).
 */
export interface AtomicRunResultLike {
  status: string
  result?: { status?: string; verdict?: unknown; deliverable?: unknown; gate?: unknown; evidence?: unknown }
  failure?: { disposition?: 'active_blocked' | 'terminal_killed' | 'terminal_failed'; retryable?: boolean; code?: string }
}
export function classify(run: RunId, r: AtomicRunResultLike, budget: Budget): Outcome {
  throw new Error('not implemented')
  // TODO budget_exceeded -> parked { kind:'budget', audience:'operator', raise: budget*2 }
  // TODO outputs.status 'done' -> independentVerdict(outputs.verdict) ok -> done; else failed{verifier-failed}
  // TODO outputs.status 'needs_human' -> parked { kind: outputs.gate.kind ('question' | 'irreversible'), audience:'requester' }
  // TODO always carry outputs.session so the next attempt resumes the same Claude Code session
  // TODO cancelled/killed -> failed{stopped, retryable:false}; failed -> failed{error, retryable: failure.retryable}
}

/** Parse a pstack ledger row; refuses self-review and non-passing verdicts. The only IndependentVerdict constructor. */
export function independentVerdict(row: unknown): { ok: true; v: IndependentVerdict } | { ok: false; why: string } {
  throw new Error('not implemented')
  // TODO row = the verify step's own record keyed by (repo, sha); pstack's `orch ledger` needs a PR
  //      number, so it is read only when a PR exists. Require verifier !== author.
}

/*
 * ticketWorkflow (Atomic definition, private to this file, registered by name for resume):
 *
 *   workflow({ name: 'harness-ticket', inputs: { brief, ticket, attempt }, outputs: { status, verdict, deliverable, gate, evidence },
 *     run: async (ctx) => {
 *       const wt = await ctx.tool('worktree', { ticket }, () => envs.worktree(...))         // cached, reused on resume
 *       const work = await ctx.tool('work', { attempt }, () => spawnClaudeP(wt, brief, { resume: spec.resumeSession }))
 *       //   `claude -p --output-format json [--resume <session>]`, pstack plugin, ORCH_STORE=<run dir>,
 *       //   process env WITHOUT host secrets: the worker can commit, not push, open PRs or message anyone.
 *       //   PreToolUse hook denies force-push / deploy / delete / outbound messaging and writes
 *       //   `orch gate park`; a parked gate makes the work tool return { status: 'needs_human', gate: { kind } }
 *       //   worker MCP tools (report, took, unsubscribe, handback) call sink.report through a run-scoped socket
 *       //   spend comes from the JSON output (total_cost_usd); Atomic cannot meter inside ctx.tool,
 *       //   so the executor enforces maxCost/maxTokens itself and Atomic enforces maxDurationMs.
 *       const verdict = await ctx.tool('verify', { sha: work.sha }, () => spawnVerifier(wt, work))   // fresh session, not the author
 *       if (!verdict.ok) return { status: 'failed', verdict, session: work.session, evidence: work.evidence }
 *       const pr = await ctx.tool('publish', { sha: work.sha }, () => publish(wt, work, o.secrets(spec.hostSecrets)))
 *       //   at-least-once safe: push is idempotent by sha, PR is find-or-open by branch + hidden marker (graft from candidate 2)
 *       return { status: 'done', verdict, deliverable: { ...work.deliverable, pr }, session: work.session, evidence: work.evidence }
 *     } })
 */

export type { EventId, Text }
