"""Run one Stata 14 comparison program and record, at full double precision, e() and r() after every command that
changes them, plus the log. The same file runs on CPython and inside Pyodide (web/scripts/check-numeric.mjs), and
web/scripts/compare_numeric.py diffs the two outputs number by number.

    python numeric_probe.py CASE TOOLS_DIR OUT.json
      CASE       e.g. 1907_models (tests_opendta/compat/do/CASE.do)
      TOOLS_DIR  the folder with compare.py (tests_opendta/tools, or /od/tools in Pyodide)

OUT.json: {"case", "seconds", "log": text, "records": [{"i", "cmd", "which": "e"|"r", "res": {scalars, macros, matrices}}]}
A record is written for a command after which e() (or r()) is not what it was before. A command that runs other commands
(a loop, a program, quietly) is recorded too, after its inner commands, so the sequence is the same on both platforms
as long as the control flow is.
"""
import importlib.util
import json
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True


def main(case, tools, out):
    spec = importlib.util.spec_from_file_location("compat_compare", f"{tools}/compare.py")
    compare = importlib.util.module_from_spec(spec)
    sys.modules["compat_compare"] = compare
    spec.loader.exec_module(compare)
    from dofile.engine import _same, group_results
    from dofile._vendor.opendta.commands.registry import REGISTRY

    records = []
    MAX_CELLS = 5000

    def small(res):
        for k, m in res["matrices"].items():   # a huge matrix is cut to its first cells; its size is kept
            if len(m["rows"]) * len(m["cols"]) > MAX_CELLS:
                res["matrices"][k] = {"rows": m["rows"][:1], "cols": m["cols"][:1], "data": [], "size": f'{len(m["rows"])}x{len(m["cols"])}'}
        return res

    def wrap(name, fn):
        def run(s, rest):
            e0, r0 = dict(s.e), dict(s.r)
            try:
                return fn(s, rest)
            finally:
                for which, before, now in (("e", e0, s.e), ("r", r0, s.r)):
                    if not _same(before, now):
                        records.append({"i": len(records), "cmd": name, "which": which, "res": small(group_results(now))})
        return run

    import dataclasses
    for name, cs in list(REGISTRY.items()):   # CommandSpec is frozen: replace the entries
        REGISTRY[name] = dataclasses.replace(cs, fn=wrap(name, cs.fn))

    outdir = Path(tempfile.mkdtemp())
    t0 = time.perf_counter()
    log = ""
    try:
        logfile = compare.run_opendta(compare.COMPAT / "do" / f"{case}.do", outdir)
        log = Path(logfile).read_text(encoding="utf-8", errors="replace")
    except BaseException as e:   # keep what was recorded
        log = f"(probe stopped: {type(e).__name__}: {str(e)[:200]})"
    with open(out, "w") as f:
        json.dump({"case": case, "seconds": round(time.perf_counter() - t0, 2), "log": log, "records": records}, f)


if __name__ == "__main__":
    main(*sys.argv[1:4])
