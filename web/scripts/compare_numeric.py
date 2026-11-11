"""Diff two folders of numeric_probe.py results, CPython against Pyodide, number by number.

    python compare_numeric.py CPY_DIR WASM_DIR [--top N]

Per case, the recorded e()/r() sequences are aligned by position (a different command or length is reported as control
flow that differs: nothing after that point is compared). Differences are measured so that noise around zero does not
count: a scalar by |a-b| / max(|a|, |b|, 1e-12); a matrix cell by |a-b| / the largest |entry| of that matrix (both
sides), so a covariance entry of 1e-11 next to entries of 1 is judged against 1. Reported:
  1. a histogram of all numbers,
  2. the quantities (scalar or matrix name) with a difference above 1e-9 (e(gradient) at convergence is noise by nature),
  3. the estimation results whose e(b) differs by more than 1e-6, with e(ll), `converged` and the iteration count,
  4. control-flow and text differences in results, and in the logs (opening times and temp paths are ignored).
Exit code 1 if a control flow differs or a result is missing; the numbers are for reading, not for a pass/fail.
"""

import collections
import json
import re
import sys
from pathlib import Path

BINS = [
    (0.0, "bit-identical"),
    (1e-12, "<= 1e-12"),
    (1e-9, "<= 1e-9"),
    (1e-6, "<= 1e-6"),
    (1e-3, "<= 1e-3"),
    (float("inf"), "> 1e-3"),
]
NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
IGNORE_LINE = re.compile(r"opened on|closed on|\blog:|/tmp|/var/folders|Temp\\|datasignature|elapsed|Time:")


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def sdiff(a, b):
    return 0.0 if a == b else abs(a - b) / max(abs(a), abs(b), 1e-12)


def compare_case(ca, cb):
    """-> (diffs [(d, kind, where, a, b)], models [...], other [(where, text)], control)"""
    diffs, models, other, control = [], [], [], None
    ra, rb = ca["records"], cb["records"]
    for n, (x, y) in enumerate(zip(ra, rb)):
        if (x["cmd"], x["which"]) != (y["cmd"], y["which"]):
            control = f"record {n}: CPython {x['cmd']}/{x['which']}, Pyodide {y['cmd']}/{y['which']}"
            break
        where = f"#{n} {x['cmd']}"
        for k in sorted(set(x["res"]["scalars"]) | set(y["res"]["scalars"])):
            a, b = x["res"]["scalars"].get(k, "(absent)"), y["res"]["scalars"].get(k, "(absent)")
            if is_num(a) and is_num(b):
                diffs.append((sdiff(a, b), f"scalar {k}", where, a, b))
            elif a != b:
                other.append((where, f"scalar {k}: {a!r} vs {b!r}"))
        for k in sorted(set(x["res"]["macros"]) | set(y["res"]["macros"])):
            a, b = x["res"]["macros"].get(k), y["res"]["macros"].get(k)
            if a != b and k != "datasignature":
                other.append((where, f"macro {k}: {a!r} vs {b!r}"))
            elif a != b:
                other.append((where, "macro datasignature differs (the data differs in some bit)"))
        bdiff = None
        for k in sorted(set(x["res"]["matrices"]) | set(y["res"]["matrices"])):
            m1, m2 = x["res"]["matrices"].get(k), y["res"]["matrices"].get(k)
            if (
                not m1
                or not m2
                or m1.get("size")
                or m2.get("size")
                or (m1["rows"], m1["cols"]) != (m2["rows"], m2["cols"])
            ):
                if (
                    (m1 and m1.get("size")) != (m2 and m2.get("size"))
                    or not m1
                    or not m2
                    or (m1["rows"], m1["cols"]) != (m2["rows"], m2["cols"])
                ):
                    other.append((where, f"matrix {k}: shape or presence differs"))
                continue
            v1 = [c for r in m1["data"] for c in r]
            v2 = [c for r in m2["data"] for c in r]
            scale = max([abs(c) for c in v1 + v2 if is_num(c)] + [1e-12])
            worst = 0.0
            for c1, c2 in zip(v1, v2):
                if is_num(c1) and is_num(c2):
                    d = 0.0 if c1 == c2 else abs(c1 - c2) / scale
                    diffs.append((d, f"matrix {k}", where, c1, c2))
                    worst = max(worst, d)
            if k == "b" and x["which"] == "e":
                bdiff = worst
        if bdiff is not None:
            s1, s2 = x["res"]["scalars"], y["res"]["scalars"]
            models.append(
                (
                    bdiff,
                    where,
                    s1.get("ll"),
                    s2.get("ll"),
                    s1.get("converged"),
                    s2.get("converged"),
                    s1.get("ic"),
                    s2.get("ic"),
                )
            )
    if control is None and len(ra) != len(rb):
        control = f"CPython recorded {len(ra)} results, Pyodide {len(rb)}"
    return diffs, models, other, control


def compare_logs(la, lb):
    A = [l for l in la.splitlines() if not IGNORE_LINE.search(l)]
    B = [l for l in lb.splitlines() if not IGNORE_LINE.search(l)]
    text = [] if len(A) == len(B) else [(f"({len(A)} lines)", f"({len(B)} lines)")]
    nums = 0
    for a, b in zip(A, B):
        if a != b:
            if NUM.sub("#", re.sub(r"\s+", " ", a)) == NUM.sub(
                "#", re.sub(r"\s+", " ", b)
            ):  # spacing shifts with the digits
                nums += 1
            else:
                text.append((a.strip()[:90], b.strip()[:90]))
    return nums, text


def main(cpy, wasm, top=10):
    cpy, wasm = Path(cpy), Path(wasm)
    names = sorted(p.stem for p in cpy.glob("*.json") if (wasm / p.name).exists())
    missing = sorted(p.stem for p in cpy.glob("*.json") if not (wasm / p.name).exists())
    hist, total = collections.Counter(), 0
    by_kind = collections.defaultdict(lambda: [0, 0.0, None])
    models, controls, others, loglines, logtext = [], [], [], 0, []
    for name in names:
        a, b = json.load(open(cpy / f"{name}.json")), json.load(open(wasm / f"{name}.json"))
        diffs, ms, other, control = compare_case(a, b)
        for d, kind, where, x, y in diffs:
            total += 1
            hist[next(lab for hi, lab in BINS if d <= hi)] += 1
            if d > 1e-9:
                e = by_kind[kind]
                e[0] += 1
                if d > e[1]:
                    e[1], e[2] = d, (name, where, x, y)
        models += [(name,) + m for m in ms]
        if control:
            controls.append((name, control))
        if other:
            others.append((name, other))
        n, t = compare_logs(a["log"], b["log"])
        loglines += n
        if t:
            logtext.append((name, t))
    print(f"{len(names)} cases, {total} numbers in e()/r() records")
    for _, lab in BINS:
        print(f"  {lab:14s} {hist[lab]:7d}  ({100 * hist[lab] / max(total, 1):.2f}%)")
    print(
        f"\nquantities with a difference above 1e-9, largest first ({top} shown; e(gradient) and similar are noise near zero):"
    )
    for kind, (cnt, mx, ex) in sorted(by_kind.items(), key=lambda t: -t[1][1])[:top]:
        print(f"  {mx:8.1e} {cnt:5d}x  {kind:22s} e.g. {ex[0]} {ex[1]}: {ex[2]:.10g} vs {ex[3]:.10g}")
    b = collections.Counter(
        "<= 1e-9" if m[1] <= 1e-9 else "<= 1e-6" if m[1] <= 1e-6 else "<= 1e-3" if m[1] <= 1e-3 else "> 1e-3"
        for m in models
    )
    print(
        f"\n{len(models)} estimation results; largest relative difference in e(b): "
        + ", ".join(f"{b[k]} {k}" for k in ("<= 1e-9", "<= 1e-6", "<= 1e-3", "> 1e-3"))
    )
    print("those above 1e-6 (e(ll) CPython vs Pyodide, converged, iterations):")
    for name, d, where, l1, l2, c1, c2, i1, i2 in sorted(models, key=lambda m: -m[1]):
        if d > 1e-6:
            ll = f"{l1:.6f} vs {l2:.6f}" if is_num(l1) and is_num(l2) else "n/a"
            print(f"  {d:8.1e}  {name:22s} {where:18s} ll {ll:28s} converged {c1}/{c2}  iterations {i1}/{i2}")
    if controls:
        print("\ncontrol flow differs (the rest of the case is not compared):")
        for name, c in controls:
            print(f"  {name}: {c}")
    if others:
        print("\nnon-numeric differences in results:")
        for name, o in others:
            print(f"  {name}: {len(o)}, first: {o[0][0]} {o[0][1][:90]}")
    its = sum(1 for _, t in logtext for x, y in t if re.search(r"Iteration \d+:|\(not concave\)|\(backed up\)", x + y))
    print(
        f"\nlogs: {loglines} lines differ only in a printed number; {sum(len(t) for _, t in logtext)} lines differ in their text "
        f"in {len(logtext)} cases, {its} of them iteration lines (a fit that took another path); the others are listed by"
    )
    print(
        "  `compare_logs` (a table row with a different word or sign, or a log of another length: read those by hand)"
    )
    if missing:
        print(f"\nno Pyodide result for: {', '.join(missing)}")
    return 1 if controls or missing else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    sys.exit(main(a[0], a[1], int(a[a.index("--top") + 1]) if "--top" in a else 10))
