# Architect arena task: Super-Agent-Harness MVP (Atomic-centered, local, personal)

## Artifact
One candidate MVP design package in TypeScript: usage first (README-style quickstart, how Vlad
starts it and lives with it day to day, plus 2-3 real call sites), then the type sketch (`.ts`
files, `throw new Error("not implemented")` bodies, `// TODO` pseudocode), a module map, a
one-page rationale per
`~/src/pstack-claude/plugins/pstack/skills/architect/references/rationale-template.md`
(leave "Synthesis decision" empty), and an ordered BUILD PLAN of the MVP as small verifiable units
(each unit: what it delivers, how it is proven on the real artifact). Read first:
`~/src/pstack-claude/plugins/pstack/skills/architect/references/runner-prompt.md`
and screen against
`~/src/pstack-claude/plugins/pstack/skills/architect/references/design-red-flags.md`.

## Goal and scope (fixed by Vlad)
A personal super-agent harness for ONE Mac and ONE person (Vlad), local only. It joins:
- **Atomic 0.9.63 as THE execution engine** (Vlad insists: not a thin step runner; use its
  durable workflows, budgets, async run notices, sessions, extensions, tool_call blocking).
- **pstack as the method** inside every worker (as a Pi package loaded by Atomic).
- **The service layer from dsh-superagent** (the initial plan: event sources, Eval, Mandate,
  observe mode, effects queue / outbox, panel), ported in TypeScript, not its DSH execution layer.
- **The DeepSeek super-agent article's insights**: Router that never executes and talks to the
  human; isolated Workers that never talk to humans; two-stage filter (code then LLM); Thread +
  subscription pass-through of follow-ups to the owning worker; async start/stop with results as
  new messages; Inline & Spill + Chain of Recall; per-channel reply norms; external Watchdog that
  judges liveness AND progress; credentials usable without entering model context; speculative
  "silently reproduce and fix".

MVP cut (suggested, argue if you disagree): one machine, 1-3 GitHub repos of Vlad, GitHub as the
only source and reply channel, terminal/TUI (+ optional tiny local page) for gates and attention,
2-3 concurrent workers in git worktrees, an independent verify stage before "done", launchd for
the always-on process and the watchdog. Out of MVP: IM channels, cloud, remote endpoints,
multi-user, `simulate(policy)`. Keep observe mode (cheap and the safest way to turn it on).

## Grounding (read ALL before sketching)
Folder `design/grounding/`:
- `ground-atomic-host.md`  NEW, most important: Atomic as host (extension API, tool_call block,
  async workflow notices, resumeInFlight, auth, skills paths, what Atomic lacks)
- `ground-pstack-on-atomic.md`  NEW: pstack as a Pi package inside Atomic stages, the adapter needed
- `ground-atomic.md`, `ground-dsh.md`, `ground-pstack.md`  earlier overviews
Plus:
- The article: `riferimenti/dsh-superagent/articolo/articolo.md`
- The previous (pre-MVP) synthesized design, Atomic was too thin there but much carries over
  (content-addressed event log, roles in types, IndependentVerdict, durable intents):
  `design/rationale.md` and `design/src/*.ts`
- Sources to check APIs against: Atomic `~/src/ext/atomic-0.9.63`, pstack `~/src/pstack-claude`,
  dsh `riferimenti/dsh-superagent/repo/src`.

## Hard facts (from grounding; cite the grounding file when you rely on more)
- Atomic main session `workflow` tool starts runs in background; on end a notice is delivered
  with triggerTurn + deliverAs "steer" (wakes idle router, queues if busy) but WITHOUT outputs;
  `awaiting_input` runs do NOT wake the router.
- Extensions: `tool_call` hook can block; extension also loads in every workflow stage session.
  `ctx.tool` callbacks bypass the hook. Bash string matching is bypassable: credentials boundary
  still needed.
- `resumeInFlight: "auto"` works headless, BUT runs are skipped if restart is within ~120 s lease,
  and runs stopped by clean shutdown are skipped: harness must call `session.workflows.resume`.
- Budgets per run / child workflow, not per stage. Child workflows nest at most 3 deep.
  Subagent tool one level; pstack's own `agent` tool spawns separate atomic processes (3 levels)
  that Atomic's journal does NOT see; keep worker pools off.
- Atomic has no GitHub source, no web panel/HTTP server, no launchd, no real watchdog.
- Auth: Claude Pro/Max OAuth exists, but Atomic docs say third-party harness use is billed per
  token as extra usage (unverified). Opus id `anthropic/claude-opus-5-5`. Vlad's rule: every
  model role is opus at medium effort.
- pstack in Atomic: needs `PI_CODING_AGENT_DIR=$HOME/.atomic/agent`, model sheet copied there with
  `pi ask tool: off`; Claude Code hooks and `/loop` in stages do not work; verify must be a
  `context: "fresh"` stage without edit tools; pstack ledger needs a PR number.
- Machine (verified 02/11): Node v26.13.0 via nvm (system /usr/local node pending upgrade),
  gh authenticated with repo+workflow scopes, git 2.50, no bun installed.
- No subscription to follow up a running worker without an LLM turn was found (open question 9).

## Constraints on the output
- Write ONLY inside your own output directory (given below). Do not modify repos or install anything.
- Prose in Italian or English; never use the em dash character.
- Type sketch under ~500 lines total; fewer, deeper modules. It is an MVP: be ruthless about scope.
- If you rely on an Atomic API, cite file:line in Atomic source or the grounding file.
- End with: directions considered and rejected, and the 3 biggest risks with the cheapest test for each.
