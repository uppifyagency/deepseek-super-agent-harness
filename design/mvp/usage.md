# Harness MVP, candidate 2: usage (caller's view, written before the types)

Direction: **a daemon that owns the service and embeds Atomic.** One Node process under launchd.
It owns the content-addressed event log, the GitHub poller and filter, the outbox, the attention
page/CLI and the run lifecycle. It embeds Atomic 0.9.63 in-process through `createAgentSession`
twice: an **engine session** that owns every ticket run and never gets an LLM turn, and a
**router session** that is the only LLM the daemon talks to and has no bash, no edit, no
`workflow` tool. Atomic owns execution, budgets and run durability. The daemon owns everything a
human or GitHub can see.

## README

### Install once

```sh
# 1. code + deps (Node 26 strips TS types natively; no bun, no build step)
git clone <harness> ~/src/harness && cd ~/src/harness && npm i      # pins @bastani/atomic@0.9.63

# 2. Atomic auth + pstack as a Pi package inside Atomic (ground-pstack-on-atomic.md section 6)
atomic                     # then /login anthropic once (billed per token as extra usage, providers.md:143)
atomic install ~/src/pstack-claude
cp ~/.claude/pstack-models.md ~/.atomic/agent/pstack-models.md
echo 'pi ask tool: off' >> ~/.atomic/agent/pstack-models.md   # keep Atomic's ask_user_question for gates

# 3. the harness home, the repos it may work on, and the launchd agents
npx harness init --repo <utente>/<altro-repo> --repo <utente>/sketch
#   writes ~/.harness/{config.json, log.sqlite, .atomic/workflows/harness-ticket.ts}
#   writes ~/Library/LaunchAgents/it.delera.harness.plist          (KeepAlive, env PI_CODING_AGENT_DIR)
#   writes ~/Library/LaunchAgents/it.delera.harness-watchdog.plist (StartInterval 120)
#   policy starts in mode "observe": nothing runs, the attention page lists what it WOULD accept
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/it.delera.harness.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/it.delera.harness-watchdog.plist
```

### Living with it

```sh
harness                    # = harness attention: what needs Vlad, empty when nothing does
#  GATE  t:3f9a  <altro-repo>#41  irreversible  "worker wants: git push --force-with-lease origin fix/41"
#  GATE  t:77c0  sketch#12      budget        "spent $4.80 of $5. raise to $10?"
#  WOULD t:-     <altro-repo>#44  observe       "accept: 'Fix CSV export encoding' (mention by <utente>)"
harness answer t:3f9a no "rebase instead, no force push"
harness answer t:77c0 yes
harness tickets            # open tickets with stage: working | waiting-human | verifying | idle
harness recall t:3f9a      # Chain of Recall from any id: card + next-hop ids
harness stop t:3f9a
harness policy auto        # after a week of observe looks right
open http://127.0.0.1:4777 # same attention list as a page, with answer buttons
```

Day to day Vlad writes on GitHub. `@vlad-harness fix the CSV export` on an issue of a listed repo
becomes a ticket; the router acknowledges in the issue; a worker works in a git worktree with
pstack; a fresh verifier stage judges; the daemon pushes and opens the PR; the router posts the
result in the issue. A review comment on that PR goes straight to the running worker (no LLM
turn) or starts the next attempt that forks the previous worker session.

## Call site 1: the daemon composition (daemon.ts main)

```ts
const log = openLog('~/.harness/log.sqlite')
const harness = openHarness(log, config)                  // pure rules over the log, no I/O
const engine = await openEngine({ home: '~/.harness', host: harness.engineHost() })
const router = await openRouter(harness.routerPort(), { home: "~/.harness" })
await engine.recover(harness.liveRuns())                  // the ONE resume path (resumeInFlight: 'never')
runLoops({ harness, engine, router, github: githubSource(config.repos, ghOpts) }); serveAttention(harness, 4777)
```

## Call site 2: the seam, as the daemon uses it (effects loop)

```ts
for (const intent of harness.pending()) {                 // a fold of the log, not a queue
  switch (intent.kind) {
    case 'run':   await engine.start(intent.run, intent.spec); break   // idempotent by RunKey
    case 'stop':  await engine.stop(intent.run, intent.reason); break  // re-issued until run.ended
    case 'reply': harness.settle(intent.id, await github.send(intent.issue, intent.text, intent.id)); break
  }
}
// Everything the engine learns comes back through EngineHost:
//   host.report(run, { kind: 'bound' | 'progress' | 'delivered' | 'ended' })
//   host.ask(gateAsk) -> Promise<answer>      (Atomic HostInput, durable by GateId)
//   host.follow(ticket) -> AsyncIterable      (follow-ups the daemon routed, steered into the live worker)
```

## Call site 3: the router session's tools (router.ts)

```ts
// Woken by the daemon with a batch of cards; never by Atomic. Its tools only append decisions.
tool('decide', ({ eval, decision }) => port.decide(eval, decision))
//   decision: accept{title,scope,silent?} | route{ticket} | answer{gate,text} | stop{ticket} | ignore{reason}
tool('reply',  ({ ticket, purpose, text }) => port.reply(ticket, purpose, text))  // GitHub norms checked here
tool('recall', ({ id }) => port.recall(id))
```

## Call site 4: the ticket workflow reaching the daemon (ticket.workflow.ts, inside Atomic)

```ts
const { spec, brief } = await ctx.tool('spec', { runKey }, () => bridge().spec(runKey))
await ctx.stage('work', { gitWorktreeDir, forkFromSessionId: spec.forkFrom }, async (s) => {
  const steering = pipe(bridge().follow(spec.ticket, signal), (i) => s.steer(i.text).then(() => i))
  return s.prompt(brief)                                   // pstack poteto-mode inside
})
```
