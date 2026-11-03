// Unit 4 without Atomic: run.intended from an accepted ticket, engine reports, classify.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLog } from '../src/log.ts'
import { openHarness, VIEWS } from '../src/service.ts'
import { SPECULATIVE_STOP, afterResumeError, budgetNotice, classify, hostInput, openQuestionGates, reportEnded, stopRun, usageOfEntries } from '../src/engine.ts'
import type { StopDeps } from '../src/engine.ts'
import { DEFAULT_BUDGET, DEFAULT_MODELS, DEFAULT_SPECULATIVE, MARKER } from '../src/config.ts'
import type { HarnessConfig } from '../src/config.ts'
import type { Draft, Event, EventId, Repo } from '../src/domain.ts'

const repo = 'uppifyagency/harness-sandbox' as Repo
const config: HarnessConfig = { home: '/tmp', repos: [{ repo, listen: 'explicit', base: 'main' }], allowedActors: ['uppifyagency'], handles: ['/harness'], marker: MARKER, models: DEFAULT_MODELS, budget: DEFAULT_BUDGET, botKeychainService: 'none', maxAttempts: 2, serviceLabel: 'it.delera.harness.test', pstackDir: '/tmp/plugins/pstack', stuckAfterMin: 15 }

const done = { kind: 'done' as const, verdict: { sha: 's' } as never, pr: 1, url: 'u', sha: 's', summary: 'ok', workerSession: 'w' }

function accepted() {
  const log = openLog(join(mkdtempSync(join(tmpdir(), 'runs-')), 'l.sqlite'), VIEWS)
  const h = openHarness(log, config)
  h.setPolicy('auto', 'r1')
  h.ingest({ thread: { kind: 'issue', repo, number: 7 }, native: { id: 'c1', version: 'v1' }, actor: 'uppifyagency', human: true, text: '/harness add a CONTRIBUTING.md', url: 'https://x/c1', createdAt: new Date().toISOString(), correlates: [] })
  const [ev] = h.next().evals
  const d = h.decide(ev.eval, { kind: 'accept', title: 'CONTRIBUTING', scope: 'CONTRIBUTING.md exists' })
  assert.ok(d.ok && d.ticket)
  return { log, h, ticket: d.ok ? d.ticket! : '' }
}

test('an accepted ticket gets exactly one run.intended, with the issue text in the brief and the config frozen in', () => {
  const { log, h, ticket } = accepted()
  const [run] = h.planRuns()
  assert.ok(run)
  assert.deepEqual(h.planRuns(), [], 'planning again adds nothing')
  const { spec, brief } = h.runSpec(run)
  assert.equal(spec.ticket, ticket)
  assert.equal(spec.attempt, 1)
  assert.equal(spec.models.worker, DEFAULT_MODELS.worker)
  assert.match(brief, /add a CONTRIBUTING\.md/)
  assert.match(brief, /Never push/)
  assert.match(brief, /issue:uppifyagency\/harness-sandbox#7/)
  assert.deepEqual(h.liveRuns().map((r) => r.run), [run])
  log.close()
})

test('engine reports: bound, progress, ended closes the run and later reports are dropped', () => {
  const { log, h } = accepted()
  const [run] = h.planRuns()
  h.report(run, { kind: 'bound', atomic: 'a-1' })
  h.report(run, { kind: 'bound', atomic: 'a-1' })
  assert.equal(h.recall(`ticket:${h.runSpec(run).spec.ticket}`)?.next.filter((n) => n.rel === 'run.bound').length, 1, 'the same binding is recorded once')
  h.report(run, { kind: 'progress', stage: 'work', summary: 'completed' })
  h.report(run, { kind: 'ended', outcome: done, usage: { costUsd: 0.4, input: 1, output: 2, cacheRead: 0, turns: 3, durationMs: 9 } })
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'error', retryable: true, evidence: 'late' } })
  assert.deepEqual(h.liveRuns(), [])
  const r = h.runs()[run]
  assert.equal(r.outcome?.kind, 'done')
  assert.equal(r.usage?.costUsd, 0.4)
  assert.deepEqual(h.planRuns(), [], 'a done ticket is not replanned')
  log.close()
})

test('a run Atomic cannot resume is started again as the same attempt: rebound, never ended, no attempt spent', () => {
  const { log, h } = accepted()
  const [run] = h.planRuns()
  h.report(run, { kind: 'bound', atomic: 'a3241828' })
  h.report(run, { kind: 'bound', atomic: 'f019fff8' })
  assert.deepEqual(h.liveRuns().map((r) => [r.run, r.atomic, r.spec.attempt]), [[run, 'f019fff8', 1]], 'the next process resumes the new Atomic run')
  assert.deepEqual(h.planRuns(), [], 'no second attempt is planned')
  log.close()
})

const refusal = (code: string, message: string) => Object.assign(new Error(message), { code })
const zeroProgress = refusal('WORKFLOW_RUN_NOT_RESUMABLE', 'Workflow f019fff8 has no durable checkpoint or pending prompt progress and is not resumable.')

test('afterResumeError: only a run with no progress is started again; a run that may have progress is waited for', () => {
  assert.equal(afterResumeError(zeroProgress, 0, 1, false), 'start-again')
  for (const message of [
    'Workflow f019fff8 is already running or has a pending resume admission.',
    'Workflow "harness-ticket" (f019fff8) is already running in another session. See agents working ...',
    'Workflow f019fff8 changed while resume was pending; refresh the workflow list and try again.',
    'Workflow f019fff8 is paused, not resumable.',
  ]) {
    assert.equal(afterResumeError(refusal('WORKFLOW_RUN_NOT_RESUMABLE', message), 0, 1, false), 'wait', message)
    assert.equal(afterResumeError(refusal('WORKFLOW_RUN_NOT_RESUMABLE', message), 20, 1, false), 'fail', `${message} (after 20 tries)`)
  }
})

test('afterResumeError: the lease and a busy journal are waited out within 20 tries, anything else fails', () => {
  for (const code of ['WORKFLOW_RUN_OWNED_ELSEWHERE', 'WORKFLOW_RUN_STORAGE']) {
    assert.equal(afterResumeError(refusal(code, 'busy'), 0, 1, false), 'wait', code)
    assert.equal(afterResumeError(refusal(code, 'busy'), 20, 1, false), 'fail', `${code}: the lease is ~120 s, 20 x 15 s is plenty`)
  }
  assert.equal(afterResumeError(refusal('WORKFLOW_RUN_CONTROL_FAILED', 'startup failed'), 0, 1, false), 'fail')
  assert.equal(afterResumeError(new Error('boom'), 0, 1, false), 'fail')
})

test('afterResumeError: an attempt binds at most five Atomic runs that die before a checkpoint, then gives up', () => {
  assert.equal(afterResumeError(zeroProgress, 0, 4, false), 'start-again')
  assert.equal(afterResumeError(zeroProgress, 0, 5, false), 'give-up')
})

test('bindings counts the Atomic runs a run was bound to, a repeated binding once', () => {
  const { log, h } = accepted()
  const [run] = h.planRuns()
  assert.equal(h.bindings(run), 0)
  h.report(run, { kind: 'bound', atomic: 'a3241828' })
  h.report(run, { kind: 'bound', atomic: 'a3241828' })
  h.report(run, { kind: 'bound', atomic: 'f019fff8' })
  assert.equal(h.bindings(run), 2)
  log.close()
})

/** The shape getRun returned on 0.9.63 for a completed root (logs/run-6762e913-....json, 02/11). */
const attempt = (outputs: object, status = 'completed') => ({ status: 'completed', result: { attempt: JSON.stringify({ workflow: 'harness-ticket-attempt', status, exited: false, outputs }) } })

test('classify: done, verifier FAIL, no commit, blocked worker, budget stop, failure', () => {
  const ok = classify(attempt({ status: 'done', sha: 's', pr: 5, url: 'u', verdict: JSON.stringify({ sha: 's' }), summary: 'x', workerSession: 'w' }))
  assert.ok(ok.kind === 'done' && ok.pr === 5 && ok.verdict.sha === 's')
  const vf = classify(attempt({ status: 'verifier-failed', sha: 's', evidence: 'README misses the line', workerSession: 'w' }))
  assert.ok(vf.kind === 'failed' && vf.cause === 'verifier-failed' && vf.retryable && vf.sha === 's' && vf.workerSession === 'w')
  const none = classify(attempt({ status: 'no-commit', commits: 0, summary: 'x' }))
  assert.ok(none.kind === 'failed' && none.retryable && /no commit/.test(none.evidence))
  const blocked = classify(attempt({ status: 'blocked', summary: 'need the license holder' }))
  assert.ok(blocked.kind === 'failed' && !blocked.retryable && /license holder/.test(blocked.evidence))
  const shown = classify(attempt({ status: 'blocked', summary: 'scripts/somma-a3.sh is absent' }, 'blocked'))
  assert.ok(shown.kind === 'failed' && /^worker blocked/.test(shown.evidence), 'a worker that finishes blocked also leaves its child blocked (e2e/a3 lane 2): not a budget stop')
  assert.equal(classify(attempt({ status: 'budget_exceeded' }, 'blocked')).kind, 'budget', 'child over budget (e2e/a3 lane 8)')
  assert.equal(classify(attempt({}, 'blocked')).kind, 'budget', 'child over budget returns blocked (E2E S7)')
  assert.equal(classify({ status: 'blocked', failureDisposition: 'active_blocked', result: { status: 'budget_exceeded' } }).kind, 'budget')
  const killed = classify({ status: 'killed' })
  assert.ok(killed.kind === 'failed' && killed.cause === 'stopped')
})

test('two attempts on an existing clone get separate worktrees at the same base; prepare is idempotent', async () => {
  const { execFileSync } = await import('node:child_process')
  const { prepare, inspect } = await import('../src/workspace.ts')
  const root = mkdtempSync(join(tmpdir(), 'ws-'))
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim()
  const origin = join(root, 'origin.git'), seed = join(root, 'seed'), home = join(root, 'home')
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '--quiet', origin, seed])
  g(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'seed')
  g(seed, 'push', '--quiet', 'origin', 'HEAD:main')
  execFileSync('git', ['clone', '--quiet', origin, join(home, 'repos', repo)])      // the clone exists: no gh needed
  const spec = (ticket: string) => ({ ticket, attempt: 1, repo, baseBranch: 'main', brief: { preview: '', length: 0 }, budget: DEFAULT_BUDGET, models: DEFAULT_MODELS }) as never
  const [a, b] = await Promise.all([prepare(home, spec('aaaaaaaaaaaa1')), prepare(home, spec('bbbbbbbbbbbb1'))])
  assert.notEqual(a.worktree, b.worktree)
  assert.equal(a.base, b.base)
  assert.equal(a.base, g(seed, 'rev-parse', 'HEAD'))
  assert.deepEqual(await prepare(home, spec('aaaaaaaaaaaa1')), a, 'preparing again returns the same worktree and base')
  g(a.worktree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'work')
  assert.equal((await inspect(a.worktree, a.base)).commits, 1)
  assert.equal((await inspect(b.worktree, b.base)).commits, 0)
})

test('a verifier FAIL plans attempt 2 that resumes the worker and its commits; attempt 2 failing is final and reported once', () => {
  const { log, h } = accepted()
  const [a1] = h.planRuns()
  h.report(a1, { kind: 'ended', outcome: { kind: 'failed', cause: 'verifier-failed', retryable: true, evidence: 'CONTRIBUTING.md is empty', workerSession: 'w1', sha: 'abc' } })
  assert.equal(h.next().results.length, 0, 'not final: attempt 2 is coming')
  const [a2] = h.planRuns()
  const { spec, brief } = h.runSpec(a2)
  assert.equal(spec.attempt, 2)
  assert.equal(spec.forkFrom, 'w1')
  assert.equal(spec.startFrom, 'abc')
  assert.match(brief, /attempt 2[\s\S]*CONTRIBUTING\.md is empty/)
  assert.deepEqual(h.planRuns(), [], 'one attempt at a time')
  h.report(a2, { kind: 'ended', outcome: { kind: 'failed', cause: 'verifier-failed', retryable: true, evidence: 'still empty', sha: 'def' } })
  assert.deepEqual(h.planRuns(), [], 'maxAttempts 2: no attempt 3')
  const [res] = h.next().results
  assert.equal(res.attempt, 2)
  assert.equal(res.to, 'issue:uppifyagency/harness-sandbox#7')
  assert.equal(h.routerHasWork(), true)
  assert.ok(h.reply(res.to!, 'result', 'Non riuscito: il file resta vuoto.', res.about).ok)
  assert.deepEqual(h.next().results, [], 'reported once')
  log.close()
})

test('verdict: independent only on an untouched worktree; a commit after the verdict blocks publish', async () => {
  const { execFileSync } = await import('node:child_process')
  const { excludeHarnessDirs, inspect, patchId } = await import('../src/workspace.ts')
  const { independentVerdict, verdictStillValid, familyOf } = await import('../src/verify.ts')
  const w = mkdtempSync(join(tmpdir(), 'verdict-'))
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: w, stdio: 'pipe' }).toString().trim()
  g('init', '--quiet', '-b', 'main'); g('commit', '--quiet', '--allow-empty', '-m', 'base')
  const base = g('rev-parse', 'HEAD')
  execFileSync('sh', ['-c', 'echo hello > A.md'], { cwd: w }); g('add', 'A.md'); g('commit', '--quiet', '-m', 'work')
  const head = await inspect(w, base), pid = await patchId(w, base)
  assert.match(pid, /^[0-9a-f]{40}$/)
  const asked = { repo, sha: head.sha, patchId: pid, workerModel: DEFAULT_MODELS.worker, verifierModel: 'opus', dirty: [] }
  const pass = { ok: true, verdict: 'PASS' as const, level: 'inspected' as const, evidence: 'A.md says hello' }
  const v = independentVerdict(pass, asked, { sha: head.sha, dirty: [] })
  assert.ok(v.ok && v.v.sameFamily === false, 'Sol and Opus are different families')
  const edited = independentVerdict(pass, asked, { sha: head.sha, dirty: [' M A.md'] })
  assert.ok(!edited.ok && /^the verifier changed the worktree \( M A\.md\)/.test(edited.why), 'a verifier that edits loses its verdict')
  execFileSync('sh', ['-c', 'mkdir -p .atomic .audit && touch .atomic/run.json .audit/t.tsv forgot.txt'], { cwd: w })
  await excludeHarnessDirs(w)
  await excludeHarnessDirs(w)
  const left = await inspect(w, base)
  assert.deepEqual(left.dirty, ['?? forgot.txt'], 'git ignores exactly .atomic/ and .audit/')
  const forgot = independentVerdict(pass, { ...asked, dirty: left.dirty }, left)
  assert.ok(!forgot.ok && /^the worktree has uncommitted changes \(\?\? forgot\.txt\)/.test(forgot.why), 'a file the worker forgot to commit gets no PASS, and the verifier is not blamed for it')
  const both = independentVerdict(pass, { ...asked, dirty: left.dirty }, { sha: head.sha, dirty: [...left.dirty, ' M A.md'] })
  assert.ok(!both.ok && /^the verifier changed the worktree \( M A\.md\)/.test(both.why), 'the verifier is blamed only for the paths it dirtied')
  execFileSync('rm', ['forgot.txt'], { cwd: w })
  assert.equal(independentVerdict(pass, asked, await inspect(w, base)).ok, true, 'Atomic and pstack leftovers do not cost the verdict')
  assert.equal(independentVerdict({ ...pass, verdict: 'FAIL' }, asked, { sha: head.sha, dirty: [] }).ok, false)
  assert.equal(familyOf('openai-codex/gpt-6.1-sol:high'), 'openai')
  if (!v.ok) return
  assert.equal(verdictStillValid(v.v, { sha: head.sha, patchId: pid }), true)
  execFileSync('sh', ['-c', 'echo late >> A.md'], { cwd: w }); g('commit', '--quiet', '-am', 'after the verdict')
  const later = await inspect(w, base)
  assert.equal(verdictStillValid(v.v, { sha: later.sha, patchId: await patchId(w, base) }), false)
})

const say = (number: number, id: string, text: string) => ({ thread: { kind: 'issue' as const, repo, number }, native: { id, version: 'v1' }, actor: 'uppifyagency', human: true, text, url: `https://x/${id}`, createdAt: new Date().toISOString(), correlates: [] })

test('a comment on the ticket\'s issue during the run is routed in code and delivered once to the live run', () => {
  const { log, h } = accepted()
  const [run] = h.planRuns()
  h.report(run, { kind: 'bound', atomic: 'a' })
  assert.equal(h.ingest(say(7, 'c9', 'usa il titolo "Come contribuire"')), 'to-ticket')
  assert.equal(h.routerHasWork(), false, 'no router turn for a follow-up')
  const [p] = h.pendingInputs(run)
  assert.match(p.text, /Come contribuire/)
  h.report(run, { kind: 'delivered', input: p.input })
  h.report(run, { kind: 'delivered', input: p.input })
  assert.deepEqual(h.pendingInputs(run), [])
  assert.match(h.requirements(run), /add a CONTRIBUTING\.md[\s\S]*later message wins[\s\S]*Come contribuire/, 'the verifier sees the follow-up the worker got')
  log.close()
})

test('after a done run, a comment on the PR starts attempt 2 on the same session and commits, carrying the comment', () => {
  const { log, h } = accepted()
  const [a1] = h.planRuns()
  h.report(a1, { kind: 'ended', outcome: { ...done, pr: 12, sha: 'abc', workerSession: 'w1' } })
  assert.deepEqual(h.planRuns(), [], 'done and nothing new: no attempt')
  assert.equal(h.ingest(say(12, 'r1', 'manca una riga su come eseguire i test')), 'to-ticket', 'the PR thread joined the ticket')
  const [a2] = h.planRuns()
  const { spec, brief } = h.runSpec(a2)
  assert.equal(spec.attempt, 2)
  assert.equal(spec.forkFrom, 'w1')
  assert.equal(spec.startFrom, 'abc')
  assert.match(brief, /New messages[\s\S]*come eseguire i test/)
  assert.deepEqual(h.pendingInputs(a2), [], 'the brief delivered it')
  log.close()
})

test('while a worker question is asked on the issue, a comment answers it and is not routed as new input', () => {
  const { log, h } = accepted()
  const [run] = h.planRuns()
  const g = h.openGate(run, 's', 0, { kind: 'question', audience: 'requester', question: 'A or B?', options: ['A', 'B'] })
  const card = h.next().gates[0]
  h.reply(card.to!, 'ask', 'A o B?', card.about)
  h.ingest(say(7, 'c5', 'B'))
  assert.deepEqual(h.pendingInputs(run), [])
  assert.equal(h.next().gates[0].replies.length, 1)
  h.answer(g.gate, 'B', 'router', 'r')
  h.ingest(say(7, 'c6', 'e aggiungi anche un esempio'))
  assert.equal(h.pendingInputs(run).length, 1, 'once answered, comments are input again')
  log.close()
})

test('slots: with 2 workers, a third ticket waits until a run ends; a run waiting on a gate keeps its slot', () => {
  const log = openLog(join(mkdtempSync(join(tmpdir(), 'slots-')), 'l.sqlite'), VIEWS)
  const h = openHarness(log, config)
  h.setPolicy('auto', 'p', 2)
  for (const n of [11, 12, 13]) {
    h.ingest(say(n, `c${n}`, `/harness task ${n}`))
    const ev = h.next().evals.find((e) => e.thread.endsWith(`#${n}`))!
    h.decide(ev.eval, { kind: 'accept', title: `t${n}`, scope: 's' })
  }
  const planned = h.planRuns()
  assert.equal(planned.length, 3)
  const first = h.runsToStart()
  assert.deepEqual(first, planned.slice(0, 2), 'oldest two first')
  first.forEach((r, i) => h.report(r, { kind: 'bound', atomic: `a${i}` }))
  assert.deepEqual(h.runsToStart(), [], 'both slots taken')
  h.openGate(first[0], 's', 0, { kind: 'question', audience: 'requester', question: 'q?' })
  assert.deepEqual(h.runsToStart(), [], 'a run waiting for an answer still holds its slot')
  h.report(first[1], { kind: 'ended', outcome: done })
  assert.deepEqual(h.runsToStart(), [planned[2]])
  h.setPolicy('auto', 'p2', 1)
  assert.deepEqual(h.runsToStart(), [], 'one worker: the gated run holds the only slot')
  assert.equal(h.status().maxWorkers, 1)
  h.setPolicy('observe', 'p3')
  assert.equal(h.status().maxWorkers, 1, 'changing mode keeps the worker count')
  log.close()
})

test('recall follows a ticket: thread key -> runs and outcomes with readable previews', () => {
  const { log, h, ticket } = accepted()
  const [run] = h.planRuns()
  h.report(run, { kind: 'ended', outcome: { ...done, pr: 9, url: 'https://x/pull/9' } })
  const issue = h.recall('issue:uppifyagency/harness-sandbox#7')!
  assert.match(issue.preview, new RegExp(`ticket ticket:${ticket}`))
  const t = h.recall(`ticket:${ticket}`)!
  assert.deepEqual(t.next.map((n) => n.rel), ['ticket.opened', 'run.intended', 'run.ended'])
  assert.match(t.next[2].preview, /done: PR #9/)
  assert.match(h.recall(t.next[0].id)!.preview, /ticket "CONTRIBUTING"/)
  log.close()
})

test('budget: a stop opens a Sì/No gate in the issue instead of a result; Sì starts the next attempt with the raised cap', () => {
  const { log, h } = accepted()
  const [a1] = h.planRuns()
  h.report(a1, { kind: 'ended', outcome: { kind: 'budget', spentUsd: 0.12, workerSession: 'w1', sha: 'abc' } })
  const [g] = h.next().gates
  assert.ok(g, 'a budget gate for the router to ask')
  assert.equal(g.to, 'issue:uppifyagency/harness-sandbox#7')
  assert.deepEqual(g.options, ['Sì', 'No'])
  assert.match(g.question, /0\.12 \$ su 5\.00 \$.*10\.00 \$/)
  assert.deepEqual(h.next().results, [], 'a budget stop is not a final result')
  assert.deepEqual(h.planRuns(), [], 'no answer yet: nothing starts')
  assert.ok(h.attention().some((i) => i.kind === 'gate'))

  h.answer(g.gate, 'Sì', 'router', 'r')
  const [a2] = h.planRuns()
  const { spec, brief } = h.runSpec(a2)
  assert.equal(spec.attempt, 2)
  assert.equal(spec.budget.maxCostUsd, 10)
  assert.equal(spec.forkFrom, 'w1')
  assert.equal(spec.startFrom, 'abc')
  assert.match(brief, /stopped by its budget after spending \$0\.12/)
  log.close()
})

test('budget: No leaves the ticket idle; a stop that overshot its cap asks for twice the spend', async () => {
  const { budgetGate, saysYes } = await import('../src/runs.ts')
  const spec = { budget: { maxCostUsd: 0.05, maxDurationMs: 1 }, attempt: 1 } as never
  assert.equal(budgetGate(spec, 0.12).raise!.maxCostUsd, 0.24)
  assert.equal(saysYes('sì, continua'), true)
  assert.equal(saysYes('Si'), true)
  assert.equal(saysYes('no grazie'), false)
  const { log, h } = accepted()
  const [a1] = h.planRuns()
  h.report(a1, { kind: 'ended', outcome: { kind: 'budget', spentUsd: 1 } })
  h.answer(h.next().gates[0].gate, 'No', 'human', 'r')
  assert.deepEqual(h.planRuns(), [])
  assert.deepEqual(h.next().gates, [])
  log.close()
})

const specConfig: HarnessConfig = { ...config, repos: [{ repo, listen: 'candidates', base: 'main', speculative: DEFAULT_SPECULATIVE }] }

function silent(maxWorkers: 1 | 2 | 3 = 2) {
  const log = openLog(join(mkdtempSync(join(tmpdir(), 'silent-')), 'l.sqlite'), VIEWS)
  const h = openHarness(log, specConfig)
  h.setPolicy('auto', 'r1', maxWorkers)
  h.ingest(say(7, 'c1', 'il README ha un link rotto'))
  const [ev] = h.next().evals
  const d = h.decide(ev.eval, { kind: 'accept', title: 'Fix README link', scope: 'the link resolves', silent: true })
  assert.ok(d.ok && d.ticket)
  const [run] = h.planRuns()
  return { log, h, ticket: d.ok ? d.ticket! : '', run }
}
async function homeWithClone(): Promise<string> {
  const { execFileSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'home-'))
  const origin = join(root, 'origin.git'), seed = join(root, 'seed'), home = join(root, 'home')
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '--quiet', origin, seed], { stdio: 'pipe' })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], { cwd: seed })
  execFileSync('git', ['push', '--quiet', 'origin', 'HEAD:main'], { cwd: seed, stdio: 'pipe' })
  execFileSync('git', ['clone', '--quiet', origin, join(home, 'repos', repo)], { stdio: 'pipe' })
  return home
}

function fakeWorkflows(o: { refuse?: true } = {}) {
  const quits: string[] = []
  const workflows: StopDeps['workflows'] = {
    async quit(atomic) { if (o.refuse) throw new Error('run is not active'); quits.push(atomic); return { status: 'paused' } },
  }
  const usage = async () => ({ costUsd: 0.07, input: 900, output: 120, cacheRead: 300, turns: 3, durationMs: 42_000 })
  return { quits, workflows, usage }
}
const endedOf = (log: ReturnType<typeof openLog>, run: string) => log.read.effects(run as EventId).find((e) => e.kind === 'run.ended') as Event<'run.ended'> | undefined

const kinds = (h: ReturnType<typeof openHarness>, ticket: string) => h.recall(`ticket:${ticket}`)!.next.map((n) => n.rel)

test('silent FAIL: no reply, the ticket is discarded with a DISCARDED item, no second attempt', () => {
  const { log, h, ticket, run } = silent()
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'verifier-failed', retryable: true, evidence: 'link still broken', sha: 'abc' } })
  assert.deepEqual(h.pending(), {})
  assert.deepEqual(h.next().results, [])
  assert.deepEqual(h.planRuns(), [], 'one attempt only')
  assert.ok(kinds(h, ticket).includes('ticket.closed'))
  assert.deepEqual(h.attention(), [{ kind: 'discarded', ticket, reason: 'verifier-failed', thread: `issue:${repo}#7`, title: 'Fix README link' }])
  assert.deepEqual(h.next().board.openTickets, [])
  assert.equal(h.ingest(say(7, 'c2', 'nessuna novita')), 'to-ticket', 'inert input to the closed ticket, no new speculation')
  assert.deepEqual(h.planRuns(), [])
  assert.equal(h.ingest(say(7, 'c3', '/harness sistemalo tu')), 'to-router', 'calling the harness there is a fresh request')
  assert.ok(h.reply(`issue:${repo}#7`, 'answer', 'Non ho trovato il problema.').ok, 'the router may answer a call there, even before a new ticket')
  log.close()
})

test('silent budget stop: discarded, no budget gate', () => {
  const { log, h, ticket, run } = silent()
  h.report(run, { kind: 'ended', outcome: { kind: 'budget', spentUsd: 1.2 } })
  assert.deepEqual(h.next().gates, [])
  assert.ok(!kinds(h, ticket).includes('gate.opened'))
  assert.deepEqual(h.attention().map((i) => [i.kind, 'reason' in i ? i.reason : '']), [['discarded', 'budget']])
  assert.deepEqual(h.planRuns(), [])
  log.close()
})

test('a question in a silent ticket discards it: no gate.opened, no gate card for the router', () => {
  const { log, h, ticket, run } = silent()
  const g = h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?', options: ['A', 'B'] })
  assert.equal(g.discarded, true)
  assert.equal(h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?', options: ['A', 'B'] }).discarded, true, 're-ask after resume')
  assert.deepEqual(h.next().gates, [])
  const k = kinds(h, ticket)
  assert.ok(!k.includes('gate.opened'))
  assert.equal(k.filter((x) => x === 'ticket.closed').length, 1)
  assert.deepEqual(h.attention().map((i) => 'reason' in i && i.reason), ['question: Quale link?'])
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'killed' } })
  assert.equal(kinds(h, ticket).filter((x) => x === 'ticket.closed').length, 1, 'closing a closed ticket writes nothing')
  assert.equal(h.ticketOf(run).closed, 'discarded')
  log.close()
})

test('silent done: the speculative brief and budget, then exactly one comment with the link, and the ticket is visible after', () => {
  const { log, h, ticket, run } = silent()
  const { spec, brief } = h.runSpec(run)
  assert.match(brief, /This ticket is speculative/)
  assert.deepEqual(spec.budget, DEFAULT_SPECULATIVE.budget)
  h.report(run, { kind: 'ended', outcome: { ...done, pr: 21, url: 'https://github.com/x/pull/21' } })
  const out = Object.values(h.pending())
  assert.equal(out.length, 1)
  assert.equal(out[0].text, 'Ho preparato una correzione in anticipo: https://github.com/x/pull/21')
  assert.equal(out[0].purpose, 'result')
  assert.deepEqual(h.next().results, [], 'the router does not report it again')
  assert.equal(h.next().board.openTickets[0].visibility, 'visible')
  assert.ok(kinds(h, ticket).includes('ticket.promoted'))
  assert.ok(h.reply(`issue:${repo}#7`, 'answer', 'Ok.').ok, 'an ordinary ticket from now on')
  assert.equal(h.ingest(say(21, 'r1', 'manca un test')), 'to-ticket')
  assert.equal(h.runSpec(h.planRuns()[0]).spec.attempt, 2)
  log.close()
})

test('/harness on a silent ticket promotes it: ack, the message reaches the worker, a later question is a normal gate', () => {
  const { log, h, run } = silent()
  assert.match(h.ticketOf(run).title, /^\[speculativa\] Fix README link$/)
  assert.equal(h.ingest(say(7, 'c2', '/harness si, usa il link nuovo')), 'to-ticket')
  assert.deepEqual(Object.values(h.pending()).map((p) => [p.purpose, p.text]), [['ack', "Ci stavo gia' lavorando in anticipo. Da ora seguo questo ticket qui: ti scrivo quando la PR e' pronta."]])
  assert.match(h.pendingInputs(run)[0].text, /usa il link nuovo/)
  assert.equal(h.ticketOf(run).title, 'Fix README link')
  const g = h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  assert.equal(g.discarded, undefined)
  assert.equal(h.next().gates[0].gate, g.gate)
  assert.equal(h.routerHasWork(), true)
  log.close()
})

test('runsToStart starts a visible run before an older silent one', () => {
  const { log, h, run } = silent(1)
  h.ingest(say(8, 'c8', '/harness aggiungi una LICENSE'))
  const ev = h.next().evals.find((e) => e.thread.endsWith('#8'))!
  h.decide(ev.eval, { kind: 'accept', title: 'LICENSE', scope: 'MIT' })
  const [visible] = h.planRuns()
  assert.deepEqual(h.runsToStart(), [visible])
  h.report(visible, { kind: 'bound', atomic: 'a1' })
  h.report(visible, { kind: 'ended', outcome: done })
  assert.deepEqual(h.runsToStart(), [run])
  log.close()
})

test('a question in a silent ticket tells the worker to stop, and a run that ends that way pays no verifier', async () => {
  const { log, h, run } = silent()
  assert.equal(openQuestionGates(h, run, 'work', [{ question: 'Quale link?', options: [] }]), 'discarded')
  assert.equal(h.ticketOf(run).closed, 'discarded')
  const input = hostInput(() => {}, async (o) => o.questions.map(() => SPECULATIVE_STOP))
  assert.deepEqual(await input.questionnaire({ questions: [{ question: 'Quale link?', options: [{ label: 'A' }] }] }, {}), { cancelled: false, answers: [{ questionIndex: 0, question: 'Quale link?', kind: 'custom', answer: SPECULATIVE_STOP }] })
  assert.equal(await input.input('Quale link?', '', {}), SPECULATIVE_STOP)
  log.close()
})

test('a silent ticket discarded while the engine lost its run still frees the worktree', async () => {
  const { existsSync } = await import('node:fs')
  const { prepare } = await import('../src/workspace.ts')
  const home = await homeWithClone()
  const { log, h, run } = silent()
  const ws = await prepare(home, h.runSpec(run).spec)
  assert.ok(existsSync(ws.worktree))
  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  await reportEnded(h, home, config.maxAttempts, () => {}, run, { kind: 'failed', cause: 'error', retryable: true, evidence: 'engine lost the run: boom' })
  assert.deepEqual(h.liveRuns(), [])
  assert.equal(existsSync(ws.worktree), false, 'the closed ticket has no worktree left')
  log.close()
})

test('a silent run started again before its first checkpoint stays silent on one attempt; once its ticket is discarded it is not started again', () => {
  const { log, h, ticket, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a3241828' })
  assert.equal(afterResumeError(zeroProgress, 0, h.bindings(run), h.ticketOf(run).closed !== undefined), 'start-again')
  h.report(run, { kind: 'bound', atomic: 'f019fff8' })
  assert.deepEqual(h.liveRuns().map((r) => [r.run, r.atomic, r.spec.attempt]), [[run, 'f019fff8', 1]])
  assert.deepEqual(h.planRuns(), [], 'no second attempt')
  assert.match(h.runSpec(run).brief, /This ticket is speculative/)
  assert.deepEqual(h.runSpec(run).spec.budget, DEFAULT_SPECULATIVE.budget)
  assert.equal(h.routerHasWork(), false)
  assert.deepEqual(h.pending(), {})

  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  assert.equal(afterResumeError(zeroProgress, 0, h.bindings(run), h.ticketOf(run).closed !== undefined), 'give-up', 'a discarded ticket has nothing to start again')
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'error', retryable: false, evidence: '2 Atomic runs of this attempt ended before their first checkpoint' } })
  assert.deepEqual(h.planRuns(), [])
  assert.deepEqual(h.pending(), {})
  assert.equal(h.routerHasWork(), false)
  assert.equal(kinds(h, ticket).filter((k) => k === 'ticket.closed').length, 1)
  assert.deepEqual(h.attention().map((i) => 'reason' in i && i.reason), ['question: Quale link?'])
  log.close()
})

test('a select in a silent ticket is cancelled, never answered with its first option', async () => {
  const input = hostInput(() => {}, async (o) => o.questions.map(() => SPECULATIVE_STOP))
  assert.equal(await input.select('Allow the change?', ['Yes', 'No'], {}), undefined)
  const human = hostInput(() => {}, async () => ['No'])
  assert.equal(await human.select('Allow the change?', ['Yes', 'No'], {}), 'No', 'a real answer still goes through')
})

test('/harness while the silent run is queued: the run starts as a normal ticket, with the visible budget and brief', () => {
  const { log, h, run } = silent()
  assert.equal(h.ingest(say(7, 'c2', '/harness si, sistemalo')), 'to-ticket')
  const [again] = h.planRuns()
  assert.ok(again && again !== run, 'the queued speculative run is planned again')
  const { spec, brief } = h.runSpec(again)
  assert.equal(spec.attempt, 1)
  assert.deepEqual(spec.budget, DEFAULT_BUDGET)
  assert.doesNotMatch(brief, /This ticket is speculative/)
  assert.match(brief, /si, sistemalo/)
  assert.deepEqual(h.liveRuns().map((r) => r.run), [again])
  assert.deepEqual(h.runsToStart(), [again])
  assert.deepEqual(h.pendingInputs(again), [], 'the message is in the brief, not steered in again')
  assert.deepEqual(h.planRuns(), [])
  log.close()
})

test('/harness while the silent run is live: the steer tells the worker it is a normal ticket now', () => {
  const { log, h, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a1' })
  h.ingest(say(7, 'c2', '/harness si, sistemalo'))
  assert.deepEqual(h.planRuns(), [], 'a live run is not replaced')
  const [steer] = h.pendingInputs(run)
  assert.match(steer.text, /no longer speculative/)
  assert.match(steer.text, /si, sistemalo/)
  log.close()
})

test('a budget stop of a silent ticket notifies nothing; a visible one asks to answer in the issue', () => {
  const s = silent()
  assert.equal(budgetNotice(s.h.ticketOf(s.run), 1.2), undefined)
  s.log.close()
  const v = accepted()
  const [run] = v.h.planRuns()
  assert.match(String(budgetNotice(v.h.ticketOf(run), 1.2)), /1\.20 \$: rispondi nell'issue se continuare/)
  v.log.close()
})

test('a discarded ticket with a live run is stopped, never resumed', () => {
  const { log, h, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a1' })
  assert.deepEqual(h.runsToStop(), [])
  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?', options: ['A', 'B'] })
  assert.deepEqual(h.runsToStop(), [run])
  assert.deepEqual(h.liveRuns(), [], 'a restarted daemon does not resume it')
  assert.deepEqual(h.runsToStart(), [])
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'quit in Atomic: paused' } })
  assert.deepEqual(h.runsToStop(), [])
  assert.deepEqual(h.planRuns(), [])
  log.close()
})

test('engine.stop on a discarded ticket: one quit in Atomic, the run ends failed/stopped with its usage, the worktree is gone', async () => {
  const { existsSync } = await import('node:fs')
  const { prepare } = await import('../src/workspace.ts')
  const home = await homeWithClone()
  const { log, h, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a1' })
  const ws = await prepare(home, h.runSpec(run).spec)
  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  const { quits, workflows, usage } = fakeWorkflows()
  const deps: StopDeps = { host: h, home, maxAttempts: config.maxAttempts, note: () => {}, workflows, usage, quitting: new Set() }
  assert.deepEqual(h.runsToStop(), [run])
  assert.equal(await stopRun(deps, run, 'a1'), 'quit')
  assert.deepEqual(quits, ['a1'])
  const ended = endedOf(log, run)
  assert.deepEqual(ended?.body.outcome, { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'ticket discarded, quit in Atomic: paused' })
  assert.equal(ended?.body.usage?.costUsd, 0.07, 'the cost of a stopped run reaches the log')
  assert.equal(existsSync(ws.worktree), false)
  assert.deepEqual(h.runsToStop(), [])
  assert.equal(await stopRun(deps, run, 'a1'), 'pending', 'a second lap does not quit again')
  assert.deepEqual(quits, ['a1'])
  log.close()
})

test('engine.stop: a run no process runs ends without a quit; a refused quit ends nothing', async () => {
  const { log, h, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a1' })
  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  const refused = fakeWorkflows({ refuse: true })
  const deps: StopDeps = { host: h, home: mkdtempSync(join(tmpdir(), 'stop-')), maxAttempts: config.maxAttempts, note: () => {}, workflows: refused.workflows, usage: refused.usage, quitting: new Set() }
  assert.equal(await stopRun(deps, run, 'a1'), 'refused')
  assert.equal(endedOf(log, run), undefined)
  assert.deepEqual(h.runsToStop(), [run], 'tried again next lap')
  assert.equal(await stopRun(deps, run, undefined), 'ended')
  assert.deepEqual(endedOf(log, run)?.body.outcome, { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'ticket discarded while no process ran it' })
  log.close()
})

test('the usage of a stage quit mid-turn is the sum of its assistant turns since the run started', () => {
  const turn = (at: string, cost: number, input: number) => ({ type: 'message', timestamp: at, message: { role: 'assistant', usage: { input, output: 10, cacheRead: 5, cost: { total: cost } } } })
  const entries = [
    turn('2026-11-02T21:30:00.000Z', 0.5, 1000),
    { type: 'message', timestamp: '2026-11-02T21:40:58.000Z', message: { role: 'user', content: 'brief' } },
    turn('2026-11-02T21:40:59.352Z', 0.054, 25806),
    { type: 'message', timestamp: '2026-11-02T21:41:00.000Z', message: { role: 'toolResult' } },
    turn('2026-11-02T21:41:05.000Z', 0.036, 15074),
  ]
  const u = usageOfEntries(entries, Date.parse('2026-11-02T21:40:36.417Z'))
  assert.deepEqual(u && { ...u, costUsd: Math.round(u.costUsd * 1000) / 1000 }, { costUsd: 0.09, input: 40880, output: 20, cacheRead: 10, turns: 2, durationMs: 0 }, 'a forked parent turn before the run is not counted')
  assert.equal(usageOfEntries(entries.slice(1, 2), 0), undefined)
})

test('a closed ticket keeps the engine reason over an older watchdog stop the run had moved past', () => {
  const { log, h, run } = silent()
  h.report(run, { kind: 'bound', atomic: 'a1' })
  log.transact((read) => [{ thread: read.event(run as string as EventId)!.thread, kind: 'stop.intended', by: 'daemon', cause: [run as string as EventId], body: { run, reason: 'watchdog stuck: old' } } as Draft<'stop.intended'>])
  h.openGate(run, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale link?' })
  h.report(run, { kind: 'ended', outcome: { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'ticket discarded, quit in Atomic: paused' } })
  assert.deepEqual(endedOf(log, run)?.body.outcome, { kind: 'failed', cause: 'stopped', retryable: false, evidence: 'ticket discarded, quit in Atomic: paused' })
  log.close()
})
