# Runs every corpus .do file in each engine's batch mode and scores CHECK lines against ref.json.
# Usage: python -I run_eval.py SCRATCH_DIR
import json, re, shutil, subprocess, sys, time
from pathlib import Path

S = Path(sys.argv[1]); W = S / "work"
ref = json.loads((W / "ref.json").read_text())
CHECK = re.compile(r"^CHECK (\w+)=\s*(\S+)", re.M)
# loose tolerance for values where Stata's own definition differs slightly (documented in report)
TOL = {"default": 1e-6}


def run_opendta(do: Path, out: Path) -> tuple[str, float]:
    shutil.copy(do, out / do.name)
    t = time.time()
    p = subprocess.run([str(S / "src/opendta/.venv/bin/opendta"), "-b", "do", do.name], cwd=out,
                       capture_output=True, text=True, timeout=600)
    dt = time.time() - t
    log = out / do.with_suffix(".log").name
    return (log.read_text(errors="replace") if log.exists() else "") + p.stdout + p.stderr, dt


def run_openstat(do: Path, out: Path) -> tuple[str, float]:
    shutil.copy(do, out / do.name)
    code = ("import sys;from openstat.engine import Engine;r=Engine(cwd=sys.argv[1]).run_file(sys.argv[2]);"
            "print(r.output);print('RC',r.rc,'LINE',r.line)")
    t = time.time()
    p = subprocess.run([str(S / "src/openstat/.venv/bin/python"), "-I", "-c", code, str(out), do.name],
                       cwd=out, capture_output=True, text=True, timeout=600)
    return p.stdout + p.stderr, time.time() - t


def score(text: str):
    got = {k: v for k, v in CHECK.findall(text)}
    rows = []
    for k, v in got.items():
        r = ref.get(k)
        try:
            x = float(v)
        except ValueError:
            rows.append((k, v, r, "unparsed")); continue
        if r is None:
            rows.append((k, x, r, "noref")); continue
        ok = abs(x - r) <= max(TOL["default"] * abs(r), 1e-12)  # relative tolerance
        rows.append((k, x, r, "ok" if ok else "MISMATCH"))
    return rows


results = {}
for eng, fn in [("opendta", run_opendta), ("openstat", run_openstat)]:
    out = W / "runs" / eng
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(W / "data", out)
    for do in sorted((W / "corpus").glob("*.do")):
        text, dt = fn(do, out)
        (out / (do.stem + ".out.txt")).write_text(text)
        expected = [k for k in CHECK.findall(do.read_text()) or re.findall(r'"CHECK (\w+)=', do.read_text())]
        rows = score(text)
        results.setdefault(do.stem, {})[eng] = dict(seconds=round(dt, 2), rows=rows,
                                                   expected=re.findall(r'"CHECK (\w+)=', do.read_text()))

summary = {}
for f, engs in results.items():
    for eng, r in engs.items():
        exp = r["expected"]; got = {k: s for k, _, _, s in r["rows"]}
        ok = sum(1 for k in exp if got.get(k) == "ok")
        summary.setdefault(eng, [0, 0]); summary[eng][0] += ok; summary[eng][1] += len(exp)
        bad = [f"{k}:{got.get(k, 'missing')}" for k in exp if got.get(k) != "ok"]
        print(f"{f:16s} {eng:9s} {ok:2d}/{len(exp):2d}  {r['seconds']:6.2f}s  {' '.join(bad)}")
print("TOTAL", {k: f"{a}/{b}" for k, (a, b) in summary.items()})
(W / "results.json").write_text(json.dumps(results, indent=1, default=str))
