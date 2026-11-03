import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./check-publish.mjs', import.meta.url))

function repoWith(files, privateTerms) {
  const dir = mkdtempSync(join(tmpdir(), 'check-publish-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (privateTerms) writeFileSync(join(dir, '.git', 'info', 'private-terms'), privateTerms)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  execFileSync('git', ['add', '.'], { cwd: dir })
  return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })
}

test('a clean repo passes', () => {
  const r = repoWith({ 'a.md': 'see ~/src/pstack-claude\n' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /ok \(1 files, 0 private terms\)/)
})

test('a GitHub token fails with file and line', () => {
  const r = repoWith({ 'a.md': 'x\ntoken ghp_' + 'A'.repeat(36) + '\n' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /a\.md:2: GitHub token/)
})

test('a home path fails', () => {
  const r = repoWith({ 'b.ts': `const p = '${['', 'Users', 'someone', 'src'].join('/')}'\n` })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /b\.ts:1: home path/)
})

test('a Claude session path fails in both its path and its dir-name form', () => {
  const tmp = ['', 'private', 'tmp', 'claude-501', 'x'].join('/')
  const r = repoWith({ 'c.log': `cwd=${tmp}\nmemory ~/.claude/projects/${['-private', 'tmp', 'claude-501', 'x'].join('-')}\n` })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /c\.log:1: Claude session path/)
  assert.match(r.stderr, /c\.log:2: Claude session path/)
})

test('a Claude project dir named after a user fails, the placeholder passes', () => {
  const r = repoWith({ 'd.md': `~/.claude/projects/${['-Users', 'someone', 'src'].join('-')}/memory\n~/.claude/projects/-Users-<utente>-src\n` })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /d\.md:1: Claude project dir/)
  assert.doesNotMatch(r.stderr, /d\.md:2:/)
})

test('a personal email fails, commit-trailer and GitHub privacy addresses pass', () => {
  const r = repoWith({ 'e.md': ['Co-Authored-By: Claude <noreply@anthropic.com>', 'by 123+bot@users.noreply.github.com', `author ${['someone', 'example.org'].join('@')}`].join('\n') })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /e\.md:3: email address/)
  assert.doesNotMatch(r.stderr, /e\.md:[12]:/)
})

test('a term from .git/info/private-terms fails in any case', () => {
  const r = repoWith({ 'f.md': 'ok\nsee Acme-Secret/repo\n' }, '# private\nacme-secret => <altro-repo>\nother-term\n')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /f\.md:2: private term "acme-secret"/)
})

test('a file over 1 MB fails', () => {
  const r = repoWith({ 'big.bin': Buffer.alloc(2 * 1024 * 1024, 1) })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /big\.bin: 2\.0 MB, over 1 MB/)
})

test('run from a subdirectory it still checks the whole repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-publish-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'top.md'), 'token ghp_' + 'B'.repeat(36) + '\n')
  writeFileSync(join(dir, 'sub', 'ok.md'), 'fine\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: join(dir, 'sub'), encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /top\.md:1: GitHub token/)
})
