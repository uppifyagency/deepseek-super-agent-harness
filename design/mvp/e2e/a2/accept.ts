// accept.ts "<title>" "<scope>": the scripted brief of lanes 2 and 6. Accepts every open eval of this home
// with the given title and scope, as the router would; the brief then carries the issue text verbatim.
import { join } from 'node:path'
import { openLog } from '../../../../harness/src/log.ts'
import { openHarness, VIEWS } from '../../../../harness/src/service.ts'
import { loadConfig } from '../../../../harness/src/config.ts'
const config = loadConfig()
const log = openLog(join(config.home, 'log.sqlite'), VIEWS)
const h = openHarness(log, config)
for (const e of h.next().evals) console.log(JSON.stringify(h.decide(e.eval, { kind: 'accept', title: process.argv[2], scope: process.argv[3] })))
log.close()
