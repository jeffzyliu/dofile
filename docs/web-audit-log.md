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
