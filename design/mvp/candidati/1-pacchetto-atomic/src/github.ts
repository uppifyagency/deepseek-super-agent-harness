// github.ts: GitHub as source AND reply channel, the only module that talks to GitHub.
// Uses `gh` through node:child_process execFile with Vlad's existing gh login (keychain).
// Called only from code (poller, outbox flusher, the workflow's publish ctx.tool), never from a
// model tool, so the credential never enters a model context (article 8.4). Model-run bash gets an
// env with GH_CONFIG_DIR pointed at an empty dir (domain.checkTool), so `gh` there is logged out.
// Wire types (REST JSON) stay inside this file; callers see domain types only.

import type { FactId, RepoSlug, ReplyText, ThreadKey, Trigger } from './domain.js'

/**
 * Issues, PRs, issue comments, reviews and review comments updated since `since`.
 * Parses REST JSON into Trigger; long bodies are spilled by the caller (store.spill).
 * Returns the new cursor = max updated_at seen (not now(): no gap on clock skew).
 */
export async function poll(repo: RepoSlug, since: string | undefined, spill: (s: string) => Trigger['text']):
  Promise<{ triggers: Trigger[]; cursor: string }> {
  // TODO gh api --paginate repos/{repo}/issues?state=all&since=  (issues + PRs)
  //      gh api --paginate repos/{repo}/issues/comments?since=
  //      gh api --paginate repos/{repo}/pulls/comments?since=
  //      reviews: only for PRs touched above, gh api repos/{repo}/pulls/{n}/reviews
  throw new Error('not implemented')
}

/**
 * Idempotent post. The body ends with `<!-- harness:reply id=<intent> -->`; before posting, the
 * last 30 comments of the thread are scanned for that id, so a crash between POST and
 * `reply.settled` never double-posts.
 */
export async function post(thread: ThreadKey, text: ReplyText, intent: FactId): Promise<{ url: string }> {
  throw new Error('not implemented')
}

/**
 * Push `headSha` to `harness/<ticket>` and find-or-open a PR marked with the ticket id.
 * Safe to rerun: push is a no-op at the same sha; the PR is found by head branch first.
 * Only the `ticket` workflow's publish ctx.tool calls this, after verdictStillValid.
 */
export async function publish(args: {
  repo: RepoSlug; repoPath: string; ticket: string; headSha: string; baseBranch: string
  title: string; body: string; draft: boolean
}): Promise<{ pr: number; url: string }> {
  throw new Error('not implemented')
}
