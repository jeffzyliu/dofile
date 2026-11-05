"""The vendored engine reproduces OpenDTA's real-Stata-14 reference logs (tests_opendta/compat).

compare.py fails on any case that differs from Stata, except the ones listed with a reason in
compat/known_differences.txt.
"""
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.slow  # ~3 min; skipped by default, run with `pytest -m slow` or `pytest -m ""`

COMPARE = Path(__file__).resolve().parents[1] / "tests_opendta" / "tools" / "compare.py"


def test_matches_stata14_reference_logs():
    r = subprocess.run([sys.executable, str(COMPARE), "--brief"], capture_output=True, text=True, timeout=900)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
    assert " 0 different" in r.stdout.splitlines()[-1], r.stdout.splitlines()[-1]
