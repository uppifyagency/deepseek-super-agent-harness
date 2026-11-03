# Build plan (candidate 3)

Each unit ends in a state proven on the real artifact. Units 1-3 are the spikes that can kill
or reshape the design; they come first and cost an afternoon.

| # | Unit | Delivers | Proof on the real artifact |
|---|---|---|---|
| 1 | Atomic SDK spike | A 20-line host calling `run()` on a two-stage toy workflow with `budget`, schema output, `journal: ~/.harness/atomic.sqlite`, model `anthropic/claude-opus-5-5` | `RunResult.result` printed with typed fields; a 1k-token budget run returns status `running` + `failure.disposition: active_blocked` (confirms classify's budget rule) |
| 2 | Resume and steer spike | Risk tests 1 and 2 from the rationale | `kill -9` mid stage 2, rerun with `continuation`, stage 1 not re-executed (or: record that it fails and keep the attempt n+1 fallback only); `steer` text appears in the stage's final answer |
| 3 | Env and pstack spike | launchd-like env (`PI_CODING_AGENT_DIR`, empty `GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`, no `SSH_AUTH_SOCK`), pstack installed, sheet copied with `pi ask tool: off` | In one stage: `/skill:poteto-mode` loads (mandate text visible in the transcript), `gh auth status` fails, `git push --dry-run` fails |
| 4 | `store.ts` core | `intake`, `nextRouterBatch`, `applyRunEnded`, `applyDecision`, `mayStart`, `composeReply`, `recall` on node:sqlite | Property test: replay of the same triggers and RunEnded values gives identical rows and ids; observe turns inferred accepts into would-accept; pack size of a realistic batch measured in tokens (feeds the cost estimate) |
| 5 | `github.ts` poll + reply | Triggers from one repo; idempotent reply by marker | Against a scratch repo: run poll twice, same trigger ids; post a reply, kill before settle, rerun, exactly one comment on GitHub |
| 6 | Router batch end to end | `runs.ts` routerBatch + supervisor steps 2, 5, 7 | In observe mode on the scratch repo: open an issue with `@harness fix the typo in README`, see `ticket-opened` and an ack comment; an un-addressed issue shows up in `harness status` as would-accept |
| 7 | Ticket attempt without publish | work + verify stages, `classify`, `onSettled` | The typo ticket produces a commit in its worktree and a PASS verdict row with headSha and patch-id; a forced failing test gives `failed{verify-failed}` |
| 8 | Publish and result reply | `github.publish` as `ctx.tool`, result card in next batch | One PR on the scratch repo with the marker; rerunning the attempt run id does not open a second PR; the router posts a structured result comment |
| 9 | Gates and pass-through | work output `needs_human`, `answer`, `steerLive`, GitHub reply as answer | Ask a question in the brief; the gate appears in `harness attention` and as a macOS notification; answering on the issue starts attempt 2 in the same worktree |
| 10 | Guard extension | `guard.ts` installed; `decide` unit tests | A work stage told to `git push --force` gets the block reason and returns `needs_human{irreversible}` |
| 11 | Stops, reconcile, launchd | supervisor plist (KeepAlive), `pendingStops`, `reconcile` | `harness stop` ends a live attempt; `kill -9` the supervisor mid-attempt: launchd restarts it, after the lease the attempt resumes or attempt n+1 starts; a mid-batch kill reruns the same BatchId with no duplicate ticket |
| 12 | Watchdog | watchdog plist (StartInterval 120), `suspicious`, `judgeProgress` | `kill -STOP` the supervisor: watchdog kickstarts it within 4 min; a stage looping on `sleep 60` for 25 min gets a `stuck` row, then a stop and a `stuck` gate |
| 13 | Auto mode and silent tickets | `harness mode auto`, `visibility: silent` | After a week of observe: an inferred bug report on the scratch repo yields either a draft PR plus comment (verified) or nothing at all on GitHub (discarded) |

Out of the MVP: IM channels, the web panel (CLI only; a page is a later read-only view of
`store.status()`), cloud, multiple users, `simulate(policy)`, cross-family verification.
