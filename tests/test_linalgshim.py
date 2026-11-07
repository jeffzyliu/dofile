"""The WebAssembly numpy.linalg shim (src/dofile/linalgshim.py), tested on CPython.

CPython's numpy already raises LinAlgError, so the bug the shim works around cannot happen here: these tests pin the
shim's logic by making the three functions behave the way Pyodide's do (return NaN), and check the assumption the shim
rests on. The behaviour of the real WebAssembly numpy is tested in Pyodide: web/test/linalgshim.test.mjs.
"""

from pathlib import Path
import re

import numpy as np
import pytest

from dofile import linalgshim

SINGULAR = np.array([[1.0, 2.0], [2.0, 4.0]])


@pytest.fixture
def wasm_like(monkeypatch):
    """np.linalg.inv, solve and cholesky return NaN for a matrix that must fail, as in Pyodide; the shim is removed after."""
    real = {n: getattr(np.linalg, n) for n in ("inv", "solve", "cholesky")}

    def nan_instead(name):
        def f(a, *args, **kw):
            try:
                return real[name](a, *args, **kw)
            except np.linalg.LinAlgError:
                shape = np.shape(args[0]) if name == "solve" else np.shape(a)
                return np.full(shape, np.nan)
        return f

    for n in real:
        monkeypatch.setattr(np.linalg, n, nan_instead(n))
    yield
    linalgshim.uninstall()   # before monkeypatch puts the originals back


def test_nothing_to_do_where_numpy_raises():
    assert linalgshim.install() == []
    with pytest.raises(np.linalg.LinAlgError):
        np.linalg.inv(SINGULAR)


def test_functions_that_return_nan_are_wrapped(wasm_like):
    assert np.isnan(np.linalg.inv(SINGULAR)).all()   # the Pyodide behaviour, simulated
    assert linalgshim.install() == ["inv", "solve", "cholesky"]
    with pytest.raises(np.linalg.LinAlgError, match="Singular"):
        np.linalg.inv(SINGULAR)
    with pytest.raises(np.linalg.LinAlgError, match="Singular"):
        np.linalg.solve(SINGULAR, np.ones(2))
    with pytest.raises(np.linalg.LinAlgError, match="positive definite"):
        np.linalg.cholesky(-np.eye(3))   # what ml.maximize asks about a non-concave Hessian
    assert linalgshim.install() == []   # twice does nothing


def test_good_matrices_and_nan_input_are_left_alone(wasm_like):
    linalgshim.install()
    A = np.array([[4.0, 1.0], [1.0, 3.0]])
    assert np.allclose(np.linalg.inv(A) @ A, np.eye(2))
    assert np.allclose(np.linalg.solve(A, np.ones(2)), np.linalg.inv(A) @ np.ones(2))
    assert np.allclose(np.linalg.cholesky(A) @ np.linalg.cholesky(A).T, A)
    # a NaN that was already in the input is the caller's, not a failed factorisation: inv and solve pass it on, as in numpy
    nan_matrix = np.array([[np.nan, 0.0], [0.0, 1.0]])
    assert np.isnan(np.linalg.inv(nan_matrix)).any()
    assert np.isnan(np.linalg.solve(nan_matrix, np.ones(2))).any()
    # ... but numpy's cholesky raises for a NaN matrix (it is not positive definite), so the shim does too
    with pytest.raises(np.linalg.LinAlgError):
        np.linalg.cholesky(nan_matrix)
    # stacks of matrices: one bad matrix is an error, as in numpy
    with pytest.raises(np.linalg.LinAlgError):
        np.linalg.inv(np.stack([A, SINGULAR]))


def test_uninstall_restores_the_functions(wasm_like):
    before = np.linalg.inv
    linalgshim.install()
    assert np.linalg.inv is not before
    linalgshim.uninstall()
    assert np.linalg.inv is before


def test_the_engine_reaches_numpy_linalg_through_the_module():
    """The shim replaces attributes of np.linalg, so it only works if the engine never copies the functions with
    `from numpy.linalg import inv` (or `import numpy.linalg as la` at import time, before install())."""
    root = Path(linalgshim.__file__).parent / "_vendor" / "opendta"
    bad = []
    for f in root.rglob("*.py"):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"from numpy\.linalg import|from numpy import .*\blinalg\b|import numpy\.linalg|\blinalg as\b", line):
                bad.append(f"{f.relative_to(root)}:{n}: {line.strip()}")
    assert not bad, "the shim would miss these:\n" + "\n".join(bad)
