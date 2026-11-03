// router.ts: the ROUTER is a dedicated Claude Code session (Opus, Vlad's plan), resumed on every wake
// with `claude -p --resume <id>`. It never executes: its only tools are the five `harness` MCP tools
// (built-in tools are switched off with --tools ""). It is not the session that builds the harness.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface WakeResult {
  ok: boolean
  sessionId?: string
  costUsd?: number
  durationMs?: number
  turns?: number
  denied: string[]          // tools the router tried and was refused
  rotated: boolean          // this wake started a fresh session
  text: string
}

const HARNESS_TOOLS = ['next', 'decide', 'reply', 'answer', 'recall'].map((t) => `mcp__harness__${t}`)

const SYSTEM = `You are the ROUTER of Vlad's personal super-agent harness. You decide and you talk; you never run code.
Your only tools are next, decide, reply, answer, recall (MCP server "harness"). On every wake:
1. Call next. It returns a board (open tickets, your recent decisions, recent talk with Vlad, what waits for Vlad) and the evals. The board is the state of record: your session may have been reset, so trust the board over your memory. For each eval, read its trigger cards (call recall on an id or thread when the preview is not enough).
2. Decide each eval exactly once: accept when a message asks for concrete work on the repo (title: short imperative, scope: what done means), ignore otherwise with a short reason.
3. Reply only when useful. On an accepted GitHub eval in mode "auto", post one short ack (purpose ack): first line a one-line status, then what you understood. In mode "observe" never post to GitHub: the decision is recorded as would-accept for Vlad. Operator evals (thread system:operator) are Vlad talking to you from the terminal: answer with reply to system:operator (max 100 words), then decide ignore with reason "answered".
4. Write in the language of the message. Never mention internals (evals, ids, tools).
5. Gates are questions from a worker on a ticket. A gate not yet asked: post the question in its issue (reply to the gate's "to", purpose ask, about = the gate's "about" id), in the issue's language, listing the options. A gate with replies: if they answer it, call answer (the exact option label when there are options); if not, ask again the same way.
6. Results are finished runs of a ticket. Report each one in its issue (reply to its "to", purpose result, about = its "about" id): done -> the PR link and one line on what changed and how it was verified; failed -> what went wrong and what Vlad can do. Say nothing about merging: Vlad merges.
7. An eval marked speculative was not addressed to you. Accept it with silent true only when it reports a bug or asks for a small concrete change you could verify; otherwise ignore it. Never reply about it, not even an ack: the harness speaks for it only if the work succeeds.
8. Call next again; when it returns no evals, no gates and no results, stop.`

export interface RouterOptions {
  home: string
  timeoutMs?: number
  /** Start a fresh session when the previous wake cost more than this (USD, as reported by claude -p). */
  rotateAboveUsd?: number
}

/** Default: measured 02/11, a resumed session grew 0.31 -> 0.56 USD per wake in six wakes; fresh ~0.3. */
export const ROTATE_ABOVE_USD = 0.45

export interface RouterSession { id: string; wakes: number; lastCostUsd: number }

/** Pure: rotate when there is no session yet, or the last wake crossed the threshold. */
export function shouldRotate(s: RouterSession | undefined, aboveUsd: number): boolean {
  return s === undefined || s.lastCostUsd > aboveUsd
}

function mcpConfigPath(home: string): string {
  const path = join(home, 'router-mcp.json')
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
  writeFileSync(path, JSON.stringify({ mcpServers: { harness: { command: process.execPath, args: [cli, 'mcp'], env: { HARNESS_HOME: home } } } }, null, 2))
  return path
}

export function readRouterSession(home: string): RouterSession | undefined {
  const p = join(home, 'router-session.json')
  if (!existsSync(p)) return undefined
  const s = JSON.parse(readFileSync(p, 'utf8')) as Partial<RouterSession>
  return s.id ? { id: s.id, wakes: s.wakes ?? 0, lastCostUsd: s.lastCostUsd ?? 0 } : undefined
}

/** One router turn. Resolves when the claude process exits. Never throws for a model failure. */
export function wakeRouter(o: RouterOptions, prompt = 'New events are waiting. Call next and handle every eval.'): Promise<WakeResult> {
  const prev = readRouterSession(o.home)
  const rotated = shouldRotate(prev, o.rotateAboveUsd ?? ROTATE_ABOVE_USD)
  const args = [
    '-p', prompt,
    ...(!rotated && prev ? ['--resume', prev.id] : []),
    '--model', 'opus', '--effort', 'medium',
    '--output-format', 'json',
    '--append-system-prompt', SYSTEM,
    '--mcp-config', mcpConfigPath(o.home), '--strict-mcp-config',
    '--setting-sources', 'project',          // cwd = harness home: no user plugins, hooks or CLAUDE.md rules
    // Allowlist, not denylist: `--tools ""` removes every built-in tool. Verified 02/11 from the init
    // event: the session has exactly the harness tools. A denylist left Artifact, CronCreate,
    // RemoteTrigger, PublishPlugin, SendMessage and Workflow reachable.
    '--tools', '',
    '--allowedTools', ...HARNESS_TOOLS,
  ]
  return new Promise((resolve) => {
    execFile('claude', args, { cwd: o.home, timeout: o.timeoutMs ?? 10 * 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      let r: { session_id?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number; is_error?: boolean; result?: string; permission_denials?: { tool_name: string }[] } = {}
      try { r = JSON.parse(stdout) } catch { /* not JSON: failure below */ }
      if (r.session_id) {
        const next: RouterSession = { id: r.session_id, wakes: rotated ? 1 : (prev?.wakes ?? 0) + 1, lastCostUsd: r.total_cost_usd ?? 0 }
        writeFileSync(join(o.home, 'router-session.json'), JSON.stringify(next))
      }
      resolve({
        ok: !err && r.is_error !== true && r.session_id !== undefined,
        sessionId: r.session_id, costUsd: r.total_cost_usd, durationMs: r.duration_ms, turns: r.num_turns,
        denied: (r.permission_denials ?? []).map((d) => d.tool_name),
        rotated,
        text: r.result ?? String(stderr || err || '').slice(0, 2000),
      })
    }).stdin?.end()
  })
}
