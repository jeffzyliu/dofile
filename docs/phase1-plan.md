# dofile — Phase 1 plan

**Goal:** an installable, open-source Python package that runs Stata-syntax .do code with no Stata license, plus an
MCP server (`dofile-mcp`) that lets agents use it. Engine: OpenDTA (MIT), chosen in `docs/engine-evaluation.md`.
Background research: `docs/stata-research.md`.

**Not in Phase 1:** the web demo (Phase 2), accounts/storage, our own estimators, community commands
(`reghdfe`, `esttab`, `outreg2`), fixing OpenDTA upstream.

**Status (2026-11-05):** Phase 1 is complete. All exit checks pass, including CI on Linux and macOS (see
[Is Phase 1 finished?](#is-phase-1-finished)). Since the CI run, a round of agent testing (three paper
replications) led to result-format, engine and sandbox changes that aren't committed yet; they pass the full
suite locally. See [After Phase 1](#after-phase-1-2026-11-04-and-05).

## Facts this plan rests on (checked 2026-11-03, corrected 2026-11-04 and 05)
- OpenDTA is not on PyPI, and PyPI rejects packages that depend on a git URL. Our installs could pin it by commit,
  but `pip install dofile` would then fail.
- OpenDTA lists PySide6 (Qt, ~500 MB) as a hard dependency, though only `opendta/gui/` uses it. Vendoring without
  `gui/` removes it for everyone, pip users included.
- In-process API: `Session().run(src, echo=True) → rc`; output via `session.output.add_listener(fn)` (or
  `opendta.core.output.Capture`); results in `session.e` / `session.r` (dicts; `e(b)`/`e(V)` are `Matrix` with
  `data`, `rownames`, `colnames`, `roweq`, `coleq`); data in `session.data` (`names` and `nobs` are properties;
  `get(name)`).
- **OpenDTA's `shell` runs `subprocess.run(cmd, shell=True)`.** Any client that can send Stata code can then run
  programs on the host. File commands (`save`, `export`, `log`, `file`, `erase`, `rm`, `rmdir`, `mkdir`, `copy`,
  `cd`) take any path, and `webuse`/`copy` reach the network. Correction (2026-11-05): there were two
  embedded-Python routes. `arch`'s `archmexp()` and `bayesstats` expressions passed Stata text to Python's
  `eval()` with empty `__builtins__`, which attribute access escapes (ODT-14). dofile now patches both to a
  restricted evaluator.
- Known OpenDTA problems are tracked in [opendta-issues.md](opendta-issues.md); dofile patches the ones that
  crash, mislead agents or affect security (see Decision 1). `while 1 {}` never returns on its own; the worker's
  timeout interrupts it.
- MCP SDK is `mcp` 2.3.0. `FastMCP` was renamed `MCPServer` (`from mcp.server.mcpserver import MCPServer`), with
  `@server.tool()` and `server.run("stdio" | "streamable-http")`. **Protocol 2026-07-28 HTTP has no MCP session**
  (no handshake, no `Mcp-Session-Id`), so `ctx.session_id` can't key workers; dofile uses explicit tokens.
- Vendoring needs one import rewrite pass (`scripts/vendor_opendta.py`: 5 rewrites in the package, 127 in the
  tests). Only `gui/` and `__main__.py` are dropped. `cli.py` and `updater.py` stay: `tools/compare.py` uses
  `cli.py`, other modules import `from ..updater import ssl_context`, and their GUI imports are lazy.
- The registry has 515 commands. I/O-capable names actually present: `shell` (`!cmd` and `sh` map to it),
  `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`, `webuse`, `sysuse`, `adopath`, `use`, `save`, `export`, `import`,
  `log`, `file`, `outsheet`, `insheet`, `infile`, `infix`, `graph`, `putexcel`, `tempfile`, `preserve`, `dir`/`ls`,
  `type`. `winexec`, `net`, `ssc` and `findit` don't exist.

## Decisions (confirmed 2026-11-03)
1. **Vendor OpenDTA** into `src/dofile/_vendor/opendta/` at a pinned commit, without `gui/` and `__main__.py`,
   keeping its LICENSE, `packaging/THIRD_PARTY_NOTICES.md` (as `THIRD_PARTY_NOTICES.md`) and
   `docs/clean-room-policy.md` (as `CLEAN_ROOM_POLICY.md`). The bundled `data/*.dta` and `data/icd` have their own
   data licenses. `scripts/vendor_opendta.py` re-vendors a commit, then applies dofile's own patches from
   `scripts/patches/*.patch` in name order; the `VENDORED` stamp records commit and patches. This fixes both
   PyPI publishing and Qt. Patches (2026-11-05): `opendta-patch1-r-table` (PATCH-1), one per fixed bug
   (`opendta-odt1-…`, `odt2`, `odt5-odt6`, `odt9`, `odt10`, `odt12`) and `opendta-odt14-safe-expr` (ODT-14). Each is
   recorded in [opendta-issues.md](opendta-issues.md) to report upstream.
2. **The MCP server is Python, and the Node backend is retired.** This replaces the original "make the backend an
   MCP server". With a Python engine, a Node layer would only add a hop.
3. **Layout:** the uv project lives at the top of this folder. The three 2020 repos are in `legacy/`, unchanged
   and gitignored (each is its own git repo with a GitHub remote).
4. **License:** MIT, with the clean-room and no-GPL rules in `LICENSE-POLICY.md`.

## Package layout
```
./
  pyproject.toml          # name "dofile"; script entry points: dofile, dofile-mcp
  README.md, MCP-SCHEMA.md, LICENSE, LICENSE-POLICY.md
  src/dofile/
    _vendor/opendta/      # pinned copy, MIT, gui/ + __main__.py removed, scripts/patches applied
    engine.py             # Engine: run(code) -> Result; results(); matrix(); data_summary(); about()
    sandbox.py            # command denylist + audit hook (paths / subprocess / network)
    worker.py             # one child process per session; timeout, Break and crash recovery
    _forkserver.py        # what the forkserver preloads (the engine), so sessions start fast
    mcp_server.py         # MCPServer tools, stdio + streamable HTTP
    cli.py                # `dofile run file.do [--json]` (batch, like stata -b)
  scripts/vendor_opendta.py, scripts/patches/
  tests/                  # unit tests; tests/conformance/ (corpus, probes, fixtures)
  docs/                   # this plan, research, OpenDTA issue sheet, replication tests
  tests_opendta/          # OpenDTA's own suite and Stata 14 reference logs, vendored
  eval/                   # how the conformance fixtures were made (Phase 0)
```

## Components
**1. `engine.py` (the engine adapter, in-process).** `Engine(workdir, log_keep, hints)` wraps one `Session` with a
`Capture` listener. `run(code, images=False) → Result(log, rc, error, results, error_command, nobs, nvars,
new_graphs, images)`.
- Each `run` call is a do-file scope: data `preserve`d in it is restored, and tempvars/tempfiles dropped, when it
  ends, error or not; locals, data and estimates carry over. Scientific notation prints as Stata does
  (`1.000e+10`; OpenDTA's superscript form is off). `hints=False` (MCP sessions) drops OpenDTA's console hints
  under errors.
- Any Python exception escaping a command gives `rc=9999` ("internal engine error: Type: message" plus the
  traceback), so a crash doesn't take the caller down. A sandbox refusal gives rc 603 with the reason; an
  interrupt (KeyboardInterrupt from the worker) gives rc 1 `--Break--`, and the session keeps its data.
- `results()`: `e()` and `r()` each grouped as `{scalars, macros, matrices}`, like `ereturn list`. Missing values
  are `null` or `".a"`–`".z"`, infinity is `null`, and matrix row/column names include the equation (`eq:name`).
- `matrix(name, rows, cols)`: one matrix at full precision. `data_summary(vars, offset, limit)`: variables
  (name, type, format, label, value label), filtered by a varlist and paged. `about()`: versions.
- After any estimation table, `r(table)` holds e(b)'s columns and replaces r() (PATCH-1, also after `mean`,
  `proportion`, `total`, `ratio`); new estimates never inherit a previous model's table.
- Most OpenDTA access goes through this module; `sandbox.py` and `mcp_server.py` (`dofile://commands`) also
  use OpenDTA's command registry.

**2. `sandbox.py` (on by default; `--unsafe` turns it off for local trusted use).**
- Denylist (names checked against the registry): `shell` (also covers `!` and `sh`), `erase`/`rm`, `rmdir`,
  `mkdir`, `cd`, `copy`, `webuse`. Each returns rc 199 with "disabled in the dofile sandbox". Every other file
  command (`use`, `save`, `log`, `file`, `export`, `graph export`, `tempfile`, `preserve` …) stays available and
  is confined by the path rule below.
- `sys.addaudithook` blocks subprocesses, `os.system`/`exec`/`spawn`/`fork`, sockets and DNS lookups, `ctypes`
  and `webbrowser`. Writes, deletes and renames are allowed only inside the session workdir. Reads are allowed
  only in the workdir, the `--read-dir` folders, the Python install and the folders that hold code
  (site-packages, the user site folder, the dofile package's parent). Not all of `sys.path`: with
  `python -m` it contains the launch folder (fixed in `37be4d0`).
- `TMPDIR`, `HOME` and `MPLCONFIGDIR` point to a hidden `.dofile/` folder inside the workdir, so `tempfile`,
  `preserve` and matplotlib stay inside the allowed area. `mimetypes` is pre-loaded, since openpyxl reads
  `/etc/mime.types`. `graph export` prints OpenDTA's own 603 text instead of the sandbox's reason.
- OpenDTA has no URL support in `use`/`import`, so `webuse` and `copy` were the only network commands. The whole
  corpus and every probe give the same results with the sandbox on.
- This is defense in depth, not a security boundary. Audit hooks are sufficient here only as long as clients
  can't run Python: the two `eval()` routes (ODT-14) showed that Stata code could, so they are patched, and any
  re-vendor should be checked for new `eval`/`exec` on user text. A public HTTP deployment should also run in a
  container. The sandbox still holds with upstream's lazy command loading (checked 2026-11-05: all denied
  commands are registered at import, and lazy modules don't re-register them).

**3. `worker.py` (process isolation).** Each session gets its own child process with its own `Engine`.
- **Workdir:** with stdio, the launch directory or `--workdir` (the main local use: a replication package with
  relative `use data/x.dta` / `do 01_clean.do` paths). With HTTP, a fresh temp dir per session, deleted on close.
- **Session key:** a token from the `start_session` tool over HTTP; one worker for the process over stdio.
- `Worker` (child process, pipe, per-call timeout) and `WorkerPool` (idle reaping after 15 minutes; when all
  `--max-sessions` slots are taken, the least recently used session that isn't running code is closed, and if
  every session is running code, `start_session` is refused). A session in the middle of a call is never closed.
  If the child died between calls, that call returns rc 9998 without running the code, so the agent knows its
  data is gone.
  The next call starts fresh. Startup was about 0.7 s per new session with spawn; since 2026-11-04 sessions fork from a preloaded forkserver (Linux, macOS) in about 20–50 ms, and Windows still uses spawn.
- **Timeouts and cancels work like Stata's Break key:** the child gets SIGINT, and the call ends with rc 1
  `--Break--` while the session keeps its data. Only if it hasn't stopped after 5 s is the child killed (rc 9998,
  "session reset"). Each call has a timeout (default 60 s, `--timeout`; `run_do` can ask for less). On Windows
  there's no SIGINT, so an interrupt always waits 5 s and resets.

**4. `mcp_server.py`.** The full reference, with inputs, outputs and return codes, is
[MCP-SCHEMA.md](../MCP-SCHEMA.md); every tool except `get_file` advertises a typed output schema.
- Tools: `start_session` (HTTP), `run_do(code, graphs, timeout)`, `get_matrix(name, rows, cols)`,
  `describe_data(vars, offset, limit)`, `get_file(name)`, `upload_file(name, text, replace)`, `request_upload` and
  `request_download` (HTTP, one-time URLs valid 10 minutes), `reset`. Resources: `dofile://commands`,
  `dofile://about`.
- `run_do` returns rc, error, the failing command, the log, the current e()/r() scalars and macros in full on
  every call, also after an error (matrices by size only, e.g. `"V": "16x16"`; values via `get_matrix`; no `null`
  for "unchanged", since agents' context gets summarized), changed files, `nobs`/`nvars`, and the last 3 graphs
  as PNG images. `describe_data` leaves out `label`/`value_label` when a variable has none. Each command's output keeps its first 40 and last 15 lines, and the whole log is capped
  at 8 KB; the full log goes to `.dofile/`, where the newest 20 are kept. A call's log is capped at its first and
  last 1,000,000 characters in the worker, so a runaway loop can't fill memory or disk (`dofile run` keeps all).
- Large files never pass through the model: over stdio, code reads them in place from `--read-dir` folders;
  over HTTP, the client PUTs them to a `request_upload` URL. `upload_file` takes text only. Neither overwrites an
  existing file unless `replace` is true, and file tools refuse links that point outside the working folder.
- Over HTTP, `session` is required in every tool's schema except `start_session`; over stdio it isn't offered.
- Deliberate errors are raised as `ToolError`, so their message reaches the agent (the SDK hides other
  exceptions).
- Transports: `dofile-mcp` (stdio, default) and `dofile-mcp --http --port 8000`. HTTP has no auth, so it binds to
  localhost unless `--host` is given; the SDK's DNS-rebinding protection is on for localhost.
- Checked with a headless `claude -p` run: the agent ran a robust regression on cps.dta and reported
  b = 0.1177832, SE = 0.0054437 (statsmodels HC1: 0.11778324, 0.00544367), and was refused `shell ls` with rc 199.

**5. `cli.py`:** `dofile run file.do [--json out.json] [--workdir] [--read-dir] [--unsafe]` prints the log and
exits 1 on an error (Stata's rc is in the log and the JSON). Sandboxed by default, with the do-file's folder
readable. `--json` writes rc, error, the failing command, e()/r() and `versions`, and works for any path.

## Tests and CI
- **Python:** `requires-python >=3.12`; development is pinned to **3.14** (`.python-version`), the same Python
  as Pyodide 314. Checked 2026-11-03: OpenDTA's suite gives identical results on 3.12–3.15, as does the Stata 14
  comparison.
- **pytest-xdist** is a dev dependency: `-n auto` runs the suite in parallel.
- **OpenDTA's own suite is vendored** into `tests_opendta/` by `scripts/vendor_opendta.py`, with imports
  rewritten, without the GUI tests. That includes `tools/compare.py` and **97 .do files with reference logs
  produced by real Stata 14** (`compat/`). `tests/test_stata_compat.py` fails if any case differs from Stata
  beyond OpenDTA's documented `known_differences.txt`. Baseline: 53 equal, 0 different, 44 known differences,
  1 without a reference; unchanged with all dofile patches (re-checked 2026-11-05). Since 2026-11-05 it is
  one test per case (97, each in its own folder); ~3.5 minutes serial, ~75 s with `-n auto` (pytest-xdist). It's
  marked `slow` and skipped by default: run it with `pytest -m slow -n auto`.
- **Conformance** (`tests/conformance/`): the corpus (63 CHECK values) runs through `Engine` with the sandbox
  on and must match `ref.json` (independent statsmodels/linearmodels results) to 1e-6 relative. The probes
  (`tests/conformance/probe/`) run pass/fail with the sandbox on. Known OpenDTA gaps are `xfail(strict=True)`:
  3 corpus checks and 2 probes, so a fix shows up (the `xtlogit` probe passes since the ODT-2 patch). The fixtures (`cps.dta`, `panel.dta`,
  `grpinfo.dta`, `ref.json`) are committed; `eval/make_data.py` and `eval/reference.py` document how they were
  made.
- Unit and MCP tests cover the sandbox (denylist, path rules, network, launch folder), the worker (timeouts,
  Break, cancel, crashes, pool), the engine (results JSON, do-file scope per call, r(table), each patched ODT
  bug, the restricted expression evaluator, errors), the MCP tools over in-process stdio and HTTP and real
  transports, and the CLI.
- Local runs (2026-11-05, uncommitted work): default 1,178 passed, 13 skipped, 5 xfailed (31 s with `-n auto`);
  everything (`-m "" -n auto`) 1,275 passed, 13 skipped, 5 xfailed (2.5 min).
- GitHub Actions (`.github/workflows/ci.yml`, repo `jeffzyliu/dofile`): uv, Python 3.12/3.13/3.14 on Ubuntu and
  macOS, running everything (`-m ""`). First run 2026-11-05 on `978fad4`: all 6 jobs green, 1,167 passed each,
  8–13 minutes per job (serial). The workflow now runs `uv run poe ci` (poethepoet
  tasks in `pyproject.toml`, parallel with `-n auto`), with `UV_PYTHON` set per job.
- **Replication tests** ([replication-tests.md](replication-tests.md)): three papers replicated through the MCP
  server by an agent (Card & Krueger 1994, LaLonde / Dehejia & Wahba, Card 1995), with published versus dofile
  numbers and a checklist of what to look out for. Manual, not in CI: the data belongs to its authors.

## Order of work (each step ended green)
1. `git init`, move the old repos to `legacy/`, scaffold the uv project at the top level, vendor script +
   vendored OpenDTA.
2. `engine.py` + conformance tests (port of `eval/`).
3. `sandbox.py` + its tests.
4. `worker.py` + timeout/crash tests.
5. `mcp_server.py` + MCP client tests. Manual check: add it to Claude Code
   (`claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp --workdir "$PWD"`) and run
   a regression from a prompt.
6. `cli.py`, README (install, MCP config, sandbox limits, OpenDTA attribution), CI workflow.

After step 6 (all on `main`): one-time upload URLs and typed output schemas (`0f2cedc`); `LICENSE-POLICY.md`
and the vendored clean-room policy (`27d08a9`); grouped results, inline graphs, `get_matrix`,
`request_download`, r(table) and Break-style timeouts (`275bf96`); review fixes for the sandbox read scope,
`--json` paths and log pileup (`37be4d0`); forkserver session start (`0744700`); real error messages from
`dofile run` (`b6e6d80`).

## Verification (end of Phase 1)
- [x] `uv run pytest` is green; conformance shows 60/63 with 3 strict xfails (plus 2 probe xfails).
- [x] `dofile run tests/conformance/corpus/03_regress.do --json r.json` matches the reference
  (`tests/test_dofile_cli.py`).
- [x] From Claude Code with the MCP server added: "load cps.dta and regress log wage on education with robust
  SEs". The agent's quoted coefficient matches `run_do`'s results, and `shell ls` is refused (headless
  `claude -p` check, 2026-11-03).
- [x] Over HTTP: two clients get separate sessions, and a killed worker doesn't affect others
  (`tests/test_mcp.py`, `tests/test_worker.py`).
- [x] CI green on Linux (and macOS), Python 3.12–3.14 (2026-11-05, run on `978fad4`).
- [x] A built wheel installs into a clean venv, and `dofile run` and `dofile-mcp` work from it (2026-11-04,
  Python 3.12 and 3.14, macOS; see below).

## Is Phase 1 finished?
Yes (2026-11-05). All exit checks are done:
1. ~~Forkserver~~ committed (`0744700`).
2. ~~CI on Linux once~~ done 2026-11-05: pushed to `jeffzyliu/dofile`; the sandbox, SIGINT and the forkserver
   pass on Ubuntu as well as macOS, Python 3.12–3.14.
3. ~~Wheel install test~~ done 2026-11-04: `uv build` (the wheel is built from the source archive), then
   `dofile[mcp]` installed from the wheel into fresh Python 3.12 and 3.14 venvs (183 MB, no Qt, no pandas) and
   run from a folder outside the repo. The wheel has 458 files: the vendored engine, `VENDORED`, all license
   files, 173 help files, the bundled datasets, no tests. `dofile run` matched `ref.json` on the regression
   corpus; `sysuse`, `help` and the sandbox worked. `dofile-mcp` over stdio and HTTP (upload, run, download)
   gave the same robust coefficient and SE as statsmodels. The first server start after installing takes 3–4 s
   once (bytecode compilation, about 1.2 s of it); later starts give a first `run_do` in 0.07 s.
   The source archive used to include the Stata 14 reference logs (`tests_opendta/compat/expected`), against
   `LICENSE-POLICY.md`; they are now excluded from it (`pyproject.toml`), and `test_stata_compat` skips
   without them. The comparison runs from a git checkout.

Windows stays "not supported yet".

## After Phase 1 (2026-11-04 and 05)
Agent testing: an agent replicated three papers through the MCP server ([replication-tests.md](replication-tests.md));
all published numbers were reproduced. What it led to (uncommitted at the time of writing; full suite green):
- **Session semantics:** each `run_do` call is a do-file scope, so a failed call no longer leaves `preserve`
  active (the retry used to fail with rc 621).
- **Stata-like output:** superscript scientific notation off; OpenDTA's console hints off in MCP sessions.
- **Result format:** e()/r() scalars and macros sent in full on every call, matrices by size only, no `null`
  (an IV regression's results went from 10.6 KB to 1.0 KB); `describe_data` without null label fields. Version
  kept at 0.1.0 by decision (nothing released yet).
- **PATCH-1 (`r(table)`):** replaces r(), follows e(b)'s columns (equation names, ancillary parameters), exists
  after `mean`/`proportion`/`total`/`ratio`, and is never stale; 5 of its 6 items are fixed, the sixth needs
  real Stata. Its four patches were merged into one.
- **Engine bugs patched:** ODT-1, 2, 5, 6, 9, 10, 12 (crashes, `%w.dg` formats, footnote wrapping, `relabel()`),
  and the ODT-14 security fix. Each has a test that fails without its patch.
- **Tests:** pytest-xdist; the Stata comparison split into one test per case.
- **Upstream check:** OpenDTA `main` (0.10.0, 37 commits after our pin) fixes none of our issues. Six of our eight
  patches apply to it as is (all but ODT-9, whose code moved; `safe-expr` not yet tried); it adds eight Stata
  reference cases, echoes blank lines in do-files and puts thousands separators in `regress`'s ANOVA df.

## Next steps
1. **Confirm CI is green on the post-Phase-1 work** (pushed as `474fac4`; the workflow now runs `-n auto`).
2. **Publish to PyPI** (GitHub repo and CI are done). PyPI has no reservations: a name is claimed by uploading a
   release (`dofile` and `dofile-mcp` were free on 2026-11-04). It must be a working package, since PyPI's name
   policy (PEP 541) lets others reclaim squatted names, and a version number can never be re-uploaded. Use
   Trusted Publishing from GitHub Actions, so no API token is stored.
3. **OpenDTA issues** ([opendta-issues.md](opendta-issues.md)): report upstream, ODT-14 (security) first, then
   the patched bugs with their patches. Still open, unpatched: ODT-3, 4, 7, 8, 11, 13, GAP-2 (`estat
   firststage`), and PATCH-1's check against real Stata. Several entries need someone with Stata to confirm.
4. **Re-vendor to upstream `main`** when it's worth it: redo the ODT-9 patch for the moved code, check the
   `safe-expr` patch and any new `eval`/`exec` on user text, rerun everything including the new reference cases.
5. **Phase 2: thin Pyodide web demo**: an editor plus a log, one sample dataset, no server. OpenDTA ran unmodified
   in Pyodide 314 during the evaluation.
6. **HTTP hardening** before any non-local hosting: a bearer-token option, per-session memory and disk limits,
   a container.
7. **Robustness**: a Break in the middle of `merge`/`reshape` (does the data stay consistent?), clients other than
   the Python SDK (MCP Inspector, Claude Desktop), Windows.
8. **Agent ergonomics**: the result-format and hint changes are done (see After Phase 1), and so are the five
   items in [agent-ergonomics.md](agent-ergonomics.md) (log cut, tempfile hint, `e_changed`/`r_changed`, the
   sandbox's reason on a 603, the reconnect note). More replications per
   [replication-tests.md](replication-tests.md) when the engine changes.
9. Later: community commands (`reghdfe`, `esttab`), via OpenDTA upstream or a later decision.
10. Dropped: a `parse_do` parser tool. The MIT tree-sitter-stata grammar (codedthinking) covers syntax for the web
   demo's highlighting, and `run_do` already reports real errors. If agents need a pre-flight check, the small
   version is a `check_do` tool (MCP + `dofile check`) that lists unknown or disabled commands using OpenDTA's own
   command splitter and registry, without running anything. Only worth it once there's demand.

## Risks
- OpenDTA moves fast (439 commits in its first 3 weeks; 37 more, including module splits, the day after our
  pin), so vendoring means we choose when to take updates. Re-vendor deliberately and rerun conformance and the
  Stata comparison each time; our eight patches must still apply, and moved code means redoing a patch.
- Agents trust `results` and `r(table)` more than a person would. A mislabeled or stale value is worse than a
  missing one, so changes there need the checks in [replication-tests.md](replication-tests.md).
- Audit hooks are a policy layer, not a security boundary, and they assume clients can't run Python; an
  engine `eval()` on user text breaks that (ODT-14). Public HTTP hosting needs a container.
- HTTP has no auth and no per-session memory or disk limits, so it's for localhost only.
- An interrupted command (Break) may leave half-changed data; not checked yet.
- Windows is untested, and interrupts there always reset the session.
