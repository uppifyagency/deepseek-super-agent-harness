# Atomic 0.9.63 as the HOST of the super-agent harness (deeper pass)

Source: `~/src/ext/atomic-0.9.63`. Paths are relative to `packages/` unless they start with `specs/`.
Tags: **[code]** read in code, **[docs]** read in docs/specs, **[inf]** inferred.
Builds on `design/grounding/ground-atomic.md` (not repeated here). Two corrections to that file are flagged inline (search "Correction").

## TL;DR for the A / B / C decision

1. **Async ReAct already exists natively in shape A.** The main session's `workflow` tool launches a run in the background and returns at startup admission; when the run ends, the workflows extension injects a lifecycle notice into the owning chat with `{ triggerTurn: true, deliverAs: "steer", persistWhenStreaming: true }`, which wakes an idle router or queues for a busy one (`workflows/src/extension/lifecycle-notifications.ts:226-235`, `coding-agent/docs/workflows/operations.md:138, 413-417`) [code+docs]. The notice carries only status and run id, not outputs, so the router must call `workflow({action:"status", runId, summary:true})` to read results (`lifecycle-notifications.ts:387-389`, `workflow-schema.ts` `summary` field) [code].
2. **An extension CAN block any tool call** (`tool_call` returns `{block, reason, terminate}`; a throwing handler also blocks), and the extension is re-instantiated inside every workflow stage session, so the guard covers workers too [code]. It does not cover `ctx.tool` callbacks in workflow TypeScript, which are not LLM tool calls [inf].
3. **Shape B is the same engine with the same features**: `createAgentSession()` ships the workflows, subagents, MCP, Intercom builtins (`coding-agent/docs/sdk.md:141`) [docs], so the SDK router session gets the `workflow` tool, lifecycle notices and `session.workflows` too. B = A plus a Node process you own (for pollers, watchdog hooks, HostInput bridge). A and B are not really alternatives: B is "A embedded".
4. **Shape C fights the engine**: the body replays from the top on resume, there is no durable sleep/inbox primitive, every poll is a journaled checkpoint, `ctx.workflow` nesting caps at `maxDepth` (default 3), and stage agents cannot launch workflows. See section 8.

---

## 1. Extension API

### 1.1 Surface (`coding-agent/src/core/extensions/api-types.ts:104-444`) [code]

Event hooks (`pi.on(name, handler)`, each returns an unsubscribe fn). Handler type: `ExtensionHandler<E, R> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void` (`:99`).

| Group | Event names | Can change outcome? |
|---|---|---|
| Session | `session_start`, `session_shutdown`, `session_info_changed`, `session_before_switch`/`_fork`/`_compact`/`_tree` (cancel), `session_compact`, `session_compact_failed`, `session_tree`, `session_recovery_restore`, `session_recovery_replay` | before_* can cancel; before_compact can supply `compactedText` (`event-results.ts:86-90`) |
| Agent loop | `input` (intercept/transform), `before_agent_start` (inject message, replace system prompt, `event-results.ts:47-51`), `agent_start`, `agent_end`, `agent_before_settle`, `agent_settled`, `turn_start`, `turn_end`, `message_start/update/end` (end can replace message) | yes where noted |
| Context/provider | `context`, `context_with_system` (rewrite messages), `before_provider_request`, `before_provider_headers`, `after_provider_response`, `provider_stream_event` | yes |
| Tools | `tool_execution_start/update/end`, **`tool_call` (can block)**, `tool_result` (can rewrite), `user_bash` | yes |
| Workflow | `workflow_lifecycle`, `workflow_activity_changed`, `workflow_stage_completed`, `workflow_heartbeat` (`:116-119`) | observe only |
| Other | `resources_discover`, `project_trust`, `model_select`, `thinking_level_select`, `ui_prompt_start/end`, `cache_warming_decision` | some |

Lifecycle diagram: `coding-agent/docs/extensions/events.md:14-104` [docs].

Registration: `registerTool(ToolDefinition)`, `registerCommand(name, opts)`, `registerShortcut`, `registerFlag`/`getFlag`, `registerMcpServer(name, config)`, `registerProvider`/`registerProviderAlias`/`unregisterProvider`, message/entry/tool renderers, `registerWorkflowRunControl`, `registerWorkflowActivityPublisher` (`api-types.ts:109-111, 200-285, 423-440`) [code].

Actions: `sendMessage`, `sendMessages`, `sendUserMessage`, `appendEntry`, `setSessionName`, `setLabel`, `exec(cmd,args,opts)`, `getActiveTools`/`setActiveTools`, `getCommands`, `setModel`, `setThinkingLevel`, shared `events: EventBus` (`api-types.ts:291-443`) [code].

`ExtensionContext` (`context-types.ts:193-335`) [code] adds: `observeWorkflowActivity(observer)` (`:195`), `isIdle()`, `waitForIdle()`, `hasPendingMessages()`, `abort()`, `compact()`, `getContextUsage()`, `newSession/fork/switchSession/reload`, `sessionSignal`, `hasUI`, `hasHumanInput`, `mode: "tui"|"rpc"|"json"|"print"` (`:192`), `orchestrationContext` and `subagentPolicy` (set when the session is a stage or subagent child).

Tool-only context (`ExtensionToolContext`, `context-types.ts:19-27`) [code] adds `executeTool(name, args, options)`: a custom tool can call any other tool, for example `workflow` or `intercom`, and "Nested calls retain session validation and permission hooks" (`:18`; `events.md:650`) [code+docs].

### 1.2 Blocking a tool call: YES

```ts
// coding-agent/src/core/extensions/event-results.ts:17-26  [code]
export interface ToolCallEventResult {
	/** Block tool execution. To modify arguments, mutate `event.input` in place instead. */
	block?: boolean;
	reason?: string;
	terminate?: boolean; // stop after this tool batch if every result in it is terminating
}
// api-types.ts:190
on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): () => void;
```

- `ToolCallEvent` = `{type:"tool_call", toolCallId, parentToolCallId?, toolName, input}`, typed per built-in tool, `CustomToolCallEvent` for anything else including MCP and extension tools (`tool-events.ts:24-83`) [code]. `input` is mutable (arguments can be rewritten) [docs `events.md:652-658`].
- Handlers run in extension load order; the first `block:true` short-circuits (`runner-events.ts:294-313`) [code].
- **Fail-closed**: a handler that throws propagates out of `beforeToolCall`; non-Error throws become `"Extension failed, blocking execution"` (`agent-session-tool-hooks.ts:20-39`) [code]. That the agent core then refuses to run the tool is [inf] from the message text.
- Hook can ask a human first: `ctx.ui.confirm/select` from inside `tool_call` (example `coding-agent/examples/extensions/permission-gate.ts:13-33`, which blocks by default when `!ctx.hasUI`) [code]. In a headless host, `ctx.ui.*` routes to `extensionBindings.humanInput` when bound; without an adapter "ordinary dialogs reject with `HumanInputUnavailable`" (`docs/sdk.md:279`) [docs], which in a hook means the call is blocked [inf].
- **Coverage of workers**: stage sessions are built with normal resource discovery "so stage sessions inherit the same project/global theme, extensions, tools, prompts, and skills as the parent chat" (`workflows/src/extension/wiring.ts:612-620`); stages inherit SDK `extensionFactories` too, "Factories run again for each stage" (`docs/sdk.md:465-467`) [code+docs]. So one guard extension covers router, stages and (as child sessions) subagents [inf for subagents].
- **Gaps** [inf unless tagged]: (a) `ctx.tool(name,args,fn)` callbacks in workflow code run plain JS, not LLM tools, so the hook never sees them; put pause-always effects (deploy, outbound messages) only in code you control and gate them with `ctx.ui.confirm`. (b) Bash is a string: "Atomic does not provide command-level allow/deny policy for bash" and there is no built-in sandbox (`docs/security.md:34-40`) [docs]; regex on `git push --force` is bypassable via scripts. Strong enforcement for force-push/delete needs a credential boundary (no push token in worker env) or a wrapper, with the hook as the second line. (c) Codemode scripts call tools through the tool layer; whether those nested calls hit `tool_call` follows from `events.md:650` for `ctx.executeTool`, not verified for codemode.
- Per-session instances: the factory runs per session, so guard state shared between router and workers must live outside the extension instance (file, SQLite) [inf].

### 1.3 Injecting a message asynchronously into the main session

```ts
// api-types.ts:292-315  [code]
sendMessage<T>(message: Pick<CustomMessage<T>, "customType"|"content"|"display"|"details">, options?: SendMessageOptions): void | Promise<void>;
sendMessages<T>(messages: ..., options?: SendMessagesOptions): void | Promise<void>;
sendUserMessage(content: string | (TextContent|ImageContent)[], options?: { deliverAs?: "steer"|"followUp"; expandPromptTemplates?: boolean }): void;
// message-types.ts:7-40
type CustomMessageDelivery = "steer" | "followUp" | "nextTurn" | "interrupt";
interface SendMessageOptions { triggerTurn?; deliverAs?; excludeFromContext?; persistWhenStreaming?; interruptAbortMessage?; ... }
```

Semantics (`docs/extensions/api-reference.md:578-646`) [docs]: `steer` (default) queues while streaming and delivers after the current tool calls; `followUp` waits until the agent has no more tool calls; `nextTurn` waits for the next user prompt; `interrupt` + `triggerTurn` aborts the active turn. `triggerTurn:true` on an idle agent starts an LLM turn immediately. The promise is an admission receipt, not turn completion. `sendUserMessage(..., {expandPromptTemplates:true})` dispatches extension commands such as `/workflow ...` (`api-types.ts:303-311`; `api-reference.md:644`) [code+docs].

This is the event-trigger path: a poller in the extension calls `pi.sendMessage({customType:"gh-event", content, display:true}, {triggerTurn:true, deliverAs:"followUp"})` and the router LLM decides. Shipped precedent: `examples/extensions/file-trigger.ts:14-40` (fs.watch then `sendMessage(..., {triggerTurn:true})`) [code].

### 1.4 Timers, pollers, background tasks

- No scheduler API. Use plain Node timers/watchers started in `session_start` and closed in `session_shutdown`; do not start them in the factory, which "may run in invocations that never start a session" (`docs/extensions/authoring.md:80, 207`) [docs]. Use `ctx.sessionSignal` for teardown (`api-reference.md:140-153`) [docs].
- Because the factory also runs in every stage session, a poller must start only in the router: skip when `ctx.subagentPolicy` (doc advice, `sdk.md:467`) or `ctx.orchestrationContext` is set [docs+inf].
- `TaskSupervisor`: the public SDK exposes `AgentTaskHost` (`startAgentTask`, `observeAgentLaunch`, `waitForTask`, `cancelTask`, `watchOwnerTasks`) for trusted hosts running owner-bound background agent tasks (`docs/sdk/reference.md:959-965`) [docs]. It is plumbing for subagents/shell tasks, not a cron. Not needed for the harness [inf].

---

## 2. Async workflow runs from the main session

### 2.1 Starting

- `SessionWorkflows` (`session.workflows`) has `listRuns`, `getRun`, `getStages`, `pause`, `quit`, `resume`, `waitForSettled`, `observe`; **no `start`** (`coding-agent/src/core/extensions/workflow-run-control.ts:146-171`) [code].
- Start paths: (a) the LLM-facing `workflow` tool, `action:"run"` with `workflow`, `inputs`, `budget` (`workflows/src/extension/workflow-schema.ts:35-75`) [code]; (b) a custom extension tool calling `ctx.executeTool("workflow", {action:"run", ...})` (`context-types.ts:19-27`) [code; that it attributes ownership the same way is inf]; (c) `pi.sendUserMessage("/workflow <name> k=v", {expandPromptTemplates:true})` [docs api-reference.md:636,644 + inf]; (d) headless CLI `atomic --mode json -p '/workflow <name> ...'` returns an accepted run id (`docs/sessions.md:67`; `operations.md:162`) [docs]; (e) SDK `run(def, inputs, opts)` (prior file), which is NOT session-owned, so no lifecycle notices and no `session.workflows` control [inf].
- `run` returns at startup admission with `status:"running"`; body continues detached (`operations.md:138`) [docs]. Hard 150 s deadline on every `workflow` tool call covers only startup (`operations.md:111`) [docs].

### 2.2 Getting the result back (async ReAct)

- Terminal notices (completed, failed, blocked incl. budget stop) for top-level runs go into the owning main chat once, deduped, retried with capped backoff (`lifecycle-notification-delivery.ts:19-66`) and sent with `{triggerTurn:true, deliverAs:"steer", persistWhenStreaming:true}` (`lifecycle-notifications.ts:226-235`) [code]. Docs: "appear once in main chat without interrupting current streaming text. Atomic also queues a model update" (`operations.md:417`) [docs].
- Config: `workflowNotifications.enabled` (default true), `notifyOn` default all nine kinds (`operations.md:435, 844-845`; `config-loader.ts:43, 195`) [docs+code]. `started/paused/quit/resumed` notify only for user-attributed actions; tool-initiated runs stay silent at start (`operations.md:429`) [docs].
- **`awaiting_input` does not wake the router** ("tracked for dedupe/restore without waking the main agent", `operations.md:845`) [docs]. A worker's human gate is visible only via `observeWorkflowActivity` / `session.workflows.observe` (`pendingPrompt` on graph nodes, `workflow-events.ts:35-62`) or `listRuns({status:"awaiting_input"})` [code]. The harness must forward those to the human itself.
- For code-level callbacks, `workflow_lifecycle` events carry `target.kind: run|stage|tool|prompt` with status transitions and `attribution` (`workflow-events.ts:114-152`) [code].

### 2.3 Ownership and crash/restart

- Runs are owned by the launching session (`ownerSessionId` on every activity/lifecycle event, `workflow-events.ts:84, 146`) [code]. Errors: `WORKFLOW_RUN_OWNED_ELSEWHERE`, `WORKFLOW_RUN_NOT_RESUMABLE`, etc. (`workflow-run-control.ts:177-273`) [code].
- Crash: run stays `running` in the journal, shows `crashed` once the owner lease is stale (`operations.md:657`) [docs]. Lease takeover needs the renewal to be older than the window (`durable/journal/journal-backend.ts:794-802`, `lease-expiry.ts:1-3`, ~120 s) [code].
- **Correction to prior file**: startup auto-recovery is NOT TUI-only. The workflows extension's `session_start` runs `resumeInFlight` in any mode; only `"ask"` needs a UI (`workflows/src/extension/extension-lifecycle.ts:221-227, 393`) [code]. Setting `resumeInFlight: "auto"` (default `"never"`, `config-loader.ts:64, 186`) resumes runs that are `running`, have no pending prompts, ownership `available`, and were invoked in the same cwd (`extension-lifecycle.ts:235-243`) [code].
- **Watchdog trap** [inf from code above]: if the watchdog restarts Atomic within ~120 s of a crash, ownership is still `foreign`, startup recovery skips those runs, and nothing retries later. The harness must call `session.workflows.resume(runId)` after the lease expires (`sdk.md:369`) [docs].
- Graceful exit: `session.dispose()` stops in-flight runs at their last checkpoint and releases them (`sdk.md:373-379`) [docs]; startup recovery skips paused/quit runs (`operations.md:848`) [docs], so after a clean restart the harness also resumes explicitly. `listRuns({includeDurable:true})` finds stored runs from this project directory (`sdk.md:359`) [docs].
- Resume is project-scoped (same cwd) or forks to a new run id (`sdk.md:383`) [docs].

---

## 3. Headless, long-lived operation

- Modes: print (`-p`, one turn and exit), JSON stream (`--mode json`), RPC (`--mode rpc`, "A long-lived session another program drives"), SDK (`docs/guides/non-interactive.md:9-31`) [docs]. RPC supports `prompt`, `steer`, `follow_up`, `abort`, `compact`, `set_auto_compaction`, `switch_session`, etc. (`docs/rpc.md:66-246`) [docs]. RPC docs recommend the SDK for Node hosts (`rpc.md:10`) [docs].
- No daemon/launchd support in the repo (grep for launchd/LaunchAgent found nothing relevant) [code]. Always-on on macOS = your own launchd agent running a Node SDK host or `atomic --mode rpc` [inf]. Days-long uptime is not documented either way [inf].
- Session persistence: default SQLite `~/.atomic/workflows/journal.sqlite`, sessions under `session_` tables, workflow runs under `wf_` (`sdk.md:202-204`) [docs]. Reopen with `SessionManager.open(store, savedSessionId)` then `createAgentSession({sessionManager})` (`sdk.md:216-233`) [docs]; CLI `atomic --session <id>` or `-c` (`docs/sessions.md:22-33`) [docs]. Opening a session never recovers prior unfinished work; call `session.startPendingRecovery("resume")` (`sdk.md:145`) [docs].
- Compaction for the router: automatic "verbatim line compaction" at a threshold (`compaction.enabled` default true, `reserveTokens` 16384) or on overflow; it deletes lines rather than summarising; falls back to summary or a "fresh context window" if every model fails (`docs/compaction.md:7-27`; `compaction/reference.md:261-267`; `settings.md:284`) [docs]. `session_before_compact` lets an extension supply the full replacement text (`event-results.ts:86-90`) [code], so the router can compact to "open tickets table + last N messages" [inf].

---

## 4. Auth and models

- Claude Pro/Max subscription login exists: `/login anthropic`, browser or "copy code login (headless)" (`docs/providers.md:141-145`) [docs]; refresh happens automatically within 5 min of expiry and other processes' refreshes are picked up (`providers.md:54-58`) [docs]. Requests impersonate Claude Code headers (prior file) [code].
- **Billing caveat**: "Third-party harness usage draws from extra usage and is billed per token, not against Claude plan limits" (`providers.md:143`) [docs]. So Pro/Max login does not give plan-included usage. This is the doc's claim; not verified against Anthropic.
- API keys: `ANTHROPIC_API_KEY`; to keep both subscription and key, use provider `anthropic-api` (`providers.md:76-80`) [docs].
- Opus model id: `anthropic/claude-opus-5-5` (`docs/subagents/reference.md:37`; base id listed in `coding-agent/src/core/fast-model-variants.ts:31`), fast variant `anthropic/claude-opus-5-5-fast` (`providers.md:122`) [docs+code]. 1M context, adaptive thinking (`coding-agent/CHANGELOG.md:2426`) [docs].
- Per-stage: `StageOptions.model`, `fallbackModels`, `modelConstraints`, `taskNeeds`, `"auto"` (`workflows/src/shared/authoring-contract-stage.ts:179-217`) [code]; children inherit the parent's auth runtime (`sdk.md:463`) [docs].

---

## 5. Skills and subagents

- Discovery (`docs/skills.md:34-55`) [docs]: global `~/.atomic/agent/skills/` (legacy `~/.pi/agent/skills/`), `~/.agents/skills/`; project (trusted only) `.atomic/skills/`, `.pi/skills/`, `.agents/skills/` in cwd and ancestors up to the git root; packages (`skills/`, `atomic.skills`); settings `skills: [paths]`; CLI `--skill <path>`.
- Claude Code skills: add `"skills": ["~/.claude/skills"]` to settings (`skills.md:58-77`) [docs]. A Claude Code plugin's skills dir (e.g. pstack's `skills/`) loads the same way by pointing a settings path at it; dirs containing `SKILL.md` are discovered recursively (`skills.md:52`) [docs+inf]. Claude-specific frontmatter fields are ignored ("Unknown frontmatter fields are ignored", `skills/reference.md:56`) [docs]; `name` must match the directory or it warns (`:49-54`).
- SKILL.md: Agent Skills standard; `name` (≤64, lowercase-hyphen) and `description` (≤1024) required; optional `license`, `compatibility`, `metadata`, `allowed-tools` (experimental), `disable-model-invocation` (`skills/reference.md:8-20`) [docs]. Progressive disclosure: descriptions in system prompt, body read on demand (`skills.md:79-86`) [docs].
- Subagents: "delegation is one level deep and cannot be configured"; nest teams via workflow stages; `ctx.workflow` nests to `maxDepth` default 3 (`docs/subagents.md:148, 385`) [docs].
- Stage agents: no `skills` field on `StageOptions` (`authoring-contract-stage.ts:179-217`) [code]; stages inherit the parent's resource snapshot incl. skills (`operations.md:1010`) [docs] and can use `/skill:<name>` in prompts (`skills.md:166-176`) [docs]. Per-stage `cwd`, `gitWorktreeDir`, `baseBranch`, `agentDir`, `tools/excludedTools/customTools`, `mcp` exist (`authoring-contract-stage.ts:195-209`) [code]. Stages and subagents exclude recursive workflow tooling (`sdk.md:473`) [docs].

---

## 6. Worker-stage features

- Worktrees: covered in prior file. Additional: setup failure of `git_worktree_dir` fails the `run` call synchronously with a structured error; a non-git non-empty dir gets its own checkout reused on resume (`operations.md:138`) [docs].
- **Mid-run follow-up into a running stage**: Intercom `send` to `workflow:<rootRunId>/<stage>` (globs `*`, `**`). Live stages receive immediately; pending/future stages get a FIFO queue (≤50 per target) delivered before their first turn; messages survive resume and broker restart (`docs/intercom/reference.md:60-110`; `operations.md:305`) [docs]. The launching session can `send` without joining (`intercom/reference.md:68`) [docs]. Inside workflow code, `StageContext.steer(text)`, `followUp(text)`, `sendUserMessage(content,{deliverAs})` (`authoring-contract-stage.ts:380-386`) [code]. `session.workflows.resume(runId,{message})` delivers text only to paused stages (`workflow-run-control.ts:109-115`) [code].
- Open: no non-LLM API was found for an extension poller to Intercom-send directly. Options: a custom tool using `ctx.executeTool("intercom", ...)` (needs an LLM turn), or have the router LLM do it [inf]. `@bastani/intercom` is a private package with a local broker (`intercom/package.json:4`, `intercom/broker/broker.ts`) [code].
- Human input inside a stage: `ctx.ui.input/confirm/select/editor/custom`; headless hosts bind `extensionBindings.humanInput: HostInput` (`confirm, select, input, editor, questionnaire`), requests carry `workflowRunId`/`workflowStageId`; a durable approval stays pending without an adapter and never auto-approves; only literal `true` confirms (`sdk.md:239-297`; `operations.md:162-166`) [docs]. `ui.custom` needs a presentation host [docs]. Answers can also come from the router via `workflow({action:"answer", runId, promptId, response})` (`workflow-schema.ts:57, 155-161`) [code].
- Budget: per run only (`RunOpts.budget`, definition `budget`, config), and per child via `ctx.workflow(def, {budget})` (`authoring-contract-ui.ts:249-250, 307-308`; `authoring-contract-stage.ts:491-495`) [code]. No per-stage budget; no maxStages/maxToolCalls (`specs/2026-08-17-run-budgets.md:35`) [docs]. Per-ticket budget = one run (shape A) or one child workflow (shape C).

---

## 7. Existing pieces resembling the harness

| Need | In Atomic? | Where |
|---|---|---|
| GitHub event source / poller / webhook | **No.** Only an example `github-issue-autocomplete.ts` (gh issue list for `#` completion) and a "feedback" skill that posts via `gh` | `coding-agent/examples/extensions/github-issue-autocomplete.ts:1-2`; `skills.md:126-130` [code+docs] |
| External trigger into chat | Example extension, file watch → `sendMessage(triggerTurn)` | `examples/extensions/file-trigger.ts` [code] |
| Permission gate | Example extension | `examples/extensions/permission-gate.ts` [code] |
| Web panel / HTTP server | **No.** Only a Next.js embedding guide; TUI `BACKGROUND` panel; `.atomic/workflows/status.json` writer (`statusFile` config, default false); Herdr pane reporter (interactive only) | `docs/sdk/web-server.md`; `operations.md:15-90`; `config-loader.ts:62,185`; `docs/herdr.md:3-12` [docs+code] |
| Workflow heartbeat | Yes, but it is an **alignment ping to the parent chat**, not a liveness watchdog: `heartbeatIntervalMinutes` (default 15, 0 off), card queued as a steer at a safe boundary, at most one outstanding per run, skipped not stacked | `docs/workflows/api-reference.md:60-86`; `specs/2026-08-06-workflow-heartbeats.md:14-48`; scheduler `workflows/src/extension/workflow-heartbeat-scheduler.ts` [docs+code] |
| Process liveness | Journal lease renewed ~30 s, stale after ~120 s → `crashed`; local worker pool has its own worker heartbeats/`leaseMs` | prior file; `operations.md:657, 903` [docs] |
| Storage health probe | `atomic storage status` (exits 1 when DB unreachable) | `docs/reference/cli.md:114` [docs] |
| Progress summaries | Generated at heartbeat cadence and on finish/block; injected on resume | `operations.md:591-593` [docs] |

The external watchdog therefore has to be built: launchd `KeepAlive` + a liveness probe (e.g. lease age in the journal or a heartbeat file the router extension writes) + post-restart resume after lease expiry [inf].

---

## 8. Shape-specific consequences [inf unless tagged]

**A (extension inside Atomic, main session = Router)**
- Gets for free: background launch, async result notices that wake the router, `observeWorkflowActivity`, Intercom steering, tool_call guard in every worker, resume API, heartbeats.
- Needs: a host process that keeps the session alive (TUI in tmux/Herdr, or `--mode rpc` under launchd), pollers guarded to the router session, `resumeInFlight:"auto"` plus explicit resume after the lease window, a HostInput bridge if headless (TUI covers it interactively).
- Risk: "router never executes" is a prompt/tool-allowlist policy; the main session has bash/edit by default. Restrict with `setActiveTools([...])` (`api-types.ts:343`) [code], but note child tool selections "can narrow the parent's selection, not expand it" (`sdk.md:471`) [docs], so narrowing the router's tools may also narrow what stages can use. Must be tested.

**B (Node daemon embedding SDK)**
- Same engine and same session-owned features (`sdk.md:141`) [docs], plus direct ownership of: HostInput bridge (`sdk.md:239-268`), `session.workflows.observe`, launchd process, pollers outside the LLM, `resourceAdmission` caps (`sdk.md:165-200`). Pollers can call `session.prompt/steer/followUp` or `sendCustomMessage` directly (`sdk.md:682-745`; `:200`) [docs].
- The tool-allowlist inheritance risk from A applies here too.

**C (harness = one long-running workflow)**
- No durable sleep or inbox primitive in `WorkflowRunContext` (`authoring-contract-ui.ts:93-128`) [code]. Event intake would be `ctx.tool` polls, each a journal checkpoint keyed by ordinal; replay re-executes the body from the top, so an always-on loop grows the journal and replay time without bound, and event arrival order is non-deterministic against ordinal replay keys.
- Children via `ctx.workflow` are awaited promises inside one root; depth cap 3 (`subagents.md:148`) [docs]; one root lease and one owner session; budget accumulates across the whole tree, so a run-level budget becomes a harness-lifetime budget.
- Heartbeat cards every 15 min to the parent chat by default (disable with 0).
- Human talk still needs a main chat that owns the root run, so C still needs A or B around it.
