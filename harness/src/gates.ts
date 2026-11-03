// gates.ts: a worker's question as rules over the log (unit 5). No Atomic, no GitHub.
//   engine: a stage asks -> gate.opened (GateId from content, so a re-ask after resume is the same gate)
//   router: sees the gate in next(), asks in the issue (reply purpose 'ask', about = the gate.opened id)
//   human comment on that issue -> pending reply on the gate -> router answers (gate.answered) or asks again
//   operator: `harness answer <gate> <text>` (gate.answered by human)
// The stage waits inside Atomic (awaiting_input); the engine resolves it when gate.answered exists.

import { threadKey } from './domain.ts'
import type { Draft, Event, EventId, GateId, GateSpec, RunKey, ThreadRef } from './domain.ts'
import { hash } from './log.ts'
import type { Reader, View } from './log.ts'

export interface GateLine {
  gate: string; opened: string; run: string; to?: string; spec: GateSpec
  asked: boolean                // a reply.intended about this gate exists
  replies: string[]             // follow-up triggers on the issue since the last ask, not yet resolved
  answer?: string
}

/** Open and answered gates. One global part: a person's harness has a handful at a time. */
export const gatesView: View<{ gates: Record<string, GateLine> }> = {
  name: 'gates', version: 1, init: { gates: {} },
  parts: (e) => (e.kind.startsWith('gate.') || e.kind === 'reply.intended' || (e.kind === 'trigger.filtered' && (e as Event<'trigger.filtered'>).body.reason === 'follow-up') ? ['all'] : []),
  evolve: (s, e) => {
    const gates = { ...s.gates }
    if (e.kind === 'gate.opened') {
      const b = (e as Event<'gate.opened'>).body
      gates[b.gate] ??= { gate: b.gate, opened: e.id, run: b.run, to: b.to ? threadKey(b.to) : undefined, spec: b.spec, asked: false, replies: [] }
    } else if (e.kind === 'gate.answered') {
      const b = (e as Event<'gate.answered'>).body
      if (gates[b.gate]) gates[b.gate] = { ...gates[b.gate], answer: b.answer, replies: [] }
    } else if (e.kind === 'reply.intended') {
      for (const g of Object.values(gates)) if (e.cause.includes(g.opened as EventId) && g.answer === undefined) gates[g.gate] = { ...g, asked: true, replies: [] }
    } else {
      const key = threadKey(e.thread), trigger = (e as Event<'trigger.filtered'>).body.trigger
      for (const g of Object.values(gates)) if (g.to === key && g.asked && !g.answer) gates[g.gate] = { ...g, replies: [...g.replies, trigger] }
    }
    return { gates }
  },
}

export const GATE_VIEWS = [gatesView] as View<unknown>[]

export function gateIdOf(run: RunKey, stage: string, index: number, spec: GateSpec): GateId {
  return hash('gate', run, stage, index, spec.kind, spec.question, spec.options ?? []) as string as GateId
}

/** Opens the gate once. The ticket's issue is where the requester is asked. */
export function openGate(read: Reader, run: RunKey, gate: GateId, spec: GateSpec, by: 'engine' | 'daemon' = 'engine'): Draft[] {
  if (read.view(gatesView, 'all').gates[gate]) return []
  const intended = read.event(run as string as EventId) as Event<'run.intended'> | undefined
  if (!intended || intended.kind !== 'run.intended') return []
  const sub = read.effects(read.event(intended.cause[0])?.cause[0] as EventId).find((x) => x.kind === 'subscribed')
  const to: ThreadRef | undefined = sub?.thread
  return [{ thread: intended.thread, kind: 'gate.opened', by, cause: [intended.id], body: { run, gate, spec, ...(to ? { to } : {}) } } as Draft<'gate.opened'>]
}

/** One answer per gate. An answer to a gate with options must name one of them, or be free text when the worker allowed it. */
export function answerGate(read: Reader, gate: string, answer: string, by: 'router' | 'human', requestId: string): { drafts: Draft[]; result: { ok: true; already?: boolean } | { ok: false; problem: string } } {
  const g = read.view(gatesView, 'all').gates[gate]
  if (!g) return { drafts: [], result: { ok: false, problem: `no gate ${gate}` } }
  if (g.answer !== undefined) return { drafts: [], result: { ok: true, already: true } }
  const text = answer.trim()
  if (!text) return { drafts: [], result: { ok: false, problem: 'empty answer' } }
  const opened = read.event(g.opened as EventId)!
  return { drafts: [{ thread: opened.thread, kind: 'gate.answered', by, cause: [opened.id, ...g.replies as EventId[]], body: { gate: gate as GateId, answer: text, requestId } } as Draft<'gate.answered'>], result: { ok: true } }
}

/** Gates the router must act on: not yet asked, or with replies to read. */
export function gatesForRouter(read: Reader): GateLine[] {
  return Object.values(read.view(gatesView, 'all').gates).filter((g) => g.answer === undefined && g.spec.audience === 'requester' && (!g.asked || g.replies.length > 0))
}
