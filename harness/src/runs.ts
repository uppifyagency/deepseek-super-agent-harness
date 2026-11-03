// runs.ts: the run lifecycle as rules over the log (unit 4). No Atomic import, no git.
//   ticket.opened -> run.intended (planRuns) -> engine: run.bound, run.progress, run.ended (reportDrafts)
// RunKey is the id of its run.intended, so replanning the same ticket gives the same key.

import { threadKey } from './domain.ts'
import type { AtomicRunId, Budget, Draft, Event, EventId, GateSpec, Outcome, RunKey, RunSpec, Text, ThreadRef, TicketId, Usage } from './domain.ts'
import { idOf } from './log.ts'
import type { Reader, View } from './log.ts'
import { gateIdOf, gatesView, openGate } from './gates.ts'
import type { HarnessConfig } from './config.ts'
import { composeReply, parseThread, ticketLine, ticketsView } from './routing.ts'
import type { TicketLine } from './routing.ts'

export type EngineReport =
  | { kind: 'bound'; atomic: string }
  | { kind: 'progress'; stage: string; summary: string }
  | { kind: 'delivered'; input: string }
  | { kind: 'ended'; outcome: Outcome; usage?: Usage }

export interface RunLine { run: string; ticket: string; attempt: number; atomic?: string; stage?: string; ended?: Outcome['kind'] }

/** Every run, keyed by RunKey. One global part: a person's harness has few runs. */
export const runsView: View<{ runs: Record<string, RunLine> }> = {
  name: 'runs', version: 1, init: { runs: {} },
  parts: (e) => (e.kind.startsWith('run.') ? ['all'] : []),
  evolve: (s, e) => {
    const runs = { ...s.runs }
    switch (e.kind) {
      case 'run.intended': {
        const b = (e as Event<'run.intended'>).body
        const replaced = runs[e.cause[0]]
        if (replaced && !replaced.ended && !replaced.atomic) delete runs[e.cause[0]]
        runs[e.id] = { run: e.id, ticket: b.ticket, attempt: b.attempt }
        break
      }
      case 'run.bound': { const b = (e as Event<'run.bound'>).body; if (runs[b.run]) runs[b.run] = { ...runs[b.run], atomic: b.atomic }; break }
      case 'run.progress': { const b = (e as Event<'run.progress'>).body; if (runs[b.run]) runs[b.run] = { ...runs[b.run], stage: b.stage }; break }
      case 'run.ended': { const b = (e as Event<'run.ended'>).body; if (runs[b.run]) runs[b.run] = { ...runs[b.run], ended: b.outcome.kind }; break }
    }
    return { runs }
  },
}

export const RUN_VIEWS = [runsView] as View<unknown>[]

/** The worker's brief. Built from the log only: the ticket the router accepted and the words of the issue. */
export function composeBrief(t: { title: string; scope: string; repo: string; thread?: string }, request: readonly string[]): string {
  return [
    `You are a worker of Vlad's harness. Ticket: "${t.title}" on ${t.repo}${t.thread ? ` (${t.thread})` : ''}.`,
    `Done when: ${t.scope}`,
    '',
    'The request, verbatim from the issue:',
    ...request.map((r) => `> ${r.replace(/\n/g, '\n> ')}`),
    '',
    'Rules for this attempt:',
    '- Your cwd is a git worktree made for this ticket. You have full autonomy inside it; work only there.',
    '- Work the pstack way (poteto-mode).',
    '- Commit your work with git when it is done. Never push, never run gh, never change remotes: publishing is a later step that is not yours.',
    '- If only a human can unblock you (a fact, a choice that is theirs), ask with the ask_user_question tool: the question reaches them in the issue and the answer comes back to you. Ask only then, and offer options when you can.',
    '- Do not spawn subagents.',
    '- Finish with the final-answer tool: status "verify-ready" when the work is committed and ready for an independent check, or "blocked"; plus a short summary. Another model then verifies your commits; if it finds a problem you get another attempt with its reasons.',
  ].join('\n')
}

const SPECULATIVE_BRIEF = 'This ticket is speculative: nobody asked the harness for it, and nothing is shown to anyone unless an independent check passes. First confirm the problem (reproduce it). Deliver only a small fix you confirmed. If you cannot confirm the problem, or the fix is not small, finish with status blocked.'
export const DELIVERED_TEXT = 'Ho preparato una correzione in anticipo: '

/** Final = nothing more will happen on its own: done, or a failure with no attempt left. A budget stop is not final: its gate decides. */
export function isFinal(o: Outcome, attempt: number, maxAttempts: number): boolean {
  if (o.kind === 'budget') return false
  return o.kind === 'done' || !o.retryable || attempt >= maxAttempts
}

/** Raise asked for after a budget stop: twice the old cap, and at least twice what was spent (a stage overshoots its cap). */
export function budgetGate(spec: RunSpec, spentUsd: number): GateSpec {
  const raise = { ...spec.budget, maxCostUsd: Math.round(Math.max(2 * spec.budget.maxCostUsd, 2 * spentUsd) * 100) / 100 }
  return {
    kind: 'budget', audience: 'requester', raise, options: ['Sì', 'No'],
    question: `Il tentativo ${spec.attempt} si è fermato al budget: ha speso ${spentUsd.toFixed(2)} $ su ${spec.budget.maxCostUsd.toFixed(2)} $. Continuo con un budget di ${raise.maxCostUsd.toFixed(2)} $?`,
  }
}

/** A budget gate answer counts as yes when it starts with sì/si/yes/ok. */
export const saysYes = (answer: string) => /^\s*(s[iì]|yes|ok)(?=$|[\s,.;:!])/i.test(answer)   // not \b: without the u flag "ì" is not a word char

/** Follow-ups routed to a ticket that no run has received yet: not steered in (input.delivered), not in a brief (spec.inputs). */
export function pendingInputs(read: Reader, ticket: TicketId): { input: string; text: string }[] {
  const events = read.thread({ kind: 'ticket', ticket }, { kinds: ['input.routed', 'input.delivered', 'run.intended'] })
  const got = new Set<string>()
  for (const e of events) {
    if (e.kind === 'input.delivered') got.add((e as Event<'input.delivered'>).body.input)
    if (e.kind === 'run.intended') for (const i of (e as Event<'run.intended'>).body.inputs ?? []) got.add(i)
  }
  return events.filter((e) => e.kind === 'input.routed' && !got.has(e.id)).map((e) => ({ input: e.id, text: read.text((e as Event<'input.routed'>).body.preview) }))
}

/** Follow-ups the worker has received for this ticket, in any attempt (steered in, or in a brief). The verifier judges against these too. */
export function deliveredInputs(read: Reader, ticket: TicketId): string[] {
  const pending = new Set(pendingInputs(read, ticket).map((i) => i.input))
  return read.thread({ kind: 'ticket', ticket }, { kinds: ['input.routed'] })
    .filter((e) => !pending.has(e.id))
    .map((e) => read.text((e as Event<'input.routed'>).body.preview))
}

/**
 * A run.intended for every open ticket that needs one: attempt 1 when it has no run; attempt n+1 when
 * attempt n failed retryably (verifier FAIL, no commit, engine error), or when follow-ups arrived after a
 * finished attempt (unit 7). Attempt n+1 resumes the worker's session, continues its commits and carries
 * the reason or the new messages in its brief. Budget stops wait for unit 8.
 */
export function planRuns(read: Reader, config: HarnessConfig, spill: (s: string) => Text): Draft[] {
  const runs = Object.values(read.view(runsView, 'all').runs)
  const drafts: Draft[] = []
  for (const ev of openedTickets(read)) {
    const ticket = (ev.thread as { ticket: TicketId }).ticket
    const mine = runs.filter((r) => r.ticket === ticket).sort((x, y) => y.attempt - x.attempt)
    const last = mine[0]
    const inputs = pendingInputs(read, ticket)
    let prev: { attempt: number; sha?: string; session?: string; why?: string } | undefined
    let raised: Budget | undefined
    if (last && !last.ended && !queuedWhenPromoted(read, last)) continue
    if (last?.ended) {
      const ended = read.effects(last.run as EventId).find((x) => x.kind === 'run.ended') as Event<'run.ended'> | undefined
      const o = ended?.body.outcome
      if (!o) continue
      if (o.kind === 'budget') {
        // The budget gate decides: yes -> the next attempt with the raised cap; no, or no answer yet -> nothing.
        const g = Object.values(read.view(gatesView, 'all').gates).find((x) => x.run === last.run && x.spec.kind === 'budget')
        if (!g?.answer || !saysYes(g.answer) || !g.spec.raise) continue
        raised = g.spec.raise
        prev = { attempt: last.attempt, sha: o.sha, session: o.workerSession, why: `Your previous attempt was stopped by its budget after spending $${o.spentUsd.toFixed(2)}. Vlad raised the budget to $${raised.maxCostUsd.toFixed(2)}. Continue where you stopped: uncommitted changes of that attempt are gone, so check git log and git status first, and commit as you go.` }
      } else {
        const retry = o.kind === 'failed' && !isFinal(o, last.attempt, config.maxAttempts)
        if (!retry && inputs.length === 0) continue
        prev = { attempt: last.attempt, sha: o.sha, session: o.workerSession, why: retry && o.kind === 'failed' ? o.evidence : undefined }
      }
    }
    const b = ev.body
    const silent = ticketLine(read, ticket)?.visibility === 'silent'
    const repo = config.repos.find((r) => r.repo === b.repo)
    const request = b.origin.map((id) => read.event(id)).filter((t): t is Event<'trigger'> => t?.kind === 'trigger').map((t) => read.text(t.body.text))
    const subscribed = read.effects(ev.cause[0]).find((x) => x.kind === 'subscribed')
    let brief = composeBrief({ title: b.title, scope: b.scope, repo: b.repo, thread: subscribed ? threadKey(subscribed.thread) : undefined }, request)
    if (silent) brief += `\n\n${SPECULATIVE_BRIEF}`
    if (prev?.why) brief += `\n\nThis is attempt ${prev.attempt + 1}. Your previous attempt was not accepted:\n${prev.why}\nYour earlier commits are already in this worktree: fix what is wrong, commit, finish as before.`
    if (!prev && inputs.length) brief += `\n\nMessages that arrived in the issue after the request:\n${inputs.map((i) => `> ${i.text.replace(/\n/g, '\n> ')}`).join('\n\n')}`
    if (prev && inputs.length) brief += `\n\nThis is attempt ${prev.attempt + 1}. New messages arrived in the issue or the PR after your last attempt:\n${inputs.map((i) => `> ${i.text.replace(/\n/g, '\n> ')}`).join('\n\n')}\nYour earlier commits are already in this worktree: address these messages, commit, finish as before.`
    const spec: RunSpec = {
      ticket, attempt: prev ? prev.attempt + 1 : 1, repo: b.repo,
      baseBranch: repo?.base ?? 'main',
      brief: spill(brief), budget: raised ?? (silent && repo?.speculative ? repo.speculative.budget : config.budget), models: config.models,
      ...(prev?.session ? { forkFrom: prev.session } : {}),
      ...(prev?.sha ? { startFrom: prev.sha } : {}),
      ...(prev?.why ? { feedback: spill(prev.why) } : {}),
      ...(inputs.length ? { inputs: inputs.map((i) => i.input as EventId) } : {}),
    }
    drafts.push({ thread: ev.thread, kind: 'run.intended', by: 'daemon', cause: [last ? (last.run as EventId) : ev.id], body: spec } as Draft<'run.intended'>)
  }
  return drafts
}

function queuedWhenPromoted(read: Reader, run: RunLine): boolean {
  if (run.atomic) return false
  const planned = read.event(run.run as EventId)?.seq ?? 0
  return read.thread({ kind: 'ticket', ticket: run.ticket as TicketId }, { kinds: ['ticket.promoted'] }).some((e) => e.seq > planned)
}

/** What the router reports in the issue: final runs of visible tickets with no reply about them yet. */
export interface ResultCard { about: string; to?: string; ticket: string; attempt: number; outcome: Outcome }
export function resultsForRouter(read: Reader, maxAttempts: number): ResultCard[] {
  const out: ResultCard[] = []
  for (const r of Object.values(read.view(runsView, 'all').runs)) {
    if (!r.ended) continue
    const ended = read.effects(r.run as EventId).find((x) => x.kind === 'run.ended') as Event<'run.ended'> | undefined
    if (!ended || !isFinal(ended.body.outcome, r.attempt, maxAttempts)) continue   // budget stops speak through their gate
    if (read.effects(ended.id).some((x) => x.kind === 'reply.intended')) continue
    const spec = (read.event(r.run as EventId) as Event<'run.intended'>).body
    const line = ticketLine(read, spec.ticket)
    if (line?.visibility !== 'visible' || line.closed) continue
    const opened = read.thread({ kind: 'ticket', ticket: spec.ticket }, { kinds: ['ticket.opened'] })[0]
    const sub = opened && read.effects(opened.cause[0]).find((x) => x.kind === 'subscribed')
    out.push({ about: ended.id, to: sub ? threadKey(sub.thread) : undefined, ticket: spec.ticket, attempt: r.attempt, outcome: ended.body.outcome })
  }
  return out
}

function openedTickets(read: Reader): Event<'ticket.opened'>[] {
  return Object.values(read.view(ticketsView, 'all').tickets).filter((l) => !l.closed)
    .flatMap((l) => read.thread({ kind: 'ticket', ticket: l.ticket as TicketId }, { kinds: ['ticket.opened'] }) as Event<'ticket.opened'>[])
}

export function runsToStart(read: Reader, maxWorkers: number): RunKey[] {
  const live = Object.values(read.view(runsView, 'all').runs).filter((r) => !r.ended)
  const free = maxWorkers - live.filter((r) => r.atomic).length
  if (free <= 0) return []
  const silent = (r: RunLine) => (ticketLine(read, r.ticket)?.visibility === 'silent' ? 1 : 0)
  return live.filter((r) => !r.atomic)
    .sort((x, y) => silent(x) - silent(y) || (read.event(x.run as EventId)?.seq ?? 0) - (read.event(y.run as EventId)?.seq ?? 0))
    .slice(0, free).map((r) => r.run as RunKey)
}

export function liveRuns(read: Reader): { run: RunKey; spec: RunSpec; atomic?: string }[] {
  return Object.values(read.view(runsView, 'all').runs)
    .filter((r) => !r.ended && !ticketLine(read, r.ticket)?.closed)
    .map((r) => ({ run: r.run as RunKey, spec: (read.event(r.run as EventId) as Event<'run.intended'>).body, atomic: r.atomic }))
}

function discardReason(o: Outcome): string {
  if (o.kind === 'budget') return 'budget'
  if (o.kind === 'done') return 'no PR'
  if (o.cause !== 'error') return o.cause
  return /^worker blocked/.test(o.evidence) ? 'blocked' : `error: ${o.evidence.replace(/\s+/g, ' ').slice(0, 120)}`
}

/** One engine report as drafts. Idempotent: an ended run takes no more reports, a repeated binding is recorded once. */
export function reportDrafts(read: Reader, run: RunKey, r: EngineReport, marker: string): Draft[] {
  const intended = read.event(run as string as EventId) as Event<'run.intended'> | undefined
  if (!intended || intended.kind !== 'run.intended') return []
  const line = read.view(runsView, 'all').runs[run]
  if (line?.ended) return []
  const thread = intended.thread
  switch (r.kind) {
    case 'bound':
      if (line?.atomic === r.atomic) return []
      return [{ thread, kind: 'run.bound', by: 'engine', cause: [intended.id], body: { run, atomic: r.atomic as AtomicRunId } } as Draft<'run.bound'>]
    case 'progress':
      return [{ thread, kind: 'run.progress', by: 'engine', cause: [intended.id], body: { run, stage: r.stage, summary: r.summary } } as Draft<'run.progress'>]
    case 'delivered':
      return [{ thread, kind: 'input.delivered', by: 'engine', cause: [intended.id, r.input as EventId], body: { input: r.input as EventId, run } } as Draft<'input.delivered'>]
    case 'ended': {
      const ticket = ticketLine(read, intended.body.ticket)
      const stop = watchdogStopOf(read, run, ticket, r.outcome)
      const outcome: Outcome = stop && r.outcome.kind === 'failed' ? { ...r.outcome, evidence: stop.body.reason } : r.outcome
      const ended = { thread, kind: 'run.ended', by: 'engine', cause: stop ? [intended.id, stop.id] : [intended.id], body: { run, outcome, ...(r.usage ? { usage: r.usage } : {}) } } as Draft<'run.ended'>
      if (ticket?.visibility === 'silent') return [ended, ...speculativeEnd(read, intended, ended, ticket, outcome, marker)]
      if (outcome.kind === 'budget') {
        const spec = budgetGate(intended.body, outcome.spentUsd)
        return [ended, ...openGate(read, run, gateIdOf(run, 'budget', 0, spec), spec, 'daemon')]
      }
      // The PR thread joins the ticket: review comments on it are follow-ups from now on.
      if (outcome.kind !== 'done' || !outcome.pr) return [ended]
      const pr: ThreadRef = { kind: 'issue', repo: intended.body.repo, number: outcome.pr }
      return [ended, { thread: pr, kind: 'subscribed', by: 'daemon', cause: [intended.id], body: { ticket: intended.body.ticket } } as Draft<'subscribed'>]
    }
  }
}

function speculativeEnd(read: Reader, intended: Event<'run.intended'>, ended: Draft<'run.ended'>, ticket: TicketLine, o: Outcome, marker: string): Draft[] {
  const thread = intended.thread
  if (ticket.closed) return []
  if (o.kind !== 'done' || !o.pr) {
    return [{ thread, kind: 'ticket.closed', by: 'daemon', cause: [idOf(ended)], body: { outcome: 'discarded', reason: discardReason(o) } } as Draft<'ticket.closed'>]
  }
  const pr: ThreadRef = { kind: 'issue', repo: intended.body.repo, number: o.pr }
  const out: Draft[] = [{ thread: pr, kind: 'subscribed', by: 'daemon', cause: [intended.id], body: { ticket: intended.body.ticket } } as Draft<'subscribed'>]
  const issue = ticket.thread ? parseThread(ticket.thread) : undefined
  const text = issue && composeReply(issue, `${DELIVERED_TEXT}${o.url}`, marker)
  if (issue && text?.ok) out.push({ thread: issue, kind: 'reply.intended', by: 'daemon', cause: [idOf(ended)], body: { to: issue, purpose: 'result', text: text.text } } as Draft<'reply.intended'>)
  out.push({ thread, kind: 'ticket.promoted', by: 'daemon', cause: [idOf(ended)], body: { via: 'delivered' } } as Draft<'ticket.promoted'>)
  return out
}

// ---------- stops (unit 9): watchdog.judged -> stop.intended -> the engine quits the run in Atomic ----------

function watchdogStopOf(read: Reader, run: RunKey, ticket: TicketLine | undefined, o: Outcome): Event<'stop.intended'> | undefined {
  return o.kind === 'failed' && o.cause === 'stopped' && !ticket?.closed ? liveStop(read, run) : undefined
}

function stopOf(read: Reader, run: RunKey): Event<'stop.intended'> | undefined {
  return read.effects(run as string as EventId).filter((e) => e.kind === 'stop.intended').at(-1) as Event<'stop.intended'> | undefined
}

export const hasOpenGate = (read: Reader, run: RunKey) => Object.values(read.view(gatesView, 'all').gates).some((g) => g.run === run && g.answer === undefined)

export function marksOf(read: Reader, run: RunKey): Event[] {
  return read.effects(run as string as EventId).flatMap((e): Event[] => {
    if (e.kind === 'gate.opened') return [e, ...read.effects(e.id).filter((a) => a.kind === 'gate.answered')]
    return ['run.bound', 'run.progress', 'watchdog.judged'].includes(e.kind) ? [e] : []
  }).sort((a, b) => a.seq - b.seq)
}

export function standingVerdict(read: Reader, run: RunKey): Event<'watchdog.judged'> | undefined {
  const last = marksOf(read, run).at(-1)
  return last?.kind === 'watchdog.judged' && ['stuck', 'drifting'].includes(last.body.verdict) ? last : undefined
}

function liveStop(read: Reader, run: RunKey): Event<'stop.intended'> | undefined {
  const moved = marksOf(read, run).filter((e) => e.kind !== 'watchdog.judged').at(-1)?.seq ?? 0
  const stop = stopOf(read, run)
  return stop && stop.seq > moved ? stop : undefined
}

export function stopDrafts(read: Reader): Draft<'stop.intended'>[] {
  return liveRuns(read).flatMap(({ run }) => {
    const j = standingVerdict(read, run)
    if (!j || liveStop(read, run)) return []
    return [{ thread: j.thread, kind: 'stop.intended', by: 'daemon', cause: [run as string as EventId, j.id], body: { run, reason: `watchdog ${j.body.verdict}: ${j.body.evidence}` } } as Draft<'stop.intended'>]
  })
}

export function runsToStop(read: Reader): RunKey[] {
  const closed = Object.values(read.view(runsView, 'all').runs).filter((r) => !r.ended && ticketLine(read, r.ticket)?.closed).map((r) => r.run as RunKey)
  const judged = liveRuns(read).filter((r) => standingVerdict(read, r.run) && liveStop(read, r.run)).map((r) => r.run)
  return [...closed, ...judged]
}

export interface StuckItem { kind: 'stuck'; thread: string; run: string; reason: string }

/** Open tickets whose latest attempt a stop.intended ended: they wait for Vlad, with the reason. */
export function stuckItems(read: Reader): StuckItem[] {
  const runs = Object.values(read.view(runsView, 'all').runs)
  return Object.values(read.view(ticketsView, 'all').tickets).filter((t) => !t.closed).flatMap((t) => {
    const last = runs.filter((r) => r.ticket === t.ticket).sort((x, y) => y.attempt - x.attempt)[0]
    const ended = last?.ended === 'failed' ? read.effects(last.run as EventId).find((e) => e.kind === 'run.ended') as Event<'run.ended'> | undefined : undefined
    const stop = ended && read.causes(ended.id).find((e) => e.kind === 'stop.intended') as Event<'stop.intended'> | undefined
    return stop ? [{ kind: 'stuck' as const, thread: t.thread ?? `ticket:${t.ticket}`, run: last.run, reason: stop.body.reason }] : []
  })
}
