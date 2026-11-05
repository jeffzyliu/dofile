# Engine evaluation: OpenDTA vs OpenStat (Phase 0)

Date: 2026-11-03. Question: should the refreshed OpenStata build its own Stata interpreter, or use one of the two
MIT-licensed, license-free .do interpreters that appeared in October 2026?

> **Later changes (2026-11-04):** this report is kept as written. Since then the corpus and probes moved to
> `tests/conformance/`, and the MCP tools planned below changed: see [MCP-SCHEMA.md](../MCP-SCHEMA.md). OpenDTA
> issues found here are tracked in [opendta-issues.md](opendta-issues.md); the research behind the project is
> in [stata-research.md](stata-research.md).

**Recommendation: use OpenDTA as the engine, behind a thin adapter of our own, pinned to a commit. Keep OpenStat as
the fallback.** This project then becomes the MCP server and the web teaching IDE. Neither engine has those.

## What was tested

| | OpenDTA | OpenStat |
|---|---|---|
| Repo / commit | yaskepalhares/opendta @ `0c3f3a2` | dgonzalezgonzalez/OpenStat @ `ae94caf` |
| Size | ~127k lines of Python, 75 test files (13.5k lines) | ~21.5k lines of Python, 15 test files (2.5k lines) |
| History | 439 commits since 2026-10-08; 322 (73%) have a Claude co-author trailer | 19 commits since 2026-10-15 |
| Maintainers | 1 person | 1 person |
| License | MIT (LICENSE confirmed; Qt/PySide6 LGPL only in the desktop build) | MIT |
| Provenance | Written clean-room policy: manuals, help files, observed behaviour; inspecting Stata binaries is forbidden | `docs/inspection.md` records static inspection of installed Stata 19 executables (resource trees, menus, a DLL) |
| Core dependencies | numpy, scipy, matplotlib, openpyxl (Qt for the GUI only) | numpy, pandas, scipy, statsmodels, pyreadstat, matplotlib, openpyxl (+ optional C extension for its RNG) |
| Own test suite | 1079 passed, 2 failed (pyreadstat version cap, xtgee vs. a newer statsmodels) | 248 passed, 1 failed (unicode), GUI test needs Qt |

Corpus: 10 .do files with 63 numeric/return-code checks, covering the old OpenStata tutorial commands, intro
econometrics, data management, programming constructs and error handling. Data: the project's own CPS extract,
plus a synthetic panel with a known data-generating process. Each check is compared with values computed
independently in statsmodels/linearmodels, to 1e-6 relative tolerance. There was no Stata license, so the
reference is not Stata itself. The kit is in `eval/` (see `eval/README.md`).

## Results

| File | What it covers | OpenDTA | OpenStat |
|---|---|---|---|
| 01_basics | use, describe, summarize (detail), tabulate 1/2-way, count, list, mean | 6/6 | 6/6 |
| 02_generate | gen/replace if, bysort egen, `_N`, decode, substr, labels, recode | 5/5 | 4/5 — `generate` from `substr()` of a string crashes; label/recode/tabulate after it never ran |
| 03_regress | regress, robust, aweights, `if`, predict, test, e()/r() | 10/10 | 10/10 |
| 04_factor | `i.`, `c.##i.`, testparm | 2/3 — `_b[c.yrsed#2.sex]` fails to parse in `display` (so `testparm` was never reached) | 3/3, but `testparm` unsupported (rc 199) |
| 05_cluster_iv | vce(cluster), ivregress 2sls (+robust) | 5/5 | 5/5 |
| 06_nonlinear | logit, probit, poisson, margins | 5/5 | 5/5 |
| 07_panel | xtset, xtreg fe (+cluster), areg, `L.` lags, reghdfe | 5/6 — no `reghdfe` (community command) | 6/6 |
| 08_datamgmt | merge m:1, collapse, preserve/restore, reshape wide/long, tempfile, append, duplicates, gsort | 10/10 | 10/10 |
| 09_programming | local/global, forvalues, foreach, scalars, capture, program/rclass, matrix, `#delimit`, estimates store/table | 7/8 — `confirm variable` returns rc 198, not 111 | 8/8, but `estimates table` unsupported (rc 199) |
| 10_errors | Stata return codes for common errors | 5/5 | 4/5 — type mismatch gives rc 198, not 109 |
| **Total** | | **60/63** | **61/63** |

Two of my own corpus errors were found and fixed along the way. `predict` scores out-of-sample rows, and Stata
names the interaction `c.yrsed#2.sex`. Both engines were right on both points.

Commands without a CHECK line were also checked for a nonzero return code. The table notes every one that
failed or never ran.

### Breadth probe (pass/fail, `eval/probe/`)
| Command | OpenDTA | OpenStat |
|---|---|---|
| `twoway scatter` + `graph export` | ok | ok |
| `histogram` + `graph export` | ok | ok |
| `tabstat …, by()` | ok | rc 198 |
| `svyset` + `svy: mean` | ok | rc 199 |
| `xtlogit, re` | **crash** (uncaught `OverflowError`; first scored ok by mistake, see note) | rc 199 |
| `mixed y x || id:` | ok | rc 199 |
| `correlate` / `pwcorr, sig` | ok | rc 199 |
| `xtivreg, fe` | ok | rc 199 |
| `bootstrap _b, reps(20)` | ok | rc 199 |
| `putexcel` | ok | rc 199 |
| `esttab` (community) | rc 199 | ok |
| `outreg2` (community) | rc 199 | rc 199 |
| **Total** | **9/12** | **4/12** |

Correction (2026-11-03): the first scoring only grepped for Stata `r(#);` lines, so a Python traceback counted as
a pass. Running the probes through `dofile.engine` (`tests/test_conformance.py`) found `xtlogit, re` crashing.

OpenDTA's roadmap lists what's still missing for Stata 14 parity, and it's almost all advanced *options* (for
example `ivprobit, twostep`, `xtunitroot llc`, `vec` constraints, Stata's class system). That's the project's own
claim, checked here only by the probe above.

### Things the numbers don't show
- **Output fidelity:** OpenDTA's `regress` table is laid out like Stata's (ANOVA header, coefficient table, factor
  levels labelled by value label). OpenStat claims byte-exact numeric display formats, and honoured `%20.12g`
  exactly. OpenDTA ignored the width/precision and printed 18 significant digits.
- **Error messages for students:** OpenDTA adds a plain-English explanation and a "how to fix / did you mean"
  hint under each Stata error (e.g. "reghdfe is not a command known to OpenDTA … did you mean recode?"). That fits
  the teaching IDE directly.
- **Speed:** both run each corpus file in about 0.3–1.5 s (OpenDTA's startup is about 1.3 s).

## Embeddability (needed for MCP + IDE)
- Both have an in-process API with a persistent session, so an MCP server can keep data in memory between tool calls.
  - OpenDTA: `opendta.session.Session().run(src)`, with output through `session.output.add_listener(fn)`.
  - OpenStat: `openstat.engine.Engine(cwd).run(src) → RunResult(output, rc, line)`.
- Both import without Qt. OpenDTA declares PySide6 as a hard dependency even though only the GUI uses it. An
  upstream change to make it an extra would avoid pulling ~500 MB of Qt into a server install.

## Browser (Pyodide 314.0.7, run under Node)
- **OpenDTA runs unmodified.** It loads straight from source with Pyodide's bundled numpy/scipy/matplotlib, plus
  openpyxl from micropip. It reads .dta with its own reader and gave the same results as native on 03 and 05.
  Packages load in about 2 s.
- **OpenStat runs only if .dta input avoids pyreadstat**, a C library that isn't in Pyodide. Using CSV input, it gave
  correct results on 05. It would need a small patch to fall back to `pandas.read_stata`.

So a client-side teaching IDE with no server compute is realistic with either engine, and easiest with OpenDTA.

## Why OpenDTA, and the risks
For it: clearly broader (9/12 vs 4/12 on the probe; its roadmap claims near-full Stata 14 coverage), the largest
test suite and CI, Stata-like output, beginner error hints, runs in the browser as-is, no pandas/statsmodels
dependency, and a clean-room policy. The core corpus is effectively a tie (60/63 vs 61/63).

Risks, and how to handle each:
1. **Three weeks old, one maintainer, 73% of commits AI-co-authored, 127k lines.** We may end up maintaining a fork. → Pin a
   commit. Call it only through our own adapter (`run(do_source, session) → {log, rc, results}`), so OpenStat or
   our own code can replace it. Keep this corpus as a conformance suite in CI.
2. **Known bugs from this run:** `display` with an interaction `_b[...]`, `confirm variable`, `%w.dg` formats
   not honoured, no `reghdfe`. → Report upstream (needs your OK, since it posts publicly), or patch them in our pin.
3. **Correctness beyond 63 checks is unverified**, and nothing was compared against real Stata. → If anyone on the
   project has a Stata license, generate reference logs for the corpus. OpenDTA ships a Stata-log comparison tool.

OpenStat stays the fallback: smaller and easier to read, exact formats, has `reghdfe`/`esttab`, but much narrower
and only 19 commits old. Its static inspection of Stata's binaries is a legal risk to look into before depending on
it (Stata's license terms on reverse engineering were not checked).

## Next (Phase 1, to plan with you)
- Python package: adapter over OpenDTA, plus an MCP server (`run_do`, `describe_data`, `get_results`,
  `load_dataset`, `list_commands`), over stdio and streamable HTTP.
- Web IDE: new Vite/React frontend, Monaco with tree-sitter-stata (MIT) highlighting, local storage, the engine in
  Pyodide in a web worker. Port the 3 old tutorials and reuse OpenDTA's error hints.
- **Your call:** you originally asked for the *Node backend* to become the MCP server. With a Python engine, the
  simpler option is a Python MCP server and retiring the Node backend (MongoDB/S3 are dropped either way). The
  alternative is keeping Node as a thin MCP/HTTP layer that calls the Python engine.
- Pick a new project name.

## Addendum: stats.camp (checked 2026-11-03)

[stats.camp](https://stats.camp/) is a hosted, **closed-source** browser app for Stata syntax. Its engine and UI are
Rust compiled to WebAssembly (~1.6 MB loaded on the main thread; the web workers' own downloads weren't measured).
All computation runs in the browser. Features: do-file editor and notebook, data viewer, .dta/CSV/Excel/Parquet,
GitHub sign-in and project sync, an optional AI assistant, command reference pages, and ready-to-run
workspaces for 7+ AEA replication packages. Its compatibility page lists 160 commands as supported, 42 partial and
3 planned. The GitHub account `stats-camp` (created 2026-02) hosts only the demo and replication repos, not the
engine. No MCP server, public API or self-hosting.

Same self-contained test (`set obs` + deterministic sin/cos data, no upload of real data), run in all three:

| | stats.camp | OpenDTA | OpenStat |
|---|---|---|---|
| Core numeric/rc checks (31) | 30 — `program …, rclass` + `return scalar` gave `.` | 30 — `confirm variable` rc 198 | 31 |
| Agreement on shared numbers | identical to 12 digits | (reference) | (reference) |
| Probes ok (12): tabstat, svy, mixed, xtlogit, correlate, bootstrap, margins, reghdfe, esttab, scatter, xtivreg, qreg | 7 — no svy, mixed, bootstrap, reghdfe, xtivreg | 9 — `xtlogit` **crashed the session** (uncaught OverflowError); no reghdfe, esttab | 5 |
| Output style | HTML tables, close to Stata's labels | Stata text layout | Stata text layout |

Other observations: in notebook-cell mode, one cell holding many lines failed as a whole on the first error, and
`capture` didn't catch an unknown command there. Run as a do-file, both behaved like Stata. The privacy page says
failed commands are reported to stats.camp *with their command text and error message*, plus usage metadata.

**What it means:** stats.camp already covers most of the "students in the browser" half of the plan, with a
polished, fast product. It doesn't cover the agent half (no MCP or API), and it isn't open source, self-hostable,
or usable offline as a library. So this project's distinct value is the **open-source, embeddable engine + MCP
server**. The web IDE should shrink to a thin demo, unless being open source and free of telemetry is itself the
selling point for classrooms.

## Decision (2026-11-03): refocus
The project is now **an open-source, embeddable Stata-syntax engine plus an MCP server for agents**. The web IDE
shrinks to a thin demo/playground, and students are pointed to stats.camp or the demo for full IDE use.
Phase 1 scope:
1. Python package: a thin session adapter over a pinned OpenDTA (`run(do_source, session) → {log, rc, results}`),
   with the evaluation corpus in `eval/` as CI conformance tests.
2. MCP server (stdio + streamable HTTP): `run_do`, `load_dataset`, `describe_data`, `get_results`, `list_commands`.
   Each session runs in its own process, because OpenDTA can crash the whole interpreter (seen with `xtlogit`).
3. Thin web demo: one page, OpenDTA in Pyodide, no accounts or storage.
4. Retire the Node backend, MongoDB and S3. Archive the old React frontend.
Name: **dofile** for the project, **dofile-mcp** for the MCP server package (chosen 2026-11-03; both free on PyPI and npm; trademark search not done).
Open: whether to report the OpenDTA bugs upstream.
