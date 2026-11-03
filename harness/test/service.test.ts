// Unit 2: the code filter and intake, without network. The GitHub proof runs on the sandbox repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLog } from '../src/log.ts'
import { addresses, filter, openHarness, VIEWS } from '../src/service.ts'
import { issueView } from '../src/routing.ts'
import type { FilterInput, TriggerDraft } from '../src/service.ts'
import { DEFAULT_BUDGET, DEFAULT_MODELS, MARKER } from '../src/config.ts'
import type { HarnessConfig } from '../src/config.ts'
import { correlatesOf } from '../src/github.ts'
import type { Repo } from '../src/domain.ts'

const repo = 'uppifyagency/harness-sandbox' as Repo
const config: HarnessConfig = { home: '/tmp', repos: [{ repo, listen: 'explicit', base: 'main' }], allowedActors: ['uppifyagency'], handles: ['/harness'], marker: MARKER, models: DEFAULT_MODELS, budget: DEFAULT_BUDGET, botKeychainService: 'none', maxAttempts: 2, serviceLabel: 'it.delera.harness.test', pstackDir: '/tmp/plugins/pstack', stuckAfterMin: 15 }
const base: FilterInput = { repoListen: 'explicit', mode: 'observe', actor: 'uppifyagency', human: true, addressed: true, subscribed: false, text: '/harness fix it', beforeSpeculativeOn: false }

test('filter: first matching row wins', () => {
  const cases: [Partial<FilterInput>, string, boolean][] = [
    [{ mode: 'off' }, 'policy-off', false],
    [{ repoListen: undefined }, 'repo-not-listed', false],
    [{ repoListen: 'ignore' }, 'repo-ignored', false],
    [{ text: `done ${MARKER}abc -->` }, 'own-message', false],
    [{ human: false }, 'bot', false],
    [{ subscribed: true, actor: 'a-reviewer', addressed: false }, 'follow-up', true],
    [{ actor: 'stranger' }, 'actor-not-allowed', false],
    [{}, 'addressed', true],
    [{ addressed: false, repoListen: 'candidates' }, 'candidate', true],
    [{ addressed: false, repoListen: 'candidates', beforeSpeculativeOn: true }, 'before-speculative', false],
    [{ repoListen: 'candidates', beforeSpeculativeOn: true }, 'addressed', true],
    [{ addressed: false }, 'not-addressed', false],
  ]
  for (const [over, reason, pass] of cases) {
    const r = filter({ ...base, ...over }, config)
    assert.equal(r.reason, reason, JSON.stringify(over))
    assert.equal(r.pass, pass, JSON.stringify(over))
  }
})

test('addresses: the handle counts only as a whole token', () => {
  assert.equal(addresses('/harness fix the README', ['/harness']), true)
  assert.equal(addresses('please\n/harness: look at this', ['/harness']), true)
  assert.equal(addresses('see /harnessing docs', ['/harness']), false)
  assert.equal(addresses('a/harness b', ['/harness']), false)
})

test('correlatesOf: closing keywords link a PR to its issues', () => {
  assert.deepEqual(correlatesOf(repo, 'Fixes #12 and closes #3, see #9').map((t) => (t as { number: number }).number), [12, 3])
})

const draft = (over: Partial<TriggerDraft> = {}): TriggerDraft => ({
  thread: { kind: 'issue', repo, number: 1 },
  native: { id: 'comment:1', version: 'v1' },
  actor: 'uppifyagency', human: true, text: '/harness add a LICENSE', url: 'https://x', createdAt: new Date().toISOString(), correlates: [], ...over,
})

test('intake: duplicate, filtered, to-router; edits are new triggers; own messages are dropped', () => {
  const log = openLog(join(mkdtempSync(join(tmpdir(), 'svc-')), 'l.sqlite'), VIEWS)
  const h = openHarness(log, config)
  assert.equal(h.ingest(draft()), 'to-router')
  assert.equal(h.ingest(draft()), 'duplicate', 're-poll of the same item')
  assert.equal(h.ingest(draft({ native: { id: 'comment:1', version: 'v2' }, text: '/harness add an MIT LICENSE' })), 'to-router', 'an edit is a new fact')
  assert.equal(h.ingest(draft({ native: { id: 'comment:2', version: 'v1' }, text: `Ack. ${MARKER}x -->` })), 'filtered')
  assert.equal(h.ingest(draft({ native: { id: 'comment:3', version: 'v1' }, text: 'unrelated chatter' })), 'filtered')
  const s = log.read.view(issueView, `issue:${repo}#1`)
  assert.equal(s.triggers, 4)
  assert.equal(s.filtered, 2)
  assert.deepEqual(h.status().filter, { 'pass:addressed': 2, 'drop:own-message': 1, 'drop:not-addressed': 1 })
  const card = h.recall(`issue:${repo}#1`)!
  assert.equal(card.next.length, 8)
  log.close()
})
