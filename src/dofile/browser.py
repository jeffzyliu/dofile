"""Web demo: what the browser's Web Worker calls through Pyodide. One Engine per worker, in the working folder `root`.

Every function takes and returns plain values; results come back as JSON text, so the worker needs one
`JSON.parse` and no Python-to-JS conversion. The browser tab is the sandbox, so only commands that reach outside the
page are denied; file names written for someone's computer are mapped into `root` (pathshim). The page's Break
button sets Pyodide's interrupt buffer, which runs our SIGINT handler: the engine stops at the next safe point
(PATCH-2), as in the MCP worker.
"""

from __future__ import annotations

import base64
import importlib
import json
import signal
import sys
import sysconfig
import time

from . import linalgshim, pathshim, sandbox
from .engine import (
    LOG_KEEP,
    NOMEM,
    RC_NOMEM,
    Engine,
    Result,
    about,
    clear_break,
    flush_output,
    matrix_sizes,
    request_break,
)

DENIED = ("shell", "webuse")  # no programs and no network in a browser; file commands only touch the page's own files
# The note under the error about a tempfile an earlier run deleted. A draft: step 4d's word list replaces it (OQ-10).
TEMPFILE_HINT = "a tempfile lasts one run: save it under a name to use it in a later run"

# Memory kept in reserve (memory cap, docs/browser-engine.md): when the heap is full, even the interpreter's own error
# handling and the next call's compile need a little room, and without it every later call fails ("lost sys.stderr"), so
# the session cannot recover. A run that ends in "out of memory" frees this, and the next run takes it again if it can.
BALLAST = 20_000_000

_eng: Engine | None = None
_busy = False
_put_back = None  # keep_breaks
_ballast: bytearray | None = None


def _hold_ballast() -> None:
    global _ballast
    if _ballast is None:
        try:
            _ballast = bytearray(BALLAST)
        except MemoryError:  # no room for it now: the run goes without, the next one tries again
            pass


def _free_ballast() -> None:
    global _ballast
    _ballast = None


def _on_interrupt(signum, frame) -> None:
    if _busy:
        request_break()
    elif _put_back is not None:  # not dropped: the top of run(), before it is busy, reads a Break meant for it
        _put_back()


def keep_breaks(put_back) -> None:
    """`put_back()`, a JS function, writes SIGINT into Pyodide's interrupt buffer again. A Break read while no run is
    busy is put back there: the run reads it again once busy, and the page clears the buffer when it sends a run, so a
    Break left from the run before stops nothing. Once, after start()."""
    global _put_back
    _put_back = put_back


def start(root: str = "/work") -> str:
    """Set up the engine in `root` (once per worker). Returns the versions as JSON."""
    global _eng
    linalgshim.install()  # numpy.linalg in WebAssembly returns NaN instead of raising LinAlgError (before any fit)
    sandbox.deny_commands(DENIED)
    # Console hints on: a person reads this log. A run's log keeps its first and last LOG_KEEP characters (1 M each, as
    # for MCP): far more than a person reads, small enough for the page to hold and show. A runaway loop prints about
    # 5 MB/s, so it reaches the cap within a second instead of filling the worker's memory.
    _eng = Engine(root, log_keep=LOG_KEEP, tempfile_hint=TEMPFILE_HINT)
    _eng.on_memory_error = _free_ballast  # the engine frees it before it writes the error: the heap is full
    pathshim.install(root, lambda m: _eng.session.output.write(m + "\n", "text"))
    signal.signal(signal.SIGINT, _on_interrupt)
    _hold_ballast()
    return json.dumps(about())


def run(
    code: str, images: bool = True, fresh_locals: bool = False, plot_theme: str | None = None, on_output=None
) -> str:
    """Run Stata code like a do-file. JSON: rc, error, error_command, error_line (1-based line in `code` of the command
    that failed; null for rc 0 or an error inside a nested do-file), log, results (e() and r(), matrices by size: values
    come from matrix()), nobs, nvars, new_graphs, images (PNG, base64), graph_commands (the command that drew each image),
    graph_lines (that command's first line in `code`, null if unknown), timing (seconds: engine, which includes drawing the graphs, and encode, the base64 of the images; the page shows them
    to say where a slow run went). The page lists the working folder itself after each run.
    `fresh_locals`: clear the locals first (a whole-file run). `plot_theme`: "dark" draws the images dark.
    `on_output(text)`: a JS function given the log as it grows, at most every 0.1 s while a command writes (a JS null or
    undefined, or anything not callable, means none). The chunks are only a preview: they stop at the log cap with no
    marker, and notes may be added after the run. When the result comes, the page replaces the streamed text with the
    JSON's log, never appends to it."""
    global _busy
    clear_break()
    _hold_ballast()
    _busy = True
    t0 = time.perf_counter()
    try:
        r = _eng.run(
            code,
            images=images,
            fresh_locals=fresh_locals is True,
            plot_theme=plot_theme if plot_theme in ("light", "dark") else None,
            on_output=on_output if callable(on_output) else None,
        )
    except MemoryError:
        # The heap filled again while the engine was reporting its own MemoryError (it frees the ballast before it
        # does, and a command's own is r(909) already): free it, if that did not happen, and answer as the engine would.
        _free_ballast()
        d = _eng.session.data
        r = Result(f"{NOMEM}\nr({RC_NOMEM});\n", RC_NOMEM, NOMEM, _eng.results(), nobs=d.nobs, nvars=len(d.names))
    finally:
        _busy = False
    if r.rc == RC_NOMEM:
        _free_ballast()  # room for the result below, and for the calls the page makes next (memory, describe, browse)
    t1 = time.perf_counter()
    encoded = [base64.b64encode(p).decode() for p in r.images]
    return json.dumps(
        {
            "rc": r.rc,
            "error": r.error,
            "error_command": r.error_command,
            "error_line": r.error_line,
            "log": r.log,
            "results": matrix_sizes(r.results),
            "nobs": r.nobs,
            "nvars": r.nvars,
            "new_graphs": r.new_graphs,
            "images": encoded,
            "graph_commands": r.graph_commands,
            "graph_lines": r.graph_lines,
            "timing": {"engine": t1 - t0, "encode": time.perf_counter() - t1},
        }
    )


def describe(vars: str | None = None, offset: int = 0, limit: int | None = None) -> str:
    return json.dumps(_eng.data_summary(vars, offset, limit))


def describe_file(path: str) -> str:
    """The variables of a .dta in the working folder, without loading it (data in memory, r() and the log unchanged)."""
    return json.dumps(_eng.describe_file(path))


def matrix(name: str) -> str:
    return json.dumps(_eng.matrix(name))


def macros() -> str:
    """{locals, globals, system_globals}: the top-level locals, all globals, and the globals the engine set itself."""
    return json.dumps(_eng.macros())


def browse(vars: str | None = None, offset: int = 0, limit: int = 50) -> str:
    """Observations offset+1 to offset+limit of `vars` (a varlist; None: all), each value as `list` prints it."""
    return json.dumps(_eng.data_rows(vars, offset or 0, 50 if limit is None else limit))


def memory() -> str:
    """{data_bytes}: the dataset's size in memory (the worker adds the WebAssembly heap)."""
    return json.dumps(_eng.memory())


# ---- the lazy graphics part (web/src/engine/worker.ts, waitGraphics; experiment E1c) ----
# In a lazy snapshot, matplotlib and what only it needs are not in the heap: the page downloads them after the start and the
# worker writes them into site-packages. Only a graph waits for them: the graph store's put (inside the graph command, so a
# Break while waiting is an ordinary Break, rc 1, and nothing is half stored), and a finder for any other import of
# matplotlib (graph export of a graph drawn earlier). Every other run never waits: the part's other packages (PIL, dateutil,
# ...) are simply not found until it is written, as an optional import expects.
GRAPHICS_WAIT = frozenset({"matplotlib", "mpl_toolkits", "pylab"})
GRAPHICS_RC = 199  # as ODT-32's "not available" errors


class _LazyGraphics:
    """A sys.meta_path finder that finds nothing: importing matplotlib first waits for the part to be written."""

    def __init__(self, wait) -> None:
        # wait(ms), a JS function: "" the files are written; "pending" ms passed; "break" the Break was pressed; else why
        # the files cannot be had
        self.wait = wait
        self.ready = False

    def ensure(self) -> None:
        if self.ready:
            return
        from ._vendor.opendta.core import brk
        from ._vendor.opendta.core.errors import StataError

        said = False
        while True:
            brk.check()  # a Break the SIGINT handler took before or between the waits
            # what the run printed so far reaches the page now, not when the graph is done: one wait may take seconds
            # (it unpacks, writes, or without a shared buffer downloads the part), and brk.check sends only what is
            # STREAM_EVERY old
            flush_output()
            why = self.wait(100)
            if why == "pending":
                if not said and _eng is not None:
                    _eng.session.output.write("(waiting for the graphics files to download)\n", "text")
                    said = True
                continue
            if why == "break":
                request_break()
                brk.check()  # KeyboardInterrupt: the engine's Break (rc 1), data kept
            if why == "":
                self.ready = True
                importlib.invalidate_caches()
                return
            raise StataError(GRAPHICS_RC, f"graphs are not available: {why}")

    def find_spec(self, name, path=None, target=None) -> None:
        """Finds nothing: the ordinary finders find the files (or not, before they are written)."""
        if not self.ready and name.partition(".")[0] in GRAPHICS_WAIT:
            self.ensure()


_graphics: _LazyGraphics | None = None
_warm: list[str] | None = None


def lazy_graphics(wait) -> None:
    """A lazy snapshot: graphs wait for the graphics part (`wait`, see _LazyGraphics). Once, after start()."""
    global _graphics
    _graphics = _LazyGraphics(wait)
    sys.meta_path.insert(0, _graphics)
    store = _eng.session._graphs
    put = store.put

    def waiting_put(g, *, replace: bool) -> None:
        _graphics.ensure()  # before the graph is stored: a Break here leaves nothing changed
        put(g, replace=replace)

    store.put = waiting_put


def graphics_written() -> None:
    """The worker wrote the part's files while no graph waited (the engine was idle)."""
    if _graphics is not None:
        _graphics.ready = True
    importlib.invalidate_caches()


def warm_graphics(start: int, count: int = 40) -> int:
    """Import the modules a first graph needs (the build's list, in its order), `count` at a time from `start`, so the first
    graph after the part landed costs what it did with matplotlib in the heap. Returns where to go on, or -1 when done."""
    global _warm
    if _warm is None:
        try:
            with open(f"{sysconfig.get_paths()['purelib']}/_dofile_graphics_warm.txt") as fh:
                _warm = fh.read().split("\n")
        except OSError:
            _warm = []
        # what the engine's renderer loads first (render.py: matplotlib.figure; the font list), then the rest
        _warm = ["matplotlib", "matplotlib.figure", "matplotlib.font_manager", *_warm]
    for name in _warm[start : start + count]:
        try:
            importlib.import_module(name)
        except Exception:  # noqa: BLE001, S112 - a module this page cannot import is imported (and fails) at its first use
            continue
    return start + count if start + count < len(_warm) else -1
