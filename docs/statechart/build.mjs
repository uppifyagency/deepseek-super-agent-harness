import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const FLOWS = ["ticket-lifecycle", "run-stop", "issue-reply", "worker-slots"];
const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
const { TLA2TOOLS, STATECHART, JAVA = "java" } = process.env;
if (!TLA2TOOLS || !STATECHART) {
  console.error("Set TLA2TOOLS to tla2tools.jar and STATECHART to the statechart launcher.");
  process.exit(2);
}

const COLORS = {
  blue: "#c3e0ff", orange: "#f0d3bf", purple: "#e3d5ff", yellow: "#f0dcbf", teal: "#bfe3df", tan: "#e5d9ce", pink: "#ffcbe6",
};
const classDefs = [
  ...Object.entries(COLORS).map(([name, fill]) => `  classDef ${name} fill:${fill},stroke:#808080,color:#1c1c1c`),
  "  classDef bugPath stroke:#1680f3,stroke-width:2.5px",
];

/** GitHub ignores CSS, so the group colors and the bug path become classDef lines before the bug marks. */
function forGitHub(mmd) {
  const lines = mmd.trimEnd().split("\n");
  const at = lines.findIndex((l) => l.startsWith("  classDef "));
  lines.splice(at === -1 ? lines.length : at, 0, ...classDefs);
  return lines.join("\n") + "\n";
}

function tlc(dir, tla, cfg) {
  const meta = mkdtempSync(join(tmpdir(), "tlc-"));
  const r = spawnSync(JAVA, ["-XX:+UseParallelGC", "-cp", TLA2TOOLS, "tlc2.TLC", "-workers", "1", "-config", cfg, "-metadir", meta, tla], { cwd: dir, encoding: "utf8" });
  rmSync(meta, { recursive: true, force: true });
  const out = r.stdout + r.stderr;
  const num = (re) => (out.match(re)?.[1] ?? "?").replace(/,/g, "");
  return {
    command: `java -XX:+UseParallelGC -cp $TLA2TOOLS tlc2.TLC -workers 1 -config ${cfg} ${tla}`,
    ok: /No error has been found/.test(out),
    violated: out.match(/Invariant (\w+) is violated/)?.[1],
    trace: (out.match(/^State \d+:/gm) ?? []).length,
    generated: num(/([\d,]+) states generated/),
    distinct: num(/([\d,]+) distinct states found/),
    depth: num(/depth of the complete state graph search is (\d+)/),
  };
}

function chart(dir, tla, cfg) {
  const out = join(mkdtempSync(join(tmpdir(), "chart-")), "out");
  const run = spawnSync(STATECHART, [tla, "--config", cfg, "--view", "view.mjs", "--out", out], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } });
  if (run.status !== 0 && run.status !== 1) throw new Error(`statechart failed on ${cfg}: ${run.stdout}${run.stderr}`);
  const read = (f) => readFileSync(join(out, f), "utf8");
  const result = { mmd: forGitHub(read("chart.mmd")), report: read("report.md") };
  rmSync(dirname(out), { recursive: true, force: true });
  return result;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
const result = (r) => r.ok
  ? `No error. ${r.generated} states generated, ${r.distinct} distinct, depth ${r.depth}.`
  : `Invariant ${r.violated} is violated, trace of ${r.trace} states. ${r.generated} states generated, ${r.distinct} distinct.`;

function page(flow, v, good, bad, base, rotto) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(flow)} statechart</title>
<style>:root{--bg:#fafafa;--fg:#1c1c1c;--muted:#555;--card:#fff;--line:#ddd}@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#f0f0f0;--muted:#aaa;--card:#202020;--line:#3a3a3a}}body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px;max-width:1200px}h1{font-size:22px}h2{font-size:18px;margin:28px 0 8px}.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto}.note,li{color:var(--muted);font-size:14px;line-height:1.5}code{font-size:13px}</style></head><body>
<h1>${esc(v.title)}</h1>
<p class="note">Model <code>${esc(flow.replace(/-/g, "_"))}.tla</code>, checked with TLC 2.19 (tla2tools 1.7.4) and drawn with the pstack statechart skill. Each state names the log fact (<code>Kinds</code> in harness/src/domain.ts) that stands for it. Rebuild with <code>node docs/statechart/build.mjs ${esc(flow)}</code>.</p>
<h2>Rules</h2>${list(v.rules)}
<h2>The model as configured</h2><p class="note">${esc(good.command)}<br>${esc(result(good))}</p>
<div class="card"><pre class="mermaid">${esc(base.mmd)}</pre></div>
<h2>Where each state and arrow is in the code</h2>${list(v.legend)}
<h2>The broken model</h2><p class="note">${esc(v.broken)}</p><p class="note">${esc(bad.command)}<br>${esc(result(bad))}</p>
<div class="card"><pre class="mermaid">${esc(rotto.mmd)}</pre></div>
<pre class="note">${esc(rotto.report.trim())}</pre>
<h2>What the model leaves out</h2>${list(v.leftOut)}
<script src="${MERMAID}"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:"strict",theme:"default"});</script></body></html>
`;
}

let failed = false;
for (const flow of process.argv.slice(2).length ? process.argv.slice(2) : FLOWS) {
  const dir = join(root, flow);
  const tla = `${flow.replace(/-/g, "_")}.tla`;
  const v = { ...(await import(pathToFileURL(join(dir, "view.mjs")).href)), ...(await import(pathToFileURL(join(dir, "notes.mjs")).href)) };
  const good = tlc(dir, tla, `${flow}.cfg`);
  const bad = tlc(dir, tla, `${flow}.rotto.cfg`);
  console.log(`${flow}.cfg: ${result(good)}`);
  console.log(`${flow}.rotto.cfg: ${result(bad)}`);
  if (!good.ok || bad.violated !== v.expect) {
    console.error(`${flow}: expected ${flow}.cfg to pass and ${flow}.rotto.cfg to break ${v.expect}`);
    failed = true;
    continue;
  }
  const base = chart(dir, tla, `${flow}.cfg`);
  const rotto = chart(dir, tla, `${flow}.rotto.cfg`);
  writeFileSync(join(dir, `${flow}.mmd`), base.mmd);
  writeFileSync(join(dir, "charts.html"), page(flow, v, good, bad, base, rotto));
}
process.exit(failed ? 1 : 0);
