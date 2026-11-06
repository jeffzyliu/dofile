"""dofile patch (PATCH-3): every file name the user writes is resolved here, after its default extension is added.
A host can set `mapper` (dofile's web demo maps paths into its virtual working folder). Unset, nothing changes."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

mapper: Callable[[Path], Path] | None = None


def user_path(p: Path) -> Path:
    return mapper(p) if mapper is not None else p
