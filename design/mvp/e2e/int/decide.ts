// decide.ts <silent|visible> "<title>" "<scope>": the scripted router. Accepts every open eval of this home, as the router would.
import { join } from 'node:path'
import { openLog } from '../../../../harness/src/log.ts'
import { openHarness, VIEWS } from '../../../../harness/src/service.ts'
import { loadConfig } from '../../../../harness/src/config.ts'
const [how, title, scope] = process.argv.slice(2)
const config = loadConfig()
const log = openLog(join(config.home, 'log.sqlite'), VIEWS)
const h = openHarness(log, config)
for (const e of h.next().evals) console.log(JSON.stringify(h.decide(e.eval, { kind: 'accept', title, scope, silent: how === 'silent' })))
log.close()
