// watchdog.ts: a separate launchd job (StartInterval 120), so a wedged daemon cannot silence it.
// Opens the log with write access for `watchdog.judged` ONLY. Never touches Atomic directly.
// Two stages, like the filter: code decides who is suspicious, an LLM judges only those.

export async function watchdogTick(home = `${process.env.HOME}/.harness`): Promise<void> {
  throw new Error('not implemented')
  // LIVENESS (code):
  //   alive file older than 3 min, or its seq has not moved while the log head moved
  //     -> `launchctl kickstart -k gui/<uid>/it.delera.harness`, append nothing (the restart is the act);
  //        the daemon's recover() handles the ~120 s Atomic lease (ground-atomic-host.md section 2.3)
  //   `atomic storage status` exits 1 (cli.md:114) -> macOS notification via osascript, no restart loop
  // PROGRESS (code, then LLM):
  //   for each live run in the log: suspicious if no `run.progress` for 20 min while not awaiting a gate,
  //     or the last N progress summaries are near-identical, or cost > 80% of budget with no commit
  //   suspicious -> one `atomic -p --mode json` call (read-only tools, opus medium) given the brief,
  //     progress summaries and `git log` of the worktree: verdict progressing | stuck | drifting + evidence
  //   append `watchdog.judged`; the daemon's react() turns stuck|drifting into stop + attention item.
  // Judgments are content-addressed by (run, window), so a tick that runs twice writes one fact.
}
