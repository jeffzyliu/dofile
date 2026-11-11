// Numeric comparison of CPython and Pyodide (`node scripts/check-numeric.mjs [--cases a,b] [--shards 4] [--timeout 600]
// [--out DIR] [--no-shim]`): runs each Stata 14 comparison program in Pyodide with numeric_probe.py, one process per
// case, and writes DIR/<case>.json. The CPython side is the same file:
//   uv run python web/scripts/numeric_probe.py CASE tests_opendta/tools OUT.json
// and `uv run python web/scripts/compare_numeric.py CPY_DIR WASM_DIR` diffs them number by number.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import { installEngine } from "./install-engine.ts";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const out = resolve(arg("--out", `${repo}/.dofile/numeric-wasm`));

if (args.includes("--child")) {
  const caseName = arg("--child");
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage(["numpy", "scipy", "matplotlib"], { messageCallback: () => {} });
  await installEngine(py);
  py.FS.mkdirTree("/od");
  py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests_opendta` }, "/od");
  py.FS.writeFile("/tmp/numeric_probe.py", readFileSync(`${repo}/web/scripts/numeric_probe.py`));
  if (!args.includes("--no-shim")) py.runPython("from dofile import linalgshim; linalgshim.install()");   // as browser.start() does
  py.globals.set("CASE", caseName);
  py.runPython(`import sys; sys.path.insert(0, "/tmp"); import numeric_probe; numeric_probe.main(CASE, "/od/tools", "/tmp/result.json")`);
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${caseName}.json`, py.FS.readFile("/tmp/result.json"));
  process.exit(0);
}

const shards = Number(arg("--shards", 4)), timeoutS = Number(arg("--timeout", 600));
const all = readdirSync(`${repo}/tests_opendta/compat/do`).filter(f => f.endsWith(".do")).map(f => f.slice(0, -3)).sort();
const cases = arg("--cases", null)?.split(",") ?? all;
for (const c of cases) if (!all.includes(c)) { console.error(`unknown case: ${c}`); process.exit(2); }
mkdirSync(out, { recursive: true });
const t0 = performance.now(), timeouts = [], missing = [], queue = [...cases];
const runOne = c => new Promise(done => {
  const started = performance.now();
  rmSync(`${out}/${c}.json`, { force: true });   // a result left by an earlier run would hide a crash
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", c, "--out", out, ...(args.includes("--no-shim") ? ["--no-shim"] : [])], { stdio: "ignore" });
  const timer = setTimeout(() => { timeouts.push(c); child.kill("SIGKILL"); }, timeoutS * 1000);
  child.on("exit", () => {
    clearTimeout(timer);
    if (!existsSync(`${out}/${c}.json`)) missing.push(c);
    if (timeouts.includes(c) || !existsSync(`${out}/${c}.json`)) console.log(`${timeouts.includes(c) ? "TIMEOUT" : "no result"} ${c} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
    done();
  });
});
await Promise.all(Array.from({ length: shards }, async () => { for (let c; (c = queue.shift());) await runOne(c); }));
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${cases.length} cases, ${timeouts.length} timed out, ${missing.length} without a result`);
process.exit(timeouts.length || missing.length ? 1 : 0);
