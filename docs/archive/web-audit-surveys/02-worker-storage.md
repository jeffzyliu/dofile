# 02: worker and storage (survey)

## 1. Covered
- Read fully: `web/src/engine/worker.ts`, `store.ts`, `snapshot.ts`, `zip.ts`, `memcap.ts`; `src/dofile/browser.py`, `pathshim.py`, `linalgshim.py`; `web/CLAUDE.md`.
- Partly read: `types.ts` (lines 25-200 and 265-306); `client.ts` (lines 536-697, plus greps); SPEC section 7; `web-engine-data-flow.md` Part 3; `phase2-plan.md` lines 66-106; `test/node-worker.ts`; a sample of about 60-100 lines each from `files.test.ts`, `store.test.ts` and `engine.test.ts`; the test names of those three, `snapshot.test.ts`, `e2e/graphics.spec.ts` and `tests/test_browser.py`; `imports.test.ts` lines 353-500.
- Not read: `machine.ts` (grep only), `app/*` (grep only), `scripts/make-snapshot.mjs`, `docs/lazy-matplotlib.md`.
- Commands: `cat`/`sed`/`grep`/`wc` only. Nothing was run or built.

## 2. Shape
`worker.ts` does five jobs:
- **Message dispatch and queue** (about 130 lines).
- **Pyodide start**: snapshot or normal boot, the fetch interception, the loader import (about 300 lines).
- **The `/work` mirror**: the start copy, `sync`, and the after-run difference against the store (about 150 lines).
- **The lazy graphics part**: shared-buffer handover, prefetch, a synchronous XHR, decode steps, the idle scheduler, warm imports (about 390 lines, about 20 module-level `let`s).
- **Thin JSON wrappers** over `browser.py`.

`store.ts` is self-contained and clean: the page's API plus `takeAll` and `applyRun`, each one transaction. `snapshot.ts` serves three audiences: the build scripts, the worker's codec, and `client.ts` (Cache helpers, `PART_HEADER`). The Python files are small and well tested on CPython.

Where the risk is: the graphics half of `worker.ts` (implicit state, no Node test), and the store-failure path across `worker.ts`, `client.ts` and the app, where an error is computed and then never shown.

## 3. Findings

| id | file:line | kind | what and why it costs | confidence |
|---|---|---|---|---|
| F1 | client.ts:628-630; worker.ts:141-150 | bug | **`Startup.storeError` has no reader anywhere in `src/app/`** (grep). A worker that cannot open the store mounts an empty `/work` and the page says nothing. An upload shows in the list, but `use` on it gives rc 601 (gap b). After an upgrade by another page both threads fail (gap a): the page's own `refresh()` only warns on the console (app/files.ts:73-75), so nothing is shown there either. | read |
| F2 | worker.ts:147 | inconsistent | `copyStore` flattens the error to text and drops `e.name`. So `VersionError` (gap a) cannot be told apart without parsing the message, against the rule "decide from kind, never text". The client also learns of it only after `boot` and `startup` (client.ts:628). Page changes made in that window write `pending` rows this worker never reads (harmless: the next `takeAll` clears them). | read |
| F3 | worker.ts:225-233; client.ts:589-592; LogView.tsx:280 | bug (trigger suspected) | After `applyRun` commits and empties the journal, a `takePageVersion` failure leaves `/work` out of step with the store, and nothing is owed. The `store_error` it returns makes LogView say the files "couldn't be kept in this browser", but they were kept; it is `/work` that is wrong. A failed `sync` goes only to the console. The symptom is the same as gap b. A likely trigger is a big upload under the phone heap cap; that trigger is a guess. | read |
| F4 | worker.ts:470-817, 412, 768 | fragile | The graphics part is an implicit state machine. Flags such as `share`, `decode`, `decoded`, `native`, `graphicsWritten`, `graphicsError`, `fetchSaid`, `fresh`, `askedAt`, `prefetching`, `idleTimer`, `runs`, `started` and `warmAt` patch the order of fetch, decode, write and warm. The guards are re-spelled at 746, 752 and 779. The native-decode test appears at 757 and 799 (and snapshot.ts:456). `brotliPick` is both the mount option and a runtime fallback flag (768). `brotliWasm` is set from inside the boot code (412). **No Node test** covers it: only `e2e/graphics.spec.ts` and the fake-`wait` tests in `tests/test_browser.py`. | read |
| F5 | worker.ts:481-483 vs client.ts:417-421, 462-465, 473-477 | inconsistent | The shared-buffer header protocol has named states in the worker but raw `0/1/2` and index literals in the client. Its layout is described in four comments (types.ts BootArgs, snapshot.ts:249, worker.ts:473, client.ts). Only `PART_HEADER` is shared. | read |
| F6 | worker.ts:1016-1038, 1021, 919 | fragile | Dispatch special-cases ops by name: `boot` and `graphics` run outside the queue, and `run` is counted before the queue and un-counted in its `finally`. `boot` reads `py` and `fromSnapshot`, which `mount` sets, and only client.ts:613-614's sequential awaits keep that order. | read |
| F7 | worker.ts:829 | fragile | `Handlers<S>` returns `unknown`, so no worker op result is type-checked against `Ops[K]["result"]`. The protocol is typed on the client side only. | read |
| F8 | worker.ts:48-66; browser.py:83-137; types.ts:162-180 | tangle | The JSON contract is spelled three times: the Python docstring, its `json.dumps` dict, and `RunResult`. The positional `Browser` interface restates the Python signatures as well. Defaults are duplicated (browse limit 50 at worker.ts:983 and browser.py:158,160). `fresh_locals` and `plot_theme` are cleaned on both sides. `images` is always `true` (worker.ts:947). Errors cross two ways: a thrown `PythonError`, or `{error}` inside `DataSummary`. I found no test that compares the keys. | read |
| F9 | worker.ts:934; browser.py:62-65, 97 | fragile | "A Break while idle does not stop the next run" is enforced three times: the buffer is cleared in `runNow`, `clear_break()` runs, and `_busy` is checked. Clearing at run start is gap 1 (a Break pressed in the send-to-start window is lost and ends as a 9998 reset). | read |
| F10 | store.ts:137-151, 172-175 | fragile | `change()` keeps call order only because `tx` creates its transaction right after `await mine`. One more `await` before `.transaction()` would silently reorder a write and a rename, and Save relies on that order. No test of the IndexedDB ordering found: files-ui.test.ts:280 tests `fileTurn`'s tabs only. | read |
| F11 | worker.ts:228-233; LogView.tsx:280 | inconsistent | `store_error` has two meanings (the store refused, or `/work` refused), but the page has one message for both. | read |
| F12 | snapshot.ts:75-82 | fragile | `replaceAll` uses `String.replace(string, string)`. A `$&` or `$'` in a future patch would be expanded, and nothing checks that the pattern occurs once. Today's patches contain no `$`. | read |
| F13 | snapshot.ts:127-263, 249-251 | tangle | Build-only helpers (`makeOptions`, `makeSnapshot`, `zero*`, `bundle`, `packGraphics`, `isDeadWeight`) share a module with the runtime codec and the page's Cache helpers. The size checks are duplicated between `unpack` and `unpackSteps`, and again between `inflateSteps` and `inflateNative`. | read |
| F14 | store.ts:104 | suspected | `onblocked` cannot fire at version 1. Once someone bumps the version (a fix for gap a), it rejects while the open may still succeed later, which would leave an orphaned connection. | guess |
| F15 | browser.py:35, 168; worker.ts:1-3, 470-480; store.ts:1-8, 124-130; worker.ts:72, 85 / store.ts:33, 53; worker.ts:933-958 | chaff | History in comments ("step 4d… OQ-10", "experiment E1c"). Multi-module narrative in the file headers and the graphics block. The store header restates SPEC 7, and `attach`'s JSDoc narrates the gap-a scenario. `HIDDEN` and `within` are duplicated. `runNow` has a stray `{}` block. `files`/`read` are test-only ops in the production protocol. | read |

**The file contract.** On the worker side it holds by structure: no op carries bytes into `/work`. The only writers are `putRecords` (via mount, sync and the after-run write) and Python during `run`.
- Nothing tests that rule. A future op with a `Uint8Array` argument, or a read op whose Python side writes into `/work` (`ReadOps` is "declared, not proved", types.ts:40), would break it silently: `saveRun` diffs only around `run`.
- The mtime-and-size rule depends on the spin-wait (worker.ts:939-943) staying between `walk` and `browser.run`. files.test.ts covers both halves ("two runs in a row…same number of bytes" and "a run that empties a file").

**snapshot.ts.** It holds no copy of Pyodide's loader. It holds about 15 lines of verbatim minified Pyodide text: four find/replace pairs (lines 45-65, 73, 106). `replaceAll` throws when the text is not found, so the patch boundary is clear. The other ~440 lines are dofile's own code.

## 4. Candidate work items
1. **Surface store failures (gaps a and b, plus F3 and F11).**
   - What changes: the worker returns `{name, message}` for a store failure. `VersionError` (and `onversionchange` with a `newVersion`) becomes a reload-type failure: machine.ts:87's `start-failed` reason union lacks `"updated"`, so it needs a new cell. Any other failure becomes a `started` that carries a store-failure flag, then a signal, then a banner kind. A failed `sync` or `takePageVersion` becomes a `crashed` with cause storage (a re-copy) instead of a console line. The two `store_error` cases get separate messages.
   - Files: worker.ts, store.ts, client.ts, types.ts, machine.ts (and the SPEC 5 tables), app/engine.ts, state.ts, states/banners.tsx, LogView.tsx.
   - Size M. Risk med (machine cells).
   - Tests that would catch a regression: files.test.ts (718, 733, 756), machine.test.ts, app.test.ts, client.test.ts.
   - Must land first: nothing.
2. **Extract the `/work` mirror to an imported module** (`walk`, `putRecords`, `copyStore`, `takePageVersion`, `foldersAt`, `saveRun`, `forget`, `unsaved`), taking an FS parameter. Share `HIDDEN` and `within` with store.ts, and add unit tests of `saveRun` with a fake FS.
   - Size M. Risk low.
   - Tests: files.test.ts, store.test.ts, engine.test.ts. imports.test.ts:373 and 473-476 pin worker.ts's source text and must be updated.
   - Must land first: nothing.
3. **One owner for the shared-buffer part protocol.** A small module with header read/write helpers and named states, used by both client.ts and worker.ts; `PART_HEADER` moves there.
   - Size S. Risk low.
   - Tests: e2e/graphics.spec.ts only.
   - Must land first: nothing.
4. **Graphics part into one object or module** that owns its state. One "native eligible" predicate; `brotliPick` split from the fallback flag; `brotliWasm` passed in, not assigned from boot.
   - Size M-L. Risk med-high (iOS timing, synchronous XHR, Atomics).
   - Tests: e2e/graphics.spec.ts and test_browser.py.
   - Must land first: item 3. Also first: a Node test that drives a lazy part through the real worker (whether the Node snapshot build can have a lazy part is not verified).
5. **Extract boot and loader** (`fetchBytes`, `watchFetch`, `importLoader`, `importCapped`, `loadBrotli`, `loadFromSnapshot`, the normal boot) so they return `{py, brotli, summary}`.
   - Size M (moves). Risk low.
   - Tests: engine.test.ts (snapshot start, heap cap), e2e.
   - Must land first: nothing.
6. **Declarative dispatch and typed handlers.** An op table flag for queued or not; `Handlers` returns `Ops[K]["result"]`.
   - Size S. Risk low.
   - Tests: engine.test.ts, client.test.ts.
   - Must land first: items 2 and 5 (easier after them).
7. **Gap 1 and a single owner for idle-Break clearing** (for example, the page tags the Break with the run it is meant for). The design is open.
   - Size S-M. Risk med.
   - Tests: engine.test.ts (Break), files.test.ts:785, test_browser.py:167, machine.test.ts.
   - Must land first: nothing.
8. **Tidy.**
   - Move snapshot.ts's build-only helpers next to the scripts.
   - Make `replaceAll` use a function replacer with a check that the pattern occurs once.
   - Drop the `images` parameter, and set browse's defaults on one side only.
   - Cut the history and narrative comments (F15).
   - Size S. Risk low.
   - Tests: snapshot.test.ts, memcap.test.ts, test_browser.py, `npm run check-snapshot`.
   - Must land first: nothing.

## 5. Redesign question
No redesign. The store, journal and `applyRun` design is sound. A transaction-scoped journal plus a diff by mtime and size is simple, and it is well tested through the real worker.

The one structural change I would make is to split `worker.ts` into imported modules (not chunks, so the iOS constraint does not apply): the dispatch entry, boot, the `/work` mirror, and the graphics part. The graphics part should first become a single object that owns its state. I would make it an explicit pure machine only after a Node harness for it exists, because e2e is its only safety net today.
- Cost: about M+M+L of mostly mechanical moves, plus rewriting the source-text pins in imports.test.ts.
- What could break: the order of the shared module state (`py`, `browser`, `interrupt`, `runs`, `idleSince`, `started`) once it has to be passed explicitly.

I would do the store-failure item (1) first. It is the only one that fixes user-visible bugs.

## 6. What is good
- `store.ts`'s one-transaction `applyRun` and `takeAll`, which make the order of syncs irrelevant.
- Behaviour tests that run the real `worker.ts` in Node behind `EngineClient` with fake-indexeddb, including the mtime and empty-file edges.
- The snapshot patch that throws on a Pyodide mismatch.
- The `Ops` sets in types.ts.
- The `{error, name}` answer.
- `pathshim` and `linalgshim`: small, self-disabling, tested.

## 7. Not verified
- No tests were run.
- Whether any browser fails to open IndexedDB in the worker only.
- Whether the Node snapshot build has a lazy graphics part.
- Whether e2e/graphics.spec.ts runs in CI.
- What makes `takePageVersion` throw in practice.
- `machine.ts`'s `FAIL` handling of `"updated"`.
- Any test of the IndexedDB transaction order beyond the grep.
- The rest of `client.ts`'s graphics code.
