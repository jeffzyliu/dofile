// Compare two folders of per-file pytest results (pytest_report.py), CPython baseline against Pyodide:
//   node scripts/compare-pytest.mjs BASELINE_DIR PYODIDE_DIR
// Lists every test whose outcome differs, the files with no result on one side, and the slowest tests in Pyodide
// against CPython. Exit code 1 if any outcome differs.
import { existsSync, readdirSync, readFileSync } from "node:fs";

const [baseDir, wasmDir] = process.argv.slice(2);
if (!baseDir || !wasmDir) {
  console.error("usage: compare-pytest.mjs BASELINE_DIR PYODIDE_DIR");
  process.exit(2);
}
const load = (dir) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))]),
  );
const base = load(baseDir),
  wasm = load(wasmDir);

const count = {},
  diffs = [],
  slow = [];
for (const f of Object.keys(base)) {
  if (!wasm[f]) continue;
  for (const [id, b] of Object.entries(base[f].tests)) {
    const w = wasm[f].tests[id];
    count[b.outcome] = (count[b.outcome] ?? 0) + 1;
    if (!w) diffs.push({ id, base: b.outcome, wasm: "(not run)", why: "" });
    else if (w.outcome !== b.outcome) diffs.push({ id, base: b.outcome, wasm: w.outcome, why: w.why });
    if (w && b.s > 0.05) slow.push({ id, ratio: w.s / b.s, b: b.s, w: w.s });
  }
  for (const id of Object.keys(wasm[f].tests))
    if (!base[f].tests[id]) diffs.push({ id, base: "(not run)", wasm: wasm[f].tests[id].outcome, why: "" });
}
const missingWasm = Object.keys(base).filter((f) => !wasm[f]),
  missingBase = Object.keys(wasm).filter((f) => !base[f]);
const nb = Object.values(base).reduce((n, r) => n + Object.keys(r.tests).length, 0);
console.log(
  `${Object.keys(base).length} files, ${nb} tests on CPython: ${Object.entries(count)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")}`,
);
console.log(`${diffs.length} tests with a different outcome in Pyodide`);
for (const d of diffs)
  console.log(
    `  ${d.id}\n      CPython ${d.base}, Pyodide ${d.wasm}${d.why ? ": " + d.why.replace(/\s+/g, " ").slice(0, 220) : ""}`,
  );
if (missingWasm.length) console.log(`no Pyodide result for: ${missingWasm.join(", ")}`);
if (missingBase.length) console.log(`no CPython result for: ${missingBase.join(", ")}`);
slow.sort((a, b) => b.w - a.w);
console.log("\nslowest in Pyodide (seconds; CPython in brackets):");
for (const s of slow.slice(0, 8)) console.log(`  ${s.w.toFixed(1).padStart(7)} (${s.b.toFixed(2)})  ${s.id}`);
process.exit(diffs.length || missingWasm.length ? 1 : 0);
