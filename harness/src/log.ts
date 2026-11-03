// log.ts: the single source of truth for the SERVICE. Owns ~/.harness/log.sqlite (node:sqlite, WAL).
// Atomic's journal is the source of truth for EXECUTION; the only shared key is
// RunKey <-> AtomicRunId, recorded once by `run.bound`.
//
// Two processes write: the daemon (every kind but one) and the watchdog (`watchdog.judged` only).
// Both go through `transact` under BEGIN IMMEDIATE, so there is one write path, not one writer.
// View rows are caches: dropping them and replaying `event` gives the same answers.

import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { threadKey } from './domain.ts'
import type { Draft, Event, EventId, Hash, Kind, Seq, Text, ThreadRef } from './domain.ts'

/**
 * A pure fold, partitioned so an event touches only its parts. Bump `version` to rebuild by replay.
 * State is stored as JSON, so it must be plain data (objects, arrays, strings, numbers, booleans).
 */
export interface View<S> {
  name: string
  version: number
  init: S
  parts(e: Event): readonly string[]
  evolve(s: S, e: Event): S
}

export interface Reader {
  view<S>(v: View<S>, part: string): S
  event(id: EventId): Event | undefined
  thread(t: ThreadRef, opts?: { kinds?: readonly Kind[]; after?: Seq }): readonly Event[]
  causes(id: EventId): readonly Event[]
  effects(id: EventId): readonly Event[]      // reverse index on cause: Chain of Recall walks both ways
  text(t: Text): string
  head(): Seq
}

export type Decider = (read: Reader) => readonly Draft[]

export interface Log {
  /** The only write path. Pure decider inside BEGIN IMMEDIATE; existing ids are skipped (idempotent). */
  transact(decide: Decider): readonly Event[]
  read: Reader
  tail(from: Seq, signal: AbortSignal): AsyncIterable<Event>
  spill(full: string, inline?: number): Text
  close(): void
}

export interface LogOptions {
  /** The watchdog opens with ['watchdog.judged']: transact refuses any other kind. */
  readonlyExcept?: readonly Kind[]
  /** How often `tail` polls for events appended by another process. */
  pollMs?: number
}

const SPILL_INLINE = 400

const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  id     TEXT NOT NULL UNIQUE,
  thread TEXT NOT NULL,
  kind   TEXT NOT NULL,
  by     TEXT NOT NULL,
  at     TEXT NOT NULL,
  draft  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_thread ON event(thread, seq);
CREATE TABLE IF NOT EXISTS edge (cause TEXT NOT NULL, effect TEXT NOT NULL, PRIMARY KEY (cause, effect));
CREATE TABLE IF NOT EXISTS blob (hash TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS view (name TEXT NOT NULL, part TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, part));
CREATE TABLE IF NOT EXISTS view_meta (name TEXT PRIMARY KEY, version INTEGER NOT NULL, up_to INTEGER NOT NULL);
`

interface EventRow { seq: number; id: string; at: string; draft: string }

export function openLog(path: string, views: readonly View<unknown>[], opts: LogOptions = {}): Log {
  const db = new DatabaseSync(path)
  // busy_timeout FIRST: switching to WAL takes a lock, and two processes opening at once would
  // otherwise fail with "database is locked" (1 run in 25 of the concurrency test, 02/11).
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
  db.exec(SCHEMA)

  const names = new Set<string>()
  for (const v of views) {
    if (names.has(v.name)) throw new Error(`duplicate view name: ${v.name}`)
    names.add(v.name)
  }

  const q = {
    byId: db.prepare('SELECT seq, id, at, draft FROM event WHERE id = ?'),
    insert: db.prepare('INSERT INTO event (id, thread, kind, by, at, draft) VALUES (?, ?, ?, ?, ?, ?)'),
    edge: db.prepare('INSERT OR IGNORE INTO edge (cause, effect) VALUES (?, ?)'),
    effects: db.prepare('SELECT e.seq, e.id, e.at, e.draft FROM edge g JOIN event e ON e.id = g.effect WHERE g.cause = ? ORDER BY e.seq'),
    after: db.prepare('SELECT seq, id, at, draft FROM event WHERE seq > ? ORDER BY seq LIMIT 500'),
    thread: db.prepare('SELECT seq, id, at, draft FROM event WHERE thread = ? AND seq > ? ORDER BY seq'),
    head: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM event'),
    viewGet: db.prepare('SELECT value FROM view WHERE name = ? AND part = ?'),
    viewPut: db.prepare('INSERT INTO view (name, part, value) VALUES (?, ?, ?) ON CONFLICT(name, part) DO UPDATE SET value = excluded.value'),
    viewDrop: db.prepare('DELETE FROM view WHERE name = ?'),
    metaGet: db.prepare('SELECT version, up_to FROM view_meta WHERE name = ?'),
    metaPut: db.prepare('INSERT INTO view_meta (name, version, up_to) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version, up_to = excluded.up_to'),
    blobPut: db.prepare('INSERT OR IGNORE INTO blob (hash, text) VALUES (?, ?)'),
    blobGet: db.prepare('SELECT text FROM blob WHERE hash = ?'),
  }

  const toEvent = (r: EventRow): Event =>
    ({ ...(JSON.parse(r.draft) as Draft), id: r.id as EventId, seq: r.seq as Seq, at: r.at }) as Event

  const head = (): Seq => (q.head.get() as { seq: number }).seq as Seq

  let inTxn = false
  let foldedTo = -1   // head this process last caught every view up to

  const read: Reader = {
    view<S>(v: View<S>, part: string): S {
      if (!inTxn && head() !== foldedTo) inTransaction(catchUp)
      const row = q.viewGet.get(v.name, part) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as S) : structuredClone(v.init)
    },
    event(id) {
      const row = q.byId.get(id) as EventRow | undefined
      return row ? toEvent(row) : undefined
    },
    thread(t, o = {}) {
      const rows = q.thread.all(threadKey(t), o.after ?? 0) as unknown as EventRow[]
      const all = rows.map(toEvent)
      return o.kinds ? all.filter((e) => o.kinds!.includes(e.kind)) : all
    },
    causes(id) {
      const e = read.event(id)
      return e ? e.cause.flatMap((c) => read.event(c) ?? []) : []
    },
    effects(id) {
      return (q.effects.all(id) as unknown as EventRow[]).map(toEvent)
    },
    text(t) {
      if (!t.blob) return t.preview
      const row = q.blobGet.get(t.blob) as { text: string } | undefined
      if (!row) throw new Error(`spilled text missing from blob store: ${t.blob}`)
      return row.text
    },
    head,
  }

  /** Apply one stored event to every view it touches. Runs inside the caller's transaction. */
  function fold(e: Event, only?: View<unknown>): void {
    for (const v of only ? [only] : views) {
      for (const part of v.parts(e)) {
        q.viewPut.run(v.name, part, JSON.stringify(v.evolve(read.view(v, part), e)))
      }
    }
  }

  function inTransaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    inTxn = true
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    } finally {
      inTxn = false
    }
  }

  /**
   * Bring every view of THIS process up to the log head. A view with another version is rebuilt
   * from seq 0; a view that is behind (another process appended, e.g. the watchdog, which opens
   * with fewer views) folds only the missing events. Runs inside a transaction.
   */
  function catchUp(): void {
    const top = head()
    for (const v of views) {
      const meta = q.metaGet.get(v.name) as { version: number; up_to: number } | undefined
      let from = 0
      if (meta && meta.version === v.version) {
        if (meta.up_to >= top) continue
        from = meta.up_to
      } else {
        q.viewDrop.run(v.name)
      }
      for (;;) {
        const rows = q.after.all(from) as unknown as EventRow[]
        if (rows.length === 0) break
        for (const r of rows) fold(toEvent(r), v)
        from = rows[rows.length - 1].seq
      }
      q.metaPut.run(v.name, v.version, top)
    }
    foldedTo = top
  }

  inTransaction(catchUp)

  const listeners = new Set<() => void>()

  function transact(decide: Decider): readonly Event[] {
    const out = inTransaction(() => {
      catchUp()
      const events: Event[] = []
      for (const d of decide(read)) {
        if (opts.readonlyExcept && !opts.readonlyExcept.includes(d.kind)) {
          throw new Error(`this log handle may only append ${opts.readonlyExcept.join(', ')}, got ${d.kind}`)
        }
        const id = idOf(d)
        const existing = q.byId.get(id) as EventRow | undefined
        if (existing) { events.push(toEvent(existing)); continue }
        const at = new Date().toISOString()
        const res = q.insert.run(id, threadKey(d.thread), d.kind, d.by, at, JSON.stringify(stripUndefined(d)))
        for (const c of d.cause) q.edge.run(c, id)
        const e = toEvent({ seq: Number(res.lastInsertRowid), id, at, draft: JSON.stringify(stripUndefined(d)) })
        fold(e)
        events.push(e)
      }
      const top = head()
      for (const v of views) q.metaPut.run(v.name, v.version, top)
      foldedTo = top
      return events
    })
    for (const wake of listeners) wake()
    return out
  }

  async function* tail(from: Seq, signal: AbortSignal): AsyncIterable<Event> {
    let cursor: number = from
    while (!signal.aborted) {
      const rows = q.after.all(cursor) as unknown as EventRow[]
      for (const r of rows) {
        cursor = r.seq
        yield toEvent(r)
        if (signal.aborted) return
      }
      if (rows.length > 0) continue
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); listeners.delete(done); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, opts.pollMs ?? 250)
        listeners.add(done)
        signal.addEventListener('abort', done, { once: true })
      })
    }
  }

  function spill(full: string, inline = SPILL_INLINE): Text {
    if (full.length <= inline) return { preview: full, length: full.length }
    const h = hash('blob', full)
    q.blobPut.run(h, full)
    return { preview: full.slice(0, inline), length: full.length, blob: h }
  }

  return { transact, read, tail, spill, close: () => db.close() }
}

/**
 * idOf = sha256(canonical([threadKey, kind, by, sorted cause, body])). No `at`, no `seq`.
 * Two real actions with equal content must differ in body (native version, requestId).
 */
export function idOf(d: Draft): EventId {
  return digest(['event', threadKey(d.thread), d.kind, d.by, [...d.cause].sort(), d.body]) as string as EventId
}

export function hash(...parts: unknown[]): Hash {
  return digest(parts) as string as Hash
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32)
}

/** JSON with sorted object keys and undefined fields dropped, so key order never changes an id. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortKeys(x)))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = sortKeys(x)
    }
    return out
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`non-finite number in event body: ${v}`)
  return v
}

function stripUndefined<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
