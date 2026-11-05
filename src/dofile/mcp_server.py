"""dofile MCP server: lets agents run Stata-syntax code without a Stata license.

stdio (default): one session for the process, working in the launch directory (or --workdir).
HTTP (--http): call start_session first and pass its token to the other tools; each session runs
in its own temp workdir. Protocol 2026-07-28 HTTP has no MCP session, so the token is explicit.

Large files never pass through the model: over stdio, code reads them in place from --read-dir folders by
absolute path; over HTTP, request_upload returns a one-time URL the client PUTs the file to (e.g. with curl).
"""
from __future__ import annotations

import argparse
import base64
import json
import inspect
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Annotated, Any, NotRequired, TypedDict

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.utilities.types import Image
from mcp.types import CallToolResult, ImageContent, TextContent
from pydantic import Field
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse

from .engine import about
from .worker import Worker, WorkerPool

LOG_LIMIT = 8_000  # characters of log returned inline; the full log is saved to the workdir's .dofile/
KEEP_LOGS = 20  # full logs kept in .dofile/; older ones are deleted
CMD_HEAD, CMD_TAIL = 40, 15  # lines kept from the start and end of each command's output
MATRIX_CELLS = 2_500  # matrices in run_do results above this (e.g. V with >50 terms) are sent without data
GET_MATRIX_CELLS = 250_000  # get_matrix answers up to this; larger needs rows/cols
GET_FILE_LIMIT = 5_000_000  # bytes for get_file: its content goes into the model's context
FILE_LIMIT = 1024 * 1024 * 1024  # default upload limit in bytes (--file-limit)
UPLOAD_TTL = 600.0  # seconds an upload or download URL stays valid
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

INSTRUCTIONS = """Runs Stata-syntax code (.do files) with the open-source dofile engine; no Stata license needed.
Data, macros and estimation results persist between run_do calls in the same session.
Quote numbers from run_do's `results` (e()/r() as JSON) or its log, never from memory.
For standard errors, p-values and confidence intervals use r(table), not your own arithmetic.
A call that runs too long, or that the client cancels, is interrupted like Stata's Break key: rc 1,
and the session keeps its data. Pass `timeout` to run_do for a shorter limit.
Commands that run programs, delete files, change directory or download are disabled (rc 199);
file access is limited to the session's working directory. rc 9998 means the session was reset
(the code did not stop when interrupted, or it crashed): its data is gone, so re-run your setup.
Community commands (reghdfe, esttab, outreg2) are not available."""


# Tool outputs: typed so tools/list advertises their real shape as outputSchema.
# Tool arguments: described so tools/list tells the model what each one is.
SessionArg = Annotated[str | None, Field(description="the session token from start_session")]
FileName = Annotated[str, Field(description="a plain file name in the session's working directory, e.g. "
                                            "'data.csv' (no folders)")]
NameList = Annotated[list[str] | None, Field(description="only these names, exactly as in the matrix's "
                                                         "rows/cols (default: all)")]


class SessionToken(TypedDict):
    session: Annotated[str, Field(description="pass as `session` to the other tools")]


ExtendedMissing = Annotated[str, Field(pattern=r"^\.[a-z]$", description="extended missing value .a ... .z")]
# int before float: a JSON integer stays an integer (N: 1000, not 1000.0)
Scalar = Annotated[int | float | ExtendedMissing | None, Field(description="a number; null for missing (.); "
                                                                       "'.a'..'.z' for extended missing")]


class Matrix(TypedDict):
    rows: Annotated[list[str], Field(description="row names, e.g. 'y1' or factor names like '4b.cyl'")]
    cols: list[str]
    data: Annotated[list[list[Scalar]] | None, Field(description="rows of values, encoded like scalars; "
                                                                 "null when omitted for size")]
    omitted: NotRequired[Annotated[str, Field(description="why data is null and how to fetch it")]]


class ResultSet(TypedDict):
    """One of e() or r(), grouped like `ereturn list` / `return list`."""
    scalars: Annotated[dict[str, Scalar], Field(description="e.g. N, r2, df_r (e()); N, mean, sd (r())")]
    macros: Annotated[dict[str, str], Field(description="e.g. cmd, depvar, cmdline, vce")]
    matrices: Annotated[dict[str, Matrix], Field(description="e.g. b (coefficients), V (variance matrix); after "
                                                           "estimation r() has table: rows b se t|z pvalue ll ul "
                                                           "df crit eform, one column per coefficient")]


class Results(TypedDict):
    e: Annotated[ResultSet | None, Field(description="e() results, or null when e() is unchanged since an "
                                                     "earlier call returned it (still in effect)")]
    r: Annotated[ResultSet | None, Field(description="r() results, or null when r() is unchanged since an "
                                                     "earlier call returned it (still in effect)")]


class FileChange(TypedDict):
    name: str
    status: Annotated[str, Field(description="'created' or 'modified'")]
    bytes: int


class RunResult(TypedDict):
    rc: Annotated[int, Field(description="return code: 0 success, Stata's codes on error, 1 interrupted "
                                         "(timeout or cancel; data kept), 199 command disabled by the sandbox, "
                                         "603 file not allowed, 9998 session reset, 9999 internal engine error")]
    error: Annotated[str | None, Field(description="the error message, or null on success")]
    error_command: Annotated[str | None, Field(description="the command that failed, as echoed in the log (for "
                                                           "an error inside a loop, the loop's first line); "
                                                           "null on success")]
    log: Annotated[str, Field(description="output as Stata shows it. Each command's long output keeps its "
                                          "first 40 and last 15 lines, with a marker for the omitted lines")]
    log_file: Annotated[str | None, Field(description="when the log was cut: the full log, readable with "
                                                      "get_file(name); else null")]
    results: Results
    files: Annotated[list[FileChange], Field(description="files in the working directory (top level) this "
                                                         "call created or changed")]
    nobs: Annotated[int, Field(description="observations in the dataset in memory after the call")]
    nvars: Annotated[int, Field(description="variables in the dataset in memory after the call")]
    new_graphs: Annotated[int, Field(description="graphs this call drew; with graphs=true the last (up to "
                                                 "3) are attached as PNG images after this JSON")]


class Variable(TypedDict):
    name: str
    type: Annotated[str, Field(description="storage type: byte, int, long, float, double, str#, strL")]
    format: str
    label: str | None
    value_label: str | None


class DataSummary(TypedDict):
    nobs: int
    nvars: Annotated[int, Field(description="variables in the dataset")]
    matched: Annotated[int, Field(description="variables matching `vars` (all of them without it)")]
    offset: int
    variables: Annotated[list[Variable], Field(description="the matching variables from `offset`, at most `limit`")]
    more: Annotated[int, Field(description="matching variables after these; call again with a larger offset")]
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


class DownloadTicket(TypedDict):
    url: Annotated[str, Field(description="fetch the file from here with an HTTP GET")]
    method: str
    bytes: int
    expires_in_seconds: int
    example: Annotated[str, Field(description="a curl command that does the download")]


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
        self._uploads: dict[str, tuple[str, str, str, float]] = {}  # token -> (kind, session, name, expiry)
        self._uploads_lock = threading.Lock()
        self.timeout = timeout
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

    def new_upload(self, session: str, name: str, kind: str = "upload") -> str:
        token = secrets.token_urlsafe(24)
        now = time.monotonic()
        with self._uploads_lock:
            self._uploads = {k: v for k, v in self._uploads.items() if v[3] > now}  # drop expired
            self._uploads[token] = (kind, session, name, now + UPLOAD_TTL)
        return token

    def take_upload(self, token: str, kind: str = "upload") -> tuple[str, str] | None:
        """(session, name) for a valid token of this kind ("upload" or "download"); each token works once."""
        with self._uploads_lock:
            claim = self._uploads.get(token)
            if claim is None or claim[0] != kind:
                return None
            del self._uploads[token]
        if claim[3] < time.monotonic():
            return None
        return claim[1], claim[2]

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


def _cut_log(log: str, log_file: str) -> str:
    """Each command's output (the lines after its `. cmd` echo) keeps its first CMD_HEAD and last CMD_TAIL
    lines, so every command and how it ended stay visible; then the whole log is capped at LOG_LIMIT."""
    out: list[str] = []
    block: list[str] = []

    def flush() -> None:
        if len(block) > CMD_HEAD + CMD_TAIL + 1:
            n = len(block) - CMD_HEAD - CMD_TAIL
            block[CMD_HEAD:-CMD_TAIL] = [f"[... {n} lines omitted; full log: get_file {log_file} ...]"]
        out.extend(block)
        block.clear()

    for line in log.split("\n"):
        if line.startswith(". "):  # a command echo starts the next block
            flush()
            out.append(line)
        else:
            block.append(line)
    flush()
    text = "\n".join(out)
    if len(text) > LOG_LIMIT:
        text = (text[:LOG_LIMIT // 2] + f"\n... [log truncated; full log: get_file {log_file}] ...\n"
                + text[-LOG_LIMIT // 2:])
    return text


def _cap(results: dict[str, Any]) -> dict[str, Any]:
    """Results with large matrices replaced by their names and size (new dicts: the originals are kept)."""
    out = {}
    for k, rs in results.items():
        if rs is None:
            out[k] = None
            continue
        mats = {}
        for name, m in rs["matrices"].items():
            n = len(m["rows"]) * len(m["cols"])
            mats[name] = m if n <= MATRIX_CELLS else {
                "rows": m["rows"], "cols": m["cols"], "data": None,
                "omitted": f"{len(m['rows'])}x{len(m['cols'])} = {n} values; fetch with "
                           f"get_matrix(name=\"{k}({name})\"), optionally only some rows/cols"}
        out[k] = {**rs, "matrices": mats}
    return out


def _snapshot(workdir: str) -> dict[str, tuple[int, int]]:
    """Top-level files -> (mtime in ns, size); the hidden .dofile/ scratch folder is not listed."""
    out = {}
    for p in Path(workdir).iterdir():
        if p.is_file():
            st = p.stat()
            out[p.name] = (st.st_mtime_ns, st.st_size)
    return out


def _changes(before: dict, after: dict) -> list[dict[str, Any]]:
    return [{"name": n, "status": "modified" if n in before else "created", "bytes": after[n][1]}
            for n in sorted(after) if before.get(n) != after[n]]


def _instructions(sessions: Sessions) -> str:
    where = "the server's disk" if sessions.http else "this machine"
    v = about()
    text = (INSTRUCTIONS + f"\nVersions: dofile {v['dofile']}, engine OpenDTA {(v['engine_commit'] or '?')[:7]}, "
            f"emulating Stata {v['stata_version']} (see resource dofile://about).")
    if sessions.read_dirs:
        text += (f"\nRead-only data folders on {where}: " + ", ".join(sessions.read_dirs)
                 + '. Use files there in place by absolute path, e.g. `use "<folder>/file.dta"`; save output '
                   "to the working directory.")
    if sessions.http:
        text += ("\nTo use a large file from your machine, call request_upload and send the file to the URL "
                 "it returns (e.g. with curl) so its content does not pass through your context. To give the user "
                 "a result file (a saved .dta, an exported .xlsx), call request_download for a one-time URL; "
                 "session files are deleted when the session ends.")
    return text


def build_server(sessions: Sessions) -> MCPServer:
    mcp = MCPServer(name="dofile", version=about()["dofile"], instructions=_instructions(sessions))
    session_doc = " `session`: the token from start_session." if sessions.http else ""
    code_doc = "Stata code: one or more commands, one per line, as in a .do file."
    if sessions.read_dirs:  # also in the instructions, but not every client shows those to the model
        code_doc += (" Files in the read-only folders " + ", ".join(sessions.read_dirs)
                     + ' can be used by absolute path, e.g. `use "<folder>/file.dta"`.')

    def tool(**kw):
        """mcp.tool; over stdio the `session` argument is left out of the schema (one session per process).
        Annotations are resolved here so they can use this function's locals (code_doc)."""
        def register(fn):
            sig = inspect.signature(fn, eval_str=True, locals={"code_doc": code_doc})
            params = [p for p in sig.parameters.values() if sessions.http or p.name != "session"]
            fn.__signature__ = sig.replace(parameters=params)
            return mcp.tool(**kw)(fn)
        return register

    if sessions.http:
        @mcp.tool()
        async def start_session() -> SessionToken:
            """Start a new Stata session with its own empty working directory. Pass the returned token as
            `session` to every other tool. Sessions idle for 15 minutes are closed."""
            return {"session": await anyio.to_thread.run_sync(sessions.new)}

    @tool(description="Run Stata code (one or more lines, like a .do file) in the session. Returns the "
                          "log (commands echoed as `. cmd`), the return code rc (0 = success), the error "
                          "message, the current e()/r() results as JSON, and files created or changed. Graphs the code "
                          "draws (scatter, histogram, twoway, ...) are attached as images: the last 3, "
                          "unless graphs=false; no `graph export` needed to see them." + session_doc)
    async def run_do(code: Annotated[str, Field(description=code_doc)],
                     graphs: Annotated[bool, Field(description="attach the last (up to 3) graphs this call draws "
                                                               "as images; false to save context")] = True,
                     timeout: Annotated[float | None, Field(gt=0, description="seconds before the call is "
                                                                          "interrupted (rc 1, data kept); at most "
                                                                          "the server's limit, which is the "
                                                                          "default")] = None,
                     session: SessionArg = None) -> Annotated[CallToolResult, RunResult]:
        w = sessions.get(session)
        before = _snapshot(w.workdir)
        limit = min(timeout, sessions.timeout) if timeout else None
        call = object()
        try:  # abandon_on_cancel: a cancel from the client returns here at once, and interrupts the code
            r = await anyio.to_thread.run_sync(w.run, code, limit, graphs, call, abandon_on_cancel=True)
        except anyio.get_cancelled_exc_class():
            w.interrupt(call)
            raise
        after = _snapshot(w.workdir)
        # don't resend stale or repeated e()/r() (errors keep both); they can be large (V is k×k)
        last = getattr(w, "last_results", {})
        w.last_results = dict(r.results)
        for k in ("e", "r"):
            if r.results[k] == last.get(k):
                r.results[k] = None
        out = {"rc": r.rc, "error": r.error, "error_command": r.error_command, "log": r.log, "log_file": None, "results": _cap(r.results),
               "files": _changes(before, after), "new_graphs": r.new_graphs,
               "nobs": r.nobs, "nvars": r.nvars}
        name = f"dofile-log-{secrets.token_hex(4)}.txt"
        cut = _cut_log(r.log, name)
        if cut != r.log:
            scratch = Path(w.workdir) / ".dofile"  # hidden, so long runs don't litter the user's folder
            scratch.mkdir(exist_ok=True)
            (scratch / name).write_text(r.log, encoding="utf-8")
            logs = sorted(scratch.glob("dofile-log-*.txt"), key=lambda f: f.stat().st_mtime_ns)
            for f in logs[:-KEEP_LOGS]:  # over stdio this is the user's folder: don't let logs pile up
                f.unlink(missing_ok=True)
            out["log"], out["log_file"] = cut, name
        images = [ImageContent(type="image", data=base64.b64encode(png).decode(), mime_type="image/png")
                  for png in r.images]
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(out)), *images],
                              structured_content=out)

    @tool(description="Return one matrix with full precision: e(b), e(V), r(table), or a matrix made "
                          "with `matrix`. Give `rows`/`cols` (names as in the matrix, e.g. ['x1', '_cons']) "
                          "to get only part of a large one. Use it when run_do results omit a matrix for "
                          "size." + session_doc)
    async def get_matrix(name: Annotated[str, Field(description="e(b), e(V), r(table), or the name of a matrix "
                                                               "made with `matrix`")],
                         rows: NameList = None, cols: NameList = None, session: SessionArg = None) -> Matrix:
        m = await anyio.to_thread.run_sync(sessions.get(session).matrix, name, rows, cols)
        if not isinstance(m, dict):  # the session was reset
            raise ToolError(m.error)
        if "error" in m:
            raise ToolError(m["error"])
        if len(m["rows"]) * len(m["cols"]) > GET_MATRIX_CELLS:
            raise ToolError(f"{name} has {len(m['rows'])}x{len(m['cols'])} values, more than {GET_MATRIX_CELLS}; "
                            "ask for some rows/cols")
        return m

    @tool(description="Describe the dataset in memory: number of observations and, per variable, its exact "
                          "name, storage type, display format, label and value label. On wide data, narrow it "
                          "with `vars` or page with `offset`." + session_doc)
    async def describe_data(vars: Annotated[str | None, Field(description="only these variables, as a Stata "
                                                                          "varlist, e.g. 'inc* age-educ'")] = None,
                            offset: Annotated[int, Field(ge=0, description="skip this many matching variables")] = 0,
                            limit: Annotated[int, Field(ge=1, le=1000, description="return at most this many")] = 200,
                            session: SessionArg = None) -> DataSummary:
        r = await anyio.to_thread.run_sync(sessions.get(session).data_summary, vars, offset, limit)
        if not isinstance(r, dict):  # the session was reset
            raise ToolError(r.error)
        if "error" in r:
            raise ToolError(r["error"])
        return r

    @tool(description="Return a file from the session's working directory: images (.png, .jpg, ...) as "
                          "an image, text files (logs, .csv, .do, .tex) as text. Use it to look at exported graphs "
                          "from `graph export` and full logs from run_do's log_file. Binary files (.dta, "
                          ".xlsx, .pdf) are refused: open them with run_do instead."
                          + session_doc)
    async def get_file(name: FileName, session: SessionArg = None) -> Image | str:
        p = _safe_name(sessions.get(session).workdir, name)
        if not p.is_file() and name.startswith("dofile-log-"):  # full logs live in the hidden scratch folder
            p = p.parent / ".dofile" / name
        if not p.is_file():
            raise ToolError(f"no file {name!r} in the working directory")
        if p.stat().st_size > GET_FILE_LIMIT:
            raise ToolError(f"{name} is larger than {GET_FILE_LIMIT} bytes")
        if p.suffix.lower() in IMAGE_TYPES:
            return Image(data=p.read_bytes(), format=p.suffix.lower().lstrip(".").replace("jpg", "jpeg"))
        data = p.read_bytes()
        if b"\0" not in data:  # NUL bytes: binary formats (.dta, .xlsx, .pdf)
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                text = data.decode("latin-1")  # older Stata logs and Windows CSVs
                if sum(c.isprintable() or c in "\r\n\t" for c in text) > 0.95 * len(text):
                    return text
        raise ToolError(f"{name} is a binary file, which get_file cannot show. Look inside it with run_do "
                        "instead (`use` for .dta, `import excel` for .xlsx, then `describe` or `list`); "
                        "for graphs, export .png (e.g. `graph export g.png`).")

    @tool(description="Write a small text file you wrote yourself (a CSV, a .do file, ...) into the "
                          "session's working directory as `name`, so Stata code can use it, e.g. `import "
                          "delimited using name.csv`. For large data files, see the server instructions."
                          + session_doc)
    async def upload_file(name: FileName, text: Annotated[str, Field(description="the whole file content")],
                          session: SessionArg = None) -> Written:
        data = text.encode("utf-8")
        if len(data) > sessions.file_limit:
            raise ToolError(f"file is larger than {sessions.file_limit} bytes")
        _safe_name(sessions.get(session).workdir, name).write_bytes(data)
        return {"name": name, "bytes": len(data)}

    if sessions.http:
        @mcp.tool()
        async def request_upload(name: FileName,
                                 session: Annotated[str, Field(description="the session token from start_session")]) -> UploadTicket:
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

    if sessions.http:
        @mcp.tool()
        async def request_download(name: FileName,
                                   session: Annotated[str, Field(description="the session token from start_session")]) -> DownloadTicket:
            """Get a one-time URL to download a file from the session's working directory (e.g. a .dta saved
            with `save`, an .xlsx from `export excel`, a graph) to your machine, without its content passing
            through this conversation: `curl --fail -o <name> <url>`. The URL works once and expires after
            10 minutes. Download results before the session ends: its files are deleted with it."""
            p = _safe_name(sessions.get(session).workdir, name)
            if not p.is_file():
                raise ToolError(f"no file {name!r} in the working directory")
            url = f"{sessions.public_url}/download/{sessions.new_upload(session, name, 'download')}"
            return {"url": url, "method": "GET", "bytes": p.stat().st_size,
                    "expires_in_seconds": int(UPLOAD_TTL), "example": f"curl --fail -o {name} {url}"}

        @mcp.custom_route("/download/{token}", methods=["GET"])
        async def send_download(request: Request):
            claim = sessions.take_upload(request.path_params["token"], "download")
            w = sessions.pool.find(claim[0]) if claim else None
            p = Path(w.workdir) / claim[1] if w else None
            if p is None or not p.is_file():
                return PlainTextResponse("unknown, used or expired download URL (or its file or session is gone)\n",
                                         404)
            return FileResponse(p, filename=claim[1])

    @tool(description="Discard the session: its data, macros and results. Over stdio a fresh session "
                          "starts on the next call; over HTTP the token stops working." + session_doc)
    async def reset(session: SessionArg = None) -> Status:
        sessions.get(session)  # validates the token
        await anyio.to_thread.run_sync(sessions.drop, session)
        return {"status": "reset"}

    @mcp.resource("dofile://about", mime_type="application/json",
                  description="dofile version, engine (OpenDTA) commit and patches, emulated Stata version")
    def about_resource() -> str:
        return json.dumps(about())

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
    ap.add_argument("--timeout", type=float, default=60.0, help="seconds per run_do call before it is interrupted (rc 1)")
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
