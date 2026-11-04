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


@dataclass
class Result:
    log: str
    rc: int
    error: str | None = None
    results: dict[str, Any] = field(default_factory=dict)


def to_json(v: Any) -> Any:
    """e()/r() values as JSON: numbers, strings, matrices; Stata missing as None or ".a"-".z"."""
    if isinstance(v, str):
        return v
    if hasattr(v, "data") and hasattr(v, "rownames"):  # Matrix
        return {"rows": list(v.rownames), "cols": list(v.colnames),
                "data": [[to_json(float(x)) for x in row] for row in v.data]}
    try:
        x = float(v)
    except (TypeError, ValueError):
        return str(v)
    if missing.is_missing(x) or x != x:
        name = missing.missing_name(x) if x == x else "."
        return None if name == "." else name
    return int(x) if x.is_integer() and abs(x) < 2**53 else x


class Engine:
    def __init__(self, workdir: str | os.PathLike | None = None):
        if workdir is not None:
            os.chdir(workdir)
        self._capture = Capture()
        self.session = Session()
        self.session.output.add_listener(self._capture)

    def run(self, code: str) -> Result:
        """Runs Stata code like a do-file (commands echoed as `. cmd`) and returns its log."""
        self._capture.clear()
        error = None
        try:
            rc = self.session.run(code, echo=True)
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
        return Result(self._capture.text, rc, error, self.results())

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
        return {"e": {k: to_json(v) for k, v in s.e.items()},
                "r": {k: to_json(v) for k, v in s.r.items()}}

    def data_summary(self) -> dict[str, Any]:
        d = self.session.data
        variables = []
        for name in d.names:
            v = d.get(name)
            variables.append({"name": name, "type": v.vtype, "format": v.fmt,
                              "label": v.label or None, "value_label": v.value_label or None})
        return {"nobs": d.nobs, "nvars": len(variables), "variables": variables,
                "filename": getattr(d, "filename", None) or None}


def _last_error(log: str) -> str | None:
    """The Stata error message: the line before the last `r(#);`, skipping OpenDTA's hint lines."""
    lines = [ln for ln in log.splitlines() if ln.strip()]
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].startswith("r(") and lines[i].rstrip().endswith(");"):
            for j in range(i - 1, -1, -1):
                if not lines[j].startswith(" "):  # hints are indented
                    return lines[j].strip()
    return None
