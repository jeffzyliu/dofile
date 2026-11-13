"""Thin adapter over the vendored OpenDTA interpreter. The only module that imports it.

One Engine = one Stata session (data in memory, macros, e()/r() results). OpenDTA's `cd`
changes the process working directory, so run one Engine per process (see worker.py).
"""

from __future__ import annotations

import errno
import math
import os
import re
import time
import traceback
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import sandbox
from ._vendor.opendta.core import brk, missing
from ._vendor.opendta.core.output import Capture
from ._vendor.opendta.lang.programs import Scope
from ._vendor.opendta.session import Session

RC_INTERNAL = 9999  # a Python exception escaped the interpreter (an engine bug, not a Stata error)
RC_FILE = 603  # Stata: file could not be opened
RC_BREAK = 1  # Stata: --Break-- (the user pressed Break); the session keeps its data
BREAK = "--Break--"
RC_NOMEM = (
    909  # Stata: op. sys. refuses to provide memory (a MemoryError in a command is this too: OpenDTA patch ODT-28)
)
NOMEM = "op. sys. refuses to provide memory"


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
    return all(
        v is after[k]
        or (
            isinstance(v, (int, float, str))
            # NaN counts as equal to NaN
            and (v == after[k] or v != v and after[k] != after[k])  # noqa: PLR0124  (the NaN test: only a NaN differs from itself)
        )
        for k, v in before.items()
    )


@dataclass
class Result:
    log: str
    rc: int
    error: str | None = None
    results: dict[str, Any] = field(
        default_factory=lambda: {"e": empty_results(), "r": empty_results(), "e_changed": False, "r_changed": False}
    )
    error_command: str | None = None  # the echoed command that failed (a loop's first line, for errors in a loop)
    nobs: int = 0  # dataset in memory after the call
    nvars: int = 0
    new_graphs: int = 0  # graphs drawn by this call
    images: list[bytes] = field(default_factory=list)  # PNGs of the last few of them, when asked for
    files: list[dict[str, Any]] = field(default_factory=list)  # workdir files the call created or changed
    # The web demo's fields (mcp_server.py does not send them):
    error_line: int | None = (
        None  # 1-based line, in the code run, of the command that failed (None in a nested do-file)
    )
    graph_commands: list[str] = field(default_factory=list)  # the command that drew each entry of `images`
    graph_lines: list[int | None] = field(default_factory=list)  # and its first line in the code run (None: unknown)


def to_json(v: Any) -> Any:
    """e()/r() values as JSON: numbers, strings, matrices; Stata missing as None or ".a"-".z"."""
    if isinstance(v, str):
        return v
    if hasattr(v, "data") and hasattr(v, "rownames"):  # Matrix
        return {
            "rows": _fullnames(v.roweq, v.rownames),
            "cols": _fullnames(v.coleq, v.colnames),
            "data": [[to_json(float(x)) for x in row] for row in v.data],
        }
    try:
        x = float(v)
    except (TypeError, ValueError):
        return str(v)
    if x in (float("inf"), float("-inf")):  # Stata has no infinity, and JSON cannot carry it
        return None
    if missing.is_missing(x) or math.isnan(x):
        name = missing.missing_name(x) if not math.isnan(x) else "."
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


def matrix_sizes(results: dict[str, Any]) -> dict[str, Any]:
    """e()/r() with each matrix replaced by its size ("16x16"): a big e(V) would be sent on every call; the
    values come from Engine.matrix()."""
    return {
        k: (
            {**rs, "matrices": {name: f"{len(m['rows'])}x{len(m['cols'])}" for name, m in rs["matrices"].items()}}
            if k in ("e", "r")
            else rs
        )
        for k, rs in results.items()
    }


def about() -> dict[str, Any]:
    """Versions: dofile, the vendored OpenDTA commit and patches, and the Stata version it emulates."""
    from . import __version__

    stamp = dict(
        line.split(": ", 1)
        for line in (Path(__file__).parent / "_vendor" / "opendta" / "VENDORED").read_text().splitlines()
        if ": " in line
    )
    return {
        "dofile": __version__,
        "engine": "OpenDTA",
        "engine_commit": stamp.get("commit"),
        "engine_patches": [p.strip() for p in stamp.get("patches", "").split(",") if p.strip()],
        "stata_version": 14,
    }  # OpenDTA's c(stata_version); its target is Stata 14


MAX_IMAGES = 5
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
            first = text[: self.keep - self.head_n]
            self.head.append(first)
            self.head_n += len(first)
            text = text[len(first) :]
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


STREAM_EVERY = 0.1  # seconds: on_output is called at most this often while a command writes
STREAM_BEFORE_COMMAND = 0.015  # seconds: before a command starts, what is pending goes if the last send is this old


class _Tee:
    """The output listener: passes the log to the capture, and, during a run with `on_output`, sends it there too,
    in batches. With a capped capture, it sends only the part the capture keeps at its start, so what was sent is
    always the start of the final log."""

    def __init__(self, capture) -> None:
        self.capture = capture
        self.sink = None
        self.pending: list[str] = []
        self.last = 0.0

    def start(self, sink) -> None:
        self.sink, self.pending, self.last = sink, [], 0.0  # the first text goes at once

    def __call__(self, text: str, style: str = "") -> None:
        head = getattr(self.capture, "head_n", None)  # a _BoundedCapture: send only what goes to its head
        self.capture(text, style)
        if self.sink is None:
            return
        if head is not None:
            text = text[: self.capture.head_n - head]  # past the cap: nothing more is sent
        if text:
            self.pending.append(text)
            self.tick()

    def tick(self, every: float = STREAM_EVERY) -> None:
        if self.pending and time.monotonic() - self.last >= every:
            self.flush()

    def flush(self) -> None:
        if not (self.pending and self.sink):
            return
        text, self.pending = "".join(self.pending), []
        self.last = time.monotonic()
        try:
            self.sink(text)
        except BaseException:  # noqa: BLE001 - a failing receiver must not stop the run (a Break comes through brk)
            self.sink = None

    def stop(self) -> None:
        try:
            self.flush()
        finally:
            self.sink, self.pending = None, []


_ticking: _Tee | None = None  # the run that streams now; long computations give it a chance to send


def _install_tick() -> None:
    """Long computations (ml iterations, bootstrap and Mata loops) call brk.check(); send the pending log there too,
    so the echo of a long command reaches the page before the command ends."""
    if getattr(brk.check, "_dofile_tick", False):
        return
    check = brk.check

    def checked() -> None:
        if _ticking is not None:
            _ticking.tick()
        check()

    checked._dofile_tick = True
    brk.check = checked


def _tracked_store():
    """OpenDTA's graph store, also recording each graph drawn (put), so a call can report its new graphs and the
    command that drew each one, as (text, line) (`command`, set by the Engine)."""
    from ._vendor.opendta.graphics.store import GraphStore

    class TrackedStore(GraphStore):
        def __init__(self) -> None:
            super().__init__()
            self.drawn: list = []
            self.commands: list[tuple[str, int | None]] = []
            self.command = lambda: ("", None)

        def put(self, g, *, replace: bool) -> None:
            super().put(g, replace=replace)
            self.drawn.append(g)
            self.commands.append(self.command())

        def clear_drawn(self) -> None:
            self.drawn.clear()
            self.commands.clear()

    return TrackedStore()


def request_break() -> None:
    """From a signal handler: Break at the next safe point (between commands, or in a long computation that leaves
    the data alone). Never mid-command, which could leave the data half changed (PATCH-2)."""
    brk.request()


def clear_break() -> None:
    """Drop a Break that arrived after its call ended, before the next call starts."""
    brk.clear()


def _png(g, theme: str | None = None) -> bytes | None:
    """The graph as a PNG. theme="dark": every graph whose scheme maps to OpenDTA's color scheme (the default,
    s2color or s1color named, or an unknown name) is drawn in OpenDTA's dark scheme (dark background, light text, axes
    and grid); the mono schemes and the dark one are drawn as they are."""
    import io

    from ._vendor.opendta.graphics import render, scheme

    get = scheme.get
    if theme == "dark":
        light, dark = scheme.SCHEMES["opendta"], scheme.SCHEMES["opendta_dark"]
        scheme.get = lambda name=None: dark if get(name) is light else get(name)
    buf = io.BytesIO()
    try:
        fig = render.figure(g)
        fig.savefig(buf, format="png", dpi=100, facecolor=fig.get_facecolor())
    except Exception:  # noqa: BLE001 - a graph that cannot be drawn is just not shown inline
        return None
    finally:
        scheme.get = get
    return buf.getvalue()


def _out_of_memory(e: Exception) -> bool:
    """A MemoryError, or the OSError that WebAssembly's file system raises when the heap is full (ENOMEM: Python looking
    up a module file)."""
    return isinstance(e, MemoryError) or (isinstance(e, OSError) and e.errno == errno.ENOMEM)


class Engine:
    def __init__(
        self,
        workdir: str | os.PathLike | None = None,
        log_keep: int | None = None,
        hints: bool = True,
        tempfile_hint: str = TEMPFILE_HINT,
    ):
        """`log_keep`: cap each call's log to its first and last `log_keep` characters (None: keep it all,
        as `dofile run` does, like a Stata batch log). `hints`: OpenDTA's explanations under errors, written for
        people at a console; off for agents. `tempfile_hint`: the note under an error about a tempfile that a
        previous call deleted."""
        if workdir is not None:
            os.chdir(workdir)
        self._capture = _BoundedCapture(log_keep) if log_keep else Capture()
        self._tee = _Tee(self._capture)
        self._temp_names: set[str] = set()  # tempvar, tempname and tempfile names made by the code's top level
        self.tempfile_hint = tempfile_hint
        self.on_memory_error = (
            None  # called first when a MemoryError escapes a call: the web demo frees its reserve here
        )
        self.session = Session()
        self.session.run("quietly set superscript off")  # Stata's 1.000e+10, not OpenDTA's 1.00×10¹⁰ (loses a digit)
        if not hints:
            self.session.run("quietly set hints off")
        self.session._graphs = _tracked_store()  # the attribute OpenDTA's graphics.store.store() looks up
        self.session._graphs.command = self._graph_command
        self.session.output.add_listener(self._tee)
        self._track_lines()
        _install_tick()

    def _track_lines(self) -> None:
        """Wrap the interpreter so a call knows which line of its code is running: `_frames` holds a (line, do
        depth) for each command being run, outermost first (a program's body adds a None marker); `_failure` is
        the frames where the last error was raised."""
        interp, s = self.session.interp, self.session
        self._frames: list = []
        self._failure: tuple | None = None
        self._top: set[int] = set()  # id() of the LogicalLines of the code this call runs
        run_lines, run_one, run_program = interp.run_lines, interp._run_one, interp.run_program
        execute = interp.execute

        def lines_hook(lines, *a, **k):
            if not self._top:
                self._top = {id(ln) for ln in lines}
            return run_lines(lines, *a, **k)

        def one_hook(lines, i, end, *, echo):
            self._frames.append((lines[i], s.do_depth))
            try:
                return run_one(lines, i, end, echo=echo)
            except BaseException as e:
                self._note_failure(e)
                raise
            finally:
                self._frames.pop()

        def program_hook(prog):
            self._frames.append(None)
            try:
                return run_program(prog)
            finally:
                self._frames.pop()

        def execute_hook(raw):
            # Before a command starts, send what is pending (the last output and this command's echo), or a long
            # command that writes nothing would hold it to its end. A top-level command always does; one in a loop,
            # a block or a program only if the last send is STREAM_BEFORE_COMMAND old, so a tight loop sends rarely.
            top = len(self._frames) == 1 and s.do_depth == self._depth
            self._tee.tick(0 if top else STREAM_BEFORE_COMMAND)
            return execute(raw)

        interp.run_lines, interp._run_one, interp.run_program, interp.execute = (
            lines_hook,
            one_hook,
            program_hook,
            execute_hook,
        )

    def _note_failure(self, e: BaseException) -> None:
        """Keep the frames of the innermost place an error was raised. The same error passing outward (or a new one
        raised while handling it, as `do` does) keeps them; another error (after `capture` took the first) replaces
        them."""
        if self._failure and (e is self._failure[0] or e.__context__ is self._failure[0]):
            self._failure = (e, self._failure[1])
        else:
            self._failure = (e, list(self._frames))

    def _error_line(self) -> int | None:
        """The line, in this call's code, of the command that failed: the innermost one being run that is part of
        this code (a loop's or a program's body line when the error is there); None inside a nested do-file."""
        if not self._failure:
            return None
        frames = [f for f in self._failure[1] if f is not None]
        if not frames or frames[-1][1] > self._depth:
            return None
        return next((ln.lineno for ln, _ in reversed(frames) if id(ln) in self._top), None)

    def _graph_command(self) -> tuple[str, int | None]:
        """The command of this call's code that is drawing a graph, and its first line: the innermost one being run,
        outside any program (for a program's graph, the line that called it; for a nested do-file's, its `do` line)."""
        frames = self._frames[: self._frames.index(None)] if None in self._frames else self._frames
        ln = next((ln for ln, _ in reversed(frames) if id(ln) in self._top), None)
        return (ln.text.strip(), ln.lineno) if ln is not None else ("", None)

    def run(
        self,
        code: str,
        images: bool = False,
        *,
        fresh_locals: bool = False,
        plot_theme: str | None = None,
        on_output=None,
    ) -> Result:
        """Runs Stata code like a do-file (commands echoed as `. cmd`) and returns its log. With `images`,
        the last MAX_IMAGES graphs it drew come back as PNGs. Like `do`, each call has its own scope: preserved
        data is restored and temporaries are dropped when it ends, with or without an error. Locals persist, unless
        `fresh_locals` clears them first. `plot_theme` "dark" draws those PNGs dark (not files from graph export).
        `on_output(text)` gets the log as it grows, at most every STREAM_EVERY seconds, and the rest at the end."""
        global _ticking
        self._capture.clear()
        store = self.session._graphs
        store.clear_drawn()
        self._frames.clear()
        self._failure, self._top, self._depth = None, set(), self.session.do_depth
        error = None
        sandbox.refusals.clear()
        if fresh_locals:
            self.session.macros._frames[0].clear()
        self._before = (dict(self.session.e), dict(self.session.r))  # to tell whether the call changed e()/r()
        if on_output is not None:
            self._tee.start(on_output)
            _ticking = self._tee
        try:
            scope = Scope("do", "run")
            self.session.scopes.append(scope)
            try:
                rc = self.session.run(code, echo=True)
            except KeyboardInterrupt:  # Break at a safe point (request_break: the worker's cancel or timeout)
                rc, error = RC_BREAK, BREAK
                self._tee(f"{BREAK}\nr({RC_BREAK});\n", "error")
                self._recover(rc)
            except PermissionError as e:  # the sandbox refused a file access: Stata's "file could not be opened"
                rc, error = RC_FILE, f"file could not be opened: {e.strerror or e}"
                self._tee(f"{error}\nr({rc});\n", "error")
                self._recover(rc)
            except Exception as e:  # noqa: BLE001 - any engine bug becomes an error result, not a crash
                if _out_of_memory(
                    e
                ):  # outside a command (a loop's own work; a command's is r(909) already): Stata's 909
                    if self.on_memory_error is not None:
                        self.on_memory_error()  # before anything below allocates: the heap is full
                    rc, error = RC_NOMEM, NOMEM
                    self._tee(f"{error}\nr({rc});\n", "error")
                else:
                    rc = RC_INTERNAL
                    error = f"internal engine error: {type(e).__name__}: {e}"
                    self._tee(f"{error}\n{traceback.format_exc(limit=-3)}r({rc});\n", "error")
                self._recover(rc)
            held = set(self.session.macros._frames[0].values())  # temporary names a top-level local still holds
            self._temp_names = {n for n in self._temp_names if n in held} | {
                str(n) for n in scope.tempvars + scope.tempnames + scope.tempfiles
            }
            if scope in self.session.scopes:  # _recover() already closed it after an escaped exception
                self.session.scopes.remove(scope)
                self.session.close_scope(scope)
            if rc and error is None:
                error = _last_error(self._capture.text)
            refused = _refusal_for(error) if rc == RC_FILE and "dofile sandbox" not in (error or "") else None
            if (
                refused
            ):  # OpenDTA's own 603 message (graph export) hides why: say it was the sandbox, not a missing folder
                error = f"{error} ({refused})"
                if refused not in _annotate_refusals(
                    self._capture.text
                ):  # not OpenDTA's usual wording: add it at the end
                    self._tee(f"{refused}\n", "error")
            elif (
                rc == 601 and error and _TEMPFILE.search(error)
            ):  # the local names it, the call's scope deleted the file
                self._tee(f"({self.tempfile_hint})\n", "error")
                error = f"{error} ({self.tempfile_hint})"
        finally:
            _ticking = None
            self._tee.stop()
        log = self._capture.text  # built once: it joins up to 2 MB
        failed = _failed_command(log) if rc else None
        shown = list(zip(store.drawn, store.commands))[-MAX_IMAGES:] if images else []
        drawn = [(png, cmd) for png, cmd in ((_png(g, plot_theme), cmd) for g, cmd in shown) if png]
        d = self.session.data
        result = Result(
            _annotate_refusals(log),
            rc,
            error,
            self.results(),
            failed,
            d.nobs,
            len(d.names),
            len(store.drawn),
            [png for png, _ in drawn],
            error_line=self._error_line() if rc else None,
            graph_commands=[text for _, (text, _) in drawn],
            graph_lines=[line for _, (_, line) in drawn],
        )
        store.clear_drawn()  # don't keep graphs alive past the call
        self._frames.clear()
        self._failure, self._top = None, set()
        return result

    def _recover(self, rc: int) -> None:
        """Leave the interpreter usable after an escaped exception: close open scopes and prefixes."""
        s = self.session
        for scope in reversed(s.scopes):  # close_scope() cleans up but does not pop
            s.close_scope(scope)
        s.scopes.clear()
        s.do_depth = 0
        s.by_groups = None
        brk.clear()  # the exception left the commands it was in
        s.set_rc(rc)

    def results(self) -> dict[str, Any]:
        """e() and r() as they are now, with whether the last call changed each (False: left from an earlier call,
        e.g. e() after `clear` still describes a model on data that is gone, r() after a failed command)."""
        s = self.session
        e0, r0 = getattr(self, "_before", (None, None))
        return {
            "e": group_results(s.e),
            "r": group_results(s.r),
            "e_changed": e0 is None or not _same(e0, s.e),
            "r_changed": r0 is None or not _same(r0, s.r),
        }

    def matrix(
        self, name: str, rows: list[str] | None = None, cols: list[str] | None = None, max_cells: int | None = None
    ) -> dict[str, Any]:
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
                return {
                    "error": f"{name} has no {axis[:-1]} named {', '.join(bad)} (it has {len(have)}, e.g. "
                    f"{', '.join(have[:5])})"
                }
            idx[axis] = [have.index(w) for w in want] if want else range(len(have))
        n_rows, n_cols = len(idx["rows"]), len(idx["cols"])
        if max_cells is not None and n_rows * n_cols > max_cells:
            return {"error": f"{name} has {n_rows}x{n_cols} values, more than {max_cells}; ask for some rows/cols"}
        return {
            "rows": [names["rows"][i] for i in idx["rows"]],
            "cols": [names["cols"][j] for j in idx["cols"]],
            "data": [[to_json(float(mx.data[i][j])) for j in idx["cols"]] for i in idx["rows"]],
        }

    def data_summary(self, vars: str | None = None, offset: int = 0, limit: int | None = None) -> dict[str, Any]:
        """The dataset's variables; `vars` is a Stata varlist (`inc* age`), `offset`/`limit` page through it.
        Problems come back as {"error": message}."""
        from ._vendor.opendta.core.errors import StataError

        d = self.session.data
        try:
            names = self.session.expand_varlist(vars) if vars and vars.strip() else list(d.names)
        except StataError as e:
            return {"error": e.message}
        return _summary(d, names, offset, limit, getattr(d, "filename", None) or None)

    def describe_file(self, path: str) -> dict[str, Any]:
        """data_summary() of a .dta file in the working folder, read apart: the data in memory, e(), r() and the log
        stay as they were. Problems come back as {"error": message}."""
        from ._vendor.opendta.core.errors import StataError
        from ._vendor.opendta.core.userpath import user_path
        from ._vendor.opendta.io.dta import read_dta

        if not isinstance(path, str) or not path.strip():
            return {"error": "no file name given"}
        try:
            p = user_path(Path(path))
            if p.suffix == "" and p.name not in ("", ".", ".."):
                p = p.with_suffix(".dta")
            if not p.resolve().is_relative_to(Path.cwd().resolve()):
                return {"error": f"not in the working folder: {path}"}
            if not p.is_file():
                return {"error": f"file {path} not found"}
            d = read_dta(p)
        except StataError as e:
            return {"error": e.message or f"file {path} could not be read"}
        except Exception as e:  # noqa: BLE001 - not a .dta, or a damaged one; a sandbox refusal is an OSError
            return {"error": f"file {path} could not be read: {e}"}
        return _summary(d, list(d.names), 0, None, path)

    def macros(self) -> dict[str, Any]:
        """The top-level locals and all globals, and the names in `globals` that still hold the engine's own value.
        Locals set by tempvar, tempname or tempfile (their names are gone when their call ended) are left out; a
        local the user set to a value that only looks like one is kept."""
        from ._vendor.opendta.session import DEFAULT_GLOBALS

        m = self.session.macros
        glob = dict(m.globals)
        return {
            "locals": {k: v for k, v in m._frames[0].items() if v not in self._temp_names},
            "globals": glob,
            "system_globals": [k for k, v in glob.items() if DEFAULT_GLOBALS.get(k) == v],
        }

    def data_rows(self, vars: str | None = None, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        """Observations offset+1 to offset+limit of the variables `vars` (a varlist, as in data_summary), each value
        as `list` prints it: display format and value label applied, missing as `.`. Problems come back as
        {"error": message}."""
        from ._vendor.opendta.commands.inspect import cell_text
        from ._vendor.opendta.core.errors import StataError

        d = self.session.data
        try:
            names = self.session.expand_varlist(vars) if vars and vars.strip() else list(d.names)
        except StataError as e:
            return {"error": e.message}
        offset, limit = max(int(offset), 0), max(int(limit), 0)
        end = min(offset + limit, d.nobs)
        cols = [d.get(n) for n in names]
        rows = [[cell_text(d, v, i) for v in cols] for i in range(offset, end)]
        return {
            "nobs": d.nobs,
            "offset": offset,
            "vars": names,
            "more": max(d.nobs - max(end, offset), 0),
            "rows": rows,
        }

    def memory(self) -> dict[str, int]:
        """The size of the dataset's values in memory, in bytes (strings estimated from their content)."""
        return {"data_bytes": sum(v.nbytes for v in self.session.data.vars)}


def _summary(d, names: list[str], offset: int, limit: int | None, filename: str | None) -> dict[str, Any]:
    page = names[offset : offset + limit] if limit is not None else names[offset:]
    variables = []
    for name in page:
        v = d.get(name)
        variables.append(
            {
                "name": name,
                "type": v.vtype,
                "format": v.fmt,
                "label": v.label or None,
                "value_label": v.value_label or None,
            }
        )
    return {
        "nobs": d.nobs,
        "nvars": len(d.names),
        "matched": len(names),
        "offset": offset,
        "variables": variables,
        "more": max(len(names) - offset - len(page), 0),
        "filename": filename,
    }


def _failed_command(log: str) -> str | None:
    """The last command echoed (`. cmd`, with its `> ` continuation lines) before the last `r(#);`."""
    lines = log.splitlines()
    end = max((i for i, ln in enumerate(lines) if ln.startswith("r(") and ln.rstrip().endswith(");")), default=None)
    if end is None:
        return None
    for i in range(end, -1, -1):
        if lines[i].startswith(". "):
            cmd = [lines[i][2:]]
            for ln in lines[i + 1 : end]:
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
