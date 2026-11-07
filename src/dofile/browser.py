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

from . import linalgshim, pathshim, sandbox
from .engine import Engine, about, clear_break, matrix_sizes, request_break

DENIED = ("shell", "webuse")   # no programs and no network in a browser; file commands only touch the page's own files

_eng: Engine | None = None
_busy = False


def _on_interrupt(signum, frame) -> None:
    if _busy:   # a Break that comes between runs must not stop the next one
        request_break()


def start(root: str = "/work") -> str:
    """Set up the engine in `root` (once per worker). Returns the versions as JSON."""
    global _eng
    linalgshim.install()   # numpy.linalg in WebAssembly returns NaN instead of raising LinAlgError (before any fit)
    sandbox.deny_commands(DENIED)
    _eng = Engine(root)   # console hints on: a person reads this log
    pathshim.install(root, lambda m: _eng.session.output.write(m + "\n", "text"))
    signal.signal(signal.SIGINT, _on_interrupt)
    return json.dumps(about())


def run(code: str, images: bool = True) -> str:
    """Run Stata code like a do-file. JSON: rc, error, error_command, log, results (e() and r(), matrices by size: values
    come from matrix()), nobs, nvars,
    new_graphs, images (PNG, base64). The page lists the working folder itself after each run."""
    global _busy
    clear_break()
    _busy = True
    try:
        r = _eng.run(code, images=images)
    finally:
        _busy = False
    return json.dumps({"rc": r.rc, "error": r.error, "error_command": r.error_command, "log": r.log,
                       "results": matrix_sizes(r.results), "nobs": r.nobs, "nvars": r.nvars,
                       "new_graphs": r.new_graphs, "images": [base64.b64encode(p).decode() for p in r.images]})


def describe(vars: str | None = None, offset: int = 0, limit: int | None = None) -> str:
    return json.dumps(_eng.data_summary(vars, offset, limit))


def matrix(name: str) -> str:
    return json.dumps(_eng.matrix(name))
