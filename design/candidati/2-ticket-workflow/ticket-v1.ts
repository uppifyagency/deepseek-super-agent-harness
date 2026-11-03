// ticket-v1.ts: the body. FROZEN once shipped (ui replay keys hash the callsite).
// Copied to <engineCwd>/.atomic/workflows/ticket-v1.ts at boot.

import { defineTicketWorkflow, type AttemptResult, type Brief } from "./ticket-workflow";
import type { InboxItem, WaitingFor } from "./inbox";

export default defineTicketWorkflow("ticket-v1", async (t) => {
  let brief: Brief = t.brief;
  let budget = undefined as undefined | { maxCostUsd: number; maxDurationMs: number; maxTokens: number };

  for (let attemptNo = 1; ; attemptNo++) {
    await t.report({ kind: "started", attemptNo });
    const r = await t.attempt(attemptNo, brief, budget);
    budget = undefined;

    let waitingFor: WaitingFor = "events";
    let question: string | undefined;
    switch (r.kind) {
      case "verified": {
        const pr = await t.publish(attemptNo, r);
        await t.report({ kind: "done", attemptNo, pr, verified: r });
        // Not ended: the PR thread is subscribed. Review comments and CI failures wake us;
        // merge/close of every owned thread wakes us with "closed".
        break;
      }
      case "needs_human":
      case "budget": {
        if (t.mandate.delivery === "silent") return t.finish("discarded");   // speculative: stay quiet
        question = r.kind === "budget" ? budgetQuestion(r) : r.question;
        await t.report({ kind: "question", attemptNo, question, options: r.kind === "budget" ? ["continue", "stop"] : r.options });
        waitingFor = "human";
        break;
      }
      case "failed": {
        if (t.mandate.delivery === "silent") return t.finish("discarded");
        await t.report({ kind: "failed", attemptNo, evidence: r.evidence });
        waitingFor = "human";
        break;
      }
    }

    // Park until something relevant arrives. Context-only items do not end the park on
    // their own; the body re-parks (new n) so the decision is still journaled.
    for (;;) {
      const wake = await t.park(waitingFor, question);
      if (wake.kind === "revoked") return t.finish("revoked");
      if (wake.kind === "closed") return t.finish(wake.outcome);
      brief = { ...brief, followUps: [...brief.followUps, ...wake.items] };
      if (wake.items.some(actionable)) break;
    }
    if (r.kind === "budget" && saysContinue(brief.followUps)) budget = raised(r);
  }
});

function actionable(i: InboxItem): boolean {
  // TODO owner-role trigger, environment-online, router-note -> true; context trigger, policy-changed -> false
  throw new Error("not implemented");
}
function budgetQuestion(r: Extract<AttemptResult, { kind: "budget" }>): string { throw new Error("not implemented"); }
/** Deterministic reading of the latest human reply. Ambiguous -> false (never approval by default). */
function saysContinue(items: readonly InboxItem[]): boolean { throw new Error("not implemented"); }
function raised(r: Extract<AttemptResult, { kind: "budget" }>) { return { ...r.cap, maxCostUsd: r.cap.maxCostUsd * 2 }; }
