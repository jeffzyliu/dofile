"""Sandbox tests. The audit hook cannot be removed, so every case runs in a fresh subprocess."""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from test_conformance import HERE, KNOWN_GAPS, PROBE_GAPS, REF

RUNNER = """
import json, sys
work, read_dirs, scripts = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
from dofile import sandbox
sandbox.install(work, tuple(read_dirs))
from dofile.engine import Engine
out = []
for code in scripts:
    r = Engine().run(code)
    out.append({"rc": r.rc, "error": r.error, "log": r.log})
print(json.dumps(out))
"""


def sandboxed(work: Path, *scripts: str, read_dirs: tuple[str, ...] = (), prelude: str = "") -> list[dict]:
    p = subprocess.run(
        [sys.executable, "-I", "-c", prelude + RUNNER, str(work), json.dumps(read_dirs), json.dumps(scripts)],
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert p.returncode == 0, p.stderr[-3000:]
    return json.loads(p.stdout.splitlines()[-1])


@pytest.fixture
def work(tmp_path):
    w = tmp_path / "work"
    w.mkdir()
    for f in (HERE / "data").glob("*.dta"):
        shutil.copy(f, w)
    return w


def test_corpus_and_probes_still_work_under_sandbox(work):
    corpus = sorted((HERE / "corpus").glob("*.do"))
    probes = sorted((HERE / "probe").glob("*.do"))
    results = sandboxed(work, *(f.read_text() for f in corpus + probes))
    checks = {}
    for r in results[: len(corpus)]:
        checks.update(re.findall(r"^CHECK (\w+)=\s*(\S+)", r["log"], re.M))
    bad = [
        k
        for k, ref in REF.items()
        if k not in KNOWN_GAPS and not (k in checks and abs(float(checks[k]) - ref) <= max(1e-6 * abs(ref), 1e-12))
    ]
    assert bad == []
    failed = [p.name for p, r in zip(probes, results[len(corpus) :]) if r["rc"] != 0 and p.name not in PROBE_GAPS]
    assert failed == []
    assert (work / "scat.png").exists() and (work / "hist.png").exists()


@pytest.mark.parametrize(
    "cmd",
    [
        "shell echo pwned",
        "!echo pwned",
        "sh echo pwned",
        "erase panel.dta",
        "rm panel.dta",
        "rmdir sub",
        "mkdir sub",
        "cd ..",
        "copy panel.dta other.dta",
        "webuse auto",
    ],
)
def test_denied_commands_return_rc_199(work, cmd):
    (r,) = sandboxed(work, cmd)
    assert r["rc"] == 199
    assert "disabled in the dofile sandbox" in r["error"]
    assert "pwned" not in r["log"].replace(cmd, "")
    assert (work / "panel.dta").exists()


@pytest.mark.parametrize(
    "code,outside,reason_shown",
    [
        ("use panel, clear\nsave ../escaped.dta", "escaped.dta", True),
        ("use panel, clear\nexport delimited using ../escaped.csv", "escaped.csv", True),
        ("log using ../escaped.log, text", "escaped.log", True),
        # graph export prints OpenDTA's own 603 message; Engine.run adds the sandbox's reason (ERG-5)
        ("use panel, clear\nscatter y x1\ngraph export ../escaped.png", "escaped.png", True),
    ],
)
def test_writes_outside_workdir_are_blocked(work, code, outside, reason_shown):
    (r,) = sandboxed(work, code)
    assert r["rc"] == 603
    assert ("dofile sandbox" in r["log"]) == reason_shown  # the agent is told why where possible
    assert not (work.parent / outside).exists()


def test_missing_folder_is_not_blamed_on_the_sandbox(work):
    """ERG-5: rc 603 for a folder that doesn't exist says nothing about the sandbox, so the two can be told apart."""
    (r,) = sandboxed(work, "use panel, clear\nscatter y x1\ngraph export nofolder/x.png")
    assert r["rc"] == 603 and "dofile sandbox" not in r["log"] and "dofile sandbox" not in r["error"]


def test_a_refusal_is_told_apart_from_a_missing_folder_inside_capture(work):
    """ERG-5: `capture` swallows the error and the call ends rc 0, but the log still says which export the sandbox refused."""
    (r,) = sandboxed(
        work,
        "use panel, clear\nscatter y x1\n"
        'capture noisily graph export ../escaped.png\ndisplay "refused rc=" _rc\n'
        'capture noisily graph export nofolder/x.png\ndisplay "missing rc=" _rc',
    )
    log = r["log"].split("\n")
    assert r["rc"] == 0 and "refused rc=603" in log and "missing rc=603" in log
    k = log.index("file ../escaped.png could not be opened")
    assert log[k + 1].startswith("dofile sandbox: cannot write") and log[k + 1].endswith("escaped.png")
    j = log.index("file nofolder/x.png could not be opened")
    assert not log[j + 1].startswith("dofile sandbox") and "dofile sandbox" not in "\n".join(log[j:])


def test_reads_outside_allowed_dirs_are_blocked(work, tmp_path):
    secret = tmp_path / "secret.csv"
    secret.write_text("token\nTOP-SECRET-VALUE\n")
    (r,) = sandboxed(work, f'import delimited using "{secret}", clear\nlist')
    assert r["rc"] != 0
    assert "TOP-SECRET-VALUE" not in r["log"]


def test_folders_on_sys_path_are_not_readable(work, tmp_path):
    # `python -m` puts the launch folder first on sys.path (PYTHONPATH adds more); that must not open it up
    launch = tmp_path / "launch"
    launch.mkdir()
    (launch / "secret.csv").write_text("token\nTOP-SECRET-VALUE\n")
    (r,) = sandboxed(
        work,
        f'import delimited using "{launch / "secret.csv"}", clear\nlist',
        prelude=f"import sys; sys.path.insert(0, {str(launch)!r})\n",
    )
    assert r["rc"] == 603 and "TOP-SECRET-VALUE" not in r["log"]


def test_read_dirs_are_readable_and_workdir_is_writable(work, tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    shutil.copy(HERE / "data" / "panel.dta", data / "shared.dta")
    (r,) = sandboxed(
        work, f'use "{data / "shared.dta"}", clear\nsave mine.dta\nsave "{data / "nope.dta"}"', read_dirs=(str(data),)
    )
    assert (work / "mine.dta").exists()  # write inside the workdir works
    assert not (data / "nope.dta").exists() and r["rc"] != 0  # read dirs are read-only


@pytest.mark.parametrize(
    "code",
    ['import delimited using "https://example.com/data.csv", clear', 'use "https://example.com/data.dta", clear'],
)
def test_urls_are_local_paths(work, code):
    """OpenDTA has no URL support in use/import; only webuse and copy fetch, and both are denied."""
    (r,) = sandboxed(work, code)
    assert r["rc"] == 601


HOOK_PROBE = """
import json, socket, subprocess, sys
from dofile import sandbox
sandbox.install(sys.argv[1])
out = {}
for name, fn in [("dns", lambda: socket.getaddrinfo("example.com", 443)),
                 ("connect", lambda: socket.create_connection(("127.0.0.1", 9), timeout=1)),
                 ("subprocess", lambda: subprocess.run(["true"]))]:
    try:
        fn(); out[name] = "allowed"
    except PermissionError as e:
        out[name] = str(e)
print(json.dumps(out))
"""


def test_hook_blocks_network_and_subprocess(work):
    p = subprocess.run([sys.executable, "-I", "-c", HOOK_PROBE, str(work)], capture_output=True, text=True, timeout=60)
    out = json.loads(p.stdout)
    assert all("dofile sandbox" in v for v in out.values()), out


def test_capture_catches_a_sandbox_refusal_like_any_file_error(work):
    r = sandboxed(
        work, 'capture type /etc/passwd\ndisplay "after rc=" _rc\ncapture noisily type /etc/passwd\ndisplay "again"'
    )[0]
    assert r["rc"] == 0 and "after rc=603" in r["log"] and "again" in r["log"]
