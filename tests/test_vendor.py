"""The vendored OpenDTA imports under its new name and runs headless."""
import sys

from dofile._vendor.opendta.core.output import Capture
from dofile._vendor.opendta.session import Session

SCRIPT = """
clear
set obs 200
set seed 1
generate double x = rnormal()
generate double y = 1 + 2*x + rnormal()
generate byte d = runiform() < invlogit(0.5*x)
regress y x
scalar bx = _b[x]
logit d x
display byteorder()
"""


def test_runs_headless_under_vendored_name():
    s = Session()
    cap = Capture()
    s.output.add_listener(cap)
    assert s.run(SCRIPT) == 0, cap.text
    assert abs(s.scalars["bx"] - 2) < 0.3
    assert s.e["cmd"] == "logit"  # logit loads through a rewritten import_module() call
    assert "Logistic regression" in cap.text
    # the rewrite worked: nothing imported the package by its old top-level name, and no Qt
    assert not any(m == "opendta" or m.startswith("opendta.") for m in sys.modules)
    assert not any(m.startswith("PySide6") for m in sys.modules)
