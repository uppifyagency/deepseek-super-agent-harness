# Build plan (candidate 1)

Each unit ends in a state proven on the real artifact (a real Atomic process, a real GitHub
repo, the real launchd), not on a mock. Units 0-2 are spikes that can change the shape; they run
first. A scratch repo `<utente>/harness-sandbox` is the only repo until unit 11.

| # | Delivers | Proof on the real artifact |
|---|---|---|
| 0 | Package skeleton installed: `atomic install .` loads the extension and the `ticket` workflow; pstack installed with `PI_CODING_AGENT_DIR=$HOME/.atomic/agent` and `pi ask tool: off` | `atomic` lists workflow `ticket` and extension `harness`; `/skill:poteto-mode` resolves inside a one-stage test run; the opus id resolves (`anthropic/claude-opus-5-5`) |
| 1 | **Spike: stage self-steer** (risk 1). Extension in a stage steers its own session from a file | Two files written by one stage, the second only asked via the steer |
| 2 | **Spike: ownership** (risk 2, open q. 3-4). SDK daemon starts a run via a custom tool's `executeTool("workflow")`; end notice wakes the session; `ctx.ui.input` appears in `observeWorkflowActivity`; `/workflow resume` via `sendUserMessage` works headless | Session log shows the notice turn; observer logs the prompt id; after `kill -9` and restart the run continues from its checkpoint |
| 3 | `store.ts` with `append`, views, spill/recall | Property test: append the same 500 drafts twice from two processes concurrently; same ids, same views, no SQLITE_BUSY failure |
| 4 | `roleOf` + guard (`checkTool`) in every session | In a real stage: `gh auth status` reports logged out, `git push` is blocked, verifier `edit` is blocked; router `bash` is blocked |
| 5 | `github.poll` + prefilter + router batch (observe mode, no runs) | On the sandbox repo: 3 comments in one minute produce one router turn; a harness reply does not come back as a trigger; `harness observed` lists the decision |
| 6 | Outbox: `reply` action, `composeReply`, idempotent `post` | Kill the daemon between POST and `reply.settled`; after restart exactly one comment exists |
| 7 | `ticket` workflow work + publish, no verify yet, mode auto on sandbox | An issue `@harness add a LICENSE file` becomes a PR from `harness/<ticket>` within budget; the run appears in the TUI BACKGROUND panel |
| 8 | Verify stage + `independentVerdict` + `verdictStillValid` at publish | A planted failing test makes the verifier FAIL, the worker fixes it, the PR body carries PASS at the PR's head SHA; amending after the verdict blocks publish |
| 9 | Gates: question -> `ctx.ui.input` -> GitHub question -> answer -> forked session continues | Issue with an ambiguous ask: question appears on GitHub, Vlad's answer reaches the worker, the worker's next turn references its earlier context |
| 10 | Pass-through inbox + late-input step | A comment during the work stage changes the result; a comment during verify triggers one more work round |
| 11 | launchd daemon, `harness attach`, reconcile loop | Reboot the Mac: router resumes, open run continues; `attach` and quit with a run in flight loses nothing |
| 12 | Watchdog: liveness + code progress + model judge for ambiguous runs | `kill -STOP` the daemon: restarted within 5 min; a worker told to loop forever gets `judged stuck` and the router stops it |
| 13 | Compaction to the board + `recall` | Force compaction: router answers "what happened to the CSV ticket?" via recall hops |
| 14 | Speculative tickets | A bug issue with a repro and no mention gets a draft PR or nothing, never a question |
| 15 | First real repo in observe mode for a week, then auto | `harness observed` agreement with Vlad's own call, counted by hand |

Directions rejected and the three biggest risks with their cheapest tests: see the end of
`rationale.md` (units 1, 2 and 15 are those tests).
