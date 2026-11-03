# Candidate 1: the harness is an Atomic package

## Problem

A personal, always-on harness on one Mac: it reads 1-3 of Vlad's GitHub repos, decides what
to work on, runs isolated pstack workers, gets an independent verdict and replies on GitHub. Vlad
wants Atomic 0.9.63 as the real engine, not a step runner. The previous design kept all state in its
own log and used Atomic for four steps; its own open question 1 asked "is Atomic still needed?".
This candidate answers the other way: Atomic owns everything it can. The constraints that shape it
(ground-atomic-host.md):
- end notices wake the owner session but carry no outputs; `awaiting_input` wakes nobody (2.2);
- the extension loads in every stage session, and `tool_call` can block or rewrite (1.2);
- `resumeInFlight` skips runs inside the ~120 s lease and runs released by a clean shutdown (2.3);
- no GitHub source, no launchd, no watchdog, no non-LLM path to steer a running stage (6, 7);
- stages run in-process with the router, so they share its env and keychain access (1.2 gap b).

## Usage (caller's view)

See `usage.md`. Three callers: Vlad (GitHub comments, `harness attach`, `harness observed`), the
router model (one tool, `harness`, with 11 actions), and the `ticket` workflow code (verdicts and
publish). Nothing else calls the harness.

## Shape

**The package is the harness.** `package.json` declares `atomic.extensions`, `atomic.workflows`,
`atomic.skills` (package-manager-manifest.ts:13,48,70-81). `harness install` runs
`atomic install` for it and for pstack. There is no separate service process with its own logic.

**Module map (6 files, any flow traced in at most 3).**

| File | Owns |
|---|---|
| `src/domain.ts` | the fact list, ids, roles, and pure policy: `prefilter`, `mandateFor`, `composeReply`, `independentVerdict`, `checkTool` |
| `src/store.ts` | the append-only SQLite store; private to the package |
| `src/github.ts` | GitHub source, reply channel and publish; the only file that runs `gh` |
| `src/extension.ts` | `roleOf`, the guard, the router loop, the worker inbox, the `harness` tool |
| `workflows/ticket.ts` | one ticket = one Atomic run: work, gate, verify, publish |
| `src/host.ts` | the `harness` CLI: daemon, attach, watchdog, install |

**Data structures first.**
- *What Atomic owns, the harness never copies:* run status, budget spend, pending prompts, run
  outputs, stage transcripts, worktrees, the router's conversation. Read at the boundary via
  `workflow status` (per single source of truth).
- *What the store owns:* one `facts` table, append only, content-addressed id (no timestamp in
  the id). Twelve kinds in one list (`Kinds` in domain.ts). Views are SQL over facts, no
  materialized tables. Multiple writers (router, stages, pstack children, watchdog) only ever
  INSERT OR IGNORE, so there is no shared mutable row to serialize (per
  separate-before-serializing-shared-state). The poller cursor is the one mutable row, single writer.
- *Ticket = run.* `TicketId = hash('ticket', decided.id)`; `run.linked` maps it to Atomic run ids,
  attempt-ordered. Ticket status is derived: closed fact, else the current run's Atomic status.

**Roles are derived, never claimed.** `roleOf(ctx)` uses the stage context
(`orchestrationContext.workflowStageName`, context-types.ts:126-130), a `--harness-role` flag and
the router lock file. Authorship is in the types (`DraftBy<R>`, `StoreFor<R>`): worker code cannot
build a `reply.intended`. Workers never talk to humans by construction: they have no reply action
and their bash is logged out of GitHub.

**One guard, one table.** `checkTool(role, tool, input)` runs in every session. The router may
only call `harness` and read-only `workflow` actions: "router never executes" is enforced by the
hook, not by `setActiveTools`, which would also narrow stage tools (ground-atomic-host 8 A). Worker
bash is rewritten in place to a logged-out env (no gh config, no credential helper, no ssh agent).

**Async ReAct is Atomic's.** The router starts a ticket with `ctx.executeTool("workflow", {action:"run"})`
from inside its tool, so the run is owned by the router session and its end notice wakes the router
(lifecycle-notifications.ts:226-235). The extension adds the two notices Atomic lacks: gate prompts
(from `observeWorkflowActivity`) and watchdog judgments (from the store).

**Two-stage filter + pass-through.** Code: `prefilter` drops our own replies (marker), unknown
actors and off repos, and routes follow-ups on subscribed threads to the ticket. LLM: the router
gets everything else as one batched message per poll tick. Pass-through needs no router turn: the
extension instance inside the work stage reads its inbox and steers its own session; anything that
arrives after the stage settled is caught by the workflow's `inbox-<round>` step before publish.

**Gates are Atomic's.** A worker's question ends its stage with `status: "question"`; the workflow
asks `ctx.ui.input` (durable `awaiting_input`); the router relays it to GitHub and answers with
`workflow answer`; the next work stage forks the previous session (`context: "fork"`,
`forkFromSessionId`), so the worker keeps its context. Headless, `humanInput: null` keeps the gate
pending and never auto-approves (sdk.md:279-297). The harness never merges or deploys, so there
is no irreversible-action gate to build.

**Verify before done.** A fresh stage, edit tools excluded, verifier role in the guard, schema
output. `independentVerdict()` refuses writer == verifier. Publish re-reads head and patch-id and
requires `verdictStillValid` (pstack shipping.md:9). Same model for both (Vlad's opus rule):
recorded as `sameModel: true` on every verdict.

**Inline & Spill, Chain of Recall, compaction.** Triggers over 400 chars are spilled to blobs;
the router sees previews and ids. `harness recall` returns any object with its next-hop ids inline.
`session_before_compact` replaces the router's history with the open-ticket board plus the last
20 messages (event-results.ts:86-90).

**Observe and speculative share the open path.** Observe: `open` records `decided {observe}` and
starts nothing. Speculative: `open {speculative}` runs silent; a question ends it as discarded; a
PASS publishes a draft PR, which the router then reveals.

**Interface depth.** Public surface: one LLM tool (`harness`, 11 actions), one workflow (7 inputs),
one CLI (5 commands). Hidden: polling, cursors, dedup, mandate, observe, reply norms, idempotent
posting, outbox, gate relay, pass-through, role policy, env scrubbing, reconcile after crash,
compaction. Wire types stay in github.ts.

## Synthesis decision

## Tradeoffs accepted

- We accept two durable stores (Atomic journal + harness facts) in exchange for never copying
  run state: the join key is `RunId` and the only reader that joins them is `harness status`.
- We accept a credential boundary that is a speed bump, not a wall, in exchange for no second
  macOS user: stages run in-process under Vlad's user and could, deliberately, read his keychain.
  The env rewrite plus string denies stop accidents; a separate user is the post-MVP wall.
- We accept replies posted as Vlad's own login (told apart by a hidden marker) in exchange for no
  GitHub App or bot account in the MVP.
- We accept same-model verification (opus verifies opus) because Vlad's override says so; every
  verdict says it.
- We accept one router turn per poll tick even for a single trigger, in exchange for batching.
- We accept that the TUI and the daemon cannot hold the router at the same time: `attach` is a
  handoff that disposes the daemon session and reopens it.
- We accept that pstack's own `agent` children are invisible to Atomic's journal (ground-pstack-on-atomic 4);
  a crashed stage restarts its agent session and pstack refuses orphans.

## Alternatives considered

- **SDK daemon with all logic in host code, extension only for the guard.** Same engine, but two
  homes for behavior (host code vs extension) and the TUI-attached session would lack the poller
  and the gate relay. Exposes more: the attach mode would need its own copy of the router loop.
- **Router as plain TUI in tmux under launchd.** Zero handoff and a free human-input adapter, but
  launchd + tmux + TUI has no clean shutdown path and no SDK hooks (`startPendingRecovery`,
  `dispose`). Close second; would replace `attach` with `tmux attach`.
- **Harness as one long-running workflow (shape C).** Rejected: no durable sleep or inbox,
  replay from the top grows without bound, depth cap 3 (ground-atomic-host 8 C).

## Implementation reconciliation

## Open questions and risks

1. Does `pi.sendMessage(..., {deliverAs:"steer"})` from the extension instance inside a stage
   reach that stage's own session mid-run? The whole pass-through rests on it.
2. Can a budget-blocked run be resumed with a raised budget, or must `retry` open a new run?
   (sdk.md: "obtain approval before explicitly resuming with a raised budget" suggests yes.)
3. Does `pi.sendUserMessage("/workflow resume <id>", {expandPromptTemplates:true})` dispatch the
   command headless without an LLM turn? Reconcile uses it in both daemon and TUI.
4. Is `ctx.ui.input` at run level visible as a prompt in `observeWorkflowActivity` frames
   (workflow-events.ts: "a human-input prompt raised by a run itself")?
5. Should the harness post as a bot account from day one, to keep Vlad's GitHub history clean?

**Directions rejected for the MVP:** IM channels, a web panel (the TUI BACKGROUND panel and
`harness observed` cover it), `simulate(policy)`, merge/deploy, Atomic local worker pools (break
pstack's child command, ground-pstack-on-atomic 4), a second macOS user for workers.

**Three biggest risks, cheapest test each:**
1. *Stage self-steer does not work* (pass-through falls back to a router turn per follow-up).
   Test: a 20-line extension + a one-stage workflow that writes a file, then 10 s later the
   extension steers "also write B"; check both files exist. About 30 minutes.
2. *Handoff and crash recovery lose runs* (lease window, released runs, reopened session id).
   Test: start a 10-minute dummy run from the SDK daemon, `kill -9` it, restart within 30 s,
   confirm reconcile resumes it after the lease; repeat with `harness attach`.
3. *Router stays on track over days* (compaction to the board, batching, one tool). Test: replay
   200 recorded GitHub events from one repo in observe mode in one day, read `harness observed`
   and the router's context size after each compaction.

## Next implementation step

Build the risk-1 spike (stage self-steer) before any store or GitHub code: if it fails, the
worker inbox moves to a router `route` turn and the shape otherwise stands.
