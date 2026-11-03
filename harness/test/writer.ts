// Child process for the concurrency test: appends a seeded list of drafts in a shuffled order and
// random batch sizes, then prints how many events its own transact calls returned.
// argv: dbPath seed n orderSeed

import { openLog } from '../src/log.ts'
import { drafts, everything, perThread, rng } from './fixtures.ts'

const [dbPath, seed, n, orderSeed] = process.argv.slice(2)
const list = drafts(Number(seed), Number(n))
const r = rng(Number(orderSeed))
const order = list.map((d, i) => ({ d, k: r(), i })).sort((a, b) => a.k - b.k)

// Causes must exist before their effects only for the reverse index, not for ids, so any order is valid.
const log = openLog(dbPath, [perThread, everything])
let i = 0
while (i < order.length) {
  const size = 1 + Math.floor(r() * 7)
  const batch = order.slice(i, i + size).map((x) => x.d)
  log.transact(() => batch)
  i += size
}
log.close()
process.stdout.write('done\n')
