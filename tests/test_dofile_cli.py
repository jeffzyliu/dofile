import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent / "conformance"


def dofile(*args, cwd):
    return subprocess.run(
        [sys.executable, "-m", "dofile.cli", *map(str, args)],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def test_run_success_writes_log_and_json(tmp_path):
    shutil.copy(HERE / "data" / "cps.dta", tmp_path)
    p = dofile("run", HERE / "corpus" / "03_regress.do", "--json", "out.json", cwd=tmp_path)
    assert p.returncode == 0, p.stdout[-2000:]
    assert "CHECK ols_b_yrsed=" in p.stdout and "end of do-file" in p.stdout
    out = json.loads((tmp_path / "out.json").read_text())
    assert out["rc"] == 0 and out["results"]["e"]["macros"]["cmd"] == "regress"


def test_run_error_exits_1_and_sandbox_blocks_shell(tmp_path):
    (tmp_path / "bad.do").write_text("display 1\nshell echo hi\n")
    p = dofile("run", "bad.do", "--json", "out.json", cwd=tmp_path)
    assert p.returncode == 1
    out = json.loads((tmp_path / "out.json").read_text())
    assert out["rc"] == 199 and "sandbox" in out["error"]  # the error itself, not the do wrapper's "end of do-file"


def test_error_message_inside_nested_do_files(tmp_path):
    (tmp_path / "main.do").write_text(f'do "{tmp_path / "inner.do"}"\n')
    (tmp_path / "inner.do").write_text("use nosuch, clear\n")
    dofile("run", "main.do", "--json", "out.json", cwd=tmp_path)
    out = json.loads((tmp_path / "out.json").read_text())
    assert out["rc"] == 601 and "nosuch" in out["error"] and out["error_command"] == "use nosuch, clear"


def test_unsafe_allows_shell(tmp_path):
    (tmp_path / "ok.do").write_text("shell echo unsafe-ok\n")
    p = dofile("run", "ok.do", "--unsafe", cwd=tmp_path)
    assert p.returncode == 0 and "unsafe-ok" in p.stdout


def test_nested_do_next_to_the_file_works(tmp_path):
    pkg = tmp_path / "package"
    pkg.mkdir()
    (pkg / "main.do").write_text(f'do "{pkg / "step.do"}"\ndisplay "after"\n')
    (pkg / "step.do").write_text('display "inside step"\n')
    p = dofile("run", pkg / "main.do", cwd=tmp_path)
    assert p.returncode == 0 and "inside step" in p.stdout and "after" in p.stdout


def test_json_outside_the_workdir_is_written(tmp_path):
    work, out = tmp_path / "work", tmp_path / "out"
    work.mkdir(), out.mkdir()
    (work / "t.do").write_text("display 1\n")
    p = dofile("run", "t.do", "--json", out / "o.json", cwd=work)
    assert p.returncode == 0, p.stderr[-2000:]
    assert json.loads((out / "o.json").read_text())["rc"] == 0


def test_dollar_and_backquote_in_the_path_are_not_macros(tmp_path):
    for folder in ("proj$v1", "q`x'y"):  # Stata would expand $v1 and `x' if the path went into code as text
        d = tmp_path / folder
        d.mkdir()
        (d / "a.do").write_text('display "ran"\n')
        p = dofile("run", d / "a.do", cwd=tmp_path)
        assert p.returncode == 0 and "ran" in p.stdout, p.stdout[-1500:]
        assert p.stdout.startswith(f'. do "{d / "a.do"}"')
