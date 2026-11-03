#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { readPrivateTerms } from './private-terms.mjs'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inRepo = new RegExp(escape(root + '/') + `([^'"\`\\s)]*)`, 'g')
const home = /\/Users\/[^/\s'"`]+\//g
const session = /\/private\/tmp\/claude-\d+\/-[^/\s'"`]+/g
const projectDir = /(?:-private-tmp-claude-\d+-)?-Users-[A-Za-z0-9][^/\s'"`]*/g
const terms = readPrivateTerms(root).filter((t) => t.replacement !== undefined)

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
let changed = 0
for (const file of files) {
  const path = resolve(root, file)
  if (!lstatSync(path).isFile()) continue
  const before = readFileSync(path)
  if (before.includes(0)) continue
  const resolvesRelativeToFile = /\.(ts|mjs|js)$/.test(file)
  const after = before.toString('utf8')
    .replace(inRepo, (_, rest) => {
      if (!resolvesRelativeToFile) return rest || '.'
      const rel = relative(dirname(path), resolve(root, rest))
      return rel.startsWith('.') ? rel : './' + rel
    })
    .replace(session, '<sessione>')
    .replace(projectDir, '<sessione>')
    .replace(/<sessione>\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<sessione>')
    .replace(home, '~/')
  const scrubbed = terms.reduce((text, { term, replacement }) => text.replaceAll(term, replacement), after)
  if (scrubbed !== before.toString('utf8')) { writeFileSync(path, scrubbed); changed++; console.log(`scrubbed ${file}`) }
}
console.log(`scrub-paths: ${changed} files changed`)
