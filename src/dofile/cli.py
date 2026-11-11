"""`dofile run file.do`: run a do-file in batch mode, like `stata -b do file.do`.

Prints the log, exits 0 on success and 1 on an error (the Stata rc is in the log and in --json).
Runs sandboxed by default, in the current directory; --unsafe lifts the sandbox for trusted code.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dofile", description="Run Stata-syntax .do files without a Stata license.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="run a .do file and print its log")
    run.add_argument("dofile", type=Path, help="the .do file to run; its own folder is readable, for nested `do`")
    run.add_argument(
        "--json",
        type=Path,
        metavar="OUT",
        help="also write JSON: rc, error, error_command, results (e() and r()) and versions",
    )
    run.add_argument(
        "--workdir",
        type=Path,
        default=Path("."),
        help="working directory, the only folder code can write to (default: current)",
    )
    run.add_argument("--read-dir", action="append", default=[], help="extra read-only data directory (repeatable)")
    run.add_argument("--unsafe", action="store_true", help="disable the sandbox (trusted code only)")
    a = ap.parse_args(argv)

    dofile = a.dofile.resolve()
    if not dofile.is_file():
        ap.error(f"no such file: {a.dofile}")
    workdir = a.workdir.resolve()
    json_out = open(a.json, "w") if a.json else None  # noqa: SIM115  (closed after the run; opened before the sandbox, which blocks writes outside workdir)
    if not a.unsafe:
        from . import sandbox

        # the do-file's own folder stays readable, so `do other.do` next to it works
        sandbox.install(workdir, (str(dofile.parent), *(str(Path(d).resolve()) for d in a.read_dir)))
    from .engine import Engine, about

    os.chdir(workdir)
    eng = Engine()
    # via a local: Stata doesn't expand a macro's contents again, so `$` and backquotes in the path stay literal
    eng.session.macros.set_local("__dofile_path", str(dofile))
    cmd = "do `\"`__dofile_path'\"'"
    r = eng.run(cmd)
    shown = f'do "{dofile}"'  # echo the real path, not the macro
    r.log = r.log.replace(f". {cmd}", f". {shown}", 1)
    if r.error_command == cmd:
        r.error_command = shown
    sys.stdout.write(r.log)
    if json_out:
        with json_out:
            json_out.write(
                json.dumps(
                    {
                        "rc": r.rc,
                        "error": r.error,
                        "error_command": r.error_command,
                        "results": r.results,
                        "versions": about(),
                    },
                    indent=2,
                )
                + "\n"
            )
    return 1 if r.rc else 0


if __name__ == "__main__":
    sys.exit(main())
