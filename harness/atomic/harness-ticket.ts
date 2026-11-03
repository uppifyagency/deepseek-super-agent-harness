// harness-ticket.ts: copied by the engine to <home>/.atomic/workflows/ at every start, loaded by Atomic.
// One Atomic run = one ATTEMPT of one ticket: work (Sol stage), verify (host step: fresh Opus),
// publish (host step: bot push + PR). It reads everything from the daemon through the bridge on globalThis, and every
// bridge call is a ctx.tool, so a replay after a crash sees the same values.

import { workflow } from '@bastani/atomic/workflows'
import { Type } from 'typebox'

interface Bridge {
  prepare(run: string): Promise<{ brief: string; model: string; worktree: string; base: string; forkFrom?: string; budget: { maxCostUsd: number; maxDurationMs: number } }>
  inspect(run: string): Promise<{ sha: string; commits: number; dirty: string[] }>
  verify(run: string): Promise<{ ok: boolean; verdict?: unknown; evidence: string; costUsd: number }>
  publish(run: string, verdict: unknown, summary: string): Promise<{ ok: boolean; pr?: number; url?: string; evidence?: string }>
  follow(run: string): { input: string; text: string }[]
  delivered(run: string, input: string): void
}
const bridge = (): Bridge => {
  const b = (globalThis as Record<symbol, unknown>)[Symbol.for('it.delera.harness.bridge')]
  if (!b) throw new Error('harness bridge missing: harness-ticket runs only inside the harness daemon')
  return b as Bridge
}

const WorkResult = Type.Object({
  status: Type.Union([Type.Literal('verify-ready'), Type.Literal('blocked')]),
  summary: Type.String(),
})

const attempt = workflow({
  name: 'harness-ticket-attempt',
  description: 'one attempt of one harness ticket',
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: {
    status: Type.String(), summary: Type.String(), sha: Type.String(), base: Type.String(),
    commits: Type.Number(), dirty: Type.Array(Type.String()), workerSession: Type.String(),
    evidence: Type.String(), verdict: Type.String(), pr: Type.Number(), url: Type.String(), verifierUsd: Type.Number(),
  },
  run: async (ctx) => {
    const runKey = ctx.inputs.runKey
    const p = await ctx.tool('prepare', { runKey }, () => bridge().prepare(runKey))
    // forkFromSessionId alone is ignored: Atomic forks only with context 'fork' (observed 02/11, api-reference.md:518-525).
    const work = ctx.stage('work', { model: p.model, cwd: p.worktree, schema: WorkResult, ...(p.forkFrom ? { context: 'fork' as const, forkFromSessionId: p.forkFrom } : {}) })
    // Follow-ups the daemon routed to this ticket reach the worker live, with no router turn (unit 7).
    // The pump is not journaled: a steered message lives in the stage session, input.delivered in our log.
    const steered = new Set<string>()
    let busy = false
    const pump = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        for (const i of bridge().follow(runKey)) {
          if (steered.has(i.input)) continue
          await work.steer(`A new message arrived in the issue or the PR while you work. Take it into account:\n\n${i.text}`)
          steered.add(i.input)
          bridge().delivered(runKey, i.input)
        }
      } catch { /* the stage may be between turns; the next tick retries */ } finally { busy = false }
    }, 3000)
    let result: { status: string; summary: string }
    // A replayed schema stage returns its checkpoint text, JSON.stringify of the live value (Atomic 0.9.63,
    // executor-stage-replay.ts:87-93). Unparsed, a resume after the work stage reads no status.
    try {
      const r: unknown = await work.prompt(p.brief)
      result = typeof r === 'string' ? JSON.parse(r) : r as typeof result
    } finally { clearInterval(pump) }
    const after = await ctx.tool('inspect', { runKey }, () => bridge().inspect(runKey))
    // A replayed stage has no session of its own ("durable-replay:work"): the next attempt cannot fork from it and starts fresh.
    const workerSession = work.sessionId.startsWith('durable-replay:') ? '' : work.sessionId
    const out = { summary: result.summary, sha: after.sha, base: p.base, commits: after.commits, dirty: after.dirty, workerSession, evidence: '', verdict: '', pr: 0, url: '', verifierUsd: 0 }
    if (result.status !== 'verify-ready') return { ...out, status: result.status }
    if (!after.commits) return { ...out, status: 'no-commit' }
    const v = await ctx.tool('verify', { runKey, sha: after.sha }, () => bridge().verify(runKey))
    if (!v.ok) return { ...out, status: 'verifier-failed', evidence: v.evidence, verifierUsd: v.costUsd }
    const pr = await ctx.tool('publish', { runKey, sha: after.sha }, () => bridge().publish(runKey, v.verdict, result.summary))
    if (!pr.ok) return { ...out, status: 'publish-refused', evidence: pr.evidence ?? '', verifierUsd: v.costUsd }
    return { ...out, status: 'done', evidence: v.evidence, verdict: JSON.stringify(v.verdict), pr: pr.pr ?? 0, url: pr.url ?? '', verifierUsd: v.costUsd }
  },
})

/** Root run. Exists because `/workflow` cannot pass a budget; the attempt runs as a budgeted child. */
export const harnessTicket = workflow({
  name: 'harness-ticket',
  description: 'harness ticket: one budgeted attempt',
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { attempt: Type.String() },
  run: async (ctx) => {
    const runKey = ctx.inputs.runKey
    const p = await ctx.tool('budget', { runKey }, async () => (await bridge().prepare(runKey)).budget)
    const r = await ctx.workflow(attempt, { inputs: { runKey }, budget: { maxCost: p.maxCostUsd, maxDurationMs: p.maxDurationMs } })
    return { attempt: JSON.stringify(r) }
  },
})
