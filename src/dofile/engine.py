"""Thin adapter over the vendored OpenDTA interpreter. The only module that imports it.

One Engine = one Stata session (data in memory, macros, e()/r() results). OpenDTA's `cd`
changes the process working directory, so run one Engine per process (see worker.py).
"""
from __future__ import annotations

import os
import re
import traceback
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ._vendor.opendta.core import missing
from ._vendor.opendta.core.output import Capture
from ._vendor.opendta.lang.programs import Scope
from ._vendor.opendta.session import Session
from . import sandbox

RC_INTERNAL = 9999  # a Python exception escaped the interpreter (an engine bug, not a Stata error)
RC_FILE = 603  # Stata: file could not be opened
RC_BREAK = 1  # Stata: --Break-- (the user pressed Break); the session keeps its data
BREAK = "--Break--"


# a tempfile's path (OpenDTA names them <tmp>/opendta-<pid>/S__000001.dta)
_TEMPFILE = re.compile(r"opendta-\d+[/\\]S__\d+")
TEMPFILE_HINT = "a tempfile lasts one run_do call: save it under a name to use it in a later call"


def _refusal_for(error: str | None) -> str | None:
    """The sandbox refusal of this call that names the file `error` is about (they end in the path), if any."""
    if not error:
        return None
    for path, message in reversed(sandbox.refusals):
        name = os.path.basename(path.rstrip("/\\"))
        if name and re.search(rf"(?<![\w.-]){re.escape(name)}", error):  # whole name, so a.png isn't found in data.png
            return message
    return None


_COULD_NOT_OPEN = re.compile(r"^file (.+) could not be opened$")


def _annotate_refusals(text: str) -> str:
    """OpenDTA's own `file X could not be opened` (graph export) hides why. Under each such line, add the sandbox's
    refusal that names X, so a refusal reads differently from a missing folder even when `capture` swallows the error."""
    if not sandbox.refusals:
        return text
    lines = text.split("\n")
    out: list[str] = []
    for k, line in enumerate(lines):
        out.append(line)
        if _COULD_NOT_OPEN.match(line) and not (k + 1 < len(lines) and "dofile sandbox" in lines[k + 1]):
            reason = _refusal_for(line)
            if reason:
                out.append(reason)
    return "\n".join(out)


def _same(before: dict[str, Any], after: dict[str, Any]) -> bool:
    """Whether e() or r() holds the same values as before a call (a matrix counts as the same only if untouched)."""
    if before.keys() != after.keys():
        return False
    return all(v is after[k] or (isinstance(v, (int, float, str)) and (v == after[k] or v != v and after[k] != after[k]))
               for k, v in before.items())  # NaN counts as equal to NaN


@dataclass
class Result:
    log: str
    rc: int
    error: str | None = None
    results: dict[str, Any] = field(default_factory=lambda: {"e": empty_results(), "r": empty_results(),
                                                             "e_changed": False, "r_changed": False})
    error_command: str | None = None  # the echoed command that failed (a loop's first line, for errors in a loop)
    nobs: int = 0  # dataset in memory after the call
    nvars: int = 0
    new_graphs: int = 0  # graphs drawn by this call
    images: list[bytes] = field(default_factory=list)  # PNGs of the last few of them, when asked for
    files: list[dict[str, Any]] = field(default_factory=list)  # workdir files the call created or changed


def to_json(v: Any) -> Any:
    """e()/r() values as JSON: numbers, strings, matrices; Stata missing as None or ".a"-".z"."""
    if isinstance(v, str):
        return v
    if hasattr(v, "data") and hasattr(v, "rownames"):  # Matrix
        return {"rows": _fullnames(v.roweq, v.rownames), "cols": _fullnames(v.coleq, v.colnames),
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


def _fullnames(eqs, names) -> list[str]:
    """Stata's row/column fullnames: `eq:name`, or just `name` without an equation."""
    return [n if q == "_" else f"{q}:{n}" for q, n in zip(eqs, names)]


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
LOG_KEEP = 1_000_000  # MCP workers: characters kept from the start and from the end of one call's log


class _BoundedCapture:
    """OpenDTA's Capture, but past 2 x `keep` characters only the start and the end of the log are kept. A runaway
    loop prints ~5 MB/s; the worker, the pipe and the server would each hold all of it."""

    def __init__(self, keep: int) -> None:
        self.keep = keep
        self.clear()

    def clear(self) -> None:
        self.head: list[str] = []
        self.tail: deque[str] = deque()
        self.head_n = self.tail_n = self.dropped = 0

    def __call__(self, text: str, style: str = "") -> None:
        if self.head_n < self.keep:
            first = text[:self.keep - self.head_n]
            self.head.append(first)
            self.head_n += len(first)
            text = text[len(first):]
        if text:
            self.tail.append(text)
            self.tail_n += len(text)
            while self.tail_n - len(self.tail[0]) >= self.keep:  # drop old pieces; the tail keeps >= keep
                old = self.tail.popleft()
                self.tail_n -= len(old)
                self.dropped += len(old)

    @property
    def text(self) -> str:
        cut = f"\n[... {self.dropped:,} characters of output omitted ...]\n" if self.dropped else ""
        return "".join(self.head) + cut + "".join(self.tail)


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
    def __init__(self, workdir: str | os.PathLike | None = None, log_keep: int | None = None, hints: bool = True):
        """`log_keep`: cap each call's log to its first and last `log_keep` characters (None: keep it all,
        as `dofile run` does, like a Stata batch log). `hints`: OpenDTA's explanations under errors, written for
        people at a console; off for agents."""
        if workdir is not None:
            os.chdir(workdir)
        self._capture = _BoundedCapture(log_keep) if log_keep else Capture()
        self.session = Session()
        self.session.run("quietly set superscript off")  # Stata's 1.000e+10, not OpenDTA's 1.00×10¹⁰ (loses a digit)
        if not hints:
            self.session.run("quietly set hints off")
        self.session._graphs = _tracked_store()  # the attribute OpenDTA's graphics.store.store() looks up
        self.session.output.add_listener(self._capture)

    def run(self, code: str, images: bool = False) -> Result:
        """Runs Stata code like a do-file (commands echoed as `. cmd`) and returns its log. With `images`,
        the last MAX_IMAGES graphs it drew come back as PNGs. Like `do`, each call has its own scope: preserved
        data is restored and temporaries are dropped when it ends, with or without an error. Locals persist."""
        self._capture.clear()
        drawn = self.session._graphs.drawn
        drawn.clear()
        error = None
        sandbox.refusals.clear()
        self._before = (dict(self.session.e), dict(self.session.r))  # to tell whether the call changed e()/r()
        scope = Scope("do", "run")
        self.session.scopes.append(scope)
        try:
            rc = self.session.run(code, echo=True)
        except KeyboardInterrupt:  # the worker's interrupt (cancel or timeout), like Stata's Break key
            rc, error = RC_BREAK, BREAK
            self._capture(f"{BREAK}\nr({RC_BREAK});\n", "error")
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
        if scope in self.session.scopes:  # _recover() already closed it after an escaped exception
            self.session.scopes.remove(scope)
            self.session.close_scope(scope)
        if rc and error is None:
            error = _last_error(self._capture.text)
        refused = _refusal_for(error) if rc == RC_FILE and "dofile sandbox" not in (error or "") else None
        if refused:  # OpenDTA's own 603 message (graph export) hides why: say it was the sandbox, not a missing folder
            error = f"{error} ({refused})"
            if refused not in _annotate_refusals(self._capture.text):  # not OpenDTA's usual wording: add it at the end
                self._capture(f"{refused}\n", "error")
        elif rc == 601 and error and _TEMPFILE.search(error):  # the local names it, the call's scope deleted the file
            self._capture(f"({TEMPFILE_HINT})\n", "error")
            error = f"{error} ({TEMPFILE_HINT})"
        log = self._capture.text  # built once: it joins up to 2 MB
        failed = _failed_command(log) if rc else None
        pngs = [p for p in map(_png, drawn[-MAX_IMAGES:]) if p] if images else []
        d = self.session.data
        result = Result(_annotate_refusals(log), rc, error, self.results(), failed, d.nobs, len(d.names),
                        len(drawn), pngs)
        drawn.clear()  # don't keep graphs alive past the call
        return result

    def break_result(self) -> Result:
        """Result for an interrupt that came after the code itself finished (while building the result)."""
        self._capture(f"{BREAK}\nr({RC_BREAK});\n", "error")
        self._recover(RC_BREAK)
        self.session._graphs.drawn.clear()
        d = self.session.data
        return Result(self._capture.text, RC_BREAK, BREAK, self.results(), None, d.nobs, len(d.names))

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
        """e() and r() as they are now, with whether the last call changed each (False: left from an earlier call,
        e.g. e() after `clear` still describes a model on data that is gone, r() after a failed command)."""
        s = self.session
        e0, r0 = getattr(self, "_before", (None, None))
        return {"e": group_results(s.e), "r": group_results(s.r),
                "e_changed": e0 is None or not _same(e0, s.e), "r_changed": r0 is None or not _same(r0, s.r)}

    def matrix(self, name: str, rows: list[str] | None = None, cols: list[str] | None = None,
               max_cells: int | None = None) -> dict[str, Any]:
        """One matrix as JSON (`e(V)`, `r(table)` or a user matrix), optionally only the named rows/cols, and
        refused above `max_cells` before any conversion. Problems come back as {"error": message}."""
        from ._vendor.opendta.commands.matrix import get_matrix
        from ._vendor.opendta.core.errors import StataError
        try:
            mx = get_matrix(self.session, name)
        except StataError as e:
            return {"error": e.message}
        names = {"rows": _fullnames(mx.roweq, mx.rownames), "cols": _fullnames(mx.coleq, mx.colnames)}
        idx = {}
        for axis, want in (("rows", rows), ("cols", cols)):
            have = names[axis]
            bad = [w for w in want or () if w not in have]
            if bad:
                return {"error": f"{name} has no {axis[:-1]} named {', '.join(bad)} (it has {len(have)}, e.g. "
                                 f"{', '.join(have[:5])})"}
            idx[axis] = [have.index(w) for w in want] if want else range(len(have))
        n_rows, n_cols = len(idx["rows"]), len(idx["cols"])
        if max_cells is not None and n_rows * n_cols > max_cells:
            return {"error": f"{name} has {n_rows}x{n_cols} values, more than {max_cells}; ask for some rows/cols"}
        return {"rows": [names["rows"][i] for i in idx["rows"]], "cols": [names["cols"][j] for j in idx["cols"]],
                "data": [[to_json(float(mx.data[i][j])) for j in idx["cols"]] for i in idx["rows"]]}

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
    """The Stata error message: the line before the last `r(#);`, skipping OpenDTA's hint lines and the
    `end of do-file` / `r(#);` pair each enclosing `do` adds when it passes the error up."""
    is_rc = lambda ln: ln.startswith("r(") and ln.rstrip().endswith(");")
    lines = [ln for ln in log.splitlines() if ln.strip()]
    for i in range(len(lines) - 1, -1, -1):
        if is_rc(lines[i]):
            for j in range(i - 1, -1, -1):
                ln = lines[j]
                if not ln.startswith(" ") and ln.strip() != "end of do-file" and not is_rc(ln):  # hints are indented
                    return ln.strip()
    return None
