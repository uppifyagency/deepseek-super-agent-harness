# pstack inside an unattended worker session: what it needs, what it gives

Source root: `~/src/pstack-claude` (version 0.9.117, `plugins/pstack/.claude-plugin/plugin.json`). Paths below are relative to `~/src/pstack-claude/plugins/pstack/` unless they start with `docs/` (relative to the repo root). Everything was read in this session unless labelled **inferred** or **not verified**.

Goal of this note: the harness service (Ticket in, Atomic durable run, worker session in its own worktree) needs to know what pstack expects from its host and which pstack artifacts it can read back to decide done, blocked on a human, or failed.

## Overview

pstack is Markdown doctrine plus a few local CLIs. It is not a runtime, has no server and no telemetry (`README.md:17`). The only automatic trigger is a SessionStart hook that injects a short routing mandate. Everything else (playbooks, gates, ledger, reviewer rule) is instructions the model follows, plus three CLIs that write plain files: `orch` (TSV/Markdown/JSON store), `resume.mjs` (JSON checkpoint), and `watch-pr` (NDJSON verdicts with exit codes). A decision trail TSV comes from `show-me-your-work`.

Consequence for the host: pstack produces evidence, it does not enforce policy. "Always pause" for irreversible actions is prose on Claude Code. If the harness needs a hard stop, the harness must enforce it.

## Key concepts

- **Routing mandate.** Injected text that sends multi-file, design, or unknown-cause work to `pstack:poteto-mode` (`hooks/session-start-context.md:4-12`).
- **Playbook.** A numbered procedure copied verbatim into the todolist; skipped steps stay as `skip: <reason>` (`skills/poteto-mode/SKILL.md:131`).
- **Predicate.** The checkable exit condition an autonomous run drives to (`skills/poteto-mode/playbooks/autonomous-run.md:5`).
- **Verdict.** A verification result tied to a revision. Two vocabularies exist. Orchestrate's ledger (`live-ui-verified | unit-test-verified | type-check-only | verifier-blocked | verifier-failed`, keyed by PR plus head SHA) and Shipping's per-PR `PASS | PASS+NOTES | FAIL` with head SHA, base SHA and `git patch-id`.
- **Gate.** A parked human decision with a default (`gates.md`, Orchestrate only).
- **Store.** `~/.claude/orchestrate/<project-slug>/`, outside the repo and the session (`skills/poteto-mode/playbooks/orchestrate.md:25`).

## 1. Loading, runtimes, headless

### How it loads

1. **Plugin.** Claude Code installs it from a marketplace (`docs/reference.md:63`, needs Claude Code 2.1.292 or later). Skills register as `pstack:<name>`; agents as `pstack:poteto-agent`, `pstack:comment-sicko`, and the two thermo review subagents (`agents/`).
2. **SessionStart hook.** `hooks/hooks.json:3-11` runs `session-start.sh claude` on `startup|resume|clear|compact`. The script reads the model sheet (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/pstack-models.md`, `hooks/session-start.sh:8`), exits silently if the sheet says `session hook: off` (`:42-44`), otherwise prints `hooks/session-start-context.md` (`:68`).
3. **Mandate text.** Invoke `pstack:poteto-mode` when the task touches more than one file or a shared signature, involves a design choice, or is a bug of unknown cause or a perf issue (`hooks/session-start-context.md:4-10`). Direct entry to `tdd`, `architect`, `how`, `why`, `arena`, `interrogate` when intent is specific (`:12`). User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence (`:14`).
4. **Skills.** poteto-mode then routes to a playbook under `skills/poteto-mode/playbooks/` (`SKILL.md:129-157`). Repos can add `.agents/playbooks/*.md` that extend bundled ones; `check-playbooks.mjs` validates anchors (`SKILL.md:159`).
5. **Model sheet.** Per-role models and `default effort` come from `pstack-models.md`, defaults from `models.json` (`SKILL.md:161-174`).

### Runtimes

From `docs/reference.md:59-72`:

| Runtime | Mechanism | Status in docs |
|---|---|---|
| Claude Code | marketplace plugin plus SessionStart hook | native |
| Codex | native plugin, hook must be trusted via `/hooks` (`hooks/codex-hooks.json`, `docs/reference.md:64,112`) | supported, mapping `references/codex-tools.md` |
| GitHub Copilot (CLI and app) | plugin, SessionStart emits JSON `additionalContext`, plus a PreToolUse hook (`hooks/copilot-hooks.json:14-25`) | smoke-tested on CLI (`docs/reference.md:66`) |
| Muse | native bundle, `muse plugins approve pstack` needed before hooks run (`docs/reference.md:67,168`) | supported |
| Pi | Pi package plus extension that supplies subagent, question, wake-up tools (`docs/reference.md:65,143-148`) | supported, equivalence table |
| opencode | shared skills dir, no hook | verified 2.0.30 (`docs/reference.md:69`) |
| Prime Agent, Gemini CLI | shared skills dir | discovery documented, not live-tested (`docs/reference.md:68,70,72`) |

Skills-only installs get no hook; poteto-mode must be requested explicitly (`docs/reference.md:86`).

### Headless (claude -p, Agent SDK) with no human

pstack has no headless documentation. A grep for `headless`, `claude -p`, `non-interactive`, `agent sdk`, `unattended` across `plugins/` and `docs/` finds only prose uses of "unattended" (show-me-your-work, hillclimb) and one Copilot caveat. What the source does say:

- The doctrine is built for an absent human. `principle-never-block-on-the-human/SKILL.md:9-15` says proceed on reversible work, confirm irreversible ones. poteto-mode tells the agent to settle empirical forks by prototype instead of asking (`SKILL.md:24`), and under a full-autonomy grant to decide, apply a default, and report instead of asking (`SKILL.md:24`, `:93`).
- Autonomous run and Orchestrate assume no human turns and a `/loop` wake mechanism (`autonomous-run.md:6`, `orchestrate.md:74`).
- Copilot caveat (measured by the authors): on Copilot CLI 1.0.92 with a cached computer-use experiment, `-p` sessions load no plugin skills (`docs/reference.md:156`).

**Inferred, not verified this session.** Claude Code runs SessionStart hooks in `-p` mode, and the Agent SDK can load a local plugin, so the mandate should load. Three things will degrade without a human:

1. `AskUserQuestion` has nobody to answer. The worker brief must contain an explicit full-autonomy grant so poteto-mode takes the "apply a default and report" branch (`SKILL.md:24`).
2. `/loop` and wake-ups (`autonomous-run.md:6`, Babysit `drive`) need a session that stays alive between turns. In a one-shot `-p` run they do not exist, so the host must own polling (Atomic is the natural place).
3. Background subagents (`SKILL.md:101`, `run_in_background: true`) must finish before the process exits. A one-shot run that ends early orphans them (`SKILL.md:107` warns that `completed` is not an exit).

Treat headless as "works with a brief that grants autonomy and a host that owns waiting"; verify with a pilot run before relying on it.

## 2. Machine-readable outputs

### 2.1 Orchestrate store (`orch` CLI)

Only the Orchestrate playbook creates it (`orchestrate.md:23-34`). The CLI is `bun skills/poteto-mode/scripts/orch/orch.ts`, store path from `--store <dir>` or `ORCH_STORE` (`scripts/orch/orch.ts:208,265-266`), `--json` for full rows (`:269`). One writer per file; a lock file `.orch.lock` that is replaced when its holder pid is gone (`scripts/orch/store.ts:19-20`, `orchestrate.md:104`).

Files (`orchestrate.md:27-34`): `preferences.md` (standing orders), `overview.md`, `units.tsv`, `frontier.json`, `ledger.tsv`, `inbox/`, `gates.md`, `decisions.tsv`, `status.md` (derived).

**`units.tsv`** header (`scripts/orch/store.ts:17`):
```
id	track	state	branch	pr	sha	brief
```
`state` is a free string (`store.ts:33`); Orchestrate's drain classes are `landed, needs-verify, failed, zombie, noise` (`orchestrate.md:76`). The host should fix its own state vocabulary.

**`ledger.tsv`** header (`store.ts:18`):
```
pr	sha	verdict	evidence	verifier	ts
```
Verdict is a closed union (`store.ts:23-28`); an unknown value makes reads throw (`store.ts:611`). Keyed by PR number plus SHA: `record` replaces the row with the same `(pr, sha)` and appends otherwise (`store.ts:1695-1703`). `orch ledger check --pr N --sha S` prints the row or `NOT-VERIFIED` (JSON `{pr, sha, verdict:"NOT-VERIFIED"}`) with exit 2 (`store.ts:1714-1718`, `orch.ts:556-563`). Other errors exit 1 (`orch.ts:565-569`). Semantics (`orchestrate.md:92`): CI green is an input, not a verdict; `verifier-blocked` is not a pass; `verifier-failed` gets a fix unit; a new head SHA voids the row; a verifier overrides a worker's self-report on the same key. The ledger requires a PR number (`store.ts:1685`), so pre-PR work cannot be recorded there.

**`gates.md`** (`store.ts:695-710`, parser `:712-766`):
```
# Gates

## <id>

- Status: open
- Question: <text>
- Options: <text>
- Default: <text>
```
A resolved gate has `Status: resolved` and `- Answer: <text>`. CLI: `orch gate park <id>`, `gate list` (open gates), `gate resolve <id>` (`orch.ts:438-470`). Duplicate ids or bad status throw (`store.ts:759-763`).

**`inbox/`** one file per completion pointer, a single TSV line `ts agent unit status report` (`store.ts:647-693`, write at `:1730-1752`). `orch inbox drain` atomically renames the dir (`store.ts:1754-1766`).

**`frontier.json`** `{generation, prs:[{pr, branches, sha, state: OPEN|MERGED|CLOSED}], lowestUnmerged}` (`store.ts:81-94`).

**`status.md`** generated by `orch status` (`orch.ts:517`), tables for units, ledger, frontier, gates, and a trailing machine line `<!-- orch-summary {"unitStates":...,"ledgerVerdicts":...,"frontierGeneration":N,"openGateIds":[...]} -->` (`store.ts:1000-1059`, summary type `:103-108`). That comment is the cheapest single read for a host.

### 2.2 Decision trail (show-me-your-work)

TSV, header `ts	phase	decision	why	evidence	result` (`skills/show-me-your-work/references/decision-log-template.tsv:1`, `SKILL.md:18-25`). Evidence is a pointer (SHA, PR, `file:line`, path), result is a short predicate state such as `tests green`, `INCONCLUSIVE`, `open` (`SKILL.md:24-25`). Writer `scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>`: stamps UTC ts, strips tabs and newlines, prefixes cells starting with `= + - @ "` with `'` (`scripts/log.sh:3,21-40`). Location `decisions.tsv` in the work dir or `.audit/<task-slug>.tsv`, not committed by default (`SKILL.md:49-51`). Append-only; corrections are superseding rows (`SKILL.md:55,66`). Each new run starts with a `phase=start` row (`SKILL.md:45`). The final reply ends with an "Attention" section headed `reviewed by <model>` from a cross-model trail review (`SKILL.md:68-77`). The `result` column is free text, so a host should parse it only for the conventions it imposes in the brief.

### 2.3 Todolist

The playbook steps go verbatim into `TaskCreate`/`TaskUpdate` or `TodoWrite`, or an uncommitted `todo.md` (or `.audit/<task-slug>.todo.md`) when no task tool exists (`skills/poteto-mode/SKILL.md:14`). The literal marker `BLOCKED: independent review` lands here when no reviewer could run (`SKILL.md:109`). On headless Claude Code, **inferred**, the task tools may be absent, so `todo.md` becomes the readable artifact; set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (`SKILL.md:14`) or mandate the file in the brief.

### 2.4 Resume checkpoints (`resume.mjs`)

Store under the Git common dir: `<git-common-dir>/pstack/resume/`, shared by all worktrees and excluded from commits (`references/resume-storage.md:3-5`, `scripts/resume.mjs:99`). Commands `begin | publish | read --project <worktree>` (`resume.mjs:95-96`). All output is one JSON line:

- `{"kind":"directory","directory":...}` from `begin` (`resume.mjs:115`).
- `{"kind":"checkpoint","checkpoint":{schemaVersion:1, gitDir, worktree, branch, createdAt, note:{path,sha256}, artifacts:[{path,sha256}]}}` from `publish` and `read` (`resume.mjs:82,122-131`, hashing `:33`).
- `{"kind":"missing"}` exit 2; `{"kind":"unavailable","detail":...}` exit 1 (`resume.mjs:105-106,135-136`).

`latest.json` is replaced atomically; last publish wins; it is "a locator, not a task scheduler or execution lock" (`resume-storage.md:14`). The note itself (`resume.md`) is prose: intent, verified progress, state, next steps (`playbooks/pause-safely.md:8`). Pause safely runs only on explicit request (`pause-safely.md:3`), so a host that wants a checkpoint on budget expiry must ask for it in the brief.

### 2.5 PR watcher (`watch-pr`)

`skills/poteto-mode/scripts/watch-pr/watch-pr` (bun). JSON by default, NDJSON while polling, `--pretty` for humans (`scripts/watch-pr/cli.ts:100,152`). Modes `--pr`, `--stack`, `--queued-stack --stack-prs` (`cli.ts:104-121`); `--timeout`, `--status-only` (exit 0 means the table was read, not ready) (`cli.ts:134-150`). Verdict kinds and exit codes (`scripts/watch-pr/types.ts:332-415`):

| kind | exit | meaning |
|---|---|---|
| `READY` / `COMPLETE` / `STATUS` | 0 | single or stack ready, queued stack merged, status read |
| `BLOCKER` merge-conflicts | 2 | |
| `BLOCKER` review-threads | 3 | |
| `BLOCKER` failing-checks | 4 | |
| `TIMEOUT` | 5 | |
| `BLOCKER` merge-gate | 6 | e.g. approval required |
| `BLOCKER` status-query | 7 | unknown state |
| usage error | 64 | `cli.ts:212` |

Progress lines (`QUEUE`, `STATUS`, `WAITING`, `ADVANCE`, `RETRY`) are non-terminal (`types.ts:332-351`). The watcher holds no state on disk; it reads GitHub each poll. This is the one pstack output that already has a stable exit-code contract a host can switch on.

## 3. "Needs a human"

### Where pstack defines it

- **Always-pause list**: force-push to shared branches, deploys, data deletion, customer messages (`skills/poteto-mode/SKILL.md:91`). Same in `principle-never-block-on-the-human/SKILL.md:13`.
- **Just do it**: any MCP tool, reversible work, external actions such as team chat, ticket updates, evals (`SKILL.md:89`).
- **Autonomy levels** are session words, not config. Default: just do it plus always-pause. Override phrases ("don't stop", "going to bed", "run until done", "be fully autonomous") mean keep going (`SKILL.md:93`). A full-autonomy grant: decide covered calls, apply a default with explanation for operator-only calls; operator-named gates and the always-pause list still need the operator (`SKILL.md:24`). Autopilot-full scopes the grant to the queue's items and the operator always clicks merge (`playbooks/autopilot-full.md:5,9,21`).
- **Escalation set** in Orchestrate: irreversible actions (force-push to shared branches, deploys, deletions, closing someone else's PR), product or preference calls no experiment settles, a standing order that contradicts reality, a dead end that survived a replan. Each is parked as a `gates.md` entry first and work routes around it (`orchestrate.md:108`). Never escalated: rebases, retries, CI flakes, thread triage, "should I keep going" (`orchestrate.md:110`).
- **Autonomous run**: surface only irreversible actions, real product calls, or a real dead end; never relax the predicate (`autonomous-run.md:9,11`).
- **Shipping** needs the user's landing authority (`playbooks/shipping.md:5`); Babysit `drive` stops at merge-ready, landing is separate (`playbooks/babysit.md:23`).

### Where a host can intercept

1. **Tool layer (only hard enforcement).** pstack ships no PreToolUse hook for Claude Code; the only one is Copilot's, and it checks reads, script contracts and agent models, not irreversible actions (`hooks/pre-tool-use.sh:2-5`, `hooks/copilot-hooks.json:14-25`). The host must add its own PreToolUse hook or SDK permission callback that denies `git push --force*`, `gh pr merge`, deploy CLIs, destructive `rm`/DB commands, and outbound messaging tools, and turns each denial into a "needs human" event. **Inferred** design, not a pstack feature.
2. **`gates.md` / `orch gate list --json`.** Machine-readable, has a default answer, but only exists when the worker runs Orchestrate. A host can make it general by setting `ORCH_STORE` and telling the worker in the brief to `orch gate park` any always-pause item.
3. **`BLOCKED: independent review`** in the todolist (`SKILL.md:109`).
4. **watch-pr exit 6 (`merge-gate`)** for approval gates on a PR (`types.ts:375`).
5. **Final reply.** Every playbook ends with a reply that names open gates and decisions (e.g. `orchestrate.md:114`, `autopilot-full.md:31`, `feature.md:21`). It is prose; parse only what the brief requires.

## 4. Verification semantics

- **Done** means verified on the real artifact, not a proxy, self-report, or "it compiles" (`SKILL.md:72`, principle-prove-it-works). Feature step 5: "Inconclusive" or wrong-surface is not a pass (`playbooks/feature.md:13`). Autonomous run: stop only when the predicate is met (`autonomous-run.md:11`). Orchestrate: predicate confirmed on the real artifact and every landed PR has a verdict for its current head SHA (`orchestrate.md:69`). A unit is not done until externalized (branch pushed, ledger row written) (`orchestrate.md:94`).
- **Author cannot judge.** "Only a verdict from an agent that did not write the code counts" (`shipping.md:7`). Never count your own review, passing tests, or CI as the independent verdict (`SKILL.md:109`). Verifier on a different model family from the worker (`orchestrate.md:19`). Autopilot-full: the swarm "never wrote the code" (`autopilot-full.md:5`). Trail review by a different model family; self-review is not a substitute (`show-me-your-work/SKILL.md:70`).
- **Cheap units** may self-verify: when VERIFY is one cheap command, the worker runs it and the coordinator spot-checks receipts (`orchestrate.md:90`). A worker self-report can be overridden by a verifier on the same ledger key (`orchestrate.md:92`).
- **Recording.** Ledger row `(pr, sha, verdict, evidence, verifier, ts)` (Orchestrate); a `PASS | PASS+NOTES | FAIL` comment on the PR with head SHA, base SHA, base branch, and `git patch-id` (Shipping, `shipping.md:7`); patch-id comparison decides whether an old verdict survives a rebase (`shipping.md:9`). If no reviewer can run, the gate stays closed and `BLOCKED: independent review` is recorded (`SKILL.md:109`).
- **Gap.** In a single-worker Feature or Bug-fix run there is no SHA-keyed file; the evidence is the PR `## Verification` section (`playbooks/opening-a-pr.md:20`), the trail, and the reply. A host wanting a machine verdict must require one.

**Implication for the harness.** The worker session cannot mark its own work done under pstack's rules. Either the worker spawns an independent reviewer subagent inside its session (allowed, `SKILL.md:105,109`) and records the result, or the host runs a separate verifier session on another model and writes the ledger row itself. Given Vlad's override (everything on `opus`), a "different model family" verifier is not available through pstack's sheet; that weakens independence to "different agent, same model". State that in reports.

## 5. Minimal host contract

### Pass in (brief)

Use Orchestrate's brief shape (`orchestrate.md:40-53`), since it is the one pstack already designed for a worker that "cannot ask you a question" (`orchestrate.md:13`):

```
GOAL         one sentence from the Ticket
SCOPE        writable paths; forbidden paths; the exclusive worktree and branch
CONTEXT      ticket URL, files, upstream reports in full
ACCEPTANCE   checkable criteria, one per line
VERIFY       exact commands or the driver skill path
TIMEBOX      runtime cap; on expiry return partial findings and stop
FORBIDDEN    no merge, no rebase of shared branches, no force-push, no deploy, plus ticket bans
REPORT       status, branch, head SHA, PRs, verdict, what you ran, deviations, follow-ups
STANDING     host's standing orders verbatim
```

Add, for unattended runs:

1. An explicit autonomy grant naming what it covers, so poteto-mode never waits on `AskUserQuestion` (`SKILL.md:24,93`).
2. Store paths: `ORCH_STORE=<run-dir>/orch`, trail at `<run-dir>/decisions.tsv`, todo at `<worktree>/.audit/<run-id>.todo.md`. Keep them outside the worktree if the worktree is deleted on failure, per `orchestrate.md:25`.
3. "Park every always-pause action as `orch gate park` and continue on other work" (`orchestrate.md:108`).
4. "On TIMEBOX expiry, run Pause safely and publish via `resume.mjs`" (`pause-safely.md:8-9`).
5. Budget. pstack has no token or cost budget mechanism; only TIMEBOX and Orchestrate's 70% landing rule (`orchestrate.md:63`). The host must enforce spend.
6. Model sheet. Write `pstack-models.md` for the worker's config dir (Claude Code reads `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, `session-start.sh:8`), or the session falls back to `models.json` defaults.

### Read back

| Signal | Source | Machine form |
|---|---|---|
| Done | ledger row for `(pr, head sha)` with an accepted verdict, written by a non-author | `orch ledger check` exit 0 |
| Not verified | no row for current head | exit 2, `NOT-VERIFIED` |
| Failed | `verifier-failed`, or `units.tsv` state `failed` | TSV |
| Blocked on env | `verifier-blocked` (not a pass, respawn later) | TSV |
| Blocked on human | open entries in `gates.md`; `BLOCKED: independent review`; host PreToolUse denials | `orch gate list --json`, todo file, hook log |
| PR state | `watch-pr` verdict | exit 0/2/3/4/5/6/7 |
| Resumable | `resume.mjs read` | JSON `kind` plus exit 0/1/2 |
| Audit | `decisions.tsv` plus "Attention" section | TSV plus reply text |
| Summary | `status.md` `orch-summary` comment | JSON in HTML comment |

Rule of thumb from pstack itself: "The ledger answers 'was this verified', not memory and not the transcript" (`orchestrate.md:92`). The host should read files and exit codes, never the worker's final prose, for state.

## Gotchas

- `orch ledger` needs a positive integer PR (`store.ts:1685`). Work before a PR exists has no ledger slot; either open the PR early (Autopilot does, `autopilot-full.md:12`) or keep a host-side ledger keyed by SHA.
- `units.tsv` `state` and trail `result` are free text. Fix the vocabulary in STANDING.
- A new head SHA voids a ledger row (`orchestrate.md:92`). A host retry that rebases must re-verify.
- `completed` from the Agent tool does not mean the process exited (`SKILL.md:107`). The host should probe files and `git status`, not agent status. "Transcript mtime is not liveness" (`orchestrate.md:98`).
- User instructions outrank the mandate (`session-start-context.md:14`). A repo CLAUDE.md in the worktree can change routing.
- `resume.mjs` stores under the Git common dir, so all worktrees of one repo share one `latest.json`; concurrent workers overwrite each other's pointer and must keep the `begin` paths (`resume-storage.md:14`).
- The Copilot `-p` skill-loading caveat (`docs/reference.md:156`) shows hooks and skills can silently not load in headless modes. Have the worker's first trail row or first message prove poteto-mode loaded.
- The pstack deepwiki at `riferimenti/pstack/deepwiki/` and the feature map (`riferimenti/pstack/feature-map.md:29-31`, which states pstack is not a runtime or scheduler and its only automatic trigger is SessionStart) agree with the source; claims above cite the source directly.
