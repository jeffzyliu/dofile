import json

import pytest

from dofile.engine import RC_INTERNAL, Engine, to_json

PERFECT_FIT = "clear\nset obs 5\ngen x = _n\ngen y = 2*x\nregress y x"  # OpenDTA: ZeroDivisionError


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return Engine(tmp_path)


def test_run_returns_log_rc_and_results(eng):
    r = eng.run("clear\nset obs 50\nset seed 1\ngen x = rnormal()\ngen y = 2*x + rnormal()\nregress y x")
    assert r.rc == 0 and r.error is None
    assert ". regress y x" in r.log  # commands are echoed like a Stata log
    b = r.results["e"]["matrices"]["b"]
    assert b["cols"] == ["x", "_cons"] and abs(b["data"][0][0] - 2) < 0.5
    assert r.results["e"]["scalars"]["N"] == 50 and r.results["e"]["macros"]["cmd"] == "regress"
    json.dumps(r.results)  # must be JSON-serializable


def test_stata_error_gives_rc_and_message(eng):
    r = eng.run("clear\nset obs 1\nsummarize nosuchvar")
    assert r.rc == 111
    assert r.error == "variable nosuchvar not found"


def test_internal_crash_is_contained(eng):
    r = eng.run(PERFECT_FIT)
    assert r.rc == RC_INTERNAL
    assert r.error.startswith("internal engine error: ZeroDivisionError")
    assert r.log.rstrip().endswith(f"r({RC_INTERNAL});")
    # the session still works and keeps its data
    after = eng.run("count")
    assert after.rc == 0 and after.results["r"]["scalars"]["N"] == 5


def test_crash_inside_program_closes_its_scope(eng):
    r = eng.run("""program define boom
    tempvar t
    gen `t' = 1
    gen x = _n
    gen y = 2*x
    regress y x
end
clear
set obs 5
boom""")
    assert r.rc == RC_INTERNAL
    assert eng.session.scopes == []
    assert [v for v in eng.session.data.names if v.startswith("__")] == []  # tempvar dropped
    assert eng.run("display 1 + 1").rc == 0


def test_to_json_missing_and_matrix():
    from dofile._vendor.opendta.core import missing
    assert to_json(missing.missing_code(".")) is None
    assert to_json(missing.missing_code(".a")) == ".a"
    assert to_json(3.0) == 3 and isinstance(to_json(3.0), int)
    assert to_json(2.5) == 2.5 and to_json("x") == "x"


def test_data_summary(eng):
    eng.run('clear\nset obs 3\ngen double x = _n\nlabel variable x "An x"\ngen s = "a"')
    d = eng.data_summary()
    assert d["nobs"] == 3 and d["nvars"] == 2
    assert d["variables"][0] == {"name": "x", "type": "double", "format": "%10.0g", "label": "An x",
                                 "value_label": None}
    assert d["variables"][1]["type"] == "str1"


def test_r_table_after_estimation(eng):
    """r(table) (a dofile patch to OpenDTA): b, se, t, p and CI per coefficient, with e(b)'s columns."""
    import math
    from scipy import stats
    r = eng.run("clear\nset obs 60\nset seed 3\ngen g = mod(_n, 3)\ngen x = rnormal()\n"
                "gen y = 1 + 2*x + g + rnormal()\nquietly regress y x i.g")
    e, t = r.results["e"], r.results["r"]["matrices"]["table"]
    assert t["rows"] == ["b", "se", "t", "pvalue", "ll", "ul", "df", "crit", "eform"]
    assert t["cols"] == e["matrices"]["b"]["cols"]  # includes the hidden base level 0b.g
    col = {name: dict(zip(t["rows"], vals)) for name, vals in zip(t["cols"], zip(*t["data"]))}
    V, df = e["matrices"]["V"]["data"], e["scalars"]["df_r"]
    x = col["x"]
    assert math.isclose(x["se"], math.sqrt(V[0][0]), rel_tol=1e-12)
    assert math.isclose(x["t"], x["b"] / x["se"], rel_tol=1e-12)
    assert math.isclose(x["pvalue"], 2 * stats.t.sf(abs(x["t"]), df), rel_tol=1e-9)
    assert math.isclose(x["ll"], x["b"] - stats.t.ppf(0.975, df) * x["se"], rel_tol=1e-9)
    assert x["df"] == df and x["eform"] == 0
    assert col["0b.g"] == {**col["0b.g"], "b": 0, "se": None, "t": None, "pvalue": None}

    r = eng.run("gen d = y > 2\nquietly logit d x, or")
    t = r.results["r"]["matrices"]["table"]
    b = r.results["e"]["matrices"]["b"]["data"][0][0]
    assert t["rows"][2] == "z" and math.isclose(t["data"][0][0], math.exp(b)) and t["data"][8][0] == 1
    assert t["data"][6][0] is None  # no df for z statistics


def test_matrix_names_keep_equations():
    from dofile._vendor.opendta.commands.matrix import Matrix
    m = to_json(Matrix([[1.0, 2.0]], ["y1"], ["x", "_cons"], coleq=["eq1", "eq1"]))
    assert m["cols"] == ["eq1:x", "eq1:_cons"] and m["rows"] == ["y1"]
    assert to_json(float("inf")) is None and to_json(float("-inf")) is None


def test_error_command_names_the_failing_command(eng):
    assert eng.run("clear\nset obs 3\ngen x = 1\nregress y ///\n   x").error_command == "regress y x"
    assert eng.run("forvalues i = 1/2 {\n  summarize nosuch\n}").error_command == "forvalues i = 1/2 {"
    assert eng.run("display 1").error_command is None


def test_matrix_size_limit_is_checked_before_converting():
    eng = Engine()
    eng.run("matrix A = J(30, 40, 1)")
    assert "error" not in eng.matrix("A", max_cells=1200)  # at the limit: fine
    err = eng.matrix("A", max_cells=1199)["error"]
    assert "30x40" in err and "rows/cols" in err
    part = eng.matrix("A", rows=["r1", "r2"], max_cells=100)  # a slice under the limit is fine
    assert len(part["rows"]) == 2 and len(part["data"][0]) == 40


def test_worker_log_keeps_only_its_start_and_end():
    eng = Engine(log_keep=10_000)
    r = eng.run('forvalues i = 1/5000 {\n    display "line `i\' of output"\n}\ndisplay "the end"')
    assert r.rc == 0 and len(r.log) < 25_000
    assert "line 1 of output" in r.log and "line 5000 of output" in r.log and "the end" in r.log
    assert "characters of output omitted" in r.log
    r = eng.run("bad_command")  # the error at the end is still found
    assert r.rc == 199 and r.error and len(r.log) < 25_000
    assert Engine().run('forvalues i = 1/5000 {\n    display "x"\n}').log.splitlines().count("x") == 5000  # default: all
