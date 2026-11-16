# dofile web demo: experiment, loading matplotlib lazily

## The lazy graphics part (experiment E1c)

The second design, built to the maintainer's three requirements: the download widget shows the true size, only a graph
waits, and a return visit is not slower. The first (E1b) made every run wait for the part.

- **Build.** matplotlib, pillow, kiwisolver, fonttools, contourpy, cycler, pyparsing, python-dateutil, pytz, six and
  packaging leave the heap and the bundle for `graphics.brotli.bin`: a u32 index length, a JSON index (with the list of 158
  modules the background import runs, in order), then the files, with `.pyc` for the modules the four graph kinds and
  the export import. The build raises (the earlier prototype's `assert`s were stripped by `PYTHONOPTIMIZE=2`) when a check
  fails. Brotli 11, 2026-11-15: heap 15.11 MB, bundle 12.22 MB, part 7.69 MB (32.9 MB raw, 1,822 files, 5.2 MB raw `.pyc`);
  `start-files.json`'s `download` is 41.57 MB with the part, 33.87 MB before "ready".
- **With a SharedArrayBuffer the page fetches, never the worker** (`client.ts`, `#graphics`): a busy worker cannot advance a fetch. The Cache first
  (at the start, so a return visit has it by "ready"), else the network once the start files are in, with
  `cache: "no-cache"` and the size checked. It is written to the Cache only when the build's heap is already there. The bytes
  go to the worker in one `SharedArrayBuffer(16 + size)`: Int32 `[state, byte count, tries, 0]` (state 0 pending, 1 landed, 2 failed; `tries`: the page's fetches, counted), then the
  part, or the reason as UTF-8. The page is cross-origin isolated in production (`_headers`: COOP `same-origin`, COEP
  `require-corp` on every path), as Break already needs. Without a SharedArrayBuffer (plain http on a LAN address, say)
  **the worker is the part's one owner and the page never fetches it**: a message cannot reach a graph blocked in Python,
  so a graph could not use the page's bytes and would download them again. The worker fetches it itself once `startup`
  is answered (`fetch`, off the engine's way); a graph that comes before that lands stops it and fetches the part with a
  synchronous request (the bytes the stopped fetch had are lost, so the part arrives whole once, not without overlap).
  There is no Cache then (plain http has none). The page still shows the download: the worker posts `{graphics: "fetching"}`,
  `"progress"` (bytes received, at most every 100 ms), `"landed"` or `"failed"`, and the page's one writer of the progress
  turns them into the "Graphs loading" ring and the download total. A graph that fetches it in a run first gets "pending"
  from `waitGraphics`, so it prints the waiting line before its synchronous request blocks; that request has no progress to
  tell, so the ring shows 0 of the total until it lands. A part that arrived damaged is fetched again from an address of its
  own (`?fresh=`; the worker's `fetch` uses `cache: "reload"`), not from the browser's HTTP cache.
- **Only a graph waits.** A `sys.meta_path` finder for `matplotlib`, `mpl_toolkits` and `pylab` and a wrapper on the graph
  store's `put` call `waitGraphics`, which unpacks a landed part with brotli-wasm in 256 KB steps (the interrupt buffer
  read between them: a Break there is rc 1 and the unpack goes on from that step later), or `Atomics.wait`s in 100 ms
  slices, looking at the interrupt buffer between them: a Break is rc 1 with the data kept, and the page's fetch goes on
  (no download again). A failed or offline part gives rc 199 "graphs are not available: …"; other work is unaffected; a
  graph that finds it failed asks the page for one more fetch (`{graphics: "again"}`) and waits for it, so once online the
  next graph draws; its failure is final for that run. The page also fetches it again on the `online` event. A run that does not graph never touches any of it.
- **A return visit's start and its non-graph runs are not slowed; a graph sent before the idle work is done pays for it in the run.** The page reads the part from the Cache only once the engine has started, and the
  worker does nothing of it before `startup` is answered. Then the browser's own brotli decoder (Firefox, Safari; it runs
  off the worker's thread) unpacks it as soon as it is there, run or no run. A brotli-wasm unpack (Chromium) in 256 KB
  steps, the write, and the import of what a first graph needs (the three heavy modules one per step, then 20) run on the
  engine's thread, so only after the engine has been idle (no run sent or running) for 1 s, one step per task: a run sent meanwhile waits
  for the step in progress (the "written" and "warmed" console lines give the longest step), and, JS being
  single-threaded, no module is half imported. What is measured: a non-graph run at "ready" is not held (Chromium,
  one sample: `display 1` 0.01 s after ready). A graph at "ready" finds nothing unpacked: it decodes (brotli-wasm, in
  the run), writes and imports matplotlib there (Chromium, one sample: ready to image about 0.55 s, about 0.45 s more
  than main's first graph). A graph that arrives while the browser's own decoder is unpacking (Firefox, Safari) cannot
  wait for it, a worker blocked in Python never sees the promise settle: it decodes with brotli-wasm itself, and the
  native result is dropped, so the files are written once. Not done: letting that graph use the native result. The
  decoder's output comes through promises on the worker's own event loop, which a graph blocked in Python never runs; a
  SharedArrayBuffer does not help, since nothing outside the worker holds the raw bytes. Only a decode on another thread
  (the page, or a nested worker) into a ~33 MB SharedArrayBuffer that the graph `Atomics.wait`s on would; that covers
  isolated pages only (not the plain-http phone) and saves the wasm decode (about 0.15 s with the JIT on). Without a
  SharedArrayBuffer nothing can be done. Before a graph waits, the run's log so far is sent to the page (browser.py,
  `flush_output`), so the lines before a graph do not wait for it.
  `measure-startup.mjs --first-run` times a run at "ready" on the return visit, and `--during-import` one sent while the
  background import runs.
- **The widget.** `download` includes the part, so the prompt, the landing page and the meta tag show the true size. The
  dialog's bar counts what comes before the start, and says under it "+ 7.7 MB of graphics after the start"; after the
  start, while the part downloads, the status bar (on a phone, the strip under the top bar) shows "Graphs loading" and a
  ring of its percent (a progressbar named "Graphs loading, 3.1 of 7.7 MB"). Nothing once it lands, and no lasting label
  after a failure (the graph's own error says why).
- **Measured** (`measure-startup.mjs`, median of 5, brotli 11, one Mac, Chromium and WebKit; a difference counts when it
  beats the spread and is at least 0.5 s or 2 MB): before "ready" the first visit downloads 33.9 MB, not 44.1 (41.6 MB with
  the part); ready comes 1.0 s sooner at 100 Mbps and 3.0 s sooner at 30 Mbps (not different unthrottled). A non-graph run at
  "ready" takes 0.01 s on both builds, and 0.03 to 0.08 s when sent during the background import. A return visit is ready
  about 0.2 s sooner. A graph sent at "ready" on a return visit takes about 0.4 s more than on a build with matplotlib in the
  heap (0.52 to 0.58 s against 0.12 to 0.13 s): it decodes, writes and imports in the run.
- **Known limits.** On an iPhone, a graph sent in the first seconds after load does the part's work inside the run and took
  3 to 7 s on one phone (a build with matplotlib in the heap: about 0.4 s); a graph after a few seconds is as fast. Over plain
  http (a LAN address: no Cache, no SharedArrayBuffer) the worker fetches the part itself and the ring shows 0 of 7.7 MB while a
  graph's own request runs. Not tested: a real phone over https, Android, Firefox's timing.
- **Not done:** the restart race and the two-tab case are argued, not tested; a part that arrives damaged is dropped from the Cache by the page (the worker posts `{graphics: "damaged"}`), fetched again from the network, and the graph that found it says so (rc 199), the next one waits for the fresh fetch;
  `nodraw` graphs also wait.

The sections below are the 2026-11-07 findings and the plan this design replaces; their estimates are not updated.

An experiment that is not done: whether the snapshot should load matplotlib on the first plot.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged.

## Experiment: loading matplotlib lazily

Status: **done as the lazy graphics part (above)**. Findings and conjectures recorded 2026-11-07, while working on the snapshot
([pyodide-snapshot.md](pyodide-snapshot.md)).

**The question.** Matplotlib is about 28% of the site-packages files and about 23 MB of the snapshot's raw heap, and it is
needed only when a program draws a graph. Should it be loaded on demand in the snapshot flow (left out of the heap and the
main download), in the regular flow (which already imports it at the first plot), or both? The first plot should not take
about a second, as it does in the regular flow today. The snapshot's eager import is worth keeping unless lazy loading saves
**significant** time at a cold and a warm start without bringing that delay back.

### Measured

Pyodide 314.0.7 under Node, a normal boot, an M-series Mac, 3 runs each; the first plot is `scatter y x` in a fresh `Engine`
after numpy, scipy and `dofile.engine` were loaded. `browser.start()` itself takes 1.8 s (numpy and scipy); matplotlib and PIL
come with the first graph. Not yet measured in a browser.

| Part of the first plot | Time | Share |
|---|---|---|
| Compiling matplotlib's 147 `.py` files to bytecode (no `.pyc` exists for any) | 0.59–0.61 s | about 68% |
| Running the modules' code (173 modules) | about 0.2 s | about 25% |
| Fonts and first-use drawing | about 0.03 s | about 3% |
| The plot itself | 0.04–0.05 s | about 5% |
| **First plot** | **0.87–0.89 s** | |

- **With unchecked-hash `.pyc` files written for those 147 modules beforehand, the first plot took 0.29 s** (the one experiment
  behind "0.9 s to 0.3 s": `.pyc` files written just before the plot, standing in for a build step).
- **Fonts are not the delay:** the font list loads in 0.001 s (Pyodide's matplotlib ships a prebuilt list). On CPython a cold
  font cache cost 11.2 s (scanning 1,070 system fonts), which does not exist in the browser.
- **In the snapshot flow the first plot is already fast** (the sample program took 0.11 s against 0.87 s in the regular flow),
  because matplotlib is imported and compiled before the heap is saved.
- **The engine already imports matplotlib lazily** (`graphics/render.py` imports it inside functions), so neither flow needs an
  engine change. The profile showed no `pyplot` import during the first plot (read off the profile, not checked in the source).
- **What matplotlib is worth in the snapshot** (stage-by-stage build, brotli 5, and the bundle): importing it adds 23 MB of raw
  heap and **4.5 MB** compressed; its files and dependencies (pillow, fonttools, kiwisolver, contourpy, pyparsing, dateutil,
  pytz, six) are 1,052 of the 3,884 files, 26–27 MB of 93 MB raw, **7.4 MB** compressed. Only 16 of the 136 native libraries
  are graphics-only.
- **No `.pyc` anywhere in the bundle**, so the regular flow compiles everything it imports on every page load. Pyodide's
  package loader does not write `.pyc` files.

### Conjectures (not measured)

**Snapshot flow, lazy graphics.**
1. The build's warm-up draws nothing, so matplotlib is never imported (assert `'matplotlib' not in sys.modules`). The bundle is
   split into a core part and a graphics part (matplotlib, mpl_toolkits, pylab, PIL, pillow, kiwisolver, contourpy, fontTools,
   cycler, pyparsing, dateutil, pytz, six) with its own file index and `.pyc` files for the modules a plot imports. The 16
   graphics libraries leave the re-link list and link normally at their first import.
2. The page restores the core snapshot as today, so the engine is ready sooner.
3. After "ready" the worker fetches the graphics part (Cache API, brotli), decompresses it and writes it into site-packages.
4. `run` waits for those files, because any command can draw. Optionally the worker imports matplotlib right after, so the
   first plot pays no import.

| Estimate, brotli 11 (from the 42.3 MB build, before docstring stripping) | Now (eager) | Lazy: core, before "ready" | Lazy: graphics, after |
|---|---|---|---|
| Heap | 22.2 MB (measured) | about 18.6 MB | |
| Files | 20.0 MB (measured) | about 13.8 MB | about 6.2 MB, plus about 2 MB of `.pyc` (a guess) |
| Total | 42.3 MB | **about 32–33 MB** | **about 8 MB** |

The graphics shares are the brotli 5 figures scaled by the ratios measured between brotli 5 and 11 (0.77 heap, 0.84 files). A
visitor who plots downloads about the same in all; the gain is about 9.7 MB less before "ready". Timing guesses: a warm start
about 1.05 s instead of 1.2 s; the first plot after a warm start about 0.4 s with `.pyc` or about 1.0 s without; a cold start
about 0.8 s faster at 100 Mbps and 2.6 s faster at 30 Mbps, which would bring the snapshot at 30 Mbps from 13.9 s to about
11.3 s, ahead of the regular boot's 13.9 s.

**Regular flow.**
- **(a) Import matplotlib in the background once the engine is ready.** It moves the 0.9 s off the click and changes no
  download. A Run issued during that import waits up to about 0.9 s (Python is single-threaded in the worker).
- **(b) Ship precompiled `.pyc` files for the graphics packages.** The first plot at about 0.3 s. Matplotlib comes from
  Pyodide's CDN without `.pyc` files, so this needs our own repackaged bundle, tied to this Python build.
- **(c) The same compile cost probably applies to the whole stack** (scipy import 1.65 s, matplotlib 0.94 s, numpy 0.22 s,
  engine 0.51 s). If about two thirds is compiling, `.pyc` for everything could cut several seconds from the regular boot.
  Not measured.
- **(d) Keep compiled bytecode between visits** (IndexedDB). An idea only: `.pyc` files are checked against the source's
  modification time, which differs on every page load.

### The experiment

1. **Build the lazy snapshot** (a build option): warm-up without drawing, the assertion, the split bundle, `.pyc` for the
   modules a first plot imports (found by diffing `sys.modules` around it). Measure the raw, q5 and q11 sizes of the heap, the
   core files, the graphics files, and the graphics files with `.pyc`. This replaces the estimate table.
2. **Time it under Node:** the core restore, loading the graphics part, and the first plot with and without `.pyc` and with a
   pre-import, against the eager first program (0.11 s).
3. **Time it in the browser** with `web/scripts/measure-startup.mjs`: unthrottled, 100 and 30 Mbps, cold and warm, plus a plot
   started one second after "ready".
4. **Decide the gating:** whether `run` waits for the graphics files for every program, and what the status line says.
5. **Regular flow:** measure (a), (b) and (c), including the compile-versus-import split for numpy, scipy and dofile.
6. **Correctness:** `npm run check-snapshot` on the lazy variant, and the native-library test; core code must not import a
   graphics package (`pytz`, `dateutil` and `six` are the doubtful ones).

**Decision rule.** Adopt lazy graphics in the snapshot flow only if, measured, a cold first visit at 30 Mbps is about 2 s
faster, a warm start is at least about 0.2 s faster, and the first plot stays at or under about 0.5 s. Otherwise keep it eager.
For the regular flow, take the cheapest of (a) and (b) that brings the first plot well under a second without making Run wait
noticeably.

**Risks.** A plot started in the first moments waits for the graphics download on a slow network. A second file to keep in sync
with the manifest. `.pyc` files tie the graphics part to this exact Python build. Core code that quietly imports a graphics
package would fail only on the lazy path.
