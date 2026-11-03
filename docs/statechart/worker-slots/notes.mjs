export const expect = "WithinCap";
export const broken = "Starters = {daemon, work} and MaxWorkers = 1. harness work (cli.ts:175-183) calls startRuns without the run lock that harness run takes (cli.ts:151). The slot rule counts only bound runs (runs.ts:180), so a run that one process is starting is free for the other process to start again.";
export const legend = [
  "Waiting: run.intended with no run.bound yet. The chart starts with 3 runs intended at once, as in the unit 10 proof (design/mvp/e2e/unit10/REPORT.md).",
  "Picks the runs to start: runsToStart counts bound, not ended runs as held slots and returns the oldest unbound runs while slots are free (runs.ts:174-185).",
  "Starting: engine.start is in flight. The daemon awaits each start before the next (cli.ts:75-78), and launch writes run.bound before it returns (engine.ts:223-234).",
  "run.bound: Atomic gave the run id. A bound run holds its slot also while it waits on a gate.",
  "Ends: run.ended frees the slot (runs.ts:179).",
  "maxWorkers comes from policy.set (domain.ts:99, service.ts:84-88, default 2). The chart uses 2. The same model passes with 1 and 3.",
  "Silent runs yield: with SilentYields = TRUE a silent run sorts after every visible run (plan A3). Today runsToStart sorts by age only.",
];
export const rules = [
  "WithinCap: live Atomic workers never exceed maxWorkers.",
  "OneWorkerPerRun: one run key never has two live Atomic runs.",
  "VisibleFirst: a pass never picks a silent run while it leaves a visible run waiting.",
];
export const leftOut = [
  "Lowering maxWorkers while runs are live: the new cap applies only to later starts, live runs keep their slots.",
  "Resume of runs bound by a dead process (cli.ts:70-74). They are bound, so they count as held.",
  "The chart hides the failed start (run.ended with no run.bound). The model has it.",
];
