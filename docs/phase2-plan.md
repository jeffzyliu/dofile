# dofile — Phase 2 plan: web demo

**Goal:** a static website with a landing page and a single-page editor that runs .do code in the browser. The engine runs
in Pyodide inside a Web Worker. The visitor uploads their own files (.do, .dta, .csv, .xlsx) into a working folder, and code
that names a file by any path finds it there. Nothing runs on a server: no accounts, no hosting cost beyond static files.

**Not in Phase 2:** accounts, sync between devices, sharing, server-side execution, the MCP server (Phase 3), community
commands, tutorials beyond one sample project, our own estimators.

This is the one plan for what is left of Phase 2. What is done, and the decided lists with their item IDs, are in
[phase2-history.md](phase2-history.md). To pick up after a break: read this file, then `docs/design/SPEC.md` (the build
spec), then `git status` and `git log --oneline -5`.

## Status (2026-11-14)

The engine runs in Pyodide and matches CPython (95 of 97 Stata 14 cases; 1701 and 1911 call `export sasxport`); the memory
snapshot is the default start (a return visit in 1.2 s, a first visit in 1.7 s unthrottled and 5.1 s at 100 Mbps, 41.6 MB at
brotli 11; one real iPhone took about 3 s to unpack with the browser's own decoder, [pyodide-snapshot.md](pyodide-snapshot.md)).
The editor page, the landing and commands pages and the sample project are built and merged (prototype 1 steps 0 to 5, pull
requests #13, #17 and #18, then fix rounds up to #55). CI runs on every pull request and every push to `main`, and each merge
to `main` deploys the one-origin build to Cloudflare Workers (workers.dev). PyPI has only the pre-release `0.1.0.dev1`
([releasing.md](releasing.md)).

The maintainer bought `dofile.dev` on 2026-11-14 and set up its Cloudflare zone. The two-origin split (`dofile.dev` for the
landing and commands pages, `app.dofile.dev` for the editor), pull request previews, a gated production deploy and
`docs/deploying.md` are built and reviewed on the **local, unpushed branch `deploy/dofile-dev`** (7592b53). It is not merged
and not deployed. No pull request is open; that branch is the next merge.

**Waiting on the maintainer:** the push and pull request of `deploy/dofile-dev`; the iPhone sitting (the phone command line,
the wake lock with the phone locked 30 s, review decision 6's zoom); how they saw Home open `analysis.do` (later UI work, 8).

## Step numbers

The remaining work has names, because two old numberings collide: the phase 2 plan's steps 1 to 10 (with 4a to 4e), and
prototype 1's steps 0 to 7 (with 3.5, 4a to 4d, 6r), the build plan for phase 2's steps 6 and 8. Phase 2's steps 4 (the
proof of concept), 5 (the design) and 7 (PyPI) are not prototype 1's. In code comments and other docs, "step 3.5", "step 4a"
to "4d", "step 6" (the audit) and "step 7" (the verification pass) are prototype 1's; "step 4 A/B/C n" and "step 5 A/B/C n"
are prototype 1's decision lists, now in the history; "decision N" (1 to 7) is this plan's; "review decision N" (1 to 22) is
the maintainer's post-merge review (a table in the history).

| Remaining work | Old numbers | Status |
|---|---|---|
| **Audit**: the full-web-code audit, the design checks on the real pages, the first real deploy's checks | phase 2 step 6 (its last part); prototype 1 step 6, with 6r folded in | not started |
| **Two origins**: `dofile.dev` and `app.dofile.dev` | prototype 1 step 6 (deployment) | built on `deploy/dofile-dev`, not merged |
| **Verification and phone pass**: the verification list below, a real-phone pass, the Safari storage re-check | prototype 1 step 7 | not started |
| **PyPI release**: a non-pre-release, so `pip install dofile` works | phase 2 step 7 | pre-release only |
| **Launch**: domain, Chrome, Firefox and Safari on desktop and phone, a link from the README | phase 2 step 10 | open |
| **Lazy matplotlib** (experiment, [lazy-matplotlib.md](lazy-matplotlib.md)) | phase 2 step 4a | not started, no code |
| **Later UI work** (8 items, below) | "After step 6: later UI work" | not started; nothing is built before the audit |

Done (in the history): phase 2 steps 1 to 5, 4b to 4e, 8 (landing page, sample, clean-room check; #18) and 9 (CI and deploy);
prototype 1 steps 0 to 5 and 3.5.

## Open, critical

Open items that are a data-loss or wrong-result bug, a security or clean-room issue, or that block the audit, a release or a
deploy. Everything else open is in this plan's lists, `docs/icebox.md` or `docs/test-map.md` ("Known flaky tests"). The
maintainer decides on the ones that are unsure.

- **The first real deploy's checks** block the first real deploy: SPEC section 8, "To look at on the first real deploy" (the
  edge's redirects, 404s and headers on 304s; a tab of the old build left open across a deploy shows a failed download, not
  "updated"). Step 5 C 1.
- **The two origins are split before the site is announced.** The browser keeps the visitors' files, the downloaded engine,
  the tab lock, the sample's mark and the theme per origin, so a split after visitors used `dofile.dev/app/` would leave their
  files behind. Built on `deploy/dofile-dev`, not merged.
- **Step 3.5's three engine gaps** (`web-engine-data-flow.md`, Part 3): a Break pressed between sending a run and the worker
  starting it is lost and ends as a 9998 reset; when another page upgrades the database, the new worker mounts with a store
  error and an empty `/work`; if only the worker fails to open the store, an upload shows in the file list but `use` on it gives
  rc 601 with no banner. In the audit's list.
- **The audit** as a whole (below).

## The audit (prototype 1 step 6)

Width decided 2026-11-13 (review decision 22): the work below plus three cheap checks. Security headers and the `?test` gate
wait until later. The maintainer's name for it is "the full-web-code audit"; it replaces a `/code-review` of the merged whole.

- **Code**, in the maintainer's words:
  - Preact lifecycle and raw DOM: "rely on render cycle as much as possible", "avoid raw dom operations wherever possible"
    (`querySelector` into rendered components, timers waiting for a render, focus or scroll moved from outside the owner).
  - Comments: top-of-file comments "keep getting changed due to unrelated file changes"; "leave heavy multi-module
    documentation in text files" and link to it.
  - Spaghetti patterns: "small changes in app statefulness and order of asynchronous concurrent operations" (booleans that
    patch an ordering, timers standing in for an event, duplicated state). Known case: uploads and "Restore the sample" write
    outside `fileTurn` (`docs/icebox.md`).
  - Focus consolidation: #45 made one focus-hooks file; check what is left of the `.focus()` calls (about 38 in 18 files before).
- **Three cheap checks:** unused code (knip), the licences of the web dependencies, stale docs.
- **Design checks on the real pages:** `npm run axe`, `tabwalk`, `contrast` and `fonts` read the mockups from `file:` URLs;
  only axe runs on the built landing and commands pages (`e2e/landing.spec.ts`; step 5 C 5). Also e2e per user flow, and the
  accessibility items of `docs/icebox.md`, "Accessibility".
- **Engine code:** step 3.5's three gaps (above).
- **Build:** code splitting of the main chunk (step 4 C 20; 562 kB raw, 191 kB gzip on 2026-11-13, over Vite's 500 kB warning).
- **To verify or check:** the off controls' contrast (#26: Load, Import and help links at 0.45 opacity measure 2.2 to 3.8 to 1);
  a held Enter on a banner button that hands the focus to the editor ("Try again", "Run the file again"), whose repeats may type
  newlines into CodeMirror; #37's unchecked items (Cmd+Enter in a `<select>`, the 1 px ring's contrast, the status bar's fit at
  1200 px); the UI round's nice-to-haves 6 (IME `isComposing`), 8 (ring contrast) and 9 (the `.log` focus ring's radius and its
  off-screen bottom edge).
- **Tests:** what the tests do not cover (the views are tried only by e2e; `check-pytest` and `check-numeric` run by hand);
  `web/e2e/poc.spec.ts` is bound to the proof-of-concept page's ids and is rewritten with the page (its four tests are fixme);
  one Playwright test of a streamed run in a real browser (step 1 checked streaming in Node only); Tab out of the open ⋯ menu
  at phone width (`e2e/shell.spec.ts` checks the desktop only). New specs import `test` from `e2e/fixtures.ts`.
- **The first real deploy's checks** (Open, critical).

## Verification and phone pass (prototype 1 step 7)

The maintainer's step. It runs the verification list below, and:

- The 48 MB download figure; Break on a long model fit in a browser; `pyreadstat` on a real iPhone; a phone over HTTPS with
  the cache working; a first visit over a real network; that the host compresses the `.wasm`.
- A real iPhone session: the phone command line; the wake lock with the phone locked for 30 s; the page does not scroll or
  bounce; with the keyboard open the command line sits right above it and the tab bar is hidden; a toast sits above the command
  line and the tab bar, and above the keyboard while it is open; the keyboard opens again when a dialog gives the focus back to
  the command line (step 4 C 13); #52's "+" bringing the keyboard up and the strip at 320 px. None of #22 to #25 and #40 has
  been tried on a real phone; #48 and #50 were.
- The same on an Android phone (Chrome, Firefox).
- Review decision 5: the trackpad back-swipe over the editor and the log, checked once by hand.
- Memory: the cap was measured on an iPhone 13 only (`docs/browser-engine.md`, "The memory cap"); try other phones, `merge`,
  `reshape`, `sort` and graphs near the cap, and a full heap in a browser.
- The Safari storage re-check (Safari deletes a site's storage after 7 days without a visit unless it is on the home screen;
  tabled 2026-11-10 until after prototype 1). Until then the page shows the generic "This browser may clear your files".

Review decision 6 (zoom on the editor page) is not part of this pass: it stays in `docs/icebox.md`, "Phone".

### Verification list (end of Phase 2)

`[x]` done, `[~]` partly, `[ ]` not done. Rechecked 2026-11-14 against `docs/test-map.md`, the tests and the history (the
browser suite was not run).

- [x] The conformance corpus gives the same numbers in Pyodide as in CPython. `check-snapshot` (the 63 corpus values to 1e-6
      and the 97 Stata 14 cases, 95 pass, 1701 and 1911 expected differences) runs in CI (`web.yml`, the snapshot job: on a pull
      request that changes its inputs, and on every push to `main`). `check-pytest` and `check-numeric` stay by hand (on
      2026-11-07, e() and r() of all 98 programs agreed to 1e-9 for 95% of estimation results).
- [~] Upload a replication package's .do and .dta files: a do-file with absolute Windows paths that starts with `cd` runs
      without edits, and the log notes each mapped path. The e2e does this for one file (`use C:\Users\me\proj\cps`, the note,
      a regression to 1e-6, `e2e/engine.spec.ts`) in four browser profiles; a real replication package has not been tried
      (verification pass).
- [x] Reload the page: files are still there; data in memory is not, and the page says so. In the e2e: Save, reload, files
      and the editor's text come back; Reset gives a new engine with no data and the files kept (not rechecked in detail).
- [~] Break stops `while 1 {}` with rc 1 and keeps the data (e2e, four profiles). A long single command is ended by restarting
      the worker and the page says the data is gone: tested in Node (`web/test/app.test.ts`), not in a browser. Break on a long
      model fit was not tried (verification pass).
- [~] Works in current Chrome, Firefox and Safari. Chromium, Firefox and WebKit pass the e2e (and an iPhone 15 profile); one
      real iPhone was tried by hand; Chrome and Edge as shipped, Android and Safari on a Mac were not (verification pass).
- [ ] No request leaves the page after load except for the static assets (the browser's network tab). Not checked for the
      editor. `e2e/landing.spec.ts` checks that the landing and commands pages ask only for their own assets, by path only (it
      ignores the host). `?snapshot=0` uses the CDN by design (verification pass).
- [~] `pip install dofile` works from PyPI: `pip install --pre dofile` does (`0.1.0.dev1`); no non-pre-release yet (PyPI
      release).

## Later UI work (the maintainer's ideas, 2026-11-12; not started)

Nothing here is built before the audit. The order among them is set when the work is scheduled (review decision 17, "queued
run first", was dropped: the queued run is gone, #26).

1. **Run only from a `.do` or `.ado` file** (review decision 18, accepted): Run is disabled with a reason; Ctrl/Cmd+Enter shows
   a toast; Run selection follows the same rule; a file with no extension does not run. Overlaps step 4 A 12 and C 3.
2. **Syntax checking of the active buffer**, with underlines (review decision 19, changed by the maintainer: "i do want to
   reject syntax errors"): stage 1 only, the page's own lexer. A syntax error (an unclosed quote, brace or comment) refuses the
   run; an unknown command only warns ("No, warn only"). The same for the command line. It would replace the paste heuristics
   `opensComment` and `opensBlock` (step 4 B 3, C 11) and bears on A 5's multi-line command line. Command names can come from
   `src/stata/commands.json`; argument checks need the engine's parser (not stage 1).
3. **Reorder the editor's tabs by dragging** (review decision 21, accepted): no drag by touch.
4. **Move files:** a "Move…" with a typed path first, drag in the file tree later (review decision 21: no drag by touch). Move
   refuses a name that exists.
5. **Rename from a right click on an editor tab** (review decision 21): a tab's Rename uses the Move dialog.
6. **Hold back the presentation of very quick operations** (about 100 ms), so buttons, the status bar and the running banner do
   not flash; the internal state is unchanged. Placed here by review decision 9; covers step 4 C 2 and the "Running…" flash.
7. **`cls`** at the command line clears the log (review decision 20, accepted): no confirmation; it clears the graphs too, like
   Clear log; it works during a run; command line only (in a do-file it stays an error, with a hint). `clear` keeps its meaning.
8. **Remember the open tabs across reloads.** A tab without the engine's lock neither reads nor writes storage, so the tab that
   holds the lock would keep them. Open: how the maintainer saw Home open `analysis.do` (the code opens it on a first visit only).

Deferred to prototype 2 (decided 2026-11-10): the Help tab; highlighters for .py, .R, .tex, .sql and .yaml; the
unknown-command underline and per-file list; the selection-run warning about an unset local; unpacking a .zip on upload. Also P2:
Load's question about changed data and drafts kept across a reload (OQ-6, OQ-17). Keyboard shortcuts beyond the design's are
tabled (Cmd+. is Safari's Stop, Cmd+L the address bar).

## Decisions in force

The reasons, the alternatives and the decisions already built are in the history. The design: `docs/design/` (SPEC.md is the
build spec; `README.md` holds every round of feedback).

1. **Where files live** (revised 2026-11-10, built): dofile's own store in IndexedDB, one record per file, shared by the page
   and the worker; `/work` is a plain in-memory folder that the worker fills at engine start and writes back as a difference
   after each run. A `pending` journal makes a page change made during a run win over that run. A Web Lock lets one tab own the
   engine; a second tab is blocked and writes nothing. Why: IDBFS's save could remove a second writer's files, and the file
   panel must work with no engine. Contract and tests: SPEC section 7. The first version (IDBFS):
   [history](phase2-history.md#decision-1-as-first-made-idbfs).
2. **The path shim** (browser only, PATCH-3, `src/dofile/pathshim.py`): relative paths resolve in `/work`; an absolute path maps
   to its longest tail that exists in `/work` (`C:\Users\me\proj\data\x.dta` → `data/x.dta`, else `x.dta`); a new file gets its
   file name; the log notes each mapped path. `cd` to a folder inside `/work` works, otherwise it prints a note (not rc 199:
   real do-files start with `cd`). In the CLI and MCP server absolute paths stay real and the sandbox refuses them (rc 603).
   Only `shell` and `webuse` are denied in the page. Unquoted Windows paths in `mkdir`/`rmdir`/`copy`/`dir` lose their
   backslashes (ODT-26, open).
3. **UI framework: Preact with signals** (2026-11-10), on the project's own `ui.css`, no component library. Plain TypeScript was
   rejected (about 20 states to sync by hand). [Earlier discussion](phase2-history.md#decision-3-the-earlier-discussion).
4. **Text editor: CodeMirror 6**, unless a real-phone test shows a problem.
   [Comparison with Ace](phase2-history.md#decision-4-codemirror-6-or-ace-the-comparison).
5. **Repository layout:** `web/` (Vite, TypeScript) beside the Python package at the root; the Python the page needs stays in
   `src/dofile/`. [Alternatives](phase2-history.md#repository-layout-alternatives).
6. **Hosting:** Cloudflare Workers static assets (`web/wrangler.jsonc`, the isolation headers in `web/public/_headers`,
   `deploy.yml`). Each asset must be under 25 MiB (the two snapshot files are about 20 MB each; `deploy.yml` fails over 25 MiB
   and warns over 23 MiB). The headers must be on every response, 304s included (WebKit refuses a worker whose cached 304 has
   no COEP). Domain: `dofile.dev`, bought 2026-11-14; the split is on `deploy/dofile-dev` (Status).
7. **Pyodide self-hosted for the snapshot start** (2026-11-10, built): the build copies `pyodide.asm.wasm`, `python_stdlib.zip`
   and `pyodide-lock.json` from the `pyodide` npm package into `public/pyodide/`. `?snapshot=0`, the normal boot, keeps the CDN
   and is a diagnostic mode the page never names.

Other rules a builder needs:
- **Scope of a run** (2026-11-08): every run is a do-file call (preserve restored, temporaries dropped). A whole-file run starts
  with no locals, so running a file twice gives the same answer; a selection and the command line keep the locals of the runs
  before them; globals, data and e()/r() carry over. The MCP server keeps its behavior.
- **Break** reaches PATCH-2's safe points through Pyodide's interrupt buffer and dofile's SIGINT handler; a single long command
  that cannot stop ends with a new worker (rc 9998, data lost, files kept). SharedArrayBuffer needs cross-origin isolation.
- **Clean room** (`LICENSE-POLICY.md`) applies to all page text; the sample uses our own synthetic data. The record:
  [history](phase2-history.md#step-5-the-clean-room-record-2026-11-11).
- How the page works: [web-page-flows.md](web-page-flows.md) (focus, runs, open files, log links) and
  [web-engine-data-flow.md](web-engine-data-flow.md) (the engine code, and Part 3, what is open in it).

## Risks still open

- **Load size and time:** 41.6 MB with matplotlib in the heap; lazy matplotlib is the open experiment.
- **Memory:** WebAssembly has at most 4 GB, less on phones; a large .dta can fail where the CLI works. An out-of-memory error
  must be reported clearly, without a freeze (no limit is measured, OQ-8).
- **Browser storage can be cleared:** site data cleared, a private window, eviction on a full disk unless
  `navigator.storage.persist()` was granted (the page asks), Safari's 7 days. The page says files stay only in this browser
  and offers "Download all (.zip)".
- **Path mapping can pick the wrong file** when two files share a name; the log note shows it.
- **Safari:** one real iPhone tried, no Mac Safari.

## Open questions for the maintainer (closing Phase 2)

1. Does Phase 2 close with the PyPI release (a non-pre-release) and the Launch (domain, browsers, README link), or do those
   move to a later phase? Options: both in Phase 2; the release in Phase 2 and the launch later; both later.
2. Once Phase 2 closes, where do the prototype 2 items and the later UI work live: a prototype 2 plan, a Phase 2.5 plan,
   `phase3-plan.md`, or `docs/icebox.md`?
3. When is the Safari 7-day storage re-check due ("after prototype 1")? In the verification pass, or before the launch?
4. Review decision 6 (zoom on the editor page) still waits on an iPhone sitting. Does Phase 2 wait for it, or does it stay
   iceboxed?
5. Lazy matplotlib (old step 4a, never started): keep it in Phase 2, icebox it, or drop it?
6. Which verification items still `[ ]` or `[~]` must be `[x]` to close Phase 2: a real replication package, Break on a long
   model fit, Chrome and Edge as shipped, Android, Safari on a Mac, no request leaving the editor page, `pip install dofile`?
7. The first real deploy's checks were to run on the one-origin site before the split. The split is now built on
   `deploy/dofile-dev`. Run them on today's workers.dev deploy before that branch merges, or on the split site after?
8. The clean-room record's "Doubtful" list: 1 is half decided (the log head's "Stata 14 syntax" kept, step 4 A 10; the commands
   page's "Stata 14" was not decided on its own), 2 is iceboxed (step 5 C 3), 3 was replaced by the maintainer's text (step 5
   B 5), 4 and 5 need nothing. Close the review, or decide the commands page's wording first?
9. `docs/design/system/critique.md` DS-7 (a text field's states, the dialog as a bottom sheet, the phone's tab bar and toast
   place, not drawn in the component sheet): the page builds them. Draw them in the sheet, or close DS-7? (DS-5, text sizes in
   rem, is done in `tokens.css`.)

## Pointers

[phase2-history.md](phase2-history.md); [icebox.md](icebox.md); [test-map.md](test-map.md);
[browser-engine.md](browser-engine.md) (the engine in Pyodide); [opendta-issues.md](opendta-issues.md) (ODT-n, PATCH-n);
[archive/prototype1-step3.5-plan.md](archive/prototype1-step3.5-plan.md).
