// github.ts: the only module that knows GitHub's shapes. Parses gh JSON into TriggerDraft at the
// boundary; sends replies idempotently. Credentials: GH_TOKEN read from the keychain per call and
// passed only to the spawned `gh` child; the daemon process env stays tokenless (see engine.ts guard).

import type { EventId, Repo, ThreadRef } from './domain.ts'
import type { IngestResult, TriggerDraft } from './service.ts'

export interface GitHub {
  /** One pass over every listed repo since the stored cursor. Cursor advances only after ingest returned. */
  poll(ingest: (t: TriggerDraft) => IngestResult, signal: AbortSignal): Promise<void>
  /** Idempotent by intent id: searches the thread for `<!-- harness:<id> -->` before posting. */
  send(issue: ThreadRef & { kind: 'issue' }, text: string, id: EventId): Promise<{ result: 'sent' | 'gone'; url?: string }>
}

export function githubSource(repos: readonly Repo[], o: { cursorFile: string; token: () => Promise<string> }): GitHub {
  throw new Error('not implemented')
  // poll: per repo, `gh api /repos/{r}/issues/comments?since=` + `/pulls/comments` + `/issues?since=`
  //       + PR state for merged detection; ETag (If-None-Match) so idle polls cost no rate limit.
  //   native = { id: comment id, version: updated_at }; correlates from "Fixes #n" and branch `harness/<ticket>`.
  // send: 404/410/locked -> 'gone' (not retried); 5xx/network -> throw (outbox retries next pass).
}
