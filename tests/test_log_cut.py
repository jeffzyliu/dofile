"""ERG-1: how run_do cuts a long log (src/dofile/mcp_server.py: _cut_log)."""
import pytest

pytest.importorskip("mcp")
from dofile.engine import Engine  # noqa: E402
from dofile.mcp_server import LOG_LIMIT, _cut_log  # noqa: E402


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return Engine(tmp_path)

PRE = ("clear\nset obs 500\nset seed 1\nforeach v in a b c d e f g h i j k l m n o p {\n    gen `v' = rnormal()\n}\n"
       "gen y = a + b + rnormal()\n")
REG = "regress y a b c d e f g h i j k l m n o p"


def test_a_log_that_fits_is_kept_whole(eng):
    log = eng.run("display 1\ndisplay 2").log
    assert _cut_log(log, "x.txt") == (log, 0)


def test_a_loops_results_survive_the_cut(eng):
    """A loop's commands are echoed once, up front, so its output has no per-command markers: cut the biggest
    tables, keep the display lines (before the fix, iterations 2 to 4 were lost)."""
    code = (PRE + f"foreach c in 1 2 3 4 5 {{\n    {REG} if mod(_n,5)==`c'-1\n"
            "    display \"RESULT iteration `c'\"\n}\ndisplay \"LAST LINE\"\n")
    log = eng.run(code).log
    assert len(log) > LOG_LIMIT
    cut, omitted = _cut_log(log, "x.txt")
    assert len(cut) <= LOG_LIMIT and omitted > 0 and "lines omitted; full log: get_file x.txt" in cut
    assert all(f"RESULT iteration {i}" in cut for i in range(1, 6)) and "LAST LINE" in cut
    assert all(line in cut for line in log.split("\n") if line.startswith(". "))  # echoes are never cut


def test_short_results_between_long_outputs_survive(eng):
    code = PRE + "".join(f"{REG} if mod(_n,5)=={i}\ndisplay \"RESULT {i}\"\n" for i in range(5))
    cut, _ = _cut_log(eng.run(code).log, "x.txt")
    assert all(f"RESULT {i}" in cut for i in range(5))


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
