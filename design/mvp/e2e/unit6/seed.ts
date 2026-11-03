// Unit 6 E2E seed: a fresh harness home in `auto` where every existing issue is already decided (ignore),
// so only issues opened after this run reach the router. Usage: HARNESS_HOME=<empty dir> node seed.ts
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
h.setPolicy('auto', 'unit6-seed')
await pollRepo(home, config.repos[0].repo, (d) => h.ingest(d))
for (const e of h.next().evals) console.log(e.thread, JSON.stringify(h.decide(e.eval, { kind: 'ignore', reason: 'before the unit 6 proof' })))
log.close()
