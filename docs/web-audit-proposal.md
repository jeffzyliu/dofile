# Proposal for the full-web-code audit

The plan for the audit named in `docs/phase2-plan.md` ("The audit"): what is wrong in `web/`, what to do about it, three
sizes of doing it, and how to run it. It is a proposal, not an execution plan: the items are not yet briefs.

**Status (2026-11-16).** The maintainer chose proposal B, then moved four of C's redesigns into it (R7 through S0, R5,
the focus-target registry of R3, R1) with screenshots as a net. The execution plan is `docs/web-audit-plan.md`. What is
left of C is in `docs/icebox.md` ("Web audit: the redesigns"). Section 8 lists what is decided and what is still open.

**How it was made.** A planning session (Fable 5.2) wrote it from ten read-only survey reports, then revised it after a
fresh-context review (verdict "accept after fixes"; all five must-fix and all should-fix findings are applied, and the
revision itself was checked only by the planner). In this file "I" is the planner and "you" is the maintainer. The
reports are in `docs/archive/web-audit-surveys/`, as written (01 to 10 the surveys, 11 the review of the first draft).

**Baseline.** The surveys read `main` at 145a557. This text was then corrected against 65c5bd9, eleven commits later;
those commits changed the lazy graphics part and nothing else under `web/src` (see "Since the surveys" below). Line
numbers in this file are 65c5bd9's. Line numbers inside the reports are 145a557's.

Finding ids are `<report>-<finding>`: `03-F1` is finding F1 of report 03. The reports: 01 engine protocol, 02 worker and
storage, 03 controllers and state, 04 census (knip, madge, jscpd), 05 and 06 views, 07 unit tests, 08 e2e, 09 CSS, 10
build and scripts.

### Since the surveys (145a557 to 65c5bd9)

- `engine/lazy-part.ts` is new: the worker's decisions about a waiting graph (`waitStep`) and about the browser's own
  decoder (`useNative`) are pure functions with table tests (`test/lazy-part.test.ts`). `worker.ts` acts on them.
- `test/client.test.ts` gained four tests of the page's side of the hand-over (pending, landed, damaged, failed), with a
  stand-in worker.
- The page now re-fetches a damaged part past the HTTP cache until a copy lands (`damaged` on the part's record), and a
  native decode that failed applies to one copy only (`copies`, `nativeFailedOn` in the worker).
- So theme 4 is smaller than the surveys found, and R1's first step is on `main`. What is left is named in theme 4.
- `vite.config.ts` gained an `fs.allow` block (a worktree whose `node_modules` is a symlink); S9 must keep it.
  `measure-startup.mjs` gained `--engine firefox`.
- Root `CLAUDE.md` now lets a pull request be merged by a fast-forward push to `main` when the maintainer says so for
  it.

## 1. Verdict

The architecture is sound and should stay. The spaghetti is where the code did not follow its own rules.

- **Keep:** the pure state machine and its table tests, the store and journal, the real-worker test harness, the pure
  helper modules, the `useFocusRequest` pattern, the typed dialog and banner registries, `urls.ts` and `staleness()`.
- **What the surveys said about a redesign.** Of the nine regional surveys, seven answered "no, tidy it". Two said yes
  to one change each: the editor's per-file bookkeeping (adopted here as S1) and a staged build step (R5).
- **Mechanical chaff is small.** knip found 0 unused dependencies and 20 unused exports; `src` has 0 TODOs and one
  duplicated block. A chaff sweep alone will not make the code easier to own.
- **The mess is structural and local.** Eight themes, in the order I would fear them as the owner:

| # | Theme | Where | Evidence |
|---|---|---|---|
| 1 | Logic lives in view files, on module-level state, with no Node test | `Editor.tsx` (four parallel Maps per file, and Save), `FilesPane.tsx` (the rename and draft machine), `ResultsTab.tsx` and `DtaView.tsx` (readers), `LogView.tsx` (`runText`, scroll-follow), `App.tsx`, `CommandLine.tsx` | 05-F1, F2, F8, F10; 06-F1, F7; 03-F2 |
| 2 | File writes are ordered by two unrelated promise chains and by comments | `files/actions.ts` (`fileTurn`, `uploads`), `store.ts` `change()` | 03-F1, F3, F4, F6; 02-F10 |
| 3 | Failures are computed and then dropped, or decided from text | `storeError` has no reader; `reasonOf` and `words.ts` match regexes; `run.ts` swallows every rejection | 02-F1, F2, F3; 01-F3, F4, F5; 06-F2; 03-F13 |
| 4 | Lazy graphics is a state machine kept in loose variables on both threads; only its waiting-graph decisions and the page's hand-over have Node tests | `client.ts` 383-540; `worker.ts` 471-850 (22 module-level variables; the idle steps, the native decode and the worker's own fetch decide inline); the header's states are names in `lazy-part.ts` and the literals 0, 1, 2 in `client.ts` | 01-F2, F12; 02-F4, F5 |
| 5 | Focus hand-off depends on other components' label strings and on call order | `states/focus.ts`, `Editor.tsx`, `Dialog.tsx`, `Menu.tsx`; five roving-key implementations, two modal implementations | 06-F3, F4, F8, F12; 05-F4 |
| 6 | One fact, many spellings | engine-state sets in about a dozen view sites, the phone breakpoint six times, three byte formatters | 05-F12; 06-F6, F14; `09-css.md` |
| 7 | Shared signals anyone may write | `dialog` (8 files), `phoneTab` (6), `activeTab` (3) | 03-F7, F9 |
| 8 | The tests that guard the architecture pin source text | `imports.test.ts` (exact signatures, call counts, cast counts, a blacklist of old names); the e2e hook exposes the whole `state` module | 07-F1 to F4; 01-F13; 08-E1 |

Themes 1, 2 and 5 are what the maintainer's list in `docs/phase2-plan.md` calls "spaghetti patterns", "raw DOM" and
"focus consolidation". The icebox upload bug is theme 2; step 3.5's two store gaps are theme 3; its Break gap is item
B3.

## 2. Goals for the refactor

1. **Logic in `.ts`, rendering in `.tsx`.** A view holds no app state in module variables and makes no store write.
   This is already the rule in `web/CLAUDE.md`; the audit makes it true and testable in Node.
2. **One door per side effect.** Store writes go through one sequencer. A shared signal is written through its
   owner's functions. (`#send` already is the one door to the worker.)
3. **Order by construction.** Where a comment says "this must come before that", the structure forces it or a test
   pins it.
4. **Decide from kinds.** No regex on an error or reason text. A failure becomes an event, a banner or a logged kind;
   it is never dropped.
5. **One name per fact.** Engine-state predicates, the shared-buffer protocol and small helpers are each stated once.
6. **Rules that survive a refactor.** Architecture rules move from text counts to types, Biome's restricted imports,
   and one import-graph test with its paths in one table.
7. **Comments.** A file header says what the module is for in at most three lines. Cross-module narrative lives in
   `docs/` and is linked. No history.
8. **Net first.** Every move lands behind a test that existed before it.

## 3. Work items

Size: S under 150 changed lines, M under 500, L more. Risk is the risk of a behaviour change.

### Nets (land before the code they protect)

| id | Item | Size, risk | Source |
|---|---|---|---|
| N1 | `imports.test.ts` and the verbatim-line checks in `site.test.ts:112-113`: replace text pins with Biome restricted imports, compiler types and one path table; keep the transitive reachability test. Each removed assertion gets a named replacement in the same change, including the `ignoreHeldEnter` counts and the writable-signal count. Rewrites `web/CLAUDE.md` lines 82-88 to match. The two outright deletions (the old-names blacklist, the cast counts) wait for decision 8.3. Needed before S5 to S8, not before the B items. | M, low | 07-F1 to F4, F7; 01-F13 |
| N2 | Split `app.test.ts` (2,486 lines) along the controllers; shared wiring into `test/wiring.ts`; one `resetState()`. | M, low | 07-F5, F6 |
| N3 | e2e: one typed hook module in place of three hand-typed copies; named helpers for the roughly 25 places that write a signal; duplicated helpers into `fixtures.ts`; the app's own CSS-class selectors (about 150 uses) moved to roles and names where one exists. | M, low | 08-E1, E2, E5, E8 |
| N4 | e2e leftovers. First confirm that poc's two other flows ("Run does not save, Save does, reload brings the text back"; "a switch with unsaved edits asks") are covered elsewhere, or port them; add a live test of the `beforeunload` guard; then delete `poc.spec.ts` and rename `step2.spec.ts`. Same change: `web/CLAUDE.md` 92-93, `web/README.md` 97, `docs/test-map.md` 200 and 275, SPEC 1462, 1464, 1696. Runs after N3 (both edit `e2e/`). | S, low | 08-E6, E7, E9 |
| N5 | Type-check the tooling: `e2e/`, the two configs and `scripts/` into `tsconfig`; the `.mjs` scripts become `.ts`. The same change must update the two CI lists that name those files, or they silently stop matching: the path filter at `web.yml:50` and the cache key at `build-web/action.yml:37`. Also `web/CLAUDE.md` 121, `docs/browser-engine.md` 7, 89, 91 and SPEC 1548. Runs after N4. | M, low | 10-F1, F7, F12 |
| N6 | e2e for the code about to move: one Playwright test of a streamed run in a real browser (it also measures 05-F9); run the specs holding the 29 fixed sleeps ten times on the iPhone project; replace the sleeps that guard focus and write order (`files.spec.ts` 197-361, `editor.spec.ts` 1480-1707) with a settle helper. | M, med | 08-E3, E4; 05-F9 |

### Bugs (behaviour changes; each starts with a failing test, each its own pull request)

| id | Item | Size, risk | Source |
|---|---|---|---|
| B1 | Uploads and "Restore the sample" take a file turn: **one turn per write and its reopen, never per upload** (a turn around the whole upload would hold every Save while a clash dialog is open). Also the `createEntry` and `followOpen` races. In proposal A, where Save stays in the view, the failing test simulates Save as `fileTurn(() => store.write(...))` in `files-ui.test.ts`. In proposal B this item is done inside S2. | M, med | 03-F1, F4, F5; icebox |
| B2 | Store failures are shown: the worker returns the error's name; a version change becomes a reload-type failure; `storeError` reaches a banner; a failed `/work` sync no longer says the files "couldn't be kept". Changes machine cells and SPEC section 5. If it bumps the database version, handle `onblocked` (02-F14). | M, med | 02-F1, F2, F3, F11, F14; 01-F5; gaps a and b |
| B3 | A Break pressed before the worker takes the run is kept. Three layers: `client.ts` clears the buffer at send time; `worker.ts:957` stops clearing at run start; `browser.py` must not drop an interrupt that arrives before `_busy` is set (suspected, check first). A Python change needs a new wheel and snapshot, and ruff. | S to M, med | 01-F1; 02-F9; gap 1 |
| B4 | Decide from kinds: `download-failed` may be "unknown"; memory by error name; the reset banner from the machine's `cause`; a run error of a kind other than "op" is reported, not swallowed; `run.ts` swallows only `no-engine` and `reset`; the leaked subscription in `connectEngine`. | M, low | 01-F3, F4, F8, F14; 06-F2; 03-F13 |
| B5 | Small ones in views: Find bar's ref read during render (suspected), the full-size viewer's uncleared timer, a doubled `describe_file` (suspected). | S, low | 05-F7; 06-F7, F8 |

### Consistency

| id | Item | Size, risk | Source |
|---|---|---|---|
| C1 | Engine-state predicates (`engineUp`, `runOn`) stated once; no state-name set in a view. The one CSS rule on a state-name prefix stays unless you decide otherwise (decision 8.4): a test requires exactly that rule. | S, low | 05-F12; 06-F6 |
| C2 | Registry types into `app/types.ts` (import cycles 10 to 3); break the three controller cycles. | S, low | 06-F9; 03-F11 |
| C3 | The shared-buffer protocol in one module used by `client.ts` and `worker.ts`: `lazy-part.ts` already names the states; it also gets the header's layout (state, length, tries; `PART_HEADER` is in `snapshot.ts`), and `client.ts` uses the names. | S, low | 01-F12; 02-F5 |
| C4 | The visitor's words out of the engine controller; one byte formatter; one UTF-8 decode; one "reload a tab from bytes". | S, low | 01-F11; 06-F14; 03-F14 |

### Sweeps (the "total" in total-code audit)

A sweep builder reads every file of its region in full and fixes only local things under a fixed rubric: the census's
unused exports, dead parameters and options, history comments, headers over three lines (narrative moved to `docs/`),
duplicated small helpers. Anything structural is logged for the orchestrator, not done.

| id | Region |
|---|---|
| W1 | `src/engine/` and the three Python files |
| W2 | controllers and state |
| W3 | shell, editor (with `editor/csv.ts`) and log; `src/stata/` |
| W4 | files, output, shared UI, states |
| W5 | `test/` and `e2e/` (three copies of the wheel loader, the 580-line ordered test) |
| W6 | CSS: mockup-only rules and the duplicated sheet block, after checking `docs/design/` does not use them |
| W7 | `scripts/`, config, `biome.json`, `src/site/`, `sample/`, `wheels/`, the three HTML pages |

`src/stata/`, two `src/site/` files, `editor/csv.ts`, `sample/`, `wheels/`, the HTML bodies and `biome.json` were read
by no survey; W3 and W7 are their first read.

### Structural moves

| id | Item | Size, risk | Source |
|---|---|---|---|
| S0 | A one-page design note: who owns tabs, dirty, saved text and write turns, and the target module list for S1 to S3. Written before any of them. | doc | 03, 05, 06 |
| S1 | Editor documents: one record per open path in a DOM-free controller that owns open, reload, run-over, rename, close and Save. "Dirty" is derived. Node tests for rename against Save and a run against unsaved edits. Scroll restore through CodeMirror's `scrollSnapshot` in place of the animation-frame wait. | M + S, med | 05-F1, F2, F3, F5; 03-F2, F10 |
| S2 | One door for file writes: one turn factory, one write and its follow-up per turn, the races tested in Node, a test of the store's transaction order. Then split `files/actions.ts` into tabs, file operations, upload and intake. Contains B1. | M + M, med | 03-F3, F6, F12; 02-F10 |
| S3 | Split `FilesPane.tsx`: a `rename.ts` controller with Node tests, tree state, the drop hook, `TreeRow` and `RenameField`. | M to L, med | 06-F1, F10, F11, F15 |
| S4 | Output: the matrix and `.dta` readers into a `.ts` module with tests; one command bar, one variables table, one dismissible banner. | M, med | 06-F5, F7, F13 |
| S5 | Log and shell: `runText` becomes a tested pure function; scroll-follow in one hook that owns its scroll box; `CommandLine.tsx` split into its four jobs; state logic out of `App.tsx` (after S1: both edit `state.ts`). | M + S + S, med | 05-F6, F8, F10, F13, F14 |
| S6 | Shared UI: one roving-key hook (the editor tabs onto `Tablist`); the full-size viewer onto the shared modal trap; focus targets through exported handles, not label selectors; owner functions for `dialog`, `phoneTab` and `activeTab`, including the engine controller's writes to `dialog`. | M + M, med | 06-F3, F4, F8, F12; 05-F4; 03-F7, F9; 01-F10 |
| S7 | Transport: per-start facts onto the start record; the controller's module-level wiring and download handle. **Graphics half** (see "What doing B first would waste", section 4): the graphics part out of `client.ts` into its own module; the four hand-over tests in `client.test.ts` are its net. | M + M, med | 01-F2, F6, F9 |
| S8 | Worker: split into imported modules (the `/work` mirror with unit tests, boot and loader, a typed declarative dispatch). **Graphics half**: the graphics state into one object that owns it, along the seam `lazy-part.ts` started (decisions pure, `worker.ts` acts). A move, not a redesign. Imported modules are safe; separate chunks are not (iOS runs the worker twice). | M + M + S + M, med to high | 02-F4, F6, F7, F8, F13 |
| S9 | Build: `scripts/lib` (argument parsing, the shard pool written three times, one `wheels()`); `vite.config.ts` split into plugin modules; **staging half**: file staging out of module load; every snapshot knob in the manifest; the two CI file lists generated from one table; `npm run commands` writes through a temp file; `wheel` stops deleting the release wheels in the root `dist/` and runs once per `e2e`; the denied-commands list generated, not parsed from `browser.py` by regex; `measure-startup.mjs` and `compare-pytest.mjs` moved or folded. If decision 8.2 is yes: delete the `DOFILE_EDITOR_BASE` mode in `vite.config.ts` (six branches), `urls.ts`, `site.test.ts` (five sites), the e2e reads and `measure-startup`, and SPEC section 8. | M + M + S, med | 10-F2 to F10 |

### Redesigns (proposal C only; in the icebox, R1 and R5 first)

| id | Item | Builder items | Replaces |
|---|---|---|---|
| R1 | Lazy graphics as one pure machine with table tests, behind a Node harness that drives a lazy part through the real worker. Its first step is on `main` (`waitStep`, `useNative`). Left: the idle steps, the native decode, the worker's own fetch and the page's side stated as one table of states and events; the 22 variables as one record; the harness. | 3 | the graphics halves of S7 and S8 |
| R2 | A ticket per run in the engine machine: tickets become uniform and the Break gap closes by construction. Rewrites part of `machine.test.ts` and the SPEC matrix. | 2 | B3's page-side fix |
| R3 | A DOM test harness for views (a new dev dependency) and a focus-target registry in place of the seven hand-off mechanisms. | 4 | S6's handles |
| R4 | CSS by component: a Playwright screenshot baseline first, then `app.css` and `ui.css` re-sorted (about 1,300 lines move), one statement of the phone breakpoint, the phone toast arithmetic. | 4 | W6 |
| R5 | A staged `public/` made by one script, which the Vite config only reads. | 1 | part of S9 |
| R6 | The e2e hook as a small named surface, not the `state` namespace (about 180 uses). | 2 | N3's helpers |
| R7 | One workspace module owning the file list, tabs and documents behind a command queue; `state.ts` split by owner. | 5 | S1 to S3 |

## 4. Three proposals

| | A. Sweep and fix | B. Logic out of the views | C. Redesign |
|---|---|---|---|
| Items | N4, B1 to B5, C1 to C4, W1 to W7 | A plus N1, N2, N3, N5, N6 and S0 to S9 | B plus R1 to R7 |
| Builder items | about 17 | about 42 | about 55 |
| Pull requests | about 6 | about 13 | 20 or more |
| Relative cost | 1 | about 2.8 | about 4.5 |
| Estimated agent tokens | 4 to 7 million | 11 to 18 million | 18 to 30 million |
| Orchestrator sessions | 2 | 5 (phase 2 takes two) | 8 or 9 |
| New dependencies | none | none | a DOM test library; screenshot baselines in the repository |
| Themes closed | 3, most of 6 | 1, 2, 3, 7, 8, and 6 except the phone breakpoint; 5 contained; 4 contained, or only named if its halves go to R1 (decision 8.9) | all eight |

Costs are guesses; section 6 gives their basis.

**A. Sweep and fix (lean).** Read every file once, cut the chaff, fix every bug that has a concrete case, state the
repeated facts once. No file is split and no logic moves.
- For: the lowest risk; it closes the audit box in the phase 2 plan, the three engine gaps and the upload bug; nothing
  depends on e2e-only code staying right. It needs no change to `imports.test.ts`.
- Against: the files I would be afraid to change stay as they are. `Editor.tsx` keeps Save and four Maps,
  `FilesPane.tsx` keeps its rename machine, and the text-pinning tests still fail on the first later restructure. It
  does not do what "get rid of the spaghetti" asks.

**B. Logic out of the views (recommended).** Proposal A plus the moves that make the existing architecture true: the
nets first, then each tangled view loses its logic to a `.ts` controller with Node tests, file writes get one door, and
the two largest engine files are split along seams the code already marks.
- For: it removes the cause, not the symptoms. Each move converts e2e-only behaviour into Node-tested behaviour, so the
  code gets safer to change as the audit proceeds. No new dependency and no new concept: every rule it enforces is
  already written in `web/CLAUDE.md`.
- Against: S3, S5, S6 and S8 change code whose only net is e2e, and iPhone behaviour is emulated there. About 13 pull
  requests for you to merge. The phone breakpoint stays spelled six times.
- Its one piece of real design is S0 to S2: the editor's per-file bookkeeping and the write ordering are the same
  problem seen from two files. That is why a design note comes first and the three items run in series.

**C. Redesign (aggressive).** Proposal B with seven subsystems redesigned, not tidied.
- For: uniform tickets, an explicit graphics machine, a unit net under the views and CSS organised by component would
  each make a later change cheaper. R5 was recommended by the build survey.
- Against, item by item:
  - R1 rewrites code that is days old and still changing (eleven commits on the day of the surveys). `main` has since
    taken its first step itself, which weakens this objection: the remaining cost is the harness and the idle path.
  - R2 costs a rewrite of the best test file in the suite to fix a gap that B3 may close in three small edits.
  - R3 adds a DOM library whose focus and layout behaviour differ from the browsers where the bugs occur; B gets most
    of that net by making views thin enough for Node tests.
  - R4's screenshot baselines are binary files per browser that the later UI work will invalidate at once; the re-sort
    is worth doing at the start of that work, not before it.
  - R5 changes CI and the one-command `npm run dev` for a gain S9 mostly delivers by moving the staging out of module
    load.
  - R6 and R7 are mechanical at scale (180 call sites; three modules merged into one) with no finding that needs them.
- Cost: about 1.6 times B's.

**The planner's recommendation was B, and none of C now. Decided 2026-11-16: B; C goes to the icebox, and the
maintainer broadly agrees with every item in it, R1 and R5 first.** The other items keep their triggers: R2 if B3
proves incomplete, R4 at the start of the later UI work, R3, R6 and R7 when a finding needs them.

### What doing B first would waste, by redesign

The maintainer wants every item of C done in the end. So the question for each is whether B does work that the redesign
then throws away. "Waste" below counts builder items of B that the redesign redoes; the counts are estimates from the
tables above. Where a survey gave its own order, it is quoted.

| id | Waste if B runs first | Why | Recommendation |
|---|---|---|---|
| R7 | **High: 4 to 5 items.** | S1 to S3 draw three controllers and split `files/actions.ts` four ways; R7 then redraws the same boundaries as one workspace module, and rewrites the new Node tests and the views' call sites a second time. Almost all of R7's cost exists only because B chose other boundaries first. | **Advance, as a decision and not as an item:** S0 decides the ownership R7 wants, and S1 to S3 are built to it. What is left of R7 is the split of `state.ts` by owner (one item, with S6). |
| R1 | **Medium: 1 to 2 items, and a second pass over the riskiest code.** | The graphics halves of S7 and S8 move code that R1 restructures. The move is not lost (report 02: "a single object that owns its state" comes before a machine), but the code is reviewed and verified in browsers twice. | **Advance into B's engine lane, last**, in place of the two halves, once the part has stopped changing. A design note first. |
| R5 | **Low to medium: 1 item.** | S9's staging half moves the staging out of module load; R5 moves it again, into a script. Report 10: "I would do it together with [the config split], not alone." | **Advance into S9**, in place of the staging half. |
| R3, registry | **Low to medium: 1 item.** | S6 replaces label selectors with exported handles; the registry replaces the handles. Report 06 wants the registry "only after FilesPane is split", and S6 already runs after S3. | **Advance into S6**, in place of the handles. |
| R3, DOM harness | None. | It adds tests and a dependency; B builds nothing it replaces. After B the views are thinner, so there is less to cover. | Later. |
| R6 | Low. | N3 is R6's first stage by the survey's own design (report 08: before the view refactor "only the typing ... and the helper wrappers for the 25 signal writes; the observation uses can stay"). | Later, with one rule in B's briefs: an e2e read that a move breaks becomes a named helper in the hook; it is not repointed at the signal's new place. |
| R2 | Low: under 1 item. | B3's page and worker edits are replaced by the ticket; its failing tests and the `browser.py` fix are kept and become R2's acceptance tests. Report 01: "Do it only if [the] simple variant proves incomplete." | Later. Advancing it puts the heaviest change to the machine's tests in the phase meant for small fixes. |
| R4 | None; the other order wastes. | W6 deletes dead rules first, and S3 to S6 settle the components the sheets would be sorted by. Sorted before B, the sheets are sorted twice. | Later, at the start of the later UI work. |

**Recommendation: B plus R7 (through S0), R5, the registry half of R3, and R1 last.** That is about 45 to 47 builder
items against B's 42, and it leaves about 10 for later (R2, the DOM harness, R4, the rest of R6). Doing B whole and then
all of C is about 63: roughly 7 items done twice. The numbers are rough; the order of the rows is what I am confident
of.

Two cautions:
- **R7's "command queue" must not be a queue per operation.** Report 03 argued against it: an upload's clash dialog
  would hold every Save for as long as the visitor hesitates. The unit of order stays S2's turn (one write and its
  follow-up). S0 settles this before S1 starts.
- **R1's timing is not ours to set.** If the lazy graphics part is still changing when the engine lane reaches it, R1
  runs first after B, and B still leaves the two halves out.

One piece of R4 is worth more during B than after it: screenshots as a net for the view moves, which must change no
pixel. Taken from `main` at the start of phase 2 and kept out of the repository, they need no baseline files and are not
invalidated by the later UI work. One builder item; optional.

## 5. How to run it

**Tooling.** The orchestrate skill, one orchestrator session per phase, handing off at each phase boundary. Each item
is one `orchestrate:builder` in its own worktree under `.claude/worktrees/`, then one fresh `orchestrate:reviewer` at
the builder's tier or above. A failing check goes to `orchestrate:investigator`; long logs go to the Haiku log-watcher.

**Models.**
- Opus, high: B1, B2, B3, S1, S2, S7, S8 and their reviews (races, the machine, the worker).
- Sonnet, high, with an Opus review: N1, S3, S5, S6 (view code where judgment matters; N1 can lose an invariant).
- Sonnet, medium: N2 to N6, B4, B5, C1 to C4, S4, S9 and the sweeps.
- Haiku: doc sync, renames, test-map edits.
- Fable: S0 only, and only with your yes; an Opus design note is the fallback.

**Order (proposal B).** Items in one lane run in series; lanes run in parallel.

| Phase | Lanes |
|---|---|
| 0. Nets | (1) N1. (2) N2. (3) N3, N4, N5, N6. (4) S0. |
| 1. Bugs and names | (1) Engine and its controller: B2, B3, B4, C4, C2. (2) Views: C1, then B5 once B2 has merged (both edit `LogView.tsx`). |
| 2. Moves | (1) Engine: C3, S7, S8. (2) Files and editor: S1, S2, S3. (3) Other views: S5, S4, then S6 after S3. (4) Build: S9. |
| 3. Close | Sweeps W1 to W7 on the new layout; doc sync (including `web/CLAUDE.md`'s claim that every request gets a ticket: tickets are per worker start, 01-F7); full verification; one whole-diff review. |

**Order (proposal A).** Phase 1 with B1 added to the views lane and N4 first; then phase 3. Sweeps are its main body.

**Rules every brief carries.**
1. A refactor changes no expectation of a behaviour test. If one must change, it is a behaviour change and a separate
   pull request. A test that pins a path, a count or a class name may change in the move's own pull request, and the
   change names the rule the test still keeps.
2. A bug item starts with a failing test. A bug that cannot be reproduced is reported, not fixed from reading.
3. Move first, change second, in two commits, so the review can read the change.
4. No rule in `imports.test.ts` is dropped without its replacement in the same change, except by decision 8.3.
5. Docs move with code: a machine cell change pastes the SPEC section 5 tables; `types.ts` and SPEC section 6 stay in
   step; `docs/test-map.md`, `web/CLAUDE.md` and `web/README.md` change with the files they name.
6. Budget: 80 tool calls and one L item at most per agent; a larger item is split into a chain.

**Checks.**
- Per item: `npm run check`, `npm test` (58 s at baseline), and the item's e2e specs on Chromium and the iPhone project
  with `SNAPSHOT_QUALITY=5` and its own `E2E_PORT`.
- Per phase: `npm run lint:strict`, the full e2e on four browsers, and for the engine lane `npm run snapshot`,
  `check-snapshot`, `check-pytest`, `check-numeric` and `uv run poe test tests`.
- Stop rule: two failed fix rounds on an item, or an item at twice its size, goes back to you.

**Optional cross-check.** Your installation has `ponytail:ponytail-audit`, a one-shot whole-repo audit. Running it over
`web/` after phase 3 would give a read that did not come from this plan. I did not read that skill.

## 6. Cost

- **Basis.** The ten surveys read nearly all of `src` once (not `src/stata/`, two `src/site/` files or
  `editor/csv.ts`) and sampled the tests: 1.16 million tokens and 218 tool calls in total, 68k to 150k tokens each, none
  over 31 calls. The token figure is what the harness reports per agent; treat it as a relative measure, not a bill.
- **Extrapolation.** A builder reads about what a survey read and then edits and runs checks; I assumed 120k to 300k
  per builder by size and 100k to 150k per review. The totals in the table follow from those guesses.
- **Where it could run over.** View items loop on e2e runs of several minutes; S3 and S8 are the likeliest to need a
  second builder. N1 is cheap to write and expensive to get wrong.
- **Your time.** Every pull request needs your merge. Grouping items into about 13 pull requests keeps refactors and
  behaviour changes apart without sending you 40.

## 7. Risks

1. **e2e is the only net under the views**, and it emulates the iPhone. A focus or keyboard regression can pass CI.
   Mitigation: N6 hardens the specs that guard focus and write order; goal 1 moves logic under Node tests before views
   change; the real-phone pass in the phase 2 plan runs after the audit, not before.
2. **There is no visual check.** Nothing compares screenshots; about 84 geometry assertions are the only guard on
   layout. Proposals A and B therefore limit CSS work to deletions that grep can confirm.
3. **N1 can lose an invariant silently.** It gets an Opus review whose only job is to match each removed assertion to
   its replacement.
4. **A refactor that hides a behaviour change.** Rules 1 and 3, and separate pull requests for the B items.
5. **Lazy graphics is new code, still changing, and only partly under Node tests.** Proposal B gives it names (C3) and
   a sweep, and leaves its structure to R1. Any engine-lane item starts from the `main` of its day, not from this
   file's line numbers.
6. **A merge to `main` deploys the web demo.** Each pull request must be releasable alone; an engine or Python change
   needs a fresh snapshot; N5 must not leave the CI snapshot lists stale.
7. **Lanes colliding** on hot files (`Editor.tsx`, `app.css` and `FilesPane.tsx` are the most-changed files of the
   last six weeks). Items on the same file run in series.
8. **The survey's own limits** (section 9). Every bug in this plan was read, not reproduced.

## 8. Decisions for you

Decided: 1 and 9. Open: 2 to 7. Item 8 is a list, not a question.

1. **Which proposal.** Decided 2026-11-16: B. C is in the icebox, R1 and R5 first.
2. **`DOFILE_EDITOR_BASE`.** No workflow, npm script, README or CLAUDE file sets it. SPEC section 8 documents it and
   already calls it "a one-origin layout the scripts and the e2e tests no longer build"; `site.test.ts` and two e2e
   specs read it. Delete the mode? I recommend yes, unless you plan to serve the editor under a path.
3. **Two rules of yours that N1 would delete outright.** `web/CLAUDE.md` states both: the grep for old flag names
   (line 73) and "`machine.ts` is pure with two casts" (line 85). The unit-test survey calls them history and exact
   counts that fail on harmless edits. I recommend deleting both and keeping their intent in types (the transport's
   type knows no state name; the `Ticket` brand). They are your rules, so N1 keeps them until you say.
4. **The CSS rule on `data-engine^="other-tab"`.** It is the one place CSS reads a state name, and a test requires
   exactly that rule, so it was deliberate. I recommend leaving it.
5. **Pull request grouping.** About 13 pull requests straight to `main`, or one integration branch merged once. I
   recommend the 13: CI tests each merge, and a regression bisects to one theme.
6. **Fable for S0.** One design note. It decides the shape of the three riskiest items; I recommend yes.
7. **The engine gaps inside the audit** (B2, B3). They change machine cells and the SPEC. I recommend keeping them in:
   they are the correctness half of what you asked for.
8. **Left out of every proposal**, with the reason:
   - accessibility items, design checks, security headers, deploy checks: out of scope as you set it, including "Tab
     out of the open menu at phone width";
   - `check-pytest` and `check-numeric` in CI: they run at each phase gate here; adding them to CI is a cost decision;
   - splitting the main chunk: CodeMirror is most of it, and the build survey guesses a lazy split buys little;
   - the phone toast arithmetic: only a real device can verify it;
   - the dark palette stated once: SPEC decision DS-6 already says "not now";
   - fewer e2e specs per browser: needs timings first.
9. **Which redesigns move into B** (section 4, "What doing B first would waste"). Decided 2026-11-16: all four that
   the section recommends (R7 through S0, R5 in S9, the focus-target registry in S6, R1 last in the engine lane once the
   lazy graphics part has settled), and the screenshots as a net for phase 2. R2, the DOM harness, R4 and the rest of
   R6 stay in the icebox; `docs/web-audit-plan.md`, section 8, lists how each is planned after the audit.

## 9. Not verified

- No finding was reproduced. Every bug and interleaving was read from the code; some are marked "suspected" in the
  reports.
- Tests were sampled: about 95% of e2e test bodies and most unit test bodies were not read. Claims about what e2e
  covers come from test names.
- The baseline ran `npm run check`, `lint:strict` and `npm test` only. At 65c5bd9: `npm run check` passes, and
  `npm test` passes 368 of 373 with 5 skipped (59 s); `lint:strict` was run at 145a557 only. No e2e, build, snapshot or
  `check-*` script was run. The 5 skipped tests all need a snapshot (the snapshot start, the two heap-cap cases, the
  "updated" refusal, native-library calls), so a plain `npm test` does not exercise the snapshot start.
- The correction against 65c5bd9 read the diff of `web/` since 145a557 and nothing else again. Findings in the engine
  reports (01, 02) about the lazy graphics part may be out of date beyond what "Since the surveys" lists.
- Each survey was capped at 15 findings, so each region has more. The sweeps exist to find them.
- The plan review checked eight facts against the code and 24 citations against the reports; the rest of this plan
  rests on the reports. My revision after that review was not re-reviewed.
- Unchecked assumptions the plan leans on: that `cm.ts` or its state half loads under Node (S1); that the real worker
  can be driven with a lazy graphics part under Node (R1; the new page-side tests use a stand-in worker); that
  `docs/design/` no longer needs the mockup-only CSS (W6); that Biome's restricted-import rules can express every layer
  rule in N1; that `e2e/` and the configs pass `tsc` without a large fix list (N5).
- The state of the production deploy, and the content of the `ponytail` and Workflow tooling, were not read.
- The three "cheap checks" of the phase 2 plan are done as far as a census goes: no GPL or AGPL dependency (one LGPL
  optional native binary, dev only; Pyodide is MPL-2.0 and is shipped); no stale path or script name in
  `web/CLAUDE.md`, `web/README.md` or `docs/test-map.md`.
