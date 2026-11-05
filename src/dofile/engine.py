"""Thin adapter over the vendored OpenDTA interpreter. The only module that imports it.

One Engine = one Stata session (data in memory, macros, e()/r() results). OpenDTA's `cd`
changes the process working directory, so run one Engine per process (see worker.py).
"""
from __future__ import annotations

import os
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ._vendor.opendta.core import missing
from ._vendor.opendta.core.output import Capture
from ._vendor.opendta.session import Session

RC_INTERNAL = 9999  # a Python exception escaped the interpreter (an engine bug, not a Stata error)
RC_FILE = 603  # Stata: file could not be opened
RC_BREAK = 1  # Stata: --Break-- (the user pressed Break); the session keeps its data


@dataclass
class Result:
    log: str
    rc: int
    error: str | None = None
    results: dict[str, Any] = field(default_factory=lambda: {"e": empty_results(), "r": empty_results()})
    error_command: str | None = None  # the echoed command that failed (a loop's first line, for errors in a loop)
    nobs: int = 0  # dataset in memory after the call
    nvars: int = 0
    new_graphs: int = 0  # graphs drawn by this call
    images: list[bytes] = field(default_factory=list)  # PNGs of the last few of them, when asked for


def to_json(v: Any) -> Any:
    """e()/r() values as JSON: numbers, strings, matrices; Stata missing as None or ".a"-".z"."""
    if isinstance(v, str):
        return v
    if hasattr(v, "data") and hasattr(v, "rownames"):  # Matrix
        full = lambda eqs, names: [n if q == "_" else f"{q}:{n}" for q, n in zip(eqs, names)]  # Stata's fullnames
        return {"rows": full(v.roweq, v.rownames), "cols": full(v.coleq, v.colnames),
                "data": [[to_json(float(x)) for x in row] for row in v.data]}
    try:
        x = float(v)
    except (TypeError, ValueError):
        return str(v)
    if x in (float("inf"), float("-inf")):  # Stata has no infinity, and JSON cannot carry it
        return None
    if missing.is_missing(x) or x != x:
        name = missing.missing_name(x) if x == x else "."
        return None if name == "." else name
    return int(x) if x.is_integer() and abs(x) < 2**53 else x


def empty_results() -> dict[str, dict]:
    return {"scalars": {}, "macros": {}, "matrices": {}}


def group_results(d: dict[str, Any]) -> dict[str, dict]:
    """e() or r() split like `ereturn list`: strings are macros, Matrix objects matrices, the rest scalars."""
    out = empty_results()
    for k, v in d.items():
        kind = "macros" if isinstance(v, str) else "matrices" if hasattr(v, "rownames") else "scalars"
        out[kind][k] = to_json(v)
    return out


def about() -> dict[str, Any]:
    """Versions: dofile, the vendored OpenDTA commit and patches, and the Stata version it emulates."""
    from . import __version__
    stamp = dict(line.split(": ", 1) for line in
                 (Path(__file__).parent / "_vendor" / "opendta" / "VENDORED").read_text().splitlines() if ": " in line)
    return {"dofile": __version__, "engine": "OpenDTA", "engine_commit": stamp.get("commit"),
            "engine_patches": [p.strip() for p in stamp.get("patches", "").split(",") if p.strip()],
            "stata_version": 14}  # OpenDTA's c(stata_version); its target is Stata 14


MAX_IMAGES = 3


def _tracked_store():
    """OpenDTA's graph store, also recording each graph drawn (put), so a call can report its new graphs."""
    from ._vendor.opendta.graphics.store import GraphStore

    class TrackedStore(GraphStore):
        def __init__(self) -> None:
            super().__init__()
            self.drawn: list = []

        def put(self, g, *, replace: bool) -> None:
            super().put(g, replace=replace)
            self.drawn.append(g)
    return TrackedStore()


def _png(g) -> bytes | None:
    import io
    from ._vendor.opendta.graphics import render
    buf = io.BytesIO()
    try:
        fig = render.figure(g)
        fig.savefig(buf, format="png", dpi=100, facecolor=fig.get_facecolor())
    except Exception:  # noqa: BLE001 - a graph that cannot be drawn is just not shown inline
        return None
    return buf.getvalue()


class Engine:
    def __init__(self, workdir: str | os.PathLike | None = None):
        if workdir is not None:
            os.chdir(workdir)
        self._capture = Capture()
        self.session = Session()
        self.session._graphs = _tracked_store()  # the attribute OpenDTA's graphics.store.store() looks up
        self.session.output.add_listener(self._capture)

    def run(self, code: str, images: bool = False) -> Result:
        """Runs Stata code like a do-file (commands echoed as `. cmd`) and returns its log. With `images`,
        the last MAX_IMAGES graphs it drew come back as PNGs."""
        self._capture.clear()
        drawn = self.session._graphs.drawn
        drawn.clear()
        error = None
        try:
            rc = self.session.run(code, echo=True)
        except KeyboardInterrupt:  # the worker's interrupt (cancel or timeout), like Stata's Break key
            rc, error = RC_BREAK, "--Break--"
            self._capture("--Break--\nr(1);\n", "error")
            self._recover(rc)
        except PermissionError as e:  # the sandbox refused a file access: Stata's "file could not be opened"
            rc, error = RC_FILE, f"file could not be opened: {e.strerror or e}"
            self._capture(f"{error}\nr({rc});\n", "error")
            self._recover(rc)
        except Exception as e:  # noqa: BLE001 - any engine bug becomes an error result, not a crash
            rc = RC_INTERNAL
            error = f"internal engine error: {type(e).__name__}: {e}"
            self._capture(f"{error}\n{traceback.format_exc(limit=-3)}r({rc});\n", "error")
            self._recover(rc)
        if rc and error is None:
            error = _last_error(self._capture.text)
        failed = _failed_command(self._capture.text) if rc else None
        pngs = [p for p in map(_png, drawn[-MAX_IMAGES:]) if p] if images else []
        d = self.session.data
        result = Result(self._capture.text, rc, error, self.results(), failed, d.nobs, len(d.names), len(drawn), pngs)
        drawn.clear()  # don't keep graphs alive past the call
        return result

    def break_result(self) -> Result:
        """Result for an interrupt that came after the code itself finished (while building the result)."""
        self._capture("--Break--\nr(1);\n", "error")
        self._recover(RC_BREAK)
        self.session._graphs.drawn.clear()
        d = self.session.data
        return Result(self._capture.text, RC_BREAK, "--Break--", self.results(), None, d.nobs, len(d.names))

    def _recover(self, rc: int) -> None:
        """Leave the interpreter usable after an escaped exception: close open scopes and prefixes."""
        s = self.session
        for scope in reversed(s.scopes):  # close_scope() cleans up but does not pop
            s.close_scope(scope)
        s.scopes.clear()
        s.do_depth = 0
        s.by_groups = None
        s.set_rc(rc)

    def results(self) -> dict[str, Any]:
        s = self.session
        return {"e": group_results(s.e), "r": group_results(s.r)}

    def matrix(self, name: str, rows: list[str] | None = None, cols: list[str] | None = None) -> dict[str, Any]:
        """One matrix as JSON (`e(V)`, `r(table)` or a user matrix), optionally only the named rows/cols.
        Problems come back as {"error": message}."""
        from ._vendor.opendta.commands.matrix import get_matrix
        from ._vendor.opendta.core.errors import StataError
        try:
            m = to_json(get_matrix(self.session, name))
        except StataError as e:
            return {"error": e.message}
        idx = {}
        for axis, want in (("rows", rows), ("cols", cols)):
            names = m[axis]
            bad = [w for w in want or () if w not in names]
            if bad:
                return {"error": f"{name} has no {axis[:-1]} named {', '.join(bad)} (it has {len(names)}, e.g. "
                                 f"{', '.join(names[:5])})"}
            idx[axis] = [names.index(w) for w in want] if want else range(len(names))
        return {"rows": [m["rows"][i] for i in idx["rows"]], "cols": [m["cols"][j] for j in idx["cols"]],
                "data": [[m["data"][i][j] for j in idx["cols"]] for i in idx["rows"]]}

    def data_summary(self, vars: str | None = None, offset: int = 0, limit: int | None = None) -> dict[str, Any]:
        """The dataset's variables; `vars` is a Stata varlist (`inc* age`), `offset`/`limit` page through it.
        Problems come back as {"error": message}."""
        from ._vendor.opendta.core.errors import StataError
        d = self.session.data
        try:
            names = self.session.expand_varlist(vars) if vars and vars.strip() else list(d.names)
        except StataError as e:
            return {"error": e.message}
        page = names[offset:offset + limit] if limit is not None else names[offset:]
        variables = []
        for name in page:
            v = d.get(name)
            variables.append({"name": name, "type": v.vtype, "format": v.fmt,
                              "label": v.label or None, "value_label": v.value_label or None})
        return {"nobs": d.nobs, "nvars": len(d.names), "matched": len(names), "offset": offset,
                "variables": variables, "more": max(len(names) - offset - len(page), 0),
                "filename": getattr(d, "filename", None) or None}


def _failed_command(log: str) -> str | None:
    """The last command echoed (`. cmd`, with its `> ` continuation lines) before the last `r(#);`."""
    lines = log.splitlines()
    end = max((i for i, ln in enumerate(lines) if ln.startswith("r(") and ln.rstrip().endswith(");")), default=None)
    if end is None:
        return None
    for i in range(end, -1, -1):
        if lines[i].startswith(". "):
            cmd = [lines[i][2:]]
            for ln in lines[i + 1:end]:
                if not ln.startswith("> "):
                    break
                cmd.append(ln[2:])
            return " ".join(c.strip().removesuffix("///").strip() for c in cmd)
    return None


def _last_error(log: str) -> str | None:
    """The Stata error message: the line before the last `r(#);`, skipping OpenDTA's hint lines."""
    lines = [ln for ln in log.splitlines() if ln.strip()]
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].startswith("r(") and lines[i].rstrip().endswith(");"):
            for j in range(i - 1, -1, -1):
                if not lines[j].startswith(" "):  # hints are indented
                    return lines[j].strip()
    return None
