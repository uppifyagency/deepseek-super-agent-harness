// github.ts: source AND channel AND publish. The only file that knows GitHub's wire shapes; it
// returns domain Triggers. The token is read from the Keychain per call and given to ONE `gh`
// child as GH_TOKEN; it is never in process.env, so stage sessions (same process) cannot see it.

import type { AttemptSpec, IntentId, ReplyText, ThreadKey, Trigger } from './domain'

export interface GitHub {
  /** Issues, comments, reviews, check runs, PR state changes since `since`, for every configured repo.
   *  Content ids include the native updated_at, so an edited comment is a new trigger. Own replies
   *  (carrying the harness marker) come back flagged and intake drops them. */
  poll(since: string): Promise<{ triggers: Trigger[]; next: string }>
  /** Idempotent by intent: searches the thread for `<!-- harness:intent=ID -->` before posting. */
  reply(thread: ThreadKey, intent: IntentId, text: ReplyText): Promise<'sent' | 'gone'>
  /** Host step called from inside the ticket-attempt workflow via ctx.tool.
   *  `git push <remote> <sha>:refs/heads/<branch>` (idempotent by sha), then PR find-or-open by branch
   *  with a hidden ticket marker; draft PR when the ticket is silent. Returns the PR number. */
  publish(spec: AttemptSpec, headSha: string): Promise<number>
}

export function openGitHub(o: { repos: string[]; vlad: string; token: () => Promise<string> }): GitHub {
  throw new Error('not implemented')
  // token: `security find-generic-password -s harness-github -w`
  // addressed = author === vlad && (body includes '@harness' || issue has label 'agent')
  // human = user.type !== 'Bot'
}
