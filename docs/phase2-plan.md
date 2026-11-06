# dofile — Phase 2 plan: web demo

**Goal:** a static website with a landing page and a single-page editor that runs .do code in the browser. The
dofile engine runs in Pyodide inside a Web Worker. The user uploads their own files (.do, .dta, .csv, .xlsx) into a
virtual working folder, and code that names a file by any path finds it there. Nothing runs on a server, so there
are no accounts and no hosting cost beyond static files.

**Not in Phase 2:** accounts, sync between devices, sharing or collaboration, server-side execution, the MCP server
(Phase 3), community commands, tutorials beyond one sample project, our own estimators.

**Status (2026-11-06):** steps 1 (the Pyodide spike) and 2 (the path shim) are done, see [Spike results](#spike-results-2026-11-06);
storage and the path shim are decided. Phase 1 is complete ([phase1-plan.md](phase1-plan.md)).

## Facts this plan rests on
- **OpenDTA ran unmodified in Pyodide 314** (Python 3.14) under Node during the engine evaluation
  ([engine-evaluation.md](engine-evaluation.md#browser-pyodide-31407-run-under-node)), with Pyodide's bundled
  numpy, scipy and matplotlib. dofile's other dependency, openpyxl, is pure Python (micropip). The dofile wheel is
  pure Python. Development is already pinned to 3.14 for this reason. Confirmed for the built dofile wheel in the
  spike (2026-11-06).
- **Most of dofile's process layer does not apply in a browser.** `worker.py` (forkserver, child processes) and the
  audit hook in `sandbox.py` need processes and signals. The browser tab is the sandbox: the code can reach only
  the files the user gave it. The Web Worker takes the place of the child process. `engine.Engine` is used
  directly. Only commands that reach outside the page stay denied (`shell`, `webuse`, `copy` from a URL).
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
  Pages and Netlify can (`_headers`). Pyodide from a CDN must then be loaded with CORS, or self-hosted. Plan on
  `require-corp`; check `credentialless` in Safari in step 4 (the first browser test) before relying on it.
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
- **Pyodide in a Node worker thread** has no file descriptors 1 and 2, so `loadPyodide` needs `stdout`/`stderr`
  callbacks (a browser Web Worker uses the console by default, and the page will capture output anyway).
- Clean-room reminder: `sysuse auto` gives rc 601, because OpenDTA doesn't ship Stata's example datasets. The
  sample project must use our own data.

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
5. **Where the web code goes in the repo** (see [Repository layout](#repository-layout)).
6. **Hosting.** (Recommended) Cloudflare Pages: free, can set headers, deploys from GitHub Actions. Domain to
   choose.
7. **Where Pyodide loads from.** jsDelivr CDN (cached across sites, CORS headers) or self-hosted (one origin, no CORS
   issue). Decide after step 1 measures it.

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
- Output that MCP already formats (`Result`, `results()`, `data_summary()`) is reused as is, sent from the Web
  Worker as JSON.

## Order of work (each step ends green)
1. ~~**Spike under Node**~~ done 2026-11-06 ([Spike results](#spike-results-2026-11-06)). Warm start time is left to
   step 4, because a browser's cache differs from Node's.
2. ~~**Path shim**~~ done 2026-11-06: `src/dofile/pathshim.py` (`install(root, note)`, `uninstall()`) on top of
   PATCH-3, a hook at the ~25 places OpenDTA turns a file name into a path ([opendta-issues.md](opendta-issues.md)).
   Tests (`tests/test_pathshim.py`): 22 file commands with a Windows and a POSIX foreign path, the note, tempfiles,
   a missing file (rc 601 after the note), `cd`, and a guard against unhooked sites after a re-vendor. Unquoted
   Windows paths in `mkdir`/`rmdir`/`copy`/`dir` lose their backslashes in the engine (ODT-26, open).
3. **Browser entry point:** a small Python module the Web Worker calls (`run`, `files`, `describe`, `matrix`), plus
   the worker script and its message protocol. The entry point installs its own SIGINT handler that calls
   `break_.request()` (the one in `worker.py` isn't loaded in the browser). The restart path.
4. **Proof-of-concept page** in `web/`, plain TypeScript, unstyled: editor (CodeMirror 6 or Ace, try both on a
   phone, decision 4), upload into `/work` with IndexedDB persistence, Run, Break, log, graphs. The first Stata
   highlighter. Ends with decisions 3 and 4 settled.
5. **UI/UX design** (section above): flows, wireframes, mockups, design tokens.
6. **Editor page** built to the design: files, editor, run, log, graphs, data view, results.
7. **Publish to PyPI** (moved from Phase 1): the landing page tells people to `pip install dofile`, so the
   release must exist first. Trusted Publishing from GitHub Actions, no stored token. The page can load the same
   wheel from its own origin.
8. **Landing page**, sample project, clean-room check of all text.
9. **CI:** run the corpus in Pyodide under Node on each push. Build `web/` and deploy `main` to the host.
   A browser smoke test (Playwright, one browser): load, upload a .dta, run a regression, check the coefficient.
10. **Launch:** domain, test in Chrome, Firefox and Safari (desktop and phone), link from the README.

## Verification (end of Phase 2)
- [ ] The conformance corpus gives the same numbers in Pyodide as in CPython (CI).
- [ ] Upload a replication package's .do and .dta files. A do-file that uses absolute Windows paths and starts
      with `cd` runs without edits, and the log notes each mapped path.
- [ ] Reload the page: files are still there. Data in memory is not (the page says so).
- [ ] Break stops `while 1 {}` with rc 1 and keeps the data. A long single command is ended by restarting the
      worker, and the page says the data is gone.
- [ ] Works in current Chrome, Firefox and Safari. Cold load size and time are written down here.
- [ ] No request leaves the page after load except for the static assets (checked in the browser's network tab).
- [ ] `pip install dofile` works from PyPI.

## Risks
- **Load size and time.** Pyodide plus scipy and matplotlib is tens of MB on the first visit. Measure in step 1.
  If it is too slow, load matplotlib only on the first `graph` command.
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
