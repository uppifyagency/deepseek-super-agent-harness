// log.ts: the single source of truth for the SERVICE. Owns ~/.harness/log.sqlite (node:sqlite, WAL).
// Atomic's journal (~/.harness/.atomic journal) is the source of truth for EXECUTION; the only
// shared key is RunKey <-> AtomicRunId, recorded once by `run.bound`.
//
// Private schema:  event(seq PK, id UNIQUE, thread, kind, by, at, cause JSON, body JSON)
//                  blob(hash PK, text)       view(name, part, upTo, value JSON, PK(name, part))
// Two processes write: the daemon (every kind but one) and the watchdog (`watchdog.judged` only).
// Both go through `transact` under BEGIN IMMEDIATE, so there is one write path, not one writer.

import type { Draft, Event, EventId, Hash, Kind, Seq, Text, ThreadRef } from './domain.ts'

/** A pure fold, partitioned so an event touches only its parts. Bump `version` to rebuild by replay. */
export interface View<S> {
  name: string; version: number; init: S
  parts(e: Event): readonly string[]
  evolve(s: S, e: Event): S
}

export interface Reader {
  view<S>(v: View<S>, part: string): S
  event(id: EventId): Event | undefined
  thread(t: ThreadRef, opts?: { kinds?: Kind[]; after?: Seq }): readonly Event[]
  causes(id: EventId): readonly Event[]
  effects(id: EventId): readonly Event[]      // reverse index on cause: Chain of Recall walks both ways
  text(t: Text): string
}

export type Decider = (read: Reader) => readonly Draft[]

export interface Log {
  /** The only write path. Pure decider inside BEGIN IMMEDIATE; existing ids are skipped (idempotent). */
  transact(decide: Decider): readonly Event[]
  read: Reader
  tail(from: Seq, signal: AbortSignal): AsyncIterable<Event>
  spill(full: string, inline?: number): Text
}

export function openLog(path: string, views: readonly View<unknown>[], opts?: { readonlyExcept?: Kind[] }): Log {
  throw new Error('not implemented')
  // TODO DatabaseSync(path), journal_mode=WAL, synchronous=FULL, busy_timeout=5000
  // TODO rebuild any view whose stored version differs, by replaying `event` from seq 0
  // TODO readonlyExcept: the watchdog opens with ['watchdog.judged']; transact throws on any other kind
}

/** idOf = sha256(canonical([threadKey, kind, by, sorted cause, body])). No `at`, no `seq`. */
export function idOf(d: Draft): EventId { throw new Error('not implemented') }
export function hash(...parts: unknown[]): Hash { throw new Error('not implemented') }
