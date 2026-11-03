// workflows/ticket.ts: ONE ticket = ONE Atomic workflow run, owned by the router session.
// Discovered from the package manifest `workflows` entry (package-manager-manifest.ts:13,70-81).
// Atomic gives this for free: durability and replay of every ctx.* step, run budget, worktree,
// awaiting_input gates in the journal, background run + end notice to the owner (ground-atomic-host 2.2).
//
// Steps: work (pstack worker) <-> question gate -> verify (fresh, read-only) -> publish (code).
// The harness never merges and never deploys: Vlad merges. That removes the "irreversible" gate.

import { workflow } from '@bastani/atomic/workflows'
import { Type } from 'typebox'

const WorkResult = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('question'), Type.Literal('blocked')]),
  summary: Type.String(),
  question: Type.Optional(Type.String()),   // status 'question': one question for the requester
})
const VerifyResult = Type.Object({          // pstack shipping vocabulary (playbooks/shipping.md:7)
  verdict: Type.Union([Type.Literal('PASS'), Type.Literal('PASS+NOTES'), Type.Literal('FAIL')]),
  evidence: Type.String(),
  commands: Type.Array(Type.String()),
})

const MAX_WORK_ROUNDS = 6      // question answers + verifier FAIL fix-ups + late follow-ups, together
const OPUS = 'anthropic/claude-opus-5-5'   // Vlad: every role opus, effort medium (ground-atomic-host 4)

export default workflow({
  name: 'ticket',
  description: 'Work one harness ticket in a worktree, verify independently, publish a PR.',
  inputs: {
    ticket: Type.String(), repo: Type.String(), repoPath: Type.String(), baseBranch: Type.String(),
    title: Type.String(), brief: Type.String(),
    visibility: Type.Union([Type.Literal('visible'), Type.Literal('silent')]),
  },
  outputs: {
    // read by the router via workflow status (operations.md: status with runId returns outputs)
    outcome: Type.Union([Type.Literal('delivered'), Type.Literal('discarded'), Type.Literal('failed')]),
    pr: Type.Optional(Type.Number()), url: Type.Optional(Type.String()),
    verdict: Type.Optional(Type.String()), why: Type.String(),
  },
  run: async (ctx) => {
    // TODO pseudocode (every external effect is a ctx.tool: checkpointed, runs at least once,
    //      so each must be idempotent; ids below are content ids, not timestamps)
    //
    // const wt = `${HARNESS_HOME}/wt/${ticket}`
    // let prompt = workerBrief(inputs)          // "/skill:poteto-mode" + full-autonomy grant +
    //                                            // "commit only, never push; independent verification is
    //                                            // the next stage, stop at verify-ready; todo.md at <wt>"
    // let prev: WorkflowTaskResult | undefined
    // for (let round = 1; round <= MAX_WORK_ROUNDS; round++) {
    //   const w = await ctx.task(`work-${round}`, {
    //     cwd: inputs.repoPath, gitWorktreeDir: wt, baseBranch: inputs.baseBranch, model: OPUS,
    //     schema: WorkResult, prompt,
    //     ...(prev ? { context: 'fork', forkFromSessionId: prev.sessionId } : { context: 'fresh' }),
    //   })                                       // authoring-contract-stage.ts:179-217, 447-462
    //   prev = w
    //   if (w.structured.status === 'question') {
    //     if (inputs.visibility === 'silent') return exit('discarded', 'speculative run needed a human')
    //     prompt = await ctx.ui.input(`[${ticket}] ${w.structured.question}`)
    //       // durable awaiting_input; the router's activity observer relays it to GitHub;
    //       // the answer comes back as workflow({action:'answer'}) (workflow-schema.ts:57,155-161)
    //     continue
    //   }
    //   if (w.structured.status === 'blocked') return exit('failed', w.structured.summary)
    //   const head = await ctx.tool('head', () => headOf(wt, inputs.baseBranch))  // {headSha, baseSha, patchId}
    //   const v = await ctx.task(`verify-${round}`, {
    //     cwd: wt, context: 'fresh', model: OPUS, schema: VerifyResult,
    //     excludedTools: ['edit', 'write'],     // plus the guard's verifier role
    //     prompt: verifierBrief(inputs, head),   // "verification only, do not edit; overrides poteto-mode"
    //   })
    //   await ctx.tool('record-verdict', () => store.append({ kind: 'verdict', by: 'verifier',
    //     body: independentVerdict({ ...head, ...v.structured, writerSession: w.sessionId,
    //                                verifierSession: v.sessionId, sameModel: true }) }))
    //   if (v.structured.verdict === 'FAIL') { prompt = fixBrief(v.structured); continue }
    //   const late = await ctx.tool(`inbox-${round}`, () => store.inbox(ticket, ctx.runId))
    //   if (late.length) { prompt = followupBrief(late); continue }   // follow-ups that missed the stage
    //   const pr = await ctx.tool('publish', () => {
    //     const cur = headOf(wt, inputs.baseBranch)
    //     if (!verdictStillValid(store.verdictFor(repo, cur.headSha), cur.headSha, cur.patchId)) throw ...
    //     return github.publish({ ..., draft: inputs.visibility === 'silent' })
    //   })
    //   return { outcome: 'delivered', pr: pr.pr, url: pr.url, verdict: v.structured.verdict, why: w.structured.summary }
    // }
    // return exit('failed', 'round cap reached')
    throw new Error('not implemented')
  },
})
