// mcp.ts: the `harness` MCP server (stdio, JSON-RPC 2.0, one message per line). The router session
// reaches the harness ONLY through these five tools; its permissions deny everything else.
// Zero dependencies on purpose: five tools do not need an SDK.

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Harness } from './service.ts'

const TOOLS = [
  {
    name: 'next',
    description: 'Get every open eval (GitHub or operator messages that passed the code filter and wait for your decision) every worker question (gates) that needs you (ask it in its issue, or read the replies and answer it), and every finished run (results) to report in its issue. Trigger cards carry a text preview; call recall for more. Also returns the policy mode and the board.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'decide',
    description: 'Decide one eval. accept = this is work the harness should do (needs title and scope; in observe mode it is recorded as would-accept and nothing starts). silent = true only on an eval marked speculative: the work runs unseen and is shown only if it succeeds. ignore = no work (needs reason). Operator evals (system:operator) are conversation: ignore them after answering with reply.',
    inputSchema: {
      type: 'object',
      properties: {
        eval: { type: 'string' },
        decision: {
          type: 'object',
          properties: { kind: { enum: ['accept', 'ignore'] }, title: { type: 'string' }, scope: { type: 'string' }, silent: { type: 'boolean' }, reason: { type: 'string' } },
          required: ['kind'],
        },
      },
      required: ['eval', 'decision'],
    },
  },
  {
    name: 'reply',
    description: 'Queue a reply. to = the thread key from the eval card (issue:owner/name#n or system:operator). GitHub: max 1500 chars, first line is a one-line status, structured markdown, no internals. Operator: max 100 words. Never write the harness marker. about = the eval id this reply is about.',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, purpose: { enum: ['ack', 'ask', 'result', 'answer'] }, text: { type: 'string' }, about: { type: 'string' } },
      required: ['to', 'purpose', 'text'],
    },
  },
  {
    name: 'answer',
    description: 'Answer a worker question (gate) from the human replies in its issue. When the gate has options, answer with the exact label the human chose; otherwise their answer in a few words. If the replies do not answer the question, do not call this: ask again with reply (purpose ask, about = the gate\'s about id).',
    inputSchema: { type: 'object', properties: { gate: { type: 'string' }, answer: { type: 'string' } }, required: ['gate', 'answer'] },
  },
  {
    name: 'recall',
    description: 'Expand any id: an event id, or a thread key (issue:owner/name#n, ticket:<id>). Returns full text and the ids of related events (thread, causes, effects). Follow ids hop by hop to answer about anything not on the board: old tickets, past runs, PR comments.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
] as const

type Args = Record<string, unknown>

function call(h: Harness, name: string, a: Args): unknown {
  switch (name) {
    case 'next': return h.next()
    case 'decide': {
      const d = (a.decision ?? {}) as Args
      return h.decide(String(a.eval), d.kind === 'accept'
        ? { kind: 'accept', title: String(d.title ?? ''), scope: String(d.scope ?? ''), silent: d.silent === true }
        : { kind: 'ignore', reason: String(d.reason ?? '') })
    }
    case 'reply': return h.reply(String(a.to), a.purpose as 'ack', String(a.text), a.about === undefined ? undefined : String(a.about))
    case 'answer': return h.answer(String(a.gate), String(a.answer ?? ''), 'router', `router:${String(a.gate)}`)
    case 'recall': return h.recall(String(a.id)) ?? { problem: `not found: ${a.id}` }
    default: throw new Error(`unknown tool ${name}`)
  }
}

/** Every tool call is logged to <home>/logs/mcp.log: which tools the router used, and on what. */
export async function serveMcp(h: Harness, home: string): Promise<void> {
  mkdirSync(join(home, 'logs'), { recursive: true })
  const audit = (name: string, a: Args) => appendFileSync(join(home, 'logs', 'mcp.log'), `${new Date().toISOString()} ${name} ${JSON.stringify(a).slice(0, 300)}\n`)
  const out = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    if (!line.trim()) continue
    let req: { id?: number | string; method: string; params?: Args }
    try { req = JSON.parse(line) } catch { continue }
    if (req.id === undefined) continue                       // notifications (initialized, cancelled)
    try {
      let result: unknown
      if (req.method === 'initialize') {
        result = { protocolVersion: (req.params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'harness', version: '0.0.0' } }
      } else if (req.method === 'tools/list') {
        result = { tools: TOOLS }
      } else if (req.method === 'tools/call') {
        const p = req.params as { name: string; arguments?: Args }
        audit(p.name, p.arguments ?? {})
        const value = call(h, p.name, p.arguments ?? {})
        const failed = typeof value === 'object' && value !== null && 'ok' in value && (value as { ok: boolean }).ok === false
        result = { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: failed }
      } else if (req.method === 'ping') {
        result = {}
      } else {
        out({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } })
        continue
      }
      out({ jsonrpc: '2.0', id: req.id, result })
    } catch (err) {
      out({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: String(err) }], isError: true } })
    }
  }
}
