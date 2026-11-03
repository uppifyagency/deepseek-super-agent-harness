// service.ts: the harness as pure rules over the log, behind one object: intake and the code filter
// (stage one of the two-stage filter), policy, recall, and the router/outbox port (routing.ts).
// No GitHub import, no Atomic import.

import { threadKey } from './domain.ts'
import type { Draft, Event, EventId, Hash, Repo, ThreadRef, TicketId, TriggerBody } from './domain.ts'
import { hash, idOf } from './log.ts'
import type { Log, Reader, View } from './log.ts'
import type { HarnessConfig, Listen, RepoConfig } from './config.ts'
import { BOARD_VIEWS, ROUTING_VIEWS, attentionView, board, composeReply, issueView, parseThread, routerView, decide, openEvalCards, openEvals, outboxView, reply, settle, ticketLine, triggerCard } from './routing.ts'
import { GATE_VIEWS, answerGate, gateIdOf, gatesForRouter, gatesView, openGate } from './gates.ts'
import type { AttentionItem, Board, DecideResult, EvalCard, OutboxItem, RouterDecision, TriggerCard } from './routing.ts'
import type { GateId, GateSpec, Outcome, ReplyPurpose, RunKey, RunSpec, Usage } from './domain.ts'
import { RUN_VIEWS, deliveredInputs, liveRuns, runsToStart, runsToStop, pendingInputs, planRuns, reportDrafts, resultsForRouter, runsView, stopDrafts, stuckItems } from './runs.ts'
import type { EngineReport, ResultCard, RunLine, StuckItem } from './runs.ts'

/** What a source hands in, already parsed from the wire (boundary: github.ts). */
export interface TriggerDraft {
  thread: (ThreadRef & { kind: 'issue' }) | { kind: 'system'; name: 'operator' }
  native: { id: string; version: string }
  actor: string
  human: boolean
  text: string
  url: string
  createdAt: string
  correlates: ThreadRef[]
}

export type IngestResult = 'duplicate' | 'filtered' | 'to-ticket' | 'to-router'
export type Mode = 'off' | 'observe' | 'auto'

// ---------- the code filter: pure, no LLM ----------

export interface FilterInput {
  repoListen: Listen | undefined        // undefined = repo not in config
  mode: Mode
  actor: string
  human: boolean
  addressed: boolean
  subscribed: boolean                   // the thread already has a ticket subscriber
  text: string
  candidateMatch?: string
  beforeSpeculativeOn: boolean
}
export type FilterResult = { pass: true; reason: 'follow-up' | 'addressed' | 'candidate' } | { pass: false; reason: string }

/** Stage one of the article's two-stage filter. First matching row wins. */
export function filter(t: FilterInput, c: Pick<HarnessConfig, 'allowedActors' | 'marker'>): FilterResult {
  if (t.mode === 'off') return { pass: false, reason: 'policy-off' }
  if (t.repoListen === undefined) return { pass: false, reason: 'repo-not-listed' }
  if (t.repoListen === 'ignore') return { pass: false, reason: 'repo-ignored' }
  if (t.text.includes(c.marker)) return { pass: false, reason: 'own-message' }
  if (!t.human) return { pass: false, reason: 'bot' }
  if (t.subscribed) return { pass: true, reason: 'follow-up' }
  if (!c.allowedActors.includes(t.actor)) return { pass: false, reason: 'actor-not-allowed' }
  if (t.addressed) return { pass: true, reason: 'addressed' }
  if (t.repoListen === 'candidates' && t.beforeSpeculativeOn) return { pass: false, reason: 'before-speculative' }
  if (t.repoListen === 'candidates') return t.candidateMatch && !new RegExp(t.candidateMatch, 'i').test(t.text) ? { pass: false, reason: 'not-a-candidate' } : { pass: true, reason: 'candidate' }
  return { pass: false, reason: 'not-addressed' }
}

/** A handle counts only as a whole token: "/harness fix it" yes, "/harnessing" no. */
export function addresses(text: string, handles: readonly string[]): boolean {
  return handles.some((h) => new RegExp(`(^|\\s)${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,:;!?])`, 'm').test(text))
}

// ---------- views (state is only these folds) ----------

export interface PolicyState { mode: Mode; maxWorkers: 1 | 2 | 3 }
export const policyView: View<PolicyState> = {
  name: 'policy', version: 2, init: { mode: 'observe', maxWorkers: 2 },
  parts: (e) => (e.kind === 'policy.set' ? ['policy'] : []),
  evolve: (_s, e) => { const b = (e as Event<'policy.set'>).body; return { mode: b.mode, maxWorkers: b.maxWorkers } },
}

/** Counts per filter reason, for `harness status`. One global part. */
export const filterStats: View<Record<string, number>> = {
  name: 'filterStats', version: 1, init: {},
  parts: (e) => (e.kind === 'trigger.filtered' ? ['all'] : []),
  evolve: (s, e) => {
    const b = (e as Event<'trigger.filtered'>).body
    const k = `${b.pass ? 'pass' : 'drop'}:${b.reason}`
    return { ...s, [k]: (s[k] ?? 0) + 1 }
  },
}

export const VIEWS = [policyView, filterStats, ...ROUTING_VIEWS, ...BOARD_VIEWS, ...RUN_VIEWS, ...GATE_VIEWS] as View<unknown>[]

// ---------- recall: Chain of Recall over the reference graph ----------

export interface Card { id: string; kind: string; preview: string; next: readonly { id: string; rel: string; preview: string }[] }

function previewOf(read: Reader, e: Event): string {
  switch (e.kind) {
    case 'trigger': {
      const b = (e as Event<'trigger'>).body
      return `${b.actor}${b.addressed ? ' (addressed)' : ''}: ${b.text.preview.replace(/\s+/g, ' ').slice(0, 120)}`
    }
    case 'trigger.filtered': {
      const b = (e as Event<'trigger.filtered'>).body
      return `${b.pass ? 'PASS' : 'DROP'} ${b.reason}`
    }
    case 'decided': {
      const d = (e as Event<'decided'>).body.decision
      return d.kind === 'accept' || d.kind === 'would-accept' ? `${d.kind}: ${d.title}` : d.kind === 'ignore' ? `ignore: ${d.reason}` : d.kind
    }
    case 'ticket.opened': { const b = (e as Event<'ticket.opened'>).body; return `ticket "${b.title}": ${b.scope.slice(0, 120)}` }
    case 'subscribed': return `subscribed to ticket ${(e as Event<'subscribed'>).body.ticket}`
    case 'ticket.promoted': return `promoted to visible (${(e as Event<'ticket.promoted'>).body.via})`
    case 'ticket.closed': { const b = (e as Event<'ticket.closed'>).body; return `closed ${b.outcome}${b.reason ? `: ${b.reason}` : ''}` }
    case 'reply.intended': { const b = (e as Event<'reply.intended'>).body; return `${b.purpose} -> ${threadKey(b.to)}: ${b.text.replace(/\s+/g, ' ').slice(0, 120)}` }
    case 'run.intended': { const b = (e as Event<'run.intended'>).body; return `attempt ${b.attempt} on ${b.repo}${b.inputs?.length ? ` with ${b.inputs.length} follow-up(s)` : ''}` }
    case 'run.progress': { const b = (e as Event<'run.progress'>).body; return `${b.stage}: ${b.summary}` }
    case 'run.ended': {
      const o = (e as Event<'run.ended'>).body.outcome
      return o.kind === 'done' ? `done: PR #${o.pr} ${o.url}` : o.kind === 'failed' ? `failed (${o.cause}): ${o.evidence.replace(/\s+/g, ' ').slice(0, 120)}` : `stopped by budget at $${o.spentUsd.toFixed(2)}`
    }
    case 'input.routed': return `follow-up: ${(e as Event<'input.routed'>).body.preview.preview.replace(/\s+/g, ' ').slice(0, 120)}`
    case 'gate.opened': return `question: ${(e as Event<'gate.opened'>).body.spec.question}`
    case 'gate.answered': return `answer: ${(e as Event<'gate.answered'>).body.answer}`
    case 'watchdog.judged': { const b = (e as Event<'watchdog.judged'>).body; return `${b.verdict}: ${b.evidence.replace(/\s+/g, ' ').slice(0, 120)}` }
    case 'stop.intended': return `stop: ${(e as Event<'stop.intended'>).body.reason.replace(/\s+/g, ' ').slice(0, 120)}`
    default: return e.kind
  }
}

/** Chain of Recall: a thread key (issue:owner/name#n, ticket:<id>) lists its events; an event id shows itself, its thread, causes and effects. */
export function recall(read: Reader, id: string): Card | undefined {
  const m = /^issue:(.+)#(\d+)$/.exec(id) ?? /^ticket:([0-9a-f]+)$/.exec(id)
  if (m) {
    const thread: ThreadRef = id.startsWith('issue:') ? { kind: 'issue', repo: m[1] as Repo, number: Number(m[2]) } : { kind: 'ticket', ticket: m[1] as TicketId }
    const events = read.thread(thread)
    if (events.length === 0) return undefined
    let preview = `${events.length} events`
    if (thread.kind === 'issue') { const s = read.view(issueView, id); preview += `, ${s.triggers} triggers, ${s.filtered} dropped${s.subscriber ? `, ticket ticket:${s.subscriber}` : ''}` }
    return { id, kind: 'thread', preview, next: events.map((e) => ({ id: e.id, rel: e.kind, preview: previewOf(read, e) })) }
  }
  const e = read.event(id as EventId)
  if (!e) return undefined
  return {
    id: e.id, kind: e.kind,
    preview: e.kind === 'trigger' ? `${previewOf(read, e)}\n\n${read.text((e as Event<'trigger'>).body.text)}` : previewOf(read, e),
    next: [
      { id: threadKey(e.thread), rel: 'thread', preview: '' },
      ...read.causes(e.id).map((c) => ({ id: c.id, rel: 'cause', preview: previewOf(read, c) })),
      ...read.effects(e.id).map((c) => ({ id: c.id, rel: 'effect', preview: previewOf(read, c) })),
    ],
  }
}

// ---------- the harness object ----------

export interface Harness {
  ingest(t: TriggerDraft): IngestResult
  recall(id: string): Card | undefined
  status(): { mode: Mode; maxWorkers: number; policy: Hash; head: number; filter: Record<string, number>; waitingForRouter: number; outbox: number }
  /** True when the router has something to decide (unrouted triggers or an undecided eval). */
  routerHasWork(): boolean
  /** The router's view: opens evals for everything that piled up, returns every open eval and the
   *  board (open tickets, recent decisions, recent talk with Vlad), so a rotated session needs no memory. */
  next(): { mode: Mode; board: Board; evals: EvalCard[]; gates: GateCard[]; results: ResultCard[] }
  decide(evalId: string, d: RouterDecision): DecideResult
  reply(to: string, purpose: ReplyPurpose, text: string, about?: string): { ok: true; intent: string } | { ok: false; problem: string }
  pending(): Record<string, OutboxItem>
  settle(intent: string, result: 'sent' | 'gone', url?: string): void
  attention(): (Exclude<AttentionItem, { kind: 'discarded' }> | DiscardedItem | GateItem | StuckItem)[]
  /** stop.intended for every run the watchdog judged stuck or drifting (once per run); returns runsToStop(). */
  intendStops(): RunKey[]
  /** Runs to end now: a closed ticket's run, or a live run whose stop still stands. Read again right before each quit: a gate can open meanwhile. */
  runsToStop(): RunKey[]
  /** Vlad talks to the router from the terminal: a trigger on system:operator. */
  ask(text: string, requestId: string): IngestResult
  /** maxWorkers kept as is when omitted. */
  setPolicy(mode: Mode, requestId: string, maxWorkers?: 1 | 2 | 3): void
  /** Unbound live runs that may start now: oldest first, while bound live runs stay under maxWorkers. */
  runsToStart(): RunKey[]
  /** run.intended for every open ticket without a run; returns the new RunKeys. */
  planRuns(): RunKey[]
  /** Runs intended and not ended on an open ticket, with the Atomic id once bound. */
  liveRuns(): { run: RunKey; spec: RunSpec; atomic?: string }[]
  /** The engine's only way in. Idempotent. */
  report(run: RunKey, r: EngineReport): void
  /** Spec and brief text of one run, for the workflow (through the engine bridge). */
  runSpec(run: RunKey): { spec: RunSpec; brief: string }
  openGate(run: RunKey, stage: string, index: number, spec: GateSpec): { gate: GateId; isNew: boolean; discarded?: true }
  gateAnswer(gate: GateId): string | undefined
  /** The router (normalized from a comment) or Vlad (`harness answer`) answers a gate. */
  answer(gate: string, text: string, by: 'router' | 'human', requestId: string): { ok: true; already?: boolean } | { ok: false; problem: string }
  ticketOf(run: RunKey): { title: string; silent?: true; issue?: { repo: string; number: number }; closed?: Event<'ticket.closed'>['body']['outcome'] }
  /** Follow-ups routed to the run's ticket and not delivered yet (unit 7). */
  pendingInputs(run: RunKey): { input: string; text: string }[]
  /** What the ticket asks now: the run's brief plus every follow-up the worker received (the verifier's reference). */
  requirements(run: RunKey): string
  bindings(run: RunKey): number
  /** Every run with its outcome and usage, for `harness work`. */
  runs(): Record<string, RunLine & { usage?: Usage; outcome?: Outcome }>
}

/** A worker question waiting for an answer, as the router sees it. `about` goes into reply() when asking in the issue. */
export interface GateCard { gate: string; about: string; to?: string; question: string; options?: string[]; asked: boolean; replies: TriggerCard[] }
export interface GateItem { kind: 'gate'; gate: string; thread: string; question: string; options: string[] }
export interface DiscardedItem { kind: 'discarded'; ticket: string; thread: string; title: string; reason: string }

export const SPECULATIVE_TITLE = '[speculativa] '
export const PROMOTED_STEER = 'The requester called the harness on this issue: this ticket is no longer speculative. If your brief has the speculative rule (only a small fix, otherwise blocked), drop it and work this as a normal ticket. If your budget runs out, the requester is asked whether to raise it. Their message:'
export const PROMOTED_ACK = "Ci stavo gia' lavorando in anticipo. Da ora seguo questo ticket qui: ti scrivo quando la PR e' pronta."


export function policyHash(c: HarnessConfig, mode: Mode): Hash {
  return hash('policy-v1', mode, c.repos, [...c.allowedActors].sort(), [...c.handles].sort())
}

const POLICY: ThreadRef = { kind: 'system', name: 'policy' }
const lastSpeculativeSet = (read: Reader, repo: Repo) =>
  (read.thread(POLICY, { kinds: ['speculative.set'] }) as Event<'speculative.set'>[]).filter((e) => e.body.repo === repo).at(-1)
const speculativeSince = (read: Reader, repo: Repo): string | undefined => {
  const last = lastSpeculativeSet(read, repo)
  return last?.body.enabled ? last.at : undefined
}

function recordSpeculative(read: Reader, repos: readonly RepoConfig[]): Draft[] {
  return repos.flatMap((r) => {
    const last = lastSpeculativeSet(read, r.repo)
    const enabled = r.speculative !== undefined
    if ((last?.body.enabled ?? false) === enabled) return []
    return [{ thread: POLICY, kind: 'speculative.set', by: 'daemon', cause: last ? [last.id] : [], body: { repo: r.repo, enabled } } as Draft<'speculative.set'>]
  })
}

export function openHarness(log: Log, config: HarnessConfig): Harness {
  const repoConfig = new Map<string, RepoConfig>(config.repos.map((r) => [r.repo, r]))
  const repoOf = (r: Repo) => repoConfig.get(r)
  log.transact((read) => recordSpeculative(read, config.repos))

  function ingest(t: TriggerDraft): IngestResult {
    let result: IngestResult = 'duplicate'
    log.transact((read) => {
      const body: TriggerBody = {
        native: t.native, actor: t.actor, human: t.human,
        addressed: addresses(t.text, config.handles),
        text: log.spill(t.text), url: t.url, correlates: t.correlates,
      }
      const trigger = { thread: t.thread, kind: 'trigger', by: 'source', cause: [], body } as Draft<'trigger'>
      const tid = idOf(trigger)
      if (read.event(tid)) { result = 'duplicate'; return [] }

      const issue = read.view(issueView, threadKey(t.thread))
      const mode = read.view(policyView, 'policy').mode
      const repo = t.thread.kind === 'issue' ? repoOf(t.thread.repo) : undefined
      const owner = issue.subscriber ? ticketLine(read, issue.subscriber) : undefined
      const since = repo?.speculative ? speculativeSince(read, repo.repo) : undefined
      const called = body.addressed && config.allowedActors.includes(t.actor)
      const subscriber = owner?.closed === 'discarded' && called ? undefined : issue.subscriber
      const f = filter({
        repoListen: t.thread.kind === 'system' ? 'explicit' : repo?.listen, mode,
        actor: t.actor, human: t.human, addressed: body.addressed,
        subscribed: subscriber !== undefined, text: t.text, candidateMatch: repo?.candidateMatch,
        beforeSpeculativeOn: since !== undefined && Date.parse(t.createdAt) < Date.parse(since),
      }, config)
      const filtered = {
        thread: t.thread, kind: 'trigger.filtered', by: 'daemon', cause: [tid],
        body: { trigger: tid, pass: f.pass, reason: f.reason, policy: policyHash(config, mode) },
      } as Draft<'trigger.filtered'>
      result = !f.pass ? 'filtered' : subscriber ? 'to-ticket' : 'to-router'
      // A follow-up goes to its ticket in code, no router turn (unit 7). While a worker question is
      // asked on this thread, a comment is read as the answer to it (gates.ts), not as new input.
      if (f.pass && f.reason === 'follow-up' && subscriber) {
        const ticket = { kind: 'ticket', ticket: subscriber as TicketId } as const
        const routed = { thread: ticket, kind: 'input.routed', by: 'daemon', cause: [tid], body: { trigger: tid, preview: body.text } } as Draft<'input.routed'>
        if (called && owner?.visibility === 'silent' && !owner.closed) {
          const ack = composeReply(t.thread, PROMOTED_ACK, config.marker)
          if (!ack.ok) throw new Error(ack.problem)
          return [trigger, filtered,
            { thread: ticket, kind: 'ticket.promoted', by: 'daemon', cause: [tid], body: { via: 'handle' } } as Draft<'ticket.promoted'>,
            { ...routed, body: { trigger: tid, preview: log.spill(`${PROMOTED_STEER}\n\n${t.text}`) } },
            { thread: t.thread, kind: 'reply.intended', by: 'daemon', cause: [tid], body: { to: t.thread, purpose: 'ack', text: ack.text } } as Draft<'reply.intended'>]
        }
        const key = threadKey(t.thread)
        const answering = Object.values(read.view(gatesView, 'all').gates).some((g) => g.to === key && g.asked && g.answer === undefined)
        if (!answering) return [trigger, filtered, routed]
      }
      return [trigger, filtered]
    })
    return result
  }

  const mode = () => log.read.view(policyView, 'policy').mode
  const waiting = () => Object.values(log.read.view(routerView, 'all').threads)

  return {
    ingest,
    recall: (id) => recall(log.read, id),
    status: () => ({
      mode: mode(), maxWorkers: log.read.view(policyView, 'policy').maxWorkers, policy: policyHash(config, mode()), head: log.read.head(),
      filter: log.read.view(filterStats, 'all'),
      waitingForRouter: waiting().reduce((n, p) => n + p.unrouted.length + (p.openEval ? 1 : 0), 0),
      outbox: Object.keys(log.read.view(outboxView, 'all').pending).length,
    }),
    routerHasWork: () => waiting().some((p) => p.unrouted.length > 0 || p.openEval) || gatesForRouter(log.read).length > 0 || resultsForRouter(log.read, config.maxAttempts).length > 0,
    next: () => {
      log.transact((read) => openEvals(read, policyHash(config, read.view(policyView, 'policy').mode)))
      return { mode: mode(), board: board(log.read), evals: openEvalCards(log.read, repoOf), gates: gatesForRouter(log.read).map((g) => ({ gate: g.gate, about: g.opened, to: g.to, question: g.spec.question, options: g.spec.options, asked: g.asked, replies: g.replies.map((t) => triggerCard(log.read, t)) })), results: resultsForRouter(log.read, config.maxAttempts) }
    },
    decide: (evalId, d) => {
      let result: DecideResult = { ok: false, problem: 'not run' }
      log.transact((read) => { const r = decide(read, evalId, d, read.view(policyView, 'policy').mode, repoOf); result = r.result; return r.drafts })
      return result
    },
    reply: (to, purpose, text, about) => {
      let result: ReturnType<Harness['reply']> = { ok: false, problem: 'not run' }
      log.transact((read) => { const r = reply(read, to, purpose, text, about, config.marker, repoOf); result = r.result; return r.drafts })
      return result
    },
    pending: () => log.read.view(outboxView, 'all').pending,
    settle: (intent, result, url) => { log.transact((read) => settle(read, intent, result, url)) },
    attention: () => [
      ...log.read.view(attentionView, 'all').items.map((i) => {
        if (i.kind !== 'discarded') return i
        const l = ticketLine(log.read, i.ticket)
        return { ...i, thread: l?.thread ?? '', title: l?.title ?? '' }
      }),
      ...Object.values(log.read.view(gatesView, 'all').gates).filter((g) => g.answer === undefined).map((g) => ({ kind: 'gate' as const, gate: g.gate, thread: g.to ?? '', question: g.spec.question, options: g.spec.options ?? [] })),
      ...stuckItems(log.read),
    ],
    intendStops: () => {
      log.transact(stopDrafts)
      return runsToStop(log.read)
    },
    runsToStop: () => runsToStop(log.read),
    openGate: (run, stage, index, spec) => {
      const gate = gateIdOf(run, stage, index, spec)
      let discarded = false
      const added = log.transact((read) => {
        const ticket = (read.event(run as string as EventId) as Event<'run.intended'>).body.ticket
        const l = ticketLine(read, ticket)
        if (l?.visibility !== 'silent') return openGate(read, run, gate, spec)
        discarded = true
        if (l.closed) return []
        return [{ thread: { kind: 'ticket', ticket }, kind: 'ticket.closed', by: 'daemon', cause: [run as string as EventId], body: { outcome: 'discarded', reason: `question: ${spec.question.replace(/\s+/g, ' ').slice(0, 120)}` } } as Draft<'ticket.closed'>]
      })
      return discarded ? { gate, isNew: false, discarded: true } : { gate, isNew: added.length > 0 }
    },
    gateAnswer: (gate) => log.read.view(gatesView, 'all').gates[gate]?.answer,
    answer: (gate, text, by, requestId) => {
      let result: ReturnType<Harness['answer']> = { ok: false, problem: 'not run' }
      log.transact((read) => { const r = answerGate(read, gate, text, by, requestId); result = r.result; return r.drafts })
      return result
    },
    ask: (text, requestId) => ingest({
      thread: { kind: 'system', name: 'operator' },
      native: { id: `ask:${requestId}`, version: hash('ask', text) },
      actor: config.allowedActors[0], human: true,
      text: `${config.handles[0]} ${text}`, url: '', createdAt: new Date().toISOString(), correlates: [],
    }),
    planRuns: () => log.transact((read) => planRuns(read, config, (t) => log.spill(t))).filter((e) => e.kind === 'run.intended').map((e) => e.id as string as RunKey),
    liveRuns: () => liveRuns(log.read),
    requirements: (run) => {
      const e = log.read.event(run as string as EventId) as Event<'run.intended'>
      const later = deliveredInputs(log.read, e.body.ticket)
      const brief = log.read.text(e.body.brief)
      return later.length === 0 ? brief : `${brief}\n\nMessages from the requester delivered to the worker during the work, oldest first. Where they conflict with the request above, the later message wins:\n${later.map((t) => `> ${t.replace(/\n/g, '\n> ')}`).join('\n\n')}`
    },
    pendingInputs: (run) => pendingInputs(log.read, (log.read.event(run as string as EventId) as Event<'run.intended'>).body.ticket),
    ticketOf: (run) => {
      const spec = (log.read.event(run as string as EventId) as Event<'run.intended'>).body
      const l = ticketLine(log.read, spec.ticket)!
      const issue = l.thread ? parseThread(l.thread) : undefined
      return {
        title: `${l.visibility === 'silent' ? SPECULATIVE_TITLE : ''}${l.title}`,
        ...(l.visibility === 'silent' ? { silent: true as const } : {}),
        ...(issue?.kind === 'issue' ? { issue: { repo: issue.repo, number: issue.number } } : {}),
        ...(l.closed ? { closed: l.closed } : {}),
      }
    },
    runs: () => Object.fromEntries(Object.values(log.read.view(runsView, 'all').runs).map((r) => {
      const ended = log.read.effects(r.run as EventId).find((e) => e.kind === 'run.ended') as Event<'run.ended'> | undefined
      return [r.run, { ...r, outcome: ended?.body.outcome, usage: ended?.body.usage }]
    })),
    report: (run, r) => { log.transact((read) => reportDrafts(read, run, r, config.marker)) },
    bindings: (run) => log.read.effects(run as string as EventId).filter((e) => e.kind === 'run.bound').length,
    runSpec: (run) => {
      const e = log.read.event(run as string as EventId)
      if (e?.kind !== 'run.intended') throw new Error(`no run.intended ${run}`)
      return { spec: e.body, brief: log.read.text(e.body.brief) }
    },
    runsToStart: () => runsToStart(log.read, log.read.view(policyView, 'policy').maxWorkers),
    setPolicy: (m, requestId, workers) => {
      log.transact((read) => [{ thread: { kind: 'system', name: 'policy' }, kind: 'policy.set', by: 'human', cause: [], body: { mode: m, maxWorkers: workers ?? read.view(policyView, 'policy').maxWorkers, requestId } } as Draft<'policy.set'>])
    },
  }
}
