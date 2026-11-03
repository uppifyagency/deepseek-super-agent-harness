// Spike host: ENGINE session. Env: ACTION=start|resume|inspect, WF, RUNKEY, RUNID, ANSWER=red|hang, WAIT_MS
import { createAgentSession, SessionManager } from "@bastani/atomic";
const t0 = Date.now();
const log = (...a) => console.log(`[host +${((Date.now() - t0) / 1000).toFixed(1)}s pid=${process.pid}]`, ...a);
const ACTION = process.env.ACTION ?? "start";
const WF = process.env.WF ?? "spike-two";
const RUNKEY = process.env.RUNKEY ?? "k1";
const ANSWER = process.env.ANSWER ?? "red";
const WAIT_MS = Number(process.env.WAIT_MS ?? 180000);
const JOURNAL = new URL("./journal.sqlite", import.meta.url).pathname;

globalThis[Symbol.for("it.delera.harness.bridge")] = { spec: (rk) => `BRIDGE-OK:${rk}:pid${process.pid}` };

const humanLog = (kind, a, o) => log("HUMANINPUT", kind, JSON.stringify(a), JSON.stringify({ requestId: o.requestId, sessionId: o.sessionId, workflowRunId: o.workflowRunId, workflowStageId: o.workflowStageId }));
const hang = (o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))));
const humanInput = {
  async confirm(t, m, o) { humanLog("confirm", [t, m], o); return ANSWER === "hang" ? hang(o) : true; },
  async select(t, c, o) { humanLog("select", [t, c], o); return ANSWER === "hang" ? hang(o) : c[0]; },
  async input(t, p, o) { humanLog("input", [t, p], o); return ANSWER === "hang" ? hang(o) : ANSWER; },
  async editor(t, i, o) { humanLog("editor", [t, i], o); return ANSWER === "hang" ? hang(o) : ANSWER; },
  async questionnaire(params, o) {
    humanLog("questionnaire", params, o);
    if (ANSWER === "hang") return hang(o);
    const q = params.questions[0];
    const opt = q.options.find((o) => o.label === ANSWER) ?? q.options[0];
    return { cancelled: false, answers: [{ questionIndex: 0, question: q.question, kind: "option", answer: opt.label }] };
  },
};

const { session } = await createAgentSession({
  cwd: process.cwd(),
  ...(process.env.STORE ? { sessionStore: { kind: "sqlite", path: new URL("./sessions.sqlite", import.meta.url).pathname } } : { sessionManager: SessionManager.inMemory() }),
  journal: { path: JOURNAL },
  extensionBindings: { humanInput, onDiagnostic: (d) => log("DIAG", JSON.stringify(d)) },
});
const evCounts = {};
session.subscribe((e) => { evCounts[e.type] = (evCounts[e.type] ?? 0) + 1; if (/turn|message_start|provider|agent_start/.test(e.type)) log("ENGINE-EVENT", e.type, e.message ? (e.message.role + ":" + (e.message.customType ?? "") + ":" + JSON.stringify(e.message.content ?? "").slice(0, 160)) : ""); });
log("engine session", session.sessionId, "model", session.model?.provider + "/" + session.model?.id);

let lastStatus = {};
const sub = session.workflows.observe((f) => {
  if (f.kind === "snapshot") { if (process.env.SNAP) log("observe snapshot", f.availability, (f.roots ?? []).length); return; }
  if (f.kind === "removed") { log("observe removed", f.rootRunId); return; }
  const r = f.root; const nodes = (r.graph?.nodes ?? []).map((n) => `${n.kind}:${n.name}=${n.status}${n.pendingPrompt ? "[PROMPT:" + n.pendingPrompt.kind + "]" : ""}`).join(",");
  const key = r.rootRunId; const s = `${r.status} ${nodes}`;
  if (lastStatus[key] !== s) { lastStatus[key] = s; log("observe", key.slice(0, 8), s); }
});

async function findByKey() {
  const runs = await session.workflows.listRuns({ includeDurable: true });
  const out = [];
  for (const r of runs) { const d = await session.workflows.getRun(r.runId).catch(() => null); if (d?.inputs?.runKey === RUNKEY) out.push(d); }
  log("listRuns(includeDurable) count", runs.length, "statuses", runs.map((r) => r.runId.slice(0, 8) + ":" + r.status + ":id=" + r.identity).join(" "));
  return out;
}

try {
  let runId = process.env.RUNID;
  if (ACTION === "start") {
    const before = Date.now();
    await session.prompt(`/workflow ${WF} runKey=${RUNKEY}`);
    log("prompt() returned after", Date.now() - before, "ms; messages in engine session:", session.messages.length, session.messages.map((m) => m.role + ":" + JSON.stringify(m.content).slice(0, 200)));
    const runs = await session.workflows.listRuns();
    log("listRuns()", JSON.stringify(runs, null, 0).slice(0, 1500));
    runId = runs[0]?.runId;
  } else if (ACTION === "resume") {
    log("getRun before resume", JSON.stringify(await session.workflows.getRun(runId)).slice(0, 1200));
    const out = await session.workflows.resume(runId);
    log("resume outcome", JSON.stringify(out));
  } else if (ACTION === "slashresume") {
    await session.prompt(`/workflow resume ${runId}`);
    log("slash resume messages", JSON.stringify(session.messages.map((m) => m.role + ":" + JSON.stringify(m.content).slice(0, 400))));
  } else if (ACTION === "idle") {
    log("idle: waiting", WAIT_MS, "ms (resumeInFlight test)"); await new Promise((r) => setTimeout(r, WAIT_MS));
    log("listRuns", JSON.stringify((await session.workflows.listRuns()).map((r) => [r.runId, r.status])));
    runId = undefined;
  } else if (ACTION === "inspect") {
    log("listRuns includeDurable", JSON.stringify(await session.workflows.listRuns({ includeDurable: true })).slice(0, 3000));
    if (runId) log("getRun", JSON.stringify(await session.workflows.getRun(runId)).slice(0, 3000));
    process.exitCode = 0;
  }
  if (runId && ACTION !== "inspect") {
    log("runId", runId);
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const d = await session.workflows.getRun(runId);
      if (["completed", "failed", "killed", "blocked"].includes(d.status) || process.env.STOP_ON === d.status) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await session.workflows.waitForSettled(runId).catch((e) => log("waitForSettled err", e.message));
    const d = await session.workflows.getRun(runId);
    log("FINAL getRun", JSON.stringify(d).slice(0, 4000));
    log("byKey", JSON.stringify((await findByKey()).map((r) => ({ runId: r.runId, status: r.status, inputs: r.inputs }))));
  }
} catch (e) {
  log("ERROR", e?.name, e?.code, e?.message);
} finally {
  log("ENGINE event counts", JSON.stringify(evCounts));
  sub.dispose();
  await session.dispose().catch((e) => log("dispose err", e.message));
}
