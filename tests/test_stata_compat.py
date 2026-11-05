"""The vendored engine reproduces OpenDTA's real-Stata-14 reference logs (tests_opendta/compat).

One test per case, so `-n auto` runs them in parallel: each case runs in its own folder with
compare.py's own functions, and passes when its log matches Stata's or a known difference in
compat/known_differences.txt accepts it (the same rule as `compare.py`).
"""
import difflib
import importlib.util
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.slow  # ~3 min serial, ~70 s with -n auto; run with `pytest -m slow` or `pytest -m ""`

TOOLS = Path(__file__).resolve().parents[1] / "tests_opendta" / "tools"
_spec = importlib.util.spec_from_file_location("compat_compare", TOOLS / "compare.py")
compare = sys.modules["compat_compare"] = importlib.util.module_from_spec(_spec)  # its dataclasses need it there
_spec.loader.exec_module(compare)

EXPECTED = compare.COMPAT / "expected"
# The slowest cases (asmprobit ~70 s, nine irt fits ~60 s, multilevel ~20 s) go early and 6 apart: xdist gives each
# worker a first batch of consecutive tests (2 each with 12 workers, 6 with 4), so with 4-16 workers each starts at
# once on its own worker. Together on one worker they would set the run's length (~130 s instead of ~70 s).
SLOW = ["1908_models2", "1909_other_suites", "1916_multilevel", "1902_multilevel"]
CASES = sorted(f.stem for f in (compare.COMPAT / "do").glob("*.do") if (EXPECTED / f"{f.stem}.log").exists())
for i, s in enumerate(s for s in SLOW if s in CASES):
    CASES.remove(s)
    CASES.insert(6 * i, s)
KNOWN = compare._known_differences() if CASES else {}


# no reference logs (the sdist leaves them out): an empty list makes pytest report one skipped test
@pytest.mark.parametrize("case", CASES)
def test_matches_stata14_reference_log(case, tmp_path):
    got = compare.run_opendta(compare.COMPAT / "do" / f"{case}.do", tmp_path)
    a = compare.normalize((EXPECTED / f"{case}.log").read_text(encoding="utf-8", errors="replace"))
    b = compare.normalize(got.read_text(encoding="utf-8", errors="replace"))
    k = KNOWN.get(case)
    if compare.same_logs(a, b) or (k is not None and k.accepts(a, b)):
        return
    diff = list(difflib.unified_diff(a, b, "Stata 14", "dofile", n=1, lineterm=""))
    pytest.fail(f"{case} differs from Stata 14" + (f" beyond its known difference ({k.why})" if k else "")
                + ":\n" + "\n".join(diff[:80]))
