"""dofile.browser, the web demo's Python side, run in CPython. start() changes the command registry and the SIGINT
handler for the whole process, so each case runs in a fresh subprocess. The Pyodide side: web/test/."""

import json
import subprocess
import sys

PRELUDE = """
import json, os, sys, threading
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
threading.Timer(1.0, os.kill, (os.getpid(), 2)).start()   # the Break button: SIGINT, as Pyodide's interrupt buffer
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
os.kill(os.getpid(), 2)   # handled at once, while no run is going on
print(browser.run('display 1'))
""",
    )
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
