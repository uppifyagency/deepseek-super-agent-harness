// install-path.ts <PATH>: install this home's daemon with another PATH (lane 7: no claude; router-turn proof: a slow claude).
import { daemonJob, install } from '../../../../harness/src/launchd.ts'
import { loadConfig } from '../../../../harness/src/config.ts'
const job = daemonJob(loadConfig(), 60)
console.log(JSON.stringify(await install({ ...job, env: { ...job.env, PATH: process.argv[2] } })))
