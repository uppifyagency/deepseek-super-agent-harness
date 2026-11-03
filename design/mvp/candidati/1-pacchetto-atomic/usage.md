# Super-Agent-Harness (candidate 1: the harness is an Atomic package)

One Atomic package, like pstack. Install it next to pstack, run one command, and the Mac has a
long-lived Atomic session that reads Vlad's GitHub and works tickets in the background.

## Quickstart

```sh
git clone ~/src/super-agent-harness && cd ~/src/super-agent-harness
npm link                       # puts `harness` on PATH (node 26 via nvm)
harness install                # LaunchAgents, ~/.harness/policy.json, model sheet, `atomic install` of
                               # this package and of ~/src/pstack-claude
$EDITOR ~/.harness/policy.json # list 1-3 repos; they start in mode "observe"
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/it.delera.harness.plist
```

`~/.harness/policy.json`:

```json
{
  "humans": ["<utente>"],
  "botLogin": "<utente>",
  "repos": {
    "<utente>/<altro-repo>": { "mode": "observe", "path": "~/<altro-repo>", "baseBranch": "main",
                                  "budget": { "maxDurationMs": 5400000, "maxCost": 8 } }
  }
}
```

## Living with it

- **Week 1, observe.** The router reads every new issue and comment and decides, but `open`
  records "would have opened" and starts nothing. `harness observed` lists those decisions.
  When they look right, set the repo to `"auto"`. No restart: the policy is re-read each poll.
- **Normal day.** Vlad writes on GitHub: an issue `@harness the CSV export drops accents`, or a
  comment on an open harness PR. Within a minute the router replies with an ack, a worker runs in
  `~/.harness/wt/<ticket>`, a fresh verifier checks it, and a PR appears with the verdict in its body.
  Vlad merges. The harness never merges.
- **Questions.** A worker that needs Vlad stops at a durable Atomic gate. The router posts the
  question on the issue. Vlad answers in a comment; the router passes it to the gate; the worker
  continues in the same session.
- **Follow-ups.** A new comment on a thread a ticket is working reaches the running worker
  directly (no router turn). The router only gets a one-line note.
- **At the Mac.** `harness attach` opens the same router session in the Atomic TUI. Vlad sees
  the conversation, the BACKGROUND panel with the ticket runs, and answers gates in the TUI.
  Quit the TUI and the daemon takes over again.
- **When things go wrong.** The watchdog (every 5 min) restarts a dead router and tells the
  router about stuck or drifting workers. The router stops them or asks Vlad.

## Call sites

1. The router model, after a `gh-batch` message (this is the whole acting surface):

```ts
harness({ action: 'open', triggers: ['f_9a1c'], title: 'CSV export drops accents',
          brief: 'Repro: export a client named "Niccolò" ...', speculative: false })
// -> "ticket t_3be0 opened, run 5f2e9c1a-... (background). Ack queued on gh:<utente>/<altro-repo>#41"
// in observe mode: "observed: would open 'CSV export drops accents' (mandate: mention by <utente>)"
```

2. The router model, after Atomic's end notice for that run (`deliverAs: "steer"`, no outputs):

```ts
harness({ action: 'status', ticket: 't_3be0' })
// -> run completed; outcome delivered; PR #57; verdict PASS (unit-test-verified, same model: opus);
//    head 1c9e0a7; threads gh:...#41, gh:...#57
harness({ action: 'reply', thread: 'gh:<utente>/<altro-repo>#41', purpose: 'result',
          text: 'PR #57 fixes the encoding; verified by a separate session: 3 tests added, all pass.' })
harness({ action: 'close', ticket: 't_3be0', outcome: 'delivered', why: 'PR #57 open' })
```

3. Workflow code inside the `ticket` run (the only writer of verdicts, the only caller of publish):

```ts
const v = await ctx.task(`verify-${round}`, { cwd: wt, context: 'fresh', model: OPUS,
  schema: VerifyResult, excludedTools: ['edit', 'write'], prompt: verifierBrief(inputs, head) })
await ctx.tool('record-verdict', () => store.append({ kind: 'verdict', by: 'verifier',
  body: independentVerdict({ ...head, ...v.structured, writerSession: w.sessionId!,
                             verifierSession: v.sessionId!, sameModel: true }) }))
```
