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
    b = r.results["e"]["b"]
    assert b["cols"] == ["x", "_cons"] and abs(b["data"][0][0] - 2) < 0.5
    assert r.results["e"]["N"] == 50 and r.results["e"]["cmd"] == "regress"
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
    assert after.rc == 0 and after.results["r"]["N"] == 5


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
