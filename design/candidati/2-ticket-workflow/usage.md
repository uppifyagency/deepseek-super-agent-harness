# Usage (caller's view): "the Ticket is the workflow"

Candidate 2. Written before the types; `*.ts` in this folder are derived from it.

## README

The harness is one Node (>= 22.19) process. It holds two stores and nothing else:

- `service.sqlite`: what Atomic cannot hold. Triggers, Threads (with their subscribers), Evals
  and Decisions, Tickets (identity + Mandate + channels only), the Inbox (per-Ticket queue of
  deliveries), the Outbox, the service effect queue.
- `journal.sqlite`: Atomic 0.9.63's run journal. One long-lived workflow run per accepted Ticket.
  Every execution fact lives here and only here: which attempt is running, what the worker
  said, what the verifier ruled, which question is open, how much budget was spent, whether the
  run is parked, crashed, or done.

A Ticket has no status column. Its status is read from its run (`ticketView(ticketId)`).

```ts
import { startHarness } from "./service";

const harness = await startHarness({
  stateDir: "/var/lib/superagent",          // service.sqlite + journal.sqlite + worktrees/
  repoRoot: "/srv/repos",
  settings,                                  // zod-parsed Settings: sources, rules, accept mode
});
// Boot already did: open both stores, create the one engine session, resume every open
// Ticket's run (retrying through the ~120 s lease window), start polling sources.

await harness.stop();                        // disposes the engine session: runs release at
                                             // their last checkpoint, next boot adopts them
```

The life of an event:

1. A Source polls GitHub, builds a `Trigger` with a content-derived id, calls `receive`.
2. Fast filter (pure, no LLM): scope, allowlist, admission cell. Drop or keep.
3. If any Thread of the Trigger has subscribers, the Trigger goes **straight into each
   subscriber's Inbox** (pass-through, no Router). Otherwise it waits on the Thread for an Eval.
4. Eval (slow filter, LLM, no tools): batches the Thread's pending Triggers, decides
   `ignore | accept | stop | unavailable`. In `observe` mode an inferred accept becomes
   `ignore` with `wouldAccept`.
5. `accept` writes a Ticket, subscribes its Threads, queues an acknowledgement reply and an
   `ensureRun` effect, all in one service transaction. The effect calls `engine.ensureRunning`,
   which starts `ticket-v1` with `runId = ticketId`.
6. The Ticket workflow loops: run an attempt (worker stage + independent verifier stage, in a
   child workflow with its own budget), report, then **park** until its Inbox has something.
   A park is a durable `ctx.ui.input` whose answer is the next Inbox batch.
7. Every outward word goes through `report` -> service `Replies` -> Outbox. The workflow and
   the worker never hold a channel or a GitHub token.

## Call site 1: a Source delivering a Trigger (service side, no Atomic)

```ts
// sources/github-issue-comment.ts
export async function onComment(ctx: SourceContext, c: GhComment): Promise<void> {
  const trigger: Trigger = {
    id: triggerId("github-comment", c.url, c.id, c.updatedAt),   // replay-stable
    source: "github",
    threads: [threadRef("github", `${c.repo}#${c.number}`)],
    actor: { source: "github", id: c.user.login },
    human: c.user.type !== "Bot",
    addressed: c.body.includes("@superagent") ? "mention" : undefined,
    at: c.createdAt,
    text: untrusted(c.body),
    channel: { source: "github", thread: `${c.repo}#${c.number}`, address: { kind: "issue" } },
  };
  const r = ctx.receive(trigger);
  // r: { kind: "duplicate" } | { kind: "filtered"; reason } | { kind: "queued"; thread }
  //  | { kind: "delivered"; tickets: TicketId[] }   <- pass-through to subscribed Tickets
}
```

The Source never learns whether a workflow exists. `delivered` means "appended to the Inbox";
waking the run is the Inbox's job.

## Call site 2: the Ticket workflow body (Atomic side)

```ts
// ticket-workflow.ts (abridged; the real body is in that file)
export const ticketV1 = defineTicketWorkflow("ticket-v1", async (t) => {
  let brief = t.brief;                                   // from Ticket inputs, cached
  for (let attemptNo = 1; ; attemptNo++) {
    const r = await t.attempt(attemptNo, brief);         // child workflow, own budget
    switch (r.kind) {
      case "verified":                                   // verifier passed at r.sha
        await t.publish(attemptNo, r);                   // push + PR via host-held token, opKey'd
        await t.report({ kind: "done", attemptNo, verified: r });
        break;
      case "needs_human":
        if (t.mandate.delivery === "silent") return t.finish("discarded");
        await t.report({ kind: "question", attemptNo, question: r.question });
        break;
      case "budget":
        if (t.mandate.delivery === "silent") return t.finish("discarded");
        await t.report({ kind: "question", attemptNo, question: budgetQuestion(r) });
        break;
      case "failed":
        await t.report({ kind: "failed", attemptNo, evidence: r.evidence });
        break;
    }
    const wake = await t.park(why(r));                   // durable wait on the Inbox
    if (wake.kind === "revoked") return t.finish("revoked");
    if (wake.kind === "closed") return t.finish(wake.outcome);   // PR merged / closed
    brief = withFollowUps(brief, wake.items);            // refs + 50-char previews
  }
});
```

`t` is a `TicketCtx`, not Atomic's `ctx`. It exposes four durable verbs (`attempt`, `publish`,
`report`, `park`) and `finish`. The body cannot reach `ctx.ui` or `ctx.tool` directly, so it
cannot write a park key, a GitHub call, or a service call that is not replay-safe.

## Call site 3: the panel and the Watchdog read a Ticket

```ts
// app/http.ts
app.get("/tickets/:id", async (req) => {
  const view = await harness.ticketView(asTicketId(req.params.id));
  // view.phase: "starting" | "working" | "waiting" | "ended" | "crashed"
  // view.waitingFor (when phase === "waiting"): "human" | "events" | "environment"
  // view.question, view.lastVerdict, view.spend, view.attemptNo
  return render(view);
});

// watchdog/check.ts (separate process, read-only on both stores)
for (const v of await harness.openTicketViews()) {
  if (v.phase === "crashed") await harness.ensureRunning(v.ticketId);   // idempotent
  if (v.phase === "working" && v.silentForMs > STUCK_MS) await judgeProgress(v);  // LLM
}
```

A person answering from the panel does not call a gate API. The panel posts a Trigger with
`source: "panel"` on the Ticket's own Thread. It reaches the Inbox like any GitHub comment,
and the parked run wakes.
