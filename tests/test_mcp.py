import asyncio
import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

mcp = pytest.importorskip("mcp")
from mcp import Client, StdioServerParameters

from dofile.mcp_server import LOG_LIMIT, Sessions, _instructions, build_server

EMPTY = {"scalars": {}, "macros": {}, "matrices": {}}
PANEL = Path(__file__).parent / "conformance" / "data" / "panel.dta"


def call(client_target, steps):
    """Run `steps(client)` (an async function) against a server and return its result."""

    async def go():
        async with Client(client_target) as c:
            return await steps(c)

    return asyncio.run(go())


async def tool(c, _tool, **args):
    return await c.call_tool(_tool, args)


@pytest.fixture
def stdio_sessions(tmp_path):
    shutil.copy(PANEL, tmp_path)
    s = Sessions(http=False, workdir=tmp_path, read_dirs=(), sandbox=True, timeout=30)
    yield s
    s.close()


def test_stdio_mode_tools(stdio_sessions, tmp_path):
    async def steps(c):
        names = {t.name for t in (await c.list_tools()).tools}
        assert names == {
            "run_do",
            "describe_data",
            "get_file",
            "get_matrix",
            "upload_file",
            "reset",
        }  # no start_session on stdio

        r = (
            await tool(c, "run_do", code="use panel, clear\nregress y x1 x2\nscatter y x1\ngraph export s.png")
        ).structured_content
        assert (
            r["rc"] == 0
            and r["results"]["e"]["scalars"]["N"] == 1000
            and r["results"]["e"]["macros"]["cmd"] == "regress"
        )
        assert [(f["name"], f["status"]) for f in r["files"]] == [("s.png", "created")]  # not the hidden .dofile/
        assert r["files"][0]["bytes"] > 1000
        again = (await tool(c, "run_do", code="graph export s.png, replace", graphs=False)).structured_content
        assert [(f["name"], f["status"]) for f in again["files"]] == [("s.png", "modified")]
        # state persists between calls; every call sends e()/r() in full (no null for "unchanged"), matrices by size
        r = (await tool(c, "run_do", code="summarize y")).structured_content["results"]
        assert r["e"]["macros"]["cmd"] == "regress" and r["e"]["matrices"] == {"b": "1x3", "V": "3x3"}
        assert r["r"]["scalars"]["N"] == 1000
        r = (await tool(c, "run_do", code="regress y nosuchvar")).structured_content
        assert r["rc"] == 111 and r["results"]["e"]["macros"]["cmd"] == "regress"  # the error kept e()
        assert r["results"]["r"]["scalars"]["N"] == 1000 and "→" not in r["log"]
        assert (await tool(c, "run_do", code="regress y x1")).structured_content["results"]["e"]["scalars"]["df_m"] == 1
        assert (await tool(c, "run_do", code="count")).structured_content["results"]["r"]["scalars"]["N"] == 1000
        assert (await tool(c, "describe_data")).structured_content["nobs"] == 1000

        img = await tool(c, "get_file", name="s.png")
        assert img.content[0].type == "image" and img.content[0].mime_type == "image/png"

        bad = await tool(c, "get_file", name="../secret")
        assert bad.is_error and "plain file name" in bad.content[0].text  # the reason reaches the agent

        await tool(c, "upload_file", name="a.csv", text="v\n1\n2\n")
        r = (await tool(c, "run_do", code="import delimited using a.csv, clear\nsummarize v")).structured_content
        assert r["results"]["r"]["scalars"]["mean"] == 1.5

        r = (await tool(c, "run_do", code="shell echo hi")).structured_content
        assert r["rc"] == 199 and "sandbox" in r["error"]

        r = (await tool(c, "run_do", code='forvalues i = 1/3000 {\n    display "line `i\'"\n}')).structured_content
        assert len(r["log"]) < LOG_LIMIT + 200 and "lines omitted" in r["log"] and "line 3000" in r["log"]
        assert r["log_file"].startswith("dofile-log-") and r["log_file"] not in [f["name"] for f in r["files"]]
        assert not (tmp_path / r["log_file"]).exists()  # kept in the hidden .dofile/, not the user's folder
        full = (await tool(c, "get_file", name=r["log_file"])).content[0].text
        assert full.count("line ") >= 3000 and "line 3000" in full

        await tool(c, "reset")
        assert (await tool(c, "run_do", code="count")).structured_content["results"]["r"]["scalars"]["N"] == 0

        out = {t.name: t.output_schema for t in (await c.list_tools()).tools}
        assert out["run_do"]["title"] == "RunResult" and out["describe_data"]["title"] == "DataSummary"

        cmds = (await c.read_resource("dofile://commands")).contents[0].text.split("\n")
        assert "regress" in cmds and "shell" not in cmds

    call(build_server(stdio_sessions), steps)


def test_http_mode_needs_tokens_and_isolates_sessions():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)

    async def steps(c):
        assert "start_session" in {t.name for t in (await c.list_tools()).tools}
        missing = await tool(c, "run_do", code="display 1")  # `session` is required in the schema
        assert missing.is_error
        unknown = await tool(c, "run_do", code="display 1", session="made-up")
        assert unknown.is_error and "start_session" in unknown.content[0].text

        a = (await tool(c, "start_session")).structured_content["session"]
        b = (await tool(c, "start_session")).structured_content["session"]
        await tool(c, "run_do", code="clear\nset obs 7", session=a)
        assert (await tool(c, "run_do", code="count", session=b)).structured_content["results"]["r"]["scalars"][
            "N"
        ] == 0
        assert (await tool(c, "run_do", code="count", session=a)).structured_content["results"]["r"]["scalars"][
            "N"
        ] == 7

        await tool(c, "reset", session=a)
        assert (await tool(c, "run_do", code="count", session=a)).is_error  # token no longer valid

    try:
        call(build_server(s), steps)
    finally:
        s.close()


def test_real_stdio_transport(tmp_path):
    shutil.copy(PANEL, tmp_path)
    params = StdioServerParameters(command=sys.executable, args=["-m", "dofile.mcp_server", "--workdir", str(tmp_path)])

    async def steps(c):
        r = (await tool(c, "run_do", code="use panel, clear\nquietly regress y x1")).structured_content
        await tool(c, "reset")  # the next call starts a new session process
        t = time.perf_counter()
        assert (await tool(c, "run_do", code="display 1")).structured_content["rc"] == 0
        return r["rc"], r["results"]["e"]["scalars"]["N"], time.perf_counter() - t

    rc, n, restart = call(params, steps)
    assert (rc, n) == (0, 1000)
    if sys.platform != "win32":  # under `python -m` the forkserver must preload the server module, or ~0.35 s
        assert restart < 0.2, f"a new session took {restart:.2f} s"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_http(*args):
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "dofile.mcp_server", "--http", "--port", str(port), *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    for _ in range(100):  # wait for the server to listen
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                break
        time.sleep(0.1)
    return proc, port


def test_real_http_transport():
    proc, port = _start_http()
    try:

        async def steps(c):
            token = (await tool(c, "start_session")).structured_content["session"]
            r = (await tool(c, "run_do", code="clear\nset obs 3\ncount", session=token)).structured_content
            return r["rc"], r["results"]["r"]["scalars"]["N"]

        assert call(f"http://127.0.0.1:{port}/mcp", steps) == (0, 3)
    finally:
        proc.terminate()
        proc.wait(10)


def test_http_expired_session_is_reported_not_silently_replaced():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)

    async def steps(c):
        a = (await tool(c, "start_session")).structured_content["session"]
        await tool(c, "run_do", code="clear\nset obs 5", session=a)
        s.pool.idle_seconds = 0  # the session idles out
        r = await tool(c, "run_do", code="count", session=a)
        assert r.is_error and "expired" in r.content[0].text
        assert len(s.pool) == 0

    try:
        call(build_server(s), steps)
    finally:
        s.close()


def test_read_dirs_are_listed_and_read_in_place(tmp_path):
    work, data = tmp_path / "work", tmp_path / "data"
    work.mkdir()
    data.mkdir()
    shutil.copy(PANEL, data / "big.dta")
    s = Sessions(http=False, workdir=work, read_dirs=(str(data),), sandbox=True, timeout=30)
    assert str(data) in _instructions(s) and "request_upload" not in _instructions(s)

    async def steps(c):
        r = (await tool(c, "run_do", code=f'use "{data}/big.dta", clear\ncount')).structured_content
        assert r["results"]["r"]["scalars"]["N"] == 1000
        r = (await tool(c, "run_do", code=f'save "{data}/big.dta", replace')).structured_content
        assert r["rc"] == 603  # the original stays read-only
        assert (await tool(c, "upload_file", name="a.csv", path=str(data / "big.dta"))).is_error  # no copy by path

    try:
        call(build_server(s), steps)
    finally:
        s.close()
    assert (data / "big.dta").read_bytes() == PANEL.read_bytes()


def test_upload_tokens_are_single_use_and_expire():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)
    t = s.new_upload("sess", "a.dta")
    assert s.take_upload(t) == ("sess", "a.dta") and s.take_upload(t) is None
    t = s.new_upload("sess", "a.dta")
    s._uploads[t] = ("sess", "a.dta", time.monotonic() - 1)
    assert s.take_upload(t) is None
    s.close()


def _put(url: str, chunks) -> tuple[int, bytes]:
    """PUT with a chunked body, as curl -T sends a large file."""
    import http.client
    from urllib.parse import urlsplit

    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=30)
    try:
        conn.request("PUT", u.path, body=chunks, encode_chunked=True)
        r = conn.getresponse()
        return r.status, r.read()
    finally:
        conn.close()


def _put_header_only(url: str, content_length: str) -> int:
    """PUT that only declares a Content-Length (no body): the server must answer from the header alone."""
    import http.client
    from urllib.parse import urlsplit

    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=30)
    try:
        conn.putrequest("PUT", u.path)
        conn.putheader("Content-Length", content_length)
        conn.endheaders()
        return conn.getresponse().status
    finally:
        conn.close()


def _get(url: str) -> tuple[int, bytes]:
    import http.client
    from urllib.parse import urlsplit

    u = urlsplit(url)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=30)
    try:
        conn.request("GET", u.path)
        r = conn.getresponse()
        return r.status, r.read()
    finally:
        conn.close()


def test_real_http_upload_url():
    proc, port = _start_http("--file-limit", "1")  # 1 MB
    try:

        async def steps(c):
            token = (await tool(c, "start_session")).structured_content["session"]
            up = (await tool(c, "request_upload", name="p.dta", session=token)).structured_content
            assert up["url"].startswith(f"http://127.0.0.1:{port}/upload/") and up["max_bytes"] == 2**20

            data = PANEL.read_bytes()
            # rejected from the header alone, before the URL is used up: the real upload below still works
            assert await asyncio.to_thread(_put_header_only, up["url"], str(2**21)) == 413
            assert await asyncio.to_thread(_put_header_only, up["url"], "abc") == 400
            status, body = await asyncio.to_thread(
                _put, up["url"], (data[i : i + 4096] for i in range(0, len(data), 4096))
            )
            assert status == 200 and json.loads(body)["bytes"] == len(data)
            assert (await asyncio.to_thread(_put, up["url"], iter([b"x"])))[0] == 404  # single use

            big = (await tool(c, "request_upload", name="big.csv", session=token)).structured_content
            assert (await asyncio.to_thread(_put, big["url"], iter([b"1\n" * 2**19] * 3)))[0] == 413

            r = (await tool(c, "run_do", code="use p, clear\ncount", session=token)).structured_content
            assert r["results"]["r"]["scalars"]["N"] == 1000
            r = (
                await tool(c, "run_do", code='capture confirm file big.csv\ndisplay "rc=" _rc', session=token)
            ).structured_content
            assert "rc=601" in r["log"]  # the oversized upload left no file behind
            assert (await tool(c, "request_upload", name="../x", session=token)).is_error
            scratch = await tool(c, "request_upload", name=".dofile", session=token)  # the hidden scratch folder
            assert scratch.is_error and "plain file name" in scratch.content[0].text

            # download: the uploaded file comes back byte for byte, once
            down = (await tool(c, "request_download", name="p.dta", session=token)).structured_content
            assert down["bytes"] == len(data) and down["url"].startswith(f"http://127.0.0.1:{port}/download/")
            status, body = await asyncio.to_thread(_get, down["url"])
            assert status == 200 and body == data
            assert (await asyncio.to_thread(_get, down["url"]))[0] == 404  # single use
            up_token = up["url"].rsplit("/", 1)[1]  # an upload token does not work as a download token
            assert (await asyncio.to_thread(_get, f"http://127.0.0.1:{port}/download/{up_token}"))[0] == 404
            missing = await tool(c, "request_download", name="nosuch.dta", session=token)
            assert missing.is_error and "no file" in missing.content[0].text

        call(f"http://127.0.0.1:{port}/mcp", steps)
    finally:
        proc.terminate()
        proc.wait(10)


def test_timeout_and_cancel_interrupt_but_keep_the_session(tmp_path):
    shutil.copy(PANEL, tmp_path)
    s = Sessions(http=False, workdir=tmp_path, read_dirs=(), sandbox=True, timeout=30)

    async def steps(c):
        await tool(c, "run_do", code="use panel, clear")
        r = await tool(c, "run_do", code="sleep 60000", timeout=1)  # the call's own, shorter limit
        assert not r.is_error and r.structured_content["rc"] == 1
        assert "keeps its data" in r.structured_content["error"]

        task = asyncio.ensure_future(tool(c, "run_do", code="while 1 {\n}"))
        await asyncio.sleep(1)
        task.cancel()  # the client cancels: notifications/cancelled
        t = time.monotonic()
        r = await tool(c, "run_do", code="count")  # waits only until the cancelled code stops
        assert time.monotonic() - t < 5 and r.structured_content["results"]["r"]["scalars"]["N"] == 1000

    try:
        call(build_server(s), steps)
    finally:
        s.close()


def test_get_matrix_and_matrix_sizes(stdio_sessions):
    async def steps(c):
        await tool(c, "run_do", code="matrix A = (1, ., 3 \\ .a, 5, 6)\nmatrix rownames A = r1 r2")
        a = (await tool(c, "get_matrix", name="A")).structured_content
        assert a == {"rows": ["r1", "r2"], "cols": ["c1", "c2", "c3"], "data": [[1, None, 3], [".a", 5, 6]]}

        code = (
            "clear\nset obs 300\nset seed 2\nforvalues i = 1/60 {\n    gen x`i' = rnormal()\n}\n"
            "gen y = x1 + rnormal()\nquietly regress y x*"
        )
        r = (await tool(c, "run_do", code=code)).structured_content["results"]
        assert r["e"]["matrices"] == {"b": "1x61", "V": "61x61"} and r["r"]["matrices"] == {"table": "9x61"}

        part = (await tool(c, "get_matrix", name="e(V)", rows=["x1", "_cons"], cols=["x1"])).structured_content
        assert part["rows"] == ["x1", "_cons"] and part["cols"] == ["x1"] and part["data"][0][0] > 0
        assert len((await tool(c, "get_matrix", name="e(V)")).structured_content["data"]) == 61
        t = (await tool(c, "get_matrix", name="r(table)", rows=["se"], cols=["x1"])).structured_content
        assert abs(t["data"][0][0] - part["data"][0][0] ** 0.5) < 1e-12

        bad = await tool(c, "get_matrix", name="nosuch")
        assert bad.is_error and "not found" in bad.content[0].text
        bad = await tool(c, "get_matrix", name="e(V)", rows=["zz"])
        assert bad.is_error and "no row named zz" in bad.content[0].text

    call(build_server(stdio_sessions), steps)


def test_arguments_are_described_and_session_only_over_http(stdio_sessions):
    http = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)
    try:
        for s in (stdio_sessions, http):
            for t in asyncio.run(build_server(s).list_tools()):
                props = t.input_schema["properties"]
                assert ("session" in props) == s.http or t.name == "start_session", t.name
                if s.http and t.name != "start_session":  # every call needs a token, so the schema says so
                    assert "session" in t.input_schema["required"], t.name
                assert all(p.get("description") for p in props.values()), t.name
    finally:
        http.close()


def test_code_description_names_read_dirs(tmp_path):
    s = Sessions(http=False, workdir=tmp_path, read_dirs=("/data/aea",), sandbox=True, timeout=30)
    try:
        run_do = next(t for t in asyncio.run(build_server(s).list_tools()) if t.name == "run_do")
        assert "/data/aea" in run_do.input_schema["properties"]["code"]["description"]
    finally:
        s.close()


def test_get_file_shows_text_and_refuses_binary(stdio_sessions, tmp_path):
    async def steps(c):
        await tool(
            c,
            "run_do",
            code="use panel, clear\nkeep in 1/5\nsave small, replace\n"
            "export excel using small.xlsx, replace\nexport delimited using small.csv, replace",
        )
        for name in ("small.dta", "small.xlsx", "panel.dta"):
            r = await tool(c, "get_file", name=name)
            assert r.is_error and "binary" in r.content[0].text and "run_do" in r.content[0].text, name
        assert (await tool(c, "get_file", name="small.csv")).content[0].text.count("\n") >= 5
        (tmp_path / "old.csv").write_bytes("name\nJos\xe9\n".encode("latin-1"))
        assert "José" in (await tool(c, "get_file", name="old.csv")).content[0].text

    call(build_server(stdio_sessions), steps)


def test_run_do_attaches_last_five_new_graphs(stdio_sessions):
    async def steps(c):
        code = "use panel, clear\nscatter y x1\nforvalues i = 1/6 {\n    histogram y, name(h`i', replace)\n}"
        r = await tool(c, "run_do", code=code)
        assert r.structured_content["new_graphs"] == 7
        images = [b for b in r.content if b.type == "image"]
        assert len(images) == 5 and all(b.mime_type == "image/png" for b in images)
        assert r.content[0].type == "text" and json.loads(r.content[0].text)["rc"] == 0

        r = await tool(c, "run_do", code="count")  # no new graph: nothing attached
        assert r.structured_content["new_graphs"] == 0 and len(r.content) == 1

        r = await tool(c, "run_do", code="scatter y x2", graphs=False)
        assert r.structured_content["new_graphs"] == 1 and len(r.content) == 1

    call(build_server(stdio_sessions), steps)


def test_log_is_cut_per_command_and_counts_data(stdio_sessions, monkeypatch):
    import dofile.mcp_server as srv

    monkeypatch.setattr(
        srv, "LOG_LIMIT", 8_000
    )  # the `tab id` log is about 9,000 characters: over this, under the shipped limit

    async def steps(c):
        code = "use panel, clear\ntab id\nregress y x1"  # tab id: one row per id
        r = (await tool(c, "run_do", code=code)).structured_content
        log = r["log"]
        assert "lines omitted" in log and r["log_file"]
        assert ". regress y x1" in log and "_cons" in log  # the command after the long one is intact
        assert r["nobs"] == 1000 and r["nvars"] == 10
        assert (await tool(c, "run_do", code="keep x1 y")).structured_content["nvars"] == 2

    call(build_server(stdio_sessions), steps)


def test_only_the_newest_full_logs_are_kept(stdio_sessions, tmp_path, monkeypatch):
    import dofile.mcp_server as srv

    monkeypatch.setattr(srv, "KEEP_LOGS", 2)

    async def steps(c):
        names = []
        for _ in range(3):
            names.append((await tool(c, "run_do", code="use panel, clear\ntab id")).structured_content["log_file"])
            await asyncio.sleep(0.05)  # coarse file timestamps (some Linux file systems) must not tie
        kept = sorted(f.name for f in (tmp_path / ".dofile").glob("dofile-log-*.txt"))
        assert kept == sorted(names[1:])

    call(build_server(stdio_sessions), steps)


def test_upload_refuses_the_scratch_folder_and_folders(stdio_sessions, tmp_path):
    (tmp_path / "sub").mkdir()

    async def steps(c):
        for name, why in ((".dofile", "plain file name"), ("sub", "is a folder")):
            r = await tool(c, "upload_file", name=name, text="x")
            assert r.is_error and why in r.content[0].text, r.content[0].text

    call(build_server(stdio_sessions), steps)


def test_overlapping_calls_report_only_their_own_files(stdio_sessions):
    async def steps(c):
        await tool(c, "run_do", code="display 1")
        a, b = await asyncio.gather(
            tool(c, "run_do", code="use panel, clear\nsave saved_by_a, replace\nsleep 300"),
            tool(c, "run_do", code="display 2"),
        )
        assert [f["name"] for f in a.structured_content["files"]] == ["saved_by_a.dta"]
        assert b.structured_content["files"] == []

    call(build_server(stdio_sessions), steps)


def test_uploads_keep_existing_files_unless_replace(stdio_sessions, tmp_path):
    (tmp_path / "data.csv").write_text("user's own\n")

    async def steps(c):
        r = await tool(c, "upload_file", name="data.csv", text="agent\n")
        assert r.is_error and "replace=true" in r.content[0].text
        assert (tmp_path / "data.csv").read_text() == "user's own\n"
        assert not (await tool(c, "upload_file", name="data.csv", text="agent\n", replace=True)).is_error
        assert (tmp_path / "data.csv").read_text() == "agent\n"

    call(build_server(stdio_sessions), steps)


def test_start_session_is_refused_when_every_session_is_busy():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30, max_sessions=1)

    async def steps(c):
        a = (await tool(c, "start_session")).structured_content["session"]
        long_call = asyncio.create_task(tool(c, "run_do", code="sleep 2000", session=a))
        await asyncio.sleep(1.0)
        full = await tool(c, "start_session")
        assert full.is_error and "running code" in full.content[0].text
        assert not (await long_call).is_error  # the running session was not evicted

    try:
        call(build_server(s), steps)
    finally:
        s.close()


def test_file_tools_do_not_follow_symlinks_out_of_the_workdir(stdio_sessions, tmp_path_factory, tmp_path):
    outside = tmp_path_factory.mktemp("outside") / "secret.txt"
    outside.write_text("SECRET\n")
    (tmp_path / "link.txt").symlink_to(outside)

    async def steps(c):
        assert (await tool(c, "run_do", code="type link.txt")).structured_content["rc"] == 603  # the sandbox's rule
        for name, args in (("get_file", {}), ("upload_file", {"text": "x", "replace": True})):
            r = await tool(c, name, name="link.txt", **args)
            assert r.is_error and "outside the working directory" in r.content[0].text
        assert outside.read_text() == "SECRET\n"

    call(build_server(stdio_sessions), steps)


def test_describe_data_filters_and_pages(stdio_sessions):
    async def steps(c):
        await tool(c, "run_do", code="clear\nset obs 3\nforvalues i = 1/250 {\n    gen v`i' = `i'\n}\ngen age = 1")
        d = (await tool(c, "describe_data")).structured_content
        assert d["nvars"] == 251 and len(d["variables"]) == 200 and d["more"] == 51
        d = (await tool(c, "describe_data", offset=200)).structured_content
        assert [v["name"] for v in d["variables"]][-1] == "age" and d["more"] == 0
        d = (await tool(c, "describe_data", vars="v1? age")).structured_content
        assert [v["name"] for v in d["variables"]] == [f"v1{i}" for i in range(10)] + ["age"] and d["matched"] == 11
        bad = await tool(c, "describe_data", vars="nosuch*")
        assert bad.is_error and bad.content[0].text
        # label / value_label only when set, not null on every variable
        await tool(c, "run_do", code='label var age "Age"\nlabel define yn 1 "yes"\nlabel values v1 yn')
        d = {v["name"]: v for v in (await tool(c, "describe_data", vars="age v1 v2")).structured_content["variables"]}
        assert d["age"]["label"] == "Age" and "value_label" not in d["age"] and d["v1"]["value_label"] == "yn"
        assert set(d["v2"]) == {"name", "type", "format"}

    call(build_server(stdio_sessions), steps)


def test_versions_are_reported(stdio_sessions):
    from dofile import __version__
    from dofile.engine import Engine, about

    v = about()
    assert v["dofile"] == __version__ and len(v["engine_commit"]) == 40
    assert "opendta-patch1-r-table.patch" in v["engine_patches"]
    import tempfile

    assert Engine(tempfile.mkdtemp()).run("display c(stata_version)").log.split("\n")[1].strip() == str(
        v["stata_version"]
    )
    assert f"dofile {__version__}" in _instructions(stdio_sessions)

    async def steps(c):
        assert c.server_info.version == __version__
        assert json.loads((await c.read_resource("dofile://about")).contents[0].text) == v

    call(build_server(stdio_sessions), steps)


def test_get_file_pages_text_and_a_busy_session_answers_at_once(stdio_sessions, tmp_path):
    (tmp_path / "big.txt").write_text("".join(f"{i:07d}\n" for i in range(10000)))  # 80,000 characters

    async def steps(c):
        first = (await tool(c, "get_file", name="big.txt")).content[0].text
        assert first.startswith("0000000\n") and first.endswith("[characters 0-50000 of 80000; next offset 50000]")
        rest = (await tool(c, "get_file", name="big.txt", offset=50000)).content[0].text
        assert rest.endswith("[characters 50000-80000 of 80000; end of file]")
        tail = (await tool(c, "get_file", name="big.txt", offset=-16)).content[0].text
        assert tail.startswith("0009998\n0009999\n") and "[characters 79984-80000" in tail
        assert (await tool(c, "get_file", name="big.txt", limit=500000)).is_error  # over the most a page may hold
        running = asyncio.ensure_future(tool(c, "run_do", code="sleep 60000", timeout=4))
        await asyncio.sleep(1)
        waiting = asyncio.ensure_future(tool(c, "run_do", code="display 1"))  # one call may wait
        await asyncio.sleep(0.5)
        busy = await tool(c, "run_do", code="display 2")
        assert busy.is_error and "still running a call" in busy.content[0].text
        await running
        await waiting

    call(build_server(stdio_sessions), steps)


def test_a_call_cancelled_before_its_thread_starts_leaves_nothing_behind(stdio_sessions):
    """A cancel can land before anyio starts the thread, so the call never runs. It must not count against the
    session's queue (two such cancels used to block run_do for good, even after reset)."""
    import anyio

    w = stdio_sessions.get(None)

    async def go():
        for _ in range(3):
            with anyio.CancelScope() as scope:
                scope.cancel()  # before the first checkpoint: the thread never starts
                await stdio_sessions.call(w, lambda call: w.run("display 1", None, False, call))
            assert scope.cancelled_caught
        q = stdio_sessions.queue(w)
        assert not q.locked() and q.statistics().tasks_waiting == 0
        r = await stdio_sessions.call(w, lambda call: w.run("display 41+1", None, False, call))
        assert r.rc == 0 and "42" in r.log

    anyio.run(go)


def _run(w, code):
    """A Sessions.call function that runs `code` in worker `w`."""
    return lambda call: w.run(code, None, False, call)


def test_waiting_calls_hold_no_threads(stdio_sessions):
    """Calls queue on the session's async lock: 20 waiting behind a running call use no thread (they each held one
    of the ~40 shared threads before), and all run once it ends."""
    import anyio

    s, w = stdio_sessions, stdio_sessions.get(None)
    results = []

    async def describe():
        results.append(await s.call(w, lambda call: w.data_summary()))

    async def go():
        limiter = anyio.to_thread.current_default_thread_limiter()
        async with anyio.create_task_group() as tg:
            tg.start_soon(s.call, w, _run(w, "sleep 1500"))
            await anyio.sleep(0.5)
            for _ in range(20):
                tg.start_soon(describe)
            await anyio.sleep(0.3)
            assert limiter.borrowed_tokens == 1 and s.queue(w).statistics().tasks_waiting == 20

    anyio.run(go)
    assert len(results) == 20 and all(r["nobs"] == 0 for r in results)


def test_cancels_at_random_moments_leave_the_queue_free(stdio_sessions):
    """Cancels land before the thread starts, while it starts, while the code runs and just after it ends. After
    each, the queue must be free and the session must answer."""
    import random

    import anyio

    s, w = stdio_sessions, stdio_sessions.get(None)
    rng = random.Random(7)

    async def go():
        await s.call(w, _run(w, "display 0"))  # the child process is up
        for _ in range(30):
            with anyio.move_on_after(rng.uniform(0, 0.05)):
                await s.call(w, _run(w, "sleep 30"))
            q = s.queue(w)
            assert not q.locked() and q.statistics().tasks_waiting == 0
            r = await s.call(w, _run(w, "display 6*7"))
            assert r.rc == 0 and "42" in r.log

    anyio.run(go)


def test_a_cancelled_waiting_call_never_runs(stdio_sessions):
    import anyio

    s, w = stdio_sessions, stdio_sessions.get(None)
    out = {}

    async def long_call():
        out["long"] = await s.call(w, _run(w, 'sleep 1000\ndisplay "long done"'))

    async def go():
        async with anyio.create_task_group() as tg:
            tg.start_soon(long_call)
            await anyio.sleep(0.3)
            with anyio.move_on_after(0.3) as scope:
                await s.call(w, _run(w, 'global waiter "ran"'))
            assert scope.cancelled_caught
        assert out["long"].rc == 0 and "long done" in out["long"].log  # the running call was not disturbed
        r = await s.call(w, _run(w, 'display "[$waiter]"'))
        assert r.rc == 0 and "[]" in r.log  # the cancelled call's code never ran

    anyio.run(go)


def test_an_error_in_a_call_comes_out_unwrapped(stdio_sessions):
    """Sessions.call runs in a task group, which wraps errors in an ExceptionGroup; it must re-raise the error itself."""
    import anyio

    s, w = stdio_sessions, stdio_sessions.get(None)

    def boom(call):
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        anyio.run(s.call, w, boom)
    assert not s.queue(w).locked()


def test_data_tools_wait_behind_a_running_call(stdio_sessions):
    """describe_data and get_matrix wait their turn and answer from the state after the running call. A waiting call
    of any tool counts as the one call that may wait, so a run_do after them is refused."""

    async def steps(c):
        await tool(c, "run_do", code="use panel, clear\nmatrix A = (1, 2)")
        running = asyncio.ensure_future(tool(c, "run_do", code="sleep 1500\ndrop in 1/10\nmatrix A = (3, 4)"))
        await asyncio.sleep(0.5)
        described = asyncio.ensure_future(tool(c, "describe_data"))
        matrix = asyncio.ensure_future(tool(c, "get_matrix", name="A"))
        await asyncio.sleep(0.3)
        refused = await tool(c, "run_do", code="display 1")
        assert refused.is_error and "still running a call" in refused.content[0].text
        assert not (await running).is_error
        assert (await described).structured_content["nobs"] == 990
        assert (await matrix).structured_content["data"] == [[3, 4]]

    call(build_server(stdio_sessions), steps)


def test_http_reset_runs_after_waiting_calls_and_ends_the_session():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)

    async def steps(c):
        a = (await tool(c, "start_session")).structured_content["session"]
        await tool(c, "run_do", code="display 0", session=a)
        w = s.pool.find(a)
        running = asyncio.ensure_future(tool(c, "run_do", code="sleep 1000", session=a))
        await asyncio.sleep(0.3)
        waiting = asyncio.ensure_future(tool(c, "run_do", code='display "second"', session=a))
        await asyncio.sleep(0.2)
        assert not (await tool(c, "reset", session=a)).is_error
        assert not (await running).is_error
        second = (await waiting).structured_content  # queued before the reset, so it ran first
        assert second["rc"] == 0 and "second" in second["log"]
        after = await tool(c, "run_do", code="display 1", session=a)
        assert after.is_error and "unknown or expired session" in after.content[0].text
        assert w.closed and w._proc is None and w.run("display 2").rc == 9998  # never restarted

    try:
        call(build_server(s), steps)
    finally:
        s.close()


def test_unsafe_http_only_on_loopback(capsys):
    from dofile.mcp_server import main

    with pytest.raises(SystemExit) as e:
        main(["--http", "--host", "0.0.0.0", "--unsafe"])
    assert e.value.code == 2 and "loopback" in capsys.readouterr().err


def test_schema_doc_names_every_output_field():
    """MCP-SCHEMA.md is written by hand: every field of a tool's output type must appear in it."""
    from pathlib import Path

    import dofile.mcp_server as m

    doc = (Path(__file__).parents[1] / "MCP-SCHEMA.md").read_text()
    missing = [
        f"{t.__name__}.{k}"
        for t in (m.RunResult, m.Results, m.DataSummary)
        for k in t.__annotations__
        if f"`{k}`" not in doc
    ]
    assert missing == []
