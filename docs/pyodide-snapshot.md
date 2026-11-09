# Starting the web demo from a Pyodide memory snapshot

Status (2026-11-09): built, measured and checked; **the demo's default start** (`?snapshot=0` is the normal boot; a missing
or stale snapshot is an error that names `?snapshot=0`, not a silent fallback). It was opt-in with `?snapshot=1` until then,
and an old `?snapshot=1` link still starts from the snapshot. The default build is 39.9 MB
(brotli 11, docstrings and asserts stripped). A return visit starts in 1.2 s against 4.5–9.2 s for the normal boot; a first
visit takes 1.7 s unthrottled, 5.1 s at 100 Mbps and 13.9 s at 30 Mbps (normal boot: 5.8, 6.9, 13.9 s). It passes the conformance corpus, 95 of 97 Stata 14
cases (the other two need packages Pyodide lacks) and the browser tests in Chromium, Firefox, WebKit and an iPhone profile.
Tried by hand on one real iPhone (Safari, over the LAN, 2026-11-08): see [On a real iPhone](#on-a-real-iphone-2026-11-08);
unpacking was the slow part there (brotli-wasm, 25 s) and the browser's own brotli decoder fixed it. **Which size optimizations are done and which are not: [File size](#file-size-what-is-done-and-what-is-not).**
Part of Phase 2 (`phase2-plan.md`); the engine itself is unchanged.

## The question

The page's normal boot installs the dofile wheel and its dependencies (numpy, scipy, matplotlib, openpyxl) into Pyodide;
`browser.start()` then imports numpy, scipy and the engine (1.8 s in Node, measured 2026-11-07), and matplotlib is imported
at the first graph (0.8 s). Together that takes about 5 s on a fast machine before the first run (the timing table below is
from a script that imported everything up front, matplotlib's 0.9 s included). Could it load something prebuilt instead, such
as a PyInstaller or Nuitka binary?

**No, and it would not help.** PyInstaller has no wasm target. Nuitka compiles Python to C and does not cross-compile
to Emscripten. Pyodide is already a prebuilt wasm CPython with the scientific packages compiled. dofile and the
vendored OpenDTA are pure Python, so compiling them could save only their own import time, which is under 10% of the
start (0.5 s of 6 s in Node).

Where the time goes (Node, local files, cold; three runs agree within 0.15 s):

| Phase | Time |
|---|---|
| Pyodide runtime boot | 0.89 s |
| Load micropip | 0.07 s |
| `micropip.install` of the wheel and its dependencies (includes a PyPI fetch of openpyxl) | 1.5 s |
| Import numpy | 0.22 s |
| Import scipy (`stats`, `optimize`, `linalg`) | 1.65 s |
| Import matplotlib | 0.94 s |
| Import openpyxl | 0.20 s |
| Create the `Engine` | 0.51 s |
| First `regress` | 0.02 s |
| **Total** | **6.0 s** |

Imports and the install are about 5 s of it. That is work that gives the same result every time, which is what a
memory snapshot saves.

## What a snapshot is, and what stock Pyodide 314.0.7 leaves out

`pyodide.makeMemorySnapshot()` copies the wasm heap after the imports. `loadPyodide({_loadSnapshot})` copies it back,
so Python resumes with numpy, scipy, matplotlib and dofile already imported. The API is experimental (underscore
options). A straight try fails in a chain of ways, found one at a time (`web/spike/snapshot.mjs` has the working
version and a header with the result):

1. **"Unexpected hiwire entry at index 6".** Any `loadPackage` call fills Pyodide's `loadedPackages` object, and the
   snapshot check insists it is still `{}`. Worked around by emptying it for the call.
2. **"Can't serialize object at index 31".** Python still held two JS objects, a fetch `Response` and its
   `arrayBuffer` method, left by micropip's download of openpyxl. Nothing uses them again, so they are stored as null.
3. **"offset is out of bounds" on restore.** This Pyodide build ignores `INITIAL_MEMORY`: the heap starts at 30 MiB
   and the 136 MB image does not fit. Worked around by growing the heap to the image's size first (through the
   `createPyodideModule` option).
4. **"table index is out of bounds" when numpy runs.** The real problem. A snapshot holds the Python heap, not the
   wasm function table and not the filesystem. Native extensions (numpy, scipy, matplotlib's `.so` files) are linked
   into the table and the heap when Python first imports them, so a restored heap points at table slots that no
   longer exist. `loadPackage` after the restore also crashed. This is what a first spike run reported as "not
   workable".

The fix for 4, in `web/src/engine/snapshot.js`:

- A patched copy of `pyodide.asm.mjs` (string replacement of three places in the loader; it throws if Pyodide's text
  is not what the patch expects) **logs every library load**: name, `dlopen` handle, memory base, table base, flags.
  The 136 libraries are logged when the snapshot is made.
- On restore, the **site-packages tree is written back** into the filesystem first (it is saved as one bundle beside
  the snapshot), then the **libraries are linked again at the recorded addresses**, in the recorded order, and the
  handle table is rebuilt. Only then does Pyodide copy the heap image in, which overwrites whatever the re-link wrote
  to memory.
- The re-link **skips each library's constructors and data relocations**. They already ran before the snapshot and
  their effects are in the image. Running them again crashed on `matplotlib.ft2font` (C++ constructors that call
  into Python, which is not up yet).

One thing tried on the way did not matter: reserving the whole address span with one `malloc` before the re-link
did not change the `ft2font` crash (the constructors were the cause). The reservation is still in the code as a
safety check, and was not shown to be needed.

One more bug that no error showed: drawing a graph before the snapshot caches matplotlib fonts, which hold open file
descriptors, and descriptors are not part of a snapshot. After the restore every glyph read failed with "Bad file
descriptor", logged and ignored, and graphs came out without text. The build script clears the font cache first. A
graph drawn after a restore is byte-identical to one from a normal boot (checked with the same seeded program).

## What is in the demo

| File | Role |
|---|---|
| `web/scripts/make-snapshot.mjs` | `npm run snapshot` builds `web/public/snapshot/` (gitignored; about 3 minutes, almost all of it brotli quality 11, or seconds with `SNAPSHOT_QUALITY=5`; needs the network once for openpyxl) |
| `web/src/engine/snapshot.js` | the loader patch, the library log, the restore options, and the brotli decoding: `inflate`/`unpack` (brotli-wasm) and `hasNativeBrotli`/`inflateNative`/`unpackAsync` (the browser's own decoder, with brotli-wasm as the fallback); used by the script and the worker |
| `web/src/engine/worker.js` | `mount` loads from the snapshot when the page gives a URL (download or cache, unpack, restore); `boot` then skips the install; the `startup` op returns where the start's time went |
| `web/src/engine/client.js`, `main.ts` | pass the URL, the wheel's hash and `?brotli=`; the snapshot is on unless `?snapshot=0`, and the status says `(snapshot)` with the start's breakdown |
| `web/spike/snapshot.mjs` | the standalone spike, with its own timing comparison |
| `docs/img/make-startup-times.mjs` | draws the chart below |

- The snapshot is made in Node and runs in the browser. There are two big files: the **snapshot** (the Python heap,
  136 MB) and the **bundle** (the site-packages folder as files, 93 MB, 3,884 files, which the snapshot needs because
  it holds memory and not the filesystem). They are written **brotli-compressed at quality 11**, as
  `heap.brotli.bin` (19.8 MB) and `site-packages.brotli.bin` (20.0 MB), so 39.9 MB in all (the heap was 26.5 MB, 46.5 MB in all,
  before the library copies were zeroed and the docstrings stripped; see "Making the files smaller"). The small files are
  `dso.json` and `files.json`, the patched `pyodide.asm.patched.mjs`, and a `manifest.json` with the wheel's name and
  SHA-256, the Pyodide version, a build time, and each big file's name, compressed size and decompressed size. The build decodes
  both files again with the decoder the page uses and fails if they are not identical.
- **Only the compressed files are kept in the browser** (the Cache API, under a name with the build time; older builds
  are deleted): 39.9 MB of storage, not 229 MB. Every start reads them and decompresses them, with the browser's own
  brotli decoder (`DecompressionStream("brotli")`) when it has one, else with brotli-wasm (a 1 MB wasm decoder, about 0.7 s
  for both files on a laptop), into one buffer per file so the memory peak stays near the decompressed size (brotli-wasm
  works in steps; the native path holds a copy of the compressed input as a Blob as well). The browser's own HTTP cache did not keep files this big across visits in the tests; the
  Cache API did.
- **The files end in `.bin`, not `.br`.** `vite preview` (and many hosts) send any `.br` file with
  `Content-Encoding: br`, so the browser decodes it before the page can store it, and the cache held the full 229 MB;
  the browser test that checks the stored size caught this. If a host decodes the files anyway, `unpack` notices the
  decompressed length and uses the bytes as they are: it still works, but the storage is larger.
- **A stale snapshot is refused with a message** (built for another wheel: "run `npm run snapshot` again"). It must
  be rebuilt after changing the dofile wheel or the Pyodide version. The wheel's file name does not change with its
  code, so the manifest also holds the wheel's SHA-256 and the page (Vite's `__WHEEL_HASH__`) compares it; a missing or
  different hash is refused (the Node tests, which pass none, skip the check). Found 2026-11-08: a snapshot older than
  `browser.py` kept running the old code and broke the page's new run-timing display until it was rebuilt. `uv build
  --wheel` is reproducible (the same hash after a rebuild and after touching a source file), so a rebuild without a code
  change does not make a snapshot stale. Test: "a snapshot from a different build of the wheel is refused" in `web/e2e/poc.spec.ts`.
- The snapshot is taken after one program has run in a throwaway engine, so the lazily imported modules (graphs,
  commands) are already loaded. The page's real `Engine` is created after the restore, as before.

## Results

Node, local files (one run of each, same machine):

| | Normal boot | From the snapshot, uncompressed (`web/spike/snapshot.mjs`) | From the compressed snapshot (the demo) |
|---|---|---|---|
| Time to a running engine and a first regression | 5.2 s | 0.64–0.80 s | 1.31 s |

The demo's 1.31 s, in parts: read 0.02 s, **decompress 0.70 s**, start the wasm module 0.05 s, write site-packages
0.08 s, **re-link 136 libraries 0.42 s**, copy the heap 0.04 s. After a restore the first program runs in 0.04–0.18 s,
because its imports are done.

Measured on 2026-11-07 with `web/scripts/measure-startup.mjs` on the 39.9 MB build (brotli 11, trampoline-free, docstrings
stripped): Chromium 158, the built page, the network throttled through the DevTools protocol. The harness writes
`docs/img/startup-times.json` (every run, and the page's breakdown of each snapshot start), and
`docs/img/make-startup-times.mjs` draws the chart from it. It serves the page like a real host: brotli (quality 5) for text and
wasm, long caching for hashed assets, the isolation headers, and the `.bin` files as they are. Pyodide's runtime and packages come
from the real jsDelivr CDN, throttled too, so the unthrottled rows depend on this machine's connection. Each cell is the median
of 3 runs of the page's own "ready in X s" (a new browser context is a cold cache, a reload in it a warm one); runs agree within 0.3 s.

![Time until the engine is ready, normal boot vs snapshot, by network speed, for a first and a return visit](img/startup-times.svg)

| Network | Normal, cold | Normal, warm | Snapshot, cold | Snapshot, warm |
|---|---|---|---|---|
| Unthrottled | 5.8 s | 4.5 s | 1.7 s | 1.2 s |
| 100 Mbps, 20 ms | 6.9 s | 5.3 s | 5.1 s | 1.2 s |
| 30 Mbps, 50 ms | 13.9 s | 9.2 s | 13.9 s | 1.2 s |

- **Return visits win everywhere:** 1.2 s against 4.5–9.2 s. Of that, 0.6 s is decompressing and 0.5 s is restoring
  (site-packages 0.07 s, re-link 0.36 s, copy the heap 0.03 s).
- **First visits depend on the network.** The snapshot wins above about 100 Mbps and is level with the normal boot at 30 Mbps.
  A cold visit is the download (0.07 s unthrottled, 3.3 s at 100 Mbps, 11.0 s at 30 Mbps) plus the browser's compile of the wasm
  module (0.5, 0.6 and 1.8 s) plus the same 1.1 s of decompressing and restoring.
- **The download is the cost:** 39.9 MB (40.8 MB sent by the host on the first visit, with the page), against about 25 MB of
  wheels for the normal boot. That is also all the browser stores.
- **Compressed storage costs 0.3–0.7 s per start** (measured on the 46.5 MB build) against keeping the 229 MB decompressed, and
  makes the download about 12 MB smaller than the quality-5 brotli a host would send (52.3 MB).
- The site-packages bundle has only about 8 MB of dead weight (tests, type stubs); the bulk is scipy (41 MB), matplotlib (17)
  and numpy (11). Trimming it would not change the picture.
- Against plain `vite preview` (no compression, files not cached) the snapshot took 2.8 s cold and 2.4 s warm: not comparable,
  so not in the table or chart.

## File size: what is done and what is not

A first visit downloads two compressed files: the **heap image** (the Python process's memory after the imports; 136 MB raw,
19.8 MB compressed) and the **bundle** (the site-packages folder as files; 93 MB raw in 3,884 files, 20.0 MB compressed),
39.9 MB in all (40.8 MB sent by the host with the page and the small files). A return visit downloads none of it but still
decompresses it (0.6 s). Sizes below are compressed MB, measured unless marked; the code is in `web/src/engine/snapshot.js`,
`web/scripts/make-snapshot.mjs` and `web/src/engine/worker.js`.

**Download size**

| Optimization | Status | Effect | Notes |
|---|---|---|---|
| Brotli 11 for both files, decoded in the page by brotli-wasm | **Done, the default** | smallest format tried (see [Making the files smaller](#making-the-files-smaller)) | `SNAPSHOT_QUALITY` (default 11, window 24; 5 is for development: a 7 s build instead of 125 s, about 25% bigger) |
| Zero the copies of native libraries in the heap | **Done, the default** | heap 26.5 → 22.2; total 46.5 → 42.3 | Emscripten keeps each `.so`'s bytes after `dlopen`, and the bundle has them too: 135 of 136 buffers (30.5 MB raw) were identical to their files. `zeroLibraryCopies` |
| Strip docstrings and asserts (`PYTHONOPTIMIZE=2`) | **Done, the default** (since 2026-11-07) | heap 22.2 → 19.8; total 42.3 → 39.9 | `SNAPSHOT_STRIP_DOCS=0` builds without it; the manifest records `optimize: 2`. It removes the `assert`s of every library, so it rests on the checks below (identical results to the unstripped build), not on a proof |
| Files named `.bin`, kept compressed in the browser | **Done** | the Cache API holds 40 MB, not 229 | a `.br` name makes hosts send `Content-Encoding: br`, and the browser decodes before the cache sees it |
| Leave matplotlib out of the snapshot and fetch it at the first graph | **Not done** (step 4a of the plan; no code) | estimated about 9.7 less before "ready" | the first graph then pays about 0.9 s (0.3 s with `.pyc` files); needs the bundle in two parts and a fetch. [Experiment](phase2-plan.md#experiment-loading-matplotlib-lazily) |
| Ship `.pyc` files for the lazily loaded part | **Not done** (part of the row above) | 0.6 s of the 0.87 s first graph is compiling | |
| Leave out the bundle's tests (6.6 MB raw) and type stubs (1.5 MB raw) | **Not done** | too small to matter | `bundle()` takes every file under site-packages |
| Leave out unused scipy subpackages (`io`, `signal`, `cluster`, `odr`: 4.1 of 40.8 MB raw) | **Not done** | little to gain | the corpus programs import 493 scipy modules |
| Zero the heap's free memory | **Tried, no gain** | 34.0 against 34.3 at brotli 5 | no large free blocks are left |
| zstd or gzip instead of brotli | **Tried, rejected** | zstd 22 decoded the heap wrongly without any error; gzip is half as good | the build compares the decoded files with the originals |
| Explain the 12 MB the heap gains from installing the packages, before any import | **Not investigated** | the largest piece nothing here removes | |
| A smaller Pyodide runtime, or self-hosting it | **Not touched** | | both flows download Pyodide's runtime (about 5.5 MB compressed) from jsDelivr |

**Start time and memory**

| Optimization | Status | Notes |
|---|---|---|
| The engine starts at page load, in the background | **Done** | `engine.start()` in `main.ts`; only Run and Reset wait |
| Decompress in steps into one buffer per file | **Done** | the memory peak stays near the decompressed size; not a speed gain |
| One snapshot that starts on iOS | **Done** | built without Pyodide's trampoline, [below](#the-trampoline) |
| Starting from the snapshot at all | **Done, the default** (`?snapshot=0` = normal boot) | no fallback to the normal boot when the snapshot is missing, stale or fails: the page says why and names `?snapshot=0`, so CI cannot pass by quietly booting the old way. A crash on a low-memory phone (peak about 1.25 GB against 0.7 GB for the normal boot) is only checked on one iPhone 13 |
| Keep the files decompressed in the browser's storage | **Rejected** | 0.3–0.7 s faster per start, 229 MB stored instead of 40 |
| Normal boot: import matplotlib only at the first graph | **Done already** | `browser.start()` imports numpy and scipy (1.8 s in Node); matplotlib and PIL come with the first graph (0.82 s) |
| Normal boot: import scipy lazily | **Not done** | it is imported in `browser.start()` |
| Normal boot: download the packages lazily | **Not done** | `micropip.install` fetches all dependencies (about 25 MB) at boot, and openpyxl from PyPI on every cold start |

## Making the files smaller

Measured on 2026-11-07 on the 136 MB heap image and the 93 MB bundle, before the library copies were zeroed. Sizes are
compressed, MB. Decode time is for both files together, in Node.

| Format and decoder | Snapshot | Bundle | Total | Decode |
|---|---|---|---|---|
| gzip -9, the browser's `DecompressionStream` | 43.7 | 28.8 | 72.5 | 0.46 s |
| zstd 19, `--long=24`, fzstd (80 KB of JS) | 28.7 | 21.0 | 49.7 | 0.58 s |
| zstd 22, `--long=27`, fzstd | 27.8 | 20.5 | 48.3 | **decodes the heap wrongly** |
| **brotli 11, brotli-wasm (1 MB wasm)** | **26.5** | **20.0** | **46.5** | 0.59 s |
| brotli 5 (what a host usually sends) | 34.3 | 23.7 | 58.0 | native, not measured |

Brotli 11 is the smallest. fzstd with a 128 MB window produced different bytes from the original without any error, so the
build decodes both files again and fails on any difference. The decoders run at about 390 MB/s output (Node's native brotli
600). The manifest does not record the quality, but recompressing the decoded heap at quality 11 with the build's parameters
reproduces `heap.brotli.bin` byte for byte (at quality 5 the bytes differ), which is how to check a built file.

Where the heap's size comes from (snapshot after each stage, brotli 5): bare Pyodide 5.2 MB; packages installed, nothing
imported 17.2 (not explained: the install itself adds 12); numpy 15.9; scipy 26.1; matplotlib 30.6 (4.5 for importing it,
and its files cost 7.4 in the bundle); openpyxl and one engine run 34.3.

## Correctness checks

`cd web && npm run check-snapshot` (`web/scripts/check-snapshot.mjs`) checks that an engine restored from the snapshot
gives the results the normal engine gives, in Node, with the restore code the page uses. Options: `-- --dir path` for
another snapshot folder, `--shards N` (default 4), and `--normal` to run the same checks on a normal Pyodide boot (no
snapshot), which is the baseline that tells a snapshot problem from one Pyodide has anyway. It runs:

- **conformance** (one process): the corpus (`tests/conformance`, the `CHECK name=value` lines against `ref.json` to
  1e-6), the probes (with graphs), a graph export, and 13 calls into the native libraries (`NATIVE_CHECKS` in
  `web/scripts/snapshot-node.mjs`: scipy's linear algebra including LAPACK `dsytrf`, stats, special, optimize, sparse,
  integrate, interpolate, fft, numpy, and a matplotlib plot with text);
- **compat** (the other processes): the 98 Stata 14 reference cases of `tests_opendta/compat`, through the repo's own
  `tests_opendta/tools/compare.py` (its `run_opendta`, `normalize`, `same_logs` and known-difference rules, mounted into
  Pyodide), the same acceptance rule as `tests/test_stata_compat.py`. The slowest cases start first, one per process.

It takes about 2.5 minutes for the snapshot start, with one process per case and a time limit (`--timeout`, default 300 s). It is not part
of `npm test`.

**Results, 2026-11-07.** On every snapshot start checked (brotli 5 and 11, with and without the trampoline, with and without
stripping; the last on the current 39.9 MB build, 150 s): 63 corpus checks, 12 probes and 13 native-library calls clean, and
**95 of 97 Stata cases pass**, the same two failures as a normal boot (`xlwt`, for legacy `.xls` only; `pyreadstat`); the count is 97, not 98, because
`1920_models4` has no Stata log. Before PATCH-4 and the `numpy.linalg` shim (`src/dofile/linalgshim.py`) 16 cases failed on
the snapshot and the normal boot alike: 11 from one 32-bit numpy bug in `expand` and `stsplit`, 2 package gaps, and 3 numeric
cases (which also ran 20–500 times slower). See [Known gaps](phase2-plan.md#known-gaps-in-the-browser-engine) and the
[open investigation](phase2-plan.md#open-investigation-model-fits-take-far-longer-in-pyodide). No failure is specific to the
snapshot or to stripping docstrings.

**Bugs the checks found in the snapshot's own code**
- **A restore bug, found and fixed 2026-11-07.** After a restore, `scipy.linalg.solve` ended the process with
  `Dynamic linking error: cannot resolve symbol dsytrf_`. Emscripten's `dlopen` gives each library load a scope object
  (`localScope = global ? null : {}`) that collects the exports of the library's local dependencies, and the library finds
  the symbols it needs there. The re-link passed none, so a library could not see its dependency's symbols. The fix is
  one argument in `restoreOptions` (`r.global ? null : {}`). Earlier checks missed it because they used numpy's own
  linear algebra.
- **Its regression test**, `web/test/snapshot-native.test.mjs` (in `npm test`): 13 native-library calls after a restore.
  With the fix removed it fails on `dsytrf_` at the first call; with it, all 13 pass.
- The matplotlib font descriptors bug (above) was found the same way: by comparing a graph drawn after a restore with a
  normal one.

## On a real iPhone (2026-11-08)

One iPhone, Safari, the page served by `npm run dev` from a Mac over the LAN (plain HTTP, so **not a secure context**: no
Cache API, so the snapshot is downloaded and unpacked on every visit, and the page is not cross-origin isolated, so Break
restarts the engine). Numbers were read by hand from the page's status line, which now splits the start up. One phone, a few
runs each, no repeats under controlled conditions: an indication, not a benchmark.

| Start | Total | Breakdown |
|---|---|---|
| Snapshot, brotli-wasm | 28–30 s | download 0.2 s, **unpack 25–28 s** (heap 13.9 s, site-packages 11.5 s), restore 2.1 s, files 0.1 s, engine 0 s |
| Snapshot, the browser's native brotli | not read; unpack about 3 s (as reported) | the rest was not changed |
| Normal boot | 9.2 s | runtime 2.3 s, files 0.1 s, packages 2.6 s, engine 3.9 s |

- **Unpacking was the problem, not the network or the restore.** brotli-wasm decoded at about 9 MB/s of output on the phone
  against about 330 MB/s on a laptop (Node) in the same code. Why is unknown (a slow WebAssembly tier or memory pressure on
  iOS are guesses). The phone's Safari has `DecompressionStream("brotli")`; using it brought the unpack to about 3 s. The page
  uses the native decoder whenever the browser has one and falls back to brotli-wasm if it is missing or fails;
  `?brotli=wasm` forces the wasm decoder, to compare.
- **Desktop, same page** (this Mac, Playwright's browser builds, local server, unpack time of the two files, three loads each):

  | Browser | native | brotli-wasm |
  |---|---|---|
  | Firefox | 0.4–0.5 s | 0.8 s |
  | WebKit | 0.5 s | 0.7 s |
  | Chromium | fell back to wasm: 0.7 s | 0.7 s |

  Playwright's Chromium has no native brotli in `DecompressionStream`; a current Chrome or Edge was not tried.
- **A run of the sample program** (regress and a scatter plot), desktop, first run then second, in seconds: normal boot
  0.8–1.1 then 0.04–0.06; snapshot 0.09–0.13 then 0.05–0.06 (the normal boot imports matplotlib at the first graph; the
  snapshot has it loaded). On the phone a run took 2–3 s in snapshot mode every time and 0.1–1 s on the normal boot, until
  the snapshot was rebuilt: then 0.1–0.2 s. The slow runs came with a snapshot older than the code, but the cause was not
  established (the run breakdown, below, had not shipped when it happened).
- **The status line says where the time went.** A snapshot start: `[download|read from cache X s, unpack X s (heap, site-packages,
  decoder native|wasm), restore X s, files X s, engine X s; not cached]`. A normal boot: `[runtime, files, packages, engine]`.
  A run: `rc 0 in X s (engine, encode, json, save, other)`, where engine includes drawing the graphs and `save` is the write
  of `/work` to IndexedDB. The start's numbers are collected in the worker (`startup`); the run's come from `browser.run`
  (`timing`) and the worker. The same facts go to the console (`[dofile] unpack with ...`).
- **Not measured on a phone:** a first visit over a real network, a return visit with the cache working (needs HTTPS: a
  tunnel such as `cloudflared`, or a host), memory use, Low Power Mode.

### Debugging an iPhone 13 (2026-11-08): the worker ran twice, and what was only the phone

The page on a real iPhone 13 (Safari; served from `wrangler dev --ip 0.0.0.0` over the LAN and from a Cloudflare https tunnel)
failed with `the engine did not start: undefined is not an object (evaluating 'V.loadPackage')`, every time with `?snapshot=1`,
on desktop never. It took long because several unrelated things looked alike. What was found, in the order it mattered:

- **The cause: a chunk imported the worker's own entry file.** `boot` ran in a worker that had never received `mount`
  (`py` was undefined, and `fromSnapshot` false, so it took the non-snapshot branch, which is where `V.loadPackage` is).
  Logging a random id when the worker script ran showed **two evaluations of `worker.js` for one `new Worker`**: `mount` and the
  first `files` reached the first, everything after reached the second, which sets `self.onmessage` again. The second
  evaluation came right after the first began to mount, when `loadBrotli()` did `import("brotli-wasm")`. Vite had put that package
  in its own chunk (`index.web-*.js`), and the chunk began `import { n } from "./worker-<hash>.js"` for the bundler's helpers,
  that is, it imported the worker's entry file. iOS Safari then ran the entry a second time as a separate module (desktop
  Chromium, Firefox and WebKit, and Playwright's iPhone profile, do not). Only a snapshot imports that chunk, hence "only
  `?snapshot=1`". **Fix:** `worker: { rollupOptions: { output: { inlineDynamicImports: true } } }` in `vite.config.ts`: the worker
  is one file. If a built `worker-*.js` is ever imported from another `assets/*.js`, this is back.
- **Web Inspector made it worse and misled the debugging.** With the inspector attached the page was very slow and the console
  filled with the duplicated worker's output. Look at the console after a load, not during it, and do not time anything with the
  inspector on.
- **The snapshot can crash the tab.** Safari reloaded the page ("a problem repeatedly occurred") on `?snapshot=1`, never on a normal
  boot. Peak memory in Node (`/usr/bin/time -l`, includes Node's own overhead): normal boot 0.7 GB, snapshot 1.25 GB, and a second
  Python loaded on top (what a duplicated worker costs) well beyond that. The compressed files and the 93 MB site-packages bytes are
  let go as soon as they are unpacked and written was tried and removed: it did not change Node's peak (Node does not collect on
  demand), and it was never measured on the phone. After the single-file fix the snapshot worked on the phone.
- **`cProfile` is not a speed measurement.** A profiled scatter took 2.8–3 s on the phone, in normal boot as well as in the
  snapshot, against 0.1 s unprofiled, and the first graph of a normal boot took 64 s profiled, 39 s of it in `compile` (matplotlib
  ships without `.pyc` files). The profiler's per-call hook is far more expensive on the phone than in Node (0.17 s profiled, 0.04 s
  not). Use it for the shape of the time, never for the time. A check that the phone itself is fine: Pyodide's console
  (`pyodide.org/en/stable/console.html`), `sum(range(10**7))` took 0.4 s.
- **The slow earlier numbers were the phone's state.** The "2–3 s per graph in snapshot mode" and "normal boot too slow to start" were
  measured with the inspector on, and did not come back after the fixes (the second graph 0.1 s or less, in both modes).
- **`save` of 1 s on some runs.** The worker wrote `/work` to IndexedDB after every run, changed or not, and Safari's IndexedDB
  took about 1 s on some of those writes (a run does not change `/work`; checked in Node). After a run the write is now skipped when
  the folder's paths, sizes and times are as at the last write; the page's file operations always write. Not checked on the phone
  after the change. Removed from the worker for now, so the rest of the branch can be retested on the phone without it.
- **Ruled out:** a 304 reply without COEP (Wrangler's carry both headers), a stale snapshot (its wheel hash matched), the iOS
  user agent (Node with an iPhone user agent: 0.05 s per graph), Pyodide's trampoline.
- **Method that worked:** a log line in the worker with a random id at the top of the script and in each `onmessage`, and one in the
  client's `call`, then reading which worker got which message. A `BroadcastChannel` between copies of the worker (named after the
  Worker's `name`) showed in one load whether another copy was alive. Both were removed again.

## Tests

- `web/test/engine.test.mjs` (Node, `npm test`): the snapshot start runs a regression, a scipy computation, a graph,
  file writes and Break (rc 1, data kept), and a snapshot built for another wheel is refused with its message. They
  skip themselves if `public/snapshot/` has not been built.
- `web/test/snapshot.test.mjs`: `inflate` and `unpack` with the page's decoder: a round trip in steps of any size, a
  file already decoded by a host, and truncated, damaged, wrongly sized and mismatched-manifest files all refused; and
  `inflateNative`/`unpackAsync` (the browser's decoder: the same bytes as brotli-wasm, and a truncated file that falls back
  and gives the wasm error; skipped where the runtime has no native brotli). 34 Node tests pass in all (`npm test`).
- `web/e2e/poc.spec.ts`: every test starts the page from the snapshot (the default; `npm run e2e` builds it, a missing one fails
  the tests), one starts it with `?snapshot=0`; the snapshot test runs the sample program with a graph, a reload reads from the cache and
  decompresses, and **everything in the browser's caches adds up to between 10 and 80 MB** (about 40 MB; this is the
  check that found the `.br` problem); the status line shows the start's breakdown and, after a Run, the run's; a manifest
  with another wheel hash is refused. Skipped without a snapshot. All 6 e2e tests pass in each of the four browser profiles
  (24 in all, 2026-11-08).
- The test file now ends every worker it starts in an `after` hook. Before, a failing assertion skipped the
  `terminate()` at the end of its test and `npm test` hung with the worker alive.


## Not done, and risks

- **Browsers** (`npm run e2e`: Chromium, Firefox, WebKit and an iPhone 15 profile, 6 tests each, 24 of 24 pass). One real iPhone
  was tried by hand (see [On a real iPhone](#on-a-real-iphone-2026-11-08)). Not checked: other phones, Android, Chrome or
  Edge as shipped, a real phone over HTTPS with the cache working; Break in the browser with a snapshot (tested in Node); files restored from IndexedDB with a
  snapshot start. The first run found two problems in WebKit, both settled:
  - **Desktop WebKit: the cache was empty after a reload.** Not the page. Playwright's default context keeps storage in
    memory, and WebKit drops the whole Cache API on reload there; a persistent profile on disk keeps entries. The snapshot
    test now runs in one, as a real browser does.
  - **iPhone profile: "call_indirect to a signature that does not match".** See [The trampoline](#the-trampoline).
- **Browser memory** is higher: the heap image is 136 MB before anything runs, and during the start the compressed files
  (39.9 MB) and the decompressed ones (229 MB) are in memory together for a moment. The iPhone tried ran it without a crash;
  its memory use was not measured.
- **Cache errors.** The worker used to swallow every error of `cache.put`. Now only the browser refusing storage
  (`QuotaExceededError`, `SecurityError`, `NotAllowedError`, or no Cache API) lets the engine start uncached, reported as
  `NOT CACHED: ...` with the start's timings; any other error is thrown.
- **A patched copy of Pyodide's loader.** It is generated from the installed Pyodide file, fails loudly if the text changes,
  and needs a rebuilt snapshot on every Pyodide upgrade. It relies on internals (`loadWebAssemblyModule`, `LDSO`,
  `wasmTable`) that Pyodide may change. Check upstream for native-extension snapshot support before each upgrade.
- **`npm run build` copies `public/snapshot/`** (39.9 MB) into `dist/`. The files are already compressed, so the host needs no
  brotli setting and must not add a `Content-Encoding` of its own (the `.bin` names keep common servers from doing that).
- The snapshot build needs the network once (openpyxl from PyPI) and takes about 2 minutes at quality 11.
- **A new dependency**, `brotli-wasm` (Apache-2.0, 1 MB of wasm): the browser cannot decode brotli from script by itself.

### The trampoline

WebAssembly's `call_indirect` traps when the callee's signature differs from the call site's, and CPython's C code often calls
through function pointers cast to another type. Pyodide's loader embeds a small wasm function (a "trampoline") that makes such
calls with the callee's real signature, and writes its pointer into the Python runtime (`__PyRuntime`, in the heap). On iOS
(a `navigator.userAgent` test) it writes 0 and creates no function; CPython then uses a JavaScript call path that tolerates a
mismatch (inferred, not read in CPython's source).

**What went wrong.** A snapshot is made in Node, with the trampoline, so restoring it puts a non-zero pointer back into the
heap. On an iPhone that slot holds nothing valid, and the first call through it fails (`Module._init_pyodide_proxy()`). Only
the user agent matters (checked in WebKit with the profiles mixed). A real iOS device was not tried.

**The fix.** `make-snapshot.mjs` patches the loader so it behaves as on iOS everywhere (`noTrampoline` in `snapshot.js`), for
the build and the restore alike, so the pointer in the heap is always 0 and one snapshot starts in every browser.
`SNAPSHOT_TRAMPOLINE=1` keeps Pyodide's own choice.

**What it costs** (Node, normal boot against iOS user agent): 2M calls of `len` and `abs` 1.47x; 60 `regress` calls 1.13x;
a pure Python loop, `list.append`, `sorted` and tiny numpy and scipy calls the same. OpenDTA's unit suite 128 s against 134 s
(about 5%), the 97 Stata cases 151 s against 153 s. The results are identical: the same 1,061 unit tests agree with CPython
(`npm run check-pytest -- --ios`; the wasm table length, 51558 against 51559, shows the trampoline was off) and the same 95 of
97 Stata cases pass on a snapshot. Not measured: a desktop browser, where a plain boot would still have the trampoline.

## Recommendation

Keep it opt-in for now. It is a clear win for return visitors and for first visits faster than about 100 Mbps, and about
level on a 30 Mbps first visit (13.9 s against 13.9 s). What is left, in order of effort (what is already done is in
[File size](#file-size-what-is-done-and-what-is-not)):

1. **Decide whether to make it the default, with a fallback to the normal boot.** The four browser profiles pass; a real
   phone has not been tried, and memory there (136 MB heap, 229 MB decompressed during the start) is the open question.
2. ~~**Decide on stripping docstrings**~~ done 2026-11-07: the default (2.4 MB less). It removes the `assert`s of every
   library; the checks on the quality-11 build match the unstripped build.
3. **Load matplotlib and its dependencies on the first graph instead of in the snapshot** (not done; about 9.7 MB less before
   "ready" at brotli 11, estimated). The first plot then pays about 0.9 s, mostly compiling, unless `.pyc` files are shipped.
   Findings, conjectures and the plan to measure it: [Experiment: loading matplotlib lazily](phase2-plan.md#experiment-loading-matplotlib-lazily).
4. **Normal boot: import scipy lazily and download the packages lazily** (not done). Its matplotlib import is already lazy
   (first graph 0.82 s); scipy is imported in `browser.start()` and every package is downloaded at boot. This helps first
   visits without a big download; combine with the snapshot for return visits.
5. Smaller things: leave out the bundle's tests and type stubs (8 MB raw), explain the 12 MB the heap gains from the package
   install, and fetch openpyxl without PyPI on every cold start.
