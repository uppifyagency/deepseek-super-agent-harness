// log.ts: the single source of truth and the single writer. Owns the SQLite file.
// Not exported from the package: service.ts is the only importer (see package.json "exports").
//
// Schema (private):
//   event(seq INTEGER PRIMARY KEY, id TEXT UNIQUE, key TEXT, kind TEXT, by TEXT, at TEXT, cause JSON, body JSON)
//   blob(hash TEXT PRIMARY KEY, text TEXT)                      -- spilled content, content-addressed
//   view(name TEXT, part TEXT, upTo INTEGER, value JSON, PRIMARY KEY(name, part))  -- fold cache
// `view` rows are caches. Deleting the table and replaying `event` must give the same answers.

import type { Draft, Event, EventId, Hash, Kind, Seq, Text, ThreadKey } from './events'

/**
 * A fold. Pure. `part` partitions the state (per thread, per ticket, or one global part), so the
 * log updates only the parts an event touches. `version` is bumped when `evolve` changes meaning;
 * a version mismatch at open triggers a rebuild of that view from seq 0.
 */
export interface View<S> {
  name: string
  version: number
  init: S
  parts(e: Event): readonly string[]           // which partitions this event updates; [] = ignore
  evolve(s: S, e: Event): S
}

/** Read access inside or outside a transaction. Always at the log head of the current txn. */
export interface Reader {
  view<S>(v: View<S>, part: string): S
  event(id: EventId): Event | undefined
  thread(key: ThreadKey, opts?: { kinds?: Kind[]; after?: Seq; limit?: number }): readonly Event[]
  causes(id: EventId): readonly Event[]        // one hop back along `cause`
  effects(id: EventId): readonly Event[]       // one hop forward (reverse index on cause)
  text(t: Text): string                        // inline preview + spilled tail
}

export type Decider = (read: Reader) => readonly Draft[]

export interface Log {
  /**
   * The only write path. Runs `decide` inside BEGIN IMMEDIATE against the head, then appends its
   * drafts and updates the affected view parts in the same transaction.
   * Idempotent: a draft whose id already exists is skipped and the stored event is returned in
   * its place, so retrying a whole command after a crash is safe.
   * `decide` must be pure: it may be re-run on SQLITE_BUSY.
   */
  transact(decide: Decider): readonly Event[]
  read: Reader
  /** Tail from a seq, live. Reactors, router wake-ups and the watchdog consume this. */
  tail(from: Seq): AsyncIterable<Event>
  head(): Seq
  /** Inline & Spill at write time: keeps the first `inline` chars, stores the rest by hash. */
  spill(full: string, inline?: number): Text
  close(): void
}

export function openLog(path: string, views: readonly View<unknown>[]): Log {
  throw new Error('not implemented')
  // TODO node:sqlite DatabaseSync, WAL, synchronous=FULL
  // TODO for each view: if stored version != v.version -> drop its rows, replay all events through it
}

/**
 * Content address. Identity excludes `at` and `seq` on purpose: same thread, kind, author, causes
 * and body give the same id. Bodies never carry our own clock (types have no time field except
 * what a source reports natively), so replaying a source page or re-running a decider is a no-op.
 * Two genuinely distinct human actions with equal content must differ in body: panel commands
 * carry a client `requestId`, source triggers carry the native id and version.
 */
export function idOf(d: Draft): EventId {
  throw new Error('not implemented')
  // TODO sha256(canonicalJson([threadKey(d.thread), d.kind, d.by, [...d.cause].sort(), d.body])).slice(0, 32)
  // canonicalJson sorts object keys; arrays keep order except `cause`
}

export function hash(...parts: unknown[]): Hash {
  throw new Error('not implemented')
}
