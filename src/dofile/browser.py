"""Web demo: what the browser's Web Worker calls through Pyodide. One Engine per worker, in the working folder `root`.

Every function takes and returns plain values; results come back as JSON text, so the worker needs one
`JSON.parse` and no Python-to-JS conversion. The browser tab is the sandbox, so only commands that reach outside the
page are denied; file names written for someone's computer are mapped into `root` (pathshim). The page's Break
button sets Pyodide's interrupt buffer, which runs our SIGINT handler: the engine stops at the next safe point
(PATCH-2), as in the MCP worker.
"""

from __future__ import annotations

import base64
import json
import signal
import time

from . import linalgshim, pathshim, sandbox
from .engine import LOG_KEEP, Engine, about, clear_break, matrix_sizes, request_break

DENIED = ("shell", "webuse")  # no programs and no network in a browser; file commands only touch the page's own files
# The note under the error about a tempfile an earlier run deleted. A draft: step 4d's word list replaces it (OQ-10).
TEMPFILE_HINT = "a tempfile lasts one run: save it under a name to use it in a later run"

_eng: Engine | None = None
_busy = False


def _on_interrupt(signum, frame) -> None:
    if _busy:  # a Break that comes between runs must not stop the next one
        request_break()


def start(root: str = "/work") -> str:
    """Set up the engine in `root` (once per worker). Returns the versions as JSON."""
    global _eng
    linalgshim.install()  # numpy.linalg in WebAssembly returns NaN instead of raising LinAlgError (before any fit)
    sandbox.deny_commands(DENIED)
    # Console hints on: a person reads this log. A run's log keeps its first and last LOG_KEEP characters (1 M each, as
    # for MCP): far more than a person reads, small enough for the page to hold and show. A runaway loop prints about
    # 5 MB/s, so it reaches the cap within a second instead of filling the worker's memory.
    _eng = Engine(root, log_keep=LOG_KEEP, tempfile_hint=TEMPFILE_HINT)
    pathshim.install(root, lambda m: _eng.session.output.write(m + "\n", "text"))
    signal.signal(signal.SIGINT, _on_interrupt)
    return json.dumps(about())


def run(
    code: str, images: bool = True, fresh_locals: bool = False, plot_theme: str | None = None, on_output=None
) -> str:
    """Run Stata code like a do-file. JSON: rc, error, error_command, error_line (1-based line in `code` of the command
    that failed; null for rc 0 or an error inside a nested do-file), log, results (e() and r(), matrices by size: values
    come from matrix()), nobs, nvars, new_graphs, images (PNG, base64), graph_commands (the command that drew each image),
    graph_lines (that command's first line in `code`, null if unknown), graph_themes ("light" or "dark": how each image
    was drawn; a graph whose command names a color is drawn light whatever `plot_theme` says), timing (seconds: engine, which includes drawing the graphs, and encode, the base64 of the images; the page shows them
    to say where a slow run went). The page lists the working folder itself after each run.
    `fresh_locals`: clear the locals first (a whole-file run). `plot_theme`: "dark" draws the images dark.
    `on_output(text)`: a JS function given the log as it grows, at most every 0.1 s while a command writes (a JS null or
    undefined, or anything not callable, means none). The chunks are only a preview: they stop at the log cap with no
    marker, and notes may be added after the run. When the result comes, the page replaces the streamed text with the
    JSON's log, never appends to it."""
    global _busy
    clear_break()
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
    finally:
        _busy = False
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
            "graph_themes": r.graph_themes,
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
