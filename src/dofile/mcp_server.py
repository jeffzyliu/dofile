"""dofile MCP server: lets agents run Stata-syntax code without a Stata license.

stdio (default): one session for the process, working in the launch directory (or --workdir).
HTTP (--http): call start_session first and pass its token to the other tools; each session runs
in its own temp workdir. Protocol 2026-07-28 HTTP has no MCP session, so the token is explicit.

Large files never pass through the model: over stdio, code reads them in place from --read-dir folders by
absolute path; over HTTP, request_upload returns a one-time URL the client PUTs the file to (e.g. with curl).
"""
from __future__ import annotations

import argparse
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Annotated, Any, TypedDict

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.utilities.types import Image
from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from .worker import Worker, WorkerPool

LOG_LIMIT = 20_000  # characters of log returned inline; the full log is saved to the workdir
GET_FILE_LIMIT = 5_000_000  # bytes for get_file: its content goes into the model's context
FILE_LIMIT = 1024 * 1024 * 1024  # default upload limit in bytes (--file-limit)
UPLOAD_TTL = 600.0  # seconds an upload URL stays valid
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

INSTRUCTIONS = """Runs Stata-syntax code (.do files) with the open-source dofile engine; no Stata license needed.
Data, macros and estimation results persist between run_do calls in the same session.
Quote numbers from run_do's `results` (e()/r() as JSON) or its log, never from memory.
Commands that run programs, delete files, change directory or download are disabled (rc 199);
file access is limited to the session's working directory. rc 9998 means the session was reset
(timeout or crash): its data is gone, so re-run your setup. Community commands (reghdfe, esttab,
outreg2) are not available."""


# Tool outputs: typed so tools/list advertises their real shape as outputSchema.
class SessionToken(TypedDict):
    session: Annotated[str, Field(description="pass as `session` to the other tools")]


class Results(TypedDict):
    e: Annotated[dict[str, Any], Field(description="e() results. Matrices are {rows, cols, data}; missing "
                                                   "is null, extended missing is '.a'..'.z'")]
    r: Annotated[dict[str, Any], Field(description="r() results, encoded like e()")]


class RunResult(TypedDict):
    rc: Annotated[int, Field(description="return code: 0 success, Stata's codes on error, 199 command disabled "
                                         "by the sandbox, 603 file not allowed, 9998 session reset, "
                                         "9999 internal engine error")]
    error: Annotated[str | None, Field(description="the error message, or null on success")]
    log: Annotated[str, Field(description="output as Stata shows it; long logs keep the head and tail, with "
                                          "the full log saved to a file listed in `files`")]
    results: Results
    files: Annotated[list[str], Field(description="files in the working directory created or changed")]


class Variable(TypedDict):
    name: str
    type: Annotated[str, Field(description="storage type: byte, int, long, float, double, str#, strL")]
    format: str
    label: str | None
    value_label: str | None


class DataSummary(TypedDict):
    nobs: int
    nvars: int
    variables: list[Variable]
    filename: str | None


class Written(TypedDict):
    name: str
    bytes: int


class UploadTicket(TypedDict):
    url: Annotated[str, Field(description="send the raw file here with an HTTP PUT")]
    method: str
    max_bytes: int
    expires_in_seconds: int
    example: Annotated[str, Field(description="a curl command that does the upload")]


class Status(TypedDict):
    status: str


class Sessions:
    """Maps a tool call to its Worker: one fixed worker (stdio) or a token-keyed pool (HTTP)."""

    def __init__(self, *, http: bool, workdir: Path, read_dirs: tuple[str, ...], sandbox: bool, timeout: float,
                 max_sessions: int = 8, idle_seconds: float = 900.0, file_limit: int = FILE_LIMIT,
                 public_url: str = "http://127.0.0.1:8000"):
        self.http = http
        self.read_dirs = read_dirs
        self.file_limit = file_limit
        self.public_url = public_url.rstrip("/")
        self._uploads: dict[str, tuple[str, str, float]] = {}  # token -> (session, file name, expiry)
        self._uploads_lock = threading.Lock()
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

    def new_upload(self, session: str, name: str) -> str:
        token = secrets.token_urlsafe(24)
        now = time.monotonic()
        with self._uploads_lock:
            self._uploads = {k: v for k, v in self._uploads.items() if v[2] > now}  # drop expired
            self._uploads[token] = (session, name, now + UPLOAD_TTL)
        return token

    def take_upload(self, token: str) -> tuple[str, str] | None:
        """(session, name) for a valid upload token; each token works once."""
        with self._uploads_lock:
            claim = self._uploads.pop(token, None)
        if claim is None or claim[2] < time.monotonic():
            return None
        return claim[0], claim[1]

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


def _instructions(sessions: Sessions) -> str:
    where = "the server's disk" if sessions.http else "this machine"
    text = INSTRUCTIONS
    if sessions.read_dirs:
        text += (f"\nRead-only data folders on {where}: " + ", ".join(sessions.read_dirs)
                 + '. Use files there in place by absolute path, e.g. `use "<folder>/file.dta"`; save output '
                   "to the working directory.")
    if sessions.http:
        text += ("\nTo use a large file from your machine, call request_upload and send the file to the URL "
                 "it returns (e.g. with curl) so its content does not pass through your context.")
    return text


def build_server(sessions: Sessions) -> MCPServer:
    mcp = MCPServer(name="dofile", instructions=_instructions(sessions))
    session_doc = " `session`: the token from start_session (HTTP only; ignored over stdio)."

    if sessions.http:
        @mcp.tool()
        async def start_session() -> SessionToken:
            """Start a new Stata session with its own empty working directory. Pass the returned token as
            `session` to every other tool. Sessions idle for 15 minutes are closed."""
            return {"session": await anyio.to_thread.run_sync(sessions.new)}

    @mcp.tool(description="Run Stata code (one or more lines, like a .do file) in the session. Returns the "
                          "log (commands echoed as `. cmd`), the return code rc (0 = success), the error "
                          "message, the current e()/r() results as JSON, and files created or changed."
                          + session_doc)
    async def run_do(code: str, session: str | None = None) -> RunResult:
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
    async def describe_data(session: str | None = None) -> DataSummary:
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
        if p.stat().st_size > GET_FILE_LIMIT:
            raise ToolError(f"{name} is larger than {GET_FILE_LIMIT} bytes")
        if p.suffix.lower() in IMAGE_TYPES:
            return Image(data=p.read_bytes(), format=p.suffix.lower().lstrip(".").replace("jpg", "jpeg"))
        return p.read_text(encoding="utf-8", errors="replace")

    @mcp.tool(description="Write a small text file you wrote yourself (a CSV, a .do file, ...) into the "
                          "session's working directory as `name`, so Stata code can use it, e.g. `import "
                          "delimited using name.csv`. For large data files, see the server instructions."
                          + session_doc)
    async def upload_file(name: str, text: str, session: str | None = None) -> Written:
        data = text.encode("utf-8")
        if len(data) > sessions.file_limit:
            raise ToolError(f"file is larger than {sessions.file_limit} bytes")
        _safe_name(sessions.get(session).workdir, name).write_bytes(data)
        return {"name": name, "bytes": len(data)}

    if sessions.http:
        @mcp.tool()
        async def request_upload(name: str, session: str) -> UploadTicket:
            """Get a one-time URL to upload a file from your machine into the session's working directory as
            `name`, without its content passing through this conversation. PUT the raw file to the URL, e.g.
            `curl --fail -T local.dta <url>`, then use it in Stata (`use name.dta`). The URL works once and
            expires after 10 minutes."""
            _safe_name(sessions.get(session).workdir, name)
            url = f"{sessions.public_url}/upload/{sessions.new_upload(session, name)}"
            return {"url": url, "method": "PUT", "max_bytes": sessions.file_limit,
                    "expires_in_seconds": int(UPLOAD_TTL), "example": f"curl --fail -T {name} {url}"}

        @mcp.custom_route("/upload/{token}", methods=["PUT"])
        async def receive_upload(request: Request):
            claim = sessions.take_upload(request.path_params["token"])
            w = sessions.pool.find(claim[0]) if claim else None
            if w is None:
                return PlainTextResponse("unknown, used or expired upload URL (or its session ended)\n", 404)
            limit = sessions.file_limit
            if int(request.headers.get("content-length") or 0) > limit:
                return PlainTextResponse(f"file is larger than {limit} bytes\n", 413)
            scratch = Path(w.workdir) / ".dofile"
            scratch.mkdir(exist_ok=True)
            tmp = scratch / f"upload-{secrets.token_hex(8)}.part"  # renamed into place only when complete
            size = 0
            try:
                with open(tmp, "wb") as f:
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > limit:
                            return PlainTextResponse(f"file is larger than {limit} bytes\n", 413)
                        f.write(chunk)
                os.replace(tmp, Path(w.workdir) / claim[1])
            finally:
                tmp.unlink(missing_ok=True)
            return JSONResponse({"name": claim[1], "bytes": size})

    @mcp.tool(description="Discard the session: its data, macros and results. Over stdio a fresh session "
                          "starts on the next call; over HTTP the token stops working." + session_doc)
    async def reset(session: str | None = None) -> Status:
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
    ap.add_argument("--file-limit", type=float, default=FILE_LIMIT / 2**20, metavar="MB",
                    help="largest file upload_file or request_upload accept, in MB (default: 1024)")
    ap.add_argument("--public-url", help="HTTP: base URL clients reach this server at, for upload links "
                                         "(default: http://HOST:PORT)")
    ap.add_argument("--timeout", type=float, default=60.0, help="seconds per run_do call before the session resets")
    ap.add_argument("--max-sessions", type=int, default=8, help="HTTP: concurrent sessions")
    ap.add_argument("--unsafe", action="store_true", help="disable the sandbox (trusted local use only)")
    a = ap.parse_args(argv)
    sessions = Sessions(http=a.http, workdir=Path(a.workdir).resolve(),
                        read_dirs=tuple(str(Path(d).resolve()) for d in a.read_dir),
                        sandbox=not a.unsafe, timeout=a.timeout, max_sessions=a.max_sessions,
                        file_limit=int(a.file_limit * 2**20),
                        public_url=a.public_url or f"http://{a.host}:{a.port}")
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
