import json
from pathlib import Path

import pytest

from dofile.engine import RC_INTERNAL, Engine, to_json

CRASH = "clear\nset obs 5\ndofile_test_crash"  # a command that raises ZeroDivisionError (fixture `crash_cmd`)


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


@pytest.fixture
def crash_cmd():
    """A command that raises a Python exception, as an engine bug would (the real ones get fixed)."""
    from dofile._vendor.opendta.commands.registry import REGISTRY, command

    @command("dofile_test_crash")
    def _crash(s, args):
        raise ZeroDivisionError("division by zero")
    yield
    REGISTRY.pop("dofile_test_crash", None)


def test_internal_crash_is_contained(eng, crash_cmd):
    r = eng.run(CRASH)
    assert r.rc == RC_INTERNAL
    assert r.error.startswith("internal engine error: ZeroDivisionError")
    assert r.log.rstrip().endswith(f"r({RC_INTERNAL});")
    # the session still works and keeps its data
    after = eng.run("count")
    assert after.rc == 0 and after.results["r"]["scalars"]["N"] == 5


def test_crash_inside_program_closes_its_scope(eng, crash_cmd):
    r = eng.run("""program define boom
    tempvar t
    gen `t' = 1
    dofile_test_crash
end
clear
set obs 5
boom""")
    assert r.rc == RC_INTERNAL
    assert eng.session.scopes == []
    assert [v for v in eng.session.data.names if v.startswith("__")] == []  # tempvar dropped
    assert eng.run("display 1 + 1").rc == 0


def test_each_call_is_a_do_file_scope(eng):
    # a failed call must not leave preserve active, or the retry fails with rc 621 on the changed data
    eng.run("clear\nset obs 3\ngen x = _n\ngen y = 1")
    r = eng.run("preserve\nkeep x\nnosuchcommand")
    assert r.rc == 199 and r.nvars == 2  # data restored
    assert eng.run("preserve\nkeep x").rc == 0 and eng.run("describe").rc == 0
    assert eng.session.data.names == ["x", "y"]  # restored at the end of that call too
    assert eng.run("restore").rc == 622  # preserve does not carry across calls
    assert eng.run("local k 7").rc == 0 and "7" in eng.run("display `k'").log  # locals do
    assert eng.session.scopes == []


def test_scientific_notation_matches_stata(eng):
    # OpenDTA's default prints 1.00×10¹⁰; Stata (and agents parsing logs) expect 1.000e+10
    assert "1.000e+10" in eng.run("display 1e10").log
    assert "1.000e+10" in eng.run("clear all\ndisplay 1e10").log


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


def test_r_table_replaces_earlier_r(eng):
    """A coefficient table replaces r(), as in Stata: no leftovers from summarize or test beside r(table)."""
    eng.run("clear\nset obs 40\nset seed 2\ngen x = rnormal()\ngen y = x + rnormal()")
    r = eng.run("summarize x\nquietly regress y x")
    assert set(r.results["r"]["scalars"]) == set() and set(r.results["r"]["matrices"]) == {"table"}
    r = eng.run("test x\nregress y x")
    assert r.results["r"]["scalars"] == {} and set(r.results["r"]["matrices"]) == {"table"}
    r = eng.run("lincom x")  # r-class: its own results replace r(table), as in Stata 14
    assert set(r.results["r"]["scalars"]) == {"estimate", "se", "df"} and r.results["r"]["matrices"] == {}


def test_new_estimates_drop_a_stale_r_table(eng):
    """r(table) never outlives its estimates: after mean it is mean's own table, not the previous
    regression's. Tables drawn before posting (xtpoisson) and margins' own r() are kept."""
    eng.run("clear\nset obs 200\nset seed 4\ngen id = ceil(_n/4)\ngen t = mod(_n,4)\ngen x = rnormal()\n"
            "gen y = x + rnormal()\ngen c = rpoisson(exp(x/2))\nxtset id t")
    assert eng.run("quietly regress y x").results["r"]["matrices"]
    assert eng.run("quietly mean y").results["r"]["matrices"]["table"]["cols"] == ["y"]
    r = eng.run("quietly xtpoisson c x, fe")
    assert r.rc == 0 and r.results["r"]["matrices"]["table"]["cols"][0].endswith("x")
    r = eng.run("quietly regress y x\nquietly margins, dydx(x) post")
    assert r.results["r"]["macros"]["cmd"] == "margins" and "table" in r.results["r"]["matrices"]


def test_r_table_columns_follow_e_b(eng):
    """r(table) has e(b)'s columns, as in Stata: equation names on ML models, e(b)'s own ancillary parameters
    (lnalpha, cut1, sigma), not the transformed ones shown in the table (alpha); also when the table is drawn
    before the estimates are posted (xtpoisson, fe)."""
    import math
    eng.run("clear\nset obs 300\nset seed 5\ngen id = ceil(_n/5)\ngen t = mod(_n,5)\ngen x = rnormal()\n"
            "gen y = x + rnormal()\ngen d = y > 0\ngen c = rpoisson(exp(1 + x/2))\ngen k = 1 + (y > -.5) + (y > .5)\n"
            "xtset id t")
    for code, cols in [("logit d x", ["d:x", "d:_cons"]), ("logit d x, or", ["d:x", "d:_cons"]),
                       ("poisson c x", ["c:x", "c:_cons"]),
                       ("nbreg c x", ["c:x", "c:_cons", "lnalpha:_cons"]),
                       ("tobit y x, ll(-1)", ["model:x", "model:_cons", "sigma:_cons"]),
                       ("ologit k x", ["k:x", "cut1:_cons", "cut2:_cons"]),
                       ("xtpoisson c x, fe", ["c:x"])]:
        r = eng.run("quietly " + code)
        t, b = r.results["r"]["matrices"]["table"], r.results["e"]["matrices"]["b"]
        assert t["cols"] == b["cols"] == cols, code
        for bt, be, ef in zip(t["data"][0], b["data"][0], t["data"][8]):
            assert math.isclose(bt, math.exp(be) if ef else be, rel_tol=1e-9), code


def test_r_table_after_mean_and_proportion(eng):
    """mean/proportion/total/ratio post r(table) like other estimators; proportion's ll/ul are the interval its
    table shows (logit scale), not b +/- crit*se."""
    import math
    eng.run("clear\nset obs 90\ngen x = mod(_n*7, 13)\ngen g = 1 + mod(_n, 3)")
    r = eng.run("quietly regress x g\nquietly mean x")
    t = r.results["r"]["matrices"]["table"]
    assert t["cols"] == ["x"] and t["rows"][2] == "t"
    assert math.isclose(t["data"][0][0], r.results["e"]["matrices"]["b"]["data"][0][0])
    r = eng.run("proportion g")
    t = r.results["r"]["matrices"]["table"]
    assert t["cols"] == ["g:1", "g:2", "g:3"]
    b, se, ll = t["data"][0][0], t["data"][1][0], t["data"][4][0]
    assert ll > b - t["data"][7][0] * se  # logit-scale interval: asymmetric, above the symmetric bound
    row = next(ln for ln in r.log.splitlines() if ln.strip().startswith("1 |"))
    assert f"{ll:.7f}"[1:8] in row  # the same lower bound the table shows


def test_odt_fixes(eng):
    """dofile patches for OpenDTA issues ODT-1, 2, 5, 6, 9, 10, 12 (docs/opendta-issues.md)."""
    import warnings
    # ODT-1: a perfect fit runs, with F and its p-value missing
    r = eng.run("clear\nset obs 20\ngen x = _n\ngen y = 2*x\nregress y x")
    assert r.rc == 0 and r.results["e"]["scalars"]["F"] is None and r.results["e"]["scalars"]["r2"] == 1
    # ODT-6: huge numbers in %f formats (an almost perfect fit's F) no longer crash
    r = eng.run("display %12.2f 1e33")
    assert r.rc == 0 and len(r.log.splitlines()[1].strip()) == 36 and r.log.splitlines()[1].endswith(".00")
    # ODT-5: %w.dg shows at most d significant digits
    out = eng.run("display %12.4g 1/3\ndisplay %20.12g 1/3\ndisplay %10.4g -1234.567").log.splitlines()
    assert [ln.strip() for ln in out if ln and not ln.startswith(".")] == [".3333", ".333333333333", "-1235"]
    # ODT-9: a long instrument list wraps at the line size, continuation lines under the first item
    names = " ".join(f"z{i}" for i in range(1, 31))
    r = eng.run("clear\nset obs 100\nset seed 7\nforvalues i = 1/30 {\n    gen z`i' = rnormal()\n}\n"
                "gen x = z1 + rnormal()\ngen y = x + rnormal()\nivregress 2sls y (x = " + names + ")")
    foot = r.log[r.log.index("Instruments:"):].splitlines()
    assert r.rc == 0 and len(foot[1]) > 15 and foot[1].startswith(" " * 15 + "z") and max(map(len, foot)) <= 79
    # ODT-12: nbreg at the alpha boundary: no NumPy warning. Smoke test only: the original trigger (lnalpha just
    # above -20 with a negative variance) came from the Card data, which can't ship here; checked by hand.
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        r = eng.run("clear\nset obs 200\ngen x = mod(_n, 7)\ngen c = 2 + mod(_n, 3)\nnbreg c x")
    assert r.rc == 0 and "/lnalpha" in r.log


def test_odt2_xtlogit_bounds_dont_overflow(eng):
    """ODT-2: xtlogit, re at the sigma_u = 0 boundary: the rho and sigma_u intervals no longer overflow exp()."""
    data = Path(__file__).parent / "conformance" / "data" / "panel.dta"
    r = eng.run(f'use "{data}", clear\nxtset id year\nxtlogit d x1 x2, re')
    assert r.rc == 0 and "rho" in r.log


def test_odt10_relabel():
    """ODT-10: over(var, relabel(# "text")) renames categories by position."""
    from dofile._vendor.opendta.graphics.families import _relabel
    assert _relabel(["0", "1", "0", "1"], {"relabel": '1 "Not near" 2 "Near"'}) == ["Not near", "Near"] * 2
    assert _relabel(["a", "b"], {"relabel": '2 "B"'}) == ["a", "B"] and _relabel(["a"], {}) == ["a"]


def test_safe_eval_allows_only_arithmetic():
    """Expression text from Stata code (arch's archmexp(), bayesstats {param} expressions) is evaluated without
    Python's eval(), whose empty __builtins__ still let ().__class__... reach Python's internals."""
    import math
    from dofile._vendor.opendta.core.safe_expr import safe_eval
    env = {"x": 2.0, "sqrt": math.sqrt, "exp": math.exp}
    assert safe_eval(" sqrt(x) * 2 + -1 ** 2 / 4", env) == math.sqrt(2) * 2 - 0.25
    for bad in ["().__class__", "x.real", "[1][0]", "(lambda: 1)()", "[i for i in (1,)]", "sqrt(x=1)",
                "sqrt(*[x])", "'a'", "__import__('os')", "open", "x if x else 1", "x < 1", "{1: 2}"]:
        with pytest.raises(ValueError):
            safe_eval(bad, env)


def test_stata_expressions_cannot_reach_python(eng):
    """arch archmexp() and bayesstats expressions: arithmetic works, Python attribute tricks are rc 198."""
    base = "clear\nset obs 200\ngen t = _n\ntsset t\nset seed 3\ngen y = rnormal()\n"
    assert eng.run(base + "quietly arch y, arch(1) archm archmexp(X^2 + 1)").rc == 0
    r = eng.run(base + "quietly arch y, arch(1) archm archmexp(().__class__.__mro__.__len__()*X)")
    assert r.rc == 198 and "archmexp" in r.error
    eng.run("clear\nset obs 25\nset seed 7\ngen w = 1 + rnormal()\nquietly bayesmh w = ({mu}), "
            "likelihood(normal(1)) prior({mu}, normal(0,4)) rseed(11) mcmcsize(1000) nomodelsummary")
    assert eng.run("bayesstats summary (sq: {mu}^2) (e: exp({mu}))").rc == 0
    assert eng.run("bayesstats summary (a: ().__class__.__mro__.__len__()*{mu})").rc == 198


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
