# dofile — Phase 2 plan: web demo

**Goal:** a static website with a landing page and a single-page editor that runs .do code in the browser. The
dofile engine runs in Pyodide inside a Web Worker. The user uploads their own files (.do, .dta, .csv, .xlsx) into a
virtual working folder, and code that names a file by any path finds it there. Nothing runs on a server, so there
are no accounts and no hosting cost beyond static files.

**Not in Phase 2:** accounts, sync between devices, sharing or collaboration, server-side execution, the MCP server
(Phase 3), community commands, tutorials beyond one sample project, our own estimators.

**Status (2026-11-07):** steps 1 (the Pyodide spike), 2 (the path shim), 3 (the browser entry point) and 4 (the
proof-of-concept page) were done on 2026-11-06, see [Spike results](#spike-results-2026-11-06); storage and the path shim
are decided. Phase 1 is complete ([phase1-plan.md](phase1-plan.md)). Done since, on 2026-11-07 (steps 4b to 4e below):
- **The engine matches CPython in Pyodide, apart from missing packages.** Two browser-only bugs were found and fixed
  (PATCH-4: `np.repeat` counts as `intp`; a shim for `numpy.linalg` raising `LinAlgError`). 95 of 97 Stata 14 cases pass
  (the other two need `pyreadstat` and `xlwt`), 1048 of 1080 unit tests (the others skip for those packages and `xlrd`, or
  are `shell`), 99.5% of estimation results agree with CPython to 1e-3 and 95% to 1e-9. The differences that remain are in
  fits whose answer the data does not pin down (ODT-30, an OpenDTA optimizer issue). Nothing of this is in CI yet.
- **The memory snapshot** (opt-in, `?snapshot=1`; [pyodide-snapshot.md](pyodide-snapshot.md)): a return visit starts in 1.2 s
  against 4.6–9.3 s, a first visit in 1.7 s unthrottled and 5.4 s at 100 Mbps, about level with the normal boot at 30 Mbps. It
  is 42.3 MB (brotli 11). It works in Chromium, Firefox, WebKit and an iPhone profile; a real phone was not tried. Which
  size optimizations are done and which are not: [File size](pyodide-snapshot.md#file-size-what-is-done-and-what-is-not).
- **Tools:** `npm run check-snapshot`, `check-pytest`, `check-numeric` and `web/scripts/measure-startup.mjs`.

**Still open in Phase 2:** the lazy-matplotlib experiment (4a, not started), whether the snapshot becomes the default, a real
phone, the `.xls` packages (`xlwt`, `xlrd`) and `pyreadstat`, wiring the checks into CI (step 9), and steps 5 to 10.

## Facts this plan rests on
- **OpenDTA ran unmodified in Pyodide 314** (Python 3.14) under Node during the engine evaluation
  ([engine-evaluation.md](engine-evaluation.md#browser-pyodide-31407-run-under-node)), with Pyodide's bundled
  numpy, scipy and matplotlib. dofile's other dependency, openpyxl, is pure Python (micropip). The dofile wheel is
  pure Python. Development is already pinned to 3.14 for this reason. Confirmed for the built dofile wheel in the
  spike (2026-11-06).
- **Most of dofile's process layer does not apply in a browser.** `worker.py` (forkserver, child processes) and the
  audit hook in `sandbox.py` need processes and signals. The browser tab is the sandbox: the code can reach only
  the files the user gave it. The Web Worker takes the place of the child process. `engine.Engine` is used
  directly. Only commands that reach outside the page stay denied (`shell`, `webuse`; `copy` from a URL has no
  network to reach in Pyodide).
  `cd`, `mkdir`, `rmdir` and `erase` touch only the user's own `/work`, so they go through the path shim instead
  (replication do-files often start with `cd` and `cap mkdir output`).
- **A relative path already works.** `Engine` does `os.chdir(workdir)`, so `use data/x.dta` resolves in an
  Emscripten folder such as `/work`. Absolute paths need the shim (decision 2): `use "C:\Users\me\proj\x.dta"` or
  `/Users/me/proj/x.dta` from a do-file written on someone's computer.
- **Break must reach PATCH-2.** Since PATCH-2, the engine stops only at safe points: the host calls
  `break_.request()` and the engine raises KeyboardInterrupt at the next safe point. Pyodide's interrupt buffer
  (`pyodide.setInterruptBuffer`, a SharedArrayBuffer) raises a signal in Python. It must run dofile's SIGINT
  handler, not raise KeyboardInterrupt mid-command. Otherwise data can be left half changed again. Confirmed in the
  spike: a handler installed with `signal.signal(SIGINT, ...)` runs, and the engine stops at a safe point.
  A long single command still cannot stop: then the page terminates the Web Worker and starts a new one (the
  browser's rc 9998, data lost; files stay).
- **SharedArrayBuffer needs cross-origin isolation** (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`). GitHub Pages cannot set headers. Cloudflare
  Pages and Netlify can (`_headers`). `require-corp` works with Pyodide from jsDelivr in Chromium, Firefox and
  WebKit (step 4), so `credentialless` isn't needed. **The headers must be on every response, 304s included:**
  WebKit refuses a worker script whose cached 304 reply has no COEP header (found in step 4). Check the host does
  this when deploying (step 9).
- Highlighting: tree-sitter-stata (codedthinking, MIT) exists. Clean room (`LICENSE-POLICY.md`) applies to all
  page text: no Stata manual or help text, no Stata example datasets. `sysuse` datasets bundled with OpenDTA have
  their own data licenses; check them before using one as the sample.
- stats.camp is a closed-source browser app with the same idea. Our demo's points are that it is open source,
  needs no account, sends no data and uses the same engine as the CLI and MCP server.

## Spike results (2026-11-06)
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

## Decisions (2026-11-06)
1. **Where files live:** an Emscripten in-memory folder `/work`, saved to IndexedDB (IDBFS, `FS.syncfs`) after each
   run and each upload. It works in every browser. The page calls `navigator.storage.persist()` so the browser
   doesn't clear it. Not chosen: OPFS via `pyodide.mountNativeFS` (larger quotas, but more Pyodide edge cases). A
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
2. **The path shim** (what "everything is in the working folder" means):
   - Relative paths need no change: they resolve in `/work`.
   - An absolute path is mapped to the longest tail of it that exists in `/work`
     (`C:\Users\me\proj\data\x.dta` → `data/x.dta`, else `x.dta`). A new file (`save`, `export`, `log using`) gets
     its file name in `/work`. The log shows one note line for each mapped path, so the user sees what happened.
   - `cd "<folder>"` changes to a folder inside `/work` if it exists. Otherwise it does nothing and prints a note.
     It doesn't give rc 199 as the MCP sandbox does, because do-files from real projects start with `cd`.
   - **Browser only.** The patch adds a hook that does nothing unless the browser entry point turns it on. In the
     CLI and MCP server, absolute paths are real, and the sandbox keeps refusing them (rc 603, tested).
   - Where (done): OpenDTA has no single path helper (about 25 sites in 18 files), so PATCH-3 adds one hook,
     called after the default extension is added, and `dofile/pathshim.py` sets it. Temp files and paths that
     exist as written are never mapped. `cd` is replaced in the command registry while the shim is on.

## Open decisions (recommendation first)
3. **UI framework.** Vite is a build tool and dev server, not a framework. "Plain Vite" means TypeScript that
   creates and updates DOM elements by hand. Preact (about 4 KB) adds components and re-renders the page from state,
   like React. React (about 45 KB) is the same idea with the largest set of ready-made components (for example
   Material UI, which the legacy app used). Size doesn't decide this: Pyodide is tens of MB, so 45 KB is noise.
   - (Recommended) **Proof of concept in plain TypeScript, no framework.** One editor, a Run button and a log pane
     is a handful of elements. Choose the framework after the design step (see UI/UX), when the number of
     components and their state are known. If the design wants ready-made Material components, use React. If not,
     use Preact (with signals for state). The PoC glue is small enough to rewrite either way.
   - Step 4 was built this way (`web/src/main.ts`, about 200 lines of plain TypeScript). Still open: decided at the
     design step (5).
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
5. **Where the web code goes in the repo** (see [Repository layout](#repository-layout)). In use since step 3: `web/`
   next to the Python package, as recommended.
6. **Hosting.** (Recommended) Cloudflare Pages: free, can set headers, deploys from GitHub Actions. Domain to
   choose.
7. **Where Pyodide loads from.** jsDelivr CDN (cached across sites, CORS headers) or self-hosted (one origin, no CORS
   issue). Step 4 loads the runtime and packages from jsDelivr, which works in all three engines; the wheel comes
   from the page's own origin. Self-hosting stays an option if the CDN is slow or unavailable.

## Repository layout
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

## UI/UX design (after the proof of concept, before the full editor)
Not started; the proof of concept comes first. The PoC page is deliberately unstyled. This step produces the design
that steps 6 and 8 build.
- **Inspiration: legacy OpenStata** (`legacy/openstata/`, screenshots and GIFs in `docs/img/`). It is rough, with a
  bare-bones, academic, scrappy feel that we want to keep:
  - Material UI (v4): a navy top bar (`#1b1464`) with a pixel-style wordmark;
  - a gray left drawer with collapsible sections (Do Files, Log Files, Sample Data, Your Data) and upload below;
  - a monospace log pane with line numbers on the left, and the editor on the right;
  - a bottom action bar (Delete, Clear, Save, Run);
  - the landing page as an editor showing an ASCII-art banner and plain-text "what is this", next to a navy
    graph-paper grid.

  Keep the plain-text, editor-first, graph-paper character. Fix what was rough: dead space, the low contrast of the
  gray-on-gray drawer, no Break or busy state, and no highlighting.
- **Deliverables, in order:**
  1. a moodboard: legacy screenshots plus a few references (terminal and notebook UIs, academic sites);
  2. user flows: first visit, open the sample, upload a replication package, run, Break, a crashed worker, download
     everything;
  3. low-fidelity wireframes for desktop and phone (the phone layout stacks the editor and the log with tabs);
  4. high-fidelity mockups of the landing page and the editor, light and dark;
  5. a small design system: color and type tokens (one monospace font, one UI font), spacing, and the components
     (file list, pane, toolbar button, log line, error line, results table, toast).
- **Tools:** Excalidraw for wireframes. For mockups, Figma or Penpot (open source, can self-host); choose at this
  step. Keep exported images and the token file in `docs/design/` and the tokens as CSS variables in `web/`.
- **Rules:**
  - Accessibility: contrast at least WCAG AA, everything usable by keyboard, the log readable by screen readers.
  - Clean room: no Stata screenshots, icons or layout copied. The legacy app is our own and can be reused.
  - Names: the product is "dofile", described as running "Stata-syntax" code. "Stata" is not used as our name, and
    the old "OpenStata" wordmark is not reused.

## What the page does
- **Landing page:** what dofile is, a "try it" button, the CLI and MCP install lines (`pip install dofile`), the
  OpenDTA credit and links. Static HTML.
- **Editor:** a file panel (upload by button or drag and drop, download, rename, delete, new .do file), the editor,
  Run (whole file) and Run selection (a do-file scope per run, as in MCP), Break, a log pane with errors marked,
  graphs inline, a data view (variables like `describe_data`, plus the first rows), and the e()/r() results.
  Ctrl+Enter runs. One sample project loads on first visit.
- Output that MCP already formats (`Result`, `results()` with `matrix_sizes`, `data_summary()`, `matrix()`) is
  reused as is, sent from the Web Worker as JSON (`dofile/browser.py`).

## Order of work (each step ends green)
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
   [Experiment: loading matplotlib lazily](#experiment-loading-matplotlib-lazily). Related:
   [pyodide-snapshot.md](pyodide-snapshot.md#file-size-what-is-done-and-what-is-not), which lists every size optimization
   as done, opt-in or not done.
4b. ~~**Investigate: model fits run far longer in Pyodide than on CPython**~~ done 2026-11-07: the cause was
   `numpy.linalg.cholesky`, `inv` and `solve` returning NaN instead of raising `LinAlgError` in Pyodide, which the engine
   relies on in about 100 places (`src/dofile/linalgshim.py`, installed by `browser.start()`). Fits now take 1.5–5 times as
   long as on CPython, not 20–500 times or forever. Also fixed: PATCH-4 (`expand` and `stsplit`). Details, evidence and what
   remains: [Open investigation](#open-investigation-model-fits-take-far-longer-in-pyodide) and [Known gaps](#known-gaps-in-the-browser-engine).
4c. ~~**Memory snapshot**~~ done 2026-11-07 (opt-in): [pyodide-snapshot.md](pyodide-snapshot.md). Patched Pyodide loader,
   42.3 MB at brotli 11, restore in 1.2 s; `web/scripts/make-snapshot.mjs`, `web/src/engine/snapshot.js`. Whether it
   becomes the default is open.
4d. ~~**Check the engine in Pyodide against CPython**~~ done 2026-11-07, by hand, not in CI: `check-snapshot` (conformance
   corpus and the 97 Stata 14 cases), `check-pytest` (OpenDTA's unit suite, test by test against CPython) and
   `check-numeric` (e() and r() at full precision, 109,265 numbers). Results in [Known gaps](#known-gaps-in-the-browser-engine).
4e. ~~**Browsers**~~ done 2026-11-07: the e2e passes in Chromium, Firefox, WebKit and an iPhone profile, with and without the
   snapshot. Found and fixed on the way: iOS (Pyodide creates no wasm trampoline there, so a snapshot made in Node failed at
   start; [The trampoline](pyodide-snapshot.md#the-trampoline)), and cache failures that were swallowed. A real phone was not tried.
5. **UI/UX design** (section above): flows, wireframes, mockups, design tokens.
6. **Editor page** built to the design: files, editor, run, log, graphs, data view, results.
7. **Publish to PyPI** (moved from Phase 1): the landing page tells people to `pip install dofile`, so the
   release must exist first. Trusted Publishing from GitHub Actions, no stored token. The page can load the same
   wheel from its own origin.
8. **Landing page**, sample project, clean-room check of all text.
9. **CI:** run the corpus in Pyodide under Node on each push. Build `web/` and deploy `main` to the host.
   A browser smoke test (Playwright, one browser): load, upload a .dta, run a regression, check the coefficient.
   The checks exist and are run by hand (`check-snapshot` about 4 minutes, `check-pytest` about 2, `check-numeric` about 4,
   `npm test` and `npm run e2e` about 1 each); no CI job runs them yet. `check-snapshot` needs a built snapshot only for its
   default mode; `--normal` does not.
10. **Launch:** domain, test in Chrome, Firefox and Safari (desktop and phone), link from the README.

## Known gaps in the browser engine

Found 2026-11-07 by running the engine's checks inside Pyodide (`web/scripts/check-snapshot.mjs`, `npm run
check-snapshot`; details in [pyodide-snapshot.md](pyodide-snapshot.md#correctness-checks)): the conformance corpus
(63 value checks against `ref.json`, 12 probes including graphs), 13 calls into the native libraries, and the 98
Stata 14 reference cases of `tests_opendta/compat` through the repo's own `compare.py` and its known-difference rules.

**Where things stand (2026-11-07), what is open.** The details are in the paragraphs and tables below.
- **Packages Pyodide lacks:** `pyreadstat` (SAS transport files, Stata 12 and older `.dta`, SPSS; no WebAssembly build: a limit
  of the web demo to document) and `xlwt` and `xlrd` (`.xls` output and input; both pure Python, so micropip could install
  them: add them to the page's install, or document `.xls` as unsupported; decision open).
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

**Update, 2026-11-07, after PATCH-4 and the `numpy.linalg` shim:** the whole comparison was run again in Pyodide on a
normal boot (`check-snapshot --normal`, one process per case, 600 s limit, four at a time): **95 of 97 cases pass in 200 s,
none timed out or crashed**, and the corpus (63 checks), the 12 probes and the 13 native-library calls are clean. The two
that differ are the two package gaps below (1701_datamgmt_options: `xlwt`; 1911_datamgmt: `pyreadstat`). The count is 97,
not 98, because `1920_models4` has a `.do` file and no Stata reference log, so neither this check nor
`tests/test_stata_compat.py` runs it (the first run listed it among 7 unfinished cases; that list is therefore also
doubtful for the other 6, which have now run and pass). The tables below describe the state before the two fixes; the
snapshot start has not been run again with the shim.

**The unit tests in Pyodide, 2026-11-07** (`npm run check-pytest`, `web/scripts/check-pytest.mjs`; compared with CPython test
by test by `compare-pytest.mjs`, both through the same plugin `pytest_report.py`; one process per file, 72 files,
128 s): OpenDTA's own suite (`tests_opendta/tests`) and `tests/test_engine.py`, 1080 tests. CPython: 1067 passed, 13
skipped. Pyodide: 1048 passed, 31 skipped, 1 failed. **Of the 19 tests that differ, none is an engine problem:** 16 skip
for lack of `pyreadstat`, 1 for `xlwt` and 1 for `xlrd` (the `.xls` reader, also missing in Pyodide, pure Python like
`xlwt`), and 1 fails because `shell` cannot start a process in the browser (the page denies `shell` anyway). All other
1,061 tests have the same outcome on both. Not run in Pyodide because they need subprocesses, the `mcp` package or the
repo's source tree: `test_mcp`, `test_worker`, `test_sandbox`, `test_break`, `test_dofile_cli`, `test_vendor`,
`test_log_cut`, `test_pathshim` (its browser side is `web/test/engine.test.mjs`), `test_browser`, `test_linalgshim`
(`web/test/linalgshim.test.mjs`), `test_conformance` and `test_stata_compat` (those two are `check-snapshot`). The slowest
tests take 1.5-2.4 times as long as on CPython. What this does not show: the unit tests only reach what they assert on,
so a silent numeric difference in code they do not check would not appear; the two bugs found today were both visible only
as a timeout or an exception.

**Numbers, CPython against Pyodide, 2026-11-07** (`npm run check-numeric`; `web/scripts/numeric_probe.py` records e() and r()
after every command that changes them, at full double precision, for all 98 Stata 14 programs; `compare_numeric.py` diffs
the two runs; CPython here is macOS, arm64, so "CPython" is one libm and LAPACK, not all of them):
- **109,265 numbers.** 47.3% are bit-identical, 84.6% agree to 1e-12, 92.4% to 1e-9, 97.8% to 1e-6. Matrix cells are measured
  against the matrix's largest entry, so a covariance entry of 1e-11 is judged against the entries of 1.
- **Noise around exact zero** makes up much of the rest: `e(gradient)` at convergence (about 1e-9, with the sign flipped,
  1028 cells), means of residuals (about 1e-10), `Psi`, `srmr`, `Jacobian` entries. Not a difference in any result.
- **Random numbers.** `runiform` and the integer generators (`rbinomial`, `rpoisson`, `rnbinomial`) are bit-identical. Anything
  that goes through a math library differs in the last bits: `rnormal` and `invnormal` in 16% of draws by up to 4 ulp,
  `normal` 14 ulp, `chi2` 35, `invchi2` 62, `invttail` 82, `lngamma` up to 4096 (4.6e-13 relative). So simulated data is
  not bit-identical (`datasignature` differs in 1902 and 1916), and everything downstream starts 1e-16 apart. Another
  libm (CPython on Linux) would probably differ from macOS too; not checked.
- **Estimates.** Of 1110 estimation results, `e(b)` agrees to 1e-9 in 1056 (95.1%), to 1e-6 in 1091 (98.3%), to 1e-3 in
  1104 (99.5%). The 6 above 1e-3: **1901 `streg`, 1907 `tnbreg`, `zinb`, 1905 `xtfrontier`** have the same log likelihood to
  8 or more digits and different parameters (some parameters sit at a boundary: `theta` about 1e-9, `alpha` about 1e-8),
  which fits a flat likelihood; **1907 `gnbreg`** converged in 7 iterations on CPython and did not converge in 300 on
  Pyodide, whose log likelihood is higher (-878.294 against -878.310; see "`gnbreg`" below); **1908 `asmprobit`** (a simulated likelihood:
  82 against 104 iterations, ll -278.540 against -278.381, Pyodide higher). The 13 between 1e-6 and 1e-3 include
  `0602_svy_ampliado` `nbreg` (ll differs by 0.005 of 30,565, and 4 against 2 iterations: the stopping rule is relative to
  the log likelihood, so it ends within about 3e-3 of the optimum on either platform).
- **Logs.** 823 lines differ only in a printed digit. Lines that differ in their text are confined to 1907_models,
  1905_panel and 1901_survival (the cases above, iteration paths of fits that went another way) and to the two package-gap
  cases. `tech_steps` of `arfima` in 1904: 4 against 1.
- **What this shows and does not.** Same answers to the digits printed, except in fits where the answer is not pinned down
  by the data or the stopping rule, which can land elsewhere on either platform. It does not say which platform is closer
  to Stata in those cases; that needs the Stata 14 logs, and these cases pass under their known-difference rules.

**`gnbreg` in 1907_models (looked into 2026-11-07): a fit that is path-sensitive on CPython too, not a Pyodide problem.**
- `gnbreg cnt x1 x2, lnalpha(x3)` ends on CPython at ll -878.310297 in 7 iterations, **equal to the Poisson log likelihood of
  the same mean equation** (-878.3102973) with `lnalpha:_cons` = -22, i.e. alpha about 1e-10. Stata's reference log ends at
  -878.31024 after many "(backed up)" iterations. That is the boundary alpha = 0, where the score for `lnalpha` is
  proportional to alpha and so vanishes: a false convergence, since the likelihood can still be raised.
- In Pyodide with the linalg shim the fit leaves the boundary and creeps upward: ll -878.2943 at 300 iterations, changes of
  about 1e-6 per thousand iterations after that, never meeting the stopping rule (3000 iterations tried). Without the shim it
  converged in 4 iterations at the boundary (-878.310303), like CPython: the shim made the non-concave branch run, as it does
  on CPython, and the path went elsewhere.
- **On CPython the same happens with a tiny perturbation.** Multiplying the analytic derivatives of the likelihood by
  (1 + r u), u uniform(-1,1), 8 seeds per r: r = 0 gives -878.3103 8 times; r = 1e-13 gives one run that does not converge
  (-878.3053); r = 1e-11 gives one run that converges to **-878.1424** (0.17 above the boundary) and one that does not
  converge (-878.2737); r = 1e-9 gives five different outcomes in 8 runs. Platform differences in the derivatives are of the
  order of 1e-13 to 1e-10, so a different outcome on another platform is expected, and the boundary answer (CPython, Stata)
  is not the maximum.
- Also: the constant-only model of `gnbreg` (fitted separately, starting from the full model) is stuck in the non-concave
  branch on both platforms (ll -959.397 on CPython, -957.390 in Pyodide, against -952.7455 in Stata's log), so `ll_0` and
  `Pseudo R2` differ from Stata's everywhere; the case passes because its known-difference rule ignores them.
- What would fix it is the optimizer's non-concave step (`ml.maximize`, marked `VERIFY` against Stata: a multiple of the
  identity is added when `cholesky(-H)` fails), not anything in the browser engine. Not done.

**Before the two fixes, passing, in the normal boot and in the snapshot start alike:** all 63 corpus checks, all 12 probes (graphs come out as
PNGs), all 13 native-library calls. Of the 98 Stata 14 cases, **91 were run, 75 pass and 16 fail, and 7 were not run**: the
two runs were stopped after about 35 minutes with those 7 (`1904_timeseries`, `1910_programming`, `1914_panel`,
`1915_timeseries`, `1919_other_suites2`, `1920_models4`, `1921_graphics_look`) still going. The two starts agree on every
one of the 91, so none of the 16 comes from the snapshot or from the stripped docstrings it was built with:

| Gap | Cases | Cause | What to do |
|---|---|---|---|
| **`expand` and `stsplit` fail** | 11: 0304_collapse, 1001_mixed, 1002_melogit, 1402_kappa_roc, 1601_epidemiology, 1801_programming, 1901_survival, 1902_multilevel, 1908_models2, 1909_other_suites, 1916_multilevel | `np.repeat` gets an int64 counts array and numpy's index type is int32 in WebAssembly (PATCH-4 in [opendta-issues.md](opendta-issues.md)) | **fixed 2026-11-07**: two call sites patched (PATCH-4; no other int64 site fails, checked there). All 11 now pass in Pyodide, 5 with PATCH-4 alone and the other 6 (1001, 1601, 1901, 1902, 1908, 1916) once the `numpy.linalg` shim below was also in: with PATCH-4 only, those 6 passed `expand` and then hit the 600 s limit |
| `.xls` output | 1 (1701_datamgmt_options) | `putexcel` and `export excel` to `.xls` need `xlwt`, which Pyodide does not have; the log says `writing .xls files requires the xlwt package`, and a later `import excel` of that file says `file ... not found`. `xlwt` is pure Python, so it could be installed with micropip. It is also only a dev dependency of dofile, so a `pip install dofile` user hits the same message | decide: add `xlwt` to the page's install, or document that `.xls` is not supported in the browser |
| SAS transport files and Stata 12 `.dta` | 1 (1911_datamgmt) | `export sasxport`, `import sasxport` and old `.dta` files need `pyreadstat`, a C extension with no WebAssembly build (`this file format requires the pyreadstat package`) | document as a limit of the web demo |
| Numeric known differences | 3: 0408_mata_moptimize, 1907_models, 1918_models3 | these cases are accepted on CPython by known-difference rules (iteration paths ignored, tolerances 1e-8, 1e-5 and 3e-4); in Pyodide they leave a difference beyond the rule. The raw diffs show close values (`.9002714` against `.9002712`) and different iteration paths. **They are also the three cases that run 20–500 times slower than on CPython**, so the cause is probably shared: see [Open investigation](#open-investigation-model-fits-take-far-longer-in-pyodide). After the known-difference filters the Pyodide log has **more lines** than Stata's: 8 more in 1907, 1 more in 1918 and 1 more in 0408, where the extra line is `convergence not achieved` | **fixed 2026-11-07** by the `numpy.linalg` shim ([Open investigation](#open-investigation-model-fits-take-far-longer-in-pyodide)): all three pass in Pyodide, in 2.1 s (0408, was 204–220 s), 7.5 s (1907, was 25 s) and 4.2 s (1918, was 17 s), and match Stata under the same known-difference rules as CPython. No tolerance change was needed |

Nothing here is new engine behaviour that the snapshot introduced. The snapshot check did find one bug of the snapshot's
own, fixed on 2026-11-07: after a restore, `scipy.linalg.solve` crashed with `cannot resolve symbol dsytrf_`
(see the correctness section of [pyodide-snapshot.md](pyodide-snapshot.md)).

### Open investigation: model fits take far longer in Pyodide

Status: **cause found and fixed 2026-11-07** (`src/dofile/linalgshim.py`, installed by `browser.start()`; results at the end of this section). Everything below this paragraph was written before the cause was
known; the sections "Not known" and "How to pick it up" are superseded by this paragraph.

**Cause: `np.linalg.cholesky`, `inv` and `solve` do not raise `LinAlgError` in Pyodide's numpy (2.4.6); they return
NaN.** Checked on `[[1,2],[2,4]]` (singular) and on `-I` (not positive definite): CPython raises `LinAlgError` for
`inv`, `solve` and `cholesky`; Pyodide returns NaN arrays without an error. `scipy.linalg.cholesky`, `inv`, `solve` and
`cho_factor` raise correctly in both. (Probable reason, not checked: numpy's gufuncs report these failures through the
floating-point "invalid" status flag, which WebAssembly has no way to set or read.) The engine has 95 `LinAlgError`
references in 46 files and about 170 `np.linalg.inv`, 121 `solve` and 43 `cholesky` calls, so every fallback that
depends on that exception is dead in the browser, silently.
- **How it was found** (case `1001_mixed`: 0.3 s on CPython, killed at 600 s in Pyodide). The slow command is
  `mixed y week x || id: week, covariance(unstructured)`: 246 `loglik` calls on CPython, 19,692 in 30 s in Pyodide and
  still going. At the second iteration the finite-difference Hessian has one positive eigenvalue (+0.845).
  `ml.maximize` tests concavity with `try: np.linalg.cholesky(-H) / except LinAlgError`; in Pyodide that never raises,
  so it skips the non-concave correction and takes the plain Newton step, which is the wrong way along that
  eigenvector (length about 6 instead of 59). No trial point improves until the step is tiny, then the loop accepts
  gains of about 4e-10 per iteration up to its 16,000-iteration limit.
- **Confirmed by a shim:** in Pyodide, wrapping `np.linalg.cholesky`, `inv` and `solve` to raise `LinAlgError` when
  the input is finite and the result is not, `1001_mixed` runs in **1.7 s** in total.
- **Ruled out:** random relative noise of up to 1e-12 added to `loglik` on CPython does not change its path (246
  calls each time). The platforms do differ at machine precision (`ll` by 2.3e-13 at the first point, which becomes
  1e-4 in the Hessian after division by h² of about 1e-8), but that is not what stalls the fit.
- **Same cause for the others**, shown by running them with the shim (below): 1902, 1908, 1916, 1601, 1901 (timed out at
  600 s with PATCH-4 applied) and 0408, 1907, 1918 (the slow-fit numeric cases). Only 1001 was traced by hand.
- **The fix** (made 2026-11-07): `src/dofile/linalgshim.py`, called from `browser.start()`, not an edit of the vendored
  engine. It runs `inv`, `solve` and `cholesky` on a matrix that must fail and wraps only the ones that do not raise,
  so it does nothing on CPython and switches itself off if numpy is fixed. The wrapper raises `LinAlgError` when the
  inputs have no NaN and the result has one. All engine calls are `np.linalg.X` looked up at call time, so replacing
  the attribute reaches them (a CPython test fails if a `from numpy.linalg import` appears). Tests:
  `tests/test_linalgshim.py` (CPython, the wrapper against simulated NaN behaviour) and
  `web/test/linalgshim.test.mjs` (real Pyodide: before the shim all three return NaN, after `browser.start()` all
  three raise, and a fit that needs the non-concave step converges in 0.3 s).
- **Results in Pyodide with the shim** (`check-snapshot --normal --cases ...`, one process per case, 600 s limit): 9 of 9
  pass, 0 differ, 0 time out (total 141 s with 4 at a time): 0408 2.1 s, 1907 7.5 s, 1918 4.2 s, 1001 2.6 s, 1601 2.8 s,
  1901 2.7 s, 1902 29.7 s, 1916 40.8 s, 1908 138.7 s. Slowdown against CPython is now 1.5-5x for most (1902: 18 s on
  CPython; 1916: 23 s; 1908: 66 s, about 2x), where it was 20-500x or a timeout.
- **Other numpy.linalg functions, checked 2026-11-07** (102 probes of 28 functions on singular, zero, NaN, inf,
  indefinite, ill-conditioned and huge matrices, CPython against Pyodide; 74 identical). `det`, `slogdet`, `qr`, `norm`,
  `eigh` and `eigvals` agree (`eig` and `eigvals` return complex dtype on this CPython/LAPACK and real in Pyodide when
  the imaginary parts are zero: cosmetic). Differences:
  - **Raise on CPython, NaN in Pyodide:** `cholesky` of a NaN matrix (**now covered by the shim**; the first version let
    NaN input through), and `matrix_power(singular, -1)`, `tensorsolve`, `tensorinv`. These three call `inv`/`solve`
    through numpy's own module namespace, so the shim does not reach them; the engine uses `matrix_power` 3 times and the
    other two never.
  - **Non-finite input to the SVD family (`svd`, `pinv`, `matrix_rank`, `lstsq`):** CPython raises
    `LinAlgError: SVD did not converge`; Pyodide returns NaN or 0 (`matrix_rank` of a NaN matrix is 0), or raises a
    `ValueError` ("On entry to DLASCL parameter number 4 had an illegal value": `lstsq` of NaN, `eigvalsh` of inf), which
    an `except LinAlgError` does not catch. **Not shimmed.** The engine has 74 `lstsq`, 50 `pinv`, 40 `matrix_rank` and 8
    `svd` calls; only about 7 of them sit in a `try ... except LinAlgError` (`meglm.py:693`, `sspace.py:364`,
    `archmodel.py:603`, `mata/lib_linalg.py:140`, `graphics/baseplots.py:267`), and they only see non-finite input if
    missing values reach a design matrix, which the estimation commands drop first. Not shown to matter; a shim that
    raises `LinAlgError` for non-finite input to these four would match CPython if a case turns one up.
  - **Numbers on near-singular input** differ in the last digits: `pinv([[1,1],[1,1+1e-14]])` has entries 1.0060e14 on
    CPython and 9.95e13 in Pyodide, `cond` 4.02e14 and 3.98e14, and `lstsq` of that system returns `[0.997, 0.003]` and
    `[1, 0]`. A different LAPACK build, so expected; only exactly or nearly collinear regressors can show it.
  
  The 7 cases that did not finish in the first run (1904, 1910, 1914, 1915, 1919, 1920, 1921) have since run (see the
  update at the top of "Known gaps"). Break on a long fit in the browser was not tried.

**What was seen.** Running the Stata 14 comparison cases in Pyodide (`npm run check-snapshot`) took over 30 minutes,
where the repo's slow test runs the same cases on CPython in about 3 minutes serial. The time is not spread evenly. Timings
of single runs, the CPython ones taken on a busy machine, so rough:

| Case | CPython, native | Pyodide | Slowdown |
|---|---|---|---|
| 1905_panel | 3.6 s | 6.5 s | about 2× |
| 1907_models | 0.7–1.2 s | 25.3 s | about 20–35× |
| 1918_models3 | 0.8 s | 17.3 s | about 20× |
| 0408_mata_moptimize | 0.43 s | 204–220 s (three runs) | about 500× |

Two things follow. A uniform WebAssembly penalty would look like the first row (about 2×), so something else is going on
in the other three. And **the three slow cases are exactly the three "numeric known difference" failures** listed
in the table above, which suggests one cause for both. **The last result supports it:** the three logs have extra lines after the
known-difference filters (8, 1 and 1), and for `0408_mata_moptimize` the extra line is `convergence not achieved`. So in
Pyodide at least that optimizer runs to its iteration limit without converging, which would explain both the
evaluation counts below and the failures. Seen directly only for 0408; for 1907 and 1918 the extra lines were not
read (the first few changes printed were coefficient lines, not the extras), so non-convergence there is an inference.

**The profile of `1907_models`** (`cProfile` around `compare.run_opendta`, Pyodide 37.8 s under the profiler against 1.6 s on
CPython): the time is Python-level, in the likelihood code, called again and again for numerical gradients.

| Calls | CPython | Pyodide |
|---|---|---|
| `mleq.py` `fun` (the likelihood) | 752 | 141,963 (189×) |
| `mleq.py` `scores` (gradient) | 3,627 | 57,540 (16×) |
| `likelihoods.py` `_nb_terms` | 2,034 | 94,223 (46×) |

So the per-call cost is only a little higher; the optimizer asks for 16–190 times as many evaluations. The early part of the
case is identical in both: the `cloglog yb x1 x2` block prints the same iterations (`-406.82929`, `-299.69377`,
`-290.04183`, `-289.97775`) on CPython and in Pyodide, which also shows that the iteration numbers differ from Stata's
reference log (`-366.85045` first) on CPython too, as the case's known-difference rule says. The hot functions are the
zero-inflated negative binomial's likelihood (`zinb`, `_infl_prob`, `_nb_terms`), but the profile does not say which
command's fit makes the extra calls; that was not isolated.

**Not known**
- Which command, and why. For 0408 the log says the fit did not converge; what is not known is whether it hit an iteration
  limit or stopped on a convergence test (gradient or step tolerance) that noisier gradients never meet, or loops in a line
  search. `1918_models3` and `0408_mata_moptimize` were not profiled, and the extra lines of 1907 and 1918 were not read.
- Whether it is numerics. Hypotheses, none tested: a different BLAS or LAPACK build in Pyodide (reference
  implementations, different summation order) gives gradients that differ in the last digits; `scipy.special`
  (`gammaln`, `digamma`) or `scipy.stats` (`logcdf`) differ slightly; `np.longdouble` is not 80-bit on wasm32; the 32-bit
  `intp` (PATCH-4) changes a code path.
- How many cases in the browser this affects beyond the three. Seven cases were not finished when the runs were stopped
  (`1904_timeseries`, `1910_programming`, `1914_panel`, `1915_timeseries`, `1919_other_suites2`, `1920_models4`,
  `1921_graphics_look`), the same seven in both runs after 35 minutes; their contents were not looked at, and their names
  suggest estimation. Whether they are slow for the same reason, or would pass, is unknown.
- Whether it matters to users: a model like this could take minutes in the page. Break was not tried on a long fit.

**How to pick it up**
0. Read the extra lines first: print the lines that the Pyodide log has and Stata's lacks after the known-difference
   filters, for 1907 and 1918 (for 0408 it is `convergence not achieved`), and find which command printed each.
1. Time and count per command. Run a case under `cProfile` on both interpreters
   (`compare.run_opendta(compare.COMPAT / "do" / "1907_models.do", tmpdir)`; CPython with `uv run python`, Pyodide with a
   normal boot and `tests_opendta` mounted at `/od`, as `web/scripts/check-snapshot.mjs` does), and print the calls of
   `mleq.fun` and `scores`. Better: wrap `cmd_*` dispatch to log the seconds and the `fun` count of each command, to name
   the one command that explodes.
2. For that command, log the optimizer's iteration number, the objective and the gradient norm at each step on both,
   starting from identical parameters, and find the first place they differ (the first evaluation, the gradient, or the
   step).
3. Test the hypotheses one at a time: compare `scipy.special.gammaln` and the BLAS products on the same inputs; check
   `np.finfo(np.longdouble)` and `np.dtype(np.intp)`; check the optimizer's `maxiter` and tolerances in `mleq.py`.
4. If it is a numerics difference that cannot be removed, decide between widening the browser's tolerances, capping
   iterations, or telling the user a fit is slow.
5. Give `check-snapshot` a per-case time limit (the longest tail hid a result for over 30 minutes) and put the cases that are
   slow in Pyodide first in its list (its `SLOW` list is the CPython one: `1908`, `1909`, `1916`, `1902`, which die at
   `expand` anyway; the Pyodide-slow ones are `0408`, `1907`, `1918` and the 7 above).

## Experiment: loading matplotlib lazily

Status: **not done** (still to do as of 2026-11-07). Findings and conjectures recorded 2026-11-07, while working on the
snapshot ([pyodide-snapshot.md](pyodide-snapshot.md)). Nothing in the repo implements any variant of this: the snapshot
build still imports matplotlib and draws one graph, and its bundle includes matplotlib's files. Measured again on
2026-11-07 in Node (a normal boot, nothing from a snapshot): `browser.start()` imports numpy and scipy and takes 1.8 s;
matplotlib and PIL are imported by the first graph, which takes 0.82 s, so the regular flow's matplotlib import is already
lazy, as this section says below.

**The question.** Matplotlib is about 28% of the site-packages files and about 23 MB of the snapshot's heap, and it is
needed only when a program draws a graph. Should it be loaded on demand: in the snapshot flow (leave it out of the
heap and the main download), in the regular flow (the page without `?snapshot=1`, which imports it on the first plot),
or both? The preference stated for this decision: the first plot should not take about a second, as it does in the
regular flow today. The snapshot flow's eager import is an advantage worth keeping unless lazy loading saves
**significant** time at both a cold and a warm start without bringing that delay back.

### Measured

Pyodide 314.0.7 under Node, a normal boot (no snapshot), an M-series Mac, 3 runs each. The first plot is `scatter y x`
in a fresh `Engine`, after numpy, scipy and `dofile.engine` were loaded. Not yet measured in a browser.

| Part of the first plot | Time | Share |
|---|---|---|
| Compiling matplotlib's `.py` files to bytecode (147 files; no `.pyc` file exists for any of them) | 0.59–0.61 s | about 68% |
| Running the modules' code (173 modules in all; 0.80–0.84 s for the whole import, of which the compile above is most) | about 0.2 s | about 25% |
| Fonts and first-use drawing (the plot after the imports took 0.067–0.072 s, a second plot 0.041–0.051 s) | about 0.03 s | about 3% |
| The plot itself | 0.041–0.051 s | about 5% |
| **First plot** | **0.87–0.89 s** | |

- **With unchecked-hash `.pyc` files written for those 147 modules beforehand, the first plot took 0.286–0.294 s.**
  This is the one experiment behind the "0.9 s to 0.3 s" figure. It is a normal boot with the `.pyc` files written
  just before the plot (standing in for a build step), under Node.
- **Fonts are not the delay.** The profile showed the font list loading in 0.001 s (Pyodide's matplotlib ships a
  prebuilt list), the first font lookup about 0.002 s and opening the font file about 0.002 s. The profiler itself
  slows everything: the same plot read 1.24–1.29 s under `cProfile`.
- **On CPython (macOS, the engine the CLI uses, called from Python, not through the `dofile run` command):** with a cold
  font cache the first plot took 11.2 s, all of it `findSystemFonts` scanning the system's 1,070 fonts. With a warm
  cache it took 0.36 s (a second plot 0.022 s), of which about 0.27 s was importing 182 modules. Compiling the 172
  source files from scratch took 0.375 s against 0.149 s to import them with `.pyc` files. The cold-cache cost does not
  exist in the browser, which has no system fonts.
- **In the snapshot flow the first plot is already fast**, because matplotlib is imported and compiled before the heap
  is saved. The sample program (regress and a scatter) took 0.11 s there against 0.87 s in the regular flow.
- **The engine already loads matplotlib lazily** (`graphics/render.py` imports it inside functions), so no engine
  change is needed for either flow. The profile showed no `pyplot` import during the first plot, so the renderer seems to
  use the figure and Agg classes directly. This was read off the profile, not checked in the source.
- **What matplotlib is worth in the snapshot** (from the stage-by-stage build, brotli 5, and the file bundle): its
  import adds 23 MB of raw heap (113 to 136 MB) and **4.5 MB** compressed (26.1 to 30.6 MB). Its files and its
  dependencies (pillow, fonttools, kiwisolver, contourpy, pyparsing, dateutil, pytz, six) are 1,052 of the 3,884
  files, 26–27 MB of 93 MB raw, and **7.4 MB** compressed. Only 16 of the 136 native libraries are graphics-only
  (matplotlib 8, PIL 6, kiwisolver 1, contourpy 1), 0.7 of 6.3 MB of library static memory.
- **No `.pyc` anywhere in the bundle** (`__pycache__` count 0), so the regular flow compiles everything it imports on
  every page load, not only matplotlib. Pyodide's package loader does not write `.pyc` files.

### Conjectures (not measured)

**Snapshot flow, lazy graphics.** How it would work:
1. The build's warm-up draws nothing, so matplotlib is never imported (assert `'matplotlib' not in sys.modules`). The
   bundle is split into a core part and a graphics part (matplotlib, mpl_toolkits, pylab, PIL, pillow, kiwisolver,
   contourpy, fontTools, cycler, pyparsing, dateutil, pytz, six) with its own file index, and the graphics part
   carries unchecked-hash `.pyc` files for the modules a plot imports. The 16 graphics libraries are not in the
   re-link list; they link normally at their first import.
2. The page restores the core snapshot as today. The engine is ready sooner.
3. After "ready" the worker fetches the graphics part (Cache API, brotli, as the other files), decompresses it and
   writes its files into site-packages.
4. `run` waits for those files before executing anything, because any command can draw and the program text does not
   say which will. Optionally the worker also imports matplotlib right after the files land, so the first plot pays
   no import.

| Estimate, brotli 11 (the library-copy zeroing included) | Now (eager) | Lazy: core, before "ready" | Lazy: graphics, after |
|---|---|---|---|
| Heap | 22.1 MB (measured) | about 18.6 MB | |
| Files | 20.0 MB (measured) | about 13.8 MB | about 6.2 MB, plus about 2 MB of `.pyc` (a guess) |
| Total | 42.1 MB (46.5 MB without the zeroing) | **about 32–33 MB** | **about 8 MB** |

The graphics shares are the brotli 5 figures above scaled by the 0.77 (heap) and 0.84 (files) ratios measured between
brotli 5 and 11. A visitor who plots downloads about 40.6 MB in all, about the same as eager. The gain is about 9.7 MB
less before "ready". Timing guesses: warm start about 1.05 s instead of 1.2 s (21% fewer bytes to decompress, of the 0.66 s measured on
2026-11-07); the first plot after a warm start about 0.4 s with `.pyc` (0.29 s plus writing the files) or about 1.0 s without;
a cold start about 0.8 s faster at 100 Mbps and about 2.6 s faster at 30 Mbps, which would bring the snapshot at 30 Mbps from
14.6 s (measured 2026-11-07 with the 42.3 MB build; the guess was first made from 16.0 s with the 46.5 MB one) to about 12.0 s,
ahead of the regular boot's 14.1 s.

**Regular flow.**
- **(a) Import matplotlib in the background once the engine is ready.** It moves the 0.9 s off the click and changes no
  download. Python is single-threaded in the worker, so a Run issued during that import waits up to about 0.9 s.
- **(b) Ship precompiled `.pyc` files for the graphics packages.** Gain: the first plot at about 0.3 s. Matplotlib comes
  from Pyodide's own distribution (CDN) with no `.pyc` files, so it would need our own repackaged wheel or bundle,
  hosted by us, tied to this Python build, and with an unknown download cost.
- **(c) The same compile cost probably applies to the whole stack.** The Node phase table (scipy import 1.65 s,
  matplotlib 0.94 s, numpy 0.22 s, engine 0.51 s) may be mostly compiling too. If it is about two thirds, as for
  matplotlib, `.pyc` for everything could cut several seconds from the regular boot, and the snapshot flow already
  avoids that cost. Not measured for numpy, scipy or dofile.
- **(d) Keep compiled bytecode between visits** (an IndexedDB-backed cache). An idea only: Python writes `.pyc`
  files that are checked against the source's modification time, which differs on every page load, so they would be
  stale. Unexplored.

### The experiment

1. **Build the lazy snapshot** (a build option or a scratch script; the scratch script written on 2026-11-07 was
   stopped before it ran and is not in the repo): warm-up without drawing, the assertion, the split bundle, `.pyc` for
   the modules a first plot imports (record them by diffing `sys.modules` around the first plot). Measure the raw, q5 and
   q11 sizes of the heap, the core files, the graphics files and the graphics files with `.pyc`. This replaces the table
   of estimates.
2. **Time it under Node:** the core restore (compare with the eager 1.31 s), then loading the graphics part (decompress
   and write), then the first plot with and without `.pyc`, and with a pre-import. Compare with the eager first program
   (0.11 s).
3. **Time it in the browser** the way `pyodide-snapshot.md` does: Chromium first, then Firefox and WebKit; unthrottled,
   100 Mbps and 30 Mbps; cold and warm; plus the case that matters for the gating, a plot started one second after
   "ready".
4. **Decide the gating:** whether `run` waits for the graphics files for every program, and what the status line says
   while it waits.
5. **Regular flow:** measure (a), (b) and (c) above, including the compile-versus-import split for numpy, scipy and
   dofile.
6. **Correctness:** `npm run check-snapshot` on the lazy variant (the corpus, the probes with graphs, the Stata 14
   cases) and the native-library test; core code must not import a graphics package (`pytz`, `dateutil` and `six` are
   the doubtful ones).

**Decision rule.** Adopt lazy graphics in the snapshot flow only if, measured, a cold first visit at 30 Mbps is about
2 s faster, a warm start is at least about 0.2 s faster, and the first plot stays at or under about 0.5 s. Otherwise keep
it eager. For the regular flow, take the cheapest of (a) and (b) that brings the first plot well under a second without
making Run wait noticeably in the first seconds.

**Risks.** A plot started in the first moments waits for the graphics download on a slow network. A second file to keep in
sync with the manifest. `.pyc` files tie the graphics part to this exact Python build (a Pyodide upgrade already
forces a snapshot rebuild). Core code that quietly imports a graphics package would fail only on the lazy path.

## Verification (end of Phase 2)
`[x]` done, `[~]` partly, `[ ]` not done. Status of 2026-11-07.
- [~] The conformance corpus gives the same numbers in Pyodide as in CPython. Checked by hand, not in CI: the 63 corpus values
      match the reference to 1e-6 in Pyodide (normal boot and snapshot start), 95 of 97 Stata cases pass, and e() and r() of
      all 98 programs agree with CPython to 1e-9 for 95% of estimation results. CI is step 9.
- [~] Upload a replication package's .do and .dta files. A do-file that uses absolute Windows paths and starts
      with `cd` runs without edits, and the log notes each mapped path. The e2e does this for one file
      (`use C:\Users\me\proj\cps`, the note, a regression checked to 1e-6) in four browsers; a real replication package
      has not been tried.
- [x] Reload the page: files are still there. Data in memory is not (the page says so). In the e2e: Save, reload, files and
      the editor's text come back; Reset gives a new engine with no data and the files kept.
- [~] Break stops `while 1 {}` with rc 1 and keeps the data (in the e2e, four browsers). A long single command is ended by
      restarting the worker, and the page says the data is gone: tested in Node (`web/test/engine.test.mjs`), not in a browser;
      Break on a long model fit was not tried.
- [~] Works in current Chrome, Firefox and Safari. Chromium, Firefox and WebKit pass the e2e (with and without the snapshot,
      and an iPhone 15 profile); real Safari and a real phone were not tried. Cold load size and time are written down in
      [pyodide-snapshot.md](pyodide-snapshot.md#results).
- [ ] No request leaves the page after load except for the static assets (checked in the browser's network tab).
- [ ] `pip install dofile` works from PyPI.

## Risks
- **Load size and time.** Pyodide plus scipy and matplotlib is tens of MB on the first visit. Measure in step 1.
  If it is too slow, load matplotlib only on the first `graph` command (the regular flow already does; the snapshot flow does not: step 4a).
- **Memory.** WebAssembly has at most 4 GB, and less on phones. A large .dta can fail where the CLI works. The page
  must report an out-of-memory error clearly and not freeze.
- **Browser storage can be cleared**, even though IndexedDB is on disk (from the browsers' docs; check in step 4):
  - the user clears site data, or uses a private window (kept only until the window closes);
  - the browser evicts it when the disk is nearly full, unless `navigator.storage.persist()` was granted. Chrome
    grants it based on use, Firefox may ask, and Safari decides itself;
  - **Safari deletes a site's IndexedDB after 7 days without a visit**, unless the site was added to the home
    screen. A student who comes back after a week finds their files gone.

  So the page must say that files are kept only in this browser, offer a download of everything as a zip, and on
  Safari say that files are kept for 7 days without a visit. Quotas (several GB or more) are not the limit: the
  4 GB WebAssembly memory is.
- **Path mapping can pick the wrong file** when two files have the same name in different folders. The log note
  makes this visible. The longest-tail rule makes it rare.
- Safari: storage and SharedArrayBuffer differences. Test early.
