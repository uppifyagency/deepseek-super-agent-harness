#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPrivateTerms } from './private-terms.mjs'

const MAX_BYTES = 1024 * 1024
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const PUBLIC_EMAIL = /^(?:noreply@anthropic\.com|[A-Za-z0-9.+-]+@users\.noreply\.github\.com)$/i

const RULES = [
  [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/sk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\/Users\/[^/\s'"`]+\//, 'home path (use ~/)'],
  [/[/-]tmp[/-]claude-\d+[/-]/, 'Claude session path (use <sessione>)'],
  [/-Users-[A-Za-z0-9]/, 'Claude project dir (use <sessione>)'],
  [{ test: (line) => [...line.matchAll(EMAIL)].some(([m]) => !PUBLIC_EMAIL.test(m)) }, 'email address'],
]

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const terms = readPrivateTerms(root)
const rules = [...RULES, ...terms.map(({ term }) => [{ test: (line) => line.toLowerCase().includes(term.toLowerCase()) }, `private term "${term}"`])]
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const problems = []
for (const file of files) {
  const stat = lstatSync(join(root, file))
  if (!stat.isFile()) continue
  const size = stat.size
  if (size > MAX_BYTES) { problems.push(`${file}: ${(size / MAX_BYTES).toFixed(1)} MB, over 1 MB`); continue }
  const text = readFileSync(join(root, file))
  if (text.includes(0)) continue
  text.toString('utf8').split('\n').forEach((line, i) => {
    for (const [re, what] of rules) if (re.test(line)) problems.push(`${file}:${i + 1}: ${what}`)
  })
}

for (const p of problems) console.error(p)
if (problems.length) { console.error(`check-publish: ${problems.length} problems`); process.exit(1) }
console.log(`check-publish: ok (${files.length} files, ${terms.length} private terms)`)
