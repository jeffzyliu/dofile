# dofile

Run Stata-syntax `.do` files without a Stata license, and expose them to AI agents over MCP.

Status: Phase 1 in progress (see `docs/phase1-plan.md`).

## Command line

```bash
uv run dofile run analysis.do --json results.json
```

Prints the log like `stata -b`, exits 1 if the do-file stops on an error, and optionally writes the return code
and `e()`/`r()` results as JSON. It runs in the current folder with the sandbox on (see below); `--unsafe` turns it
off for trusted code that needs `shell`, `cd` or `erase`.

## MCP server

```bash
uv sync --extra mcp
```

Add it to Claude Code (stdio; the session works in the folder you launch it from):

```bash
claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp --workdir "$PWD"
```

Tools: `run_do` (run Stata code; returns log, rc, error, e()/r() as JSON and new files), `describe_data`,
`get_file` (returns exported graphs as images), `get_matrix` (one matrix, or part of it, at full precision), `upload_file`, `request_upload` and `request_download` (HTTP), `reset`. Resource `dofile://commands` lists the
supported commands. Data stays in memory between `run_do` calls. Full inputs, outputs and return codes: [MCP-SCHEMA.md](MCP-SCHEMA.md).

HTTP: `dofile-mcp --http --port 8000` (localhost only by default). Call `start_session` first and pass its
token as `session`; each session gets its own temporary folder, deleted when the session ends.

**Large files** never need to pass through the model's context:

- stdio: start with `--read-dir /path/to/data`. The folders are listed in the server's instructions, and code
  reads files in place by absolute path (`use "/path/to/data/file.dta"`). They are read-only; output goes to
  the working folder.
- HTTP: the agent calls `request_upload(name, session)` and gets a one-time URL (valid 10 minutes), then sends
  the file itself, e.g. `curl --fail -T file.dta <url>`. Behind a proxy or in a container, set `--public-url`
  to the address clients reach the server at. (`--read-dir` here means folders on the server.)

`--file-limit` sets the largest upload in MB (default 1024). Small files the agent writes itself (CSV, .do)
go inline with `upload_file(name, text=...)`.

**Sandbox (on by default; `--unsafe` turns it off):** `shell`/`!`, `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`
and `webuse` are disabled. Files can only be written in the working folder, and read from it, from `--read-dir`
folders and from the Python installation. No subprocesses or network. Each call has a timeout (`--timeout`,
default 60 s); a call that runs too long or is cancelled is interrupted like Stata's Break key (rc 1, data
kept), and only code that does not stop, or a crash, resets that session (rc 9998). The sandbox is a policy layer, not a security
boundary: run public HTTP deployments in a container.

## Development

Check the local MCP server with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (needs Node):

```bash
npx @modelcontextprotocol/inspector uv run --extra mcp dofile-mcp        # web UI: list tools, call run_do
npx @modelcontextprotocol/inspector --cli uv run --extra mcp dofile-mcp --method tools/call \
  --tool-name run_do --tool-arg 'code=display 2+2'                       # scripted check
```

For HTTP mode, start `uv run --extra mcp dofile-mcp --http` and connect the Inspector to `http://127.0.0.1:8000/mcp`
(call `start_session` first).

```bash
uv sync --extra mcp
uv run --extra mcp pytest -q            # ~90 s; skips the slow Stata 14 log comparison
uv run --extra mcp pytest -q tests      # dofile's own tests only, without OpenDTA's suite in tests_opendta/
uv run --extra mcp pytest -q -m slow    # the Stata 14 log comparison (~3 min)
uv run --extra mcp pytest -q -m ""      # everything, as CI does
```

- `tests/conformance/`: dofile's corpus with reference values from statsmodels/linearmodels, plus breadth probes.
  Known engine gaps are strict xfails, so a fix in OpenDTA shows up as a failure to remove.
- `scripts/vendor_opendta.py [COMMIT]`: re-vendor OpenDTA, then run the full suite.
- CI: Ubuntu and macOS, Python 3.12–3.14 (`.github/workflows/ci.yml`). Dev default is 3.14 (`.python-version`).

## Engine

A vendored copy of [OpenDTA](https://github.com/yaskepalhares/opendta) (MIT), pinned in
`src/dofile/_vendor/opendta/VENDORED`. dofile's own changes to it are patches in `scripts/patches/`
(currently: `r(table)` after estimation), re-applied by the vendor script. Not affiliated with StataCorp; Stata is a registered trademark of StataCorp LLC.

## License

MIT ([LICENSE](LICENSE)). Contributions follow the clean-room and license rules in
[LICENSE-POLICY.md](LICENSE-POLICY.md): no StataCorp files or text, no GPL code.
