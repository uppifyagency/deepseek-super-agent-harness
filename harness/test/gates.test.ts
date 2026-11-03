// Unit 5 without Atomic or GitHub: a worker question from gate.opened to gate.answered, and the guard.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLog } from '../src/log.ts'
import { openHarness, VIEWS } from '../src/service.ts'
import { guardExtension } from '../src/engine.ts'
import { DEFAULT_BUDGET, DEFAULT_MODELS, MARKER } from '../src/config.ts'
import type { HarnessConfig } from '../src/config.ts'
import type { GateSpec, Repo } from '../src/domain.ts'

const repo = 'uppifyagency/harness-sandbox' as Repo
const config: HarnessConfig = { home: '/tmp', repos: [{ repo, listen: 'explicit', base: 'main' }], allowedActors: ['uppifyagency'], handles: ['/harness'], marker: MARKER, models: DEFAULT_MODELS, budget: DEFAULT_BUDGET, botKeychainService: 'none', maxAttempts: 2, serviceLabel: 'it.delera.harness.test', pstackDir: '/tmp/plugins/pstack', stuckAfterMin: 15 }
const issue = { kind: 'issue' as const, repo, number: 9 }
const comment = (id: string, text: string) => ({ thread: issue, native: { id, version: 'v1' }, actor: 'uppifyagency', human: true, text, url: `https://x/${id}`, createdAt: new Date().toISOString(), correlates: [] })
const spec: GateSpec = { kind: 'question', audience: 'requester', question: 'A.md or B.md?', options: ['A.md', 'B.md'] }

function running() {
  const log = openLog(join(mkdtempSync(join(tmpdir(), 'gates-')), 'l.sqlite'), VIEWS)
  const h = openHarness(log, config)
  h.setPolicy('auto', 'p')
  h.ingest(comment('c1', '/harness create the file I will name'))
  const d = h.decide(h.next().evals[0].eval, { kind: 'accept', title: 'file', scope: 'the file exists' })
  assert.ok(d.ok)
  const [run] = h.planRuns()
  return { log, h, run }
}

test('a worker question becomes one gate the router asks in the issue; the reply comes back as the answer', () => {
  const { log, h, run } = running()
  const g = h.openGate(run, 'stage-1', 0, spec)
  assert.equal(g.isNew, true)
  assert.deepEqual(h.openGate(run, 'stage-1', 0, spec), { gate: g.gate, isNew: false }, 'the re-ask after a resume is the same gate')
  assert.ok(h.attention().some((i) => i.kind === 'gate' && i.gate === g.gate), 'it waits for Vlad')

  let card = h.next().gates[0]
  assert.equal(card.asked, false)
  assert.equal(card.to, 'issue:uppifyagency/harness-sandbox#9')
  assert.equal(h.routerHasWork(), true)
  assert.ok(h.reply(card.to!, 'ask', 'A.md o B.md?', card.about).ok)
  assert.equal(h.next().gates.length, 0, 'asked and no replies yet: nothing for the router')
  assert.equal(h.routerHasWork(), false)

  assert.equal(h.ingest(comment('c2', 'B, grazie')), 'to-ticket')
  card = h.next().gates[0]
  assert.deepEqual(card.replies.map((r) => r.text), ['B, grazie'])
  assert.equal(h.gateAnswer(g.gate), undefined)
  assert.deepEqual(h.answer(g.gate, 'B.md', 'router', 'r1'), { ok: true })
  assert.equal(h.gateAnswer(g.gate), 'B.md')
  assert.deepEqual(h.answer(g.gate, 'A.md', 'human', 'r2'), { ok: true, already: true }, 'first answer wins')
  assert.equal(h.next().gates.length, 0)
  assert.ok(!h.attention().some((i) => i.kind === 'gate'))
  log.close()
})

test('Vlad can answer from the terminal before the router asks; unknown gates and empty answers are refused', () => {
  const { log, h, run } = running()
  const g = h.openGate(run, 'stage-1', 0, spec)
  assert.equal(h.answer('nope', 'x', 'human', 'r').ok, false)
  assert.equal(h.answer(g.gate, '  ', 'human', 'r').ok, false)
  assert.deepEqual(h.answer(g.gate, 'A.md', 'human', 'r'), { ok: true })
  assert.equal(h.next().gates.length, 0)
  log.close()
})

test('the guard blocks git push, gh and keychain reads with the reason, and lets ordinary commands run', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'guard-')), 'guard.log')
  const handlers: Record<string, (e: unknown, ctx: unknown) => Promise<unknown>> = {}
  guardExtension(path)({ on: (name: string, fn: (e: unknown, ctx: unknown) => Promise<unknown>) => { handlers[name] = fn } })
  const call = (command: string) => handlers.tool_call({ toolName: 'bash', input: { command } }, { cwd: '/w' }) as Promise<{ block: boolean; reason: string } | undefined>
  assert.match((await call('git add -A && git push origin HEAD'))!.reason, /git push is reserved for the publish step/)
  assert.ok((await call('gh pr create'))?.block)
  assert.ok((await call('security find-generic-password -s x -w'))?.block)
  assert.equal(await call('git commit -m x && echo done'), undefined)
  assert.ok((await handlers.tool_call({ toolName: 'write', input: { path: '/etc/x' } }, { cwd: '/w' }) as { block: boolean }).block, 'writes outside the worktree')
  assert.match(readFileSync(path, 'utf8'), /BLOCKED/)
})
