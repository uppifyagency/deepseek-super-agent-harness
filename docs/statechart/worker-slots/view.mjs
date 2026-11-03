export const title = "Worker slots never exceed maxWorkers";

const total = (v) => Object.values(v.workers).reduce((a, b) => a + b, 0);
const starting = (v) => Object.values(v.busy).filter((b) => b !== "none").length;

export const state = (v) => {
  const workers = total(v);
  const s = starting(v);
  const busy = new Set(Object.values(v.busy));
  const waiting = Object.entries(v.st).filter(([r, st]) => st === "intended" && !busy.has(r)).length;
  const live = workers === 0 ? "No worker" : `${workers} worker${workers > 1 ? "s" : ""} (${workers - s} run.bound${s ? `, ${s} starting` : ""})`;
  return `${live}, ${waiting} waiting (run.intended)`;
};

export const group = (v) => (total(v) === 0 ? "No worker" : starting(v) > 0 ? "Starting a run" : "Workers live");
export const colors = { "No worker": "tan", "Starting a run": "yellow", "Workers live": "blue" };

const who = (from, to) => (JSON.stringify(from.picks.work) !== JSON.stringify(to.picks.work) ? "harness work" : "the daemon");

export const step = (action, from, to) => {
  switch (action) {
    case "PickRuns": return `${who(from, to)} picks the runs to start (runsToStart)`;
    case "Launch": return `${who(from, to)} starts the next run in its pass`;
    case "RunBound": return "Atomic gives the run id (run.bound)";
    case "RunEnds": return "a run ends (run.ended)";
    case "OrphanEnds": return "a second Atomic run of the same ticket ends";
    default: return null;
  }
};
