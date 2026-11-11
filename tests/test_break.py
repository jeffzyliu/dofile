"""Break at safe points (PATCH-2): an interrupt never leaves the data half changed.

The interrupt is injected at the k-th line the engine executes (sys.settrace), for many k, instead of by timing:
whatever line it lands on, the data must match the state after a whole number of commands.
"""

import sys

import numpy as np
import pytest

from dofile.engine import Engine, clear_break, request_break
from dofile.worker import RC_RESET, Worker

SETUP = (
    "clear\nset obs 60\ngen id = _n\ngen g = mod(_n, 4)\ngen x = _n * 1.5\ngen s = string(_n)\n"
    "save t, replace\npreserve\nkeep g\nduplicates drop\ngen y = g * 10\nsave m, replace\nrestore"
)
COMMANDS = [
    "append using t",
    "sort x",
    "expand 2",
    "bysort g: replace x = x + g",
    "merge m:1 g using m, nogenerate",
    "drop if mod(id, 3) == 0",
    "collapse (mean) x y, by(g)",
]


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return Engine(tmp_path)


def _state(eng):
    d = eng.session.data
    return d.nobs, tuple((v.name, tuple(v.raw.tolist())) for v in d.vars)


def _run_with_break_at(eng, code, k):
    """Run `code`, requesting a Break at the k-th engine line executed; also return how many lines ran."""
    seen = 0

    def local(frame, event, arg):
        nonlocal seen
        if event == "line":
            seen += 1
            if seen == k:
                request_break()
        return local

    def trace(frame, event, arg):
        return local if "_vendor" in frame.f_code.co_filename else None

    clear_break()
    sys.settrace(trace)
    try:
        r = eng.run(code)
    finally:
        sys.settrace(None)
        clear_break()
    return r, seen


def test_a_break_anywhere_leaves_the_data_as_some_complete_command_left_it(eng):
    eng.run(SETUP)
    refs = [_state(eng)]
    for cmd in COMMANDS:
        assert eng.run(cmd).rc == 0, cmd
        refs.append(_state(eng))
    eng.run(SETUP)
    _, total = _run_with_break_at(eng, "\n".join(COMMANDS), 0)  # count the lines once
    hit = set()
    for k in range(1, total, max(total // 60, 1)):
        eng.run(SETUP)
        r, _ = _run_with_break_at(eng, "\n".join(COMMANDS), k)
        state = _state(eng)
        assert state in refs, f"Break at engine line {k} of {total} left the data half changed (rc {r.rc})"
        i = refs.index(state)
        assert (r.rc, r.error) == ((1, "--Break--") if i < len(COMMANDS) else (0, None)), k
        hit.add(i)
    assert len(hit) >= 4, hit  # the Break really landed between different commands


@pytest.mark.parametrize("via_do", [False, True])
def test_a_loop_stops_between_passes_also_inside_do(eng, tmp_path, via_do):
    loop = "forvalues i = 1/30 {\n    replace x = x + 1\n}\n"
    (tmp_path / "loop.do").write_text(loop)
    code = "do loop.do" if via_do else loop
    eng.run("clear\nset obs 20\ngen x = _n")
    _, total = _run_with_break_at(eng, code, 0)
    passes = set()
    for k in range(1, total, max(total // 25, 1)):
        eng.run("clear\nset obs 20\ngen x = _n")
        r, _ = _run_with_break_at(eng, code, k)
        x = eng.session.data.get("x").raw - np.arange(1, 21)  # passes each row got
        assert len(set(x.tolist())) == 1, k  # every row got the same number of passes
        passes.add(int(x[0]))
        assert r.rc == (1 if x[0] < 30 else 0), k
    assert len(passes) >= 5 and min(passes) < 30, passes  # stopped at many points, before the end


def test_a_command_with_no_safe_point_is_ended_with_a_reset(tmp_path, monkeypatch):
    """One long command that changes the data has no safe point: past the timeout it is killed (rc 9998, data
    lost), not stopped half done and reported as rc 1 with the data kept."""
    monkeypatch.setattr("dofile.worker.GRACE", 0.5)
    w = Worker(tmp_path, timeout=30)
    try:
        assert w.run("clear\nset obs 3000000\ngen x = 0").rc == 0
        r = w.run("replace x = x[_n-1] + 1 in 2/l", timeout=1)  # a row-by-row Python loop: seconds
        assert r.rc == RC_RESET and "did not stop when interrupted" in r.error
        assert w.run("count").results["r"]["scalars"]["N"] == 0  # a fresh session
    finally:
        w.close()
