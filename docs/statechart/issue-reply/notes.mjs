export const expect = "AtMostOneComment";
export const broken = "MarkerLookup = FALSE. send() POSTs without first listing the issue comments for the hidden marker, so a crash after the POST and before reply.settled gives a second comment on restart.";
export const legend = [
  "Pending in the outbox: reply.intended (routing.ts:174-183). The outbox is the fold outboxView: an intent stays pending until its reply.settled exists (routing.ts:43-56).",
  "The daemon drains the outbox on every tick (cli.ts:48-55, cli.ts:57-65).",
  "Lists the comments: send() looks for the marker harness:<intent> first (github.ts:121-128).",
  "POSTs the comment: the body carries the marker (github.ts:129).",
  "Settled: reply.settled with result sent (routing.ts:185-189).",
  "Crash after the POST: the live proof is design/mvp/e2e/unit3/crash-after-post.ts, which POSTs and exits 137 without settling.",
];
export const rules = [
  "AtMostOneComment: one reply.intended gives at most one comment in the issue.",
  "SettledMeansPosted: reply.settled sent means a comment exists.",
];
export const leftOut = [
  "One intent, one issue, at most 2 crashes. A POST that times out after GitHub created the comment acts like a crash after the POST.",
  "The gone result (HTTP 404 or 410).",
  "The model has two more switches, checked outside this folder: StaleList (GitHub's list can miss a fresh comment) and a second sender.",
];
