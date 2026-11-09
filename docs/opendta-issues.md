# OpenDTA issues (tracking sheet)

Problems found in the vendored OpenDTA engine (`src/dofile/_vendor/opendta`, commit in its `VENDORED` file):
bugs (ODT-*), missing features (GAP-*), and dofile's own patches to it (PATCH-*). **None of these are reported
upstream yet.** Each needs a hand check against real Stata by someone who knows it before anything is reported.
The "Expected in Stata" line in each entry's details is our reading of the Stata manual or of OpenDTA's Stata 14
reference logs (`tests_opendta/compat/expected/`), not a Stata run.

Status values: `unverified` (seen in dofile, Stata behavior not checked), `documented` (a Stata manual, FAQ or reference
log states the expected behavior, with the source in the entry; still not a Stata run), `likely not a bug` (the evidence
suggests Stata does the same), `confirmed` (checked against Stata),
`reported` (issue opened upstream), `fixed upstream` (fixed in a commit we have not vendored yet), `vendored`
(the fix is in our copy), `patched` (fixed by a dofile patch in `scripts/patches/`, to report upstream), `partly patched` (the patch covers part
of the entry; the rest is listed in its details), `known`
(a missing feature, not a bug), `left as is` (a real but harmless difference that we chose not to patch; the reason is in the entry). PATCH-1's status describes its own progress.
The repros were run in dofile (`dofile run` or the MCP server) on 2026-11-04 and 05; the patched ones have tests. The cps and panel data are
in `tests/conformance/data/`; the Card data is Wooldridge's public `card.dta` (Card 1995), not in the repo.

| ID | Symptom | Where it shows up | Status |
|---|---|---|---|
| ODT-1 | `regress` on a perfect fit crashes (ZeroDivisionError, rc 9999) | `tests/test_engine.py::test_odt_fixes` | patched |
| ODT-2 | `xtlogit, re` crashes on some data (OverflowError, rc 9999), even inside `capture` | probe `p04_xtlogit.do`, `::test_odt2_xtlogit_bounds_dont_overflow` | patched |
| ODT-3 | `_b[c.yrsed#2.sex]` does not parse (rc 198) | `::test_odt3_interaction_names_in_b` | patched |
| ODT-4 | `confirm variable` on a missing variable returns rc 198, not 111 | `::test_odt4_confirm_variable` | patched |
| ODT-5 | `%w.dg` ignores d: `%20.12g` prints 18 significant digits, `%12.4g` 10 | `::test_odt_fixes`; corpus `CHECK` lines use it | patched |
| ODT-6 | regressing a variable on its own interaction crashes (decimal InvalidOperation, rc 9999) | `::test_odt_fixes` | patched |
| ODT-8 | backslash escapes `\$` and ``\` `` don't stop macro expansion | `::test_odt8_backslash_dollar_is_a_literal_dollar` | patched |
| ODT-9 | `ivregress` prints a long `Instruments:` list on one line instead of wrapping it at 80 columns | `::test_odt_fixes` | patched |
| ODT-10 | `graph bar ..., over(x, relabel(...))` ignores `relabel()` | `::test_odt10_relabel` | patched |
| ODT-11 | `by g: regress ...` refuses with rc 190 "regress may not be combined with by" | found 2026-11-04, no test | documented |
| ODT-12 | `nbreg` prints a NumPy warning (`invalid value encountered in sqrt`) computing alpha's standard error | `::test_odt_fixes` (smoke test; trigger checked on the Card data) | patched |
| ODT-13 | bare `mean` (replay) refuses with rc 100 `varlist required`, also `mean, level(90)`, even right after `mean`; `estimates replay` works | `::test_odt13_summary_commands_replay` | patched |
| ODT-14 | Stata code reaches Python's `eval()` (empty `__builtins__`, escapable): `arch ..., archmexp()` and `bayesstats` `{param}` expressions | `::test_safe_eval_allows_only_arithmetic`, `::test_stata_expressions_cannot_reach_python` | patched |
| ODT-15 | `predict` after `mean` or `bootstrap` crashes (AttributeError `'Estimates' object has no attribute 'terms'`, rc 9999, traceback in the log; `capture` doesn't catch it) | `::test_odt15_predict_after_a_command_without_predict` | patched |
| ODT-16 | `color()` specs: `gs#` is inverted (`gs0` white, `gs16` black); `none`, `*#` intensity (`navy*.5`) and `%#` opacity (`maroon%50`) fall back to the default palette color without an error; also unhandled: CMYK/`hsv` specs, color lists, about 20 of Stata's named colors | `::test_odt16_*` | partly patched |
| ODT-17 | `legend(pos(#))` ignored: the legend is always at the bottom center | `::test_odt17_legend_position` | partly patched |
| ODT-18 | `ttest a == b, unequal` without `unpaired` runs a paired test (prints "Paired t test") instead of refusing | `::test_odt18_ttest_options_of_the_paired_and_one_sample_forms` | patched |
| ODT-19 | a matrix subscript on `e()`/`r()` matrices in an expression fails, with rc 109 "type mismatch" or 198 depending on the command (table in the details); Stata also rejected `e(b)[1,1]` in Stata 11 (see details), so probably the same | found 2026-11-05, no test | likely not a bug |
| ODT-20 | `histogram` (and `bar`'s) outline ignores `lcolor()`/`lwidth()`: histogram bars always get a background-colored edge, so `fcolor(none) lcolor(navy)` draws nothing | `::test_odt20_histogram_outline` | patched |
| ODT-21 | numeric axis ticks step by 2.5 (`0.0 2.5 5.0 ... 20.0`, with `.0` labels) where Stata uses 1/2/5/10 steps (`5 10 15 20`) | `::test_odt21_default_axis_ticks_are_nice_numbers` | patched |
| ODT-22 | the `matrix(name)` pseudofunction is not supported in expressions: `display trace(matrix(xx))` and `el(matrix(xx),2,1)` give rc 198 (`trace(xx)` works) | `::test_odt22_matrix_pseudofunction` | patched |
| ODT-23 | `capture` does not catch a file error that comes as a Python `PermissionError` (the dofile sandbox's refusal in `type`, ...): the whole call stops with rc 603 | `tests/test_sandbox.py::test_capture_catches_a_sandbox_refusal_like_any_file_error` | patched |
| ODT-24 | `xtreg ..., fe|re|be` and `areg ..., absorb()` ignore `[aweight=]`, `[pweight=]` and `[fweight=]`: the coefficient is the unweighted one | `tests/test_engine.py::test_odt24_*` | patched |
| ODT-25 | `describe` prints a long wrong `Sorted by:` list (48 names with repeats) for a Stata-written file whose own sort list is one variable | found 2026-11-05 (castle.dta); `tests/test_engine.py::test_odt25_the_sort_list_ends_at_the_first_zero` rebuilds the bytes | patched |
| ODT-26 | `mkdir`, `rmdir`, `copy` and `dir` delete the backslashes of an unquoted path (`mkdir C:\proj\out` makes `C:projout`), unlike `use`/`save` and unlike the same path in quotes: their arguments are split with `shlex` in POSIX mode, where `\` is an escape | found 2026-11-06 (path shim tests) | unverified |
| ODT-27 | `save using name, replace` is accepted and writes a file called `using name.dta`; `save a b, replace` writes `a b.dta`. `save` has no documented `using` clause, so Stata should refuse the first form with a syntax error (assumed; the closed-source Rust reimplementation at stats.camp accepts it and writes `name.dta`, which is no evidence about Stata) | found 2026-11-06 (web demo); not checked against Stata | unverified |
| ODT-28 | Python errors that escape a command are not turned into Stata errors: rc 9999 `internal engine error` with a traceback, the whole program ends, and `capture` does not catch it. A missing folder (`log using hi/hi`, `cmdlog`, `outfile`, `file open ... write`, `copy`, `bcal create`) or a directory where a file is expected (`use`, `append`, `type`, `infile`, ...): `OSError`, Stata r(603) `file ... could not be opened`. Out of memory (numpy cannot allocate): `MemoryError`, Stata r(909). A command that fails partway leaves the data partly changed | found 2026-11-07 (web demo); `tests/test_engine.py::test_odt28_*`; expected codes assumed, not checked against Stata | patched (the partly changed data is not) |
| ODT-29 | numpy `RuntimeWarning: overflow encountered in exp` when a delta-method interval is computed from a huge standard error: `estimation/mleq.py:157` (`transformed_row`, the `exp` of `b ± c·se`) and `estimation/models2.py:739` (`nbreg`/`gnbreg`, the interval of alpha). The value becomes `inf`, which is what the Stata 14 logs show. The warning goes to Python's warnings, not the Stata log | `poe slow`: `test_matches_stata14_reference_log[1907_models]` and `[1918_models3]`; `tests_opendta/tests/test_models_block_c.py::test_nb1_nbreg_and_tnbreg` (`mleq.py:157` only); no test of our own | left as is |
| ODT-30 | the ML optimizer takes Newton steps from a nearly singular numerical Hessian, so where the likelihood is flat its path (and sometimes where it stops) depends on the last digits of the likelihood's derivatives. `gnbreg cnt x1 x2, lnalpha(x3)` in compat 1907 stops at the boundary alpha = 0 (ll equal to the Poisson log likelihood), a false convergence: a relative 1e-13 change in the derivatives gives a run that does not converge, 1e-11 one that converges to a log likelihood 0.17 higher. Its constant-only model is stuck (ll -959.397, Stata -952.7455) | found 2026-11-07 comparing CPython with Pyodide (`web/scripts/compare_numeric.py`); perturbation experiment in `phase2-plan.md`, "`gnbreg` in 1907_models"; no test | unverified |
| ODT-32 | a missing optional package (pyreadstat, pandas) is reported as rc 610, which in Stata means "file not Stata format", with advice to `pip install` it: `import sasxport`, `import spss`, `import sas`, `use` of a Stata 7 or older `.dta` (pyreadstat), `export sasxport` (pandas). A script that tests `_rc == 610` to detect a bad file misreads it, and the advice is useless in the web demo | found 2026-11-09 (the web demo ships without pandas); `tests/test_engine.py::test_odt32_*`, `web/e2e/poc.spec.ts` | patched |
| GAP-1 | community commands `reghdfe`, `esttab`, `outreg2` don't exist (not bugs) | corpus `hdfe_b_x1`, probes `p06_esttab.do`, `p07_outreg2.do` (xfail) | known |
| GAP-2 | `estat firststage` after `ivregress` is not implemented (rc 321) | found 2026-11-04 (Card 1995 replication), no test | known |
| GAP-3 | `estat endogenous` and `estat overid` after `ivregress` are not implemented (rc 321), like GAP-2's `estat firststage` | found 2026-11-05, no test | known |
| GAP-4 | `twoway lpoly` and `twoway lpolyci` are not plot types (rc 198 `lpoly is not a twoway plot type`); standalone `lpoly` works | found 2026-11-05 (Lee 2008 RD replication), no test | known |
| GAP-5 | `estimates` has only `store`, `restore`, `dir`, `drop`, `clear`, `replay` and `table`; `save`, `use`, `describe`, `stats`, `for`, `notes`, `title` and `query` give rc 198 `<sub>: unknown subcommand` | found 2026-11-07 (checking ODT-28's side find), no test | known |
| GAP-6 | `help` has no page for the language topics `if`, `in`, `foreach`, `forvalues`, `while`, `weights`, `varlist` (rc 111 `help for foreach not found`); every command has one | found 2026-11-08 (web demo design: the Help panel), no test | known |
| PATCH-1 | dofile patch: `r(table)` after every coefficient table (and `mean`/`proportion`/`total`/`ratio`), with e(b)'s columns, replacing r(); new estimates drop a stale one. Open: Stata check | `tests/test_engine.py::test_r_table_*`, `::test_new_estimates_drop_a_stale_r_table` | 5 of 6 fixed; needs Stata check |
| PATCH-2 | dofile patch: Break is taken only at safe points (between commands and loop passes, outside `by`; in the ML optimizer, `bootstrap`/`permute`/`jackknife` replications, Mata loops and `sleep`). An interrupt mid-command could leave the data half changed (an interrupted `append` left columns of different lengths) | `tests/test_break.py` | patched |
| PATCH-3 | dofile patch: every file name the user writes goes through one hook (`core/userpath.user_path`), after its default extension is added. Unset, nothing changes; dofile's web demo sets it to map paths into its working folder (`dofile/pathshim.py`) | `tests/test_pathshim.py` | patched (dofile-only, not for upstream) |
| PATCH-4 | dofile patch: `expand` and `stsplit` build their `np.repeat` counts as `np.intp` instead of `np.int64`. Where `intp` is 32 bits (the web demo's WebAssembly Python) numpy refuses an int64 counts array. Identical on 64-bit | `expand` and `stsplit` cases of `tests_opendta/compat` in Pyodide (`web/scripts/check-snapshot.mjs`); a CPython test cannot show it | patched (dofile-only, wasm32); not yet run in Pyodide |

## Details

### ODT-1: perfect-fit `regress` crashes
```stata
clear
set obs 20
gen x = _n
gen y = 2*x
regress y x
```
- dofile: rc 9999, `internal engine error: ZeroDivisionError: division by zero`.
- Expected in Stata: the regression runs (R² = 1, root MSE 0), and the F statistic and p-values show as missing.
  Source: [R] regress (to confirm).
- Patched (`opendta-odt1-perfect-fit.patch`): F was divided by a zero residual variance; now F and its p-value
  are missing, standard errors 0, t/p/CI missing.

### ODT-2: `xtlogit, re` overflow
```stata
use panel, clear
xtset id year
xtlogit d x1 x2, re
```
- dofile: rc 9999, `internal engine error: OverflowError: math range error` (in `math.exp`). Not caught by
  `capture`, because it isn't a Stata error. Other data can run fine.
- Expected in Stata: estimates, or a convergence message with a Stata return code. Source: [XT] xtlogit.
- Patched (`opendta-odt2-xtlogit-overflow.patch`): the model converges at the sigma_u = 0 boundary and the
  rho/sigma_u interval bounds overflowed `math.exp`; now rho's bounds use a stable form and an overflowing
  sigma_u bound is missing. Same `math.exp` pattern, not seen to fail yet: other panel models' bounds in
  `panel2.py` (`xtreg, mle`, `xtpoisson, re`).

### ODT-3: `_b[]` with an interaction name
```stata
use cps, clear
generate double lwage = ln(wage_hr)
regress lwage c.yrsed##i.sex
display _b[c.yrsed#2.sex]
```
- dofile: rc 198 `invalid syntax` from `display`. The coefficient exists in `e(b)` as `c.yrsed#2.sex`.
- Expected in Stata: shows the coefficient (.00783558 here). Source: [U] 13.5 (accessing coefficients) and
  [U] 11.4.3 (factor variables).
- Workaround: `matrix b = e(b)` then `display b[1, colnumb(b, "c.yrsed#2.sex")]`; or get it from `run_do`
  results or `get_matrix("e(b)")`.
- Evidence (2026-11-05): [U] 13 writes interaction coefficients as `b[1.sex#2.group]`, and Stata's linear-regression
  interaction slides use `_b[1.female#c.age]`, so these names are accepted in Stata
  ([U] 13, https://www.stata.com/manuals13/u13.pdf). Today dofile gives rc 198 for both `_b[c.yrsed#2.sex]` and
  `_b[2.sex#c.yrsed]`; `_b[yrsed]` and `_b[2.sex]` work, so only interaction names fail. Not found: whether Stata
  names this model's term `c.yrsed#2.sex` or `2.sex#c.yrsed` (the Stata 14 reference logs show `g#c.x` for
  `i.g#c.x` and `c.x#c.x`, the written order, which is what dofile's `e(b)` uses).
- Patched (`opendta-odt3-coef-interaction-names.patch`): the tokenizer accepts `#` and `.` inside `_b[...]`, `_se[...]`
  and `_coef[...]` (`c.yrsed` splits at the dot), and `_coef_index` tries the terms of an interaction in any order,
  since Stata's order for this model is not known (VERIFY). `display _b[c.yrsed#2.sex]` now gives `.00783558`, as
  `_b[2.sex#c.yrsed]` does. A `#` outside the brackets is still a syntax error.

### ODT-4: `confirm variable` return code
```stata
clear
set obs 1
capture confirm variable nosuch
display _rc
```
- dofile: `198`.
- Expected in Stata: `111` ("variable nosuch not found"). Source: [P] confirm.
- Workaround: test `_rc != 0` instead of `_rc == 111`.
- Evidence (2026-11-05): [P] confirm says a failing `confirm` gives the appropriate error message and a nonzero return
  code, and its capture example shows `_rc` 111 for a missing variable
  (https://www.stata.com/manuals14/pconfirm.pdf). Still reproduces: dofile `198`.
- Patched (`opendta-odt4-confirm-variable.patch`): `confirm [new|numeric|string|str#|<type>] variable varlist [, exact]`
  with the manual's codes: 111 `variable not found` and `no variables defined`, 110 `already defined` for `new`, 198
  `invalid name`, 7 for a type mismatch. VERIFY: the type-mismatch message text; `exact` turns off abbreviations.

### ODT-5: `%w.dg` ignores d
```stata
display %20.12g 1/3
display %12.4g 1/3
```
- dofile: ` .333333333333333315` (18 significant digits) and `.3333333333`.
- Expected in Stata: `.333333333333` and `.3333` (at most d significant digits). Source: [D] format.
- Patched (`opendta-odt5-general-digits.patch`): `format_value` passed only the width to `general()`, which
  implements `%w.0g`; d now caps the significant digits. `%w.0g` is unchanged.

### ODT-6: regression on its own interaction
```stata
use cps, clear
regress yrsed c.yrsed#i.sex
```
- dofile: rc 9999, `internal engine error: InvalidOperation`.
- Expected in Stata: estimates (an unusual model, but valid). Source: to check in Stata.
- Patched (`opendta-odt6-huge-fixed-format.patch`): the model is a numerically perfect fit, so F and t are
  ~1e14 to 1e29, and `%f` formatting crashed for values that need more than Decimal's default 28 digits; it now
  uses enough precision. To verify: how Stata 14 prints such huge F and t values (here they overflow the
  table's columns).

### ODT-8: backslash escapes for macros
```stata
global v1 X
display "a\$v1 b"
```
- dofile: `a\X b` (the backslash stays and `$v1` is expanded).
- Expected in Stata: `a$v1 b`; a backslash before `$` or a backquote stops expansion. Source: [U] 18.3 (macros),
  to confirm.
- Workaround: put such text in a macro and reference it, since a macro's contents aren't expanded again. This
  is how `dofile run` passes the do-file path.
- Evidence (2026-11-05): Stata's FAQ on backslashes and macros shows `display "\$myfile"` printing the literal text
  `$myfile`, and the Programming manual prints `$22.15` with `display "\$22.15"`
  (https://www.stata.com/support/faqs/programming/backslashes-and-macros/). So `\$` is documented. The backquote
  half of the entry is not: the FAQ only covers a backslash that precedes a local macro in a path (`\\`myfile'`).
  Still reproduces: `a\X b`.
- Patched (`opendta-odt8-macro-backslash-dollar.patch`): in `lang/macros.py:expand`, `\$` leaves a literal `$` (the
  backslash is dropped) and `$name` still expands. Only `\$` is handled: how Stata treats a backslash before a
  backquote, or a doubled backslash, is not documented well enough here (the FAQ only covers a path such as
  ``c:\data\\`myfile'``), so those are unchanged.

### ODT-9: `Instruments:` footnote does not wrap
```stata
use card, clear      // Wooldridge's card.dta (Card 1995)
ivregress 2sls lwage (educ = nearc4) exper expersq black smsa south smsa66 reg662-reg669
```
- dofile: `Instruments:   exper expersq black ... reg669 nearc4` on one line of about 150 characters.
- Expected in Stata: the list wraps at the line size, with continuation lines indented under the first
  instrument. Source: memory of Stata output; the Stata 14 reference log (`0510_painel_iv.log`) only has short
  lists, so to confirm.
- Patched (`opendta-odt9-footnote-wrap.patch`): the `Instrumented:`/`Instruments:` footnotes of `ivregress`,
  `ivprobit`/`ivtobit`, `svy: ivregress` and `xtivreg` wrap at the line size with a hanging indent.

### ODT-10: `relabel()` ignored in `graph bar`
```stata
use card, clear
graph bar (mean) educ, over(nearc4, relabel(1 "Not near" 2 "Near"))
```
- dofile: the bars are labeled `0` and `1`.
- Expected in Stata: the bars are labeled "Not near" and "Near". Source: [G-2] graph bar, `over()` suboptions.
- Patched (`opendta-odt10-relabel.patch`): `relabel(# "text")` in `over()` of `graph bar` and `graph box` renames
  categories by position.

### ODT-11: `by` with `regress`
```stata
use card, clear
gen byte g = 1 + mod(_n, 3)
by g, sort: regress lwage educ
```
- dofile: rc 190, `regress may not be combined with by`.
- Expected in Stata: one regression per group; `regress` allows `by`. Source: [R] regress (by is allowed).
- Workaround: `forvalues` over the groups with `if`.
- Evidence (2026-11-05): the current [R] regress manual lists `by` among the prefixes `regress` accepts, with
  `bootstrap`, `jackknife`, `rolling`, `statsby` and others (https://www.stata.com/manuals/rregress.pdf).
  Still reproduces on the CPS data: `by g, sort: regress ...` and `bysort g: regress ...` both give rc 190, while
  `bysort g: summarize` works.
- Re-run 2026-11-05 (dofile, Card data): `by g, sort: regress lwage educ` and `bysort g: regress lwage educ` both give rc 190;
  `bysort g: summarize lwage` works. Stata 13 and 14 manuals list `by` among the prefixes allowed with estimation commands
  (the [R] glm manual of Stata 14 shows the same list as [R] regress: bootstrap, by, fp, jackknife, mfp, mi estimate,
  nestreg, rolling, statsby, stepwise, svy). The Stata 14 [R] regress page itself was not read. The Stata 14 reference logs have no `by:` estimation.

### ODT-12: `nbreg` warning
`nbreg pos educ` on the Card data (`pos = round(exp(lwage-5))`) prints `RuntimeWarning: invalid value encountered
in sqrt` from `estimation/models2.py` (alpha's standard error). The estimates still come back; check whether
the standard error of `lnalpha` is missing where Stata would report one.
- Patched (`opendta-odt12-nbreg-boundary.patch`): `lnalpha` (-18.6, just above the -20 boundary test) had a
  negative variance; the square root is skipped and the row shows missing, as at the boundary. Still to verify:
  the LR test printed `chibar2(01) = 2.5e-03`; Stata 14 shows `%7.2f` and `0.0e+00` for an exact zero, so small
  positive values are unchecked (marked VERIFY in the code).

### ODT-13: bare `mean` (replay)
```stata
clear
set obs 50
gen x = rnormal()
mean x
mean
mean, level(90)
```
- dofile: the last two give rc 100 `varlist required`. `estimates replay` redisplays the results.
- Expected in Stata 14: [U] 20.3 says typing an estimation command without arguments redisplays its prior results,
  with options allowed on replay (its example is `regress` and then `regress, coeflegend`)
  (https://www.stata.com/manuals14/u20.pdf). `mean` is an estimation command (it stores `e(b)` and `e(V)`), and
  its reporting options `level()`, `noheader`, `nolegend` and `coeflegend` are replay options
  (https://www.stata.com/manuals14/rmean.pdf). The syntax box in [R] mean shows only `mean varlist ...`, but
  `regress`'s box has no replay line either. Not run in Stata, so whether `mean` itself replays is documented
  by the general rule and not shown.
- Workaround: `estimates replay`.
- Patched (`opendta-odt13-mean-replay.patch`): `mean`, `proportion`, `ratio` and `total` with no varlist redisplay the last
  result, header and table, as typed the first time; `, level(90)` recomputes the intervals, `, noheader` drops the
  header, and `r(table)` is reposted. Another estimation in between gives rc 301 `last estimates not found`. The first
  `mean x y` output is identical to the replay (tested). This patch applies before `opendta-patch1-r-table.patch`
  (patches apply in name order), which edits the same function and adds the `r(table)` call to the replay.

### ODT-14: Python `eval()` on expression text (security)
```stata
tsset t
arch y, arch(1) archm archmexp(().__class__.__mro__.__len__()*X)
```
- dofile: runs (rc 0). `archmexp()` and `bayesstats summary ({param} expressions)` passed their text to Python's
  `eval()` with `{"__builtins__": {}}`, which doesn't stop attribute access, so Stata code could reach Python's
  object internals inside the sandboxed worker. Only the audit hook (no subprocesses or network, confined file
  access) stood behind it. Present at the pinned commit; upstream `main` (0.10.0) still has it, with the bayes
  code moved to `bayespost.py`.
- Expected: these options take arithmetic expressions only. Source: [TS] arch (`archmexp()`), [BAYES] bayesstats.
- Patched (`opendta-odt14-safe-expr.patch`): a restricted evaluator (`core/safe_expr.py`) allows numbers, the given
  names and functions, `+ - * / **` and unary minus; anything else is rc 198. `^` in `archmexp()` now works as
  power (it failed before).
- To report upstream as a security issue.

### ODT-15: `predict` after `mean` or `bootstrap`
```stata
clear
set obs 50
gen x = rnormal()
gen y = x + rnormal()
mean y
predict yh
```
- dofile: rc 9999 `internal engine error: AttributeError: 'Estimates' object has no attribute 'terms'`
  (`estimation/postest.py`, `xb_all`). `bootstrap _b[x], reps(5): regress y x` then `predict` does the same.
- Expected in Stata 14: an ordinary error, rc 321. The `mean` postestimation page lists `estat vce`, `estimates`, `hausman`,
  `lincom`, `nlcom`, `test` and `testnl`, and no `predict` (https://www.stata.com/manuals14/rmeanpostestimation.pdf); [P] error
  gives 321 "requested action not valid after most recent estimation command" as what `predict` or `test` return
  when the action can't be performed (https://www.stata.com/manuals14/perror.pdf). Only `mean` was checked, not
  `bootstrap`.
- The session survives and keeps its data, but rc 9999 skips `capture` and ends the call.
- Status (2026-11-05): a crash is a bug whatever Stata does, since rc 9999 is dofile's own code for an escaped Python
  exception. The fix is a guard in `estimation/postest.py` raising rc 321 (the message wording is ours). Still
  reproduces after `mean` on the CPS data.
- Patched (`opendta-odt15-predict-unsupported.patch`): `predict` raises rc 321 `requested action not valid after most
  recent estimation command` when the estimation has no terms (`mean`, `bootstrap`). The message wording is ours.

### ODT-16: `color()` specs
```stata
twoway (histogram x, color(maroon%50))
twoway (histogram x, color(gs2))
```
`graphics/scheme.py:color()` returned the default palette color for any text it did not know, so these drew in
the wrong color with no error:
- `gs#`: the formula ran the wrong way, `gs0` white and `gs16` black (Stata: `gs0` black, `gs16` white). The
  table entries `gs4`, `gs8`, `gs12` were right, so only the other levels were wrong.
- `maroon%50` (opacity suffix, Stata 15+): the color was dropped.
- `navy*.5` (intensity multiplier, the Stata 14 way to lighten or darken a color): dropped.
- `none` (`fcolor(none)`, `lcolor(none)`, `mcolor(none)`): dropped, so a hollow bar or invisible line was drawn filled.
- Patched (`opendta-odt16-color-specs.patch`): `gs#` fixed; `none` returns matplotlib's transparent
  `"none"`; `%#` returns `#rrggbbaa`; `*#` mixes toward white below 1 and darkens above 1. VERIFY: the intensity
  formula is an approximation of Stata's, not checked against Stata output; a combined `navy*.5%50` is read in that order.
- Still open (not patched, the semantics or the full list are not certain):
  - four-number CMYK specs and `hsv ...`;
  - color lists such as `mcolor(red blue)`;
  - named colors Stata has that the table lacks (for example `lime`, `bluishgray`, `ltbluishgray`, `midblue`,
    `ebblue`, `ebg`, `emidblue`, `erose`, `dknavy`; from memory, check the manual before adding any);
  - an unknown color still falls back silently. Stata refuses an invalid color; doing the same here would make a
    valid-but-missing name fail outright, so wait until the name table is complete.
- `docs/replication-tests.md` said `%50` is "accepted"; since the patch the opacity is applied.
- Re-checked 2026-11-05: `gs0` is `#000000` and `gs16` `#ffffff` (the Stata manual labels gs0 black and gs16 white), `gs2`
  `#202020`; `maroon%50` is `#7b1f2a80`; `navy*.5` `#8d97ad`; `none` is `none`; `lime`, `ltbluishgray`, `midblue`, `ebblue`,
  `erose`, `dknavy` and `foo` still fall back silently. New: the named colors are the engine's own palette, not Stata's
  values. The colorstyle manual gives `navy` as RGB 26 71 111; the engine's `navy` is 27 47 91, so `navy*.5` also differs.
  Only the `gs#` levels follow Stata's definition (no RGB values were found for the other names).

### ODT-17: legend placement
```stata
twoway (scatter y x) (lfit y x), legend(pos(3))
```
- dofile: legend stays at the bottom center (`graphics/render.py`, `loc="outside lower center"`).
  `legend(order(...))`, `label()` and `off` work.
- Expected in Stata (our reading of [G-3] legend_options, not a Stata run): `pos()` is short for `position()`, a
  clock position (1 to 12; 0 is the center) giving the side or corner of the plot region the legend sits at;
  `ring(#)` sets how far out it sits (`ring(0)` is inside the plot region, larger is farther out, values are
  ordinal), and `bplacement(compass)` places a legend with `ring(0)`. The Stata 14 default is the bottom
  (`pos(6)`), which is what dofile draws; newer Stata defaults to the right. Under `by()`, location suboptions go
  inside `by()`. Minimum fix: honor `pos(3|6|9|12)` (and 1, 2, 4, 5, 7, 8, 10, 11 as corners) with the default
  `ring`; `ring(0)` (inside the plot) can wait.
- Patched (`opendta-odt17-legend-position.patch`): `position()` is read as the clock position, outside the plot
  region (12 top, 3 right, 6 bottom, 9 left; 1-2 and 10-11 are top right and top left, 4-5 and 7-8 bottom right
  and bottom left), a legend at a side defaults to one column. Not done: `ring()` (the parser stores it but it is
  ignored), `ring(0)` inside the plot region, `bplacement()`, `position(0)`.
- Re-rendered 2026-11-05: `legend(pos(3))` puts the legend on the right, `pos(12)` on top, `pos(1)` at the top right outside the
  plot, and `legend(ring(0) pos(11))` still draws it outside the plot (top left), as the entry says. Status stays `partly patched`.

### ODT-18: `ttest` with `unequal` but no `unpaired`
```stata
clear
set obs 50
gen x = _n
gen y = x + rnormal()
gen z = x + rnormal()
ttest y == z, unequal
```
- dofile: rc 0, "Paired t test". `ttest y == z, unpaired unequal` correctly gives the two-sample test with unequal variances.
- Expected in Stata: in the manual's syntax (stata.com/manuals14/rttest.pdf) `unequal` and `welch` belong to the
  `unpaired` form, and without `unpaired` the two-variable form is the paired test, so Stata should refuse the option
  rather than ignore it (the rc is not checked). Silently ignoring it matters because the user asked for Welch
  and gets a paired test.
- Evidence (2026-11-05): [R] ttest's syntax puts `unequal` and `welch` under the `unpaired` form; the paired form is
  `ttest varname1 == varname2 [if] [in] [, level(#)]`, so `level()` is the only option it allows
  (https://www.stata.com/manuals14/rttest.pdf). Expected rc 198: [P] error lists "option not allowed" under 198
  "invalid syntax" (https://www.stata.com/manuals14/perror.pdf); the exact message (likely `option unequal not
  allowed`) is not in the manuals. The Stata 14 reference logs only use `unequal` with `by()` and with
  `ttesti`, so they say nothing about the paired form. Still reproduces: "Paired t test", rc 0.
- Patched (`opendta-odt18-ttest-options.patch`): the paired and one-sample forms refuse `unequal`, `welch` and `unpaired`
  with rc 198 `option unequal not allowed`; the two-sample forms and `by()` are unchanged. VERIFY: Stata's message text.

### ODT-19: matrix subscripts of `e()`/`r()` in an expression (likely not a bug)
```stata
clear
set obs 50
gen x = _n
gen y = x + rnormal()
regress y x
display e(b)[1,1]
scalar s = e(b)[1,1]
display r(table)[1,1]
display %6.3f (r(table)[1,1])
```
- dofile: `display e(b)[1,1]` and `display r(table)[1,1]` give rc 109 `type mismatch`; `scalar s = e(b)[1,1]` and
  `display %6.3f (r(table)[1,1])` give rc 198 `invalid syntax`. Copying first works:
  `matrix T = e(b)` then `display T[1,1]`.
- Stata (2026-11-05): [P] matrix define lets scalar expressions refer to `matname[r,c]`, which is a matrix *name*. A 2010
  Statalist thread on taking an element of `e(b)` reports `local x = e(b)[1,1]` giving "invalid syntax" and
  `generate x = e(b)[1,1]` giving r(509), with the advice to copy `e(b)` into a named matrix first
  (https://www.stata.com/statalist/archive/2010-10/msg00534.html; Stata 11 era). So dofile's rc 198 probably matches
  Stata for `scalar`/`local`. Differences left: dofile says rc 109 for `display e(b)[1,1]`, and it is unchecked whether
  Stata 14 (our target) still rejects the form, or what rc `display` gives.
- An earlier version of this entry said Stata should accept these; that was read from the manual's wording and is
  not supported by the thread. Close it unless someone shows Stata 14 printing the value.
- Agent-facing: use `_b[name]` or copy the matrix first; the engine's messages name no cause.
- More evidence (2026-11-05, Stata 14 manuals): [U] 14.9 says `matname[r,c]` is for matrix and scalar expressions, and
  [P] matrix define says the subscripts tell Stata that the name is a matrix name (`el(A,i,j)` takes a matrix name,
  string literal or string variable); [U] 14 says `e(b)` and `e(V)` can be used "in any matrix expression", with
  `matrix myb = e(b)` as its example. The `e(b)[1,3]` in that chapter is only the heading `matrix list e(b)` prints.
  Nothing documents `e(b)[1,1]` as an expression. dofile already accepts `e(b)` in matrix expressions and functions
  (`colsof(e(b))`, `trace(e(V))`, `e(b)*invsym(e(V))*e(b)'`) and is more permissive than Stata for `el(e(b),1,1)`.
  So the status stays `likely not a bug`; only the rc (109 here for `display`) is unchecked.
- Return codes (documented mismatch, 2026-11-05). dofile reports the same unsupported expression with different
  codes depending on the command, because two evaluators handle it:

  | Command | dofile | Stata (Statalist 2010, Stata 11) |
  |---|---|---|
  | `local l = e(b)[1,1]` | 198 `invalid syntax` | 198 `invalid syntax` (same) |
  | `generate z = e(b)[1,1]` | 198 | 509 (matrix operators not allowed in this context) (differs) |
  | `scalar s = e(b)[1,1]` | 198 | not reported |
  | `display (e(b)[1,1])`, `display %6.3f (r(table)[1,1])` | 198 | not reported |
  | `display e(b)[1,1]`, `display r(table)[1,1]`, `display 1 + e(b)[1,1]` | 109 `type mismatch` | not reported |

  Left as it is: the form is rejected everywhere, only the code differs. If it is ever made consistent, 198 is the
  only code with evidence behind it (and 509 for `generate`).
- Re-run 2026-11-05: `display e(b)[1,1]` and `display r(table)[1,1]` give rc 109; `scalar s = e(b)[1,1]`, `local l = e(b)[1,1]`,
  `generate z = e(b)[1,1]` and `display %6.3f (r(table)[1,1])` give rc 198; `matrix T = e(b)` then `display T[1,1]`, `el(e(b),1,1)` and
  `_b[x]` work. Same as the table above; status unchanged.

### ODT-20: histogram outline ignores `lcolor()`
```stata
twoway (histogram x, fcolor(none) lcolor(navy))
```
- dofile: no bars are visible. `graphics/render.py` (`draw_layer`, kinds `bar` and `histogram`) sets the edge to the
  background color for histograms (`edge = sch["background"]`) so that narrow bins keep their fill, and never reads
  `lcolor`; with `fcolor(none)` (ODT-16) the whole bar is invisible.
- Expected in Stata: `lcolor()` and `lwidth()` set the bar outline; `fcolor(none)` gives hollow bars. Not run in Stata.
- Patched (`opendta-odt20-bar-outline.patch`): an explicit `lcolor()` sets the outline color (also for histograms of
  more than 40 bins, which had no edge), an explicit `lwidth()` its width; with neither, the background-colored edge
  stays as before. `color()` alone still does not outline. Not checked: `lpattern`, and whether Stata outlines with
  `color()` (it sets both fill and outline there).

### ODT-21: numeric axis tick steps
```stata
clear
set obs 18
gen educ = _n
gen w = educ / 3
twoway line w educ
```
- dofile: the x axis labels are `0.0 2.5 5.0 7.5 10.0 12.5 15.0 17.5 20.0`. `graphics/render.py` leaves the x axis on
  matplotlib's default `AutoLocator`, whose steps include 2.5, and its `ScalarFormatter` then adds `.0` to every label.
  The y axis of bar charts already uses `MaxNLocator(steps=[1, 2, 5, 10])` (`render.py`, near line 371).
- Expected in Stata: "nice" ticks in steps of 1, 2, 5 or 10 times a power of ten, here `5 10 15 20`, labelled `5`, `10`,
  `15`, `20`. Not run in Stata (our reading of how its default axes look), so the exact tick choice is unverified.
- Cosmetic, but it is in nearly every plot. Sketch: use the same `MaxNLocator` for numeric x and y axes.
- Evidence (2026-11-05): the Stata manual's "approximately five values are labeled and ticked on each axis by default",
  chosen by a nice-number routine (https://www.stata.com/manuals/g-3axis_label_options.pdf). dofile labels nine
  values on this axis (`0.0 ... 20.0`), so the density claim is supported; the exact Stata choice for this axis
  (`5 10 15 20`?) is still our reading.
- Patched (`opendta-odt21-axis-ticks.patch`): `_apply_axis` replaces matplotlib's default locator on a linear numeric
  axis with `MaxNLocator(nbins=5, steps=[1, 2, 5, 10])`. Only the default `AutoLocator` is replaced, so explicit
  labels, `#`-rule labels, value labels and categorical axes keep theirs. The sample axis now reads `5 10 15`. Not
  checked: how closely Stata's own tick choice agrees on other ranges (the manual only says about five).

### ODT-22: the `matrix()` pseudofunction
```stata
matrix xx = (1,2 \ 3,4)
display trace(matrix(xx))
display el(matrix(xx),2,1)
```
- dofile: both give rc 198 `invalid syntax`; `display trace(xx)` and `display el(xx,2,1)` work.
- Expected in Stata: [P] matrix define says `matrix(name)` forces the matrix-name interpretation, for when a data
  variable has the same name, and gives `local new=trace(matrix(xx))` as its example
  (https://www.stata.com/manuals14/pmatrixdefine.pdf). Not run in Stata.
- Low priority: it only matters when a variable and a matrix share a name, but do-files written for programs use it.
- Patched (`opendta-odt22-matrix-pseudofunction.patch`): `matrix(name)` in an expression is the name. It does not force the
  matrix reading when a data variable has the same name, which is what the manual's `matrix()` is for (VERIFY).
  Inside matrix functions (`trace`, `el`) the name is a matrix anyway, so those are right with a same-named variable;
  only a 1x1 matrix read as a scalar (`display matrix(one)` with a variable `one`) gives the variable's value.

### ODT-23: `capture` and the sandbox's refusals
```stata
capture type /etc/passwd     // under the dofile sandbox
display _rc
```
- dofile before the patch: the call stopped at `capture type ...` with rc 603 and `_rc` was never shown. The sandbox
  raises a Python `PermissionError`; OpenDTA's `capture` only caught its own `StataError`. (`capture use /etc/passwd` and
  `capture graph export` were fine: those commands turn the error into a `StataError` themselves.)
- Expected: `capture` catches any file error and sets `_rc` (Stata: 603 `file could not be opened`).
- Patched (`opendta-odt23-capture-sandbox-refusal.patch`): `capture` turns a `PermissionError` into `StataError(603)`.
  Only needed because of dofile's sandbox, so it is not worth reporting upstream.

### ODT-24: weights in `xtreg, fe` and `areg`
```stata
clear
set seed 12345
set obs 300
gen id = ceil(_n/10)
gen t = mod(_n-1, 10) + 1
gen x = rnormal()
gen y = 0.5*x + id/20 + rnormal()
gen w = 1 + mod(id, 5)          // constant within id
xtset id t
regress y x i.id [aweight=w]    // 0.41346
xtreg y x [aweight=w], fe       // 0.47292, the unweighted value
areg y x [aweight=w], absorb(id)  // 0.47292
```
- With `aweight` and `pweight` (weights varying within id) and `fweight`, `regress` with the dummies moves
  (0.49189, 0.49189, 0.43677) and `xtreg, fe` and `areg` stay at 0.47292.
- Cause (read in the code, 2026-11-05): `estimation/panel.py` declares `weights=("aweight", "fweight", "pweight")` for
  `cmd_xtreg` and `cmd_areg`, and `Sample` parses them into `smp.w`, but `_xtreg_fe` and `cmd_areg` never read `smp.w`:
  they demean with `_demean(y, ids, inv, counts)` and solve with unweighted cross-products. The weights are accepted and dropped.
  (Line 653 is the only use of `smp.wtype` in the file.)
- Expected in Stata (2026-11-05):
  - [R] areg: `absorb(var)` is "included in the regression as if it were specified by dummy variables", and `areg`
    takes aweights, fweights and pweights. So `areg y x [aw=w], absorb(id)` should equal `regress y x i.id [aw=w]` (the
    manual shows that equivalence only unweighted; the weighted case is an inference).
  - `xtreg, fe`, Stata 14 [XT] xtreg, syntax notes (PDF p. 4, read from the manual with `pypdf`): "aweights, fweights,
    and pweights are allowed for the fixed-effects model. ... See [U] 11.1.6 weight. Weights must be constant within
    panel." The current manual (PDF p. 7) has the same sentences. `e(wtype)` and `e(wexp)` are stored, so the weights
    are part of the fit. Statalist, 2008, Austin Nichols: "Note that -xtreg- will not allow weights that vary over time
    within panel, but -areg- will." (https://www.stata.com/statalist/archive/2008-06/msg01015.html). So dofile is wrong
    twice: it ignores constant weights, and it accepts varying ones where Stata stops with an error (the error's
    return code is not in the manual text).
- Found with Cheng and Hoekstra (2013), whose main specification is `xtreg l_homicide ... post [aweight=popwt], fe`
  (`popwt` is constant within state): `post` is 0.0694 (se 0.0559) with `xtreg, fe` and `areg`, and 0.0755 (se 0.0348)
  with `regress ... i.sid`.
- Workaround: `regress y x i.id [aweight=w], vce(cluster id)`.
- Not checked: `xtivreg`. The Stata 14
  reference logs (`tests_opendta/compat/expected/`) have no weighted `xtreg` or `areg`.
- Patched (`opendta-odt24-weighted-within-estimators.patch`, 2026-11-05): `xtreg, fe` and `areg` demean with the weighted
  group means and solve weighted least squares (OLS on sqrt(w)-scaled data), with the weights scaled as `regress` does
  (a- and pweights to the sample size, fweights as they are, N their sum). `xtreg, fe` stops with rc 101
  `weights must be constant within panel` for weights that vary within a panel; `areg` takes them. `e(wtype)` and `e(wexp)`
  are set. Checked against `regress` with the panel dummies: coefficient, standard error, N and residual df agree to 1e-8
  for a- and fweights (and the coefficient for pweights, whose variance is robust).
  VERIFY: the rc 101 and its text (a guess), the place of `wtype`/`wexp` among the e() macros, and the secondary statistics
  in the weighted `xtreg, fe` (between and overall R-squared, `sigma_u`, `corr`, the log likelihood), which are still the
  unweighted formulas.
- Patch follow-up (2026-11-05, code review):
  - `areg ..., vce(robust)` with fweights squared the weight in the robust variance (`Xa` and `e` each carry sqrt(w), so
    the score carried w and its square w^2). That is right for a- and pweights. An fweight stands for w copies of the
    row, so it needs w. The se was 0.0761 against `regress`'s 0.0487 on a test panel; it now agrees to 1e-8
    (`test_odt24_areg_robust_with_fweights`). `vce(cluster)` sums the scores first and was already right.
  - `xtreg, re` and `, be` accepted weights and dropped them, the same bug as `fe`. The manual's weight note lists
    weights per model (fe: aweights, fweights, pweights; then the pa and mle models) and lists none for re or be. So
    they now stop with rc 101 `aweights not allowed` (`test_odt24_xtreg_re_and_be_refuse_weights`). VERIFY the text and
    that Stata 14 refuses them.

### ODT-25: `Sorted by:` after reading a Stata-written file
`use castle.dta` then `describe, short` (Cheng and Hoekstra's data, `scunning1975/mixtape`) prints 48 names after
`Sorted by:` (`sid r20052 year state r20083 trend_17 trend_23 ...`, some twice).
- Cause (checked in the file and the code, 2026-11-05): the file's `<sortlist>` has 186 two-byte entries, `3, 0, 0, ...`,
  so the real key is the one variable `sid`, and then it holds 127 more nonzero entries after the first 0 (leftover bytes
  that Stata ignores; the list ends at the first 0). `io/dta.py:314` reads `[names[k - 1] for k in sort_idx if 0 < k <= K]`
  and so keeps every entry in range, 48 of them. A file that dofile writes has zeros after the list and reads back fine.
- Fix: stop at the first 0 (`itertools.takewhile(lambda k: k != 0, sort_idx)`). One line, not patched yet.
- Not checked: whether `by:` or `merge` use the list (it looks cosmetic), and the wording of the .dta format
  specification ([P] File formats .dta) on the terminator.
- Patched (`opendta-odt25-dta-sort-list.patch`, 2026-11-05): the reader stops at the first 0 (`_sort_keys` in `io/dta.py`,
  used for the old and the 117+ formats). `castle.dta` now reports `Sorted by: sid`.

### ODT-26: `mkdir`, `rmdir`, `copy`, `dir` delete backslashes from an unquoted path
`mkdir C:\proj\out` makes a folder named `C:projout`. `commands/datautil.py` splits the arguments with
`shlex.split(body, posix=True)`, which treats `\` as an escape character as a Unix shell does, so each backslash is
removed.
- The problem is not that a backslash isn't a separator on macOS and Linux: there it is an ordinary character in a
  file name. The problem is that the text is changed, and inconsistently:
  - `use C:\proj\d` and `save C:\proj\d` keep the backslashes; only these four commands drop them.
  - Quoting changes the name: `mkdir "C:\proj\out"` keeps them (inside double quotes POSIX `shlex` keeps a
    backslash before an ordinary letter), and `mkdir "C:\\x"` turns `\\` into `\`.
- Expected in Stata (from the documentation, not a Stata run): the command gets the text as written. Windows
  treats `\` as a separator. On macOS and Linux it is a literal character, so the folder is named `C:\proj\out`.
  Stata's only backslash rule is in macro expansion (`\$`, `` \` ``), before the command sees its arguments.
- Impact: small in the CLI (one junk name instead of another). It matters for the web demo, because the path shim
  needs the original text to map a Windows path, and the separators are gone before it sees the path. Do-files
  written on Windows use unquoted backslash paths.
- Fix: split with `posix=False` and strip the outer quotes, or split on whitespace outside quotes as the other file
  commands do.

### ODT-27: `save using name` is not a syntax error
`save using my_new_data, replace` prints `file using my_new_data.dta saved` and creates `using my_new_data.dta`
(with a space in the name). `save a b, replace` creates `a b.dta`. `commands/files.py` takes all the text before the
comma as the file name.
- Expected in Stata: **assumed, not checked.** `save` is documented as `save [filename] [, options]`, with no `using`
  clause (`using` belongs to `use`, `merge`, `append`, `outfile`, ...), so we assume `save using x` is a syntax error
  (probably rc 198). We do not know the exact code or message, or whether Stata accepts unquoted spaces in a `save`
  file name at all (which decides whether `save a b` is also an error).
- Evidence in the repo: none. No Stata 14 reference log runs `save using` or `save` with a space in the name; every
  `save` in `tests_opendta/compat/do/` is plain (`save odta_u, replace`). `known_differences.txt` doesn't list it.
- Not evidence about Stata, from the user (2026-11-06): stats.camp accepts `save using x, replace` and writes
  `x.dta`. It is a closed-source web demo of a Stata reimplementation written in Rust; nothing else is known (which
  Stata version it targets, how it was tested). Another emulator's choice says nothing about what Stata does, so it
  does not change the assumption above. It only shows that one other implementation takes `using` there, and that
  dofile's output differs from it.
- To verify: run `save using x, replace` and `save a b, replace` in Stata 14, then add them to
  `gerar_esperados.do` as a case.
- Fix (once checked): if Stata refuses `using` (the working assumption), reject that name with a syntax error; if it
  turns out to accept it, drop a leading `using` word so `save using x` writes `x.dta`. Likewise decide what to do
  with unquoted names that have spaces (`save a b`). A patch in `scripts/patches/`, not an edit of the vendored engine.

### ODT-28: Python errors that escape a command give rc 9999, not a Stata error
A command that lets a Python exception out ends the whole program with rc 9999 `internal engine error` and a traceback,
and `capture` does not catch it (it catches only `StataError`, `lang/interpreter.py`). Two kinds are known and patched:
an `OSError` from a file command and a `MemoryError` when memory runs out.

**A missing folder or a directory in place of a file:**
```stata
log using hi/hi, replace      // no folder hi/
```
prints `internal engine error: FileNotFoundError: [Errno 2] No such file or directory: 'hi/hi.smcl'` with a Python
traceback in the log, rc 9999. `capture log using hi/hi, replace` does not catch it either.
- Cause: `log`, `cmdlog`, `outfile`, `file open`, `copy` (destination) and `bcal create` have no `try/except OSError`
  around their `open()`. And `use`, `append`, `type`, `infile`, `file open ... read`, `copy` (source) check
  `path.exists()` and then fail inside `open()` when the path is a directory (`IsADirectoryError`). The commands that
  did it right each carry their own `except OSError` (`save`, `export delimited`/`excel`, `outsheet`, `postfile`,
  `putexcel`, `graph save`/`export`, `erase` 693, `mkdir`/`rmdir` 693, `cd` 170).
- Found 2026-11-07 (web demo), then probed 48 file commands with a missing folder and with a directory; the list
  above is what gave 9999. Not covered by the probe: commands outside those 48, permission errors that are not the
  sandbox's, and the rc of `merge`/`cross` with a directory (459 and 110, not looked at).
- Expected in Stata: **assumed, not checked.** r(603), `file hi/hi.smcl could not be opened`, as `save` already does
  here (the existing handlers in this engine raise 603 with `(strerror)`). For a directory in place of a file we
  assume 603 too.

**Out of memory:** when numpy cannot allocate an array, `MemoryError` (numpy's `Unable to allocate 763. MiB ...`)
escapes the command the same way. Found 2026-11-07 in the web demo, whose WebAssembly heap stops at 4 GB: with 100
million observations, `gen double x = 1` and `gen double y = x` worked (heap 3.6 GB) and `gen double z = x + y` gave
rc 9999. The Pyodide runtime survived and the next command ran. It happens on CPython too, when the machine runs out.
- Expected in Stata: **assumed, not checked.** r(909), `op. sys. refuses to provide memory`, which `capture` catches.

**The data is not rolled back.** A command that fails partway leaves what it already changed. With a `MemoryError`
injected at the second variable, `recode a b (1=9)` leaves `a` recoded to 9 and `b` unchanged, and `mvdecode a b, mv(1)`
leaves `a` set to missing; both then fail. Any error raised inside a command (a `StataError` too) can do this, since
OpenDTA's commands change the data as they go and nothing restores it. The patch below changes only the error code, so
r(603) or r(909) does not mean the data is as it was.
- Expected in Stata: **not checked.** Built-in commands are thought to leave the data unchanged when they fail, but
  that has not been tested, and ado-file commands may differ.
- Not patched: a fix needs each command to work on a copy, or a snapshot of the data before every command, and the
  snapshot would double memory use at the point where memory is short.

**The patch** (`opendta-odt28-python-errors-as-stata.patch`): `commands/registry.py` wraps every registered command, so an
  `OSError` that escapes it becomes `StataError(603, "file <name> could not be opened (<strerror>)")` and a
  `MemoryError` becomes `StataError(909, "op. sys. refuses to provide memory")`; `capture` then catches them. A
  command's own `StataError` (erase 693, cd 170, ...) is untouched. `PermissionError` is left alone: the
  dofile sandbox's refusals use it (ODT-23: `capture` converts it; `Engine.run` turns an uncaught one into 603). The
  patch goes in the registry, not in the dispatcher, because PATCH-2 edits the dispatcher's `spec.fn` lines. An error
  outside a command (macro expansion, the interpreter itself) still gives rc 9999.
- Tests: `tests/test_engine.py::test_odt28_*` (13 commands, `capture`, the commands that keep their own codes, and a
  `MemoryError` injected into `replace`, with and without `capture`).
- Related: ODT-23 is the same family (an `OSError` escaping a command) for the sandbox's `PermissionError`. It stays
  separate: it only exists because of the sandbox and is not for upstream, while this one is an OpenDTA bug.
- Side finds: `estimates save` and `estimates use` are a missing feature (GAP-5). `export excel` to a bad path prints a
  stray `ValueError: I/O operation on closed file` from openpyxl to stderr, although the command returns 603 (not an entry).

### GAP-2: `estat firststage`
`estat firststage` (first-stage F and partial R² after `ivregress`) returns rc 321 "subcommand estat
firststage is unrecognized". It's the standard weak-instrument check, so it's worth implementing upstream.
- Workaround: run the first stage with `regress endog instruments exog`, then `test instruments`.

### ODT-30: Newton steps from a nearly singular numerical Hessian (false convergence at a boundary; path depends on rounding)
```stata
* compat 1907_models: data from the lines before it in tests_opendta/compat/do/1907_models.do
gnbreg cnt x1 x2, lnalpha(x3)
```
ends on CPython at log likelihood -878.310297 after 7 iterations, with `lnalpha:_cons` = -22.0 (alpha about 1e-10).
That is the Poisson log likelihood of the same mean equation to every digit printed (-878.3102973): the fit has gone to the
boundary alpha = 0.
- Cause, as far as it was traced. `ml.maximize` takes the step `-solve(H, g)` with `H` from `models2.num_hess` (central
  differences of the analytic gradient, h = 5e-3 scale, Richardson). At that boundary `H` is nearly singular: eig(-H) is
  6.8e-4, 2.3e-3 and then 620 to 1300 (condition number 1.9e6). A difference of 3e-7 in `H` (from the last bits of the
  gradient, which uses `lngamma` and `digamma`) moves the step by 1.4e-4, and the path goes elsewhere. The score for
  `lnalpha` is proportional to alpha, so it vanishes at alpha = 0 and the convergence test (`dp < tol or dv < ltol`, and
  `nr < nrtol`, and a concave `H`) accepts a point where the likelihood can still be raised.
- The perturbation experiment (CPython, 8 seeds each, analytic derivatives multiplied by `1 + r u`, u uniform(-1,1)):
  r = 0: -878.3103 converged, 8 of 8. r = 1e-13: one run does not converge (-878.3053). r = 1e-11: one run converges to
  **-878.1424**, one does not converge (-878.2737). r = 1e-9: five different outcomes in 8 runs. So the answer at the
  boundary is not the maximum, and which answer a platform gives is not stable. Pyodide (numpy 2.4.6, other libm and
  LAPACK) ends at -878.2943 after 300 iterations without converging, and was still creeping after 3000.
- Same family: the constant-only model that `gnbreg` fits for `ll_0` (separately, from the full model's values) sits in
  the non-concave branch on both platforms: ll -959.397 on CPython, -957.390 in Pyodide, against -952.7455 in Stata's
  log. The non-concave step adds `lam * I` with `lam = 1.1 * max eig(H) + 1e-6` (the code says `VERIFY`), which makes the
  step almost entirely along the one flat eigenvector (length about 59 in 1001_mixed's `covariance(unstructured)` fit,
  where it was first seen): a nearly singular matrix again.
- Found 2026-11-07, comparing e() and r() of the 98 comparison programs between CPython and Pyodide. Other fits in the
  same comparison that end in different places on the two platforms with the same log likelihood to 8 or more digits
  (1901 `streg`, 1907 `tnbreg` and `zinb`, 1905 `xtfrontier`) probably belong here too; not traced.
- Expected in Stata: **not known.** Stata's reference log also ends at -878.31024 (after 25 iterations, many of them
  "(backed up)"), so the boundary answer agrees with Stata, and that is why the case passes. Whether Stata's own path is
  as sensitive cannot be seen from one log. Stata fits the constant-only model in 4 iterations to -952.7455; ours does
  not reach it. Both are for someone with Stata to check.
- Fix to try, not done: a step rule that copes with a nearly singular `H` (Levenberg-Marquardt or a trust region, or the
  analytic Hessian where the likelihood has one), and a convergence test that does not accept a point because a score is
  small only through a parameter at its boundary. Either changes the iteration logs, which the Stata 14 comparison checks
  line by line (with known-difference rules for 1907), so it needs the comparison run again. Cross-platform note: the
  differences between platforms here are of the size of ordinary libm differences, so the same would be expected from
  CPython on Linux against macOS; not tested (no Linux machine; the Docker daemon was not running).

### ODT-31: overflow warnings in delta-method intervals (left as is)
`poe slow` prints three `RuntimeWarning: overflow encountered in exp` in pytest's warnings summary:
`mleq.py:157` in `1907_models` and `1918_models3`, `models2.py:739` in `1918_models3`.
- Both lines compute `exp(b - c * se)` and `exp(b + c * se)` for an interval; where `se` is large the upper end overflows
  to `inf`. Neither site is wrapped in `np.errstate`, unlike the engine's other numpy-heavy modules (`core/ordination.py`,
  `core/survival.py`, `core/rng.py`).
- Not caused by dofile: both files are unmodified upstream code at the pinned commit (`opendta-odt12-nbreg-boundary.patch`
  edits the branch above `models2.py:739`, not the `exp` line). OpenDTA's own suite (`tests_opendta/`, run 2026-11-07:
  1021 passed, 13 skipped) prints the `mleq.py:157` warning too, in `test_nb1_nbreg_and_tnbreg`. The `models2.py:739` one
  was not checked upstream, because 1918_models3 runs only through `compare.py`. The same run printed `slogdet` and
  `normalden` overflow warnings that are also not ours.
- Not patched on purpose: the output is right (both Stata 14 comparison cases pass, `inf` included) and the warning only
  goes to Python's warnings (stderr), not into the Stata log (checked only in pytest, not in the CLI or MCP server). A patch would add two `np.errstate(over="ignore")` wrappers (as in
  `core/ordination.py`) in a new `scripts/patches/` file, plus a re-vendor, for no change in results.
- Revisit if the warnings ever reach a user (a caller that turns warnings into errors) or if a result stops matching.

### ODT-32: a missing optional package is rc 610 "file not Stata format", with `pip install` advice
`io/statpkg.py` and `io/dta.py` raise `StataError(610, ...)` when `pyreadstat` or `pandas` cannot be imported, with
messages such as `export sasxport requires the pandas package (pip install pandas)`. 610 is the code Stata gives for a
file that is not in its format, and OpenDTA uses it for that too (`file not SAS XPORT format`, `file not Stata format`),
so one number means "the file is bad" and "this build lacks a package". The web demo ships `pyreadstat` without pandas
(`docs/pyodide-snapshot.md`, "Packages added"), so `export sasxport` there ends with rc 610 and tells a browser user to
`pip install pandas`.
- Expected in Stata: **no equivalent; a design choice.** Stata always has all of its commands. The closest thing in dofile is
  the sandbox's refusal of a command (`shell`, `cd`, ...): rc 199 `command ... is disabled in the dofile sandbox`
  (`sandbox.py`). The patch uses 199 for "not available in this build" and a message without install advice.
- Patched (`scripts/patches/opendta-odt32-missing-package-errors.patch`): three sites become
  `StataError(199, "... is not available: it needs the <package> package, which is not installed")`:
  `statpkg.pyreadstat()` (`import sasxport`/`sas`/`spss`), `statpkg.write_xport` (pandas), `dta._read_legacy`.
- Not patched: the `xlrd` and `xlwt` errors in `io/excel.py` (rc 603, `... requires the xlrd package (pip install xlrd)`;
  603 is "file could not be opened", also a stretch) because both are core dependencies of dofile since 2026-11-09, so
  they cannot occur; and the `pyodbc` one in `commands/datasets.py` (rc 198, ODBC needs a driver as well, not only a package).
  `write_formats_xpf` imports pandas without a guard, but `write_xport` runs first and refuses.
- A side finding: `_read_legacy`'s docstring says formats up to 115 (Stata 12 and earlier) go through ReadStat, but
  `read_dta` sends 113 to 115 to its own reader (`_read_old`); ReadStat gets only what is older than 113 (Stata 7 and
  earlier) or a release it does not know. `pyproject.toml`'s `legacy-dta` comment had the same mistake, corrected.
- Tests: `tests/test_engine.py::test_odt32_missing_optional_package_is_rc_199_without_pip_advice` (hides each package with
  `sys.modules[name] = None`), and the web demo's e2e test (`export sasxport` without pandas, in four browsers).

### GAP-3: other `estat` subcommands after `ivregress`
`estat endogenous` and `estat overid` return rc 321 `subcommand ... is unrecognized`, as `estat firststage` does (GAP-2).
A student running Card (1995) or any IV paper reaches for all three. (`estat overid` is an error in Stata for an
exactly identified model, so test it with two instruments.)

### GAP-4: `lpoly` and `lpolyci` as twoway plot types
`twoway (lpolyci y x if x<0, degree(1) bwidth(.1)) (lpolyci y x if x>=0, ...)` stops with rc 198 `lpolyci is not a twoway
plot type`; `lpoly` gives the same. The standalone `lpoly y x, degree(1) bwidth(.1) ci` runs and draws a graph. Stata documents both as twoway plot
types (not checked in a Stata 14 log), and a regression-discontinuity plot (a fit on each side of a cutoff) needs them.
- Workaround: `lpoly ..., nograph generate(...) at(...)` for each side, then `twoway line` on the saved values.
- Also seen in the same run: the `ci` option's band wasn't visible at bandwidth 0.1 with 5,000 points; not checked
  whether the band was drawn.

### GAP-5: `estimates` subcommands
`cmd_estimates` (`estimation/postest.py`) implements `store`, `restore`, `dir`, `drop`, `clear`, `replay` and `table`.
Any other word falls to the last line, `raise StataError(198, f"{sub}: unknown subcommand")   # VERIFY`, so
`estimates save m1, replace` gives rc 198 `save: unknown subcommand`. Run on 2026-11-07 with two stored models.
- Missing, from memory of Stata 14's `estimates` (not checked in a Stata 14 log or run): `save` and `use` (an estimates
  file), `describe using`, `stats` (AIC and BIC of stored models), `for` (run a command with a stored model active),
  `notes`, `title` and `query`. `esample`, `selected` and `change` fail the same way; we don't know whether they exist in Stata 14,
  so they are not counted.
- Impact: the error reads like a typo, not "not implemented". `save`/`use` matter most: the usual way to keep fits
  across sessions, and in the web demo across a page reload.
- Not a quick fix for `save`/`use`: Stata's `.ster` format is its own, so dofile would need its own file format (as for
  `.gph`), and real `.ster` files would not load. `stats`, `for`, `notes`, `title`, `query` work on the stored
  snapshots in `_stored_estimates`, with no file format.
- A cheap step: make the unknown-subcommand message say it is not implemented for the subcommands Stata has.
- Not covered by any test, and no xfail.

### GAP-6: help pages for language topics
OpenDTA's `help` (`commands/helpcmd.py`, 173 pages in `help/`, written in its own words) has a page for all 515
commands in the registry, but not for the language around them: `help foreach` stops with rc 111 `help for foreach not
found`, and so do `if`, `in`, `forvalues`, `while`, `weights` and `varlist`. (`local`, `global`, `program`, `by`,
`quietly`, `capture`, `missing` and `functions` have pages.) Checked 2026-11-08 with `find_help()` on each topic.
- Impact: these are what a new user looks up first. The web demo's Help panel will show "no help page for this yet"
  instead of an error; the MCP server and CLI print the rc 111 line.
- A side note, not a bug: the pages' examples use variable names from Stata's example datasets
  (`regress price mpg weight`), which dofile does not ship, so they don't run as written.

### GAP-1: community commands
`reghdfe`, `esttab` and `outreg2` are SSC packages, not part of Stata, and OpenDTA doesn't implement them. Not
bugs; listed so the xfails have a home. Built-in alternatives: `areg`/`xtreg, fe` for one fixed effect,
`estimates table` for tables.

### PATCH-1: `r(table)` (dofile's own patch)
`scripts/patches/opendta-patch1-r-table.patch` gives OpenDTA Stata's `r(table)` (rows `b se t|z pvalue ll ul df crit
eform`, one column per coefficient):
- Every estimation table sets it and replaces r(), as Stata's r-class table helper does. `mean`, `proportion`,
  `total` and `ratio` set it too; `proportion`'s `ll`/`ul` are the logit-scale interval its table shows.
- When the table shows the current model, it's built from `e(b)`/`e(V)` with e(b)'s columns: equation names,
  base and omitted terms (b 0, rest missing), e(b)'s own ancillary parameters (`lnalpha`, `cut1`, `sigma`), not
  the transformed ones shown (`alpha`, `rho`). Other tables (`lincom`, `contrast`) use the displayed rows, and
  those commands set their own r() afterwards.
- New estimates start with an empty r(), so a previous model's `r(table)` can't pass as theirs. Kept: a table
  the same command drew before posting (`xtlogit`, `gmm`, ...; rebuilt with e(b)'s names, tracked by a
  per-command counter in `Interpreter.execute`) and the r() of `margins`/`nlcom, post`.
- That is the whole guarantee: a *new* estimation never inherits an earlier `r(table)`. Otherwise r() is Stata's (not
  run in Stata for `estimates restore`): `estimates restore`, `clear` and failed commands leave it alone, so an older
  `r(table)` can stay while `e()` is another model's. `results.r_changed` tells an agent when that is the case.

Tests: `tests/test_engine.py::test_r_table_*` and `::test_new_estimates_drop_a_stale_r_table`.

| # | Problem | Status |
|---|---|---|
| 1 | Leftover r() values beside `r(table)` (`test` then `regress`) | fixed |
| 2 | Stale `r(table)` from the previous model | fixed, except e-class commands that skip `post()` (`anova`, mv commands, Mata's `moptimize`) |
| 3 | No `r(table)` after `mean`, `proportion`, `total`, `ratio` | fixed |
| 4 | Missing equation names (`logit`, `probit`, `poisson`, `glm`) | fixed |
| 5 | Wrong columns with ancillary parameters (`tobit`, `nbreg`, `ologit`, `heckman`) | fixed |
| 6 | Not checked against real Stata: `eform` (which columns, `se` scale, base levels), `df`/`crit` for z vs t, constrained parameters, whether `r(level)` is also set, `proportion`'s `ll`/`ul` | open: needs Stata output |

If OpenDTA adds `r(table)` itself, drop the patch.

Research (2026-11-04):
- Survey on the Card data: `r(table)` has e(b)'s columns, and its `b` row equals e(b) (exp(b) under `eform`),
  for `regress`, `logit` (and `, or`), `probit`, `poisson` (and `, irr`), `glm`, `nbreg`, `tobit`, `ologit`,
  `oprobit`, `mlogit`, `heckman`, `ivregress`, `areg`, `qreg`, `sureg`, `xtreg, fe`, `xtpoisson, fe`, `mean`,
  `proportion`, `total`, `ratio`. Before the fixes, 10 of these had wrong or missing columns.
- Stata 14 evidence: `logit y x` labels e(V) `y:x y:_cons` (`0514_fweight_robust.log`), so equation names belong
  on ML models; `lincom` leaves no `r(table)` (`0504_posestimacao.log`). That r(table) follows e(b)'s columns is
  Stata's documented behavior, not checked in a log.
- stats.camp, a separate Stata-syntax engine (WebAssembly; not Stata, not OpenDTA), on a probe built from
  `mod()`: same estimates, and only `r(table)` in r() after `summarize` then `regress`. It has `r(table)` after
  `mean`; its `logit` e(b) has no equation names, unlike Stata 14. It prints newer-Stata text, so it isn't a
  Stata 14 reference.

### PATCH-2: Break at safe points (dofile's own patch)
- Found 2026-11-05 (code review): the worker's SIGINT raised `KeyboardInterrupt` at whatever Python line was running.
  `append using t` on 4 million rows with a string column, interrupted by a timeout, returned rc 1 ("the session keeps
  its data"). The next `summarize x` then failed with rc 9999, `operands could not be broadcast together with shapes
  (4000000,) (8000000,)`: some columns had been extended and others not. The engine changes data in many places (whole
  arrays replaced, written in place, the variable list edited, the dataset swapped), so a command can't be rolled back
  after the fact.
- Patched (`opendta-patch2-safe-break.patch`): the SIGINT handler calls `core/brk.request()`, which only sets a flag.
  The interpreter takes the Break before each command and each loop pass (`brk.at_command`). It skips that check inside
  another engine command and inside `by`, because stopping there would leave that command half done. `do`, `run` and
  `include` don't count as commands for this, since their lines are commands of their own. Computations that leave the
  data alone, or restore it in a `finally`, take it at once (`brk.check`): `ml.maximize`'s iterations,
  `bootstrap`/`permute`/`jackknife` replications, Mata `for`/`while`/`do` loops, and `sleep` (now in 50 ms steps).
  One long command with no safe point runs on. If it hasn't finished within the worker's 5 s grace, the child is
  killed (rc 9998, data lost) instead of being stopped half done.
- Not covered: `simulate` (no `finally` restores the data, so its replications aren't safe points), `statsby`,
  `rolling`, and optimizers outside `ml.maximize` (scipy's): these run to the end or hit the 5 s fallback.
- Test: `tests/test_break.py` requests the Break at the k-th engine line executed (`sys.settrace`) for many k across
  `append`, `sort`, `expand`, `bysort: replace`, `merge`, `drop`, `collapse`. The data must equal the state after a
  whole number of commands. Raising `KeyboardInterrupt` at the same points instead (the old behavior) left the data
  half changed at 7 of 60.

### PATCH-3: one hook for user file paths (dofile's own patch)
- Added 2026-11-06 for the web demo's path shim ([phase2-plan.md](phase2-plan.md), decision 2). OpenDTA has no
  single place that turns a file name into a path: about 25 sites in 18 files build one with `Path(t).expanduser()`.
- The patch adds `core/userpath.py` (`mapper`, `user_path(p)`) and calls `user_path` at each site, after the
  default extension (`.dta`, `.csv`, `.do`, ...) is added, so the mapper can look for the file that will really be
  opened. Sites: `use`/`save`/`append`/`merge` and other `using` files (`dta_path`), `type`, `erase`, delimited, Excel,
  `infile`/`infix`, `putexcel`, `mkdir`/`rmdir`/`copy`/`dir` (`datautil._path`), `log`/`cmdlog`, `describe using`,
  `outfile`, a `saving()` file, `do`/`run`, `confirm file`, `graph export`/`save`/`use`, `file open`, the `dir`
  macro function, SAS/SPSS import, `irf`, `bcal create`, `view`.
- Not hooked: `cd` (dofile replaces the command when the shim is on), `adopath`/`sysdir`, `program ..., plugin`,
  console hints.
- With the hook unset (the CLI and MCP server) the engine behaves as before: the full suite and the Stata 14
  comparison pass unchanged.
- Not for upstream: it exists only for dofile's browser host. `tests/test_pathshim.py` runs each file command with a
  foreign path, and fails if a new `expanduser` site appears after a re-vendor.

### PATCH-4: `np.repeat` counts as `intp` (dofile's own patch, for the WebAssembly engine)
`expand` and `stsplit` in WebAssembly Python (Pyodide 314, numpy 2.4.6: `np.dtype(np.intp)` is `int32`, `sys.maxsize` is
2147483647) stop with
`TypeError: Cannot cast array data from dtype('int64') to dtype('int32') according to the rule 'safe'`, raised from
`numpy/_core/fromnumeric.py` `repeat`. Not a Stata question: both work on 64-bit CPython, where `tests_opendta/compat`
passes. WebAssembly (wasm32) has 32-bit pointers and sizes, so numpy's index type `intp` is 32 bits; 64-bit integer data
is unaffected. Any other 32-bit Python would fail the same way, but nothing else dofile supports is 32-bit, so this is
kept as a dofile patch for the browser demo, not sent upstream.
- Cause: `np.repeat(a, repeats)` needs `repeats` to convert to `intp` with the "safe" rule, and int64 to int32 is not safe.
- The patch (`opendta-patch4-intp-counts.patch`, two lines, vendored 2026-11-07):
  - `commands/collapse.py` (`cmd_expand`): `copies = ...astype(np.intp)` instead of `np.int64`;
  - `commands/stdata.py` (`cmd_stsplit`): `reps = np.ones(n, dtype=np.intp)` instead of `np.int64`. Its later
    `reps[rows] = np.bincount(...)` assigns into that array, so both `np.repeat` calls on `reps` are covered.
  On 64-bit `intp` is `int64`, so nothing changes there. Counts above 2^31 cannot exist in a 4 GiB address space.
- Found 2026-11-07: the 98 Stata 14 comparison cases run inside Pyodide, with the repo's own `compare.py` and
  known-difference rules (`web/scripts/check-snapshot.mjs`, normal boot and snapshot start gave the same results).
  Eleven cases fail on this, each at its first `expand` or `stsplit`: `expand` in 0304_collapse, 1001_mixed, 1002_melogit,
  1402_kappa_roc, 1601_epidemiology, 1801_programming, 1902_multilevel, 1908_models2, 1909_other_suites and
  1916_multilevel; `stsplit` in 1901_survival. Because each stops there, the rest of those cases has not been
  compared at all.
- **Other int64 sites, checked 2026-11-07: none else is affected.** Probing numpy 2.4.6 in Pyodide with an int64 array
  showed that only five calls refuse it: `np.repeat` with an array of counts, `np.put`, `np.searchsorted(sorter=...)`,
  `np.choose` and `ufunc.reduceat` (indices). These accept it: fancy indexing and assignment, `np.take`,
  `np.bincount`, `np.add.at`, `np.delete`, `np.insert`, `np.split`, `np.unique(return_inverse=True)`, `np.lexsort`,
  `np.tile`, `reshape`, `np.arange`, `np.full`, `np.unravel_index`, `np.ravel_multi_index`, `np.take_along_axis`
  and `np.roll`. Against the engine's 96 `int64` uses: the only `np.repeat` calls with an array of counts are the two
  patched sites, `lang/vexpr.py:68-69`, `commands/egen.py:59` and `commands/{roc,summarize,kappa}.py` (counts built from
  `flatnonzero`, `bincount`, `np.diff` or `astype(int)`, all `intp`, so they pass). The `reduceat` calls
  (`core/panelquad.py:48`, `estimation/mlcmd.py:872`) take indices from `cumsum` of a `bincount`, also `intp`. The engine
  never calls `np.put`, `np.choose` or `sorter=`. Not covered: calls inside scipy and statsmodels-style code that
  receive an engine int64 array, and numpy functions not in the probe. The 11 cases above are the real test.
- **Run in Pyodide 2026-11-07, one process per case:** all 11 pass. Five (0304, 1002, 1402, 1801, 1909) with PATCH-4 alone.
  The other six (1001, 1601, 1901, 1902, 1908, 1916) got past `expand` and then did not finish in 600 s because of a second
  problem, `numpy.linalg` returning NaN instead of raising `LinAlgError` in Pyodide; with `src/dofile/linalgshim.py` they
  pass (`phase2-plan.md`, "Open investigation"). The "nothing else is affected" finding above was about the int64 problem
  only; it did not cover this one.
- Related: the web demo's other gaps found in the same run were the optional packages `xlwt` (`.xls` output) and
  `pyreadstat` (SAS transport files, pre-Stata-13 `.dta`), which are not OpenDTA bugs. Both are installed in the page since
  2026-11-09; see `phase2-plan.md`, "Known gaps in the browser engine".
