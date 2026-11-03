// Poll + route, then POST every pending reply WITHOUT reply.settled: a crash right after the POST.
import { join } from 'node:path'
import { loadConfig } from '../../../../harness/src/config.ts'
import { openLog } from '../../../../harness/src/log.ts'
import { openHarness, VIEWS } from '../../../../harness/src/service.ts'
import { pollRepo, send } from '../../../../harness/src/github.ts'
import { wakeRouter } from '../../../../harness/src/router.ts'
const c = loadConfig(); const log = openLog(join(c.home, 'log.sqlite'), VIEWS); const h = openHarness(log, c)
for (let i = 0; i < 20 && !h.routerHasWork(); i++) {   // wait until GitHub's list shows the new issue
  for (const { repo } of c.repos) await pollRepo(c.home, repo, (d) => { h.ingest(d) })
  if (!h.routerHasWork()) await new Promise((r) => setTimeout(r, 3000))
}
if (!h.routerHasWork()) { console.log('issue never visible'); process.exit(1) }
const r = await wakeRouter({ home: c.home }); console.log('router', r.ok, r.costUsd, r.durationMs)
console.log('pending before crash:', Object.keys(h.pending()).length)
for (const [intent, item] of Object.entries(h.pending())) { if (item.to.kind !== 'issue') continue; const s = await send(item.to, item.text, intent); console.log('POSTED (no settle):', intent, s.url) }
process.exit(137)
