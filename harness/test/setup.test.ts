import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConfig } from '../src/config.ts'
import { serviceProblem, shellQuote, watchdogProblem } from '../src/setup.ts'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const LABEL = 'it.delera.harness.t'
const WATCHDOG = 'it.delera.harness.watchdog.t'
const SVC = 'svc-t'
const PROBED_BY_DAEMON_PATH = ['npm', 'claude', 'gh', 'security']
const ON_USER_PATH = ['git', 'launchctl', 'stty']
const TOOLS = ['node', 'atomic', ...PROBED_BY_DAEMON_PATH, ...ON_USER_PATH]

interface Fixture {
  root: string
  home: string
  user: string
  pstackDir: string
  env: Record<string, string>
  node: string
  atomicPkg: string
  state(flag: string, on: boolean): void
  calls(): string[]
}

const sh = (root: string, body: string) => `#!/bin/sh\nR='${root}'\necho "$(basename "$0") $*" >> "$R/calls.log"\n[ -e "$R/state/slow" ] && sleep 1\n${body}\n`

const ATOMIC = `if [ -e "$R/state/codex-ok" ]; then echo '{"status":"ready"}'; else echo '{"status":"missing"}'; exit 1; fi`
const FAKES: Record<string, string> = {
  npm: `if [ "$1 $2" = "i -g" ]; then printf '{"version":"%s"}' "\${3#@bastani/atomic@}" > "$R/prefix/lib/node_modules/@bastani/atomic/package.json"; cp "$R/tpl/atomic" "$R/prefix/bin/atomic"; fi`,
  claude: `if [ -e "$R/state/claude-ok" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai"}'; else echo '{"loggedIn":false}'; exit 1; fi`,
  gh: `[ "$1 $2" = "auth status" ] && { [ -e "$R/state/gh-ok" ] || [ -n "$GH_TOKEN" ]; }`,
  git: `[ "$1" = clone ] || exit 1; if [ -d "$3" ] && [ -n "$(ls -A "$3")" ]; then echo "fatal: destination path '$3' already exists and is not an empty directory." >&2; exit 128; fi; mkdir -p "$3/plugins/pstack/skills/poteto-mode" "$3/plugins/pstack/pi"; touch "$3/plugins/pstack/skills/poteto-mode/SKILL.md" "$3/plugins/pstack/pi/index.ts"`,
  security: `case "$1" in
  find-generic-password) [ -e "$R/state/keychain-$3" ] ;;
  -i) while IFS= read -r line; do echo "security -i stdin: $line" >> "$R/calls.log"; svc=$(echo "$line" | sed -n 's/.* -s \\([^ ]*\\) .*/\\1/p'); [ -n "$svc" ] && touch "$R/state/keychain-$svc"; done; true ;;
  *) exit 1 ;;
esac`,
  launchctl: `case "$1" in
  print) if [ -e "$R/state/running-\${2##*/}" ]; then echo "pid = 4242"; [ -e "$R/state/exit-\${2##*/}" ] && echo "last exit code = $(cat "$R/state/exit-\${2##*/}")"; true; else exit 113; fi ;;
  bootout) rm -f "$R/state/running-\${2##*/}"; exit 3 ;;
  bootstrap) touch "$R/state/running-$(basename "$3" .plist)" ;;
  *) exit 1 ;;
esac`,
  stty: 'true',
}

function script(path: string, text: string): void {
  writeFileSync(path, text)
  chmodSync(path, 0o755)
}

const roots: string[] = []
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'harness-setup-'))
  roots.push(root)
  const pbin = join(root, 'prefix', 'bin')
  const bin = join(root, 'bin')
  const atomicDir = join(root, 'prefix', 'lib', 'node_modules', '@bastani', 'atomic')
  for (const d of [pbin, bin, atomicDir, join(root, 'state'), join(root, 'tpl'), join(root, 'user')]) mkdirSync(d, { recursive: true })
  // A hardlink, not a symlink: process.execPath then reports prefix/bin/node, so npm and Atomic resolve inside the fixture.
  const node = join(pbin, 'node')
  linkSync(process.execPath, node)
  const atomicPkg = join(atomicDir, 'package.json')
  writeFileSync(atomicPkg, '{"version":"0.9.63"}')
  script(join(root, 'tpl', 'atomic'), sh(root, ATOMIC))
  script(join(pbin, 'atomic'), sh(root, ATOMIC))
  for (const t of PROBED_BY_DAEMON_PATH) script(join(pbin, t), sh(root, FAKES[t]))
  for (const t of ON_USER_PATH) script(join(bin, t), sh(root, FAKES[t]))
  const env = { PATH: `${pbin}:${bin}:/usr/bin:/bin`, HOME: join(root, 'user'), HARNESS_HOME: join(root, 'home') }
  const found = execFileSync('/bin/sh', ['-c', `for t in ${TOOLS.join(' ')}; do command -v "$t"; done`], { env, encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(found, TOOLS.map((t) => join(ON_USER_PATH.includes(t) ? bin : pbin, t)), 'every fake shadows the real tool on PATH')
  // The first exec of a new hardlink costs about 1 s on macOS (measured 02/11): pay it here, not inside a timed run.
  execFileSync(node, ['-e', '0'], { env })
  rmSync(join(root, 'calls.log'), { force: true })
  return {
    root, node, atomicPkg, env,
    home: env.HARNESS_HOME,
    user: env.HOME,
    pstackDir: join(root, 'pstack-claude', 'plugins', 'pstack'),
    state(flag, on) { if (on) writeFileSync(join(root, 'state', flag), ''); else rmSync(join(root, 'state', flag), { force: true }) },
    calls() { return existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean) : [] },
  }
}

function logins(f: Fixture): void {
  for (const flag of ['codex-ok', 'claude-ok', 'gh-ok']) f.state(flag, true)
}

function ready(f: Fixture): Fixture {
  logins(f)
  f.state(`keychain-${SVC}`, true)
  f.state(`running-${LABEL}`, true)
  f.state(`running-${WATCHDOG}`, true)
  mkdirSync(join(f.pstackDir, 'skills', 'poteto-mode'), { recursive: true })
  mkdirSync(join(f.pstackDir, 'pi'), { recursive: true })
  writeFileSync(join(f.pstackDir, 'skills', 'poteto-mode', 'SKILL.md'), '')
  writeFileSync(join(f.pstackDir, 'pi', 'index.ts'), '')
  mkdirSync(f.home, { recursive: true })
  writeFileSync(join(f.home, 'config.json'), JSON.stringify({ repos: ['o/n'], allowedActors: ['v'], serviceLabel: LABEL, botKeychainService: SVC, pstackDir: f.pstackDir }))
  return f
}

const setupArgs = (f: Fixture) => ['setup', '--yes', '--repo', 'o/n', '--allow', 'v', '--label', LABEL, '--keychain', SVC, '--pstack', f.pstackDir]

function harness(f: Fixture, args: string[], o: { stdin?: string; preload?: string } = {}): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(f.node, [...(o.preload ? ['--import', o.preload] : []), CLI, ...args], { env: f.env, cwd: f.root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }))
    child.stdin.end(o.stdin ?? '')
  })
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => join(dir, p)).filter((p) => statSync(p).isFile()).sort()
}

const snapshot = (f: Fixture) => [...files(f.home), ...files(f.user)].map((path) => { const s = statSync(path); return { path, mtimeMs: s.mtimeMs, size: s.size } })

const stepLines = (out: string) => out.split('\n\n')[0].split('\n').filter(Boolean)

test('doctor on a ready machine: eleven lines, all ok, exit 0', async () => {
  const f = ready(fixture())
  const r = await harness(f, ['doctor'])
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines.length, 11, r.stdout)
  for (const line of lines) assert.match(line, /^ok {5}\S/)
  assert.equal(r.code, 0)
})

test('doctor names the one missing prerequisite and the command that fixes it', async (t) => {
  const user = userInfo().username
  const rows: { name: string; fix: (f: Fixture) => string; preload?: string; brk(f: Fixture): void; alsoMissing?: (f: Fixture) => string[] }[] = [
    { name: 'macOS', fix: () => "l'harness gira solo su macOS", preload: "Object.defineProperty(process, 'platform', { value: 'linux' })", brk() {} },
    { name: 'Node >= 26.13.0', fix: () => 'nvm install 26.13.0 && nvm alias default 26.13.0', preload: "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '26.12.9' } })", brk() {} },
    { name: 'Atomic globale, 0.9.x da 0.9.63 in su', fix: () => 'npm i -g @bastani/atomic@0.9.63', brk(f) { writeFileSync(f.atomicPkg, '{"version":"0.9.62"}') } },
    { name: 'pstack in <dir>', fix: (f) => `git clone https://github.com/michael-denyer/pstack-claude ${join(f.root, 'pstack-claude')}`, brk(f) { rmSync(join(f.root, 'pstack-claude'), { recursive: true }) } },
    { name: 'login Codex di Atomic', fix: () => 'atomic, poi /login (OpenAI Codex)', brk(f) { f.state('codex-ok', false) } },
    { name: 'Claude Code con il login del piano', fix: () => 'claude auth login', brk(f) { f.state('claude-ok', false) } },
    { name: 'gh autenticato', fix: () => 'gh auth login', brk(f) { f.state('gh-ok', false) } },
    {
      name: 'config.json', fix: () => 'bad repo "bad", expected owner/name; harness setup',
      brk(f) { writeFileSync(join(f.home, 'config.json'), JSON.stringify({ repos: ['bad'], allowedActors: ['v'] })) },
      alsoMissing: (f) => [
        `manca  pstack in ${join(f.user, 'src/pstack-claude/plugins/pstack')}: git clone https://github.com/michael-denyer/pstack-claude ${join(f.user, 'src/pstack-claude')}`,
        'manca  token del bot nel Portachiavi: harness setup',
        'manca  servizio launchd: harness setup',
        'manca  watchdog launchd: harness setup',
      ],
    },
    { name: `token del bot nel Portachiavi (${SVC})`, fix: () => `security add-generic-password -s ${SVC} -a ${user} -w`, brk(f) { f.state(`keychain-${SVC}`, false) } },
    { name: `servizio launchd (${LABEL})`, fix: () => 'harness service install', brk(f) { f.state(`running-${LABEL}`, false) } },
    { name: `watchdog launchd (${WATCHDOG})`, fix: () => 'harness service install', brk(f) { f.state(`running-${WATCHDOG}`, false) } },
    {
      name: `watchdog launchd (${WATCHDOG})`, fix: (f) => `l'ultimo controllo del watchdog e' uscito con codice 1: guarda ${join(f.home, 'logs', 'watchdog.out')}`,
      brk(f) { writeFileSync(join(f.root, 'state', `exit-${WATCHDOG}`), '1') },
    },
  ]
  for (const row of rows) {
    await t.test(row.name, async () => {
      const f = ready(fixture())
      row.brk(f)
      let preload: string | undefined
      if (row.preload) { preload = join(f.root, 'preload.mjs'); writeFileSync(preload, row.preload) }
      const r = await harness(f, ['doctor'], { preload })
      const lines = r.stdout.trim().split('\n')
      const name = row.name.replace('<dir>', f.pstackDir)
      const missing = lines.filter((l) => !l.startsWith('ok     '))
      assert.deepEqual(missing.sort(), [`manca  ${name}: ${row.fix(f)}`, ...(row.alsoMissing?.(f) ?? [])].sort(), r.stdout)
      assert.equal(lines.length, 11)
      assert.equal(r.code, 1)
    })
  }
})

test('Atomic: same 0.9 minor at or above patch 63 is ok', async () => {
  const line = async (f: Fixture) => (await harness(f, ['doctor'])).stdout.split('\n').find((l) => l.includes('Atomic'))
  for (const [version, ok] of [['0.9.63', true], ['0.9.64', true], ['0.9.62', false]] as const) {
    const f = ready(fixture())
    writeFileSync(f.atomicPkg, JSON.stringify({ version }))
    assert.equal(await line(f), ok ? 'ok     Atomic globale, 0.9.x da 0.9.63 in su' : 'manca  Atomic globale, 0.9.x da 0.9.63 in su: npm i -g @bastani/atomic@0.9.63', version)
  }
  const f = ready(fixture())
  rmSync(f.atomicPkg)
  assert.equal(await line(f), 'manca  Atomic globale, 0.9.x da 0.9.63 in su: npm i -g @bastani/atomic@0.9.63', 'no Atomic package next to this Node')
})

test('setup from an empty home does every step; a second setup does none and writes no file', async () => {
  const f = fixture()
  logins(f)
  rmSync(f.atomicPkg)
  rmSync(join(f.root, 'prefix', 'bin', 'atomic'))
  const first = await harness(f, setupArgs(f), { stdin: 'ghp_FIRST\n' })
  assert.equal(first.code, 0, first.stdout + first.stderr)
  assert.deepEqual(stepLines(first.stdout).filter((l) => !l.startsWith('Token')).map((l) => l.split('  ')[0]), ["gia' fatto", "gia' fatto", 'fatto', 'fatto', "gia' fatto", "gia' fatto", "gia' fatto", 'fatto', 'fatto', 'fatto', "gia' fatto"], first.stdout)
  assert.equal(statSync(join(f.home, 'config.json')).mode & 0o777, 0o600)
  for (const label of [LABEL, WATCHDOG]) assert.ok(existsSync(join(f.user, 'Library', 'LaunchAgents', `${label}.plist`)), `${label} plist under the fake HOME`)
  assert.match((await harness(f, ['status'])).stdout, /"mode": "observe"/, 'a new home starts in observe')

  const before = snapshot(f)
  rmSync(join(f.root, 'calls.log'))
  const second = await harness(f, setupArgs(f))
  assert.equal(second.code, 0, second.stdout + second.stderr)
  const lines = stepLines(second.stdout)
  assert.equal(lines.length, 11)
  for (const l of lines) assert.match(l, /^gia' fatto {2}\S/)
  assert.deepEqual(snapshot(f), before, 'no file written or touched')
  const mutating = f.calls().filter((c) => /^npm i|^git clone|add-generic-password|^launchctl bootstrap/.test(c))
  assert.deepEqual(mutating, [])
})

test('setup installs what `service install` installs, and `service uninstall` removes both jobs', async () => {
  const f = ready(fixture())
  f.state(`running-${LABEL}`, false)
  f.state(`running-${WATCHDOG}`, false)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const agents = join(f.user, 'Library', 'LaunchAgents')
  const bootstrapped = f.calls().filter((c) => c.startsWith('launchctl bootstrap')).map((c) => c.split('/').at(-1))
  assert.deepEqual(bootstrapped, [`${LABEL}.plist`, `${WATCHDOG}.plist`])
  assert.ok(r.stdout.includes(`ok     watchdog launchd (${WATCHDOG})`), r.stdout)
  assert.match(readFileSync(join(agents, `${WATCHDOG}.plist`), 'utf8'), /<string>watchdog<\/string>\s*<string>--once<\/string>/)
  const out = await harness(f, ['service', 'uninstall'])
  assert.equal(out.code, 0, out.stdout + out.stderr)
  assert.deepEqual(readdirSync(agents), [], 'no plist left')
})

test('a daemon running without its watchdog: doctor names it, setup adds it', async () => {
  const f = ready(fixture())
  f.state(`running-${WATCHDOG}`, false)
  const doc = await harness(f, ['doctor'])
  assert.equal(doc.code, 1)
  assert.ok(doc.stdout.split('\n').includes(`manca  watchdog launchd (${WATCHDOG}): harness service install`), doc.stdout)
  rmSync(join(f.root, 'calls.log'), { force: true })
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(stepLines(r.stdout).includes(`fatto       watchdog launchd (${WATCHDOG})`), r.stdout)
  const touched = f.calls().filter((c) => /^launchctl (bootout|bootstrap)/.test(c)).map((c) => `${c.split(' ')[1]} ${c.split('/').at(-1)}`)
  assert.deepEqual(touched, [`bootout ${WATCHDOG}`, `bootstrap ${WATCHDOG}.plist`], 'the running daemon is left alone')
})

test('the bot token reaches security on stdin and nowhere else', async () => {
  const f = ready(fixture())
  rmSync(join(f.home, 'config.json'))
  f.state('keychain-svc', false)
  const TOKEN = 'fake_token_for_tests'
  const r = await harness(f, ['setup', '--yes', '--repo', 'o/n', '--allow', 'v', '--keychain', 'svc', '--label', LABEL, '--pstack', f.pstackDir], { stdin: `${TOKEN}\n` })
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(stepLines(r.stdout).includes('fatto       token del bot nel Portachiavi (svc)'), r.stdout)
  assert.equal((r.stdout + r.stderr).split(TOKEN).length - 1, 0, 'not in the output')
  for (const path of [...files(f.home), ...files(f.user)]) assert.ok(!readFileSync(path, 'utf8').includes(TOKEN), `not in ${path}`)
  const calls = f.calls()
  assert.ok(calls.some((c) => c.startsWith('security -i stdin: ') && c.includes(`-s svc -a ${userInfo().username} -w ${TOKEN}`)), 'reached security -i on stdin')
  assert.deepEqual(calls.filter((c) => !c.startsWith('security -i stdin: ') && c.includes(TOKEN)), [], 'never on argv')
})

test('lane 9: a bad repo is refused with loadConfig\'s message, before any step and any write', async () => {
  const f = fixture()
  const r = await harness(f, ['setup', '--yes', '--repo', 'bad', '--allow', 'v'])
  const expected = (() => { try { parseConfig({ handles: ['/harness'], repos: [{ repo: 'bad', listen: 'explicit' }], allowedActors: ['v'] }, f.home) } catch (e) { return (e as Error).message } })()
  assert.ok(expected)
  assert.equal(r.stderr.trim(), expected)
  assert.equal(r.code, 1)
  assert.equal(existsSync(join(f.home, 'config.json')), false)
  assert.deepEqual(f.calls(), [])
})

test('under a pipe a missing login stops setup with the command, before config.json', async () => {
  const f = ready(fixture())
  rmSync(join(f.home, 'config.json'))
  f.state('gh-ok', false)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 1)
  assert.equal(stepLines(r.stdout).at(-1), 'manca  gh autenticato: gh auth login')
  assert.equal(existsSync(join(f.home, 'config.json')), false)
  assert.ok(!f.calls().some((c) => c.startsWith('gh auth login')), 'no login started without a terminal')
})

test('doctor runs the slow probes at once', async () => {
  const f = ready(fixture())
  f.state('slow', true)
  const r = await harness(f, ['doctor'])
  assert.equal(r.code, 0, r.stdout)
  assert.ok(r.ms < 2000, `three 1 s probes took ${r.ms} ms`)
})

const ATOMIC_LABEL = 'Atomic globale, 0.9.x da 0.9.63 in su'
const atomicLine = (out: string) => out.split('\n').find((l) => l.includes(ATOMIC_LABEL))

test('Atomic installed but off PATH: doctor names the PATH fix and setup installs nothing', async () => {
  const f = ready(fixture())
  writeFileSync(f.atomicPkg, '{"version":"0.9.64"}')
  const pbin = realpathSync(join(f.root, 'prefix', 'bin'))
  f.env.PATH = f.env.PATH.replace(`${join(f.root, 'prefix', 'bin')}:`, '')
  assert.equal(atomicLine((await harness(f, ['doctor'])).stdout), `manca  ${ATOMIC_LABEL}: atomic 0.9.64 e' in ${pbin}, che non e' nel PATH: export PATH="${pbin}:$PATH"`)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 1)
  assert.equal(stepLines(r.stdout).at(-1), `manca  ${ATOMIC_LABEL}: atomic 0.9.64 e' in ${pbin}, che non e' nel PATH: export PATH="${pbin}:$PATH"`)
  assert.deepEqual(f.calls().filter((c) => c.startsWith('npm')), [], 'no install over a present Atomic')
})

test('Atomic newer than the tested line: doctor says so and setup never downgrades it', async () => {
  const f = ready(fixture())
  writeFileSync(f.atomicPkg, '{"version":"0.10.0"}')
  const fix = "Atomic 0.10.0 e' piu' nuovo delle versioni provate; per tornare a quella provata: npm i -g @bastani/atomic@0.9.63"
  assert.equal(atomicLine((await harness(f, ['doctor'])).stdout), `manca  ${ATOMIC_LABEL}: ${fix}`)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 1)
  assert.equal(stepLines(r.stdout).at(-1), `manca  ${ATOMIC_LABEL}: ${fix}`)
  assert.deepEqual(f.calls().filter((c) => c.startsWith('npm')), [])
  assert.equal(JSON.parse(readFileSync(f.atomicPkg, 'utf8')).version, '0.10.0')
})

test('Atomic older than the tested line: setup upgrades it to the tested version', async () => {
  const f = ready(fixture())
  writeFileSync(f.atomicPkg, '{"version":"0.9.62"}')
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(f.calls().filter((c) => c.startsWith('npm')), ['npm i -g @bastani/atomic@0.9.63'])
})

const pstackLabel = (f: Fixture) => `pstack in ${f.pstackDir}`
const clone = (f: Fixture) => `git clone https://github.com/michael-denyer/pstack-claude ${join(f.root, 'pstack-claude')}`

test('pstack: a clone root holding only empty directories is cleared and cloned into', async () => {
  const f = ready(fixture())
  const root = join(f.root, 'pstack-claude')
  rmSync(root, { recursive: true })
  mkdirSync(f.pstackDir, { recursive: true })
  const pstackLine = (out: string) => out.split('\n').find((l) => l.includes(pstackLabel(f)))
  assert.equal(pstackLine((await harness(f, ['doctor'])).stdout), `manca  ${pstackLabel(f)}: find ${root} -depth -type d -empty -delete && ${clone(f)}`)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(stepLines(r.stdout).includes(`fatto       ${pstackLabel(f)}`), r.stdout)
  assert.ok(existsSync(join(f.pstackDir, 'pi', 'index.ts')))
})

test('pstack: a clone root that holds a file is refused, nothing is cloned or deleted', async () => {
  const f = ready(fixture())
  const root = join(f.root, 'pstack-claude')
  rmSync(join(f.pstackDir, 'pi', 'index.ts'))
  const fix = `${root} esiste e non e' un clone completo di pstack-claude: spostala, o scegli un'altra cartella con --pstack`
  assert.equal((await harness(f, ['doctor'])).stdout.split('\n').find((l) => l.includes(pstackLabel(f))), `manca  ${pstackLabel(f)}: ${fix}`)
  const r = await harness(f, setupArgs(f))
  assert.equal(r.code, 1)
  assert.equal(stepLines(r.stdout).at(-1), `manca  ${pstackLabel(f)}: ${fix}`)
  assert.deepEqual(f.calls().filter((c) => c.startsWith('git')), [])
  assert.ok(existsSync(join(f.pstackDir, 'skills', 'poteto-mode', 'SKILL.md')))
})

test('the token prompt appears only after echo is off, and echo comes back, also on Ctrl-C', async () => {
  const f = ready(fixture())
  rmSync(join(f.home, 'config.json'))
  f.state(`keychain-${SVC}`, false)
  const preload = join(f.root, 'tty.mjs')
  writeFileSync(preload, `import { appendFileSync } from 'node:fs'
Object.defineProperty(process.stdin, 'isTTY', { value: true })
const write = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...rest) => { if (String(chunk).startsWith('Token')) appendFileSync(${JSON.stringify(join(f.root, 'calls.log'))}, 'prompt\\n'); return write(chunk, ...rest) }
`)
  const ttyCalls = () => f.calls().filter((c) => c.startsWith('stty') || c === 'prompt')
  const r = await harness(f, setupArgs(f), { stdin: 'ghp_X\n', preload })
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(ttyCalls(), ['stty -echo', 'prompt', 'stty echo'])

  f.state(`keychain-${SVC}`, false)
  rmSync(join(f.root, 'calls.log'))
  const child = spawn(f.node, ['--import', preload, CLI, ...setupArgs(f)], { env: f.env, cwd: f.root })
  const code = new Promise<number | null>((resolve) => child.on('close', resolve))
  while (!f.calls().includes('prompt')) await new Promise((r) => setTimeout(r, 20))
  child.kill('SIGINT')
  assert.equal(await code, 130)
  assert.deepEqual(ttyCalls(), ['stty -echo', 'prompt', 'stty echo'])
})

test('doctor probes gh with the daemon environment: a GH_TOKEN only doctor can see is not ok', async () => {
  const f = ready(fixture())
  f.state('gh-ok', false)
  f.env.GH_TOKEN = 'only-in-this-shell'
  const r = await harness(f, ['doctor'])
  assert.ok(r.stdout.split('\n').includes('manca  gh autenticato: gh auth login'), r.stdout)
})

test('setup --yes --mode observe starts a new home in observe; --mode auto later switches it', async () => {
  const f = ready(fixture())
  rmSync(join(f.home, 'config.json'))
  const r = await harness(f, [...setupArgs(f), '--mode', 'observe'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match((await harness(f, ['status'])).stdout, /"mode": "observe"/)
  const again = await harness(f, [...setupArgs(f), '--mode', 'observe'])
  assert.ok(stepLines(again.stdout).includes("gia' fatto  config.json e modo observe"), again.stdout)
  const auto = await harness(f, [...setupArgs(f), '--mode', 'auto'])
  assert.equal(auto.code, 0, auto.stdout + auto.stderr)
  assert.ok(stepLines(auto.stdout).includes('fatto       config.json e modo auto'), auto.stdout)
  assert.match((await harness(f, ['status'])).stdout, /"mode": "auto"/)
  const bad = await harness(f, [...setupArgs(f), '--mode', 'off'])
  assert.equal(bad.code, 1)
  assert.match(bad.stderr, /--mode vuole observe o auto/)
})

test('a printed path survives the shell: spaces and apostrophes stay one word', () => {
  for (const path of ['/tmp/PROGETTI ANTYGRAVITY/pstack-claude', "/tmp/it's here", '/plain/path', '~/src/pstack-claude']) {
    const back = execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(path)}`], { encoding: 'utf8', env: { HOME: '/home-x' } })
    assert.equal(back, path.startsWith('~/') ? '/home-x' + path.slice(1) : path)
  }
})

test('doctor calls a missing or respawning daemon missing, a steady one ok', async () => {
  const printOf = (code: number, runs: number, last: string) => async () => ({ code, stdout: code ? '' : `\tstate = running\n\truns = ${runs}\n\tpid = 4242\n\t${last}\n` })
  const log = '/tmp/h/logs/daemon.log'
  assert.equal(await serviceProblem('l', log, printOf(113, 0, '')), 'harness service install')
  assert.match(await serviceProblem('l', log, printOf(0, 7, 'last exit code = 1')) ?? '', /riparte di continuo \(ultima uscita con codice 1, 7 avvii\)/)
  assert.equal(await serviceProblem('l', log, printOf(0, 2, 'last terminating signal = Killed: 9')), undefined, 'the watchdog restarts a hung daemon with kickstart -k')
  assert.equal(await serviceProblem('l', log, printOf(0, 1, 'last exit code = (never exited)')), undefined)
  assert.equal(await serviceProblem('l', log, printOf(0, 3, 'last exit code = 0')), undefined)
})

test('doctor calls an unloaded or failing watchdog missing, a loaded one between checks ok', async () => {
  const printOf = (code: number, last = '') => async () => ({ code, stdout: code ? '' : `\tstate = not running\n\truns = 4\n${last && `\t${last}\n`}` })
  const log = '/tmp/h/logs/watchdog.out'
  assert.equal(await watchdogProblem('l', log, printOf(113)), 'harness service install')
  assert.equal(await watchdogProblem('l', log, printOf(0, 'last exit code = 1')), `l'ultimo controllo del watchdog e' uscito con codice 1: guarda ${log}`)
  assert.equal(await watchdogProblem('l', log, printOf(0, 'last terminating signal = Killed: 9')), `l'ultimo controllo del watchdog e' uscito con segnale Killed: 9: guarda ${log}`)
  for (const last of ['last exit code = 0', 'last exit code = (never exited)', '']) assert.equal(await watchdogProblem('l', log, printOf(0, last)), undefined, last)
})

test('a repo of dot segments is refused before it can name a path outside repos/', () => {
  for (const repo of ['../x', './x', 'owner/..', 'owner/.']) {
    assert.throws(() => parseConfig({ repos: [repo], allowedActors: ['v'] }, '/tmp/h'), /bad repo/)
  }
  assert.doesNotThrow(() => parseConfig({ repos: ['owner/name.js'], allowedActors: ['v'] }, '/tmp/h'))
})
