# Replication tests (paper replications through the MCP server)

End-to-end checks of dofile as an agent uses it: an agent replicates a published econometrics paper through
the `dofile` MCP server (`run_do`, `describe_data`, `get_matrix`, `get_file`) and compares its numbers with the
paper's. They complement the unit tests and the Stata 14 log comparison: they exercise whole workflows (reading
raw data, reshaping, several estimators, graphs, stored estimates) and show how the tool feels to an agent.

Three papers were run on 2026-11-04, and two more (Lee, and Cheng and Hoekstra) on 2026-11-05. All published numbers listed below were reproduced. The problems they
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

## 4. Lee (2008), incumbency and House elections: regression discontinuity

Run 2026-11-05.
- Data: the Mixtape's copy of the Lee, Moretti and Butler (2004) House file,
  `https://github.com/scunning1975/mixtape/raw/master/lmb-data.dta` (7 MB, Stata 118 format, 13,588 rows, 178
  variables). It is not Lee's own file. The running variable is `lagdemvoteshare` minus 0.5 (the Democratic margin in
  the previous election); the outcomes are `demvoteshare` and `democrat` in the next one. 11 rows have a missing lag.
- Exercises: `gen` with `floor`, `regress` with `c.x#D` and `vce(cluster id2)`, `[pweight=]` with a triangular
  kernel, `ivregress` (fuzzy RD), `bootstrap`, `preserve`/`collapse`/`restore`, `histogram`, `lpoly`, `rcap`.

| Result | Lee (2008), from memory | dofile |
|---|---|---|
| Jump in next vote share, 4th-order polynomial | about 0.08 | 0.0861 (0.0104), N 13,566 |
| Jump in win probability, 4th-order polynomial | about 0.4 to 0.5 | 0.3996 (0.0389) |
| Local linear, vote share, h = 0.05 / 0.10 / 0.15 / 0.25 | | 0.0921 (0.0115) / 0.0949 (0.0086) / 0.0969 (0.0075) / 0.0970 (0.0064) |
| Local linear, win probability, same h | | 0.4761 / 0.4241 / 0.4437 / 0.5064 |
| Fuzzy RD, effect of winning on next vote share, h = 0.15 | | 0.2013 (0.0126) |

The published values are not checked against the paper's text. The jump is about 0.09 to 0.10 across bandwidths, and
the bandwidth plot is flat from 0.05 up. The histogram of the margin has spikes at -0.5 and +0.5: uncontested races.

Watch for:
- `lagscore` is not a placebo: it is the previous incumbent's score and jumps by 48 at the cutoff (a predetermined
  covariate such as `realincome` or `pcturban` would be).
- `twoway lpoly`/`lpolyci` fail (GAP-4); `ssc install` and `rdrobust` are not recognized (ERG-8).
- A long log lost the `D` coefficient row (ERG-7).

## 5. Cheng and Hoekstra (2013), castle doctrine laws: panel fixed effects and event study

Run 2026-11-05.
- Data: `https://github.com/scunning1975/mixtape/raw/master/castle.dta` (0.5 MB, Stata 118 format): 50 states, 2000
  to 2010, 550 rows, 185 variables. 21 states adopted between 2005 and 2009 (`effyear`); `post` is the treatment,
  `popwt` the population weight.
- Exercises: `xtset`, `xtdescribe`, `xtreg, fe`, `areg`, `regress` with `i.sid`, `[aweight=]`, `vce(cluster)`, factor
  years, event-study dummies built in a loop, `testparm`, `collapse`, `rcap`, `graph bar (count)`.

| Result (outcome `l_homicide`, weights `popwt`, clustered by state) | dofile |
|---|---|
| State and year effects, `xtreg, fe` | 0.0755 (0.0332) |
| Same, `areg` / `regress` with `i.sid` (same coefficient, different degrees-of-freedom factor) | 0.0755 (0.0348) |
| + region-by-year effects / + state linear trends / + time-varying controls (`xtreg, fe`) | 0.0857 (0.0263) / 0.0670 (0.0319) / 0.0821 (0.0268) |
| Falsification: `l_larceny`, `l_motor` | 0.0012 (0.0142), 0.0414 (0.0485) |
| Event study (weighted `regress` with `i.sid`, leads -5 to -2, lags 0 to 4) | leads 0.028 to 0.053, lags 0.046, 0.124, 0.113, 0.109, 0.097 |
| Joint test of the four leads | F(4, 49) = 1.37, p = 0.26 |

The paper reports about 8 percent more homicide (from memory, not checked); the estimates are 0.067 to 0.086. Before
the ODT-24 patch `xtreg, fe` and `areg` ignored the weights and gave 0.0694 (0.0559) for the first row. `areg`'s standard
error (0.0348) is above `xtreg`'s (0.0332) because `areg` counts the 49 absorbed effects in its small-sample factor,
as in Stata.

Watch for:
- `describe, short` printed a wrong `Sorted by:` list for this file before the ODT-25 patch.
- `pop` is an ambiguous abbreviation here (ERG-9).
- Never-adopting states have a missing `effyear`, so `rel = year - effyear` is missing for them; their event-time
  dummies must be 0 (not missing) or `regress` drops them.

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
- e() and r() are what Stata would hold, after errors too; nothing is `null`. `e()` survives `clear`, and `r()` survives
  `clear`, `estimates restore` and a failed command. `results.e_changed`/`r_changed` say whether the last call changed
  each. Matrices are listed by size (`"V": "16x16"`); values come from `get_matrix`.
- `r(table)` (PATCH-1): replaces r() after every estimation table, has e(b)'s columns (equation names such as
  `nearc4:educ`, ancillary parameters such as `lnalpha:_cons`), exists after `mean`/`proportion`/`total`/
  `ratio`, and a new estimation never inherits an earlier one's `r(table)`. Like any r() it is left alone by
  `estimates restore`, `clear` and failed commands (as in Stata, not run there), so after `estimates restore` it can
  still be the table of an earlier command: check `r_changed`, or replay the model (`ivregress` with no arguments) to
  rebuild it. A table that does not match `e(b)` (its column count differs) is the most dangerous kind of bug
  here: the numbers look right but belong to something else.
- After `lincom`/`nlcom`/`test`, r() holds their own results, not `r(table)`.

Log output (should look like Stata 14)
- Scientific notation as `1.000e+10`, not `1.00×10¹⁰` (superscript is off).
- `%w.dg` formats show at most d significant digits (`%12.4g` of 1/3 is `.3333`; ODT-5).
- No OpenDTA hint lines (`→ ... How to fix`) after errors in MCP sessions.
- Header and coefficient table layouts match the reference logs in `tests_opendta/compat/expected/`. Known open
  differences: huge F/t values overflow the table columns (ODT-6: the crash is patched, how Stata prints them is
  unchecked), `chibar2` for tiny values (ODT-12).

Session behavior
- Each `run_do` call is a do-file scope: `preserve`/`restore` and `tempfile`s belong in the same call; locals,
  data and estimates carry over.
- A failed line stops the rest of the call: check `rc`, `error_command` and the log before reading results.
- The MCP server process runs the code it started with: after changing dofile, start a new session.

Agent ergonomics
- Result size: an IV regression's results should be about 1 KB; the log carries the tables.
- A log under about 12,000 characters comes back whole. A longer one has its biggest blocks of output cut first (to
  40 + 15 lines, then to 5 + 3), so short results stay; `log_omitted_lines` says how many lines are missing and
  `log_file` names the full log for `get_file` (ERG-1 in [agent-ergonomics.md](agent-ergonomics.md)). In a loop use
  `quietly` and `display` what you need.
- `results.e_changed`/`r_changed` say whether the call changed e()/r(); a `false` is left from an earlier call.
- Graphs come back as images automatically; `graph export` only to keep a file.
- Community commands (`reghdfe`, `esttab`, `outreg2`) don't exist (GAP-1); use built-ins.

Engine gaps hit so far and still open: GAP-2 and GAP-3 (`estat firststage`, `endogenous`, `overid`), ODT-11 (`by:
regress`), the leftovers of ODT-16/17 (colour lists, CMYK, `ring()`), PATCH-1 #6 (r(table) details unchecked against
real Stata). The others found by these replications are patched (see [opendta-issues.md](opendta-issues.md)).
