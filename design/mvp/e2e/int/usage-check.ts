import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { usageOfEntries } from '../../../../harness/src/engine.ts'
const A = await import(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@bastani', 'atomic', 'dist', 'index.js'))
const [home, rec] = process.argv.slice(2)
const d = JSON.parse(readFileSync(rec, 'utf8'))
const store = await A.resolveSessionStore(home, { sessionStore: { kind: 'sqlite', path: join(home, 'atomic', 'sessions.sqlite') } })
const entries = (await Promise.all(d.stages.map((x: any) => store.load(x.sessionId).then((s: any) => s.entries)))).flat()
console.log('since 0:', JSON.stringify(usageOfEntries(entries, 0)))
console.log('since startedAt:', JSON.stringify(usageOfEntries(entries, d.startedAt)), 'durationMs', d.pausedAt - d.startedAt)
