# Candidate 3: sessions as mailbox actors

## Problem

We need an always-on service that turns GitHub events (IM later) into authorized, verified work
and replies where the person wrote, while spending human attention as little as possible. The
service layer comes from dsh (Trigger, Thread, two-stage Eval, Mandate and Policy, accept mode,
effect queue and outbox), durable execution from Atomic 0.9.63, and the working method from pstack.
Constraints the shape must honor: dsh has no Subscription type, a derived ticket stage, revalidation
only on resume, timestamped ids and a non-durable stop. Atomic has no start or gate RPC, resumes
only through `session.workflows.resume`, reports a budget stop as `status: "running"`, re-runs tools
at least once, and runs its own Pi agent (no Claude Code hooks). pstack says "done" is a verdict by a
non-author keyed by SHA, and its pause-always list is prose the host must enforce. The article adds
the intent: a Router that never executes, batching of triggers per Router turn, many-to-many
subscriptions with pass-through and handback, Workers that never talk to humans, async
`start()`/`stop()` with results as new events, speculative work, environments that may be offline,
and an external Watchdog.

## Usage (caller's view)

See `usage.md` (written first). In short: `openHarness(config)` returns a seven-method `Harness`;
sources call `ctx.intake(trigger)`; the Router's turn returns `RouterCommand[]`; a Worker's
`claude -p` session talks to the harness only through buffered MCP tools (`start`, `report`, `ask`,
`handback`, `unsubscribe`, `carry`); the panel calls `answer`; the Watchdog calls `inspect`,
`nudge`, `stopTurn`.

## Shape

**Data first.** Six tables carry the model: `letter` (mailboxes), `subscription` (the routing
table), `worker` (charter + end + carry), `turn` (fixed batch per actor turn, one open turn per actor
by partial unique index), `gate`/`op`/`env`/`verdict` (facts that letters point at), and dsh's
`effect`/`outbox` unchanged.

**Load-bearing decisions.**

1. *Everything that happens is a letter; everything an actor does is a command.* The Router's batch,
   async op results, environment status, gate answers, policy changes, Watchdog nudges and rejected
   commands all travel the same path. There is one way for information to reach an actor and one way
   for an actor to act. `RouterCommand` has `reply` and no shell; `WorkerCommand` has `start` and no
   `reply`. The article's role split is in the types, not the prompts (per encode-lessons-in-structure).
2. *The turn is the unit of durability.* `claim` fixes the batch, `commit` applies the commands and
   marks the batch read in one transaction, ids are `key(turn, ordinal)`. A crash before commit
   re-runs the same batch and produces no duplicates; a commit twice is a no-op (per
   make-operations-idempotent). This gives the article's Router batching for free: letters that land
   during a turn are the next batch.
3. *The Ticket is the Worker's charter.* No separate ticket entity or process. Worker stage is
   derived by one pure function (`workerStage`) shared by the scheduler and the panel, so "runnable"
   and "what the panel shows" cannot diverge (single source of truth).
4. *Authority is minted by code from stored admissions, and rechecked at every Worker turn.* The fast
   path stores an `Admission` on each trigger letter; `Policy.mint` turns the batch's admissions into a
   Mandate when the Router spawns. The LLM chooses whether, never with what authority. Because every
   turn is a resume, `revalidate` runs at each claim (stricter than dsh, which notifies live tickets).
5. *Subscriptions are a real many-to-many table with roles.* Owner = waking pass-through; context =
   non-waking copy; the Router gets a non-waking `seen` copy of everything routed, so it keeps global
   state without spending turns. Workers may add context follows and unsubscribe; ownership is
   granted only by the Router (`spawn`, `route`).
6. *Async ops.* `start` returns a deterministic `OpId` inside the turn; the op starts from the effect
   queue after commit; the result returns as `op.finished`. `stop` is a committed command plus an
   effect, so it survives a crash (fixes dsh trap 14).
7. *Environments are first-class and waiting is derived.* An offline env makes the Worker not
   runnable; letters accumulate; the endpoint heartbeat posts `env` and the Worker wakes. No polling
   loop in the Worker, no "blocked on env" report.
8. *Done needs a verdict id that only the verifier op can mint.* `report done` must carry a
   `VerdictId` whose sha equals the env head; `recordVerdict` is the only minter, called from an
   independent verifier session. Ledger keyed by (repo, sha), so pre-PR work has a slot (pstack gap).
9. *Speculative delivery is a charter field with commit-time rules.* No ack, no `ask`, replies about it
   only after `done`; failed or blocked means `discarded`, silently.
10. *Atomic where it fits.* A Worker turn is one Atomic run whose body is `ctx.tool` around a
    `claude -p` session on the endpoint, so pstack runs natively with Claude Code hooks (the
    PreToolUse hook turns pause-always actions into `irreversible` gates), and the turn gets journal,
    resume and a duration budget. `fromAtomic` is the one place that decodes Atomic's status quirks.
    The Router turn needs no engine: the Turn row is its durability.

**Interface depth.** Public surface: `openHarness` + 7 `Harness` methods, the `Source`/`SourceContext`
pair and `EndpointPort`. Hidden: mailboxes, routing, batching, scheduling with a human-reserved slot,
revalidation, command validation, effects, outbox, turn resume, Atomic decoding, Inline & Spill.
`Postbox` is internal and deep (11 methods hiding 10 tables and every invariant). No wire types
cross `edges.ts`.

**What it deliberately does not do.** No direct Worker-to-Worker messages (they share threads). No
mid-turn steering of a Worker (letters wait for the next turn). No Worker replies. No Atomic `ctx.ui`
gates: gates are harness rows, because Atomic has no answer-gate RPC.

**Module map** (`src/`, 629 lines):

| File | Owns | Depends on |
|---|---|---|
| `domain.ts` | ids, Trigger, Thread, Subscription, Admission, Mandate, Charter, Environment, Op, Gate, WorkerReport, letters, commands, Turn | nothing |
| `postbox.ts` | all durable state and its invariants; intake routing; claim/commit; recall; inspect | domain, policy |
| `policy.ts` | admit, mint, revalidate, command check, pause-always classify, channel norms | domain |
| `actors.ts` | scheduler, Router engine, Worker engine (Atomic + claude -p), `fromAtomic`, op runner | domain, postbox, edges types |
| `edges.ts` | package index: Source, SourceContext, EndpointPort, Harness, openHarness | domain, postbox, policy types |

Tracing any flow takes three files at most: `edges` (in) to `postbox` (state) to `policy` (rule).

## Synthesis decision

## Tradeoffs accepted

- We accept coarse Worker turns (a human follow-up waits until the current `claude -p` session ends,
  capped by `turnMinutes`) in exchange for one durable unit per turn and native pstack with hooks.
- We accept re-prefill per Worker turn (continuity via `--resume` plus the `carry` note and pstack's
  on-disk trail) in exchange for stateless compute, as in article 5.1.
- We accept that Atomic meters no tokens inside a `ctx.tool` `claude -p` session; spend comes from
  `claude -p` JSON output and is enforced by the harness (charter `usdCap`), Atomic only caps duration.
- We accept stricter revalidation than dsh (every turn) in exchange for one rule with no exceptions.
- We accept that rejected commands cost the Router another turn in exchange for partial commits that
  never undo valid work (dsh's per-item transactions, generalized).
- The `seen` copies grow the Router's batches; they are non-waking and rendered as one-line previews.

## Alternatives considered

- **One Atomic run per Ticket, with mailbox reads as `ctx.ui` prompts.** Keeps one long session but
  holds a lease for days, depends on UI replay keys that include the author callsite, and makes
  Atomic the owner of human gates without an answer RPC. Exposes engine quirks to the whole lifecycle.
- **Worker turn as an Atomic Pi stage with pstack as native SKILL.md.** Gets token metering and
  `steer`, but loses Claude Code hooks, so pause-always can only be prose. Rejected on enforcement.
- **Callbacks instead of letters (dsh `EngineForExecutor`).** Eleven callback methods, each its own
  transaction and rule set; the actor model folds them into `post` + `commit`.
- **Router as code plus an LLM only for the slow path.** Smaller LLM surface but splits global memory;
  the article measured that one batched Router session suffices.

## Implementation reconciliation

## Open questions and risks

- Should a human message to a Worker mid-turn also wake the Router for a short ack ("noted, will
  include it"), or is waiting up to `turnMinutes` acceptable?
- Does `session.workflows.resume` work from a headless host process that also embeds `run()`? If not,
  is "abandon and re-run the turn with attempt + 1" good enough, given `claude -p --resume`?
- Does `claude -p --output-format json` reliably report cost (`total_cost_usd`), and is there a
  per-session spend cap? Not verified in this session.
- Remote endpoints: the Atomic journal stays in the service and `claude -p` runs on the endpoint. Is a
  daemon that holds credentials and git shims acceptable for BYOM security (article 8.4)?
- With everything on `opus`, the verifier is "different session, same model". Should the verifier op
  run as an Atomic Pi stage on another provider to restore model-family independence?
- Is per-turn revalidation too strict for live tickets after a small rule edit?

## Next implementation step

Build `postbox.ts` on `node:sqlite` with `intake`, `claim`, `commit` and the pure `route` and
`workerStage`, and test them with a scripted fake engine before any LLM or Atomic code exists.

## Directions considered and rejected (summary)

1. Ticket as a long Atomic run with `ctx.ui` as mailbox receive (lease and replay-key risk).
2. Atomic Pi stage as the Worker engine (no hooks, pause-always unenforceable).
3. dsh-style executor callbacks (eleven entry points instead of one letter path).
4. Router split into code router plus LLM assessor (loses one global context).
5. Gates inside Atomic `ctx.ui` (no answer RPC; harness rows instead).
