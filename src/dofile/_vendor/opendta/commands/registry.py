"""Command registry and abbreviation resolution.

Each command declares its full name and minimal abbreviation (the
underlined part in the manual's syntax diagram). E.g.: display -> "di".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from ..session import Session

CommandFn = Callable[["Session", str], None]


@dataclass(frozen=True)
class CommandSpec:
    name: str
    min_abbrev: int
    fn: CommandFn
    prefix: bool = False  # quietly, noisily, capture, version: take a command
    byable: bool = False  # aceita o prefixo by


REGISTRY: dict[str, CommandSpec] = {}


def command(name: str, abbrev: str | None = None, *, prefix: bool = False, byable: bool = False):
    """Registers a command. `abbrev` is the minimal accepted form (default: full name)."""
    minimal = abbrev or name
    if not name.startswith(minimal):
        raise ValueError(f"abbreviation {minimal!r} is not a prefix of {name!r}")

    def deco(fn: CommandFn) -> CommandFn:
        REGISTRY[name] = CommandSpec(name, len(minimal), _file_errors_as_603(fn), prefix, byable)
        return fn
    return deco


def _file_errors_as_603(fn: CommandFn) -> CommandFn:
    """dofile patch (ODT-28): an OSError that escapes a command (a folder that is missing, a directory where a file is
    expected) becomes Stata's r(603) "file ... could not be opened", which `capture` can catch, not an internal error.
    A command's own StataError (erase 693, cd 170, ...) never gets here. A PermissionError is left alone: the dofile
    sandbox's refusals use it (ODT-23)."""
    def run(s: "Session", rest: str) -> None:
        try:
            fn(s, rest)
        except PermissionError:
            raise
        except OSError as e:
            from ..core.errors import StataError
            where = f" {e.filename}" if e.filename else ""
            raise StataError(603, f"file{where} could not be opened ({e.strerror})") from e
    run.__name__, run.__doc__ = getattr(fn, "__name__", "run"), fn.__doc__
    return run


def lookup(word: str) -> CommandSpec | None:
    spec = REGISTRY.get(word)
    if spec is not None:
        return spec
    # with more than one candidate (sca: scalar or scatter), the one with the longest minimal
    # abbreviation wins: it is the one the manual reserves for that form
    best = None
    for spec in REGISTRY.values():
        if len(word) >= spec.min_abbrev and spec.name.startswith(word):
            if best is None or spec.min_abbrev > best.min_abbrev:
                best = spec
    return best


def all_commands() -> list[str]:
    return sorted(REGISTRY)
