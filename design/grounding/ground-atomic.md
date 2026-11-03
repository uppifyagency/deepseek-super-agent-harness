# Atomic 0.9.63 workflow engine: grounding for the Super-Agent-Harness types

Source: `~/src/ext/atomic-0.9.63`. Paths below are relative to `packages/` unless they start with `docs/`, `specs/` or `research/`.
Tags: **[code]** read in code, **[docs]** read in docs/specs/changelog, **[inf]** inferred.
Method: pstack `how`, complex path. Four opus explorers (authoring+status+budget, durability, embedding, workers+models), then synthesis by the parent agent, which spot-checked the load-bearing claims (status union, budget stop, `sdk-run.ts`, web-server guide, `node:sqlite`, CLAUDE.md loading, licenses). The DeepWiki was mostly not used: the durability page is stale (it still lists DBOS files that no longer exist).

## Overview

A workflow is a TypeScript object made by `workflow({...})`. Its `run(ctx)` body is ordinary async code that calls durable primitives: `ctx.stage` (an LLM agent session), `ctx.task`/`chain`/`parallel`, `ctx.tool` (a cached side effect), `ctx.ui` (a human gate), and `ctx.workflow` (a child run). Every primitive writes a checkpoint to an event-sourced **SQLite journal** (not DBOS, not Postgres, in 0.9.63). On resume the body re-executes from the top and each primitive returns its cached result. A stage that was mid-flight is reattached to its persisted transcript and told to continue.

A host embeds it by calling `run(def, inputs, opts)` in-process. Every stage is an in-process Pi `AgentSession` (Atomic's own coding agent). Claude Code is not a stage runtime option.

## Key Concepts

| Concept | What it is | Where |
|---|---|---|
| `workflow()` | the only way to mint a definition (branded via WeakSet) | `workflows/src/authoring/workflow.ts:149-153, 31, 55-69` [code] |
| `WorkflowRunContext` (ctx) | inputs, runId, cwd, stage, task, chain, parallel, workflow, ui, tool, exit | `workflows/src/shared/authoring-contract-ui.ts:93-128` [code] |
| `RunJournal` | host-pluggable storage interface with leases and keyed appends | `coding-agent/src/core/storage/run-journal.ts:103-133` [code] |
| `run()` | SDK entry point, no TUI | `workflows/src/runs/foreground/sdk-run.ts:16-53` [code] |
| `RunResult` | runId, status, result, failure classification, stages, toolNodes | `workflows/src/shared/authoring-contract-ui.ts:464-479` [code] |
| `WorkflowBudget` | maxDurationMs, maxTokens, maxCost, warnAtPercent | `workflows/src/shared/budget.ts:12-17` [code] |

## How It Works

### 1. Authoring API

The spec passed to `workflow()` (`workflows/src/shared/workflow-authoring-types.ts:93-111`) [code]:

```ts
export interface AuthoredWorkflowSpec<TInputs, TOutputs, TActualOutputs, TRunContext> {
	readonly name?: string; readonly autoAttach?: boolean; readonly heartbeatIntervalMinutes?: number;
	readonly budget?: WorkflowBudget; readonly description: string;
	readonly inputs?: TInputs; readonly outputs: TOutputs;
	readonly worktreeFromInputs?: WorkflowWorktreeInputBinding;
	readonly run: (ctx: TRunContext) => Promise<WorkflowRunOutputResult<TOutputs, TActualOutputs>> | WorkflowRunOutputResult<...>;
}
```

- Inputs and outputs are typebox schema maps: `WorkflowInputSchemaMap = Readonly<Record<string, TSchema>>` (`workflows/src/shared/authoring-contract-stage.ts:34-35`) [code]. A field is optional if `TOptional` or has a `default` (`workflow-authoring-types.ts:21-30`); undeclared output keys are a type error (`:85-91`) [code].
- `outputs` is mandatory (may be `{}`) (`authoring/workflow.ts:161-168`). If `name` is missing it is taken from the caller file name via stack trace (`:129-136, 184-185`). Budget is validated at definition time (`:182`) [code].
- Resolved form `WorkflowDefinition` (`authoring-contract-ui.ts:236-255`) carries `name`, `normalizedName`, `budget`, `inputs`, `outputs`, `run(ctx)` [code].

The ctx (`authoring-contract-ui.ts:93-128`) [code]:

```ts
readonly inputs: Readonly<TInputs>; readonly runId?: string; readonly cwd?: string;
exit(options?: WorkflowExitOptions<TOutputs>): never;
stage<TSchemaDef extends TSchema>(name: string, options: StageOptions<TSchemaDef> & { readonly schema: TSchemaDef }): StageContext<TSchemaDef>;
stage(name: string, options?: StageOptions): StageContext;
task(name, options: WorkflowTaskOptions): Promise<WorkflowTaskResult>;
chain(steps, options?): Promise<WorkflowTaskResult[]>;
parallel(steps, options?): Promise<WorkflowTaskResult[]>;
workflow<...>(definition, ...args: WorkflowRunChildArgs<TChildRunInputs>): Promise<WorkflowChildResult<TChildOutputs>>;
readonly ui: WorkflowUIContext;
tool: WorkflowToolPrimitive;
```

- `ctx.stage(name, opts)` returns a `StageContext` with `prompt(text, opts): Promise<WorkflowStageResult<S>>`, `complete`, `sendUserMessage`, `steer`, `followUp`, `subscribe`, `setModel`, `abort` (`authoring-contract-stage.ts:380-411`). The result is `Static<S>` with a schema, else `string` (`:87-89`) [code].
- `StageOptions` (`authoring-contract-stage.ts:179-217`): `schema`, `schemaTimeoutMs`, `model` (string, object, or `"auto"`), `fallbackModels`, `modelConstraints`, `taskNeeds`, `tools`/`noTools`/`excludedTools`/`customTools`, `mcp {allow, deny}`, `cwd`, `context: "fresh"|"fork"`, `gitWorktreeDir`, `baseBranch`, `group` [code].
- `ctx.tool(name, args, fn)`: `fn` receives `{ signal }`. Options `maxAttempts`, `intervalMs`, `backoffRate`, `timeoutMs`, `failureMode`. With `failureMode: "return"` it yields `{ok:true,value,attempts,cached} | {ok:false,error,attempts,cached}`, else it throws (`authoring-contract-ui.ts:130-205`). Values must be serializable; an explicit `undefined` is rejected at runtime (`authoring-contract-stage.ts:16-29`) [code].
- `ctx.ui`: `input`, `confirm`, `select`, `editor`, `custom(factory, {replayIdentity})` (`authoring-contract-ui.ts:77-83`) [code].
- `ctx.exit({status?, reason?, resumable?, outputs?})`; failed exits are non-resumable by default (`authoring-contract-stage.ts:61-67`) [code].
- Child result is a union (`authoring-contract-stage.ts:513-534`) [code]:
  `{status:"completed"; exited:false; outputs}` or `{status: WorkflowExitStatus; exited:true; outputs: Partial<...>; exitReason?}`. Child options `{inputs?, stageName?, budget?}` (`:491-495`).
- Example: `workflows/builtin/goal.ts:15-60` (outputs.status is `"complete"|"blocked"|"needs_human"|"active"`) [code].

### 2. Durability

- **Not DBOS, not Postgres in 0.9.63.** Store is an event-sourced SQLite journal. DBOS and embedded Postgres were removed (`research/workflow-journal-s5a-notes.md:147-151`) [docs]. They were mandatory in older releases (`coding-agent/CHANGELOG.md:4570`) [docs], which is why the DeepWiki and old notes mention them [inf].
- `SqlRunJournal` tables `meta`, `runs`, `events (PRIMARY KEY(run_id,seq), UNIQUE(run_id,key))`, `leases (holder_id, epoch, renewed_at)` (`workflows/src/durable/journal/sql-run-journal.ts:118-133`) [code]. Driver is `node:sqlite` (`workflows/src/durable/journal/sqlite-run-journal.ts:2`) [code].
- **Store selection** (`workflows/src/durable/journal/resolution.ts:50-102`) [code], first match wins:
  1. a `RunJournal` object passed by the host (duck-typed, 15 methods, `:54-77`);
  2. a selection `{path}` | `{memory:true}` | `{adapter, options, secrets, prefix}` | `{database, prefix}` (`coding-agent/src/core/storage/selection.ts:17-96`);
  3. env/CLI (`ATOMIC_WORKFLOWS_JOURNAL`, `ATOMIC_STORAGE`, `--storage`);
  4. settings `workflows.journal` or `storage`;
  5. default `~/.atomic/workflows/journal.sqlite` (`resolution.ts:52,89`, `coding-agent/src/config.ts:384-390`); `ATOMIC_WORKFLOW_JOURNAL_PATH` overrides.
  Lighter and heavier options: `MemoryRunJournal` (no crash recovery, `resolution.ts:35`), and the optional `@bastani/atomic-storage-libsql` adapter for libSQL/Turso URLs (`storage-libsql/README.md`) [docs]. A Postgres store would have to be a custom `RunJournal`; `durable/journal/conformance.ts` is a conformance suite for that (not read) [inf].
- **Event types**: `RunStarted`, `StatusChanged`, `CheckpointRecorded{kind: tool|ui|stage|task|boundary}`, `PromptAsked`/`PromptReleased`, `Message*`, `TimerScheduled`, `SummaryRecorded` (`run-journal.ts:3-16, 42-61`) [code].
- **What is cached (does not replay)** [code]:

| Primitive | Replay key | Where |
|---|---|---|
| `ctx.tool` | `durableHash({name,args,ordinal,failureMode?})` | `durable/tool-primitive.ts:325-340` |
| `ctx.stage` | `stage:${name}:${n}` (per-name counter) | `durable/stage-primitive.ts:663-670` |
| `ctx.task` | `task:` prefix, same scheme | `stage-primitive.ts:262-265` |
| `ctx.ui.*` | hash of root id, scope, author callsite hash, descriptor, ordinal | `durable/ui-primitive.ts:71-90` |
| `ctx.workflow` | `workflow:${name}:${fingerprint}:${n}` | `engine/run.ts:603-609`, `durable/child-primitive.ts:76-95` |

- **What re-executes**: everything outside `ctx.*`, plus any tool without a completed checkpoint (cancelled or thrown calls are inspection-only), so tools are at-least-once (`tool-primitive.ts:513-518`, `durable/types.ts:143-149`) [code]. Journal fencing does not deduplicate external effects (`coding-agent/docs/sdk.md:381`) [docs].
- **Mid-flight stage**: its `sessionId`/`sessionFile` is checkpointed during execution (`stage-primitive.ts:78-111`); on replay the stage resumes that session and its next prompt becomes `RESUME_CONTINUATION_PROMPT` ("Continue where you left off") (`stage-primitive.ts:114-125, 172-191`) [code]. The in-flight model turn is lost [inf].
- **Resume flow** (`durable/resume-runtime.ts`) [code]: under `withWorkflowLease` (`:118-148`), reject locally live or foreign-owned runs (`:224-230`), check eligibility (`:232`), resolve the definition **by name** from a registry or resolver (`:263-270`), revalidate stored inputs (`:279-288`), fork if cwd differs (`:289-315`), compute a tool resume frontier (`:316-335`), CAS the status to `running` (`:389-397`), relaunch under the same run id (`:420-436`).
- **Leases**: holder id is random per process (`journal-backend.ts:53, 368`); lease expires after 120 s without renewal (`journal/lease-expiry.ts:2-3`); renewal every 30 s; every write is fenced by holder+epoch, `StaleLeaseError` on mismatch (`sql-run-journal.ts:409-413, 456-467`) [code].
- **Eligibility**: a running/paused run needs `completedCheckpoints > 0 || pendingPrompts > 0`, else it is not resumable (`durable/resume-eligibility.ts:66-71`) [code].
- **Auto recovery** exists only in the TUI extension (`resumeInFlight`, default `"never"`, `extension/config-loader.ts:186,221`) [code]. A headless host must drive resume itself [inf].
- **Retention**: no automatic deletion; `deleteDurableWorkflowIfSafe` refuses running runs (`durable/retention-policy.ts:7-43`) [code].

### 3. RunStatus, blocked, budgets

```ts
// workflows/src/shared/authoring-contract-stage.ts:43-44  [code]
export type WorkflowExitStatus = "completed" | "skipped" | "cancelled" | "blocked" | "failed";
export type RunStatus = "pending" | "running" | "paused" | WorkflowExitStatus | "killed";
```

- Stage status: `RunStatus | "skipped" | "awaiting_input" | "blocked"` (`authoring-contract-ui.ts:381`); tool node status `pending|running|completed|failed|cached|cancelled` (`:412`); durable status `running|paused|completed|failed|cancelled|blocked` (`durable/types.ts:96`) [code].
- `RunFailureClassification` (`authoring-contract-ui.ts:431-462`): `kind`, `code`, `retryable`, `resumable`, `recoverability`, `disposition: "active_blocked"|"terminal_killed"|"terminal_failed"`, `retryAfterMs` [code].
- **There is no `budget_exceeded` RunStatus.** On exhaustion the engine returns `recordActiveBlockedFailure(...)` with `result = {status:"budget_exceeded", ...report}`, `failureDisposition:"active_blocked"`, `failureRecoverability:"recoverable"`, `resumable:true` (`engine/run.ts:1210-1231`, spot-checked) [code]. The returned `RunResult.status` is `"running"` (`shared/store-run-methods.ts:167`) [code]; the spec says this is deliberate (`specs/2026-08-17-run-budgets.md:31`) [docs].
- **`blocked` is often derived**: `effectiveRunStatus` reports `blocked` when a run is running/completed and carries a recoverable failure, or when the workflow's own `outputs.status` normalizes to `blocked|needs_human|incomplete|auth_blocked|budget_exceeded|active` (`shared/returned-run-status.ts:5-27, 109-122`) [code]. Only the engine can produce the resumable budget rail (`systemOwnedStop`, `:63-66`) [code].
- **Budget fields** (`shared/budget.ts:12-17`): `maxDurationMs`, `maxTokens`, `maxCost` (USD), `warnAtPercent` (default 80). Each resolved independently `run ?? definition ?? config ?? 0`; 0 disables (`budget.ts:54-83, 125-127`; `extension/workflow-budget-schema.ts:4-16`) [code].
- **Metering**: tokens = input + output, cache read/write excluded; cost = `usage.cost`; duration excludes paused time; summed over the child tree (`shared/budget-meter.ts:14-33`; spec:17,21) [code+docs].
- **Enforcement** only at boundaries (before stage start, around stage calls, child workflows, after tool nodes, local pool) (`engine/runtime.ts:200`, `runs/foreground/executor-stage-call.ts:147,337-340`, `engine/primitives/workflow.ts:71,148`, `engine/run-tool-node-lifecycle.ts:199`) [code]. First exhaustion gives the frontier stage one wrap-up turn (`engine/run-budget.ts:16-17, 194-221`), so real spend can exceed the cap (reported as `wrapUpUsage`) [code].
- **Resume after budget stop**: resume with a raised budget; continuation merges the old budget under the new one and carries accounting (`engine/run.ts:204-283`); without a raise it stops again with no second wrap-up (`run-budget.ts:216-220`) [code]. A child's budget stop surfaces to the parent as `{status:"blocked", exited:true}` (`engine/primitives/workflow.ts:160-191`) [code].

### 4. Embedding surfaces

- **In-process SDK** [code]. Package root re-exports `sdk-surface.ts` (`workflows/src/index.ts:8`): `run`, `createAgentSessionAdapter`, `cancellationRegistry`, `createStore`/`store`, `MemoryRunJournal`, `openSqlRunJournal`, `SqlRunJournal`, `resolveRunJournal`, types `RunSnapshot`, `StageSnapshot`, `RunStatus`, `PendingPrompt` (`sdk-surface.ts:25-58`).

```ts
// workflows/src/runs/foreground/sdk-run.ts:16-24  [code]
export function run<TInputs extends WorkflowInputValues, TOutputs extends WorkflowOutputValues, TRunInputs extends WorkflowInputValues = TInputs>(
	def: WorkflowDefinition<TInputs, TOutputs, TRunInputs>, inputs: WorkflowRunInputArgument, opts?: RunOpts,
): Promise<RunResult<TOutputs>>;
```
  `run()` opens the durable backend from `opts.journal`/`cwd`, uses `opts.runId ?? randomUUID()`, installs the default in-process agent-session adapter, acquires a standalone Intercom route, calls the engine (`sdk-run.ts:25-53`) [code]. `RunOpts` includes `cwd`, `ui`, `executionMode`, `signal`, `budget`, `journal`, `runId`, `continuation`, `cancellation`, `localWorkers`, `admission`, `onRunStart`, `onStageStart`, `onStageEnd`, `onStageSessionEvent(runId, stageId, AgentSessionEvent)`, `onRunEnd(runId, status, result?, error?, exitReason?)` (`authoring-contract-ui.ts:287-342`; `runs/foreground/executor-types.ts:47-173`) [code].
- **Observe**: callbacks above, or `Store.subscribe(fn: (snap) => void)`, `run(runId)`, `runs()`, `snapshot()` (`shared/store-public-types.ts:363-365`) [code]. Session hosts also have `session.workflows.observe(observer)` (snapshot then `changed`/`removed` frames) (`coding-agent/src/core/extensions/workflow-run-control.ts:165-171`) [code]. Optional `.atomic/workflows/status.json` writer (`extension/status-writer.ts:1-15`) [code].
- **Human gates**: `ctx.ui` resolves to prompt nodes, or a headless-unavailable context when `executionMode: "non_interactive"` with no `ui`, or `opts.ui` (`engine/primitives/ui.ts:22-27`); answers are durably cached (`:34-35`) [code]. The host supplies `WorkflowUIAdapter { input; confirm; select; editor; custom }` (`authoring-contract-ui.ts:85-91`); a web host can back each method with a promise settled by an HTTP answer [inf]. Store path: `resolveStagePendingPrompt(runId, stageId, promptId, response)` (`store-public-types.ts:268-274`), used by `extension/workflow-human-input.ts:111-113` [code]. SDK sessions: `extensionBindings.humanInput`; a durable gate stays pending if no adapter is bound (`coding-agent/docs/sdk.md:119, 281-295`) [docs]. `ctx.ui.custom` cannot be answered by a host-input adapter (`sdk.md:277`) [docs]. `contact_supervisor` is a subagent escalation tool, not a workflow gate (`intercom/contact-supervisor-tool.ts:42-51`) [code]. There is no `needs_human` gate primitive; `needs_human` is only a value of a workflow's own `outputs.status` that makes the run read as blocked (`returned-run-status.ts:5-27`) [code].
- **Cancel**: `RunOpts.signal`, or `cancellationRegistry.abort(runId, reason?)`/`abortAll` (`runs/background/cancellation-registry.ts:28-31`) [code]. Session API: `pause`, `quit`, `resume(runId, options?)`, `waitForSettled` (`workflow-run-control.ts:146-162`) [code].
- **Resume after crash**: `resumeDurableWorkflow` is **not** exported from `sdk-surface.ts`; the public path is `session.workflows.resume(runId)` on a `createAgentSession` with the same cwd and journal, after the ~120 s lease expires (`coding-agent/docs/sdk.md:363, 374-377`) [docs+code]. `SessionWorkflows` has no `start` (`workflow-run-control.ts:146-171`) [code]. Whether `run(def, inputs, {runId: crashedId, journal})` resumes a crashed run is unverified: `sdk-run.ts:32-33` looks for a backend owning that id but no takeover path was found [inf].
- **RPC**: `coding-agent` has `--mode rpc` with JSON lines on stdio (`coding-agent/src/cli/args.ts:24`, `modes/rpc/rpc-types.ts:1-6`). Commands include `prompt`, `abort`, `list_workflow_runs`, `get_workflow_run_summary` (`rpc-types.ts:86-177`); UI answers return as `extension_ui_response` (`:491-554`) [code]. No start-workflow, answer-gate or resume RPC; a run can only be started by sending `/workflow run ...` as a `prompt` [code+inf].
- **"Embedding Atomic in a web server"**: exists as a doc, `coding-agent/docs/sdk/web-server.md` (linked from `docs/sdk.md:31`), a Next.js App Router guide calling `run(def, inputs, {cwd, signal, journal:{memory:true}, adapters:{agentSession: createAgentSessionAdapter(...)}, onStageSessionEvent})` and streaming NDJSON (`web-server.md:238-300`); it recommends `journal:{path}` for restart recovery (`:296-300`) [docs, spot-checked]. Missing: no server code in the repo, no CHANGELOG entry, and no "3483" anywhere except unrelated snapshot refs in `research/` [code]. So PR #3483 cannot be confirmed from this tree; the guide is the shipped artifact [inf]. The guide covers start, stream and cancel; it does not cover answering gates or crash resume from a server [docs].
- **Runtime**: Node. `@bastani/atomic` needs `node >= 22.19.0` (`coding-agent/package.json:164-166`); the guide says the same (`web-server.md:22`) [code+docs]. `@bastani/workflows` is private, ships raw `.ts` and declares `bun >= 1.4.2` (`workflows/package.json:4, 12-14`) [code], but there are no `bun:` imports and the journal uses `node:sqlite` [code]. Under Node import the compiled `@bastani/atomic/workflows` (`coding-agent/package.json:46-50`) [code]. Bun works for dev in-repo [inf].

### 5. Worker pool and concurrency

- Per-run stage semaphore `createRunLimiter(defaultConcurrency ?? 1000)` (`runs/shared/concurrency.ts:85-86`, `engine/run.ts:405`); default 1000, so effectively unlimited; set via `defaultConcurrency` setting (`extension/config-loader.ts:181-183`) [code]. Per-call `concurrency` on `parallel` (`runs/foreground/executor-direct-helpers.ts:29-44`) [code]. Internal fixed limiters: stage routing 8, resource reloads 4 [code].
- **Local workers (opt-in)**: `LocalWorkerOptions { count, definitions, startupTimeoutMs?, leaseMs?, maxLoadPerCpu? }` (`workers/public-options.ts:8-21`). Root forks a coordinator, which `child_process.fork`s N workers (`workers/local-pool.ts:158-162`, `workers/pool-coordinator.ts:1263-1289`). Each worker claims one first-level `ctx.workflow` child at a time and runs the ordinary engine (`workers/local-worker.ts:428-441, 600-625`) [code]. Only whole child subtrees are placed on workers (`docs/workflow-local-workers.md:162`); 3 attempts per child then `worker_retry_limit` (`:19`); Linux/macOS only (`:5`) [docs].
- **Admission**: `admission.limits.{session,process}`, `admission.userLimits` (shared SQLite counter), `host.{maxLoadPerCpu,minFreeMemoryBytes}` (`workers/public-options.ts:1-6`, `workers/resource-admission.ts:183, 265-271`) [code]. Counts agent sessions and Atomic-managed tool processes, not arbitrary subprocesses (`docs/workflow-local-workers.md:166`) [docs].
- **Worktrees**: two mechanisms, mutually exclusive (`executor-direct-helpers.ts:256-260`) [code]. `gitWorktreeDir` on a stage: `git worktree add --detach`, reused across stages, retries and resume, never auto-removed (`runs/shared/worktree-git.ts:573-574`; `coding-agent/docs/workflows/api-reference.md:740-743`). `worktree: true` on `ctx.task`: `git worktree add -B <branch> .atomic/worktrees/<name>`, post-create copies `.atomic/settings*`, symlinks `node_modules`, copies `.worktreeinclude` files, runs an optional setup hook, then diffs and cleans up in `finally` (`engine/primitives/task.ts:113-138`, `runs/shared/worktree-setup.ts:94-96, 325-361`, `worktree-post-create.ts:33-136`) [code]. Worker processes do not get their own worktree; placement and worktree are independent [code].

### 6. Models and stage agent

- Providers registered in `ai/src/providers/all.ts:5-57` [code]: amazon-bedrock, ant-ling, anthropic, azure, baseten, cerebras, cloudflare (gateway, workers-ai), deepseek, fireworks, github-copilot, google, google-vertex, groq, huggingface, kimi-coding, meta, minimax, mistral, moonshotai, morph, nvidia, openai, openai-codex, opencode, openrouter, qwen, together, typesafe, vercel-ai-gateway, xai, xiaomi, zai, radius (dynamic) and variants.
- Anthropic has an OAuth "Claude Pro/Max" subscription mode that presents itself as Claude Code (user-agent `claude-cli/...`, Claude Code beta headers, tool renaming, system line) (`ai/src/providers/anthropic.ts:69-84`, `ai/src/api/anthropic-messages.ts:107-145, 1369-1382`) [code]. This is Atomic's own agent calling the Messages API, not the Claude Code binary [inf].
- Stage model choice: candidates `[model, ...fallbackModels, currentModel]`, deduplicated and resolved against the host catalog; unresolvable models fail before the run (`runs/shared/model-fallback-candidates.ts:179-257`); `"auto"` routes via `modelConstraints`/`taskNeeds` (`extension/workflow-model-catalog.ts:18-50`) [code].
- **Stage agent is always an in-process Pi `AgentSession`**: "an in-process pi SDK AgentSession for each workflow stage. There is no subprocess" (`extension/wiring.ts:573-588`) [code]. No Claude Code, Claude Agent SDK or ACP adapter in `packages/*/src`; the rewrite spec says Claude Code / Claude Agent SDK support was "removed in their entirety" (`specs/2026-05-11-atomic-pi-coding-agent-rewrite.md:69`) [docs]. In-process hosts can replace the session factory (`createAgentSession`, `wiring.ts:593-605`; `RunOpts.adapters.agentSession`) but the replacement must implement the Pi session contract; the worker pool rejects process-bound adapter overrides (`docs/workflow-local-workers.md:27,164`) [code+docs].
- **pstack inside a worker**, three routes [inf unless tagged]:
  1. Native skills: Atomic discovers `SKILL.md` dirs in `.atomic`/`.pi`/`.agents/skills` (project ones only if trusted) and `skills` settings paths (`coding-agent/src/core/package-manager-auto-resources.ts:77, 102-126`, `core/skills.ts:166-197`) [code]. No `.claude/skills` or `.claude/plugins` path is read [code]. `CLAUDE.md` is loaded as a context file (`core/resource-loader-context-files.ts:41`) [code]. Claude Code hooks (`hooks.json`, `PreToolUse`) are not supported; they would need porting to an Atomic TypeScript extension [code+inf].
  2. Spawn `claude -p` from `ctx.tool` with cwd = worktree: works, gets durable caching of the final result, but no streaming, no budget metering, and no admission accounting for that process [code+docs+inf].
  3. Spawn it from the stage agent's bash tool: same as 2, inside an LLM turn [inf].

### 7. Licenses

- Root `LICENSE` MIT (Bastani, Inc.) [code]. Every package declares MIT and ships an MIT LICENSE: `@bastani/atomic` (no LICENSE file in the package dir; root one applies), `@bastani/workflows` (private, not published), `@bastani/pi-ai`, `@bastani/intercom`, `@bastani/mcp`, `@bastani/atomic-natives`, `@bastani/atomic-storage-libsql`, `@bastani/subagents`, `@bastani/web-access` [code].
- Third-party `@earendil-works/pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-tui`, `pi-telemetry` are MIT (`coding-agent/npm-shrinkwrap.json`) [code].
- **Flag**: `mupdf` 1.28.0 is **AGPL-3.0-or-later**, pulled as a hard dependency of `markit-ai` (document conversion) by `@bastani/atomic` (`npm-shrinkwrap.json`, `node_modules/markit-ai` dependencies) [code]. For a network service this needs a legal look or a way to exclude it [inf].

## Where Things Live

- Authoring types: `workflows/src/shared/authoring-contract-ui.ts`, `authoring-contract-stage.ts`, `workflow-authoring-types.ts`; entry `workflows/src/authoring/workflow.ts`.
- Engine: `workflows/src/engine/run.ts`, `run-budget.ts`, `primitives/`.
- Durable: `workflows/src/durable/` (`resume-runtime.ts`, `*-primitive.ts`, `journal/`); storage interface `coding-agent/src/core/storage/run-journal.ts`.
- SDK: `workflows/src/sdk-surface.ts`, `runs/foreground/sdk-run.ts`; docs `coding-agent/docs/sdk.md`, `docs/sdk/web-server.md`, `docs/workflows/api-reference.md`, `operations.md`.
- Workers: `workflows/src/workers/`; worktrees `workflows/src/runs/shared/worktree-*.ts`.

## Gotchas for the harness types

1. Do not model run state from `RunResult.status` alone: a budget stop returns `"running"`. Derive the harness state from `status` + `failure.disposition` + `result.status` [code]. A harness `RunState` union with `budget_exceeded` and `blocked` is a harness concept, not an Atomic one.
2. `onRunEnd` is not called on the active-blocked path (`recordActiveBlockedFailure`), so a budget stop may only be visible through `RunResult` or store subscription [code, unverified end to end].
3. Resume needs a stable name-to-definition registry and the same cwd (otherwise it forks to a new run id) (`resume-runtime.ts:248-315`) [code].
4. After a crash, expect `owned_elsewhere` for up to ~120 s (new process = new holder) [code+inf].
5. Replay is by per-name ordinal; UI replay keys include the author callsite, so editing the workflow file between crash and resume can miss cached gate answers [code+inf]. Tool cache ignores callback code changes [code].
6. Zero-progress runs are not resumable; the harness must restart them fresh [code].
7. `executionMode: "non_interactive"` without `ui` makes every `ctx.ui` call fail; pass a `ui` adapter backed by the harness's gate store [code].
8. Tools are at-least-once; key GitHub side effects (comments, PRs) with idempotency keys derived from run id + tool name [docs+inf].
9. `gitWorktreeDir` worktrees are never cleaned up by Atomic; the harness owns cleanup [code].
10. Worker processes inherit full `process.env`, including provider credentials [code].

## Open questions (not resolved)

- Does standalone `run(def, inputs, {runId: <crashed>, journal})` recover the crashed run, or only `session.workflows.resume`?
- Do stage sessions in a fresh worktree count as trusted for project `.agents/skills`, and does the stage inherit the parent's resource set instead of discovering from the worktree cwd (`wiring.ts:600, 623-626`)?
- What `fold_usage` does when a provider reports no cost (affects `maxCost` enforcement).
- Whether a Postgres `RunJournal` passes `durable/journal/conformance.ts`.
