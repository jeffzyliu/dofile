// dofile's and OpenDTA's own pytest files, run inside Pyodide (`npm run check-pytest`), to compare with CPython test by
// test. Complements check-snapshot.mjs, which runs the conformance corpus and the Stata 14 logs: this one runs the unit
// tests, which reach commands those do not.
//
//   node scripts/check-pytest.mjs [--paths a.py,b.py] [--shards 4] [--timeout 900] [--out DIR] [--no-shim] [--ios]
//
// Each test file runs in its own process (a fresh Pyodide, as the page starts one), is killed after --timeout seconds,
// and writes DIR/<file>.json (see pytest_report.py). Default files: tests_opendta/tests/test_*.py and the dofile tests
// that make sense without subprocesses (WEB_TESTS). The baseline is the same plugin on CPython:
//   uv run python web/scripts/pytest_report.py OUT.json FILE -q -p no:cacheprovider
// and `node scripts/compare-pytest.mjs BASELINE_DIR DIR` lists the differences.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, basename } from "node:path";
import { loadPyodide } from "pyodide";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const out = resolve(arg("--out", `${repo}/.dofile/pytest-wasm`));
// dofile tests that make sense in the page's Python. Left out, because they start subprocesses, need the `mcp` package or
// the repo's src/ tree, or assume the numpy.linalg shim is not installed yet (it is, as in the page): test_browser
// (covered by web/test/engine.test.mjs), test_pathshim, test_linalgshim (covered by web/test/linalgshim.test.mjs), test_log_cut
// (mcp_server), test_mcp, test_worker, test_sandbox, test_break, test_dofile_cli, test_vendor, test_conformance, test_stata_compat.
const WEB_TESTS = ["tests/test_engine.py"];

if (args.includes("--child")) {
  const file = arg("--child");
  // --ios: Pyodide's loader tests navigator.userAgent for iPhone/iPad and then creates no WebAssembly trampoline function
  // (getPyEMTrampolinePtr); this makes Node look like that, to run the suite the way an iPhone runs the engine
  if (args.includes("--ios")) Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 } });
  const py = await loadPyodide({ stdout: s => console.log(s), stderr: s => console.log(s) });
  await py.loadPackage(["pytest", "numpy", "scipy", "matplotlib"], { messageCallback: () => {} });
  await py.loadPackage("micropip", { messageCallback: () => {} });
  const dist = `${repo}/dist`, wheel = readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1);
  py.FS.writeFile(`/tmp/${wheel}`, readFileSync(`${dist}/${wheel}`));
  await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${wheel}")`);
  for (const d of ["tests_opendta", "tests"]) {
    py.FS.mkdirTree(`/repo/${d}`);
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/${d}` }, `/repo/${d}`);
  }
  py.FS.mkdirTree("/work");
  py.FS.writeFile("/tmp/pytest_report.py", readFileSync(`${repo}/web/scripts/pytest_report.py`));
  if (!args.includes("--no-shim")) py.runPython("from dofile import linalgshim; linalgshim.install()");   // as browser.start() does
  py.globals.set("FILE", file);
  py.globals.set("OUT", "/tmp/result.json");
  py.runPython(`
import os, sys
os.chdir("/work"); sys.path.insert(0, "/tmp")
import pytest_report
pytest_report.run(OUT, ["/repo/" + FILE, "-q", "-p", "no:cacheprovider", "--rootdir=/repo", "-o", "addopts="])`);
  mkdirSync(out, { recursive: true });
  // the table is one entry shorter when Pyodide created no trampoline (an iPhone user agent): proof of which mode ran
  const result = { ...JSON.parse(py.FS.readFile("/tmp/result.json", { encoding: "utf8" })), wasmTableLength: py._module.wasmTable.length, ios: args.includes("--ios") };
  writeFileSync(`${out}/${basename(file)}.json`, JSON.stringify(result));
  process.exit(0);
}

// ---- the parent ------------------------------------------------------------------------------------------------------
const shards = Number(arg("--shards", 4)), timeoutS = Number(arg("--timeout", 900));
const files = arg("--paths", null)?.split(",") ?? [
  ...readdirSync(`${repo}/tests_opendta/tests`).filter(f => /^test_.*\.py$/.test(f)).sort().map(f => `tests_opendta/tests/${f}`),
  ...WEB_TESTS];
for (const f of files) if (!existsSync(`${repo}/${f}`)) { console.error(`no such file: ${f}`); process.exit(2); }
mkdirSync(out, { recursive: true });
const t0 = performance.now(), timeouts = [], crashed = [];
const queue = [...files];
const runOne = file => new Promise(done => {
  const started = performance.now();
  rmSync(`${out}/${basename(file)}.json`, { force: true });   // a result left by an earlier run would hide a crash
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", file, "--out", out,
    ...(args.includes("--no-shim") ? ["--no-shim"] : []), ...(args.includes("--ios") ? ["--ios"] : [])], { stdio: ["ignore", "ignore", "ignore"] });
  const timer = setTimeout(() => { timeouts.push(file); child.kill("SIGKILL"); }, timeoutS * 1000);
  child.on("exit", code => {
    clearTimeout(timer);
    const s = ((performance.now() - started) / 1000).toFixed(0);
    if (!timeouts.includes(file) && !existsSync(`${out}/${basename(file)}.json`)) crashed.push(file);
    console.log(`${timeouts.includes(file) ? "TIMEOUT" : code === 0 ? "done   " : "exit " + code} ${file} (${s} s)`);
    done();
  });
});
await Promise.all(Array.from({ length: shards }, async () => { for (let f; (f = queue.shift());) await runOne(f); }));
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${files.length} files, ${timeouts.length} timed out, ${crashed.length} without a result`);
if (timeouts.length) console.log(`  timed out: ${timeouts.join(", ")}`);
if (crashed.length) console.log(`  no result: ${crashed.join(", ")}`);
process.exit(timeouts.length || crashed.length ? 1 : 0);
