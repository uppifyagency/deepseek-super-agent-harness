// trunk-lane1.ts <issue>: lane 1 on trunk without polling the whole sandbox. Trunk has no candidateMatch, so a live
// trunk daemon with listen candidates would hand every message of every agent to its router. This feeds only the given
// issue through trunk's own intake, wakes trunk's router once, sends its replies and plans its runs (no engine).
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const code = process.env.TRUNK!, home = process.env.HARNESS_HOME!, n = Number(process.argv[2])
const { openLog } = await import(join(code, 'src/log.ts'))
const { openHarness, VIEWS } = await import(join(code, 'src/service.ts'))
const { loadConfig } = await import(join(code, 'src/config.ts'))
const { issueToDraft, send } = await import(join(code, 'src/github.ts'))
const { wakeRouter } = await import(join(code, 'src/router.ts'))
mkdirSync(home, { recursive: true })
writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: [{ repo: 'uppifyagency/harness-sandbox', listen: 'candidates' }], allowedActors: ['uppifyagency'], handles: ['/harness-st'], serviceLabel: 'it.delera.harness.st' }))
const config = loadConfig(home)
const log = openLog(join(home, 'log.sqlite'), VIEWS), h = openHarness(log, config)
h.setPolicy('auto', 'lane1', 1)
const issue = JSON.parse(execFileSync('gh', ['api', `/repos/uppifyagency/harness-sandbox/issues/${n}`], { encoding: 'utf8' }))
console.log('ingest ->', h.ingest(issueToDraft('uppifyagency/harness-sandbox', issue)))
const r = await wakeRouter({ home })
console.log(`router: ok=${r.ok} cost=$${r.costUsd?.toFixed(4)} turns=${r.turns}`)
for (const [intent, item] of Object.entries(h.pending() as Record<string, { to: { kind: string }; text: string; purpose: string }>)) {
  if (item.to.kind !== 'issue') continue
  const s = await send(item.to, item.text, intent); h.settle(intent, s.result, s.url)
  console.log(`reply ${item.purpose} ${s.result}: ${s.url}\n  ${item.text.replace(/\n/g, '\n  ')}`)
}
console.log('planRuns ->', h.planRuns().length, 'run.intended')
const card = h.recall(`issue:uppifyagency/harness-sandbox#${n}`)
for (const x of card.next) console.log(`  -> ${x.rel.padEnd(16)} ${x.preview}`)
log.close()
