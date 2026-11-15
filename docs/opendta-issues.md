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
| ODT-16 | `color()` specs: `gs#` inverted; `none`, `*#` intensity and `%#` opacity silently fell back to the default color; CMYK/`hsv`, color lists and some named colors still unhandled | `::test_odt16_*` | partly patched |
| ODT-17 | `legend(pos(#))` ignored: the legend is always at the bottom center | `::test_odt17_legend_position` | partly patched |
| ODT-18 | `ttest a == b, unequal` without `unpaired` runs a paired test (prints "Paired t test") instead of refusing | `::test_odt18_ttest_options_of_the_paired_and_one_sample_forms` | patched |
| ODT-19 | `e(b)[1,1]`-style subscripts in an expression fail with rc 109 or 198 depending on the command; Stata 11 also rejected the form | found 2026-11-05, no test | likely not a bug |
| ODT-20 | `histogram`/`bar` outline ignores `lcolor()`/`lwidth()`, so `fcolor(none) lcolor(navy)` draws nothing | `::test_odt20_histogram_outline` | patched |
| ODT-21 | numeric axis ticks step by 2.5 (`0.0 2.5 5.0 ... 20.0`, with `.0` labels) where Stata uses 1/2/5/10 steps (`5 10 15 20`) | `::test_odt21_default_axis_ticks_are_nice_numbers` | patched |
| ODT-22 | the `matrix(name)` pseudofunction in expressions gives rc 198 (`trace(matrix(xx))`) | `::test_odt22_matrix_pseudofunction` | patched |
| ODT-23 | `capture` does not catch the sandbox's `PermissionError` (`type`, ...): the call stops with rc 603 | `tests/test_sandbox.py::test_capture_catches_a_sandbox_refusal_like_any_file_error` | patched |
| ODT-24 | `xtreg ..., fe|re|be` and `areg ..., absorb()` ignore `[aweight=]`, `[pweight=]` and `[fweight=]`: the coefficient is the unweighted one | `tests/test_engine.py::test_odt24_*` | patched |
| ODT-25 | `describe` prints a long wrong `Sorted by:` list for a Stata-written file whose sort list is one variable | found 2026-11-05 (castle.dta); `tests/test_engine.py::test_odt25_the_sort_list_ends_at_the_first_zero` rebuilds the bytes | patched |
| ODT-26 | `mkdir`, `rmdir`, `copy` and `dir` delete the backslashes of an unquoted path (`shlex` in POSIX mode) | found 2026-11-06 (path shim tests) | unverified |
| ODT-27 | `save using name, replace` writes `using name.dta`; Stata presumably refuses it (assumed) | found 2026-11-06 (web demo); not checked against Stata | unverified |
| ODT-28 | Python errors escaping a command (`OSError` for a missing folder or a directory, `MemoryError`) give uncatchable rc 9999 instead of r(603)/r(909); a failed command leaves the data partly changed | found 2026-11-07 (web demo); `tests/test_engine.py::test_odt28_*`; expected codes assumed, not checked against Stata | patched (the partly changed data is not) |
| ODT-29 | numpy `RuntimeWarning: overflow encountered in exp` in delta-method intervals (`mleq.py:157`, `models2.py:739`); results `inf`, as in Stata's logs. Details under ODT-31, the same issue | `poe slow`: `test_matches_stata14_reference_log[1907_models]` and `[1918_models3]`; `tests_opendta/tests/test_models_block_c.py::test_nb1_nbreg_and_tnbreg` (`mleq.py:157` only); no test of our own | left as is |
| ODT-30 | the ML optimizer's Newton steps from a nearly singular numerical Hessian: `gnbreg` in compat 1907 falsely converges at alpha = 0, and the path depends on rounding | found 2026-11-07 comparing CPython with Pyodide (`web/scripts/compare_numeric.py`); perturbation experiment in `browser-engine.md`, "`gnbreg` in 1907_models"; no test | unverified |
| ODT-32 | a missing optional package (pyreadstat, pandas) gave rc 610 "file not Stata format" with `pip install` advice | found 2026-11-09 (the web demo ships without pandas); `tests/test_engine.py::test_odt32_*`, `web/e2e/engine.spec.ts` | patched |
| ODT-33 | the unclosed-block hint names OpenDTA's Command window and Shift+Enter, which dofile does not have | `core/hints/programming.py` `_unclosed_block` (English and Portuguese); found 2026-11-11 (the web demo's command line), no test | left as is |
| ODT-34 | a do-file starting with a UTF-8 BOM fails on its first line with r(198) (nested `do`, `dofile run`) | found 2026-11-11 (the web demo's Save, which now drops a do-file's BOM); `web/e2e/editor.spec.ts` (a nested `do` of a BOM do-file, r(198), in four browsers) | unverified |
| GAP-1 | community commands `reghdfe`, `esttab`, `outreg2` don't exist (not bugs) | corpus `hdfe_b_x1`, probes `p06_esttab.do`, `p07_outreg2.do` (xfail) | known |
| GAP-2 | `estat firststage` after `ivregress` is not implemented (rc 321) | found 2026-11-04 (Card 1995 replication), no test | known |
| GAP-3 | `estat endogenous` and `estat overid` after `ivregress` are not implemented (rc 321), like GAP-2's `estat firststage` | found 2026-11-05, no test | known |
| GAP-4 | `twoway lpoly` and `twoway lpolyci` are not plot types (rc 198 `lpoly is not a twoway plot type`); standalone `lpoly` works | found 2026-11-05 (Lee 2008 RD replication), no test | known |
| GAP-5 | `estimates` has only `store`, `restore`, `dir`, `drop`, `clear`, `replay` and `table`; `save`, `use`, `describe`, `stats`, `for`, `notes`, `title` and `query` give rc 198 `<sub>: unknown subcommand` | found 2026-11-07 (checking ODT-28's side find), no test | known |
| GAP-6 | `help` has no page for the language topics `if`, `in`, `foreach`, `forvalues`, `while`, `weights`, `varlist` (rc 111 `help for foreach not found`); every command has one | found 2026-11-08 (web demo design: the Help panel), no test | known |
| PATCH-1 | dofile patch: `r(table)` after every coefficient table, with e(b)'s columns; new estimates drop a stale one | `tests/test_engine.py::test_r_table_*`, `::test_new_estimates_drop_a_stale_r_table` | 5 of 6 fixed; needs Stata check |
| PATCH-2 | dofile patch: Break is taken only at safe points, so an interrupt can't leave the data half changed | `tests/test_break.py` | patched |
| PATCH-3 | dofile patch: every user file name goes through one hook (`core/userpath.user_path`), for the web demo's path shim (`dofile/pathshim.py`) | `tests/test_pathshim.py` | patched (dofile-only, not for upstream) |
| PATCH-4 | dofile patch: `expand` and `stsplit` build `np.repeat` counts as `np.intp`, which wasm32 numpy needs | `expand` and `stsplit` cases of `tests_opendta/compat` in Pyodide (`web/scripts/check-snapshot.mjs`); a CPython test cannot show it | patched (dofile-only, wasm32); the 11 cases pass in Pyodide |

## Details

### ODT-1: perfect-fit `regress` crashes
`clear`, `set obs 20`, `gen x = _n`, `gen y = 2*x`, `regress y x`.
- dofile: rc 9999, `internal engine error: ZeroDivisionError: division by zero`.
- Expected in Stata: the regression runs (R² = 1, root MSE 0); F and p-values missing. Source: [R] regress (to confirm).
- Patched (`opendta-odt1-perfect-fit.patch`): F was divided by a zero residual variance; now F and its p-value
  are missing, standard errors 0, t/p/CI missing.

### ODT-2: `xtlogit, re` overflow
`use panel, clear`, `xtset id year`, `xtlogit d x1 x2, re`.
- dofile: rc 9999, `OverflowError: math range error` (in `math.exp`), not caught by `capture`. Other data can run fine.
- Expected in Stata: estimates, or a convergence message with a Stata return code. Source: [XT] xtlogit.
- Patched (`opendta-odt2-xtlogit-overflow.patch`): the model converges at the sigma_u = 0 boundary and the rho/sigma_u
  interval bounds overflowed `math.exp`; rho's bounds now use a stable form and an overflowing sigma_u bound is missing.
  Same `math.exp` pattern, not seen to fail yet: other panel models' bounds in `panel2.py` (`xtreg, mle`, `xtpoisson, re`).

### ODT-3: `_b[]` with an interaction name
`use cps, clear`, `generate double lwage = ln(wage_hr)`, `regress lwage c.yrsed##i.sex`, `display _b[c.yrsed#2.sex]`.
- dofile: rc 198 `invalid syntax`, though `e(b)` has the column `c.yrsed#2.sex`. `_b[yrsed]` and `_b[2.sex]` worked.
- Expected in Stata: the coefficient (.00783558 here). [U] 13.5 and 11.4.3; [U] 13 writes `b[1.sex#2.group]` and Stata's
  regression slides use `_b[1.female#c.age]` (https://www.stata.com/manuals13/u13.pdf). Not found: whether Stata names this
  term `c.yrsed#2.sex` or `2.sex#c.yrsed` (the Stata 14 logs show the written order, `g#c.x`, as dofile's `e(b)` does).
- Workaround (before the patch): `matrix b = e(b)`, `display b[1, colnumb(b, "c.yrsed#2.sex")]`, or `get_matrix("e(b)")`.
- Patched (`opendta-odt3-coef-interaction-names.patch`): the tokenizer accepts `#` and `.` inside `_b[...]`, `_se[...]`
  and `_coef[...]`, and `_coef_index` tries an interaction's terms in any order (VERIFY Stata's order). Both orders now
  give `.00783558` (`_b[c.yrsed#2.sex]` and `_b[2.sex#c.yrsed]`). A `#` outside the brackets is still a syntax error.

### ODT-4: `confirm variable` return code
`clear`, `set obs 1`, `capture confirm variable nosuch`, `display _rc`.
- dofile: `198`. Expected in Stata: `111` ("variable nosuch not found"); [P] confirm's capture example shows `_rc` 111
  (https://www.stata.com/manuals14/pconfirm.pdf).
- Workaround (before the patch): test `_rc != 0` instead of `_rc == 111`.
- Patched (`opendta-odt4-confirm-variable.patch`): `confirm [new|numeric|string|str#|<type>] variable varlist [, exact]`
  with the manual's codes: 111 `variable not found` and `no variables defined`, 110 `already defined` for `new`, 198
  `invalid name`, 7 for a type mismatch. VERIFY: the type-mismatch message text; `exact` turns off abbreviations.

### ODT-5: `%w.dg` ignores d
`display %20.12g 1/3` and `display %12.4g 1/3`.
- dofile: ` .333333333333333315` (18 significant digits) and `.3333333333`.
- Expected in Stata: `.333333333333` and `.3333` (at most d significant digits). Source: [D] format.
- Patched (`opendta-odt5-general-digits.patch`): `format_value` passed only the width to `general()`, which
  implements `%w.0g`; d now caps the significant digits. `%w.0g` is unchanged.

### ODT-6: regression on its own interaction
`use cps, clear`, `regress yrsed c.yrsed#i.sex`.
- dofile: rc 9999, `internal engine error: InvalidOperation`.
- Expected in Stata: estimates (an unusual model, but valid). To check in Stata.
- Patched (`opendta-odt6-huge-fixed-format.patch`): the model is a numerically perfect fit, so F and t are ~1e14 to
  1e29, and `%f` formatting crashed for values needing more than Decimal's default 28 digits; it now uses enough
  precision. To verify: how Stata 14 prints such huge F and t values (here they overflow the table's columns).

### ODT-8: backslash escapes for macros
`global v1 X`, `display "a\$v1 b"`.
- dofile: `a\X b` (the backslash stays and `$v1` is expanded).
- Expected in Stata: `a$v1 b`. Stata's FAQ shows `display "\$myfile"` printing `$myfile`, and the Programming manual
  prints `$22.15` with `display "\$22.15"` (https://www.stata.com/support/faqs/programming/backslashes-and-macros/).
  So `\$` is documented ([U] 18.3, macros). A backslash before a backquote is not: the FAQ only covers a path such as
  ``c:\data\\`myfile'``.
- Workaround: put such text in a macro and reference it, since a macro's contents aren't expanded again. This
  is how `dofile run` passes the do-file path.
- Patched (`opendta-odt8-macro-backslash-dollar.patch`): in `lang/macros.py:expand`, `\$` leaves a literal `$` (the
  backslash is dropped) and `$name` still expands. Only `\$` is handled; a backslash before a backquote, or a doubled
  backslash, is unchanged.

### ODT-9: `Instruments:` footnote does not wrap
`use card, clear`, `ivregress 2sls lwage (educ = nearc4) exper expersq black smsa south smsa66 reg662-reg669`.
- dofile: `Instruments:   exper expersq black ... reg669 nearc4` on one line of about 150 characters.
- Expected in Stata: the list wraps at the line size, continuation lines indented under the first instrument. Source:
  memory of Stata output; the Stata 14 log `0510_painel_iv.log` only has short lists, so to confirm.
- Patched (`opendta-odt9-footnote-wrap.patch`): the `Instrumented:`/`Instruments:` footnotes of `ivregress`,
  `ivprobit`/`ivtobit`, `svy: ivregress` and `xtivreg` wrap at the line size with a hanging indent.

### ODT-10: `relabel()` ignored in `graph bar`
`use card, clear`, `graph bar (mean) educ, over(nearc4, relabel(1 "Not near" 2 "Near"))`.
- dofile: the bars are labeled `0` and `1`. Expected in Stata: "Not near" and "Near". Source: [G-2] graph bar, `over()`.
- Patched (`opendta-odt10-relabel.patch`): `relabel(# "text")` in `over()` of `graph bar` and `graph box` renames
  categories by position.

### ODT-11: `by` with `regress`
`use card, clear`, `gen byte g = 1 + mod(_n, 3)`, `by g, sort: regress lwage educ`.
- dofile (re-run 2026-11-05 on the Card and CPS data): `by g, sort: regress ...` and `bysort g: regress ...` both give
  rc 190 `regress may not be combined with by`; `bysort g: summarize lwage` works.
- Expected in Stata: one regression per group. The current [R] regress lists `by` among its allowed prefixes
  (https://www.stata.com/manuals/rregress.pdf), and the Stata 13 and 14 manuals list `by` among the prefixes allowed
  with estimation commands (Stata 14 [R] glm shows the same list: bootstrap, by, fp, jackknife, mfp, mi estimate,
  nestreg, rolling, statsby, stepwise, svy). The Stata 14 [R] regress page itself was not read; the Stata 14 reference
  logs have no `by:` estimation.
- Workaround: `forvalues` over the groups with `if`.

### ODT-12: `nbreg` warning
`nbreg pos educ` on the Card data (`pos = round(exp(lwage-5))`) printed `RuntimeWarning: invalid value encountered
in sqrt` from `estimation/models2.py` (alpha's standard error); the estimates still came back. Open: whether Stata
reports a standard error for `lnalpha` where dofile now shows missing.
- Patched (`opendta-odt12-nbreg-boundary.patch`): `lnalpha` (-18.6, just above the -20 boundary test) had a
  negative variance; the square root is skipped and the row shows missing, as at the boundary. Still to verify:
  the LR test printed `chibar2(01) = 2.5e-03`; Stata 14 shows `%7.2f` and `0.0e+00` for an exact zero, so small
  positive values are unchecked (marked VERIFY in the code).

### ODT-13: bare `mean` (replay)
`clear`, `set obs 50`, `gen x = rnormal()`, `mean x`, then `mean` and `mean, level(90)`.
- dofile: the last two give rc 100 `varlist required`. `estimates replay` redisplays the results (the workaround).
- Expected in Stata 14: [U] 20.3 says an estimation command typed without arguments redisplays its prior results,
  with options allowed on replay (its example: `regress`, then `regress, coeflegend`)
  (https://www.stata.com/manuals14/u20.pdf). `mean` stores `e(b)` and `e(V)`, and
  `level()`, `noheader`, `nolegend` and `coeflegend` are its replay options (https://www.stata.com/manuals14/rmean.pdf).
  [R] mean's syntax box shows no replay line, but neither does `regress`'s. Documented by the general rule, not shown.
- Patched (`opendta-odt13-mean-replay.patch`): `mean`, `proportion`, `ratio` and `total` with no varlist redisplay the last
  result, header and table, as typed the first time; `, level(90)` recomputes the intervals, `, noheader` drops the
  header, and `r(table)` is reposted. Another estimation in between gives rc 301 `last estimates not found`. The first
  `mean x y` output is identical to the replay (tested). This patch applies before `opendta-patch1-r-table.patch`
  (patches apply in name order), which edits the same function and adds the `r(table)` call to the replay.

### ODT-14: Python `eval()` on expression text (security)
`tsset t`, `arch y, arch(1) archm archmexp(().__class__.__mro__.__len__()*X)` ran (rc 0).
- `archmexp()` and `bayesstats summary ({param} expressions)` passed their text to Python's `eval()` with
  `{"__builtins__": {}}`, which doesn't stop attribute access, so Stata code could reach Python's object internals in
  the sandboxed worker, with only the audit hook behind it. Upstream `main` (0.10.0) still has it, the bayes code moved
  to `bayespost.py`.
- Expected: arithmetic expressions only. Source: [TS] arch (`archmexp()`), [BAYES] bayesstats.
- Patched (`opendta-odt14-safe-expr.patch`): a restricted evaluator (`core/safe_expr.py`) allows numbers, the given
  names and functions, `+ - * / **` and unary minus; anything else is rc 198. `^` in `archmexp()` now works as
  power (it failed before). To report upstream as a security issue.

### ODT-15: `predict` after `mean` or `bootstrap`
`clear`, `set obs 50`, `gen x = rnormal()`, `gen y = x + rnormal()`, `mean y`, `predict yh`.
- dofile: rc 9999 `AttributeError: 'Estimates' object has no attribute 'terms'` (`estimation/postest.py`, `xb_all`);
  `bootstrap _b[x], reps(5): regress y x` then `predict` does the same. The session keeps its data, but rc 9999 skips
  `capture` and ends the call. A crash is a bug whatever Stata does.
- Expected in Stata 14: rc 321. The `mean` postestimation page lists `estat vce`, `estimates`, `hausman`, `lincom`,
  `nlcom`, `test` and `testnl`, and no `predict`
  (https://www.stata.com/manuals14/rmeanpostestimation.pdf); [P] error gives 321 "requested action not valid after most
  recent estimation command" for this case (https://www.stata.com/manuals14/perror.pdf). Only `mean` was checked, not
  `bootstrap`.
- Patched (`opendta-odt15-predict-unsupported.patch`): `predict` raises that rc 321 when the estimation has no terms
  (`mean`, `bootstrap`). The message wording is ours.

### ODT-16: `color()` specs
`twoway (histogram x, color(maroon%50))`, `twoway (histogram x, color(gs2))`.
`graphics/scheme.py:color()` returned the default palette color for any text it did not know, with no error:
- `gs#` ran the wrong way, `gs0` white and `gs16` black (Stata: `gs0` black, `gs16` white); only the table entries
  `gs4`, `gs8`, `gs12` were right.
- `maroon%50` (opacity, Stata 15+), `navy*.5` (intensity, the Stata 14 way to lighten or darken) and `none`
  (`fcolor(none)`, ...: a hollow bar was drawn filled) were dropped.
- Patched (`opendta-odt16-color-specs.patch`): `gs#` fixed; `none` returns matplotlib's transparent `"none"`; `%#`
  returns `#rrggbbaa`; `*#` mixes toward white below 1 and darkens above 1. VERIFY: the intensity formula approximates
  Stata's, not checked against Stata output; a combined `navy*.5%50` is read in that order. Re-checked 2026-11-05:
  `gs0` `#000000`, `gs16` `#ffffff`, `gs2` `#202020`, `maroon%50` `#7b1f2a80`, `navy*.5` `#8d97ad`, `none` `none`.
- Still open (the semantics or the full list are not certain): four-number CMYK specs and `hsv ...`; color lists such
  as `mcolor(red blue)`; named colors the table lacks (`lime`, `bluishgray`, `ltbluishgray`, `midblue`, `ebblue`, `ebg`,
  `emidblue`, `erose`, `dknavy`; about 20 in all, from memory: check the manual before adding any). An unknown color
  (`foo` too) still falls back silently; refusing it as Stata does would make a valid-but-missing name fail, so wait for
  a complete table.
- The named colors are the engine's own palette, not Stata's values: the colorstyle manual gives `navy` as RGB 26 71 111,
  the engine's is 27 47 91 (so `navy*.5` differs too). Only the `gs#` levels follow Stata's definition.

### ODT-17: legend placement
`twoway (scatter y x) (lfit y x), legend(pos(3))`.
- dofile: the legend stayed at the bottom center (`graphics/render.py`, `loc="outside lower center"`).
  `legend(order(...))`, `label()` and `off` work.
- Expected in Stata (our reading of [G-3] legend_options): `pos()` is `position()`, a clock position (1 to 12; 0 the
  center); `ring(#)` sets how far out (`ring(0)` inside the plot region, values ordinal); `bplacement(compass)` places a
  `ring(0)` legend. Stata 14 defaults to the bottom (`pos(6)`), as dofile draws; newer Stata to the right. Under `by()`,
  location suboptions go inside `by()`.
- Patched (`opendta-odt17-legend-position.patch`): `position()` is read as the clock position, outside the plot
  region (12 top, 3 right, 6 bottom, 9 left; 1-2 and 10-11 top right and top left, 4-5 and 7-8 bottom right and bottom
  left); a legend at a side defaults to one column. Not done: `ring()` (parsed, ignored), `ring(0)` inside the plot
  region, `bplacement()`, `position(0)`. Re-rendered 2026-11-05: `pos(3)` right, `pos(12)` top, `pos(1)` top right
  outside the plot; `legend(ring(0) pos(11))` still draws outside (top left).

### ODT-18: `ttest` with `unequal` but no `unpaired`
`clear`, `set obs 50`, `gen x = _n`, `gen y = x + rnormal()`, `gen z = x + rnormal()`, `ttest y == z, unequal`.
- dofile: rc 0, "Paired t test": the user asked for Welch and got a paired test. With `unpaired unequal` it was right.
- Expected in Stata: [R] ttest puts `unequal` and `welch` under the `unpaired` form; the paired form is
  `ttest varname1 == varname2 [if] [in] [, level(#)]` (https://www.stata.com/manuals14/rttest.pdf). Expected rc 198:
  [P] error lists "option not allowed" under 198 (https://www.stata.com/manuals14/perror.pdf); the exact message is not in
  the manuals. The Stata 14 logs use `unequal` only with `by()` and `ttesti`.
- Patched (`opendta-odt18-ttest-options.patch`): the paired and one-sample forms refuse `unequal`, `welch` and `unpaired`
  with rc 198 `option unequal not allowed`; the two-sample forms and `by()` are unchanged. VERIFY: Stata's message text.

### ODT-19: matrix subscripts of `e()`/`r()` in an expression (likely not a bug)
After `regress y x`: `display e(b)[1,1]`, `scalar s = e(b)[1,1]`, `display r(table)[1,1]`, `display %6.3f (r(table)[1,1])`.
All fail (rc in the table below). `matrix T = e(b)` then `display T[1,1]`, `el(e(b),1,1)` and `_b[x]` work.
- Stata: nothing documents `e(b)[1,1]` as an expression. [U] 14.9 and [P] matrix define give `matname[r,c]` for a matrix
  *name*; [U] 14 allows `e(b)` "in any matrix expression", with `matrix myb = e(b)` as its example (its `e(b)[1,3]` is
  only the heading `matrix list e(b)` prints). A 2010 Statalist thread
  (Stata 11) reports `local x = e(b)[1,1]` "invalid syntax" and `generate x = e(b)[1,1]` r(509), advising a copy into a
  named matrix (https://www.stata.com/statalist/archive/2010-10/msg00534.html). An earlier reading that Stata accepts
  these is not supported. dofile is more permissive than Stata for `el(e(b),1,1)`, and accepts `e(b)` in matrix
  functions (`colsof(e(b))`, `trace(e(V))`, `e(b)*invsym(e(V))*e(b)'`).
- Unchecked: whether Stata 14 still rejects the form, and its rc for `display`. Close the entry unless someone shows
  Stata 14 printing the value. Agent-facing: use `_b[name]` or copy the matrix first; the messages name no cause.
- Return codes (two evaluators handle the form; re-run 2026-11-05):

  | Command | dofile | Stata (Statalist 2010, Stata 11) |
  |---|---|---|
  | `local l = e(b)[1,1]` | 198 `invalid syntax` | 198 `invalid syntax` (same) |
  | `generate z = e(b)[1,1]` | 198 | 509 (matrix operators not allowed in this context) (differs) |
  | `scalar s = e(b)[1,1]` | 198 | not reported |
  | `display (e(b)[1,1])`, `display %6.3f (r(table)[1,1])` | 198 | not reported |
  | `display e(b)[1,1]`, `display r(table)[1,1]`, `display 1 + e(b)[1,1]` | 109 `type mismatch` | not reported |

  Left as it is: rejected everywhere, only the code differs. If made consistent, 198 is the only code with evidence
  (509 for `generate`).

### ODT-20: histogram outline ignores `lcolor()`
`twoway (histogram x, fcolor(none) lcolor(navy))` drew no visible bars: `graphics/render.py` (`draw_layer`, kinds `bar`
and `histogram`) set histogram edges to the background color (`edge = sch["background"]`, so narrow bins keep their
fill) and never read `lcolor`.
- Expected in Stata: `lcolor()` and `lwidth()` set the outline; `fcolor(none)` gives hollow bars. Not run in Stata.
- Patched (`opendta-odt20-bar-outline.patch`): an explicit `lcolor()` sets the outline color (also for histograms of
  more than 40 bins, which had no edge), an explicit `lwidth()` its width; with neither, the background-colored edge
  stays. `color()` alone still does not outline. Not checked: `lpattern`, and whether Stata outlines with `color()`.

### ODT-21: numeric axis tick steps
`clear`, `set obs 18`, `gen educ = _n`, `gen w = educ / 3`, `twoway line w educ`.
- dofile: x labels `0.0 2.5 5.0 7.5 10.0 12.5 15.0 17.5 20.0`, from matplotlib's default `AutoLocator` (steps include
  2.5) and `ScalarFormatter` (adds `.0`). Bar charts' y axis already used `MaxNLocator(steps=[1, 2, 5, 10])`.
- Expected in Stata: "approximately five values are labeled and ticked on each axis by default", from a nice-number
  routine (https://www.stata.com/manuals/g-3axis_label_options.pdf); here presumably `5 10 15 20`, our reading.
- Patched (`opendta-odt21-axis-ticks.patch`): `_apply_axis` replaces the default `AutoLocator` on a linear numeric axis
  with `MaxNLocator(nbins=5, steps=[1, 2, 5, 10])`; explicit labels, `#`-rule labels, value labels and categorical axes
  keep theirs. The sample axis now reads `5 10 15`. Not checked: Stata's tick choice on other ranges.

### ODT-22: the `matrix()` pseudofunction
`matrix xx = (1,2 \ 3,4)`, `display trace(matrix(xx))`, `display el(matrix(xx),2,1)`.
- dofile: both rc 198; `trace(xx)` and `el(xx,2,1)` work.
- Expected in Stata: `matrix(name)` forces the matrix-name reading when a variable has the same name, with
  `local new=trace(matrix(xx))` as the example (https://www.stata.com/manuals14/pmatrixdefine.pdf). Not run in Stata.
- Patched (`opendta-odt22-matrix-pseudofunction.patch`): `matrix(name)` in an expression is the name. It does not force
  the matrix reading over a same-named variable (VERIFY). In matrix functions (`trace`, `el`) the name is a matrix anyway;
  only a 1x1 matrix read as a scalar (`display matrix(one)` with a variable `one`) gives the variable's value.

### ODT-23: `capture` and the sandbox's refusals
`capture type /etc/passwd` under the dofile sandbox, then `display _rc`.
- Before the patch the call stopped with rc 603: the sandbox raises a Python `PermissionError`, and OpenDTA's `capture`
  caught only its own `StataError` (`use` and `graph export` convert the error themselves).
- Expected: `capture` catches any file error and sets `_rc` (Stata: 603 `file could not be opened`).
- Patched (`opendta-odt23-capture-sandbox-refusal.patch`): `capture` turns a `PermissionError` into `StataError(603)`.
  Only needed because of dofile's sandbox, so not for upstream.

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
- With `aweight` and `pweight` varying within id and with `fweight`, `regress` with the dummies moves (0.49189, 0.49189,
  0.43677); `xtreg, fe` and `areg` stay at 0.47292.
- Cause: `estimation/panel.py` declares the weights for `cmd_xtreg` and `cmd_areg` and parses them into `smp.w`, but
  `_xtreg_fe` and `cmd_areg` never read it: they demean with `_demean(y, ids, inv, counts)` and solve unweighted.
- Expected in Stata: [R] areg treats `absorb(var)` "as if it were specified by dummy variables" and takes a-, f- and
  pweights, so it should equal `regress y x i.id [aw=w]` (shown only unweighted; the weighted case is inferred). Stata
  14 [XT] xtreg (syntax notes, PDF p. 4; current manual p. 7): "aweights, fweights, and pweights are allowed for the
  fixed-effects model. ... See [U] 11.1.6 weight. Weights must be constant within panel." Statalist, 2008, Austin
  Nichols: "-xtreg- will not allow weights that vary over time within panel, but -areg- will"
  (https://www.stata.com/statalist/archive/2008-06/msg01015.html). The error's rc is not in the manual.
- Found with Cheng and Hoekstra (2013), `xtreg l_homicide ... post [aweight=popwt], fe` (`popwt` constant within state):
  `post` 0.0694 (se 0.0559) with `xtreg, fe` and `areg`, 0.0755 (se 0.0348) with `regress ... i.sid`.
- Workaround (before the patch): `regress y x i.id [aweight=w], vce(cluster id)`.
- Not checked: `xtivreg`. The Stata 14 reference logs have no weighted `xtreg` or `areg`.
- Patched (`opendta-odt24-weighted-within-estimators.patch`): `xtreg, fe` and `areg` demean with weighted group means and
  solve weighted least squares, weights scaled as `regress` does (a- and pweights to the sample size, fweights as they
  are, N their sum). `xtreg, fe` stops with rc 101 `weights must be constant within panel` for weights varying within a
  panel; `areg` takes them. `e(wtype)` and `e(wexp)` are set. Against `regress` with the dummies, coefficient, se, N and
  residual df agree to 1e-8 for a- and fweights (the coefficient for pweights, whose variance is robust).
  - `areg ..., vce(robust)` with fweights first squared the weight in the robust variance (se 0.0761 against `regress`'s
    0.0487); it now uses w and agrees to 1e-8 (`test_odt24_areg_robust_with_fweights`). `vce(cluster)` was right.
  - `xtreg, re` and `, be` dropped weights too. The manual's weight note lists none for re or be, so they now stop with
    rc 101 `aweights not allowed` (`test_odt24_xtreg_re_and_be_refuse_weights`). VERIFY the text and that Stata 14 refuses.
  - VERIFY: the rc 101 and its text (a guess), the place of `wtype`/`wexp` among the e() macros, and the weighted
    `xtreg, fe`'s secondary statistics (between and overall R-squared, `sigma_u`, `corr`, the log likelihood), still the
    unweighted formulas.

### ODT-25: `Sorted by:` after reading a Stata-written file
`use castle.dta` (Cheng and Hoekstra's data, `scunning1975/mixtape`), `describe, short` printed 48 names after
`Sorted by:` (`sid r20052 year state r20083 trend_17 trend_23 ...`, some twice).
- Cause: the file's `<sortlist>` has 186 two-byte entries, `3, 0, 0, ...` (the key is `sid`), then 127 leftover nonzero
  entries that Stata ignores, since the list ends at the first 0. `io/dta.py:314` kept every entry in range.
- Not checked: whether `by:` or `merge` use the list (it looks cosmetic), and the .dta format specification's wording
  ([P] File formats .dta) on the terminator. A file that dofile writes has zeros after the list and reads back fine.
- Patched (`opendta-odt25-dta-sort-list.patch`): the reader stops at the first 0 (`_sort_keys` in `io/dta.py`, for the old
  and the 117+ formats). `castle.dta` now reports `Sorted by: sid`.

### ODT-26: `mkdir`, `rmdir`, `copy`, `dir` delete backslashes from an unquoted path
`mkdir C:\proj\out` makes a folder named `C:projout`: `commands/datautil.py` splits the arguments with
`shlex.split(body, posix=True)`, where `\` is an escape character.
- The problem is that the text is changed, and inconsistently: `use C:\proj\d` and `save C:\proj\d` keep the
  backslashes; `mkdir "C:\proj\out"` keeps them, and `mkdir "C:\\x"` turns `\\` into `\`.
- Expected in Stata (documentation, not a run): the command gets the text as written; on Windows `\` is a separator, on
  macOS and Linux a literal character (the folder is `C:\proj\out`). Stata's only backslash rule is in macro expansion.
- Impact: small in the CLI. It matters for the web demo's path shim, which needs the original text to map a Windows
  path; do-files written on Windows use unquoted backslash paths.
- Fix: split with `posix=False` and strip the outer quotes, or split on whitespace outside quotes as the other file
  commands do.

### ODT-27: `save using name` is not a syntax error
`save using my_new_data, replace` prints `file using my_new_data.dta saved` and creates `using my_new_data.dta`;
`save a b, replace` creates `a b.dta`. `commands/files.py` takes all the text before the comma as the file name.
- Expected in Stata: **assumed, not checked.** `save` is documented as `save [filename] [, options]`, with no `using`
  clause, so we assume a syntax error (probably rc 198). Unknown: the code and message, and whether Stata accepts
  unquoted spaces in a `save` file name (which decides `save a b`).
- Evidence in the repo: none. No Stata 14 log runs either form (every `save` in `tests_opendta/compat/do/` is plain,
  `save odta_u, replace`); `known_differences.txt` doesn't list it.
- Not evidence about Stata: stats.camp (a closed-source Rust reimplementation, Stata version and testing unknown)
  accepts `save using x, replace` and writes `x.dta`, so dofile's output differs from it.
- To verify: run both in Stata 14, then add them to `gerar_esperados.do` as a case.
- Fix (once checked): if Stata refuses `using`, reject it with a syntax error; if it accepts it, drop a leading `using`
  so `save using x` writes `x.dta`. Decide likewise for unquoted names with spaces. A patch in `scripts/patches/`.

### ODT-28: Python errors that escape a command give rc 9999, not a Stata error
A Python exception that escapes a command ended the whole program with rc 9999 `internal engine error` and a
traceback, and `capture` (which catches only `StataError`, `lang/interpreter.py`) did not catch it.

**A missing folder or a directory in place of a file:** `log using hi/hi, replace` with no folder `hi/` gave
`FileNotFoundError: [Errno 2] No such file or directory: 'hi/hi.smcl'`, rc 9999, also under `capture`.
- Cause: `log`, `cmdlog`, `outfile`, `file open`, `copy` (destination) and `bcal create` had no `except OSError`
  around their `open()`; `use`, `append`, `type`, `infile`, `file open ... read`, `copy` (source) check
  `path.exists()` and then fail in `open()` on a directory (`IsADirectoryError`). The commands that were right carry
  their own `except OSError` (`save`, `export delimited`/`excel`, `outsheet`, `postfile`, `putexcel`, `graph
  save`/`export`, `erase` 693, `mkdir`/`rmdir` 693, `cd` 170).
- Probed: 48 file commands with a missing folder and with a directory. Not covered: commands outside those 48,
  permission errors that are not the sandbox's, and the rc of `merge`/`cross` with a directory (459 and 110).
- Expected in Stata: **assumed, not checked.** r(603), `file hi/hi.smcl could not be opened`, as `save` already gives
  here (the engine's own handlers raise 603 with `(strerror)`); 603 assumed for a directory too.

**Out of memory:** a numpy `MemoryError` (`Unable to allocate 763. MiB ...`) escaped the same way. In the web demo
(WebAssembly heap stops at 4 GB), with 100 million observations `gen double x = 1` and `gen double y = x` worked (heap
3.6 GB) and `gen double z = x + y` gave rc 9999; the runtime survived. CPython does the same when the machine runs out.
- Expected in Stata: **assumed, not checked.** r(909), `op. sys. refuses to provide memory`, which `capture` catches.

**The data is not rolled back.** A command that fails partway keeps what it changed: with a `MemoryError` injected at
the second variable, `recode a b (1=9)` leaves `a` recoded and `b` unchanged, `mvdecode a b, mv(1)` leaves `a` missing.
Any error inside a command (a `StataError` too) can do this. So r(603) or r(909) does not mean the data is as it was.
- Expected in Stata: **not checked.** Built-in commands are thought to leave the data unchanged on failure; ado-file
  commands may differ.
- Not patched: each command would need to work on a copy, or a snapshot before every command would double memory use
  just where memory is short.

**The patch** (`opendta-odt28-python-errors-as-stata.patch`): `commands/registry.py` wraps every registered command, so
an escaping `OSError` becomes `StataError(603, "file <name> could not be opened (<strerror>)")` and a `MemoryError`
`StataError(909, "op. sys. refuses to provide memory")`; `capture` catches them. A command's own `StataError` is
untouched. `PermissionError` is left alone for the sandbox (ODT-23: `capture` converts it; `Engine.run` turns an uncaught
one into 603). The wrapper is in the registry because PATCH-2 edits the dispatcher's `spec.fn` lines. An error outside a
command (macro expansion, the interpreter) still gives rc 9999.
- Tests: `tests/test_engine.py::test_odt28_*` (13 commands, `capture`, the commands that keep their own codes, and a
  `MemoryError` injected into `replace`, with and without `capture`).
- Related: ODT-23 is the same family for the sandbox's `PermissionError`; it stays separate because it exists only for
  the sandbox and is not for upstream.
- Side finds: `estimates save`/`use` are GAP-5. `export excel` to a bad path prints a stray `ValueError: I/O operation
  on closed file` from openpyxl to stderr, though it returns 603 (not an entry).

### GAP-2: `estat firststage`
`estat firststage` (first-stage F and partial R² after `ivregress`) returns rc 321 "subcommand estat
firststage is unrecognized". It's the standard weak-instrument check, so it's worth implementing upstream.
- Workaround: run the first stage with `regress endog instruments exog`, then `test instruments`.

### ODT-30: Newton steps from a nearly singular numerical Hessian (false convergence at a boundary; path depends on rounding)
`gnbreg cnt x1 x2, lnalpha(x3)` in compat 1907_models (data from the lines before it in
`tests_opendta/compat/do/1907_models.do`) ends on CPython at ll -878.310297 after 7 iterations, `lnalpha:_cons` = -22.0
(alpha about 1e-10): the Poisson log likelihood of the same mean equation to every digit (-878.3102973), the boundary.
- Cause, as traced: `ml.maximize` steps `-solve(H, g)` with `H` from `models2.num_hess` (central differences of the
  analytic gradient, h = 5e-3 scale, Richardson). At the boundary eig(-H) is 6.8e-4, 2.3e-3, then 620 to 1300 (condition
  1.9e6). A 3e-7 difference in `H` (last bits of the `lngamma`/`digamma` gradient) moves the step by 1.4e-4. The `lnalpha`
  score is proportional to alpha, so it vanishes at alpha = 0, and the convergence test (`dp < tol or dv < ltol`,
  `nr < nrtol`, concave `H`) accepts a point where the likelihood can still rise.
- Perturbation experiment (CPython, 8 seeds each, analytic derivatives times `1 + r u`, u uniform(-1,1)): r = 0:
  -878.3103 converged, 8 of 8. r = 1e-13: one run does not converge (-878.3053). r = 1e-11: one converges to
  **-878.1424**, one does not converge (-878.2737). r = 1e-9: five outcomes in 8 runs. Pyodide (numpy 2.4.6, other libm
  and LAPACK) ends at -878.2943 after 300 iterations unconverged, still creeping after 3000.
- Same family: the constant-only model for `ll_0` sits in the non-concave branch on both platforms: ll -959.397 on
  CPython, -957.390 in Pyodide, -952.7455 in Stata's log. The non-concave step adds `lam * I` with
  `lam = 1.1 * max eig(H) + 1e-6` (`VERIFY` in the code), so the step runs almost entirely along the one flat eigenvector
  (length about 59 in 1001_mixed's `covariance(unstructured)` fit, where it was first seen).
- Found comparing e() and r() of the 98 comparison programs between CPython and Pyodide. Probably the same, not traced:
  1901 `streg`, 1907 `tnbreg` and `zinb`, 1905 `xtfrontier` (different endpoints, same ll to 8 or more digits).
- Expected in Stata: **not known.** Stata's log also ends at -878.31024 (25 iterations, many "(backed up)"), so the case
  passes; whether Stata's path is as sensitive cannot be seen from one log. Stata fits the constant-only model in 4
  iterations to -952.7455; ours does not reach it. For someone with Stata to check.
- Fix to try, not done: a step rule for a nearly singular `H` (Levenberg-Marquardt, a trust region, or the analytic
  Hessian), and a convergence test that does not accept a small score caused only by a parameter at its boundary. Either
  changes the iteration logs the Stata 14 comparison checks line by line (with known-difference rules for 1907), so the
  comparison must run again. The platform differences are of ordinary libm size, so CPython on Linux against macOS would
  likely differ too; not tested.

### ODT-31: overflow warnings in delta-method intervals (left as is)
The details of ODT-29 (one issue, two IDs). `poe slow` prints three `RuntimeWarning: overflow encountered in exp`:
`estimation/mleq.py:157` in `1907_models` and `1918_models3`, `estimation/models2.py:739` in `1918_models3`.
- Both lines compute `exp(b - c * se)` and `exp(b + c * se)` (`mleq.py`'s `transformed_row`; `models2.py`'s interval
  of `nbreg`/`gnbreg`'s alpha); a large `se` overflows the upper end to `inf`. Neither is wrapped in `np.errstate`,
  unlike `core/ordination.py`, `core/survival.py`, `core/rng.py`.
- Upstream code, unmodified (`opendta-odt12-nbreg-boundary.patch` edits the branch above `models2.py:739`, not the
  `exp` line). OpenDTA's own suite prints the `mleq.py:157` warning too, in `test_nb1_nbreg_and_tnbreg`; `models2.py:739`
  was not checked upstream (1918_models3 runs only through `compare.py`). `slogdet` and `normalden` overflow warnings in
  the same run are also not ours.
- Not patched on purpose: the output is right (both comparison cases pass, `inf` included) and the warning goes only to
  Python's warnings (stderr), not the Stata log (checked in pytest only, not in the CLI or MCP server). A patch would be
  two `np.errstate(over="ignore")` wrappers plus a re-vendor, for no change in results.
- Revisit if the warnings ever reach a user (a caller that turns warnings into errors) or if a result stops matching.

### ODT-32: a missing optional package is rc 610 "file not Stata format", with `pip install` advice
`io/statpkg.py` and `io/dta.py` raised `StataError(610, ...)` when `pyreadstat` or `pandas` could not be imported
(`export sasxport requires the pandas package (pip install pandas)`). 610 is Stata's code for a file not in its
format, and OpenDTA uses it for that too (`file not SAS XPORT format`, `file not Stata format`), so one number meant
both "the file is bad" and "this build lacks a package". The web demo ships `pyreadstat` without pandas
(`docs/pyodide-snapshot.md`, "Packages added"). A script that tests `_rc == 610` for a bad file misread it, and the
advice is useless in the browser.
- Expected in Stata: **no equivalent; a design choice.** Stata always has all its commands. The nearest dofile code is
  the sandbox's refusal, rc 199 `command ... is disabled in the dofile sandbox` (`sandbox.py`).
- Patched (`scripts/patches/opendta-odt32-missing-package-errors.patch`): three sites become
  `StataError(199, "... is not available: it needs the <package> package, which is not installed")`:
  `statpkg.pyreadstat()` (`import sasxport`/`sas`/`spss`), `statpkg.write_xport` (pandas), `dta._read_legacy`.
- Not patched: `xlrd`/`xlwt` in `io/excel.py` (rc 603 with pip advice; both are core dependencies of dofile, so it cannot
  occur); `pyodbc` in `commands/datasets.py` (rc 198; ODBC needs a driver too). `write_formats_xpf` imports pandas
  unguarded, but `write_xport` runs first and refuses.
- Side finding: `_read_legacy`'s docstring says formats up to 115 go through ReadStat, but `read_dta` sends 113 to 115
  to `_read_old`; ReadStat gets only formats older than 113 (Stata 7 and earlier) or unknown releases.
- Tests: `tests/test_engine.py::test_odt32_missing_optional_package_is_rc_199_without_pip_advice` (hides each package with
  `sys.modules[name] = None`), and the web demo's e2e test (`export sasxport` without pandas, in four browsers).

### ODT-33: the unclosed-block hint names OpenDTA's Command window and Shift+Enter (left as is)
`core/hints/programming.py`, `_unclosed_block` (after "unexpected end of file" for an unclosed `{`), says in English and
Portuguese: "add the closing }. In the Command window, type the whole block (Shift+Enter starts a new line) or write it
in the Do-file Editor."
- That is OpenDTA's desktop window. dofile has none: the CLI runs files, the MCP server runs given code, and the web
  demo's command line is one line (a pasted block gets a toast to run it from the editor). "add the closing }." is true.
- Not a Stata question: the words are OpenDTA's own.
- Left as is on the maintainer's word (2026-11-11): no patch. Fix upstream, or with a multi-line command line in the web
  demo (`docs/phase2-plan.md`, "Later UI work"), when the sentence would be true there.

### ODT-34: a do-file that starts with a UTF-8 BOM fails on its first line
`commands/program.py` `_run_file` reads the do-file with `path.read_text(encoding="utf-8")` (latin-1 when that fails),
which keeps a leading BOM as U+FEFF; the lexer takes it as part of the first command, so `\ufeffdisplay 1` stops with
r(198) "invalid syntax". Windows editors (Notepad's "UTF-8 with BOM") and some exports write one.
- Repro (dofile 0.1.0.dev1, CPython): `b.do` holding `EF BB BF` then `display "inner ok"`; a nested `do b.do` (from a
  do-file or the MCP server) and `dofile run b.do` echo the line with the BOM, then r(198). The web demo's engine does the
  same (`web/e2e/editor.spec.ts`). `import delimited` is fine: `io/delimited.py` `read_delimited` tries `utf-8-sig` first.
- Expected in Stata: **unverified.** Stata 14 reads do-files as UTF-8; whether it skips a BOM needs a Stata run.
- Not patched. The web demo's editor never holds a BOM, and Save drops a `.do` or `.ado` file's BOM
  (`web/src/app/editor/ranover.ts` `dropsBom`); a data file keeps its BOM. An engine fix would read with `utf-8-sig` in
  `_run_file` (shared with `include`).

### GAP-3: other `estat` subcommands after `ivregress`
`estat endogenous` and `estat overid` return rc 321 `subcommand ... is unrecognized`, as `estat firststage` does (GAP-2).
An IV replication such as Card (1995) needs all three. (`estat overid` is an error in Stata for an exactly identified
model, so test it with two instruments.)

### GAP-4: `lpoly` and `lpolyci` as twoway plot types
`twoway (lpolyci y x if x<0, degree(1) bwidth(.1)) (lpolyci y x if x>=0, ...)` stops with rc 198 `lpolyci is not a twoway
plot type`; `lpoly` too. Standalone `lpoly y x, degree(1) bwidth(.1) ci` draws. Stata documents both as twoway plot
types (not checked in a Stata 14 log); a regression-discontinuity plot needs them.
- Workaround: `lpoly ..., nograph generate(...) at(...)` for each side, then `twoway line` on the saved values.
- Also seen: the `ci` band wasn't visible at bandwidth 0.1 with 5,000 points; not checked whether it was drawn.

### GAP-5: `estimates` subcommands
`cmd_estimates` (`estimation/postest.py`) implements `store`, `restore`, `dir`, `drop`, `clear`, `replay` and `table`.
Any other word reaches `raise StataError(198, f"{sub}: unknown subcommand")   # VERIFY`, so `estimates save m1, replace`
gives rc 198 `save: unknown subcommand`.
- Missing, from memory of Stata 14 (not checked): `save` and `use`, `describe using`, `stats` (AIC and BIC), `for`,
  `notes`, `title`, `query`. `esample`, `selected` and `change` fail the same way; not counted (not known in Stata 14).
- Impact: the error reads like a typo. `save`/`use` matter most: the usual way to keep fits across sessions, and in the
  web demo across a page reload.
- `save`/`use` need a dofile file format (Stata's `.ster` is its own, as for `.gph`), and real `.ster` files would not
  load. `stats`, `for`, `notes`, `title`, `query` can work on the snapshots in `_stored_estimates`.
- A cheap step: say "not implemented" for the subcommands Stata has. No test, no xfail.

### GAP-6: help pages for language topics
OpenDTA's `help` (`commands/helpcmd.py`, 173 pages in `help/`, its own words) covers all 515 commands in the registry,
but `help foreach` stops with rc 111 `help for foreach not found`, as do `if`, `in`, `forvalues`, `while`, `weights` and
`varlist` (`local`, `global`, `program`, `by`, `quietly`, `capture`, `missing`, `functions` have pages). Checked with
`find_help()` on each topic.
- Impact: these are what a new user looks up first. The web demo's Help panel will show "no help page for this yet"
  instead of an error; the MCP server and CLI print the rc 111 line.
- Not a bug: the pages' examples use Stata's example-dataset variables (`regress price mpg weight`), which dofile
  does not ship, so they don't run as written.

### GAP-1: community commands
`reghdfe`, `esttab` and `outreg2` are SSC packages, not part of Stata, and OpenDTA doesn't implement them. Not
bugs; listed so the xfails have a home. Built-in alternatives: `areg`/`xtreg, fe` for one fixed effect,
`estimates table` for tables.

### PATCH-1: `r(table)` (dofile's own patch)
`scripts/patches/opendta-patch1-r-table.patch` gives OpenDTA Stata's `r(table)` (rows `b se t|z pvalue ll ul df crit
eform`, one column per coefficient):
- Every estimation table sets it and replaces r(), as Stata's r-class table helper does; so do `mean`, `proportion`,
  `total` and `ratio` (`proportion`'s `ll`/`ul` are the logit-scale interval its table shows).
- For the current model it's built from `e(b)`/`e(V)` with e(b)'s columns: equation names, base and omitted terms
  (b 0, rest missing), e(b)'s own ancillary parameters (`lnalpha`, `cut1`, `sigma`), not the transformed ones shown
  (`alpha`, `rho`). Other tables (`lincom`, `contrast`) use the displayed rows, and set their own r() afterwards.
- New estimates start with an empty r(), so a previous model's `r(table)` can't pass as theirs. Kept: a table the same
  command drew before posting (`xtlogit`, `gmm`, ...; rebuilt with e(b)'s names, tracked by a per-command counter in
  `Interpreter.execute`) and the r() of `margins`/`nlcom, post`.
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

Evidence:
- On the Card data `r(table)` has e(b)'s columns and its `b` row equals e(b) (exp(b) under `eform`) for `regress`,
  `logit` (and `, or`), `probit`, `poisson` (and `, irr`), `glm`, `nbreg`, `tobit`, `ologit`, `oprobit`, `mlogit`,
  `heckman`, `ivregress`, `areg`, `qreg`, `sureg`, `xtreg, fe`, `xtpoisson, fe`, `mean`, `proportion`, `total`, `ratio`
  (10 of these were wrong before the fixes).
- Stata 14 logs: `logit y x` labels e(V) `y:x y:_cons` (`0514_fweight_robust.log`), so ML models carry equation names;
  `lincom` leaves no `r(table)` (`0504_posestimacao.log`). That r(table) follows e(b)'s columns is documented, not
  checked in a log.
- stats.camp (a separate Stata-syntax engine, not Stata or OpenDTA, newer-Stata text, so no Stata 14 reference) agrees
  on a `mod()` probe: same estimates, only `r(table)` in r() after `summarize` then `regress`, `r(table)` after `mean`;
  its `logit` e(b) has no equation names, unlike Stata 14.

### PATCH-2: Break at safe points (dofile's own patch)
- Problem: the worker's SIGINT raised `KeyboardInterrupt` at any Python line. `append using t` on 4 million rows with a
  string column, interrupted by a timeout, returned rc 1; the next `summarize x` gave rc 9999 `operands could not be
  broadcast together with shapes (4000000,) (8000000,)`. The engine changes data in many places, so a command can't be
  rolled back after the fact.
- Patched (`opendta-patch2-safe-break.patch`): the SIGINT handler calls `core/brk.request()`, which only sets a flag.
  The interpreter takes the Break before each command and loop pass (`brk.at_command`), but not inside another engine
  command or `by`; `do`, `run` and `include` don't count as commands, since their lines are. Computations that leave
  the data alone or restore it in a `finally` take it at once (`brk.check`): `ml.maximize`'s iterations,
  `bootstrap`/`permute`/`jackknife` replications, Mata `for`/`while`/`do` loops, and `sleep` (now in 50 ms steps).
  A long command with no safe point that hasn't finished within the worker's 5 s grace is killed (rc 9998, data lost).
- Not covered: `simulate` (no `finally` restores the data), `statsby`, `rolling`, and optimizers outside
  `ml.maximize` (scipy's): these run to the end or hit the 5 s fallback.
- Test: `tests/test_break.py` requests the Break at the k-th engine line executed (`sys.settrace`) for many k across
  `append`, `sort`, `expand`, `bysort: replace`, `merge`, `drop`, `collapse`; the data must equal the state after a
  whole number of commands. Raising `KeyboardInterrupt` at the same points (the old behavior) left it half changed at
  7 of 60.

### PATCH-3: one hook for user file paths (dofile's own patch)
- For the web demo's path shim ([phase2-plan.md](phase2-plan.md), decision 2). OpenDTA has no single place that turns a
  file name into a path: about 25 sites in 18 files build one with `Path(t).expanduser()`.
- The patch adds `core/userpath.py` (`mapper`, `user_path(p)`) and calls `user_path` at each site, after the
  default extension (`.dta`, `.csv`, `.do`, ...) is added, so the mapper sees the file that will really be
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
In WebAssembly Python (Pyodide 314, numpy 2.4.6: `np.intp` is `int32`, `sys.maxsize` 2147483647) `expand` and `stsplit`
stopped with `TypeError: Cannot cast array data from dtype('int64') to dtype('int32') according to the rule 'safe'`
from `numpy/_core/fromnumeric.py` `repeat`: `np.repeat` needs its counts to convert to `intp` safely. Not a Stata
question; 64-bit CPython is fine. Any 32-bit Python would fail the same way, but dofile supports no other, so the patch
is dofile's own, not for upstream.
- The patch (`opendta-patch4-intp-counts.patch`, two lines): `commands/collapse.py` (`cmd_expand`):
  `copies = ...astype(np.intp)` instead of `np.int64`; `commands/stdata.py` (`cmd_stsplit`):
  `reps = np.ones(n, dtype=np.intp)`, whose later `reps[rows] = np.bincount(...)` covers both `np.repeat` calls. On
  64-bit `intp` is `int64`, so nothing changes there. Counts above 2^31 cannot exist in a 4 GiB address space.
- Found running the 98 Stata 14 comparison cases inside Pyodide with `compare.py` and the known-difference rules
  (`web/scripts/check-snapshot.mjs`; normal boot and snapshot start gave the same results). Eleven failed at their
  first `expand` or `stsplit`: `expand` in 0304_collapse, 1001_mixed, 1002_melogit, 1402_kappa_roc, 1601_epidemiology,
  1801_programming, 1902_multilevel, 1908_models2, 1909_other_suites and 1916_multilevel; `stsplit` in 1901_survival.
- **Other int64 sites: none else is affected.** In Pyodide's numpy 2.4.6 only five calls refuse an int64 array:
  `np.repeat` with an array of counts, `np.put`, `np.searchsorted(sorter=...)`, `np.choose` and `ufunc.reduceat`
  (indices). These accept it: fancy indexing and assignment, `np.take`, `np.bincount`, `np.add.at`, `np.delete`,
  `np.insert`, `np.split`, `np.unique(return_inverse=True)`, `np.lexsort`, `np.tile`, `reshape`, `np.arange`,
  `np.full`, `np.unravel_index`, `np.ravel_multi_index`, `np.take_along_axis` and `np.roll`. Of the engine's 96
  `int64` uses, the other `np.repeat` calls with counts (`lang/vexpr.py:68-69`, `commands/egen.py:59`,
  `commands/{roc,summarize,kappa}.py`) get `intp` counts (`flatnonzero`, `bincount`, `np.diff`, `astype(int)`), and
  the `reduceat` calls (`core/panelquad.py:48`, `estimation/mlcmd.py:872`) take `intp` indices (`cumsum` of a
  `bincount`). The engine never calls `np.put`, `np.choose` or `sorter=`. Not covered: calls inside scipy and
  statsmodels-style code given an engine int64 array, and numpy functions not probed.
- **Run in Pyodide, one process per case:** all 11 pass. Five (0304, 1002, 1402, 1801, 1909) with PATCH-4 alone; the
  other six (1001, 1601, 1901, 1902, 1908, 1916) then hit the 600 s limit on a second problem, `numpy.linalg` returning
  NaN instead of raising `LinAlgError` in Pyodide, and pass with `src/dofile/linalgshim.py` (`browser-engine.md`, "Open
  investigation").
- Related, not OpenDTA bugs: the same run found the optional packages `xlwt` (`.xls` output) and `pyreadstat` (SAS
  transport files, pre-Stata-13 `.dta`) missing; both are in the page now (`browser-engine.md`, "Known gaps in the
  browser engine").
