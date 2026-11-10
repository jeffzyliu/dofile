"""Web demo only: make numpy's `inv`, `solve` and `cholesky` raise `LinAlgError` again in WebAssembly.

In Pyodide (numpy 2.4.6) these three return NaN arrays instead of raising `LinAlgError` for a singular or not
positive definite matrix, probably because numpy reports the failure through the floating-point "invalid" flag,
which WebAssembly cannot set or read. `scipy.linalg` raises correctly. The engine relies on the exception in about
100 places; the one that was found first is `ml.maximize` testing concavity with `cholesky(-H)`, which never saw a
non-concave Hessian in the browser and crawled to its 16,000-iteration limit (docs/browser-engine.md, "Open investigation").

`install()` runs each function on a matrix that must fail and wraps only the ones that do not raise, so it does
nothing on CPython and switches itself off if numpy is fixed. The wrapper raises when the inputs are all finite and the
result has one. The engine calls `np.linalg.X` through the module at call time (no `from numpy.linalg import`), so
replacing the attribute reaches all of it; a test checks that this stays true.
"""

from __future__ import annotations

import numpy as np

_FUNCTIONS = ("inv", "solve", "cholesky")
_MESSAGES = {"inv": "Singular matrix", "solve": "Singular matrix", "cholesky": "Matrix is not positive definite"}
_installed: dict[str, object] = {}   # name -> the original function, for the functions that were wrapped


def _probe(name: str) -> bool:
    """True if numpy raises LinAlgError for a matrix that must fail."""
    f = getattr(np.linalg, name)
    try:
        if name == "cholesky":
            f(-np.eye(2))
        elif name == "inv":
            f(np.zeros((2, 2)))
        else:
            f(np.zeros((2, 2)), np.ones(2))
    except np.linalg.LinAlgError:
        return True
    return False


def _wrap(name: str, f):
    def wrapped(a, *args, **kwargs):
        r = f(a, *args, **kwargs)
        # cholesky raises for a NaN matrix on CPython too; inv and solve pass on a NaN or inf that was in the input
        if np.isnan(r).any() and (name == "cholesky" or all(np.isfinite(x).all() for x in (a, *args))):
            raise np.linalg.LinAlgError(_MESSAGES[name])
        return r
    wrapped.__name__ = name
    wrapped.__doc__ = f.__doc__
    wrapped.__wrapped__ = f
    return wrapped


def install(force: bool = False) -> list[str]:
    """Wrap the functions that do not raise. Returns their names. `force` wraps all three (for tests on CPython)."""
    done = []
    for name in _FUNCTIONS:
        if name in _installed:
            continue
        f = getattr(np.linalg, name)
        if force or not _probe(name):
            _installed[name] = f
            setattr(np.linalg, name, _wrap(name, f))
            done.append(name)
    return done


def uninstall() -> None:
    """Put the original functions back (tests)."""
    for name, f in _installed.items():
        setattr(np.linalg, name, f)
    _installed.clear()
