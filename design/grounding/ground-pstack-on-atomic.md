# pstack inside an Atomic 0.9.63 workflow stage

Sources: pstack at `~/src/pstack-claude` (0.9.117), referred to as `PS/`. Atomic at `~/src/ext/atomic-0.9.63`, referred to as `AT/`. Prior note `design/grounding/ground-pstack.md` covers pstack outputs (orch store, ledger, resume, watch-pr); not repeated here.

Tags: **[code]** read in code this session, **[docs]** read in docs this session, **[inferred]** reasoning from what was read, not run. Nothing here was executed live against Atomic.

## 1. pstack's Pi support, as documented

**Install.** The pstack repo root is a Pi package. `PS/package.json:32-39` declares `"pi": { "skills": ["./plugins/pstack/skills"], "extensions": ["./plugins/pstack/pi/index.ts"] }` and peer-depends on `@earendil-works/pi-coding-agent` and `typebox` with `*` (`:40-48`) [code]. Install with `pi install git:github.com/michael-denyer/pstack-claude` or `pi install <clone path>` (`PS/docs/reference.md:141`) [docs]. CI typechecks the extension against `@earendil-works/pi-coding-agent@1.1.0` (`PS/.github/workflows/ci.yml:168`); the equivalence table is "verified on Pi 1.1" (`PS/docs/reference.md:65`) [code/docs].

**Mapping file.** Yes: `PS/plugins/pstack/skills/poteto-mode/references/pi-tools.md` (115 lines), plus the verification ledger `PS/docs/pi-equivalence.md` (one row per Claude Code mechanism, status and test name) [code]. The extension injects a pointer to pi-tools.md into every session's system prompt (`PS/plugins/pstack/pi/prompt.ts:15-18,35`) [code].

**Extension (`PS/plugins/pstack/pi/`, 1893 lines TS).** `index.ts:12-38` wires: agent runner, scheduler, ask tool, prompt sections, `paths:` skill notes, exit/shutdown cleanup [code].

**Tool name mapping (pi-tools.md, equivalence rows):**

| Claude Code | On Pi via pstack | Source |
|---|---|---|
| `Agent` / `Task` | `agent` tool: spawns a child `pi --mode rpc` process, sends the prompt over RPC stdin; `subagent_type`, `model`, `effort`, `run_in_background`, `readonly`, `isolation: "worktree"` | pi-tools.md:18-19,31-46; agents.ts:134-141,255 [code] |
| `SendMessage` | `send_message` (RPC `steer` to running child, resume if finished) | pi-tools.md:21; T07 [docs] |
| list/stop agents | `list_agents`, `stop_agent` | pi-tools.md:22-23 [docs] |
| `pstack:poteto-agent` etc. | resolved from `plugins/pstack/agents/*.md`, appended via `--append-system-prompt` | A01-A06 [docs]; agents.ts:137 [code] |
| `Skill` / `/command` | native Pi skills, `/skill:<name>`; skills load under bare names | pi-tools.md:17; T11, T12 [docs] |
| `AskUserQuestion` | `ask_user_question`; errors in print/JSON mode and in child agents; `pi ask tool: off` in the sheet skips it | pi-tools.md:25; config.ts:79-80; index.ts:17 [code] |
| `TaskCreate`/`TodoWrite` | none; poteto-mode's `todo.md` fallback | pi-tools.md:24; T14 [docs] |
| `ScheduleWakeup` | `schedule_wakeup` | pi-tools.md:26; T17 [docs] |
| `/loop` | extension command `/loop [interval] <prompt>` | schedule.ts:177; S03 [code] |
| Background completion | notice joins the turn after current tool calls; in print/JSON mode the extension holds settle until children exit | one-shot.ts:55-72; pi-tools.md:40 [code] |
| Nesting | up to 3 layers below main; layer 3 runs without `agent` | agents.ts:140 (`MAX_SPAWN_DEPTH`); pi-tools.md:38; T21 [code] |
| SessionStart mandate | `before_agent_start` adds `hooks/session-start-context.md` as a system prompt section at depth 0 unless `session hook: off` | prompt.ts:29-38 [code] |
| `pstack-models.md` | read from `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, injected whole, children included | config.ts:47,85-103; prompt.ts:37 [code] |
| Model families | `models.json` `pi` block: `anthropic` (fallback), `openai`, `openai-codex`; `pi models: alias=provider/id` remaps | config.ts:120-142; reference.md:150 [code/docs] |

Documented caveat: Anthropic bills Claude used through Pi per token as extra usage even on a Claude plan, and every pstack subagent adds to it (`PS/docs/reference.md:150`) [docs]. Applies to Atomic for the same reason [inferred].

## 2. Compatibility with Atomic 0.9.63

**Package format: compatible.** Atomic reads the manifest from `pkg.atomic ?? pkg.pi` (`AT/packages/coding-agent/src/core/package-manager-manifest.ts:48`) [code], so pstack's `"pi"` key works. CLI is `atomic install git:...` / local path (`AT/.../src/package-manager-cli-parser.ts:4,55`) [code]. README states Atomic works with Pi skills and extensions (`AT/README.md:910`) [docs].

**Imports: compatible.** The extension imports `@earendil-works/pi-coding-agent` and `typebox`. Atomic aliases both at load time: `loader-virtual-modules.ts:452` and `loader-host-modules.ts:101` map `@earendil-works/pi-coding-agent` to Atomic's own entry; `typebox` is host-provided (`resource-loader-extension-warnings.ts:10-23`) [code]. pstack declares them as peer deps with `*`, which is what Atomic requires (`resource-loader-extension-warnings.ts:46`) [code].

**Extension API surface used by pstack: present in Atomic** [code], each checked by grep in `AT/packages/coding-agent/src/core/extensions/`:
`registerTool` with `exposure: "model-only"` (tool-types.ts:66,126), `before_agent_start` with `systemPromptOptions.sections` (runner-events.ts:54; system-prompt.ts:40), `agent_before_settle` / `agent_settled` (agent-events.ts:165,170), `sendMessage`/`sendUserMessage` with `deliverAs: steer|followUp` and `expandPromptTemplates` (api-types.ts:292,314), `registerFlag`/`getFlag` (api-types.ts:224), `getThinkingLevel` (:359), `appendEntry` (:318), `getCommands` (:346), `tool_result`, `session_shutdown`. Type compatibility under Atomic's TS was not compiled [inferred: likely fine, not proven].

**Child process CLI: compatible.** pstack spawns `[execPath, argv[1]] --extension <pstack>/pi/index.ts --skill <skills> --mode rpc --session-id --session-dir [--model] [--thinking] [--append-system-prompt] --pstack-depth N [--exclude-tools]` (agents.ts:134-141,255; config.ts:31-38) [code]. Every flag exists in `AT/packages/coding-agent/src/cli/args.ts` (`--mode rpc` :116, `--session-id` :158, `--session-dir` :162, `--thinking` :201, `--append-system-prompt` :143, `--exclude-tools` :196, `--extension` :220, `--skill` :227, `--model` :137) [code]. RPC `prompt` and `steer` commands exist (`modes/rpc/rpc-types.ts:86-87`) [code]. Under the npm `atomic` CLI, `process.argv[1]` is Atomic's script, so children are Atomic processes; under the compiled binary, `/$bunfs/` triggers `execPath` alone (config.ts:33-37) [code, inferred for the outcome].

**No tool-name collisions** with Atomic built-ins for `agent`, `send_message`, `list_agents`, `stop_agent`, `schedule_wakeup`, `/loop`: grep for these names across `AT/packages/*` found no registration [code, grep-level]. Atomic's own delegation tool is `subagent`, a different name. Extension-vs-extension duplicates are reported as conflicts (`resource-loader-extensions.ts:384-418`) [code].

**One real collision: `ask_user_question`.** Atomic ships a built-in `ask_user_question` (`core/tools/index.ts:163,342`) [code]. In the tool registry, extension tools are set after built-ins in one Map, so pstack's version replaces Atomic's (`core/agent-session-tool-registry.ts:93-103`) [code]. Atomic's built-in is the one wired to workflow stage HIL that marks the graph node as awaiting input (`AT/packages/workflows/src/extension/wiring.ts:14-17`) [code]. Fix: put `pi ask tool: off` in the sheet (config.ts:80; index.ts:17) [code]. In non-interactive workflow runs Atomic removes `ask_user_question` by name anyway (wiring.ts:400-403) [code].

**Agent dir mismatch: needs an adapter.** Atomic's agent dir is `~/.atomic/agent` (`config.ts:384-389`, configDir `.atomic` in `packages/coding-agent/package.json`), env `ATOMIC_CODING_AGENT_DIR` with `PI_CODING_AGENT_DIR` accepted as alias (`config.ts:326,343-347`) [code]. pstack reads only `PI_CODING_AGENT_DIR` or `~/.pi/agent` (`PS/.../pi/config.ts:47`) [code]. Without action, pstack reads the sheet from `~/.pi/agent/pstack-models.md`, stores child sessions under `~/.pi/agent/pstack/`, and `find-transcript.mjs`/`worktree-audit.mjs` look in `~/.pi/agent/sessions` (`worktree-audit.mjs:90-93`) [code]. Fix: export `PI_CODING_AGENT_DIR=$HOME/.atomic/agent` for the Atomic process; both sides then agree [inferred from the two code paths].

**Skill discovery.** Atomic auto-discovers `<configDir>/skills` for `.atomic` and legacy `.pi` (marked `inherited-pi`), `~/.agents/skills`, and ancestor `.agents/skills` in trusted projects (`core/package-manager-auto-resources.ts:58-61,77,120-125,140-150`) [code]. Package-declared skills load from the installed package. pstack project skills written to `.claude/skills/` are not discovered (pi-tools.md:78) [docs].

**SessionStart equivalent: yes.** Not a hook; the extension's `before_agent_start` handler adds the mandate on every agent start at depth 0 (prompt.ts:31-36) [code]. A workflow stage is an in-process `createAgentSession` with a `DefaultResourceLoader(cwd, agentDir, settingsManager)` that reloads installed packages (`AT/packages/workflows/src/extension/atomic-stage-session.ts:100-120`), and only the workflows package's own extension is disabled for stages (`:151-163`) [code]. So an installed pstack extension loads inside every stage, and since no `--pstack-depth` flag is set, depth is 0 and the mandate is injected [inferred from code]. Note the mandate also lands in verifier and planner stages; their briefs must override it (user instructions win, `hooks/session-start-context.md:14`) [docs, prior note].

**Model sheet: read, but not the one you have.** Your sheet is `~/.claude/pstack-models.md`; Pi/Atomic never read it [code: config.ts:88]. Copy it to `~/.atomic/agent/pstack-models.md` (with the env above). The extension injects its full text and resolves `opus` via the provider of the parent model, falling back to the `anthropic` table (`anthropic/claude-opus-5-5`) (config.ts:120-142; `PS/plugins/pstack/models.json` pi block) [code]. Effort `@level` becomes `--thinking` (A02) [docs]. Whether Atomic's generated catalog contains `anthropic/claude-opus-5-5` was not confirmed: the ID appears only in Atomic test files in source, since the catalog is generated at build (`AT/package.json` `generate:models`) [code, inferred].

**Stage mode and settle.** Stage sessions are bound without a `mode`, so the extension mode stays at the default `"print"` (`AT/.../agent-session.ts:218`; `agent-session-extension-bindings.ts:284-286`; `workflows/.../wiring.ts:667`) [code]. pstack treats print as one-shot and holds `agent_before_settle` until background children exit (one-shot.ts:57,67-72) [code]. Consequence: a stage will not complete while pstack background agents run, which is the desired behavior, and `ask_user_question`/`schedule_wakeup` from pstack error out in that mode (pi-tools.md:25) [inferred from code].

## 3. Claude Code specific pieces

| Piece | Under Atomic | Why |
|---|---|---|
| `hooks/hooks.json`, `session-start.sh`, `pre-tool-use.sh`, codex/copilot/muse hook files | not used | Replaced by the Pi extension's prompt injection (H01) [docs]. Atomic has no SessionStart shell hook contract for packages [inferred]. |
| Plugin agents (`poteto-agent`, `comment-sicko`, two thermo subagents) | work | Read at runtime from `agents/` and passed as appended system prompt (A01-A06; agents.ts:137) [code/docs] |
| `orch` (`bun .../scripts/orch/orch.ts`) | works via `bash` | Plain bun CLI; store `~/.claude/orchestrate/<slug>` or `ORCH_STORE` (F04 "native", C05) [docs]. Needs `bun` on PATH [inferred]. |
| `resume.mjs` | works | node + git common dir, runtime-neutral (prior note) [inferred] |
| `watch-pr`, `ship-pr` | work | bun + `gh` (C01, C05) [docs] |
| `show-me-your-work/scripts/log.sh` | works | POSIX shell [inferred] |
| `find-transcript.mjs`, `worktree-audit.mjs` | work with env fix | Read Pi session layout under `PI_CODING_AGENT_DIR` (F01, F07; worktree-audit.mjs:90) [code]. Atomic workflow stage transcripts live in a separate home-scoped location (`AT/.../docs/workflows/api-reference.md:677`) [docs]; whether the reader handles them is unverified. |
| `reflect/scripts/claude-project-dir.mjs`, eval playbook transcript paths | do not apply | Read `~/.claude/projects` (`playbooks/eval.md:22`) [code] |
| `TaskCreate`/`TodoWrite` | adapter choice | pstack says Pi has none and falls back to `todo.md` (pi-tools.md:24). Atomic does ship a `todo` tool storing files under `.atomic/todos` (`core/tools/todos.ts:2-7`) [code]. For host readback, mandate `todo.md` in the brief [inferred]. |
| `/loop`, `schedule_wakeup`, autonomous-run and babysit `drive` waits | do not fit a stage | A stage ends when its run settles; wakeups need a live idle session (pi-tools.md:26) [docs]. The workflow should own polling [inferred]. |
| Bundled `run`, `verify`, `code-review`, `simplify`, `security-review` | absent | S01, S02, S06 [docs] |

## 4. Subagents: pstack vs Atomic

- Atomic's `subagent` tool is exactly one level deep, not configurable; children cannot call `subagent` (`AT/.../docs/subagents.md:148,385`) [docs]. Workflow stages are top-level sessions allowed to delegate (`atomic-stage-session.ts:56-60` comment, `WORKFLOW_STAGE_SUBAGENT_POLICY` at :118) [code].
- pstack does not use Atomic's `subagent`. Its `agent` tool spawns separate `atomic --mode rpc` processes and enforces its own limit of three layers (agents.ts:140; pi-tools.md:38) [code]. Atomic's one-level rule does not constrain it [inferred: different mechanism, no shared policy object].
- Does poteto-mode need nesting? Sometimes. Feature playbook: "That owner fans out internally after the blocking phase" (`playbooks/feature.md:19`), so stage → owner → workers is 2 layers. Orchestrate: coordinator → track → worker, and sub-coordinators spawn their own verifiers "where the runtime lets a subagent spawn one" (`playbooks/orchestrate.md:18,22`). Arena/interrogate from inside an owner add a layer. Plain bug-fix or feature with one delegate needs 1 layer [docs]. Inside a stage, pstack's 3-layer budget covers these [inferred].
- Cost of using pstack's mechanism: its children are invisible to Atomic's workflow graph, durable journal, resource admission and resume. A stage replayed after a crash restarts its agent session; pstack's restore stops orphans and refuses to continue them until exit is confirmed (pi-tools.md:43) [docs]. Durability below the stage level is pstack's, not Atomic's [inferred].
- Do not enable Atomic `localWorkers` pools for runs whose stages use pstack `agent`: pooled workers are forked from `local-worker-entry.mjs` or an internal arg (`workflows/src/workers/local-pool.ts:151-155`; `pool-coordinator.ts:1267-1268`), so pstack's `argv[1]`-based child command would point at the worker entry, not the CLI [inferred from code; pools are opt-in, `docs/workflows/operations.md:858`].

## 5. Verification as a separate Atomic stage

The rule: "Only a verdict from an agent that did not write the code counts" (`playbooks/shipping.md:7`); "Never count your own review, passing tests, or CI as the independent verdict" (`SKILL.md:109`); a dedicated verifier runs on a different model family than the worker for expensive or high-blast-radius units (`playbooks/orchestrate.md:90`) [docs].

A fresh Atomic stage satisfies the letter of the rule: `ctx.task/ctx.stage` with `context: "fresh"` starts a clean session (`AT/.../docs/workflows/api-reference.md:521-525`; `authoring.md:29`) that never saw the writer's transcript [docs, inferred for "counts"]. What the stage needs:

1. **Inputs:** repo path, head branch and head SHA, base branch and base SHA, the original brief and acceptance predicate, the driver skill path or exact verify commands (`orchestrate.md:22`: the brief names the resolved skill path).
2. **Isolation:** a checkout at head SHA. Atomic `worktree: true` on `ctx.task` gives `<root>/.atomic/worktrees/<name>` (`api-reference.md:724-730`) [docs]. Make it read-only with `excludedTools: ["edit","write"]` in stage options (stage options forward to `createAgentSession`, `wiring.ts:403-404`) [code, inferred applicability].
3. **Model:** a different model than the writer. Your override sets every role to `opus`, so this collapses to same-model verification; say so in the verdict [inferred].
4. **Brief override:** the stage gets the poteto-mode mandate (section 2), so the prompt must say "verification only, do not edit, return the verdict" [inferred].
5. **Output:** a schema-backed stage (`ctx.stage(..., { schema })` + `structured_output`, `authoring.md:253,682`) with `{ verdict: PASS|PASS+NOTES|FAIL, headSha, baseSha, baseBranch, patchId, evidence }` (shipping vocabulary, `shipping.md:7`) [docs].
6. **Recording, in workflow code via `ctx.tool` (checkpointed side effects, `authoring.md:256`):**
   - `git diff <base>..<head> | git patch-id --stable` for the patch key (`shipping.md:7,9`).
   - If a PR exists: `ORCH_STORE=<store> bun <pstack>/skills/poteto-mode/scripts/orch/orch.ts ledger record ...` with the orchestrate vocabulary (`live-ui-verified | unit-test-verified | type-check-only | verifier-blocked | verifier-failed`). The ledger requires a PR number (`scripts/orch/store.ts:1685`, prior note), so pre-PR verdicts go to the harness's own store keyed by head SHA plus patch-id.
   - Before landing, recompare patch-id at the verdict SHA vs current head; a new head SHA voids the row (`orchestrate.md:92`; `shipping.md:9`).
7. **Writer stage brief:** tell the poteto-mode worker that independent verification is the next stage, so it stops at verify-ready instead of spawning its own verifier or writing `BLOCKED: independent review` (`SKILL.md:109`) [inferred].

## 6. Bottom line: pstack inside an Atomic workflow stage

**Works natively (code-level match, not live-tested on Atomic):**
- Package install via `atomic install <clone>`; skills and extension load (manifest `pi` fallback, import aliases).
- Extension API calls and child CLI flags all exist in Atomic.
- Routing mandate injected per agent start, including in stages.
- `agent`/`send_message`/`list_agents`/`stop_agent` with pstack agent types, model, effort, worktree isolation, up to 3 layers, independent of Atomic's one-level `subagent` limit.
- Stage settle waits for pstack background agents (print mode).
- `orch`, `resume.mjs`, `watch-pr`, `log.sh`, `check-playbooks.mjs` through `bash` (needs `bun`, `node`, `gh`).

**Needs a small adapter:**
- `PI_CODING_AGENT_DIR=$HOME/.atomic/agent` in the Atomic process env.
- Copy the override sheet to `~/.atomic/agent/pstack-models.md`; add `pi ask tool: off` (keeps Atomic's stage HIL ask tool); add `pi models:` lines if `anthropic/claude-opus-5-5` is not in Atomic's catalog or auth is via another provider.
- Worker brief: full-autonomy grant, `todo.md` path, "verification is the next stage", no `/loop`.
- Verifier stage as in section 5, plus harness-side store for pre-PR verdicts.
- Keep `localWorkers` pools off for these runs, or patch pstack's `piInvocation`.
- Live smoke test: one stage that spawns a background `pstack:poteto-agent` and reports; the equivalence tests (`PS/tests/pi/live.test.mjs`) can be pointed at the `atomic` binary as a start.

**Does not work or does not apply:**
- Claude Code hook scripts, PreToolUse approvals, Claude transcript readers, `.claude/skills` discovery, Claude bundled skills.
- `/loop`, `schedule_wakeup`, and wait-driven playbooks (autonomous-run, babysit `drive`, orchestrate liveness) inside one stage; the workflow must own waiting.
- pstack `ask_user_question` in stages (print mode errors); use Atomic's built-in.
- Atomic durability/admission over pstack's child processes: they are outside the journal and graph.
- Model diversity for verifier panels under the all-`opus` override.
