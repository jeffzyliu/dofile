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
    p = subprocess.run([sys.executable, "-I", "-c", PRELUDE + script, str(root)], capture_output=True, text=True,
                       timeout=60)
    assert p.returncode == 0, p.stderr
    return [json.loads(line) for line in p.stdout.splitlines()]


def test_run_returns_json_with_results_and_images(tmp_path):
    about, r = browser(tmp_path, """
print(browser.run('clear\\nset obs 20\\ngen x = _n\\ngen y = 2*x + mod(_n, 3)\\nregress y x\\nscatter y x\\nsave d'))
""")
    assert "dofile" in about and "opendta" in json.dumps(about).lower()
    assert r["rc"] == 0 and r["nobs"] == 20 and r["nvars"] == 2
    assert r["results"]["e"]["scalars"]["N"] == 20
    assert r["results"]["e"]["matrices"]["V"] == "2x2"   # values through matrix()
    assert len(r["images"]) == 1 and r["images"][0].startswith("iVBOR")   # base64 of a PNG
    assert (tmp_path / "d.dta").exists()


def test_describe_matrix_and_errors(tmp_path):
    _, d, m, bad = browser(tmp_path, """
browser.run('clear\\nset obs 5\\ngen x = _n\\ngen y = x^2\\nregress y x')
print(browser.describe())
print(browser.matrix('e(b)'))
print(browser.run('regress nosuchvar x'))
""")
    assert [v["name"] for v in d["variables"]] == ["x", "y"]
    assert m["cols"] == ["x", "_cons"]
    assert bad["rc"] == 111 and bad["error_command"] == "regress nosuchvar x"


def test_only_shell_and_webuse_are_denied_and_paths_are_mapped(tmp_path):
    (tmp_path / "data").mkdir()
    _, shell, webuse, files = browser(tmp_path, r"""
print(browser.run('shell ls'))
print(browser.run('webuse auto'))
print(browser.run('clear\nset obs 2\ngen x = 1\nsave data/d\nmkdir out\ncd "C:\\Users\\me\\proj\\data"\n'
                  'use "C:\\Users\\me\\proj\\data\\d", clear\ncd ..\nerase data/d.dta'))
""")
    assert shell["rc"] == 199 and webuse["rc"] == 199
    assert files["rc"] == 0, files["log"]
    assert "in the working folder)" in files["log"]
    assert (tmp_path / "out").is_dir() and not (tmp_path / "data" / "d.dta").exists()


def test_break_stops_at_a_safe_point_and_keeps_the_data(tmp_path):
    _, _, broke, after, later = browser(tmp_path, """
print(browser.run('clear\\nset obs 100\\ngen x = 0'))
threading.Timer(1.0, os.kill, (os.getpid(), 2)).start()   # the Break button: SIGINT, as Pyodide's interrupt buffer
print(browser.run('while 1 {\\n quietly replace x = x + 1\\n}'))
print(browser.run('summarize x'))
threading.Event().wait(0.1)
print(browser.run('display 1'))
""")
    assert broke["rc"] == 1 and "--Break--" in broke["log"]
    assert after["rc"] == 0 and after["nobs"] == 100
    assert later["rc"] == 0


def test_a_break_between_runs_does_not_stop_the_next_one(tmp_path):
    _, r = browser(tmp_path, """
os.kill(os.getpid(), 2)   # handled at once, while no run is going on
print(browser.run('display 1'))
""")
    assert r["rc"] == 0


def test_the_web_highlighters_command_list_matches_the_engine():
    """web/src/stata/commands.json is generated from the registry (`cd web && npm run commands`); a re-vendor that
    adds or renames commands must regenerate it."""
    from pathlib import Path
    from dofile._vendor.opendta.session import Session  # noqa: F401  (registers all commands)
    from dofile._vendor.opendta.commands.registry import REGISTRY
    saved = json.loads((Path(__file__).parent.parent / "web" / "src" / "stata" / "commands.json").read_text())
    assert saved["commands"] == {k: v.min_abbrev for k, v in REGISTRY.items()}
    assert saved["prefixes"] == sorted(k for k, v in REGISTRY.items() if v.prefix)
