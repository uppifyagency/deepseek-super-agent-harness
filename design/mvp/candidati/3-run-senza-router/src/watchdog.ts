// watchdog.ts: `harness watchdog`, a one-shot process launchd starts every 120 s
// (StartInterval). Outside the supervisor, so a wedged supervisor cannot silence it (article 6).
// Reads the store read-only; writes ONLY watchdog_verdicts. Acting on a verdict is the supervisor's job.

import type { AttemptId } from './domain'

export interface ProgressSignal {
  attempt: AttemptId
  runningMs: number
  lastCommitAgoMs: number
  toolCallsLast10m: number
  repeatedCallRatio: number          // identical (tool, input) pairs / calls, last 30 calls
  tokensSpent: number
  budgetShare: number                // spent / budget, worst of the three axes
}

/**
 * 1. Liveness: store heartbeat older than 90 s -> `launchctl kickstart -k gui/$UID/it.vlad.harness`.
 *    Supervisor booting resumes runs by itself (reconcile), so the watchdog never touches Atomic.
 * 2. Progress (code first, then model, article 3.1 applied to the watchdog):
 *    suspicious(sig) false -> nothing. true -> judgeProgress(card) as a tiny Atomic run (runs.ts),
 *    card = brief + last 30 tool calls + diffstat. 'stuck' | 'drifting' -> append verdict row.
 * 3. Same verdict for the same attempt within 30 min is not repeated (one row per window).
 */
export async function watchdogOnce(storePath: string, journalPath: string): Promise<void> {
  throw new Error('not implemented')
}

/** Pure. Cheap thresholds so the model judge runs only on candidates. */
export function suspicious(s: ProgressSignal): boolean {
  throw new Error('not implemented')
  // runningMs > 20 min && lastCommitAgoMs > 15 min, or repeatedCallRatio > 0.5, or budgetShare > 0.8 with no commit
}
