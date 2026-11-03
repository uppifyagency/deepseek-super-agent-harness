// fold.ts: every "state" in the system, as pure folds over the log, plus pure derivations.
// Nothing here does I/O. Every exported view is registered once, in service.ts openHarness.

import type {
  AcceptMode, ChannelRef, EnvId, Event, EventId, GateId, GateResult, GateSpec, Hash, Iso, Mandate,
  Outcome, ReplyPurpose, RunId, RunSpec, Seq, Text, TicketId, TicketSeed, Visibility,
} from './events'
import type { View } from './log'

// ---------- Thread (source threads): subscription and the Router inbox live here ----------

export interface ThreadState {
  /** Subscription is a fold result: last `subscribed` minus later `unsubscribed`, per ticket. */
  subscribers: ReadonlyMap<TicketId, 'own' | 'context'>
  /** Triggers that passed the gate, reached no `own` subscriber, and no `decided` cites yet. */
  unrouted: readonly EventId[]
  /** At most one open Eval per thread. Set by `eval.started`, cleared by `decided`. */
  evaluating?: { eval: EventId; triggers: readonly EventId[]; attempt: number }
  correlated: readonly string[]
  lastAt?: Iso
}
export const threadView: View<ThreadState> = {
  name: 'thread', version: 1,
  init: { subscribers: new Map(), unrouted: [], correlated: [] },
  parts: (e) => { throw new Error('not implemented') },   // TODO source-thread key; for `trigger`, also its correlates
  evolve: (s, e) => {
    throw new Error('not implemented')
    // TODO switch (e.kind) exhaustively:
    //  trigger.gated admissible && no 'own' subscriber -> unrouted += trigger
    //  handed.back -> unrouted += trigger (the Router sees it again)
    //  eval.started -> evaluating = {...}
    //  decided -> unrouted -= eval.triggers unless decision.kind === 'unavailable'; evaluating = undefined
    //  subscribed / unsubscribed -> subscribers
  },
}

// ---------- Ticket (work threads). Run status and gates are part of it. ----------

export type RunStatus =
  | { s: 'intended'; waitingFor?: 'env' | 'slot' }
  | { s: 'running'; since: Iso; lastReport?: Iso }
  | { s: 'stopping'; reason: string }
  | { s: 'ended'; outcome: Outcome }

export interface RunState { id: RunId; spec: RunSpec; status: RunStatus }

export interface TicketState {
  id: TicketId
  mandate: Mandate
  seed: TicketSeed
  visibility: Visibility | 'revealed'
  channels: readonly ChannelRef[]
  inputs: readonly { id: EventId; trigger: EventId; preview: Text; context: boolean; taken: boolean }[]
  runs: readonly RunState[]                 // attempt order; at most one not ended
  gates: ReadonlyMap<GateId, { spec: GateSpec; run: RunId; answer?: string }>
  replies: ReadonlyMap<EventId, { purpose: ReplyPurpose; status: 'pending' | 'held' | 'sent' | 'dropped' }>
  closed?: { outcome: 'completed' | 'merged' | 'closed' | 'discarded' | 'stopped'; reason: string }
}
export const ticketView: View<TicketState | undefined> = {
  name: 'ticket', version: 1, init: undefined,
  parts: (e) => { throw new Error('not implemented') },   // TODO work-thread events -> [ticket id]
  evolve: (s, e) => { throw new Error('not implemented') },
}

// ---------- Policy (system:policy) ----------

export interface PolicyState {
  version: Hash
  mode: AcceptMode
  paused: boolean
  /** Compiled from settings once per `policy.set`; pure functions of (settings, input). */
  gate(t: Event<'trigger'>, thread: ThreadState): GateResult
  admitsInferred(rules: readonly string[]): boolean
  evalTimeoutMs: number
}
export const policyView: View<PolicyState> = {
  name: 'policy', version: 1,
  init: undefined as never,                 // TODO compile default settings (mode 'observe')
  parts: (e) => (e.kind === 'policy.set' ? ['policy'] : []),
  evolve: (s, e) => { throw new Error('not implemented') },
}

// ---------- Pending effects: the outbox is a fold, not a queue ----------

export type Intent =
  | { kind: 'reply'; event: Event<'reply.intended'>; orderKey: string }   // ticket+channel, FIFO per key
  | { kind: 'run'; event: Event<'run.intended'> }
  | { kind: 'stop'; event: Event<'stop.intended'> }

/**
 * An intent is pending until its outcome event exists:
 *   reply.intended -> reply.settled (citing it)   run.intended -> run.started   stop.intended -> run.ended
 * Held, not pending: replies of a `silent` ticket until `ticket.revealed`; runs whose env is offline.
 * Dropped from pending: replies of a ticket closed as `discarded`.
 */
export interface EffectsState { pending: ReadonlyMap<EventId, Intent>; held: ReadonlySet<EventId> }
export const effectsView: View<EffectsState> = {
  name: 'effects', version: 1, init: { pending: new Map(), held: new Set() },
  parts: () => ['all'],
  evolve: (s, e) => { throw new Error('not implemented') },
}

export interface EnvState { online: boolean; since: Iso }
export const envView: View<EnvState> = {
  name: 'env', version: 1, init: { online: false, since: '' as Iso },
  parts: (e) => (e.kind === 'env.seen' ? [e.key] : []),
  evolve: (_s, e) => { throw new Error('not implemented') },
}

// ---------- Attention: the panel. Empty when nothing needs a person. ----------

export type AttentionItem =
  | { kind: 'gate'; ticket: TicketId; gate: GateId; spec: GateSpec; age: string }
  | { kind: 'delivery-failed'; ticket: TicketId; reply: EventId; reason: string }
  | { kind: 'would-accept'; thread: string; decided: EventId; seed: TicketSeed }   // observe mode
  | { kind: 'stuck'; ticket: TicketId; run: RunId; judged: EventId }
  | { kind: 'mandate-lapsed'; ticket: TicketId; why: string }
export const attentionView: View<readonly AttentionItem[]> = {
  name: 'attention', version: 1, init: [], parts: () => ['all'],
  evolve: (s, e) => { throw new Error('not implemented') },
}

// ---------- pure derivations (not stored) ----------

/** Evaluated at every run.intended, every resume and every attach, against the CURRENT policy. */
export type Validity = { valid: true } | { valid: false; why: 'sender-removed' | 'source-unlistened' | 'mode-not-auto' | 'rule-disabled' }
export function mandateValidity(m: Mandate, p: PolicyState): Validity {
  throw new Error('not implemented')
  // TODO port policy.ts:213-240 revalidate, returning the reason instead of a boolean
}

/** The dsh "first row wins" stage table, over TicketState. Panel and Router cards use it. */
export type Stage =
  | { stage: 'person'; action: 'answer' | 'delivery' | 'review' }
  | { stage: 'working' | 'queued' | 'idle' | 'closed' }
export function stage(t: TicketState): Stage {
  throw new Error('not implemented')
}

/** pstack Orchestrate brief (GOAL..STANDING) plus autonomy grant, store paths, untaken inputs. */
export function briefOf(t: TicketState, attempt: number, env: EnvId, standing: string): Text {
  throw new Error('not implemented')
}

/** Card for the Router: preview + ids of next hops. `recall(id)` returns the same shape for any id. */
export interface Card { id: string; kind: string; preview: string; next: readonly { id: string; rel: string; preview: string }[] }
export function cardOf(e: Event, hops: { causes: readonly Event[]; effects: readonly Event[] }): Card {
  throw new Error('not implemented')
}

/** Liveness and progress for the watchdog: runs with no report since `stale`. */
export function liveRuns(tickets: Iterable<TicketState>, now: Iso, staleMs: number): readonly { run: RunId; ticket: TicketId; lastReport?: Iso; stale: boolean }[] {
  throw new Error('not implemented')
}

export type { Seq }
