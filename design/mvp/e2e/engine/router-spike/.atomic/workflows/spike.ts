import { workflow } from "@bastani/atomic/workflows";
import { Type } from "typebox";

const M = "openai-codex/gpt-5.6-luna-fast:low";
const BRIDGE = Symbol.for("it.delera.harness.bridge");

// S1 + S3: two stages plus a ctx.tool that reads the host bridge.
export const spikeTwo = workflow({
  name: "spike-two",
  description: "two stage spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { a: Type.String(), b: Type.String(), bridge: Type.String() },
  run: async (ctx) => {
    const br = await ctx.tool("bridge", { runKey: ctx.inputs.runKey }, () => {
      const b = (globalThis as any)[BRIDGE];
      return b ? String(b.spec(ctx.inputs.runKey)) : "MISSING";
    });
    const bridge = String(br);
    const a = await ctx.task("one", { model: M, prompt: "Reply with exactly the word ALPHA and nothing else. Do not use tools." });
    const b = await ctx.task("two", { model: M, prompt: "Reply with exactly the word BETA and nothing else. Do not use tools." });
    return { a: a.text, b: b.text, bridge };
  },
});

// S2 / S5: stage one completes, stage two must ask the human.
export const spikeAsk = workflow({
  name: "spike-ask",
  description: "ask spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { first: Type.String(), answer: Type.String() },
  run: async (ctx) => {
    const t = await ctx.tool("marker", {}, () => { console.error(`[wf] marker tool executed pid=${process.pid}`); return Date.now(); });
    const first = await ctx.task("first", { model: M, prompt: "Reply with exactly FIRST-DONE. Do not use tools." });
    console.error(`[wf] first stage done pid=${process.pid} text=${first.text}`);
    const ask = await ctx.task("ask", { model: M, prompt: "You MUST call the ask_user_question tool exactly once, asking the user: 'What color?' with options red and blue. Then reply with exactly ANSWER=<the answer the user gave>. If the tool is unavailable, reply NO-ASK-TOOL." });
    return { first: first.text + " t=" + String(t), answer: ask.text };
  },
});

// S4: steer from inside the stage callback while the agent is busy in bash.
export const spikeSteer = workflow({
  name: "spike-steer",
  description: "steer spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { text: Type.String() },
  run: async (ctx) => {
    const s = ctx.stage("busy", { model: M });
    const p = s.prompt("Run the bash command `sleep 20 && echo slept` using the bash tool. After it finishes, reply with one short sentence saying it finished.");
    setTimeout(() => {
      s.steer("include the word PING in your final answer").then(
        () => console.error("[wf] steer resolved"),
        (e) => console.error("[wf] steer rejected", e?.message));
    }, 8000);
    const text = await p;
    return { text: String(text) };
  },
});

// S6: tool ceiling. Stage runs bash.
export const spikeTools = workflow({
  name: "spike-tools",
  description: "tools spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { text: Type.String() },
  run: async (ctx) => {
    const t = await ctx.task("bash", { model: M, prompt: "Use the bash tool to run `echo TOOLS-$((40+2))` and reply with its exact output. If you have no bash tool, reply NO-BASH." });
    return { text: t.text };
  },
});

// S7: child attempt with tiny budget.
const child = workflow({
  name: "spike-budget-child",
  description: "child",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { text: Type.String() },
  run: async (ctx) => {
    const a = await ctx.task("c1", { model: M, prompt: "Write three sentences about the sea. Do not use tools." });
    const b = await ctx.task("c2", { model: M, prompt: "Write three sentences about mountains. Do not use tools." });
    return { text: a.text + b.text };
  },
});
export const spikeBudget = workflow({
  name: "spike-budget",
  description: "budget spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { child: Type.String() },
  run: async (ctx) => {
    try {
      const r = await ctx.workflow(child, { inputs: { runKey: ctx.inputs.runKey }, budget: { maxTokens: 50 } });
      return { child: JSON.stringify(r) };
    } catch (e: any) {
      return { child: "THREW " + e?.name + ": " + e?.message + " " + JSON.stringify(Object.keys(e ?? {})) };
    }
  },
});

// S7b: root-level budget.
export const spikeBudgetRoot = workflow({
  name: "spike-budget-root",
  description: "root budget",
  heartbeatIntervalMinutes: 0,
  budget: { maxTokens: 50 },
  inputs: { runKey: Type.String() },
  outputs: { text: Type.String() },
  run: async (ctx) => {
    const a = await ctx.task("r1", { model: M, prompt: "Write three sentences about the sea. Do not use tools." });
    const b = await ctx.task("r2", { model: M, prompt: "Write three sentences about rivers. Do not use tools." });
    return { text: a.text + b.text };
  },
});

// S4b: no in-body steer; host steers via pause/resume(message).
export const spikeHostSteer = workflow({
  name: "spike-hoststeer",
  description: "host steer spike",
  heartbeatIntervalMinutes: 0,
  inputs: { runKey: Type.String() },
  outputs: { text: Type.String() },
  run: async (ctx) => {
    const t = await ctx.task("busy", { model: M, prompt: "Run the bash command `sleep 20 && echo slept` using the bash tool. After it finishes, reply with one short sentence saying it finished." });
    return { text: t.text };
  },
});
