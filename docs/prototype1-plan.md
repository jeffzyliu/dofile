# Prototype 1 of the web demo: build plan and status

The working plan for steps 6 to 8 of [phase2-plan.md](phase2-plan.md): the editor page, the landing page and the sample
project, built to the design in `docs/design/`. This file is the one place for the step table and its status. Update the
Status column and the "Where things stand" section at the end of every session.

To pick up after a break: read this file, then `docs/design/SPEC.md` (the build spec), then run `git status` and
`git log --oneline -5`.

## Where things stand (2026-11-12)

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
    prompt, as "Try again" does. **Held Enter:** the guard was checked with a synthesized repeated keydown in Chromium,
    Firefox and WebKit, and (2026-11-13) by the maintainer on real keyboards: "good on all browsers". **Not verified:** a held Enter on a banner button that hands the focus to the editor
    ("Try again", "Run the file again"), where the repeats may type newlines into CodeMirror (older than this change); nothing
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
  hand), 6 (zoom on the editor page) waited on the keyboard experiment, which is now done (#27) and leaves it to the maintainer (the experiment ran with zoom off; turning it back on needs another iPhone check, `docs/icebox.md`, "Phone"), and 7 to 22 have no answer yet. Nothing they
  would release is started: `cls`, the later UI work, the
  document pass and step 6's scope.
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
  - Waiting on the maintainer: decisions 7 to 22; the iPhone sitting (the phone command line, the wake
    lock with the phone locked 30 s; the keyboard experiment is done, #27); the deployed site's address for the first-deploy checks; the
    draft words of SPEC section 8; how they saw Home open `analysis.do` (see "Later UI work", 8).
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
  2. Step 5 (pull request #18, over step 4), then step 6 for each merged part and the review in 6r.
- **To try on a real iPhone** (none of this can be tested here; the e2e iPhone profile is an emulation with no real
  keyboard, toolbars or touch scrolling): the page does not scroll or bounce; with the keyboard open the command line sits
  right above it and the tab bar is hidden; a toast sits above the command line and the tab bar, and above the keyboard
  while it is open. An Android phone (Chrome, Firefox) should behave the same now.
- **Open from step 3.5** (listed in `web-engine-data-flow.md`, Part 3): a Break pressed between sending a run and the worker
  starting it is lost and ends as a 9998 reset; when another page upgrades the database, the new worker mounts with a store
  error and an empty `/work`; if only the worker fails to open the store, an upload shows in the file list but `use` on it gives
  rc 601 with no banner; a closed database keeps today's restart (the maintainer's ruling, 2026-11-11). (The failed states'
  banners, also listed there, are built by step 4d.)
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

## Step 4: decisions and open questions

The maintainer's list for step 4 (pull request #17), in one place: each item is stated here, as the code behaves, and
SPEC section 8 points here. The words drafted for the visitor are not repeated here: they are SPEC section 8's lists
("Words the spec does not give" for 4a and 4b, "Step 4c: draft words", "Step 4d: draft words").

**A. Decided by the maintainer** (2026-11-11)
1. Text pasted into the command line with line breaks runs each line in turn, the next once the one before has ended.
   Trailing line breaks are stripped first, so one copied line with its break is an ordinary paste (`log/paste.ts`).
2. A run that rewrites an open file: a tab with no unsaved edits shows the run's version; a tab with unsaved edits keeps
   them, stays unsaved and gets the banner `run-changed` ("Reload from the run", "Dismiss"), the fallback in place of a
   question dialog (SPEC section 8, "As built in step 4b").
3. `.md` and `.json` are highlighted with CodeMirror's packages (`@codemirror/lang-markdown`'s `markdownLanguage` alone,
   `@codemirror/lang-json`).
4. What becomes of a queued command is decided by the state machine: a step that lets go of the queued run without
   sending it ends with the effect `drop-run`, which settles the command's `done` with null (`engine/machine.ts`).
   (2026-11-12: the held run is gone, see Post-merge review: there is no queued command and no `drop-run`. With no
   engine the command line is disabled and the page offers "Start engine"; a command opens no prompt.)
5. The engine's hint for an unclosed block still names OpenDTA's Command window and Shift+Enter: left as is (ODT-33). A
   multi-line command line (Shift+Enter starts a new line, so a block or a `///` command can be typed or pasted and run
   as one) is future work; today such a paste stops with a toast that points to the editor.
6. Save keeps a file's line break, `\r\n` or `\n`, noted when the file is read (`editor/ranover.ts` `formOf`). A new or
   empty file is written with `\n` on every OS.
7. Save keeps a UTF-8 byte order mark, except in a `.do` or `.ado` file (case ignored), which is written without it: the
   engine reads a BOM as part of the first command (ODT-34; `editor/ranover.ts` `dropsBom`).
8. Keyboard shortcuts work at every width. The phone layout shows no key chip and no key hint (SPEC section 1, Glyphs).
9. The status bar says "Not affiliated with StataCorp" on the desktop from 1200 px (SPEC 3.6).
10. The log's head keeps "Stata 14 syntax" ("dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax"): a descriptive use of
    the name.
11. From the joining of 4a and 4c: on a phone the Files pane's head is hidden and the file actions are in the top bar's ⋯
    on the Files view (UI fix round, 2026-11-12: by the maintainer's decision they are now in the phone strip's "Files ⋯" button, and the Log view's actions in "Log ⋯"); the unfolded file list (700 to 1199 px) gives the focus to the tree's row; a drop of files
    anywhere on the page uploads them; a toast confirms, or reports an error that needs no action, and anything the
    visitor must act on or choose between is a banner or a dialog (SPEC 3.10); a graph is drawn in the run's theme
    whatever colors its command names, so a dark plot with a user-named color is accepted as it is (Step 4c, below).
12. (2026-11-11) A Ctrl/Cmd+Enter in the editor that the engine does not take (a run on, the engine starting, no engine
    that can run in this tab), where the Run buttons are disabled, says why in a short toast by the engine's state
    (`editor/words.ts` `refusedRunWords`; the words are drafts in SPEC section 8); nothing where it runs or opens the
    prompt. A held Ctrl/Cmd+Enter runs once.

**B. Made during review, waiting for the maintainer's confirmation**
Reviewed after the merge: see Post-merge review.
1. The error mark belongs to the file's last run: set when a run of that file (whole or a selection) ends with an error
   on a line (not Break's rc 1); cleared by a new run of that file, a reset or a restart of the engine, or deleting the
   marked line; a command from the command line and a run of another file leave it; a file closed with its mark and no
   unsaved edits has it again when it is opened with the same text (`editor/errormark.ts`).
   **Resolved (2026-11-13, #40): confirmed, and changed.** The maintainer: "this should be cleared in those situations, it is
   ephemeral." The mark lives in the tab's editor state: it goes when the tab closes (a file opened again has none) and stays
   with a renamed tab; the extra `closedMarks` map is gone.
2. On a phone, a tap on the Break pill also shows the Log view, where Break's countdown and its outcome are
   (`editor/RunControls.tsx`).
   **Resolved (2026-11-13): confirmed** (the maintainer: "ok").
3. Pasted lines stop at the first line that is refused, that was queued and then dropped, that ends with any rc but 0
   (Break's rc 1 too), or whose run is cut because another tab took the engine; and before a line that opens a block
   (`{` at its end, a lone `program define` or `mata`), opens a `/*` comment it does not close, or holds `///` (not sent).
   A toast says how many lines were not run, and a refused line goes back into the field (`log/paste.ts`). (UI fix round, 2026-11-12: that toast is now an error toast, with the warning icon.) (2026-11-12, with the queued run's removal: no line is queued or dropped any more, so that stop is gone; with no engine a paste is an ordinary paste into the disabled field, and no line runs.)
   **Resolved (2026-11-13, #40): "fine for now"** (the maintainer). A multi-line command line is in `docs/icebox.md`.
4. Load on a phone's .dta tab shows only its toast ("Loaded wages.dta"); the Log view does not open.
   **Resolved (2026-11-13): confirmed** (the maintainer: "ok").
5. Reset asks whenever a run is in progress. Otherwise it resets at once while the engine is ready with no data in
   memory and no e() or r() scalar, macro or matrix; after a run it first describes the memory again, and asks when
   that fails (`states/words.ts` `resetDecision`).
   **Resolved (2026-11-13, #40), settled with C 1:** Reset asks unless the engine is `ready` and nothing has run on it since it started; it no longer describes the memory again (`states/words.ts` `resetAsks`).
6. With a .dta tab active, a focus hand-off (a banner with the focus that goes; a dialog whose opener has left the page)
   goes to that tab in "Open files", else to its Load button (`editor/Editor.tsx` `focus`).
   **Resolved (2026-11-13): confirmed** (the maintainer: "ok").
7. A run that writes something that is not text (binary, not UTF-8) over an open text tab keeps the tab's text, edits or
   not, marks it unsaved and shows the `run-changed` banner in other words, with no "Reload from the run".
8. On a phone the Results view's "↵ Copy" hint is hidden, the word Copy with it (a tap copies, and the toast says so).
   **Resolved (2026-11-13): confirmed** (the maintainer: "ok").
9. A file with both kinds of line break is saved with the more common one (`\n` on a tie); a file whose breaks are lone
   `\r` is saved with `\n` (`editor/ranover.ts` `lineBreakOf`).
   **Resolved (2026-11-13, #40): confirmed as it is** (it matches VS Code: the file's most common line break).

**C. Open questions**
Reviewed after the merge: see Post-merge review.
1. Reset does not ask when only globals, Stata scalars or graphs are held: only data and e() or r() results count (S 14
   read literally), though the dialog says Reset clears macros and graphs.
   **Fixed (2026-11-13, #40), with B 5:** Reset asks whenever anything has run on the engine since it started.
2. The running banner shows on every run, though S 11's caption says "with the first run".
3. "Run the file again" (the reset banner) runs the active text tab, not the file whose run the reset cut, and it is
   offered after a Reset the visitor asked for too.
   **Fixed (2026-11-13, #40):** the button runs the file whose run the reset cut, and is drawn only after a Break or a crash
   that cut a file run (not after a Reset the visitor asked for); it is enabled while the engine is ready and that file is
   open as a text tab.
4. The Break grace of 5 s is written twice: the machine's `graceMs` and 4d's `GRACE_S` (`states/words.ts`), which the
   banners' words count from. (Done: `BREAK_GRACE_MS` in `engine/types.ts` is the one place; `app/engine.ts` defaults `graceMs`
   to it and `GRACE_S` is derived from it; the machine still takes the grace through `env`.)
5. A failed start is announced twice to a screen reader: the live region's "The engine didn't start" and the failed
   banner, which has `role="alert"`.
   **Fixed (2026-11-13, #40):** the failed banners are not `role="alert"`; the live region says it once.
6. "Browsers that work" (`landing.html#browsers`) and the other-tab dialog's "Close editor" (`landing.html`) are dead
   links until step 5 builds the landing page; check them then, and that the e2e tab-lock test's request still matches
   the page's path. (Step 5: they go to `/#browsers` and `/`, checked by `e2e/landing.spec.ts` and the tab-lock test.)
7. A file a run deleted keeps its tab: it leaves the file list, the tab keeps its unsaved dot as it was, and Save writes
   the file again.
   **Decided (2026-11-13, #40): kept, as other editors do.** A "(deleted)" mark on such a tab is in `docs/icebox.md`.
8. Ctrl/Cmd+S with a dialog open saves the active tab behind the dialog. (Done: with a dialog open it only keeps the browser's
   Save page away and saves nothing; `editor/Editor.tsx` `onKey`, one e2e case in `editor.spec.ts`.)
9. The editor has no find of its own (no Ctrl/Cmd+F binding); Find searches the log only.
   **Iceboxed (2026-11-13)** with a fix to build later (`docs/icebox.md`, "Command line, log and files").
10. On a phone the toast sits above the command line and the tab bar on every view, so on the views with no command line
    (Files, Editor, Data, Results) it is a command line's height higher than it needs to be. (UI fix round, 2026-11-12:
    fixed; on a phone the toast is lower on the views with no command line.)
11. In `#delimit ;` mode two commands on one line are echoed as the whole line twice, and the second echo can be matched
    to a later identical line, which puts a graph's link in the wrong place.
    **Moved to `docs/icebox.md` (2026-11-13, #40).**
12. The memory banner is built (`states/banners.tsx` `MemoryBanner`), but nothing adds it (OQ-8: no limit is measured). (2026-11-12: dropped from SPEC's words; the unused `MemoryBanner` code is to be removed in the post-merge review.) The code is removed: `MemoryBanner`, its registry entry, `{ b: "memory" }`, `memoryHead` and their tests; the `memory` signal stays.)
13. On a real iPhone: that the on-screen keyboard opens again when a dialog gives the focus back to the command line (the
    focus now comes back in a timer); the iPhone checks of step 3 ("To try on a real iPhone", above); and step 3.5's
    open items (`web-engine-data-flow.md`, Part 3).
14. A clash over an open file with unsaved edits is asked again after "Do the same" with Replace (not after Esc, nor after
    "Do the same" with Keep mine).
15. A drag that began in the page (a graph image, which Chromium and WebKit list as carrying a file) is not taken as an
    upload: a guard kept on partial evidence.
16. While a dialog is open, or another tab has the files, a drag of files over the page gives the Files pane no outline
    and the drop uploads nothing, with nothing that says why.
17. The forced-colors rules of 4a, 4b and 4c (and the shell's fold button) are in `@media (forced-colors: active)` blocks
    inside each part's block of `app.css`, not in the block at the end of `ui.css` that SPEC section 1 names.
18. "Restore the sample" is not in the Files head menu until step 5's sample exists (OQ-13 puts it above "Delete all
    files…"). (Step 5: it is there, above "Delete all files…".)
19. A graph that keeps its own scheme (`scheme(s1mono)`) in the dark theme is a light image on a dark card. (2026-11-12: the card's image has a thin border from the tokens in the dark theme, so it looks intended; `app.css`.)
20. The build's main JavaScript chunk is over Vite's 500 kB warning (about 525 kB raw, 173 kB gzip).
21. A two-word `help` topic in a hint's link is unverified.
22. From step 3: at 700 to about 855 px with a 20 px default font size the toolbar scrolls sideways instead of fitting
    (its compact form starts below 56em).

## Step 5: decisions and open questions

The list for step 5 (pull request #18), in the same form: each item as the code behaves. What was built, the addresses and
the words drafted for the visitor are in SPEC section 8, "As built in step 5".

**A. Decided by the maintainer** (2026-11-11)
1. The landing page is the site's root, `/`; the commands page is `/commands/`; the editor is a single-page app under
   `/app/` (`/app/?test` and the other flags as before).
2. The editor's location is one setting, `web/scripts/urls.ts` (`EDITOR_BASE`, with `EDITOR_URL` and `SITE_URL` for links
   across origins), so that it can move to its own subdomain later. Another path on the same origin is a change of that
   setting alone; the subdomain is two builds into two folders plus the hand edits SPEC section 8, "URLs", lists.
3. The landing and commands pages load none of the editor's code: static HTML with their own two small scripts and
   stylesheet (`src/site/`, which imports only `src/site/` and the stylesheets; nothing of the editor's imports it), complete
   with scripts off.
4. `sysuse` is left as the engine has it: it loads OpenDTA's three synthetic datasets (`cohort`, `diet`, `growth`), and
   the names of Stata's example datasets give rc 601 with a note (the clean-room record, below).

**B. Made during the step, waiting for the maintainer's confirmation**
Reviewed after the merge: see Post-merge review.
1. The commands page is `/commands/` (`dist/commands/index.html`), not `/commands.html`: a folder's index is served at
   the same address with no redirect by the dev server, `vite preview` and Cloudflare's `auto-trailing-slash`, and
   `/commands.html` redirects to it.
   **Resolved (2026-11-13): confirmed** (the maintainer: "ok").
2. The first visit's sample brings no storage banner (S 19) for its own writes (of the sample's three paths); a change of
   the visitor's made while it is written, and the first one afterwards (a Save, an upload, a run that writes a file), do
   (`app/files.ts`, from the store's change row).
   **Resolved (2026-11-13): confirmed** (the maintainer: "b2 is okay, do not bring the banner on the initial sample write").
3. The first-visit sample is off under `?test` unless the URL also has `?sample`, so the e2e tests start from an empty
   store.
   **Resolved (2026-11-13): kept as it is** (the maintainer: "change it if it helps, not important at all. current situation
   probably fine"; no change helps).
4. "Restore the sample" (the Files head menu): files that are only missing are written with no question and the toast
   "Sample restored"; when all three are there unchanged, the toast "The sample is already here"; when one differs from the
   sample or is open with unsaved edits, the dialog `restore-sample` names those files first, and Replace writes the missing,
   differing and unsaved ones, reloads their open tabs with the sample's text and opens `analysis.do`. Other files are never
   touched.
   **To change (2026-11-13), not built.** The maintainer: "my idea is to reuse the workflow and code for uploads to resolve
   conflicts. in essence, restoring the sample should act as an upload of the sample + switching tab to analysis.do if it
   exists." Not built: it waits for the focus work, which changes `files/dialogs.tsx`.
5. "Browsers that work" says only what the tests and the docs support: the automatic tests run the page in Chromium,
   Firefox and WebKit, no browser was also tried by hand on a computer, one iPhone 13 was tried by hand, other iPhones and
   iPads and Android were not tried; Break needs cross-origin isolation, and the files stay in the browser's storage. (2026-11-12: the maintainer replaced the section's text: computers tested automatically in Chromium, Firefox and WebKit; an iPhone 13 checked by hand in Safari, older iPhones and iPads with less memory may not start; Android not tested; the files stored in this browser only; on some networks Break resets the engine. It no longer says an iPhone-sized WebKit window is run or that Break needs isolation.)
6. `/landing.html` is a 404, not a redirect: it was never deployed (step 5 is the first to build it).
   **Resolved (2026-11-13): confirmed** (the maintainer: "yes, 404 is correct").

**C. Open questions**
Reviewed after the merge: see Post-merge review.
1. The first real deploy: the list in SPEC section 8, "To look at on the first real deploy" (the edge's redirects, 404s and
   headers on 304s; a tab of the old build left open across the deploy shows a failed download, not "updated").
2. OpenDTA's `growth` dataset (`sysuse growth`) resembles Stata's `childweight` in theme only (children measured at several
   ages with a `girl` indicator; other variables, another measure, other values); its generator was read, not run.
   **Resolved (2026-11-13): kept** (the maintainer: "keep growth"). Re-run of the generator matches the vendored data; the
   resemblance is in theme only (a report of 2026-11-13, from public descriptions; Stata's file was not opened).
3. The engine's own text was not audited again for step 5: its error messages and hints, and OpenDTA's help pages (`help`),
   are covered by the vendor's clean-room policy only; the clean-room check covered the site's pages, the sample and the
   editor's words.
   **Iceboxed (2026-11-13)** (`docs/icebox.md`, "Engine text"): the maintainer: "no engine patches that are non critical for
   correctness until phase 2(web editor) is done, icebox".
4. `shell.spec.ts`'s `?snapshot=0` test (the normal boot from the CDN) has failed now and then in Firefox, not in the other
   profiles; not investigated.
5. The design checks (`npm run axe`, `tabwalk`, `contrast`, `fonts`) read the mockups from `file:` URLs, not the built pages;
   on the real landing and commands pages only axe runs (`e2e/landing.spec.ts`, both themes).
6. "Restore the sample" against a Save in progress of the same file (step 4's `saving` set in `editor/Editor.tsx`), read
   from the code, not tested: the store's writes run in the order they began. A Save that began first (Ctrl/Cmd+S behind
   the open dialog, then Replace: that first step can no longer happen, since C 8 makes Ctrl/Cmd+S do nothing with a dialog open) ends first, and the restore's `reload` then shows the sample: the tab is clean and the store
   holds the sample. A Save that begins while the restore's write is in progress ends after the `reload`: the store then holds
   the Save's text while the tab shows the sample with no unsaved dot (the Save sets the saved text to its own, and the dot
   only follows edits). A window of milliseconds; `reload` does not touch `saving`.
   **Moved to `docs/icebox.md` (2026-11-13, #40), with uploads, which also write outside `fileTurn`.**

## Post-merge review (after steps 4 and 5 merge)

By the maintainer's decision (2026-11-11), lists B (waiting for confirmation) and C (open questions) of "Step 4: decisions
and open questions" and "Step 5: decisions and open questions", and the draft words in SPEC section 8, do not block the
merge of steps 4 and 5. They are reviewed after it:

- [ ] Confirm or change each B item.
- [ ] Decide each C item: fix it, move it to `docs/icebox.md`, or drop it.
- [ ] Approve or reword the draft words (SPEC section 8). (2026-11-12: the maintainer went through all five lists; the entries decided are marked in SPEC section 8; the rest stay drafts.)
- [ ] A document pass: non-critical items go to `docs/icebox.md`; the critical ones are surfaced at the top of this plan.
- [ ] Documentation shuffling: one place for open items, and the stale history trimmed from "Where things stand".
- [ ] The first-deploy checklist (SPEC section 8, "To look at on the first real deploy") run against the real deploy.
- [x] Remove the queued run (asked for by the maintainer, 2026-11-12). Done on the branch `claude/remove-queued-run`, merged as #26 on 2026-11-12: no
      state holds a run, `started` always leads to `ready`, `drop-run`, run.ts's `pending` and `dropped` are gone, and with no
      engine nothing offers to run: Run is "Start engine" (the prompt, a new try, or the take-over dialog), the command
      line is disabled, and Load, Import and the help links are off (`docs/web-page-flows.md`, section 2). What follows
      is the request as written on 2026-11-12, before it was done ("today" is the code before this change): Today a Run or a command with no engine (`none`,
      `declined`) is accepted, opens the download prompt and is held until the engine starts; the machine drops it
      (`drop-run`) when the visitor says "Not now", the start fails or another tab takes the engine. The simpler model: with
      no engine, Run only opens the prompt and runs nothing, and the visitor presses Run again when the engine is ready. That
      removes the held run from the machine's table (`web/src/engine/machine.ts`), the `drop-run` effect, `pending` and
      `dropped` in `run.ts`, and the special cases in `log/CommandLine.tsx` and `log/pasterun.ts`
      (`docs/web-page-flows.md`, section 2).

Found in the UI fix round (2026-11-12), still open:
- The "Running…" banner appears and goes for every short run and every pasted line (seen as a flash). The log no longer
  loses its place through it.
- The phone keyboard's jump: settled by three rounds of measurements on an iPhone (iOS 27.0.1;
  `docs/phone-keyboard-experiment.md`). The command line takes a tap's focus itself with `preventScroll` (no pan at
  all); elsewhere Safari's pan is scrolled straight back (one frame, about 3 px seen) and the editor's caret is scrolled
  above the keyboard through CodeMirror. `?kblog` stays, an on-screen list of the viewport's events.
- `overscroll-behavior-x: none` on the editor and the log also stops a trackpad back-swipe that starts over them.

- `e2e/editor.spec.ts` "a rename while Save writes" fails about 1 run in 16 in Firefox on `main`.
  Changed (test code only): its `rename` helper now waits for the renamed row to have the focus before it returns, and the
  F2 steps in `editor.spec.ts` wait for the rename field to have the focus before Ctrl+A. The suspected cause (the tree's
  `focusRow` retrying every 50 ms and taking the focus from the editor, so the typed character is lost) is a suspicion
  until Firefox runs confirm it. (2026-11-13: 24 Firefox runs each before and after the `focusRow` rewrite passed; the flake
  did not reproduce, so the suspicion is neither confirmed nor ruled out.) `shell.spec.ts`'s `?snapshot=0` test (a failure now and then in Firefox, cause unknown)
  now waits until the state is not a starting state, asserts `ready` with the state's `reason` and `detail`, and prints
  the page's console in the failure; no retries.

## Later UI work (the maintainer's ideas, 2026-11-12; not started)

"Remove the queued run" (Post-merge review) came before 1 and 6, since they change the same Run controls; it is merged (#26).

1. Run only from a `.do` or `.ado` file (today any text file runs). Overlaps the refused-run toast (step 4 A 12) and C 3.
2. Live syntax checking of the active editor buffer, with underlines, and a run refused on a syntax error; the same for the
   command line. It would replace the paste heuristics `opensComment` and `opensBlock` (step 4 B 3, C 11) and bears on A 5's
   multi-line command line. A misspelled command name can come from `src/stata/commands.json`; argument checks need the
   engine's parser.
3. Reorder the editor's tabs by dragging.
4. Move files: a "Move…" with a typed path first, drag in the file tree later.
5. Rename from a right click on an editor tab.
6. Hold back the presentation of very quick operations (about 100 ms), so buttons, the status bar and the running banner do
   not flash; the internal state is unchanged. Subtle transitions later. Overlaps step 4 C 2 and the flash noted above.
7. `cls` typed at the command line clears the log (Stata's command for it; the engine has none). `clear` keeps its meaning
   of dropping the data.
8. Remember the open tabs across reloads. Today a tab without the engine's lock neither reads nor writes to storage (the
   Web Lock lets one tab own the engine; a second tab is blocked entirely and writes nothing), so the open tabs would have
   to be kept by the tab that holds the lock. Open question for the maintainer: how they saw Home open `analysis.do`; the
   code opens it on a first visit only (the sample's load), so the source of that sighting is unknown.
9. A run whose first command is `clear all` restarts the engine first, which frees its WebAssembly memory (it never shrinks
   otherwise; the status bar's "Engine memory" only grows until a restart). First step: measure how long a restart from the
   cached snapshot takes; build it only if that is under about 2 s. `clear all` anywhere else in a run clears as today.
   (2026-11-13.)

How this relates to steps 6, 6r and 7. **Step 6** (e2e per user flow; `axe`, `tabwalk`, `contrast` on the real pages) is
partly done inside steps 3 to 5: the e2e suite has 105 tests in four browser profiles (420 cases, 389 run, 31 skipped:
`docs/test-map.md`), and `e2e/landing.spec.ts` runs axe on the built landing and commands pages. Left for it: the design-check
scripts (`npm run axe`, `tabwalk`, `contrast`, `fonts`) read the mockups from `file:` URLs and do not yet run on the built
pages; the four tests in `e2e/poc.spec.ts` are still fixme; and the accessibility items in `docs/icebox.md` belong with that
work. **Step 6r** (a review of each merge by a fresh context) has in effect been done before the merge for steps 4 and 5:
fresh-context reviewers went over each part, the join and the move, and their findings were fixed or listed in B and C. A
`/code-review` of the merged whole is still open if the maintainer wants it. **Step 7** (the Phase 2 verification list, the
real-phone pass, the Safari storage re-check) takes the real-phone items of the C lists (step 4's C 13).

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
| 4a | File tree, editor tabs, upload and name clash, row menus | general-purpose, worktree | Opus, medium | after 3, with 4c | to review (built on `prototype1-step4`, pull request #17) |
| 4b | Editor, Run, Break, log, run-head, status bar | general-purpose, worktree | Opus, medium | after 4a and 4c, with 4d | to review (built on `prototype1-step4`, pull request #17) |
| 4c | Graph, Data and Browse, Results and the matrix view | general-purpose, worktree | Sonnet, medium | with 4a | to review (built on `prototype1-step4`, pull request #17) |
| 4d | Dialogs and states: download prompt, failures, reset, toast; drafts the missing words (OQ-10, OQ-16, OQ-18) for the maintainer to approve before merge | general-purpose, worktree | Sonnet, medium | with 4b | to review (built on `prototype1-step4`, pull request #17; the draft words in SPEC section 8, "Step 4d: draft words"; the review decisions and open questions in "Step 4: decisions and open questions" above) |
| 5 | Landing page, commands page, the sample project on synthetic data, clean-room check of all text | general-purpose, worktree | Sonnet, medium | parallel with 4 | to review (branch `prototype1-step5`, draft pull request #18 over step 4; reviewed once, its findings fixed; the landing page moved to `/` and the editor to `/app/`; open for the maintainer: the words listed in SPEC section 8 "As built in step 5", the first deploy's checks in SPEC 8 "URLs") |
| 6 | e2e per user flow; `axe`, `tabwalk`, `contrast` on the real pages | general-purpose | Sonnet, medium | after each of 3 to 5 | partly done in steps 3 to 5 (105 e2e tests, axe on the built landing and commands pages); the rest after the merge: "Post-merge review" |
| 6r | Review of each merge (`/code-review`) | fresh context | Opus, high (Fable for step 2) | per merge | done before the merge for steps 4 and 5 (fresh-context reviews of each part, the join and the move); a `/code-review` of the merged whole open if wanted |
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
- **Step 6 (the "full-web-code audit", the maintainer's name for it, 2026-11-13):** look out for these, in the maintainer's
  words.
  - Preact lifecycle and raw DOM: "overly manual breaking of Preact lifecycle to achieve specific things on the DOM. rely on
    render cycle as much as possible" and "we should avoid raw dom operations wherever possible". Look for `querySelector`
    or `getElementById` reaching into rendered components, `setTimeout` or polling that waits for a render, and focus or
    scroll moved from outside the component that owns the element.
  - Code comments' scope and conciseness: "we have way too many top-of-file code comments that keep getting changed due to
    unrelated file changes. that should not be happening. need to review for code comment scope and conciseness, and leave
    heavy multi-module documentation in text files. link to relevant documentation files from code comments instead of
    explaining everything bespoke". A comment says what its code does and why, and points to the doc for the rest.
  - Spaghetti patterns: "small changes in app statefulness and order of asynchronous concurrent operations". Look for booleans
    that patch an ordering, timers standing in for an event, and state duplicated across modules; the known case is uploads
    and "Restore the sample" writing outside `fileTurn` (`docs/icebox.md`).
  - Focus consolidation: about 38 `.focus()` calls in 18 files. `useRovingFocus` (so far inside `files/FilesPane.tsx`) now serves the file tree row;
    Tablist, EditorTabs, the Results and Data tabs could use it, two hooks (focus on mount, return focus) would serve the
    banners and dialogs, and eight cross-component focus moves want a focus request owned by the target component. The
    maintainer asked for the hooks to live in one focus-hooks file.
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
  - Rebuild the snapshot after merging step 1 (`npm run snapshot`). Run `npm test`: the three tests in `files.test.ts` (then `files.test.mjs`) that need
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
  - Not fixed in step 3: the toolbar at 700 to about 855 px with a 20 px default font size ("Step 4: decisions and open
    questions", C 22).
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
  tab. Decided at the review (from step 4d's), for the maintainer to confirm (list B): on a phone the Break pill also shows the Log view. **Left for the joining
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
  tab, still open); the error mark (the file's last run's: a command leaves it, `editor/errormark.ts`; for the maintainer
  to confirm, list B); one line pasted
  with its line break is an ordinary paste (a paste of several lines runs them in turn, as before); the dead rules;
  `@lezer/highlight`; `.md` and `.json` highlighted; the close-tab test's failed Save; the phone ⋯'s Save. **Still
  open, and the future work** (a multi-line command line, ODT-33): "Step 4: decisions and open questions", A 5 and C.
- **Step 4d:** a failed "Download all" shows the banner `download-failed` above the editor ("Your files couldn't be
  downloaded. This browser wouldn't open the storage where dofile keeps them, so the .zip couldn't be made. Try again;
  if it fails again, reload the page." / "Try again", "Dismiss"; reworded by 4d, a draft in SPEC section 8), built in
  step 3 in `states/banners.tsx`; `files.ts` (then `files.js`) adds it (one at a time) and removes it when a later
  download works.
  It sits above the editor on desktop; on a phone every view draws it (`banners.tsx`, `phone: "every"`), so it is seen
  whichever view "Download all" was started from.
- **Step 5 (done, to review):** the other-tab dialog's "Close editor" and the banner's "Browsers that work" go to
  the landing page, `/` and `/#browsers` (`/landing.html` until the editor moved to `/app/`); the e2e tab-lock test (`step2.spec.ts`) checks the request and
  that the landing page's section answers; `e2e/landing.spec.ts` checks both links ("Step 4: decisions and open questions", C 6).
- **Step 4c:**
  - Dark plots: colors the user names (`mcolor(black)`, `lcolor(navy)`) nearly vanish on the dark card. Decided
    (2026-11-11): accepted as it is; a graph is drawn in the run's theme whatever colors its command names. A rule that
    drew such a graph light was built and removed the same day: it needed changes to engine code shared with the CLI and
    the MCP server (a wrapper around the interpreter's per-command step, a new result field) for a small gain, and the
    visitor can switch the theme. A page-only version (the page asks for light graphs for a run whose text names a
    color) is possible later if asked for. Known gap: a kept scheme in the dark theme ("Step 4: decisions and open
    questions", C 19).
  - Three graphs from one loop share one label and alt text (`graph_commands` is the unexpanded command). Done in 4c: the
    alt text adds the graph number when another kept graph has the same command (SPEC section 8, "As built (step 4c)").
  - `browse` returns string cells whole (a strL can be thousands of characters with newlines). Done in 4c: a cell over 60
    characters, or with a line break, is cut to one line in the grid and shows whole when pressed.
- **Step 6:** one Playwright test of a streamed run in a real browser (step 1 checked streaming in Node `worker_threads` only).
  From the second review of step 3: check Tab out of the open ⋯ menu at phone width too (`e2e/shell.spec.ts` checks it on
  desktop only). New specs import `test` from `e2e/fixtures.ts` (storage kept, no storage banner unless turned off).

## Step 5: the clean-room record (2026-11-11)

The "Browsers that work" text was replaced by the maintainer on 2026-11-12 (item 3 below is the older wording). The sample's comments were shortened on 2026-11-12, in our own words, with no text from StataCorp.

The check of every word the site shows a visitor against `LICENSE-POLICY.md`: nothing copied from StataCorp's files, manuals,
help text or example datasets; "Stata" used as the policy allows (the policy's own forms are "runs Stata-syntax code" and
"Stata-compatible"; the registered-trademark line is on the landing and commands pages). Done by the step 5 agent; the
maintainer's review of the doubtful items below is still open.

**What was checked**
1. `web/landing.html` and `web/commands.html`: all text, including the text only a screen reader gets, the page titles and
   descriptions, the "Browsers that work" section, and the output block "What a run looks like" (it is the sample's own run:
   `web/test/sample-run.test.ts` compares it line by line with a run of `analysis.do`).
2. The sample: `web/sample/analysis.do`, `helpers.do` (every comment and string), `make_sample.py`, and `data/wages.dta` (its
   variable names, labels and values).
3. The editor page: every label, menu item, banner, dialog, toast, note and status word in `web/src/app/**` (the views, and the
   words in `states/words.ts`, `editor/words.ts`, `log/classify.ts`, `files/*.ts`), and the draft words of SPEC section 8
   ("Step 4d: draft words" and the 4a and 4c lists), and the words step 5 added (the restore dialog, its toasts).
4. The command names on the commands page.

**How**
- Read each string against the policy's two tests: is it text from a manual, help page or example (then it must not be there),
  or is it our own sentence describing what this page does (then it is fine)? This was done in full for the landing and
  commands pages and the sample, and for `states/words.ts` and the dialogs, banners, menus and toasts that SPEC sections 3.10
  and 8 list. For the rest of the editor page (the CodeMirror, log, output and file views) it was done through the searches
  below and the SPEC's lists, not by reading every source file line by line: a reviewer who wants that should read the string
  literals of `web/src/app/**/*.tsx`. What was read names a control of dofile's own page or says what dofile did; none
  describes how a Stata command works, so none can be a paraphrase of a manual. The only strings about Stata's behavior are
  the two notes of `states/words.ts` (a `restore` with nothing preserved; a community command): each is one sentence of our own
  about what dofile does.
- Searched `web/src`, `web/*.html` and `web/sample` for `sysuse`, `webuse`, `auto.dta`, `nlsw`, `census`, `lifeexp`, `citytemp`,
  `manual`, `sthlp`, `.ado`, `stata.com` and every use of "Stata": the only hits are the product-name uses listed under "Doubtful"
  and code comments. `test/site.test.ts` repeats them over the landing and commands pages' sources and the sample's three
  files (the example datasets' names, `sysuse`, `webuse`, `manual`, `.sthlp`, `.ado`, `stata.com`), and `e2e/commands.spec.ts`
  over the built commands page, so a later edit that brings one in fails a test.
- The data: `make_sample.py` draws every value from numpy's seeded generator (`default_rng(2026)`) and writes the file with
  dofile's own engine, with a fixed time in the .dta header (the engine's `save` stamps the time; until the review of step 5
  that made every run's bytes differ, so `--check` always failed). The script is committed beside its output, and
  `tests/test_sample_data.py` (in `poe test`, so in CI) checks that it makes the committed file byte for byte. The draws repeat
  only while numpy is the version `uv.lock` pins (numpy does not promise the same stream across versions, NEP 19): an upgrade
  that changes them fails that test, and then the script and `npm run sample` are run again. Variables are `id age educ female
  region wage`, regions are North, East, South and West, `id` is a counter: no person's name, no real record, nothing taken from
  a Stata or other dataset. The names are common words, not a copy of any example dataset's variable list.
- The sample's do-files use ordinary commands in our own comments (`use`, `describe`, `summarize`, `tabulate`, `tabstat`,
  `regress`, `foreach`, `program`, `scatter`); they were written for this page and run as written (rc 0, in the page's engine).
- The command names are facts about the language and are read from the engine's registry, not typed in.

**Result: nothing found that is copied from StataCorp's material.**

**Doubtful, for the maintainer**
1. **"Stata 14 syntax" in the log's head** (`log/LogView.tsx`, from `ABOUT.stata_version`) and "Stata 14" on the commands page
   ("checked against results recorded from Stata 14 for a set of test programs"). It names the product to say which behavior the
   engine follows, which is a statement of fact, but the policy's own forms are "Stata-syntax" and "Stata-compatible", so a version
   number is a small step beyond them. `LICENSE-POLICY.md` forbids "Stata" in a product name and does not require the "not
   affiliated" line on every page; the landing and commands pages carry it in their footer, and since step 4 the editor's
   status bar does from 1200 px ("Not affiliated with StataCorp", with the policy's whole sentence for screen readers, SPEC
   3.6). The phone layout of the editor has no status bar, so no line there.
2. **Text the engine prints is not the page's text and was not re-audited here:** the error messages and output layouts of the
   engine (behavior it reproduces), `help <topic>` (the page suggests "Try: help regress"; the engine reads OpenDTA's own
   173 `help/*.sthlp` pages, written by OpenDTA under its own clean-room policy; the extension is the format's, but a reader
   may take them for StataCorp's files), and `sysuse`, which loads OpenDTA's own synthetic datasets (below). They are covered
   by `CLEAN_ROOM_POLICY.md` of OpenDTA, the vendor's; `sysuse` and `help` are in the commands page's list like any command.
3. **"Browsers that work" says only what the repository supports** (reworded in the review of step 5, drafts): the desktop
   line names the three engines the automatic tests run (Chromium, Firefox, WebKit) and says the branded browsers were not each
   tried by hand; the iPhone line names the one iPhone 13 tried by hand (`docs/pyodide-snapshot.md`, 2026-11-08) and says
   other iPhones and iPads were not; Android "Not tried yet". The memory figure was dropped: its source, the 1.25 GB peak in
   the same file, is of a Node process with Node's own overhead, not of a browser.
4. **The commands page lists the `shell` and `webuse` names marked "off in the browser"** (read from `browser.py`'s `DENIED`),
   which is true of the page; the CLI and MCP server turn off a longer list. Not a clean-room matter.
5. The mockups and flows under `docs/design/` (not shipped to visitors) hold a Stata-style `regress` table in the landing
   mockup; its numbers were from dofile's own run of a synthetic file, and the page now shows the real sample's run instead.

**`sysuse` and OpenDTA's datasets (checked in the review of step 5)**
- What the engine does (`_vendor/opendta/commands/datasets.py`, unchanged): `sysuse <name>` loads `<name>.dta` from
  `_vendor/opendta/data/` or the adopath; `sysuse dir` lists them. OpenDTA ships three: `cohort` (300 rows: `id exposed agegrp
  time died`), `diet` (400 rows: `id sex age region upf fruitveg bmi obese strata psu weight`) and `growth` (300 rows, 50
  children by 6 years: `id age girl height`), each labelled "(synthetic, OpenDTA)". The names of Stata's example datasets
  (`auto`, `nlsw88`, `census`, `lifeexp`, `cancer`, `citytemp`, ... in its `STATA_EXAMPLES`) give rc 601 with a note that they
  are not included and that `webuse` downloads them; `webuse` is off in the page and in the CLI and MCP sandbox. The page's
  own sample is our data, not one of these.
- Where the three come from: OpenDTA's `tools/make_datasets.py` at the pinned commit (0c3f3a2; read on GitHub, not vendored,
  not run here) builds them with `np.random.default_rng(2026 + i)` (seeds 2026, 2027, 2028) and says "They are synthetic data
  made by this script with a fixed seed ... no third-party dataset is copied." Its variable lists and row counts are the vendored
  files'. Their values, read here, are on regular grids (whole-year ages 2 to 7, ids 1 to N) as a seeded script makes them; no
  name, variable list or value matches a StataCorp example dataset I know (`growth` has a theme like Stata's `childweight`,
  children measured at several ages with a `girl` indicator, but other variables, another measure and other values).
- How sure: high that they are generated, not copied (a committed generator with seeds, matching structure, labels that say
  so). Not done: running the generator and comparing bytes. `data/icd/` holds the U.S. CMS ICD-9-CM and ICD-10-CM tables
  (public domain, per `datasets.py` and `data/icd/README.md`), for `icd9`/`icd10`, not `sysuse`.
- `docs/design/flows` F2 said "`sysuse` gives rc 601, by design"; it now says that `sysuse auto` does, and what `sysuse` loads.
