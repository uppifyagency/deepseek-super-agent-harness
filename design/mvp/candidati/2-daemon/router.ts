// router.ts: the ONE LLM the daemon talks to. Never executes, owns no runs, talks to humans only
// through `reply`. Woken by the daemon with a RouterBatch, never by Atomic notices.

import type { RouterBatch, RouterPort } from './service.ts'

export interface Router {
  /** Runs one router turn over the batch; resolves when the session is idle again. */
  wake(batch: RouterBatch): Promise<void>
  dispose(): Promise<void>
}

export async function openRouter(port: RouterPort, o: { home: string }): Promise<Router> {
  throw new Error('not implemented')
  // const { session } = await createAgentSession({
  //   cwd: o.home, sessionManager: SessionManager.open(store, savedRouterSessionId) ?? create,  // sdk.md:216-233
  //   model: 'anthropic/claude-opus-5-5', thinking: 'medium',
  //   noTools: 'all', customTools: [decide, reply, recall],   // no bash/edit/read, no `workflow` (sdk.md:14)
  //   builtins: { 'web-access': false, intercom: false },
  //   extensionFactories: [compactionExtension],              // see below
  // })
  // Tools: thin adapters, each one call into `port` and a JSON result; refusals return the problem
  // string so the model can correct itself (e.g. reply too long, stale eval).
  //
  // wake(batch): session.prompt(renderBatch(batch)) where renderBatch lists, in this order:
  //   evals (decide each), asks (post the worker's question in its issue, purpose 'ask'),
  //   results (post the outcome, purpose 'result'), seen (one line each, no action expected).
  //   Cards are previews + ids; the router calls `recall(id)` to expand (Chain of Recall).
  //
  // compactionExtension: on session_before_compact return { compactedText:
  //   "open tickets table (from port.recall('tickets')) + last 20 messages" } (event-results.ts:86-90),
  //   so the router never depends on its own memory for state the log already holds.
  //
  // The router's system prompt carries the per-channel norms (GitHub: structured markdown, one
  // status line first, no internals) and "you decide and talk; you never run code".
}
