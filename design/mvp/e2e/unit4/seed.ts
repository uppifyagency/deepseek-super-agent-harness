// Unit 4 E2E seed: a fresh harness home with the two tickets the router accepted in unit 3 (#2, #3).
// Real GitHub poll; the accept is the router's own decision, replayed through Harness.decide.
// Usage: HARNESS_HOME=<empty dir> node seed.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, harnessHome } from '../../../../harness/src/config.ts'
import { openLog } from '../../../../harness/src/log.ts'
import { openHarness, VIEWS } from '../../../../harness/src/service.ts'
import { pollRepo } from '../../../../harness/src/github.ts'

const home = harnessHome()
mkdirSync(home, { recursive: true })
writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: [{ repo: 'uppifyagency/harness-sandbox', listen: 'explicit' }], allowedActors: ['uppifyagency'], handles: ['/harness'] }, null, 2))
const config = loadConfig(home)
const log = openLog(join(home, 'log.sqlite'), VIEWS)
const h = openHarness(log, config)
h.setPolicy('auto', 'unit4-seed')
await pollRepo(home, config.repos[0].repo, (d) => h.ingest(d))
const ACCEPT: Record<string, { title: string; scope: string }> = {
  '#2': { title: 'Aggiungi al README una riga sullo scopo del repo', scope: "README.md contiene una riga in italiano che spiega a cosa serve il repository harness-sandbox. Se README.md non esiste, crearlo con quella riga. Fatto quando la riga è presente e chiara." },
  '#3': { title: "Rinomina il titolo del README in 'Harness sandbox'", scope: "Il titolo principale (heading H1) di README.md diventa esattamente 'Harness sandbox'. Il resto del contenuto resta invariato. Se manca un titolo, aggiungerlo in cima." },
}
for (const e of h.next().evals) {
  const n = Object.keys(ACCEPT).find((k) => e.thread.endsWith(k))
  const r = n ? h.decide(e.eval, { kind: 'accept', ...ACCEPT[n] }) : h.decide(e.eval, { kind: 'ignore', reason: 'not part of the unit 4 proof' })
  console.log(e.thread, JSON.stringify(r))
}
console.log('open tickets', h.next().board.openTickets.length)
log.close()
