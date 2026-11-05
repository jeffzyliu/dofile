# OpenDTA issues (tracking sheet)

Problems found in the vendored OpenDTA engine (`src/dofile/_vendor/opendta`, commit in its `VENDORED` file), and
dofile's own patch to it. **None of these are reported upstream yet.** Each needs a hand check against real Stata
by someone who knows it, before anything is reported. The "Expected in Stata" column is our reading of the
manual, not a verified Stata run.

Status values: `unverified` (seen in dofile, Stata behavior not checked), `confirmed` (checked against Stata),
`reported` (issue opened upstream), `fixed upstream` (fixed in a commit we have not vendored yet), `vendored`
(the fix is in our copy). The repros were last run on 2026-11-04 with `dofile run`. The cps and panel data are
in `tests/conformance/data/`.

| ID | Symptom | Where it shows up | Status |
|---|---|---|---|
| ODT-1 | `regress` on a perfect fit crashes (ZeroDivisionError, rc 9999) | `tests/test_engine.py` (internal crash) | unverified |
| ODT-2 | `xtlogit, re` crashes on some data (OverflowError, rc 9999), even inside `capture` | probe `p04_xtlogit.do` (xfail) | unverified |
| ODT-3 | `_b[c.yrsed#2.sex]` does not parse (rc 198) | corpus `fv_b_int` (xfail) | unverified |
| ODT-4 | `confirm variable` on a missing variable returns rc 198, not 111 | corpus `capture_rc` (xfail) | unverified |
| ODT-5 | `%20.12g` prints 18 significant digits instead of 12 | corpus `CHECK` lines use it | unverified |
| ODT-6 | regressing a variable on its own interaction crashes (decimal InvalidOperation, rc 9999) | found 2026-11-04, no test | unverified |
| ODT-7 | `graph export` refused by the sandbox prints a generic OS message, not the sandbox's reason | `tests/test_sandbox.py` | unverified |
| GAP-1 | community commands `reghdfe`, `esttab`, `outreg2` don't exist (not bugs) | corpus `hdfe_b_x1`, probes `p06_esttab.do`, `p07_outreg2.do` (xfail) | known |
| PATCH-1 | dofile patch: `r(table)` after every coefficient table | `tests/test_engine.py::test_r_table_after_estimation` | needs expert check |

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
- Workaround: none; avoid exact fits.

### ODT-2: `xtlogit, re` overflow
```stata
use panel, clear
xtset id year
xtlogit d x1 x2, re
```
- dofile: rc 9999, `internal engine error: OverflowError: math range error` (in `math.exp`). Not caught by
  `capture`, because it isn't a Stata error. Other data can run fine.
- Expected in Stata: estimates, or a convergence message with a Stata return code. Source: [XT] xtlogit.
- Workaround: none known.

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

### ODT-5: `%20.12g` ignores the precision
```stata
display %20.12g 1/3
```
- dofile: ` .333333333333333315` (18 significant digits).
- Expected in Stata: `      .333333333333` (12 significant digits, right-aligned in 20). Source: [D] format.
- Workaround: none needed for dofile's own checks (results JSON has full precision); visible in logs.

### ODT-6: regression on its own interaction
```stata
use cps, clear
regress yrsed c.yrsed#i.sex
```
- dofile: rc 9999, `internal engine error: InvalidOperation`.
- Expected in Stata: estimates (an unusual model, but valid). Source: to check in Stata.
- Workaround: none; low priority.

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

### GAP-1: community commands
`reghdfe`, `esttab` and `outreg2` are SSC packages, not part of Stata, and OpenDTA doesn't implement them. Not
bugs; listed so the xfails have a home. Built-in alternatives: `areg`/`xtreg, fe` for one fixed effect,
`estimates table` for tables.

### PATCH-1: `r(table)` (dofile's own patch)
`scripts/patches/opendta-r-table.patch` makes every coefficient table set `r(table)`: rows `b se t|z pvalue ll
ul df crit eform`, one column per coefficient, following `e(b)`'s columns (including base levels and base
outcomes that the table hides). The Stata 14 comparison still passes with it. **Needs an expert check** against
real Stata's `r(table)`, especially:
- `eform` models (`logit, or`, `poisson, irr`): which rows are exponentiated, and `se` on that scale;
- multi-equation models (`mlogit`, `heckman`, `ivregress` first stage): column order and equation names;
- base and omitted levels: zeros and missing values in each row;
- `df` and `crit` for z-statistics versus t-statistics.
If OpenDTA adds `r(table)` itself, drop the patch.
