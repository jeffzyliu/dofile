# Research: Stata, open-source alternatives and agents (2026-11-03)

Notes from before Phase 0, kept as a dated record. Paths under "What exists today" are the 2020 repos, now in
`legacy/`. The engine choice that followed is in [engine-evaluation.md](engine-evaluation.md); the build, in
[phase1-plan.md](phase1-plan.md).

## Context
OpenStata (2020) is a school project: a React web IDE + Node/Express (MongoDB, S3) backend + Flask engine
that runs a small subset of Stata via pandas/econtools. The user wants to (a) refresh it, (b) broaden Stata
coverage, (c) expose parser + engine as an MCP server for agent clients. This file captures the research
needed to decide whether that's worthwhile and what direction to take. Implementation plan comes after
discussion with the user.

## What exists today (codebase)
- **Parser**: nearley grammar compiled to `openstata-backend/src/parser/index.js` (~717 lines generated). Node parses
  each line into JSON `{command, args, condition, options}`; Flask executes it.
- **Engine**: `openstata-engine/stata-functionality/stata.py` (449 lines). ~15 commands: clear, use, summarize,
  describe, mean, log using/close, generate, replace, rename, drop, keep, tabulate (1-way only; 2-way is broken —
  `df.count_values()` doesn't exist), regress (via `econtools`), predict (resid/xb), test. `merge` is parsed but not
  implemented. `if` conditions use `DataFrame.query`, expressions use `DataFrame.eval` with regex rewrites
  (`^`→`**`). Output is pandas `to_string()`, not Stata-style tables. No macros, loops, `by:`, `egen`, `collapse`,
  `reshape`, `merge`, labels, `e()`/`r()` results.
- Grammar source: `openstata-backend/src/parser/grammars/grammar.ne` (698 lines, handles abbreviations, `//`, `if`,
  options, `merge 1:1|1:m|m:1`). Grammar and engine disagree: `predict` and `merge` parse but the engine's dispatch
  (`openstata-engine/do.py` `RunStata.run_command`) rejects them. Engine is stateless per request (whole do-file reruns).
- Tests: parser has testcases in `src/parser/testing/`; engine "test" is print-only, no assertions.
- Known bugs: `tabulate` returns a DataFrame (not JSON-serializable); `generate` ignores `if`; `use` returns success on
  unknown file type; `app.py` NameError when `tutorialID` missing; `/sign-s3` unauthenticated with client-chosen key
  and `public-read` ACL. Heroku URLs hard-coded in all three parts (Heroku free tier gone → all likely dead).
- **Stack age**: Python deps pinned 2020 (pandas 1.1, Flask 1.1, numpy 1.19); `econtools` is unmaintained.
  Node pinned `>=9 <=15`, mongoose 5, React 16 (CRA). Total ~5k lines of hand-written code across all three parts.
- Conclusion: the code is small enough that a rewrite of the engine is cheaper than incremental extension.
  The reusable assets are the idea, the UI flow, and the tutorial content.

## Research: is Stata still relevant (2026)?
- **Economics research: yes, dominant and not declining.** skranz (8,262 replication packages, all years pooled):
  Stata 71.6%, MATLAB 24.5%, R 9.8%, Python 4.1%. Per-year: R 1.4% (2010) → >20% (2023); Python 0.4% → ~10%;
  Stata and MATLAB "relatively constant". Upton et al. (arXiv 2504.06507; >10k papers through 2024): Stata in
  "80% (or more)" of econ packages, "no evidence that use of Stata is declining"; multi-language packages rose
  from <10% (2010) to >40% (2024) — economists *add* R/Python rather than switch.
  **Political science is shifting**: R passed Stata in 2019; 2024 ≈ R 75%, Stata ~50%. Statistics: Stata <1%.
- **StataCorp is active.** Stata 19 (Apr 2025) + StataNow continuous releases: H2O ML, CATE, built-in HDFE,
  Parquet import (Nov 2025), and an official blog post on calling ChatGPT/Claude/Gemini from Stata.
- **Cost still a barrier.** Student licenses ~$48/6mo to ~$300 perpetual for BE (unverified 3rd-party numbers);
  many schools provide site licenses, but students lose access after graduation; industry use is limited.
- **Teaching debate is ongoing**: departments split between Stata ("commands map onto econometric concepts")
  and R ("free, used in industry"). No clear 2024–25 survey data on course software.

## Research: open-source Stata replication since 2020
**Revised after GitHub check:** two MIT-licensed, license-free .do interpreters appeared in Oct 2026 (OpenDTA,
OpenStat). Both are desktop apps with no MCP server, web IDE or browser runtime. The landscape is:
| Project | What it is | Gap vs. OpenStata's idea |
|---|---|---|
| **StatsPAI** (PyPI, v1.2x, JOSS) | Python library, Stata-*named* functions (regress, reghdfe, csdid, rdrobust, synth, outreg2…), ~1k functions, agent-oriented | Python API, not Stata syntax; no .do interpreter. Strong candidate as the **estimation backend**. |
| **PyFixest** | Python port of R `fixest` (feols, IV, Poisson, HDFE) | formula syntax, not Stata. Also a candidate backend. |
| **Stataconda** (elliottash) | Desktop GUI translating Stata cmds → pandas/statsmodels | closest analog; small, desktop-only |
| **PyStataR**, wakuwakumiwaku/**openstata** | Stata-flavored pandas helpers (tab, egen, winsor); the latter is literally named "openstata" (clinical stats) | **name collision** on GitHub/PyPI |
| **pystata** (official) | Python ↔ licensed Stata bridge | needs a license |
| **mcp-stata** (tmonk, LSE), **hanlulong/stata-mcp** | MCP servers for agents | both **require a local licensed Stata** |
| **stata-code** (same author as StatsPAI) | Agent bridge (MCP, Jupyter, VS Code) to *licensed* Stata, cross-validates vs StatsPAI | needs license |
| **StatsPAI MCP server + `sp.from_stata()`** | translates single Stata commands → StatsPAI calls; ships an MCP server | translation of commands, not a .do interpreter (no data-state, macros, loops) — **closest competitor to the MCP idea** |
| **OpenDTA** (yaskepalhares, MIT; created 2026-10-08, ~439 commits, 364 .py files) | Desktop (Qt) interpreter targeting *all of Stata 14*: macros, loops, `by`, `if/in`, Stata storage types/float precision, own .dta reader/writer, `capture/quietly`, r() error codes, Stata-log comparison tool, CI. Roadmap phases 0–1 done; also claims estimation, surveys, Mata, graphics | **Real license-free .do interpreter already exists.** Desktop only, no MCP/web. 0 stars, 3 weeks old |
| **OpenStat** (dgonzalezgonzalez, MIT; created 2026-10-15, ~19 commits) | Desktop + `--batch file.do --json`: macros, loops, programs/`syntax`, r()/e()/c(), byte-exact Stata display formats, Stata's RNG, reghdfe-style HDFE, 2SLS, logit/probit, esttab, Mata subset | Same: desktop, no MCP. Batch JSON mode is almost agent-ready |
| **Dodo** (codedthinking, MIT, alpha) | DuckDB extension that runs .do commands as SQL | data-cleaning subset only |
| **tree-sitter-stata** ×4: codedthinking (MIT, clean-room, Dodo), jbearak (GPLv3, powers Zed ext + "Sight" LSP), SimonMTaye, tumarkin | Open Stata grammars, all early (v0) | grammar gap is **partly filled**; codedthinking's MIT one is reusable |
| **MCP servers needing Stata**: hanlulong/stata-mcp (520★), SepineTam/mcp-for-stata (274★), tmonk/mcp-stata (91★), stata-code (55★) | — | strong **demand signal**: agents-driving-Stata is popular, but all need a license |
| **gretl** | free GUI + scripting (hansl), widely used for teaching, active 2025 | not Stata syntax; main free *teaching* competitor |
(GitHub verified via `gh` on 2026-11-03; competitor capability claims are from READMEs, not run.)

## Research: agents + econometrics
- Active area: ReplicatorBench (KDD '26), REPRO-Bench (ACL '25), NBER "AI Agents and Prompt Engineering in
  Econometric Coding", "Econometrics AI Agent". An SSRN 2026 paper warns LLMs fabricate regression
  coefficients and recommends LLM-writes-code / real-engine-computes.
- Existing Stata MCP servers (tmonk, hanlulong, SepineTam, stata-code) all need licensed Stata. StatsPAI's MCP
  translates single commands but doesn't run a .do file with data state, macros and loops. So the remaining gap is
  narrower than "nothing exists": a **license-free interpreter that runs whole .do files with Stata semantics**
  (sessions, `if/in`, `by:`, macros, loops, `e()/r()`), plus a parser that tools can use on their own to lint or
  inspect .do files. Good fit for agents checking replication packages and for CI.

## Research: education
- Browser-native runtimes (Pyodide, webR, Quarto Live) are now the standard way to teach without installs;
  pandas/numpy/scipy/statsmodels run in Pyodide. A Python engine could run **entirely client-side**, removing the
  Flask server, S3 cost and data-privacy concerns for coursework.
- Caveat: pyfixest uses numba, which doesn't run in Pyodide (unverified per-package; statsmodels/scipy are believed
  bundled). So "runs in the browser" constrains the estimation backend → statsmodels + linearmodels/own HDFE code.
- Competition: gretl (free, built for teaching), Colab/Posit Cloud + pyfixest/fixest, webR. Demand side: Wooldridge
  8e ships datasets with R/Python companions (Heiss); Mixtape/The Effect publish Stata+R+Python side by side
  (from memory, not re-verified). Students do keep running into Stata syntax.
- Value: students in Stata-taught courses with no license / Chromebooks / post-graduation; intro econometrics
  with Wooldridge-style datasets; "see the Python equivalent" teaching mode.

## Assessment of the value proposition
Yes, with a sharper position than in 2020:
1. **Agent-facing, license-free .do-file interpreter (MCP)** — the interpreter itself is no longer a gap (OpenDTA,
   OpenStat). The gaps left: (a) a license-free **MCP server** for running .do files (popular Stata MCPs all need a
   license), (b) a **web/browser** IDE for teaching. Key strategic choice: build our own engine, or adopt/contribute
   to OpenDTA or OpenStat (both MIT, Python) as the engine and make this project the MCP + web/teaching layer.
   Both are 3–4 weeks old with 0 stars, so evaluate them hands-on before betting on either.
2. **Zero-install teaching IDE** for intro econometrics — real but narrower; competes with "just use R/webR".
3. **Not** a full Stata replacement — Stata's surface (Mata, ado ecosystem, graphics) is too large; target the
   ~50–80 commands that cover intro/intermediate applied-micro courses and typical replication .do files.
Risks: StataCorp trademark ("Stata" in the name — rename advisable, also resolves the GitHub name collision);
output fidelity expectations; StatsPAI could add a .do interpreter itself.

## Decisions so far (user, 2026-11-03)
- Engine: **evaluate OpenDTA and OpenStat hands-on first**, then decide build vs. adopt.
- Audience: **agents and students equally** (MCP server + web teaching IDE).
- Storage: **drop MongoDB/S3/accounts for now**; local/browser storage.

## Sources
- https://www.r-bloggers.com/2023/12/usage-shares-of-programming-languages-in-economics-research/
- https://arxiv.org/html/2504.06507v2 ; https://www.tandfonline.com/doi/full/10.1080/26939169.2026.2725967
- https://www.businesswire.com/news/home/20250408169339/en ; https://blog.stata.com/page/2/
- https://www.statalist.org/forums/forum/general-stata-discussion/general/1783126-latest-12-november-2025-updates-to-statanow-19-and-stata-19
- https://pypi.org/project/StatsPAI/1.28.0/ ; https://github.com/s3alfisc/pyfixest ; https://github.com/elliottash/stataconda
- https://github.com/wakuwakumiwaku/openstata ; https://github.com/brycewang-stanford/PyStataR
- https://claudemarketplaces.com/mcp/io.github.tmonk/mcp-stata ; https://claudemarketplaces.com/mcp/hanlulong/stata-mcp
- https://www.cs.odu.edu/~jwu/downloads/pubs/soos-2026-kdd/soos-2026-kdd.pdf ; https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7053118
- https://github.com/hanlulong/awesome-ai-for-economists ; https://policy.fi/ai-econ/
- https://github.com/brycewang-stanford/statspai ; https://github.com/brycewang-stanford/stata-code
- https://github.com/dgonzalezgonzalez/OpenStat ; https://github.com/yaskepalhares/opendta ; https://github.com/SepineTam/mcp-for-stata
- https://gretl.sourceforge.net/ ; https://cran.rstudio.com/web/packages/wooldridge/index.html
- https://damien-dupre.github.io/talks_slides/edtech_2026.html
- https://www.aeaweb.org/forum/169/statistics-package-should-undergraduate-students-taught
- https://metricgate.com/blogs/stata-license-cost/
- https://aeadataeditor.github.io/projects/project4

## Refocus (2026-11-03)
Engine + MCP first; web IDE reduced to a thin Pyodide demo. See docs/engine-evaluation.md "Decision".
