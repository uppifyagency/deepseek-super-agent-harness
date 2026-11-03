# Architect arena task: Super-Agent-Harness core types

## Artifact
One candidate design package in TypeScript: usage sketch first (README-style plus 2-3 real call
sites), then the type sketch (`.ts` files with `throw new Error("not implemented")` bodies and
`// TODO` pseudocode), a module map, and a one-page rationale shaped per
`~/src/pstack-claude/plugins/pstack/skills/architect/references/rationale-template.md`
(leave "Synthesis decision" empty). Read the runner prompt first:
`~/src/pstack-claude/plugins/pstack/skills/architect/references/runner-prompt.md`
and screen your design against
`~/src/pstack-claude/plugins/pstack/skills/architect/references/design-red-flags.md`.

## Goal
A "super agent" service: always on, listens to event sources (GitHub first: issues, PR, CI,
review comments; IM later), decides whether it is authorized to work, runs the work durably in
an isolated worker, verifies it before saying "done", replies in the channel where the person
wrote. Human attention is the only scarce resource.

Built from three parts:
- dsh-superagent (TypeScript, MIT): port the SERVICE layer (sources, Trigger/Thread/subscription,
  two-stage Eval, Mandate + Policy, accept mode off/observe/auto, effects queue / outbox, panel API).
  Do NOT port its execution layer (DSH/Cordis host, DshExecutor, sessions).
- Atomic 0.9.63 (TypeScript, MIT core; AGPL transitive dep via mupdf, under review): the durable
  execution engine. In-process `run()` from Node >= 22.19, SQLite journal.
- pstack: the method inside each worker session (Claude Code plugin). Reachable only via
  `claude -p` spawned from a step, or SKILL.md loaded natively by Atomic's own agent.

## Core types to shape
At minimum: Trigger, Thread (and how subscription works), Ticket, Mandate (and Policy), Run
(the engine-side execution of a Ticket), the worker outcome (done/blocked-on-human/failed with
evidence), human gates, outbound replies/effects. Decide what else is a first-class type
(Environment? Eval? Attention?) and what is derived.

## Grounding (read all before sketching)
- `<sessione>/scratchpad/ground-dsh.md`
  (dsh service layer, real types with file:line, 17 traps)
- `.../scratchpad/ground-atomic.md` (Atomic 0.9.63 engine, embedding gaps, statuses, budget)
- `.../scratchpad/ground-pstack.md` (what pstack needs/gives inside an unattended worker)
- `riferimenti/dsh-superagent/diagrammi/README.md`
  plus the 9 PNGs next to it (author's architecture intent: two-stage filter, subscription
  pass-through, async ReAct, inline & spill references, stateless loop + environment daemons, watchdog)
- `riferimenti/dsh-superagent/articolo/articolo.md`
  The authors' full article (DeepSeek, 01/11/2026). READ IT IN FULL: it is the design intent.
  Points that matter for types: Router never executes and can run without Bash; Triggers that
  arrive during a Router turn queue and are injected as one batch; subscriptions are many-to-many,
  a Worker can unsubscribe or hand an event back to the Router; Workers never talk to humans,
  only the Router replies; speculative execution ("silently reproduce and fix": deliver only if
  confirmed, otherwise stay silent and discard); async start()/stop() with results delivered as
  new events; Inline & Spill + Chain of Recall over a reference graph of ids; per-channel reply
  norms (IM: 100-word cap, GitHub: structured); compute / state / environment separated, endpoint
  daemons may be offline and tasks wait for them; an external Watchdog session judges liveness
  AND progress/drift; credentials must be usable without entering model context.
- `mappa-dsh-pstack-atomic.md`
- Source if you need to check something: dsh at
  `riferimenti/dsh-superagent/repo/src`,
  Atomic at `~/src/ext/atomic-0.9.63`, pstack at `~/src/pstack-claude/plugins/pstack`.

## Hard facts the design must respect (from grounding)
- Atomic 0.9.63: no RPC command to start a workflow or answer a gate; crash resume public only
  via `session.workflows.resume(runId)`; budget stop is `status: "running"` +
  `failure.disposition: "active_blocked"` + `result.status: "budget_exceeded"`, resumable;
  `needs_human` is only an output value; stages run Atomic's own agent, Claude Code hooks are not
  supported; tools are at-least-once; workflow body re-runs from top on resume with cached steps.
- dsh: subscription is not a type (ticket ids on Thread); ticket stage is derived; Mandate is
  revalidated only on resume/attach of ended tickets; observe turns accept into ignore+would_accept;
  several ids include timestamps (not replay-stable); stopping a worker is not durable.
- pstack: "done" is a verdict by an agent that did not write the code, keyed by PR+SHA in
  `ledger.tsv`; pause-always actions (force-push, deploy, deletion, customer messages) are prompt
  instructions only, the host must enforce them; pstack has no budget.

## Constraints on the output
- Write ONLY inside your own output directory (given below). Do not touch the repos.
- Prose in Italian or English, but never use the em dash character.
- Keep the type sketch under ~600 lines total. Prefer fewer, deeper modules.
- End with a short list: which design directions you considered and rejected.
