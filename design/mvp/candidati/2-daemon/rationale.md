# Candidate 2: a harness daemon that owns the service and embeds Atomic

## Problem

One always-on process on Vlad's Mac must turn GitHub activity on 1-3 of his repos into verified
PRs, talk back on GitHub, and bother Vlad only when a human fact or an irreversible action is
needed. Atomic 0.9.63 is the execution engine (durable workflows, budgets, worktrees, HIL
durability, tool_call blocking), pstack is the method inside each worker. Constraints from
grounding: Atomic has no GitHub source, no daemon, no watchdog, no HTTP panel
(ground-atomic-host.md section 7); `SessionWorkflows` has no `start` (workflow-run-control.ts:146-171);
lifecycle notices wake the owning chat with `triggerTurn` but carry no outputs and do not fire
for `awaiting_input` (section 2.2); `resumeInFlight` skips runs within the ~120 s lease and runs
stopped by a clean shutdown (section 2.3); stage tool selections can only narrow the parent's
(sdk.md:471); Bash string matching is bypassable (security.md:34-40); no non-LLM way to push a
follow-up into a running stage was found from outside the workflow (open question 9).

## Usage (caller's view)

See `usage.md`. Vlad lives with three things: GitHub (where he writes), `harness` (attention
list, answer, stop, policy) and the page at 127.0.0.1:4777 (same list). The code-level callers
are four: the GitHub poller (`harness.ingest`), the router session (`decide/reply/recall`), the
engine (`EngineHost`), and the human commands (`harness.human.*`).

## Shape

**Two sources of truth, split by what they are about, joined by one key.** The service log
(`log.ts`, carried over from the previous design: content-addressed events, `transact(decider)`,
folds as views) owns every fact a human or GitHub can see: triggers, filter results, decisions,
tickets, subscriptions, gates and answers, replies, policy. Atomic's journal owns execution: stage
state, replay checkpoints, budgets, pending HIL prompts. The only shared key is
`RunKey <-> AtomicRunId`, written once as `run.bound` (per separate-before-serializing-shared-state).
Run outcome flows one way, Atomic to log, through `classify`.

**Two embedded Atomic sessions with opposite jobs.** This is the load-bearing decision.
- The **engine session** owns every ticket run and never gets an LLM turn. Runs start through the
  registered `/workflow harness-ticket runKey=...` slash command via `session.prompt`, which
  executes without a provider turn (agent-session-prompt.ts:197-204). Notices and heartbeats are
  off; the daemon observes runs with `session.workflows.observe` and `waitForSettled`. It keeps
  the full default tool set because stages inherit it as a ceiling; a guard blocks every tool
  call at depth 0.
- The **router session** is the only LLM the daemon prompts. `noTools: 'all'` plus three custom
  tools (`decide`, `reply`, `recall`). No bash, no `workflow` tool, owns no runs, so Atomic never
  wakes it. The daemon wakes it with a `RouterBatch`.
This dissolves two grounding risks at once: "router never executes" is a capability, not a
prompt; and narrowing the router's tools cannot starve workers, because workers are not its children.

**The daemon owns lifecycle; Atomic owns execution.** The seam is `Engine` (start, stop,
recover, dispose) in, `EngineHost` (report, ask, spec, follow) out. Start is idempotent by
`RunKey` (find by `inputs.runKey` before dispatch). `resumeInFlight: 'never'` makes
`engine.recover` the only resume path, run after the lease window, covering crash, clean
restart and watchdog kickstart alike (per make-operations-idempotent; one way to do one task).

**Gates stay inside Atomic runs.** A worker asks with Atomic's own `ask_user_question` (pstack's
is off); the guard raises `ctx.ui.confirm` for irreversible commands. Both reach the daemon
through `extensionBindings.humanInput`, inherited by stages (sdk.md:475), as `host.ask`. The run
sits `awaiting_input` in Atomic's journal, durable across restarts; the daemon records
`gate.opened` and the answer. `GateId = hash(atomicRun, stage, kind, question)`, so a re-asked
prompt after a restart maps to the same gate and gets the stored answer at once. Atomic's docs
prescribe exactly this host behavior (sdk.md:119-120). Budget exhaustion is the exception: the
run ends `budget`, the daemon opens an operator gate, and "yes" starts attempt n+1 with a raised
child budget and `forkFromSessionId` (session resume takes no budget).

**Follow-ups are routed by code, delivered by the workflow.** `intake` sends a human comment on a
subscribed issue straight to its ticket (`input.routed`), no LLM. If a run is live, the `work`
stage's pump reads `bridge().follow(ticket)` and calls `StageContext.steer`
(authoring-contract-stage.ts:380-386), then reports `delivered`. If none is live, `react` starts the
next attempt, forked from the last worker session. This answers open question 9 without Intercom
and without an LLM turn. The router still sees each one as a non-waking `seen` line.

**The bridge.** Workflow modules load through Atomic's module loader, so `harness-ticket.ts`
reaches the daemon through a typed `TicketBridge` on `globalThis[Symbol.for(...)]`, three
functions. It is the one place the design crosses into Atomic's process space outside the API.

**Credentials by capability.** The daemon process env has no GitHub credential (empty
`GH_CONFIG_DIR`, `GIT_CONFIG_NOSYSTEM=1`, global gitconfig without helper); `main` refuses to start
otherwise. Poller, replies and `publish` read a token from the keychain per call and pass it only
to their own `gh`/`git` child. Stages and pstack's child processes inherit the tokenless env. The
guard is the second line.

**Roles in types.** `Kinds[k].by` fixes authors: the engine cannot write `reply.intended`, so
workers never talk to humans. `ReplyText` only from `composeReply`, `IndependentVerdict` only from
`independentVerdict` (verifier session != worker session, bound to sha).

**Module map.**

| File | Owns | Imports Atomic |
|---|---|---|
| `domain.ts` | the one list of kinds, ids, bodies | no |
| `log.ts` | SQLite, `transact`, `idOf`, spill | no |
| `service.ts` | folds, deciders, `Harness`, `EngineHost`, `RouterPort` | no |
| `github.ts` | gh JSON parsing, cursor, idempotent send | no |
| `engine.ts` | engine session, HostInput adapter, guard, classify, bridge | yes |
| `ticket.workflow.ts` | the Atomic workflow (spec, work, verify, publish) | yes |
| `router.ts` | router session and its three tools | yes |
| `daemon.ts` | composition, loops, CLI, attention page, heartbeat | no |
| `watchdog.ts` | liveness kickstart, two-stage progress judge | no (shells `atomic -p`) |

**Interface depth.** The daemon sees Atomic as 4 methods and is seen by it as 4. Hidden behind
them: session config, slash-command start, run discovery by input, lease-aware recovery,
HostInput translation, guard policy, status classification, steering. Any flow traces in three
files: `daemon.ts` loop, `service.ts` decider, `engine.ts` (or `router.ts`) adapter.

**Deliberately not done.** No IM, no remote envs, no `simulate(policy)`, no worker pools, no
per-stage budgets, no web framework. Speculation (`silent`) exists in types and costs one fold
rule; it is the last build unit.

## Synthesis decision

## Tradeoffs accepted

- We accept two durable stores in exchange for using Atomic's durability for what it is good at
  (stage replay, pending prompts, budgets). They can disagree only about a run's end; `classify`
  on `waitForSettled` and `recover` on boot reconcile it.
- We accept a `globalThis` bridge in exchange for live follow-up steering and log-sourced specs
  with no LLM turn and no Intercom.
- We accept a two-level workflow (root + attempt child) only because `/workflow` cannot pass a budget.
- We accept that a gate holds an Atomic run (and a worktree) open for as long as Vlad takes to answer.
- We accept same-model verification (all-opus rule); the verdict says `sameModel: true`.
- We accept that on a single-user Mac a determined worker could still read the keychain via
  `security`; the guard blocks it by string, and a real boundary needs a second macOS user (out of MVP).

## Alternatives considered

- **Atomic TUI/RPC as the host, harness as an extension (shape A).** Fewer moving parts, but the
  router would be the run owner, so every notice wakes an LLM, the poller lives inside a session's
  lifetime, and narrowing the router's tools narrows the workers. Lifecycle would belong to the LLM.
- **One router session that also owns runs (B as written in grounding).** Same as above minus the
  process: notices with `triggerTurn` cost router turns for facts code already handles, and the
  tool-ceiling conflict remains.
- **Daemon calling SDK `run()` directly, no engine session.** Shortest start path, but runs are
  not session-owned: no `session.workflows` control or observe, and resume after crash is unverified
  (previous design's open question 3).
- **Gates as run endings (previous design).** Durable without trusting HostInput, but throws away
  Atomic's HIL durability and costs a full attempt per question.

## Implementation reconciliation

## Open questions and risks

1. Does the engine session, with no UI and no provider turn ever taken, run `/workflow` with an
   execution mode that keeps `ask_user_question` (wiring.ts:400-403 removes it when
   `non_interactive`)? Cheapest test: build unit 3 with a two-line workflow whose stage calls
   `ask_user_question`, bound to a stub HostInput that logs; 10 minutes.
2. Can a fresh engine session `resume` a run started by a previous process, after the lease, with
   its pending HIL prompt re-presented to the new adapter? Cheapest test: unit 4, start a run that
   asks, `kill -9` the daemon, restart after 130 s, assert the same question reaches `host.ask`.
3. Does the workflow module see the daemon's `globalThis` (same isolate) under Atomic's module
   loader? Cheapest test: unit 3 workflow `ctx.tool('probe', {}, () => typeof globalThis[BRIDGE])`.
4. Is per-token billing on the Pro/Max login acceptable for 2-3 opus workers plus router?
5. Is a review comment that reaches a worker only via `steer` (delivered after its current tool
   calls) fast enough, or should some follow-ups stop and restart the attempt?

## Next implementation step

Unit 0 of `build-plan.md`: the 80-line seam spike (slash-command start with no provider turn,
HostInput reaching a stub, `globalThis` bridge visible, resume after `kill -9`), because a NO on
any of those sends this direction back to Phase B; `log.ts` (unit 1) does not depend on it.

## Directions considered and rejected (summary)

Atomic-extension host (shape A), single router-owns-runs session, raw SDK `run()`, gates as run
endings, harness as one long-running workflow (shape C: replay from top, no durable inbox,
lifetime budget, ground-atomic-host.md section 8). Details in "Alternatives considered".

## Three biggest risks, cheapest test each

1. Engine-session start path keeps HIL (`ask_user_question` not stripped) without a UI: unit 0, stub HostInput, 10 min.
2. Fresh process resumes a foreign run after the lease and re-presents its pending prompt: unit 0, `kill -9` + 130 s wait.
3. Workflow module shares the daemon's `globalThis`: unit 0, one `ctx.tool` probe. Fallback if it fails: bridge over a unix socket at `~/.harness/bridge.sock`, same three functions.
