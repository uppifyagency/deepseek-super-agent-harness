import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./scrub-paths.mjs', import.meta.url))
const scrub = (cwd) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })

test('session paths and private terms are rewritten, and a second run changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrub-paths-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, '.git', 'info', 'private-terms'), 'acme-secret\nacme-secret/crm => <altro-repo>\nsomeone => <utente>\n')
  const project = ['-Users', 'someone', 'proj'].join('-')
  const tmp = ['', 'private', 'tmp', 'claude-501', project, '7d50fc69-ec8a-489d-9134-2093aabd7010', 'scratchpad', 'x.ts'].join('/')
  writeFileSync(join(dir, 'a.log'), `at ${tmp}:3\nmemory ~/.claude/projects/${project}/memory/\nrepo acme-secret/crm by someone\n`)
  execFileSync('git', ['add', '.'], { cwd: dir })

  assert.match(scrub(dir).stdout, /1 files changed/)
  assert.equal(readFileSync(join(dir, 'a.log'), 'utf8'),
    'at <sessione>/scratchpad/x.ts:3\nmemory ~/.claude/projects/<sessione>/memory/\nrepo <altro-repo> by <utente>\n')
  assert.match(scrub(dir).stdout, /0 files changed/)
})
