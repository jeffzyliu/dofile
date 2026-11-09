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
- **The engine matches CPython in Pyodide.** Two browser-only bugs were found and fixed
  (PATCH-4: `np.repeat` counts as `intp`; a shim for `numpy.linalg` raising `LinAlgError`), and the two packages Pyodide lacked
  are installed (pandas is not, see below) (2026-11-09: `xlwt` and `xlrd` for `.xls`, `pyreadstat` built for Pyodide, without pandas; see [Known gaps](#known-gaps-in-the-browser-engine)).
  95 of 97 Stata 14 cases pass (1701 and 1911 call `export sasxport`; with pandas loaded they match too), 1060 of 1085 unit tests (the rest skip for pandas, statsmodels, Qt and certifi, or are `shell`), 99.5% of estimation results agree with CPython to 1e-3 and 95% to 1e-9. The differences that remain are in
  fits whose answer the data does not pin down (ODT-30, an OpenDTA optimizer issue). Nothing of this is in CI yet.
- **The memory snapshot** (the page's default start since 2026-11-09, `?snapshot=0` is the normal boot, no fallback; [pyodide-snapshot.md](pyodide-snapshot.md)): a return visit starts in 1.2 s
  against 4.5–9.2 s, a first visit in 1.7 s unthrottled and 5.1 s at 100 Mbps, level with the normal boot at 30 Mbps. It
  is 39.9 MB (brotli 11, docstrings stripped). It works in Chromium, Firefox, WebKit and an iPhone profile. **One real iPhone
  (2026-11-08, over the LAN): the snapshot start took 28–30 s, 25–28 s of it unpacking with brotli-wasm; with the browser's own
  brotli decoder the unpack is about 3 s. The normal boot took 9.2 s.** The status line now says where a start's and a run's
  time goes. A snapshot older than the code is refused (the manifest holds the wheel's hash). Details:
  [On a real iPhone](pyodide-snapshot.md#on-a-real-iphone-2026-11-08). Which size optimizations are done and which are not: [File size](pyodide-snapshot.md#file-size-what-is-done-and-what-is-not).
- **Tools:** `npm run check-snapshot`, `check-pytest`, `check-numeric` and `web/scripts/measure-startup.mjs`.

**Still open in Phase 2:** the lazy-matplotlib experiment (4a, not started), whether the snapshot becomes the default (the
real-phone numbers above are one input; a phone over HTTPS with the cache working, and a first visit over a real network,
were not measured), the `pyreadstat` wheel in a real browser (it passes under Node; iOS Safari not tried), the CI workflows' first results (step 9), and steps 5 to 10.

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
In progress: deliverables 1–3 (moodboard, user flows, wireframes) done, 4 (high-fidelity mockups) done (iteration 3 is the final one), 5 (the
design system) done: tokens in `web/src/styles/tokens.css`, components in `docs/design/mockups/ui.css`, the component
sheet and its crit in `docs/design/system/`, contrast and font checks. The banner is B2. Open for steps 6 and 8: text
sizes in rem, text field states, the phone's bottom sheet and toast placement (`docs/design/system/critique.md`). The brief, the deliverables, the rules (WCAG AA, keyboard, screen-reader log; clean room;
naming), every round of feedback and the status are in `docs/design/README.md`; the flows, wireframes and mockups are in
`docs/design/`.

Decisions of iteration 2 (2026-11-09, after the UX crit `docs/design/mockups/ux-analysis.md`) that affect the build:
- Run and Run selection run a copy of the editor's text, saved or not; `do` and `include` read the saved file, and the
  log notes when that file is open with unsaved edits. Editing during a run is allowed and doesn't change it.
- A first visit asks before downloading the engine (about 36 MB, from the build), then shows a download bar and the
  start-up stages in the same dialog; later visits show the stage on Run and in the status bar. "Not now" leaves a
  working editor and file manager. To build: the page reads the IDBFS IndexedDB store itself when Python isn't loaded,
  and counts the download's bytes with its own fetch wrapper.
- Data tab: a click on a variable marks its column in Browse; it inserts nothing.
- Reset asks first. Name clash: "Keep mine" (default) or "Replace with uploaded", plus "do the same for the rest".
- Per-file ⋯ menu (Open, Rename, Download, Delete); "Download all (.zip)" under the file list.
- The phone's Break replaces Run with another shape and color and ignores taps in its first 600 ms.
- Deferred: storage persistence per browser, the iOS long press, a real-phone test of the Break guard.

Decisions of iteration 3 (2026-11-09, after the second crit `docs/design/mockups/ux-analysis-2.md`) that affect the build:
- Break's countdown offers "Don't reset: wait for it": the page cancels its 5 s kill timer (`client.js`) and the engine
  takes the Break at the next safe point (rc 1, data kept); while it waits, Break becomes "Reset now".
- The download can be stopped (abort the fetch; resume from the cache later); after "Not now", Run opens the prompt.
- A selection run warns, in the page's run-head line, about a local it uses that no earlier run has set (the page
  compares the tokenizer's macro references with the session's locals, ignoring names the selection itself assigns).
- The file list is an ARIA tree with roving focus; editor tabs are a tablist, Delete closes (Cmd/Ctrl+W
  belong to the browser); Results
  values and Data names take focus. Name clash: Esc keeps yours for every remaining clash.
- Storage: ask `navigator.storage.persist()`; when `persisted()` is false, show "This browser may clear your files".
- Checks over the mockups: `cd web && npm run axe` and `npm run tabwalk`.

Engine and page work the design needs (steps 6–8): a whole-file run starts with no locals (see "Scope" below); list
locals and globals for the Results panel; report memory use; unpack and make .zip files in the worker; return the first
rows of the data (Browse); a dark plotting style, picked by an option on the run call (`Engine.run` / `browser.run`)
from the page's light/dark mode, leaving `graph export` files and the CLI/MCP defaults as they are unless asked; the
editor's tokenizer underlines commands the engine lacks and lists them per uploaded do-file. Keyboard shortcuts are
tabled (Cmd+. is Safari's Stop, Cmd+L the address bar). PyPI: `docs/releasing.md`.

## What the page does
- **Landing page:** what dofile is, a "try it" button, the CLI and MCP install lines (`pip install dofile`), the
  OpenDTA credit and links. Static HTML.
- **Editor:** a file panel (upload by button or drag and drop, download, rename, delete, new .do file), the editor,
  Run (whole file) and Run selection, Break, a log pane with errors marked,
  graphs (a Graph tab with the session's graphs; inline in the log on a phone), a data view (variables like `describe_data`, plus the first rows), and the e()/r() results.
  Ctrl+Enter runs. One sample project loads on first visit.
- **Scope (decided 2026-11-08):** every run is a do-file call (preserve restored, temporaries dropped at its end). A
  whole-file run (Run, or Ctrl/Cmd+Enter with nothing selected) starts with no locals, as a do-file does in Stata, so
  running a file twice gives the same answer. A selection and the command line keep the locals from the runs before
  them. Globals, data and e()/r() carry over. To build: an option on `Engine.run` that clears the top-level locals
  (`session.macros`, in `engine.py`, no OpenDTA patch), passed by `browser.run`, with a test in `tests/test_engine.py`;
  the MCP server keeps today's behavior. The Results panel lists the locals and globals (a new adapter call; internal
  temporary names hidden). Full user flows: `docs/design/flows/`.
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
   39.9 MB at brotli 11 (42.3 MB before docstring stripping became the default), restore in 1.2 s; `web/scripts/make-snapshot.mjs`, `web/src/engine/snapshot.js`. Whether it
   becomes the default is open.
4d. ~~**Check the engine in Pyodide against CPython**~~ done 2026-11-07, by hand, not in CI: `check-snapshot` (conformance
   corpus and the 97 Stata 14 cases), `check-pytest` (OpenDTA's unit suite, test by test against CPython) and
   `check-numeric` (e() and r() at full precision, 109,265 numbers). Results in [Known gaps](#known-gaps-in-the-browser-engine).
4e. ~~**Browsers**~~ done 2026-11-07: the e2e passes in Chromium, Firefox, WebKit and an iPhone profile, with and without the
   snapshot. Found and fixed on the way: iOS (Pyodide creates no wasm trampoline there, so a snapshot made in Node failed at
   start; [The trampoline](pyodide-snapshot.md#the-trampoline)), and cache failures that were swallowed. A real phone was tried
   by hand on 2026-11-08 ([On a real iPhone](pyodide-snapshot.md#on-a-real-iphone-2026-11-08)). The first CI run found that the
   e2e helper's Ctrl+A then `insertText` left the editor's last line behind in WebKit on Linux (the iPhone profile): it ran
   `display "EDITED"scatter y x` and got rc 111. The tests now replace the editor's text through `window.__editor`, a view
   that `main.ts` exposes for them; whether a real iOS keyboard's select-all does the same was not checked.
5. **UI/UX design** (section above): flows, wireframes, mockups, design tokens.
6. **Editor page** built to the design: files, editor, run, log, graphs, data view, results.
7. **Publish to PyPI** (moved from Phase 1): the landing page tells people to `pip install dofile`, so the
   release must exist first. Trusted Publishing from GitHub Actions, no stored token. The page can load the same
   wheel from its own origin.
8. **Landing page**, sample project, clean-room check of all text.
9. **CI:** run the corpus in Pyodide under Node on each push. Build `web/` and deploy `main` to the host.
   A browser smoke test (Playwright, one browser): load, upload a .dta, run a regression, check the coefficient.
   The checks exist and are run by hand (`check-snapshot` about 4 minutes, `check-pytest` about 2, `check-numeric` about 4,
   `npm test` and `npm run e2e` about 1 each); `.github/workflows/web.yml` (2026-11-08) runs on pull requests: `npm run check`,
   a check that `commands.json` is current, `npm test`, `build`, `e2e` in four browser profiles, and `npm run snapshot` with
   `npm test` and `check-snapshot` (a push to `main` runs only the first job; a pull request that changes nothing under `web/`, `src/` or the
   Python build files skips the test jobs but still reports through the `web ok` job, which is the one to require in branch protection; `ci.yml` has the same
   `ci ok`, with its own filter: `src/`, `tests/`, `tests_opendta/`, `scripts/` and the Python build files). `check-pytest` and `check-numeric` stay by hand. `check-snapshot` needs a built snapshot only for its default
   mode; `--normal` does not. First runs on GitHub found: the runner is slower than a laptop (1908_models2 took over 300 s
   with four cases at a time, so the per-case limit is 900 s in CI); the two package-gap cases (1701, 1911) now count as
   expected differences, a strict xfail (`EXPECTED_DIFFER` in `check-snapshot.mjs`); and iPhone-profile WebKit on Linux needs
   the editor hook above. The iPhone-profile run took about 200 s to become ready once, so the e2e waits for the engine
   up to 300 s and a test may take 600 s.
10. **Launch:** domain, test in Chrome, Firefox and Safari (desktop and phone), link from the README.

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
   ([pyodide-snapshot.md](pyodide-snapshot.md#packages-added-xlwt-xlrd-and-pyreadstat-2026-11-09)). The snapshot is 41.6 MB.
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

## Experiment: loading matplotlib lazily

Status: **not done**; nothing in the repo implements it (the snapshot build still imports matplotlib, draws one graph, and
bundles matplotlib's files). Findings and conjectures recorded 2026-11-07, while working on the snapshot
([pyodide-snapshot.md](pyodide-snapshot.md)).

**The question.** Matplotlib is about 28% of the site-packages files and about 23 MB of the snapshot's raw heap, and it is
needed only when a program draws a graph. Should it be loaded on demand in the snapshot flow (left out of the heap and the
main download), in the regular flow (which already imports it at the first plot), or both? The first plot should not take
about a second, as it does in the regular flow today. The snapshot's eager import is worth keeping unless lazy loading saves
**significant** time at a cold and a warm start without bringing that delay back.

### Measured

Pyodide 314.0.7 under Node, a normal boot, an M-series Mac, 3 runs each; the first plot is `scatter y x` in a fresh `Engine`
after numpy, scipy and `dofile.engine` were loaded. `browser.start()` itself takes 1.8 s (numpy and scipy); matplotlib and PIL
come with the first graph. Not yet measured in a browser.

| Part of the first plot | Time | Share |
|---|---|---|
| Compiling matplotlib's 147 `.py` files to bytecode (no `.pyc` exists for any) | 0.59–0.61 s | about 68% |
| Running the modules' code (173 modules) | about 0.2 s | about 25% |
| Fonts and first-use drawing | about 0.03 s | about 3% |
| The plot itself | 0.04–0.05 s | about 5% |
| **First plot** | **0.87–0.89 s** | |

- **With unchecked-hash `.pyc` files written for those 147 modules beforehand, the first plot took 0.29 s** (the one experiment
  behind "0.9 s to 0.3 s": `.pyc` files written just before the plot, standing in for a build step).
- **Fonts are not the delay:** the font list loads in 0.001 s (Pyodide's matplotlib ships a prebuilt list). On CPython a cold
  font cache cost 11.2 s (scanning 1,070 system fonts), which does not exist in the browser.
- **In the snapshot flow the first plot is already fast** (the sample program took 0.11 s against 0.87 s in the regular flow),
  because matplotlib is imported and compiled before the heap is saved.
- **The engine already imports matplotlib lazily** (`graphics/render.py` imports it inside functions), so neither flow needs an
  engine change. The profile showed no `pyplot` import during the first plot (read off the profile, not checked in the source).
- **What matplotlib is worth in the snapshot** (stage-by-stage build, brotli 5, and the bundle): importing it adds 23 MB of raw
  heap and **4.5 MB** compressed; its files and dependencies (pillow, fonttools, kiwisolver, contourpy, pyparsing, dateutil,
  pytz, six) are 1,052 of the 3,884 files, 26–27 MB of 93 MB raw, **7.4 MB** compressed. Only 16 of the 136 native libraries
  are graphics-only.
- **No `.pyc` anywhere in the bundle**, so the regular flow compiles everything it imports on every page load. Pyodide's
  package loader does not write `.pyc` files.

### Conjectures (not measured)

**Snapshot flow, lazy graphics.**
1. The build's warm-up draws nothing, so matplotlib is never imported (assert `'matplotlib' not in sys.modules`). The bundle is
   split into a core part and a graphics part (matplotlib, mpl_toolkits, pylab, PIL, pillow, kiwisolver, contourpy, fontTools,
   cycler, pyparsing, dateutil, pytz, six) with its own file index and `.pyc` files for the modules a plot imports. The 16
   graphics libraries leave the re-link list and link normally at their first import.
2. The page restores the core snapshot as today, so the engine is ready sooner.
3. After "ready" the worker fetches the graphics part (Cache API, brotli), decompresses it and writes it into site-packages.
4. `run` waits for those files, because any command can draw. Optionally the worker imports matplotlib right after, so the
   first plot pays no import.

| Estimate, brotli 11 (from the 42.3 MB build, before docstring stripping) | Now (eager) | Lazy: core, before "ready" | Lazy: graphics, after |
|---|---|---|---|
| Heap | 22.2 MB (measured) | about 18.6 MB | |
| Files | 20.0 MB (measured) | about 13.8 MB | about 6.2 MB, plus about 2 MB of `.pyc` (a guess) |
| Total | 42.3 MB | **about 32–33 MB** | **about 8 MB** |

The graphics shares are the brotli 5 figures scaled by the ratios measured between brotli 5 and 11 (0.77 heap, 0.84 files). A
visitor who plots downloads about the same in all; the gain is about 9.7 MB less before "ready". Timing guesses: a warm start
about 1.05 s instead of 1.2 s; the first plot after a warm start about 0.4 s with `.pyc` or about 1.0 s without; a cold start
about 0.8 s faster at 100 Mbps and 2.6 s faster at 30 Mbps, which would bring the snapshot at 30 Mbps from 13.9 s to about
11.3 s, ahead of the regular boot's 13.9 s.

**Regular flow.**
- **(a) Import matplotlib in the background once the engine is ready.** It moves the 0.9 s off the click and changes no
  download. A Run issued during that import waits up to about 0.9 s (Python is single-threaded in the worker).
- **(b) Ship precompiled `.pyc` files for the graphics packages.** The first plot at about 0.3 s. Matplotlib comes from
  Pyodide's CDN without `.pyc` files, so this needs our own repackaged bundle, tied to this Python build.
- **(c) The same compile cost probably applies to the whole stack** (scipy import 1.65 s, matplotlib 0.94 s, numpy 0.22 s,
  engine 0.51 s). If about two thirds is compiling, `.pyc` for everything could cut several seconds from the regular boot.
  Not measured.
- **(d) Keep compiled bytecode between visits** (IndexedDB). An idea only: `.pyc` files are checked against the source's
  modification time, which differs on every page load.

### The experiment

1. **Build the lazy snapshot** (a build option): warm-up without drawing, the assertion, the split bundle, `.pyc` for the
   modules a first plot imports (found by diffing `sys.modules` around it). Measure the raw, q5 and q11 sizes of the heap, the
   core files, the graphics files, and the graphics files with `.pyc`. This replaces the estimate table.
2. **Time it under Node:** the core restore, loading the graphics part, and the first plot with and without `.pyc` and with a
   pre-import, against the eager first program (0.11 s).
3. **Time it in the browser** with `web/scripts/measure-startup.mjs`: unthrottled, 100 and 30 Mbps, cold and warm, plus a plot
   started one second after "ready".
4. **Decide the gating:** whether `run` waits for the graphics files for every program, and what the status line says.
5. **Regular flow:** measure (a), (b) and (c), including the compile-versus-import split for numpy, scipy and dofile.
6. **Correctness:** `npm run check-snapshot` on the lazy variant, and the native-library test; core code must not import a
   graphics package (`pytz`, `dateutil` and `six` are the doubtful ones).

**Decision rule.** Adopt lazy graphics in the snapshot flow only if, measured, a cold first visit at 30 Mbps is about 2 s
faster, a warm start is at least about 0.2 s faster, and the first plot stays at or under about 0.5 s. Otherwise keep it eager.
For the regular flow, take the cheapest of (a) and (b) that brings the first plot well under a second without making Run wait
noticeably.

**Risks.** A plot started in the first moments waits for the graphics download on a slow network. A second file to keep in sync
with the manifest. `.pyc` files tie the graphics part to this exact Python build. Core code that quietly imports a graphics
package would fail only on the lazy path.

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
      and an iPhone 15 profile); one real iPhone was tried by hand (Safari, over the LAN); Chrome and Edge as shipped, Android and
      Safari on a Mac were not. Cold load size and time are written down in
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
