import asyncio
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

mcp = pytest.importorskip("mcp")
from mcp import Client, StdioServerParameters  # noqa: E402

from dofile.mcp_server import LOG_LIMIT, Sessions, build_server  # noqa: E402

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


def test_real_http_transport():
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "dofile.mcp_server", "--http", "--port", str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):  # wait for the server to listen
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)

        async def steps(c):
            token = (await tool(c, "start_session")).structured_content["session"]
            r = (await tool(c, "run_do", code="clear\nset obs 3\ncount", session=token)).structured_content
            return r["rc"], r["results"]["r"]["N"]
        assert call(f"http://127.0.0.1:{port}/mcp", steps) == (0, 3)
    finally:
        proc.terminate()
        proc.wait(10)
