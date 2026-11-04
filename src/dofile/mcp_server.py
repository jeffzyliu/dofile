"""dofile MCP server: lets agents run Stata-syntax code without a Stata license.

stdio (default): one session for the process, working in the launch directory (or --workdir).
HTTP (--http): call start_session first and pass its token to the other tools; each session runs
in its own temp workdir. Protocol 2026-07-28 HTTP has no MCP session, so the token is explicit.
"""
from __future__ import annotations

import argparse
import base64
import secrets
from pathlib import Path
from typing import Any

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.utilities.types import Image

from .worker import Worker, WorkerPool

LOG_LIMIT = 20_000  # characters of log returned inline; the full log is saved to the workdir
FILE_LIMIT = 5_000_000  # bytes for get_file / upload_file
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

INSTRUCTIONS = """Runs Stata-syntax code (.do files) with the open-source dofile engine; no Stata license needed.
Data, macros and estimation results persist between run_do calls in the same session.
Quote numbers from run_do's `results` (e()/r() as JSON) or its log, never from memory.
Commands that run programs, delete files, change directory or download are disabled (rc 199);
file access is limited to the session's working directory. rc 9998 means the session was reset
(timeout or crash): its data is gone, so re-run your setup. Community commands (reghdfe, esttab,
outreg2) are not available."""


class Sessions:
    """Maps a tool call to its Worker: one fixed worker (stdio) or a token-keyed pool (HTTP)."""

    def __init__(self, *, http: bool, workdir: Path, read_dirs: tuple[str, ...], sandbox: bool, timeout: float,
                 max_sessions: int = 8, idle_seconds: float = 900.0):
        self.http = http
        kw = dict(read_dirs=read_dirs, sandbox=sandbox, timeout=timeout)
        self.single = None if http else Worker(workdir, **kw)
        self.pool = WorkerPool(max_workers=max_sessions, idle_seconds=idle_seconds, **kw) if http else None

    def new(self) -> str:
        token = secrets.token_urlsafe(16)
        self.pool.get(token)  # the pool's keys are the valid tokens
        return token

    def get(self, session: str | None) -> Worker:
        if not self.http:
            return self.single
        w = self.pool.find(session) if session else None
        if w is None:  # never started, reset, idle too long, or evicted: never silently hand out a fresh one
            raise ToolError("unknown or expired session (data from an expired session is gone): call "
                            "start_session and pass its token as `session`")
        return w

    def drop(self, session: str | None) -> None:
        if self.http:
            self.pool.close(session)
        else:
            self.single.close()

    def close(self) -> None:
        if self.single:
            self.single.close()
        if self.pool:
            self.pool.close()


def _safe_name(workdir: str, name: str) -> Path:
    """A plain file name inside the workdir (trust boundary: no paths, no traversal)."""
    p = Path(name)
    if p.name != name or name in ("", ".", ".."):
        raise ToolError(f"{name!r} must be a plain file name inside the session's working directory")
    return Path(workdir) / name


def _snapshot(workdir: str) -> dict[str, float]:
    return {p.name: p.stat().st_mtime for p in Path(workdir).iterdir() if p.is_file()}


def build_server(sessions: Sessions) -> MCPServer:
    mcp = MCPServer(name="dofile", instructions=INSTRUCTIONS)
    session_doc = " `session`: the token from start_session (HTTP only; ignored over stdio)."

    if sessions.http:
        @mcp.tool()
        async def start_session() -> dict[str, str]:
            """Start a new Stata session with its own empty working directory. Pass the returned token as
            `session` to every other tool. Sessions idle for 15 minutes are closed."""
            return {"session": await anyio.to_thread.run_sync(sessions.new)}

    @mcp.tool(description="Run Stata code (one or more lines, like a .do file) in the session. Returns the "
                          "log (commands echoed as `. cmd`), the return code rc (0 = success), the error "
                          "message, the current e()/r() results as JSON, and files created or changed."
                          + session_doc)
    async def run_do(code: str, session: str | None = None) -> dict[str, Any]:
        w = sessions.get(session)
        before = _snapshot(w.workdir)
        r = await anyio.to_thread.run_sync(w.run, code)
        after = _snapshot(w.workdir)
        out = {"rc": r.rc, "error": r.error, "log": r.log, "results": r.results,
               "files": sorted(n for n, t in after.items() if before.get(n) != t)}
        if len(r.log) > LOG_LIMIT:
            full = Path(w.workdir) / f"dofile-log-{secrets.token_hex(4)}.txt"
            full.write_text(r.log, encoding="utf-8")
            out["log"] = r.log[:LOG_LIMIT // 2] + f"\n... [log truncated; full log in {full.name}] ...\n" + \
                r.log[-LOG_LIMIT // 2:]
            out["files"].append(full.name)
        return out

    @mcp.tool(description="Describe the dataset in memory: number of observations and, per variable, its "
                          "name, storage type, display format, label and value label." + session_doc)
    async def describe_data(session: str | None = None) -> dict[str, Any]:
        r = await anyio.to_thread.run_sync(sessions.get(session).data_summary)
        if not isinstance(r, dict):  # the session was reset
            raise ToolError(r.error)
        return r

    @mcp.tool(description="Return a file from the session's working directory: images (.png, .jpg, ...) as "
                          "an image, anything else as text. Use it to look at graphs from `graph export`."
                          + session_doc)
    async def get_file(name: str, session: str | None = None) -> Image | str:
        p = _safe_name(sessions.get(session).workdir, name)
        if not p.is_file():
            raise ToolError(f"no file {name!r} in the working directory")
        if p.stat().st_size > FILE_LIMIT:
            raise ToolError(f"{name} is larger than {FILE_LIMIT} bytes")
        if p.suffix.lower() in IMAGE_TYPES:
            return Image(data=p.read_bytes(), format=p.suffix.lower().lstrip(".").replace("jpg", "jpeg"))
        return p.read_text(encoding="utf-8", errors="replace")

    @mcp.tool(description="Write a file (a dataset as CSV text, a .do file, ...) into the session's working "
                          "directory so Stata code can use it, e.g. `import delimited using data.csv`. Give "
                          "`text`, or `base64` for binary files such as .dta." + session_doc)
    async def upload_file(name: str, text: str | None = None, base64_data: str | None = None,
                          session: str | None = None) -> dict[str, Any]:
        if (text is None) == (base64_data is None):
            raise ToolError("give exactly one of `text` or `base64_data`")
        data = text.encode("utf-8") if text is not None else base64.b64decode(base64_data, validate=True)
        if len(data) > FILE_LIMIT:
            raise ToolError(f"file is larger than {FILE_LIMIT} bytes")
        p = _safe_name(sessions.get(session).workdir, name)
        p.write_bytes(data)
        return {"name": name, "bytes": len(data)}

    @mcp.tool(description="Discard the session: its data, macros and results. Over stdio a fresh session "
                          "starts on the next call; over HTTP the token stops working." + session_doc)
    async def reset(session: str | None = None) -> dict[str, str]:
        sessions.get(session)  # validates the token
        await anyio.to_thread.run_sync(sessions.drop, session)
        return {"status": "reset"}

    @mcp.resource("dofile://commands", mime_type="text/plain", description="Stata commands the engine knows")
    def commands() -> str:
        from .sandbox import DENIED
        from ._vendor.opendta.commands import registry
        from ._vendor.opendta.session import Session  # noqa: F401  (registers the commands)
        return "\n".join(n for n in registry.all_commands() if n not in DENIED)

    return mcp


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="dofile-mcp", description=__doc__.splitlines()[0])
    ap.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    ap.add_argument("--host", default="127.0.0.1", help="HTTP bind address (default: localhost only)")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--workdir", default=".", help="stdio: working directory for the session (default: current)")
    ap.add_argument("--read-dir", action="append", default=[], help="extra read-only data directory (repeatable)")
    ap.add_argument("--timeout", type=float, default=60.0, help="seconds per run_do call before the session resets")
    ap.add_argument("--max-sessions", type=int, default=8, help="HTTP: concurrent sessions")
    ap.add_argument("--unsafe", action="store_true", help="disable the sandbox (trusted local use only)")
    a = ap.parse_args(argv)
    sessions = Sessions(http=a.http, workdir=Path(a.workdir).resolve(),
                        read_dirs=tuple(str(Path(d).resolve()) for d in a.read_dir),
                        sandbox=not a.unsafe, timeout=a.timeout, max_sessions=a.max_sessions)
    server = build_server(sessions)
    try:
        if a.http:
            server.run("streamable-http", host=a.host, port=a.port)
        else:
            server.run("stdio")
    finally:
        sessions.close()


if __name__ == "__main__":
    main()
