# dofile web demo: Phase 2 history

Results of the first spike and the proof-of-concept page, and the two comparisons behind decisions 4 and 5.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged.

## Spike results (2026-11-06)

*Note (2026-11-10): `web/spike/` and `eval/`, which this text mentions, were removed on 2026-11-10; they are in git history at commit `10e0f1c`.*

`web/spike/spike.mjs` (`cd web/spike && npm install && node spike.mjs`, after `uv build --wheel`) runs Pyodide
314.0.7 in a Node worker thread, as a browser Web Worker would, with the built dofile wheel (`micropip.install`, which
also resolves numpy, scipy, matplotlib and openpyxl). Results on an M-series Mac, cold package cache:
- **Correctness:** the conformance corpus gives 63/63 as expected (62 matches with `ref.json` to 1e-6, plus the
  GAP-1 xfail), the same as CPython. All 12 probes behave as in CPython (10 pass, `esttab` and `outreg2` fail).
- **Graphs:** inline PNGs work (scatter 35 KB, histogram 7 KB), and `graph export s.png` writes the file into
  `/work` (matplotlib's Agg backend, no changes).
- **Break:** the interrupt buffer, set from the other thread 1.5 s into `while 1 { quietly replace x = x + 1 }`,
  called our SIGINT handler once (`request_break()`). The call returned rc 1, and the next `summarize x` saw all
  100 observations. So the PATCH-2 safe points hold in the browser, using the same handler as `worker.py`.
- **Download size (cold):** about 36 MB. Pyodide's core is 13.5 MB uncompressed (wasm, stdlib, loader), or 5.5 MB
  with brotli. The packages are 27.4 MB as wheels, which are already compressed: scipy 14.0, matplotlib 7.0,
  numpy 3.0, fonttools 1.2, pillow 1.0, and the rest under 1 MB together. The dofile wheel is 2.8 MB, and openpyxl
  comes from PyPI.
- **Time (Node, cold, with downloads):** Pyodide starts in 0.8 s. Installing the wheel and its dependencies takes
  4.4 s. Importing `dofile.engine` and creating `Engine` takes 2.0 s. A `run_do` then takes about 1 ms. The corpus
  takes 0.2 s. In total it is 11.4 s. Browser times are measured in step 4.
- **Lazy loading is possible:** `import dofile.engine` loads numpy only. matplotlib and openpyxl are imported on
  first use (checked natively after a regression). So the page can install dofile with `deps=False`, load numpy
  and scipy at start, and fetch matplotlib (about 9.5 MB with fonttools, pillow, contourpy and kiwisolver) and
  openpyxl in the background while the user is idle, or before running code that draws a graph. Decide in step 4.
- **Starting faster (2026-11-07):** a Pyodide memory snapshot, a patched loader that links numpy and scipy again, and
  the timings in a real browser are in `pyodide-snapshot.md`. A compiled binary (PyInstaller, Nuitka) is not an
  option: there is no wasm target, and dofile's own code is under 10% of the start.
- **Pyodide in a Node worker thread** has no file descriptors 1 and 2, so `loadPyodide` needs `stdout`/`stderr`
  callbacks (a browser Web Worker uses the console by default, and the page will capture output anyway).
- Clean-room reminder: `sysuse auto` gives rc 601, because OpenDTA doesn't ship Stata's example datasets. The
  sample project must use our own data.

## Proof-of-concept results (2026-11-06)
Playwright on an M-series Mac, `vite preview` on localhost, Pyodide from jsDelivr. Same test in each engine: upload
`cps.dta`; run a regression that names it by a Windows path (the note shows the mapping; the coefficient matches
`ref.json` to 1e-6); a graph; Break during `while 1 {}` (rc 1, the data kept); reload (files and the editor's text
come back from IndexedDB); Reset (a new engine: the data is gone, `use cps` works).

| | ready, cold | ready, after a reload |
|---|---|---|
| Chromium | 5.8 s | 4.6 s |
| Firefox | 6.6 s | 5.1 s |
| WebKit | 5.9 s | 4.6 s |
| WebKit, iPhone emulation | 5.5 s | 4.6 s |

Runs alone; with all three in parallel, cold was 6–8 s. A run of the sample (200 observations, `regress`,
`scatter`) takes about 0.9 s. Cold includes downloading about 36 MB (each test starts with an empty cache) on a fast
connection; a slow one adds to it. Most of the reload time is installing the wheels and importing, not downloading.
Lazy matplotlib/openpyxl would shorten both.

Found and fixed:
- WebKit refused the worker after a reload: `vite preview` sent its 304 replies without the COEP header. The
  page's dev and preview servers now set the headers on every response, and the client completes a start that
  crashed by starting again (`test/engine.test.mjs` covers a worker that fails to load).
- The log wrapped Stata's fixed-width tables; it now scrolls sideways.
- Data loss (found in review): opening a file and pressing Run wrote the editor's text back over it, which changed
  the bytes (Latin-1 became U+FFFD, CRLF became LF); an upload of the open file was undone by the next Run;
  "New" with an existing name emptied it. Now a file is written only after an edit, a file that isn't UTF-8 is not
  opened (download it instead), an upload of the open file reloads the editor, and "New" refuses an existing name.
  Test: `e2e/poc.spec.ts`, "the editor never rewrites a file it didn't change". A file opened and edited is still
  saved with LF line endings.
- Seen once: Firefox stuck at "starting the engine" with four browsers starting at once; not reproduced in 16 more
  runs (8 of them four Firefox at once). The page now shows a startup error instead of the last status.

Not checked: a real phone (emulation has no phone keyboard), a slow network, files near the memory limit.

## Decision 4: CodeMirror 6 or Ace (the comparison)

4. **Text editor: CodeMirror 6 or Ace.** Sizes were measured on 2026-11-06 (esbuild, minified, gzip -9). The rest
   comes from the projects' own docs and use, and is checked on real phones in the PoC.

   | | CodeMirror 6 (6.0.2, MIT) | Ace (ace-builds 1.45.2, BSD-3) |
   |---|---|---|
   | Quality / maturity | Rewritten 2018–2022. Used by Chrome DevTools, JupyterLab 4, Replit, Observable. Active. | Since 2010 (Cloud9, then AWS). Used by many older apps, including legacy OpenStata. Active, stable. |
   | Ease of use | Modular: you assemble extensions (`basicSetup` is a good start). More concepts (state, transactions, facets), more power. | One object, `ace.edit(el)`, with setters. Faster to start with. |
   | Mobile | Built on the browser's own editing (contenteditable) to work with touch, phone keyboards, IME and screen readers. Mobile support was a main goal of the rewrite. | Takes input from a hidden textarea and draws text itself. Touch selection and phone keyboards are its known weak spot. |
   | Desktop | Good. | Good. |
   | Features | Autocomplete, lint, search, multiple cursors, folding, bracket matching, vim and emacs keys (add-ons). | The same, mostly built in. More ready-made themes (~40). |
   | Performance | Draws only the visible lines, with incremental parsing. Fine with very large files. | Draws only the visible lines. Fine with very large files. |
   | Size, basic setup | 131 KB gz (with a legacy-mode language) | 128 KB gz core, + 17 KB autocomplete, + ~2 KB per mode |
   | Stata support | None built in (no Stata in `@codemirror/legacy-modes` 6.5.5). | None built in (no `mode-stata` in ace-builds 1.45.2). The legacy app used JSX mode, so it had no Stata highlighting. |

   - **Stata highlighting is our work either way, and it's about the same for both.** A regex tokenizer is a
     `StreamLanguage` in CodeMirror or `HighlightRules` in Ace (Ace's R mode is 5.5 KB). Stata's hard parts:
     - `*` is a comment only at the start of a line, and `/* */` comments nest;
     - `///` continues a line;
     - local macro quotes `` `x' `` nest, and so do compound quotes `` `"..."' ``;
     - globals are written `$x` and `${x}`;
     - commands can be abbreviated (`reg`, `gen`).

     The command list comes from OpenDTA's own registry (the `dofile://commands` resource, 515 commands), so what is
     highlighted is what the engine runs. Grammars to learn from (both MIT, so code can be reused with credit): the
     TextMate grammar `kylebarron/language-stata` (last pushed 2022) and `codedthinking/tree-sitter-stata` (0 stars,
     pushed 2026-08). Later, a Lezer grammar in CodeMirror would add folding and structure.
   - (Recommended) **CodeMirror 6.** Mobile is the axis where they differ, and both sizes are the same. Ace's
     advantages are a simpler API and the legacy app's familiarity. These count for little once the Stata mode has
     to be written anyway.
   - Step 4 used CodeMirror 6: it works in Chromium, Firefox, WebKit and iPhone emulation, and the highlighter took
     about 100 lines. Ace was not built, and no real phone was tried (emulation has no phone keyboard). **Chosen,
     unless a real-phone test shows a problem.**

## Repository layout (alternatives)

Now: the repo root is the Python package (`pyproject.toml`, `src/dofile/`, `tests/`, `tests_opendta/`, `scripts/`,
`eval/`). `plugins/dofile-log/` holds the Claude Code plugin, which `.claude-plugin/marketplace.json` lists. `docs/`
is shared. The web demo adds a JavaScript project, so `web/src/` would sit beside `src/dofile/`.

- **(Recommended) Keep the Python package at the root. Each other product gets one self-contained top-level folder
  with its own toolchain.** `web/` (Vite: `package.json`, `web/src/`, landing page and editor as two entries of one
  build) sits beside `plugins/`. Python code that the web demo needs (the browser entry point, the path shim) stays
  in `src/dofile/`, so pytest tests it and it ships in the wheel the page loads. The rule is "language by folder":
  `src/` is Python, `web/src/` is TypeScript. This is a common shape, and the clash is only in name.
  - Why not move Python: the wheel and sdist are built from the root. Users' MCP configs say
    `uv run --directory /path/to/dofile`. CI, `poe` tasks, `CLAUDE.md`, the vendor script and test paths all assume
    the root. Moving it costs a large diff and breaks those configs, for a tidier tree only.
  - When a second JavaScript project comes (for example a VS Code extension or a docs site), add a pnpm workspace
    file at the root that lists `web/` and the new folder. Not before.
- Alternative: a monorepo, with `python/` (the current root), `web/` and `plugins/`, each self-contained. It is
  cleaner if Python stops being the main product, which is not the case now.
- Alternative: an `apps/` folder (`apps/web/`, `apps/claude-plugin/`). It adds a level and moves the plugin, and
  gains little with two apps.

## Decision 1 as first made: IDBFS

Superseded on 2026-11-10 by dofile's own store ([phase2-plan.md](phase2-plan.md), decision 1). The code works this way until
build step 2.

   - **Superseded; this is what the code does until build step 2 (current code):** an Emscripten in-memory folder `/work`, saved to IndexedDB (IDBFS, `FS.syncfs`) after each
   run and each upload. It works in every browser. The page is to call `navigator.storage.persist()` so the browser
   doesn't clear it (not in the code yet: step 6). Not chosen: OPFS via `pyodide.mountNativeFS` (larger quotas, but more Pyodide edge cases). A
   later option on Chromium is "open a folder" (`showDirectoryPicker` + `mountNativeFS`), which uses a replication
   folder in place with no upload. It is not in the first version.
   - **Why two copies:** Python's file calls are synchronous, and IndexedDB is async only. So Python works on the
     in-memory copy, and `syncfs` copies it to or from IndexedDB, which is on disk. Each file takes memory as well
     as disk. A later Pyodide with WasmFS/OPFS or JSPI could remove the memory copy.
   - **Steps, in the Web Worker** (`syncfs(load)` wraps `FS.syncfs` in a Promise; one sync at a time, queued with
     the runs):
     - start: `FS.mkdirTree("/work")`, `FS.mount(FS.filesystems.IDBFS, {}, "/work")`, `syncfs(true)` (load),
       `navigator.storage.persist()`; on a first visit, copy in the sample project;
     - after an upload, an editor save, a delete or rename, and each Run: `syncfs(false)` (save);
     - a restarted worker repeats the start, so files come back and data in memory doesn't.

     A tab closed in the middle of a run loses only what that run wrote. Not tried yet: Node has no IndexedDB, so
     the spike used plain in-memory files. The first test is in step 4.

## Decision 3: the earlier discussion

Superseded on 2026-11-10: Preact with signals was chosen.

  The earlier discussion (superseded by this decision): Vite is a build tool and dev server, not a framework. "Plain Vite" means TypeScript that
   creates and updates DOM elements by hand. Preact (about 4 KB) adds components and re-renders the page from state,
   like React. React (about 45 KB) is the same idea with the largest set of ready-made components (for example
   Material UI, which the legacy app used). Size doesn't decide this: Pyodide is tens of MB, so 45 KB is noise.
   - (Was recommended) **Proof of concept in plain TypeScript, no framework.** One editor, a Run button and a log pane
     is a handful of elements. Choose the framework after the design step (see UI/UX), when the number of
     components and their state are known. If the design wants ready-made Material components, use React. If not,
     use Preact (with signals for state). The PoC glue is small enough to rewrite either way.
   - Step 4 was built this way (`web/src/main.ts`, about 200 lines of plain TypeScript). Still open: decided at the
     design step (5).

## Order of work: the finished steps as first written

Steps 1 to 4e as the plan had them at commit `10e0f1c`. Two things changed since: the memory snapshot (4c) is the page's default
start, not opt-in, and the links to sections of the plan now point to files beside this one.

1. ~~**Spike under Node**~~ done 2026-11-06 ([Spike results](#spike-results-2026-11-06)). Warm start time is left to
   step 4, because a browser's cache differs from Node's.
2. ~~**Path shim**~~ done 2026-11-06: `src/dofile/pathshim.py` (`install(root, note)`, `uninstall()`) on top of
   PATCH-3, a hook at the ~25 places OpenDTA turns a file name into a path ([opendta-issues.md](opendta-issues.md)).
   Tests (`tests/test_pathshim.py`): 22 file commands with a Windows and a POSIX foreign path, the note, tempfiles,
   a missing file (rc 601 after the note), `cd`, and a guard against unhooked sites after a re-vendor. Unquoted
   Windows paths in `mkdir`/`rmdir`/`copy`/`dir` lose their backslashes in the engine (ODT-26, open).
3. ~~**Browser entry point**~~ done 2026-11-06:
   - `src/dofile/browser.py`: `start(root)`, `run(code)`, `describe()`, `matrix()`, JSON text in and out (matrices by
     size, as MCP sends them). It denies only `shell` and `webuse`, installs the path shim, and sets a SIGINT handler
     that requests a Break only during a run. Tests: `tests/test_browser.py` (CPython, one subprocess per case).
   - `web/src/engine/worker.js`: the Web Worker. It loads Pyodide and the wheel, mounts `/work` on IndexedDB when the
     browser has it, and answers `{id, op, args}` with `{id, result}` or `{id, error}`, one at a time. Ops: `init`,
     `run`, `describe`, `matrix`, `files`, `read`, `write`, `remove`, `rename`; it saves to IndexedDB after each change
     and run. The file list is built here, from Emscripten's file system, not in Python.
   - `web/src/engine/client.js`: the page's side. `run`, `breakRun` (interrupt buffer, then a new worker after 5 s,
     which ends the run with rc 9998), `restart`.
   - Test: `cd web && npm install && npm test` (rebuilds the wheel first) runs the real `worker.js` in a Node worker
     thread with an in-memory IndexedDB (`fake-indexeddb`): files, a run with a Windows path, results, describe,
     matrix, a graph, `shell` refused, Break, restart. Not testable in Node: files surviving a restart (the fake
     IndexedDB lives in one thread). That is checked first in step 4.
4. ~~**Proof-of-concept page**~~ done 2026-11-06 ([Proof-of-concept results](#proof-of-concept-results-2026-11-06)):
   `web/index.html` + `web/src/main.ts`, plain TypeScript, unstyled. CodeMirror 6 with the first Stata highlighter
   (`web/src/stata/language.ts`; commands from the engine's registry, `npm run commands`). Upload of files or a
   whole folder into `/work`, download, delete, new .do file; Run (Ctrl/Cmd+Enter: the selection), Break, Reset,
   log, graphs. A sample do-file on first visit. Run is disabled during a run, and `read` transfers the file's bytes.
   Test: `cd web && npm run e2e` (Playwright: Chromium, Firefox, WebKit, iPhone emulation). Still open from step 3:
   micropip fetches openpyxl from PyPI on each cold start.
4a. **Experiment: load matplotlib lazily** (**not done**; planned 2026-11-07, no code). Decide whether the snapshot
   should leave matplotlib out of the heap and load it on the first plot (about 9.7 MB less before "ready", estimated), and
   what the normal boot should do about its 0.8 s first plot (its matplotlib import is already lazy; scipy's is not).
   What is measured, what is only a guess, and how to run the experiment:
   [Experiment: loading matplotlib lazily](lazy-matplotlib.md). Related:
   [pyodide-snapshot.md](pyodide-snapshot.md#file-size-what-is-done-and-what-is-not), which lists every size optimization
   as done, opt-in or not done.
4b. ~~**Investigate: model fits run far longer in Pyodide than on CPython**~~ done 2026-11-07: the cause was
   `numpy.linalg.cholesky`, `inv` and `solve` returning NaN instead of raising `LinAlgError` in Pyodide, which the engine
   relies on in about 100 places (`src/dofile/linalgshim.py`, installed by `browser.start()`). Fits now take 1.5–5 times as
   long as on CPython, not 20–500 times or forever. Also fixed: PATCH-4 (`expand` and `stsplit`). Details, evidence and what
   remains: [Open investigation](browser-engine.md#open-investigation-model-fits-take-far-longer-in-pyodide) and [Known gaps](browser-engine.md#known-gaps-in-the-browser-engine).
4c. ~~**Memory snapshot**~~ done 2026-11-07 (opt-in): [pyodide-snapshot.md](pyodide-snapshot.md). Patched Pyodide loader,
   39.9 MB at brotli 11 (42.3 MB before docstring stripping became the default), restore in 1.2 s; `web/scripts/make-snapshot.mjs`, `web/src/engine/snapshot.js`. Whether it
   becomes the default is open.
4d. ~~**Check the engine in Pyodide against CPython**~~ done 2026-11-07, by hand, not in CI: `check-snapshot` (conformance
   corpus and the 97 Stata 14 cases), `check-pytest` (OpenDTA's unit suite, test by test against CPython) and
   `check-numeric` (e() and r() at full precision, 109,265 numbers). Results in [Known gaps](browser-engine.md#known-gaps-in-the-browser-engine).
4e. ~~**Browsers**~~ done 2026-11-07: the e2e passes in Chromium, Firefox, WebKit and an iPhone profile, with and without the
   snapshot. Found and fixed on the way: iOS (Pyodide creates no wasm trampoline there, so a snapshot made in Node failed at
   start; [The trampoline](pyodide-snapshot.md#the-trampoline)), and cache failures that were swallowed. A real phone was tried
   by hand on 2026-11-08 ([On a real iPhone](pyodide-snapshot.md#on-a-real-iphone-2026-11-08)). The first CI run found that the
   e2e helper's Ctrl+A then `insertText` left the editor's last line behind in WebKit on Linux (the iPhone profile): it ran
   `display "EDITED"scatter y x` and got rc 111. The tests now replace the editor's text through `window.__editor`, a view
   that `main.ts` exposes for them; whether a real iOS keyboard's select-all does the same was not checked.

