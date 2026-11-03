// engine.ts: THE seam with Atomic 0.9.63, and the only file that imports it.
// Atomic owns execution (stages, replay, budgets, journal). The daemon owns when a run starts, and
// learns everything through `report`. The ENGINE session never gets a model turn: runs start with the
// `/workflow` slash command, which runs without a provider call (E2E S1).
//
// Corrections from design/mvp/rationale.md (Riconciliazione) applied here:
//   sessions on SQLite + private journal (S5), workflow config in <home>/.atomic/extensions/workflow,
//   guard and pstack through DefaultResourceLoader (M1, M2), RunKey -> run id kept by us (S1),
//   continuation question auto-answered (S2), worktree made by the host (workspace.ts).

import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import type { Event, GateId, GateSpec, Outcome, RunKey, RunSpec, Usage } from './domain.ts'
import type { EngineReport } from './runs.ts'
import { isFinal } from './runs.ts'
import type { HarnessConfig } from './config.ts'
import { MARKER } from './config.ts'
import { botToken, openPullRequest } from './github.ts'
import { independentVerdict, runVerifier, verdictStillValid } from './verify.ts'
import type { IndependentVerdict } from './domain.ts'
import { inspect, patchId, prepare, pushBranch, removeWorktree } from './workspace.ts'

export interface EngineHost {
  runSpec(run: RunKey): { spec: RunSpec; brief: string }
  report(run: RunKey, r: EngineReport): void
  openGate(run: RunKey, stage: string, index: number, spec: GateSpec): { gate: GateId; isNew: boolean; discarded?: true }
  gateAnswer(gate: GateId): string | undefined
  ticketOf(run: RunKey): { title: string; silent?: true; issue?: { repo: string; number: number }; closed?: Event<'ticket.closed'>['body']['outcome'] }
  pendingInputs(run: RunKey): { input: string; text: string }[]
  requirements(run: RunKey): string
  bindings(run: RunKey): number
}

export interface Engine {
  /** Starts the run unless this process already owns it. Resolves once Atomic has a run id (run.bound). */
  start(run: RunKey): Promise<void>
  /** True when this process started or resumed the run. */
  owns(run: RunKey): boolean
  /** A run bound by a process that died: resume it in this one once Atomic's lease (~120 s) has expired. */
  resume(run: RunKey, atomic: string): Promise<void>
  /**
   * Stop a run for its stop.intended or its closed ticket: quit it in Atomic when this process runs it, then end
   * it in the log as failed/stopped with Atomic's usage and remove its worktree; a run no process runs gets the
   * same end without a quit. Safe to call every lap.
   */
  stop(run: RunKey): Promise<'quit' | 'ended' | 'pending' | 'refused'>
  /** Resolves when every run this process started has ended (run.ended reported). */
  idle(): Promise<void>
  dispose(): Promise<void>
}

const WORKFLOW = 'harness-ticket'
const BRIDGE = Symbol.for('it.delera.harness.bridge')
const TERMINAL = new Set(['completed', 'failed', 'killed', 'blocked'])

/** The pstack sheet the worker sees: Atomic's ask tool stays (stage HIL), every role runs on the worker's model. */
const WORKER_SHEET = `pi ask tool: off
default effort: medium
session hook: on
`

/** Atomic as installed next to this Node (nvm global). The harness has no runtime dependency on it. */
export const ATOMIC_DIR = join(dirname(process.execPath), '..', 'lib', 'node_modules', '@bastani', 'atomic')

async function loadAtomic(): Promise<any> {
  return import(join(ATOMIC_DIR, 'dist', 'index.js'))
}

export async function openEngine(home: string, host: EngineHost, config: Pick<HarnessConfig, 'botKeychainService' | 'maxAttempts' | 'pstackDir'>): Promise<Engine> {
  const logs = join(home, 'logs')
  mkdirSync(join(home, 'atomic'), { recursive: true })
  mkdirSync(logs, { recursive: true })
  const note = (line: string) => appendFileSync(join(logs, 'engine.log'), `${new Date().toISOString()} ${line}\n`)

  // Atomic keeps its auth in ~/.atomic/agent; pstack reads its sheet from PI_CODING_AGENT_DIR (M1, correction 4).
  process.env.ATOMIC_CODING_AGENT_DIR ??= join(homedir(), '.atomic', 'agent')
  const piDir = join(home, 'pi-agent')
  mkdirSync(piDir, { recursive: true })
  if (!existsSync(join(piDir, 'pstack-models.md'))) writeFileSync(join(piDir, 'pstack-models.md'), WORKER_SHEET)
  process.env.PI_CODING_AGENT_DIR = piDir

  const wfDir = join(home, '.atomic', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  copyFileSync(fileURLToPath(new URL('../atomic/harness-ticket.ts', import.meta.url)), join(wfDir, 'harness-ticket.ts'))
  const cfgDir = join(home, '.atomic', 'extensions', 'workflow')
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(join(cfgDir, 'config.json'), JSON.stringify({ resumeInFlight: 'never', workflowNotifications: { enabled: false } }, null, 2) + '\n')

  const workspaceOf = async (run: string) => {
    const { spec, brief } = host.runSpec(run as RunKey)
    return { spec, brief, ws: await prepare(home, spec) }
  }
  ;(globalThis as Record<symbol, unknown>)[BRIDGE] = {
    async prepare(run: string) {
      const { spec, brief, ws } = await workspaceOf(run)
      return { brief, model: spec.models.worker, worktree: ws.worktree, base: ws.base, budget: spec.budget, ...(spec.forkFrom ? { forkFrom: spec.forkFrom } : {}) }
    },
    async inspect(run: string) {
      const { ws } = await workspaceOf(run)
      return inspect(ws.worktree, ws.base)
    },
    /** Follow-ups for the live work stage (unit 7): read from the log, steered in by the workflow. */
    follow(run: string) { return host.pendingInputs(run as RunKey) },
    delivered(run: string, input: string) { host.report(run as RunKey, { kind: 'delivered', input }) },
    /** VERIFY (host step): fresh Opus, read-only by check, verdict bound to sha and patch-id. */
    async verify(run: string) {
      if (host.ticketOf(run as RunKey).closed) return { ok: false, evidence: 'ticket discarded', costUsd: 0 }
      const { spec, ws } = await workspaceOf(run)
      const brief = host.requirements(run as RunKey)
      const head = await inspect(ws.worktree, ws.base)
      const pid = await patchId(ws.worktree, ws.base)
      host.report(run as RunKey, { kind: 'progress', stage: 'verify', summary: `started on ${head.sha.slice(0, 8)}` })
      const vr = await runVerifier({ home, worktree: ws.worktree, base: ws.base, sha: head.sha, brief, model: spec.models.verifier, pstackDir: config.pstackDir })
      const after = await inspect(ws.worktree, ws.base)
      const iv = independentVerdict(vr, { repo: spec.repo, sha: head.sha, patchId: pid, workerModel: spec.models.worker, verifierModel: spec.models.verifier, dirty: head.dirty }, after)
      note(`verify ${run} ${vr.verdict ?? 'no verdict'} -> ${iv.ok ? 'independent PASS' : `refused: ${iv.why.slice(0, 200)}`} cost=${vr.costUsd} session=${vr.sessionId}`)
      return iv.ok ? { ok: true, verdict: iv.v, evidence: iv.v.evidence, costUsd: vr.costUsd ?? 0 } : { ok: false, evidence: iv.why, costUsd: vr.costUsd ?? 0 }
    },
    /** PUBLISH (host step): re-check the verdict, push as the bot, find-or-open one PR per ticket. */
    async publish(run: string, verdict: IndependentVerdict, summary: string) {
      const { spec, ws } = await workspaceOf(run)
      const head = await inspect(ws.worktree, ws.base)
      const pid = await patchId(ws.worktree, ws.base)
      if (!verdictStillValid(verdict, { sha: head.sha, patchId: pid })) return { ok: false, evidence: `head ${head.sha.slice(0, 8)} is not the verified ${verdict.sha.slice(0, 8)}: commits after the verdict` }
      const t = host.ticketOf(run as RunKey)
      if (t.closed) return { ok: false, evidence: 'ticket discarded' }
      const token = await botToken(config.botKeychainService)
      const branch = `harness/${spec.ticket.slice(0, 12)}`
      await pushBranch(ws.worktree, spec.repo, head.sha, branch, token)
      const body = [
        summary, '',
        `**Verifica indipendente** (${verdict.verifierModel}, ${verdict.verdict}): ${verdict.evidence}`,
        ...(t.issue && t.issue.repo === spec.repo ? ['', `Closes #${t.issue.number}`] : []),
      ].join('\n')
      const pr = await openPullRequest({ repo: spec.repo, branch, base: spec.baseBranch, title: t.title, body, marker: `${MARKER}pr:${spec.ticket} -->`, token })
      note(`publish ${run} ${head.sha.slice(0, 8)} -> ${pr.url}`)
      return { ok: true, pr: pr.number, url: pr.url }
    },
  }

  const A = await loadAtomic()
  const loader = new A.DefaultResourceLoader({
    cwd: home, agentDir: A.getAgentDir(),
    extensionFactories: [guardExtension(join(logs, 'guard.log'))],
    additionalExtensionPaths: [join(config.pstackDir, 'pi', 'index.ts')],
    additionalSkillPaths: [join(config.pstackDir, 'skills')],
  })
  await loader.reload()
  const { session } = await A.createAgentSession({
    cwd: home, resourceLoader: loader,
    sessionStore: { kind: 'sqlite', path: join(home, 'atomic', 'sessions.sqlite') },
    journal: { path: join(home, 'atomic', 'journal.sqlite') },
    extensionBindings: { humanInput: hostInput(note, (o) => askHost(o)), onDiagnostic: (d: unknown) => note(`diagnostic ${JSON.stringify(d)}`) },
  })
  note(`engine session ${session.sessionId} pid ${process.pid}`)

  const owned = new Map<RunKey, Promise<void>>()
  const atomicOf = new Map<RunKey, string>()
  const quitting = new Set<RunKey>()

  /** A stage question -> one gate per question, then wait in the log for the answer (now, or days later). */
  async function askHost(o: { runId: string; stage: string; questions: { question: string; options: string[] }[]; signal?: AbortSignal }): Promise<(string | undefined)[]> {
    const run = (await session.workflows.getRun(o.runId))?.inputs?.runKey as RunKey | undefined
    if (!run) { note(`question from unknown run ${o.runId}: declined`); return o.questions.map(() => undefined) }
    const opened = openQuestionGates(host, run, o.stage, o.questions)
    if (opened === 'discarded') {
      note(`question in speculative run ${run}: discarded, telling the worker to stop`)
      return o.questions.map(() => SPECULATIVE_STOP)
    }
    const gates = opened.map((g, i) => {
      note(`gate ${g.gate} ${g.isNew ? 'opened' : 'reasked'} run ${run}: ${JSON.stringify(o.questions[i].question)}`)
      if (g.isNew) notify('Harness: una domanda per te', o.questions[i].question)
      return g.gate
    })
    const answers: (string | undefined)[] = gates.map(() => undefined)
    while (answers.some((a) => a === undefined)) {
      if (o.signal?.aborted) break
      gates.forEach((g, i) => { answers[i] ??= host.gateAnswer(g) })
      if (answers.some((a) => a === undefined)) await sleep(2000)
    }
    note(`gates answered run ${run}: ${JSON.stringify(answers)}`)
    return answers
  }

  async function findRun(run: RunKey, known: Set<string>): Promise<string | undefined> {
    for (let i = 0; i < 20; i++) {
      for (const r of await session.workflows.listRuns()) {
        if (known.has(r.runId)) continue
        const d = await session.workflows.getRun(r.runId).catch(() => undefined)
        if (d?.inputs?.runKey === run) return r.runId
      }
      await sleep(500)
    }
    return undefined
  }

  async function watch(run: RunKey, atomic: string): Promise<void> {
    atomicOf.set(run, atomic)
    const seen = new Map<string, string>()
    let d: any
    for (;;) {
      if (quitting.has(run)) return
      d = await session.workflows.getRun(atomic)
      for (const n of nodesOf(d)) {
        if (seen.get(n.name) === n.status) continue
        seen.set(n.name, n.status)
        if (n.status === 'completed' || n.status === 'failed') host.report(run, { kind: 'progress', stage: n.name, summary: n.status })
      }
      if (quitting.has(run)) return   // stop() ended it: a quit run stays `paused` and waitForSettled never resolves for it
      if (TERMINAL.has(d.status)) break
      await sleep(3000)
    }
    await session.workflows.waitForSettled(atomic).catch((e: Error) => note(`waitForSettled ${atomic}: ${e.message}`))
    d = await session.workflows.getRun(atomic)
    writeFileSync(join(logs, `run-${atomic}.json`), JSON.stringify(d, null, 2))
    let outcome = classify(d)
    if (outcome.kind === 'budget') {
      // Keep what the worker committed before the stop: the next attempt starts from it.
      const { ws } = await workspaceOf(run).catch(() => ({ ws: undefined }))
      if (ws) outcome = { ...outcome, sha: (await inspect(ws.worktree, ws.base)).sha }
      const text = budgetNotice(host.ticketOf(run), outcome.spentUsd)
      if (text) notify('Harness: budget esaurito', text)
    }
    await reportEnded(host, home, config.maxAttempts, note, run, outcome, usageOf(d))
    note(`run ${run} ${atomic} ended ${outcome.kind}`)
  }

  /** A stage quit mid-turn has no modelAttempts yet (Atomic 0.9.64, observed 02/11, e2e/int): its cost is only in the stage sessions. */
  async function stoppedUsage(atomic: string): Promise<Usage | undefined> {
    const d = await session.workflows.getRun(atomic).catch(() => undefined)
    if (!d) return undefined
    writeFileSync(join(logs, `run-${atomic}.json`), JSON.stringify(d, null, 2))
    const recorded = usageOf(d)
    if (recorded) return recorded
    const ids = [...new Set<string>((d.stages ?? []).map((x: any) => x.sessionId).filter(Boolean))]
    const store = await A.resolveSessionStore(home, { sessionStore: { kind: 'sqlite', path: join(home, 'atomic', 'sessions.sqlite') } })
    const entries = (await Promise.all(ids.map((id) => store.load(id).then((x: any) => x.entries, () => [])))).flat()
    const since = Number(d.startedAt ?? 0)
    const u = usageOfEntries(entries, since)
    return u && { ...u, durationMs: since && d.pausedAt ? Number(d.pausedAt) - since : 0 }
  }

  let stopping = false
  const lost = (run: RunKey, why: string) => (e: Error) => {
    note(`${why} ${run}: ${e.stack ?? e.message}`)
    // Our own dispose closed the session: the run is paused in Atomic and the next process resumes it.
    if (!stopping) return reportEnded(host, home, config.maxAttempts, note, run, { kind: 'failed', cause: 'error', retryable: true, evidence: `${why}: ${e.message}` })
  }

  async function launch(run: RunKey): Promise<string | undefined> {
    const known = new Set<string>((await session.workflows.listRuns()).map((r: { runId: string }) => r.runId))
    await session.prompt(`/workflow ${WORKFLOW} runKey=${run} --no-picker`)
    const atomic = await findRun(run, known)
    if (!atomic) {
      await reportEnded(host, home, config.maxAttempts, note, run, { kind: 'failed', cause: 'error', retryable: false, evidence: `/workflow ${WORKFLOW} produced no run; see ${join(logs, 'engine.log')}` })
      return undefined
    }
    host.report(run, { kind: 'bound', atomic })
    atomicOf.set(run, atomic)
    note(`run ${run} bound to ${atomic}`)
    return atomic
  }

  return {
    async start(run) {
      if (stopping || owned.has(run)) return
      const atomic = await launch(run)
      if (atomic) owned.set(run, watch(run, atomic).catch(lost(run, 'engine lost the run')))
    },
    owns: (run) => owned.has(run),
    async resume(run, atomic) {
      if (stopping || owned.has(run)) return
      atomicOf.set(run, atomic)
      const p = (async () => {
        for (let i = 0; ; i++) {
          if (quitting.has(run)) return
          const d = await session.workflows.getRun(atomic)
          if (TERMINAL.has(d?.status)) break
          try { note(`resume ${atomic}: ${JSON.stringify(await session.workflows.resume(atomic))}`); break } catch (e) {
            const bindings = host.bindings(run)
            const closed = host.ticketOf(run).closed
            const next = afterResumeError(e, i, bindings, closed !== undefined)
            if (next === 'fail') throw e
            if (next === 'give-up') {
              const evidence = closed
                ? `the ticket was ${closed} before ${atomic} reached its first checkpoint`
                : `${bindings} Atomic runs of this attempt ended before their first checkpoint; the last, ${atomic}, was refused: ${(e as Error).message}`
              note(`run ${run} gave up: ${evidence}`)
              await reportEnded(host, home, config.maxAttempts, note, run, { kind: 'failed', cause: 'error', retryable: false, evidence })
              return
            }
            if (next === 'start-again') {
              note(`resume ${atomic} refused (${(e as Error).message}): nothing to lose, starting ${run} again as the same attempt`)
              note(`abandoned ${atomic}: Atomic 0.9.63 has no call that ends a run (session.workflows offers pause, quit, resume), so it stays non-terminal in Atomic's records`)
              const fresh = await launch(run)
              if (fresh) await watch(run, fresh)
              return
            }
            note(`resume ${atomic} not yet (${(e as Error).message}); retry in 15 s`)
            await sleep(15_000)
          }
        }
        await watch(run, atomic)
      })().catch(lost(run, 'resume failed'))
      owned.set(run, p)
    },
    async stop(run) {
      if (stopping) return 'pending'
      return stopRun({ host, home, maxAttempts: config.maxAttempts, note, workflows: session.workflows, usage: stoppedUsage, quitting }, run, owned.has(run) ? atomicOf.get(run) : undefined)
    },
    async idle() { await Promise.all(owned.values()) },
    /** Never rejects: Atomic's shutdown fails when a stage tool ignores cancellation (observed 02/11, e2e/a1). */
    async dispose() {
      stopping = true
      const t0 = Date.now()
      try {
        await session.dispose()
        note(`engine disposed in ${Date.now() - t0} ms`)
      } catch (e) {
        const causes = e instanceof AggregateError ? e.errors.map((x) => String(x.cause?.message ?? x.message)) : []
        note(`engine dispose failed after ${Date.now() - t0} ms: ${(e as Error).message} ${JSON.stringify(causes)}`)
      }
    },
  }
}

/** Atomic 0.9.63's only refusal that proves zero progress (workflow-tool-control.ts:618-631, :712-720). */
const ZERO_PROGRESS = 'has no durable checkpoint or pending prompt progress'
const MAX_BINDINGS = 5
const WAITABLE = new Set(['WORKFLOW_RUN_OWNED_ELSEWHERE', 'WORKFLOW_RUN_NOT_RESUMABLE', 'WORKFLOW_RUN_STORAGE'])

export function budgetNotice(t: { silent?: true }, spentUsd: number): string | undefined {
  return t.silent ? undefined : `Un ticket si è fermato a ${spentUsd.toFixed(2)} $: rispondi nell'issue se continuare.`
}

export const SPECULATIVE_STOP = 'Nobody will answer: this ticket is speculative and a question ends it. Stop now, change nothing else, and finish with status blocked.'

export function openQuestionGates(host: Pick<EngineHost, 'openGate'>, run: RunKey, stage: string, questions: { question: string; options: string[] }[]): { gate: GateId; isNew: boolean }[] | 'discarded' {
  const opened = questions.map((q, i) => {
    const spec: GateSpec = { kind: 'question', audience: 'requester', question: q.question, ...(q.options.length ? { options: q.options } : {}) }
    return host.openGate(run, stage, i, spec)
  })
  return opened.some((g) => g.discarded) ? 'discarded' : opened
}

export interface StopDeps {
  host: Pick<EngineHost, 'report' | 'runSpec' | 'ticketOf'>
  home: string
  maxAttempts: number
  note: (s: string) => void
  workflows: { quit(atomic: string): Promise<{ status: string }> }
  usage(atomic: string): Promise<Usage | undefined>
  quitting: Set<RunKey>
}

/** Atomic 0.9.63 answers quit with the run `paused` (resumable), never killed (observed 02/11, e2e/a2): the end is ours to report. */
export async function stopRun(d: StopDeps, run: RunKey, atomic: string | undefined): Promise<'quit' | 'ended' | 'pending' | 'refused'> {
  const closed = d.host.ticketOf(run).closed
  const why = closed ? `ticket ${closed}` : 'stopped'
  const end = (evidence: string, usage?: Usage) =>
    reportEnded(d.host, d.home, d.maxAttempts, d.note, run, { kind: 'failed', cause: 'stopped', retryable: false, evidence }, usage)
  if (!atomic) {
    d.note(`stop ${run}: not running here, ended in the log`)
    await end(`${why} while no process ran it`)
    return 'ended'
  }
  if (d.quitting.has(run)) return 'pending'
  try {
    const o = await d.workflows.quit(atomic)
    d.quitting.add(run)
    d.note(`stop ${run}: quit ${atomic} -> ${JSON.stringify(o)}`)
    await end(`${why}, quit in Atomic: ${o.status}`, await d.usage(atomic).catch(() => undefined))
    return 'quit'
  } catch (e) {
    d.note(`stop ${run}: quit ${atomic} refused: ${(e as Error).message}`)
    return 'refused'
  }
}

export async function reportEnded(host: Pick<EngineHost, 'report' | 'runSpec' | 'ticketOf'>, home: string, maxAttempts: number, note: (s: string) => void, run: RunKey, outcome: Outcome, usage?: Usage): Promise<void> {
  host.report(run, { kind: 'ended', outcome, ...(usage ? { usage } : {}) })
  const { spec } = host.runSpec(run)
  if (isFinal(outcome, spec.attempt, maxAttempts) || host.ticketOf(run).closed) await removeWorktree(home, spec).catch((e: Error) => note(`remove worktree ${run}: ${e.message}`))
}

/**
 * Atomic 0.9.63 files refusals that may hide progress under WORKFLOW_RUN_NOT_RESUMABLE: already running
 * (resume-runtime.ts:515-523), resume admission pending (:134-139), stale claim (:412-417, mapped by
 * workflow-control-failure.ts:37-39). OWNED_ELSEWHERE holds until the foreign lease expires (120 s,
 * resume-eligibility.ts:80).
 */
export function afterResumeError(e: unknown, tries: number, bindings: number, ticketClosed: boolean): 'wait' | 'start-again' | 'give-up' | 'fail' {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown }
  if (code === 'WORKFLOW_RUN_NOT_RESUMABLE' && String(message).includes(ZERO_PROGRESS)) return bindings < MAX_BINDINGS && !ticketClosed ? 'start-again' : 'give-up'
  return WAITABLE.has(String(code)) && tries < 20 ? 'wait' : 'fail'
}

// ---------- reading Atomic's run record ----------

/** getRun(id) on 0.9.63 (observed 02/11): `stages[]` with name and status, root outputs in `result`, `durationMs`. */
interface NodeLine { name: string; status: string }
function nodesOf(d: any): NodeLine[] {
  return (d?.stages ?? []).map((n: any) => ({ name: String(n.name), status: String(n.status) }))
}

/** The only reader of Atomic run statuses. */
export function classify(d: any): Outcome {
  const evidence = (s: string) => s.slice(0, 2000)
  if (d.status === 'blocked' || d.failureDisposition === 'active_blocked' || d.result?.status === 'budget_exceeded') {
    return { kind: 'budget', spentUsd: usageOf(d)?.costUsd ?? 0, ...workerSessionOf(d) }
  }
  if (d.status !== 'completed') {
    return { kind: 'failed', cause: d.status === 'killed' ? 'stopped' : 'error', retryable: d.status !== 'killed', evidence: evidence(String(d.error ?? d.exitReason ?? d.status)) }
  }
  const raw = d.result?.attempt
  const child = typeof raw === 'string' ? JSON.parse(raw) : raw
  // A worker that finishes blocked leaves its child blocked too (e2e/a3): only missing or budget outputs are a budget stop.
  if (!child || (child.status === 'blocked' && child.outputs?.status !== 'blocked')) return { kind: 'budget', spentUsd: usageOf(d)?.costUsd ?? 0, ...workerSessionOf(d) }
  const o = child.outputs ?? {}
  const at = { workerSession: o.workerSession, sha: o.sha }
  switch (o.status) {
    case 'done': return { kind: 'done', verdict: JSON.parse(o.verdict), pr: o.pr, url: o.url, sha: o.sha, summary: o.summary, workerSession: o.workerSession }
    case 'verifier-failed': return { kind: 'failed', cause: 'verifier-failed', retryable: true, evidence: evidence(o.evidence), ...at }
    case 'publish-refused': return { kind: 'failed', cause: 'error', retryable: true, evidence: evidence(o.evidence), ...at }
    case 'no-commit': return { kind: 'failed', cause: 'error', retryable: true, evidence: evidence(`worker said verify-ready with no commit: ${o.summary}`), ...at }
    default: return { kind: 'failed', cause: 'error', retryable: false, evidence: evidence(`worker ${o.status ?? 'gave no status'}: ${o.summary ?? ''}`), ...at }
  }
}

/** The work stage's session, so the attempt after a budget stop can resume it. */
function workerSessionOf(d: any): { workerSession?: string } {
  const s = (d?.stages ?? []).find((x: any) => x.name === 'work')?.sessionId
  return s ? { workerSession: String(s) } : {}
}

/** Sum of every model attempt's usage in the run record (Atomic records one per attempt of an explicit-model stage). */
export function usageOf(d: any): Usage | undefined {
  const u: Usage = { costUsd: 0, input: 0, output: 0, cacheRead: 0, turns: 0, durationMs: 0 }
  let found = false
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x.modelAttempts)) for (const a of x.modelAttempts) {
      if (!a?.usage) continue
      found = true
      u.costUsd += a.usage.cost ?? 0; u.input += a.usage.input ?? 0; u.output += a.usage.output ?? 0
      u.cacheRead += a.usage.cacheRead ?? 0; u.turns += a.usage.turns ?? 0
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object' && v !== x.modelAttempts) walk(v)
  }
  walk(d)
  u.durationMs = Number(d?.durationMs ?? 0)
  const raw = d?.result?.attempt
  const verifierUsd = Number((typeof raw === 'string' ? JSON.parse(raw) : raw)?.outputs?.verifierUsd ?? 0)
  if (verifierUsd) u.verifierUsd = verifierUsd
  return found ? u : undefined
}

/** Assistant turns of stage sessions since the run started: a forked session also holds its parent's older turns. */
export function usageOfEntries(entries: readonly any[], since: number): Usage | undefined {
  const turns = entries.filter((e) => e?.type === 'message' && e.message?.role === 'assistant' && e.message.usage && Date.parse(e.timestamp) >= since)
  if (!turns.length) return undefined
  const u: Usage = { costUsd: 0, input: 0, output: 0, cacheRead: 0, turns: turns.length, durationMs: 0 }
  for (const { message: { usage: x } } of turns) {
    u.costUsd += x.cost?.total ?? 0; u.input += x.input ?? 0; u.output += x.output ?? 0; u.cacheRead += x.cacheRead ?? 0
  }
  return u
}

// ---------- the guard and the human-input adapter ----------

/**
 * The guard, in the engine session and every stage. First line against accidents, not a boundary
 * (the boundary is the `harness` user, deferred to before unit 11). It also logs whether the stage
 * system prompt carries the pstack mandate: that is the unit 4 proof that pstack reached the worker.
 */
export function guardExtension(path: string) {
  const log = (s: string) => appendFileSync(path, `${new Date().toISOString()} ${s}\n`)
  const BLOCK: [RegExp, string][] = [
    [/(^|[\s;&|(])git\s+push\b/, 'git push is reserved for the publish step'],
    [/(^|[\s;&|(])git\s+remote\s+(add|set-url|remove|rm)\b/, 'remotes are not the worker\'s'],
    [/(^|[\s;&|(])gh\s/, 'gh is reserved for the harness'],
    [/(^|[\s;&|(])security\s/, 'the keychain is off limits'],
    [/(^|[\s;&|(])(curl|wget)\s[^|;&]*(-d\b|--data|-X\s*(POST|PUT|PATCH|DELETE)|--upload-file|-T\s)/, 'no outbound writes'],
    [/(^|[\s;&|(])(launchctl|sudo|osascript)\s/, 'no system changes'],
  ]
  return (pi: any) => {
    pi.on('project_trust', async () => ({ trusted: true }))
    pi.on('turn_start', async (_e: unknown, ctx: any) => {
      const sp = String(ctx.getSystemPrompt?.() ?? '')
      log(`turn_start cwd=${ctx.cwd} mandate=${sp.includes('<pstack-session-start>')} poteto=${sp.includes('poteto-mode')} askoff=${sp.includes('pi ask tool: off')}`)
    })
    pi.on('tool_call', async (event: any, ctx: any) => {
      const cmd = event.toolName === 'bash' ? String(event.input?.command ?? '') : ''
      const hit = BLOCK.find(([re]) => re.test(cmd))
      log(`tool_call ${event.toolName} cwd=${ctx.cwd} ${hit ? 'BLOCKED ' : ''}${JSON.stringify(cmd).slice(0, 300)}`)
      if (hit) return { block: true, reason: `HARNESS-GUARD: ${hit[1]}` }
      if ((event.toolName === 'edit' || event.toolName === 'write') && ctx.cwd) {
        const p = String(event.input?.path ?? event.input?.file_path ?? '')
        if (p.startsWith('/') && !p.startsWith(ctx.cwd + '/')) return { block: true, reason: 'HARNESS-GUARD: edits stay inside the worktree' }
      }
    })
  }
}

type Ask = (o: { runId: string; stage: string; questions: { question: string; options: string[] }[]; signal?: AbortSignal }) => Promise<(string | undefined)[]>

/**
 * Atomic HostInput -> gates. Atomic's own "ready for the next stage?" gets its first option (E2E S2).
 * A worker question (ask_user_question -> questionnaire, or select) becomes one gate per question and
 * waits for gate.answered. An answer that is an option label goes back as that option, anything else
 * as free text ("custom"). confirm has no caller yet (the guard blocks instead of asking): declined.
 */
export function hostInput(note: (s: string) => void, ask: Ask) {
  const where = (o: any) => ({ runId: String(o?.workflowRunId ?? ''), stage: String(o?.workflowStageId ?? ''), signal: o?.signal as AbortSignal | undefined })
  const continuation = (q: string) => /next stage|move on/i.test(q)
  return {
    async select(title: string, choices: string[], o: any) {
      if (continuation(title)) { note(`continuation ${JSON.stringify(title)} -> ${JSON.stringify(choices[0])}`); return choices[0] }
      const [a] = await ask({ ...where(o), questions: [{ question: title, options: choices }] })
      if (a === SPECULATIVE_STOP) return undefined
      return a !== undefined && choices.includes(a) ? a : choices[0]
    },
    async confirm(title: string, message: string, o: any) { note(`confirm DECLINED ${JSON.stringify([title, message, where(o).runId])}`); return false },
    async input(title: string, _p: string, o: any) { const [a] = await ask({ ...where(o), questions: [{ question: title, options: [] }] }); return a },
    async editor(title: string, _i: string, o: any) { const [a] = await ask({ ...where(o), questions: [{ question: title, options: [] }] }); return a },
    async questionnaire(params: any, o: any) {
      const qs: { question: string; options?: { label: string }[] }[] = params?.questions ?? []
      if (qs.length === 1 && continuation(qs[0].question) && qs[0].options?.[0]) {
        note(`continuation -> ${qs[0].options[0].label}`)
        return { cancelled: false, answers: [{ questionIndex: 0, question: qs[0].question, kind: 'option', answer: qs[0].options[0].label }] }
      }
      const questions = qs.map((q) => ({ question: q.question, options: (q.options ?? []).map((x) => x.label) }))
      const answers = await ask({ ...where(o), questions })
      if (answers.some((a) => a === undefined)) return { cancelled: true, answers: [] }
      return {
        cancelled: false,
        answers: questions.map((q, i) => ({ questionIndex: i, question: q.question, kind: q.options.includes(answers[i]!) ? 'option' : 'custom', answer: answers[i] })),
      }
    },
  }
}

/** macOS notification when a gate opens: Vlad's attention is the scarce resource. Best effort. */
function notify(title: string, text: string): void {
  const esc = (x: string) => x.replace(/["\\]/g, '\\$&').slice(0, 200)
  execFile('osascript', ['-e', `display notification "${esc(text)}" with title "${esc(title)}"`], () => {})
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
