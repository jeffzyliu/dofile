# Prototype 1 of the web demo: build plan and status

The working plan for steps 6 to 8 of [phase2-plan.md](phase2-plan.md): the editor page, the landing page and the sample
project, built to the design in `docs/design/`. This file is the one place for the step table and its status. Update the
Status column and the "Where things stand" section at the end of every session.

The decided and done lists, with their item IDs (step 4's and step 5's decisions and open questions, e.g. "step 4 B 3" or
"step 5 C 1"; the post-merge review; the decisions of 2026-11-10; the old notes of steps 1 to 5), are in
[phase2-history.md](phase2-history.md), "Prototype 1: the decided lists of the plan, to 2026-11-14". What is still open is
in "Open, critical", the step lists below, "After step 6: later UI work", `docs/icebox.md` and `docs/test-map.md`.

To pick up after a break: read this file, then `docs/design/SPEC.md` (the build spec), then run `git status` and
`git log --oneline -5`.

## Open, critical

Open items that are a data-loss or wrong-result bug, a security or clean-room issue, or that block step 6, a release or a
deploy. Everything open that is not critical is in `docs/icebox.md` or in the list of the step or section that owns it.
Each item is listed once; the ones below are kept where the maintainer placed them, and this list points to them.

- **The first real deploy's checks** block the first deploy: SPEC section 8, "To look at on the first real deploy" (the
  edge's redirects, 404s and headers on 304s; a tab of the old build left open across the deploy shows a failed download,
  not "updated"). Placed in step 6 (step 5 C 1; "Known work inside the steps", "Step 6 (deployment)"): the domain is bought
  when the audit begins, and the one-origin site is checked before the two origins are split.
- **The two origins are split before the site is announced** (`dofile.dev` and `app.dofile.dev`): the visitors' files live
  per origin, so a later split loses them ("Known work inside the steps", "Step 6 (deployment)").
- **Step 3.5's three engine gaps**, in step 6's audit list: a Break pressed between sending a run and the worker starting it
  is lost and ends as a 9998 reset (the data in memory goes); when another page upgrades the database, the new worker mounts
  with a store error and an empty `/work`; if only the worker fails to open the store, an upload shows in the file list but
  `use` on it gives rc 601 with no banner (`web-engine-data-flow.md`, Part 3).
- **Step 6's audit** as a whole (the full-web-code audit, its three cheap checks, the design checks on the real pages):
  the step 6 row of "Steps" and "Known work inside the steps".

Nothing else open is critical as of 2026-11-13. Unsure about the critical ones: the maintainer decides.

## Where things stand (2026-11-14)

- **Merged:** steps 0 to 5 (step 4 and step 5 by pull requests #17 and #18, with the formatting and linting work in #13),
  the fix rounds after them and the pull requests merged up to #55 (among them #26 "remove the queued run: Start engine",
  #27 and #48 the phone keyboard, #40 the post-merge fixes, #43 Break on one clock, #45 focus hooks, #46 "Restore the sample" as
  an upload, #50 the draft row for New, #53 the failed-twice banner's last sentence, "Your files are safe: you can
  still edit and download them.", #52 "Files in folders", #54 the Results tab's copy and #55 its e2e check; the last three
  merged on 2026-11-14, below). The record of all of it, with the checks at the old tips and the past reviews:
  [phase2-history.md](phase2-history.md), "Prototype 1: the record from 'Where things stand', to 2026-11-13". Each merge
  deploys the page.
- **Merged on 2026-11-14:** #52 "Files in folders" (`files-in-folders`; 11 commits on main, 98b6563 to 2b2f461): a
  folder's menu gets "New file here" and "New folder", a "+" in the Files head and the phone strip makes a file in the folder
  of the row last focused, a new file's or folder's name may be a path (`sub/x.do`; missing folders are made), and Esc in a
  draft gives the focus back to its row; a double-click on a folder leaves it current. The maintainer's decisions for it:
  the "+" target is row-based, no long-press (the ⋯ only, on a phone), folder drafts accept paths. Not tried on a real
  iPhone (the keyboard coming up on the "+", the strip at 320 px; step 7's pass). #54 the Results tab's copy (main fcaa3d3,
  a8bb7d2), decided by the maintainer: the whole row copies; every value is a Tab stop; "✓ Copied" shows in the row for 2 s
  and a toast names it ("Copied e(r2)"); the engine's unchanged preset globals are hidden; the hover and focus tint are CSS;
  the folds stay as they were; no copy hint on a phone ("Confirm: no hint"), which decides and closes step 4 B 8. A matrix
  row's click copies only (toast "Copied e(b)"); View and Hide stay and do not copy. #55 (main cbb35f3): an e2e check that
  the Results act cell keeps 8 px spare around its content.
- **Open now:** no pull request is open on the plan's work.
- **Decided:** review decisions 1 to 5 and 7 to 22 (7 to 16 by #40, #45 and #46 or iceboxed; 17 to 22 in the history's "Post-merge
  review" and "After step 6: later UI work"), and the draft words of SPEC section 8. Decision 6 (zoom on the editor page)
  is left to the maintainer: it needs another iPhone sitting (`docs/icebox.md`, "Phone").
- **Waiting on the maintainer:** the iPhone sitting (the phone command line, the wake lock with the phone locked 30 s;
  step 7's real-phone pass), and how they saw Home open `analysis.do` ("After step 6: later UI work", 8). None of #22 to #25
  and #40 has been tried on a real phone; #48 and #50 were.
- **Next, in this order:** (1) step 6: the full-web-code audit, the design checks on the real pages, the first deploy
  ("Steps", and "Known work inside the steps"); (2) step 7: the verification list and the real-phone pass; (3) "After step
  6: later UI work". Nothing in that section is built before step 6.
- **Known flaky tests**, with their sightings: `docs/test-map.md`, "Known flaky tests". The causes found for WebKit's
  first-navigation hang and the `?snapshot=0` stall are in the history record ([phase2-history.md](phase2-history.md)); the one-retry of a stalled first
  navigation is merged (`web/e2e/fixtures.ts`).
- How the editor page's focus, runs, open files and log links work: [web-page-flows.md](web-page-flows.md). How the engine
  code works, and what is still open in it: [web-engine-data-flow.md](web-engine-data-flow.md) (Part 3). Step 3.5:
  [prototype1-step3.5-plan.md](archive/prototype1-step3.5-plan.md).

## Steps

Status values: `not started`, `running`, `to review`, `done`.

| Step | Work | Agent | Model, effort | Runs | Status |
|---|---|---|---|---|---|
| 0a | `docs/design/SPEC.md`: the build spec, with the worker protocol and state model types | general-purpose | Fable, high | first | done |
| 0b | Doc restructure (`CLAUDE.md` and plan splits), cleanup, `ui.css` into `web/`, the deploy size check | general-purpose | Sonnet, medium | with 0a | done |
| 1 | Engine API with tests (`engine.py`, `browser.py`): a whole-file run with no locals, the dark plot style, locals and globals, the first rows for Browse, memory use, the log streamed during a run (`on_output`; check first that it works in Pyodide), the error line, the command per graph, describing a .dta without loading it, the page's tempfile wording. Spec section 6. No MCP schema change: `mcp_server.py` does not send the new fields | general-purpose, worktree | Opus, medium | parallel with 2 | done |
| 2 | The file store with its `pending` journal, the self-hosted runtime, a build-written list of the start files with their sizes, download with byte counts and abort (resumed per file), Break as wait / reset now, the zip made in the page, the tab lock, `storage.persist()`, relaying the streamed log and the new ops; Node tests (spec section 7) | general-purpose, worktree | Fable, high | parallel with 1 | done |
| 3 | App shell: Preact, the tokens and `ui.css` in the page, layouts (desktop B, phone tabs), the theme toggle, the state store, and the shared primitives that 4a needs (dialog, menu, toast, the live region) | general-purpose, alone | Opus, high | after 1 and 2 | done |
| 3.5 | The engine code made clear and auditable: TypeScript everywhere, one explicit state machine, one build identity (no offline start), the journal as the only channel. Plan: `archive/prototype1-step3.5-plan.md` | general-purpose, one step at a time | Opus, high | after 3, before the merge | done |
| 4a | File tree, editor tabs, upload and name clash, row menus | general-purpose, worktree | Opus, medium | after 3, with 4c | done (merged with `prototype1-step4`, pull request #17) |
| 4b | Editor, Run, Break, log, run-head, status bar | general-purpose, worktree | Opus, medium | after 4a and 4c, with 4d | done (merged with `prototype1-step4`, pull request #17) |
| 4c | Graph, Data and Browse, Results and the matrix view | general-purpose, worktree | Sonnet, medium | with 4a | done (merged with `prototype1-step4`, pull request #17) |
| 4d | Dialogs and states: download prompt, failures, reset, toast; drafts the missing words (OQ-10, OQ-16, OQ-18) for the maintainer to approve before merge | general-purpose, worktree | Sonnet, medium | with 4b | done (merged with `prototype1-step4`, pull request #17; the draft words in SPEC section 8, "Step 4d: draft words"; the review decisions and open questions in "Step 4: decisions and open questions", in `phase2-history.md`) |
| 5 | Landing page, commands page, the sample project on synthetic data, clean-room check of all text | general-purpose, worktree | Sonnet, medium | parallel with 4 | done (merged by pull request #18, branch `prototype1-step5`; reviewed once, its findings fixed; the landing page moved to `/` and the editor to `/app/`; open for the maintainer: the words listed in SPEC section 8 "As built in step 5", the first deploy's checks in SPEC 8 "URLs") |
| 6 | e2e per user flow; `axe`, `tabwalk`, `contrast` on the real pages (step 5 C 5: today they read the mockups); the accessibility items of `docs/icebox.md`, "Accessibility" | general-purpose | Sonnet, medium | after each of 3 to 5 | partly done in steps 3 to 5 (105 e2e tests, axe on the built landing and commands pages); the rest after the merge: "Post-merge review" (in `phase2-history.md`). Width decided 2026-11-13 (decision 22, accepted): the work above plus three cheap audit checks: unused code (knip), the licences of the web dependencies, and stale docs. Security headers and the `?test` gate wait until later. The audit's list also has (2026-11-13): step 3.5's lost Break, upgraded database and worker-only store failure ("Open from step 3.5"), the code splitting of the main chunk (step 4 C 20), the off controls' contrast (#26), and a held Enter on a banner button that gives the focus to the editor (to verify). Also from the review's sections 6 and 7 (2026-11-13, the maintainer: "all recs"): what the tests do not cover (the views are tried only by e2e; `check-pytest` and `check-numeric` run by hand); #37's unchecked items (Cmd+Enter in a `<select>`, the 1 px ring's contrast, the status bar's fit at 1200 px); and the UI round's nice-to-haves 6 (IME `isComposing`), 8 (ring contrast) and 9 (the `.log` focus ring's radius and its off-screen bottom edge); the #26 and #30 review nice-to-haves (their reports were deleted) were dropped, since the audit reads that code |
| 6r | Review of each merge (`/code-review`) | fresh context | Opus, high (Fable for step 2) | per merge | done before the merge for steps 4 and 5 (fresh-context reviews of each part, the join and the move); dropped for the merged whole (2026-11-13): the step 6 full-code audit is that review |
| 7 | The Phase 2 verification list; a real-phone pass; the Safari storage re-check | maintainer | | last | not started; its list is under "Known work inside the steps" below ("Step 7", with the 2026-11-13 additions) |

## After step 6: later UI work (the maintainer's ideas, 2026-11-12; not started)

Decided 2026-11-13: these items come after step 6, as their own section. **Nothing in this section is built before step 6.**
The queued run's removal came before them, since it changed the same Run controls; it is merged (#26). The order among them
is set when this work is scheduled (decision 17, "queued run first", was dropped: the queued run is gone).

1. **Run only from a `.do` or `.ado` file** (today any text file runs). Decision 18, accepted as the review recommends: Run
   is disabled, with a reason; Ctrl/Cmd+Enter shows a toast; Run selection follows the same rule; a file with no extension
   does not run. Overlaps the refused-run toast (step 4 A 12) and C 3.
2. **Syntax checking of the active editor buffer**, with underlines. Decision 19, changed by the maintainer ("i do want to
   reject syntax errors"): stage 1 only, the page's own lexer. A syntax error (an unclosed quote, brace or comment) refuses
   the run. An unknown command is a warning only and the run goes on (the maintainer: "No, warn only"). The same for the
   command line. It would replace the paste heuristics `opensComment` and `opensBlock` (step 4 B 3, C 11) and bears on A 5's
   multi-line command line. A misspelled command name can come from `src/stata/commands.json`; argument checks need the
   engine's parser (not part of stage 1).
3. **Reorder the editor's tabs by dragging.** Decision 21, accepted: no drag by touch.
4. **Move files:** a "Move…" with a typed path first, drag in the file tree later (decision 21: no drag by touch). Move
   refuses a name that exists (no replace).
5. **Rename from a right click on an editor tab.** Decision 21, accepted: a tab's Rename uses the Move dialog.
6. **Hold back the presentation of very quick operations** (about 100 ms), so buttons, the status bar and the running banner
   do not flash; the internal state is unchanged. Subtle transitions later. Overlaps step 4 C 2 and the "Running…" flash
   noted under "Post-merge review" (in `phase2-history.md`). No decision in the review's 17 to 22 touches it.
7. **`cls`** typed at the command line clears the log (Stata's command for it; the engine has none). `clear` keeps its
   meaning of dropping the data. Decision 20, accepted: no confirmation; it clears the graphs too, like Clear log; it works
   during a run; command line only (in a do-file it stays an error, with a hint).
8. **Remember the open tabs across reloads.** Today a tab without the engine's lock neither reads nor writes to storage (the
   Web Lock lets one tab own the engine; a second tab is blocked entirely and writes nothing), so the open tabs would have
   to be kept by the tab that holds the lock. Open question for the maintainer: how they saw Home open `analysis.do`; the
   code opens it on a first visit only (the sample's load), so the source of that sighting is unknown.

(The old item 9, a run starting with `clear all`, moved to the engine-memory follow-ups in `docs/icebox.md`, "Engine memory".)

## How to run a step

- Step 0 must be committed before any worktree step starts: a worktree is made from the last commit, so it would not have
  the spec or the moved files.
- Give each agent: this file, `docs/design/SPEC.md`, the sections of the spec its step owns, and the rule that it does not
  commit unless told to.
- Steps 1 and 2 touch different files (`src/dofile/` and `tests/` against `web/src/engine/` and `web/test/`). The worker
  ops that call step 1's new Python functions are joined after both merge, at the start of step 3.
- Step 3 fixes the state model that the step 4 agents write against. Do not start step 4 before step 3 is merged.
- After each merge: step 6 for that part, then update the Status column here.

## Known work inside the steps (found in the review of 2026-11-10)

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
- **Step 6 (deployment, decided 2026-11-13): the site at `dofile.dev`, the editor at `app.dofile.dev`.** The maintainer asked
  for this layout ("dofile.dev and app.dofile.dev later"). Order: buy the domain and run the first-deploy checks (SPEC
  section 8, "To look at on the first real deploy"; they run in step 6, with the domain bought when the audit begins, 2026-11-13) on the one-origin site, then split the two origins **before the site is
  announced**. The browser keeps the visitors' files, the downloaded engine, the tab lock, the sample's mark and the theme per
  origin, so a split after visitors have used `dofile.dev/app/` would leave their files behind (they would download a zip and
  upload it again) and download the engine again; before anyone uses it, nothing is lost. The steps (two builds into two
  folders, a second Wrangler config, `package.json` and `deploy.yml`, a second e2e server) are SPEC section 8, "URLs", "Its own
  subdomain later"; no change to the page's code. The fallback with no build change: keep the editor at `dofile.dev/app/` and
  make `app.dofile.dev` a redirect to it.
- **Step 6:** `web/e2e/poc.spec.ts` is bound to the proof-of-concept page's element ids and is rewritten with the page.
  `axe`, `tabwalk` and `contrast` check the mockups today, not the real page.
- **Step 7:** the 48 MB figure, Break on a long model fit in a browser, `pyreadstat` on a real iPhone, a phone over HTTPS
  with the cache working, "no request leaves the page except for static assets", and that the host compresses the `.wasm`.
  **Added 2026-11-13** (sections 5 and 6 of the post-merge review; the maintainer: "all recs"), the real-phone pass:
  - A real iPhone session: the phone command line, and the wake lock locked for 30 s.
  - The "To try on a real iPhone" list (step 3; `phase2-history.md`, "Prototype 1: the record from 'Where things stand'": the page does not scroll or bounce; with the keyboard open the command line sits right above it and the tab bar is hidden; a toast sits above the command line and the tab bar, and above the keyboard while it is open), step 4's C 13, and the same on an Android phone (Chrome, Firefox).
  - Review decision 5: the trackpad back-swipe over the editor and the log, checked once by hand.
  - Memory: the cap was measured on an iPhone 13 only (`docs/browser-engine.md`, "The memory cap"), so try other phones;
    `merge`, `reshape`, `sort` and graphs near the cap; and a full heap in a browser.
  - Decision 6 (zoom on the editor page) is not part of this: it stays in `docs/icebox.md`, "Phone".
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
