export const expect = "NoStopWhileGateOpen";
export const broken = "DaemonChecksGate = FALSE and DaemonDedupes = FALSE. The daemon turns every stuck or drifting judgement into stop.intended. It does not look for an open gate when it writes, and it does not look for an earlier stop of the same run. Plain TLC stops at NoStopWhileGateOpen, the shorter path. The statechart run also finds OneStopPerRun.";
export const legend = [
  "Worker on it: run.bound (engine.ts:231) and run.progress after each stage (engine.ts:195).",
  "Question open: a stage asks, askHost opens gate.opened kind question (engine.ts:155-173, gates.ts:49-56) and waits for gate.answered (gates.ts:59-67).",
  "Budget used up: Atomic reports blocked or budget_exceeded, classify turns it into kind budget (engine.ts:303-306), and reportDrafts writes run.ended and gate.opened kind budget together (runs.ts:209-214). A budget stop is not final (runs.ts:63).",
  "Vlad says yes: gate.answered starting with si, yes or ok (runs.ts:77), then planRuns writes the next run.intended with the raised budget (runs.ts:119-124).",
  "Judged stuck: watchdog.judged with verdict stuck or drifting (domain.ts:100). The watchdog log handle may write only that kind (log.ts:48). The watchdog itself is the A2 plan, not code.",
  "Stop written: stop.intended (domain.ts:95), written by the daemon after a stuck or drifting judgement (plan A2).",
  "Stopped: the engine stops the run in Atomic, status killed, classify gives run.ended failed with cause stopped (engine.ts:309).",
];
export const rules = [
  "NoStopWhileGateOpen: the daemon never writes stop.intended while the run has an open gate.",
  "OneStopPerRun: at most one stop.intended per run, even when the stuck judgement arrives twice.",
];
export const leftOut = [
  "The watchdog's restart of a dead daemon (launchctl kickstart), the progressing verdict as a separate state, and the attention list.",
  "Two attempts at most. run.ended failed and done are one end state.",
  "The chart hides the finish and budget arrows from states where a judgement or a stop is pending. Those steps exist in the model.",
];
