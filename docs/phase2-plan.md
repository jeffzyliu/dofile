# dofile — Phase 2 plan: web demo

**Goal:** a static website with a landing page and a single-page editor that runs .do code in the browser. The
dofile engine runs in Pyodide inside a Web Worker. The user uploads their own files (.do, .dta, .csv, .xlsx) into a
virtual working folder, and code that names a file by any path finds it there. Nothing runs on a server, so there
are no accounts and no hosting cost beyond static files.

**Not in Phase 2:** accounts, sync between devices, sharing or collaboration, server-side execution, the MCP server
(Phase 3), community commands, tutorials beyond one sample project, our own estimators.

**Status (2026-11-10):** step 0 of prototype 1 (cleanup and the build spec [design/SPEC.md](design/SPEC.md), whose open questions
are decided) is done. Decisions 1, 3 and 7 were settled on
2026-11-10 (below). Phase 1 is complete ([phase1-plan.md](phase1-plan.md)). Done: steps 1 to 4 (2026-11-06, see
[phase2-history.md](phase2-history.md)); 4b to 4e (2026-11-07): the engine matches CPython in Pyodide (95 of 97 Stata 14 cases; 1701 and
1911 call `export sasxport`), with PATCH-4, a `numpy.linalg` shim, and `xlwt`, `xlrd` and `pyreadstat` (no pandas); results in
[browser-engine.md](browser-engine.md). The memory snapshot is the page's default start since 2026-11-09: a return visit starts in 1.2 s, a
first visit in 1.7 s unthrottled and 5.1 s at 100 Mbps, 41.6 MB (brotli 11); one real iPhone (2026-11-08, over the LAN) took 28-30 s with
brotli-wasm, about 3 s of unpacking with the browser's own decoder ([pyodide-snapshot.md](pyodide-snapshot.md)). In CI (`web.yml`, pull
requests): `check-snapshot`, `npm test` and the e2e; `check-pytest` and `check-numeric` are run by hand. Done on 2026-11-09: step 5
(the design, `docs/design/`), step 7 as pre-releases (`0.1.0.dev1` on PyPI, [releasing.md](releasing.md)), most of step 9 (CI on pull
requests, a deploy to Cloudflare Workers on every push to `main`).

**Still open in Phase 2:** steps 6 (the editor page), 8 (the landing page) and 10 (launch); the lazy-matplotlib experiment (4a, not
started, [lazy-matplotlib.md](lazy-matplotlib.md)); a phone over HTTPS with the cache working and a first visit over a real network (not
measured); the `pyreadstat` wheel on a real iPhone; the domain (decision 6). The build plan for prototype 1 (steps 6 and 8) and its
status: [prototype1-plan.md](prototype1-plan.md).

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
  their own data licenses; check them before using one as the sample. (Checked in prototype 1, step 5: `cohort`, `diet` and
  `growth` are synthetic, made by OpenDTA's `tools/make_datasets.py` with fixed seeds; the sample uses data of our own anyway.)
- stats.camp is a closed-source browser app with the same idea. Our demo's points are that it is open source,
  needs no account, sends no data and uses the same engine as the CLI and MCP server.

## Decisions (2026-11-06; 1 revised and 3 and 7 settled on 2026-11-10)
1. **Where files live, revised 2026-11-10.**
   - **To build (decision of 2026-11-10):** dofile's own store in IndexedDB, one record per file, shared by the page and the
     worker. `/work` becomes a plain in-memory folder. The page lists, reads, writes, renames and deletes directly in the
     store, so files work with no engine loaded, during a run and after a failed start. At engine start the worker copies the
     store into `/work`. A page write while the engine is up goes to the store first, then to the worker. After each run the
     worker compares `/work` before and after the run and writes only that difference to the store (it deletes only files the
     run itself removed). If the user saves a file during a run that also writes it, the user's save wins. A Web Lock lets one
     tab own the engine; a second tab gets the take-over prompt from the flows. Files already in the deployed demo's IDBFS
     store are not imported (pre-launch).
   - **Confirmed 2026-11-10, with the build spec:** a `pending` journal in the store holds the page's changes that the worker has
     not applied yet, so a save, delete or rename made during a run wins over that run; a second tab is blocked entirely and
     writes nothing; the old IDBFS database is left in the visitor's browser, unused and not deleted. The contract and its tests:
     [design/SPEC.md](design/SPEC.md), section 7.
   - **Why:** IDBFS's save makes the database equal to the memory copy, so a second writer's files can be removed; the
     snapshot start downloads everything before any file call answers, so "Not now" and "Edit files while it loads" cannot
     work on IDBFS; and it removes a dependence on Emscripten's internal record format. A second small Pyodide before the
     snapshot was rejected (about 6 MB before the user agrees to a download, and a second writer).
   - **Until build step 2 the code uses Emscripten's IDBFS** (`FS.syncfs` after each run and each change; the page does not
     call `navigator.storage.persist()` yet). The original decision, why there are two copies, and the steps in the worker:
     [phase2-history.md](phase2-history.md#decision-1-as-first-made-idbfs).
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

## Further decisions (3 and 7 settled 2026-11-10)
3. **UI framework: Preact with signals** (settled 2026-11-10), on the project's own `ui.css`. React would also work; nothing in the
   design needs React-only component libraries (native `<dialog>` and popover cover dialogs and menus), and signals let the
   engine client be a plain module that components subscribe to. Plain TypeScript was rejected: about 20 states to keep in
   sync by hand. The earlier discussion:
   [phase2-history.md](phase2-history.md#decision-3-the-earlier-discussion).

4. **Text editor: CodeMirror 6** (chosen, in use since step 4: it works in Chromium, Firefox, WebKit and iPhone emulation; unless a
   real-phone test shows a problem). The comparison with Ace and the notes on Stata highlighting:
   [phase2-history.md](phase2-history.md#decision-4-codemirror-6-or-ace-the-comparison).

5. **Where the web code goes in the repo:** `web/` next to the Python package (in use since step 3); see [Repository layout](#repository-layout).

6. **Hosting.** Decided and in use: Cloudflare Workers static assets (`web/wrangler.jsonc`, the isolation headers in
   `web/public/_headers`, `.github/workflows/deploy.yml` on every push to `main`). Each asset must be under 25 MiB; the two
   snapshot files are about 20 MB each. Domain to choose.

7. **Where Pyodide loads from: self-hosted for the snapshot start** (settled 2026-11-10). A snapshot start today still fetches
   `pyodide.asm.wasm` (9.6 MB, about 3.2 MB compressed), `python_stdlib.zip` (2.5 MB) and `pyodide-lock.json` from jsDelivr. To
   build (step 2): `vite.config.ts` copies these three files from the `pyodide` npm package into `public/pyodide/`
   (gitignored), as it copies the wheel; nothing is committed and CI downloads nothing extra. `?snapshot=0` keeps the CDN (it
   needs the numpy, scipy and matplotlib wheels, which the npm package does not have, and micropip fetches openpyxl, xlrd and
   xlwt from PyPI) and becomes a diagnostic mode. Check at deploy that the host compresses the `.wasm`. The mockups' wording
   "from a public CDN" changes when this lands. (Until then: the runtime and packages come from jsDelivr, which works in all
   three engines; the wheel comes from the page's own origin.)

## Repository layout
The Python package stays at the root (`pyproject.toml`, `src/dofile/`, `tests/`, `scripts/`); `web/` (Vite, TypeScript) and
`plugins/` are self-contained folders beside it; `docs/` is shared. The Python the page needs (`browser.py`, the path shim) stays
in `src/dofile/`, so pytest tests it and it ships in the wheel. The alternatives and why the Python package was not moved:
[phase2-history.md](phase2-history.md#repository-layout-alternatives).

## UI/UX design (after the proof of concept, before the full editor)
In progress: deliverables 1–3 (moodboard, user flows, wireframes) done, 4 (high-fidelity mockups) done (iteration 3 is the final one), 5 (the
design system) done: tokens in `web/src/styles/tokens.css`, components in `web/src/styles/ui.css` (moved from `docs/design/mockups/` on 2026-11-10), the component
sheet and its crit in `docs/design/system/`, contrast and font checks. The banner is B2. Open for steps 6 and 8: text
sizes in rem, text field states, the phone's bottom sheet and toast placement (`docs/design/system/critique.md`). The brief, the deliverables, the rules (WCAG AA, keyboard, screen-reader log; clean room;
naming), every round of feedback and the status are in `docs/design/README.md`; the flows, wireframes and mockups are in
`docs/design/`.

Decisions of iteration 2 (2026-11-09, after the UX crit `docs/design/mockups/ux-analysis.md`) that affect the build:
- Run and Run selection run a copy of the editor's text, saved or not; `do` and `include` read the saved file, and the
  log notes when that file is open with unsaved edits. Editing during a run is allowed and doesn't change it.
- A first visit asks before downloading the engine (about 48 MB for the snapshot start; the page takes the figure from the build), then shows a download bar and the
  start-up stages in the same dialog; later visits show the stage on Run and in the status bar. "Not now" leaves a
  working editor and file manager. To build: the page reads dofile's own IndexedDB store (decision 1) itself when Python isn't loaded,
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

**Scope of prototype 1 (steps 6 and 8), decided 2026-11-10:** desktop and phone layouts with the core flows. Deferred to prototype 2:
the Help tab; highlighters for .py, .R, .tex, .sql, .yaml; the unknown-command underline and per-file list; the selection-run
warning about an unset local; unpacking a .zip on upload. This narrows the lists above.

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
1. ~~Spike under Node~~ done 2026-11-06: [phase2-history.md](phase2-history.md#spike-results-2026-11-06).
2. ~~Path shim~~ done 2026-11-06: `src/dofile/pathshim.py` on PATCH-3 ([opendta-issues.md](opendta-issues.md)); tests in `tests/test_pathshim.py`. Unquoted Windows paths in `mkdir`/`rmdir`/`copy`/`dir` lose their backslashes in the engine (ODT-26, open).
3. ~~Browser entry point~~ done 2026-11-06: `src/dofile/browser.py`, `web/src/engine/worker.js` and `client.js` ([web/README.md](../web/README.md)); test: `cd web && npm test`.
4. ~~Proof-of-concept page~~ done 2026-11-06: [phase2-history.md](phase2-history.md#proof-of-concept-results-2026-11-06); test: `cd web && npm run e2e`. Still open from step 3: micropip fetches openpyxl from PyPI on each cold start.
4a. **Experiment: load matplotlib lazily** (**not done**; planned 2026-11-07, no code): [lazy-matplotlib.md](lazy-matplotlib.md); related: [pyodide-snapshot.md](pyodide-snapshot.md#file-size-what-is-done-and-what-is-not).
4b. ~~Model fits far slower in Pyodide~~ done 2026-11-07: `numpy.linalg` returned NaN instead of raising (`src/dofile/linalgshim.py`), plus PATCH-4: [browser-engine.md](browser-engine.md#open-investigation-model-fits-take-far-longer-in-pyodide).
4c. ~~Memory snapshot~~ done 2026-11-07 (the default start since 2026-11-09): [pyodide-snapshot.md](pyodide-snapshot.md).
4d. ~~Check the engine in Pyodide against CPython~~ done 2026-11-07, by hand: results in [browser-engine.md](browser-engine.md#known-gaps-in-the-browser-engine).
4e. ~~Browsers~~ done 2026-11-07: the e2e passes in Chromium, Firefox, WebKit and an iPhone profile ([pyodide-snapshot.md](pyodide-snapshot.md#the-trampoline), [real iPhone](pyodide-snapshot.md#on-a-real-iphone-2026-11-08)). The e2e tests replace the editor's text through `window.__editor`: select-all then `insertText` left the last line behind in WebKit on Linux.
5. ~~UI/UX design~~ done 2026-11-09 (section above, `docs/design/`).
6. **Editor page** built to the design: files, editor, run, log, graphs, data view, results.
7. **Publish to PyPI** (moved from Phase 1; pre-releases done 2026-11-09, `0.1.0.dev1`, so `pip install --pre dofile`
   works; a non-pre-release is still to come): the landing page tells people to `pip install dofile`, so the
   release must exist first. Trusted Publishing from GitHub Actions, no stored token. The page can load the same
   wheel from its own origin.
8. **Landing page**, sample project, clean-room check of all text.
9. **CI:** run the corpus in Pyodide under Node on each push. Build `web/` and deploy `main` to the host.
   A browser smoke test (Playwright, one browser): load, upload a .dta, run a regression, check the coefficient.
   The checks exist and are run by hand (`check-snapshot` about 4 minutes, `check-pytest` about 2, `check-numeric` about 4,
   `npm test` and `npm run e2e` about 1 each); `.github/workflows/web.yml` (2026-11-08) runs on pull requests: `npm run check`,
   a check that `commands.json` is current, `npm test`, `build`, `e2e` in four browser profiles, and `npm run snapshot` with
   `npm test` and `check-snapshot` (a push to `main` runs every job, one run per commit, since #33; the formatter's Biome job `format and lint` was added with `docs/formatting-proposal.md`; the `e2e` job is a matrix of four, one per browser profile, since #32; a pull request that changes nothing under `web/`, `src/` or the
   Python build files skips the test jobs but still reports through the `web ok` job, which is the one to require in branch protection; `ci.yml` has the same
   `ci ok`, with its own filter: `src/`, `tests/`, `tests_opendta/`, `scripts/` and the Python build files). `check-pytest` and `check-numeric` stay by hand. `check-snapshot` needs a built snapshot only for its default
   mode; `--normal` does not. First runs on GitHub found: the runner is slower than a laptop (1908_models2 took over 300 s
   with four cases at a time, so the per-case limit is 900 s in CI); the two package-gap cases (1701, 1911) now count as
   expected differences, a strict xfail (`EXPECTED_DIFFER` in `check-snapshot.mjs`); and iPhone-profile WebKit on Linux needs
   the editor hook above. The iPhone-profile run took about 200 s to become ready once, so the e2e waits for the engine
   up to 300 s and a test may take 600 s.
10. **Launch:** domain, test in Chrome, Firefox and Safari (desktop and phone), link from the README.

**Build order for steps 6 to 8:** the build order, the model for each step and its status are in [prototype1-plan.md](prototype1-plan.md).

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
- [~] `pip install dofile` works from PyPI. `pip install --pre dofile` does (`0.1.0.dev1`); no non-pre-release yet.

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
- **Safari's 7-day deletion is tabled (2026-11-10):** re-verify Safari's storage behavior after prototype 1. Until then the page shows the generic "This browser may clear your files" notice.
- **Asset size:** each asset on the host must be under 25 MiB, and there is no fallback start. `deploy.yml` checks the size of every file in `dist/`.

