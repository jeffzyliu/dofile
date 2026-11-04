# dofile — Phase 1 plan

**Goal:** an installable, open-source Python package that runs Stata-syntax .do code with no Stata license, plus an
MCP server (`dofile-mcp`) that lets agents use it. Engine: OpenDTA (MIT), chosen in `docs/engine-evaluation.md`.

**Not in Phase 1:** the web demo (Phase 2), accounts/storage, our own estimators, community commands
(`reghdfe`, `esttab`, `outreg2`), fixing OpenDTA upstream.

## Facts this plan rests on (checked 2026-11-03)
- OpenDTA is not on PyPI, and PyPI rejects packages that depend on a git URL. Our installs could pin it by commit,
  but `pip install dofile` would then fail.
- OpenDTA lists PySide6 (Qt, ~500 MB) as a hard dependency, though only `opendta/gui/` uses it. A uv
  `override-dependencies` entry drops it, and `Session()` then runs headless (venv 203 MB). That only helps our
  own installs, not downstream pip users.
- In-process API: `Session().run(src) → rc`; output via `session.output.add_listener(fn)` (or
  `opendta.core.output.Capture`); results in `session.e` / `session.r` (dicts; `e(b)`/`e(V)` are `Matrix` with
  `data`, `rownames`, `colnames`); data in `session.data` (`names()`, `nobs()`, `get(name)`).
- **OpenDTA's `shell` runs `subprocess.run(cmd, shell=True)`.** Any client that can send Stata code can then run
  programs on the host. File commands (`save`, `export`, `log`, `file`, `erase`, `rm`, `rmdir`, `mkdir`, `copy`,
  `cd`) take any path, and `webuse`/`copy` reach the network. There's no embedded-Python or `exec` route.
- Known crash: `xtlogit, re` raises an uncaught `OverflowError` (not a `StataError`), even inside `capture`.
  `while 1 {}` never returns.
- MCP SDK is `mcp` 2.3.0. `FastMCP` was renamed `MCPServer` (`from mcp.server.mcpserver import MCPServer`), with
  `@server.tool()` and `server.run("stdio" | "streamable-http")`. Tools get `ctx.session_id`, which is `None` on
  stdio and stateless HTTP, and set on stateful streamable HTTP.
- Vendoring is clean. OpenDTA uses no absolute `opendta` imports. Outside `gui/`, the only GUI/updater
  reference is a lazy import inside `cli.py`, which we don't vendor.
- The registry has 515 commands. I/O-capable names actually present: `shell` (`!cmd` and `sh` map to it),
  `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`, `webuse`, `sysuse`, `adopath`, `use`, `save`, `export`, `import`,
  `log`, `file`, `outsheet`, `insheet`, `infile`, `infix`, `graph`, `putexcel`, `tempfile`, `preserve`, `dir`/`ls`,
  `type`. `winexec`, `net`, `ssc` and `findit` don't exist.

## Decisions to confirm
1. **Vendor OpenDTA** into `src/dofile/_vendor/opendta/` at a pinned commit, without `gui/`, `updater.py` and
   `cli.py`, keeping its LICENSE and `packaging/THIRD_PARTY_NOTICES.md` (the bundled `data/*.dta` and `data/icd`
   have their own data licenses). A sync script re-vendors a new commit. This fixes both PyPI publishing and Qt. The alternative,
   a git-pinned dependency, works only from source checkouts. *(Recommended: vendor.)*
2. **The MCP server is Python, and the Node backend is retired.** This replaces your original "make the backend an
   MCP server". With a Python engine, a Node layer would only add a hop.
3. **Layout:** the uv project lives at the top of this folder (no `dofile/` subfolder). Move the three 2020 repos to `legacy/`
   unchanged and **gitignore `legacy/`**. Each of the three is its own git repo with a GitHub remote, so a
   top-level `git init` would otherwise record them as broken embedded repos. Then run `git init` at the top.

## Package layout
```
./
  pyproject.toml          # name "dofile"; script entry points: dofile, dofile-mcp
  src/dofile/
    _vendor/opendta/      # pinned copy, MIT, gui/ + updater.py removed
    engine.py             # Engine: run(src) -> Result; results(); data_summary()
    sandbox.py            # command denylist + audit hook (path / subprocess / socket)
    worker.py             # one child process per session; timeout + crash recovery
    mcp_server.py         # MCPServer tools, stdio + streamable HTTP
    cli.py                # `dofile run file.do [--json]` (batch, like stata -b)
  scripts/vendor_opendta.py
  tests/                  # unit tests + eval/ corpus as conformance suite
```

## Components
**1. `engine.py` (thin adapter, in-process).** `Engine(workdir)` wraps one `Session` with a `Capture` listener.
`run(src) → Result(log: str, rc: int, error: str|None)`. It catches *any* exception, not just `StataError`, and
reports it as `rc=9999` with the traceback's last line, so a Python crash doesn't take the caller down.
`results()` turns `e()`/`r()` into JSON: scalars, macros as strings, matrices as `{rows, cols, data}`.
`data_summary()` returns `nobs`, plus each variable's name, type, label and value-label name. This is the only
module that imports OpenDTA, so swapping engines later (OpenStat or our own) touches one file.

**2. `sandbox.py` (on by default; `--unsafe` turns it off for local trusted use).**
- Denylist (names checked against the registry): `shell` (also covers `!` and `sh`), `erase`/`rm`, `rmdir`,
  `mkdir`, `cd`, `copy`, `webuse`. Each returns rc 199 with a clear "disabled in dofile sandbox" message. Every
  other file command (`use`, `save`, `log`, `file`, `export`, `graph export`, `tempfile`, `preserve` …) stays
  available and is confined by the path rule below.
- `sys.addaudithook` in the worker blocks `subprocess.Popen`, `os.system`, `os.exec*`, `socket.connect`, plus
  writes and deletes outside the session workdir. Reads are allowed only in the workdir, the dataset dirs the
  server was started with, and the Python install.
- Before the engine is imported, the worker sets `TMPDIR`, `MPLCONFIGDIR` and `HOME` to the session workdir.
  `tempfile`, `preserve` and matplotlib's cache then stay inside the allowed area.
- Built (step 3, `src/dofile/sandbox.py`): the audit hook also blocks DNS lookups. `mimetypes` is pre-loaded,
  since openpyxl reads `/etc/mime.types`, and a refused file access returns Stata's rc 603 with the reason.
  `graph export` is the exception: OpenDTA prints its own 603 text there. OpenDTA has no URL support in
  `use`/`import`, so `webuse` and `copy` were the only network commands. The whole corpus and every probe give
  the same results with the sandbox on.
- This is defense in depth, not a security boundary. Audit hooks are sufficient here because clients send Stata,
  not Python. The docs will say a public HTTP deployment should also run in a container.

**3. `worker.py` (process isolation).** Each MCP session gets its own child process (`multiprocessing`, spawn) with
its own `Engine`.
- **Workdir:** with stdio, the launch directory or `--workdir`. That's the main local use: a replication package
  with relative `use data/x.dta` / `do 01_clean.do` paths. With HTTP, a fresh temp dir per session.
- **Session key:** `ctx.session_id` on stateful HTTP. On stdio, one worker for the process.
- Built (step 4, `src/dofile/worker.py`): `Worker` (spawned child, pipe, per-call timeout) and `WorkerPool`
  (LRU cap, idle reaping, a temp workdir per session that is deleted on close). If the child died between
  calls, that call returns rc 9998 without running the code, so the agent knows its data is gone.
  The next call starts fresh. Startup is about 1 s per new session. Each call has a timeout (default 60 s, configurable). On timeout or a dead
worker, the process is killed and the tool returns `rc=9998` with "session reset: data in memory was lost". The
next call starts a fresh worker. Idle workers are reaped after 15 minutes, with a cap on concurrent workers.

**4. `mcp_server.py` (tools; first-arg docs are written for the agent):**
| Tool | Input | Returns |
|---|---|---|
| `run_do` | `code: str` | `log`, `rc`, `error`, current `e()`/`r()` as JSON, and paths of new files (graphs, logs). Agents quote numbers from this, not from their own reasoning. The log is cut at 20k characters; the full log is saved to the workdir and its path returned |
| `describe_data` | — | `data_summary()` (cheaper than running `describe` and parsing text) |
| `get_file` | `name` (inside workdir) | a PNG as MCP image content, or text; lets agents see graphs they exported |
| `load_dataset` | `path` (inside allowed dirs) or `csv_text`/upload | rc + summary; for HTTP clients that can't place files on the server |
| `reset` | — | fresh session |
- Resource `dofile://commands`: the list of supported commands, taken from OpenDTA's command registry.
- Transports: `dofile-mcp` (stdio, default) and `dofile-mcp --http --port 8000`. With HTTP, the sandbox stays on,
  sessions are keyed by MCP session id, and there's no auth in Phase 1, so it binds to localhost unless `--host`
  is given.

**Built (step 5, `src/dofile/mcp_server.py`), with changes from the table above:**
- `load_dataset` became `upload_file(name, text | base64_data)`. Agents then `use`/`import` the file with
  `run_do`, which covers datasets, .do files and anything else.
- `get_results` was dropped, because `run_do` already returns e()/r().
- HTTP sessions are **explicit tokens** from a `start_session` tool. The 2026-07-28 HTTP protocol has no MCP
  session (no handshake, no `Mcp-Session-Id`), so `ctx.session_id` can't key the workers.
- Deliberate errors are raised as `ToolError` so their message reaches the agent; other exceptions are hidden
  by the SDK. Temp files and matplotlib's cache live in a hidden `.dofile/` folder inside the workdir.
- Checked with a headless `claude -p` run: the agent ran a robust regression on cps.dta and reported
  b = 0.1177832, SE = 0.0054437 (statsmodels HC1: 0.11778324, 0.00544367), and was refused `shell ls` with rc 199.

**5. `cli.py`:** `dofile run file.do [--json out.json]` prints the log, exits with Stata's rc, and can write
JSON results. It's useful in CI for replication packages and is the cheapest end-to-end test.

## Tests and CI
- **Python:** `requires-python >=3.12`; development is pinned to **3.14** (`.python-version`), the same Python as Pyodide 314. CI runs
  3.12 (OpenDTA's own CI version and our floor), 3.13, and 3.14 (dev default; Pyodide 314, for the
  Phase 2 demo). Checked 2026-11-03: OpenDTA's suite gives identical results on 3.12–3.15, as does the Stata 14 comparison;
  see `.python-version`.
- **OpenDTA's own suite is vendored** into `tests_opendta/` by `scripts/vendor_opendta.py`, with
  imports rewritten. That's 1,022 tests minus GUI ones, plus `tools/compare.py` and **97 .do files with
  reference logs produced by real Stata 14** (`compat/`). `tests/test_stata_compat.py` fails if any case
  differs from Stata beyond OpenDTA's documented `known_differences.txt`. Baseline: 53 equal, 0 different,
  44 known differences, 1 without a reference. This is the Stata ground truth our own eval lacked.
- Conformance: move `eval/corpus` into `tests/conformance/`, and **commit the fixtures**: `panel.dta`,
  `grpinfo.dta`, `cps.dta` (~900 KB) and `ref.json`. This avoids regenerating them, since `make_data.py`
  hard-codes a local path and NumPy streams can change between versions. CI then needs neither statsmodels nor
  linearmodels; `make_data.py` and `reference.py` stay as documentation of how the fixtures were made. Pytest
  runs each .do through `Engine` **with the sandbox on** and asserts CHECK values at 1e-6 relative. It also
  runs `eval/probe` (pass/fail) with the sandbox on, which catches sandbox breakage in tempfile, graphs and
  matplotlib. The 3 known OpenDTA
  misses are marked `xfail(strict=True)`, so a fixed bug shows up.
- Unit tests:
  - every denylisted command returns rc 199;
  - an audit-hook write to `../x` is blocked;
  - a timeout on `while 1 {}` resets the worker;
  - a Python exception escaping a command gives rc 9999 and the next call still works. Real trigger: `regress`
    on a perfect fit (`gen y = 2*x`) raises an uncaught `ZeroDivisionError` where Stata reports F as missing.
    Found in step 1;
  - result JSON shapes.
- MCP tests: an in-process client from the `mcp` SDK calls each tool over stdio and HTTP.
- GitHub Actions: uv, Python 3.12 + 3.13, macOS + Ubuntu.

## Order of work (each step ends green)
1. `git init`, move the old repos to `legacy/`, scaffold the uv project at the top level, vendor script + vendored OpenDTA.
2. `engine.py` + conformance tests (port of `eval/`).
3. `sandbox.py` + its tests.
4. `worker.py` + timeout/crash tests.
5. `mcp_server.py` + MCP client tests. Manual check: add it to Claude Code (`claude mcp add dofile -- uv run dofile-mcp`)
   and run a regression from a prompt.
6. `cli.py`, README (install, MCP config, sandbox limits, OpenDTA attribution), CI workflow.

**Status (2026-11-03): steps 1–6 built and committed.** Step 6 added `dofile run` (`src/dofile/cli.py`: sandboxed
by default, the do-file's folder readable, exit 1 on error, `--json`) and CI (`.github/workflows/ci.yml`). It also
fixed expired HTTP tokens: they now fail with "unknown or expired session" instead of silently getting a fresh
session. Not yet verified: CI on Linux (the sandbox has only run on macOS) and Windows (not in CI).

Publishing to PyPI, and reporting OpenDTA bugs upstream, are separate and need your go-ahead.

## Verification (end of Phase 1)
- `uv run pytest` is green; conformance shows 60/63 with 3 strict xfails.
- `dofile run eval/corpus/03_regress.do --json r.json` matches the reference.
- From Claude Code with the MCP server added, prompt "load cps.dta and regress log wage on education with robust
  SEs". The agent's quoted coefficient matches `get_results`, and `shell ls` is refused.
- Over HTTP: two clients get separate sessions, and killing one worker doesn't affect the other.

## Risks
- OpenDTA moves fast (439 commits in 3 weeks), so vendoring means we choose when to take updates. Re-vendor
  deliberately and rerun conformance each time.
- Audit hooks are a policy layer, not a security boundary. Public HTTP hosting needs a container (Phase 2+).
- MCP 2.x is new to me. `ctx.session_id` is confirmed to exist; its behaviour across reconnects is not.
