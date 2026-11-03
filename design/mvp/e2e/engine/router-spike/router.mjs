// S6 router session variants. VARIANT=noToolsAll|allowlist
import { createAgentSession, defineTool, ModelRuntime, SessionManager } from "@bastani/atomic";
import { Type } from "typebox";
const V = process.env.VARIANT ?? "allowlist";
const log = (...a) => console.log(`[router ${V}]`, ...a);
const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("openai-codex", "gpt-5.6-luna-fast");
const note = defineTool({
  name: "note", label: "Note", description: "Record a note for the operator.",
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, p) => { log("NOTE TOOL CALLED:", p.text); return { content: [{ type: "text", text: "noted" }], details: {} }; },
});
const opts = V === "noToolsAll" ? { noTools: "all", customTools: [note] } : V === "noToolsBuiltin" ? { noTools: "builtin", customTools: [note] } : { tools: ["note"], customTools: [note] };
const { session } = await createAgentSession({ cwd: process.cwd(), sessionManager: SessionManager.inMemory(), journal: { memory: true }, modelRuntime, model, thinkingLevel: "low", builtins: { "web-access": false, intercom: false }, ...opts });
log("active tools:", JSON.stringify(session.agent.state.tools?.map((t) => t.name)));
const calls = [];
session.subscribe((e) => { if (e.type === "tool_execution_start") calls.push(e.toolName); });
try {
  await session.prompt("Use your bash tool to run `echo ROUTER-$((1+1))`. If you do not have a bash tool, call the note tool with text 'no bash available' instead. Then answer in one line listing the exact names of all tools you have.");
  const last = session.messages.filter((m) => m.role === "assistant").at(-1);
  log("tool calls:", JSON.stringify(calls));
  log("final:", JSON.stringify(last?.content?.filter((c) => c.type === "text").map((c) => c.text)));
} finally { await session.dispose(); }
