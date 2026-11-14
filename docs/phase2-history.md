# dofile web demo: Phase 2 history

What is done in Phase 2, and what was decided and built, condensed. What is open is in [phase2-plan.md](phase2-plan.md),
which also says how the old step numbers map ("Step numbers"). Item IDs used elsewhere ("step 4 B 3", "step 5 C 1", "review
decision 6", "2026-11-10 decision 9") name the items of the lists below. Who decided: the maintainer, unless a line says
otherwise. `web/spike/` and `eval/`, which the early sections mention, were removed on 2026-11-10 (in git at `10e0f1c`).

## Steps done

Phase 2's own steps (the plan's first numbering):

| Step | Done | What |
|---|---|---|
| 1 Spike under Node | 2026-11-06 | [Spike results](#spike-results-2026-11-06) |
| 2 Path shim | 2026-11-06 | `src/dofile/pathshim.py` (`install(root, note)`, `uninstall()`) on PATCH-3, a hook at the ~25 places OpenDTA turns a file name into a path; `tests/test_pathshim.py` (22 file commands with a Windows and a POSIX path, the note, tempfiles, a missing file, `cd`, a guard against unhooked sites after a re-vendor) |
| 3 Browser entry point | 2026-11-06 | `src/dofile/browser.py` (`start`, `run`, `describe`, `matrix`; JSON in and out; denies `shell` and `webuse`; a SIGINT handler that requests a Break only during a run; `tests/test_browser.py`); the Web Worker and its client, tested in a Node worker thread with `fake-indexeddb` |
| 4 Proof-of-concept page | 2026-11-06 | [Proof-of-concept results](#proof-of-concept-results-2026-11-06): plain TypeScript, CodeMirror 6 with the first Stata highlighter, upload, Run, Break, Reset, graphs |
| 4b Slow model fits | 2026-11-07 | `numpy.linalg` returned NaN instead of raising `LinAlgError` in Pyodide, which the engine relies on in about 100 places: `src/dofile/linalgshim.py`. Fits went from 20 to 500 times CPython's time (or forever) to 1.5 to 5 times. Also PATCH-4 (`expand`, `stsplit`). [browser-engine.md](browser-engine.md#known-gaps-in-the-browser-engine) |
| 4c Memory snapshot | 2026-11-07 | Patched loader, 39.9 MB at brotli 11 then, restore in 1.2 s; the default start since 2026-11-09. [pyodide-snapshot.md](pyodide-snapshot.md) |
| 4d Pyodide against CPython | 2026-11-07 | `check-snapshot` (corpus and 97 Stata cases), `check-pytest` (OpenDTA's suite, test by test), `check-numeric` (e() and r() at full precision, 109,265 numbers) |
| 4e Browsers | 2026-11-07 | The e2e passes in Chromium, Firefox, WebKit and an iPhone profile, with and without the snapshot. iOS creates no wasm trampoline, so a snapshot made in Node failed there ([The trampoline](pyodide-snapshot.md#the-trampoline)); swallowed cache failures fixed; one real iPhone by hand on 2026-11-08 ([On a real iPhone](pyodide-snapshot.md#on-a-real-iphone-2026-11-08)). The e2e sets the editor's text through `window.__editor`: Ctrl+A then `insertText` left the last line behind in WebKit on Linux |
| 5 UI/UX design | 2026-11-09 | `docs/design/` (moodboard, flows, wireframes, mockups in three iterations, the design system); [Design decisions built](#design-decisions-built-iterations-2-and-3-2026-11-09) |
| 8 Landing page, sample, clean-room check | #18 | Prototype 1 step 5; [the clean-room record](#step-5-the-clean-room-record-2026-11-11) |
| 9 CI and deploy | 2026-11-08 to 2026-11-12 | [CI and deploy](#ci-and-deploy-old-step-9) |

Prototype 1 (the build plan for phase 2 steps 6 and 8, 2026-11-10 to 2026-11-14):

| Step | What | Merged |
|---|---|---|
| 0a | `docs/design/SPEC.md`, the build spec, with the worker protocol and state model types | yes |
| 0b | Doc restructure, cleanup, `ui.css` into `web/`, the deploy size check | yes |
| 1 | Engine API (`engine.py`, `browser.py`): a whole-file run with no locals, the dark plot style, locals and globals, Browse's first rows, memory use, the streamed log (`on_output`), the error line, the command per graph, describing a .dta without loading it. No MCP schema change | yes |
| 2 | The file store and its `pending` journal, the self-hosted runtime, the build's list of start files and sizes, a counted and abortable download, Break as wait or reset now, the zip in the page, the tab lock, `storage.persist()`; Node tests (SPEC section 7) | yes |
| 3 | App shell: Preact, tokens and `ui.css`, the desktop and phone layouts, the theme toggle, the state store, the shared primitives | #13 |
| 3.5 | The engine code made clear: TypeScript everywhere, one state machine, one build identity (no offline start), the journal as the only channel ([plan](archive/prototype1-step3.5-plan.md); [web-engine-data-flow.md](web-engine-data-flow.md)) | #13 |
| 4a to 4d | File tree, tabs, upload and clash (4a); editor, Run, Break, log, status bar (4b); Graph, Data, Browse, Results (4c); dialogs and states, draft words (4d) | #17 |
| 5 | Landing page, commands page, the sample on synthetic data, the clean-room check | #18 |

Steps 6 (the audit) and 7 (the verification and phone pass) are open: the plan. Step 6r (a review of each merge) was done
before the merge for steps 4 and 5 (fresh-context reviews of each part, the join and the move); the review of the merged
whole was dropped on 2026-11-13 ("all recs"), since the audit is that review.

## Spike results (2026-11-06)

Pyodide 314.0.7 in a Node worker thread, as a browser Web Worker would run it, with the built dofile wheel; an M-series Mac,
cold package cache.
- **Correctness:** the conformance corpus gives 63/63 as expected (62 matches with `ref.json` to 1e-6, plus the GAP-1 xfail),
  as in CPython. All 12 probes behave as in CPython (10 pass, `esttab` and `outreg2` fail).
- **Graphs:** inline PNGs work (scatter 35 KB, histogram 7 KB); `graph export` writes into `/work` (Agg, no changes).
- **Break:** the interrupt buffer, set 1.5 s into `while 1 { quietly replace x = x + 1 }`, called our SIGINT handler once; the
  call returned rc 1 and the data was whole. PATCH-2's safe points hold in the browser with `worker.py`'s handler.
- **Download size (cold):** about 36 MB. Pyodide's core 13.5 MB (5.5 MB brotli); packages 27.4 MB as wheels (scipy 14.0,
  matplotlib 7.0, numpy 3.0, fonttools 1.2, pillow 1.0); the dofile wheel 2.8 MB; openpyxl from PyPI.
- **Time (Node, cold):** Pyodide 0.8 s, installing the wheels 4.4 s, importing `dofile.engine` and creating `Engine` 2.0 s; a
  run about 1 ms, the corpus 0.2 s; 11.4 s in total.
- **Lazy loading is possible:** `import dofile.engine` loads numpy only; matplotlib (about 9.5 MB with fonttools, pillow,
  contourpy, kiwisolver) and openpyxl load on first use. Now the open lazy-matplotlib experiment.
- A compiled binary (PyInstaller, Nuitka) is not an option: no wasm target, and dofile's own code is under 10% of the start.
- Pyodide in a Node worker thread has no file descriptors 1 and 2, so `loadPyodide` needs `stdout`/`stderr` callbacks.

## Proof-of-concept results (2026-11-06)

Playwright on an M-series Mac, `vite preview`, Pyodide from jsDelivr. The same test in each engine: upload `cps.dta`; a
regression that names it by a Windows path (the note shows the mapping; the coefficient matches `ref.json` to 1e-6); a graph;
Break in `while 1 {}` (rc 1, data kept); reload (files and the editor's text come back); Reset.

| | ready, cold | ready, after a reload |
|---|---|---|
| Chromium | 5.8 s | 4.6 s |
| Firefox | 6.6 s | 5.1 s |
| WebKit | 5.9 s | 4.6 s |
| WebKit, iPhone emulation | 5.5 s | 4.6 s |

Runs alone; three in parallel took 6 to 8 s cold. A run of the sample takes about 0.9 s. Cold includes about 36 MB of download;
most of the reload time is installing and importing. Found and fixed: WebKit refused the worker after a reload because
`vite preview` sent 304s without the COEP header (the servers now set the headers on every response); the log wrapped fixed-width
tables (it scrolls sideways); data loss found in review (Run wrote the editor's text back over an opened file, changing its
bytes; an upload of the open file was undone by the next Run; "New" emptied an existing file): a file is now written only after
an edit, a file that is not UTF-8 is not opened, and "New" refuses an existing name. Not checked: a real phone, a slow network,
files near the memory limit.

## Decision 4: CodeMirror 6 or Ace (the comparison)

Sizes measured 2026-11-06 (esbuild, minified, gzip -9); the rest from the projects' docs.

| | CodeMirror 6 (6.0.2, MIT) | Ace (ace-builds 1.45.2, BSD-3) |
|---|---|---|
| Maturity | Rewritten 2018–2022; Chrome DevTools, JupyterLab 4, Replit | Since 2010; many older apps, the legacy OpenStata app |
| Ease of use | Modular, more concepts, more power | One object with setters, faster to start |
| Mobile | The browser's own editing (contenteditable): touch, phone keyboards, IME, screen readers; a main goal of the rewrite | A hidden textarea and its own drawing; touch selection and phone keyboards are its weak spot |
| Size, basic setup | 131 KB gz | 128 KB gz core + 17 KB autocomplete |
| Stata support | None | None |

Stata highlighting is our work either way (`*` comments only at a line's start, nesting `/* */`, `///`, nesting macro quotes
and compound quotes, `$x` and `${x}`, abbreviated commands); the command list comes from OpenDTA's registry, so what is
highlighted is what the engine runs. Grammars to learn from (MIT): `kylebarron/language-stata`, `codedthinking/tree-sitter-stata`.
**CodeMirror 6 was chosen** because mobile is where they differ and the sizes are the same; the proof of concept used it in
every engine, with a highlighter of about 100 lines.

## Repository layout (alternatives)

Chosen: the Python package stays at the root; each other product is one self-contained top-level folder (`web/` beside
`plugins/`); Python the page needs stays in `src/dofile/`, so pytest tests it and it ships in the wheel. Why not move Python:
the wheel and sdist build from the root, users' MCP configs say `uv run --directory /path/to/dofile`, and CI, `poe`, the vendor
script and test paths assume it. A pnpm workspace comes with a second JavaScript project, not before. Rejected: a monorepo
with `python/` (cleaner only if Python stops being the main product) and an `apps/` folder (a level more for two apps).

## Decision 1 as first made: IDBFS

Superseded on 2026-11-10 by dofile's own store (the plan's decision 1); built in prototype 1 step 2. The first version: an
Emscripten in-memory `/work` saved to IndexedDB with IDBFS (`FS.syncfs`) after each run and each change, in the worker, one
sync at a time queued with the runs. Two copies, because Python's file calls are synchronous and IndexedDB is async only. Not
chosen then: OPFS via `mountNativeFS` (more Pyodide edge cases); Chromium's "open a folder" (`showDirectoryPicker`) is a later
option. Why it was replaced: IDBFS's save makes the database equal to the memory copy, so a second writer's files can be
removed; the snapshot start downloads everything before any file call answers, so "Not now" could not work; and it tied the
page to Emscripten's record format. A second small Pyodide before the snapshot was rejected (about 6 MB before the visitor
agrees to a download, and a second writer).

## Decision 3: the earlier discussion

Superseded on 2026-11-10 by Preact with signals. The proof of concept was plain TypeScript (about 200 lines), with the
framework left to the design step: React if the design wanted ready-made Material components, else Preact. Size did not
decide it (Pyodide is tens of MB). React would also have worked; native `<dialog>` and popover cover dialogs and menus, and
signals let the engine client be a plain module.

## Design decisions built (iterations 2 and 3, 2026-11-09)

After the UX crits (`docs/design/mockups/ux-analysis.md`, `ux-analysis-2.md`); all built. Iteration 2: Run and Run selection
run a copy of the editor's text, saved or not, while `do` and `include` read the saved file (the log notes unsaved edits); a
first visit asks before downloading the engine, then shows a download bar and the start stages; "Not now" leaves a working
editor and file manager; a click on a variable marks its column in Browse; Reset asks; a name clash offers "Keep mine"
(default) or "Replace with uploaded", with "do the same for the rest"; a per-file ⋯ menu and "Download all (.zip)"; the phone's
Break has another shape and color and ignores taps in its first 600 ms. Iteration 3: Break's countdown offers "Don't reset:
wait for it" (then "Reset now"); the download can be stopped and resumed; the file list is an ARIA tree with roving focus,
editor tabs a tablist; Esc in a clash keeps yours for the rest; the page asks `navigator.storage.persist()` and says "This
browser may clear your files" when it is not granted. Deferred then and placed since: storage per browser (the Safari
re-check), the iOS long press (none, #52), a real-phone test of the Break guard (the verification pass). Design system:
`web/src/styles/tokens.css` and `ui.css`, the sheet and crit in `docs/design/system/`; the banner is B2.

## Decisions (2026-11-10)

Cited as "2026-11-10 decision N". The detail a builder needs is in SPEC.
1. **File store:** dofile's own IndexedDB store with the `pending` journal; IDBFS dropped; files in the old IDBFS store are not
   imported and the old database is left unused (the plan's decision 1).
2. **Framework:** Preact with signals on `ui.css`, no component library.
3. **Runtime:** self-hosted for the snapshot start; `?snapshot=0` keeps the CDN, a diagnostic mode.
4. **Download size:** about 48 MB for the snapshot start, added up from file sizes, not measured in a browser; the pages take
   the number from the build.
5. **Deploy size check** in `deploy.yml`: fail over 25 MiB per file, warn over 23 MiB; the snapshot files are not split.
6. **Styles:** `tokens.css` and `ui.css` are the one source for the page and the design pages.
7. **Scope of prototype 1:** desktop and phone layouts with the core flows; the prototype 2 list is in the plan.
8. **The spec's open questions** (SPEC section 10): its recommendations accepted, except that the log streams during a run
   (OQ-1); Load's question about changed data and drafts kept across a reload are P2 (OQ-6, OQ-17); step 4d drafts the missing
   words and the maintainer approves them (OQ-10, OQ-16, OQ-18).
9. **Tabled:** the Safari 7-day storage note (re-verify after the prototype, step 7); keyboard shortcuts beyond the design's.
10. **Cleanup:** `web/spike/` and `eval/` deleted.
11. **`?snapshot=0` is not named by the page.** A stale snapshot is reason "updated": the page says to reload. An automatic
    fallback to the normal boot is not built.
12. **Words for step 4a:** the close-tab dialog ("Save changes to clean.do?": Save, Don't save, Cancel) and "Delete all 12
    files?" (SPEC 3.10); a failed "Download all" shows the banner `download-failed` with "Try again", no toast; a command that
    does not run stays in the command line and is not added to the history.

## CI and deploy (old step 9)

`.github/workflows/web.yml` (2026-11-08) runs `npm run check`, a check that `commands.json` is current, `npm test`, the build,
the e2e and the snapshot job (`npm run snapshot`, `npm test`, `check-snapshot`). Since #32 the e2e is a matrix of four browser
profiles, each on its own runner with a 30-minute limit; since #33 every job also runs on a push to `main`, one run per commit;
a pull request that touches none of its inputs skips the test jobs but reports through `web ok` (`ci.yml` has `ci ok` with its
own filter). `check-pytest` (about 2 minutes) and `check-numeric` (about 4) stay by hand. First runs on GitHub found: the runner
is slower than a laptop (1908_models2 took over 300 s with four cases at a time, so the per-case limit is 900 s); 1701 and 1911
count as expected differences (`EXPECTED_DIFFER` in `check-snapshot.mjs`, a strict xfail); an iPhone-profile run once took
about 200 s to become ready, so the e2e waits up to 300 s for the engine and a test may take 600 s. `deploy.yml` deploys the
build to Cloudflare Workers on each merge to `main`. #20 and #21 bumped `cloudflare/wrangler-action` (3 to 4) and
`actions/cache` (5 to 6; merged by hand, since the `gh` token has no `workflow` scope).

## Prototype 1: the record from "Where things stand", to 2026-11-13

The record of the build, condensed; it runs on to the 2026-11-14 merges. The checks at each tip and the review logistics are
dropped (git and the pull requests hold them).

- **Steps 0 to 2** merged into `main` before step 3 began.
- **Step 3** (the app shell) was built on `prototype1-step3`, reviewed twice and edited from the maintainer's notes: the
  other-tab dialog has "Close editor" and "Use dofile in this tab"; `App.tsx` holds the whole layout, each phone piece next to
  its desktop one; the viewport meta does not set `interactive-widget`, so Android keeps its default and `app/viewport.ts` serves
  both; the phone toast goes above the keyboard; a failed start has plain `message` and a developer's `detail`; whether to ask
  at load comes from the Cache (`client.cached()`), and a `failed-twice` (not memory or no-wasm) deletes the start files.
- **Step 3.5 and the formatting work** (Biome for `web/`, ruff for dofile's Python, width 120;
  [formatting-proposal.md](archive/formatting-proposal.md)) were merged with step 3 by #13 (`aff60a5`, 2026-11-11). The design checks
  passed then (0 violations in 36 axe runs, 0 contrast failures, 0 hidden focus stops, 0 font problems).
- **Open from step 3.5** (`web-engine-data-flow.md`, Part 3): the lost Break, the upgraded database and the worker-only store
  failure went to the audit (2026-11-13, "go with recommendations"); a closed database keeps today's restart (the maintainer,
  2026-11-11). No timeout on the start stays iceboxed ("A watchdog for the engine start").
- **Step 4** was built on one branch, `prototype1-step4` (#17), since each merge deploys. 4c, then 4a rebased on it, joined
  with the decisions of 2026-11-11 (step 4 A 11); then 4d and 4b, then the joining changes (step 4 A 1 to A 4, B 1). Four
  fresh-context reviews of the join and of 4b's fixes found and fixed: the echo walk (`log/align.ts`) placing a graph's link at
  the wrong echo after a nested `do` (now linear: a 16,000-line log took 400 ms before, 5 ms after); pasted lines stopping when
  another tab takes the engine; a run that rewrites an open file going through the editor's `ranOver`; a dialog's focus given
  back once; Save keeping the file's line break and byte order mark (step 4 A 6, A 7, B 9); Ctrl/Cmd+S on any keyboard layout.
  The four new e2e tests of the last review failed on the code before the fixes (16 of 16 cases). Then: no key chip or hint
  on the phone layout (A 8), "Not affiliated with StataCorp" from 1200 px (A 9), Ctrl or Cmd on every platform.
- **Step 5** was built on `prototype1-step5`, stacked on step 4 (#18): the landing page at `/`, the commands page, the editor
  at `/app/`, the sample (loaded on a first visit, "Restore the sample" in the file menu), and the clean-room record (below).
  What was built and the words: SPEC section 8, "As built in step 5".
- **UI fix round** (2026-11-12, `ui-lightning`): the editor's focus ring, the lines-to-run mark, no sideways overscroll, a
  tooltip with the full path; a "Wrap lines" preference; "Commands" and "About dofile" open in a new tab; on a phone the
  file and log actions are the strip's "Files ⋯" and "Log ⋯"; the Log pane's "Clear" and Split; error toasts; a sticky top bar
  on the static pages.
- **Fix round 2** (2026-11-12, each pull request on the maintainer's word): #22 (step 4 C 4, C 8, C 12; keys with Alt, Ctrl or
  Cmd left to the browser in the file tree; three flaky e2e tests), #23 (review decision 1), #24 (review decisions 3 and 4),
  #25 (review decision 2), #30 (landing page fixes), #31 (a 60 s navigation timeout on `webkit` and `iphone`), #32, #33, #34
  (the `?snapshot=0` test skipped in WebKit), #20, #21.
- **#26, "Remove the queued run" and "Start engine"** (2026-11-12; the maintainer: "i approve your recommendations for 26"):
  with no engine nothing offers to run; Run and the command line's button read "Start engine", Ctrl/Cmd+Enter does the same,
  the command line is off with "Start the engine to run code" and keeps its text; Run selection, Load, Import and the log's
  `help` links are off and say why in a toast. Widths, the maintainer: "we want it to be as small as it can in every
  situation". State table: `docs/web-page-flows.md` section 2. Kept as built (2026-11-13, "all recommendations"): a multi-line
  paste into an engine that is not ready is refused whole; a held Enter is ignored in every dialog (checked by the maintainer
  on real keyboards: "good on all browsers"); a retry from a failed start downloads with no prompt. To the audit: the off
  controls' contrast and a held Enter on a banner button.
- **#27, the phone keyboard** (three rounds on an iPhone, iOS 27.0.1, `docs/phone-keyboard-experiment.md`): the command line
  takes a tap's focus with `preventScroll`; Safari's pan is scrolled straight back with `.app` at the top; the editor's caret is
  scrolled above the keyboard through CodeMirror. `?kblog` stays. #28 and #29 were closed unmerged.
- **Causes of two CI failures** (investigated 2026-11-12, neither reproduced):
  - *WebKit's first-navigation hang:* a fresh page's first `goto` to `/app/` stays on `about:blank`. Likely (medium-high
    confidence) WebKit bug 325840, a race when a `Cross-Origin-Opener-Policy: same-origin` document forces a process swap
    (Playwright #42957, closed as upstream; WebKit/WebKit#75569 open on 2026-11-10; not in Playwright 1.65.0). Rate about 1
    navigation in 3,000, about 7% of full runs (from run counts). Ruled out: the preview server, a service worker, a crash, a
    dofile change. #31 caps the cost at 60 s; a one-retry of a stalled first navigation (`retryFirstGoto` in
    `web/e2e/fixtures.ts`) is merged.
  - *`?snapshot=0` stall:* the normal boot stops inside Pyodide's `loadPackage` after every download finished, for 312 s
    (passing runs take 17 to 34 s). Likely (moderate confidence) one `WebAssembly.instantiate` in the worker never settles and
    blocks the loader's lock (about 136 per boot); WebKit bug 208368 is like it. About 4% of WebKit runs (2 in about 49), none
    in Chromium or Firefox. #34 skips the test in WebKit. Nothing times out the `starting-worker` state (`docs/icebox.md`).
- **#40, post-merge fixes** (2026-11-13): a Save right after a rename or a delete, before its write ended, left the texts under
  the wrong names or brought the deleted file back (a Save now waits for `fileTurn`); the file tree's 50 ms focus poll could
  steal the focus (now the row's render takes it, `useRovingFocus`); step 4 B 1, B 5, C 1, C 3, C 5; step 4 C 7, C 11 and
  step 5 C 6 decided; the phone strip at one height with a 44 px ⋯; Save in the phone's file dropdown; `ui/Menu.tsx` owns its
  active item.
- **Merged 2026-11-13:** #43 (Break's pill, status bar and banners on one clock, "Stopping…" until the engine confirms); #45
  (one focus-hooks file; each focus request taken by the render that draws its target); #46 ("Restore the sample" as an upload,
  step 5 B 4); #47 (step 4 C 17, C 21); #48 (a touchmove guard stops iOS panning the page while the keyboard is open; checked on
  the maintainer's iPhone); #50 (New .do file and New folder draw their field in the tap, so the iPhone keyboard comes up;
  Enter writes and opens, leaving the field writes only, "Write only, don't open"; Esc discards; checked on the maintainer's
  iPhone); #53 (the failed-twice banner ends "Your files are safe: you can still edit and download them."; the last of SPEC
  section 8's draft words). Gaps of #48 and #50: `docs/icebox.md`, "Phone" and "Command line, log and files".
- **Merged 2026-11-14:** #52 "Files in folders" (98b6563 to 2b2f461): a folder's menu has "New file here" and "New folder"; a
  "+" in the Files head and the phone strip makes a file in the folder of the row last focused (row-based, the maintainer); no
  long-press, the ⋯ only on a phone; a draft's name may be a path (`sub/x.do`; missing folders are made); Esc in a draft gives
  the focus back to its row; a double-click on a folder leaves it current. #54 the Results tab's copy (fcaa3d3, a8bb7d2): the
  whole row copies; every value is a Tab stop; "✓ Copied" shows in the row for 2 s and a toast names it ("Copied e(r2)"); the
  engine's unchanged preset globals are hidden; hover and focus tint by CSS; folds unchanged; no copy hint on a phone (closes
  step 4 B 8); a matrix row's click copies only ("Copied e(b)"), and View and Hide do not copy. #55 (cbb35f3): an e2e check that
  the Results act cell keeps 8 px spare around its content.
- **Reported, iceboxed:** dofile may crash Firefox on the desktop (2026-11-12); not reproduced; the maintainer: "icebox the
  firefox crash, i'll revisit it if it happens again" (`docs/icebox.md`, "Engine memory").

## Review decisions 1 to 22

The maintainer's post-merge review document (2026-11-12 and 2026-11-13). Cited as "review decision N".

| N | Decision | Where |
|---|---|---|
| 1 | "Clear log" asks first | #23 |
| 2 | The screen stays awake while the engine works | #25 |
| 3, 4 | The phone command line: autocorrect off as an attribute, typed curly quotes straightened, a Run button | #24 |
| 5 | The trackpad back-swipe over the editor and the log, checked once by hand | the verification pass |
| 6 | Zoom on the editor page: the keyboard experiment ran with zoom off; turning it on needs another iPhone sitting | the maintainer; `docs/icebox.md`, "Phone" |
| 7 | The B items of steps 4 and 5: step 4 B 7 iceboxed, step 5 B 4 done by #46, the rest confirmed | below |
| 8, 10, 11, 15 | Fixed | #40 |
| 9 | The "Running…" flash and step 4 C 2 | later UI work, 6 |
| 12 | The editor's own find (step 4 C 9) | iceboxed |
| 13, 14 | The other C items: step 4 C 2 to later UI work 6, C 13 to the verification pass, C 20 to the audit, C 22 iceboxed; step 5 C 1 to the first deploy's checks, C 4 to `docs/test-map.md`, C 5 to the audit | below |
| 16 | Fixed | #40, #45 |
| 17 | The order of the later UI work, "queued run first": dropped, the queued run is gone | — |
| 18 | Run only `.do` and `.ado` files: accepted | later UI work, 1 |
| 19 | Syntax checking: changed (a syntax error refuses the run, an unknown command warns) | later UI work, 2 |
| 20 | `cls`: accepted | later UI work, 7 |
| 21 | Move, rename from a tab, drag (no drag by touch): accepted | later UI work, 3 to 5 |
| 22 | The audit's width: its plan plus three cheap checks | the plan, "The audit" |

## Post-merge review (after steps 4 and 5 merge)

By the maintainer's decision (2026-11-11), lists B and C of steps 4 and 5 and SPEC section 8's draft words did not block the
merge of #17 and #18; they were reviewed after it. Done 2026-11-13: every B item confirmed or changed, every C item fixed,
iceboxed, placed or kept (marked in the lists below); all draft words decided (the last by #53); a document pass put the
non-critical items in `docs/icebox.md` and the critical ones in the plan's "Open, critical"; the queued run removed (#26: no
state holds a run, `started` always leads to `ready`, no `drop-run`, run.ts's `pending` and `dropped` gone). Open: the first
real deploy's checks (the plan).

Found in the UI fix round (2026-11-12): the "Running…" banner flashes for every short run and pasted line (later UI work, 6);
the phone keyboard's jump (settled by #27); `overscroll-behavior-x: none` on the editor and the log also stops a trackpad
back-swipe that starts over them (review decision 5). The Firefox flake of `editor.spec.ts` "a rename while Save writes" and
the `?snapshot=0` test's Firefox failures are tracked in `docs/test-map.md`, "Known flaky tests".

## Step 4: decisions and open questions

The list for step 4 (#17), as the code behaves. The words drafted for the visitor are in SPEC section 8.

**A. Decided by the maintainer** (2026-11-11)
1. Text pasted into the command line with line breaks runs each line in turn; trailing breaks are stripped first, so one copied
   line with its break is an ordinary paste (`log/paste.ts`).
2. A run that rewrites an open file: a clean tab shows the run's version; a tab with unsaved edits keeps them and gets the
   banner `run-changed` ("Reload from the run", "Dismiss").
3. `.md` and `.json` are highlighted with CodeMirror's packages.
4. A queued command's end was decided by the state machine (`drop-run`). Superseded by #26: there is no queued command.
5. The engine's hint for an unclosed block still names OpenDTA's Command window and Shift+Enter (ODT-33). A multi-line command
   line is future work (`docs/icebox.md`); today such a paste stops with a toast that points to the editor.
6. Save keeps a file's line break, `\r\n` or `\n`, noted when it is read; a new or empty file gets `\n` (`editor/ranover.ts`).
7. Save keeps a UTF-8 byte order mark, except in a `.do` or `.ado` file: the engine reads a BOM as part of the first command
   (ODT-34; `dropsBom`).
8. Keyboard shortcuts work at every width; the phone layout shows no key chip and no key hint.
9. The status bar says "Not affiliated with StataCorp" on the desktop from 1200 px (SPEC 3.6).
10. The log's head keeps "Stata 14 syntax": a descriptive use of the name.
11. On a phone the Files head is hidden and the file actions are in the strip's "Files ⋯" (since the UI fix round); the unfolded
    file list (700 to 1199 px) gives the focus to the tree's row; a drop of files anywhere uploads them; a toast confirms or
    reports an error that needs no action, and anything to act on is a banner or a dialog (SPEC 3.10); a graph is drawn in the
    run's theme whatever colors its command names (a rule that drew such graphs light was built and removed the same day: it
    needed engine changes shared with the CLI and MCP server for a small gain).
12. A Ctrl/Cmd+Enter the engine does not take says why in a toast by the engine's state (`refusedRunWords`); a held one runs
    once. Since #26, with no engine it does what "Start engine" does, with no toast.

**B. Made during review, for the maintainer's confirmation** (all resolved 2026-11-13)
1. The error mark belongs to the file's last run. Changed (#40), the maintainer: "it is ephemeral": it lives in the tab's
   editor state, goes when the tab closes and stays with a renamed tab.
2. On a phone a tap on the Break pill also shows the Log view. Confirmed.
3. Pasted lines stop at the first refused line or rc other than 0, and before a line that opens a block, opens a `/*` comment
   or holds `///`; a toast says how many lines did not run. Since #26 a paste into an engine that is not ready is refused
   whole. "Fine for now" (#40).
4. Load on a phone's .dta tab shows only its toast. Confirmed.
5. Reset asks unless the engine is `ready` and nothing has run on it since it started (#40, with C 1; `resetAsks`).
6. With a .dta tab active, a focus hand-off goes to that tab, else to its Load button. Confirmed.
7. A run that writes something not text over an open text tab keeps the tab's text, unsaved, with the `run-changed` banner.
   Iceboxed with the redesign of file synchronization.
8. No copy hint on a phone; a tap copies and the toast names it. Decided 2026-11-14 (#54, "Confirm: no hint").
9. A file with mixed line breaks is saved with the more common one (`\n` on a tie; lone `\r` becomes `\n`). Confirmed (#40),
   as VS Code does.

**C. Open questions** (each decided 2026-11-13 unless marked)
1. Reset did not ask when only globals, scalars or graphs were held (S 14 read literally). Fixed (#40) with B 5.
2. The running banner shows on every run, though S 11's caption says "with the first run". Placed: later UI work, 6.
3. "Run the file again" ran the active tab, not the cut file. Fixed (#40): it runs the file whose run was cut, after a Break or
   a crash only.
4. The Break grace of 5 s was written twice. Done: `BREAK_GRACE_MS` in `engine/types.ts`.
5. A failed start was announced twice to a screen reader. Fixed (#40): the failed banners are not `role="alert"`.
6. "Browsers that work" and "Close editor" were dead links until step 5. Done: `/#browsers` and `/`, checked by
   `e2e/landing.spec.ts` and the tab-lock test.
7. A file a run deleted keeps its tab, and Save writes it again. Kept, as other editors do (#40); a "(deleted)" mark and the
   redesign of file synchronization are iceboxed.
8. Ctrl/Cmd+S with a dialog open saved the tab behind it. Done: it saves nothing then.
9. The editor has no find of its own; Find searches the log. Iceboxed (review decision 12).
10. On a phone the toast sat a command line's height too high on views with no command line. Fixed in the UI fix round.
11. In `#delimit ;` mode two commands on one line are echoed twice, which can misplace a graph's link. Iceboxed (#40).
12. The memory banner was built but nothing adds it (OQ-8: no limit is measured). Its code is removed.
13. On a real iPhone: the keyboard opens again when a dialog gives the focus back to the command line. Placed: the
    verification pass.
14. A clash over an open file with unsaved edits is asked again after "Do the same" with Replace. Iceboxed with the redesign of
    file synchronization.
15. A drag that began in the page is not taken as an upload, a guard on partial evidence. Iceboxed with the drag-and-drop audit.
16. With a dialog open or another tab owning the files, a drag of files shows nothing and uploads nothing. Iceboxed with the
    drag-and-drop audit.
17. The forced-colors rules sit in each part's block of `app.css`. Resolved (#47): SPEC section 1 describes them where they are.
18. "Restore the sample" is above "Delete all files…" in the Files head menu (OQ-13). Done in step 5.
19. A graph that keeps its own scheme in the dark theme is a light image on a dark card; the card has a thin border, so it looks
    intended.
20. The main JavaScript chunk is over Vite's 500 kB warning. Moved to the audit (code splitting).
21. A two-word `help` topic in a hint's link. Closed (#47): every engine hint's topic is one word.
22. At 700 to about 855 px with a 20 px default font the toolbar scrolls sideways. Iceboxed ("Accessibility"): rare, nothing
    lost, a fix needs a third toolbar form.

## Step 5: decisions and open questions

The list for step 5 (#18). What was built, the addresses and the draft words: SPEC section 8, "As built in step 5".

**A. Decided by the maintainer** (2026-11-11)
1. The landing page is `/`, the commands page `/commands/`, the editor a single-page app under `/app/`.
2. The editor's location is one setting, `web/scripts/urls.ts` (`EDITOR_BASE`, `EDITOR_URL`, `SITE_URL`), so it can move to its
   own subdomain: two builds into two folders plus the edits SPEC section 8, "URLs", lists.
3. The landing and commands pages load none of the editor's code: static HTML with their own scripts and stylesheet
   (`src/site/`), complete with scripts off.
4. `sysuse` is left as the engine has it: OpenDTA's three synthetic datasets load; the names of Stata's example datasets give
   rc 601 with a note.

**B. Made during the step, for the maintainer's confirmation** (all resolved 2026-11-13)
1. The commands page is `/commands/`, and `/commands.html` redirects to it. Confirmed.
2. The first visit's sample brings no storage banner (S 19) for its own writes; later changes do. Confirmed ("do not bring the
   banner on the initial sample write").
3. The first-visit sample is off under `?test` unless the URL has `?sample`. Kept ("current situation probably fine").
4. "Restore the sample" is an upload of the sample (#46, the maintainer's request: "restoring the sample should act as an upload
   of the sample + switching tab to analysis.do"): identical files are not asked, the clash dialog takes the sample's words.
5. "Browsers that work" says only what the tests and docs support. Done: the maintainer replaced the text on 2026-11-12
   (Chromium, Firefox and WebKit tested automatically; an iPhone 13 by hand in Safari, older iPhones and iPads may not start;
   Android not tested; files in this browser only; on some networks Break resets the engine).
6. `/landing.html` is a 404, not a redirect: it was never deployed. Confirmed.

**C. Open questions**
1. The first real deploy: SPEC section 8, "To look at on the first real deploy". Open: the plan's "Open, critical".
2. OpenDTA's `growth` dataset resembles Stata's `childweight` in theme only. Kept ("keep growth"); a re-run of its generator
   matches the vendored data.
3. The engine's own text (errors, hints, OpenDTA's `help` pages) was not audited again for step 5. Iceboxed ("Engine text"):
   "no engine patches that are non critical for correctness until phase 2(web editor) is done".
4. `shell.spec.ts`'s `?snapshot=0` test fails now and then in Firefox, cause unknown. Kept in `docs/test-map.md`.
5. The design checks read the mockups, not the built pages. Held by the audit.
6. "Restore the sample" against a Save in progress of the same file can leave the store and the tab apart for a window of
   milliseconds (read from the code). Iceboxed with uploads, which also write outside `fileTurn`.

## Known work found in steps 1 and 2 and the step 1 review

Decisions and notes that the code now follows; the open ones are in the plan or the icebox.
- **Step 2 review:** a run's new file inside a folder the page renamed or removed during the run is not saved
  (`RunResult.skipped`, noted in the log); the engine cannot see page changes during a run, so such a `save` succeeds where Stata
  would give r(603) (passing changes mid-run through a `SharedArrayBuffer` is iceboxed). With no Web Locks (plain HTTP on a
  LAN) every tab owns the engine: accepted. The build writes `start-files.json` (each start file, its size and compressed
  size), so the prompt has the size before any download. The real page keeps a test hook behind `?test`.
- **Step 3:** the streamed log (`run(code, {onLog})`) is replaced by `RunResult.log` at the end, never appended to (the stream
  can stop short with no marker).
- **Step 4a:** on a phone the Files head is hidden (step 4 A 11).
- **Step 4b:** a run stopped by Break says "stopped before line N" with no error mark; each graph link goes after the echo on
  `graph_lines[i]` (`log/align.ts`); the command line clears its field only when the command is accepted.
- **Step 4c:** dark plots: colors the visitor names nearly vanish on the dark card; accepted (step 4 A 11). Graphs from one loop
  share a command, so the alt text adds the graph's number. A `browse` cell over 60 characters, or with a line break, is cut to
  one line and shows whole when pressed.
- **Step 4d:** a failed "Download all" shows the banner `download-failed` (a draft in SPEC section 8), on every phone view.
- **Step 5:** "Close editor" and "Browsers that work" go to `/` and `/#browsers` (step 4 C 6).

## Step 5: the clean-room record (2026-11-11)

Also cited as "Clean-room check of the site's text". The check of every word the site shows a visitor against
`LICENSE-POLICY.md`, by the step 5 agent. **Result: nothing copied from StataCorp's material.**

**Checked:** `web/landing.html` and `web/commands.html` (all text, screen-reader text, titles and descriptions, "Browsers that
work", the sample run shown, which `web/test/sample-run.test.ts` compares with a real run); the sample (`analysis.do`,
`helpers.do`, `make_sample.py`, `data/wages.dta`'s names, labels and values); the editor page's words (`web/src/app/**`, the
`words.ts` files, SPEC section 8's draft words); the command names on the commands page.

**How:** each string against the policy's two tests (is it text from a manual, help page or example, or our own sentence
about what this page does?): in full for the landing and commands pages, the sample, `states/words.ts` and the dialogs,
banners, menus and toasts of SPEC 3.10 and 8; for the rest of the editor through searches and SPEC's lists. A search of
`web/src`, `web/*.html` and `web/sample` for `sysuse`, `webuse`, `auto.dta`, `nlsw`, `census`, `lifeexp`, `citytemp`,
`manual`, `sthlp`, `.ado`, `stata.com` and "Stata" found only product-name uses and code comments; `web/test/site.test.ts` and
`e2e/commands.spec.ts` repeat these searches, so a later edit that brings one in fails a test. The data: `make_sample.py` draws
every value from `default_rng(2026)` and writes the file with dofile's engine and a fixed header time;
`tests/test_sample_data.py` checks it makes the committed file byte for byte (a numpy upgrade that changes the draws fails it,
NEP 19; then rerun the script and `npm run sample`). Variables `id age educ female region wage`: no names, no real records.
The command names are read from the engine's registry.

**Doubtful, for the maintainer** (the plan's open question 8 says what is decided):
1. "Stata 14 syntax" in the log's head and "Stata 14" on the commands page: a statement of fact, one step beyond the policy's
   "Stata-syntax" and "Stata-compatible". The landing and commands pages carry the not-affiliated line; the editor's status bar
   does from 1200 px; the phone layout has none.
2. Text the engine prints (errors, layouts, `help` from OpenDTA's 173 `help/*.sthlp` pages, written under OpenDTA's own
   clean-room policy) is not the page's text and was not re-audited.
3. "Browsers that work" says only what the repository supports (since replaced by the maintainer's text, step 5 B 5).
4. The commands page marks `shell` and `webuse` "off in the browser" (`browser.py`'s `DENIED`): not a clean-room matter.
5. The mockups under `docs/design/` (not shipped) hold a Stata-style `regress` table of dofile's own run of synthetic data.

**`sysuse` and OpenDTA's datasets:** `sysuse` loads OpenDTA's three: `cohort` (300 rows), `diet` (400) and `growth` (300, 50
children by 6 years), each labelled "(synthetic, OpenDTA)"; Stata's example names (`auto`, `nlsw88`, `census`, ...) give rc 601
with a note. OpenDTA's `tools/make_datasets.py` at 0c3f3a2 builds them with seeds 2026 to 2028 and says no third-party dataset
is copied; their values sit on regular grids. Confidence high that they are generated. `data/icd/` holds the public-domain CMS
ICD-9-CM and ICD-10-CM tables, for `icd9`/`icd10`.
