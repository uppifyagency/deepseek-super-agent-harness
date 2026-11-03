import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const stub = (src: string) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true })
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@bastani/atomic/workflows') return stub('export const workflow = (d) => d')
    if (spec === 'typebox') return stub('const f = (...a) => a; export const Type = { Object: f, Union: f, Literal: f, String: f, Number: f, Array: f }')
    return next(spec, ctx)
  },
})
const { harnessTicket } = await import(new URL('../atomic/harness-ticket.ts', import.meta.url).href) as { harnessTicket: { run(ctx: unknown): Promise<{ attempt: string }> } }

const published: string[] = []
;(globalThis as Record<symbol, unknown>)[Symbol.for('it.delera.harness.bridge')] = {
  prepare: async () => ({ brief: 'b', model: 'm', worktree: '/w', base: 'b0', budget: { maxCostUsd: 1, maxDurationMs: 1 } }),
  inspect: async () => ({ sha: 's1', commits: 1, dirty: [] }),
  verify: async () => ({ ok: true, verdict: { sha: 's1' }, evidence: 'checked', costUsd: 0.1 }),
  publish: async (_run: string, _v: unknown, summary: string) => { published.push(summary); return { ok: true, pr: 3, url: 'u' } },
  follow: () => [],
  delivered: () => {},
}

function ctx(replayed: boolean) {
  const value = { status: 'verify-ready', summary: 'scripts/ciao.sh added' }
  const c = {
    inputs: { runKey: 'k' },
    tool: async (_name: string, _args: unknown, fn: () => unknown) => fn(),
    stage: () => ({ sessionId: replayed ? 'durable-replay:work' : 'w1', steer: async () => {}, prompt: async () => (replayed ? JSON.stringify(value, null, 2) : value) }),
    workflow: async (child: { run(c: unknown): Promise<unknown> }, o: { inputs: unknown }) => child.run({ ...c, inputs: o.inputs }),
  }
  return c
}

test('a resume after the work stage reaches verify and publish: the replayed JSON text reads like the live value', async () => {
  for (const replayed of [false, true]) {
    const out = JSON.parse((await harnessTicket.run(ctx(replayed))).attempt)
    assert.equal(out.status, 'done', `${replayed ? 'replayed' : 'live'} work stage ends done`)
    assert.equal(out.pr, 3)
    assert.equal(out.workerSession, replayed ? '' : 'w1', 'a replayed stage leaves no session to fork the next attempt from')
  }
  assert.deepEqual(published, ['scripts/ciao.sh added', 'scripts/ciao.sh added'], 'the summary survives the replay')
})
