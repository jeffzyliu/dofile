"""Engine features for the web demo (docs/design/SPEC.md, section 6): fresh_locals, on_output and the log cap,
error_line, graph_commands, plot_theme, describe_file, macros, data_rows, memory and the tempfile hint. The MCP server
does not send these; tests/test_mcp.py checks that its output is unchanged. browser.py's side: tests/test_browser.py."""
import io
import time

import pytest

from dofile import engine as engine_mod
from dofile.engine import RC_BREAK, TEMPFILE_HINT, Engine, clear_break, request_break

DATA = "clear\nset obs 5\ngen x = _n\ngen y = x^2"


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    e = Engine(tmp_path)
    assert e.run(DATA).rc == 0
    return e


# -- fresh_locals ---------------------------------------------------------------------------------------------------

FILE = 'display "x=[`x\']"\nlocal x = `x\' + 1\n'


def test_a_whole_file_run_twice_gives_the_same_result(eng):
    first, second = (eng.run(FILE, fresh_locals=True) for _ in range(2))
    assert "x=[]" in first.log and "x=[]" in second.log
    assert eng.macros()["locals"] == {"x": "1"}   # the locals of the last run stay, for a selection run after it
    kept = eng.run(FILE)   # the default keeps them (the MCP server, the CLI, a selection run)
    assert "x=[1]" in kept.log


def test_fresh_locals_keeps_globals_data_and_results(eng):
    eng.run("global g hello\nlocal l 1\nregress y x\nsummarize x")
    r = eng.run('display "$g/`l\'/" e(N) "/" r(mean)', fresh_locals=True)
    assert r.rc == 0 and "hello//5/3" in r.log
    assert r.nobs == 5 and r.results["e"]["scalars"]["N"] == 5


# -- on_output and the log cap --------------------------------------------------------------------------------------

def _sink():
    got: list[tuple[float, str]] = []
    return got, lambda text: got.append((time.monotonic(), text))


@pytest.fixture
def slow_cmds():
    """`dofile_test_busy`: 0.6 s of work that writes nothing and never calls brk.check (a big regress or merge);
    `dofile_test_chatty`: one command that writes 60 lines over about 0.6 s."""
    from dofile._vendor.opendta.commands.registry import REGISTRY, command

    @command("dofile_test_busy")
    def _busy(s, args):
        end = time.monotonic() + 0.6
        while time.monotonic() < end:
            pass

    @command("dofile_test_chatty")
    def _chatty(s, args):
        for i in range(60):
            s.output.write(f"line {i}\n", "text")
            time.sleep(0.01)
    yield
    REGISTRY.pop("dofile_test_busy", None)
    REGISTRY.pop("dofile_test_chatty", None)


def test_on_output_gets_the_whole_log_in_batches(eng, slow_cmds):
    got, sink = _sink()
    t0 = time.monotonic()
    r = eng.run("display 1\ndofile_test_chatty\ndisplay 2", on_output=sink)
    elapsed = time.monotonic() - t0
    assert "".join(t for _, t in got) == r.log
    assert got[0][1].startswith(". display 1")   # the first text went at once
    # inside one command, at most one batch per STREAM_EVERY; plus one before each of the 3 commands and the last
    assert 3 <= len(got) <= elapsed / engine_mod.STREAM_EVERY + 5


def test_a_tight_loop_sends_rarely(eng):
    got, sink = _sink()
    t0 = time.monotonic()
    r = eng.run("forvalues i = 1/3000 {\n  display `i'\n}", on_output=sink)
    elapsed = time.monotonic() - t0
    assert "".join(t for _, t in got) == r.log
    assert len(got) <= elapsed / engine_mod.STREAM_BEFORE_COMMAND + 3


def test_output_before_a_long_silent_command_is_sent_before_it_starts(eng, slow_cmds):
    got, sink = _sink()
    r = eng.run("summarize x\ndofile_test_busy", on_output=sink)
    end = time.monotonic()
    assert "".join(t for _, t in got) == r.log
    sent_early = "".join(text for t, text in got if end - t > 0.4)
    assert "Variable" in sent_early and ". dofile_test_busy" in sent_early   # the summarize table and the echo


def test_the_echo_of_a_long_command_arrives_before_it_ends(eng):
    """A long command that writes nothing (sleep, ml iterations, bootstrap) still lets the pending echo out: they call
    brk.check(), which sends what is pending."""
    got, sink = _sink()
    eng.run("display 1\nsleep 500\ndisplay 2", on_output=sink)
    end = time.monotonic()
    first_with_sleep = next(t for t, text in got if ". sleep 500" in text)
    assert end - first_with_sleep > 0.25


def test_on_output_includes_the_engines_own_lines(eng):
    """The Break, the internal error and the tempfile note are written by the Engine after OpenDTA stops."""
    eng.run("tempfile t\nsave `t'")
    got, sink = _sink()
    r = eng.run("use `t', clear", on_output=sink)
    assert r.rc == 601 and "".join(t for _, t in got) == r.log and TEMPFILE_HINT in r.log


def test_on_output_stops_at_the_cap_and_the_log_drops_the_middle(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    e = Engine(tmp_path, log_keep=1000)
    got, sink = _sink()
    r = e.run('forvalues i = 1/500 {\n  display "line `i\'"\n}', on_output=sink)
    sent = "".join(t for _, t in got)
    assert len(sent) == 1000 and r.log.startswith(sent)
    assert "characters of output omitted" in r.log and r.log.rstrip().endswith("line 500")


def test_between_one_and_two_caps_the_stream_stops_and_the_log_is_whole(tmp_path, monkeypatch):
    """The capture keeps the first and last 1000 characters, so a 1500-character log is kept whole with no marker; the
    stream stops at 1000 and is still the start of the log (the page replaces it with the log at the end)."""
    monkeypatch.chdir(tmp_path)
    e = Engine(tmp_path, log_keep=1000)
    got, sink = _sink()
    r = e.run('forvalues i = 1/170 {\n  display "line `i\'"\n}', on_output=sink)
    sent = "".join(t for _, t in got)
    assert 1000 < len(r.log) < 2000 and "omitted" not in r.log
    assert len(sent) == 1000 and r.log.startswith(sent)


def test_log_keep_0_is_no_cap_for_the_stream_too(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    e = Engine(tmp_path, log_keep=0)
    got, sink = _sink()
    r = e.run("display 1", on_output=sink)
    assert "".join(t for _, t in got) == r.log != ""


def test_on_output_with_a_break(eng, break_cmds):
    got, sink = _sink()
    r = eng.run("display 1\ndofile_test_break_inside\ndisplay 2", on_output=sink)
    assert r.rc == RC_BREAK and "".join(t for _, t in got) == r.log and r.log.rstrip().endswith("r(1);")


def test_a_receiver_that_raises_a_base_exception_is_dropped(eng):
    def sink(text):
        raise KeyboardInterrupt
    eng.run("display 1\ndisplay 2", on_output=sink)
    assert eng._tee.sink is None
    assert eng.run("display 3").rc == 0


def test_a_failing_receiver_does_not_stop_the_run(eng):
    def sink(text):
        raise RuntimeError("the page is gone")
    r = eng.run("display 1\ndisplay 2", on_output=sink)
    assert r.rc == 0 and ". display 2" in r.log


def test_no_on_output_after_the_run(eng):
    got, sink = _sink()
    eng.run("display 1", on_output=sink)
    n = len(got)
    eng.run("display 2")
    assert len(got) == n


# -- error_line -----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("code, line", [
    ("display 1\n\n* a comment\n// another\n\nsummarize nosuch\n", 6),   # comment and blank lines count
    ("display 1\r\n\r\n* c\r\nsummarize nosuch\r\n", 4),   # Windows line ends
    ("/* a\nb\n*/\nsummarize nosuch\n", 4),
    ("display 1\nsummarize x ///\n   nosuch\n", 2),   # a continued command: its first line
    ("#delimit ;\ndisplay 1;\nsummarize\n  nosuch;\n#delimit cr\n", 3),   # a ; command: its first line
    ("display 1\nforeach v in x nosuch {\n  display \"`v'\"\n  summarize `v'\n}\n", 4),   # the body line in a loop
    ("forvalues i = 1/3 {\n  display `i'\n  if `i' == 2 summarize nosuch\n}\n", 3),
    ("if 1 {\n  display 1\n  summarize nosuch\n}\n", 3),
    ("capture program drop pp\nprogram define pp\n  display 1\n  summarize nosuch\nend\ndisplay 2\npp\n", 4),  # body
    ("capture {\n  summarize nosuch\n}\ndisplay 1\nsummarize nosuch2\n", 5),   # a captured error is not the one
    ("display 1\nsummarize nosuch\ndisplay 2\n", 2),
])
def test_error_line(eng, code, line):
    r = eng.run(code)
    assert r.rc == 111 and r.error_line == line


def test_error_line_is_none_for_rc_0_and_inside_a_nested_do_file(eng, tmp_path):
    assert eng.run("display 1").error_line is None
    assert eng.run("capture summarize nosuch").error_line is None
    (tmp_path / "inner.do").write_text("display 1\nsummarize nosuch\n")
    r = eng.run("display 1\ndo inner.do\n")
    assert r.rc == 111 and r.error_line is None
    (tmp_path / "ok.do").write_text("display 1\n")
    r = eng.run("do ok.do\nsummarize nosuch\n")   # after a nested do-file: a line of this code again
    assert r.rc == 111 and r.error_line == 2


@pytest.mark.parametrize("how", ["include", "run", "do"])
def test_error_line_is_none_inside_an_included_or_run_file(eng, tmp_path, how):
    (tmp_path / "inner.do").write_text("display 1\nsummarize nosuch\n")
    r = eng.run(f"display 1\n{how} inner.do\n")
    assert r.rc == 111 and r.error_line is None


def test_error_line_of_a_program_from_an_included_file_is_the_calling_line(eng, tmp_path):
    (tmp_path / "defs.do").write_text("capture program drop pq\nprogram pq\n  summarize nosuch\nend\n")
    r = eng.run("include defs.do\ndisplay 1\npq\n")
    assert r.rc == 111 and r.error_line == 3


def test_error_line_of_a_program_from_an_earlier_run_is_the_calling_line(eng):
    eng.run("capture program drop pp\nprogram pp\n  summarize nosuch\nend")
    r = eng.run("display 1\n\npp\n")
    assert r.rc == 111 and r.error_line == 3


@pytest.fixture
def break_cmds():
    """`dofile_test_break_after`: asks for a Break during the command, taken before the next one; `..._inside`: taken
    inside the command, as a long computation does (brk.check)."""
    from dofile._vendor.opendta.commands.registry import REGISTRY, command
    from dofile._vendor.opendta.core import brk

    @command("dofile_test_break_after")
    def _after(s, args):
        request_break()

    @command("dofile_test_break_inside")
    def _inside(s, args):
        request_break()
        brk.check()
    yield
    clear_break()
    REGISTRY.pop("dofile_test_break_after", None)
    REGISTRY.pop("dofile_test_break_inside", None)


def test_error_line_of_a_break(eng, break_cmds):
    r = eng.run("display 1\ndofile_test_break_inside\ndisplay 2\n")
    assert r.rc == RC_BREAK and r.error_line == 2
    # Break between commands: the line of the command it did not start (where the run stopped)
    r = eng.run("display 1\ndofile_test_break_after\ndisplay 2\n")
    assert r.rc == RC_BREAK and r.error_line == 3 and r.error_command == "display 2"   # echoed above --Break--
    # in a loop: Break between passes is taken at the loop's line
    r = eng.run("display 0\nforvalues i = 1/3 {\n  display `i'\n  if `i' == 2 dofile_test_break_after\n}\n")
    assert r.rc == RC_BREAK and r.error_line == 2


# -- graph_commands ---------------------------------------------------------------------------------------------------

def test_graph_commands_name_the_command_of_each_image(eng):
    r = eng.run("scatter y x\nforeach v in y {\n  line `v' x\n}\ncapture program drop gg\nprogram gg\n  histogram x\n"
                "end\ngg\n#delimit ;\ntwoway scatter y x,\n  title(\"t\");\n#delimit cr\n", images=True)
    assert r.rc == 0 and len(r.images) == 4
    assert r.graph_commands == ["scatter y x", "line `v' x", "gg", 'twoway scatter y x,   title("t")']


def test_graph_commands_line_up_with_the_last_five_images(eng):
    code = "\n".join(f"scatter y x, title(g{i})" for i in range(1, 8))
    r = eng.run(code, images=True)
    assert r.new_graphs == 7 and len(r.images) == 5
    assert r.graph_commands == [f"scatter y x, title(g{i})" for i in range(3, 8)]
    assert r.graph_lines == [3, 4, 5, 6, 7]
    plain = eng.run(code)   # no images asked for
    assert plain.graph_commands == [] and plain.graph_lines == []


def test_graph_commands_skip_a_graph_that_cannot_be_drawn(eng, monkeypatch):
    real = engine_mod._png
    monkeypatch.setattr(engine_mod, "_png", lambda g, theme=None: None if "g2" in str(g.opts) else real(g, theme))
    r = eng.run("scatter y x, title(g1)\nscatter y x, title(g2)\nscatter y x, title(g3)", images=True)
    assert len(r.images) == 2
    assert r.graph_commands == ["scatter y x, title(g1)", "scatter y x, title(g3)"] and r.graph_lines == [1, 3]


def test_graph_lines(eng, tmp_path):
    (tmp_path / "plots.do").write_text("scatter y x\n")
    r = eng.run("scatter y x\n\nscatter y x\nforeach v in a b c {\n  scatter y x\n}\n"   # 1, 3, 5 x 3
                "line y x, ///\n   sort\n"   # 7
                "capture program drop gp\nprogram gp\n  scatter y x\nend\ngp\n"   # 13: the calling line
                "do plots.do\n"   # 14: the do line
                "#delimit ;\nscatter\n  y x;\n#delimit cr\n", images=True)   # 16
    assert r.rc == 0 and r.new_graphs == 9
    assert r.graph_lines == [5, 7, 13, 14, 16]   # the last five
    assert r.graph_commands == ["scatter y x", "line y x,     sort", "gp", "do plots.do", "scatter   y x"]
    r = eng.run("scatter y x\nscatter y x", images=True)   # identical commands: told apart by line
    assert r.graph_lines == [1, 2]


# -- plot_theme ---------------------------------------------------------------------------------------------------------

def _corner(png: bytes) -> float:
    """Brightness (0 to 1) of the top-left pixel."""
    from matplotlib.image import imread
    return float(imread(io.BytesIO(png))[0, 0, :3].mean())


def test_dark_plot_theme_changes_only_the_inline_images(eng, tmp_path):
    dark = eng.run("scatter y x\ngraph export g.png, replace", images=True, plot_theme="dark")
    assert dark.rc == 0 and _corner(dark.images[0]) < 0.3
    assert _corner((tmp_path / "g.png").read_bytes()) > 0.9   # the exported file keeps the default style
    assert _corner(eng.run("scatter y x", images=True).images[0]) > 0.9   # nothing left over for the next run
    assert _corner(eng.run("scatter y x", images=True, plot_theme="light").images[0]) > 0.9
    mono = eng.run("scatter y x, scheme(s1mono)", images=True, plot_theme="dark")   # a chosen scheme is kept
    assert _corner(mono.images[0]) > 0.9


# -- describe_file ------------------------------------------------------------------------------------------------------

def test_describe_file_leaves_data_results_and_log_alone(eng, tmp_path):
    eng.run('clear\nset obs 3\ngen double w = _n\nlabel variable w "weight"\nlabel define yn 0 "no" 1 "yes"\n'
            'gen byte ok = mod(_n, 2)\nlabel values ok yn\nsave other, replace')
    eng.run(DATA + "\nregress y x\nsummarize x")
    before = (eng.session.data, eng.session.data.nobs, dict(eng.session.r), dict(eng.session.e), eng._capture.text)
    d = eng.describe_file("other.dta")
    assert d["nobs"] == 3 and d["nvars"] == 2 and d["filename"] == "other.dta"
    assert d["variables"] == [{"name": "w", "type": "double", "format": "%10.0g", "label": "weight", "value_label": None},
                              {"name": "ok", "type": "byte", "format": "%8.0g", "label": None, "value_label": "yn"}]
    assert eng.describe_file("other") == {**d, "filename": "other"}   # .dta added, as `use` does
    after = (eng.session.data, eng.session.data.nobs, dict(eng.session.r), dict(eng.session.e), eng._capture.text)
    assert after == before
    assert ". summarize x" in eng._capture.text


def test_describe_file_errors(eng, tmp_path):
    (tmp_path / "bad.dta").write_text("not a dta")
    assert "not found" in eng.describe_file("nosuch.dta")["error"]
    assert "not in the working folder" in eng.describe_file("../elsewhere.dta")["error"]
    assert "error" in eng.describe_file("bad.dta")
    for bad in ("", " ", ".", "..", None, 5, "sub/"):
        assert set(eng.describe_file(bad)) == {"error"}, bad


# -- macros ---------------------------------------------------------------------------------------------------------------

def test_macros(eng):
    eng.run("local a 1\nglobal g hello\nglobal S_level 90\ntempvar tv\ntempname tn\ntempfile tf\ngen `tv' = 1\n"
            "capture program drop pp\nprogram pp\n  local inner 3\nend\npp\nforvalues i = 1/2 {\n}\n")
    m = eng.macros()
    assert m["locals"] == {"a": "1", "i": "2"}   # no program's locals; no temporary names
    assert m["globals"]["g"] == "hello" and m["globals"]["S_level"] == "90"
    assert "S_ADO" in m["system_globals"] and "g" not in m["system_globals"]
    assert "S_level" not in m["system_globals"]   # changed by the user
    assert set(m["system_globals"]) <= set(m["globals"])
    # values that only look like temporary names (one the user types equal to a live tempname's is left out)
    eng.run("local b __0000FF\nlocal w __weight\nlocal c __00000A")
    assert {"b": "__0000FF", "w": "__weight", "c": "__00000A"}.items() <= eng.macros()["locals"].items()
    eng.run("tempvar t2")   # a later run's tempvar is left out too, and the earlier ones stay out
    assert set(eng.macros()["locals"]) == {"a", "i", "b", "w", "c"}


# -- data_rows --------------------------------------------------------------------------------------------------------

def test_data_rows_as_list_prints_them(eng):
    eng.run('clear\nset obs 4\ngen x = _n * 1.5\nformat x %9.2f\nreplace x = . in 2\nreplace x = .a in 3\n'
            'gen s = "s" + string(_n)\nlabel define yn 0 "no" 1 "yes"\ngen byte ok = mod(_n, 2)\nlabel values ok yn\n'
            'gen xx = 7')
    r = eng.data_rows()
    assert r == {"nobs": 4, "offset": 0, "vars": ["x", "s", "ok", "xx"], "more": 0,
                 "rows": [["1.50", "s1", "yes", "7"], [".", "s2", "no", "7"], [".a", "s3", "yes", "7"],
                          ["6.00", "s4", "no", "7"]]}
    page = eng.data_rows("x*", offset=1, limit=2)
    assert page == {"nobs": 4, "offset": 1, "vars": ["x", "xx"], "more": 1, "rows": [[".", "7"], [".a", "7"]]}
    assert eng.data_rows(offset=10)["rows"] == [] and eng.data_rows(offset=10)["more"] == 0
    assert "error" in eng.data_rows("nosuch")


# -- memory -------------------------------------------------------------------------------------------------------------

def test_memory_is_the_size_of_the_data(eng):
    eng.run("clear\nset obs 10\ngen double a = 1\ngen float b = 1\ngen byte c = 1")
    assert eng.memory() == {"data_bytes": 10 * (8 + 4 + 1)}
    eng.run("clear")
    assert eng.memory() == {"data_bytes": 0}


# -- the tempfile hint ----------------------------------------------------------------------------------------------

def test_the_tempfile_hint_is_a_parameter(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    e = Engine(tmp_path, tempfile_hint="our own words")
    e.run(DATA + "\ntempfile t\nsave `t'")
    r = e.run("use `t', clear")
    assert r.rc == 601 and "(our own words)" in r.log and r.error.endswith("(our own words)")
    assert TEMPFILE_HINT not in r.log
    assert "run_do" in TEMPFILE_HINT   # the default is still the MCP wording


# -- under the sandbox ------------------------------------------------------------------------------------------------

SANDBOXED = """
import json, sys
from dofile import sandbox
sandbox.install(sys.argv[1], ())
from dofile.engine import Engine
e = Engine()
got = []
r = e.run('clear\\nset obs 3\\ngen x = _n\\nsave d\\nscatter x x', images=True, plot_theme='dark', on_output=got.append)
print(json.dumps({"rc": r.rc, "images": len(r.images), "graph_commands": r.graph_commands, "same": "".join(got) == r.log,
                  "file": e.describe_file("d.dta"), "outside": e.describe_file("../x.dta"),
                  "etc": e.describe_file("/etc/hosts"), "rows": e.data_rows(), "memory": e.memory()}))
"""


def test_the_new_calls_under_the_sandbox(tmp_path):
    import json
    import subprocess
    import sys
    work = tmp_path / "work"
    work.mkdir()
    (tmp_path / "x.dta").write_bytes(b"")
    p = subprocess.run([sys.executable, "-I", "-c", SANDBOXED, str(work)], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr[-3000:]
    r = json.loads(p.stdout.splitlines()[-1])
    assert r["rc"] == 0 and r["images"] == 1 and r["graph_commands"] == ["scatter x x"] and r["same"]
    assert r["file"]["nobs"] == 3
    assert "not in the working folder" in r["outside"]["error"] and "not in the working folder" in r["etc"]["error"]
    assert r["rows"]["rows"] == [["1"], ["2"], ["3"]] and r["memory"] == {"data_bytes": 12}
