// Shared test fixtures: a seeded draft generator and two plain-data views.

import { threadKey } from '../src/domain.ts'
import type { Draft, Event, EventId, ThreadRef } from '../src/domain.ts'
import { idOf } from '../src/log.ts'
import type { View } from '../src/log.ts'

/** mulberry32: small deterministic PRNG, so every failure is reproducible from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const THREADS: ThreadRef[] = [
  { kind: 'issue', repo: 'vlad/sandbox' as never, number: 1 },
  { kind: 'issue', repo: 'vlad/sandbox' as never, number: 2 },
  { kind: 'system', name: 'policy' },
  { kind: 'system', name: 'watchdog' },
]

/**
 * `n` drafts over a few threads. Causes point at earlier drafts (by idOf), and some drafts are
 * exact repeats of earlier ones, so dedupe is exercised. Object key order is shuffled on purpose.
 */
export function drafts(seed: number, n: number): Draft[] {
  const r = rng(seed)
  const out: Draft[] = []
  for (let i = 0; i < n; i++) {
    if (out.length > 3 && r() < 0.1) { out.push(out[Math.floor(r() * out.length)]); continue }
    const thread = THREADS[Math.floor(r() * THREADS.length)]
    const cause = out.length && r() < 0.6
      ? [idOf(out[Math.floor(r() * out.length)]), ...(r() < 0.3 ? [idOf(out[Math.floor(r() * out.length)])] : [])]
      : []
    const k = r()
    let d: Draft
    if (k < 0.6) {
      const text = 'x'.repeat(Math.floor(r() * 900))
      const body = r() < 0.5
        ? { native: { id: `c${i}`, version: `v${Math.floor(r() * 3)}` }, actor: 'vlad', human: true, addressed: r() < 0.5, text: { preview: text.slice(0, 400), length: text.length }, url: `https://x/${i}`, correlates: [] }
        : { url: `https://x/${i}`, correlates: [], text: { length: text.length, preview: text.slice(0, 400) }, addressed: r() < 0.5, human: true, actor: 'vlad', native: { version: `v${Math.floor(r() * 3)}`, id: `c${i}` } }
      d = { thread, kind: 'trigger', by: 'source', cause, body } as Draft
    } else if (k < 0.8) {
      d = { thread, kind: 'policy.set', by: 'human', cause, body: { mode: r() < 0.5 ? 'observe' : 'auto', maxWorkers: 2, requestId: `r${Math.floor(r() * 50)}` } } as Draft
    } else {
      d = { thread, kind: 'watchdog.judged', by: 'watchdog', cause, body: { run: `run${Math.floor(r() * 5)}`, verdict: 'progressing', evidence: `e${i}` } } as unknown as Draft
    }
    out.push(d)
  }
  return out
}

/** Events per thread: count, kinds in order, and the last id. Part = thread key. */
export const perThread: View<{ n: number; kinds: string[]; last: string }> = {
  name: 'perThread', version: 1, init: { n: 0, kinds: [], last: '' },
  parts: (e) => [threadKey(e.thread)],
  evolve: (s, e) => ({ n: s.n + 1, kinds: [...s.kinds, e.kind], last: e.id }),
}

/** One global part: every id in append order and the latest policy mode. */
export const everything: View<{ ids: string[]; mode: string | null }> = {
  name: 'everything', version: 1, init: { ids: [], mode: null },
  parts: () => ['all'],
  evolve: (s, e) => ({ ids: [...s.ids, e.id], mode: e.kind === 'policy.set' ? (e as Event<'policy.set'>).body.mode : s.mode }),
}

export const PARTS = ['all', ...THREADS.map(threadKey)]

/** The stored draft of an event (what the log hashed), for replaying into another log. */
export function draftOf(e: Event): Draft {
  const { id: _id, seq: _seq, at: _at, ...d } = e
  return d as Draft
}

export type { EventId }
