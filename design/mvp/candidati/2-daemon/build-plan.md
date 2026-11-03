# Build plan: ordered verifiable units

Each unit ends in a state proven on the real artifact (real SQLite file, real Atomic, real GitHub
repo `<utente>/harness-sandbox`), not a mock. Units 0-1 are independent; 0 goes first because
it can kill this direction.

| # | Delivers | Proven by |
|---|---|---|
| 0 | **Seam spike** (throwaway, ~80 lines): Node script with `createAgentSession` engine session (notices off, `resumeInFlight: never`, stub HostInput, `globalThis` probe), a 2-stage workflow in `.atomic/workflows/`, started by `session.prompt('/workflow spike runKey=k1 --no-picker')`. | Script output shows: run started with no provider request (check `after_provider_response` count = 0 on the engine session); `inputs.runKey` visible in `listRuns`; stage `ask_user_question` reached the stub with `workflowRunId`; `typeof globalThis[BRIDGE] === 'object'` inside `ctx.tool`; `s.steer` from the stage callback reached the model (transcript). Then `kill -9`, wait 130 s, new process `resume(runId)`: the same question reaches the stub again. Any NO here sends the design back to Phase B. |
| 1 | `domain.ts` + `log.ts`: `transact`, `idOf`, blob spill, view rebuild. | `node --test`: replay all events of a fixture into an empty DB gives identical ids and view values; same draft twice = one row; deleting `view` and reopening gives same answers. |
| 2 | `service.ts` intake + code filter + `github.ts` poll (read-only). Policy `observe`. | Daemon in foreground against the sandbox repo: comments appear in `harness recall`, edits create a new trigger, bot's own comments filtered, restart re-polls without duplicates. |
| 3 | `router.ts` + `decide` + outbox + `github.send`; `would-accept` in attention. | Mention the bot on a sandbox issue: router turn happens once, `harness attention` shows WOULD; in `auto` the ack comment appears exactly once even after `kill -9` between intent and send (marker search). |
| 4 | `engine.ts` + `ticket.workflow.ts` with `work` stage only (no verify/publish), pstack loaded, 1 worker. | Accepted ticket produces commits on `harness/<ticket>` in a worktree; `run.bound`, `run.progress`, `run.ended` in the log; `harness tickets` shows working then idle; no push happened (remote unchanged). |
| 5 | Gates: HostInput adapter, guard extension, attention answers, credential env. | Brief that forces a question: question appears in the issue (router `ask`), reply comment answers it, run continues. Worker told to `git push`: operator gate appears; answering `no` blocks; with gate bypassed by an obfuscated script, push still fails (no credential). |
| 6 | `verify` stage + `publish` + `independentVerdict`; result reply. | PR opened once with marker, verdict row bound to head sha; rerunning `publish` (kill during it) does not open a second PR; a deliberately broken change gets `verifier-failed` and attempt 2. |
| 7 | Follow-ups: subscription, `follow` pump, `delivered`, next-attempt fork. | Review comment on the PR while running reaches the worker (transcript shows the steer) with no router turn; after the run ended, a comment starts attempt n+1 whose transcript contains attempt n's context. |
| 8 | Budget gate + raise; `recover` on boot; launchd plist; SIGTERM path. | `maxCost` $0.50 run ends `budget`, gate shown, `yes` starts attempt n+1 with $1; `launchctl kickstart -k` mid-run and a clean `launchctl bootout/bootstrap` both resume the run after the lease. |
| 9 | `watchdog.ts` + its plist. | `kill -STOP` the daemon: watchdog kickstarts it within 2 ticks. A brief that loops (`sleep 600` in bash) gets `stuck`, stop, attention item. |
| 10 | 2-3 concurrent workers; `silent` speculative tickets (last, optional). | Three tickets in parallel, each in its own worktree, slot count never exceeded (`harness tickets`). A silent ticket that fails leaves zero comments on GitHub. |

Phase gate for turning on `auto` on a real repo: one week of `observe` with the attention list
matching Vlad's own judgment, and units 0-9 green.
