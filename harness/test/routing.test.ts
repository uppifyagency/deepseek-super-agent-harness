// Unit 3 without network: evals, observe vs auto, idempotent decisions, reply norms, outbox, MCP stdio.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openLog } from '../src/log.ts'
import { openHarness, VIEWS } from '../src/service.ts'
import { issueView } from '../src/routing.ts'
import type { TriggerDraft } from '../src/service.ts'
import { DEFAULT_BUDGET, DEFAULT_MODELS, DEFAULT_SPECULATIVE, MARKER, loadConfig } from '../src/config.ts'
import type { HarnessConfig } from '../src/config.ts'
import type { Repo } from '../src/domain.ts'

const repo = 'uppifyagency/harness-sandbox' as Repo
const config: HarnessConfig = { home: '/tmp', repos: [{ repo, listen: 'explicit', base: 'main' }], allowedActors: ['uppifyagency'], handles: ['/harness'], marker: MARKER, models: DEFAULT_MODELS, budget: DEFAULT_BUDGET, botKeychainService: 'none', maxAttempts: 2, serviceLabel: 'it.delera.harness.test', pstackDir: '/tmp/plugins/pstack', stuckAfterMin: 15 }
const draft = (n: number, id: string, text: string): TriggerDraft => ({
  thread: { kind: 'issue', repo, number: n }, native: { id, version: 'v1' },
  actor: 'uppifyagency', human: true, text, url: `https://x/${id}`, createdAt: new Date().toISOString(), correlates: [],
})
const fresh = () => { const log = openLog(join(mkdtempSync(join(tmpdir(), 'rt-')), 'l.sqlite'), VIEWS); return { log, h: openHarness(log, config) } }

test('next batches everything that piled up on a thread into one eval, and re-shows it until decided', () => {
  const { log, h } = fresh()
  h.ingest(draft(1, 'c1', '/harness add a LICENSE'))
  h.ingest(draft(1, 'c2', '/harness MIT please'))
  h.ingest(draft(2, 'c3', '/harness fix the typo'))
  const a = h.next()
  assert.equal(a.evals.length, 2)
  assert.equal(a.evals.find((e) => e.thread.endsWith('#1'))!.triggers.length, 2, 'two triggers, one eval')
  assert.deepEqual(h.next().evals.map((e) => e.eval).sort(), a.evals.map((e) => e.eval).sort(), 'undecided evals come back, no new ones')
  assert.equal(h.routerHasWork(), true)
  log.close()
})

test('observe turns accept into would-accept: no ticket, an attention item, nothing to send', () => {
  const { log, h } = fresh()
  h.ingest(draft(1, 'c1', '/harness add a LICENSE'))
  const [ev] = h.next().evals
  const r = h.decide(ev.eval, { kind: 'accept', title: 'Add LICENSE', scope: 'MIT LICENSE file at repo root' })
  assert.deepEqual(r, { ok: true, decision: 'would-accept', ticket: undefined })
  assert.equal(log.read.view(issueView, `issue:${repo}#1`).subscriber, undefined)
  assert.equal(h.attention()[0].kind, 'would-accept')
  assert.equal(h.routerHasWork(), false)
  assert.deepEqual(h.decide(ev.eval, { kind: 'ignore', reason: 'changed my mind' }), { ok: true, decision: 'would-accept', already: true }, 'first decision wins')
  log.close()
})

test('auto: accept opens a ticket and subscribes the thread, so follow-ups bypass the router', () => {
  const { log, h } = fresh()
  h.setPolicy('auto', 'r1')
  h.ingest(draft(1, 'c1', '/harness add a LICENSE'))
  const [ev] = h.next().evals
  const r = h.decide(ev.eval, { kind: 'accept', title: 'Add LICENSE', scope: 'MIT' })
  assert.ok(r.ok && r.decision === 'accept' && r.ticket)
  assert.equal(log.read.view(issueView, `issue:${repo}#1`).subscriber, (r as { ticket: string }).ticket)
  assert.equal(h.ingest(draft(1, 'c9', 'a reviewer says: use 2026 as year')), 'to-ticket', 'any human follow-up on a subscribed thread')
  assert.equal(h.routerHasWork(), false)
  log.close()
})

test('reply: channel norms, idempotent by content, outbox until settled', () => {
  const { log, h } = fresh()
  h.ingest(draft(1, 'c1', '/harness add a LICENSE'))
  const [ev] = h.next().evals
  const to = `issue:${repo}#1`
  assert.equal(h.reply(to, 'ack', 'x'.repeat(1600)).ok, false)
  assert.equal(h.reply(to, 'ack', `hi ${MARKER}x -->`).ok, false)
  assert.equal(h.reply('system:operator', 'answer', 'word '.repeat(101)).ok, false)
  assert.equal(h.reply('issue:nobody/nothing#9', 'ack', 'hi').ok, false)
  const a = h.reply(to, 'ack', 'Received: adding a MIT LICENSE.', ev.eval)
  const b = h.reply(to, 'ack', 'Received: adding a MIT LICENSE.', ev.eval)
  assert.ok(a.ok && b.ok && a.intent === b.intent, 'same reply about the same eval is one intent')
  assert.equal(Object.keys(h.pending()).length, 1)
  h.settle((a as { intent: string }).intent, 'sent', 'https://github.com/x')
  assert.equal(Object.keys(h.pending()).length, 0)
  log.close()
})

test('ask: an operator message reaches the router as an addressed trigger', () => {
  const { log, h } = fresh()
  assert.equal(h.ask('what is open right now?', 'q1'), 'to-router')
  assert.equal(h.next().evals[0].thread, 'system:operator')
  log.close()
})

test('MCP server over stdio: initialize, tools/list, tools/call next', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mcp-'))
  writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: [repo], allowedActors: ['uppifyagency'] }))
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const p = spawn(process.execPath, [cli, 'mcp'], { env: { ...process.env, HARNESS_HOME: home } })
  const lines: string[] = []
  let buf = ''
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1) } })
  const send = (m: unknown) => p.stdin.write(JSON.stringify(m) + '\n')
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'next', arguments: {} } })
  for (let t = 0; t < 100 && lines.length < 3; t++) await new Promise((r) => setTimeout(r, 50))
  p.stdin.end(); p.kill()
  const [init, list, call] = lines.map((l) => JSON.parse(l))
  assert.equal(init.result.serverInfo.name, 'harness')
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ['next', 'decide', 'reply', 'answer', 'recall'])
  const next = JSON.parse(call.result.content[0].text)
  assert.equal(next.mode, 'observe')
  assert.deepEqual(next.evals, [])
  assert.deepEqual(next.board, { openTickets: [], recentDecisions: [], recentOperator: [], waitingForVlad: [] })
})

test('board: open tickets with their issue, recent decisions, recent talk with Vlad', () => {
  const { log, h } = fresh()
  h.setPolicy('auto', 'r1')
  h.ingest(draft(1, 'c1', '/harness add a LICENSE'))
  h.ingest(draft(2, 'c2', '/harness hello'))
  for (const ev of h.next().evals) {
    h.decide(ev.eval, ev.thread.endsWith('#1') ? { kind: 'accept', title: 'Add LICENSE', scope: 'MIT' } : { kind: 'ignore', reason: 'greeting' })
  }
  h.ask('what is open?', 'q1')
  const [op] = h.next().evals
  h.reply('system:operator', 'answer', 'One ticket: Add LICENSE.', op.eval)
  const b = h.next().board
  assert.equal(b.openTickets.length, 1)
  assert.equal(b.openTickets[0].title, 'Add LICENSE')
  assert.equal(b.openTickets[0].thread, `issue:${repo}#1`)
  assert.deepEqual(b.recentDecisions.map((d) => d.kind).sort(), ['accept', 'ignore'])
  assert.deepEqual(b.recentOperator.map((o) => o.from), ['vlad', 'router'])
  log.close()
})

test('shouldRotate: fresh when there is no session or the last wake crossed the threshold', async () => {
  const { shouldRotate } = await import('../src/router.ts')
  assert.equal(shouldRotate(undefined, 0.45), true)
  assert.equal(shouldRotate({ id: 's', wakes: 3, lastCostUsd: 0.31 }, 0.45), false)
  assert.equal(shouldRotate({ id: 's', wakes: 6, lastCostUsd: 0.56 }, 0.45), true)
})

const speculative = (over: Partial<HarnessConfig['repos'][number]> = {}): HarnessConfig => ({ ...config, repos: [{ repo, listen: 'candidates', base: 'main', speculative: DEFAULT_SPECULATIVE, ...over }] })
const auto = (c: HarnessConfig) => { const log = openLog(join(mkdtempSync(join(tmpdir(), 'sp-')), 'l.sqlite'), VIEWS); const h = openHarness(log, c); h.setPolicy('auto', 'r1'); return { log, h } }
const evalOn = (h: ReturnType<typeof openHarness>, n: number) => h.next().evals.find((e) => e.thread.endsWith(`#${n}`))!
const accept = { kind: 'accept' as const, title: 'Fix the crash', scope: 'npm test passes' }

test('silent accept is refused without speculative, on an addressed eval, and on a thread that already has a ticket', () => {
  const plain = auto(speculative({ speculative: undefined }))
  plain.h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const ev = evalOn(plain.h, 1)
  assert.equal(ev.speculative, undefined)
  assert.equal(plain.h.decide(ev.eval, { ...accept, silent: true }).ok, false)
  assert.equal(plain.h.decide(ev.eval, accept).ok, true, 'candidates without speculative: today behaviour')
  plain.log.close()

  const { log, h } = auto(speculative())
  h.ingest(draft(2, 'c2', '/harness fix the crash'))
  assert.match(String((h.decide(evalOn(h, 2).eval, { ...accept, silent: true }) as { problem: string }).problem), /addresses the harness/)
  h.ingest(draft(3, 'c3', 'the build crashes on start'))
  const first = evalOn(h, 3)
  h.ingest(draft(3, 'c4', 'also on CI'))
  assert.equal(h.decide(first.eval, { ...accept, silent: true }).ok, true)
  const second = evalOn(h, 3)
  assert.notEqual(second.eval, first.eval)
  assert.match(String((h.decide(second.eval, { ...accept, silent: true }) as { problem: string }).problem), /already has a ticket/)
  log.close()
})

test('over maxPerDay a silent accept is decided ignore and opens no ticket', () => {
  const { log, h } = auto(speculative({ speculative: { ...DEFAULT_SPECULATIVE, maxPerDay: 1 } }))
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  h.ingest(draft(2, 'c2', 'the logo is blurry'))
  assert.equal(h.decide(evalOn(h, 1).eval, { ...accept, silent: true }).ok, true)
  const ev = evalOn(h, 2)
  assert.deepEqual(h.decide(ev.eval, { ...accept, silent: true }), { ok: true, decision: 'ignore', ticket: undefined, capped: true })
  assert.equal(log.read.view(issueView, `issue:${repo}#2`).subscriber, undefined)
  assert.equal(h.next().board.openTickets.length, 1)
  assert.match(h.next().board.recentDecisions.at(-1)!.what, /speculative cap: 1 per day/)
  log.close()
})

test('a visible accept is refused on an unaddressed eval of a speculative repo', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const ev = evalOn(h, 1)
  assert.equal(ev.speculative, true)
  assert.match(String((h.decide(ev.eval, accept) as { problem: string }).problem), /nobody called the harness here/)
  log.close()
})

test('a silent accept opens a silent ticket, and the router cannot reply in its issue', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const ev = evalOn(h, 1)
  const r = h.decide(ev.eval, { ...accept, silent: true })
  assert.ok(r.ok && r.decision === 'accept' && r.ticket)
  assert.equal(h.next().board.openTickets[0].visibility, 'silent')
  const no = h.reply(`issue:${repo}#1`, 'ack', 'Ci lavoro.', ev.eval)
  assert.match(String((no as { problem: string }).problem), /post nothing/)
  assert.deepEqual(h.pending(), {})
  log.close()
})

test('candidateMatch narrows which unaddressed messages are candidates', () => {
  const { log, h } = auto(speculative({ candidateMatch: 'bug|errore' }))
  assert.equal(h.ingest(draft(1, 'c1', 'grazie mille')), 'filtered')
  assert.equal(h.ingest(draft(1, 'c2', "c'e' un errore in home")), 'to-router')
  assert.equal(h.ingest(draft(2, 'c3', '/harness grazie')), 'to-router', 'an addressed message is not narrowed')
  assert.equal(h.status().filter['drop:not-a-candidate'], 1)
  log.close()
})

test('config: speculative needs listen candidates; defaults fill what is not given', () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-'))
  const write = (r: object) => writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: [{ repo, ...r }], allowedActors: ['uppifyagency'] }))
  write({ listen: 'explicit', speculative: { enabled: true } })
  assert.throws(() => loadConfig(home), /needs listen "candidates"/)
  write({ listen: 'candidates', candidateMatch: '(' })
  assert.throws(() => loadConfig(home), /bad candidateMatch/)
  write({ listen: 'candidates', speculative: { enabled: true, budget: { maxCostUsd: 0.5 } } })
  assert.deepEqual(loadConfig(home).repos[0].speculative, { maxPerDay: 3, budget: { maxCostUsd: 0.5, maxDurationMs: 20 * 60_000 } })
  write({ listen: 'candidates', speculative: { enabled: false } })
  assert.equal(loadConfig(home).repos[0].speculative, undefined)
})

test('on a speculative repo the router cannot reply before deciding, unless the harness was called there', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const ev = evalOn(h, 1)
  assert.match(String((h.reply(`issue:${repo}#1`, 'ack', 'Ci guardo.', ev.eval) as { problem: string }).problem), /post nothing/)
  assert.deepEqual(h.pending(), {})
  h.ingest(draft(2, 'c2', '/harness fix the crash'))
  assert.ok(h.reply(`issue:${repo}#2`, 'ack', 'Ci guardo.', evalOn(h, 2).eval).ok, 'an addressed thread may get an answer')
  log.close()
})

test('a call that lands while the speculative eval is open: the silent accept becomes ignore, the call opens one visible ticket', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const e1 = evalOn(h, 1)
  assert.equal(h.ingest(draft(1, 'c2', '/harness fix the crash')), 'to-router')
  assert.deepEqual(h.decide(e1.eval, { ...accept, silent: true }), { ok: true, decision: 'ignore', ticket: undefined })
  assert.match(h.next().board.recentDecisions.at(-1)!.what, /the harness was called on this thread/)
  const e2 = evalOn(h, 1)
  assert.notEqual(e2.eval, e1.eval)
  assert.equal(e2.speculative, undefined)
  assert.ok(h.decide(e2.eval, accept).ok)
  assert.deepEqual(h.next().board.openTickets.map((t) => t.visibility), ['visible'], 'one ticket on the issue')
  log.close()
})

test('config: speculative fields are typed, not truthy', () => {
  const home = mkdtempSync(join(tmpdir(), 'cfg-'))
  const write = (sp: object) => writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: [{ repo, listen: 'candidates', speculative: sp }], allowedActors: ['uppifyagency'] }))
  write({ enabled: 'false' })
  assert.throws(() => loadConfig(home), /"enabled" must be true or false/)
  write({})
  assert.throws(() => loadConfig(home), /"enabled" must be true or false/)
  write({ enabled: true, maxPerDay: 'one' })
  assert.throws(() => loadConfig(home), /"maxPerDay" must be a positive integer/)
  write({ enabled: true, maxPerDay: 0 })
  assert.throws(() => loadConfig(home), /"maxPerDay" must be a positive integer/)
  write({ enabled: true, budget: { maxCostUsd: '1' } })
  assert.throws(() => loadConfig(home), /"budget.maxCostUsd" must be a positive number/)
  write({ enabled: true, budget: { maxDurationMs: -5 } })
  assert.throws(() => loadConfig(home), /"budget.maxDurationMs" must be a positive number/)
  write({ enabled: false, maxPerDay: 'one' })
  assert.equal(loadConfig(home).repos[0].speculative, undefined, 'a disabled block is not checked further')
})

test('speculative replays no history: only messages created after it was turned on for the repo are candidates, across restarts', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'hist-')), 'l.sqlite')
  const open = (c: HarnessConfig) => { const log = openLog(path, VIEWS); const h = openHarness(log, c); h.setPolicy('auto', 'r1'); return { log, h } }
  const at = (d: TriggerDraft, createdAt: string): TriggerDraft => ({ ...d, createdAt })
  const old = '2026-01-05T09:00:00Z'
  const tick = () => new Promise((r) => setTimeout(r, 5))

  let { log, h } = open(speculative())
  assert.equal(h.ingest(at(draft(1, 'c1', 'the build crashes on start'), old)), 'filtered', 'an old message read by the first poll')
  assert.equal(h.ingest({ ...at(draft(1, 'c1', 'the build crashes on start, also on CI'), old), native: { id: 'c1', version: 'v2' } }), 'filtered', 'reread in the overlap and edited after: still old')
  assert.equal(h.ingest(at(draft(2, 'c2', '/harness fix the crash'), old)), 'to-router', 'an old call still works')
  assert.equal(h.status().filter['drop:before-speculative'], 2)
  await tick()
  const fresh = new Date().toISOString()
  await tick()
  log.close()

  ;({ log, h } = open(speculative()))
  assert.equal(h.ingest(at(draft(3, 'c3', 'the logo is blurry'), fresh)), 'to-router', 'the turn-on point survives the restart')
  assert.equal(evalOn(h, 3).speculative, true)
  assert.equal(h.ingest(at(draft(4, 'c4', 'the footer is wrong'), old)), 'filtered')
  log.close()

  ;({ log, h } = open(speculative({ speculative: undefined })))
  log.close()
  await tick()
  ;({ log, h } = open(speculative()))
  assert.equal(h.ingest(at(draft(5, 'c5', 'the header is wrong'), fresh)), 'filtered', 'turned off and on again: the new turn-on point counts')
  log.close()
})

test('an old call does not open the thread for good: a later speculative eval, open or decided, gets no reply', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', '/harness ciao'))
  const call = evalOn(h, 1)
  assert.ok(h.reply(`issue:${repo}#1`, 'answer', 'Ciao.', call.eval).ok, 'the call itself may be answered')
  h.decide(call.eval, { kind: 'ignore', reason: 'saluto' })
  assert.ok(h.reply(`issue:${repo}#1`, 'answer', 'Ciao, di nuovo.', call.eval).ok, 'still the latest call: answered after deciding')
  h.ingest(draft(1, 'c2', 'the build crashes on start'))
  const later = evalOn(h, 1)
  assert.equal(later.speculative, true)
  const open = h.reply(`issue:${repo}#1`, 'ack', 'Ci guardo.', later.eval)
  assert.match(String((open as { problem: string }).problem), /post nothing/, 'refused while the speculative eval is open')
  h.decide(later.eval, { kind: 'ignore', reason: 'non ora' })
  const after = h.reply(`issue:${repo}#1`, 'ack', 'Ci guardo dopo.', later.eval)
  assert.match(String((after as { problem: string }).problem), /post nothing/, 'refused after it is decided')
  assert.deepEqual(Object.values(h.pending()).map((p) => p.text), ['Ciao.', 'Ciao, di nuovo.'])
  log.close()
})

test('a call that lands while a speculative eval is open waits for that eval to be decided before any reply', () => {
  const { log, h } = auto(speculative())
  h.ingest(draft(1, 'c1', 'the build crashes on start'))
  const e1 = evalOn(h, 1)
  h.ingest(draft(1, 'c2', '/harness fix the crash'))
  assert.match(String((h.reply(`issue:${repo}#1`, 'ack', 'Ci guardo.') as { problem: string }).problem), /post nothing/)
  h.decide(e1.eval, { ...accept, silent: true })
  assert.ok(h.reply(`issue:${repo}#1`, 'ack', 'Ci guardo.', evalOn(h, 1).eval).ok)
  log.close()
})

test('the board shows the router only the last discarded tickets', () => {
  const { log, h } = auto(speculative({ speculative: { ...DEFAULT_SPECULATIVE, maxPerDay: 20 } }))
  for (let n = 1; n <= 8; n++) {
    h.ingest(draft(n, `c${n}`, `bug numero ${n}`))
    const r = h.decide(evalOn(h, n).eval, { ...accept, silent: true })
    assert.ok(r.ok && r.ticket)
  }
  for (const run of h.planRuns()) h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'verifier-failed', retryable: true, evidence: 'no' } })
  assert.equal(h.attention().filter((i) => i.kind === 'discarded').length, 8, 'Vlad still sees every discard')
  assert.equal(h.next().board.waitingForVlad.filter((i) => i.kind === 'discarded').length, 5)
  log.close()
})
