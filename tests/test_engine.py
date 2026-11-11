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


def test_legacy_xls_round_trip_needs_no_extra_install(eng):
    """xlwt and xlrd are core dependencies (the CLI, the MCP server and the web demo all read and write .xls)."""
    r = eng.run(
        "clear\nset obs 3\ngen x = _n * 1.5\nexport excel using t.xls, firstrow(variables) replace\n"
        "clear\nimport excel using t.xls, firstrow clear\nsummarize x\nputexcel set p.xls, replace\nputexcel A1 = 42"
    )
    assert r.rc == 0, r.error
    assert r.results["r"]["scalars"]["N"] == 3 and abs(r.results["r"]["scalars"]["mean"] - 3) < 1e-12


@pytest.mark.parametrize(
    "missing, code, words",
    [
        ("pandas", "clear\nset obs 2\ngen x = _n\nexport sasxport out, replace", "export sasxport is not available"),
        ("pyreadstat", "import sasxport small", "this file format is not available"),
        ("pyreadstat", "use old7, clear", "very old .dta files"),
    ],
)
def test_odt32_missing_optional_package_is_rc_199_without_pip_advice(eng, monkeypatch, missing, code, words):
    """ODT-32: a missing pyreadstat or pandas is rc 199 (like a disabled command), not 610 "file not Stata format", and the
    message does not tell the user to pip install (useless in the browser). small.xpt is a valid file; old7.dta only has the
    first bytes of a format 110 (Stata 7) file, which is all the engine looks at before it needs ReadStat."""
    import shutil
    import sys

    shutil.copy(Path(__file__).parent / "conformance" / "data" / "small.xpt", Path.cwd() / "small.xpt")
    (Path.cwd() / "old7.dta").write_bytes(bytes([110, 2, 1, 0]) + bytes(60))
    monkeypatch.setitem(sys.modules, missing, None)  # `import <missing>` raises ImportError
    r = eng.run(code)
    assert r.rc == 199, r.error
    assert words in r.error and "pip install" not in r.error and missing in r.error


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
    assert d["variables"][0] == {
        "name": "x",
        "type": "double",
        "format": "%10.0g",
        "label": "An x",
        "value_label": None,
    }
    assert d["variables"][1]["type"] == "str1"


def test_r_table_after_estimation(eng):
    """r(table) (a dofile patch to OpenDTA): b, se, t, p and CI per coefficient, with e(b)'s columns."""
    import math
    from scipy import stats

    r = eng.run(
        "clear\nset obs 60\nset seed 3\ngen g = mod(_n, 3)\ngen x = rnormal()\n"
        "gen y = 1 + 2*x + g + rnormal()\nquietly regress y x i.g"
    )
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
    eng.run(
        "clear\nset obs 200\nset seed 4\ngen id = ceil(_n/4)\ngen t = mod(_n,4)\ngen x = rnormal()\n"
        "gen y = x + rnormal()\ngen c = rpoisson(exp(x/2))\nxtset id t"
    )
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

    eng.run(
        "clear\nset obs 300\nset seed 5\ngen id = ceil(_n/5)\ngen t = mod(_n,5)\ngen x = rnormal()\n"
        "gen y = x + rnormal()\ngen d = y > 0\ngen c = rpoisson(exp(1 + x/2))\ngen k = 1 + (y > -.5) + (y > .5)\n"
        "xtset id t"
    )
    for code, cols in [
        ("logit d x", ["d:x", "d:_cons"]),
        ("logit d x, or", ["d:x", "d:_cons"]),
        ("poisson c x", ["c:x", "c:_cons"]),
        ("nbreg c x", ["c:x", "c:_cons", "lnalpha:_cons"]),
        ("tobit y x, ll(-1)", ["model:x", "model:_cons", "sigma:_cons"]),
        ("ologit k x", ["k:x", "cut1:_cons", "cut2:_cons"]),
        ("xtpoisson c x, fe", ["c:x"]),
    ]:
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
    r = eng.run(
        "clear\nset obs 100\nset seed 7\nforvalues i = 1/30 {\n    gen z`i' = rnormal()\n}\n"
        "gen x = z1 + rnormal()\ngen y = x + rnormal()\nivregress 2sls y (x = " + names + ")"
    )
    foot = r.log[r.log.index("Instruments:") :].splitlines()
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


def test_odt16_color_specs():
    """ODT-16: gs# runs black to white; `none`, `*#` intensity and `%#` opacity are understood; unknown stays default."""
    from dofile._vendor.opendta.graphics.scheme import color

    d = "DEFAULT"
    assert (color("gs0", d), color("gs16", d), color("gs2", d)) == ("#000000", "#ffffff", "#202020")
    assert color("none", d) == color('"none"', d) == "none"
    assert color("navy%50", d) == color('"navy%50"', d) == color("navy", d) + "80"
    assert color("maroon%100", d) == color("maroon", d) + "ff" and color("#336699%10", d) == "#3366991a"
    assert color('"255 0 0"*.5', d) == "#ff8080" and color("navy*.5%50", d).endswith("80")
    lighter, darker = color("navy*.5", d), color("navy*1.5", d)
    assert lighter > color("navy", d) > darker  # hex strings of equal length compare by brightness here
    assert color("bogus", d) == d and color("", d) == d and color(None, d) == d
    assert color("#f00", d) == "#ff0000" and color("#f00%50", d) == "#ff000080"


def test_odt16_color_opacity_is_drawn(eng):
    import io
    from dofile._vendor.opendta.graphics import render, store as graph_store

    r = eng.run("clear\nset obs 30\nset seed 1\ngen x = rnormal()\nhistogram x, color(maroon%50)")
    assert r.rc == 0, r.error
    fig = render.figure(graph_store.store(eng.session).get())
    fig.savefig(io.BytesIO(), format="png")
    bar = fig.axes[0].patches[0]
    assert (
        abs(bar.get_facecolor()[3] - 0.5) < 0.01 and bar.get_facecolor()[0] > bar.get_facecolor()[2]
    )  # maroon, half opaque


def test_odt17_legend_position(eng):
    """ODT-17: legend(position(#)) is a clock position outside the plot region; the default stays at the bottom."""
    import io
    from dofile._vendor.opendta.graphics import render, store as graph_store

    eng.run("clear\nset obs 20\ngen x = _n\ngen y = x\ngen z = x^.5")
    centers = {}
    for pos in (None, 3, 9, 12):
        opt = "" if pos is None else f", legend(position({pos}))"
        assert eng.run(f"twoway (line y x) (line z x){opt}").rc == 0
        fig = render.figure(graph_store.store(eng.session).get())
        fig.savefig(io.BytesIO(), format="png")
        box = (fig.legends or [lg for sf in fig.subfigs for lg in sf.legends])[0].get_window_extent()
        centers[pos] = ((box.x0 + box.x1) / 2 / fig.bbox.width, (box.y0 + box.y1) / 2 / fig.bbox.height)
    assert centers[None][1] < 0.2 and 0.4 < centers[None][0] < 0.6
    assert centers[3][0] > 0.8 and centers[9][0] < 0.2 and centers[12][1] > 0.8
    # at the top the legend must sit below the title, not on it
    assert eng.run('twoway (line y x) (line z x), legend(position(12)) title("A title")').rc == 0
    fig = render.figure(graph_store.store(eng.session).get())
    fig.savefig(io.BytesIO(), format="png")
    legend = (fig.legends or [ax.get_legend() for ax in fig.axes if ax.get_legend()])[0].get_window_extent()
    assert legend.y1 <= fig._suptitle.get_window_extent().y0 + 1  # its top edge is under the title's bottom edge


def test_odt20_histogram_outline(eng):
    """ODT-20: lcolor()/lwidth() set a histogram's outline; with neither the edge stays the background color."""
    import io
    from dofile._vendor.opendta.graphics import render, store as graph_store

    def first_bar(opt):
        assert eng.run(f"clear\nset obs 200\nset seed 1\ngen x = rnormal()\nhistogram x, bin(10) {opt}").rc == 0
        fig = render.figure(graph_store.store(eng.session).get())
        fig.savefig(io.BytesIO(), format="png")
        return fig.axes[0].patches[0]

    plain, navy, thick, hollow = (
        first_bar(o) for o in ("", "lcolor(navy)", "lwidth(thick)", "fcolor(none) lcolor(navy)")
    )
    assert tuple(plain.get_edgecolor()) == (1, 1, 1, 1) and plain.get_linewidth() == 0.6  # unchanged default
    assert tuple(navy.get_edgecolor()[:3]) != (1, 1, 1) and navy.get_linewidth() == 0.6
    assert thick.get_linewidth() > 2 and tuple(thick.get_edgecolor()) == (1, 1, 1, 1)
    assert hollow.get_facecolor()[3] == 0 and tuple(hollow.get_edgecolor()) == tuple(navy.get_edgecolor())


def test_results_say_whether_the_call_changed_e_and_r(eng):
    """ERG-3: e() survives `clear` and r() survives a failed command; e_changed/r_changed tell an agent so."""

    def flags(code):
        r = eng.run(code)
        return r.results["e_changed"], r.results["r_changed"]

    base = "clear\nset obs 40\nset seed 1\ngen x = rnormal()\ngen y = x + rnormal()\n"
    assert flags(base + "regress y x") == (True, True)
    assert flags("clear") == (False, False)  # e() still describes the regression on data that is gone
    assert eng.run("clear").results["e"]["scalars"]["N"] == 40
    assert flags("set obs 5\ngen z = _n\nsummarize z") == (False, True)
    assert flags("nosuchcommand") == (False, False)  # a failed command leaves both alone
    assert flags(base + "regress y x") == (True, True)  # the same model again was still set by this call


def test_tempfile_name_outliving_its_file_gets_a_hint(eng):
    """ERG-2: the local names a tempfile of an earlier call; the file was dropped with that call's scope."""
    assert eng.run("clear\nset obs 3\ngen x = _n\ntempfile t\nsave `t'").rc == 0
    r = eng.run("use `t', clear")
    assert r.rc == 601 and "one run_do call" in r.error and "one run_do call" in r.log
    assert "one run_do call" not in eng.run("use nosuchfile, clear").error  # an ordinary missing file: no hint


def test_odt3_interaction_names_in_b(eng):
    """ODT-3: _b[] and _se[] take interaction names, in either term order; plain names and errors are as before."""
    eng.run(
        "clear\nset obs 200\nset seed 1\ngen x = rnormal()\ngen g = 1 + mod(_n, 2)\n"
        "gen y = x + g * x + rnormal()\nquietly regress y c.x##i.g"
    )
    one, other = eng.run("display %12.8f _b[c.x#2.g]"), eng.run("display %12.8f _b[2.g#c.x]")
    assert one.rc == other.rc == 0 and one.log.split("\n")[-3:] == other.log.split("\n")[-3:]
    assert abs(float(one.log.split()[-1])) > 0.1
    assert eng.run("display _se[c.x#2.g]").rc == 0 and eng.run("display _b[2.g]").rc == 0
    assert eng.run("display _b[nosuch#2.g]").rc == 111
    eng.run("quietly regress y c.x#i.g#c.x")  # three terms, any order
    assert eng.run("display _b[1.g#c.x#c.x]").rc == 0 and eng.run("display _b[c.x#c.x#1.g]").rc == 0
    assert eng.run("display 1 # 2").rc == 198  # a # outside _b[...] is still a syntax error


def test_odt4_confirm_variable(eng):
    """ODT-4: confirm [new|numeric|string|<type>] variable gives Stata's return codes."""
    eng.run('clear\nset obs 3\ngen double x = _n\ngen str3 s = "ab"\ngen byte b = 1')
    rc = lambda code: eng.run(code).rc
    assert [
        rc(c)
        for c in (
            "confirm variable x",
            "confirm variable x s",
            "confirm numeric variable x",
            "confirm string variable s",
            "confirm str# variable s",
            "confirm double variable x",
            "confirm byte variable b",
            "confirm new variable fresh",
            "confirm variable x, exact",
        )
    ] == [0] * 9
    assert rc("confirm variable nosuch") == 111 and rc("confirm variable x nosuch") == 111
    assert rc("confirm new variable x") == 110 and rc("confirm new variable 1bad") == 198
    assert rc("confirm numeric variable s") == 7 and rc("confirm string variable x") == 7
    assert rc("confirm byte variable x") == 7
    assert eng.run("capture confirm variable nosuch\ndisplay _rc").log.split()[-1] == "111"
    eng.run("clear")
    assert rc("confirm variable x") == 111


def test_odt15_predict_after_a_command_without_predict(eng):
    """ODT-15: predict after mean is Stata's rc 321, not an engine crash (rc 9999)."""
    eng.run("clear\nset obs 30\nset seed 1\ngen x = rnormal()\ngen y = x + rnormal()\nquietly mean y")
    r = eng.run("predict yh")
    assert r.rc == 321 and "not valid after most recent estimation command" in r.error
    assert eng.run("quietly regress y x\npredict yh").rc == 0


def test_odt18_ttest_options_of_the_paired_and_one_sample_forms(eng):
    """ODT-18: unequal/welch/unpaired belong to the two-sample forms; elsewhere only level() is allowed (rc 198)."""
    eng.run("clear\nset obs 30\nset seed 1\ngen y = rnormal()\ngen z = rnormal()\ngen g = mod(_n, 2)")
    for code in ("ttest y == z, unequal", "ttest y == z, welch", "ttest y == 0, unequal", "ttest y == 0, unpaired"):
        r = eng.run(code)
        assert r.rc == 198 and "not allowed" in r.error, code
    for code in (
        "ttest y == z",
        "ttest y == z, level(90)",
        "ttest y == z, unpaired unequal",
        "ttest y == 0, level(90)",
        "ttest y, by(g) unequal",
        "ttest y, by(g) welch",
    ):
        assert eng.run(code).rc == 0, code


ODT24_DATA = (
    "clear\nset seed 12345\nset obs 300\ngen id = ceil(_n/10)\ngen t = mod(_n-1, 10) + 1\ngen x = rnormal()\n"
    "gen z = rnormal()\ngen y = 0.5*x - 0.3*z + id/20 + rnormal()\ngen w = 1 + mod(id, 5)\n"
    "gen wv = 0.5 + runiform()\ngen fw = 1 + mod(id, 3)\nxtset id t"
)


def _slope_and_se(eng, cmd):
    r = eng.run(f'quietly {cmd}\ndisplay %14.10f _b[x] " " %14.10f _se[x] " " e(N) " " e(df_r)')
    assert r.rc == 0, (cmd, r.error)
    b, se, n, df = r.log.strip().splitlines()[-1].split()
    return float(b), float(se), float(n), float(df)


def test_odt24_weights_in_xtreg_fe_and_areg(eng):
    """ODT-24: with weights the within estimators must equal `regress` with the panel dummies (areg is that fit):
    coefficient, standard error, N and residual df, for a- and fweights constant within the panel."""
    eng.run(ODT24_DATA)
    for wt in ("", "[aweight=w]", "[fweight=fw]"):
        lsdv = _slope_and_se(eng, f"regress y x z i.id {wt}")
        for cmd in (f"xtreg y x z {wt}, fe", f"areg y x z {wt}, absorb(id)"):
            got = _slope_and_se(eng, cmd)
            assert all(abs(a - b) < 1e-8 for a, b in zip(got, lsdv)), (cmd, got, lsdv)
    assert (
        abs(_slope_and_se(eng, "regress y x z i.id [aweight=w]")[0] - _slope_and_se(eng, "regress y x z i.id")[0])
        > 1e-3
    )


def test_odt24_areg_takes_weights_that_vary_within_the_group_and_xtreg_refuses_them(eng):
    """[XT] xtreg (Stata 14): "Weights must be constant within panel." areg has no such limit."""
    eng.run(ODT24_DATA)
    for wt in ("[aweight=wv]", "[pweight=wv]"):
        assert (
            abs(
                _slope_and_se(eng, f"areg y x z {wt}, absorb(id)")[0]
                - _slope_and_se(eng, f"regress y x z i.id {wt}")[0]
            )
            < 1e-8
        )
        r = eng.run(f"xtreg y x z {wt}, fe")
        assert r.rc == 101 and "constant within panel" in r.error, wt


def test_odt24_pweights_in_xtreg_fe_and_weight_macros(eng):
    """pweights: the coefficient is the weighted one, the variance robust (clustered on the panel); e(wtype), e(wexp)."""
    eng.run(ODT24_DATA)
    b = _slope_and_se(eng, "xtreg y x z [pweight=w], fe")[0]
    assert abs(b - _slope_and_se(eng, "regress y x z i.id [pweight=w]")[0]) < 1e-8
    assert eng.run("display \"`e(wtype)' `e(wexp)'\"").log.strip().splitlines()[-1] == "pweight = w"


def test_odt24_areg_robust_with_fweights(eng):
    """An fweight is that many copies of the row: the robust variance weights each squared score by w, not w^2."""
    eng.run(ODT24_DATA)
    for wt in ("[fweight=fw]", "[aweight=w]"):
        lsdv = _slope_and_se(eng, f"regress y x z i.id {wt}, vce(robust)")
        got = _slope_and_se(eng, f"areg y x z {wt}, absorb(id) vce(robust)")
        assert all(abs(a - b) < 1e-8 for a, b in zip(got, lsdv)), (wt, got, lsdv)


def test_odt24_xtreg_re_and_be_refuse_weights(eng):
    """[XT] xtreg allows weights with fe only; re and be used to drop them and report the unweighted fit."""
    eng.run(ODT24_DATA)
    for model in ("re", "be"):
        r = eng.run(f"xtreg y x z [aweight=w], {model}")
        assert r.rc == 101 and "aweights not allowed" in r.error, model


def test_odt25_the_sort_list_ends_at_the_first_zero(eng, tmp_path):
    """ODT-25: Stata leaves other bytes after the zero that ends the sort list; they are not sort keys."""
    eng.run("clear\nset obs 20\nforeach i of numlist 1/8 {\n    gen v`i' = _n\n}\nsort v3\nsave t, replace")
    f = tmp_path / "t.dta"
    raw = bytearray(f.read_bytes())
    i = raw.index(b"<sortlist>") + len(b"<sortlist>")
    for j in range(2, 9):  # the list is "3, 0, 0, ...": put leftovers where the zeros are
        raw[i + 2 * j : i + 2 * j + 2] = (j % 8 + 1).to_bytes(2, "little")
    f.write_bytes(bytes(raw))
    log = eng.run("use t, clear\ndescribe, short").log
    assert [ln.rstrip() for ln in log.splitlines() if ln.startswith("Sorted by")] == ["Sorted by: v3"]


ODT28_MISSING_FOLDER = [
    "log using nodir/a, replace",
    "cmdlog using nodir/a",
    "outfile using nodir/a.raw, replace",
    "file open fh using nodir/a.txt, write replace",
    "copy base.dta nodir/a.dta, replace",
    "bcal create nodir/cal, from(x) replace",
    "save nodir/a, replace",
]
ODT28_DIRECTORY = [
    "log using adir.smcl, replace",
    "type adir.txt",
    "use adir, clear",
    "file open fh using adir.txt, read",
    "outfile using adir.raw, replace",
    "append using adir",
]


def test_odt28_a_missing_folder_or_a_directory_is_rc_603_not_an_internal_error(eng, tmp_path):
    """ODT-28: log, cmdlog, outfile, file open, copy, bcal create (missing folder) and use, append, type, ... (a directory
    in place of a file) let a Python OSError escape: rc 9999. Stata: r(603) "file ... could not be opened"."""
    eng.run("clear\nset obs 3\ngen x = _n\nsave base, replace")
    for name in ("adir", "adir.dta", "adir.txt", "adir.raw", "adir.smcl"):
        (tmp_path / name).mkdir()
    for cmd in ODT28_MISSING_FOLDER + ODT28_DIRECTORY:
        r = eng.run(cmd)
        eng.run("capture file close _all\ncapture log close _all\ncapture cmdlog close")
        assert r.rc == 603, (cmd, r.rc, r.error)
        assert "could not be opened" in r.error and "internal engine error" not in r.log, (cmd, r.error)
    assert (
        eng.run("log using nodir/a, replace").error
        == "file nodir/a.smcl could not be opened (No such file or directory)"
    )


def test_odt28_capture_catches_it_and_sets_rc(eng):
    eng.run("clear\nset obs 3\ngen x = _n")
    for cmd in (
        "log using nodir/a, replace",
        "outfile using nodir/a.raw, replace",
        "file open fh using nodir/a.txt, write replace",
    ):
        r = eng.run(f"capture {cmd}\ndisplay _rc")
        assert r.rc == 0 and r.log.strip().splitlines()[-1] == "603", (cmd, r.log)


def test_odt28_commands_with_their_own_error_codes_keep_them(eng):
    """erase 601/693, cd 170 and the rest are raised by the commands themselves; the 603 conversion must not replace them."""
    eng.run("clear\nset obs 3\ngen x = _n")
    assert eng.run("erase nodir/a.dta").rc == 601
    assert eng.run("cd nodir").rc == 170
    assert eng.run("mkdir nodir/deeper/still").rc == 693
    assert eng.run("save nodir/a, replace").rc == 603 and eng.run("use nodir/a, clear").rc == 601


def test_odt28_out_of_memory_is_rc_909_and_capture_catches_it(eng, monkeypatch):
    """ODT-28: a MemoryError (numpy could not allocate; the web demo has a 4 GB WebAssembly heap) was rc 9999 and ended the
    whole program, `capture` or not. Stata: r(909)."""
    from dofile._vendor.opendta.core.dataset import Dataset

    def no_memory(*args, **kwargs):
        raise MemoryError("Unable to allocate 763. MiB")

    eng.run("clear\nset obs 3\ngen x = _n")
    monkeypatch.setattr(Dataset, "set_numeric", no_memory)
    r = eng.run("replace x = 2")
    assert (r.rc, r.error) == (909, "op. sys. refuses to provide memory"), (r.rc, r.error)
    r = eng.run('capture replace x = 2\ndisplay "rc " _rc')
    assert r.rc == 0 and r.log.strip().splitlines()[-1] == "rc 909", r.log


def test_odt22_matrix_pseudofunction(eng):
    """ODT-22: matrix(name) is the matrix name in an expression."""
    eng.run("matrix xx = (1, 2 \\ 3, 4)")
    assert eng.run("display trace(matrix(xx))").log.split()[-1] == "5"
    assert eng.run("display el(matrix(xx), 2, 1)").log.split()[-1] == "3"
    assert eng.run("display trace(xx)").log.split()[-1] == "5"


def test_odt13_summary_commands_replay(eng):
    """ODT-13: `mean`, `mean, level(90)` and `mean, noheader` redisplay the last mean (also proportion, ratio, total)."""
    body = lambda text: [ln for ln in text.splitlines() if ln.strip() and not ln.startswith(". ")]
    eng.run("clear\nset obs 60\nset seed 3\ngen x = rnormal()\ngen y = x + rnormal()\ngen g = 1 + mod(_n, 3)")
    first = body(eng.run("mean x y").log)
    assert body(eng.run("mean").log) == first  # header and table, as typed the first time
    r90 = body(eng.run("mean, level(90)").log)
    assert any("[90% Conf. Interval]" in ln for ln in r90) and r90 != first
    assert eng.run("mean, level(90)").results["r"]["scalars"].get("level", 90) == 90
    noheader = body(eng.run("mean, noheader").log)
    assert not any("Mean estimation" in ln for ln in noheader) and any("Std. Err." in ln for ln in noheader)
    eng.run("proportion g")
    assert eng.run("proportion").rc == 0 and body(eng.run("proportion").log)[0].startswith("Proportion estimation")
    r = eng.run("mean")  # the last estimation is not a mean any more
    assert r.rc == 301 and "last estimates not found" in r.error
    eng.run("regress y x")
    assert eng.run("mean").rc == 301
    assert eng.run("mean x").rc == 0  # with arguments it estimates as before


def test_odt8_backslash_dollar_is_a_literal_dollar(eng):
    """ODT-8: `\\$` stops macro expansion and leaves a $; $name still expands."""
    last = lambda code: [ln for ln in eng.run(code).log.splitlines() if ln.strip()][-1]
    eng.run("global v1 X")
    assert last('display "a\\$v1 b"') == "a$v1 b"
    assert last('display "\\$22.15"') == "$22.15"
    assert last('display "cost \\$5 and $v1"') == "cost $5 and X"
    assert last('display "$v1"') == "X"


def test_odt21_default_axis_ticks_are_nice_numbers(eng):
    """ODT-21: numeric axes get about five ticks in steps of 1, 2, 5, 10 and no `.0` labels, as Stata does."""
    import io
    from dofile._vendor.opendta.graphics import render, store as graph_store

    eng.run("clear\nset obs 18\ngen educ = _n\ngen w = educ / 3")
    assert eng.run("twoway line w educ").rc == 0
    fig = render.figure(graph_store.store(eng.session).get())
    fig.savefig(io.BytesIO(), format="png")
    ax = fig.axes[0]
    lo, hi = ax.get_xlim()
    ticks = [t for t in ax.get_xticks() if lo <= t <= hi]
    labels = [lb.get_text() for lb, t in zip(ax.get_xticklabels(), ax.get_xticks()) if lo <= t <= hi]
    assert ticks == [5, 10, 15] and all("." not in lb for lb in labels)  # not 2.5, 5.0, 7.5, 10.0, ...
    assert 3 <= len([t for t in ax.get_yticks() if ax.get_ylim()[0] <= t <= ax.get_ylim()[1]]) <= 6


def test_safe_eval_allows_only_arithmetic():
    """Expression text from Stata code (arch's archmexp(), bayesstats {param} expressions) is evaluated without
    Python's eval(), whose empty __builtins__ still let ().__class__... reach Python's internals."""
    import math
    from dofile._vendor.opendta.core.safe_expr import safe_eval

    env = {"x": 2.0, "sqrt": math.sqrt, "exp": math.exp}
    assert safe_eval(" sqrt(x) * 2 + -1 ** 2 / 4", env) == math.sqrt(2) * 2 - 0.25
    for bad in [
        "().__class__",
        "x.real",
        "[1][0]",
        "(lambda: 1)()",
        "[i for i in (1,)]",
        "sqrt(x=1)",
        "sqrt(*[x])",
        "'a'",
        "__import__('os')",
        "open",
        "x if x else 1",
        "x < 1",
        "{1: 2}",
    ]:
        with pytest.raises(ValueError):
            safe_eval(bad, env)


def test_stata_expressions_cannot_reach_python(eng):
    """arch archmexp() and bayesstats expressions: arithmetic works, Python attribute tricks are rc 198."""
    base = "clear\nset obs 200\ngen t = _n\ntsset t\nset seed 3\ngen y = rnormal()\n"
    assert eng.run(base + "quietly arch y, arch(1) archm archmexp(X^2 + 1)").rc == 0
    r = eng.run(base + "quietly arch y, arch(1) archm archmexp(().__class__.__mro__.__len__()*X)")
    assert r.rc == 198 and "archmexp" in r.error
    eng.run(
        "clear\nset obs 25\nset seed 7\ngen w = 1 + rnormal()\nquietly bayesmh w = ({mu}), "
        "likelihood(normal(1)) prior({mu}, normal(0,4)) rseed(11) mcmcsize(1000) nomodelsummary"
    )
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
    assert (
        Engine().run('forvalues i = 1/5000 {\n    display "x"\n}').log.splitlines().count("x") == 5000
    )  # default: all


def test_same_treats_nan_as_unchanged_and_names_match_whole_files():
    from dofile import sandbox
    from dofile.engine import _refusal_for, _same

    nan = float("nan")
    assert _same({"a": nan}, {"a": float("nan")}) and not _same({"a": 1.0}, {"a": 2.0})
    sandbox.refusals.clear()
    sandbox.refusals.extend(
        [
            ("/x/a.png", "dofile sandbox: cannot write /x/a.png"),
            ("/x/my plot.png", "dofile sandbox: cannot write /x/my plot.png"),
        ]
    )
    assert _refusal_for("file my plot.png could not be opened").endswith("my plot.png")
    assert _refusal_for("file data.png could not be opened") is None  # a.png is not inside data.png
    assert _refusal_for("file ../a.png could not be opened").endswith("a.png")
    sandbox.refusals.clear()
