"""ERG-1: how run_do cuts a long log (src/dofile/mcp_server.py: _cut_log)."""

import pytest

pytest.importorskip("mcp")
import dofile.mcp_server as srv
from dofile.engine import Engine
from dofile.mcp_server import _cut_log

LOG_LIMIT = 8_000  # the cut is tested at a small limit so that these logs stay small; srv.LOG_LIMIT is what ships


@pytest.fixture(autouse=True)
def small_limit(monkeypatch):
    monkeypatch.setattr(srv, "LOG_LIMIT", LOG_LIMIT)


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return Engine(tmp_path)


PRE = (
    "clear\nset obs 500\nset seed 1\nforeach v in a b c d e f g h i j k l m n o p {\n    gen `v' = rnormal()\n}\n"
    "gen y = a + b + rnormal()\n"
)
REG = "regress y a b c d e f g h i j k l m n o p"


def test_a_log_that_fits_is_kept_whole(eng):
    log = eng.run("display 1\ndisplay 2").log
    assert _cut_log(log, "x.txt") == (log, 0)


def test_a_loops_results_survive_the_cut(eng):
    """A loop's commands are echoed once, up front, so its output has no per-command markers: cut the biggest
    tables, keep the display lines (before the fix, iterations 2 to 4 were lost)."""
    code = (
        PRE + f"foreach c in 1 2 3 4 5 {{\n    {REG} if mod(_n,5)==`c'-1\n"
        '    display "RESULT iteration `c\'"\n}\ndisplay "LAST LINE"\n'
    )
    log = eng.run(code).log
    assert len(log) > LOG_LIMIT
    cut, omitted = _cut_log(log, "x.txt")
    assert len(cut) <= LOG_LIMIT and omitted > 0 and "lines omitted; full log: get_file x.txt" in cut
    assert all(f"RESULT iteration {i}" in cut for i in range(1, 6)) and "LAST LINE" in cut
    assert all(line in cut for line in log.split("\n") if line.startswith(". "))  # echoes are never cut


def test_short_results_between_long_outputs_survive(eng):
    code = PRE + "".join(f'{REG} if mod(_n,5)=={i}\ndisplay "RESULT {i}"\n' for i in range(5))
    cut, _ = _cut_log(eng.run(code).log, "x.txt")
    assert all(f"RESULT {i}" in cut for i in range(5))


def _table(tag: str) -> str:
    """A clustered regression table: its first lines are all header (note, rule, `Robust`, column names, rule)."""
    rule = "-" * 78
    rows = [
        f"{tag}{i:02d}".rjust(13) + " |   .123456   .045610     2.71   0.007     .033333    .213579" for i in range(20)
    ]
    return "\n".join(
        [
            "Linear regression                      Number of obs = 500",
            "",
            "                                   (Std. Err. adjusted for 100 clusters in cl)",
            rule,
            "             |               Robust",
            "           y |      Coef.   Std. Err.      t    P>|t|     [95% Conf. Interval]",
            "-------------+" + "-" * 64,
            *rows,
            rule,
        ]
    )


def _listing(n: int) -> str:
    return "\n".join(f"  {i}. | row {i} " + "x" * 50 for i in range(n))


def test_coefficient_tables_are_cut_last():
    """ERG-7: cutting a clustered table to its first 5 lines keeps only header lines and drops the estimate (the Lee
    2008 replication lost `D`). Other cuttable output goes first, when that is enough."""
    log = "\n\n".join(
        [
            ". regress y x, vce(cluster cl)",
            _table("t1v"),
            ". regress y x z, vce(cluster cl)",
            _table("t2v"),
            *(f". list {k}\n\n{_listing(28)}" for k in range(3)),
        ]
    )
    assert LOG_LIMIT < len(log) < LOG_LIMIT + 2000  # the listings are smaller than a table, and cutting them is enough
    cut, omitted = _cut_log(log, "x.txt")
    assert len(cut) <= LOG_LIMIT and omitted > 0 and "lines omitted; full log: get_file x.txt" in cut
    assert all(f"{t}{i:02d} |" in cut for t in ("t1v", "t2v") for i in range(20))  # every row of both tables


def test_when_every_block_is_short_the_middle_of_the_log_goes():
    log = "\n".join(f". display {i}\n{i}" for i in range(2000))
    cut, omitted = _cut_log(log, "x.txt")
    assert len(cut) < LOG_LIMIT + 200 and "log truncated; full log: get_file x.txt" in cut and omitted > 1000
    assert cut.startswith(". display 0") and cut.endswith("1999")


def test_a_log_of_thousands_of_blocks_is_cut_quickly():
    import time

    log = "\n".join(f". display {i}\n" + "\n".join(f"line {i}.{k}" for k in range(60)) + "\n" for i in range(3000))
    t = time.perf_counter()
    cut, omitted = _cut_log(log, "x.txt")
    assert time.perf_counter() - t < 2 and len(cut) < LOG_LIMIT + 200 and omitted > 0
