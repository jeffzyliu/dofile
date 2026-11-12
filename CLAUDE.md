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
uv run poe opendta                                    # OpenDTA's vendored unit tests only (~22 s)
uv run poe slow                                       # Stata 14 log comparison only (~75 s)
uv run poe ci                                         # every test, as CI runs them (CI also runs `poe lint`)
uv run dofile run path/to/file.do --json out.json     # batch run (sandboxed; --unsafe to lift it)
uv run poe mcp [--http --port 8000]                   # MCP server, stdio by default
uv run poe vendor [COMMIT]                            # re-vendor OpenDTA, re-apply patches
uv run poe format                                     # ruff format: dofile's own Python (never the vendored engine)
uv run poe lint                                       # ruff format --check, then ruff check, as CI runs them
uv build                                              # sdist + wheel (the wheel is built from the sdist)
```

poe runs every task as `uv run --extra=mcp ...` (`[tool.poe] executor`), so the MCP tests always run; with plain
`pytest` and no `--extra mcp`, `tests/test_mcp.py` is skipped (`importorskip`). That nested `uv run` ignores an outer
`--python`: set `UV_PYTHON` to test another version (CI does). Run xdist from the project env (it's in
the `dev` group), not `uv run --with pytest-xdist`: the overlay env's `sys.prefix` isn't the `.venv`, so the
sandbox refuses the project's own packages and graph/sandbox tests fail with rc 603. The Stata comparison is one test
per case, so `-n auto` runs those in parallel too.

Agents: run the whole suite (`poe test`, `poe slow`, `poe ci`) as a background task with its output going to a
file, and read the file while it runs: `uv run poe test > .dofile/test.log 2>&1` (`.dofile/` is gitignored). Don't
pipe it through `tail` or `head`: they print nothing until the command ends, so a run in progress looks like an
empty one. pytest prints dots as tests finish and a summary line at the end; wait for the completion notice, then
read the last lines of the log. A single test or file is quick enough to run in the foreground.

Format and lint (decisions and reasons: `docs/formatting-proposal.md`): ruff 0.17.4 for dofile's own Python (`[tool.ruff]`
in `pyproject.toml`: width 120, ruff's default rules), Biome for `web/` (`web/CLAUDE.md`). Both are pinned exactly and
checked in CI (`ci ok`, `web ok`), where a warning fails as an error does. Run `uv run poe format` at the end of a task
or before a commit, not after every edit (a reformat between a read and an edit makes the edit's text stop matching).
**Never run a formatter on `_vendor/`, `tests_opendta/` or `legacy/`** (the config excludes them; the vendor script's
patches apply to upstream's exact text). A finding is fixed, or ignored in place with the rule named and the reason
(`# noqa: RULE  (reason)`), before a merge. The two reformat commits are in `.git-blame-ignore-revs`; in a new clone run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

The web demo (`web/`) has its own commands and rules: `web/CLAUDE.md`.

## Architecture

Layers, bottom up (`src/dofile/`):
- `_vendor/opendta/`: the engine. **Never edit it by hand.** `scripts/vendor_opendta.py` copies a pinned
  upstream commit, rewrites `opendta` imports to `dofile._vendor.opendta`, drops `gui/` and `__main__.py`,
  copies OpenDTA's tests into `tests_opendta/`, then applies `scripts/patches/*.patch`. A change to the engine
  is a new patch file there, then a re-vendor. Patches are named `opendta-<id>-<slug>.patch` (`odt<N>` for an
  `ODT-N` issue, `patch1` for PATCH-1) and apply in name order, so a patch that builds on another must sort after it. The `VENDORED` stamp (commit, patches) is read at runtime by
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
  fork. A timeout or cancel sends SIGINT, which only sets a flag: the engine takes the Break at the next
  safe point (PATCH-2: between commands, not mid-command), rc 1, data kept; a child that doesn't stop within 5 s is
  killed (rc 9998, "session reset"). `WorkerPool` keys workers by session token; when full it evicts the least recently used idle session (never one running code), with idle
  reaping.
- `mcp_server.py`: `MCPServer` (mcp 2.3.0). Over stdio there is one session in the launch folder. Over HTTP,
  protocol 2026-07-28 has no MCP session, so sessions are explicit tokens from the `start_session` tool, each
  with its own temp workdir. Errors meant for the agent must be raised as `ToolError` (the SDK hides others).
  Calls to one session queue on an async lock (`Sessions.call`), not in threads: only the running call holds a
  thread, and a cancel keeps the lock until the child has stopped. Per-call cancel state is the call's own `Event`.
  Tool outputs are `TypedDict`s, which become the advertised `outputSchema`, and the SDK validates every result
  against them.
- `browser.py`, `pathshim.py`, `linalgshim.py`: web demo only (the Pyodide entry point, the path shim and the `numpy.linalg` shim);
  the CLI and MCP server never install them. Detail in `web/CLAUDE.md`.
- `cli.py`: `dofile run` runs `do` on the file inside one sandboxed `Engine`, passing the path through a local
  macro so `$` and backquotes in it aren't expanded (a backslash escapes only `$`, since the ODT-8 patch, not backquotes). The log is not capped.

**Changing the result format or a tool** means updating the TypedDicts in `mcp_server.py` and `MCP-SCHEMA.md`
together. While dofile is 0.x, a breaking change to the result format raises the minor version; a patch release never
changes the schema. So the "For dofile `0.1.x`" line of `MCP-SCHEMA.md` is edited by hand only with a minor bump (it is
the one place a version bump does not reach by itself, and `tests/test_version.py` fails if it is stale). The package's
`__version__` follows `pyproject.toml` by itself.

## Tests

- `tests/`: dofile's own tests. `tests/conformance/` runs a corpus of `.do` files whose `CHECK name=value`
  lines must match `data/ref.json` (statsmodels/linearmodels results) to 1e-6, plus pass/fail probes, all with
  the sandbox on. Known engine gaps are `xfail(strict=True)`, and their reasons carry IDs from
  `docs/opendta-issues.md`. When an OpenDTA fix lands, the xfail fails and must be removed.
- `tests_opendta/`: OpenDTA's own suite and its Stata 14 reference logs, regenerated by the vendor script; don't
  edit. `tests/test_stata_compat.py` (marked `slow`) runs each case with `tests_opendta/tools/compare.py`'s
  functions, one test per case in its own folder; the slowest cases are ordered so xdist starts them on separate workers.
- **`docs/test-map.md` is the map of the whole suite** (Python, conformance, vendored, web unit and e2e, by function,
  with counts, gaps and how to broaden the conformance corpus). **Keep it in sync**: when you add, remove, rename or
  re-scope a test file or a group of tests, or change the conformance corpus, its probes or its known gaps, update the
  matching section and counts in the same change. A re-vendor that changes the `tests_opendta/` file list needs the
  same update.

## Rules

- Clean room (`LICENSE-POLICY.md`): never copy StataCorp files (`.ado`, `.sthlp`, ...), manual or help text,
  or example datasets; write from documented behavior. No GPL/AGPL code or dependencies. The Stata reference logs
  stay out of distributions (excluded from the sdist in `pyproject.toml`).
- `legacy/` holds the 2020 OpenStata repos (gitignored); leave it alone.
- **`main` is protected: never push to it.** Every change is a pull request from a branch that is up to date with `main`; `ci ok`,
  `web ok` and `lint ok` must pass. Any merge method works (the maintainer usually rebases), with one exception: a pull request
  that holds a reformat commit named in `.git-blame-ignore-revs` is merged with a merge commit, since a rebase or squash gives the
  commit a new hash and the file would name one that is not on `main`. A merge to `main` deploys the web page to Cloudflare
  (`deploy.yml`).
- Status and next steps: `docs/phase1-plan.md` (done), `docs/phase2-plan.md` (web demo; the history and gaps are in
  `docs/phase2-history.md`, `docs/browser-engine.md` and `docs/lazy-matplotlib.md`), `docs/phase3-plan.md` (hosted multi-user MCP
  server). `docs/prototype1-plan.md` (the build plan and status for prototype 1 of the web demo: read it first when picking that
  work up; steps 0 to 3.5 are merged, step 4 is built on pull request #17, not merged, and step 5 is on pull request #18 over it; `docs/prototype1-step3.5-plan.md` is the record of step 3.5, and `docs/web-engine-data-flow.md` explains the web engine's data flow). Known OpenDTA problems to verify against Stata: `docs/opendta-issues.md`. dofile's own agent-ergonomics problems:
  `docs/agent-ergonomics.md`. Releasing to PyPI: `docs/releasing.md`. Formatting and linting (Biome, ruff; merged with
  step 3.5 by pull request #13): `docs/formatting-proposal.md`.
- Web demo design (moodboard, flows, wireframes, mockups): `docs/design/`. `docs/design/SPEC.md` is the build spec for the web
  demo's pages; `docs/design/README.md` holds the brief, the rules and every round of feedback (the plan keeps only a summary of
  the decisions). Renders are not committed; each folder's README has the command.
