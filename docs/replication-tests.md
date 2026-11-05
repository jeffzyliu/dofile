# Replication tests (paper replications through the MCP server)

End-to-end checks of dofile as an agent uses it: an agent replicates a published econometrics paper through
the `dofile` MCP server (`run_do`, `describe_data`, `get_matrix`, `get_file`) and compares its numbers with the
paper's. They complement the unit tests and the Stata 14 log comparison: they exercise whole workflows (reading
raw data, reshaping, several estimators, graphs, stored estimates) and show how the tool feels to an agent.

Three papers were run on 2026-11-04. All published numbers listed below were reproduced. The problems they
turned up are tracked in [opendta-issues.md](opendta-issues.md) (ODT-*, GAP-*, PATCH-1); most are fixed.

## How to run one

1. Start a session with the dofile MCP server (stdio, working folder = this repo).
2. Download the data into `.dofile/<paper>/` (gitignored). The sandbox only reads the working folder, `--read-dir`
   folders and code folders, and blocks network access, so download with `curl` outside dofile. Don't commit the
   data: the files belong to their authors.
3. Ask the agent to replicate the tables step by step and compare each number with the paper, then go through
   the checklist at the end of this page.
4. Record anything new in [opendta-issues.md](opendta-issues.md), with a repro.

## 1. Card & Krueger (1994), minimum wages: difference-in-differences

- Data: `https://davidcard.berkeley.edu/data_sets/njmin.zip` (23 KB). `public.dat` is whitespace-separated with
  `.` for missing; read it with free-format `infile` and the 46 names from `codebook`.
- Exercises: `infile`, `generate`, `tabstat, by()`, `preserve`/`reshape long`/`restore`, `regress` with factor
  variables and `vce(cluster)`, `ttest, unequal`, `display` formats.
- FTE = full-time + managers + 0.5 × part-time. Sample sizes: 410 stores, 331 NJ, 79 PA.

| Result | Paper | dofile |
|---|---|---|
| Mean FTE before / after, NJ | 20.44 / 21.03 | 20.44 / 21.03 |
| Mean FTE before / after, PA | 23.33 / 21.17 | 23.33 / 21.17 |
| Balanced-sample change NJ, PA, difference (Table 3) | 0.47 (0.48), −2.28 (1.25), 2.75 (1.34) | same |
| Table 4 (i) NJ dummy; (ii) + chain, ownership | 2.33 (1.19); 2.30 (1.20) | same |
| Table 4 (iii) GAP; (iv) + controls | 15.65 (6.08); 14.92 (6.21) | same |
| Table 4 (v) + region dummies | 11.91 (7.39) | 11.98 (7.42) |

Table 4's sample is 357 stores (valid FTE in both waves and a starting wage in both, closed stores kept). Column
(v) is within 0.07: the paper's region coding isn't fully specified (four dummies; we used centralj southj northj
pa1).

Watch for:
- Two stores share a `sheet` number, so `reshape long ..., i(sheet)` fails (rc 9, as in Stata). Use `_n` as the id.
- `preserve` then an error inside the same call: since 2026-11-04 each `run_do` call is a do-file scope, so the
  data is restored. Before, the next call's `preserve` failed with rc 621.

## 2. LaLonde (1986) / Dehejia & Wahba (1999), NSW job training: experiment vs. observational methods

- Data: `https://users.nber.org/~rdehejia/data/` `nsw_dw.dta` (28 KB), `psid_controls.dta` (111 KB),
  `cps_controls.dta` (706 KB). The server sometimes answers 503; retry (`curl --retry 3`).
- Exercises: `use`, `tempfile`/`save`/`append`, `foreach` with locals, `logit` + `predict`, `regress` with
  `pweight` and `vce(robust)`, factor interactions (`c.age#c.age`), `ttest`, `tabstat`, `graph box`,
  `twoway kdensity`, `twoway histogram`, `graph export`.
- Samples: 185 trainees, 260 experimental controls, 2,490 PSID, 15,992 CPS comparison men.

| Result | Paper | dofile |
|---|---|---|
| Experimental effect on 1978 earnings | 1,794.34 (632.85) | 1,794.34 (632.85) |
| Unadjusted, trainees vs PSID | −15,204.78 (1,154.61) | same |
| Unadjusted, trainees vs CPS | −8,497.52 (712.02) | same |
| With covariates: experiment / PSID / CPS | (spec-dependent) | 1,666 (677) / 67 (852) / 1,137 (628) |
| Propensity-score weighted (ATT), PSID / CPS | ~1,700 to 1,800 in the paper's matching estimators | 2,598 (908) / 1,826 (774) |

The last two rows use one reasonable specification each (DW's logit for the score, ATT weights on the common
support: 1,040 of 2,490 PSID and 3,856 of 15,992 CPS men kept). They aren't the paper's matching or
stratification estimators, so compare them for direction and size, not to the dollar.

Watch for:
- `%50` color opacity (`color(navy%50)`) is applied as transparency (ODT-16, patched); it is a Stata 15 feature, not Stata 14.
- Overlap histograms: about 80% (PSID) and 90% (CPS) of comparison men sit in the lowest score bin. That's the
  paper's point, not a bug.

## 3. Card (1995), college proximity: instrumental variables

- Data: Wooldridge's `card.dta`, `http://fmwww.bc.edu/ec-p/data/wooldridge/card.dta` (413 KB), 3,010 men. Its
  results are Wooldridge's Example 15.4.
- Exercises: `regress`, `test`, `ivregress 2sls`, `estimates store`/`restore`/`table`, scalars from `_b[]`,
  `graph bar (mean) ..., over()`, `collapse` + `twoway connected`, a coefficient plot with `rcap ..., horizontal`.

| Result | Published | dofile |
|---|---|---|
| OLS return to schooling | .075 (.003) | .0747 (.0035) |
| First stage, `nearc4` on `educ` | .320 (.088) | .3199 (.0879), F = 13.26 |
| Reduced form, `nearc4` on `lwage` | — | .0421 (.0181) |
| IV (2SLS) return to schooling | .132 (.055) | .1315 (.0548) |
| Wald check: reduced form / first stage | equals IV | .0421 / .3199 = .1315 |

Watch for:
- `estat firststage` isn't implemented (GAP-2, rc 321): use `regress educ nearc4 ...` then `test nearc4`.
- `[first]_b[nearc4]` is invalid in Stata too (brackets name an equation, not stored estimates); use
  `estimates restore first` then `_b[nearc4]`.
- The `Instruments:` footnote now wraps at 80 columns (ODT-9) and `over(..., relabel())` works (ODT-10); check
  both still hold.
- `nbreg` on `pos = round(exp(lwage-5))` reaches the alpha = 0 boundary (ODT-12): standard errors of
  `lnalpha`/`alpha` show as missing, and the LR statistic prints as `2.5e-03` (unverified against Stata).

## Third-party comparison: stats.camp

stats.camp (a separate Stata-syntax engine in WebAssembly; not Stata, not OpenDTA) ran the same small probe built
from `mod()` formulas, so no data download was needed. Estimates matched dofile to the 8th digit. It is not a
Stata 14 reference: it prints newer-Stata text (`Number of observations (_N) was 0, now 60.`) and leaves the
equation names off `logit`'s e(b), unlike Stata 14. Useful for a second opinion on behavior, not for formats.

## What to look out for

Numbers
- Sample sizes first (N, groups, treated/controls): most mismatches start there.
- Coefficients and standard errors to the paper's printed digits. Small differences usually mean a different
  specification (which dummies, which sample), not an engine bug; rule that out before filing one.
- Cross-checks that must hold exactly: DiD by means equals DiD by regression; Wald ratio equals IV.

Results the agent reads (`run_do`'s `results`)
- e() and r() are always the current state, after errors too; nothing is `null`. Matrices are listed by size
  (`"V": "16x16"`); values come from `get_matrix`.
- `r(table)` (PATCH-1): replaces r() after every estimation table, has e(b)'s columns (equation names such as
  `nearc4:educ`, ancillary parameters such as `lnalpha:_cons`), exists after `mean`/`proportion`/`total`/
  `ratio`, and never belongs to a previous model. A stale or mislabeled `r(table)` is the most dangerous kind of
  bug here: the numbers look right but belong to something else.
- After `lincom`/`nlcom`/`test`, r() holds their own results, not `r(table)`.

Log output (should look like Stata 14)
- Scientific notation as `1.000e+10`, not `1.00×10¹⁰` (superscript is off).
- `%w.dg` formats show at most d significant digits (`%12.4g` of 1/3 is `.3333`; ODT-5).
- No OpenDTA hint lines (`→ ... How to fix`) after errors in MCP sessions.
- Header and coefficient table layouts match the reference logs in `tests_opendta/compat/expected/`. Known open
  differences: huge F/t values overflow the table columns (ODT-6), `chibar2` for tiny values (ODT-12).

Session behavior
- Each `run_do` call is a do-file scope: `preserve`/`restore` and `tempfile`s belong in the same call; locals,
  data and estimates carry over.
- A failed line stops the rest of the call: check `rc`, `error_command` and the log before reading results.
- The MCP server process runs the code it started with: after changing dofile, start a new session.

Agent ergonomics
- Result size: an IV regression's results should be about 1 KB; the log carries the tables.
- The log keeps 8,000 characters (first and last 4,000) and each command's first 40 and last 15 lines; a short
  result between long outputs, or a loop's output, can be cut (ERG-1 in [agent-ergonomics.md](agent-ergonomics.md)).
  `log_file` names the full log for `get_file`.
- Graphs come back as images automatically; `graph export` only to keep a file.
- Community commands (`reghdfe`, `esttab`, `outreg2`) don't exist (GAP-1); use built-ins.

Engine gaps hit so far and still open: GAP-2 (`estat firststage`), ODT-11 (`by: regress`), ODT-13 (bare `mean`
replay), ODT-3 (`_b[]` with interaction names), PATCH-1 #6 (r(table) details unchecked against real Stata).
