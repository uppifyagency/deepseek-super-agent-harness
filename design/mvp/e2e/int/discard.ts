// discard.ts <run>: a worker question in a silent run, through the same openGate the engine calls. The ticket is discarded.
import { join } from 'node:path'
import { openLog } from '../../../../harness/src/log.ts'
import { openHarness, VIEWS } from '../../../../harness/src/service.ts'
import { loadConfig } from '../../../../harness/src/config.ts'
import type { RunKey } from '../../../../harness/src/domain.ts'
const config = loadConfig()
const log = openLog(join(config.home, 'log.sqlite'), VIEWS)
const h = openHarness(log, config)
console.log(JSON.stringify(h.openGate(process.argv[2] as RunKey, 'work', 0, { kind: 'question', audience: 'requester', question: 'Quale sezione del README va corretta?' })))
console.log(JSON.stringify(h.ticketOf(process.argv[2] as RunKey)))
log.close()
