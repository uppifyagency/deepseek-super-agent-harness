// strip-input.mjs <in> <out>: drop the keystroke records from a macOS `script -r` recording, so typed
// answers (the bot token above all) never reach the file. `script -p <out>` still replays the output with its timing.
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dst] = process.argv.slice(2)
const buf = readFileSync(src)
const kept = []
let dropped = 0
for (let at = 0; at < buf.length;) {
  const len = Number(buf.readBigUInt64LE(at))
  const dir = String.fromCharCode(buf.readUInt32LE(at + 20))
  const end = at + 24 + len
  if (dir === 'i') dropped++
  else kept.push(buf.subarray(at, end))
  at = end
}
writeFileSync(dst, Buffer.concat(kept))
console.log(`${dropped} input records dropped`)
