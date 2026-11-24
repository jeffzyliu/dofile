// Runs each Stata 14 comparison program in Pyodide with numeric_probe.py, one process per case, and writes
// DIR/<case>.json: `node scripts/check-numeric.ts [--cases a,b] [--shards 4] [--timeout 600] [--out DIR] [--no-shim]`.
// The CPython side is `uv run python web/scripts/numeric_probe.py CASE tests_opendta/tools OUT.json`;
// `uv run python web/scripts/compare_numeric.py CPY_DIR WASM_DIR` diffs the two number by number.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPyodide } from "pyodide";

import { repo } from "./lib/paths.ts";

import { installEngine } from "./install-engine.ts";
import { arg, hasFlag } from "./lib/args.ts";
import { runChild, runShards } from "./lib/shards.ts";

const out = resolve(arg("--out", `${repo}/.dofile/numeric-wasm`));

if (hasFlag("--child")) {
  const caseName = arg("--child", "");
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage(["numpy", "scipy", "matplotlib"], { messageCallback: () => {} });
  await installEngine(py);
  py.FS.mkdirTree("/od");
  py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests_opendta` }, "/od");
  py.FS.writeFile("/tmp/numeric_probe.py", readFileSync(`${repo}/web/scripts/numeric_probe.py`));
  if (!hasFlag("--no-shim")) py.runPython("from dofile import linalgshim; linalgshim.install()");
  py.globals.set("CASE", caseName);
  py.runPython(
    `import sys; sys.path.insert(0, "/tmp"); import numeric_probe; numeric_probe.main(CASE, "/od/tools", "/tmp/result.json")`,
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${caseName}.json`, py.FS.readFile("/tmp/result.json"));
  process.exit(0);
}

const shards = Number(arg("--shards", 4));
const timeoutS = Number(arg("--timeout", 600));
const all = readdirSync(`${repo}/tests_opendta/compat/do`)
  .filter((f) => f.endsWith(".do"))
  .map((f) => f.slice(0, -3))
  .sort();
const cases = arg("--cases", null)?.split(",") ?? all;
for (const c of cases)
  if (!all.includes(c)) {
    console.error(`unknown case: ${c}`);
    process.exit(2);
  }
mkdirSync(out, { recursive: true });
const t0 = performance.now();
const timeouts: string[] = [];
const missing: string[] = [];
const runOne = async (c: string) => {
  const started = performance.now();
  rmSync(`${out}/${c}.json`, { force: true }); // a result left by an earlier run would hide a crash
  const { timedOut } = await runChild(
    fileURLToPath(import.meta.url),
    ["--child", c, "--out", out, ...(hasFlag("--no-shim") ? ["--no-shim"] : [])],
    { limitS: timeoutS },
  );
  if (timedOut) timeouts.push(c);
  if (!existsSync(`${out}/${c}.json`)) missing.push(c);
  if (timedOut || !existsSync(`${out}/${c}.json`))
    console.log(`${timedOut ? "TIMEOUT" : "no result"} ${c} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
};
await runShards(cases, shards, runOne);
console.log(
  `\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${cases.length} cases, ${timeouts.length} timed out, ${missing.length} without a result`,
);
process.exit(timeouts.length || missing.length ? 1 : 0);
