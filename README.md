# dofile

Run Stata-syntax `.do` files without a Stata license, and expose them to AI agents over MCP.

Status: Phase 1 in progress (see `docs/phase1-plan.md`).

## MCP server

```bash
uv sync --extra mcp
```

Add it to Claude Code (stdio; the session works in the folder you launch it from):

```bash
claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp --workdir "$PWD"
```

Tools: `run_do` (run Stata code; returns log, rc, error, e()/r() as JSON and new files), `describe_data`,
`get_file` (returns exported graphs as images), `upload_file`, `reset`. Resource `dofile://commands` lists the
supported commands. Data stays in memory between `run_do` calls.

HTTP: `dofile-mcp --http --port 8000` (localhost only by default). Call `start_session` first and pass its
token as `session`; each session gets its own temporary folder, deleted when the session ends.

**Sandbox (on by default; `--unsafe` turns it off):** `shell`/`!`, `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`
and `webuse` are disabled. Files can only be written in the working folder, and read from it, from `--read-dir`
folders and from the Python installation. No subprocesses or network. Each call has a timeout (`--timeout`,
default 60 s); a timeout or crash resets that session (rc 9998). The sandbox is a policy layer, not a security
boundary: run public HTTP deployments in a container.

## Engine

A vendored copy of [OpenDTA](https://github.com/yaskepalhares/opendta) (MIT), pinned in
`src/dofile/_vendor/opendta/VENDORED`. Not affiliated with StataCorp; Stata is a registered trademark of StataCorp LLC.
