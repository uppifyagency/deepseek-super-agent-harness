export const title = "One run with a gate, a budget and the watchdog (A2)";

const ended = {
  done: "Run finished (run.ended)",
  stopped: "Stopped (run.ended failed stopped)",
  budget: "Budget used up, Vlad asked to raise it (run.ended budget, gate.opened budget)",
  declined: "Budget not raised (gate.answered no)",
};

export const state = (v) => {
  if (v.run === "ended") return ended[v.outcome];
  const working = v.run === "working";
  if (v.stops >= 2) return "Two stops for one run (stop.intended twice)";
  if (v.stops === 1) {
    if (working) return "Worker on it, stop written (stop.intended)";
    return v.stopWhileGate ? "Question open, stop written while it is open (stop.intended)" : "Question open, stop written just before it (stop.intended)";
  }
  if (v.judged > v.handled) return working ? "Worker on it, judged stuck (watchdog.judged stuck)" : "Question open, judged stuck on an older read (watchdog.judged stuck)";
  return working ? "Worker on it (run.bound, run.progress)" : "Question open in the issue (gate.opened question)";
};

export const group = (v) => {
  if (v.run === "ended") return v.outcome === "budget" ? "Waiting for Vlad" : "Run ended";
  if (v.stops > 0) return "Stop written";
  return v.run === "working" ? "Worker running" : "Waiting for Vlad";
};
export const colors = { "Worker running": "blue", "Waiting for Vlad": "yellow", "Stop written": "orange", "Run ended": "tan" };

const quiet = (v) => v.run === "working" && v.stops === 0 && v.judged === v.handled;

export const step = (action, from, to) => {
  switch (action) {
    case "WorkerAsks": return "the worker asks (gate.opened)";
    case "GateAnswered": return "the answer arrives (gate.answered)";
    case "WatchdogReads": return "the watchdog reads the log";
    case "WatchdogJudgesStuck": return from.run === "asking" ? "the watchdog judges stuck on a read from before the question" : "no run.progress for 15 min, the watchdog judges stuck or drifting";
    case "DaemonReadsJudgement": return to.stops > from.stops ? "the daemon writes stop.intended" : "the daemon drops the judgement";
    case "EngineStopsRun": return "the engine stops the run in Atomic";
    case "RunFinishes": return quiet(from) ? "the run finishes" : null;
    case "BudgetRunsOut": return quiet(from) ? "Atomic blocks the run at its budget" : null;
    case "VladRaisesBudget": return "Vlad says yes (gate.answered, next run.intended)";
    case "VladDeclinesBudget": return "Vlad says no";
    default: return null;
  }
};
