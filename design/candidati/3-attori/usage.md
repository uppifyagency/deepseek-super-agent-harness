# Usage (caller's view), candidate 3: sessions as mailbox actors

Written before the types. The types in `src/` are derived from this file.

## README

The harness is a set of long-lived **actors**: one Router and N Workers. Each actor has a durable
**mailbox** in the service database. Nothing calls an actor directly. Everything that happens
(a GitHub comment, a finished verification, an endpoint coming back online, a human answering a
question, a Watchdog nudge) becomes a **letter** in some mailbox.

An actor runs in **turns**. A turn takes every unread letter in its mailbox as one batch, runs once
(an LLM call for the Router, a `claude -p` session on the Worker's environment for a Worker), and
returns a list of **commands**. The harness commits the commands and marks the batch read in one
transaction. Commands are the only way an actor acts. A Router cannot run shell commands; a Worker
cannot reply to a human. That split is in the command types, not in prompts.

Long operations never block a turn. `start` returns an `OpId` at once ("Started"); the result comes
back later as an `op.finished` letter. `stop` is a durable command, not a callback.

A **Ticket is the Worker's charter**: the Mandate (who authorized what, and why), the brief, the
environment it needs, and whether its result is announced or speculative. There is no separate
ticket process. Ending the Worker ends the Ticket.

The **routing table** is a many-to-many set of subscriptions `(thread, worker, role)`. When a
trigger passes the fast-path policy, every `owner` subscriber of its thread gets it as a waking
letter, every `context` subscriber gets a non-waking one, and the Router gets a non-waking `seen`
copy. A trigger on a thread with no owner wakes the Router instead.

**Environments** (a worktree on some machine, reached through a stateless endpoint daemon) are
first-class. A Worker whose environment is offline is simply not runnable: its letters pile up,
and the `env.online` letter wakes it.

```ts
import { openHarness } from "@harness/core";
import { githubSource } from "@harness/github";
import { localEndpoint } from "@harness/endpoint";

const harness = await openHarness({
  db: "/var/lib/harness/state.sqlite",       // mailboxes, routing table, charters, outbox, ledger
  journal: "/var/lib/harness/atomic.sqlite", // Atomic journal: worker turns and verifier ops
  settings: loadSettings(),                  // zod-parsed: policy rules, accept mode, channel norms
  sources: [githubSource({ repo: "acme/web", pollSeconds: 60 })],
  endpoints: [localEndpoint({ id: "vlad-mbp", repos: { "acme/web": "~/code/web" } })],
  slots: { workers: 4, humanReserve: 1 },
  router: { model: "claude-haiku-4-5" },     // article 2.1: a lighter model is usually enough
});

await harness.run(signal); // scheduler: claim runnable actor, run its turn, commit; plus effects and sources
```

## Call site 1: a source hands in a trigger (GitHub poller)

```ts
// inside githubSource, after parsing one notification into a domain Trigger
const outcome = ctx.intake(trigger);
// outcome: { kind: "duplicate" }
//        | { kind: "dropped"; reason }                        fast path said ignore
//        | { kind: "routed"; to: WorkerId[] }                 pass-through to owners
//        | { kind: "router" }                                 no owner: Router mailbox, waking
if (outcome.kind !== "duplicate") cursor.advance(notification.updatedAt);
```

The source never sees mailboxes, subscriptions, or the Router. It hands in a parsed `Trigger` with
a content-derived id; re-delivery is a no-op.

## Call site 2: what a Router turn looks like (inside the harness, shown for the contract)

The Router's batch for one turn, rendered with Inline and Spill:

```
[letter 1] trigger T7f3 on thread gh:acme/web#412 (issue, opened by @maria, unaddressed, inferred)
           "Checkout crashes when the cart has 0 items ..." (+1.2k chars, read_trigger T7f3)
[letter 2] seen T9a1 on gh:acme/web#398 -> delivered to W2c4 (owner)
[letter 3] report from W2c4: done, verdict V51e (PASS, sha 9c2e1f0), PR #401
```

The Router answers with commands (structured output, no shell tool):

```ts
[
  { do: "spawn", triggers: ["T7f3"], title: "Fix checkout crash on empty cart",
    brief: "Reproduce, fix, open a PR. Silent unless confirmed.",
    env: { repo: "acme/web", base: "main" }, delivery: "speculative" },
  { do: "reply", about: { worker: "W2c4" }, purpose: "result",
    text: "Fixed in #401 (verified on 9c2e1f0). ..." },
]
```

The harness, not the LLM, mints the Mandate for `spawn` from the fast-path admissions recorded on
`T7f3`. If accept mode is `observe` and the strength is `inferred`, the spawn is recorded as
`wouldSpawn` and no Worker starts. A reply on an IM channel over 100 words is rejected, and the
rejection comes back to the Router as a `rejected` letter in its next batch.

## Call site 3: a Worker inside its turn (claude -p with pstack, via the `harness` MCP server)

The Worker's turn prompt carries its charter, its carry note from the last turn, and its batch.
It acts on the repo with normal tools, and talks to the harness only through buffered MCP tools:

```
harness.start({ op: "verify", sha: "HEAD" })        -> { started: "O3d1" }   // returns at once
harness.report({ state: "progress", summary: "repro found, fix in progress" })
harness.ask({ question: "Drop the legacy endpoint?", options: ["yes","no"], default: "no" })
harness.handback({ trigger: "T8b0", reason: "unrelated to this ticket" })
harness.unsubscribe({ thread: "gh:acme/web#398" })
harness.carry("Next turn: wait for O3d1, then report done with its verdict.")
```

Nothing here reaches the world before the turn commits. The `verify` op runs as an independent
session; its `op.finished` letter, carrying a `VerdictId`, wakes the Worker's next turn, which
reports `{ state: "done", verdict: "V51e" }`. A `done` without a passing verdict for the current
head SHA is rejected at commit.

A Worker in `speculative` delivery that fails or blocks is discarded: no gate is opened, nothing
is said to anyone, its environment is cleaned up.

## Call site 4: a human answers a gate from the panel

```ts
harness.answer(gateId, { text: "yes, drop it", by: { source: "panel", id: "vlad" } });
// posts a gate.answered letter to the owning Worker; nothing else.
```

The same answer typed as a comment in the PR thread arrives as a trigger on a thread the Worker
owns, so it reaches the Worker by pass-through, and the Worker resolves the gate itself.

## Call site 5: the Watchdog (separate process, outside the service)

```ts
const view = await client.inspect(); // actors, open turns with age, last reports, envs, op ages
for (const w of view.workers) {
  if (judgeDrift(w).drifting) await client.nudge(w.id, "...", "watchdog");
  if (w.openTurn && w.openTurn.ageMs > HOUR) await client.stopTurn(w.openTurn.id);
}
```
