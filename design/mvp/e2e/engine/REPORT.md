# E2E engine seam, Atomic 0.9.63 (02/11/2026)

Run by a subagent against real Atomic 0.9.63, model openai-codex/gpt-5.6-luna-fast, thinking low.
Private journals in this folder; ~/.atomic/workflows/journal.sqlite untouched.
Scripts: host.mjs, .atomic/workflows/spike.ts, b/router.mjs, s5.sh. Logs: s*.log.

| Spike | Verdict | Evidence |
|---|---|---|
| S1 start without provider turn | PASS | `/workflow spike-two runKey=k2` started the run, prompt() returned in 123 ms; engine session `{"entry_appended":7,"message_start":1,"message_end":1}`, no turn; outputs via getRun. listRuns() summaries lack `inputs`; from a new process listRuns({includeDurable:true}) returns [] |
| S2 human input | PASS | ask_user_question reached the stub humanInput with workflowRunId + workflowStageId. Atomic also asks a stage-continuation question ("Are you ready to move on to the next stage?"). Answers must match an option label exactly, otherwise the stage stays waiting |
| S3 globalThis bridge | PASS | `BRIDGE-OK:k2:pid59265` read inside ctx.tool |
| S4 steer | PASS | StageContext.steer from inside the stage: final answer "PING ... finished". From the host: pause + resume({stageId, message}) gives "PONG" but interrupts the turn; resume with message and no pause drops the message silently |
| S5 crash resume | PASS with sqlite sessionStore, FAIL with SessionManager.inMemory() | After kill -9 and the lease: status `crashed`, resume replayed finished steps without rerunning them; pending question re-presented with the same workflowStageId and a new requestId. In-memory store: WORKFLOW_RUN_OWNED_ELSEWHERE; resumeInFlight "auto" fails with "Session not found"; within 30 s "auto" does nothing |
| S6 router tools | PASS after fix | `noTools:"all"` also removes custom tools. `tools:["note"]` + customTools gives exactly that tool, no bash. Engine-started stages still run bash (TOOLS-42) |
| S7 budget | PASS | Over-budget child returns `{status:"blocked",exited:true,outputs:{}}`, parent does not throw. Root: status "blocked", failureDisposition "active_blocked", result.status "budget_exceeded". One stage always overshoots plus one wrap-up turn |

## API corrections for design/mvp/src
1. Engine: persistent sessionStore (sqlite) + `journal:{path}`. Workflow settings live in `<home>/.atomic/extensions/workflow/config.json` (config-loader.ts:377), not SettingsManager.inMemory. Heartbeat off with `heartbeatIntervalMinutes:0` in the workflow definition.
2. start(): do not use listRuns for idempotency. Persist RunKey -> run id in our log and use getRun(fullUuid). Confirm that a run id appeared: a broken workflow fails silently (only "Extension command failed" in diagnostics).
3. HostInput: auto-answer the stage-continuation question with the first label. Identify a gate by (run, stage, text), never by requestId.
4. Router: `tools:[decide,reply,recall]` + customTools, not noTools:"all".
5. ctx.tool returns the raw value (no {ok,value} wrapper by default).
6. classify: handle blocked child and root budget_exceeded.
