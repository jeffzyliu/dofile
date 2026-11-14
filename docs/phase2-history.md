# dofile web demo: Phase 2 history

Results of the first spike and the proof-of-concept page, and the two comparisons behind decisions 4 and 5.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged. The last section is the record of
prototype 1's work to 2026-11-13, moved out of [prototype1-plan.md](prototype1-plan.md) the same way.

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

## Prototype 1: the record from "Where things stand", to 2026-11-13

Moved out of [prototype1-plan.md](prototype1-plan.md) on 2026-11-13 (the document pass); the text below, from its section
"Where things stand (2026-11-12)", is unchanged. Its "below" and "above" mean that file as it stood then: "Step 4:
decisions and open questions", "Step 5: decisions and open questions", "Post-merge review" and "Known work inside the steps"
are still sections of it. The open items it held are in that file's "Open, critical" and "Where things stand (2026-11-13)",
in `docs/icebox.md`, or in the step 6 and step 7 lists.

- **Fix round 2 (2026-11-12): pull requests merged one by one, each on the maintainer's word, rebased in turn.** Merged
  and deployed (each merge deploys): #22 (step 4's C 4, C 8 and C 12, every key with Alt, Ctrl or Cmd left to the browser in the
  file tree, dead toast CSS, three flaky e2e tests), #23 ("Clear log" asks first; decision 1), #24 (the phone command line:
  autocorrect off as an attribute, typed curly quotes straightened, a Run button; decisions 3 and 4), #25 (the screen stays
  awake while the engine works; decision 2). None of the four has been tried on a real phone.
  - **Merged later the same day:** #31 (a 60 s navigation timeout on the `webkit` and `iphone` projects, so a hung first
    navigation fails in 60 s, not 10 minutes), #30 (landing page fixes: the logo, the theme switch's word kept on a phone with
    an icon each, Copy buttons that turn to "Copied", the two panels scroll sideways), #32 (the browsers job is one job per
    Playwright project, a matrix of four, each on its own runner, with a 30-minute limit; it went green only on a re-run), #20
    (`cloudflare/wrangler-action` 3 to 4), #33 (every job also runs on a push to main, one run per commit, so a merge's tree is
    tested), #21 (`actions/cache` 5 to 6; the maintainer merged it by hand, because the `gh` token has no `workflow` scope and
    GitHub refused the merge), #26 (remove the queued run, below) and #34 (the `?snapshot=0` normal-boot test is skipped in
    the two WebKit projects).
  - **#26 "Remove the queued run" and "Start engine" is merged.** The maintainer approved the design ("i approve your
    recommendations for 26"): with no engine nothing on the page offers to run. The toolbar's Run and the command line's
    buttons read "Start engine"; Ctrl/Cmd+Enter does the same; the command line is off with the hint "Start the engine to run
    code" and keeps its text; Run selection, Load, Import and the log's `help` links are off and say why in a toast. Widths,
    in the maintainer's words: "navbar button should be wide enough, but let the mobile command line button expand. we want
    it to be as small as it can in every situation". The state table is in `docs/web-page-flows.md` section 2 and
    `web/src/app/start.ts`. Fresh-context reviews: the second commit's four findings were fixed; the fix commit
    (`ae8af24`) was reviewed and accepted with no must-fix, and its one should-fix (the hint's `help x` link had no
    held-Enter guard, so every repeat raised the refused-run toast and the next one ran `help x` when the engine was free)
    was fixed in the last commit before the merge, which no second agent reviewed. Kept for the maintainer: the off controls
    (Load, Import, help links at 0.45 opacity) measure 2.2 to 3.8 to 1, under 4.5 (WCAG exempts disabled controls); a
    multi-line paste while an engine exists and is not ready is refused whole with the field untouched; a held Enter is
    ignored in every dialog; the declined banner's button reads "Start engine"; a retry from a failed start downloads with no
    prompt, as "Try again" does. **Decided (2026-11-13, the maintainer: "all recommendations"):** the off controls'
    contrast goes to step 6's audit; the paste, the held Enter and the retry are kept as built; the declined banner's "Start
    engine" is decided with the Start engine words (SPEC section 8). **Held Enter:** the guard was checked with a synthesized repeated keydown in Chromium,
    Firefox and WebKit, and (2026-11-13) by the maintainer on real keyboards: "good on all browsers". **Not verified:** a held Enter on a banner button that hands the focus to the editor
    ("Try again", "Run the file again"), where the repeats may type newlines into CodeMirror (older than this change; to verify in step 6's audit, decided
    2026-11-13); nothing
    merged today was tried on a real phone. Stale after #26 and not yet edited: SPEC's toast "… not run: line 1 didn't run",
    and this plan's lines on the held run (step 4's list B item 3 and decision 4).
  - **Causes found for two CI failures (investigations, 2026-11-12; neither reproduced).**
    - *WebKit's first-navigation hang.* A fresh page's first `page.goto` to `/app/` stays on `about:blank` and waits until the
      test times out. The trace holds the document request with no response, the screenshot is blank, and the other worker
      keeps passing tests against the same server. Likely cause (medium-high confidence): WebKit bug 325840, a race in which a
      late `DidStartProvisionalLoadForFrame` from the old web process cancels the new process's navigation when a
      `Cross-Origin-Opener-Policy: same-origin` document forces a process swap. dofile serves that header on `/app/`
      (`web/vite.config.ts`), for SharedArrayBuffer and Break. Upstream: Playwright issue #42957, closed as an upstream bug;
      the WebKit fix (WebKit/WebKit#75569) was open, not merged, on 2026-11-10; no Playwright release has it (ours is 1.65.0).
      Rate: about 1 navigation in 3,000, about 7% of full runs, from run counts and not measured. Ruled out: the preview
      server, a service worker, a crash, a dofile change. Not reproduced on macOS in 2,000 navigations, which neither
      confirms nor rules out the cause. #31 caps the cost at 60 s; the test still fails.
      **A one-retry of a stalled first navigation (a `goto` that timed out while the page is on `about:blank` is called once
      more, in `web/e2e/fixtures.ts`; test code only) is being built in its own pull request, not merged.** Unproven until a
      CI log shows a retried navigation followed by a pass.
    - *`?snapshot=0` stall.* The worker is stuck, not slow: in both failures the normal boot stopped inside Pyodide's
      `loadPackage` ("Loading packages", step 4 of 5) after every download had finished, and stayed 312 s with the page alive;
      passing runs take 17 to 34 s. Every request got a 200. Likely mechanism (moderate confidence): one package's
      asynchronous `WebAssembly.instantiate` in the Worker never settles, which blocks the loader's one lock (about 136
      instantiations per boot); WebKit bug 208368 records a flaky case like it on Linux. Rate about 4% of WebKit runs of the
      test (2 in about 49), none in Chromium or Firefox. #34 skips the test in WebKit. A product gap stays: nothing times out
      the `starting-worker` state (`docs/icebox.md`).
  - **#27 is merged** (`claude/phone-keyboard-experiment`, rebased on `main`). Three rounds on an iPhone (iOS 27.0.1;
    `docs/phone-keyboard-experiment.md`) settled the keyboard: the phone's command line takes a tap's focus itself with
    `preventScroll`, Safari's pan is scrolled straight back with `.app` kept at the top, and the editor's caret is scrolled
    above the keyboard through CodeMirror. The `?kb=` and `?slide` flags are gone; `?kblog` stays. The closed #28 (a draft
    that joined everything) and #29 (an earlier version of this section) are not for merging.
- **The post-merge review is prepared; most of it is not decided.** The maintainer's review document holds 22
  decisions: 1 to 5 are accepted (all built in #23 to #25; decision 5, the trackpad back-swipe, is to be checked once by
  hand: step 7, decided 2026-11-13), 6 (zoom on the editor page) waited on the keyboard experiment, which is now done (#27) and leaves it to the maintainer (the experiment ran with zoom off; turning it back on needs another iPhone check, `docs/icebox.md`, "Phone"), and 7 to 16 have no answer yet. **17 to 22 were
  answered on 2026-11-13:** 17 (the order of the later UI work, "queued run first") dropped, since the queued run is gone;
  18 (run only `.do` and `.ado` files), 20 (`cls`), 21 (move, rename, drag) and 22 (step 6's width: its plan plus three cheap
  audit checks) accepted; 19 (syntax checking) changed by the maintainer: a syntax error refuses the run, an unknown command
  only warns. The specs of 18 to 21 are in "After step 6: later UI work", and nothing in it is built before step 6. Nothing
  else they would release is started: the document pass.
  - Found by reading the code, **fixed in #40 (2026-11-13)**: a Save pressed right after a rename's Enter, before the
    rename's write ends, left the old text under the new name and the new text under the old name, with the tab shown as
    saved (`files/actions.ts` `renameEntry`, `editor/Editor.tsx` `save`); a Save after a delete, the same race, brought the
    deleted file back. A Save now waits for the change the tabs follow (`files/actions.ts` `fileTurn`) and writes under
    the new name, or nothing for a deleted file. The file tree's focus retry after a rename (`files/FilesPane.tsx`
    `focusRow`, a 50 ms poll) could take the focus from a visitor who clicked into the editor within a second; the row
    now takes the focus from its own render (`focusWanted`), only while the focus is on the page or in the tree, and the
    row-focus logic is the hook `useRovingFocus`.
  - **Post-merge fixes, #40 (`postmerge-fixes`, 2026-11-13):** the two bugs above; step 4's B 1, B 5 and C 1, C 3, C 5
    (marked in the lists below); step 4's C 7 and C 11 and step 5's C 6 decided (kept, or moved to `docs/icebox.md`);
    and three phone UI changes: the strip under the top bar has one height on every view, with a 44 px tap target for its
    ⋯; Save moved from the phone's ⋯ menu into the file dropdown, which has Save above a scrolling list of the open files
    and Close and Show all files below it (the list is capped so all of it fits a landscape phone, and the open file is
    scrolled into view when the menu opens); and the menu (`ui/Menu.tsx`) owns its active item (a position among all its
    items), which an item takes the focus from its own render, with no `querySelectorAll`. Not tried on a real phone.
    No fresh-context review of the second fix round: the orchestrator checked it.
  - Reported by the maintainer (2026-11-12), not investigated: dofile seems to crash Firefox on the desktop, perhaps
    through its memory use. The `?snapshot=0` e2e test's failures in Firefox may share the cause (the investigation above saw
    its failures in WebKit only). To look at: the report in `about:crashes` (an out-of-memory crash is marked), and whether
    the tab or the whole browser goes.
    **Iceboxed (2026-11-13)** (`docs/icebox.md`, "Engine memory"): not reproduced locally; the maintainer: "icebox the firefox
    crash, i'll revisit it if it happens again".
  - **Merged 2026-11-13:** #43 (Break: the pill, status bar and banners on one clock; "Stopping…" from the press until
    the engine confirms); #45 (focus: one hooks file, each focus request taken by the render that draws its target);
    #48 (phone: a touchmove guard stops iOS panning the page while the keyboard is open; checked on the maintainer's iPhone,
    including a selection handle within one line and the caret magnifier); #50 (New .do file and New folder draw
    their name field in the tap, so the iPhone keyboard comes up: Enter writes, opens and focuses the row; leaving the
    field writes only and opens nothing, the focus and the phone's view staying where the visitor tapped, the maintainer's
    "Write only, don't open"; Esc discards; checked on the maintainer's iPhone). Gaps of #48 and #50: `docs/icebox.md`,
    "Phone" and "Command line, log and files".
  - Waiting on the maintainer: decisions 7 to 16 (17 to 22 are decided, 2026-11-13, above); the iPhone sitting (the phone command line, the wake
    lock with the phone locked 30 s; the keyboard experiment is done, #27); how they saw Home open `analysis.do` (see "After step 6: later UI work", 8).
  - Known flaky tests, with their sightings: `docs/test-map.md`, "Known flaky tests".

- **UI fix round (2026-11-12), on `ui-lightning`:** the maintainer's UI bugs after the merge of steps 4 and 5. Editor: the
  focus ring over the gutters, a fainter lines-to-run mark with an accent bar, no sideways overscroll, tab labels that keep
  their bold width, a tooltip with the full path on file rows. A "Wrap lines" preference (both ⋯ menus; the editor and the
  log). Menus: "Clear log" left the desktop ⋯, "Commands" and "About dofile" open in a new tab, and on a phone the file
  and log actions are the strip's "Files ⋯" and "Log ⋯". Log pane: a "Clear" button in its head, a "Log actions" ⋯ when the
  head is narrow, Split with an icon, "Clear log" keeps the head, the log follows its end unless the visitor scrolls up.
  Toasts: an error kind, a time by length, wrapping. The static pages: a sticky top bar, "Home", the GitHub link, shorter
  sample comments. It does not finish the post-merge review below; the checks are recorded by its pull request.
- **After steps 4 and 5 merge:** the open items are reviewed then, not before: "Post-merge review", below.
- **Step 4 (4a, 4b, 4c, 4d and the joining changes) was built on `prototype1-step4`, in pull request #17; merged
  (with step 5, pull request #18).** Checked at its tip `486f6bf`, CI green: Biome, `tsc` and ruff clean; `npm test` (295 pass); the e2e suite
  (273 passed, 31 skipped); `uv run poe test` (1346 passed, 13 skipped, 3 xfailed); nothing under `src/dofile/` or `tests/`
  differs from `main`. Before the merge the maintainer goes through "Step 4: decisions and open questions" (below) and
  the draft words in `docs/design/SPEC.md` section 8. Step 5 is on its own branch, `prototype1-step5`, in draft pull
  request #18 over step 4. The step 4 bullets below are the record of that work.
- **Step 5 is built on `prototype1-step5`, a branch stacked on `prototype1-step4`** (its own pull request, after step 4's;
  rebased onto `prototype1-step4` at 486f6bf, with the step 4 e2e cases moved to the editor's address `/app/`, and again at
  d94bb5e, step 4's docs):
  the landing page (`web/landing.html`), the commands page (`web/commands.html`), the sample project (`web/sample/`, loaded on a
  first visit, "Restore the sample" in the file menu), and the clean-room check of all text (the record at the end of this
  file). What was built, the URLs, the words the sources do not give and the decisions left open are in SPEC section 8, "As
  built in step 5". The maintainer's list (what was decided, what waits for confirmation, what is open) is "Step 5: decisions and open
  questions", below; the first real deploy's checks are in SPEC 8, "URLs".

- **Steps 3 and 3.5 are merged into `main`**, with the formatting and linting work, by pull request #13 (the merge commit
  `aff60a5`, 2026-11-11). `main` is pushed and protected (root `CLAUDE.md`, Rules): every change is a pull request, and a
  merge deploys the page. Checked before the merge, locally and in CI (Ubuntu and macOS, Python 3.12
  to 3.14): the lint gates; `npm test` (212 pass); e2e (74 passed, 22 skipped); `uv run poe ci` (1443 passed, 13 skipped, 3
  xfailed); the design checks. The branch `prototype1-step3` and its worktree are no longer needed. The bullets below
  about steps 3 and 3.5 are the record of that work as it stood on the branch.
- **Step 4 is built on one branch, `prototype1-step4`, with one pull request at the end** (a merge to `main` deploys the
  page, so the parts are not merged one by one). **4a and 4c are built and joined on it** (4c, then 4a rebased on it),
  with these decisions of 2026-11-11: on a phone the Files head is hidden and the file actions are in the top bar's ⋯;
  the unfolded file list gives the focus to the tree's row; a drop of files anywhere on the page uploads them; a graph
  is drawn in the run's theme whatever colors its command names (a rule that drew such a graph light was built and
  removed the same day: the 4c note below); a toast may also report an error that needs no action (SPEC 3.10). Two
  reviews' findings are fixed (one upload at a time, a clash never over another dialog and an unsaved file's clash not
  asked after Esc, paths in commands through `web/src/stata/quote.ts`, the focus after a tab closes, a .dta renamed to
  .png closes its tab, a drag that began in the page is no upload). Checked on the branch:
  `uv run poe lint`, `npm run check`, `npm run lint:strict`; `uv run poe test` (1346 passed, 13 skipped, 3 xfailed);
  `npm test` (252 pass, none skipped); the e2e suite (138 passed, 26 skipped). 4b and 4d are now joined
  too (the bullet "4b and 4d are joined" below). The draft words of 4a and 4c wait for the maintainer's approval (SPEC
  section 8, "As built in step 4a" and "Step 4c: draft words").
- **Steps 0, 1 and 2 are merged into `main`**. Checked on `main` after step 2 merged: `uv run poe test` (1346
  passed), `npm run check`, `npm test` (98 tests), `npm run e2e` (56 passed).
- **Step 3.5 is done: the engine code made clear and auditable** (TypeScript everywhere, one state machine, one build
  identity, the journal as the only channel; steps A to E; merged by pull request #13).
  Its plan and status: [prototype1-step3.5-plan.md](prototype1-step3.5-plan.md). How the engine code works as built, and what
  is still open: [web-engine-data-flow.md](web-engine-data-flow.md).
- **How the editor page's focus, runs, open files and log links work, as built on `prototype1-step4`:** [web-page-flows.md](web-page-flows.md).
- **Formatting and linting were added on the branch after step 3.5 and before the merge:** Biome for `web/`, ruff for dofile's own
  Python, width 120. Two commits are layout only (`.git-blame-ignore-revs` lists them); the lint fixes change no behavior; the gates
  are `npm run check` (Biome, then `tsc`), `npm run lint:strict`, `uv run poe lint` and a CI job for each. Decisions, rules turned
  off and commands: [formatting-proposal.md](formatting-proposal.md). Checked on the final state (2026-11-11): `npm run lint:strict`,
  `npm run check`, `uv run poe lint`; `npm test` (212 tests, all pass, none skipped); `SNAPSHOT_QUALITY=5 npm run e2e` (74
  passed, 22 skipped, as before); `uv run poe ci` (1443 passed, 13 skipped, 3 xfailed). The design checks (`npm run axe`,
  `contrast`, `tabwalk`, `fonts`) pass too: 0 violations in 36 runs, 0 contrast failures, 0 hidden focus stops, 0 font problems.
- **Step 3 (the app shell) is built, reviewed twice, edited from the maintainer's notes, and merged by pull request #13.**
  It was built on the branch `prototype1-step3` (made from `main` at `c014141`). What the step 4
  agents write against: `docs/design/SPEC.md` section 8 ("As built in step 3") and the header of `web/src/app/App.tsx`.
- Checked on the branch after step 3.5 E: `npm run check`; `npm test` (212 tests, all pass, none skipped); step E changes no page code, so the e2e and design checks were not rerun for it, and the counts below are the last recorded: `SNAPSHOT_QUALITY=5 npm run e2e`
  (74 passed, 22 skipped: the 16 fixme cases of `e2e/poc.spec.ts`, and the two iPhone-only checks, the page scroll and the toast's place, in the three desktop profiles); `npm run axe`, `contrast`, `tabwalk`, `fonts`. Nothing under the root `src/` or `tests/` changed, so
  `uv run poe test` was not run again.
- The last edits: the other-tab dialog has "Close editor" (focused; it goes to the landing page, a dead link until step 5)
  and "Use dofile in this tab"; `App.tsx` holds the whole layout again, each phone piece next to its desktop one
  (`Phone.tsx` and `Toolbar.tsx` are gone); the viewport meta no longer sets `interactive-widget`, so Android keeps its
  default (only the visual viewport shrinks for the keyboard, as on iOS) and `app/viewport.ts` (then `.js`) serves both, with a
  fallback for a browser that shrinks the layout viewport; the phone toast goes above the keyboard; a failed "Download
  all" shows the banner `download-failed` with "Try again"; a failed start's `message` is plain words for the visitor
  and its `detail` the developer's cause. Then (round 5): that banner shows on every phone view; the phone's Files view
  is no longer blank (`data-files` folded it away); shorter state labels on Run and Break ("Starting…", "Stopped",
  "Break (reset)"; the phone's "Run 6–7"), so the buttons are narrower; one height for the toolbar's buttons and one for a pane
  head's controls; the phone ⋯'s "Theme: ◐ System" cycles the theme and keeps the menu open. Round 6: the
  `dofile.downloaded` flag is gone; at load the page asks unless `client.cached()` finds this build's start files all in
  the Cache, and a `failed-twice` (not memory or no-wasm) deletes them (`client.forgetDownload()`).
- **Next, in this order:**
  1. The maintainer's pass on pull request #17 (step 4): "Step 4: decisions and open questions" below, and the draft
     words in SPEC section 8; then its merge.
  2. Step 5 (pull request #18, over step 4), then step 6 for each merged part (its full-code audit replaces 6r).
- **To try on a real iPhone** (none of this can be tested here; the e2e iPhone profile is an emulation with no real
  keyboard, toolbars or touch scrolling): the page does not scroll or bounce; with the keyboard open the command line sits
  right above it and the tab bar is hidden; a toast sits above the command line and the tab bar, and above the keyboard
  while it is open. An Android phone (Chrome, Firefox) should behave the same now. **Decided 2026-11-13: this list, and Android, are in step 7's real-phone pass** ("Known work inside the steps", "Step 7").
- **Open from step 3.5** (listed in `web-engine-data-flow.md`, Part 3): a Break pressed between sending a run and the worker
  starting it is lost and ends as a 9998 reset; when another page upgrades the database, the new worker mounts with a store
  error and an empty `/work`; if only the worker fails to open the store, an upload shows in the file list but `use` on it gives
  rc 601 with no banner; a closed database keeps today's restart (the maintainer's ruling, 2026-11-11). (The failed states'
  banners, also listed there, are built by step 4d.) **Decided (2026-11-13, the maintainer: "go with recommendations"):**
  the lost Break, the upgraded database and the worker-only store failure go to step 6's audit list; the closed database's
  restart is done (the 2026-11-11 ruling). No timeout on the start stays iceboxed (`docs/icebox.md`, "A watchdog for the
  engine start").
- **4b and 4d are joined on `prototype1-step4`** (2026-11-11): 4d's four commits, then 4b's four, then the joining
  changes (the "Step 4 join" commits): `@lezer/highlight` declared, with CodeMirror's Markdown and JSON languages; the dead
  `.cmdline .placeholder` rules gone; the close-tab test's failed Save again; a dialog whose opener has left the page
  gives the focus to the editor or More actions; the phone ⋯'s Save off on a .dta tab; OQ-10's notes shown in the log
  where the engine's own words do not already say them (the tempfile note dropped); "Run the file again" tested with the
  real editor; one focus move with a .dta tab active (the tab wins). Then, on the maintainer's decisions: a run that
  rewrites an open file reloads a clean tab and keeps an edited one unsaved with the banner `run-changed`; a paste of one
  line with its line break is an ordinary paste; a queued run's `done` settles (the machine's effect `drop-run`), so the
  command line reads no state names. Made at the join, for the maintainer to confirm (list B below): the error mark
  belongs to the file's last run (`editor/errormark.ts`). Decisions
  and words: SPEC section 8, "As built in step 4b" and "As built (4d, to review)". Checked on the branch: `npm run check`, `npm run lint:strict`,
  `uv run poe lint`; `npm test` (282 pass, none skipped); `uv run poe test` (1346 passed, 13 skipped, 3 xfailed); the
  e2e suite (241 passed, 31 skipped); nothing under `src/dofile/` or `tests/` differs from `main`. The design checks
  (`axe`, `tabwalk`, `contrast`, `fonts`) were not run: they check the mockups in `docs/design/`, which did not change.
- **A second review of 4b's fixes, fixed on the joined branch** (2026-11-11): the echo walk (`log/align.ts`) no longer
  puts a graph's link at another line's echo after a `do` run from a loop or a program, or from a do-file that runs one
  (where it cannot know, the link goes to the run's end); `n` is `noisily`; a `quietly { }` or `capture { }` body and a
  `/* */` comment's inside are never taken as echoes; a local's braces open no block; the walk is linear (a log of 16,000
  lines with 10,000 unannounced nested echoes: about 400 ms before, 5 ms after) and the log keeps its answer per run.
  Pasted lines also stop before a `/*` comment that goes on, a lone `program define` and a lone `mata`. The notes at a
  run's end wrap in the Log pane, so "Go to line" stays in view. A file closed with its error mark and no unsaved edits
  has it again when opened with the same text. Known, left: `#delimit ;` with two commands on one line (list C below).
- **A review of the join's commits, fixed** (2026-11-11): pasted lines stop when another tab takes the engine during a
  line ("… not run: another tab took over the engine during line 1"), and no leftover line is sent to the engine this
  tab gets back; a run's promise settles even when the after-run work fails; a run that rewrites an open file goes
  through the editor's `ranOver`: the same text changes nothing, a clean tab is changed in one transaction (caret,
  selection and undo kept), and a version that is not text keeps the tab's text, unsaved, with the `run-changed` banner
  in other words and no reload (chosen over closing a clean tab: one path, and no edits are lost); the `run-changed` and
  `save-failed` banners go with a closed tab and follow a rename, `reload` does nothing for a file no longer open, and
  `run-changed` shows on every phone view; OQ-10's note comes from the error the run ended with; a dialog gives the focus
  back once, after its answer places it (the opener lets go of it before `showModal()`, so the browser gives nothing
  back on `close()`). A file the run deleted keeps its tab (not handled): it leaves the file list, the tab keeps its dot
  as it was, and Save writes it again. Checked on the branch after both: `npm run check`, `npm run lint:strict`, `uv run
  poe lint`; `npm test` (292 pass, none skipped); the e2e suite (249 passed, 31 skipped); `uv run poe test` not run
  (nothing under `src/dofile/` or `tests/` changed).
- **A second review of the join, fixed** (2026-11-11): a dialog that follows another before that one has given the
  focus back (the next clash after "Keep mine", other-tab over a dialog) gives it back to the first one's opener, not
  to `<body>`, and `<body>` is never an opener; a clean tab of a file with `\r\n` breaks follows a run as any other (the
  texts are compared with breaks as `\n`, `editor/ranover.ts`; Save keeps the file's own line break, the maintainer's
  decision, list A below: `\r\n` or `\n`, noted when the file is read, the more common one in a mixed file, `\n` for a
  new or empty file); a run that writes
  the editor's own text over a version that was not text takes the `run-changed` banner away; the close-tab dialog
  stays open while its Save writes, so the focus moves once.
- **A review of Save's form, its keys and the phone's key hints, fixed** (2026-11-11): Save keeps a file's UTF-8 byte
  order mark too (noted with its line break, `editor/ranover.ts` `formOf`; the editor never holds it); Ctrl/Cmd+S takes
  S on any keyboard layout (`editor/keys.ts`: on a Cyrillic layout CodeMirror's binding had caught it, the window
  listener alone did not, and the browser's Save page opened) and saves once while held; a menu item says its hint is a
  key (`hintIsKey`) instead of a text pattern; the nested-do note on a phone says "Save it (⋯ › Save)"; the Break test's
  loop has no end, since a fixed one ran out before Break once. The engine reads a do-file's BOM as part of its first
  command (ODT-34: a nested `do` of such a file stops with r(198); `import delimited` skips it), so on the maintainer's
  decision Save drops the BOM of a `.do` or `.ado` file and keeps it for any other (`editor/ranover.ts` `dropsBom`, by
  the name it is saved under). Ctrl/Cmd+S with a dialog open, and the iPhone check of the focus that a dialog gives
  back in a timer: list C below. The four new or extended e2e
  tests failed on the code before these fixes (16 of 16 cases). Checked on the branch: `npm run check`, `npm run
  lint:strict`, `uv run poe lint`; `npm test` (293 pass, none skipped); the e2e suite (257 passed, 31 skipped); `uv run
  poe test` not run (nothing under `src/dofile/` or `tests/` changed).
- **Then** (2026-11-11): on the maintainer's decisions (list A below), no key chip or key hint in sight on the phone
  layout, and "Not affiliated with StataCorp" in the status bar from 1200 px; also Ctrl/Cmd+S and Ctrl/Cmd+Enter take
  Ctrl or Cmd on every platform, and `.gitattributes` marks lockfiles, wheels, the vendored engine and the startup-times
  files as generated. The checks at the tip are in the first bullet.
