export const expect = "SilentStaysQuiet";
export const broken = "GatesSkipSilent = FALSE. A question or a budget gate in a silent ticket is asked in the issue, which is what gates.ts does today: openGate (gates.ts:49-56), gatesForRouter (gates.ts:70-72) and the budget gate (runs.ts:211-213, audience requester at runs.ts:71) never look at visibility.";
export const legend = [
  "Start states: ticket.opened with visibility visible or silent (domain.ts:86). Today decide() always writes visible (routing.ts:134, routing.ts:146), so the silent half of the chart is the A3 plan, not code.",
  "Worker on it: run.intended from planRuns (runs.ts:104-149), then run.bound from the engine (engine.ts:223-234).",
  "Question asked in the issue: gate.opened (gates.ts:49-56), then the router asks with reply.intended purpose ask.",
  "Attempt fails, attempts left: run.ended failed and retryable, isFinal false (runs.ts:62-65), so planRuns writes the next run.intended.",
  "PR open: run.ended done after the verifier PASS and publish (engine.ts:116-133). The result reply goes only to visible tickets (runs.ts:161).",
  "Silent end with no comment: ticket.closed discarded after FAIL, budget, stuck or a question (plan A3).",
  "Promotion: Vlad writes /harness in the same thread, a trigger with addressed true (service.ts:58-61), then reply.intended ack. Kinds has no fact for the change of visibility yet.",
  "Closed states: ticket.closed with outcome merged, closed, discarded or stopped (domain.ts:98). Nothing writes ticket.closed yet. ticketsView only reads it (routing.ts:195-210).",
  "Stopped by Vlad: decided stop (domain.ts:37), then stop.intended (domain.ts:95). Nothing writes stop.intended yet.",
];
export const rules = [
  "SilentStaysQuiet: while a ticket is silent, its issue gets no ack, no question, no result, and at most one comment (the PASS link).",
  "DiscardedHasNoPR: a discarded ticket never has a PR.",
];
export const leftOut = [
  "One ticket, at most 2 attempts, at most one question per attempt.",
  "The budget gate of a visible ticket is drawn as a question. The run-stop chart shows it in detail.",
  "Follow-ups (input.routed) and the PR review thread.",
];
