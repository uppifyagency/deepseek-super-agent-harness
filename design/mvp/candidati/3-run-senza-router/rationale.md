# Candidate 3: everything is an atomic run

## Problem

A personal, local, always-on harness for Vlad: GitHub (1-3 repos) in, GitHub replies and PRs out,
Atomic 0.9.63 as the execution engine, pstack as the worker method, the dsh service layer
(Eval, Mandate, observe, outbox) and the DeepSeek article's router/worker split. Constraints that
shape it (grounding files): the main-session `workflow` notice carries no outputs and
`awaiting_input` does not wake the router (`ground-atomic-host.md` 2.2); auto-resume skips runs
inside the ~120 s lease and runs stopped by clean shutdown (2.3); budgets exist per run only (6);
Atomic has no GitHub source, launchd, panel or watchdog (7); stage sessions inherit the parent
process env (`ground-atomic.md` gotcha 10); pstack works inside a stage with an env adapter and a
"verification is next stage" brief (`ground-pstack-on-atomic.md` 5-6); no non-LLM way to reach a
running worker from a main session was found (open question 9).

## Usage (caller's view)

See `usage.md`. Vlad installs once, starts launchd, lives with `harness status / attention /
answer / stop / ask` and with GitHub itself. The three call sites are the supervisor tick, the
`onSettled` handler, and the router stage.

## Shape

**Data first.** One SQLite store (`store.ts`) owns every fact: triggers, thread ownership, tickets,
attempts, gates, decisions, router notes, outbox, stops. Ids are content-derived without clocks
(`domain.ts` header), so every write is replay-safe (per make-operations-idempotent). Ticket stage
is derived, never stored (per single source of truth). Atomic's journal is private to `runs.ts`.

**Three kinds of Atomic run, no long-lived LLM session.**
- `harness-router-batch`: one fresh stage, `noTools: 'builtin'` plus a `recall` custom tool
  (`authoring-contract-stage.ts:197-199`), schema output `{decisions, replies, notes}`. At most
  one live. Its input is a `RouterPack` of cards (pending, results, seen, open tickets, recent
  decisions, notes). The router cannot execute by construction, not by prompt.
- `harness-ticket-attempt`: `work` stage (pstack via `/skill:poteto-mode`, worktree via
  `gitWorktreeDir`), then `verify` stage (`context: 'fresh'`, no edit tools, verdict schema), then
  `publish` as a host `ctx.tool`. Budget = attempt budget.
- `harness-watchdog-judge`: no tools, verdict schema, started by the watchdog only on code-flagged
  suspects.

**One way in, one way out.** The supervisor starts runs with `runs.start` and learns about them
only through `onSettled(RunEnded)`; `store.applyRunEnded` is the only path from model output into
state. Model output is parsed at the boundary (`parseRouterOutput`, `classify`), and observe mode,
the explicit-only stop, and unknown-ticket refusals live in one pure function, `applyDecision`
(per boundary-discipline, type-system-discipline).

**Article mechanisms fall out of run boundaries.**
- Batching (2.1): triggers that arrive while a router run thinks wait in `pending` and form the next batch.
- Async ReAct (4.1): an attempt's end is a `results` card in the next batch; the router writes the reply.
- Two-stage filter (3.1): code in `store.intake`, LLM in the batch. The watchdog uses the same split.
- Pass-through (3.2): `intake` routes owned threads by code; a live attempt gets `steerLive`, which
  calls `StageContext.steer` (`authoring-contract-stage.ts:384`) on the in-process stage. This answers
  open question 9 without an LLM turn, because SDK `run()` executes the workflow body in the supervisor process.
- Inline & Spill and Chain of Recall (3.3): `Spill` previews in cards, `recall(id)` for the rest, cards carry next-hop ids.
- Speculative work (3.4): `visibility: 'silent'`; no ack, failures and gates discard quietly, a passing verdict publishes a draft PR and speaks.
- Watchdog (6): separate launchd job, liveness by store heartbeat, progress by code thresholds then a judge run.
- Credentials (8.4): the supervisor env has no GitHub or SSH credentials; host steps read the Keychain per call.

**Every human ask ends a run.** No `ctx.ui`, no `awaiting_input`. The answer queues attempt n+1
in the same worktree and branch with the answer in its brief. One mechanism for questions,
irreversible actions, budget stops and stuck verdicts (Gate kinds). Mandate revalidation
(`mayStart`) runs at each attempt start, which is every run boundary.

**Why giving up the long-lived router context is acceptable for one person.**
- Load: 1-3 personal repos give a few router-worthy triggers per hour, not 40 a minute. A
  long-lived session would sit idle most of the time with a context that is mostly stale.
- What the article's router keeps in context is mostly state, and state is better in the store:
  open tickets, recent decisions, thread history and results are all cards in every pack. What a
  long context adds on top is implicit cross-batch memory; here that is explicit `notes`
  (30 max, written by the router, visible in `harness recall`), which Vlad can read and correct.
- A long-lived Atomic session compacts by deleting lines (`ground-atomic-host.md` 3), so its
  memory degrades silently anyway. A fresh run per batch never drifts and is reproducible: the pack
  is in the journal, so a bad decision can be rerun against the same input after a prompt fix.
- Crash recovery is "rerun the batch" because decisions are first-write-wins by BatchId and
  trigger. No session ownership, no lease takeover, no `session.workflows.resume` of the router.
- Cost per batch is one cold prefill of pack + system prompt. That is a **stima**, not measured:
  a pack of 5-15k tokens per batch at a few batches per hour. The cheapest check is unit 4 of the
  build plan. A long-lived session pays cache reads of its whole history each turn instead, which
  grows; the article measured 23.2M cache-read tokens per run (`articolo.md` 7.1), a team workload.
- Where it is NOT acceptable: a fluid multi-turn conversation with the router. `harness ask` is
  turn-based, each turn costs a cold run of a few seconds plus model time, and nuance not written
  into a note or the thread is gone. For a person who talks to the system mostly through GitHub
  issues, this is a fair trade. If Vlad wants to chat with the router daily, this candidate loses.

**Interface depth.** Public surfaces are `Store` (one method per business operation), `Runs`
(start, steerLive, stop, onSettled, reconcile), `GitHub` (poll, reply, publish) and the CLI. They
hide SQLite, Atomic's status taxonomy (budget-stop-as-running), journal leases, typebox schemas,
GitHub markers and Keychain. The supervisor is about 60 lines of glue and holds no state.

**Module map** (any flow is traceable in three files: supervisor, store, runs).

| File | Owns | Imports |
|---|---|---|
| `domain.ts` | every domain type and id rule | nothing |
| `store.ts` | all harness state, intake filter, decision policy, reply norms | domain |
| `runs.ts` | the three Atomic workflows, classify, resume; only `@bastani/atomic` importer | domain |
| `github.ts` | GitHub wire shapes, Keychain token, poll/reply/publish | domain |
| `guard.ts` | tool_call block policy, as an Atomic extension package | nothing |
| `supervisor.ts` | tick loop and CLI; no state | store, runs, github |
| `watchdog.ts` | liveness and progress judgement; writes only its verdict table | domain, runs |

## Synthesis decision

## Tradeoffs accepted

- We accept no conversational memory in the router beyond cards and notes, in exchange for zero router crash handling and reproducible decisions.
- We accept losing the worker's LLM context at every gate (attempt n+1 starts a new stage with a brief and the same worktree), in exchange for one gate mechanism and no `awaiting_input` handling.
- We accept that Atomic runs in the supervisor process, so a crashing stage takes the supervisor down, in exchange for in-process `steerLive` and custom tools that write to the store without sockets.
- We accept that pstack's own `agent` children are outside Atomic's journal and budget meter (`ground-pstack-on-atomic.md` 4); the brief caps fan-out at 1.
- We accept same-model verification (opus only, Vlad's rule); the verdict type records `sameModel: true` so nobody mistakes it for cross-family.
- We accept two durable stores (harness store and Atomic journal) joined by AttemptId and BatchId, reconciled only at boot.

## Alternatives considered

- **Long-lived router as Atomic main session (article as written).** Async notices and Intercom for free, but the notice has no outputs, `awaiting_input` is invisible, resume needs lease waiting, the router context compacts by deletion, and the router's tool allowlist may narrow stage tools (`ground-atomic-host.md` 8A). More hidden state for a load that does not need it.
- **One always-running root workflow with ticket children.** Replay from the top with an unbounded journal, depth cap 3, one budget for the whole harness (`ground-atomic-host.md` 8C).
- **Worker as `claude -p` inside `ctx.tool` (previous design).** Real Claude Code hooks, but Atomic stops metering and steering the worker; Vlad wants Atomic as the engine, not a step runner.
- **Gates as `ctx.ui` with a HostInput-backed adapter.** Keeps the worker's context across a question, but pending UI prompts in a crashed run and callsite-keyed replay (`ground-atomic.md` gotcha 5) add a second waiting mechanism.

## Implementation reconciliation

(empty until Phase D)

## Open questions and risks

Directions considered and rejected are listed above. Questions for Vlad:
1. Do you want to *chat* with the router, or is GitHub plus `harness ask` enough?
2. Is losing the worker's context at a gate acceptable, or should attempt n+1 fork the previous stage session?
3. Is "no credentials in the supervisor env" enough, or should workers run as a separate macOS user?

**Three biggest risks, cheapest test each.**
1. **Resuming an SDK-started attempt after a crash.** `run(def, inputs, {runId, continuation})` is
   unverified (`ground-atomic.md` open questions). Test: a two-stage toy workflow, `kill -9` the
   host during stage 2, wait 130 s, call `run` with `continuation: {source: snapshot}`; check stage 1
   is not rerun. If it fails, the fallback (attempt n+1, same worktree) already exists, so only cost rises.
2. **`steerLive` into a stage that is mid-`prompt()`.** Test: toy workflow whose stage runs `sleep 30`
   via bash, host calls `stage.steer('say PING in your final answer')` from outside the body; check the
   final text. If it fails, pass-through degrades to "next attempt brief" plus the worker polling an `inbox` custom tool.
3. **Credential boundary.** Test: one work stage under the plist env runs `gh auth status`,
   `git push --dry-run origin HEAD`, `cat ~/.atomic/agent/auth.json`; the first two must fail without
   the guard and the third must be blocked by the guard. Atomic's own model auth is still readable by
   bash in principle; that is accepted for one person on one Mac and stated.

## Next implementation step

Write `store.ts` with `intake`, `nextRouterBatch` and `applyRunEnded` against an in-memory SQLite, with a test that feeding the same RunEnded twice yields identical rows.
