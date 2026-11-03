export const title = "A reply in the issue across a crash between the POST and reply.settled";

export const state = (v) => {
  if (!v.intended) return "Nothing to send yet";
  if (v.comments >= 2) return "Two comments for one intent";
  if (v.settled) return "Settled, one comment (reply.settled sent)";
  const pc = v.pc.daemon;
  const posted = v.comments === 1;
  switch (pc) {
    case "down": return posted ? "Daemon down after the POST, still pending (reply.intended)" : "Daemon down before the POST, still pending (reply.intended)";
    case "idle": return posted ? "Daemon back, comment on GitHub, still pending (reply.intended)" : "Pending in the outbox (reply.intended)";
    case "missing": return posted ? "Marker not looked up, about to POST again" : "No marker on GitHub, about to POST";
    case "found": return "Marker found on GitHub, no new POST";
    case "posted": return "Comment posted, settle not written yet";
  }
};

export const group = (v) => {
  if (!v.intended) return "Before the reply";
  if (v.settled) return "Settled";
  return v.pc.daemon === "down" ? "Daemon down" : "Daemon sending";
};
export const colors = { "Before the reply": "tan", "Daemon sending": "blue", "Daemon down": "orange", Settled: "teal" };

export const step = (action, from, to) => {
  switch (action) {
    case "RouterReplies": return "the router replies (reply.intended)";
    case "LookUpMarker": return to.pc.daemon === "found" ? "the daemon lists the comments and finds the marker" : "the daemon lists the comments, no marker";
    case "Post": return "the daemon POSTs the comment with the marker";
    case "Settle": return "the daemon writes reply.settled";
    case "Crash": return "the daemon crashes";
    case "Restart": return "launchd restarts the daemon";
    default: return null;
  }
};
