// Correctness check of a built snapshot (`npm run check-snapshot [-- --dir path --shards 4]`): the engine restored from it
// must give the results the normal engine gives. In Node, with the same restore code the page uses, it runs:
//   conformance  the corpus (CHECK values against tests/conformance/data/ref.json to 1e-6), the probes, a graph export
//   compat       the 98 Stata 14 reference cases of tests_opendta/compat, through compare.py's own functions and its
//                known differences, as tests/test_stata_compat.py does under CPython
// The compat cases are split over several processes (the slowest ones, asmprobit and the multilevel and irt models,
// start first on different processes). Exit code 1 if anything differs. About 4-6 minutes. Needs a built snapshot.
import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import { bootFromSnapshot, NATIVE_CHECKS, defaultDir } from "./snapshot-node.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dir = resolve(arg("--dir", defaultDir));
const repo = fileURLToPath(new URL("../..", import.meta.url));

async function boot() {
  if (args.includes("--normal")) {   // the baseline: Pyodide booted and the wheel installed the way the page does without a snapshot
    const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
    await py.loadPackage("micropip", { messageCallback: () => {} });
    const dist = `${repo}/dist`, wheel = readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1);
    py.FS.writeFile(`/tmp/${wheel}`, readFileSync(`${dist}/${wheel}`));
    await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${wheel}")`);
    return { py, manifest: { wheel: `${wheel} (normal boot, no snapshot)` } };
  }
  return bootFromSnapshot(dir);
}

// ---- a child process: one share of the work ------------------------------------------------------------------------
if (args.includes("--child")) {
  const kind = arg("--child"), shard = Number(arg("--shard", 0)), of = Number(arg("--of", 1));
  const { py, manifest } = await boot();
  const say = (...a) => console.log(`[${kind}${kind === "compat" ? ` ${shard + 1}/${of}` : ""}]`, ...a);
  say(`restored (optimize=${py.runPython("import sys; sys.flags.optimize")}, snapshot built for ${manifest.wheel})`);
  let result;

  if (kind === "conformance") {
    py.FS.mkdirTree("/work");
    const data = `${repo}/tests/conformance/data`;
    py.FS.mkdirTree("/conf");
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests/conformance` }, "/conf");
    for (const f of py.FS.readdir("/conf/data")) if (f !== "." && f !== "..") py.FS.writeFile(`/work/${f}`, py.FS.readFile(`/conf/data/${f}`));
    result = JSON.parse(py.runPython(`
import json, re
from pathlib import Path
from dofile.engine import Engine
REF = json.loads(Path("/conf/data/ref.json").read_text())
GAPS = {"hdfe_b_x1"}   # GAP-1, as in tests/test_conformance.py
PGAPS = {"p06_esttab.do", "p07_outreg2.do"}
ok = 0; problems = []
for f in sorted(Path("/conf/corpus").glob("*.do")):
    text = f.read_text()
    got = dict(re.findall(r"^CHECK (\\w+)=\\s*(\\S+)", Engine("/work").run(text).log, re.M))
    for k in re.findall(r'"CHECK (\\w+)=', text):
        g = got.get(k); ref = REF[k]
        good = g is not None and abs(float(g) - ref) <= max(1e-6 * abs(ref), 1e-12)
        if good != (k not in GAPS): problems.append(f"corpus {f.name} {k}: {g} vs {ref}")
        else: ok += 1
probes = 0
for p in sorted(Path("/conf/probe").glob("*.do")):
    r = Engine("/work").run(p.read_text(), images=True)
    probes += 1
    if (r.rc == 0) == (p.name in PGAPS): problems.append(f"probe {p.name}: rc {r.rc} {r.error}")
    if r.images and r.images[0][:4] != b"\\x89PNG": problems.append(f"probe {p.name}: image is not a PNG")
r = Engine("/work").run('clear\\nset obs 50\\ngen x = _n\\ngen y = sqrt(x)\\nscatter y x\\ngraph export s.png, replace')
if r.rc or not Path("/work/s.png").exists() or Path("/work/s.png").stat().st_size < 1000: problems.append(f"graph export: rc {r.rc}")
json.dumps({"checks": ok, "probes": probes, "problems": problems})`));
    say(`${result.checks} corpus checks as expected, ${result.probes} probes, ${result.problems.length} problems`);
    for (const [label, expr, want] of NATIVE_CHECKS) {
      try {
        const got = py.runPython(expr);
        if (want !== null && Math.abs(got - want) > 1e-6 * Math.max(1, Math.abs(want))) result.problems.push(`native ${label}: ${got}, expected ${want}`);
      } catch (e) { result.problems.push(`native ${label}: ${String(e.message).trim().split("\n").at(-1).slice(0, 120)}`); }
    }
    say(`${NATIVE_CHECKS.length} native-library calls, ${result.problems.filter(p => p.startsWith("native")).length} problems`);
    result.problems.forEach(p => say("  PROBLEM", p));
    result.failed = result.problems.length;
  } else {
    py.FS.mkdirTree("/od");
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests_opendta` }, "/od");
    py.runPython(`
import importlib.util, sys, json, tempfile, difflib, time, traceback
from pathlib import Path
spec = importlib.util.spec_from_file_location("compat_compare", "/od/tools/compare.py")
compare = importlib.util.module_from_spec(spec); sys.modules["compat_compare"] = compare; spec.loader.exec_module(compare)
EXPECTED = compare.COMPAT / "expected"
KNOWN = compare._known_differences()
SLOW = ["1908_models2", "1909_other_suites", "1916_multilevel", "1902_multilevel"]
CASES = sorted(f.stem for f in (compare.COMPAT / "do").glob("*.do") if (EXPECTED / f"{f.stem}.log").exists())
ORDER = [s for s in SLOW if s in CASES] + [c for c in CASES if c not in SLOW]

def run_case(case):
    t0 = time.perf_counter()
    try:
        got = compare.run_opendta(compare.COMPAT / "do" / f"{case}.do", Path(tempfile.mkdtemp()))
        a = compare.normalize((EXPECTED / f"{case}.log").read_text(encoding="utf-8", errors="replace"))
        b = compare.normalize(got.read_text(encoding="utf-8", errors="replace"))
        k = KNOWN.get(case)
        if compare.same_logs(a, b) or (k is not None and k.accepts(a, b)):
            return json.dumps({"case": case, "ok": True, "s": round(time.perf_counter() - t0, 1)})
        diff = list(difflib.unified_diff(a, b, "Stata 14", "dofile", n=1, lineterm=""))
        return json.dumps({"case": case, "ok": False, "s": round(time.perf_counter() - t0, 1), "why": "\\n".join(diff[:40])})
    except BaseException as e:
        return json.dumps({"case": case, "ok": False, "s": round(time.perf_counter() - t0, 1), "why": "".join(traceback.format_exception_only(type(e), e))[-600:]})
`);
    const mine = JSON.parse(py.runPython("import json; json.dumps(ORDER)")).filter((_, i) => i % of === shard);
    const results = [];
    for (const c of mine) {
      const r = JSON.parse(py.runPython(`run_case(${JSON.stringify(c)})`));
      results.push(r);
      say(`${r.ok ? "ok  " : "FAIL"} ${r.case} (${r.s} s)`);
      if (!r.ok) say(r.why.split("\n").map(l => "     " + l).join("\n"));
    }
    result = { cases: results.length, failed: results.filter(r => !r.ok).length, failures: results.filter(r => !r.ok).map(r => r.case) };
    say(`${results.length - result.failed} of ${results.length} cases match Stata 14`);
  }
  console.log("RESULT " + JSON.stringify({ kind, ...result }));
  process.exit(0);
}

// ---- the parent: start the children, collect their results -------------------------------------------------------------
const shards = Number(arg("--shards", 4));
const t0 = performance.now();
const jobs = [["conformance"], ...Array.from({ length: shards }, (_, i) => ["compat", i])];
const runs = jobs.map(([kind, shard]) => new Promise(done => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", kind, "--dir", dir,
    ...(args.includes("--normal") ? ["--normal"] : []), ...(kind === "compat" ? ["--shard", String(shard), "--of", String(shards)] : [])], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "", result = null;
  child.stdout.on("data", d => {
    out += d;
    let i;
    while ((i = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, i); out = out.slice(i + 1);
      if (line.startsWith("RESULT ")) result = JSON.parse(line.slice(7)); else console.log(line);
    }
  });
  child.on("exit", code => done({ kind, shard, code, result }));
}));
const all = await Promise.all(runs);
const crashed = all.filter(r => r.code !== 0 || !r.result);
const failed = all.reduce((n, r) => n + (r.result?.failed ?? 0), 0);
const cases = all.reduce((n, r) => n + (r.result?.cases ?? 0), 0);
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${cases} compat cases, ${failed} problems${crashed.length ? `, ${crashed.length} process(es) crashed` : ""}`);
for (const r of all) if (r.result?.failures?.length) console.log(`  failed: ${r.result.failures.join(", ")}`);
process.exit(failed || crashed.length ? 1 : 0);
