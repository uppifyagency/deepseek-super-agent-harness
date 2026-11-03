// routing.ts: everything between "a trigger passed the code filter" and "a reply is on GitHub".
// Pure: views over the log and deciders (Reader in, Drafts out). service.ts runs them in transact.
//
//   trigger.filtered PASS -> routerView.unrouted -> next() opens one eval.opened per thread
//   -> the router decides (decided [+ ticket.opened + subscribed]) and replies (reply.intended)
//   -> outboxView.pending -> github.send -> reply.settled

import { threadKey } from './domain.ts'
import type { Decision, Draft, Event, EventId, Hash, ReplyPurpose, ReplyText, Repo, ThreadRef, TicketId } from './domain.ts'
import { hash, idOf } from './log.ts'
import type { Reader, View } from './log.ts'
import type { RepoConfig } from './config.ts'

export type RepoOf = (r: Repo) => RepoConfig | undefined

// ---------- views ----------

/** Per issue thread: counts and the owning ticket. Triggers waiting for the router live in routerView. */
export interface IssueState { subscriber?: string; triggers: number; filtered: number }
export const issueView: View<IssueState> = {
  name: 'issue', version: 2, init: { triggers: 0, filtered: 0 },
  parts: (e) => (e.thread.kind === 'issue' ? [threadKey(e.thread)] : []),
  evolve: (s, e) => {
    switch (e.kind) {
      case 'trigger': return { ...s, triggers: s.triggers + 1 }
      case 'trigger.filtered': {
        const b = (e as Event<'trigger.filtered'>).body
        return b.pass ? s : { ...s, filtered: s.filtered + 1 }
      }
      case 'subscribed': return { ...s, subscriber: (e as Event<'subscribed'>).body.ticket }
      default: return s
    }
  },
}

interface Pending { ref: ThreadRef; unrouted: string[]; openEval?: string }

/** Threads with work for the router. Batching falls out: everything that piled up goes in one eval. */
export const routerView: View<{ threads: Record<string, Pending> }> = {
  name: 'router', version: 1, init: { threads: {} },
  parts: (e) => (['trigger.filtered', 'eval.opened', 'decided'].includes(e.kind) ? ['all'] : []),
  evolve: (s, e) => {
    const key = threadKey(e.thread)
    const threads = { ...s.threads }
    const cur: Pending = threads[key] ?? { ref: e.thread, unrouted: [] }
    if (e.kind === 'trigger.filtered') {
      const b = (e as Event<'trigger.filtered'>).body
      if (!b.pass || b.reason === 'follow-up') return s
      threads[key] = { ...cur, unrouted: [...cur.unrouted, b.trigger] }
    } else if (e.kind === 'eval.opened') {
      const taken = new Set<string>((e as Event<'eval.opened'>).body.triggers)
      threads[key] = { ...cur, openEval: e.id, unrouted: cur.unrouted.filter((t) => !taken.has(t)) }
    } else if (e.kind === 'decided') {
      if (cur.openEval !== (e as Event<'decided'>).body.eval) return s
      const next = { ...cur, openEval: undefined }
      if (next.unrouted.length === 0) delete threads[key]
      else threads[key] = next
    }
    return { threads }
  },
}

export interface OutboxItem { to: ThreadRef; purpose: ReplyPurpose; text: string }
/** The outbox IS this fold: an intent is pending until its reply.settled exists. */
export const outboxView: View<{ pending: Record<string, OutboxItem> }> = {
  name: 'outbox', version: 1, init: { pending: {} },
  parts: (e) => (e.kind === 'reply.intended' || e.kind === 'reply.settled' ? ['all'] : []),
  evolve: (s, e) => {
    const pending = { ...s.pending }
    if (e.kind === 'reply.intended') {
      const b = (e as Event<'reply.intended'>).body
      pending[e.id] = { to: b.to, purpose: b.purpose, text: b.text }
    } else {
      delete pending[(e as Event<'reply.settled'>).body.intent]
    }
    return { pending }
  },
}

export type AttentionItem =
  | { kind: 'would-accept'; decided: string; thread: string; title: string; scope: string }
  | { kind: 'reply-gone'; intent: string; thread: string }
  | { kind: 'discarded'; ticket: string; reason: string }
/** What needs Vlad. Empty when nothing does. */
export const attentionView: View<{ items: AttentionItem[] }> = {
  name: 'attention', version: 2, init: { items: [] },
  parts: (e) => (['decided', 'reply.settled', 'ticket.closed'].includes(e.kind) ? ['all'] : []),
  evolve: (s, e) => {
    if (e.kind === 'ticket.closed') {
      const b = (e as Event<'ticket.closed'>).body
      return b.outcome === 'discarded' ? { items: [...s.items, { kind: 'discarded', ticket: (e.thread as { ticket: string }).ticket, reason: b.reason ?? '' }] } : s
    }
    if (e.kind === 'decided') {
      const d = (e as Event<'decided'>).body.decision
      if (d.kind !== 'would-accept') return s
      return { items: [...s.items, { kind: 'would-accept', decided: e.id, thread: threadKey(e.thread), title: d.title, scope: d.scope }] }
    }
    const b = (e as Event<'reply.settled'>).body
    return b.result === 'gone' ? { items: [...s.items, { kind: 'reply-gone', intent: b.intent, thread: threadKey(e.thread) }] } : s
  },
}

export const ROUTING_VIEWS = [issueView, routerView, outboxView, attentionView] as View<unknown>[]

// ---------- cards (Inline & Spill) ----------

export interface TriggerCard { id: string; actor: string; addressed: boolean; text: string; truncated: boolean; url: string }
export interface EvalCard { eval: string; thread: string; triggers: TriggerCard[]; speculative?: true }

export function triggerCard(read: Reader, id: string): TriggerCard {
  const e = read.event(id as EventId) as Event<'trigger'>
  const b = e.body
  return { id, actor: b.actor, addressed: b.addressed, text: b.text.preview, truncated: b.text.blob !== undefined, url: b.url }
}

// ---------- deciders ----------

/** Open one eval per thread with unrouted triggers and no open eval. Pure: the drafts carry no clock. */
export function openEvals(read: Reader, policy: Hash): Draft[] {
  const out: Draft[] = []
  for (const p of Object.values(read.view(routerView, 'all').threads)) {
    if (p.openEval || p.unrouted.length === 0) continue
    out.push({ thread: p.ref, kind: 'eval.opened', by: 'daemon', cause: p.unrouted as EventId[], body: { triggers: p.unrouted as EventId[], policy } } as Draft<'eval.opened'>)
  }
  return out
}

/** Every open eval, new or left open by a router run that failed: the router always sees them again. */
export function openEvalCards(read: Reader, repoOf: RepoOf): EvalCard[] {
  return Object.entries(read.view(routerView, 'all').threads)
    .filter(([, p]) => p.openEval)
    .map(([key, p]) => {
      const ev = read.event(p.openEval as EventId) as Event<'eval.opened'>
      const triggers = ev.body.triggers.map((t) => triggerCard(read, t))
      const speculative = ev.thread.kind === 'issue' && repoOf(ev.thread.repo)?.speculative !== undefined && !triggers.some((t) => t.addressed)
      return { eval: ev.id, thread: key, triggers, ...(speculative ? { speculative: true as const } : {}) }
    })
}

export type RouterDecision =
  | { kind: 'accept'; title: string; scope: string; silent?: boolean }
  | { kind: 'ignore'; reason: string }

export type DecideResult = { ok: true; decision: Decision['kind']; ticket?: TicketId; already?: boolean; capped?: true } | { ok: false; problem: string }

const DAY_MS = 24 * 3600_000

const calls = (read: Reader, triggers: readonly string[]) => triggers.some((t) => (read.event(t as EventId) as Event<'trigger'> | undefined)?.body.addressed)

function silentBornSince(read: Reader, repo: Repo, at: string): number {
  const from = Date.parse(at) - DAY_MS
  return Object.values(read.view(ticketsView, 'all').tickets).filter((l) => {
    if (l.repo !== repo || Date.parse(l.openedAt) <= from) return false
    const opened = read.thread({ kind: 'ticket', ticket: l.ticket as TicketId }, { kinds: ['ticket.opened'] })[0] as Event<'ticket.opened'> | undefined
    return opened?.body.visibility === 'silent'
  }).length
}

/**
 * One router decision on one eval. Observe mode lives ONLY here: an accept under 'observe' is stored as
 * would-accept and starts nothing. Accept in 'auto' opens the ticket and subscribes the thread, so
 * follow-ups bypass the router from then on. Replays return the stored decision.
 */
export function decide(read: Reader, evalId: string, d: RouterDecision, mode: 'off' | 'observe' | 'auto', repoOf: RepoOf): { drafts: Draft[]; result: DecideResult } {
  const ev = read.event(evalId as EventId)
  if (!ev || ev.kind !== 'eval.opened') return { drafts: [], result: { ok: false, problem: `no eval ${evalId}; call next first` } }
  const prior = read.effects(ev.id).find((x) => x.kind === 'decided') as Event<'decided'> | undefined
  if (prior) return { drafts: [], result: { ok: true, decision: prior.body.decision.kind, already: true } }

  const refuse = (problem: string) => ({ drafts: [], result: { ok: false as const, problem } })
  const triggers = (ev as Event<'eval.opened'>).body.triggers
  let decision: Decision
  let capped = false
  let called = false
  if (d.kind === 'ignore') decision = { kind: 'ignore', reason: d.reason }
  else if (d.kind === 'accept') {
    if (ev.thread.kind !== 'issue') return refuse('accept needs an issue thread; answer the operator with reply instead')
    if (!d.title?.trim() || !d.scope?.trim()) return refuse('accept needs a title and a scope')
    const speculative = repoOf(ev.thread.repo)?.speculative
    const addressed = calls(read, triggers)
    const silent = d.silent === true
    if (silent) {
      if (!speculative) return refuse(`speculative work is off on ${ev.thread.repo}: accept with silent false, or ignore`)
      if (addressed) return refuse('this eval addresses the harness: accept it with silent false')
      if (read.view(issueView, threadKey(ev.thread)).subscriber) return refuse('this thread already has a ticket: no speculative work on it')
      const waiting = read.view(routerView, 'all').threads[threadKey(ev.thread)]?.unrouted ?? []
      called = calls(read, waiting)
      capped = !called && silentBornSince(read, ev.thread.repo, ev.at) >= speculative.maxPerDay
    } else if (speculative && !addressed) {
      return refuse('nobody called the harness here: accept with silent true, or ignore')
    }
    decision = called ? { kind: 'ignore', reason: 'the harness was called on this thread' }
      : capped ? { kind: 'ignore', reason: `speculative cap: ${speculative!.maxPerDay} per day` }
      : mode === 'auto' ? { kind: 'accept', title: d.title, scope: d.scope, silent }
      : { kind: 'would-accept', title: d.title, scope: d.scope }
  } else {
    return refuse(`unknown decision kind; use accept or ignore`)
  }

  const decided = { thread: ev.thread, kind: 'decided', by: 'router', cause: [ev.id], body: { eval: ev.id, decision } } as Draft<'decided'>
  const drafts: Draft[] = [decided]
  let ticket: TicketId | undefined
  if (decision.kind === 'accept' && ev.thread.kind === 'issue') {
    ticket = hash('ticket', idOf(decided)) as string as TicketId
    drafts.push(
      { thread: { kind: 'ticket', ticket }, kind: 'ticket.opened', by: 'daemon', cause: [idOf(decided)], body: { title: decision.title, scope: decision.scope, repo: ev.thread.repo as Repo, visibility: decision.silent ? 'silent' : 'visible', origin: triggers } } as Draft<'ticket.opened'>,
      { thread: ev.thread, kind: 'subscribed', by: 'daemon', cause: [idOf(decided)], body: { ticket } } as Draft<'subscribed'>,
    )
  }
  return { drafts, result: { ok: true, decision: decision.kind, ticket, ...(capped ? { capped: true as const } : {}) } }
}

/** Channel norms. The only ReplyText constructor. */
export function composeReply(to: ThreadRef, text: string, marker: string): { ok: true; text: ReplyText } | { ok: false; problem: string } {
  const t = text.trim()
  if (!t) return { ok: false, problem: 'empty reply' }
  if (t.includes(marker)) return { ok: false, problem: 'do not write the harness marker; it is added on send' }
  if (to.kind === 'issue') {
    if (t.length > 1500) return { ok: false, problem: `GitHub reply is ${t.length} chars; max 1500. Lead with one status line, keep it structured` }
  } else {
    const words = t.split(/\s+/).length
    if (words > 100) return { ok: false, problem: `operator reply is ${words} words; max 100` }
  }
  return { ok: true, text: t as ReplyText }
}

export function parseThread(key: string): ThreadRef | undefined {
  if (key === 'system:operator') return { kind: 'system', name: 'operator' }
  const m = /^issue:([\w.-]+\/[\w.-]+)#(\d+)$/.exec(key)
  return m ? { kind: 'issue', repo: m[1] as Repo, number: Number(m[2]) } : undefined
}

function answersCall(read: Reader, to: ThreadRef, ticket: TicketLine | undefined): boolean {
  const p = read.view(routerView, 'all').threads[threadKey(to)]
  const open = p?.openEval ? (read.event(p.openEval as EventId) as Event<'eval.opened'>).body.triggers : undefined
  if (open && !calls(read, open)) return false
  if (p && calls(read, p.unrouted)) return true
  if (open) return true
  if (p?.unrouted.length) return false
  const last = read.thread(to, { kinds: ['eval.opened'] }).at(-1) as Event<'eval.opened'> | undefined
  if (!last || !calls(read, last.body.triggers)) return false
  const closed = ticket?.closed ? read.thread({ kind: 'ticket', ticket: ticket.ticket as TicketId }, { kinds: ['ticket.closed'] }).at(-1) : undefined
  return !closed || last.seq > closed.seq
}

/** `about` (an eval or trigger id) is part of the identity: the same text twice about the same thing is one reply. */
export function reply(read: Reader, toKey: string, purpose: ReplyPurpose, text: string, about: string | undefined, marker: string, repoOf: RepoOf): { drafts: Draft[]; result: { ok: true; intent: string } | { ok: false; problem: string } } {
  const to = parseThread(toKey)
  if (!to) return { drafts: [], result: { ok: false, problem: `bad thread "${toKey}"; use issue:owner/name#n or system:operator` } }
  if (to.kind === 'issue' && read.thread(to).length === 0) return { drafts: [], result: { ok: false, problem: `unknown thread ${toKey}` } }
  const owner = to.kind === 'issue' ? read.view(issueView, toKey).subscriber : undefined
  const line = owner ? ticketLine(read, owner) : undefined
  if (line?.visibility === 'silent' && !line.closed) return { drafts: [], result: { ok: false, problem: 'this issue has speculative work nobody asked for: post nothing' } }
  if (to.kind === 'issue' && repoOf(to.repo)?.speculative) {
    const visible = line?.visibility === 'visible' && !line.closed
    if (!visible && !answersCall(read, to, line)) return { drafts: [], result: { ok: false, problem: 'nobody called the harness on this issue: post nothing' } }
  }
  const c = composeReply(to, text, marker)
  if (!c.ok) return { drafts: [], result: c }
  const cause = about && read.event(about as EventId) ? [about as EventId] : []
  const d = { thread: to, kind: 'reply.intended', by: 'router', cause, body: { to, purpose, text: c.text } } as Draft<'reply.intended'>
  return { drafts: [d], result: { ok: true, intent: idOf(d) } }
}

export function settle(read: Reader, intent: string, result: 'sent' | 'gone', url?: string): Draft[] {
  const e = read.event(intent as EventId)
  if (!e || e.kind !== 'reply.intended') return []
  return [{ thread: e.thread, kind: 'reply.settled', by: 'daemon', cause: [e.id], body: { intent: e.id, result, ...(url ? { url } : {}) } } as Draft<'reply.settled'>]
}

// ---------- the board: state of record for a router whose session was rotated (unit 3b) ----------

export interface TicketLine {
  ticket: string; title: string; scope: string; repo: string
  thread?: string
  visibility: 'visible' | 'silent'
  openedAt: string
  closed?: 'merged' | 'closed' | 'discarded' | 'stopped'
  reason?: string
}
export const ticketsView: View<{ tickets: Record<string, TicketLine> }> = {
  name: 'tickets', version: 2, init: { tickets: {} },
  parts: (e) => (['ticket.opened', 'subscribed', 'ticket.promoted', 'ticket.closed'].includes(e.kind) ? ['all'] : []),
  evolve: (s, e) => {
    const tickets = { ...s.tickets }
    const t = e.kind === 'subscribed' ? (e as Event<'subscribed'>).body.ticket : (e.thread as { ticket: string }).ticket
    const cur: TicketLine = tickets[t] ?? { ticket: t, title: '', scope: '', repo: '', visibility: 'visible', openedAt: '' }
    if (e.kind === 'ticket.opened') {
      const b = (e as Event<'ticket.opened'>).body
      tickets[t] = { ...cur, title: b.title, scope: b.scope, repo: b.repo, visibility: b.visibility, openedAt: e.at }
    } else if (e.kind === 'subscribed') {
      tickets[t] = cur.thread ? cur : { ...cur, thread: threadKey(e.thread) }
    } else if (e.kind === 'ticket.promoted') {
      tickets[t] = { ...cur, visibility: 'visible' }
    } else {
      const b = (e as Event<'ticket.closed'>).body
      tickets[t] = { ...cur, closed: b.outcome, ...(b.reason ? { reason: b.reason } : {}) }
    }
    return { tickets }
  },
}

export function ticketLine(read: Reader, ticket: string): TicketLine | undefined {
  return read.view(ticketsView, 'all').tickets[ticket]
}

export interface DecisionLine { thread: string; kind: string; what: string }
const KEEP_DECISIONS = 15
/** The last decisions, newest last. */
export const decisionsView: View<{ recent: DecisionLine[] }> = {
  name: 'decisions', version: 1, init: { recent: [] },
  parts: (e) => (e.kind === 'decided' ? ['all'] : []),
  evolve: (s, e) => {
    const d = (e as Event<'decided'>).body.decision
    const what = 'title' in d ? d.title : 'reason' in d ? d.reason : ''
    return { recent: [...s.recent, { thread: threadKey(e.thread), kind: d.kind, what }].slice(-KEEP_DECISIONS) }
  },
}

export interface OperatorLine { from: 'vlad' | 'router'; text: string }
const KEEP_OPERATOR = 10
/** The last exchanges with Vlad in the terminal (`harness ask`), newest last. */
export const operatorView: View<{ recent: OperatorLine[] }> = {
  name: 'operator', version: 1, init: { recent: [] },
  parts: (e) => (e.thread.kind === 'system' && (e.thread as { name: string }).name === 'operator' && (e.kind === 'trigger' || e.kind === 'reply.intended') ? ['all'] : []),
  evolve: (s, e) => {
    const line: OperatorLine = e.kind === 'trigger'
      ? { from: 'vlad', text: (e as Event<'trigger'>).body.text.preview }
      : { from: 'router', text: (e as Event<'reply.intended'>).body.text }
    return { recent: [...s.recent, line].slice(-KEEP_OPERATOR) }
  },
}

export const BOARD_VIEWS = [ticketsView, decisionsView, operatorView] as View<unknown>[]

const KEEP_DISCARDED = 5
function dropOldDiscards(items: AttentionItem[]): AttentionItem[] {
  const old = new Set<AttentionItem>(items.filter((i) => i.kind === 'discarded').slice(0, -KEEP_DISCARDED))
  return items.filter((i) => !old.has(i))
}

export interface Board { openTickets: TicketLine[]; recentDecisions: DecisionLine[]; recentOperator: OperatorLine[]; waitingForVlad: AttentionItem[] }

export function board(read: Reader): Board {
  return {
    openTickets: Object.values(read.view(ticketsView, 'all').tickets).filter((l) => !l.closed),
    recentDecisions: read.view(decisionsView, 'all').recent,
    recentOperator: read.view(operatorView, 'all').recent,
    waitingForVlad: dropOldDiscards(read.view(attentionView, 'all').items),
  }
}
