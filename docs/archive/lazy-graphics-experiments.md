# Lazy graphics: results of the experiments

Archive: finished work, not kept current. The design that shipped is in [../lazy-matplotlib.md](../lazy-matplotlib.md); this
file records what was tried on the way, what it measured and why each idea was kept or dropped (2026-11-15 and 2026-11-16).

The numbers come from working reports (timing runs, investigations, builder and reviewer reports) that were local files and
are not kept in the repo. Each number below names the report it came from, in brackets: `timing-E1c`, `timing-tables`,
`inv-memory`, `timing`, `parallel`, `drop`, `E1c-fix3`, or `session notes` (the orchestrator's running notes, which hold
the maintainer's phone captures and decisions). All timings are medians with (min-max), n = 5, on one Mac, unless a row says
otherwise. A difference counted as real only when it beat the spread and was at least 0.5 s or 2 MB.

## 1. The phone: what was slow, and what it was not

**Captures** (maintainer's iPhone on iOS 27, Safari, a LAN dev server over plain http; session notes):

| Capture | Value |
|---|---|
| Lazy build, a graph sent at once after load | 2.2 s; second run 0.1-0.5 s; first run after waiting 0.4 s |
| Main (matplotlib in the heap), first run | usually 0.4 s |
| A bad stretch with the lazy build | 20 s: 7 s for the non-graph part, 13-15 s for the graph |
| Lazy build with many apps open | no-wait runs "between 2-20 seconds randomly"; main not more than 1-2 s |
| Safari's `EnhancedSecurity` flag on or off | little difference; both 3-5 s without waiting |
| Worker lines, run sent at once (two loads) | 3.44 s (brotli-wasm unpack 1.06, write 0.47, the worker fetched the part again) and 6.80 s (unpack 1.94, write 0.78, rest about 4 s fetch, import, run) |
| Worker lines, run after waiting | 0.47 s, the same as main |
| Idle steps on the phone | native unpack 0.32-0.54 s, write 0.09-0.30 s, import steps 0.34-0.59 s |

**Refuted or not supported:**

- **Memory.** On a Mac WebKit, the lazy build's peak was 80-100 MB lower than main's, not higher; peak resident size
  "boot / run" was 1185 / 1321 MB lazy against 1396 / 1403 MB main on the LAN http page (single samples, `inv-memory`). The
  lazy build does take about 136 MB of new memory during a run at ready, against about 7 MB for main (`inv-memory`), and the
  phone's memory was never measured, so "pressure on a long run" stays a guess. Growing a WebAssembly memory from 113 MB to
  415 MB in 16 MiB steps took 14 ms in total on WebKit (`inv-memory`): copying on grow is not the cause on the Mac.
- **"Warm-up by time"** (the engine gets faster some seconds after start): see section 3. An import after a 10 s wait still
  took 9 s on the phone (session notes).
- **"The log is delayed by output streaming"** (lines of the non-graph part wait for the graph's load): the reader's check of the
  code found that a top-level graph command already has the earlier output sent before it waits; a probe on WebKit showed
  text streamed to the page within 350 ms of a 9.2 s run (`E1c-fix3`, session notes). The fix that flushes the log before
  a graph waits stayed (nested output in a loop was held), but it does not explain the phone's delay, which stays unexplained.
- **A tab reloaded by the dev server.** Some slow runs that came out fast "after visiting prod" were the dev server reloading
  the tab when the maintainer came back (session notes).

**What fit: iOS 27 runs plain http pages without the JIT.** A Mac WebKit puts a page loaded over http from a LAN address in a
process named `com.apple.WebKit.WebContent.EnhancedSecurity`, with JS and WebAssembly running without the JIT (`inv-memory`).
A 3e7-iteration loop, three runs each:

| Page | JS | wasm | Process |
|---|---|---|---|
| WebKit, http on a LAN address | 173, 168, 167 ms | 201, 199, 206 ms | `...EnhancedSecurity` |
| WebKit, http on 127.0.0.1 | 9, 10, 11 ms | 29, 31, 29 ms | normal |
| WebKit, https on a LAN address (self-signed) | 10, 9, 10 ms | 28, 31, 28 ms | normal |

That is JS about 17 times and wasm about 7 times slower (`inv-memory`). The trigger is the plain-http scheme, not the address.
Chromium showed no difference between the two addresses. The same lazy build, `analysis.do` run at ready on WebKit
(`inv-memory`, single samples):

| Page | Lazy build | Main |
|---|---|---|
| LAN http (JIT off) | 10.02 s, 11.03 s | 1.66 s |
| 127.0.0.1 (JIT on) | 0.53 s | 0.16 s |

The lazy build does a brotli-wasm decode and about 600k Python calls of import at run time, so a JIT-less page hurts it much
more than main. A public WebKit bug report (Bugzilla 324968, read by the investigator) calls this intentional for iOS 27
http pages. Whether the phone's variance comes from the heuristic being applied per load, or from pressure on a run that is
already slow, was not settled (`inv-memory`; the maintainer later saw "not much difference" with the flag off). Over https
the same phone drew a graph sent at ready in 1.1, 0.85 and 0.85 s (`session notes`, `pr-body-final`). The timing reports'
WebKit rows are JIT-on numbers.

## 2. Timing against main, before the lazy part's final fixes

Commit `b015fe6` (lazy) against main `9de27af`; Playwright Chromium 158.0.8127.18 and WebKit 27.2; brotli 11; served by
`build:local`, served = built checked; one build after the other, main always first; load average 2.1-3.4 (`timing-E1c`).
Download before "ready": main 44.14 MB, lazy 33.88 MB; the whole first visit 44.14 MB against 41.57 MB (`timing-E1c`).

Time to ready, display job (`timing-E1c`, `timing-tables`):

| Visit and network | Main | Lazy | Difference |
|---|---|---|---|
| First, Chromium, unthrottled | 1.32 (1.31-1.48) | 1.07 (1.06-1.25) | not real |
| First, Chromium, 100 Mbps / 20 ms | 4.97 (4.96-4.98) | 3.98 (3.95-4.00) | -0.99 s, real |
| First, Chromium, 30 Mbps / 50 ms | 13.48 (13.45-13.51) | 10.53 (10.52-10.56) | -2.95 s, real |
| First, WebKit, unthrottled | 1.19 (1.16-1.34) | 1.06 (1.05-1.22) | not real |
| Return, Chromium, unthrottled | 1.16 (1.16-1.17) | 0.93 (0.92-0.95) | not real |
| Return, Chromium, 100 Mbps | 1.25 (1.24-1.26) | 1.02 (1.00-1.03) | not real |
| Return, Chromium, 30 Mbps | 1.34 (1.34-1.38) | 1.12 (1.09-1.13) | not real |
| Return, WebKit, unthrottled | 0.98 (0.96-1.00) | 0.85 (0.83-0.87) | not real |

A graph sent at ready, image minus ready (`timing-E1c`):

| Visit and network | Main | Lazy |
|---|---|---|
| Return, Chromium, unthrottled | 0.12 (0.11-0.12) | 0.57 (0.56-0.58) |
| Return, Chromium, 100 Mbps | 0.11 (0.11-0.12) | 0.57 (0.57-0.58) |
| Return, Chromium, 30 Mbps | 0.12 (0.11-0.12) | 0.58 (0.56-0.58) |
| Return, WebKit, unthrottled | 0.13 (0.13-0.14) | 0.52 (0.51-0.52) |
| First, Chromium, 30 Mbps | 0.12 (0.11-0.12) | 1.68 (1.67-1.70), the part's request takes about 2.1 s |
| First, Chromium, 100 Mbps | 0.12 | 0.58 (0.57-0.58) |

The ranges never overlap, so the loss is consistent: +0.45 s on Chromium, +0.39 s on WebKit, under the 0.5 s bar. From the
page's start the loss is smaller (return visit, graph image: Chromium 1.28 against 1.51, WebKit 1.12 against 1.36). On a
first visit at 30 Mbps the graph image still came 1.35 s earlier than on main from the page's start (12.22 against 13.57).
The maintainer accepted the 0.45 s ("Accept, measure it", session notes).

A non-graph run at ready took 0.01 s on both builds in every row. Sent during the background import (return visit, 100 ms after
"written", `warmedBeforeSubmit` false in all 40 rows): 0.07-0.08 s Chromium, 0.03 s WebKit; a graph sent then took 0.31-0.32 s
on Chromium and 0.25 s on WebKit from submit. The longest import step the worker reported was 0.18 s (Chromium) and 0.15 s
(WebKit). The part's idle unpack was 0.35-0.36 s with brotli-wasm on Chromium and 0.09-0.13 s native on WebKit
(`timing-E1c`).

## 3. The eager-import experiment (cut)

**Idea.** The slow phone runs come from the import and the write happening inside the user's run. An `?graphics=eager`
switch (`E1c-fix3`) did the unpack, the write and one long import call inside the start, so they were over before "ready".
A second switch, `eagerdelay=<s>`, waited some seconds after the start before that import, to test "the engine speeds up
with time" (a JIT warming up). A DIAG commit also logged each run's sent, arrived and done times and every idle step over 50 ms.

**Results.**

| Where | Result |
|---|---|
| Mac WebKit, LAN http (JIT off), 1 sample | normal ready 1.2 s; eager ready 7.4 s, of which import 6.01 s (session notes) |
| Same, `eagerdelay` 3 s | import 6.09 s, no change (as expected: no JIT at all there; session notes) |
| Phone, eager | start 4.62 s; fetch 0.11, unpack 0.16, write 0.42, import 12.15 s; 12.84 s before ready (session notes) |
| Phone, normal idle import | import 2.50 s in steps, longest 0.56 s (session notes) |
| Phone, same import at other times | earlier captures 0.8-1.2 s; 12 s right after start (session notes) |
| Phone, eager after a 10 s wait | still about 9 s of import (maintainer's words, session notes) |

**Outcome.** It did not help, so the switch and the DIAG lines were cut from the code before the PR. The code survives
only on the local branch `exp-e1c`: the switch in `4465722`, `eagerdelay` in `17577c0`, the DIAG lines in `59489d1`. The
wait-by-time hypothesis is refuted on the phone; the same import took 12 s, 2.5 s and 0.8-1.2 s in different captures, and
the cause was not found.

**Left untested.** The eager import is one long call (`warm_graphics(.., 1000)`), while the shipped import runs in steps of one
task each. The lead was that JavaScriptCore may tier up code only between calls. It was never tried to run the eager import
in steps (session notes). The phone's JIT-less http pages also make any phone number from a plain-http dev server a number
the production https page would not show (section 1).

## 4. The page-side native unpack (built, measured, dropped)

**Design** (`parallel`, commit `ca1c05f`, later reverted). On a return visit in Firefox and Safari (a browser with a brotli
`DecompressionStream`), on a cross-origin isolated page, the page decoded the part with the browser's own decoder as soon as
the worker passed its stage "python", into a second 32.9 MB `SharedArrayBuffer` handed to the worker at boot. A graph at ready
then wrote the page's bytes without decoding anything, or `Atomics.wait`ed for the page's decode. The worker wrote the files
while idle and the page freed the buffer. Chromium, `?brotli=wasm` and pages without a `SharedArrayBuffer` were unchanged.
The same work found that the return visit's Cache read was already early (before the worker's start), so the earlier
"read nothing before ready" wording was wrong and was corrected (`parallel`, `drop`).

**Mac timing** (`timing`, WebKit 27.2 and Chromium 158, unthrottled, return visit, 5 reps, 120 job runs rc 0; build without
the unpack, `7f0e4a9`, against with it, `d9d28f9`):

| WebKit row | Without | With |
|---|---|---|
| Ready, display job | 0.85 (0.83-0.85) | 0.86 (0.85-0.87) |
| Graph at ready, image | 1.43 (1.43-1.46) | 1.27 (1.25-1.29) |
| Graph at ready, image minus ready | 0.59 (0.58-0.60) | 0.41 (0.40-0.41) |
| Non-graph at ready, result minus ready | 0.07 (0.07-0.08) | 0.01 (0.00-0.01) |
| Run during import, display / graph image, from submit | 0.05 / 0.27 | 0.04 / 0.27 |

Chromium: every difference was at most 0.01 s, as expected (no native decoder there). The gain on the Mac was 0.16-0.18 s,
under the 0.5 s bar. The non-graph row shows the idle native unpack in the worker holding a run sent at ready for 0.07 s;
the reading that this is the cause was not tested.

**Phone, https A/B** (maintainer, LAN https dev server, a graph sent at ready, three runs; session notes):

| | With the unpack | Without |
|---|---|---|
| Image after ready | 1.3, 0.87, 1.5 s | 1.1, 0.85, 0.85 s |

**Why dropped.** The maintainer: "it does not seem to have value". Also: the Mac gain was 0.16 s; it needed about 33 MB more
before "ready" (`parallel` estimate: 32.9 MB for the raw buffer and 7.7 MB for the kept compressed bytes, not measured; the
orchestrator's notes call it a cost not worth the gain) and about 250 lines (orchestrator's estimate) of hand-over code
that is prone to races (the reviewer found a tries-before-state ordering race in the worker's wait, fixed in the drop; there
were no unit tests of the hand-over). The reviewer's verdict on the unpack was accept after fixes with no must-fix; the
decision was the maintainer's. The revert (`drop`, `fb2f60f`) kept the corrected comments and docs, the e2e test that a
return visit reads the part before ready, and the reviewer's small fixes (SPEC's graphics messages, test-map).

## 5. Compression and decoding

**Sizes** (Node 26, one Mac, the final tree's brotli 11 snapshot, `d9d28f9` build; session notes). The raw column is the
decoded size; gzip and deflate-raw were made from the same raw files.

| File | Raw MB | Brotli 11 | gzip 6 | gzip 9 | deflate-raw 9 |
|---|---|---|---|---|---|
| Heap | 113.12 | 15.19 | 23.13 | 22.94 | 22.94 |
| Bundle | 64.34 | 12.26 | 18.12 | 18.05 | 18.05 |
| Graphics | 32.94 | 7.69 | 11.69 | 11.64 | 11.64 |
| Total | 210.41 | 35.15 | 52.94 | 52.63 | 52.63 |

gzip 6 is 17.79 MB larger in total than brotli 11 (difference computed from the table).

**Decode speed** (Node 26, Mac, load average about 4.5-10 from other sessions; session notes):

| Decoder | Input | Time |
|---|---|---|
| Native brotli | heap | 180 ms, 1 sample |
| Native gunzip (level 9 file) | heap | 97 ms, 1 sample |
| brotli-wasm | heap | 260 ms (435 MB/s), median of 3 |
| brotli-wasm | bundle | 154 ms (419 MB/s), median of 3 |
| brotli-wasm | graphics | 96 ms (342 MB/s), median of 3 |

In the browser, the lazy build's graphics unpack with brotli-wasm took 0.14 s in a run (`timing-tables`, Chromium and
WebKit) and 0.35-0.36 s as stepped idle work on Chromium. Native brotli on WebKit took 0.09-0.13 s (`timing-E1c`).

**Chromium has no brotli `DecompressionStream`.** `DecompressionStream("brotli")` raised a TypeError in Playwright Chromium
158.0.8127.18 and in `Chromium.app` 156.0.8078.79 (session notes). Google Chrome was not installed and not checked. So on
Chromium the worker decodes the whole snapshot and the graphics part with brotli-wasm (the check is `hasNativeBrotli` in
`worker.ts`); Firefox and Safari decode natively.

**`Content-Encoding: br` instead** would let the browser decode, off the thread, also in Chrome. The trade-offs written down
(session notes): the Cache API stores the decoded body, so the cache would hold the raw sizes (210.41 MB for the snapshot
files in the table above, against 35.15 MB as brotli 11); the host may
re-encode the response; the progress ring's byte counts then differ; and `snapshot.ts` deliberately handles opaque bytes.
It was not built or measured.

**Dropped by decision, not open work** (the maintainer: "ok, ignore this then"; session notes): gzip or deflate-raw for
browsers without native brotli (gzip is about 1.5 times larger by the table and decodes about 1.9 times faster in Node by
the one-sample row, both computed from the rows above; native `DecompressionStream("gzip")` exists in Chromium); decoding
the part in split chunks; and a decode worker for Chromium. None of them was built.

## 6. Firefox, after the merge

`measure-startup.mjs --engine firefox` (added for this run; unthrottled only). Firefox 159.0 (Playwright), one Mac,
snapshot mode, brotli 11, n = 5, load average 1.8-3.5; main before the lazy part (`0430fd2`, matplotlib in the heap)
against the lazy part with its follow-up fixes (`d33873c`) (`firefox`):

| Row | Before the lazy part | Lazy part | Difference |
|---|---|---|---|
| Return visit, ready (display job) | 1.07 (1.07-1.08) | 0.89 (0.89-0.89) | -0.18 s, not real |
| First visit, ready (display job) | 1.28 (1.26-1.49) | 1.08 (1.08-1.30) | -0.20 s, not real |
| Return visit, graph at ready, image minus ready | 0.10 (0.10-0.10) | 0.73 (0.72-0.74) | +0.63 s, real |
| First visit, graph at ready, image minus ready | 0.10 | 0.74 | +0.64 s, real |
| Return visit, graph at ready, image from the page's start | 1.19 (1.17-1.22) | 1.62 (1.61-1.63) | +0.43 s |
| Non-graph run at ready, result minus ready | 0.00-0.01 | 0.07 | not real |
| During the background import (lazy only), from submit | | display 0.06 (0.04-0.07), graph 0.32 (0.31-0.33) | |

`warmedBeforeSubmit` was false in all 10 during-import rows. A graph at ready costs more on Firefox than on Chromium
(+0.45 s) or WebKit (+0.39 s) in section 2, and is the only row over the 0.5 s bar measured from "ready"; from the page's
start it is +0.43 s.

**Where it goes** (`ffinv`: return visit, unthrottled, n = 5, the worker's own lines; the decoders also timed alone in a
module worker on a page without Pyodide). A graph sent at the instant of "ready" cannot take the browser decoder's result,
which is in flight, because the worker is blocked in Python: it unpacks with brotli-wasm in the run.

| | Firefox | WebKit | Chromium |
|---|---|---|---|
| Graph at ready, ready to image | 0.68-0.73 | 0.59 (0.58-0.59) | 0.58 (0.57-0.59) |
| of it: brotli-wasm unpack, write, import and draw | 0.22, 0.09, 0.40 | 0.14, 0.02, 0.36 (first rep) | 0.14-0.15, 0.03, 0.43 (first rep) |
| The part alone, native `DecompressionStream` | 0.066 (0.060-0.069) | 0.060 (0.059-0.067) | none |
| The part alone, brotli-wasm in 256 KB steps | 0.115 (0.112-0.119) | 0.099 (0.098-0.113) | 0.098 (0.096-0.116) |

Firefox's native decoder is not slow: in the app it took 0.06 s (n = 3). The worker's line "written while idle (unpack
(native) 1.06s ...)" counts from the decode's start to the write, and the write waits until the engine has been idle
for `IDLE_MS` (1 s), so it is mostly that wait. Firefox is about 0.1 s slower than WebKit in the brotli-wasm unpack and
the write of 1822 files; the in-app brotli-wasm unpack (0.22 s) is twice the stand-alone one, not explained.

A graph sent later is faster (Firefox, submit to image): 0.51-0.56 s from 200 ms to 1 s after ready (the native result
is there; write, import and draw remain), 0.19 s at 1.3 s, 0.10 s from 1.7 s (the idle work done). `?brotli=wasm` on
Firefox gave the same graph run (no contention with the native decode) and a slower start, since it also decodes the heap
and the bundle with brotli-wasm: warm ready 1.11 (1.10-1.11) against 0.86 (0.85-0.87). With `IDLE_MS` 250 (a trial,
Firefox only) a graph 0.5 s after ready took 0.25 s and from 0.8 s about 0.10 s, against 0.53-0.56 s; at 0-0.2 s no
change. Its cost to a non-graph run sent in that window, and its effect on phones, WebKit and Chromium, were not measured.

Later measured on all three browsers (n = 5): `IDLE_MS` 250 against 1000, a graph sent 0.5-1.1 s after ready was
0.3-0.5 s faster (Chromium, WebKit, Firefox), no change at 0-0.2 s; a non-graph run that meets an import step waits
0.1-0.2 s at either value, only sooner. With the whole browser on a Mac's efficiency cores (worker about 5.7x slower),
a graph took 3.2-3.5 s at every delay up to 1.5 s at both values, and the longest import step was 0.9-2.0 s.
`IDLE_MS` became 250.

## 7. Never measured

- Firefox throttled, and Firefox's memory (section 6 is unthrottled timing only).
- Android, and any phone other than the maintainer's iPhone.
- Memory peak on the final build: only single Mac samples from the earlier build (`inv-memory`) and an estimate for the
  page-side unpack (`parallel`). Phone memory, jetsam events and garbage collection were not measured.
- The production page on a phone (the deploy was checked by `start-files.json` only).
- Throttled WebKit (the harness throttles Chromium only); WebKit at 100 and 30 Mbps.
- Alternating the order of builds (main or the build without the unpack always ran first).
- The https phone numbers are 3 runs of one graph at ready; no first-visit or in-import phone run over https.
- The restart race and the two-tab case are argued, not tested; no phone capture settled why the phone's runs were so
  variable over http.
