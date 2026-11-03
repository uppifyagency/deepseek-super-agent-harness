import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readPrivateTerms(root) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
  const path = join(common, 'info', 'private-terms')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    .map((line) => {
      const [term, replacement] = line.split(' => ')
      return replacement === undefined ? { term: term.trim() } : { term, replacement }
    })
}
