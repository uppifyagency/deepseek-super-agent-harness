// router.ts: the ROUTER is a dedicated Claude Code session (Opus, Vlad's plan), not an Atomic session.
// Decided 02/11/2026: Claude Code bills against the plan, runs pstack natively with hooks, and keeps
// Atomic's Anthropic login unnecessary. It never executes, owns no runs, talks to humans only
// through `reply`. Woken by the daemon with a RouterBatch, never by Atomic notices.
//
// Shape: the daemon runs one `claude -p` per batch, resuming the same session id, so the router keeps
// conversational memory across batches (Claude Code compacts it; state of record is the log).
// The router reaches the harness only through the `harness` MCP server (stdio, served by the daemon
// binary): tools next/decide/reply/recall. Permissions deny everything else, Bash included.

import type { RouterBatch, RouterPort } from './service.ts'

export interface Router {
  /** One router turn over the batch: `claude -p --resume <id>`; resolves when the process exits. */
  wake(batch: RouterBatch): Promise<{ sessionId: string; costUsd: number; ok: boolean }>
}

export interface RouterOptions {
  home: string                 // ~/.harness: holds router-session.json and router-settings.json
  model: 'opus'                // Claude Code alias, effort via settings
  mcpConfig: string            // path to the harness MCP server config (stdio: `harness mcp`)
  timeoutMs: number            // one batch, then SIGTERM
}

export async function openRouter(port: RouterPort, o: RouterOptions): Promise<Router> {
  throw new Error('not implemented')
  // wake(batch):
  //   const sid = read(home/router-session.json)?.id            // absent on first wake
  //   spawn('claude', ['-p', renderBatch(batch),
  //     ...(sid ? ['--resume', sid] : []),
  //     '--model', 'opus', '--output-format', 'json',
  //     '--mcp-config', o.mcpConfig, '--strict-mcp-config',
  //     '--settings', home/router-settings.json,                // permissions below
  //     '--allowedTools', 'mcp__harness__next,mcp__harness__decide,mcp__harness__reply,mcp__harness__recall'],
  //     { cwd: home, stdio: ['ignore', 'pipe', 'pipe'], env: routerEnv() })   // stdin closed (e2e M6)
  //   parse JSON result -> persist session_id (first wake creates it), return total_cost_usd
  //
  // router-settings.json: permissions.deny ["Bash", "Edit", "Write", "WebFetch", "Agent"]; no plugins
  //   except pstack (unslop for replies). System prompt appended: per-channel norms (GitHub: structured,
  //   one status line first, no internals) and "you decide and talk; you never run code".
  //
  // renderBatch lists, in order: evals (decide each), asks (post the worker's question, purpose 'ask'),
  //   results (post the outcome, purpose 'result'), seen (one line each, no action expected).
  //   Cards are previews + ids; the router calls `recall(id)` to expand (Chain of Recall).
  //
  // Compaction: Claude Code auto-compacts the resumed session. Every batch re-states the open-ticket
  //   board (port.recall('tickets')), so the router never depends on memory for state the log holds.
  //
  // Failure: non-zero exit or timeout -> the batch's evals stay unrouted (no `decided`), the next wake
  //   retries them; decisions already appended are idempotent by content id.
}

/** The `harness` MCP server: four tools, each one call into `port`, refusals returned as text. */
export interface HarnessMcpTools {
  next(): RouterBatch
  decide: RouterPort['decide']
  reply: RouterPort['reply']
  recall: RouterPort['recall']
}
