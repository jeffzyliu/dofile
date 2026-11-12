# Prototype 1 of the web demo: build plan and status

The working plan for steps 6 to 8 of [phase2-plan.md](phase2-plan.md): the editor page, the landing page and the sample
project, built to the design in `docs/design/`. This file is the one place for the step table and its status. Update the
Status column and the "Where things stand" section at the end of every session.

To pick up after a break: read this file, then `docs/design/SPEC.md` (the build spec), then run `git status` and
`git log --oneline -5`.

## Where things stand (2026-11-11)

- **Steps 3 and 3.5 are merged into `main`**, with the formatting and linting work, by pull request #13 (the merge commit
  `aff60a5`, 2026-11-11). `main` is pushed and protected (root `CLAUDE.md`, Rules): every change is a pull request, and a
  merge deploys the page. Checked before the merge, locally and in CI (Ubuntu and macOS, Python 3.12
  to 3.14): the lint gates; `npm test` (212 pass); e2e (74 passed, 22 skipped); `uv run poe ci` (1443 passed, 13 skipped, 3
  xfailed); the design checks. The branch `prototype1-step3` and its worktree are no longer needed. **Next: step 4, parts 4a
  and 4c first.** The bullets below about steps 3 and 3.5 are the record of that work as it stood on the branch.
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
  too (the next bullet). The draft words of 4a and 4c wait for the maintainer's approval (SPEC section 8, "As built").
- **Steps 0, 1 and 2 are merged into `main`**. Checked on `main` after step 2 merged: `uv run poe test` (1346
  passed), `npm run check`, `npm test` (98 tests), `npm run e2e` (56 passed).
- **Step 3.5 is done: the engine code made clear and auditable** (TypeScript everywhere, one state machine, one build
  identity, the journal as the only channel; steps A to E; merged by pull request #13).
  Its plan and status: [prototype1-step3.5-plan.md](prototype1-step3.5-plan.md). How the engine code works as built, and what
  is still open: [web-engine-data-flow.md](web-engine-data-flow.md).
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
  default (only the visual viewport shrinks for the keyboard, as on iOS) and `app/viewport.js` serves both, with a
  fallback for a browser that shrinks the layout viewport; the phone toast goes above the keyboard; a failed "Download
  all" shows the banner `download-failed` with "Try again"; a failed start's `message` is plain words for the visitor
  and its `detail` the developer's cause. Then (round 5): that banner shows on every phone view; the phone's Files view
  is no longer blank (`data-files` folded it away); shorter state labels on Run and Break ("Starting…", "Stopped",
  "Break (reset)"; the phone's "Run 6–7"), so the buttons are narrower; one height for the toolbar's buttons and one for a pane
  head's controls; the phone ⋯'s "Theme: ◐ System" cycles the theme and keeps the menu open. Round 6: the
  `dofile.downloaded` flag is gone; at load the page asks unless `client.cached()` finds this build's start files all in
  the Cache, and a `failed-twice` (not memory or no-wasm) deletes them (`client.forgetDownload()`).
- **Next, in this order:**
  1. Step 4: 4a and 4c first, then 4b and 4d. Step 3.5 changed the internals of `web/src/app/engine.ts`, `run.ts` and
     `web/src/engine/`; the contracts in SPEC sections 5 to 8 are what step 4 relies on.
  2. Step 5 (it can run beside step 4), then step 6 for each merged part and the review in 6r.
- **To try on a real iPhone** (none of this can be tested here; the e2e iPhone profile is an emulation with no real
  keyboard, toolbars or touch scrolling): the page does not scroll or bounce; with the keyboard open the command line sits
  right above it and the tab bar is hidden; a toast sits above the command line and the tab bar, and above the keyboard
  while it is open. An Android phone (Chrome, Firefox) should behave the same now.
- **Open from step 3.5** (listed in `web-engine-data-flow.md`, Part 3): a Break pressed between sending a run and the worker
  starting it is lost and ends as a 9998 reset; when another page upgrades the database, the new worker mounts with a store
  error and an empty `/work`; if only the worker fails to open the store, an upload shows in the file list but `use` on it gives
  rc 601 with no banner; a closed database keeps today's restart (the maintainer's ruling, 2026-11-11); the failed states show
  nothing until step 4d builds the banners.
- **4b and 4d are joined on `prototype1-step4`** (2026-11-11): 4d's four commits, then 4b's four, then the joining
  changes (the "Step 4 join" commits): `@lezer/highlight` declared, with CodeMirror's Markdown and JSON languages; the dead
  `.cmdline .placeholder` rules gone; the close-tab test's failed Save again; a dialog whose opener has left the page
  gives the focus to the editor or More actions; the phone ⋯'s Save off on a .dta tab; OQ-10's notes shown in the log
  where the engine's own words do not already say them (the tempfile note dropped); "Run the file again" tested with the
  real editor; one focus move with a .dta tab active (the tab wins). Then, on the maintainer's decisions: a run that
  rewrites an open file reloads a clean tab and keeps an edited one unsaved with the banner `run-changed`; a paste of one
  line with its line break is an ordinary paste; the error mark belongs to the file's last run (`editor/errormark.ts`);
  a queued run's `done` settles (the machine's effect `drop-run`), so the command line reads no state names. Decisions
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
  has it again when opened with the same text. Known, left: in `#delimit ;` mode two commands on one line are echoed as
  the whole line twice, and the second echo could be matched to a later identical line.
- **Open points:** the toolbar scrolls sideways at 700 to about 855 px with a 20 px default font size (notes below, step 3).

## Decisions (2026-11-10)

The reasons are in `phase2-plan.md` (decisions 1, 3 and 7); the detail a builder needs is in `docs/design/SPEC.md`.

1. **File store:** dofile's own store in IndexedDB, one record per file, shared by the page and the worker. `/work` in the
   worker becomes a plain in-memory folder; Emscripten's IDBFS is dropped. The page works on the store directly. The
   worker copies the store into `/work` at engine start and writes back only what each run changed. A save made during a
   run wins over that run's write of the same file: a `pending` journal in the store holds page changes the worker has not
   applied yet, and the worker leaves those paths out of the run's difference. A Web Lock lets one tab own the engine; a
   second tab is blocked entirely and writes nothing. Files in the old IDBFS store are not imported, and that database is
   left in the visitor's browser, unused.
2. **Framework:** Preact with signals, on the project's own `ui.css`. No component library.
3. **Runtime:** for the snapshot start, `pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` are copied from the
   `pyodide` npm package into `public/pyodide/` at build time and served from the page's own origin. `?snapshot=0` keeps
   the CDN and is a diagnostic mode.
4. **Download size:** about 48 MB for the snapshot start, added up from file sizes, not measured in a browser. The pages
   take the number from the build. Step 2 measures it.
5. **Deploy size check:** in `deploy.yml`, after the build: fail over 25 MiB per file, warn over 23 MiB. The snapshot files
   are not split.
6. **Styles:** `web/src/styles/tokens.css` and `web/src/styles/ui.css` are the one source for the page and the design pages.
7. **Scope of prototype 1:** desktop and phone layouts with the core flows. Deferred to prototype 2: the Help tab; the
   highlighters for .py, .R, .tex, .sql and .yaml; the unknown-command underline and per-file list; the selection-run
   warning about an unset local; unpacking a .zip on upload.
8. **The spec's open questions** (SPEC.md section 10): its recommendations are accepted, except: the log streams during a run
   (OQ-1); Load's question about changed data and drafts kept across a reload are P2 (OQ-6, OQ-17); the step 4d agent
   drafts the missing words and the maintainer approves them (OQ-10, OQ-16, OQ-18).
9. **Tabled:** the Safari 7-day storage note (re-verify after the prototype, step 7); keyboard shortcuts beyond the design's.
10. **Cleanup:** `web/spike/` and `eval/` are deleted (in git history at `10e0f1c`).
11. **`?snapshot=0` is not named by the page** (step 3, second review). It still works as the normal boot, a diagnostic mode
    for developers documented in `web/CLAUDE.md` and `docs/pyodide-snapshot.md`, but no message the page shows names it. A
    stale snapshot is reason "updated": the page says the site has a newer version and must be reloaded. An automatic
    fallback to the normal boot when the snapshot fails is a possible later step, not built.
12. **Words decided for step 4a** (step 3, second review): the close-tab dialog ("Save changes to clean.do?": Save, Don't
    save, Cancel) and the Delete-all dialog ("Delete all 12 files?"), in SPEC 3.10. A failed "Download all" gives no toast
    (it offers "Try again", and what the visitor can act on is a banner; a toast confirms, or reports an error that needs
    no action, SPEC 3.10 as reworded 2026-11-11): it shows the banner `download-failed` with "Try again" (built in step 3; 4d may restyle or
    reword it, OQ-16). A command that does not run stays in the
    command line and is not added to the history (SPEC 3.5, 8).

## Steps

Status values: `not started`, `running`, `to review`, `done`.

| Step | Work | Agent | Model, effort | Runs | Status |
|---|---|---|---|---|---|
| 0a | `docs/design/SPEC.md`: the build spec, with the worker protocol and state model types | general-purpose | Fable, high | first | done |
| 0b | Doc restructure (`CLAUDE.md` and plan splits), cleanup, `ui.css` into `web/`, the deploy size check | general-purpose | Sonnet, medium | with 0a | done |
| 1 | Engine API with tests (`engine.py`, `browser.py`): a whole-file run with no locals, the dark plot style, locals and globals, the first rows for Browse, memory use, the log streamed during a run (`on_output`; check first that it works in Pyodide), the error line, the command per graph, describing a .dta without loading it, the page's tempfile wording. Spec section 6. No MCP schema change: `mcp_server.py` does not send the new fields | general-purpose, worktree | Opus, medium | parallel with 2 | done |
| 2 | The file store with its `pending` journal, the self-hosted runtime, a build-written list of the start files with their sizes, download with byte counts and abort (resumed per file), Break as wait / reset now, the zip made in the page, the tab lock, `storage.persist()`, relaying the streamed log and the new ops; Node tests (spec section 7) | general-purpose, worktree | Fable, high | parallel with 1 | done |
| 3 | App shell: Preact, the tokens and `ui.css` in the page, layouts (desktop B, phone tabs), the theme toggle, the state store, and the shared primitives that 4a needs (dialog, menu, toast, the live region) | general-purpose, alone | Opus, high | after 1 and 2 | done |
| 3.5 | The engine code made clear and auditable: TypeScript everywhere, one explicit state machine, one build identity (no offline start), the journal as the only channel. Plan: `prototype1-step3.5-plan.md` | general-purpose, one step at a time | Opus, high | after 3, before the merge | done |
| 4a | File tree, editor tabs, upload and name clash, row menus | general-purpose, worktree | Opus, medium | after 3, with 4c | to review |
| 4b | Editor, Run, Break, log, run-head, status bar | general-purpose, worktree | Opus, medium | after 4a and 4c, with 4d | to review (joined on `prototype1-step4` with 4d, 2026-11-11) |
| 4c | Graph, Data and Browse, Results and the matrix view | general-purpose, worktree | Sonnet, medium | with 4a | to review |
| 4d | Dialogs and states: download prompt, failures, reset, toast; drafts the missing words (OQ-10, OQ-16, OQ-18) for the maintainer to approve before merge | general-purpose, worktree | Sonnet, medium | with 4b | to review (branch `prototype1-step4d`; the draft words are in SPEC section 8, "Step 4d: draft words"; the OQ-10 notes are written and tested but 4b's log must show them; the first review's fixes are in: Reset asks during a run, the focus after a banner goes, the take-over button's look; the second review's too: Reset describes the memory again after a run before it resets with no question, the focus goes from one banner to the next without passing through the editor, the e2e focus checks hold for CodeMirror; joined on `prototype1-step4` with 4b, 2026-11-11: the OQ-10 notes are shown by 4b's log, the tempfile one dropped since the engine says it; the dialog that gave the focus back to nothing now uses `focusStable()`; open for the maintainer: the phone's Break off the Log view, the running banner on every run, which file "Run the file again" runs, a failed start said twice, a shared Break grace constant) |
| 5 | Landing page, commands page, the sample project on synthetic data, clean-room check of all text | general-purpose, worktree | Sonnet, medium | parallel with 4 | not started |
| 6 | e2e per user flow; `axe`, `tabwalk`, `contrast` on the real pages | general-purpose | Sonnet, medium | after each of 3 to 5 | not started |
| 6r | Review of each merge (`/code-review`) | fresh context | Opus, high (Fable for step 2) | per merge | not started |
| 7 | The Phase 2 verification list; a real-phone pass; the Safari storage re-check | maintainer | | last | not started |

## How to run a step

- Step 0 must be committed before any worktree step starts: a worktree is made from the last commit, so it would not have
  the spec or the moved files.
- Give each agent: this file, `docs/design/SPEC.md`, the sections of the spec its step owns, and the rule that it does not
  commit unless told to.
- Steps 1 and 2 touch different files (`src/dofile/` and `tests/` against `web/src/engine/` and `web/test/`). The worker
  ops that call step 1's new Python functions are joined after both merge, at the start of step 3.
- Step 3 fixes the state model that the step 4 agents write against. Do not start step 4 before step 3 is merged.
- After each merge: step 6 for that part, then the review in 6r, then update the Status column here.

## Known work inside the steps (found in the review of 2026-11-10)

- **Step 2:** risk: the patched loader is loaded with `import()`, and it is not checked that `loadPyodide` can be given the
  runtime's bytes instead of fetching them itself; if it cannot, a counted download cannot hand those files to the start.
  `client.js` `breakRun` ties the interrupt to the 5 s kill timer; "Don't reset: wait for it" and "Reset now"
  need them apart. Today the snapshot start downloads everything before any file call answers, so the file panel waits
  for the engine; the file store removes that. The page does not call `navigator.storage.persist()` yet.
- **Step 3:** `worker.js`, `client.js` and `snapshot.js` are plain JavaScript and `main.ts` casts their results; add a
  shared types file from the spec's declarations, without converting them (the Node tests run them directly).
- **Step 6:** `web/e2e/poc.spec.ts` is bound to the proof-of-concept page's element ids and is rewritten with the page.
  `axe`, `tabwalk` and `contrast` check the mockups today, not the real page.
- **Step 7:** the 48 MB figure, Break on a long model fit in a browser, `pyreadstat` on a real iPhone, a phone over HTTPS
  with the cache working, "no request leaves the page except for static assets", and that the host compresses the `.wasm`.

## Known work found in steps 1 and 2 and the step 1 review

Decided in the step 2 review:
- A run's new file inside a folder the page renamed or removed during the run is not saved; `RunResult.skipped` lists it, and
  the log says so (step 4b). A file the page itself changed during the run is not listed: the page's version wins by design.
  The engine cannot see page changes during a run (the worker is busy in one synchronous call), so such a `save` succeeds
  where desktop Stata would give r(603). **P2 idea:** pass folder changes and deletes to the engine mid-run through a
  `SharedArrayBuffer`, checked before each command, as Break is.
- With no Web Locks (plain HTTP on a LAN, the dev server only), every tab owns the engine. Accepted and documented.
- `engineBytes` is written into the page at build time, so the prompt has the size before any download, offline too.
- The real page keeps a test hook, on only behind a flag, so step 2's tab-lock and download e2e tests keep running through
  steps 3 to 5. Step 2 lists what the hook must expose.

- **Step 3:**
  - Rebuild the snapshot after merging step 1 (`npm run snapshot`). Run `npm test`: the three tests in `files.test.mjs` that need
    step 1 turn on by themselves.
  - `engineBytes` is not a build constant: step 2's build writes `start-files.json` (each start file, its size on disk and its
    compressed size). The page reads `compressed` from it.
  - The engine controller builds the states of section 5 from `onStatus`, `onRestart(reason, started)`, `resetAt`, a
    `download()` rejection (`AbortError` means declined) and `start()` rejecting with "failed twice". Whether to ask
    at load comes from the Cache (`client.cached()`), not a flag (round 6).
  - Wire `main.ts` in this order: `tabLock`, then `keepFiles()`, then `store.*` (set `store.blocked` when the lock is lost),
    then `client.download()` and `client.start()`. Leave out the proof-of-concept page's `?start=manual`, `window.__dofile`
    and its `confirm()` take-over (or keep them for tests only).
  - Show the streamed log with `run(code, {onLog})`, and at the end replace it with `RunResult.log`, never append: the stream
    can stop short of the log with no marker (log cap, and the sandbox notes added after the run).
  - Add `graph_lines: []` to the client's rc 9998 result (`graph_lines` was added after step 2 was built).
  - Docs left stale by step 2: `web/CLAUDE.md` and `docs/pyodide-snapshot.md` (the loader from a `blob:` URL, the runtime
    from the page's origin, the cache-first fetch during the start).
  - Not fixed in step 3: between 700 px and about 855 px wide at a 20 px default font size, the toolbar scrolls sideways
    instead of fitting (its compact form starts below 56em).
- **Step 4a:** on a phone the Files view showed the pane head "FILES" right under the top bar's "Files" title. Decided
  and done (2026-11-11): the head is hidden on a phone and the file actions are in the top bar's ⋯ on the Files view
  (`App.tsx` `phoneMoreItems`, `app.css`). Also decided: a drop of files anywhere on the page uploads them.
- **Step 4b** (built, to review): a run stopped by Break (rc 1) has `error_line` on the command that did not start: say "stopped before line N"
  and give it no error mark. Put each "graph n" link after the echo on line `graph_lines[i]`, not by matching the text.
  From the second review of step 3: the toast's offset on a phone (`app.css` puts it above the command line and the tab
  bar, and with the keyboard open above the command line at the visible area's foot; set both against 4b's real command
  line, which shows on the Log view only, and the strip; `e2e/shell.spec.ts` checks the place). The command line clears
  its field only when `runCommand(text).accepted` (SPEC 8). All four done: the "stopped before line N" note with no
  error mark; the links placed by `log/align.ts` from `graph_lines` (the echoes walked beside the code sent; the text
  only keeps the two walks in step); the toast placed against the command line's fixed phone height (`--cmdline-h`,
  app.css 4b block); the field cleared only when accepted. The old `.cmdline .placeholder` rules in app.css's shell part
  were removed when 4b and 4d were joined; the e2e checks of 4b are `e2e/editor.spec.ts`.
- **Step 4b review (2026-11-11), fixed in 4b's files:** Find counted only the run-heads' and notes' matches (now every
  match, in the log's order), was unseen when unsplit on another Output tab, and left the focus on the page after the
  phone's ⋯; the error mark went back to the run's line number after a tab switch; the echo walk lost step after a `do`
  in a block or a mata block, and missed `capture noisily do`; a phone's inline graph was always on the light card; no
  focus ring in forced colors; `editorCommands.focus()` with a .dta tab active focused nothing; a log file's head words
  were muted anywhere in a run's output; a command's Break note named "line 1"; a pasted block's line was sent (now the
  lines stop before it, with a toast), and a Run or Enter could slip in between two pasted lines; Save was on for a .dta
  tab. Decided at the review (from step 4d's): on a phone the Break pill also shows the Log view. **Left for the joining
  agent or the maintainer:** a queued command's end is told from state names in `log/CommandLine.tsx` (`DROPPED`): run.ts's
  `runCommand().done` should resolve for a queued run (run.ts or the machine); a run that rewrites an open file leaves
  the editor's text stale, and a later Save overwrites the run's file (the maintainer's question; files.ts `afterRun`);
  whether a command-line command should clear the file's error mark (it does); whether a paste of one line and a line
  break should run at once (it does); the dead `.cmdline .placeholder` rules and the phone toast's offset on views
  without the command line; a two-word `help` topic in a hint's link (unverified); `@lezer/highlight` to declare in
  `package.json`; `.md` and `.json` open plain, against SPEC 3.11; `files.spec.ts` no longer tests "Save fails, the
  tab stays" in the close-tab dialog (4a); the phone ⋯'s Save (App.tsx) is not off on a .dta tab. **Done when 4b and 4d
  were joined:** the queued command's end (run.ts `done` settles; the machine's `drop-run`); a run that rewrites an open
  file (a clean tab reloads; an edited one stays unsaved with the banner `run-changed`; a file the run deleted keeps its
  tab, still open); the error mark (the file's last run's: a command leaves it, `editor/errormark.ts`); one line pasted
  with its line break is an ordinary paste (a paste of several lines runs them in turn, as before); the dead rules;
  `@lezer/highlight`; `.md` and `.json` highlighted; the close-tab test's failed Save; the phone ⋯'s Save. **Still
  open:** the phone toast's offset on views without the command line; a two-word `help` topic in a hint's link
  (unverified); the build's main chunk is now over Vite's 500 kB warning (525 KB, 173 KB gzip). **Future work:** a
  multi-line command line (Shift+Enter starting a new line, so a block or a `///` command can be typed or pasted and run
  as one) is not built; today such a paste is stopped with a toast that points to the editor, and the engine's
  unclosed-block hint still names OpenDTA's Command window and Shift+Enter (ODT-33, left as is).
- **Step 4d:** a failed "Download all" shows the banner `download-failed` above the editor ("Your files couldn't be
  downloaded: …" / "Try again", "Dismiss"), built in step 3 in `states/banners.tsx`; `files.js` adds it (one at a time)
  and removes it when a later download works. Restyle or reword it with the other storage states if needed (OQ-16).
  It sits above the editor on desktop; on a phone every view draws it (`banners.tsx`, `phone: "every"`), so it is seen
  whichever view "Download all" was started from.
- **Step 5:** the other-tab dialog's "Close editor" goes to `LANDING_URL` (`web/src/app/env.ts`, `landing.html`), a dead
  link until the landing page exists: check the button once it does (and that the e2e tab-lock test's request still
  matches the page's path).
- **Step 4c:**
  - Dark plots: colors the user names (`mcolor(black)`, `lcolor(navy)`) nearly vanish on the dark card. Decided
    (2026-11-11): accepted as it is; a graph is drawn in the run's theme whatever colors its command names. A rule that
    drew such a graph light was built and removed the same day: it needed changes to engine code shared with the CLI and
    the MCP server (a wrapper around the interpreter's per-command step, a new result field) for a small gain, and the
    visitor can switch the theme. A page-only version (the page asks for light graphs for a run whose text names a
    color) is possible later if asked for. Known gap: a graph that keeps its own scheme (`scheme(s1mono)`) in the dark
    theme is a light image on a dark card.
  - Three graphs from one loop share one label and alt text (`graph_commands` is the unexpanded command). Add the graph
    number to the alt text.
  - `browse` returns string cells whole (a strL can be thousands of characters with newlines). Cut long cells in the grid.
- **Step 6:** one Playwright test of a streamed run in a real browser (step 1 checked streaming in Node `worker_threads` only).
  From the second review of step 3: check Tab out of the open ⋯ menu at phone width too (`e2e/shell.spec.ts` checks it on
  desktop only). New specs import `test` from `e2e/fixtures.ts` (storage kept, no storage banner unless turned off).
