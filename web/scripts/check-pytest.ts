// dofile's and OpenDTA's own pytest files, run inside Pyodide, to compare with CPython test by test (`npm run
// check-pytest`). check-snapshot.ts runs the conformance corpus and the Stata 14 logs; this runs the unit tests, which
// reach commands those do not.
//
//   node scripts/check-pytest.ts [--paths a.py,b.py] [--shards 4] [--timeout 900] [--out DIR] [--no-shim] [--ios]
//
// Each test file runs in its own process and writes DIR/<file>.json (see pytest_report.py). The CPython baseline is
//   uv run python web/scripts/pytest_report.py OUT.json FILE -q -p no:cacheprovider
// and `node tools/compare-pytest.ts BASELINE_DIR DIR` lists the differences.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import type { SnapshotPy } from "../src/engine/snapshot.ts";
import { installEngine } from "./install-engine.ts";
import { arg, hasFlag } from "./lib/args.ts";
import { repo } from "./lib/paths.ts";
import { runChild, runShards } from "./lib/shards.ts";

const out = resolve(arg("--out", `${repo}/.dofile/pytest-wasm`));
// dofile tests that make sense in the page's Python. Left out: those that start subprocesses, need the `mcp` package or
// the repo's src/ tree (test_mcp, test_worker, test_sandbox, test_break, test_dofile_cli, test_vendor, test_conformance,
// test_stata_compat, test_log_cut, test_pathshim), and those covered by web/test (test_browser, test_linalgshim).
const WEB_TESTS = ["tests/test_engine.py"];

if (hasFlag("--child")) {
  const file = arg("--child", "");
  // --ios: Pyodide's loader creates no WebAssembly trampoline function (getPyEMTrampolinePtr) for an iPhone/iPad
  // navigator.userAgent; this makes Node look like that, to run the suite the way an iPhone runs the engine
  if (hasFlag("--ios"))
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });
  const py = (await loadPyodide({ stdout: (s) => console.log(s), stderr: (s) => console.log(s) })) as SnapshotPy;
  await py.loadPackage(["pytest", "numpy", "scipy", "matplotlib"], { messageCallback: () => {} });
  await installEngine(py);
  for (const d of ["tests_opendta", "tests"]) {
    py.FS.mkdirTree(`/repo/${d}`);
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/${d}` }, `/repo/${d}`);
  }
  py.FS.mkdirTree("/work");
  py.FS.writeFile("/tmp/pytest_report.py", readFileSync(`${repo}/web/scripts/pytest_report.py`));
  if (!hasFlag("--no-shim")) py.runPython("from dofile import linalgshim; linalgshim.install()");
  py.globals.set("FILE", file);
  py.globals.set("OUT", "/tmp/result.json");
  py.runPython(`
import os, sys
os.chdir("/work"); sys.path.insert(0, "/tmp")
import pytest_report
pytest_report.run(OUT, ["/repo/" + FILE, "-q", "-p", "no:cacheprovider", "--rootdir=/repo", "-o", "addopts="])`);
  mkdirSync(out, { recursive: true });
  // the table is one entry shorter without the trampoline: proof of which mode ran
  const result = {
    ...JSON.parse(py.FS.readFile("/tmp/result.json", { encoding: "utf8" })),
    // Emscripten exports wasmTable; AsmModule does not declare it
    wasmTableLength: (py._module as typeof py._module & { wasmTable: WebAssembly.Table }).wasmTable.length,
    ios: hasFlag("--ios"),
  };
  writeFileSync(`${out}/${basename(file)}.json`, JSON.stringify(result));
  process.exit(0);
}

// ---- the parent ------------------------------------------------------------------------------------------------------
const shards = Number(arg("--shards", 4)),
  timeoutS = Number(arg("--timeout", 900));
const files = arg("--paths", null)?.split(",") ?? [
  ...readdirSync(`${repo}/tests_opendta/tests`)
    .filter((f) => /^test_.*\.py$/.test(f))
    .sort()
    .map((f) => `tests_opendta/tests/${f}`),
  ...WEB_TESTS,
];
for (const f of files)
  if (!existsSync(`${repo}/${f}`)) {
    console.error(`no such file: ${f}`);
    process.exit(2);
  }
mkdirSync(out, { recursive: true });
const t0 = performance.now(),
  timeouts: string[] = [],
  crashed: string[] = [];
const runOne = async (file: string) => {
  const started = performance.now();
  rmSync(`${out}/${basename(file)}.json`, { force: true }); // a result left by an earlier run would hide a crash
  const { code, timedOut } = await runChild(
    fileURLToPath(import.meta.url),
    [
      "--child",
      file,
      "--out",
      out,
      ...(hasFlag("--no-shim") ? ["--no-shim"] : []),
      ...(hasFlag("--ios") ? ["--ios"] : []),
    ],
    { limitS: timeoutS },
  );
  if (timedOut) timeouts.push(file);
  const s = ((performance.now() - started) / 1000).toFixed(0);
  if (!timedOut && !existsSync(`${out}/${basename(file)}.json`)) crashed.push(file);
  console.log(`${timedOut ? "TIMEOUT" : code === 0 ? "done   " : `exit ${code}`} ${file} (${s} s)`);
};
await runShards(files, shards, runOne);
console.log(
  `\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${files.length} files, ${timeouts.length} timed out, ${crashed.length} without a result`,
);
if (timeouts.length) console.log(`  timed out: ${timeouts.join(", ")}`);
if (crashed.length) console.log(`  no result: ${crashed.join(", ")}`);
process.exit(timeouts.length || crashed.length ? 1 : 0);
