// lock-stress.ts <launchd.ts> <processes> <trials>

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

const [launchd, procs, trials] = [resolve(process.argv[2]), Number(process.argv[3]), Number(process.argv[4])]
const bin = mkdtempSync(join(tmpdir(), 'lock-stress-bin-'))
const cli = join(bin, 'cli.ts')
writeFileSync(cli, `import { takeRunLock } from ${JSON.stringify(launchd)}
const at = Number(process.argv.at(-2))
while (Date.now() < at) {}
const r = takeRunLock(process.argv.at(-1))
console.log(r.ok ? 'held' : 'refused ' + r.holder)
setInterval(() => {}, 1000)
`)

function child(home: string, at: number): { c: ChildProcess; line: Promise<string> } {
  const c = spawn(process.execPath, [cli, 'run', String(at), home], { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  c.stderr!.on('data', (d) => { err += d })
  const line = new Promise<string>((ok) => {
    c.stdout!.once('data', (d) => ok(String(d).trim()))
    c.once('exit', (code) => ok(`exited ${code}: ${err.split('\n').find((l) => /Error/.test(l))?.trim()}`))
  })
  return { c, line }
}
const dead = (c: ChildProcess) => new Promise((r) => {
  if (c.exitCode !== null || c.signalCode !== null) return r(undefined)
  c.once('exit', r)
  c.kill('SIGKILL')
})

let doubles = 0, none = 0
const counts: number[] = []
for (let t = 1; t <= trials; t++) {
  const home = mkdtempSync(join(tmpdir(), 'lock-stress-home-'))
  const first = child(home, 0)
  if ((await first.line) !== 'held') throw new Error('the first holder did not take the lock')
  await dead(first.c)
  const at = Date.now() + 1500
  const racers = Array.from({ length: procs }, () => child(home, at))
  const lines = await Promise.all(racers.map((r) => r.line))
  const held = lines.filter((l) => l === 'held').length
  counts.push(held)
  if (held > 1) doubles++
  if (held === 0) none++
  console.log(`trial ${t}: ${held} held; ${lines.filter((l) => l !== 'held').join(' | ')}`)
  await Promise.all(racers.map((r) => dead(r.c)))
}
console.log(`${procs} processes x ${trials} trials: double holds ${doubles}, no holder ${none}, holders per trial ${JSON.stringify(counts)}`)
process.exitCode = doubles || none ? 1 : 0
