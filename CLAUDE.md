# CLAUDE.md

dofile runs Stata-syntax `.do` code without a Stata license (CLI `dofile`) and exposes it to agents over MCP
(`dofile-mcp`). The interpreter is a vendored copy of OpenDTA (MIT); dofile adds the adapter, sandbox, worker
processes, MCP server and CLI. The web demo (`web/`) has its own commands and rules: `web/CLAUDE.md`.

## Commands

```bash
uv sync --extra mcp                                   # dev env (Python 3.14 per .python-version; floor 3.12)
uv run poe                                            # list tasks (defined in pyproject.toml)
uv run poe test                                       # default suite in parallel, ~35 s; skips the slow Stata comparison
uv run poe test tests/test_mcp.py::test_stdio_mode_tools   # one test (extra args go to pytest)
uv run poe test tests                                 # dofile's own tests only (not OpenDTA's vendored suite)
uv run poe opendta                                    # OpenDTA's vendored unit tests only (~22 s)
uv run poe slow                                       # Stata 14 log comparison only (~75 s)
uv run poe ci                                         # every test, as CI runs them
uv run dofile run path/to/file.do --json out.json     # batch run (sandboxed; --unsafe to lift it)
uv run poe mcp [--http --port 8000]                   # MCP server, stdio by default
uv run poe vendor [COMMIT]                            # re-vendor OpenDTA, re-apply patches
uv run poe format                                     # ruff format: dofile's own Python
uv run poe lint                                       # ruff format --check, then ruff check, as CI runs them
uv build                                              # sdist + wheel (the wheel is built from the sdist)
```

poe runs every task as `uv run --extra=mcp ...`; plain `pytest` without `--extra mcp` skips `tests/test_mcp.py`. That
nested `uv run` ignores an outer `--python`: set `UV_PYTHON` to test another version. Run xdist from the project env,
not `uv run --with pytest-xdist`: the overlay env is not the `.venv`, so the sandbox refuses the project's own packages
and tests fail with rc 603.

Agents: run a whole suite (`poe test`, `poe slow`, `poe ci`) in the background with its output in a file, e.g.
`uv run poe test > .dofile/test.log 2>&1` (`.dofile/` is gitignored), wait for the completion notice, then read the
last lines. Don't pipe it through `tail` or `head` (nothing shows until the end). A single test or file can run in the
foreground.

Format and lint: ruff (pinned in `pyproject.toml`, `[tool.ruff]`) for dofile's own Python, Biome for `web/`; in CI a
warning fails as an error does. Run `uv run poe format` at the end of a task or before a commit, not after every edit
(a reformat between a read and an edit makes the edit's text stop matching). **Never run a formatter on `_vendor/`,
`tests_opendta/` or `legacy/`** (the vendor script's patches apply to upstream's exact text). A finding is fixed, or
ignored in place with the rule and the reason (`# noqa: RULE  (reason)`), before a merge. In a new clone run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Architecture

Layers, bottom up (`src/dofile/`):
- `_vendor/opendta/`: the engine. **Never edit it by hand.** `scripts/vendor_opendta.py` copies a pinned upstream
  commit, rewrites its imports, copies OpenDTA's tests into `tests_opendta/`, then applies `scripts/patches/*.patch`. A
  change to the engine is a new patch file there, then a re-vendor. Patches are named `opendta-<id>-<slug>.patch`
  (`odt<N>` for an `ODT-N` issue, `patch1` for PATCH-1) and apply in name order, so a patch that builds on another must
  sort after it. `engine.about()` reads the `VENDORED` stamp.
- `engine.py`: the only adapter over OpenDTA's `Session`. `Engine.run(code)` returns a `Result` and never raises.
  Return codes beyond Stata's: 9999 (a Python exception escaped the engine), 603 (sandbox refused a file), 1 (`--Break--`
  from an interrupt; data kept).
- `sandbox.py`: installed once per process. Dangerous commands (`shell`, `erase`, `cd`, `copy`, `webuse`, ...) become
  rc 199, and a PEP 578 audit hook blocks subprocesses and network access, confines writes to the workdir and reads to
  the workdir, `--read-dir` folders and code folders. Audit hooks can't be removed, so sandbox tests run each case in a
  subprocess.
- `worker.py`: one child process per session (forked from a preloaded forkserver, `_forkserver.py`, on Linux and macOS;
  spawn on Windows); the sandbox is installed in the child. A timeout or cancel sends SIGINT: the engine takes the Break
  between commands (PATCH-2), rc 1, data kept; a child that doesn't stop within 5 s is killed (rc 9998, "session
  reset"). `WorkerPool` evicts the least recently used idle session, never one running code.
- `mcp_server.py`: over stdio, one session in the launch folder; over HTTP, sessions are explicit tokens from the
  `start_session` tool, each with its own temp workdir. Errors meant for the agent must be raised as `ToolError` (the
  SDK hides others). Calls to one session queue on an async lock (`Sessions.call`), not in threads. Tool outputs are
  `TypedDict`s: they become the advertised `outputSchema`, and the SDK validates every result against them.
- `browser.py`, `pathshim.py`, `linalgshim.py`: web demo only (`web/CLAUDE.md`); the CLI and MCP server never install
  them.
- `cli.py`: `dofile run` runs `do` on the file in one sandboxed `Engine`, passing the path through a local macro so `$`
  and backquotes in it aren't expanded.

**Changing the result format or a tool** means updating the TypedDicts in `mcp_server.py` and `MCP-SCHEMA.md`
together. While dofile is 0.x, a breaking change to the result format raises the minor version; a patch release never
changes the schema. The "For dofile `0.1.x`" line of `MCP-SCHEMA.md` is edited by hand, only with a minor bump
(`tests/test_version.py` fails if it is stale); `__version__` follows `pyproject.toml` by itself.

## Tests

- `tests/conformance/` runs a corpus of `.do` files whose `CHECK name=value` lines must match `data/ref.json`
  (statsmodels/linearmodels) to 1e-6, plus pass/fail probes, sandbox on. Known engine gaps are `xfail(strict=True)`
  with IDs from `docs/opendta-issues.md`; when an OpenDTA fix lands, the xfail fails and must be removed.
- `tests_opendta/`: OpenDTA's suite and its Stata 14 reference logs, regenerated by the vendor script; don't edit.
  `tests/test_stata_compat.py` (marked `slow`) runs each case through `tests_opendta/tools/compare.py`.
- **`docs/test-map.md` maps the whole suite. Keep it in sync**: when you add, remove, rename or re-scope a test file or
  group, change the conformance corpus, its probes or known gaps, or re-vendor with a changed `tests_opendta/` file list,
  update the matching section in the same change. It holds no counts.

## Rules

- Clean room (`LICENSE-POLICY.md`): never copy StataCorp files (`.ado`, `.sthlp`, ...), manual or help text, or
  example datasets; write from documented behavior. No GPL/AGPL code or dependencies. The Stata reference logs stay out
  of distributions.
- `legacy/` holds the 2020 OpenStata repos (gitignored); leave it alone.
- **`main` is protected: never push to it.** Every change is a pull request from a branch that is up to date with `main`
  (house practice; the ruleset does not enforce it), and `ci ok`, `web ok` and `lint ok` must pass. A pull request that
  holds a reformat commit named in `.git-blame-ignore-revs` is merged with a merge commit (a rebase or squash changes
  its hash); any merge method works otherwise. **A merge to `main` deploys the web demo** once its tests pass.
- CI and deploy: the table at the top of `docs/deploying.md` (every workflow, its trigger, required check and secrets).
- Where to look (`docs/`): `phase2-plan.md` (web demo; read it first: status and next steps), `phase3-plan.md` (hosted
  multi-user MCP server), `opendta-issues.md` (known OpenDTA problems), `agent-ergonomics.md`, `releasing.md` (PyPI),
  `deploying.md` (Cloudflare, previews), `icebox.md` (left for later; nothing in it blocks a merge), `archive/`
  (finished work, not kept current). Web demo design: `docs/design/` (`SPEC.md` is the build spec).
