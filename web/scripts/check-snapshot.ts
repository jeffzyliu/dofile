// Correctness check of a built snapshot (`npm run check-snapshot [-- --dir path --shards 4]`): in Node, with the page's
// restore code, the engine restored from it must give the results the normal engine gives. It runs
//   conformance  the corpus (CHECK values against tests/conformance/data/ref.json to 1e-6), the probes, a graph export
//   compat       the Stata 14 reference cases of tests_opendta/compat, through compare.py's own functions and its
//                known differences, as tests/test_stata_compat.py does under CPython
// Each compat case runs in its own process (a fresh engine), N at a time (--shards N, default 4), and is killed after
// --timeout seconds (default 300): a failure "timeout". Options: --cases a,b,c (only those compat cases; no
// conformance), --only conformance|compat, --dir, --normal, --pandas (with --normal: load pandas, which the page does not).
// Exit 1 if anything differs, times out or crashes; 2 for an unknown case, or a missing or stale snapshot (not with
// --normal; run `npm run snapshot`). Over 30 minutes for everything.

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import { inputs, readManifest, staleness } from "./build-id.ts";
import { installEngine } from "./install-engine.ts";
import { arg, hasFlag } from "./lib/args.ts";
import { repo } from "./lib/paths.ts";
import { runChild as runScript, runShards } from "./lib/shards.ts";
import { bootFromSnapshot, defaultDir, NATIVE_CHECKS } from "./snapshot-node.ts";

const dir = resolve(arg("--dir", defaultDir));
// Slow in Pyodide (docs/browser-engine.md, "Open investigation"): started first, so a long tail does not hide the rest.
const PYODIDE_SLOW = [
  "0408_mata_moptimize",
  "1907_models",
  "1918_models3",
  "1904_timeseries",
  "1910_programming",
  "1914_panel",
  "1915_timeseries",
  "1919_other_suites2",
  "1920_models4",
  "1921_graphics_look",
  "1908_models2",
  "1909_other_suites",
  "1916_multilevel",
  "1902_multilevel",
];

async function boot() {
  if (hasFlag("--normal")) {
    // the baseline: Pyodide booted and the wheel installed the way the page does without a snapshot
    const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
    const wheel = await installEngine(py, { pandas: hasFlag("--pandas") });
    return { py, manifest: { wheel: `${wheel} (normal boot, no snapshot)` } };
  }
  return bootFromSnapshot(dir);
}

// ---- a child process: one share of the work ------------------------------------------------------------------------
if (hasFlag("--child")) {
  const kind = arg("--child", "");
  const mine = arg("--case", "").split(",").filter(Boolean);
  const { py, manifest } = await boot();
  // --no-shim: the old baseline without numpy.linalg raising LinAlgError
  if (!hasFlag("--no-shim")) py.runPython("from dofile import linalgshim; linalgshim.install()");
  const say = (...a: unknown[]) => console.log(`[${kind === "compat" ? mine.join(",") : kind}]`, ...a);
  say(`restored (optimize=${py.runPython("import sys; sys.flags.optimize")}, snapshot built for ${manifest.wheel})`);
  let result: Record<string, unknown>;

  if (kind === "conformance") {
    py.FS.mkdirTree("/work");
    py.FS.mkdirTree("/conf");
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests/conformance` }, "/conf");
    for (const f of py.FS.readdir("/conf/data"))
      if (f !== "." && f !== "..") py.FS.writeFile(`/work/${f}`, py.FS.readFile(`/conf/data/${f}`));
    const found: { checks: number; probes: number; problems: string[] } = JSON.parse(
      py.runPython(`
import json, re
from pathlib import Path
from dofile.engine import Engine
REF = json.loads(Path("/conf/data/ref.json").read_text())
_gaps = json.loads(Path("/conf/known-gaps.json").read_text())   # the same file as tests/test_conformance.py
GAPS = set(_gaps["corpus"])
PGAPS = set(_gaps["probes"])
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
json.dumps({"checks": ok, "probes": probes, "problems": problems})`),
    );
    say(`${found.checks} corpus checks as expected, ${found.probes} probes, ${found.problems.length} problems`);
    for (const [label, expr, want] of NATIVE_CHECKS) {
      try {
        const got = py.runPython(expr);
        if (want !== null && Math.abs(got - want) > 1e-6 * Math.max(1, Math.abs(want)))
          found.problems.push(`native ${label}: ${got}, expected ${want}`);
      } catch (e) {
        found.problems.push(
          `native ${label}: ${String(e instanceof Error ? e.message : e)
            .trim()
            .split("\n")
            .at(-1)!
            .slice(0, 120)}`,
        );
      }
    }
    say(
      `${NATIVE_CHECKS.length} native-library calls, ${found.problems.filter((p) => p.startsWith("native")).length} problems`,
    );
    found.problems.forEach((p) => {
      say("  PROBLEM", p);
    });
    result = { ...found, failed: found.problems.length };
  } else {
    py.FS.mkdirTree("/od");
    py.FS.mount(py.FS.filesystems.NODEFS, { root: `${repo}/tests_opendta` }, "/od");
    py.runPython(`
import importlib.util, sys, json, tempfile, difflib, time, traceback, shutil
from pathlib import Path
spec = importlib.util.spec_from_file_location("compat_compare", "/od/tools/compare.py")
compare = importlib.util.module_from_spec(spec); sys.modules["compat_compare"] = compare; spec.loader.exec_module(compare)
EXPECTED = compare.COMPAT / "expected"
KNOWN = compare._known_differences()

def run_case(case):
    t0 = time.perf_counter()
    try:
        out = Path(tempfile.mkdtemp())
        classes = compare.COMPAT / "do" / "classes"   # 1928_classes finds its .class files at do/classes from the run folder
        if classes.is_dir():
            shutil.copytree(classes, out / "do" / "classes")
        got = compare.run_opendta(compare.COMPAT / "do" / f"{case}.do", out)
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
    const results = [];
    for (const c of mine) {
      const r = JSON.parse(py.runPython(`run_case(${JSON.stringify(c)})`));
      results.push(r);
      say(`${r.ok ? "ok  " : "FAIL"} ${r.case} (${r.s} s)`);
      if (!r.ok)
        say(
          r.why
            .split("\n")
            .map((l: string) => `     ${l}`)
            .join("\n"),
        );
    }
    const failed = results.filter((r) => !r.ok).length;
    result = {
      cases: results.length,
      failed,
      failures: results.filter((r) => !r.ok).map((r) => r.case),
    };
    say(`${results.length - failed} of ${results.length} cases match Stata 14`);
  }
  console.log(`RESULT ${JSON.stringify({ kind, ...result })}`);
  process.exit(0);
}

// ---- the parent: start the children, collect their results -------------------------------------------------------------
// A snapshot of another wheel or Pyodide would check the old engine, and its results would say nothing of this checkout.
if (!hasFlag("--normal")) {
  const record = readManifest(dir);
  const why = record ? staleness(record, inputs()) : `no snapshot in ${dir}`;
  if (why) {
    // when --dir points elsewhere, the fix names it (`npm run snapshot` writes public/snapshot, or SNAPSHOT_OUT)
    const fix = dir === defaultDir ? "npm run snapshot" : `SNAPSHOT_OUT=${dir} npm run snapshot`;
    console.error(`${why.replace(/\. Run `npm run snapshot` in web\/$/, "")}. Run \`${fix}\` in web/`);
    process.exit(2);
  }
}
const shards = Number(arg("--shards", 4));
const timeoutS = Number(arg("--timeout", 300));
const only = arg("--only", null);
const wanted = arg("--cases", null)?.split(",");
const passArgs = [
  "--dir",
  dir,
  ...(hasFlag("--normal") ? ["--normal"] : []),
  ...(hasFlag("--pandas") ? ["--pandas"] : []),
  ...(hasFlag("--no-shim") ? ["--no-shim"] : []),
];
const t0 = performance.now();

// Runs one child; stdout lines are echoed, the RESULT line is parsed. A child over `limitS` seconds is killed.
type ChildExit = { code: number | null; result: { failed?: number } | null; timedOut: boolean };
const runChild = async (childArgs: string[], limitS: number): Promise<ChildExit> => {
  let result: ChildExit["result"] = null;
  const { code, timedOut } = await runScript(fileURLToPath(import.meta.url), ["--child", ...childArgs, ...passArgs], {
    limitS: limitS || undefined, // 0: no limit, as before
    onLine: (line) => {
      if (line.startsWith("RESULT ")) result = JSON.parse(line.slice(7));
      else console.log(line);
    },
  });
  return { code, result, timedOut };
};

const allCases = readdirSync(`${repo}/tests_opendta/compat/do`)
  .filter((f) => f.endsWith(".do"))
  .map((f) => f.slice(0, -3))
  .filter((c) => existsSync(`${repo}/tests_opendta/compat/expected/${c}.log`))
  .sort();
for (const c of wanted ?? [])
  if (!allCases.includes(c)) {
    console.error(`unknown compat case: ${c}`);
    process.exit(2);
  }
const cases = (wanted ?? allCases).sort((a, b) => {
  const ra = PYODIDE_SLOW.indexOf(a);
  const rb = PYODIDE_SLOW.indexOf(b);
  return (ra < 0 ? 1e6 : ra) - (rb < 0 ? 1e6 : rb) || (a < b ? -1 : 1);
});

// Cases that differ because the page has no pandas (5 MB, left out on purpose): 1701 and 1911 call `export sasxport`,
// and what follows cascades. Expected like a strict xfail: a difference is accepted, and one that now passes is
// reported. `--normal --pandas` loads pandas and expects no difference: run it for these two after an engine change.
const EXPECTED_DIFFER = hasFlag("--pandas") ? [] : ["1701_datamgmt_options", "1911_datamgmt"];
const problems: string[] = [];
const timeouts: string[] = [];
const crashed: string[] = [];
const passed: string[] = [];
let ran = 0;
const conformance =
  only === "conformance" || (!only && !wanted)
    ? runChild(["conformance"], 0).then((r) => {
        if (r.code !== 0 || !r.result) crashed.push("conformance");
        else if (r.result.failed) problems.push("conformance");
      })
    : Promise.resolve();
const runCompat = async (c: string) => {
  const started = performance.now();
  const r = await runChild(["compat", "--case", c], timeoutS);
  ran++;
  if (r.timedOut) {
    timeouts.push(c);
    console.log(`[${c}] TIMEOUT after ${timeoutS} s (killed)`);
  } else if (r.code !== 0 || !r.result) {
    crashed.push(c);
    console.log(`[${c}] crashed (exit ${r.code}) after ${((performance.now() - started) / 1000).toFixed(0)} s`);
  } else if (r.result.failed) problems.push(c);
  else passed.push(c);
};
await Promise.all([conformance, runShards(only === "conformance" ? [] : cases, shards, runCompat)]);
const expectedDiffer = problems.filter((c) => EXPECTED_DIFFER.includes(c));
problems.splice(0, problems.length, ...problems.filter((c) => !EXPECTED_DIFFER.includes(c)));
const nowPass = passed.filter((c) => EXPECTED_DIFFER.includes(c)); // the package arrived: take it off the list
console.log(
  `\n${((performance.now() - t0) / 1000).toFixed(0)} s: ${ran} compat cases run (limit ${timeoutS} s each), ` +
    `${problems.length} differ, ${timeouts.length} timed out, ${crashed.length} crashed`,
);
if (expectedDiffer.length) console.log(`  differ as expected (missing package): ${expectedDiffer.join(", ")}`);
if (nowPass.length) {
  console.log(`  expected to differ but pass: ${nowPass.join(", ")} (remove from EXPECTED_DIFFER)`);
  problems.push(...nowPass);
}
if (problems.length) console.log(`  differ: ${problems.join(", ")}`);
if (timeouts.length) console.log(`  timed out: ${timeouts.join(", ")}`);
if (crashed.length) console.log(`  crashed: ${crashed.join(", ")}`);
process.exit(problems.length || timeouts.length || crashed.length ? 1 : 0);
