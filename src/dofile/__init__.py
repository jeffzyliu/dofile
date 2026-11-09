"""dofile: run Stata-syntax .do files without a Stata license."""

from importlib.metadata import PackageNotFoundError, version as _version


def _source_tree_version() -> str:
    """`pyproject.toml`'s version plus the local tag `+src`, for a checkout that was never installed (PYTHONPATH=src)."""
    import tomllib
    from pathlib import Path

    try:
        with open(Path(__file__).resolve().parents[2] / "pyproject.toml", "rb") as f:
            return tomllib.load(f)["project"]["version"] + "+src"
    except (OSError, KeyError, ValueError):  # no pyproject.toml next to src/ (not a checkout): nothing to read
        return "0+unknown"


# One source: `version` in pyproject.toml, which the build copies into the installed package's metadata (a wheel, an
# editable install). Bump it with `uv version` (docs/releasing.md); an editable install picks the new number up when
# `uv sync` / `uv run` rebuilds it. A bare source tree has no metadata and reads pyproject.toml itself, tagged `+src`.
try:
    __version__ = _version("dofile")
except PackageNotFoundError:
    __version__ = _source_tree_version()
