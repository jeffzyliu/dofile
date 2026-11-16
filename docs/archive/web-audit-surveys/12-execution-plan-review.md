# Review: `docs/web-audit-plan.md` (execution plan of the web audit)

**Reviewed:** `docs/web-audit-plan.md` at 3c61fcf (worktree `.claude/worktrees/web-audit-plan`, branch
`docs/web-audit-proposal`, clean). I checked it against `docs/web-audit-proposal.md`, the survey reports 01, 02, 03, 05
and 06 (only the rows I needed), `docs/icebox.md` (its last section), `docs/phase2-plan.md` lines 29-100, and the code
under `web/` at the same commit. I changed no file.

**Verdict: accept after fixes.** Every item in the decided scope is scheduled, and the chain order of each lane is sound.
Four findings must be fixed first:
- Phase 1 runs two items in parallel that edit the same four files.
- R7r would either break or convert about 180 e2e reads, which is R6, put out of scope.
- Phase 3's end gate marks the whole audit done and archives the file that section 8 and the icebox still point at.
- Phase 0's own table breaks rule 8.

All four are small edits to the plan.

## Must fix

**M1. Phase 1: C1 (lane b) collides with B4 and C4 (lane a).** Section 4, phase 1 table, rows 1.3, 1.4 and 1.5.
- C1 starts at "phase 0", in parallel with lane a. Nothing orders it against B4 or C4, but all three edit the same view
  files. The evidence is at 65c5bd9 and in the reports' file lists:
  - `src/app/editor/StatusBar.tsx`:
    - C4 moves the visitor's words out of the engine controller, and line 5 imports `stageStatus, stagesOf` from
      `../engine.ts` (01-F11).
    - C1 rewrites the state-name comparisons at lines 80, 81, 92 and 116 (05-F12).
  - `src/app/states/DownloadDialog.tsx`:
    - C4 changes line 9 (`import * as eng from "../engine.ts"`, 01-F11 cites :71) and line 18 (`mb`, one of the three
      byte formatters, 06-F14 and F13).
    - C1 changes lines 66 and 74 (06-F6).
  - `src/app/states/words.ts`:
    - C1 changes `resetAsks` at line 35 (06-F6). Report 05 also proposes putting the predicates in `state.ts` or
      `words.ts`.
    - B4 changes the reset banner's regex at line 54 (06-F2).
    - C4 changes the `stageWords` alias (01-F11).
  - `src/app/files/FileBar.tsx`: C1 changes line 88; C4 changes the UTF-8 decode at 25-27 (06-F14 names
    `FileBar.tsx:25`).
- The plan already guards the one collision the proposal named (B5 waits for B2 on `LogView.tsx`). These four are not
  guarded.
- **Fix:** in the After column, B4 gets "B3, and C1 merged (both edit `states/words.ts`)" and C4 gets "B4, and C1 merged".
  C1 is S/low and runs first in its lane, so this costs almost nothing.
- **Confirmed by:** grep of the four files at 65c5bd9 (lines quoted above) and the reports' finding rows.

**M2. R7r breaks or converts about 180 e2e reads (that is R6) and nothing decides which.** Section 4, phase 2, row 2.13;
section 6, S0.
- `src/main.tsx:14` does `import * as S from "./app/state.ts"`, and line 78 exposes it to the e2e hook as `state: S`.
  `grep -o "state\.[a-zA-Z]*" -r e2e` counts 179 reads, in 12 spec files.
- When R7r splits `state.ts` by owner, every signal that leaves the file makes `state.<name>` undefined in those specs.
  Rule 9 then turns each broken read into a named helper. That is R6's conversion (the proposal: "about 180 uses", 2
  items), and sections 1 and 8 leave it for after the audit.
- The same happens, on a smaller scale, for each signal S1, S2 and S6 move out.
- S0's list in section 6 does not say whether the hook keeps one `state` namespace. Section 8 task 6 ("count the
  `state.*` reads left") assumes it does.
- **Fix:** add a bullet to S0: "what the e2e hook exposes after the split". Recommended answer: the hook assembles one
  `state` object from the owner modules (or `state.ts` stays a re-export barrel), so a split changes no e2e read; rule 9
  then applies only to a read whose meaning changed. Add to R7r's row: "the hook's `state` surface unchanged".
- **Confirmed by:** grep (`main.tsx` lines 14 and 78; 179 reads; 37 importers of `state.ts` in `src/`).

**M3. Phase 3's end gate marks the whole audit done and archives a file that is still pointed at.** Section 4, phase 3,
"End gate"; section 8, intro.
- **The audit is not all done at that point.** `docs/phase2-plan.md` lines 76-100 define "The audit" more widely than
  this plan. It includes:
  - the design checks on the real pages (`axe`, `tabwalk`, `contrast`, `fonts`);
  - the accessibility items;
  - the code splitting of the main chunk;
  - the contrast check of the off controls.

  Line 47's table row adds "the first real deploy's checks". The proposal's 8.8 puts these out of scope. If the gate
  records "the audit as done", they drop off the phase 2 plan.
- **The archived file is still in use.**
  - The gate moves this file to `docs/archive/` (which is "not kept current").
  - Section 8 says its tasks run "after phase 3's review". The phase 3 table schedules "Section 8's list" inside the
    session, and no row writes `docs/web-audit-redesigns.md` before the archive.
  - The icebox's last entry ("`docs/web-audit-plan.md`, section 8") and `phase2-plan.md:81` would point at a moved file.
- **Fix:**
  - The end gate records "the code audit (this plan) done", and lists what is still open in the audit row: design
    checks, accessibility, chunk split, contrast, deploy checks.
  - Archive this file only after section 8's task 7 has written `docs/web-audit-redesigns.md` and replaced the icebox
    entry. In that same change, repoint `phase2-plan.md:81`.
  - Say plainly whether section 8 runs in session 5 or in a session 6.
- **Confirmed by:** reading `phase2-plan.md` lines 29-100 and `icebox.md`'s last section.

**M4. Phase 0's table breaks the plan's own rule 8.** Section 3, rule 8 ("No two open items edit the same file");
section 4, phase 0.
- `web/test/site.test.ts`:
  - N1 (lane a) replaces the verbatim-line checks at 111-113.
  - N5 (lane c) renames `scripts/measure-startup.mjs`, which `site.test.ts:195` names.
  - The two lanes run in parallel.
- `web/CLAUDE.md`: N1 rewrites 82-88, N4 changes 92-93 and N5 changes 121. These are lanes a and c.
- `docs/test-map.md`:
  - N2 (lane b) splits `app.test.ts`, so the entry at line 110 and a new `test/wiring.ts` change.
  - N4 (lane c) changes 200 and 275. N1 may also change 188.
- Rule 5 of the proposal and the root `CLAUDE.md` both require these docs to change in the same change as the code. So
  the shared docs will always collide.
- **Fix:**
  - Restate rule 8: "No two open items in different lanes edit the same source or test file. The shared docs
    (`web/CLAUDE.md`, `docs/test-map.md`, SPEC) are exempt: the later pull request rebases."
  - Order N5 after N1 is merged, or move N5's one-line change at `site.test.ts:195` into N1.
  - Also, as written rule 8 forbids its own stacking: stacked items in one lane are open at once and edit the same
    files. Say "in different lanes".
- **Confirmed by:** grep (`site.test.ts` 111-113 and 186-196; `web/CLAUDE.md` 82, 92, 121; `test-map.md` 110, 188,
  200, 275).

## Should fix

**S1. Phase 2: other files that two parallel lanes edit.** Section 4, phase 2.
- **The e2e hook** (N3's typed module, and `main.tsx:78`). Under rule 9, every move whose e2e reads break adds helpers
  there: S1 and S2 (lane b), S4 and S5 (lane c), S7 (lane a). **Fix:** one helper file per lane, which the hook imports;
  or hook edits wait in turn.
- **N1's "one path table"** (today `test/imports.test.ts`). Three lanes would change it:
  - S8 splits `worker.ts`: views are banned from it at line 165, and line 373 expects `openStore` in
    `src/engine/worker.ts`.
  - S1 and S2 move `connectFiles` (line 385, `src/app/files.ts`).
  - S5 and R7r change `App.tsx` reaching `state.ts` (line 181).

  **Fix:** N1's brief says the table is keyed by folder or layer, not by file, so a split adds no row.
- **`src/app/files/FileBar.tsx`.** S2's second half splits `files/actions.ts`, and line 11 imports `downloadEntry` from
  it (lane b). S4 rewrites the command bar at 65-109 (06-F5, lane c). **Fix:** S4 after S2, or accept a rebase on the
  import line once rule 8 is restated.
- **`src/app/engine.ts`.** S7 (lane a, the controller's wiring, 01-F6 and F9) and S6 (lane c, the `dialog` writes at
  368-378, 01-F10) are kept apart only by the split into sessions. **Fix:** S6 also waits for S7.
- **R7r against R1 in session 4.**
  - `state.ts` holds `graphicsWriter` (53-57) and `graphIndex` and `graphFull` (126-127).
  - `engine.ts:130-131` routes `client.onGraphics` into `graphicsWriter`.
  - R1's page side may change these while R7r splits `state.ts`.

  **Fix:** R7r waits for R1 to merge (or for R1 to drop out), or R1's brief excludes `state.ts` and `app/engine.ts`.
- **Module splits** (S2's second half, S8, and R7r with 37 importers) edit every importer. This is a further reason to
  restate rule 8, as in M4.
- **Confirmed by:** grep and reading the cited lines at 65c5bd9. I did not build a dependency graph.

**S2. Phase 3: the sweeps run in parallel but overlap.** Section 4, phase 3, rows 3.1 to 3.4 (all "after phase 2").
- The sweep rubric removes dead parameters and options. Their callers include tests in `test/`, which is W5's region.
- Narrative moved out of headers lands in shared `docs/` files, for example `docs/web-engine-data-flow.md`, which 3.5
  also edits.
- **Fix:** W5 runs after W1 to W4. A sweep that has to change a test or a doc logs the change for W5 or 3.5.

**S3. N7 does not say how it stays out of `npm run e2e` and CI.** Section 4, the "N7" paragraph.
- The claim is checked: a separate config is not picked up.
  - `playwright.config.ts` has `testDir: "e2e"`, no `testIgnore` and no `testMatch`.
  - CI runs `npm run e2e -- --project=…` (`web.yml:134`), and `npm run e2e` is `snapshot && build:local && playwright
    test`.
- But a screenshot spec placed in `e2e/` would run in CI on all four projects, and `e2e/` is where N3's helpers are.
- **Fix:** state it in the paragraph:
  - N7 has its own config (for example `playwright.shots.config.ts` with a `testDir` outside `e2e/`) and its own npm
    script.
  - N5 includes that config under `tsc`.
  - The command that takes a baseline from a given commit builds that commit in its own worktree, on its own `E2E_PORT`
    (`e2e/global-setup.ts:19` refuses a server that serves another build).
  - The state list is fixed in phase 0, before B2 adds a store-failure banner, so the list is checked again at phase 2's
    start gate.

**S4. S8 and R1 split the same variables, and no line divides them.** Section 4, phase 2, rows 2.2 and 2.3; section 6,
the R1 note.
- `worker.ts` 485-512 declares the 22 variables (the count is confirmed). They include `started` ("`startup` was
  answered"), `runs` ("runs sent and not ended"), `snapshotBase` and `brotliWasm`.
- S8's boot, loader and typed dispatch read or write these. For example, the run message counts `runs`.
- So "S8 without graphics" moves code that touches R1's "22 variables as one record".
- **Fix:** the R1 note, or S8's brief, lists which of the 22 S8 may move, and defines "the graphics section" by the
  `main` of the day.

**S5. The S9 and R5 split of S9's list is ambiguous.** Section 1 row "Moves"; phase 2 rows 2.14 and 2.15.
- In the proposal, S9 reads: "…; `vite.config.ts` split into plugin modules; **staging half**: file staging out of module
  load; every snapshot knob in the manifest; the two CI file lists generated…; `npm run commands`…; `wheel` stops
  deleting… and runs once per `e2e`; the denied-commands list…; `measure-startup.mjs`…".
- Read literally, everything after the bold label is the staging half. Yet row 2.14 gives S9 "the generated lists, the
  rest of its list", and the R5 note also covers "the two CI lists".
- So the CI-list generation may be built twice, and "`wheel` runs once per `e2e`" or "every snapshot knob" may fall
  between the two items.
- **Fix:** list each clause under S9 or R5 by name.

**S6. Section 8's inputs have no place to be found.** Section 4 phase 1 (line 120), phase 3 rows "census" and "whole-diff
review"; section 8 tasks 1 and 3.
- Line 120 says B3's builder "records, for R2" whether the three edits close the gap, but not where.
- The census README says "Their output is not kept", and phase 3 names no path for the census results or for the
  whole-diff review.
- Task 1 ("Read phase 3's census and whole-diff review") and task 3 ("From B3's record") may then find nothing, months
  later, after the orchestrator's notes are gone.
- **Fix:** name the files. For example: B3's record goes in pull request 1.2's description and in a line of this plan's
  status. The census output and the review go in `docs/archive/web-audit-surveys/` as `12-…` and `13-…`.

**S7. Two pieces of the proposal's content are lost.** Section 4 row 3.5, and the model table in section 3.
- **The 01-F7 doc fix.** The proposal's order for phase 3 includes the doc sync "including `web/CLAUDE.md`'s claim that
  every request gets a ticket: tickets are per worker start, 01-F7". Row 3.5 (a Haiku builder) does not carry it.
- **N1's reviewer.** Risk 3 of the proposal gives N1 "an Opus review whose only job is to match each removed assertion to
  its replacement". The plan's "S/h + O" keeps the Opus reviewer but not that job.
- Neither text is in the proposal's section 3, so a brief written from an item's id misses both.
- **Fix:** add both to their rows.

**S8. The proposal still contradicts decision 9.** `docs/web-audit-proposal.md` lines 211-213 and 328.
- Line 211-213 still says "C goes to the icebox, R1 and R5 first. The other items keep their triggers: R2 if B3 proves
  incomplete, R4 at the start of the later UI work, R3, R6 and R7 when a finding needs them".
- 8.1 says "C is in the icebox, R1 and R5 first".
- Both contradict 8.9 and the plan: R1, R5, R7 and R3's registry moved in, and section 8 and the icebox plan the rest
  without waiting for those triggers.
- **Fix:** mark both places "superseded by 8.9".

**S9. The R5 note's list of commands leaves out the deploy path.** Section 6, the R5 note.
- The note lists what `dev`, `build`, `test` and `e2e` need staged. These other scripts also read or write staged files:
  `snapshot`, `check-snapshot` (CI, `web.yml:166`), `check-pytest`, `check-numeric`, `preview`, `build:local`,
  `cf:dev` and `deploy`.
- So does the `build-web` action used by `deploy.yml:54` and `preview.yml:60`. Its cache key (`action.yml:37`) names
  `make-snapshot.mjs` and `snapshot.ts`.
- A merge deploys, so the deploy path is where a staging mistake costs most.
- **Fix:** "every npm script and workflow that reads a staged file, `deploy` and `build-web` included, and N7's baseline
  command".

## Nice to have

1. **The R1 condition never holds as worded.** Section 4, "The condition on R1".
   - "No open branch … touches" cannot hold literally: the local branches `lazy-graphics-pre-rebase`,
     `lazy-graphics-pre-squash` and `exp-e1c` each differ from `main` in `client.ts`, `worker.ts` and `lazy-part.ts`
     (`git diff --stat`: 3 files).
   - `lazy-graphics-followups` and `idle-ms` do not touch them; `lazy-graphics-followups` edits only
     `measure-startup.mjs`, which N5 renames.
   - **Fix:** "no open pull request, and no branch the maintainer names as live".
2. **The item count.** Section 1.
   - R3r is counted as +1, but the plan puts it "in place of S6's exported handles", and the proposal counts those
     handles as 1 item. Either S6 loses one of its two items (48 in total), or say R3r is larger than the handles.
   - Decision 5's assumption, "one pull request per row of the phase tables", does not match the tables. Rows N3 and N4
     share 0.3, S0 and the R5 note share 0.7, C3 and S7 share 2.1, and R1 spans 2.3 and 2.4. Say "one per pull-request
     number". The 33 does add up: 7 + 6 + 15 + 5.
3. **S0 and the R5 note share pull request 0.7** although they are approved separately, and only S0 gates phase 2. Two
   pull requests (34 in total), or a line on why they are joined.
4. **Row 2.11 does not say why S5 waits for S4.** The proposal ran S5 before S4. The plan's order is right: 06-F5 says
   the command-bar rule is also in `CommandLine.tsx`, which S5 splits. Add that reason to the row.
5. **The R1 note's questions.** Add "iOS runs the worker twice: imported modules only, no separate chunk" (from S8)
   to what the note must answer.
6. **Section 8, task 3.** The statement is right: the buffer is `new Int32Array(new SharedArrayBuffer(4))` at
   `client.ts:569`, handed to `py.setInterruptBuffer` at `worker.ts:915`, and Pyodide reads its first word. The task
   should also cover the case where there is no buffer (`null` without `SharedArrayBuffer`, same line).
7. **Phase 3 gate.** W1 sweeps the three Python files. Name `uv run poe lint` (ruff) in phase 3's gate; the required
   `lint ok` check catches it in CI anyway.

## Checked and found right

- **Completeness.** All of these are scheduled exactly once: N1 to N7, S0, the R5 and R1 notes, B1 to B5, C1 to C4, S1
  to S9 (S2 in two halves around B1, as the proposal's "contains B1" requires), R5, R3r, R7r, R1 and W1 to W7. Only S9
  and R5 overlap (S5). Nothing out of scope is scheduled.
- **Item count arithmetic.** 42 for B matches the proposal's size letters (with B1 counted and S0 not); 42 − 3 + 3 + 4
  + 3 = 49.
- **Order.**
  - N1 lands in phase 0, before S5 to S8.
  - B1 comes after S2's first half, which comes after S1. That is right: Save must be in the controller before the
    turn can hold it.
  - C3 before S7 is sensible: both edit `client.ts`, and they share a pull request.
  - R1 after S8 is sensible once S4's boundary is drawn.
  - S5 does need S4 (nice to have 4).
  - N7 can be built and its stability measured in phase 0, with the baseline taken from `main` after phase 1 (S3's
    caveats aside).
  - B5 waiting on B2 is right: B2 edits `LogView.tsx:280` (02-F3, F11).
- **Facts at 65c5bd9.**
  - Every gate command exists in `web/package.json`: `check`, `lint:strict`, `test`, `snapshot`, `check-snapshot`,
    `check-pytest`, `check-numeric`, `build`.
  - The browser projects are `chromium`, `firefox`, `webkit` and `iphone`, and CI runs one job per project.
  - `SNAPSHOT_QUALITY` is read at `make-snapshot.mjs:179`, and `E2E_PORT` at `urls.ts:22`.
  - There are 22 graphics-era module variables (`worker.ts` 485-512).
  - The CI lists N5 names are `web.yml:50` and `action.yml:37`.
  - The census folder holds `css.mjs`.
  - `main` is protected (root `CLAUDE.md:93`); the plan never tells an agent to push. Nothing in the plan touches
    `_vendor/`, `tests_opendta/` or `legacy/`.
- **Consistency.** The icebox's last entry and section 8 list the same four leftovers plus R1, and the proposal's status
  line points at the plan.

## What I ran

Only reads: `git log`, `git status`, `git branch`, `git diff --stat` against local branches, `grep`, `sed` and `awk`
over `web/`, the docs and the workflows. I ran no tests, no build, no e2e and no N7 trial.

## Not checked

- Reports 04 and 07 to 10 beyond what the proposal quotes. Each item's file list beyond the rows cited above. Whether
  B2 or B4 also edit `ResetDialog.tsx`, which C1 edits (likely, not confirmed).
- Whether `cm.ts` loads under Node, whether Biome can express N1's rules, and whether the real worker can be driven under
  Node.
- The token figures. Whether S2's first half also edits `state.ts` while S5 runs.
- `web/CLAUDE.md` in full, SPEC, and `docs/test-map.md` beyond the lines cited.

## Left behind

Nothing. No process, no scratch folder, no file changed in the worktree.
