# Web audit log

The audit's own record (docs/web-audit-plan.md section 3): one section per phase.

## Phase 0 (session 1, branch audit/0-nets)

### The pull requests

All eight went into audit/0-nets by merge commit, each after its checks passed. Builder and reviewer give model and
effort. A fix round was by the builder, or a fresh agent of the same tier or above.

| PR | Item | Merge commit | Review and verdict | Builder | Reviewer |
|---|---|---|---|---|---|
| #76 (0.8) | R5 note, `docs/design/staging.md` | 2381f9f | rv-r5: accept after fixes (1 must-fix: N7's baseline must use snapshot and `build:local`) | Sonnet, medium | Sonnet, high |
| #77 (0.2) | N2: `app.test.ts` split | c2c95a3 | rv-n2: accept | Sonnet, medium | Sonnet, high |
| #78 (0.1) | N1: architecture tests without text pins | 87e7541 | rv-n1: accept after fixes (1 must-fix: a GritQL pattern that never matched) | Sonnet, high | Opus, high |
| #79 (0.7) | S0: `docs/design/workspace.md` | 731cc03 | rv-s0: accept after fixes (1 must-fix: an upload's check and write around the clash dialog); rv-s0b: accept | Fable, high; fixes Opus | Opus, high |
| #80 (0.3) | N3 (a and b) and N4 | f55b830 | rv-n3a, rv-n3b: accept after fixes, then accept; rv-n4: accept after fixes (1 must-fix: a lost newline) | Sonnet, medium | Sonnet, high |
| #81 (0.4) | N5: tooling under `tsc` | 43d88fa | rv-n5: accept | Sonnet, medium | Sonnet, high |
| #82 (0.5) | N6: `settle`, the timer rule, a streamed-run test | 18b6189 | rv-n6: accept after fixes (0 must-fix); the fix (37ed486) was read by the orchestrator, with a planted timer, not by an agent | Sonnet, medium | Sonnet, high |
| #83 (0.6) | N7: the screenshot run | 66e10a0 | rv-n7: accept (should-fix: the pixel threshold, applied in 2316a2a and read by the orchestrator) | Sonnet, medium | Sonnet, high |

### Rule 7: what the re-check found

Two read-only surveyors (Sonnet, medium) checked N1 to N7 against `main` at e711ba0. No finding was dropped. Where
the item changed shape:

- **N1.** `site.test.ts` lines 75 and 415 are text pins of the same kind as 112-113: in scope. The old-names clause in
  `web/CLAUDE.md` (line 72) goes with the blacklist. Biome 2.6.6 has no type-only import rule, so the type-only checks
  stay as a test.
- **N2.** As planned: 67 tests in 2,486 lines.
- **N3.** Larger than its row: 63 lines that write a signal and 46 that seed through calls (the row said about 25), about
  215 app-owned class locators (about 150), 8 copies of the hook type (3). Split in two: N3a (the typed hook, write
  helpers, fixtures) and N3b (selectors to roles, in two builders: about 270 locators).
- **N4.** `poc.spec.ts` has 4 tests, not 5, and its two flows were not covered elsewhere: both were ported. No live test
  of the `beforeunload` guard existed: one was added.
- **N5.** The rename of six `.mjs` files reaches more than the row named: `package.json`, `site.test.ts:195`, and
  the docs.
- **N6.** 29 sleeps; the row's range held only 8 of editor.spec's 15. The 7 outside it are in scope where they guard
  focus or write order. 15 sleeps became `settle`; 14 stay, each with its reason in `docs/test-map.md`. Added after
  the review, at the maintainer's remark that a late focus error would no longer be tested: a GritQL rule that forbids
  `.focus(` and store writes inside `setTimeout` and `setInterval` in `src/app`.
- **N7.** 25 states on each of two projects, none dropped. The status bar's last-run time and memory are pinned through
  `seedStatusBar`, not masked.

### Flaky tests seen

- `graphics.spec` "a return visit reads the part from the Cache": 1 failure in 10 iphone repeats, on the N6 branch. A
  test artefact (the counter was reset while the first visit's worker still wrote the part). Fixed in 37ed486: the
  test waits for the first visit's write; 10 iphone repeats after the fix passed (20 runs: the filter matched two tests).
  Not seen in CI.
- None at G0. None at the end gate.

### Known gaps

- **`settle` and timers.** `settle` covers tasks, microtasks, effects and frames (about 3 frames, 50 ms). A late move
  from a timer longer than that escapes it. The GritQL rule sees only a direct call in a timer callback, not a function
  that focuses.
- **N7's 30 pixels.** The run compares with threshold 0 and `maxDiffPixels` 30 (measured noise at most 14 pixels over
  5 compares). A change under 30 pixels in one state passes. Baselines are per machine. Firefox and WebKit are not shot.
  Scheduled: the N7 tightening in the plan's phase 2.
- **`measure-startup`, normal mode, timed out at 300 s** in rv-n5's run. Cause unknown; not known whether it predates
  N5.
- Unit tests without a snapshot skip 5 and leave out 15; CI's `unit` job has no snapshot, its `memory snapshot` job
  has one (engine paths only). Engine items snapshot first (plan section 7).
- No test of a CRLF file through upload, run and download.

### Gate G0, on main e711ba0 (2026-11-16, macOS, worktree .claude/worktrees/audit-0)
| Check | Result |
|---|---|
| `npm ci` | ok; npm warns that esbuild, fsevents and workerd have install scripts not covered by allowScripts (build and e2e still worked) |
| `npm run check` | pass |
| `npm run lint:strict` | pass |
| `npm test` (before a snapshot existed) | 368 pass, 5 skipped, 0 fail (59 s) |
| `npm test` (after the snapshot) | 388 pass, 0 skipped, 0 fail (71 s): the 5 skipped run and 15 more tests exist when a snapshot is present (373 -> 388) |
| `SNAPSHOT_QUALITY=5 npm run snapshot` | ok (91 s; 33.7 MB compressed) |
| `npm run check-snapshot` | ok: 107 compat cases, 0 differ, 0 timed out, 0 crashed; 2 differ as expected (missing package) |
| `npm run build` | exit 1: refuses to build without DOFILE_URLS (by design, `scripts/urls.ts`); G0's command was wrong |
| `DOFILE_URLS=production npm run build` | ok |
| `SNAPSHOT_QUALITY=5 E2E_PORT=5411 npm run e2e` (all four projects) | 722 passed, 66 skipped, 0 failed, 0 flaky (4.3 min); run beside four builder agents |

Flaky tests seen at G0: none.

### End gate, on audit/0-nets at 66e10a0 (2026-11-16, same worktree)
| Check | Result |
|---|---|
| `npm ci` | ok; the same install-scripts warning |
| `npm run check` | 0 errors |
| `npm run lint:strict` | 0 |
| `npm test`, no snapshot | 363 pass, 5 skipped |
| `SNAPSHOT_QUALITY=5 npm run snapshot` | ok (20 s) |
| `npm test`, with the snapshot | 383 of 383, 0 skipped (388 at G0, less 5 tests N1 folded into others) |
| `npm run check-snapshot` | 107 cases, 0 differ (2 differ as expected) |
| `DOFILE_URLS=production npm run build` | ok |
| `E2E_PORT=5411 npm run e2e`, all four projects | 738 passed, 54 skipped, 0 failed, 0 flaky (6.4 min) |

Not checked at this gate: the preview on a real phone (the maintainer's, before the merge to `main`), Firefox and WebKit
screenshots.

## Phase 1 (session 2, branch audit/1-bugs)

Bugs and names, cut from main 7b3e466. Run 2026-11-17. The branch ends at f3f09a4 and goes to `main` as one pull request
(the maintainer merges, by merge commit, after the preview).

### The pull requests

Each went into audit/1-bugs by merge commit, after its checks passed and after a review. Builder and reviewer give model
and effort. A fix round was by the builder (the same agent).

| PR | Item | Merge commit | Review and verdict | Builder | Reviewer |
|---|---|---|---|---|---|
| #85 | C1: engine-state predicates stated once (`states/predicates.ts`) | ddb529e | rv-c1: accept (0 must-fix; 2 should-fix, done in 8a0f6c9: a reversed pair escaped the regex, PhoneRun not in e2e) | Sonnet, medium | Sonnet, high |
| #86 | B2: store failures are shown | 56c5794 | rv-b2: accept (0 must-fix; 2 should-fix, done: the order of result and folderError was untested, the store-failed banner was not dismissed on a later ready) | Opus, high | Opus, high |
| #87 | B3: a Break pressed before the worker takes the run is kept | 7be07ac | rv-b3: accept (should-fix: an engine test was masked by the repeat, done in 14753e0) | Opus, high | Opus, high |
| #88 | B5: one `describe_file` per `.dta` version, the full-size viewer's Copied timer, Find's ref | fb35d17 | rv-b5: accept (0 must, 0 should) | Sonnet, medium | Sonnet, high |
| #89 | B4: decide from kinds, not message text | 9feec50 | rv-b4: accept after fixes (1 must-fix: `worker.onerror`'s ErrorEvent has no `name`, so a memory crash was lost; should-fix: 01-F3 was broader than reported, and SPEC's run-op row) | Sonnet, medium | Sonnet, high |
| #90 | C4 and C2 as one item (1.4): the visitor's words in `states/words.ts`, one sizes module, one UTF-8 decode, one reload of a tab from bytes; no import cycle in `src` | f3f09a4 | rv-c4c2: accept (should-fix: `engine.ts` re-exported the words for tests, done in c6d2594) | Sonnet, medium | Sonnet, high |

B2 was merged right before B3, once B3's checks were green (the maintainer: "Q3 wait for B3").

### Rule 7: what the re-check found

Two read-only surveyors (Sonnet, medium) checked the six items against `main` at 7b3e466. No finding was dropped. Where an
item changed shape:

- **B3.** The three small edits of the row do not close the gap as written (see "B3's record for R2" below). A Python
  change was needed (`_on_interrupt` dropped a Break while `_busy` was false).
- **B2.** No version bump needed.
- **B4.** The memory crash cannot be told from the name alone; the worker had to send the Python exception type.
- **C4.** The byte formatters are not where the survey said (`output/format.ts`, `files/tree.ts`, two "mb" helpers). The UTF-8
  unification depended on C2's cycle break, so the two went as one item.
- **Overlaps.** B2, B3 and B4 share `client.ts` and `worker.ts`; B2 and B4 share `machine.ts`, `types.ts` and `words.ts`;
  C1 and B5 both edit `DtaView.tsx`. Each pair ran in series (B4 after B3 and C1; B5 after C1 and B2).
- **C1 and B5.** C1 had more sites than surveyed. For B5, the find-bar ref read is real but likely unreachable; the
  `describe_file` doubling is real on remount; the FullSize timer was present.

### Flaky tests seen

- **WebKit, `editor.spec.ts:1514` "Break: the run stops before a line ..."**, rc 9998 instead of 1 (the Break was not taken
  within the grace, the engine was reset). Sightings in CI: PR #85 (run 44020311714), PR #86 (runs 44022218871 and
  44028735960), PR #87 on its first push (run 44030555279, rc 1 but "before line 1"). Each passed on a re-run of the
  failed job; the first result was a failure each time. PR #84 passed it. Not in the known-flaky list at the start.
  - Cause, found by B3, two parts. (1) A Break that reaches `browser.py` while `_busy` is false was dropped: the page
    pressed Break while an op (describe, warm_graphics) or the first bytecodes of `run()` were ahead of the run. Fixed by B3.
    (2) Pyodide's `_Py_CheckEmscriptenSignals_Helper` reads the interrupt buffer and then writes 0 as two steps, so a
    SIGINT stored between them is lost: 8 of 2350 in Node (0.34%), about 1 in 100 on this machine's WebKit. Covered by
    B3's 100 ms repeat of SIGINT while the run is live (the root fix is in the icebox).
  - The "before line 1" failure on #87 was the test's precondition: the Break came about 0.8 s after the page showed
    "running" and before the worker had started the first command. B3 changed the e2e to wait for `pass N` in the Log,
    and the engine test asserts `error_line` 1 for a Break taken before the worker starts.
  - Local WebKit runs of that test: before B3 1 of 10 failed; after B3's first fix 2 of 130 failed; with the repeat 100 of
    100 passed; round 4, 30 each on webkit, chromium and iphone: 90 of 90 (a first try without the 800 ms wait failed
    28 of 30 on iphone: the phone's Break pill ignores a tap in its first 600 ms). Green on CI since, and at the end gate.
- **rv-b2's first `npm test`** exited 1 within seconds and wrote no log (it ran right after `npm run check` in one script).
  Cause not found; the re-run passed (388 of 388). A sighting, not explained. Not seen again.
- None at the end gate (0 failed in e2e).

### B3's record for R2

The plan asked B3's builder to record whether the three small edits close the gap, and the tests added.

- **Do the three small edits close the gap? Not as three small edits.** (1) The send-time clear in `client.ts` and (2)
  dropping `worker.ts`'s clear at run start are needed, but not enough: a Break that Python reads during an op ahead of
  the run (describe, browse, macros, memory, warm_graphics) is still dropped by the `_busy` guard. (3) "`browser.py` must
  not drop" cannot be a Python flag: a flag set at the end of `run()` cannot be told apart from one set at the top of the
  next run, so it would stop the next run.
- **What closes it.** `client.run()` stores 0 in the interrupt buffer as it posts the run (a Break from before belongs to the
  run before). The worker installs Pyodide's buffer only around `browser.run` (`py.setInterruptBuffer` in `runNow`, removed in
  a `finally`), so Python reads it only during a run. `browser.py` puts a Break it reads while not busy back into the
  buffer through a JS function, `keep_breaks`, so that the page's send-time clear decides which run it belongs to. Put-back
  without the narrow install would race with the page's clear while a describe runs.
- **Round 2.** `client.interrupt()` writes SIGINT again every 100 ms while that worker's run is live, and stops when the run
  answers or the worker changes. A repeat after the Break was taken is harmless: while busy it only sets the engine flag
  again (cleared at the next run's `clear_break()`; `brk.check()` runs only inside commands, by reading the code, not a test);
  after `_busy` is false it is put back and the next send clears it. A lost store delays a Break by at most about 100 ms.
- **Tests added.** `tests/test_browser.py` 2 (a SIGINT before `_busy` is put back and the run takes it, rc 1; a SIGINT outside
  a run or at its end stops nothing); `web/test/client.test.ts` 3 (the clear at post; a lost store written again while the run is
  on and not after it answered; a repeat for an ended run does not reach the next run); `web/test/engine.test.ts` 2 subtests on
  real Pyodide (a Break while the run waits behind a describe stops that run, rc 1, `error_line` 1, with one write of SIGINT
  into the worker's buffer; a Break after its run ended does not stop the next). No new e2e: a page cannot reliably hold the
  worker busy at the right moment; the existing Break test now waits for `pass N`.
- **Failing first.** client.test `cleared when the run was posted`; engine.test `the Break was lost: the run went on until a second
  one`; the repeat test `written again`. The Python tests failed on the missing `keep_breaks`; the behaviour itself was
  shown by a CPython probe (SIGINT inside `_hold_ballast`, before `_busy`: rc 1 after 2.0 s, the first Break dropped).
- **Not taken, for R2.** The root fix: make Pyodide's helper read and clear the buffer with one `Atomics.exchange` through the
  patched loader. Then no store is lost and the repeat could go. Not taken because it patches Pyodide's runtime text and needs
  a re-check at every Pyodide upgrade. In the icebox. R2 (a ticket per run) should know that a Break is now owned by the
  buffer's send-time clear and the worker's narrow install, not by the engine machine.
- **Not verified.** `browser.py` reverted on its own (needs a rebuilt wheel; the timing of the run's first bytecodes cannot
  be forced); Firefox; the WebKit rate on CI.

### The maintainer's decisions of this session (2026-11-17)

The words are the maintainer's, as recorded in the session's notes.

- **R5 note** (`docs/design/staging.md`), 05:01Z: "approve R5 recommendations with warn-only for 2a". Approved: choices 1 to 5 as
  recommended; choice 3 amended: the dev server runs the read-only `staged()` check on each page load (not only at start)
  and warns "restart npm run dev" when the stage is stale; no watcher, no writer in the config. Plan row R5 is unblocked.
- **B2's visitor sentences.** 05:05Z: "2.1: B, except "the browser refused to store them" instead." and "2.2 i don't quite like any
  of them. Maybe a reference to "The engine's version of your files"?"; then 05:06Z: "A, out of date"; then 05:59Z: "a. sentence
  looks fine." Settled:
  - storage that will not open (`store-failed`, cause open): "Your files couldn't be opened: the browser refused to store them.
    Reload the page to try again."
  - a failed copy into `/work` (`store-failed`, cause copy): "Your files couldn't be loaded into the engine. Reload the page to
    try again."
  - a store of a newer version than the page's (a failed start, reason updated): "The engine's version of your files was out of
    date, so the engine was reset."
- **B4's visitor sentences.** 07:35Z: "After B4: sentence is okay, i approve." (`FAILED.unknown` for a failed cache write); 07:50Z:
  "yes" to approving all three 01-F3 cases with the added Reload button. 01-F3 changes which sentence shows: a Cache failure on
  download, a no-snapshot build, and a download error with no kind now say `FAILED.unknown` instead of "download", with a Reload
  button.
- **Decision 2, the open documents** (`docs/design/workspace.md`). 04:59Z: "i also lean towards discriminated union, but I want to
  see some evidence of its viability at some point."; 05:08Z: "i approve the spike."; 05:59Z: "decision 2, as recommended" (the
  spike builds the third shape against the same suite); 06:49Z, asked "(i) with content: Signal<TextPart | DtaPart>, or (ii) with
  the counter?": "i". Settled: one record per tab for its whole life, `content: Signal<TextPart | DtaPart>`, staleness by identity
  of the part, no counter. The note's section 2 holds the shape and the spike's evidence with its limits. Plan row S1 is unblocked.
- **The Save rule**, 06:40Z: "Q1 yes". A later reload, "Reload from the run", an upload's Replace, or a run's text shown in the tab
  cancels a pending Save of that tab: the later action wins. It covers tabs with unsaved edits. Today's code writes in those
  cases; this changes it. Written in the note's section 3; S1 puts it in SPEC.
- **Merge order**, 06:40Z: "Q3 wait for B3". B2 merged only right before B3, once B3's checks were green.
- **The byte units** (C4): kept as they were (the rule: nothing a visitor sees changes in C4). Unifying them is in the icebox,
  for the maintainer to decide.
- **Checks and spawns.** 04:33Z: "yes. restate the two things waiting on me?" (the plan, spawns, pushes, pull requests into the
  session branch, worktree removals). 08:47Z: "yes" (to run check-pytest, check-numeric, `uv run poe test tests`). 09:01Z: "yes"
  (the docs builder).

### End gate, on audit/1-bugs at f3f09a4 (2026-11-17, worktree .claude/worktrees/audit-1)
| Check | Result |
|---|---|
| `npm ci` | ok; the same install-scripts warning |
| `npm run check` | 0 errors |
| `npm run lint:strict` | 0 |
| `npm test`, no snapshot | 383 pass, 5 skipped |
| `SNAPSHOT_QUALITY=5 npm run snapshot` | ok (14 s) |
| `npm test`, with the snapshot | 403 of 403, 0 skipped |
| `npm run check-snapshot` | 107 cases, 0 differ (2 differ as expected) |
| `DOFILE_URLS=production npm run build` | ok |
| `E2E_PORT=5411 npm run e2e`, all four projects | 746 passed, 54 skipped, 0 failed (4.6 min) |
| `npm run check-pytest` | 80 files, 0 timed out (162 s) |
| `npm run check-numeric` | 107 cases, 0 timed out (271 s) |
| `uv run poe test tests` | 343 passed, 3 xfailed (23 s) |

The last three ran after the maintainer's "yes"; the permission check had refused them the first time.

Not checked at this gate: the preview on a real phone (the maintainer's, before the merge to `main`); Firefox and WebKit
screenshots; a real "copy" store failure in a browser (B2: the banner is tested with a fake failure); a real browser memory
failure (B4: the `MemoryError` type is verified in Node, in Pyodide 314.0.7); an epilogue path of a run that reaches
`brk.check()` (B3: excluded by reading the code, not by a test); Firefox on B3's Break test; `poe ci` and `poe slow`;
the unexplained first `npm test` exit of rv-b2.
