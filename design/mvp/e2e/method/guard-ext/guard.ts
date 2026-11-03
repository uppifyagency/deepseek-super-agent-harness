import { appendFileSync } from "node:fs";
const LOG = process.env.GUARD_LOG || "/dev/null";
export default function guard(pi: any) {
  appendFileSync(LOG, `load pid=${process.pid} cwd=${process.cwd()}\n`);
  pi.on("session_start", async (_e: any, ctx: any) => {
    appendFileSync(LOG, `session_start cwd=${ctx.cwd ?? "?"}\n`);
  });
  pi.on("turn_start", async (_e: any, ctx: any) => {
    const sp = String(ctx.getSystemPrompt?.() ?? "");
    appendFileSync(LOG, `turn_start cwd=${ctx.cwd} mandate=${sp.includes("<pstack-session-start>")} sheet=${sp.includes("<pstack-models>")} askoff=${sp.includes("pi ask tool: off")} poteto=${sp.includes("<name>poteto-mode</name>")}
`);
  });
  pi.on("tool_call", async (event: any, ctx: any) => {
    const cmd = event.toolName === "bash" ? String(event.input?.command ?? "") : "";
    appendFileSync(LOG, `tool_call ${event.toolName} cwd=${ctx.cwd ?? "?"} cmd=${JSON.stringify(cmd)}\n`);
    if (/(^|[\s;&|(])git\s+push\b/.test(cmd) || /(^|[\s;&|(])gh\s/.test(cmd)) {
      return { block: true, reason: "HARNESS-GUARD: git push / gh are reserved for the publish step" };
    }
  });
}
