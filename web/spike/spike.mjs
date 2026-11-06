// Phase 2 step 1 spike: load the built dofile wheel in Pyodide (in a worker thread, as a browser Web Worker would),
// run the conformance corpus and probes, check graphs, time the start, and test Break through the interrupt buffer.
// Usage: node spike.mjs [path/to/dofile.whl]   (default: the newest wheel in ../../dist)
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CACHE = join(HERE, ".pyodide-cache");

if (isMainThread) {
  const dist = join(ROOT, "dist");
  const wheel = process.argv[2] ?? join(dist, readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1));
  rmSync(CACHE, { recursive: true, force: true }); // cold start: every package is downloaded
  const interrupt = new Int32Array(new SharedArrayBuffer(4));
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { wheel, interrupt } });
  w.on("message", m => {
    if (m.breakIn) setTimeout(() => { interrupt[0] = 2; }, m.breakIn); // 2 = SIGINT, as the page's Break button
    if (m.log) console.log(m.log);
  });
  w.on("error", e => { console.error("worker error", e); process.exitCode = 1; });
  w.on("exit", code => {
    const sizes = dir => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    const core = ["pyodide.asm.wasm", "pyodide.asm.mjs", "python_stdlib.zip", "pyodide.mjs", "pyodide-lock.json"]
      .reduce((n, f) => n + statSync(join(HERE, "node_modules/pyodide", f)).size, 0);
    console.log(`download: core ${(core / 1e6).toFixed(1)} MB + packages ${(sizes(CACHE) / 1e6).toFixed(1)} MB` +
      ` (uncompressed files; servers gzip/brotli the core)`);
    console.log(readdirSync(CACHE).map(f => `  ${f} ${(statSync(join(CACHE, f)).size / 1e6).toFixed(2)} MB`).join("\n"));
    process.exitCode ||= code;
  });
} else {
  const { loadPyodide } = await import("pyodide");
  const say = log => parentPort.postMessage({ log });
  const t = { start: performance.now() };
  const lap = (name, from = t.last) => { const now = performance.now(); say(`${name}: ${((now - from) / 1000).toFixed(2)} s`); t.last = now; };
  t.last = t.start;
  const py = await loadPyodide({ packageCacheDir: CACHE, stdout: say, stderr: l => say("stderr: " + l) }); // fd 1/2 don't exist in a worker thread
  lap("loadPyodide");
  await py.loadPackage("micropip", { messageCallback: () => {} });
  py.FS.writeFile("/tmp/" + workerData.wheel.split("/").at(-1), readFileSync(workerData.wheel));
  py.globals.set("wheel", "emfs:/tmp/" + workerData.wheel.split("/").at(-1));
  await py.runPythonAsync("import micropip; await micropip.install(wheel)"); // resolves numpy, scipy, matplotlib, openpyxl
  lap("install dofile wheel + dependencies");
  py.setInterruptBuffer(workerData.interrupt);

  // the conformance data, copied into the in-memory /work as uploads would be
  const data = join(ROOT, "tests/conformance/data");
  py.FS.mkdirTree("/work");
  for (const f of readdirSync(data)) py.FS.writeFile("/work/" + f, readFileSync(join(data, f)));
  py.FS.mkdirTree("/conf");
  py.FS.mount(py.FS.filesystems.NODEFS, { root: join(ROOT, "tests/conformance") }, "/conf");

  py.runPython(`
import json, re, signal, time
from pathlib import Path
t0 = time.perf_counter()
from dofile.engine import Engine, request_break
eng = Engine("/work")
import_s = time.perf_counter() - t0
`);
  lap("import dofile.engine + Engine()");
  const run = (code) => py.runPython(code);
  say(run(`
t0 = time.perf_counter(); r = eng.run("display 1+1"); t1 = time.perf_counter(); r = eng.run("display 2+2")
f"first run_do {t1 - t0:.3f} s, warm {time.perf_counter() - t1:.3f} s (rc {r.rc})"`));

  say(run(`
REF = json.loads(Path("/conf/data/ref.json").read_text())
GAPS = {"hdfe_b_x1"}  # GAP-1, as in tests/test_conformance.py
ok = bad = 0; lines = []
t0 = time.perf_counter()
for f in sorted(Path("/conf/corpus").glob("*.do")):
    got = dict(re.findall(r"^CHECK (\\w+)=\\s*(\\S+)", Engine("/work").run(f.read_text()).log, re.M))
    for k in re.findall(r'"CHECK (\\w+)=', f.read_text()):
        g = got.get(k); ref = REF[k]
        good = g is not None and abs(float(g) - ref) <= max(1e-6 * abs(ref), 1e-12)
        if good != (k not in GAPS):
            bad += 1; lines.append(f"  MISMATCH {f.name} {k}: {g} vs {ref}")
        else:
            ok += 1
"\\n".join([f"corpus: {ok} as expected, {bad} not ({time.perf_counter() - t0:.1f} s)"] + lines)`));

  say(run(`
PGAPS = {"p06_esttab.do", "p07_outreg2.do"}
out = []
for p in sorted(Path("/conf/probe").glob("*.do")):
    r = Engine("/work").run(p.read_text(), images=True)
    if (r.rc == 0) == (p.name in PGAPS):
        out.append(f"  UNEXPECTED {p.name}: rc {r.rc} {r.error}")
    if r.images:
        out.append(f"  {p.name}: {len(r.images)} PNG(s), {[len(i) for i in r.images]} bytes, PNG header {r.images[0][:4] == b'\\x89PNG'}")
"\\n".join(["probes:"] + out)`));

  say(run(`
r = eng.run('clear\\nset obs 50\\ngen x = _n\\ngen y = sqrt(x)\\nscatter y x\\ngraph export s.png, replace')
f"graph export: rc {r.rc}, file {Path('/work/s.png').stat().st_size if Path('/work/s.png').exists() else 'missing'} bytes"`));

  // Break: does the interrupt buffer run a Python SIGINT handler (so PATCH-2's safe points hold)?
  run(`
handler_calls = 0
def on_interrupt(signum, frame):
    global handler_calls
    handler_calls += 1
    request_break()
signal.signal(signal.SIGINT, on_interrupt)
eng.run("clear\\nset obs 100\\ngen x = 0")`);
  parentPort.postMessage({ breakIn: 1500 });
  say(run(`
t0 = time.perf_counter()
r = eng.run("while 1 {\\n quietly replace x = x + 1\\n}")
after = eng.run("summarize x")
f"Break: rc {r.rc} after {time.perf_counter() - t0:.1f} s, handler called {handler_calls}x, data kept: rc {after.rc}, nobs {after.nobs}"`));
  workerData.interrupt[0] = 0;
  lap("total", t.start);
}
