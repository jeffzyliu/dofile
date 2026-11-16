# 11: Review of the web audit plan

**Reviewed:**
- The plan: `.claude/orchestrate/20261116-0411-web-audit-plan/plan.md`, 268 lines, read in full on 2026-11-16.
- Its ten sources: reports 01 to 10, all read in full (04 and 09 with lines cut at 260 to 600 characters).
- The code: the worktree `.claude/worktrees/web-audit-plan`, detached at `origin/main` 145a557. Read by grep and targeted reads only.
- The repository rules: `web/CLAUDE.md` lines 40 to 135, and `docs/phase2-plan.md` "The audit" (lines 76 to 112).

**Verdict: accept after fixes.**
- The diagnosis is accurate. Every fact in section 1 that I checked holds in the code, and the citations are faithful.
- The recommendation of proposal B is argued from the reports.
- Five errors would send a builder or the next orchestrator the wrong way:
  - proposal A's run order drops B1;
  - C1 breaks a test that the plan doesn't mention;
  - N1 contradicts itself;
  - the `DOFILE_EDITOR_BASE` facts are wrong;
  - N5 silently breaks two CI file lists.
- Each one is fixed by changing a few sentences in the plan. None of them changes the approach.

## Must fix

**M1. Proposal A, run "as phases 1 and 3", never schedules B1 (plan lines 125, 164, 182).**
- The case:
  - A's item list has B1 ("Uploads and 'Restore the sample' write inside the file turn"), and A's "For" says it "closes ... the upload bug".
  - Section 5 says "A is phases 1 and 3 only".
  - The phase 1 row is "B2 then B3; B4, B5; C1 to C4". B1 appears in no phase, only inside S2 ("Absorbs B1"), and S2 is phase 2.
  - An orchestrator that runs A from the table ships no upload fix.
- A second problem inside A: rule 2 says "a bug item starts with a failing test".
  - Save, the other half of the race, lives in `Editor.tsx:245-280`, and the Node tests stub `editorCommands` (03-F2).
  - Report 03 gives its race tests "Needs: 1" (Save moved into a controller), and A has no S1.
  - So under rule 2 the A builder may only be able to report B1, not fix it.
- Smallest fix:
  - Put B1 in the phase 1 row, marked "A only; in B it is done by S2".
  - Say how B1's failing test is written without S1: a Save simulated as `fileTurn(() => store.write(...))` in `files-ui.test.ts`, or an e2e test.
- Confirmed by reading the plan's lines 125, 164 and 179-184, `actions.ts:251-278` and `Editor.tsx:245-260`.

**M2. C1 fails `test/imports.test.ts:498-502`, and the plan does not say so (line 80; phase 1 in both A and B).**
- The test:
  ```ts
  const keyed = [...css.matchAll(/\[data-engine([^\]]*)\]/g)].map((m) => m[1]);
  assert.deepEqual(keyed, ['^="other-tab"'], "one rule, by prefix: other-tab-idle and other-tab-taking");
  ```
  It requires exactly one such rule in `app.css`, and the only one is at `app.css:60`.
- C1 moves that rule into the view, so `keyed` becomes `[]` and `npm test` fails.
- Every rule the plan gives forbids the obvious edit:
  - rule 1 ("a refactor changes no test expectation ... a separate pull request");
  - rule 4 ("no rule in imports.test.ts is weakened without its replacement");
  - web/CLAUDE.md:87-88 ("fix the code, not the test, unless the rule has changed").
- N1 does not cover this test: it names only "the old-names blacklist and the cast counts". In proposal A there is no N1 at all.
- Report 09 (W7) missed the test too.
- Smallest fix: C1's text says the rule changes, names the replacement ("app.css has no `[data-engine` selector"), and lands as its own pull request that changes the test.
- Confirmed by `grep data-engine` (one hit, `app.css:60`) and by reading the test.

**M3. N1 tells the builder to delete two rules and also to replace every removed assertion (line 60).**
- N1 says both "each removed assertion gets its replacement in the same change" and "delete the old-names blacklist and the cast counts". Risk 2 adds a reviewer "whose only job is to match each deleted assertion to its replacement". For these two deletions there is none to match.
- Both rules are stated in web/CLAUDE.md:
  - line 70-73: "Nothing outside it decides a state ... (a test greps for the old ones)";
  - line 85: "`machine.ts` is pure with two casts".
- Lines 82-88 list every imports.test.ts rule by name. N1 would leave those lines describing tests that no longer exist, and no item says to edit them.
- Report 07 recommends deleting both, so the substance is defensible. But removing a rule that the maintainer wrote into CLAUDE.md is the maintainer's call.
- Smallest fix:
  - Move "delete the blacklist and the cast counts" into section 8 as a decision.
  - Make N1's brief include the web/CLAUDE.md:82-88 rewrite, and the line 73 and line 85 clauses.

**M4. The `DOFILE_EDITOR_BASE` facts in section 8.2 and S9 are wrong (lines 106, 239-240).**
- The plan says: "No workflow, script or doc sets it; only tests do. Delete the mode (about 60 lines in six places)".
- From `git grep DOFILE_EDITOR_BASE\|EDITOR_BASE` over the whole tree:
  - **Workflows, npm scripts, web/README.md, web/CLAUDE.md: none.** That part holds.
  - **"only tests do" is false.** No test sets it. `test/site.test.ts` branches on it (145, 155, 224, 238) and pins `urls.ts:43` verbatim (183). The e2e specs read the `EDITOR_BASE` constant (`landing.spec.ts:10-14, 396-405`, `sample.spec.ts:6, 126`).
  - **Docs do describe it.** `docs/design/SPEC.md:1539, 1556, 1571, 1590` (section 8, "URLs" and "Builds"), and `docs/phase2-history.md:379`. SPEC:1571 already says it is "a one-origin layout the scripts and the e2e tests no longer build". That supports deleting it, but SPEC section 8 must change in the same pull request, and the plan does not say so.
  - **"six places" is the count of the `vite.config.ts` branches only** (10-F3). The deletion also touches `urls.ts` (13, 43-44), `site.test.ts` (at least 5 sites), and `measure-startup.mjs` (37, 59, 150, 240). After a deletion those files would use a constant `/`.
- Smallest fix: restate it as "set by no workflow, npm script or doc; documented in SPEC section 8; tests and e2e read it". List the SPEC section 8 edit and the site.test.ts edits in S9.

**M5. N5's rename of the `.mjs` scripts silently breaks two CI file lists (line 64; phase 0).**
- The lists:
  - `.github/actions/build-web/action.yml:37`, the snapshot cache key: `hashFiles(..., 'web/scripts/make-snapshot.mjs', ...)`;
  - `.github/workflows/web.yml:50`, the ENGINE path filter: `^web/scripts/(make-snapshot\.mjs|check-snapshot\.mjs|...)$`.
- After `make-snapshot.mjs` becomes `make-snapshot.ts`, nothing fails, because `hashFiles` ignores a missing file and the regex simply stops matching. Then:
  - a later pull request that changes only `make-snapshot.ts` or `check-snapshot.ts` skips the snapshot job, so `check-snapshot` does not run;
  - and it reuses a cached snapshot built by the old script.
- A merge to `main` deploys the result.
- Report 10-F7 names both lists. The plan cites F7 under S9, which is phase 2, after N5.
- N5 also forces doc edits that the plan doesn't list: web/CLAUDE.md:121 (`scripts/check-snapshot.mjs`), `docs/browser-engine.md:7, 89, 91` (commands that name the `.mjs`), and `docs/design/SPEC.md:1548` (`measure-startup.mjs`).
- Smallest fix: N5's text names the two workflow lists and the three docs. Or keep the snapshot scripts as `.mjs` until S9 generates the lists from one table.
- Confirmed by `sed` of both workflow files and `git grep "\.mjs"` over `docs`, `web/CLAUDE.md`, `.github`.

## Should fix

**S1. Rule 1 ("a refactor changes no test expectation", line 189) cannot hold for the plan's own moves. The rule needs an exception for tests that pin structure.** Cases:
- **S6** makes `dialog`, `phoneTab` and `activeTab` owner-written. That breaks `imports.test.ts:436-451`:
  - it asserts `dialog`, `activeTab` and `phoneTab` "stay writable";
  - it asserts the count is exactly 13.
- **S5** splits `CommandLine.tsx`. That breaks `imports.test.ts:504-509`, the `ignoreHeldEnter` count of 3 in that file. N1 cites 07-F4, but its text doesn't say what replaces this count.
- **S3, S4 and S5** split components. 08-E5 counts about 150 e2e uses of the app's own CSS classes, which break on a class rename. 08 item 4 (move those selectors to roles before the refactor) was dropped from the plan.
- **site.test.ts:112-113** pins verbatim lines of `env.ts` and `banners.tsx` (07-F7, 07 item 2). N1 covers only imports.test.ts.

Fix: rule 1 applies to behaviour tests. A test that pins a path, a count or a class changes in the move's pull request, and the change names the rule it keeps. Add 07-F7 to N1, and add 08 item 4 to N3, or say in section 8.6 why each is left out.

**S2. Phase table: C3 is scheduled twice, and phase 1 has no lanes assigned (lines 182-183).**
- C3 appears in phase 1 ("C1 to C4") and again in the phase 2 engine lane ("C3, S7, S8").
- Phase 1 gives the lanes "engine, controllers, views" but doesn't say which item goes in which lane. Several items share files:
  - `app/engine.ts`: B2, B4, B5 (`connectEngine`), C2 and C4;
  - `states/words.ts`: B4, C1 and C4;
  - `client.ts` and `worker.ts`: B2, B3, B4 (`reasonOf`) and C3;
  - LogView: B2 (`LogView.tsx:280`) and B5.
- Risk 6 says "items on the same file run in series". Phase 1's table doesn't show which items that makes serial.
- Fix: delete C3 from one phase, and give phase 1 named lanes with their items.

**S3. Proposal B claims theme 6 closed, but nothing in A or B states the phone breakpoint once (lines 27, 44-45, 132).**
- Theme 6 and goal 5 both name "the phone breakpoint six times".
- The only item that does it is R4 ("one phone switch"), which is proposal C. 09's W3 has no counterpart in A or B.
- Fix: add 09-W3 to S10, or change B's row to "6 except the breakpoint".

**S4. N4 deletes `poc.spec.ts` with a `beforeunload` test as its only replacement (line 63).**
- 08 item 1 asks to keep poc's other flows live before deleting it: "Run doesn't save; Save does; reload brings the text back" and "a switch with unsaved edits asks". 08 also says their coverage in editor.spec.ts:59 and files.spec.ts:115 is unverified.
- The maintainer's audit list says poc "is rewritten with the page", not deleted.
- N4 also forces doc edits it doesn't list:
  - web/CLAUDE.md:92-93;
  - web/README.md:97;
  - docs/test-map.md:194 and 269;
  - docs/design/SPEC.md:1462, 1464 and 1696 (poc, and step2 too).
  Rule 5 names only test-map.
- Fix: N4 verifies those two flows are covered elsewhere or ports them, and lists the doc edits.

**S5. B1 and S2 drop report 03's caveat on turns (lines 70, 99).**
- B1 says "Uploads ... write inside the file turn".
- Report 03 item 2: "Turns are per write, never per upload ... `uploads` ... does not join `turns` (a clash dialog would hold every Save)".
- A builder who wraps `uploadNow` in `fileTurn` makes every Save wait while the visitor sits at a clash dialog.
- Fix: write the caveat into B1's text: "one turn per write and its reopen, not per upload".

**S6. B3's "simple version" names half the change (line 72).**
- The page-side clear is only half. 01's item 1 also has the worker stop clearing at `worker.ts:934`; without that, a Break pressed after the send is still wiped when `runNow` starts.
- The Python side (02-F9) is also involved: `browser.py:96-99` calls `clear_break()` before `_busy = True`, and `_on_interrupt` drops a SIGINT while not busy. 01-F1 already suspects this.
- Rule 2's failing test should catch an incomplete fix, but the brief should say it.
- Fix: list the three layers, `client.ts`, `worker.ts:934` and `browser.py`. Note that a Python change means a new wheel and snapshot, and that browser.py falls under the root CLAUDE.md's Python rules (ruff).

**S7. High-severity findings dropped without a word (not in any item, not in section 8.6):**
- **08-E3**: 29 `waitForTimeout` sleeps that "guard the focus handoff and write ordering code the refactor will touch" (08 item 5: run them 10 times on the iPhone project first). Risk 1 calls e2e "the only net under the views".
- **05-F5 / item 3**: the editor's rAF scroll restore. This is the maintainer's own "timers waiting for a render".
- **09's gate**: "W1 [visual baseline] ... gates W2-W7". S10 and C1 proceed without it, and only R4 adds a baseline.
- **10-F9**: `wheel` deletes the repo-root `dist/` wheels, which the Python release also uses.
- **10-F10**: `site-pages.ts` parses `browser.py` with a regex.
- **10 item 8**: `measure-startup.mjs` and `compare-pytest.mjs`, reachable only by hand.
- **01-F7**: tickets are per worker; web/CLAUDE.md's "each asynchronous request gets a Ticket" overstates this. B leaves the doc wrong, and only C's R2 addresses it.

Fix: add each to an item or a sweep, or to section 8.6 with a reason.

**S8. Maintainer's "The audit" items, Tests line, neither included nor listed in section 8.6:**
- "one Playwright test of a streamed run in a real browser" (also 05-F9 and item 8);
- "`check-pytest` and `check-numeric` run by hand";
- "Tab out of the open ⋯ menu at phone width". This can be argued to be accessibility, which the maintainer de-prioritised; say so.

**S9. Scope: no sweep region and no survey covers part of `web/` (line 87-88).**
- Regions no sweep names:
  - `src/stata/` (`language.ts` 137 lines, `quote.ts`, `straighten.ts`; only grepped);
  - `src/site/filter.ts` and `theme.ts`, not read by anyone; report 10 read `site.ts`, `commands.ts` and `landing.ts`;
  - `web/sample/`, including `make_sample.py`;
  - `web/wheels/` (`build.sh`, `emscripten.patch`);
  - the bodies of `landing.html` and `commands.html` (10: "Not read");
  - `biome.json` (10: "Not read").
- `editor/csv.ts` was not read by 05, though its W3 region implies it.
- Section 6 says "The ten surveys read all 12k lines of source once". That is false, and section 9 does not list these gaps.
- Fix: assign them to regions (W3 takes `src/stata/` and `csv.ts`; W7 takes `src/site/`, `sample/`, `wheels/`, the HTML pages and `biome.json`), and correct section 6.

**S10. The case against C overstates its evidence (lines 15, 156-159).**
- "Nine of ten survey agents answered 'no redesign, tidy it'" is wrong. Three of the ten don't say that:
  - 05 answered "Yes, W1" (adopted as S1);
  - 10 answered "Yes, one: a plain build contract" (R5);
  - 04, the census, had no redesign question.
  So it is seven of nine.
- "The survey does not support it" is therefore unfair to R5. 10 recommended it, "together with item 3", which is S9.
- "R4 moves 1,300 lines of CSS with no visual check today" argues against a version of R4 the plan didn't write: R4's own text begins with "a Playwright screenshot baseline first".
- Fix: correct the count; argue R5 on cost; argue R4 on the baseline's cost and on its value before the later UI work.

**S11. S10's dark palette (line 107) reopens a recorded decision.**
- `docs/design/SPEC.md:1760` is DS-6: "`light-dark()` needs Safari 17.5. Not now: `contrast.mjs` already fails if the copies differ."
- Fix: cite DS-6 and make it a maintainer decision, not a builder's "if the browser floor allows".

## Nice to have

**N1. Citations that the item text doesn't reflect:**
- B4 cites 01-F8 (`app/engine.ts:303-305`, only `"op"` errors become events), but its text is about run.ts (03-F13).
- S7 cites 01-F9 (wiring) and 01-F10 (the performer writes `S.dialog`), but its text covers neither.
- Fix: add them to the text, or drop the citations. `S.dialog` at `app/engine.ts:369-373` is really S6's.

**N2. Two claims in section 1 are slightly off.**
- Line 32: "Theme 3 holds all three of step 3.5's engine gaps plus the icebox upload bug". Gap 1 (Break) is B3 and is not in theme 3's row, and the upload bug is theme 2.
- Theme 6: "engine-state sets in ten view sites". 05-F12 and 06-F6 together list 11 or 12; this is harmless.

**N3. The cost table can't be checked for proposal C.**
- Counting each M+M part as a builder, A gives 17 and B gives 42. Both match the plan.
- C is "B plus R1 to R7", but R1, R2, R3, R4, R5, R6 and R7 each say what they replace, so C is B minus the replaced parts plus 7, and that is under 49. "About 60" needs R sizes, which the R table doesn't give.
- B's "5 orchestrator sessions" doesn't follow from "one orchestrator session per phase" with 4 phases.
- All of these are labelled as guesses (section 6). Only the internal arithmetic is at issue.

**N4. B2 should carry 02-F14.** `onblocked` can't fire at version 1. If B2's version-change handling bumps the database version, an open can leave an orphaned connection.

**N5. A lane in phase 2 shares `state.ts`.** S1 (dirty derived, `tabs[].dirty`) and S5 (App.tsx's `toggleWrap` and `setSplit` into "a state or controller module") are in parallel lanes, and both are likely to edit `state.ts`.

## Answers to the brief's direct questions

1. **Facts.**

   | Claim | Holds? | Evidence |
   |---|---|---|
   | (a) Editor.tsx: four parallel per-file Maps, and Save's store write | Yes | `states`, `savedText`, `forms` and `scrolled` at lines 47-54, plus the `saving` Set; `store.write` at 257 |
   | (b) `files/actions.ts`: two separate promise chains | Yes | `turns` behind `fileTurn` (50-60) and `uploads` (251-267); the upload's `store.write` at 278 is outside `fileTurn` |
   | (c) `storeError` has no reader under `src/app/` | Yes | Its only readers are `client.ts` and tests |
   | (d) `imports.test.ts` pins exact signatures, call counts and cast counts | Yes | Lines 250-363: `bodyOf` with literal signatures, `as` counts 2 and 1, `enqueue(` 3 |
   | (e) `DOFILE_EDITOR_BASE` is set by nothing | Partly | See M4 |
   | (f) `beforeunload` is tested only in the fixme `poc.spec.ts` | Yes | It appears only in `e2e/poc.spec.ts:130-133`, which is under a file-level `test.fixme` |
   | (g) The `other-tab` CSS rule exists | Yes | It exists; moving it conflicts with imports.test.ts:498 (M2) |
   | (h) `dialog` is written from about 8 files | Yes | Exactly 8 files (13 writes); `phoneTab` 6 files, `activeTab` 3 |

2. **Fidelity.**
   - Sampled 24 citations: themes 1-7, N1-N4, B2-B5, C1-C4, S1-S5 and S8. All say what the plan uses them for, except the two in N1 above.
   - Dropped findings are listed in S7 and S8 above.
3. **Order.**
   - **N1 before B2, B3 and C3.** Not needed. Their described changes touch no pinned text: `#send(live, "run"` stays one call, and no `enqueue` or cast is added. The pins even act as an extra net there. N1 is needed before S5, S6, S7 and S8, which change pinned files.
   - **Sweeps last.** This is consistent between A and B: A is phases 1 and 3, so sweeps last in both.
   - **S6 after S3.** Correct (06 item 5, "After: 4"). The serial lane also puts S6 after S1 and S2, which it needs, because it edits `actions.ts`, `open.ts` and `Editor.tsx:411`.
   - **C1/S5 and C4/S2.** These are in different phases, so they don't collide.
   - **N3 and N5.** "N3 with N4, then N5" reads as one serial lane. That is not explicit; it should be, because both edit `e2e/`.
4. **Rules.** M2, M3, M5, S1, S4, S6 and S11. Nothing in the plan breaks the iOS one-file worker rule (S8 says imported modules, not chunks), the clean-room rules, or "main is protected". Risk 5 covers "a merge deploys".
5. **Proposals.**
   - They are distinct and coherent, apart from M1 and S3.
   - A works without N1, except for C1 (M2).
   - The case for B rests on report evidence. The case against C is partly unfair (S10).
6. **Scope.** S8 and S9.

## What I ran

- Read-only commands: `grep`, `git grep`, `sed`, `wc`, `git ls-files`, `git log`, over the worktree and the reports.
- About 40 tool calls.
- No tests, builds or scripts.
- I changed nothing but this file.

## Not checked

- E2e and unit test bodies, beyond imports.test.ts:250-536 and poc.spec.ts's grep. In particular, whether editor.spec.ts or files.spec.ts already cover poc's flows (S4).
- Whether Biome's restricted imports can express N1's rules.
- Whether `cm.ts` loads under Node.
- Whether e2e and the configs pass `tsc` (N5).
- The token, cost and session figures beyond their internal ratios. 4.5 / 2.8 is about 1.6, as stated.
- The claims about local `main` (0430fd2) and `ponytail`.
- `docs/web-engine-data-flow.md` and `docs/test-map.md`, beyond what is quoted above.
- Whether `.hover` and `.focusrow` are still used by `docs/design/` pages; the plan states this as an assumption.

## Left behind

Nothing. No processes and no scratch files; this report is the only file written.
