# OpenDTA issues (tracking sheet)

Problems found in the vendored OpenDTA engine (`src/dofile/_vendor/opendta`, commit in its `VENDORED` file):
bugs (ODT-*), missing features (GAP-*), and dofile's own patch to it (PATCH-1). **None of these are reported
upstream yet.** Each needs a hand check against real Stata by someone who knows it before anything is reported.
The "Expected in Stata" line in each entry's details is our reading of the Stata manual or of OpenDTA's Stata 14
reference logs (`tests_opendta/compat/expected/`), not a Stata run.

Status values: `unverified` (seen in dofile, Stata behavior not checked), `confirmed` (checked against Stata),
`reported` (issue opened upstream), `fixed upstream` (fixed in a commit we have not vendored yet), `vendored`
(the fix is in our copy), `patched` (fixed by a dofile patch in `scripts/patches/`, to report upstream), `known`
(a missing feature, not a bug). PATCH-1's status describes its own progress.
The repros were last run on 2026-11-04 in dofile (`dofile run` or the MCP server). The cps and panel data are
in `tests/conformance/data/`; the Card data is Wooldridge's public `card.dta` (Card 1995), not in the repo.

| ID | Symptom | Where it shows up | Status |
|---|---|---|---|
| ODT-1 | `regress` on a perfect fit crashes (ZeroDivisionError, rc 9999) | `tests/test_engine.py::test_odt_fixes` | patched |
| ODT-2 | `xtlogit, re` crashes on some data (OverflowError, rc 9999), even inside `capture` | probe `p04_xtlogit.do`, `::test_odt2_xtlogit_bounds_dont_overflow` | patched |
| ODT-3 | `_b[c.yrsed#2.sex]` does not parse (rc 198) | corpus `fv_b_int` (xfail) | unverified |
| ODT-4 | `confirm variable` on a missing variable returns rc 198, not 111 | corpus `capture_rc` (xfail) | unverified |
| ODT-5 | `%w.dg` ignores d: `%20.12g` prints 18 significant digits, `%12.4g` 10 | `::test_odt_fixes`; corpus `CHECK` lines use it | patched |
| ODT-6 | regressing a variable on its own interaction crashes (decimal InvalidOperation, rc 9999) | `::test_odt_fixes` | patched |
| ODT-7 | `graph export` refused by the sandbox prints a generic OS message, not the sandbox's reason | `tests/test_sandbox.py` | unverified |
| ODT-8 | backslash escapes `\$` and ``\` `` don't stop macro expansion | found 2026-11-04 (`dofile run` passes its path through a local instead) | unverified |
| ODT-9 | `ivregress` prints a long `Instruments:` list on one line instead of wrapping it at 80 columns | `::test_odt_fixes` | patched |
| ODT-10 | `graph bar ..., over(x, relabel(...))` ignores `relabel()` | `::test_odt10_relabel` | patched |
| ODT-11 | `by g: regress ...` refuses with rc 190 "regress may not be combined with by" | found 2026-11-04, no test | unverified |
| ODT-13 | bare `mean` (replay) refuses with rc 100 even right after `mean`; `estimates replay` works | found 2026-11-04, no test | unverified |
| ODT-12 | `nbreg` prints a NumPy warning (`invalid value encountered in sqrt`) computing alpha's standard error | `::test_odt_fixes` (smoke test; trigger checked on the Card data) | patched |
| ODT-14 | Stata code reaches Python's `eval()` (empty `__builtins__`, escapable): `arch ..., archmexp()` and `bayesstats` `{param}` expressions | `::test_safe_eval_allows_only_arithmetic`, `::test_stata_expressions_cannot_reach_python` | patched |
| GAP-2 | `estat firststage` after `ivregress` is not implemented (rc 321) | found 2026-11-04 (Card 1995 replication), no test | known |
| GAP-1 | community commands `reghdfe`, `esttab`, `outreg2` don't exist (not bugs) | corpus `hdfe_b_x1`, probes `p06_esttab.do`, `p07_outreg2.do` (xfail) | known |
| PATCH-1 | dofile patch: `r(table)` after every coefficient table (and `mean`/`proportion`/`total`/`ratio`), with e(b)'s columns, replacing r(); new estimates drop a stale one. Open: Stata check | `tests/test_engine.py::test_r_table_*`, `::test_new_estimates_drop_a_stale_r_table` | 5 of 6 fixed; needs Stata check |

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

### ODT-5: `%w.dg` ignores d
```stata
display %20.12g 1/3
display %12.4g 1/3
```
- dofile: ` .333333333333333315` (18 significant digits) and `.3333333333`.
- Expected in Stata: `.333333333333` and `.3333` (at most d significant digits). Source: [D] format.
- Patched (`opendta-odt5-odt6-number-formats.patch`): `format_value` passed only the width to `general()`, which
  implements `%w.0g`; d now caps the significant digits. `%w.0g` is unchanged.

### ODT-6: regression on its own interaction
```stata
use cps, clear
regress yrsed c.yrsed#i.sex
```
- dofile: rc 9999, `internal engine error: InvalidOperation`.
- Expected in Stata: estimates (an unusual model, but valid). Source: to check in Stata.
- Patched (`opendta-odt5-odt6-number-formats.patch`): the model is a numerically perfect fit, so F and t are
  ~1e14 to 1e29, and `%f` formatting crashed for values that need more than Decimal's default 28 digits; it now
  uses enough precision. To verify: how Stata 14 prints such huge F and t values (here they overflow the
  table's columns).

### ODT-7: `graph export` message under the sandbox
```stata
clear
set obs 5
gen x = _n
scatter x x
graph export "/tmp/nope.png", replace
```
- dofile: rc 603 with OpenDTA's generic text ("The operating system did not allow the file to be written...")
  instead of the sandbox's reason. Other file commands show the reason.
- Expected: rc 603 is right; the message is a dofile/OpenDTA interaction, not a Stata difference.
- Workaround: export inside the working directory.

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

### ODT-12: `nbreg` warning
`nbreg pos educ` on the Card data (`pos = round(exp(lwage-5))`) prints `RuntimeWarning: invalid value encountered
in sqrt` from `estimation/models2.py` (alpha's standard error). The estimates still come back; check whether
the standard error of `lnalpha` is missing where Stata would report one.
- Patched (`opendta-odt12-nbreg-boundary.patch`): `lnalpha` (-18.6, just above the -20 boundary test) had a
  negative variance; the square root is skipped and the row shows missing, as at the boundary. Still to verify:
  the LR test printed `chibar2(01) = 2.5e-03`; Stata 14 shows `%7.2f` and `0.0e+00` for an exact zero, so small
  positive values are unchecked (marked VERIFY in the code).

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
- Patched (`opendta-safe-expr.patch`): a restricted evaluator (`core/safe_expr.py`) allows numbers, the given
  names and functions, `+ - * / **` and unary minus; anything else is rc 198. `^` in `archmexp()` now works as
  power (it failed before).
- To report upstream as a security issue.

### GAP-2: `estat firststage`
`estat firststage` (first-stage F and partial R² after `ivregress`) returns rc 321 "subcommand estat
firststage is unrecognized". It's the standard weak-instrument check, so it's worth implementing upstream.
- Workaround: run the first stage with `regress endog instruments exog`, then `test instruments`.

### GAP-1: community commands
`reghdfe`, `esttab` and `outreg2` are SSC packages, not part of Stata, and OpenDTA doesn't implement them. Not
bugs; listed so the xfails have a home. Built-in alternatives: `areg`/`xtreg, fe` for one fixed effect,
`estimates table` for tables.

### PATCH-1: `r(table)` (dofile's own patch)
`scripts/patches/opendta-r-table.patch` gives OpenDTA Stata's `r(table)` (rows `b se t|z pvalue ll ul df crit
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
