# dofile

Run Stata-syntax `.do` files without a Stata license, and expose them to AI agents over MCP.

Status: early preview (0.1.x, alpha). Emulates Stata 14.

## Install

Pre-releases only so far, so pip needs `--pre`:

```bash
pip install --pre dofile            # the dofile command
pip install --pre "dofile[mcp]"     # adds the dofile-mcp server
```

Python 3.12 or newer. From a source checkout, use `uv sync --extra mcp` and `uv run` instead.

## Command line

```bash
dofile run analysis.do --json results.json
```

Prints the log like `stata -b` and exits 1 if the do-file stops on an error. `--json` also writes
`{rc, error, error_command, results, versions}`, where `results` holds `e()` and `r()` in the same form as the MCP
server's (see [MCP-SCHEMA.md](https://github.com/jeffzyliu/dofile/blob/main/MCP-SCHEMA.md)). It runs with the sandbox on (see below): code writes only to the
working folder (the current one, or `--workdir`), and reads from it, from the do-file's own folder (so nested
`do` files work) and from any `--read-dir` folders. `--unsafe` turns the sandbox off for trusted code that needs
`shell`, `cd` or `erase`.

## MCP server

Install with `pip install --pre "dofile[mcp]"`, then add it to Claude Code (stdio; the session works in the folder you
launch it from):

```bash
claude mcp add dofile -- dofile-mcp --workdir "$PWD"
```

From a source checkout: `claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp --workdir "$PWD"`.

Tools: `run_do` (run Stata code; returns log, rc, error, e()/r() as JSON and new files), `describe_data`,
`get_file` (exported graphs as images, logs and CSVs as text in pages), `get_matrix` (one matrix, or part of it, at full precision), `upload_file`, `start_session`, `request_upload` and `request_download` (HTTP), `reset`. Resources: `dofile://commands` lists the
supported commands, `dofile://about` the versions. Data stays in memory between `run_do` calls. Full inputs, outputs and return codes: [MCP-SCHEMA.md](https://github.com/jeffzyliu/dofile/blob/main/MCP-SCHEMA.md).

**Readable logs in Claude Code** (optional): Claude Code shows an MCP result as JSON, so a log is one string full of
`\n`. The `dofile-log` plugin prints each `run_do` log in the terminal under the call, colored and between two
rules, and keeps it out of the model's context. It needs `jq`, works with stdio and HTTP, and shows the `log` in
the result (cut for long runs; the bar names the file with the full log):

```
/plugin marketplace add jeffzyliu/dofile
/plugin install dofile-log@dofile
```

Source: [plugins/dofile-log](https://github.com/jeffzyliu/dofile/tree/main/plugins/dofile-log). The same text is always in the `log_file` the result names.

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
go inline with `upload_file(name, text=...)`. Uploads never overwrite an existing file unless the agent passes
`replace=true`, as with Stata's `save, replace`: over stdio the working folder is your own.

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
uv run poe test          # in parallel, ~35 s; skips the slow Stata 14 log comparison
uv run poe test tests    # dofile's own tests only, without OpenDTA's suite in tests_opendta/
uv run poe slow          # the Stata 14 log comparison (~75 s)
uv run poe ci            # every test, as CI runs them
uv run poe lint          # ruff format --check, then ruff check (CI runs it too); `uv run poe format` fixes the layout
```

- `tests/conformance/`: dofile's corpus with reference values from statsmodels/linearmodels, plus breadth probes.
  Known engine gaps are strict xfails, so a fix in OpenDTA shows up as a failure to remove.
- `scripts/vendor_opendta.py [COMMIT]`: re-vendor OpenDTA, then run the full suite.
- CI: Ubuntu and macOS, Python 3.12–3.14, and a ruff format and lint job (`.github/workflows/ci.yml`); the web demo has its own workflow
  (`.github/workflows/web.yml`). Dev default is 3.14 (`.python-version`).

## Web demo

[`web/`](https://github.com/jeffzyliu/dofile/blob/main/web/README.md) runs the same engine in the browser (Pyodide in a Web Worker, no server): an editor, files kept
in the browser, Run and Break, the log and graphs. Its README lists the scripts (dev server, build, tests, the memory
snapshot) and what each folder holds. CI for it is `.github/workflows/web.yml`.

## Engine

A vendored copy of [OpenDTA](https://github.com/yaskepalhares/opendta) (MIT), pinned in
`src/dofile/_vendor/opendta/VENDORED`. dofile's own changes to it are patches in `scripts/patches/`
(`r(table)` after estimation, and fixes for engine bugs listed in
[docs/opendta-issues.md](https://github.com/jeffzyliu/dofile/blob/main/docs/opendta-issues.md)), re-applied by the vendor script. Not affiliated with StataCorp; Stata is a registered trademark of StataCorp LLC.

## License

MIT ([LICENSE](https://github.com/jeffzyliu/dofile/blob/main/LICENSE)). Contributions follow the clean-room and license rules in
[LICENSE-POLICY.md](https://github.com/jeffzyliu/dofile/blob/main/LICENSE-POLICY.md): no StataCorp files or text, no GPL code.
