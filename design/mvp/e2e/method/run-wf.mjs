// Usage: node run-wf.mjs <repo> "<workflow args>" <guardlog>
import { appendFileSync } from "node:fs";
const A = process.env.ATOMIC_PKG + "/dist/index.js";
const { createAgentSession, DefaultResourceLoader, getAgentDir } = await import(A);
const [repo, wfArgs, LOG] = process.argv.slice(2);
const log = (s) => appendFileSync(LOG, s + "\n");
function guardExtension(pi) {
  log(`factory pid=${process.pid}`);
  pi.on("project_trust", async () => { log("project_trust -> yes"); return { trusted: true }; });
  pi.on("session_start", async (_e, ctx) => log(`session_start cwd=${ctx.cwd} subagentPolicy=${JSON.stringify(ctx.subagentPolicy ?? null)}`));
  pi.on("tool_call", async (event, ctx) => {
    const cmd = event.toolName === "bash" ? String(event.input?.command ?? "") : "";
    log(`tool_call ${event.toolName} cwd=${ctx.cwd} cmd=${JSON.stringify(cmd)}`);
    if (/(^|[\s;&|(])git\s+push\b/.test(cmd) || /(^|[\s;&|(])gh\s/.test(cmd))
      return { block: true, reason: "HARNESS-GUARD: git push / gh are reserved for the publish step" };
  });
}
const mode = process.env.LOADER_MODE || "loader";
let session;
if (mode === "loader") {
  const loader = new DefaultResourceLoader({ cwd: repo, agentDir: getAgentDir(), extensionFactories: [guardExtension] });
  await loader.reload();
  ({ session } = await createAgentSession({ cwd: repo, resourceLoader: loader }));
} else {
  ({ session } = await createAgentSession({ cwd: repo, extensionFactories: [guardExtension] }));
}
log(`mode=${mode}`);
let runId;
const done = new Promise((resolve) => {
  session.workflows.observe((f) => {
    for (const r of f.runs ?? f.roots ?? []) {
      if (!runId && r.workflowName === "spike-wt") runId = r.runId;
    }
    log(`frame ${f.kind ?? f.type} ${JSON.stringify(f).slice(0, 300)}`);
    const s = JSON.stringify(f);
    if (/"status":"(completed|failed|killed)"/.test(s) && /spike-wt/.test(s)) resolve();
  });
});
try {
  await session.prompt(`/workflow spike-wt ${wfArgs} --no-picker`);
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const rs = await session.workflows.listRuns({ includeDurable: true });
    if (rs.length && rs.every((r) => ["completed", "failed", "killed"].includes(r.status))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const runs = await session.workflows.listRuns({ includeDurable: true });
  const run = runs.find((r) => r.workflowName === "spike-wt" || r.name === "spike-wt") ?? runs[0];
  console.log("RUNS", JSON.stringify(runs.map((r) => ({ id: r.runId, name: r.workflowName ?? r.name, status: r.status }))));
  if (run) {
    await session.workflows.waitForSettled(run.runId);
    const d = await session.workflows.getRun(run.runId);
    console.log("RUN", JSON.stringify(d).slice(0, 4000));
  }
} finally {
  await session.dispose();
}
