"""Imported once by the forkserver (see worker._context): loads the engine so each session forks ready to run.

The forkserver is not sandboxed; each child installs the sandbox after the fork, as with spawn.
"""

import os
import sys
import warnings

# with `python -m dofile.mcp_server`, each child re-runs that preloaded module (see worker._context); harmless
warnings.filterwarnings("ignore", "'dofile\\.mcp_server' found in sys.modules", RuntimeWarning)

# matplotlib fixes its cache folder when imported. Use dofile's own folder in the user's cache directory:
# private (a fixed name in a shared /tmp could be planted by another user) and kept between runs, because
# building the font cache scans every system font (~10 s on macOS) although OpenDTA only uses DejaVu Sans.
if "MPLCONFIGDIR" not in os.environ:
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser(
        "~/Library/Caches" if sys.platform == "darwin" else "~/.cache"
    )
    os.environ["MPLCONFIGDIR"] = os.path.join(base, "dofile", "matplotlib")
    os.makedirs(os.environ["MPLCONFIGDIR"], mode=0o700, exist_ok=True)

import matplotlib.backends.backend_agg  # noqa: E402,F401  (the first graph would otherwise take ~0.2 s)
import matplotlib.figure  # noqa: E402,F401
import matplotlib.font_manager  # noqa: E402,F401

from . import engine, sandbox  # noqa: E402,F401
from ._vendor.opendta import session  # noqa: E402,F401
from ._vendor.opendta import commands  # noqa: E402,F401  (registers every command; mostly scipy, ~0.65 s)
from ._vendor.opendta.graphics import render  # noqa: E402,F401
