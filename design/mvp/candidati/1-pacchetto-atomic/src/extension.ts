// extension.ts: the package's one extension. Atomic instantiates it in EVERY session: the router,
// each ticket stage (atomic-stage-session.ts:100-120, wiring.ts:612-620), pstack child processes
// and the watchdog's print run. What it does depends only on `roleOf`, computed once per session.
//
//   every role : tool_call guard (api-types.ts:190, event-results.ts:17-26), fail-closed
//   router     : GitHub poller + prefilter, batching into one turn, outbox flusher, gate relay,
//                watchdog-notice feed, reconcile loop, heartbeat file, compaction, `harness` tool
//   worker     : pass-through inbox (store -> steer its own session), progress facts at turn_end
//   watchdog   : `harness` tool restricted to status/judge
//
// Atomic API used, with source: sendMessage + triggerTurn/deliverAs (api-types.ts:292-315,
// api-reference.md:578-646); observeWorkflowActivity (context-types.ts:195, workflow-events.ts:35-62);
// executeTool from a tool context (context-types.ts:19-27); session_before_compact compactedText
// (event-results.ts:86-90); orchestrationContext.workflowRunId/StageName (context-types.ts:126-130).

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'  // aliased by Atomic
import { Type } from 'typebox'
import type { Role, RunId } from './domain.js'
import type { Store } from './store.js'

export const HARNESS_HOME = `${process.env.HOME}/.harness`
const POLL_MS = 60_000, RECONCILE_MS = 120_000, HEARTBEAT_MS = 30_000

/**
 * The only place a role is decided. Order matters:
 *  1. stage context  -> 'verify-*' stage name = verifier, any other = worker
 *  2. --harness-role watchdog flag
 *  3. holds ~/.harness/router.lock (pid file written by host.ts or `harness attach`) = router
 *  4. otherwise 'child' (a pstack `agent` subprocess, or Vlad running plain `atomic` elsewhere):
 *     guarded like a worker, starts nothing. So a stray session can never become a second router.
 */
export function roleOf(pi: ExtensionAPI, ctx: ExtensionContext): Role {
  throw new Error('not implemented')
}

export default function harnessExtension(pi: ExtensionAPI): void {
  pi.registerFlag('harness-role', { type: 'string', description: 'watchdog' } as never)
  let role: Role = 'child'
  let store: Store

  pi.on('session_start', async (_e, ctx) => {
    // Never start timers in the factory (authoring.md:80,207): only here, torn down by ctx.sessionSignal.
    role = roleOf(pi, ctx)
    // store = openStore(`${HARNESS_HOME}/harness.sqlite`)
    if (role === 'router') startRouter(pi, ctx, store)
    if (role === 'worker') startWorkerInbox(pi, ctx, store)
  })

  // Guard: one policy table (domain.checkTool), fail-closed (agent-session-tool-hooks.ts:20-39).
  pi.on('tool_call', (event, _ctx) => {
    // TODO const c = checkTool(role, event.toolName, event.input)
    //      if (!c.allow) return { block: true, reason: c.reason }
    //      if (c.rewriteBash) (event.input as { command: string }).command = c.rewriteBash  // mutate in place
    throw new Error('not implemented')
  })

  pi.registerTool(harnessTool(() => store, () => role))

  pi.on('session_before_compact', (_e, _ctx) => {
    if (role !== 'router') return
    // TODO return { compactedText: renderBoard(store) + lastMessages(20) + RECALL_HINT }
    //  The board = one line per open ticket: id, repo, title, run status, waiting-on, last judged.
    //  Everything else is recallable by id (Chain of Recall), so the router's context stays bounded.
  })
}

// ---------- router ----------

function startRouter(pi: ExtensionAPI, ctx: ExtensionContext, store: Store): void {
  // TODO every POLL_MS (setInterval, cleared on ctx.sessionSignal abort):
  //   for repo of policy.repos (mode != 'off'):
  //     {triggers, cursor} = github.poll(repo, store.cursor(repo), store.spill)
  //     for t: {fact, fresh} = store.append({kind:'trigger', by:'code', body:t}); skip !fresh
  //       p = prefilter(t, policy, store.subscriberOf)
  //       'ticket' -> append input.routed; pi.sendMessage(seenLine(t,p.ticket),
  //                   { triggerTurn: false, deliverAs: 'nextTurn' })     // router keeps the picture, no wake
  //       'router' -> batch.push(fact)
  //     store.setCursor(repo, cursor)   // after appends: a crash re-polls, append dedups
  //   if batch: pi.sendMessage({ customType: 'gh-batch', content: renderBatch(batch), display: true },
  //                            { triggerTurn: true, deliverAs: 'followUp' })  // ONE turn per tick (article 7.2)
  //   flushOutbox(store)        // pendingReplies -> github.post -> reply.settled
  //   feedNotices(pi, store)    // factsSince(lastSeq, ['judged']) -> sendMessage(triggerTurn)
  //
  // ctx.observeWorkflowActivity(frame => relayGates(frame)):
  //   for each pending prompt on a run linked to an open ticket (run prompt or stage pendingPrompt):
  //     silent ticket -> pi.sendUserMessage(`/workflow quit ${run}`, { expandPromptTemplates: true })
  //                      and the router later closes it 'discarded'
  //     visible       -> pi.sendMessage(gateNotice(ticket, prompt.id, prompt.message), { triggerTurn: true })
  //   Needed because awaiting_input does not wake the router (operations.md:845).
  //
  // every RECONCILE_MS: reconcile(pi, store, liveRunsFromLastFrame)
  // every HEARTBEAT_MS: touch ~/.harness/router.heartbeat (watchdog liveness)
  throw new Error('not implemented')
}

/**
 * Converge: every open ticket's current run is live or ended. Idempotent, so it runs on start and
 * every 2 min, which also covers the ~120 s lease window after a crash (journal-backend.ts:794-802)
 * and runs released by a clean dispose (startup recovery skips those, operations.md:848).
 *   current run not in the live snapshot and not terminal -> `/workflow resume <run>` (noop if nothing to do)
 *   current run terminal and ticket not closed            -> the router got Atomic's end notice; nothing here
 */
function reconcile(pi: ExtensionAPI, store: Store, live: ReadonlySet<RunId>): void {
  throw new Error('not implemented')
}

// ---------- worker (inside a ticket stage) ----------

/**
 * Thread pass-through without an LLM turn of the router (open question 9 of the grounding):
 * the extension instance living inside the work stage reads its own inbox and steers its own session.
 *   on turn_end (and a 15 s timer while streaming):
 *     for {input, trigger} of store.inbox(ticket, ctx.orchestrationContext.workflowRunId):
 *       pi.sendMessage({ customType: 'followup', content: renderFollowup(trigger) }, { deliverAs: 'steer' })
 *       store.append({ kind: 'input.taken', by: 'worker', body: { input, run } })
 *     store.append({ kind: 'progress', by: 'worker', body: { run, stage, turn, diffHash: hash(git diff HEAD) } })
 * Inputs that arrive after the work stage settled are caught by the workflow's `inbox-<round>` step.
 */
function startWorkerInbox(pi: ExtensionAPI, ctx: ExtensionContext, store: Store): void {
  throw new Error('not implemented')
}

// ---------- the router's one tool ----------

/**
 * `harness`: the router's only acting tool. One discriminated `action`, like Atomic's `workflow`
 * tool. Each action hides policy the model must not own: Mandate from triggers, observe mode,
 * idempotent ticket ids, reply norms, starting runs as owned background runs.
 */
const HarnessParams = Type.Union([
  Type.Object({ action: Type.Literal('open'), triggers: Type.Array(Type.String()), title: Type.String(),
    brief: Type.String(), speculative: Type.Optional(Type.Boolean()) }),
  Type.Object({ action: Type.Literal('route'), trigger: Type.String(), ticket: Type.String() }),
  Type.Object({ action: Type.Literal('ignore'), triggers: Type.Array(Type.String()), reason: Type.String() }),
  Type.Object({ action: Type.Literal('reply'), thread: Type.String(), purpose: Type.String(),
    text: Type.String(), ticket: Type.Optional(Type.String()) }),
  Type.Object({ action: Type.Literal('answer'), ticket: Type.String(), promptId: Type.String(), text: Type.String() }),
  Type.Object({ action: Type.Literal('retry'), ticket: Type.String(), raiseCost: Type.Optional(Type.Number()) }),
  Type.Object({ action: Type.Literal('stop'), ticket: Type.String(), why: Type.String() }),
  Type.Object({ action: Type.Literal('close'), ticket: Type.String(), outcome: Type.String(), why: Type.String() }),
  Type.Object({ action: Type.Literal('status'), ticket: Type.Optional(Type.String()) }),
  Type.Object({ action: Type.Literal('recall'), ref: Type.String() }),
  Type.Object({ action: Type.Literal('judge'), run: Type.String(), verdict: Type.String(), why: Type.String() }), // watchdog only
])

function harnessTool(store: () => Store, role: () => Role) {
  return {
    name: 'harness', label: 'Harness', parameters: HarnessParams,
    description: 'Act on GitHub triggers and tickets. Never edits code. See /skill:harness-router.',
    async execute(_id: string, params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: unknown) {
      // TODO switch (params.action), exhaustive:
      //  open:   m = mandateFor(triggers, policy) ?? refuse('no mandate: only ignore or reply')
      //          decided = append({decided, router, {triggers, decision, mandate}}); ticket = hash('ticket', decided.id)
      //          mode 'observe' -> decision {kind:'observe'}; return "observed, not run" (shown in `harness observed`)
      //          if ticket already has run.linked -> return it (idempotent retry of the tool call)
      //          append subscribed for each trigger thread
      //          r = ctx.executeTool('workflow', { action: 'run', workflow: 'ticket', inputs, budget })
      //              // owned by this session -> end notice wakes the router (lifecycle-notifications.ts:226-235)
      //          append run.linked {ticket, run: r.runId, attempt: 1}
      //  route:  append subscribed + input.routed (same as the prefilter's pass-through)
      //  reply:  silent ticket without delivered outcome -> refuse; else append reply.intended(composeReply(...))
      //  answer: ctx.executeTool('workflow', { action: 'answer', runId, promptId, response: text })
      //  retry:  new run with the same inputs and raised budget; run.linked attempt n+1
      //          (a budget-blocked run is not resumed with a new budget: open question 2)
      //  stop:   ctx.executeTool('workflow', { action: 'quit', runId }); append closed 'stopped'
      //  status: TicketView joined with ctx.executeTool('workflow', { action: 'status', runId, summary: true })
      //  recall: store.recall(ref)
      //  judge:  role() === 'watchdog' only; append judged
      throw new Error('not implemented')
    },
  }
}

