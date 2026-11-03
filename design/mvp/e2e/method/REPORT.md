# E2E method and security, Atomic 0.9.63 (02/11/2026)

Run by a subagent, model openai-codex/gpt-5.6-luna-fast, thinking low. Logs, guard extension, SDK
driver and workflow in this folder.

| Spike | Verdict | Evidence |
|---|---|---|
| M1 pstack in Atomic | PARTIAL | Loads without errors, 88 skills incl. poteto-mode, mandate and model sheet injected, `/skill:poteto-mode` expands (OBSERVED). With `pi ask tool: off` Atomic's ask_user_question is active; without it pstack's replaces it; print mode has neither. FAIL: with project-local install (`atomic install -l`) a stage running in a worktree gets no mandate (`mandate=false`). Loading pstack via `--extension` + `--skill` (or loader paths) fixes it |
| M2 guard | PASS via CLI, FAIL as engine.ts is written | `--extension` blocks `git push` with the reason shown, `echo hi` runs, also inside a stage. `createAgentSession({extensionFactories})` is silently ignored: the push in the stage actually ran. Must go through `DefaultResourceLoader` (resource-loader-types.ts:111); then the guard blocks in the stage |
| M3 credentials | FAIL | Empty GH_CONFIG_DIR etc. make `gh auth status` and https ls-remote fail. BUT the worker can read `~/.atomic/agent/auth.json`, inherits a live `GITHUB_PERSONAL_ACCESS_TOKEN` (GitHub `/user` returns 200), and can read the gh token from the login keychain with no prompt (`security ... -w` rc=0) |
| M4 models and auth | PASS | Without login only openai-codex is listed. With a dummy ANTHROPIC_API_KEY, `anthropic/claude-opus-5-5` (1M context) appears. providers.md:143: "Anthropic subscription auth is active for Claude Pro/Max accounts. Third-party harness usage draws from extra usage and is billed per token, not against Claude plan limits." |
| M5 worktrees | PARTIAL | `gitWorktreeDir` outside the repo works: detached HEAD, commit lands there, main untouched, never cleaned. Inside the repo (`.atomic/worktrees/<ticket>`) is rejected ("must be outside the invoking checkout"). `worktree: true` gives its own branch but deletes branch and worktree at the end, leaving only a patch file |

## Corrections
1. Guard via `DefaultResourceLoader`, not `createAgentSession({extensionFactories})`.
2. Worktrees outside the repo (e.g. `~/.harness/worktrees/<ticket>`); publish creates the branch from the detached HEAD; the daemon removes worktrees on close.
3. pstack via `--extension`/`--skill` or loader paths, not `install -l`.
4. `ATOMIC_CODING_AGENT_DIR=~/.atomic/agent` plus a separate `PI_CODING_AGENT_DIR`; no copy into ~/.atomic/agent needed.
5. Strip every `*_TOKEN` env var. A real boundary needs a separate macOS user or a container.
6. `atomic -p "/workflow ..."` exits and kills the stage: the daemon must keep an SDK or rpc session open. Close stdin on every `-p` call or it hangs.
7. `thinking: 'medium'` untested; docs set effort with a `:medium` model suffix.

## Side effects
One killed run landed in the default journal ~/.atomic/workflows/journal.sqlite. `~/.atomic/agent/settings.json` was changed by Vlad's own interactive session (12:01), not by the spikes.

## Found on the machine (by the main session)
`GITHUB_PERSONAL_ACCESS_TOKEN` is exported in plain text in the shell profile and is also set in the launchd environment (`launchctl getenv` present), so every launchd-started process inherits it.
