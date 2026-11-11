// numpy.linalg in Pyodide returns NaN instead of raising LinAlgError for a singular or not positive definite matrix, and
// dofile's browser host fixes that (src/dofile/linalgshim.py). CPython cannot show the problem, so this runs in the real
// WebAssembly numpy. Found with 1001_mixed: a fit that takes 0.2 s on CPython ran until the 16,000-iteration limit
// because ml.maximize tests concavity with `except LinAlgError` (docs/browser-engine.md, "Open investigation").
// Run `uv build --wheel` in the repo first (npm test does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import { installEngine } from "../scripts/install-engine.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function boot() {
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await installEngine(py);
  return py;
}

// the three functions, on matrices that must fail; "raises" or "NaN" for each
const PROBE = `
import json, numpy as np
def what(f):
    try: r = f()
    except np.linalg.LinAlgError: return "raises"
    return "NaN" if np.isnan(r).any() else "finite"
json.dumps({"inv": what(lambda: np.linalg.inv(np.zeros((2, 2)))),
            "solve": what(lambda: np.linalg.solve(np.zeros((2, 2)), np.ones(2))),
            "cholesky": what(lambda: np.linalg.cholesky(-np.eye(2)))})`;

test("numpy.linalg raises LinAlgError after the browser host starts, and the engine fits in a sane time", { timeout: 300_000 }, async t => {
  const py = await boot();

  await t.test("before the shim numpy returns NaN (if this fails, numpy was fixed: the shim can go)", () => {
    assert.deepEqual(JSON.parse(py.runPython(PROBE)), { inv: "NaN", solve: "NaN", cholesky: "NaN" });
  });

  await t.test("after browser.start() all three raise, scipy was never affected", () => {
    py.FS.mkdirTree("/work");
    py.runPython("from dofile import browser; browser.start('/work')");
    assert.deepEqual(JSON.parse(py.runPython(PROBE)), { inv: "raises", solve: "raises", cholesky: "raises" });
    assert.equal(py.runPython(`
import numpy as np
try:
    np.linalg.cholesky(np.array([[np.nan, 0.0], [0.0, 1.0]])); nan_outcome = "no error"
except np.linalg.LinAlgError:
    nan_outcome = "raises"
nan_outcome`), "raises", "cholesky of a NaN matrix raises on CPython");
    assert.equal(py.runPython(`
import numpy as np, scipy.linalg as sl
try:
    sl.cholesky(-np.eye(2)); outcome = "no error"
except np.linalg.LinAlgError:
    outcome = "raises"
outcome`), "raises");
  });

  await t.test("a fit that needs the non-concave step converges (1001_mixed's covariance(unstructured): 0.2 s on CPython)", () => {
    const prog = `clear
set seed 1001
set obs 30
gen id = _n
gen u0 = invnormal(runiform())*2
gen u1 = invnormal(runiform())*.5
expand 8
bysort id: gen week = _n
gen x = runiform()
gen y = 10 + u0 + (1 + u1)*week + 2*x + invnormal(runiform())*1.5
mixed y week x || id: week
mixed y week x || id: week, covariance(unstructured)`;
    const t0 = performance.now();
    const r = JSON.parse(py.runPython(`from dofile import browser; browser.run(${JSON.stringify(prog)}, images=False)`));
    const s = (performance.now() - t0) / 1000;
    assert.equal(r.rc, 0, r.log.slice(-400));
    assert.match(r.log, /Log likelihood =\s+-503\.69/);
    assert.ok(s < 30, `took ${s.toFixed(1)} s: without the shim this ran until it was killed`);
  });
});
