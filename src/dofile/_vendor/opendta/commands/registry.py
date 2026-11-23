"""Command registry and abbreviation resolution.

Each command declares its full name and minimal abbreviation (the
underlined part in the manual's syntax diagram). E.g.: display -> "di".
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import import_module
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
        REGISTRY[name] = CommandSpec(name, len(minimal), _memory_error_as_stata(fn), prefix, byable)
        return fn
    return deco


def lazy_commands(module: str, *names: str | tuple[str, str], prefix: bool = False) -> None:
    """Registers commands whose code, cmd_<name> in opendta.estimation.<module>, is imported on
    first use (start-up time). A name may be given with its minimal abbreviation: ("regress", "reg")."""
    for entry in names:
        name, abbrev = entry if isinstance(entry, tuple) else (entry, entry)

        def run(s: "Session", args: str, _target=f"cmd_{name}") -> None:
            getattr(import_module(f"dofile._vendor.opendta.estimation.{module}"), _target)(s, args)
        run.__name__ = f"cmd_{name}"
        command(name, abbrev, prefix=prefix)(run)


def _memory_error_as_stata(fn: CommandFn) -> CommandFn:
    """dofile patch (ODT-28): a MemoryError that escapes a command (numpy could not allocate an array) becomes
    r(909) "op. sys. refuses to provide memory", which `capture` can catch, not an internal error. OpenDTA turns an
    OSError into r(603) itself (`_as_stata_error` in lang/interpreter.py). The data is not rolled back: a command that
    fails partway may leave it partly changed."""
    def run(s: "Session", rest: str) -> None:
        try:
            fn(s, rest)
        except MemoryError as e:
            from ..core.errors import StataError
            raise StataError(909, "op. sys. refuses to provide memory") from e
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
