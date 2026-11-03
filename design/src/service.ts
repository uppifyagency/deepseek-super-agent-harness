// service.ts: the composition root and the ONLY public module (package.json "exports": "./service").
// Public surface: openHarness -> Harness. log.ts, fold.ts and decide.ts are unreachable from outside.

import type { ActorRef, ChannelRef, EventId, GateId, ReplyPurpose, SourceId, ThreadRef, TicketId } from './events'
import type { AttentionItem, Card } from './fold'
import type { IngestResult, RouterDecision } from './decide'
import type { Executor, ExecutorSink, EnvironmentPort } from './executor'

/** What a source hands in. Parsed from the native payload by the source; the harness spills `text`. */
export interface TriggerDraft {
  source: SourceId
  thread: ThreadRef & { kind: 'source' }
  correlates?: ThreadRef[]
  native: { id: string; version?: string }
  actor: ActorRef
  human: boolean
  addressed?: 'mention' | 'direct'
  text: string
  channel?: ChannelRef
  url?: string
  meta?: Record<string, unknown>
}

/** Source adapter contract (dsh SourceKind, trimmed). `send` must be idempotent by `id`. */
export interface Source {
  id: SourceId
  poll(ingest: (t: TriggerDraft) => IngestResult, signal: AbortSignal): Promise<void>
  send(channel: ChannelRef, text: string, id: EventId): Promise<'sent' | 'gone'>
}

/**
 * evals: threads with unrouted triggers, one Eval each (waking).
 * seen:  triggers passed straight through to an owning ticket since the last batch (non-waking,
 *        one-line cards), so the Router keeps the global picture without spending a turn on them
 *        (graft from candidate 3; article 3.2: the Router still sees every event).
 */
export interface RouterBatch {
  evals: readonly { eval: EventId; thread: string; cards: readonly Card[] }[]
  seen: readonly Card[]
}

export interface Harness {
  ingest(t: TriggerDraft): IngestResult
  router: {
    /** Resolves when at least one thread has unrouted triggers; opens Evals for all of them. */
    next(signal?: AbortSignal): Promise<RouterBatch>
    decide(evalId: EventId, d: RouterDecision): { decided: EventId; ticket?: TicketId }
    reply(r: { ticket: TicketId; purpose: ReplyPurpose; text: string; inReplyTo?: EventId }): { ok: true; reply: EventId } | { ok: false; problem: string }
  }
  /** Chain of Recall: any id (event, thread key, ticket, run, gate) -> card with next-hop ids. */
  recall(id: string): Card | undefined
  panel: {
    attention(): readonly AttentionItem[]
    answer(gate: GateId, answer: string, requestId: string): void
    stop(ticket: TicketId, requestId: string): void
    setPolicy(settings: unknown, requestId: string): { version: string }
    /** Re-fold the stored history of `trigger` events through a candidate policy's gate. No writes, no LLM. */
    simulate(settings: unknown): { admitted: number; newlyAdmitted: readonly EventId[]; newlyRefused: readonly EventId[] }
  }
  /** Starts source pollers, the reaction loop, the effect reactors and the env prober. Returns stop. */
  run(): () => Promise<void>
}

export interface HarnessOptions {
  dbPath: string
  sources: readonly Source[]
  executor: (sink: ExecutorSink) => Executor
  envs: EnvironmentPort
  maxRuns: number                           // +1 slot reserved for runs started by a human input
}

export async function openHarness(o: HarnessOptions): Promise<Harness> {
  throw new Error('not implemented')
  // const log = openLog(o.dbPath, [threadView, ticketView, policyView, effectsView, envView, attentionView])
  // const sink: ExecutorSink = { report: (run, r) => log.transact((read) => fromWorker(read, run, r)) }
  // const exec = o.executor(sink)
  // boot: exec.reconcile(runs whose ticketView status is 'running' or 'stopping')
  //
  // Three loops, all reading log.tail; none keeps state of its own beyond a seq cursor
  // (the cursor is a cache: losing it means re-reacting, which is idempotent):
  //  1. reactions:  for e of tail -> log.transact((read) => react(read, e))
  //  2. effects:    for intent of effectsView.pending (not held), concurrency per kind:
  //       reply -> source.send(channel, text, intentId)  -> reply.settled   (FIFO per ticket+channel;
  //                source off -> retry later, no failure count; 'gone' -> settled dropped)
  //       run   -> slots free & env online & mandateValidity -> exec.start(run, spec, read.text(spec.brief))
  //                (invalid mandate -> react writes ticket.closed + attention item, never starts)
  //       stop  -> exec.stop(run)  (re-issued every pass until run.ended exists: durable stop)
  //  3. router wake: when threadView has unrouted triggers, resolve the pending router.next()
}
