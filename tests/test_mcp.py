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
from mcp import Client, StdioServerParameters  # noqa: E402

from dofile.mcp_server import LOG_LIMIT, Sessions, _instructions, build_server  # noqa: E402

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
        assert names == {"run_do", "describe_data", "get_file", "upload_file", "reset"}  # no start_session on stdio

        r = (await tool(c, "run_do", code="use panel, clear\nregress y x1 x2\nscatter y x1\ngraph export s.png")).structured_content
        assert r["rc"] == 0 and r["results"]["e"]["N"] == 1000 and r["results"]["e"]["cmd"] == "regress"
        assert r["files"] == ["s.png"]  # the hidden .dofile/ cache is not reported
        # state persists between calls
        assert (await tool(c, "run_do", code="count")).structured_content["results"]["r"]["N"] == 1000
        assert (await tool(c, "describe_data")).structured_content["nobs"] == 1000

        img = await tool(c, "get_file", name="s.png")
        assert img.content[0].type == "image" and img.content[0].mime_type == "image/png"

        bad = await tool(c, "get_file", name="../secret")
        assert bad.is_error and "plain file name" in bad.content[0].text  # the reason reaches the agent

        await tool(c, "upload_file", name="a.csv", text="v\n1\n2\n")
        r = (await tool(c, "run_do", code="import delimited using a.csv, clear\nsummarize v")).structured_content
        assert r["results"]["r"]["mean"] == 1.5

        r = (await tool(c, "run_do", code="shell echo hi")).structured_content
        assert r["rc"] == 199 and "sandbox" in r["error"]

        r = (await tool(c, "run_do", code="forvalues i = 1/3000 {\n    display \"line `i'\"\n}")).structured_content
        assert len(r["log"]) < LOG_LIMIT + 200 and "log truncated" in r["log"]
        assert any(f.startswith("dofile-log-") for f in r["files"])

        await tool(c, "reset")
        assert (await tool(c, "run_do", code="count")).structured_content["results"]["r"]["N"] == 0

        out = {t.name: t.output_schema for t in (await c.list_tools()).tools}
        assert out["run_do"]["title"] == "RunResult" and out["describe_data"]["title"] == "DataSummary"

        cmds = (await c.read_resource("dofile://commands")).contents[0].text.split("\n")
        assert "regress" in cmds and "shell" not in cmds
    call(build_server(stdio_sessions), steps)


def test_http_mode_needs_tokens_and_isolates_sessions():
    s = Sessions(http=True, workdir=Path("."), read_dirs=(), sandbox=True, timeout=30)

    async def steps(c):
        assert "start_session" in {t.name for t in (await c.list_tools()).tools}
        missing = await tool(c, "run_do", code="display 1")
        assert missing.is_error and "start_session" in missing.content[0].text

        a = (await tool(c, "start_session")).structured_content["session"]
        b = (await tool(c, "start_session")).structured_content["session"]
        await tool(c, "run_do", code="clear\nset obs 7", session=a)
        assert (await tool(c, "run_do", code="count", session=b)).structured_content["results"]["r"]["N"] == 0
        assert (await tool(c, "run_do", code="count", session=a)).structured_content["results"]["r"]["N"] == 7

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
        return r["rc"], r["results"]["e"]["N"]
    assert call(params, steps) == (0, 1000)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_http(*args):
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "dofile.mcp_server", "--http", "--port", str(port), *args],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
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
            return r["rc"], r["results"]["r"]["N"]
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
        assert r["results"]["r"]["N"] == 1000
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


def test_real_http_upload_url():
    proc, port = _start_http("--file-limit", "1")  # 1 MB
    try:
        async def steps(c):
            token = (await tool(c, "start_session")).structured_content["session"]
            up = (await tool(c, "request_upload", name="p.dta", session=token)).structured_content
            assert up["url"].startswith(f"http://127.0.0.1:{port}/upload/") and up["max_bytes"] == 2**20

            data = PANEL.read_bytes()
            status, body = await asyncio.to_thread(_put, up["url"], (data[i:i + 4096] for i in range(0, len(data), 4096)))
            assert status == 200 and json.loads(body)["bytes"] == len(data)
            assert (await asyncio.to_thread(_put, up["url"], iter([b"x"])))[0] == 404  # single use

            big = (await tool(c, "request_upload", name="big.csv", session=token)).structured_content
            assert (await asyncio.to_thread(_put, big["url"], iter([b"1\n" * 2**19] * 3)))[0] == 413

            r = (await tool(c, "run_do", code="use p, clear\ncount", session=token)).structured_content
            assert r["results"]["r"]["N"] == 1000
            r = (await tool(c, "run_do", code='capture confirm file big.csv\ndisplay "rc=" _rc',
                            session=token)).structured_content
            assert "rc=601" in r["log"]  # the oversized upload left no file behind
            assert (await tool(c, "request_upload", name="../x", session=token)).is_error
        call(f"http://127.0.0.1:{port}/mcp", steps)
    finally:
        proc.terminate()
        proc.wait(10)


def test_session_reset_result_matches_output_schema(tmp_path):
    s = Sessions(http=False, workdir=tmp_path, read_dirs=(), sandbox=True, timeout=1)

    async def steps(c):
        r = await tool(c, "run_do", code="sleep 5000")
        assert not r.is_error
        assert r.structured_content["rc"] == 9998 and r.structured_content["results"] == {"e": {}, "r": {}}
    try:
        call(build_server(s), steps)
    finally:
        s.close()
