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

## Phase 2 (session 3, branch audit/2a-moves)

Moves, cut from main c5d7a85. Run 2026-11-22, in two orchestrator sessions. The branch ends at 9f3ff3e (every item of the
session merged; the end gate and the async survey fix are in the sections below). It goes to `main` as one pull request
(the maintainer merges, by merge commit, after the preview on a real phone). Not in this session: R1 and its note, S2's
second half (S3), S5, S6, R7r, C5, R5, the Run gate (plan: session 4's).

### The pull requests

Each went into audit/2a-moves by merge commit, after its checks passed and after a review. Builder and reviewer give
model and effort. A fix round was by the builder (the same agent) unless noted. "Read by the orchestrator" means a diff or
report read, not an agent review.

| PR | Item | Merge commit | Review and verdict | Builder | Reviewer |
|---|---|---|---|---|---|
| #99 | 2.0: the N7 tightening (deterministic flags, no allowance, near-miss report, 10 more states) | fcfc8bc | rv-n7: accept after fixes (1 must-fix: an unchanged build failed, allowances too tight); rv-n7-fix: accept after fixes (1 must-fix: the engine size text, "about 49 MB" against "50 MB", varied per build; seeded). The last fix (a33f5e9) was read by the orchestrator | Sonnet, medium | Sonnet, high |
| #93 | C3: the part header's layout in `lazy-part.ts` | 5d431d2 | rv-c3: accept (0 must-fix; should-fix: a file header, done by the orchestrator) | Sonnet, medium | Sonnet, high |
| #94 | S9a: `scripts/lib`, the wheel in `web/.wheel`, `commands` through a temp file | 9262e6a | rv-s9a: accept (0 must-fix; should-fix: CI's engine regex and the snapshot key must cover all of `lib/`, and docs said root `dist/`: fix round; the fix read by the orchestrator) | Sonnet, medium | Sonnet, high |
| #95 | S9b: denied commands into `commands.json`, every knob in the manifest, tools moved to `web/tools/` | 273c5c9 | rv-s9b: accept (0 must-fix; should-fix: a README row, done; no path that ships asked for a quality knob: S9c) | Sonnet, medium | Sonnet, high |
| #96 | S7: per-start facts on the client, the controller's wiring record | 9d871ad | rv-s7: accept (0 must-fix, 0 should-fix; mutations caught) | Opus, high | Opus, high |
| #97 | S9c: `vite.config.ts` split, `EDITOR_BASE` deleted, `SNAPSHOT_QUALITY=11` on the deploy freshness check | 7337453 | rv-s9c: accept (0 must-fix, 0 should-fix) | Sonnet, medium | Sonnet, high |
| #98 | S8a: the `/work` mirror (`work-mirror.ts`) | 8ba36fa | rv-s8a: accept (0 must-fix, 0 should-fix) | Opus, high | Opus, high |
| #100 | S8b: boot and loader (`worker-boot.ts`) | f89e2ac | rv-s8b: accept (0 must-fix, 0 should-fix; nice-to-haves done by the orchestrator) | Opus, high | Opus, high |
| #101 | S8c: typed dispatch (`worker-dispatch.ts`) | 98efd19 | rv-s8c: accept (0 must-fix, 0 should-fix; the file header trimmed by the orchestrator) | Opus, high | Opus, high |
| #102 | S4a: the matrix reader as `output/matrix.ts` with Node tests | d78832e | rv-s4a: accept (0 must-fix; should-fix: the copy's capture before the await was untested, fix round, read by report only) | Sonnet, medium | Sonnet, high |
| #103 | S1a: documents as records in `documents.ts` (derived `tabs`, `activeTab`, selection, dirty) | 419e083 | rv-s1a: accept; rv-s1a-fix: accept (0 must-fix; should-fix: a rename read the store after the move, a rename during a read gave two tabs one path: 2 fix rounds); rv-s1-fixes: accept after fixes (should-fix: a rename onto a tab left open after a run deleted its file; fixed by the orchestrator in 3028d3f, checked by the same reviewer: accept) | Opus, high | Opus, high |
| #104 | S4b1: one command bar (`ui/CommandBar.tsx`) and one variables table (`output/VarTable.tsx`) | 267123d | rv-s4b1: accept (0 must-fix, 0 should-fix; 5 mutations caught) | Sonnet, medium | Sonnet, high |
| #105 | S1b: Save in `documents.ts`, the Save rule | 46618f6 | rv-s1b: accept after fixes (should-fix: a Save answer skipped when a read had started); rv-s1b-fix: accept (should-fix: a path check lost a rename: fix round 3, read by report only); rv-s1-fixes read the merges | Opus, high | Opus, high |
| #106 | S1c: the scroll snapshot per hidden tab | a892f07 | rv-s1c: accept (0 must-fix; should-fix: `docs/design/workspace.md` sketch stale, done by the orchestrator in 436a25e) | Opus, high | Opus, high |
| #107 | S2a: generator turns (`files/turns.ts`), one door for store writes, a Biome rule | b8d1e94 | rv-s2a: accept after fixes (1 must-fix: removing Save's resync broke the upload case; should-fix: the one-door rule missed `store!.write`, `store?.write` and a renamed import; the Store type allowed writes); fix check: accept at cf76ab2 | Opus, high | Opus, high |
| #108 | S4b2: one dismissible banner (`ui/DismissibleBanner.tsx`), `twiceWords` from `FILES_SAFE`, `noteFor` to `log/notes.ts` | 616e55e | rv-s4b2: accept (0 must-fix, 0 should-fix; a focus mutation caught by states.spec) | Sonnet, medium | Sonnet, high |
| #109 | B1: uploads, the first-visit sample and `openFile`'s read take a turn; `store.write` takes an expectation; the re-ask dialog | 9f3ff3e | rv-b1: accept after fixes (1 must-fix: an unbounded retry when a clash file is gone but its tab has unsaved edits; should-fix: a clash dialog could replace a dialog opened during the read); fix check: accept at cf25220 | Opus, high | Opus, high |

Order of merge: #93, #94, #95, #96, #97, #98, #100, #99, #101, #102, #104, #103, #105, #106, #107, #108, #109. Several
stacked pull requests conflicted in `web/README.md` (table rows) and were merged with the branch in, by rows. S2's second
half stays for session 4.

### Rule 7: what the re-check found

Four read-only surveyors (Sonnet, medium) checked the lanes against `main` at c5d7a85 (lane a: C3, S7, S8; lane b: S1,
S2a, B1; lane c: S4; lane d: S9). Findings dropped or cut:

- **S4 (sv-c).** About 60% was still open. 06-F7's `.dta` half is gone: phase 1's B5 (f9c65fa) put `readDta` in
  `output/dta.ts` with `test/app-dta.test.ts`, and the doubled `describe_file` is fixed. F7's matrix half stayed (S4a).
  F13c is mostly gone: C4's `megabytes` serves both the banner and the download dialog; two one-line constants remain.
  F13a (the repeated Dismiss and focus pattern) and F13d stayed (S4b2). F13b was unsettled in the survey and done in S4b2.
- **S9 (sv-d).** Every clause was live except 10-F1 (the type check misses the tooling) and 10-F12 (`.mjs` files): N5 closed
  both (`tsconfig.json` covers scripts, e2e, `vite.config.ts`, the Playwright configs; every script is `.ts`).
- **S7 (sv-a).** 01-F2 is the graphics half: not part of S7 (the plan leaves graphics to R1). 01-F6 was partly answered by B2.
- **C3.** Small: the bare 0, 1 and 2 of `client.ts` (about lines 420 to 482), no test of the header round trip.
- **S8.** Three items (mirror, boot and loader, typed dispatch). None of the 22 graphics variables moved; 8 are touched
  through hooks. The Grit rule at `biome/architecture.grit` (lines 129 to 135) limits `postMessage` to the post callback.
- **Lane b (sv-b).** All 11 findings present, none dropped; `docs/design/workspace.md` fits the code. The spike is 5 unwired
  files on a pre-phase-1 base: its tests were ported. B1's "already exists" was decided by message text
  (`FilesPane.tsx`, `actions.ts`): a store error needed a name (done in B1: `StoreConflict`).
- **Overlaps.** Each lane ran in series; S1 and S7 meet only at `main.tsx`. N7 ran after S4's new states were added.
- **Split by the orchestrator.** S4 into S4a (the matrix reader), S4b1 (bar and table) and S4b2 (banner, after S2a). S9 into
  three pull requests. S1 into three. S2 first half only.

### The maintainer's decisions of this session (2026-11-22)

The words are the maintainer's, as recorded in the sessions' notes.

- **Plans and spawns.** 06:5xZ: "yes to all." (the plan, the spawns, pushes of item branches, pull requests into the
  session branch and merges there, the end-gate Python checks, worktree removals). 07:46Z, asked about more agents: "are
  there any other agents you want? you can go above 5 at once". 09:08Z: "yes to all" (the second session's plan).
- **The deploy check** (S9c), 07:48Z: "yes, add quality 11 to the deploy check". The build-web freshness check now asks for
  quality 11; a quality-5 snapshot in the cache is rebuilt.
- **The machine**, 10:00Z: "all other sessions are closed now. you can load the machine more."
- **The orchestrator's choices on the open points of S1 and S2, accepted at 10:00Z** with "your decisions are fine for 2.":
  - *Rename refusal.* A rename onto a name that a tab left open after a run deleted its file: a clean stale tab closes and
    the rename goes through; a stale tab with unsaved edits keeps the name taken and the rename is refused with "already
    exists" (the text the file pane already shows).
  - *Scroll behaviours* (S1c). A new tab, or a tab retyped, opens at the top; a reload from the store keeps the place; a
    run's text put into a clean tab does not move it. The place is kept per hidden tab and applied after the state is set.
  - *The Save rule* (settled 2026-11-17, built in S1b). A later reload, "Reload from the run", an upload's Replace or a
    run's text shown in the tab cancels a pending Save of that tab: the later action wins. Today's code wrote in those cases.
  - *30 s per operation.* A turn's `Io` ends an operation that waits more than 30 s (`OP_TIMEOUT`, `files/turns.ts`) and
    refuses a turn nested in a turn.
- **B1's re-ask dialog**, 10:01Z, answering the orchestrator's question: the words "A: changed while deciding". Title
  "<path> changed while you were deciding"; body "It was saved again since you were asked. Keep yours, or replace it with
  the uploaded one?"; the "Yours" line with the new size and date; for "Restore the sample", "uploaded" becomes the
  sample's words. The rules, "Always ask": the question is asked even after "Do the same" with Replace; a file deleted
  meanwhile is written without asking; a name taken since the list was read gives the ordinary clash dialog (or "already
  exists"). In SPEC's "Name clash" row.
- **A gone file with a dirty tab**, 10:52Z, asked at 10:39Z (an upload clashes with a file a run deleted, its tab is open
  with unsaved edits, and "Do the same" with Replace was ticked: the "deleted meanwhile" rule and the "unsaved edits are
  always asked" rule disagree): the answer was "Ask (Recommended)". The clash dialog shows, with the unsaved-edits words,
  even after "Do the same". A write without a question is capped at 3 tries.
- **The narrow gaps**, 10:00Z: "4. yes, skip for now." They go to the known gaps below, not fixed.
- **The end-gate surveyor**, 10:12Z: "yes, add that surveyor to the end gate." It mapped the page's asynchronous paths
  (and the worker's dispatch queue, which the maintainer asked about).

### Known gaps

- **The narrow gaps the maintainer said to skip** ("4. yes, skip for now"):
  - Typing into a leftover tab during the rename's one write gives two tabs on one path (reasoned from the code, not
    shown in a test).
  - Save against a new file written under the old name during a rename's extra read leaves the dot off (S1b's
    variant `path === old ? saved : null` was not applied: it reverses the behaviour S1b's third fix tests).
  - A stale tab that becomes dirty while `store.rename` runs: not handled (rare).
- **The S1 screenshots.** N7 compared S1a, S1b, S1c and S2a (and later S4b1, S4b2, B1) with the phase's baseline at 81
  shots and 0 px each. S1 changed the spec's seed helpers, so each spec ran on its own build: 0 px shows that each version
  can draw the same screens, not that the same user actions reach them. Mitigation: the editor and files e2e specs drive
  the real actions on Chromium and the iPhone project, and pass; CI ran Firefox and WebKit on each pull request. For the
  real-phone pass: open several tabs, edit one, rename, switch tabs and panes, scroll a long file and come back.
- **N7 stays a screen check.** What the tightened N7 cannot see (`docs/test-map.md`): the seeded FAILED words come from the
  caller's `words.ts` (a wording change is not caught), the hidden scrollbars would hide a new overflow, and the engine size
  text is fixed.
- **The Pyodide interrupt buffer.** As in phase 1 (icebox).
- **Not run in either session:** Firefox and WebKit e2e locally (CI ran them per pull request), a real iPhone,
  `check-pytest`, `check-numeric` and `check-snapshot` per item (the gate runs them).

### Flaky tests seen

- **chromium `editor.spec.ts:1033`**, once, about 10:37Z, under the load of rv-b1's scratch runs. 10 of 10 re-runs passed. Not
  tied to B1 and not run on 57729b9. First result: a failure.
- **`check-snapshot` case 1908_models2**, 300 s timeout, under load (load average 27 to 32 on 12 CPUs, rv-s8a, earlier in the
  session). Alone and with `--timeout 900` it matched in 330.6 s (a re-run). The case does not load `worker.ts`.
- **S4b2's test count.** The builder saw 457 pass and 5 skipped (no snapshot); the reviewer saw 477 (with one). Not
  investigated; the two counts may be the snapshot's 15, plus what the pull request added, but this is a guess.
- WebKit's Break test: not seen this session.

### Records for section 8

- **R1 (task 2).** Not started: lane a ended at S8c. The sources do not record a check of the condition on R1
  (the idle-wait work done, the graphics part unchanged); R1 and its note head section 8's list unless it is checked at the
  next session. The graphics op answers beside the worker's queue (an unqueued op, with `boot`): R1's.
- **R2 (task 3).** The ticket per run: S7 now keeps per-start facts on the client (`Live.facts`, a `Wiring` record in
  `app/engine.ts`; facts are null between a worker's end and the next start). There is no test of the Break timer's clear
  on a second `connectEngine` (`engine.ts:97`). Phase 1's B3 record still stands.
- **R3, the harness (task 4).** Behaviour the page carries that only e2e covers: the `CommandBar` wiring, the focus of the
  storage, store-failed and download-failed banners, the re-ask dialog of B1 (no e2e, no shot), the cap of 3 writes in B1.
- **R4 (task 5).** No CSS changed in S4b1 or S4b2; N7 shows 0 px. S9c's split is of `vite.config.ts`, not the sheets.
- **R6 (task 6).** Rule 9 was not counted in this session; S1 moved the seeds to `src/app/editor/seeds.ts` and the e2e hook
  keeps one `state` object.
- **W1 (the sweep of `src/engine/`).** 02-F13, the split of `snapshot.ts`, goes to W1 after R1 (icebox, with the reason).
  The one-door rule's reach for the other stores of the audit: `files/turns.ts` and the Biome rule have no exception left
  after B1.
- **The async map.** The end-gate survey (below) lists loose reads of the store outside turns (`FileBar.tsx:25`,
  `output/dta.ts:15`, `sample.ts:65`, `dialogs.tsx:94`: stale display at worst) for W3's region.

### Nice-to-haves left

One line each; none blocks the merge. Recorded from the reviews.

- S7: no test of the Break timer's clear on a second `connectEngine`.
- S8a: 4 branches survive mutation in the unit tests (maybe covered by `files.test.ts`); the fake `mkdirTree` is too lenient.
- S8c: an unserialisable boot error leaves `booted` unsettled.
- C3: the state values are not pinned; the long comment at `worker.ts:488`; `lazy-matplotlib.md` says "16 + size".
- S9a: `--timeout 0` in `check-snapshot` means no limit (it was an immediate kill; callers pass a number).
- S9b: about 30 bytes of unused denied data in the editor bundle; `SNAPSHOT_QUALITY=abc` reads as stale.
- S9c: a dead `editorBase` branch in `headersFile`.
- S1a: the comment at `actions.ts:55` names an unreachable case.
- S1b: a failed write after a swap announces "couldn't be saved"; the S2 todo test did not reproduce its race (replaced in S2a).
- S1c: two tab switches before the editor lays out can restore the wrong place (no user path found); a hidden tab's place is
  not moved when a run changes its text; no browser test of the place after a reload.
- S2a: the store call in a `finally` after a timeout.
- S4a: two mutations caught only by a timeout.
- S4b1: the `Picking` export is unused outside `VarTable.tsx:10`; the `CommandBar` wiring is covered by e2e only.
- S4b2: focus untested for the storage, store-failed and download-failed banners; `docs/web-page-flows.md` (lines 108 and 233)
  does not name `DismissibleBanner`.
- B1: the asked-again dialog has no e2e or shot; the cap of 3 writes is untested.

### End-gate survey of the page's asynchronous paths (Sonnet, medium, at 9f3ff3e)

Read only; the survey found no stale-answer bug it could show. Every loose path that writes state after an await has a guard
(an identity check, an in-flight map, a `live` flag, the transport's rejection, or a turn). Not read: `store.ts`, most of
`client.ts` and `worker.ts`, the e2e specs; tests were read by title, not run.

- **A1, worker-dispatch double answer.** In `worker-dispatch.ts` `answer`, `post`, `afterResult` and `answered(false)` share
  one `try`: a throw in a hook posts a second `{id, error}` answer and calls `answered(true, e)` again (for `boot`, `booted`
  then rejects for every later op). The page drops the second answer; nothing in `afterResult` can throw today, so it is
  latent. Fixed in the gate: #110 (10a06f9), a failing test first; review Sonnet, high: accept (its should-fix and nice-to-have done).
- **A2.** Two quick drops or file picks enter the `uploads` chain in the order their reads finish, not the order of the
  user's actions; with the same path in both, the winner is not deterministic. Left for later.
- **A3.** `CloseTabDialog.save` closes by the old path after the await (`files/dialogs.tsx`); the dialog is modal, so no way
  to rename meanwhile was found (a guess). Left for later.
- **A6.** `copyMatrix` of a closed matrix copies without the `results.value === rs` check that `readMatrix` has: a run landing
  during the read copies the new run's matrix under "Copied e(b)". Left for later.

### Gate checks

On audit/2a-moves: the engine checks and N7 at 9f3ff3e, e2e at 10a06f9 (9f3ff3e plus the A1 fix, which touches only the worker's dispatch). Run 2026-11-22, locally, with no agent running.

| Check | Result |
|---|---|
| `E2E_PORT=<port> SNAPSHOT_QUALITY=5 npm run e2e`, all four projects | 750 passed, 54 skipped, 0 failed |
| `npm run check-snapshot` | 107 cases, 0 differ, 0 timed out (1701 and 1911 differ as expected). The first try stopped at once with rc 2: the fresh worktree had no snapshot yet |
| `npm run check-numeric` | exit 0: 107 cases, 0 timed out |
| `npm run check-pytest` | exit 0: 80 files, 0 timed out |
| `uv run poe test tests` | 343 passed, 3 xfailed |
| N7 against c5d7a85 (the phase's start baseline) | 81 shots, 0 px, no near-misses. Each side ran its own spec: c5d7a85 with 98efd19's spec (S1 changed the seed helpers, and the current spec cannot seed the old app), 9f3ff3e with its own |

## Phase 2 (session 4, branch audit/2b-moves)

Cut from `main` b24cbd8 (session 3's merge, #112) on 2026-11-23 and fast-forwarded to `main` 856e5b4 after #119 and
#120 (the maintainer: the session's branch is fast-forwarded, never merged into). This section is begun before the
session's items; its last pull request completes it (the pull requests, the gate checks).

### After session 3's log

Into `audit/2a-moves` after its end gate, then to `main` with it in #112 (b24cbd8), each with a fresh-context review:
#113 (bcd8b96: `callWithTimeout`, `TurnTimeout`, `step` renamed `resume`), #114 (deff4d0: promise-returning functions
`async`, the file queue; `save.test`'s `hold()` really holds), #115 (5a2d594: a Grit rule keeps every `Promise`-typed
function `async`; `noFloatingPromises` tried, 36 findings, left off), #116 (0322ed6: `uploadNow`'s names), #117
(539a4f5: the worker's op table as methods; `PageError`, `StoreError` in `types.ts`; `web/STYLE.md`), #118 (64dc997:
the phone check's fixes: Upload files in the Files menu, a roomier phone strip, Go to line follows a rename).

Straight to `main`, before the items:
- #120 (2ab56d1): the e2e upload test split so each upload input's picker opens once per test. Cause found by an
  investigator (Sonnet, high): on Firefox under load, a second picker from the same hidden input often never fires.
  Not agent-reviewed; CI passed.
- #119 (856e5b4): `web/STYLE.md`'s naming and spacing rules and its glossary, this plan's placement of them, two icebox
  entries, and Biome's `useSingleVarDeclarator` with its fix. Builder and reviewer Sonnet, medium (accept); the commits
  after the review and the rebase onto #120 were read by the orchestrator only.

### Rule 7: what the re-check found

Four read-only surveyors (Sonnet, medium) checked the lanes against `main` at b24cbd8.
- **Lane a (R1).** The 22 graphics variables of `worker.ts` are intact; 01-F12 and 02-F5 are gone (C3); 01-F2 and 02-F4
  hold, with some Node tests now (`waitStep`, `useNative`, the page's hand-over). `docs/lazy-matplotlib.md` is stale.
- **Lane b (S2's second half, S3, the Run gate).** All open; S1a's nice-to-have (a comment at `actions.ts:55`) is gone.
- **Lane c.** S5 no longer waits on S4 (`CommandBar` is not in `CommandLine.tsx`); `activeTab` is out of S6 (computed in
  `documents.ts`); FullSize's timer is fixed. `runMoved` (#118) in `state.ts` imports `files/tree.ts`, against S0.
- **Lane d (R5).** Untouched; S9a closed the `lib/` drift between the CI lists; the `.md` filter skips the root README.

### The maintainer's decisions of this session (2026-11-23)

The words are the maintainer's, as recorded in the sessions' notes; the plan's tables carry the effect.
- **Merges.** Each item into `audit/2b-moves` by merge commit once its reviewer accepts and its checks pass: "yes".
- **R1.** Its condition holds: "exp-e1c is a reference copy--icebox it for after the audit. idle-wait work is done for
  now ... no other code should be touching graphics for now." Its note on Opus, high, with an Opus reviewer; Fable only
  for a specific race, asked then. Both threads: "doing both the worker and page side code is fine"; the stale
  `docs/lazy-matplotlib.md`: "fix it in R1"; the note's path `docs/design/lazy-graphics.md`: "that path is fine".
- **A2, A3, A6.** "fix A2 in S2 with a failing test first"; A3 to the icebox ("yes"); "fix A6 this session as its own
  PR". A6's behaviour: the copy is refused when the results changed.
- **The Run gate.** "one rule for all of them" (the buttons, the banner and Ctrl/Cmd+Enter); on other tabs "greyed out
  with the reason".
- **S5.** `runText` as typed parts and a view; the phone strip and the desktop status bar drawn from one model: "add it to
  S5 with short forms".
- **S6.** Its registry gets a note first ("A, note first"), written early ("yes, write the S6 note early");
  `selectGraph(n)`: "keep today's behaviour".
- **R7r.** The path helpers move, not `runMoved`: "B, move the path helpers during R7r".
- **Rule 9's files.** `e2e/seed-files.ts`, `e2e/seed-views.ts`: "agree with those names".
- **Test-only code.** "a + b in a small item": the hook, the seeds and `data-engine` in one module loaded with `?test`
  only; then `main.tsx` ordered by what depends on what. Not taken: switching them off in production.
- **R5.** The root README counts in the `.md` filter ("A"); the one cold CI cache: "yes".
- **Left to phase 3.** The 36 floating promises to W1 to W4 ("leave them to the sweeps"); the Save tests' mutation checks
  to W5 ("leave them to W5").
- **Icebox.** The iOS scroll-bar highlight, A3, and a symmetric matrix in the Results tab; the MCP tool's `get_matrix`
  unchanged ("leave MCP as is and icebox the web display").
- **The real-phone check at the session's end** adds the phone strip at 393 px and Go to line after a rename.
- **Not now.** Splitting `check-snapshot` in CI and a shorter e2e timeout: "pass on this for now".

### Flaky tests seen

- `e2e/files.spec.ts:1227` (the upload test before #120's split), Firefox: deploy run 45113314919 attempts 1 and 2,
  PR #119's run 45119420519. Fixed by #120; not yet run under load since.

### Session 13 (2026-11-23, `audit/2b-moves` 6acd204 to 3dcf8f3)

Into `audit/2b-moves` by merge commit, each after a fresh-context review and with every CI job green (#157 merged by
the maintainer):
- **R1c.** #147 (the client's machine, `#writePart` and progress derived), #151 (online once; race 10 checked live; the
  `again` and damaged replies carry a name copy; a throwing `readPart` is not damage: nothing is posted and the next
  graph retries, kept by the maintainer after it was asked), #152 (the note's docs), #156 (the note's Decisions entry).
- **R7r.** #148: `state.ts` split into `app/paths.ts` and `state/{saved,engine,files,run,layout,notices}.ts`; the path
  helpers moved with it; a fix round added `hookState()` with its test and an import test.
- **C5.** #149: one `--tabbar-h` source and a fixed-height tab bar (the trade-off: a 300% font spills labels by 5 px, not
  cut); four phone e2e cases; N7 0 px.
- **2.21.** #150: the test hook's module; a data-engine poll that was always true removed from `landing.spec`.
- **Imports.** #157: Biome `useImportType` in the separated style, organised imports in groups from general to
  specific, and ruff's `I` rules for dofile's own Python.
- **UI helper contract.** #158: every UI helper's focus hook takes an optional getter, and makes and returns the ref when
  none is given; `focusStable` and `useFocusOnLeave` moved into `ui/`; the `ui/`-to-`states/` import cycle is gone;
  `web/STYLE.md` has the contract; Biome rules keep `ui/` from importing `states/` or `files/` and
  `focus-targets.ts` from importing `preact/hooks`.

Into `main`:
- #154 (d9078d0, fast-forward): pull requests test Python 3.14 only, on Ubuntu and macOS; `main` runs Ubuntu 3.12 to 3.14
  and macOS 3.14.
- #153 (9ffa8c9, rebase merge): each gate (`ci ok`, `web ok`, `lint ok`) fails unless every job of its own workflow's
  run succeeded or was skipped. The old step passed with two cancelled macOS legs; the cause was legs that never got a
  runner and were cancelled by GitHub at about 15 minutes. A first run of the gate failed because a job with no checkout
  has no `web/`; `deploy.yml` needed `actions: read`. The deploys of both PRs succeeded, the second one the first live run
  of the new gates.

Reviews: R1c and R7r by Opus, high; the rest by Sonnet, medium, except the Biome rules, read by the orchestrator.

### Flaky tests and CI sightings of session 13

- macOS runner starvation: jobs cancelled at about 15 minutes with "not acquired by Runner" (#137 twice, #152, #155
  twice); each re-run once, the first result recorded. #154 cut the macOS demand.
- Pyodide could not load a corrupt `scipy` download in the unit tests (#157, run 45274956655); the re-run passed.
- A Chromium dialog-reset failure once in `shots:baseline` locally (R7r); the re-run passed.
- Not run locally: Firefox and desktop WebKit e2e, the whole e2e suite, real Safari or iPhone.

### On hold and for later

- Held by the maintainer: #155 (the session's pull request to `main`; a deep review first), the real-phone check, and
  #137 (the re-vendor draft, green at 1e537fa).
- The gate step was not exercised against a cancelled job; past 100 jobs a run, its per-page filter would error.
- **Decisions for later.** A design note is to come, covering the exports' placement (inline against a bottom list or a
  top block, weighing locality for reading and editing against clarity of the interface), the state modules' shape
  (read-only exports with one writer object) and a layer-first layout with each view's helpers beside it. Imports are
  to use named roots `#app/`, `#engine/`, `#stata/` and `#site/` through `package.json` `"imports"`, and the
  build is in 3.0. Windows CI is the next item after the audit's stage.
