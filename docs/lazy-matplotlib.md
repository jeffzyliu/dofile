# dofile web demo: loading matplotlib lazily

## The lazy graphics part

The results of the experiments run on the way (phone captures, timing against main, the eager import, the page-side unpack
that was dropped, compression) are in [archive/lazy-graphics-experiments.md](archive/lazy-graphics-experiments.md).

The second design, built to the maintainer's three requirements: the download widget shows the true size, only a graph
waits, and a return visit is not slower. The first (E1b) made every run wait for the part.

- **Build.** matplotlib, pillow, kiwisolver, fonttools, contourpy, cycler, pyparsing, python-dateutil, pytz, six and
  packaging leave the heap and the bundle for `graphics.brotli.bin`: a u32 index length, a JSON index (with the list of 158
  modules the background import runs, in order), then the files, with `.pyc` for the modules the four graph kinds and
  the export import. The build raises (the earlier prototype's `assert`s were stripped by `PYTHONOPTIMIZE=2`) when a check
  fails. Brotli 11, 2026-11-15: heap 15.11 MB, bundle 12.22 MB, part 7.69 MB (32.9 MB raw, 1,822 files, 5.2 MB raw `.pyc`);
  `start-files.json`'s `download` is 41.57 MB with the part, 33.87 MB before "ready".
- **With a SharedArrayBuffer the page fetches, never the worker** (`client.ts`, `#graphics`): a busy worker cannot advance a fetch. The Cache first
  (at the end of `download()` and again once the worker has `started`, so a return visit has it by "ready"), else the network once the start files are in,
  with `cache: "no-cache"` (`"reload"` after the worker found a copy damaged) and the size checked. It is written to the Cache only when the build's heap is already there. The bytes
  go to the worker in one `SharedArrayBuffer(PART_HEADER + size)` (a 16-byte header, then the bytes or the reason it failed; the layout and the
  page's writers `landPart`, `failPart` and `retryPart` are in `src/engine/lazy-part.ts`, the seqlock they write and read through in `src/engine/seqlock.ts`).
  The region is the one record of whether the part is pending, landed or failed, of the copy number and of the reason; the page writes it only
  in `#writePart`, which then tells the live worker (the op `graphics`), and the worker reads it as a whole snapshot, never a torn one. The page is cross-origin isolated in production (`_headers`: COOP `same-origin`, COEP
  `require-corp` on every path), as Break already needs.
- **What the page decides is one table.** `partStep` (`lazy-part.ts`) is a pure function of the region's state and copy, the page's own facts (the fetch on its
  way with its copy, whether it downloads and the bytes received; `fresh`; `damagedCopy`; whether its one `online` listener is set) and the event; `client.ts`'s
  `#partEvent` applies its effect. The events are: want (the start files are in, or the worker `started`), a fetch's result, the worker's `again` and
  `damaged`, and `online`. The status bar's progress is computed from the region and the fetch (`graphicsProgress`) and stored nowhere: "fetching" is a
  pending region whose fetch has gone to the network, and a Cache hit goes from pending to landed. `again` and `damaged` name the copy they are about
  (`{graphics: "again" | "damaged", copy}`), and the page acts only when that is the region's copy and its state fits (`again`: failed; `damaged`: landed): a message
  from a worker that has ended, about a copy the page has replaced, or of an older build's part is dropped. A failed part is fetched again, as a new copy, on a
  graph's `again` and on `online` (one listener per part: set when the part fails, spent when it fires). A copy the worker found damaged is dropped from the Cache and fetched
  again from the network past the HTTP cache (`cache: "reload"`), as is every fetch after it until a copy lands; each fetch of a fresh copy deletes the Cache entry itself before it looks, so it never reads the damaged copy back.
  When the copy fetched right after a damaged one is damaged too, the page stops: the part fails ("the graphics files arrived damaged twice in a row; they are fetched again for the
  next graph"), its Cache entry is deleted without the page waiting for the delete, and no fetch starts until a graph's `again` or `online`, so a part that is damaged every
  time costs one download per graph that asks, never a loop with no click. An older build's fetch that ends later still writes its own part's region (a worker booted with it may be waiting on it)
  and shows no progress.
- **Without a SharedArrayBuffer (no cross-origin isolation, plain http on a LAN address, say) the part is a start file.** `download()` fetches and counts it with the others (the start downloads the whole 41.57 MB; on a secure
  origin it is kept in the Cache with them, and `cached()` checks it), and `boot` reads, unpacks and writes it before it answers (`worker-boot.ts`, `writePartAtStart`). The page does not fetch it, the
  worker posts no `graphics` message and no graph waits for it: only the import of what a first graph needs is left for the idle steps. A part that will not unpack or write is deleted from the Cache and fails the
  start, as a damaged heap does, and the next start fetches it again. There is no "Graphs loading" ring.
- **Only a graph waits** (with a SharedArrayBuffer). A `sys.meta_path` finder for `matplotlib`, `mpl_toolkits` and `pylab` and a wrapper on the graph
  store's `put` call `waitGraphics`, which unpacks a landed part with brotli-wasm in 256 KB steps (the interrupt buffer
  read between them: a Break there is rc 1 and the unpack goes on from that step later), or waits on the region's counter (`Atomics.wait`, woken by the page's write) in 100 ms
  slices, looking at the interrupt buffer between them: a Break is rc 1 with the data kept, and the page's fetch goes on
  (no download again). A failed or offline part gives rc 199 "graphs are not available: …"; other work is unaffected; a
  graph that finds it failed asks the page for one more fetch, once per run (`{graphics: "again", copy}`, the copy it read), and waits for it, so once online the
  next graph draws; the failure of that fetch is final for that run. A part found damaged (an unpack or a write throws) is dropped from the Cache by the page and fetched again; the graph that finds it says so (rc 199), and the next one waits for the fresh fetch.
  When an idle step found the damage and the page has already moved on, the next graph waits for the fresh copy and draws without saying it (race 11). A read of the part that throws (the copy of
  its bytes out of the region, which a phone may not be able to allocate) is not damage: the worker posts nothing and the page does not fetch; the graph answers rc 199
  "the graphics files could not be read (…); the next graph reads them again", and the next graph, or the idle step after the next wake (a run's end, a page write), reads it again. That holds in a graph, in an idle step and in the browser decoder's own task. A run that does not graph never touches any of it.
- **A return visit's start and its non-graph runs are not slowed; a graph sent before the idle work is done pays for it in the run.** The page asks for the part at the end of `download()` and again once the worker has `started`: on a first visit after the start files are in (so it never takes
  bandwidth from them), on a return visit at once, so it is read from the Cache while the worker starts ("landed (cache)"
  comes before "ready"). The worker does nothing of it before `startup` is answered. Then the browser's own brotli decoder (Firefox, Safari; it runs
  off the worker's thread) unpacks it as soon as it is there, run or no run. A brotli-wasm unpack (Chromium) in 256 KB
  steps, the write, and the import of what a first graph needs (the three heavy modules one per step, then 20) run on the
  engine's thread, so only after the engine has been idle (no run sent or running) for 0.25 s (each run's end starts that wait again), one step per task: a run sent meanwhile waits
  for the step in progress (the "written" and "warmed" console lines give the longest step), and, JS being
  single-threaded, no module is half imported. What is measured: a non-graph run at "ready" is not held (Chromium,
  one sample: `display 1` 0.01 s after ready). A graph at "ready" finds nothing unpacked: it decodes (brotli-wasm, in
  the run), writes and imports matplotlib there (Chromium, one sample: ready to image about 0.55 s, about 0.45 s more
  than main's first graph). A graph that arrives while the browser's own decoder is unpacking (Firefox, Safari) cannot
  wait for it, a worker blocked in Python never sees the promise settle: it decodes with brotli-wasm itself, and the
  native result is dropped, so the files are written once. A copy the native decoder fails on goes to brotli-wasm,
  which says whether it is damaged; with a shared buffer, the fresh copy the page fetches after that is unpacked
  natively again (`useNative`, `lazy-part.ts`). Not done: letting that graph use the native result. The
  decoder's output comes through promises on the worker's own event loop, which a graph blocked in Python never runs; a
  SharedArrayBuffer does not help, since nothing outside the worker holds the raw bytes. Only a decode on another thread
  (the page, or a nested worker) into a ~33 MB SharedArrayBuffer that the graph `Atomics.wait`s on would; that covers
  isolated pages only (not the plain-http phone) and saves the wasm decode (about 0.15 s with the JIT on). Without a
  SharedArrayBuffer `boot` has written the part, so no graph meets the decoder at work. Before a graph waits, the run's log so far is sent to the page (browser.py,
  `flush_output`), so the lines before a graph do not wait for it.
  `tools/measure-startup.ts --first-run` times a run at "ready" on the return visit, and `--during-import` one sent while the
  background import runs.
- **The widget.** `download` includes the part, so the prompt, the landing page and the meta tag show the true size. The
  dialog's bar counts what comes before the start, and says under it "+ 7.7 MB of graphics after the start"; after the
  start, while the part downloads, the status bar (on a phone, the strip under the top bar) shows "Graphs loading" and a
  ring of its percent (a progressbar named "Graphs loading, 3.1 of 7.7 MB"). Nothing once it lands, and no lasting label
  after a failure (the graph's own error says why). Without a SharedArrayBuffer the part is in the bar's total and there is no ring.
- **Measured** (`tools/measure-startup.ts`, median of 5, brotli 11, one Mac, Chromium and WebKit; a difference counts when it
  beats the spread and is at least 0.5 s or 2 MB): before "ready" the first visit downloads 33.9 MB, not 44.1 (41.6 MB with
  the part); ready comes 1.0 s sooner at 100 Mbps and 3.0 s sooner at 30 Mbps (not different unthrottled). A non-graph run at
  "ready" takes 0.01 s on both builds, and 0.03 to 0.08 s when sent during the background import. A return visit is ready
  about 0.2 s sooner. A graph sent at "ready" on a return visit takes about 0.4 s more than on a build with matplotlib in the
  heap (0.52 to 0.58 s against 0.12 to 0.13 s): it decodes, writes and imports in the run.
- **Known limits.** On an iPhone, a graph sent in the first seconds after load does the part's work inside the run and took
  3 to 7 s on one phone (a build with matplotlib in the heap: about 0.4 s); a graph after a few seconds is as fast. Over plain
  http (a LAN address: no Cache, no SharedArrayBuffer) the start downloads the whole part with the start files on every visit and
  writes it before "ready". On Firefox a graph at "ready" takes 0.73 s against 0.10 s (n = 5, unthrottled; from the page's
  start +0.43 s): brotli-wasm unpack, write and import in the run, as on the other browsers but slower in the first two
  (archive/lazy-graphics-experiments.md, section 6). Not tested: a real phone over https, Android. With `IDLE_MS` 250
  (2026-11-16), also not measured: memory, and typing during the warm-up; a slow CPU only by proxy (efficiency cores).
- **Not done:** the restart race and the two-tab case are argued, not tested; `nodraw` graphs also wait.

The sections below are the 2026-11-07 findings and the plan this design replaces; their estimates are not updated.

An experiment that is not done: whether the snapshot should load matplotlib on the first plot.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged.

The experiment that led to this design: [archive/lazy-graphics-experiments.md](archive/lazy-graphics-experiments.md).
