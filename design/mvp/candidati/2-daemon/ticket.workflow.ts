// ticket.workflow.ts: installed by `harness init` as ~/.harness/.atomic/workflows/harness-ticket.ts.
// One Atomic run = one ATTEMPT of one ticket. Atomic journals it, replays it, budgets it.
// It never talks to GitHub humans and never decides routing: it reads its spec and follow-ups
// from the daemon through `bridge()` and returns a typed result that engine.ts classifies.
// Sketch: API names per api-reference.md / authoring-contract-stage.ts; bodies are pseudocode.

import { workflow } from '@bastani/atomic/workflows'
import { Type } from 'typebox'
// import { bridge } from '<harness>/engine.ts'   -- resolved via globalThis, see engine.ts TicketBridge

const attempt = workflow({
  name: 'harness-ticket-attempt',
  inputs: { runKey: Type.String() },
  run: async (ctx) => {
    // 1. Spec from the log, checkpointed so replay sees the same brief (ctx.tool = journaled side effect).
    // const { spec, brief } = await ctx.tool('spec', { runKey }, () => bridge().spec(runKey))
    //
    // 2. WORK: pstack poteto-mode in a worktree. Follow-ups the daemon routed are steered in live.
    // const work = await ctx.stage('work', {
    //     model: 'anthropic/claude-opus-5-5', thinking: 'medium',
    //     gitWorktreeDir: `.atomic/worktrees/${spec.ticket}`, baseBranch: spec.baseBranch,
    //     forkFromSessionId: spec.forkFrom,                       // context carries across attempts
    //     schema: WorkResult,                                     // { status:'verify-ready'|'blocked', sha, branch, summary }
    //   }, async (s) => {
    //     const ac = new AbortController()
    //     const pump = (async () => { for await (const i of bridge().follow(spec.ticket, ac.signal)) {
    //         await s.steer(`Follow-up from the issue (routed by the harness):\n${i.text}`)   // StageContext.steer
    //         bridge().delivered(runKey, i.input) } })()
    //     try { return await s.prompt(brief) } finally { ac.abort(); await pump.catch(() => {}) }
    //   })
    //   Brief tells the worker: full autonomy in this worktree; commit, never push; ask with
    //   ask_user_question only when blocked on a human fact; stop at verify-ready, the next stage
    //   verifies (ground-pstack-on-atomic.md section 5.7); no /loop, no schedule_wakeup.
    //   pstack `agent` children are invisible to the journal: allowed, but localWorkers pools stay off.
    //
    // 3. VERIFY: fresh context, no edit tools, structured verdict (ground-pstack-on-atomic.md section 5).
    // const v = await ctx.stage('verify', { context: 'fresh', excludedTools: ['edit', 'write'],
    //     cwd: worktree, schema: Verdict }, (s) => s.prompt(verifyBrief(spec, work)))
    // if (v.verdict === 'FAIL') return { status: 'verifier-failed', evidence: v.evidence, workerSession: work.sessionId }
    //
    // 4. PUBLISH: plain JS, host credentials, at-least-once safe (push by sha; find-or-open PR by
    //    branch + hidden marker). The token never enters a stage session.
    // const pr = await ctx.tool('publish', { sha: work.sha }, () => publish(spec.repo, work.branch, work.sha))
    // return { status: 'done', sha: work.sha, pr, verdict: v, workerSession: work.sessionId }
    throw new Error('not implemented')
  },
})

/**
 * Root run. Exists only because `/workflow` (the only no-LLM start path from the engine session)
 * cannot pass a budget, and budgets are per run or per child (authoring-contract-stage.ts:491-495).
 * Depth used: root + attempt = 2 of 3; pstack workers inside a stage are separate processes.
 */
export default workflow({
  name: 'harness-ticket',
  inputs: { runKey: Type.String() },
  run: async (ctx) => {
    // const { spec } = await ctx.tool('spec', { runKey }, () => bridge().spec(runKey))
    // return ctx.workflow(attempt, { inputs: { runKey }, budget: { maxCost: spec.budget.maxCostUsd,   // WorkflowBudget, shared/budget.ts:12-16
    //                                                             maxDurationMs: spec.budget.maxDurationMs } })
    throw new Error('not implemented')
  },
})
