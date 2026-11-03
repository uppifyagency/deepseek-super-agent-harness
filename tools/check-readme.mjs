#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KB = 1024
const LIMITS = { '.svg': 200 * KB, '.gif': 5 * KB * KB }
const EXTERNAL_IN_SVG = [
  [/\b(?:href|src)\s*=\s*["'](?!#)/i, 'href or src outside the file'],
  [/url\(\s*(?!["']?#)/i, 'url() outside the file'],
  [/@import/i, '@import'],
]

const args = process.argv.slice(2)
const release = args.includes('--release')
const root = resolve(args.find(a => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const readme = join(root, 'README.md')

const prose = readFileSync(readme, 'utf8')
  .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, block => block.replace(/[^\n]/g, ''))
  .replace(/`[^`\n]*`/g, '')

const lineOf = index => prose.slice(0, index).split('\n').length
const refs = []
for (const m of prose.matchAll(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
  refs.push({ image: m[1] === '!', alt: m[2].trim(), target: m[3], line: lineOf(m.index) })
}
for (const m of prose.matchAll(/<img\b[^>]*>/gi)) {
  const alt = /\balt\s*=\s*"([^"]*)"/i.exec(m[0])
  const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(m[0])
  refs.push({ image: true, alt: alt ? alt[1].trim() : '', target: src ? src[1] : '', line: lineOf(m.index) })
}
for (const m of prose.matchAll(/<(?:a\b[^>]*\bhref|source\b[^>]*\bsrcset)\s*=\s*"([^"]*)"/gi)) {
  refs.push({ image: false, alt: '', target: m[1], line: lineOf(m.index) })
}

const problems = []
for (const { image, alt, target, line } of refs) {
  if (image && !alt) problems.push(`README.md:${line}: image without alt text (${target})`)
  if (!target || /^(?:[a-z]+:|#)/i.test(target)) continue
  const file = resolve(root, decodeURIComponent(target.replace(/[?#].*$/, '')))
  if (!existsSync(file)) { problems.push(`README.md:${line}: broken link ${target}`); continue }
  const limit = LIMITS[extname(file).toLowerCase()]
  if (!limit) continue
  const size = statSync(file).size
  const name = relative(root, file)
  if (size > limit) problems.push(`${name}: ${Math.ceil(size / KB)} KB, over ${limit / KB} KB`)
  if (extname(file).toLowerCase() !== '.svg') continue
  const svg = readFileSync(file, 'utf8')
  for (const [re, what] of EXTERNAL_IN_SVG) if (re.test(svg)) problems.push(`${name}: loads an external resource (${what})`)
}

const pending = [...readFileSync(readme, 'utf8').matchAll(/<!--\s*pending:([\w-]+)/g)].map(m => m[1])
const pendingNote = pending.length ? `, pending ${[...new Set(pending)].join(' ')}` : ''
if (release && pending.length) problems.push(`README.md: ${pending.length} pending markers left (${[...new Set(pending)].join(' ')})`)

for (const p of problems) console.error(p)
if (problems.length) { console.error(`check-readme: ${problems.length} problems`); process.exit(1) }
console.log(`check-readme: ok (${refs.length} links${pendingNote})`)
