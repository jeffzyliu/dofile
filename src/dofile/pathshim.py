"""Web demo only: every file a do-file names is looked for in one working folder (`root`, `/work` in the browser).

Do-files written on someone's computer name files by absolute paths (`use "C:\\Users\\me\\proj\\data\\x.dta"`,
`cd "/Users/me/proj"`). In the browser only the uploaded files exist, so such a path is mapped to the longest tail
of it that exists under root (`data/x.dta`, else `x.dta`), or, for a new file, the longest tail whose folder exists.
Each mapping prints a note line in the log. Paths under root, temp files and paths that exist as written are left
alone. `cd` moves only inside root. The CLI and MCP server never install this: there, real paths stay real.
"""

from __future__ import annotations

import dataclasses
import os
import posixpath
import re
import tempfile
from pathlib import Path
from typing import Callable

from ._vendor.opendta.core import userpath

_DRIVE = re.compile(r"^[A-Za-z]:")
_saved_cd = None


def _inside(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder.rstrip("/") + "/")


def _candidates(text: str, root: str) -> tuple[str, list[str]]:
    """The path as a normalized absolute path, and the tails of it under root, longest first."""
    t = _DRIVE.sub("", text.replace("\\", "/"), count=1)
    if text[:1] == "~":
        t = "/" + t[1:]  # someone else's home folder
    full = posixpath.normpath(posixpath.join(os.getcwd(), t))
    parts = [x for x in full.split("/") if x]
    return full, [posixpath.join(root, *parts[i:]) for i in range(len(parts))]


def resolve(text: str, root: str) -> tuple[str, bool]:
    """Where a file the user named is in the working folder, and whether that is a mapping worth a note."""
    root = os.path.realpath(root)
    tmp = os.path.realpath(tempfile.gettempdir())
    if os.path.exists(text) or (os.path.isabs(text) and _inside(os.path.realpath(text), tmp)):  # tempfiles
        return text, False
    full, tails = _candidates(text, root)
    if _inside(full, root):
        return full, False  # relative, maybe with backslashes or `..` that stays inside
    if not tails:
        return root, True
    hit = next((c for c in tails if os.path.exists(c)), None) or next(
        c for c in tails if os.path.isdir(posixpath.dirname(c))
    )  # a new file: the last tail always fits
    return hit, True


def install(root: str, note: Callable[[str], None]) -> None:
    """Map user paths into `root` and replace `cd`. `note` writes one line to the log."""
    global _saved_cd
    from ._vendor.opendta.commands import registry
    from ._vendor.opendta.lang.words import strip_outer_quotes
    from ._vendor.opendta.session import Session  # noqa: F401  (registers all commands)

    root = os.path.realpath(root)

    def mapper(p: Path) -> Path:
        s = str(p)
        hit, mapped = resolve(s, root)
        if mapped:
            note(f"(path {s} is {posixpath.relpath(hit, root)} in the working folder)")
        return Path(hit)

    def cd(s, args: str) -> None:
        t = strip_outer_quotes(args.strip())
        if not t:
            os.chdir(root)
            return
        full, tails = _candidates(t, root)
        target = (
            full
            if _inside(full, root) and os.path.isdir(full)
            else next((c for c in tails if os.path.isdir(c)), root if not tails else None)
        )
        if target is None:
            note(f"(cd {t} ignored: no such folder in the working folder)")
            return
        if not _inside(full, root):
            note(f"(cd {t} is {posixpath.relpath(target, root)} in the working folder)")
        os.chdir(target)

    userpath.mapper = mapper
    spec = registry.REGISTRY["cd"]
    _saved_cd = _saved_cd or spec
    registry.REGISTRY["cd"] = dataclasses.replace(spec, fn=cd)


def uninstall() -> None:
    """Back to real paths (tests use this, since the registry and the hook are process-wide)."""
    global _saved_cd
    from ._vendor.opendta.commands import registry

    userpath.mapper = None
    if _saved_cd is not None:
        registry.REGISTRY["cd"] = _saved_cd
        _saved_cd = None
