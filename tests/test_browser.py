"""dofile.browser, the web demo's Python side, run in CPython. start() changes the command registry and the SIGINT
handler for the whole process, so each case runs in a fresh subprocess. The Pyodide side: web/test/."""

import json
import subprocess
import sys

PRELUDE = """
import json, os, signal, sys, threading
from dofile import browser
print(browser.start(sys.argv[1]))
"""


def browser(root, script: str) -> list:
    """Run `script` after browser.start(root); each line it prints is one JSON value."""
    p = subprocess.run(
        [sys.executable, "-I", "-c", PRELUDE + script, str(root)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert p.returncode == 0, p.stderr
    return [json.loads(line) for line in p.stdout.splitlines()]


def test_run_returns_json_with_results_and_images(tmp_path):
    about, r = browser(
        tmp_path,
        """
print(browser.run('clear\\nset obs 20\\ngen x = _n\\ngen y = 2*x + mod(_n, 3)\\nregress y x\\nscatter y x\\nsave d'))
""",
    )
    assert "dofile" in about and "opendta" in json.dumps(about).lower()
    assert r["rc"] == 0 and r["nobs"] == 20 and r["nvars"] == 2
    assert r["results"]["e"]["scalars"]["N"] == 20
    assert r["results"]["e"]["matrices"]["V"] == "2x2"  # values through matrix()
    assert len(r["images"]) == 1 and r["images"][0].startswith("iVBOR")  # base64 of a PNG
    assert (tmp_path / "d.dta").exists()


def test_describe_matrix_and_errors(tmp_path):
    _, d, m, bad = browser(
        tmp_path,
        """
browser.run('clear\\nset obs 5\\ngen x = _n\\ngen y = x^2\\nregress y x')
print(browser.describe())
print(browser.matrix('e(b)'))
print(browser.run('regress nosuchvar x'))
""",
    )
    assert [v["name"] for v in d["variables"]] == ["x", "y"]
    assert m["cols"] == ["x", "_cons"]
    assert bad["rc"] == 111 and bad["error_command"] == "regress nosuchvar x"


def test_run_options_and_new_fields(tmp_path):
    _, first, again, kept, bad, graphs, chunks = browser(
        tmp_path,
        r"""
code = 'display "x=[`x\']"\nlocal x 1\nclear\nset obs 3\ngen y = _n'
print(browser.run(code, fresh_locals=True))
print(browser.run(code, True, True))
print(browser.run(code))
print(browser.run('display 1\n\nsummarize nosuch'))
print(browser.run('scatter y y\nline y y', plot_theme='dark'))
got = []
browser.run('display 1\ndisplay 2', True, False, None, got.append)
print(json.dumps(got))
""",
    )
    assert "x=[]" in first["log"] and "x=[]" in again["log"] and "x=[1]" in kept["log"]
    assert first["error_line"] is None and first["graph_commands"] == []
    assert bad["rc"] == 111 and bad["error_line"] == 3
    assert graphs["graph_commands"] == ["scatter y y", "line y y"] and len(graphs["images"]) == 2
    assert graphs["graph_lines"] == [1, 2]
    assert "".join(chunks).startswith(". display 1")


def test_run_ignores_js_null_options(tmp_path):
    """From the worker, a JS null arrives as a non-callable, non-string object: it means the default."""
    _, r = browser(
        tmp_path,
        """
class JsNull:
    def __bool__(self): return False
print(browser.run('display 1', True, JsNull(), JsNull(), JsNull()))
""",
    )
    assert r["rc"] == 0


def test_describe_file_macros_browse_memory(tmp_path):
    _, d, missing, m, rows, page, bad, mem = browser(
        tmp_path,
        r"""
browser.run('clear\nset obs 3\ngen double w = _n\nsave other\nclear\nset obs 2\ngen x = _n\nglobal g 1\nlocal l 2')
print(browser.describe_file('other.dta'))
print(browser.describe_file('nosuch.dta'))
print(browser.macros())
print(browser.browse())
print(browser.browse('x', 1, 5))
print(browser.browse('nosuch'))
print(browser.memory())
""",
    )
    assert d["nobs"] == 3 and [v["name"] for v in d["variables"]] == ["w"]
    assert "not found" in missing["error"]
    assert m["locals"] == {"l": "2"} and m["globals"]["g"] == "1" and "S_ADO" in m["system_globals"]
    assert rows == {"nobs": 2, "offset": 0, "vars": ["x"], "more": 0, "rows": [["1"], ["2"]]}
    assert page["rows"] == [["2"]] and "error" in bad
    assert mem == {"data_bytes": 8}


def test_the_page_has_its_own_tempfile_note_and_a_log_cap(tmp_path):
    from dofile.engine import LOG_KEEP

    _, _, r, big = browser(
        tmp_path,
        r"""
print(browser.run('clear\nset obs 1\ngen x = 1\ntempfile t\nsave `t\''))
print(browser.run('use `t\', clear'))
print(browser.run('forvalues i = 1/30000 {\n  display _dup(100) "x"\n}'))
""",
    )
    assert (
        r["rc"] == 601 and "run_do" not in r["log"] and "MCP" not in r["log"] and "tempfile lasts one run" in r["log"]
    )
    assert "characters of output omitted" in big["log"] and len(big["log"]) < 2 * LOG_KEEP + 200


def test_only_shell_and_webuse_are_denied_and_paths_are_mapped(tmp_path):
    (tmp_path / "data").mkdir()
    _, shell, webuse, files = browser(
        tmp_path,
        r"""
print(browser.run('shell ls'))
print(browser.run('webuse auto'))
print(browser.run('clear\nset obs 2\ngen x = 1\nsave data/d\nmkdir out\ncd "C:\\Users\\me\\proj\\data"\n'
                  'use "C:\\Users\\me\\proj\\data\\d", clear\ncd ..\nerase data/d.dta'))
""",
    )
    assert shell["rc"] == 199 and webuse["rc"] == 199
    assert files["rc"] == 0, files["log"]
    assert "in the working folder)" in files["log"]
    assert (tmp_path / "out").is_dir() and not (tmp_path / "data" / "d.dta").exists()


def test_break_stops_at_a_safe_point_and_keeps_the_data(tmp_path):
    _, _, broke, after, later = browser(
        tmp_path,
        """
print(browser.run('clear\\nset obs 100\\ngen x = 0'))
threading.Timer(1.0, signal.raise_signal, (signal.SIGINT,)).start()   # the Break button: SIGINT, as Pyodide's interrupt buffer
print(browser.run('while 1 {\\n quietly replace x = x + 1\\n}'))
print(browser.run('summarize x'))
threading.Event().wait(0.1)
print(browser.run('display 1'))
""",
    )
    assert broke["rc"] == 1 and "--Break--" in broke["log"]
    assert after["rc"] == 0 and after["nobs"] == 100
    assert later["rc"] == 0


def test_a_break_between_runs_does_not_stop_the_next_one(tmp_path):
    _, r = browser(
        tmp_path,
        """
signal.raise_signal(signal.SIGINT)   # handled at once, while no run is going on
print(browser.run('display 1'))
""",
    )
    assert r["rc"] == 0


def test_a_break_before_the_run_is_busy_is_put_back_and_the_run_takes_it(tmp_path):
    _, put_back, r = browser(
        tmp_path,
        """
put_back = []
def again():  # Pyodide's buffer: SIGINT is there again, and Python reads it a little later
    put_back.append(1)
    threading.Timer(0.3, signal.raise_signal, (signal.SIGINT,)).start()
browser.keep_breaks(again)
hold = browser._hold_ballast
def prologue():  # SIGINT read at the top of run(), before it is busy
    signal.raise_signal(signal.SIGINT)
    hold()
browser._hold_ballast = prologue
r = browser.run('while 1 {\\n}')
print(len(put_back))
print(r)
""",
    )
    assert put_back == 1
    assert r["rc"] == 1 and "--Break--" in r["log"]


def test_a_break_outside_a_run_is_put_back_and_stops_nothing_by_itself(tmp_path):
    _, put_back, ended, r = browser(
        tmp_path,
        """
put_back = []
browser.keep_breaks(lambda: put_back.append(1))
signal.raise_signal(signal.SIGINT)   # between runs (a describe, say)
sizes = browser.matrix_sizes
def epilogue(results):  # after the run is no longer busy
    signal.raise_signal(signal.SIGINT)
    return sizes(results)
browser.matrix_sizes = epilogue
ended = browser.run('display 1')
browser.matrix_sizes = sizes
print(len(put_back))
print(ended)
print(browser.run('display 1'))   # the page clears the buffer when it sends a run: Python stops no run on its own
""",
    )
    assert put_back == 2
    assert ended["rc"] == 0
    assert r["rc"] == 0


def test_the_web_highlighters_command_list_matches_the_engine():
    """web/src/stata/commands.json is generated from the registry (`cd web && npm run commands`); a re-vendor that
    adds or renames commands must regenerate it."""
    from pathlib import Path

    import pytest

    from dofile._vendor.opendta.commands.registry import REGISTRY
    from dofile._vendor.opendta.session import Session  # noqa: F401  (registers all commands)

    path = Path(__file__).parent.parent / "web" / "src" / "stata" / "commands.json"
    if not path.exists():  # not in an sdist: the web demo's folder is left out of it (pyproject.toml)
        pytest.skip("web/src/stata/commands.json is not in this checkout")
    saved = json.loads(path.read_text())
    assert saved["commands"] == {k: v.min_abbrev for k, v in REGISTRY.items()}
    assert saved["prefixes"] == sorted(k for k, v in REGISTRY.items() if v.prefix)


def test_the_ballast_is_freed_after_out_of_memory_and_taken_again_by_the_next_run(tmp_path):
    """The engine's own MemoryError is r(909) (ODT-28); the web test (web/test/engine.test.ts, "a heap cap") makes a real one.
    Here the run's result says 909, which is what the ballast logic reads."""
    _, kept, held, taken_again, later = browser(
        tmp_path,
        r"""
import dataclasses
print(json.dumps(browser._ballast is not None))           # taken at start
real = browser._eng.run
def nomem(*a, **k):
    return dataclasses.replace(real(*a, **k), rc=909, error="op. sys. refuses to provide memory")
browser._eng.run = nomem
r = json.loads(browser.run('display 1'))
print(json.dumps([r["rc"], r["error"], browser._ballast is None]))   # freed, and the result still came back
browser._eng.run = real
r = json.loads(browser.run('display 2'))
print(json.dumps([r["rc"], browser._ballast is not None]))          # the next run takes it again
print(json.dumps(json.loads(browser.run('display 3'))["rc"]))
""",
    )
    assert kept is True  # taken at start
    assert held == [909, "op. sys. refuses to provide memory", True]
    assert taken_again == [0, True]
    assert later == 0


def test_a_memory_error_outside_a_command_frees_the_ballast_and_is_r909(tmp_path):
    """The heap fills in the interpreter's own work (a loop between its commands), not in a command: the engine frees the
    ballast (browser.start hooks it) before it writes the error, and answers r(909), not rc 9999 or an escape."""
    _, r, kept, later = browser(
        tmp_path,
        r"""
browser.run('clear\nset obs 7\ngen x = _n')
def full(*a, **k):
    assert browser._ballast is not None   # still held when the MemoryError is raised
    raise MemoryError
real = browser._eng.session.run
browser._eng.session.run = full
r = json.loads(browser.run('display 1'))
print(json.dumps([r["rc"], r["error"], r["log"], r["nobs"], r["nvars"], browser._ballast is None]))
browser._eng.session.run = real
print(json.dumps(json.loads(browser.run('summarize x'))["nobs"]))
r = json.loads(browser.run('display 2'))
print(json.dumps([r["rc"], browser._ballast is not None]))
""",
    )
    assert r == [909, "op. sys. refuses to provide memory", "op. sys. refuses to provide memory\nr(909);\n", 7, 1, True]
    assert kept == 7  # the data is as it was
    assert later == [0, True]  # the next run is fine and takes the ballast again


def test_a_memory_error_that_escapes_the_engine_frees_the_ballast_and_is_r909(tmp_path):
    """The heap filled again while the engine reported it: the MemoryError reaches run(), which frees the ballast first."""
    _, r, freed, kept, later = browser(
        tmp_path,
        r"""
browser.run('clear\nset obs 7\ngen x = _n')
def full(*a, **k):
    raise MemoryError
real = browser._eng.run
browser._eng.run = full
r = json.loads(browser.run('display 1'))
print(json.dumps([r["rc"], r["error"], r["log"], r["nobs"], r["nvars"], browser._ballast is None]))
browser._eng.run = real
print(json.dumps(browser._ballast is None))
print(json.dumps(json.loads(browser.run('summarize x'))["nobs"]))
r = json.loads(browser.run('display 2'))
print(json.dumps([r["rc"], browser._ballast is not None]))
""",
    )
    assert r == [909, "op. sys. refuses to provide memory", "op. sys. refuses to provide memory\nr(909);\n", 7, 1, True]
    assert freed is True  # still freed until the next run starts
    assert kept == 7  # the data is as it was
    assert later == [0, True]


LAZY = """
answers = {answers!r}
def wait(ms):
    return answers.pop(0) if answers else ""
browser.lazy_graphics(wait)
r = json.loads(browser.run('clear\\nset obs 3\\ngen x = _n\\nscatter x x'))
print(json.dumps([r["rc"], len(r["images"]), r["nobs"], r["log"]]))
print(json.dumps(json.loads(browser.run('display 1'))["rc"]))
"""


def test_lazy_graphics_a_graph_waits_for_the_part_and_a_break_or_a_failure_stops_only_it(tmp_path):
    """A lazy snapshot (web/src/engine/worker.ts, waitGraphics): the graph waits ("pending") until the files are written
    (""); a Break while waiting is the engine's Break (rc 1, data kept); a part that cannot be had is r(199) with why."""
    _, (rc, images, nobs, log), after = browser(tmp_path, LAZY.format(answers=["pending", "pending", ""]))
    assert (rc, images, nobs, after) == (0, 1, 3, 0)
    assert log.count("(waiting for the graphics files to download)") == 1
    _, (rc, images, nobs, log), after = browser(tmp_path, LAZY.format(answers=["pending", "break"]))
    assert (rc, images, nobs, after) == (1, 0, 3, 0)
    assert "--Break--" in log
    _, (rc, images, nobs, log), after = browser(tmp_path, LAZY.format(answers=["offline (Failed to fetch)"]))
    assert (rc, images, nobs, after) == (199, 0, 3, 0)
    assert "graphs are not available: offline (Failed to fetch)" in log


FLUSH = """
import time
sent, seen = [], []
def wait(ms):
    seen.append("".join(sent))  # what the page had when the graph began its (long) wait
    time.sleep(0.2)
    return ""
browser.lazy_graphics(wait)
code = 'clear\\nset obs 3\\ngen x = _n\\nforvalues i = 1/2 {\\n    display "line `i\\'"\\n    if `i\\' == 2 scatter x x\\n}'
r = json.loads(browser.run(code, on_output=sent.append))
print(json.dumps([r["rc"], len(r["images"]), seen[0]]))
"""


def test_lazy_graphics_the_log_so_far_reaches_the_page_before_a_graph_waits(tmp_path):
    """A graph inside a loop waits for the graphics part (one wait can take seconds): the lines the run printed just
    before it are sent first, not held for STREAM_EVERY until the graph is done."""
    _, (rc, images, seen) = browser(tmp_path, FLUSH)
    assert (rc, images) == (0, 1)
    assert "line 1\n" in seen
    assert "line 2\n" in seen
