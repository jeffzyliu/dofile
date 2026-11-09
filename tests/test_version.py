"""`__version__` comes from the installed metadata (built from pyproject.toml); MCP-SCHEMA.md names the minor series.

The first test also fails when an editable install is stale (pyproject.toml bumped, package not reinstalled): run
`uv sync`. A bare source tree reports pyproject.toml's version plus the local tag `+src`."""
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from packaging.version import Version

from dofile import __version__

ROOT = Path(__file__).resolve().parent.parent


def _pyproject_version() -> str:
    pyproject = ROOT / "pyproject.toml"
    if not pyproject.exists():
        pytest.skip("no pyproject.toml next to the tests")
    return tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]["version"]


def test_version_matches_pyproject():
    assert __version__.split("+")[0] == _pyproject_version()


def test_source_tree_version_has_the_src_tag():
    # A fresh interpreter in which the package has no metadata (the lookup is made to fail), importing src/ directly.
    expected = _pyproject_version() + "+src"
    code = (
        "import importlib.metadata as m, sys\n"
        "def no_metadata(name): raise m.PackageNotFoundError(name)\n"
        "m.version = no_metadata\n"
        f"sys.path.insert(0, {str(ROOT / 'src')!r})\n"
        "import dofile\n"
        "print(dofile.__version__)\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.strip()
    assert out == expected


def test_mcp_schema_names_the_minor_series():
    """A patch release never changes the schema (while dofile is 0.x a breaking change raises the minor version, per
    CLAUDE.md), so MCP-SCHEMA.md says `0.1.x` and is edited by hand only when the minor version changes."""
    schema = ROOT / "MCP-SCHEMA.md"
    if not schema.exists():
        pytest.skip("no MCP-SCHEMA.md next to the tests")
    v = Version(__version__.split("+")[0])
    assert f"For dofile `{v.major}.{v.minor}.x`" in schema.read_text(encoding="utf-8")
