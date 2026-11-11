"""The web demo's path shim (dofile.pathshim + PATCH-3): file names written for someone's computer resolve in the
working folder. Each file command runs with a Windows and a POSIX foreign prefix, so a command that misses the hook
fails here; a per-file count of `expanduser` (EXPANDUSER) catches a path site a re-vendor adds."""

import os
from pathlib import Path

import pytest

from dofile import pathshim
from dofile.engine import Engine

PREFIXES = {"windows": r"C:\Users\alice\proj", "posix": "/nonexistent/alice/proj"}


@pytest.fixture
def shim(tmp_path):
    for d in ("data", "out", "code"):
        (tmp_path / d).mkdir()
    (tmp_path / "code" / "sub.do").write_text("display 40 + 2\n")
    eng = Engine(tmp_path)
    assert eng.run("clear\nset obs 3\ngen x = _n\ngen y = 2*x\nsave data/d").rc == 0
    pathshim.install(str(tmp_path), lambda m: eng.session.output.write(m + "\n", "text"))
    yield eng, tmp_path
    pathshim.uninstall()
    os.chdir(tmp_path)


# (code with {P} for the foreign prefix, a file that must exist afterwards or None, text the log must contain)
CASES = {
    "use": ("use {P}/data/d, clear\ndisplay _N", None, "\n3\n"),
    "use quoted backslashes": ('use "{P}\\data\\d.dta", clear\ndisplay _N', None, "\n3\n"),
    "save new in subfolder": ("use data/d, clear\nsave {P}/out/clean", "out/clean.dta", None),
    "save new at top": ("use data/d, clear\nsave {P}/new.dta", "new.dta", None),
    "append": ("use data/d, clear\nappend using {P}/data/d\ndisplay _N", None, "\n6\n"),
    "merge": ("use data/d, clear\nmerge 1:1 x using {P}/data/d\ndisplay _N", None, "\n3\n"),
    "describe using": ("describe using {P}/data/d", None, "obs"),
    "export/import delimited": (
        (
            "use data/d, clear\nexport delimited using {P}/out/x.csv, replace\n"
            "import delimited using {P}/out/x.csv, clear\ndisplay _N"
        ),
        "out/x.csv",
        "\n3\n",
    ),
    "export/import excel": (
        (
            "use data/d, clear\nexport excel using {P}/out/x.xlsx, replace firstrow(variables)\n"
            "import excel using {P}/out/x.xlsx, clear firstrow\ndisplay _N"
        ),
        "out/x.xlsx",
        "\n3\n",
    ),
    "outfile/infile": (
        "use data/d, clear\noutfile x y using {P}/out/r, replace\ninfile x y using {P}/out/r, clear\ndisplay _N",
        "out/r.raw",
        "\n3\n",
    ),
    "putexcel": ("putexcel set {P}/out/p.xlsx, replace\nputexcel A1 = 1", "out/p.xlsx", None),
    "log": ("log using {P}/out/l, text replace\ndisplay 1\nlog close", "out/l.log", None),
    "cmdlog": ("cmdlog using {P}/out/c, replace\ncmdlog close", "out/c.txt", None),
    "do": ("do {P}/code/sub", None, "\n42\n"),
    "type": ("type {P}/code/sub.do", None, "display 40 + 2"),
    "mkdir": ('mkdir "{P}/made"', "made", None),  # quoted: unquoted, OpenDTA's shlex drops backslashes (ODT-26)
    "erase": (
        (
            "file open fh using out/del.txt, write replace\nfile close fh\nerase {P}/out/del.txt\n"
            'capture confirm file out/del.txt\ndisplay "rc=" _rc'
        ),
        None,
        "rc=601",
    ),
    "file open": (
        'file open fh using {P}/out/f.txt, write replace\nfile write fh "hi"\nfile close fh',
        "out/f.txt",
        None,
    ),
    "confirm file": ("confirm file {P}/data/d.dta", None, None),
    "dir macro function": ('local f : dir "{P}/data" files "*.dta"\ndisplay `"`f\'"\'', None, "d.dta"),
    "graph export": ("use data/d, clear\nscatter y x\ngraph export {P}/out/g.png, replace", "out/g.png", None),
    "graph save/use": (
        "use data/d, clear\nscatter y x\ngraph save {P}/out/g, replace\ngraph use {P}/out/g",
        "out/g.gph",
        None,
    ),
}


@pytest.mark.parametrize("prefix", PREFIXES)
@pytest.mark.parametrize("case", CASES)
def test_file_commands_find_files_by_a_foreign_path(shim, case, prefix):
    eng, root = shim
    code, made, text = CASES[case]
    r = eng.run(code.replace("{P}", PREFIXES[prefix]))
    assert r.rc == 0, r.log
    assert "in the working folder)" in r.log  # the mapping is noted
    if made:
        assert (root / made).exists()
    if text:
        assert text in r.log


def test_note_names_the_path_written_and_where_it_went(shim):
    eng, _ = shim
    log = eng.run(r'use "C:\Users\alice\proj\data\d", clear').log
    assert r"(path C:\Users\alice\proj\data\d.dta is data/d.dta in the working folder)" in log
    assert log.count("in the working folder)") == 1


def test_relative_paths_tempfiles_and_paths_under_root_are_not_mapped(shim):
    eng, root = shim
    r = eng.run(f"use data\\d, clear\nuse {root}/data/d, clear\ntempfile t\nsave `t'\nuse `t', clear\ndisplay _N")
    assert r.rc == 0 and "in the working folder)" not in r.log, r.log
    assert sorted(p.name for p in root.iterdir()) == ["code", "data", "out"]  # the tempfile stayed in the temp dir


def test_a_missing_file_is_601_after_the_note(shim):
    r = shim[0].run(r'use "C:\Users\alice\proj\data\missing", clear')
    assert r.rc == 601 and "(path C:" in r.log


def test_cd_stays_inside_the_working_folder(shim):
    eng, root = shim
    r = eng.run(r'cd "C:\Users\alice\proj\code"' + "\nuse ../data/d, clear\ndisplay _N")
    assert r.rc == 0 and "\n3\n" in r.log and Path.cwd() == root / "code"
    r = eng.run("cd ..\ncd ..\ncd ..")
    assert r.rc == 0 and Path.cwd() == root  # never above the working folder
    r = eng.run(r'cd "C:\Users\alice\elsewhere"')
    assert r.rc == 0 and "ignored: no such folder" in r.log and Path.cwd() == root
    eng.run("cd code\ncd")
    assert Path.cwd() == root  # bare cd: back to the top


def test_uninstall_restores_real_paths(shim):
    eng, _ = shim
    pathshim.uninstall()
    r = eng.run(r'use "C:\Users\alice\proj\data\d", clear')
    assert r.rc == 601 and "in the working folder)" not in r.log
    assert eng.run('cd "C:\\nowhere"').rc == 170


# Every `expanduser` in the engine, per file: each one in a file that also calls user_path is hooked (PATCH-3), the
# rest are not user files (adopath, hints, plugins) or are cd, which pathshim replaces. A re-vendor that adds, moves or
# removes one changes this table: check the new site, hook it in the patch if it opens a user file, then update.
EXPANDUSER = {
    "commands/adocmd.py": 1,
    "commands/datacmds.py": 2,
    "commands/datasets.py": 1,
    "commands/datautil.py": 1,
    "commands/delimited.py": 1,
    "commands/excel.py": 1,
    "commands/filecmd.py": 1,
    "commands/files.py": 3,
    "commands/graphcmd.py": 1,
    "commands/helpcmd.py": 1,
    "commands/infile.py": 1,
    "commands/inspect.py": 1,
    "commands/logcmd.py": 2,
    "commands/macro.py": 1,
    "commands/program.py": 1,
    "commands/putexcel.py": 1,
    "commands/statpkg.py": 1,
    "commands/system.py": 1,
    "core/hints/files.py": 1,
    "graphics/store.py": 1,
    "lang/adopath.py": 1,
    "lang/programs.py": 1,
}


def test_the_engine_has_no_new_path_sites():
    vendor = Path(__file__).parent.parent / "src" / "dofile" / "_vendor" / "opendta"
    found = {f.relative_to(vendor).as_posix(): f.read_text().count("expanduser") for f in sorted(vendor.rglob("*.py"))}
    assert {k: n for k, n in found.items() if n} == EXPANDUSER


def test_the_note_is_in_every_run_that_maps_a_path(shim):
    eng, _ = shim
    for _ in range(2):  # running the same do-file again is the usual case in the editor
        assert "in the working folder)" in eng.run(r'use "C:\Users\alice\proj\data\d", clear').log
