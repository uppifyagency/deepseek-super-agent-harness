# harness: usage (written before the types)

Candidate 3. Direction: no long-lived router session. Every LLM thing is a short Atomic workflow
run; continuity lives in one SQLite store, never in an LLM context.

## README

`harness` is one Node process (the **supervisor**) under launchd, plus a **watchdog** job that
launchd starts every 2 minutes. The supervisor owns `~/.harness/harness.sqlite` (the store) and
hosts Atomic in-process through the SDK (`run()` from `@bastani/atomic/workflows`,
`workflows/src/runs/foreground/sdk-run.ts:16`). It never talks to a model itself. It does four
things in a loop:

1. **Poll** GitHub for the repos in `~/.harness/config.json` and turn every new issue, comment,
   review and CI result into a `Trigger` (code filter first: repo listed, author, bot, mention).
2. **Route by code** what it can: a trigger on a thread that an open ticket owns goes straight to
   that ticket (pass-through). Everything else waits in the store as *pending*.
3. **Start runs.** When something is pending and no router run is in flight, start one
   `router-batch` run with all of it. When the store holds a runnable attempt and a slot is free,
   start one `ticket-attempt` run. Both are plain Atomic workflow runs with budgets.
4. **Consume typed outputs.** A finished run returns typed outputs (`RunResult.result`). The
   supervisor applies them in one transaction (decisions, tickets, gates, reply intents) and
   drains the outbox (GitHub comments) afterwards.

Triggers that arrive while a router run is thinking simply wait for the next batch: that is the
article's batching (2.1), for free. A ticket result is written to the store and shows up in the
next router batch as a `result` card: that is async ReAct (4.1), for free.

### Install and start (once)

```sh
cd ~/src/harness && npm i
atomic install ~/src/pstack-claude                      # pstack as a Pi package
atomic install ./guard                                  # the tool_call guard extension
cp ~/.claude/pstack-models.md ~/.atomic/agent/pstack-models.md
echo 'pi ask tool: off' >> ~/.atomic/agent/pstack-models.md
security add-generic-password -s harness-github -a vlad -w "$(gh auth token)"   # token for HOST steps only
harness init --repo uppify/<altro-repo> --repo vlad/notes-site      # writes config, mode=observe
harness launchd install                                 # supervisor (KeepAlive) + watchdog (StartInterval 120)
```

The supervisor plist sets `PI_CODING_AGENT_DIR=$HOME/.atomic/agent`, `GH_CONFIG_DIR=~/.harness/gh-empty`,
`GIT_CONFIG_GLOBAL=~/.harness/gitconfig` (no credential helper), and unsets `SSH_AUTH_SOCK`.
Stage sessions run in this process and inherit its env, so a worker's `gh` and `git push` find
no credentials. Only host steps (poll, publish, reply) read the Keychain item and pass it to one
child process as `GH_TOKEN`.

### Living with it

- Day 1-7: `mode=observe`. Explicit requests (`@harness` in a comment, or label `agent`, from
  Vlad) run. Everything the router *would* have taken on its own is listed in `harness status`
  under "would accept". Vlad checks whether those are right.
- Then `harness mode auto`. Inferred work runs too; "silently reproduce and fix" runs as
  `visibility: silent` tickets that only speak if verification passes.
- Attention: a macOS notification when a gate opens. Vlad answers either on GitHub (a reply on
  the issue/PR goes through pass-through and becomes the answer) or with `harness answer`.

```sh
harness status            # open tickets, live runs, budgets spent, would-accept list, last watchdog verdicts
harness attention         # only the gates waiting on Vlad; empty means nothing to do
harness answer g_7f3a "use the existing date util, do not add dayjs"
harness stop t_19c2       # durable stop: intent row, re-issued until the run ends
harness recall t_19c2     # the same card the router sees, with next-hop ids
harness ask "is anything touching the invoice PDF this week?"   # a local trigger; reply prints when the next batch runs
harness mode observe|auto|off
```

## Call site 1: the supervisor tick (src/supervisor.ts)

```ts
for (const t of await github.poll(store.cursor('github'))) {
  const r = store.intake(t)                    // dedupe by content id, code filter, pass-through
  if (r.kind === 'passed-through' && r.live) runs.steerLive(r.attempt, r.card)   // no LLM turn needed
}
const batch = store.nextRouterBatch()          // null if nothing pending or a router run is live
if (batch) runs.start({ kind: 'router-batch', batch })
for (const a of store.runnableAttempts(slots.free())) runs.start({ kind: 'ticket-attempt', attempt: a })
```

## Call site 2: a run ends (src/supervisor.ts, the runs.onSettled handler)

```ts
runs.onSettled((ended: RunEnded) => {
  store.applyRunEnded(ended)   // one txn: router decisions -> tickets/gates/replies, or attempt outcome -> ticket
  outbox.kick()                // replies leave only after commit, idempotent by intent id
})
```

## Call site 3: what the router stage sees and returns (src/runs.ts, inside `router-batch`)

```ts
const out = await ctx.stage('route', {
  schema: RouterOutputSchema, context: 'fresh', noTools: 'builtin', customTools: [recallTool],
}).prompt(ctx.inputs.pack)            // pack = cards: pending triggers, open tickets, results, notes
return { decisions: out.decisions, replies: out.replies, notes: out.notes }
// out.decisions[i]: { trigger, kind:'accept', title, scope, visibility } | { kind:'route', ticket }
//                 | { kind:'ignore', reason } | { kind:'stop', ticket }
```
