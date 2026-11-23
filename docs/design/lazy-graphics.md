# Lazy graphics on both threads

The R1 note of the web audit (`docs/web-audit-plan.md`, section 6). It states how the lazy snapshot's graphics part
(matplotlib in a file fetched after the start, `docs/lazy-matplotlib.md`) moves between the page and the worker today,
and proposes how R1 makes it one machine. It changes no code. **Status: proposed 2026-11-23, for the maintainer's
approval.** Read from the code at e496b4c. Paths are under `web/src/engine/` unless they start with `web/`, `src/` or
`docs/`. "Guess" marks what was not checked.

## 1. The two halves

**Page** (`client.ts`, the section "a lazy snapshot's graphics part"): one `GraphicsPart` per build for the page's life
(`#graphicsOf`), so a restarted worker gets the same one. Its state is spread over `progress.state` (also what the
status bar shows, through `onGraphics`), `loading` (a fetch on its way) and `damaged`. Writers of the shared buffer:
`landPart`, `failPart`, `retryPart` (`lazy-part.ts`).

| Event | Guard | Effect |
|---|---|---|
| `download()` (its Cache open); `start()` | | `#graphicsOf`: the part, pending; `sab` = `SharedArrayBuffer(PART_HEADER + size)` or null |
| `download()`'s start files are in; `start()`'s `started` | `sab`, not `loading`, not landed or failed | `#wantGraphics`: `#fetchGraphics` |
| `#fetchGraphics` | | the Cache (deleted first when fresh), else `#downloadGraphics` (`no-cache`; fresh: `reload`), kept in the Cache only beside the heap; size checked; `landPart` or `failPart` + one `online` listener; then `#tellGraphics` |
| worker posts `again` | sab; current part; failed; not `loading` | `#retryGraphics`: `retryPart` (tries + 1, pending), `#tellGraphics`, `#fetchGraphics(part, damaged)` |
| worker posts `damaged` | sab; current part; landed; not `loading` | `#refetchDamaged`: writes `progress.state = "failed"` so that `#retryGraphics` takes it, `damaged = true` |
| `online` | as `again` | `#retryGraphics` |
| no sab: worker posts `fetching`, `progress`, `landed`, `failed`, `damaged` | | `#workerSaysGraphics`: progress only (`damaged` becomes pending); `start()` resets it to pending for a new worker |

`#tellGraphics` sends the op `graphics` (no args, answered outside the queue) to the live worker, if any: it tells
the worker to look at the header, nothing more. It is sent only when there is a buffer.

**Worker** (`worker.ts`, the section "a lazy snapshot's graphics part", lines 56 to 425). Pure decisions are already in
`lazy-part.ts`: `waitStep` (a waiting graph) and `useNative`; the rest decides inline.

| Event | Guard (spelled where) | Effect |
|---|---|---|
| `boot`: `startEngine` calls the hook `lazyGraphics` (`worker-boot.ts`) | build has a part | `share` set; the engine's `lazy_graphics(waitGraphics)` (`src/dofile/browser.py`) |
| `startup` answered | | `started`, `idleSince`; no sab: `prefetch` in a task; `nativeSoon`; `idleSoon` |
| op `graphics` | | `nativeSoon`; `idleSoon` |
| run arrives (dispatch hook `arrived`) | | `runs++` (stops the idle steps at once, before the queue reaches the run) |
| run starts | | `askedAt = null` |
| run ends (`finally`) | | the "in the run, after the write" line; `runs--`, `idleSince`; `nativeSoon`; `idleSoon` |
| `nativeSoon` | started; part; none of native, decode, decoded, written, error (line 352); `nativeNow()` | `startNative` in a task |
| `startNative` | the same flags again (358); landed; brotli-sized | `native`; `inflateNative`: keeps the result unless a graph unpacked meanwhile; failure: `nativeFailedOn = copy`; then `idleSoon(0)` |
| `idleSoon` | started; part; no timer; not native; no error; not (written and warmed) (387) | timer to `idleSince + IDLE_MS` |
| `idleStep` | `runs === 0`; idle `IDLE_MS` | one of: write (`decoded`; then `browser.graphics_written`), one decode step, start native (`nativeNow()` again, 408), first decode step, one `warm_graphics` step; a throw: `damaged`; else `idleSoon(0)` |
| a graph: `browser.py`'s `_LazyGraphics.ensure` calls `waitGraphics(100)` in a loop | written: ""; `graphicsError`: said once | `waitStep` decides: break, write, decode(-more), say-fetching, fetch (`fetchPartNow`), ask-again (`again`, wait), give-up, wait-failed, wait-pending (`Atomics.wait` on the header); a throw: `damaged` |
| no sab: `prefetch` lands or fails | not aborted, not here, not written | `share.bytes`, `copies++`; posts `landed` (or `failed`); `nativeSoon`, `idleSoon` |
| `damaged(e)` | | `graphicsError`; decode dropped; no sab: bytes dropped, `fresh`; posts `damaged` |

The unpack is one state written as four flags: none, `native`, `decode` (brotli-wasm under way), `decoded` (not
written), `graphicsWritten`, then warmed (`warmAt < 0`); `graphicsError` stops all idle work. Two can hold at once:
`native` with `decode` (a graph decodes while the browser's decoder runs; its result is then dropped).

## 2. The 22 variables as one record

All at `worker.ts:70-97`, one `let` each. S8 moved none of them. It moved what surrounds them: the boot work into `worker-boot.ts`
(`startEngine`, which calls back through the hook `lazyGraphics` that `table`'s `boot` entry defines; `since` went there too), and
the dispatch into `worker-dispatch.ts`, whose hook `arrived` now counts `runs`. Four are written by `table`'s handlers for boot
and dispatch: `snapshotBase` and `brotliWasm` (mount), `started` (startup), `runs` (run).

| Group | Today | Proposed field (names R1's to choose) |
|---|---|---|
| given at start | `share`, `snapshotBase`, `brotliWasm`, `started` | `part` (`{file, hdr, sab, bytes}`), `base`, `wasm`, `started` |
| idle clock | `runs`, `idleSince`, `idleTimer` | `runs`, `idleSince`, `timer` |
| unpack | `decode`, `native`, `decoded`, `graphicsWritten`, `warmAt`, `tWarm`, `warmLongest` | one `unpack` state (none, native, decoding, decoded, written, warming, warmed) with its data |
| copies and damage | `copies`, `nativeFailedOn`, `fresh`, `graphicsError` | `copies`, `nativeFailedOn`, `fresh`, `error` |
| this run | `askedAt`, `fetchSaid`, `writtenInRun` | `run: {askedAt, fetchSaid, writtenAt}` |
| own fetch (no sab) | `prefetching` | `prefetching` |

Read but owned elsewhere (they stay): `interrupt` (boot), `brotliMode` (mount), `py`, `browser`. Dead today:
`share.error` is never set to a reason (only cleared, `fetchPartNow`), so `partNow`'s failed branch without a buffer
cannot be reached. Names the naming survey gives R1: `askedAt` (the tries when this run asked again), `at` in
`fetchPartNow` (a URL), `damaged(e)` (a verb's job: it drops the copy; not the field `damaged` of `GraphicsPart` in `client.ts`).

## 3. What stays a side effect

Pure, and testable as tables: what a waiting graph does (`waitStep`), whether to decode natively (`useNative`), and,
new in R1, what an idle step does and whether native may start (one predicate for lines 352, 358, 387 and 408), and the
page's transitions (fetch, retry, refetch-damaged, worker's message). Side effects, kept at the edge: `setTimeout`,
`postMessage` and the console lines, `Atomics.wait` and the header writes, `fetch` and the synchronous
`XMLHttpRequest`, `inflateNative`, `unpackSteps`, `writeGraphics`, `browser.graphics_written` and `warm_graphics`,
the Cache, the `online` listener, and the clock (passed in, as `machine.ts` does).

**Wire and words that stay unchanged** (they are read by e2e and by the page): the op `graphics` and `queued: false`;
the `{graphics: ...}` messages (`types.ts`, `FromWorker`); `waitGraphics`'s answers ("", "break", "pending", a
reason); the console lines `[dofile] graphics part: landed (cache|network)`, `written in a run`, `written while idle`,
`warmed`, `fetched by the worker`, `fetched by the worker in a run`, `in the run, after the write`,
`native brotli failed`, `the worker's own fetch was still on its way`, `the worker's fetch failed`; and
`browser.py`'s "(waiting for the graphics files to download)".

## 4. Driving a lazy part through the real worker under Node

**It already runs, unasserted.** `npm run snapshot` builds a lazy snapshot by default (`SNAPSHOT_NO_MPL` unset), and
`test/engine.test.ts`, "engine from a memory snapshot", then starts the real `worker.ts` (Node worker thread,
`test/harness.ts`) through `EngineClient` with a `SharedArrayBuffer`. The page half reads the part's `file:` URL with
`fs` (`#downloadGraphics`), lands it, and the test's `scatter` waits for it. Tried at e496b4c (snapshot at
`SNAPSHOT_QUALITY=5`): the run logs "landed (network)", "written in a run (unpack (wasm) ...)", "in the run, after the
write". A scratch test (not committed) that waited 4 s before its graph got "written while idle (unpack (native) ...)" and
"warmed": Node 26 has `DecompressionStream("brotli")`, so the native path and the idle steps run too. Nothing asserts
any of it, and the lines go to the process's stdout, not to the test.

**Without a buffer it cannot run as is.** Tried: with `SharedArrayBuffer` removed from the test's thread, the worker
thread died at `startup` ("Cannot read properties of undefined (reading 'href')"): `prefetch` reads
`self.location.href` outside its `try`, and its rejection is unhandled. Node also has no `XMLHttpRequest` (`fetchPartNow`)
and its `fetch` refuses `file:` URLs. `test/node-worker.ts` would need stand-ins for all three (guess: a few lines,
the synchronous request on `readFileSync`).

**What a held or damaged part needs.** The page's fetch of a `file:` URL bypasses the client's `fetch` option, so a test
cannot hold it (the e2e spec holds it with a route). A damaged copy can be had by pointing the snapshot folder's
`graphics.brotli.bin` at bad bytes, then good ones (guess: the test's own folder of symlinks, as engine.test.ts makes).

## 5. The iOS limit

`vite.config.ts` builds the worker as one file (`inlineDynamicImports`): a chunk importing the worker's entry made iOS
Safari run the entry twice, and the second copy took every later message. So R1's code goes into modules that
`worker.ts` imports statically (as `lazy-part.ts`, `worker-boot.ts`, `worker-dispatch.ts` are), never into a chunk
or a second worker of its own. This also rules out, for R1, the "decode on another thread" idea in lazy-matplotlib.md.

## 6. Races between the page and the worker

1. A page retry between a graph's two header loads: `waitGraphics`'s `read()` loads `tries` before `state`
   (`partTries`'s doc), so the retry shows as new tries, not as the new fetch's failure. Ordered by load order.
2. A page retry while `startNative` reads the part: `copyNow()` is read before `partNow()`, so a native failure is
   charged to the copy it read. Ordered by load order.
3. A copy landing while a graph reads a failed part's reason: the state is an `Atomics.load`, the length (`partData`)
   a plain read after it; the reason could come out as the next copy's bytes. Not ordered. Guess: harmless (only the
   text), and it needs a whole fetch between two loads.
4. The graph's `again` and the `online` event: both go through `#retryGraphics`, whose guard (failed, not loading)
   starts one fetch; the graph's `askedAt` makes either fetch's failure final for it. Ordered by the guard.
5. The part lands before `startup` is answered: the op `graphics` arrives, `nativeSoon` and `idleSoon` return on
   `!started`, and `startup` calls both. Ordered by `started`.
6. The part lands between two workers (restart): `#tellGraphics` skips an ended or absent worker; the next gets the
   same buffer at boot and reads the header at `startup`. Ordered; not tested (lazy-matplotlib.md: "argued").
7. A graph while the browser's decoder runs: the graph decodes with brotli-wasm; the native result is dropped by
   `!graphicsWritten && !decode && !decoded`. Ordered; costs a second decode.
8. A run arriving during an idle step: `runs++` happens at arrival, `idleStep` returns on `runs > 0`; the step under
   way ends first (one step at most). Ordered by the single thread.
9. No buffer, a graph while `prefetch` streams: `fetchPartNow` aborts it; the aborted fetch posts nothing, and a copy
   that ends late is dropped (line 316). Ordered.
10. No buffer, an ended worker's late `{graphics}` message: `worker.onmessage` hands it to `#workerSaysGraphics`
    without checking `live.ended` (answers to calls go through `live.pending`), after `start()` reset the progress
    to pending. Not ordered. Guess: whether a terminated worker's queued messages are still delivered was not checked.
11. Damage found by an idle step, then the fresh copy lands: `graphicsError` blocks `nativeSoon` and `idleSoon`, so
    the fresh copy waits; the next graph reports the damage (rc 199) although a fresh copy is there, the one after it
    draws. As `damaged()`'s comment says; R1 keeps it or the maintainer changes it.
12. Each failed page fetch adds one `online` listener (`once`); they pile up until the browser is online, each a no-op
    after the first. Not a race; noted.

## 7. Tests

**Pinning today, before any line moves:** `e2e/graphics.spec.ts` (7 tests; skipped without a part). It reads the
worker's and page's `[dofile] graphics part` lines (order "landed ... written ... warmed"; "written while idle"; written
once) and times the idle wait: from the run sent at "ready" to the "written while idle" line, less the write and a
brotli-wasm unpack, must exceed 0.15 s. Node: `test/lazy-part.test.ts` (`waitStep`, `useNative`),
`test/part-header.test.ts` (the layout), `test/client.test.ts` (four "graphics part" tests: the page's hand-over,
damage, re-fetch, failure and `online`), `test/worker-dispatch.test.ts` (`graphics` beside the queue),
`test/worker-boot.test.ts` (`lazyGraphics` called with the engine and the part, not without a part),
`test/snapshot.test.ts` (`unpackSteps`, `packGraphics`/`writeGraphics`), `test/app-engine.test.ts` (the graphics
subscription let go), and in CPython `tests/test_browser.py` (the two `lazy_graphics` tests).

**New, before R1's items move code:**
- a. Node, real worker, with a buffer (from section 4's scratch test): a graph at `started` writes "in a run"; idle:
  "written while idle", then "warmed", no step before the last run's end plus `IDLE_MS`; a restart with a landed part
  does not fetch again. Needs the harness to collect the worker thread's console lines (an option of `nodeWorker`).
- b. Node, real worker, with a buffer: a Break while a graph waits for a held part (rc 1, data kept, draws once
  released), and a damaged copy (the graph says so, the page refetches with reload, the next graph draws). Needs a
  way to hold the page's fetch of a `file:` part.
- c. Node, real worker, without a buffer: `prefetch` lands and the idle steps take it; a graph during `prefetch`
  fetches itself; damage gives a `?fresh=` address. Needs section 4's stand-ins in `test/node-worker.ts`.
- d. Pure tables for whatever R1 makes pure (idle step, native gate, page transitions), as `lazy-part.test.ts` does.

## 8. R1 in three items (proposed)

1. **R1a, the nets (2.3).** Tests a to c with their harness changes; `share.error` either set by the no-buffer
   failures or removed (the test says which); no change to behaviour.
2. **R1b, the worker's machine (2.3, after R1a).** The 22 variables as one record (section 2) in a module `worker.ts`
   imports statically; the idle step and the native gate as pure functions next to `waitStep`; the renames; `table`'s
   hooks call it; wire and words unchanged (section 3). Tests d for the worker.
3. **R1c, the page's machine and the docs (2.4).** `client.ts`'s part as one state with its transitions (no rewrite of
   `progress.state` to steer a guard; `progress` becomes derived for the status bar); the `online` listener once per
   part; race 10 checked against `live`. Then `docs/lazy-matplotlib.md` brought up to date (list below),
   `src/dofile/browser.py`'s section comment, and `docs/test-map.md`. It leaves `app/state.ts` and
   `app/engine.ts` alone (`onGraphics` keeps its shape).

## 9. Where lazy-matplotlib.md is out of date

- "`SharedArrayBuffer(16 + size)`": the code says `PART_HEADER + file.size` (`#graphicsOf`); the value holds.
- The worker's own fetch is called `fetch` ("`fetch`, off the engine's way"; "the worker's `fetch` uses
  `cache: "reload"`"): the code has two, `prefetch` (after `startup`, streamed, with progress, `reload` after damage)
  and `fetchPartNow` (a graph's synchronous request, `?fresh=` after damage).
- "The page asks for the part at the end of `download()`": also after `started` (`start()`), which is the call that
  counts when `download()` had no Cache to fill.
- "the graph that found it says so (rc 199), the next one waits for the fresh fetch": when an idle step found the damage,
  the next graph says it even if the fresh copy is already there (race 11).
- Its title and heading still say "experiment" and "E1c", as do `src/dofile/browser.py`'s section comment ("experiment
  E1c") and `docs/test-map.md`'s `graphics.spec.ts` entry.
- Checked and holding: 256 KB decode steps, `IDLE_MS` 0.25 s, `waitGraphics(100)` slices, the warm order (three
  modules one at a time, then 20), `useNative`, the `no-cache`/`reload` fetches, 158 modules to warm and 1,822 files
  (this build). Not checked: its timings and sizes.
