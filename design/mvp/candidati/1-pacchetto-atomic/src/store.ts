// store.ts: the service store. Only what Atomic does not keep. Private to the package.
//
// One SQLite file, ~/.harness/harness.sqlite (node:sqlite, WAL), shared by the router process, every
// stage session (same process: stages are in-process sessions, atomic-stage-session.ts:100-120),
// pstack child processes and the watchdog.
//
// Invariants:
//  - Append only. `append` is INSERT OR IGNORE on a content id: a fact written twice (replayed
//    ctx.tool, re-polled comment, retried tool call) is one fact. No UPDATE anywhere, so several
//    writers never race on a row (per separate-before-serializing-shared-state).
//  - Never stores what Atomic owns: run status, budget spend, pending prompts, outputs. Those are
//    read through `RunView` at the read boundary (extension.ts), so the two cannot disagree.
//  - The poller cursor is the only mutable row, and only the poller writes it.

import type {
  Draft, DraftBy, Fact, FactId, FactKind, Hash, IndependentVerdict, Policy, RepoSlug, RunId, Text,
  ThreadKey, TicketId, Trigger, Visibility,
} from './domain.js'

export interface TicketView {
  id: TicketId
  repo: RepoSlug
  title: string
  visibility: Visibility
  threads: ThreadKey[]        // from `subscribed`
  runs: RunId[]               // from `run.linked`, attempt order; last = current
  closed?: Fact<'closed'>
  verdict?: IndependentVerdict  // latest for the current run's head, if any
  lastJudged?: Fact<'judged'>
}

export interface Store {
  /** Idempotent. `fresh` is false when the content id already existed (re-poll, replayed ctx.tool). */
  append<D extends Draft>(draft: D): { fact: Fact<D['kind']>; fresh: boolean }

  /** Inline & Spill: returns a Text whose preview fits INLINE_CHARS; the body goes to `blobs`. */
  spill(full: string): Text
  /** Chain of Recall hop: a blob, a fact, or a ticket, rendered with the ids of its next hops inline. */
  recall(ref: Hash | FactId | TicketId): string

  // views: plain SQL over `facts`, no materialized tables to keep in sync
  ticket(id: TicketId): TicketView | undefined
  openTickets(): TicketView[]
  subscriberOf(thread: ThreadKey): TicketId | undefined   // newest open ticket subscribed to it
  /** Pass-through inbox: routed inputs for this ticket that `run` has not yet taken. */
  inbox(ticket: TicketId, run: RunId): Array<{ input: FactId; trigger: Trigger }>
  pendingReplies(): Fact<'reply.intended'>[]              // intended without settled
  verdictFor(repo: RepoSlug, headSha: string): IndependentVerdict | undefined
  progress(run: RunId, sinceMs: number): Fact<'progress'>[]
  factsSince(seq: number, kinds: FactKind[]): Fact[]      // the router's notice feed (judged, ...)

  /** Poller-owned cursor per repo. */
  cursor(repo: RepoSlug): string | undefined
  setCursor(repo: RepoSlug, iso: string): void

  policy(): Policy   // read from ~/.harness/policy.json at open; its hash goes into each Mandate
}

/** Writers get a role-narrowed handle: a stage session cannot append `reply.intended`. */
export type StoreFor<R extends 'router' | 'worker' | 'verifier' | 'watchdog' | 'code'> =
  Omit<Store, 'append'> & { append<D extends DraftBy<R>>(draft: D): { fact: Fact<D['kind']>; fresh: boolean } }

export function openStore(path: string): Store {
  // TODO: CREATE TABLE facts(seq INTEGER PRIMARY KEY, id TEXT UNIQUE, kind TEXT, by TEXT, body TEXT, at TEXT)
  //       CREATE TABLE blobs(hash TEXT PRIMARY KEY, body TEXT)
  //       CREATE TABLE cursors(repo TEXT PRIMARY KEY, iso TEXT)
  //       indexes: (kind), json_extract(body,'$.ticket'), json_extract(body,'$.run'), json_extract(body,'$.thread')
  //       PRAGMA journal_mode=WAL; busy_timeout=5000
  throw new Error('not implemented')
}
