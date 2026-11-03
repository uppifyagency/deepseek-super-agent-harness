import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./check-readme.mjs', import.meta.url))
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#g)"/><use href="#a"/></svg>'

function check(files, ...flags) {
  const dir = mkdtempSync(join(tmpdir(), 'check-readme-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return spawnSync(process.execPath, [SCRIPT, dir, ...flags], { encoding: 'utf8' })
}

test('a README whose links and images all resolve passes', () => {
  const r = check({
    'README.md': '![Hero](docs/media/hero.svg)\n<img src="docs/media/hero.svg" alt="Hero">\nSee [the report](docs/REPORT.md#lanes) and [GitHub](https://github.com).\n',
    'docs/media/hero.svg': SVG,
    'docs/REPORT.md': '# r\n',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /check-readme: ok \(4 links\)/)
})

test('a broken link and an image without alt fail with their lines', () => {
  const r = check({ 'README.md': '# t\n[gone](docs/missing.md)\n![](docs/media/hero.svg)\n<img src="docs/media/hero.svg">\n', 'docs/media/hero.svg': SVG })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /README\.md:2: broken link docs\/missing\.md/)
  assert.match(r.stderr, /README\.md:3: image without alt text/)
  assert.match(r.stderr, /README\.md:4: image without alt text/)
})

test('links inside code are not checked', () => {
  const r = check({ 'README.md': '```\n[gone](nowhere.md)\n```\nRun `[x](nowhere.md)`.\n' })
  assert.equal(r.status, 0, r.stderr)
})

test('an SVG that loads an external resource fails', () => {
  const r = check({
    'README.md': '![a](a.svg) ![b](b.svg) ![c](c.svg)\n',
    'a.svg': '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>',
    'b.svg': '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "x.css";</style></svg>',
    'c.svg': '<svg xmlns="http://www.w3.org/2000/svg"><style>text{font-family:url(\'f.woff\')}</style></svg>',
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /a\.svg: loads an external resource \(href or src/)
  assert.match(r.stderr, /b\.svg: loads an external resource \(@import/)
  assert.match(r.stderr, /c\.svg: loads an external resource \(url\(\)/)
})

test('an SVG over 200 KB and a GIF over 5 MB fail', () => {
  const r = check({
    'README.md': '![big](big.svg) ![demo](demo.gif)\n',
    'big.svg': SVG + ' '.repeat(201 * 1024),
    'demo.gif': Buffer.alloc(5 * 1024 * 1024 + 1),
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /big\.svg: \d+ KB, over 200 KB/)
  assert.match(r.stderr, /demo\.gif: \d+ KB, over 5120 KB/)
})

test('pending markers pass by default and fail with --release', () => {
  const files = { 'README.md': 'Run setup. <!-- pending:A5 -->\n' }
  const draft = check(files)
  assert.equal(draft.status, 0, draft.stderr)
  assert.match(draft.stdout, /pending A5/)
  const release = check(files, '--release')
  assert.equal(release.status, 1)
  assert.match(release.stderr, /1 pending markers left \(A5\)/)
})
