// verify.ts: "done means verified" (unit 6). A fresh `claude -p` with Opus checks the worker's commits
// and returns a structured verdict. It never wrote the code (Sol did), so the verdict is independent.
//
// The verifier runs with cwd = the harness home (project settings of the harness, not of the repo under
// test: a repo's .claude/ could carry hooks) and reaches the worktree with --add-dir. Its tools are read
// and search plus Bash, so it can run the tests; "no edits" is enforced after the fact: a verdict counts
// only if the worktree has the same head and no changes once the verifier exits.

import { execFile } from 'node:child_process'
import type { IndependentVerdict, Repo } from './domain.ts'

export interface VerifierRun {
  ok: boolean                                   // the process ran and returned a verdict
  verdict?: 'PASS' | 'FAIL'
  level?: IndependentVerdict['verdict']
  evidence: string
  costUsd?: number
  sessionId?: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: ['PASS', 'FAIL'] },
    level: { enum: ['unit-test-verified', 'live-ui-verified', 'inspected'], description: 'unit-test-verified: you ran tests that exercise the change; live-ui-verified: you drove the real UI; inspected: the change has nothing to run (docs, config) and you checked it by reading' },
    evidence: { type: 'string', description: 'What you ran or read and what you saw. If FAIL: exactly what is wrong, so the next attempt can fix it.' },
  },
  required: ['verdict', 'level', 'evidence'],
  additionalProperties: false,
}

const SYSTEM = `You are the VERIFIER of Vlad's harness. Another model wrote the commits you check; you did not.
Judge whether the commits do what the ticket asks, completely and correctly, and nothing else. Run what can be run (tests, the program); read what cannot.
You must not change anything: no edits, no new files, no commits, no git checkout/reset/stash, no installs that write into the worktree. A verdict from a modified worktree is discarded.
Answer with the structured verdict: PASS only when you would merge it yourself.`

export function verifierPrompt(o: { worktree: string; base: string; sha: string; brief: string }): string {
  return [
    `Worktree to verify: ${o.worktree}`,
    `Commits: ${o.base}..${o.sha} (inspect with git -C "${o.worktree}" log/diff/show).`,
    '',
    'The ticket as it stands: the request the worker received, plus any later messages from the requester:',
    o.brief,
  ].join('\n')
}

/** Never throws: a failed process is a run with ok=false and the error as evidence. */
export function runVerifier(o: { home: string; worktree: string; base: string; sha: string; brief: string; model: string; pstackDir: string; timeoutMs?: number }): Promise<VerifierRun> {
  const args = [
    '-p', verifierPrompt(o),
    '--model', o.model, '--effort', 'medium',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--append-system-prompt', SYSTEM,
    '--setting-sources', 'project',
    '--plugin-dir', o.pstackDir,
    '--strict-mcp-config',
    '--add-dir', o.worktree,
    '--tools', 'Read,Grep,Glob,Bash',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash',
  ]
  return new Promise((resolve) => {
    execFile('claude', args, { cwd: o.home, timeout: o.timeoutMs ?? 20 * 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      let r: { session_id?: string; total_cost_usd?: number; is_error?: boolean; result?: string; structured_output?: { verdict?: string; level?: string; evidence?: string } } = {}
      try { r = JSON.parse(stdout) } catch { /* not JSON */ }
      let v = r.structured_output
      if (!v && r.result) { try { v = JSON.parse(r.result) } catch { /* free text */ } }
      const ok = !err && r.is_error !== true && (v?.verdict === 'PASS' || v?.verdict === 'FAIL')
      resolve({
        ok,
        verdict: ok ? v!.verdict as 'PASS' | 'FAIL' : undefined,
        level: ok ? (v!.level as VerifierRun['level']) ?? 'inspected' : undefined,
        evidence: ok ? String(v!.evidence ?? '') : `verifier did not return a verdict: ${(r.result ?? String(stderr || err || '')).slice(0, 1500)}`,
        costUsd: r.total_cost_usd, sessionId: r.session_id,
      })
    }).stdin?.end()
  })
}

/** Provider family: "openai-codex/gpt-6.1-sol:high" -> openai; "opus" or "anthropic/claude-..." -> anthropic. */
export function familyOf(model: string): string {
  const m = model.toLowerCase()
  if (/^(opus|sonnet|haiku|fable)\b|claude|anthropic/.test(m)) return 'anthropic'
  if (/openai|gpt|codex/.test(m)) return 'openai'
  return m.split('/')[0]
}

/**
 * The only constructor of IndependentVerdict. Refuses: no verdict, FAIL, a dirty worktree (blamed on the
 * verifier only for paths that were clean when it was asked), a head that is not the commit it was asked about.
 */
export function independentVerdict(
  run: VerifierRun,
  asked: { repo: Repo; sha: string; patchId: string; workerModel: string; verifierModel: string; dirty: readonly string[] },
  after: { sha: string; dirty: readonly string[] },
): { ok: true; v: IndependentVerdict } | { ok: false; why: string } {
  if (!run.ok) return { ok: false, why: run.evidence }
  if (after.sha !== asked.sha) return { ok: false, why: `the verifier moved HEAD from ${asked.sha} to ${after.sha}: verdict discarded` }
  const added = after.dirty.filter((p) => !asked.dirty.includes(p))
  if (added.length) return { ok: false, why: `the verifier changed the worktree (${added.slice(0, 5).join(', ')}): verdict discarded` }
  if (after.dirty.length) return { ok: false, why: `the worktree has uncommitted changes (${after.dirty.slice(0, 5).join(', ')}): verdict discarded` }
  if (run.verdict !== 'PASS') return { ok: false, why: run.evidence }
  return {
    ok: true,
    v: {
      repo: asked.repo, sha: asked.sha, patchId: asked.patchId, verdict: run.level ?? 'inspected', evidence: run.evidence,
      workerModel: asked.workerModel, verifierModel: asked.verifierModel,
      sameFamily: familyOf(asked.workerModel) === familyOf(asked.verifierModel),
    } as IndependentVerdict,
  }
}

/** Checked again inside publish, right before the push: a commit after the verdict blocks publishing. */
export function verdictStillValid(v: IndependentVerdict, head: { sha: string; patchId: string }): boolean {
  return v.sha === head.sha && v.patchId === head.patchId
}
