# dofile web demo: known gaps in the browser engine

What the engine's checks inside Pyodide found, what was fixed and what is still open.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged.

## Known gaps in the browser engine

Found 2026-11-07 by running the engine's checks inside Pyodide (`web/scripts/check-snapshot.mjs`, `npm run
check-snapshot`; details in [pyodide-snapshot.md](pyodide-snapshot.md#correctness-checks)): the conformance corpus
(63 value checks against `ref.json`, 12 probes including graphs), 13 calls into the native libraries, and the 98
Stata 14 reference cases of `tests_opendta/compat` through the repo's own `compare.py` and its known-difference rules.

**Where things stand (2026-11-07), what is open.** The details are in the paragraphs and tables below.
- **Packages Pyodide lacks: none that matter, since 2026-11-09.** `xlwt` and `xlrd` (legacy `.xls`; `.xlsx` always worked through
  openpyxl) are now core dependencies of dofile, pure Python, so micropip installs them with the wheel. `pyreadstat` (SAS
  transport, Stata 7 and older `.dta`, SPSS) has no Pyodide build, so `web/wheels/` holds one we compiled (pyreadstat 1.3.6 with
  Emscripten; recipe `web/wheels/pyreadstat/`), installed after the dofile wheel. Pandas is left out on purpose (7 MB in the
  snapshot, 1.9 s on a cold 30 Mbps start): every read works, and `export sasxport`, the one command that needs it, stops with
  rc 199 (ODT-32). Still missing, and not needed: statsmodels (5 of OpenDTA's tests compare against it), Qt and
  certifi (OpenDTA's GUI and updater).
- **numpy.linalg corners not covered by the shim:** the SVD family (`svd`, `pinv`, `matrix_rank`, `lstsq`) on NaN or inf
  input returns NaN or raises `ValueError` where CPython raises `LinAlgError`; `matrix_power(singular, -1)`, `tensorsolve` and
  `tensorinv` return NaN. None was shown to matter (missing values are dropped before a design matrix is built).
- **ODT-30 (OpenDTA, not a browser problem):** the optimizer's Newton step from a nearly singular numerical Hessian makes a few
  fits (`gnbreg`, 1901 `streg`, 1907 `tnbreg` and `zinb`, 1905 `xtfrontier`, 1908 `asmprobit`) end in different places on
  different platforms. Recorded, no fix.
- **Numbers differ in the last bits** (libm functions: `rnormal`, `invnormal`, `lngamma`, `chi2`; `runiform` and the integer
  generators are bit-identical), so simulated data is not bit-identical across platforms.
- **Speed:** cases take 1.5–5 times as long as on CPython (1908_models2: 139 s against 66 s, the CPython time taken while the machine was busy).
- **Not covered by any check:** Break on a long model fit in the browser; `1920_models4` (no Stata log); the dofile tests that
  need subprocesses or the `mcp` package, which do not apply in a page.

**Results after PATCH-4 and the `numpy.linalg` shim (2026-11-07).** `check-snapshot --normal` (one process per case, four at a
time): **95 of 97 cases pass in 200 s**, none timed out or crashed, and the corpus (63 checks), the 12 probes and the 13
native-library calls are clean. The two that differed were the package gaps in the table below (1701: `xlwt`; 1911:
`pyreadstat`; since 2026-11-09 **95 of 97 pass directly in 157 s** and the other two differ only at `export sasxport`, see below). The count is 97, not 98, because `1920_models4` has no Stata reference log. The snapshot start gives the same
result (95 of 97 in about 150 s; [pyodide-snapshot.md](pyodide-snapshot.md#correctness-checks)).

**The unit tests in Pyodide** (`npm run check-pytest`; one process per file, 72 files, 128 s; compared with CPython test by test
by `compare-pytest.mjs`): OpenDTA's suite and `tests/test_engine.py`, 1080 tests. CPython: 1067 passed, 13 skipped. Pyodide:
1048 passed, 31 skipped, 1 failed. **Of the 19 that differ, none is an engine problem:** 18 skip for lack of `pyreadstat`,
`xlwt` or `xlrd`, and 1 fails because `shell` cannot start a process in the browser. The other 1,061 have the same outcome.
With the packages installed and no pandas (2026-11-09): 1060 passed, 24 skipped, 1 failed (`shell`); with pandas, 1067 / 13 / 1,
the same as CPython.
Not run in Pyodide because they need subprocesses, the `mcp` package or the source tree: `test_mcp`, `test_worker`,
`test_sandbox`, `test_break`, `test_dofile_cli`, `test_vendor`, `test_log_cut`, `test_browser`, and the two replaced by other
checks (`test_conformance` and `test_stata_compat` by `check-snapshot`; `test_pathshim` and `test_linalgshim` by
`web/test/engine.test.mjs` and `linalgshim.test.mjs`). The slowest tests take 1.5–2.4 times as long as on CPython. The unit
tests only reach what they assert on, so a silent numeric difference elsewhere would not show; that is what the next check is for.

**Numbers, CPython against Pyodide** (`npm run check-numeric`; `numeric_probe.py` records e() and r() after every command that
changes them, at full double precision, for all 98 Stata 14 programs; `compare_numeric.py` diffs the runs; CPython here is
macOS arm64, so one libm and LAPACK, not all of them):
- **109,265 numbers:** 47.3% bit-identical, 84.6% agree to 1e-12, 92.4% to 1e-9, 97.8% to 1e-6. Matrix cells are judged against
  the matrix's largest entry. Much of the rest is noise around exact zero (`e(gradient)` at convergence, means of residuals).
- **Random numbers.** `runiform` and the integer generators are bit-identical. Anything through a math library differs in the
  last bits (`rnormal` and `invnormal` up to 4 ulp, `lngamma` up to 4096), so simulated data is not bit-identical across
  platforms (`datasignature` differs in 1902 and 1916). Another libm (CPython on Linux) would probably differ from macOS too.
- **Estimates.** Of 1110 results, `e(b)` agrees to 1e-9 in 95.1%, to 1e-6 in 98.3%, to 1e-3 in 99.5%. The 6 above 1e-3 are
  fits the data does not pin down (ODT-30): 1901 `streg`, 1907 `tnbreg` and `zinb`, 1905 `xtfrontier` (same log likelihood to
  8 digits, different parameters at a boundary), 1907 `gnbreg` (below), 1908 `asmprobit` (a simulated likelihood).
- **Logs.** 823 lines differ only in a printed digit; lines that differ in their text are confined to the cases above and the two
  package-gap cases.
- **What this shows:** the same answers to the printed digits, except where the answer is not pinned down, which can land
  elsewhere on either platform. It does not say which platform is closer to Stata there; those cases pass under their
  known-difference rules.

**`gnbreg` in 1907_models: path-sensitive on CPython too, not a Pyodide problem** (the issue is ODT-30 in
[opendta-issues.md](opendta-issues.md)).
- `gnbreg cnt x1 x2, lnalpha(x3)` ends on CPython at ll -878.310297 in 7 iterations, equal to the Poisson log likelihood
  (alpha about 1e-10). That is the boundary alpha = 0, where the score for `lnalpha` vanishes: a false convergence, since the
  likelihood can still be raised. Stata's log ends at -878.31024 after many "(backed up)" iterations.
- In Pyodide with the shim the fit leaves the boundary and creeps upward (ll -878.2943 at 300 iterations; 3000 tried), never
  meeting the stopping rule. Without the shim it converged at the boundary like CPython; the shim made the non-concave branch
  run, as it does on CPython, and the path went elsewhere.
- On CPython a tiny perturbation does the same: scaling the analytic derivatives by (1 + r u), u uniform(-1,1), 8 seeds per r:
  r = 0 gives -878.3103 every time; r = 1e-13 one run that does not converge; r = 1e-11 one that converges to **-878.1424**
  (0.17 above the boundary); r = 1e-9 five different outcomes. Platform differences in the derivatives are 1e-13 to 1e-10,
  so a different outcome on another platform is expected.
- The constant-only `gnbreg` model is stuck in the non-concave branch on both platforms (ll -959.397 on CPython, -957.390 in
  Pyodide, against -952.7455 in Stata), so `ll_0` and `Pseudo R2` differ from Stata's; the case passes by its known-difference rule.
- A fix would be in the optimizer's non-concave step (`ml.maximize`: a multiple of the identity is added when `cholesky(-H)`
  fails), not in the browser engine. Not done.

**The gaps found before the two fixes**, the same in the normal boot and the snapshot start (so none comes from the snapshot or
its stripped docstrings): 16 of the 91 cases then run failed.

| Gap | Cases | Cause | What to do |
|---|---|---|---|
| **`expand` and `stsplit` fail** | 11: 0304_collapse, 1001_mixed, 1002_melogit, 1402_kappa_roc, 1601_epidemiology, 1801_programming, 1901_survival, 1902_multilevel, 1908_models2, 1909_other_suites, 1916_multilevel | `np.repeat` gets an int64 counts array and numpy's index type is int32 in WebAssembly (PATCH-4 in [opendta-issues.md](opendta-issues.md)) | **fixed 2026-11-07** by PATCH-4 (two call sites; no other int64 site fails). All 11 pass; 6 of them (1001, 1601, 1901, 1902, 1908, 1916) needed the `numpy.linalg` shim as well, since with PATCH-4 alone they passed `expand` and then hit the 600 s limit |
| legacy `.xls` input and output (`.xlsx` was never affected) | 1 (1701_datamgmt_options) | `putexcel` and `export excel` to `.xls` need `xlwt`, `import excel` of `.xls` needs `xlrd`; neither was in the page | **fixed 2026-11-09**: both are core dependencies of dofile now (pure Python; micropip installs them with the wheel, about 0.1 s). 1701's `.xls` lines match Stata 14 |
| SAS transport files, SPSS and Stata 7 `.dta` | 1 (1911_datamgmt) | `export sasxport`, `import sasxport`, `import spss` and old `.dta` files need `pyreadstat`, a C extension with no Pyodide build | **fixed 2026-11-09**: built with `pyodide-build` (pyreadstat 1.3.6: 1.3.7 returns empty strL values, on CPython too), `web/wheels/pyreadstat-*.whl`, committed. All reads work; `export sasxport` needs pandas, which the page leaves out (7 MB), so it stops with rc 199 and 1701 and 1911 stay in `EXPECTED_DIFFER` (they match with `--pandas`) |
| Numeric known differences | 3: 0408_mata_moptimize, 1907_models, 1918_models3 | in Pyodide they left a difference beyond their known-difference rule, with more log lines than Stata's (the extra line in 0408 was `convergence not achieved`), and ran 20–500 times slower than on CPython: one shared cause | **fixed 2026-11-07** by the `numpy.linalg` shim ([Open investigation](#open-investigation-model-fits-take-far-longer-in-pyodide)): all three pass, in 2.1 s (0408, was 204–220 s), 7.5 s (1907, was 25 s) and 4.2 s (1918, was 17 s), under the same rules as CPython |

**The two package-gap cases (1701_datamgmt_options, 1911_datamgmt), 2026-11-09.** With pandas loaded both match their Stata 14 logs
line for line (`node scripts/check-snapshot.mjs --normal --pandas --cases 1701_datamgmt_options,1911_datamgmt`). The page does
not load pandas (see below), so `export sasxport` stops with rc 199 (ODT-32) and what follows in these two cases differs; they are in
`EXPECTED_DIFFER` in `web/scripts/check-snapshot.mjs`, a strict xfail (it fails if one starts to pass), with `--pandas` as the
exact check. The rest of what they cover, `.xls` and the ReadStat reads, is checked by the unit tests and the e2e test. What was done:
1. **`xlwt` and `xlrd`:** pure Python wheels on PyPI; they install in Pyodide through micropip in about 0.1 s. They became core
   dependencies of dofile (`pyproject.toml`), so the CLI and the MCP server get `.xls` too, and the page needs no code for them.
2. **`pyreadstat`:** no Pyodide build exists, so `web/wheels/pyreadstat/build.sh` compiles one (a 614 KB wheel; Cython plus
   ReadStat C, zlib from Emscripten's port, a two-line `setup.py` patch for the link flags). The page, `make-snapshot.mjs` and the
   Node checks install it after the dofile wheel through `web/scripts/install-engine.mjs`. The version is 1.3.6, the cap in the dev
   group: 1.3.7 gives empty values for long strings (strL) in `read_dta`, on CPython as well (`test_readstat_reads_ours[119]`).
3. **No pandas, on purpose.** `pyreadstat` reads SAS transport and SPSS without it; only `export sasxport` needs
   it. Pandas is 6.9 MB of the 48.6 MB snapshot and 1.9 s of a cold 30 Mbps snapshot start
   ([pyodide-snapshot.md](pyodide-snapshot.md#packages-added-xlwt-xlrd-and-pyreadstat-not-pandas-2026-11-09)). The snapshot is 41.6 MB.
4. **Checked** (Node, and Chromium, Firefox, WebKit and the iPhone profile for the e2e test): 95 of 97 Stata 14 cases directly
   plus the two expected differences, on a normal boot and on a snapshot start; 1060 passed / 24 skipped / 1 failed (`shell`) of the
   unit tests (11 skip for pandas); an e2e test that writes and reads `.xls`, reads a `.xpt` and a `.sav`, and checks the
   `export sasxport` refusal. Not done: a real iPhone.

The snapshot check found one bug of the snapshot's own, fixed: after a restore, `scipy.linalg.solve` crashed with `cannot
resolve symbol dsytrf_` (see [pyodide-snapshot.md](pyodide-snapshot.md#correctness-checks)).

### Open investigation: model fits take far longer in Pyodide

Status: **cause found and fixed 2026-11-07** (`src/dofile/linalgshim.py`, installed by `browser.start()`). Before the fix,
three of the Stata cases (`0408_mata_moptimize`, `1907_models`, `1918_models3`) ran 20–500 times slower than on CPython and
failed their known-difference rules, and six more hit the 600 s limit after PATCH-4.

**Cause: `np.linalg.cholesky`, `inv` and `solve` do not raise `LinAlgError` in Pyodide's numpy (2.4.6); they return NaN.**
Checked on `[[1,2],[2,4]]` (singular) and on `-I` (not positive definite): CPython raises, Pyodide returns NaN arrays.
`scipy.linalg.cholesky`, `inv`, `solve` and `cho_factor` raise correctly in both. (Probable reason, not checked: numpy reports
these failures through the floating-point "invalid" flag, which WebAssembly cannot set or read.) The engine has 95
`LinAlgError` references in 46 files, so every fallback that depends on that exception was dead in the browser, silently.
- **How it was found** (`1001_mixed`: 0.3 s on CPython, killed at 600 s in Pyodide). `ml.maximize` tests concavity with
  `try: np.linalg.cholesky(-H) / except LinAlgError`; in Pyodide that never raises, so it skipped the non-concave correction
  and took the plain Newton step, the wrong way along a positive-eigenvalue direction. No trial point improved until the step
  was tiny, and the loop then accepted gains of about 4e-10 per iteration up to its 16,000-iteration limit (19,692 `loglik`
  calls in 30 s, against 246 in total on CPython).
- **Confirmed by a shim:** with `cholesky`, `inv` and `solve` wrapped to raise, `1001_mixed` runs in 1.7 s. Random noise of
  up to 1e-12 added to `loglik` on CPython does not change its path, so platform rounding is not what stalled the fit.
- **The fix:** `src/dofile/linalgshim.py`, not an edit of the vendored engine. It runs the three functions on a matrix that must
  fail and wraps only those that do not raise, so it does nothing on CPython and switches itself off if numpy is fixed. The
  wrapper raises `LinAlgError` when the inputs have no NaN and the result has one. The engine looks up `np.linalg.X` at call
  time, so replacing the attribute reaches it (a CPython test fails if a `from numpy.linalg import` appears). Tests:
  `tests/test_linalgshim.py` (CPython, against simulated NaN behaviour) and `web/test/linalgshim.test.mjs` (real Pyodide).
- **Results in Pyodide with the shim:** 9 of 9 slow cases pass, none times out (141 s with 4 at a time): 0408 2.1 s, 1907 7.5 s,
  1918 4.2 s, 1001 2.6 s, 1601 2.8 s, 1901 2.7 s, 1902 29.7 s, 1916 40.8 s, 1908 138.7 s. That is 1.5–5 times CPython's time.
- **Other `numpy.linalg` functions** (102 probes of 28 functions on singular, zero, NaN, inf, indefinite and huge matrices;
  74 identical). `det`, `slogdet`, `qr`, `norm`, `eigh` and `eigvals` agree. Differences:
  - `matrix_power(singular, -1)`, `tensorsolve` and `tensorinv` return NaN instead of raising (they call `inv` and `solve`
    through numpy's own namespace, so the shim does not reach them; the engine uses `matrix_power` 3 times, the others never).
  - The SVD family (`svd`, `pinv`, `matrix_rank`, `lstsq`) on non-finite input returns NaN or 0, or raises `ValueError`, where
    CPython raises `LinAlgError`. Not shimmed: only about 7 engine calls sit in a `try ... except LinAlgError`, and they see
    non-finite input only if missing values reach a design matrix, which estimation commands drop first. A shim for these four
    would match CPython if a case turns one up.
  - Numbers on near-singular input differ in the last digits (a different LAPACK build): `pinv([[1,1],[1,1+1e-14]])` has
    entries 1.0060e14 on CPython and 9.95e13 in Pyodide. Only exactly or nearly collinear regressors can show it.

Not tried: Break on a long fit in the browser.

## The memory cap (phones)

iOS kills the tab when the engine's WebAssembly heap grows past what it allows (seen near 1 GB on an iPhone; WebKit never
answers a failed `memory.grow`, it kills or reloads). So on phones the engine never asks: the heap is capped, and a big
allocation fails inside Python as `MemoryError`, which OpenDTA's ODT-28 patch turns into r(909) "op. sys. refuses to provide
memory". The run ends with an ordinary error, the data stays, and the next command runs.

- **How.** This Pyodide builds its memory inside `pyodide.asm.wasm` (480 pages to 4 GB), so `INITIAL_MEMORY`, `MAXIMUM_MEMORY`
  and `wasmMemory` cannot cap it. What can be capped is malloc's growth: the loader's `emscripten_resize_heap` refuses a request over
  `getHeapMax()` and clamps its own over-growth to it. `snapshot.ts` (`HEAP_MAX`) patches the loader's text,
  `getHeapMax=()=>4294901760` becoming `getHeapMax=()=>Module["dofileHeapMax"]??4294901760`; the worker sets `dofileHeapMax`
  in the module's configuration before it starts the module (`withHeapCap`). The patch is in `patchAsm`, so the snapshot's
  loader has it (the build sets no cap: 4 GB as before) and a snapshot start reads the cap from the page. The normal boot
  (`?snapshot=0`) imports Pyodide's own loader, so with a cap the worker fetches `pyodide.asm.mjs` from the runtime's URL, applies
  the same one-line patch and imports it as a blob (`importCapped`); with no cap it is untouched. The snapshot restore's own
  `growMemory` bypasses the cap, so a cap below the restored heap (130 MB) does not stop the start but leaves no room to work.
  A wrapper over `instantiateWasm` that replaces `emscripten_resize_heap` also works, but it cannot stop Emscripten's own
  over-growth (up to 96 MB past the request), which a cap near 1 GB cannot spare.
- **Which devices** (`engine/memcap.ts`, by device, never by layout width): 750 MB (`PHONE_CAP_MB`) when the user agent has
  iPhone, iPad or iPod, or says Macintosh with `navigator.maxTouchPoints > 1` (an iPad asking for the desktop site; every iOS
  browser is WebKit), or `navigator.userAgentData.mobile` is true, or `navigator.deviceMemory` is 4 or less. Anything else has no
  cap (the browser's own limit). `?memcap=<MB>` in the URL overrides it either way (0: no cap), to try a cap on a real phone or a
  desktop; a value that is not a whole number is ignored. The page logs one line at start: `[dofile] engine memory cap: 750 MB,
  iOS or iPadOS`. The Playwright iPhone profile has an iPhone user agent, so the e2e tests of that project run under the 750 MB cap.
- **The ballast** (`browser.py`): a 20 MB `bytearray` kept in reserve. When the heap is full even the interpreter's error handling
  and the next call's compile need room; a script that filled the heap with small objects left every later `runPython`
  failing with "lost sys.stderr", so the session could not recover until a reset (the same hazard exists at the 4 GB limit; the
  cap does not cause it). Where the heap fills is chance: in a command (a MemoryError there is r(909), ODT-28), or in the
  interpreter's own work between commands (a loop's next pass; Python looking up a module file, which WebAssembly's file
  system fails as `OSError` ENOMEM). The engine answers the second kind as r(909) too, and calls `Engine.on_memory_error`
  first, where `browser.py` frees the ballast, so that the error report and the page's next calls (memory, describe,
  browse) have room; before this the run was rc 9999 and, with the ballast still held, could end as "PythonError: Error in
  sys.excepthook: MemoryError". A MemoryError that still escapes the engine (the heap filled again while it reported the
  first) is caught in `browser.run`, which frees the ballast and answers r(909). A run that ends in rc 909 frees it too, and
  the next run takes it again if it can. A big numpy request that is refused (the usual case) leaves the free memory as it
  was and needs none of this. It adds 20 MB to the heap's baseline on every device. Checked on the engine in Pyodide
  (`web/test/engine.test.ts`: globals filled with 1000-character strings under a 400 MB cap, then more passes on the full
  heap): the data and macros stay, and the page's calls after a failed run answer. Only the ballast is freed, never the user's
  data or macros.
- **What a cap buys.** The heap is 3.5 to 6 times the data (80 MB column: the heap went 196 to 516 MB in `generate double x1 = 1` on
  10 million rows; 320 MB of data took 1.1 GB in all), because `generate` and `replace` copy a column, and wasm memory never
  shrinks. So the cap holds much less data than its size (on an iPhone 13, below). Fewer copies in `generate` is the lever, and is not done.
- **Measured on an iPhone 13 (2026-11-13, by the maintainer, with `?memcap=` and 40 MB `generate double` steps):** cap 600:
  r(909) at 360 MB of data, and an occasional crash after other runs in the same tab (memory outside the engine's heap, or a
  leak: not looked into); cap 750 and 800: r(909) at 520 MB; cap 830: the tab crashed at 560 MB; cap 900: crashed near 560 MB.
  So the phone default is 750 MB (`PHONE_CAP_MB`), below the 800 to 830 MB where the tab dies. Other phones not measured.
- **Iceboxed (2026-11-13; `docs/icebox.md`, "Engine memory"): `set max_memory`** lowers the cap for the session (`set max_memory 500m`), never above
  the device's default, since raising it is how a visitor would crash the tab. The patch reads the cap at each grow, so it can
  probably change while the engine runs (not checked). Also later: why the cap-600 tab crashed after other runs (a leak, or memory
  outside the engine's heap).
- **Not checked:** WebKit on other devices; `merge`, `reshape`, `regress`, sort and graphs near the cap were not exercised.
