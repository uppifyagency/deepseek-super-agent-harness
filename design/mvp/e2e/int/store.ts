import { join, dirname } from 'node:path'
const A = await import(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@bastani', 'atomic', 'dist', 'index.js'))
const home = process.argv[2]
const store = await A.resolveSessionStore(home, { sessionStore: { kind: 'sqlite', path: join(home, 'atomic', 'sessions.sqlite') } })
const snap = await store.load(process.argv[3])
const a = snap.entries.filter((e: any) => e.type === 'message' && e.message?.role === 'assistant' && e.message.usage)
console.log(snap.entries.length, a.length, a.reduce((s: number, e: any) => s + (e.message.usage.cost?.total ?? 0), 0), a[0]?.timestamp, Object.keys(snap.entries[0] ?? {}))
