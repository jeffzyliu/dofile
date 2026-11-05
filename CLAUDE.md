# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

dofile runs Stata-syntax `.do` code without a Stata license (CLI `dofile`) and exposes it to agents over MCP
(`dofile-mcp`). The interpreter is a vendored copy of OpenDTA (MIT); dofile adds the adapter, sandbox, worker
processes, MCP server and CLI around it.

## Commands

```bash
uv sync --extra mcp                                   # dev env (Python 3.14 per .python-version; floor 3.12)
uv run poe                                            # list tasks (poethepoet; defined in pyproject.toml)
uv run poe test                                       # default suite in parallel, ~35 s; skips the slow Stata comparison
uv run poe test tests/test_mcp.py::test_stdio_mode_tools   # one test (extra args go to pytest)
uv run poe test tests                                 # dofile's own tests only (not OpenDTA's vendored suite)
uv run poe slow                                       # Stata 14 log comparison only (~75 s)
uv run poe ci                                         # everything, as CI does
uv run dofile run path/to/file.do --json out.json     # batch run (sandboxed; --unsafe to lift it)
uv run poe mcp [--http --port 8000]                   # MCP server, stdio by default
uv run poe vendor [COMMIT]                            # re-vendor OpenDTA, re-apply patches
uv build                                              # sdist + wheel (the wheel is built from the sdist)
```

poe runs every task as `uv run --extra=mcp ...` (`[tool.poe] executor`), so the MCP tests always run; with plain
`pytest` and no `--extra mcp`, `tests/test_mcp.py` is skipped (`importorskip`). That nested `uv run` ignores an outer
`--python`: set `UV_PYTHON` to test another version (CI does). Run xdist from the project env (it's in
the `dev` group), not `uv run --with pytest-xdist`: the overlay env's `sys.prefix` isn't the `.venv`, so the
sandbox refuses the project's own packages and graph/sandbox tests fail with rc 603. The Stata comparison is one test
per case, so `-n auto` runs those in parallel too. There is no linter or formatter configured.

Agents: run the whole suite (`poe test`, `poe slow`, `poe ci`) as a background task with its output going to a
file, and read the file while it runs: `uv run poe test > .dofile/test.log 2>&1` (`.dofile/` is gitignored). Don't
pipe it through `tail` or `head`: they print nothing until the command ends, so a run in progress looks like an
empty one. pytest prints dots as tests finish and a summary line at the end; wait for the completion notice, then
read the last lines of the log. A single test or file is quick enough to run in the foreground.

## Architecture

Layers, bottom up (`src/dofile/`):
- `_vendor/opendta/`: the engine. **Never edit it by hand.** `scripts/vendor_opendta.py` copies a pinned
  upstream commit, rewrites `opendta` imports to `dofile._vendor.opendta`, drops `gui/` and `__main__.py`,
  copies OpenDTA's tests into `tests_opendta/`, then applies `scripts/patches/*.patch`. A change to the engine
  is a new patch file there, then a re-vendor. The `VENDORED` stamp (commit, patches) is read at runtime by
  `engine.about()`.
- `engine.py`: the only adapter over OpenDTA's `Session`. `Engine.run(code)` returns a `Result` and never
  raises. Return codes beyond Stata's: 9999 (a Python exception escaped the engine), 603 (sandbox refused a
  file), 1 (`--Break--` from an interrupt; data kept). `results()` groups e()/r() as
  `{scalars, macros, matrices}`, with missing values as `null`/`".a"` and matrix names as `eq:name`.
- `sandbox.py`: two layers, installed once per process. Dangerous commands (`shell`, `erase`, `cd`, `copy`,
  `webuse`, ...) are replaced in OpenDTA's registry with an rc 199 error, and a PEP 578 audit hook blocks
  subprocesses and network access and confines writes to the workdir and reads to the workdir, `--read-dir`
  folders and code folders. Audit hooks can't be removed, which is why sandbox tests run each case in a
  subprocess. Temp files and matplotlib's cache go in a hidden `.dofile/` folder inside the workdir.
- `worker.py`: one child process per session. On Linux and macOS, children fork from a forkserver that has
  preloaded the engine (`_forkserver.py`); Windows uses spawn. The sandbox is installed in the child after the
  fork. A timeout or cancel sends SIGINT (Break, rc 1, data kept); a child that doesn't stop within 5 s is
  killed (rc 9998, "session reset"). `WorkerPool` keys workers by session token; when full it evicts the least recently used idle session (never one running code), with idle
  reaping.
- `mcp_server.py`: `MCPServer` (mcp 2.3.0). Over stdio there is one session in the launch folder. Over HTTP,
  protocol 2026-07-28 has no MCP session, so sessions are explicit tokens from the `start_session` tool, each
  with its own temp workdir. Errors meant for the agent must be raised as `ToolError` (the SDK hides others).
  Tool outputs are `TypedDict`s, which become the advertised `outputSchema`, and the SDK validates every result
  against them.
- `cli.py`: `dofile run` runs `do` on the file inside one sandboxed `Engine`, passing the path through a local
  macro so `$` and backquotes in it aren't expanded (OpenDTA ignores `\$` escapes). The log is not capped.

**Changing the result format or a tool** means updating the TypedDicts in `mcp_server.py` and `MCP-SCHEMA.md`
together. While dofile is 0.x, a breaking change to the result format raises the minor version.

## Tests

- `tests/`: dofile's own tests. `tests/conformance/` runs a corpus of `.do` files whose `CHECK name=value`
  lines must match `data/ref.json` (statsmodels/linearmodels results) to 1e-6, plus pass/fail probes, all with
  the sandbox on. Known engine gaps are `xfail(strict=True)`, and their reasons carry IDs from
  `docs/opendta-issues.md`. When an OpenDTA fix lands, the xfail fails and must be removed.
- `tests_opendta/`: OpenDTA's own suite and its Stata 14 reference logs, regenerated by the vendor script; don't
  edit. `tests/test_stata_compat.py` (marked `slow`) runs each case with `tests_opendta/tools/compare.py`'s
  functions, one test per case in its own folder; the slowest cases are ordered so xdist starts them on separate workers.

## Rules

- Clean room (`LICENSE-POLICY.md`): never copy StataCorp files (`.ado`, `.sthlp`, ...), manual or help text,
  or example datasets; write from documented behavior. No GPL/AGPL code or dependencies. The Stata reference logs
  stay out of distributions (excluded from the sdist in `pyproject.toml`).
- `legacy/` holds the 2020 OpenStata repos (gitignored); leave it alone.
- Status and next steps: `docs/phase1-plan.md`. Known OpenDTA problems to verify against Stata:
  `docs/opendta-issues.md`. dofile's own agent-ergonomics problems:
  `docs/agent-ergonomics.md`.
