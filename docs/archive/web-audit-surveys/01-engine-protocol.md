# 01: engine protocol (machine, transport, controller)

## 1. Covered
- Read fully: `web/src/engine/machine.ts`, `client.ts`, `tab.ts`, `types.ts`, `web/src/app/engine.ts`, `web/src/main.tsx`, `web/CLAUDE.md`.
- Read in part: `docs/phase2-plan.md` 60-120; `docs/web-engine-data-flow.md` Part 3 (425-450); `test/imports.test.ts` 152-184, 250-397, 454-497; `test/machine.test.ts` 1-60, 1100-1160, 1690-1760 plus test names; `test/client.test.ts` 440-560 plus test names; `test/app.test.ts` 884-905; `src/dofile/browser.py` 55-100.
- Grep only: `worker.ts` (interrupt, op queue, PART_* constants), `files.ts` (`own`/`block`), the uses of the exported symbols, and graphics coverage across `test/` and `e2e/`.
- No tests run. No commands other than read-only grep, sed and cat.

## 2. Shape
`machine.ts` is a pure table with 16 states and 24 events. It returns the next state and a list of effects. `app/engine.ts` (the controller) queues events through two entry points, calls `transition()`, writes the `engine` signal, and performs each effect against `client.ts` (the transport), the tab lock, and UI signals. `client.ts` does three jobs:
- the build's start files: the list, `cached()`, `download()`, `forgetDownload()` (lines 192-366);
- a lazy graphics part, which is a second state machine of its own (368-534);
- the worker's lifecycle: start/end, request and response, log streaming, and Break (536-697).

`main.tsx` builds everything and connects it. Most of the risk sits in `client.ts`, through the graphics part and the per-start facts. The split is real, not ceremony: the machine and its tests carry the decisions, and the performer is a thin but honest mapping. The weakest part is the Break path, which runs across `client.ts`, `worker.ts` and `browser.py`.

## 3. Findings

| id | file:line | kind | what and why it costs | conf |
|---|---|---|---|---|
| F1 | machine.ts:297-310 → client.ts:669-671 → worker.ts:934 (and op queue worker.ts:1037) → browser.py:61-63 | bug (known) | **Step 3.5 Break gap.** `interrupt` writes SIGINT into the shared buffer as soon as Break is pressed. The worker runs ops one at a time on a promise queue, so a run can wait behind a `describe` or a `sync`. When the run starts, `runNow` clears the buffer, and the Break is lost. The 5 s timer then fires and the machine resets (machine.ts:539, rc 9998). Suspected but unverified: Python code run by a queued op could also take the SIGINT, and `_on_interrupt` drops it when `_busy` is false. In that case, clearing the buffer on the page at send time would not be enough. | read; the Python part is a guess |
| F2 | client.ts:368-534 | fragile/tangle | **The graphics part is a second state machine inside "the transport [that] decides nothing".** It has four `progress.state` values, a `loading` promise, a retry counter in the shared buffer, an `online` listener, and guard clauses written as state comparisons (408, 416, 431). Line 432 rewrites the state to `"failed"` only so that its own guard at 416 will pass. It has no Node test: `graphics` occurs 0 times in `client.test.ts` and `app.test.ts`, and only `e2e/graphics.spec.ts` covers it. | read |
| F3 | app/engine.ts:285-291 vs 333-338; machine.ts:81 | bug | `startDownload` maps every error except "updated" to reason `"download"`, and the event type allows only `"download"\|"updated"`. Example: on a first visit, a broken Cache (client.ts:294) or a build with no snapshot (client.ts:226) shows FAILED.download, "Check your connection". The same errors arriving through `fetch-list` show FAILED.unknown. | read |
| F4 | client.ts:96-101 | inconsistent | `reasonOf` decides `"memory"` by matching a regex against the error text. That breaks the rule "decides from kind/name, never from the text" in types.ts:11-13 and web/CLAUDE.md. | read |
| F5 | client.ts:628-630 | fragile (known) | When the worker reports `storeError`, the transport silently detaches the store and raises no event, so the machine and the page never learn of it. This is step 3.5 gap 3: an upload is listed, but `use` fails with rc 601 and no banner. | read |
| F6 | client.ts:118-121, 625-628, 566-584 | tangle/inconsistent | `about`, `startup` and `storeError` are per-start facts, but they live on the shared instance, which is why `if (live.ended) return` is needed at 625. One worker's replies follow two staleness rules. `started` is suppressed by `live.ended`. `stage` and `crashed` are not suppressed and rely on the ticket. | read |
| F7 | machine.ts:308-309, 518; app/engine.ts:104, 355-361 | fragile | **Tickets are issued per worker, not per request.** `send-run`, `interrupt` and `start-break-timer` all reuse the worker's ticket. A stale `break-timeout` is stopped by the single `breakTimer` handle being cancelled (and by the property test machine.test.ts:1816), not by its ticket. A late `run-ended` would only be refused because each promise settles once. The rule in CLAUDE.md, "each asynchronous request gets a Ticket", overstates what the code does. | read |
| F8 | app/engine.ts:303-305 | suspected | Only a run error of kind `"op"` becomes an event. If the transport and the machine ever disagree on the worker number (client.ts:663, `"no-engine"`), the error is swallowed and the machine stays in `running` until a Break or a reset. | read |
| F9 | app/engine.ts:92, 105, 179-181, 327 | fragile (known, Part 3 item 9) | Module-level wiring. `wiring` is a second generation scheme that sits beside the tickets. The `download` handle compares a ticket outside the machine (327). | read |
| F10 | app/engine.ts:368-378 | tangle (known, Part 3 item 8) | The performer writes `S.dialog`, reads it to decide whether to close a dialog (372), and asks for editor focus through `editorAsked`. | read |
| F11 | app/engine.ts:35-73; types.ts:9-10; machine.ts:261 | chaff/inconsistent | The visitor's words live in the engine controller: `stagesOf`, `stageStatus`, `FAILED`, `UPDATED`, `SAY`, and `stageWords = stageNow`, which is a bare alias of `states/words.ts`. Views import them from the controller (StatusBar.tsx:5, DownloadDialog.tsx:71). The stage order is written down in three places. | read |
| F12 | client.ts:417-421, 462-465, 472-477 vs worker.ts:481-483 | inconsistent | The shared-buffer protocol uses bare `0/1/2` and header indexes on the page, named `PART_*` constants in the worker, and a prose description of the layout in types.ts:82-83. A change to the layout has to be made by hand in three places. | read |
| F13 | imports.test.ts:250-363, 454-497 | fragile (tests) | The source-text rules match exact text. Examples: the line `const mint = (n: number): Ticket => n as Ticket;`, exactly two `as` in machine.ts, `bodyOf` with literal function signatures (`dispatch`, `reply`, `enqueue`, `connectEngine`, `view`), the literal `#send(live, "mount"`, and `postMessage` only in client.ts. Splitting client.ts or renaming a parameter fails them. `dispatch()` (engine.ts:173-175) is a one-line wrapper that exists to be one of the "two doors". | read |
| F14 | client.ts:299, 530, 70, 104-121/166-180; engine.ts:130; machine.ts:21 | chaff | Small leftovers:<br>• The `!this.#live` guard at 299 never fires (suspected dead code): every state that emits `start-download` has no live worker.<br>• Unused parameter `_part` at 530.<br>• `onGraphics?` is optional only so test fakes can omit it.<br>• engine.ts:130 throws away the unsubscribe, so each `connectEngine` adds one more listener.<br>• 13 public mutable fields are set through `declare` plus `Object.assign`; `nextId` is read by client.test.ts:533.<br>• The `// 5000` comment on `Env.graceMs` repeats `BREAK_GRACE_MS`. | read |

What the region answers to the brief's questions:
- **Decisions in disguise.** Real ones in client.ts: F2, F4, F5, and the `live.ended` filter in F6. Mechanical, but outside the machine: the controller's `stepping` and `queue`, `wiring` and `download` (F9), and `breakTimer` (F7). imports.test.ts:454 explicitly allows `breakTimer`.
- **tab.ts** is clean.

## 4. Candidate work items

Every item that touches client.ts or app/engine.ts also has to update `imports.test.ts` (F13).

1. **Close the Break gap (F1).**
   - Change: clear the buffer in `client.run()` before `#send` (the page is single-threaded, so this is ordered against Break) and stop clearing at worker.ts:934. If check F1's Python part holds, `_on_interrupt` must also keep a SIGINT that arrives while not busy, and the run needs a per-run marker so that a stale Break cannot stop the next run.
   - Files: client.ts, worker.ts, browser.py.
   - Size: S if the page-side clear is enough, M if three layers change. Risk: med.
   - Tests that would catch a regression: test/engine.test.ts (Break in Pyodide; add a case with "Break before the run is taken"), client.test.ts:728, app.test.ts:848/884, e2e Break.
   - Before: none.
2. **Extract the graphics part (F2, F12).**
   - Change: move it to `engine/graphics.ts`, with a `tell()` callback so that `#send` stays the only `postMessage`. Share named shared-buffer constants with the worker through `snapshot.ts`.
   - Size: M. Risk: med.
   - Tests: only e2e/graphics.spec.ts today; first add Node tests for retry, damaged and online.
   - Before: item 7.
3. **Failure reasons from kinds (F3, F4).**
   - Change: allow `"unknown"` on `download-failed`. Have the worker name memory errors, so that `reasonOf` reads only `name`.
   - Size: S. Risk: low.
   - Tests: machine.test.ts (table), app.test.ts (~1032-1088), client.test.ts:573.
   - Before: none.
4. **Per-start facts on the start record, store error as an event (F5, F6, F8).**
   - Change: put `about`, `startup` and `storeError` on `Live` or in the `started` answer. Raise an event or banner for `storeError` (step 3.5 gap 3). Report non-op run rejections.
   - Size: M. Risk: med.
   - Tests: client.test.ts:1006/1048, files.test.ts:723-747, app.test.ts, machine.test.ts.
   - Before: item 7.
5. **Words out of the controller (F11).**
   - Change: move them to `states/words.ts` and drop the alias.
   - Size: S. Risk: low.
   - Tests: app.test.ts (FAILED/UPDATED), `npm run check`.
   - Before: none.
6. **Chaff sweep (F14).**
   - Size: S. Risk: low.
   - Tests: client.test.ts, `npm run check`.
   - Before: none.
7. **Loosen the text pins in imports.test.ts (F13).**
   - Change: find functions by name, not by their full signature. Make the postMessage rule independent of the file, so that the rules survive a split.
   - Size: S. Risk: low.
   - Tests: the file itself.
   - Before: items 2 and 4.

## 5. Redesign question
No. The structure is sound; tidy it. The machine–controller–transport split carries its weight: a pure table checked at compile time and covered by property tests, a thin performer, and a transport that mostly does what it is told. The one structural move I would make is to take the graphics part out of `client.ts` (item 2). That leaves `client.ts` at roughly 530 lines along the seam the `Builds` interface already marks (start files vs. worker), and a later second split into `builds.ts` and `worker-port.ts` would then be cheap.

A per-run ticket would make tickets uniform and close F1 and F7 cleanly: the machine issues one ticket per `run`, and `interrupt` writes it into the buffer. But it is M-sized with heavy churn in machine.test.ts and the SPEC matrix. Do it only if item 1's simple variant proves incomplete.

## 6. What is good
- `machine.ts` is pure, exhaustive (`satisfies never`), and its answers are checked as types (`Answers` against effects and events).
- machine.test.ts pins **behaviour**: the full 16×24 grid, plus scenarios and properties over more than 600 steps. It is an excellent refactoring net. client.test.ts also pins behaviour at the message level through fake workers; its only internal coupling is `nextId`.
- Every exit the controller takes through `apply()` runs the effects even when a subscriber throws.
- tab.ts is small and correct.
- Keep the single `#send`.

## 7. Not verified
- worker.ts was read only through grep, so I did not trace whether Pyodide takes the interrupt buffer during a queued `describe` or `sync` (F1's Python part).
- I did not check whether `own()` and `block()` in files.ts interact with the effect ordering.
- app.test.ts was sampled (one test), not read.
- The SPEC section 5 matrix was not compared.
- No tests were run, and nothing was reproduced in a browser.
