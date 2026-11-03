export const title = "Ticket lifecycle, with silent tickets (A3)";

const closed = {
  merged: "Merged (ticket.closed merged)",
  closed: "Closed by Vlad (ticket.closed closed)",
  discarded: "Discarded, no comment (ticket.closed discarded)",
  stopped: "Stopped by Vlad (ticket.closed stopped)",
};

const SILENT_END = "FAIL, budget, stuck or a question, no comment";

export const state = (v) => {
  if (v.stage === "closed") return closed[v.outcome];
  const who = v.vis === "visible" ? "Visible" : "Silent";
  switch (v.stage) {
    case "waiting": return `${who}, waiting for a run (ticket.opened ${v.vis})`;
    case "working": return `${who}, worker on it (run.intended, run.bound)`;
    case "asking": return `${who}, question asked in the issue (gate.opened)`;
    case "prOpen": return v.vis === "visible" ? "Visible, PR open (run.ended done)" : "Silent, speculative PR open (run.ended done)";
    case "failedFinal": return "Visible, attempts used up (run.ended failed)";
  }
};

export const group = (v) => (v.stage === "closed" ? (v.outcome === "merged" ? "Merged" : "Closed without merge") : v.vis === "visible" ? "Visible ticket" : "Silent ticket (A3)");
export const colors = { "Visible ticket": "blue", "Silent ticket (A3)": "purple", Merged: "teal", "Closed without merge": "tan" };

export const step = (action, from, to) => {
  switch (action) {
    case "StartRun": return "a slot is free, the daemon starts a run";
    case "WorkerAsks": return to.stage === "closed" ? SILENT_END : "the worker asks or hits its budget (reply.intended ask)";
    case "HumanAnswers": return "the answer arrives (gate.answered)";
    case "VerifierPasses": return from.vis === "visible" ? "verifier PASS, bot opens the PR (reply.intended result)" : "verifier PASS, bot opens a PR and posts one link comment";
    case "AttemptFails":
      if (from.vis === "silent") return SILENT_END;
      return to.stage === "waiting" ? "the attempt fails, attempts left (run.ended failed)" : "the last attempt fails (reply.intended result)";
    case "VladStops": return "Vlad stops it (stop.intended)";
    case "VladPromotes": return "Vlad writes /harness in the thread (reply.intended ack)";
    case "PrMerged": return "the PR is merged";
    case "IssueClosed": return "the issue or the PR is closed";
    default: return null;
  }
};
