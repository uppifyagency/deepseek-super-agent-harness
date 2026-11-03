// host.ts: the `harness` CLI (bin in package.json). The ONLY code outside Atomic's extension
// lifecycle, kept thin on purpose: it owns the process, the router lock and launchd, nothing else.
// All behavior lives in the extension, so the daemon and the attached TUI run the same code.
//
//   harness daemon     launchd KeepAlive job: SDK headless router session
//   harness attach     hand the router session to an interactive TUI, give it back on exit
//   harness watchdog   launchd StartInterval job: liveness in code, progress judged by a model
//   harness install    write the two LaunchAgents plists, settings, model sheet, policy skeleton
//   harness observed   print the observe-mode decisions ("would have opened") for review

import { createAgentSession, SessionManager } from '@bastani/atomic'

const ROUTER_SESSION_FILE = '~/.harness/router-session'   // the router's Atomic session id, created once
const LOCK = '~/.harness/router.lock'                      // pid of the process that IS the router

/**
 * Headless router. Env set by the plist: PI_CODING_AGENT_DIR=$HOME/.atomic/agent (pstack sheet,
 * ground-pstack-on-atomic 2), PATH with nvm node 26 + gh, cwd = ~/.harness (one cwd for every run:
 * resume is project-scoped, sdk.md:383).
 */
export async function daemon(): Promise<never> {
  // TODO acquireLock(LOCK)  (O_EXCL + stale-pid check; exits 0 if a live router holds it, e.g. attach)
  //      const id = readOrCreate(ROUTER_SESSION_FILE)
  //      const { session } = await createAgentSession({
  //        sessionManager: SessionManager.open(store, id),   // sdk.md:216-233
  //        model: 'anthropic/claude-opus-5-5', thinkingLevel: 'medium',
  //        extensionBindings: { humanInput: null },          // headless: workflow gates stay durable-pending
  //      })                                                   // and come back via workflow answer (sdk.md:279-297)
  //      await session.startPendingRecovery('resume')        // sdk.md:145
  //      // settings.json: workflowNotifications on (default), resumeInFlight 'auto', heartbeatIntervalMinutes 0
  //      on SIGTERM: await session.dispose(); releaseLock()   // releases runs for the next owner (sdk.md:373-379)
  //      await forever
  throw new Error('not implemented')
}

/**
 * Vlad at the Mac. Same session, same extension, interactive.
 *   launchctl bootout gui/$UID/it.delera.harness   (daemon disposes: runs released at last checkpoint)
 *   acquireLock(LOCK); spawn `atomic --session <id>` with stdio inherited (docs/sessions.md:22-33)
 *   (the extension in the TUI sees the lock -> router role -> reconcile resumes the released runs)
 *   on TUI exit: releaseLock(); launchctl bootstrap gui/$UID ~/Library/LaunchAgents/it.delera.harness.plist
 * Nothing is lost while switching: GitHub is re-polled from the cursor, runs resume from checkpoints.
 */
export async function attach(): Promise<void> {
  throw new Error('not implemented')
}

/**
 * External control loop (article section 6), every 5 min, outside the router process.
 *  1. Liveness, code only: router.heartbeat older than 3 min, or `atomic storage status` exits 1
 *     (cli.md:114) -> `launchctl kickstart -k gui/$UID/it.delera.harness` and log it.
 *  2. Progress, code first: for each open ticket's current run, store.progress(run, 30 min):
 *     diffHash changed -> progressing (no model call)
 *     no progress facts and run not awaiting input -> stuck (no model call)
 *     facts but same diffHash for 30 min -> ambiguous: collect these
 *  3. Only for ambiguous runs: `atomic -p --harness-role watchdog "/skill:harness-watchdog <runs>"`
 *     The model reads the brief and the stage transcript tail (workflow transcript action) and calls
 *     harness judge {run, verdict: progressing|stuck|drifting, why}. The router is told via the
 *     store's notice feed and decides (steer by route, stop, or ask Vlad). The watchdog never stops runs.
 */
export async function watchdog(): Promise<void> {
  throw new Error('not implemented')
}

export async function install(): Promise<void> {
  // TODO ~/Library/LaunchAgents/it.delera.harness.plist          KeepAlive, RunAtLoad, ThrottleInterval 30
  //      ~/Library/LaunchAgents/it.delera.harness.watchdog.plist StartInterval 300
  //      ~/.atomic/agent/settings.json merge: resumeInFlight 'auto', heartbeatIntervalMinutes 0
  //      ~/.atomic/agent/pstack-models.md = copy of ~/.claude/pstack-models.md + 'pi ask tool: off'
  //      ~/.harness/policy.json skeleton: repos in mode 'observe'
  //      ~/.harness/empty/ (GH_CONFIG_DIR for model-run bash)
  //      `atomic install <this package>` and `atomic install <pstack clone>`
  throw new Error('not implemented')
}
