// Unit 1 of design/mvp/build-plan.md: the log is replay-stable, idempotent, and its views are caches.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { openLog, idOf, canonical } from '../src/log.ts'
import type { View } from '../src/log.ts'
import type { Draft, Event, Seq } from '../src/domain.ts'
import { drafts, draftOf, everything, perThread, PARTS, rng } from './fixtures.ts'

const run = promisify(execFile)
const VIEWS = [perThread, everything] as View<unknown>[]
const dir = () => mkdtempSync(join(tmpdir(), 'harness-log-'))

function all(log: ReturnType<typeof openLog>): Event[] {
  const out: Event[] = []
  // every event, in seq order, through the public reader
  const ids = log.read.view(everything, 'all').ids
  for (const id of ids) out.push(log.read.event(id as never)!)
  return out
}

function snapshot(log: ReturnType<typeof openLog>) {
  return Object.fromEntries(PARTS.map((p) => [p, p === 'all' ? log.read.view(everything, p) : log.read.view(perThread, p)]))
}

for (const seed of [1, 7, 42, 1234, 99991]) {
  test(`replay into an empty log gives the same ids and views (seed ${seed})`, () => {
    const d = dir()
    const a = openLog(join(d, 'a.sqlite'), VIEWS)
    const r = rng(seed * 31)
    const list = drafts(seed, 300)
    for (let i = 0; i < list.length;) {
      const size = 1 + Math.floor(r() * 9)
      a.transact(() => list.slice(i, i + size))
      i += size
    }
    const stored = all(a)
    const unique = new Set(list.map(idOf))
    assert.equal(stored.length, unique.size, 'one row per distinct draft')

    const b = openLog(join(d, 'b.sqlite'), VIEWS)
    for (const e of stored) b.transact(() => [draftOf(e)])
    assert.deepEqual(all(b).map((e) => e.id), stored.map((e) => e.id), 'same ids in the same order')
    assert.deepEqual(snapshot(b), snapshot(a), 'same view values')
    for (const e of stored) assert.equal(idOf(draftOf(e)), e.id, 'stored draft re-hashes to its id')
    a.close(); b.close()
  })
}

test('the same draft twice is one row, and transact returns the stored event', () => {
  const log = openLog(join(dir(), 'x.sqlite'), VIEWS)
  const [d] = drafts(5, 1)
  const [first] = log.transact(() => [d])
  const [second] = log.transact(() => [d, d])
  assert.equal(second.id, first.id)
  assert.equal(second.seq, first.seq)
  assert.equal(log.read.head(), 1 as Seq)
  assert.equal(log.read.view(everything, 'all').ids.length, 1)
  log.close()
})

test('ids ignore object key order and cause order, but not content', () => {
  const base = { thread: { kind: 'system', name: 'policy' }, kind: 'policy.set', by: 'human', cause: ['b', 'a'], body: { mode: 'auto', maxWorkers: 2, requestId: 'r1' } } as unknown as Draft
  const shuffled = { body: { requestId: 'r1', maxWorkers: 2, mode: 'auto' }, cause: ['a', 'b'], by: 'human', kind: 'policy.set', thread: { name: 'policy', kind: 'system' } } as unknown as Draft
  const other = { ...base, body: { mode: 'auto', maxWorkers: 2, requestId: 'r2' } } as unknown as Draft
  assert.equal(idOf(base), idOf(shuffled))
  assert.notEqual(idOf(base), idOf(other))
  assert.equal(canonical({ b: 1, a: { d: undefined, c: 2 } }), '{"a":{"c":2},"b":1}')
})

test('views are caches: dropping them and reopening gives the same answers', () => {
  const path = join(dir(), 'v.sqlite')
  const a = openLog(path, VIEWS)
  const list = drafts(77, 200)
  for (const x of list) a.transact(() => [x])
  const before = snapshot(a)
  a.close()

  const raw = new DatabaseSync(path)
  raw.exec('DELETE FROM view; DELETE FROM view_meta;')
  raw.close()

  const b = openLog(path, VIEWS)
  assert.deepEqual(snapshot(b), before)
  b.close()
})

test('a view version bump rebuilds that view by replay', () => {
  const path = join(dir(), 'bump.sqlite')
  const a = openLog(path, VIEWS)
  for (const x of drafts(3, 60)) a.transact(() => [x])
  const n = a.read.view(everything, 'all').ids.length
  a.close()
  const counted: View<number> = { name: 'everything', version: 2, init: 0, parts: () => ['all'], evolve: (s) => s + 1 }
  const b = openLog(path, [perThread, counted] as View<unknown>[])
  assert.equal(b.read.view(counted, 'all'), n)
  b.close()
})

test('a second handle with fewer views (the watchdog) does not leave the daemon views stale', () => {
  const path = join(dir(), 'w.sqlite')
  const daemon = openLog(path, VIEWS)
  daemon.transact(() => drafts(11, 5))
  const watchdog = openLog(path, [], { readonlyExcept: ['watchdog.judged'] })
  const judged = { thread: { kind: 'system', name: 'watchdog' }, kind: 'watchdog.judged', by: 'watchdog', cause: [], body: { run: 'r1', verdict: 'stuck', evidence: 'no commits for 40 min' } } as unknown as Draft
  const [e] = watchdog.transact(() => [judged])
  assert.throws(() => watchdog.transact(() => drafts(12, 1).filter((x) => x.kind !== 'watchdog.judged').slice(0, 1)), /may only append watchdog.judged/)
  assert.ok(daemon.read.view(everything, 'all').ids.includes(e.id), 'daemon view caught up with the watchdog append')
  watchdog.close(); daemon.close()
})

test('spill keeps a preview inline and the full text in the blob store', () => {
  const log = openLog(join(dir(), 's.sqlite'), VIEWS)
  const short = log.spill('hello')
  assert.deepEqual(short, { preview: 'hello', length: 5 })
  const long = 'a'.repeat(1000) + 'END'
  const t = log.spill(long)
  assert.equal(t.preview.length, 400)
  assert.equal(t.length, 1003)
  assert.ok(t.blob)
  assert.equal(log.read.text(t), long)
  assert.deepEqual(log.spill(long), t, 'same text, same blob')
  log.close()
})

test('causes and effects walk the reference graph both ways', () => {
  const log = openLog(join(dir(), 'g.sqlite'), VIEWS)
  const [a] = log.transact(() => drafts(21, 1))
  const child = { thread: { kind: 'system', name: 'policy' }, kind: 'policy.set', by: 'human', cause: [a.id], body: { mode: 'auto', maxWorkers: 1, requestId: 'g1' } } as unknown as Draft
  const [c] = log.transact(() => [child])
  assert.deepEqual(log.read.causes(c.id).map((e) => e.id), [a.id])
  assert.deepEqual(log.read.effects(a.id).map((e) => e.id), [c.id])
  log.close()
})

test('tail yields existing and new events, including ones appended later', async () => {
  const log = openLog(join(dir(), 't.sqlite'), VIEWS, { pollMs: 20 })
  const list = drafts(31, 6)
  log.transact(() => list.slice(0, 3))
  const ac = new AbortController()
  const seen: string[] = []
  const done = (async () => { for await (const e of log.tail(0 as Seq, ac.signal)) { seen.push(e.id); if (seen.length === 6) ac.abort() } })()
  setTimeout(() => log.transact(() => list.slice(3)), 30)
  await done
  assert.equal(new Set(seen).size, seen.length)
  assert.equal(seen.length, 6)
  log.close()
})

test('two processes appending the same drafts concurrently: same ids, no duplicates, no busy errors', async () => {
  const path = join(dir(), 'c.sqlite')
  openLog(path, VIEWS).close()
  const writer = fileURLToPath(new URL('./writer.ts', import.meta.url))
  const N = 500
  const results = await Promise.all([1, 2, 3].map((order) => run(process.execPath, [writer, path, '2026', String(N), String(order)])))
  for (const r of results) assert.equal(r.stdout.trim(), 'done')
  const log = openLog(path, VIEWS)
  const expected = new Set(drafts(2026, N).map(idOf))
  const ids = log.read.view(everything, 'all').ids
  assert.equal(ids.length, expected.size, 'one row per distinct draft across processes')
  assert.deepEqual(new Set(ids), expected)
  const counts = PARTS.filter((p) => p !== 'all').reduce((n, p) => n + log.read.view(perThread, p).n, 0)
  assert.equal(counts, expected.size, 'per-thread views agree with the global view')
  log.close()
})
