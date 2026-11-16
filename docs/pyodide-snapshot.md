# Starting the web demo from a Pyodide memory snapshot

Status (2026-11-09): built, measured and checked; **the demo's default start**. `?snapshot=0` is the normal boot, a
diagnostic mode for developers; an old `?snapshot=1` link still starts from the snapshot. A missing or stale snapshot is
an error that gives its cause, not a silent fallback, and nothing the page shows names `?snapshot=0`. The default build
was 39.9 MB (brotli 11, docstrings and asserts stripped; 41.6 MB with the packages added on 2026-11-09). A return visit
starts in 1.2 s against 4.5–9.2 s for the normal boot; a first visit is level with it at 30 Mbps ([Results](#results)).
It passes the checks of [Correctness checks](#correctness-checks) and the browser tests in four profiles; one real
iPhone was tried by hand ([On a real iPhone](#on-a-real-iphone-2026-11-08)). **Which size optimizations are done and
which are not: [File size](#file-size-what-is-done-and-what-is-not).** Part of Phase 2 (`phase2-plan.md`); the engine
itself is unchanged.

## The question

The normal boot installs the dofile wheel and its dependencies (numpy, scipy, matplotlib, openpyxl) into Pyodide;
`browser.start()` then imports numpy, scipy and the engine (1.8 s in Node), and matplotlib comes at the first graph
(0.8 s): about 5 s on a fast machine before the first run. Could it load something prebuilt instead, such as a
PyInstaller or Nuitka binary?

**No, and it would not help.** PyInstaller has no wasm target; Nuitka does not cross-compile to Emscripten. Pyodide is
already a prebuilt wasm CPython with the scientific packages compiled. dofile and OpenDTA are pure Python, so compiling
them could save only their own import time, under 10% of the start (0.5 s of 6 s in Node).

Where the time goes (Node, local files, cold, everything imported up front; three runs agree within 0.15 s):

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

The imports and the install, about 5 s, give the same result every time, which is what a memory snapshot saves.

## What a snapshot is, and what stock Pyodide 314.0.7 leaves out

`pyodide.makeMemorySnapshot()` copies the wasm heap after the imports; `loadPyodide({_loadSnapshot})` copies it back, so
Python resumes with everything imported. The API is experimental. A straight try fails in four ways (the spike,
`web/spike/snapshot.mjs`, is in git history at commit `10e0f1c`):

1. **"Unexpected hiwire entry at index 6".** `loadPackage` fills `loadedPackages`, which the snapshot check wants empty.
   Emptied for the call.
2. **"Can't serialize object at index 31".** Python still held a fetch `Response` and its `arrayBuffer` method from
   micropip's download of openpyxl. Nothing uses them again, so they are stored as null.
3. **"offset is out of bounds" on restore.** This Pyodide ignores `INITIAL_MEMORY`: the heap starts at 30 MiB and the
   136 MB image does not fit. The heap is grown to the image's size first (a `createPyodideModule` option).
4. **"table index is out of bounds" when numpy runs.** The real problem. A snapshot holds the Python heap, not the wasm
   function table or the filesystem, and native extensions (numpy, scipy, matplotlib's `.so` files) are linked into the
   table and the heap at their first import. `loadPackage` after the restore also crashed.

The fix for 4, in `web/src/engine/snapshot.ts`:

- A patched copy of `pyodide.asm.mjs` (three string replacements; it throws if Pyodide's text is not what it expects)
  **logs every library load**: name, `dlopen` handle, memory base, table base, flags. 136 libraries are logged when the
  snapshot is made.
- On restore, the **site-packages tree is written back** first (saved as one bundle beside the snapshot), then the
  **libraries are linked again at the recorded addresses**, in order, and the handle table is rebuilt. Then Pyodide
  copies the heap image in, over whatever the re-link wrote.
- The re-link **skips each library's constructors and data relocations**: their effects are in the image, and running
  them again crashed on `matplotlib.ft2font` (C++ constructors that call into Python, not up yet).

Reserving the whole address span with one `malloc` before the re-link did not change the `ft2font` crash; it stays in
the code as a safety check, not shown to be needed.

A silent bug: a graph drawn before the snapshot caches matplotlib fonts with open file descriptors, which a snapshot
does not hold, so after a restore graphs had no text. The build script clears the font cache first. A graph drawn after
a restore is byte-identical to one from a normal boot (the same seeded program).

## What is in the demo

| File | Role |
|---|---|
| `web/scripts/make-snapshot.mjs` | `npm run snapshot` builds `web/public/snapshot/` (gitignored; about 3 minutes at brotli 11, seconds with `SNAPSHOT_QUALITY=5`; needs the network once for openpyxl) |
| `web/src/engine/snapshot.ts` | the loader patch, the library log, the restore options, and brotli decoding: `inflate`/`unpack` (brotli-wasm) and `hasNativeBrotli`/`inflateNative`/`unpackAsync` (the browser's decoder, brotli-wasm as the fallback); used by the script and the worker |
| `web/src/engine/worker.ts` | `mount` loads from the snapshot when the page gives a URL (download or cache, unpack, restore); `boot` then skips the install; the `startup` op returns where the start's time went. It reads everything through one Cache: "The start since prototype 1" below |
| `web/src/engine/client.ts`, `main.tsx` | pass the URL, the wheel's hash and `?brotli=`; the snapshot is on unless `?snapshot=0`. Where the start's time went: the client's `startup` and the worker's console line `[dofile] snapshot start: …` |
| `web/spike/snapshot.mjs` | the standalone spike with its own timing comparison (removed; in git history at commit `10e0f1c`) |
| `docs/img/make-startup-times.mjs` | draws the chart below |

- The snapshot is made in Node and runs in the browser. Two big files: the **snapshot** (the Python heap, 136 MB) and
  the **bundle** (site-packages as files, 93 MB, 3,884 files, needed because the snapshot holds memory, not the
  filesystem). They are written **brotli 11** as `heap.brotli.bin` (19.8 MB) and `site-packages.brotli.bin` (20.0 MB),
  39.9 MB in all (46.5 MB, the heap 26.5, before the library copies were zeroed and the docstrings stripped; see
  "Making the files smaller"). The small files are `dso.json`, `files.json`, the patched `pyodide.asm.patched.mjs` and
  `manifest.json` (the build record, not deployed: the wheel's name and SHA-256, the extra wheels' SHA-256s, the Pyodide
  version, a build time, each big file's compressed and decompressed size). The build decodes both files again with the
  page's decoder and fails if they differ.
- **Only the compressed files are kept in the browser** (the Cache API, under a name with the build time; older builds
  are deleted): 39.9 MB, not 229 MB. Every start decompresses them, with `DecompressionStream("brotli")` where the browser
  has it, else brotli-wasm (1 MB of wasm, about 0.7 s for both files on a laptop), into one buffer per file so the memory
  peak stays near the decompressed size (the native path also holds the compressed input as a Blob). The browser's HTTP
  cache did not keep files this big across visits in the tests; the Cache API did.
- **The files end in `.bin`, not `.br`.** `vite preview` and many hosts send a `.br` file with `Content-Encoding: br`,
  so the browser decodes it first and the cache held 229 MB; the browser test of the stored size caught this. If a host
  decodes the files anyway, `unpack` notices the length and uses the bytes as they are (it works, with more storage).
- **A stale snapshot is refused with a message** (another wheel: "run `npm run snapshot` again"). It must be rebuilt
  after changing the dofile wheel, an extra wheel or the Pyodide version. The wheel's file name does not change with its
  code, so the manifest holds SHA-256s; `vite build` refuses a snapshot whose record differs, and the page (Vite's
  `__BUILD_ID__`, `scripts/build-id.ts`) compares its build id with `start-files.json`'s (Node tests that pass none skip
  the check). Why: on 2026-11-08 a snapshot older than `browser.py` ran the old code. `uv build --wheel` is reproducible,
  so a rebuild without a code change does not make a snapshot stale. `npm run wheel` first deletes the old `dist/dofile-*.whl`:
  the scripts take the last wheel in file-name order, and `dofile-0.1.0.dev1` sorts after `dofile-0.1.0`. `npm run dev` warns
  of a stale or missing snapshot and starts anyway; `npm run check-snapshot` exits 2 (its results would be of the old
  engine) unless it runs with `--normal`. Test: "a snapshot from a different build of the
  wheel is refused" in `web/e2e/shell.spec.ts`.
- The snapshot is taken after one program has run in a throwaway engine, so the lazily imported modules (graphs,
  commands) are loaded. The page's real `Engine` is created after the restore.

## The start since prototype 1 (2026-11-10)

How the page starts from the snapshot now (`web/src/engine/worker.ts`, `client.ts`; the contract is in
`docs/design/SPEC.md`, sections 6 and 7). The sections below describe the earlier start where they differ.

- **The runtime comes from the page's own origin.** `vite.config.ts` copies `pyodide.asm.wasm`, `python_stdlib.zip` and
  `pyodide-lock.json` from the `pyodide` npm package into `web/public/pyodide/`. The snapshot start makes no request to
  another origin (a browser test checks it). `?snapshot=0` keeps the CDN.
- **The page can download first, counting bytes.** `client.download()` fetches every start file into the Cache
  `dofile-snapshot-<built>` before a worker exists. The build writes the list of those files, with each one's size on disk
  and compressed size, as `dist/start-files.json`, and the download size (the compressed total of the files marked `download`, not the page's own) into `dist/index.html` (since step 5,
  `dist/app/`: the editor is served at the root of its own origin, SPEC section 8, "URLs") (`web/scripts/start-files.ts`): 48.5 MB on 2026-11-10 (snapshot 42.1, runtime 5.75, page 0.68); counted without the page's own files the figure is 0.5 MB lower (the page shows that one, 48.4 MB at brotli 11 on 2026-11-15). A file whose byte count
  is not the list's is not kept.
- **The worker reads that Cache for everything.** `loadPyodide` has no option for the `.wasm` (it fetches
  `indexURL + "pyodide.asm.wasm"`), so during the start the worker's `fetch` looks in the Cache first (`watchFetch`); a
  miss goes to the network. The worker never writes the Cache: `download()` is its one writer, and keeps only a file with
  the byte count of the build's list (a host that answers a missing file with `index.html` and status 200 would
  otherwise poison it). The start works without `download()`, uncached; the page calls it before each start
  (`src/app/engine.ts`). A cached `.wasm` is given the type `application/wasm`, since Pyodide compiles it with
  `instantiateStreaming` and has no fallback; a failed fetch ends the start with an error (Pyodide would wait for ever).
- **The patched loader is imported from a `blob:` URL** made from the cached bytes, so it is not fetched twice; if a
  browser refuses, the worker imports the loader's own URL. Checked in Chromium, Firefox and WebKit.
- **A cached file that `unpack` refuses is deleted**, so the next start fetches it again.
- **No IDBFS.** `/work` is a plain in-memory folder. The files live in dofile's own IndexedDB store, which the page reads
  and writes directly; `mount` copies it into `/work`, and after each run the worker writes back what the run changed.

## Results

Node, local files (one run of each, same machine):

| | Normal boot | From the snapshot, uncompressed (the spike, commit `10e0f1c`) | From the compressed snapshot (the demo) |
|---|---|---|---|
| Time to a running engine and a first regression | 5.2 s | 0.64–0.80 s | 1.31 s |

The demo's 1.31 s: read 0.02 s, **decompress 0.70 s**, start the wasm module 0.05 s, write site-packages 0.08 s,
**re-link 136 libraries 0.42 s**, copy the heap 0.04 s. After a restore the first program runs in 0.04–0.18 s.

In the browser (2026-11-07, `web/scripts/measure-startup.mjs`, the 39.9 MB build, Chromium 158, the built page, the
network throttled through the DevTools protocol): the harness writes `docs/img/startup-times.json` and
`docs/img/make-startup-times.mjs` draws the chart. It serves the page like a real host (brotli 5 for text and wasm, long
caching for hashed assets, the isolation headers, the `.bin` files as they are); Pyodide's runtime and packages come
from jsDelivr, throttled too, so the unthrottled rows depend on this machine's connection. Each cell is the median of 3
runs of the page's "ready in X s" (a new browser context is cold, a reload in it warm); runs agree within 0.3 s.

![Time until the engine is ready, normal boot vs snapshot, by network speed, for a first and a return visit](img/startup-times.svg)

| Network | Normal, cold | Normal, warm | Snapshot, cold | Snapshot, warm |
|---|---|---|---|---|
| Unthrottled | 5.8 s | 4.5 s | 1.7 s | 1.2 s |
| 100 Mbps, 20 ms | 6.9 s | 5.3 s | 5.1 s | 1.2 s |
| 30 Mbps, 50 ms | 13.9 s | 9.2 s | 13.9 s | 1.2 s |

- **Return visits win everywhere:** 1.2 s against 4.5–9.2 s: 0.6 s decompressing, 0.5 s restoring (site-packages
  0.07 s, re-link 0.36 s, the heap 0.03 s).
- **First visits depend on the network.** The snapshot wins above about 100 Mbps and is level at 30 Mbps. A cold visit
  is the download (0.07 s unthrottled, 3.3 s at 100 Mbps, 11.0 s at 30 Mbps), the wasm compile (0.5, 0.6 and 1.8 s) and
  the same 1.1 s of decompressing and restoring.
- **The download is the cost:** 39.9 MB (40.8 MB sent with the page on a first visit), against about 25 MB of wheels for
  the normal boot. That is also all the browser stores.
- **Compressed storage costs 0.3–0.7 s per start** (measured on the 46.5 MB build) against keeping 229 MB decompressed,
  and the download is about 12 MB smaller than the brotli 5 a host would send (52.3 MB).
- The bundle has only about 8 MB of dead weight (tests, type stubs); the bulk is scipy (41 MB), matplotlib (17) and
  numpy (11). Trimming it would not change the picture.
- Against plain `vite preview` (no compression, nothing cached) the snapshot took 2.8 s cold and 2.4 s warm: not
  comparable, so not in the table or chart.

## Packages added: `xlwt`, `xlrd` and `pyreadstat`, not pandas (2026-11-09)

For legacy `.xls` and for SAS transport, SPSS and Stata 7 and older `.dta` files
([browser-engine.md](browser-engine.md#known-gaps-in-the-browser-engine)), the normal boot installs `xlwt` and `xlrd`
(pure Python, from PyPI, dependencies of the dofile wheel) and `pyreadstat`, which has no Pyodide build, so `web/wheels/`
holds one we compiled (`web/wheels/README.md`). The snapshot holds all of them. Pandas is **not** installed: only
`export sasxport` needs it.

Four builds, measured the same day on one machine (`measure-startup.mjs`, 2 reps, Chromium; the 11-07 column is the
table above, 3 reps). Times are cold / warm. The unthrottled normal-boot times swing by seconds (the CDN), so compare the
30 Mbps rows.

| | 11-07 (before) | A: `xlwt`+`xlrd` | C: A + `pyreadstat`, no pandas | D: C + pandas |
|---|---|---|---|---|
| What works | no `.xls`, no ReadStat | `.xls` | `.xls`; read SAS transport and SPSS (**shipped**) | all of C; also `export sasxport` |
| Snapshot, compressed | 39.9 MB | 40.5 MB | 41.7 MB | 48.6 MB |
| Normal boot, host / CDN extra | 3.0 MB | 3.0 MB | 3.6 MB | 3.6 MB host, plus 4.2 MB pandas from the CDN |
| Normal boot, 30 Mbps | 13.9 / 9.2 s | 14.4 / 9.5 s | 15.1 / 9.6 s | 15.7 / 9.8 s |
| Snapshot start, 30 Mbps | 13.9 / 1.2 s | 14.1 / 1.3 s | 14.6 / 1.4 s | 16.5 / 1.5 s |
| Snapshot start, unthrottled | 1.7 / 1.2 s | 1.9 / 1.3 s | 2.0 / 1.3 s | 2.0 / 1.5 s |

`xlwt` and `xlrd` cost 0.6 MB and about 0.2 s. `pyreadstat` (the 0.6 MB wheel, narwhals, its native code) costs another
1.2 MB and 0.5 to 0.7 s on a cold 30 Mbps start. Pandas would cost 6.9 MB in the snapshot, 4.2 MB more on a normal boot,
and on a cold 30 Mbps start 0.6 s more for a normal boot and 1.9 s more for a snapshot start, for `export sasxport`
alone. Without it that command stops with `export sasxport is not available: it needs the pandas package` (rc 199,
ODT-32; checked in Pyodide under Node and in all four e2e browsers). A and D were built by hand; C is the committed build;
the numbers are not in CI.

C is committed: 41.6 MB. A snapshot start passes 95 of 97 Stata cases directly, the 63 corpus checks, the 12 probes and
the 13 native-library calls; 1701 and 1911 differ only by `export sasxport` and match with `check-snapshot.mjs --normal
--pandas`. `npm run e2e` passes in all four profiles, including a test that writes and reads `.xls`, reads a `.xpt` and
a `.sav`, and checks the `export sasxport` refusal. To add pandas later (D): load it in `worker.ts` and
`install-engine.ts`, import it in `make-snapshot.mjs`, and empty `EXPECTED_DIFFER`.

## File size: what is done and what is not

The two files and their sizes: "What is in the demo". Sizes below are compressed MB, measured unless marked; the code
is in `web/src/engine/snapshot.ts`, `web/scripts/make-snapshot.mjs` and `web/src/engine/worker.ts`.

**Download size**

| Optimization | Status | Effect | Notes |
|---|---|---|---|
| Brotli 11 for both files, decoded in the page by brotli-wasm | **Done, the default** | smallest format tried (see [Making the files smaller](#making-the-files-smaller)) | `SNAPSHOT_QUALITY` (default 11, window 24; 5 is for development: a 7 s build instead of 125 s, about 25% bigger) |
| Zero the copies of native libraries in the heap | **Done, the default** | heap 26.5 → 22.2; total 46.5 → 42.3 | Emscripten keeps each `.so`'s bytes after `dlopen`, and the bundle has them too: 135 of 136 buffers (30.5 MB raw) were identical to their files. `zeroLibraryCopies` |
| Strip docstrings and asserts (`PYTHONOPTIMIZE=2`) | **Done, the default** (since 2026-11-07) | heap 22.2 → 19.8; total 42.3 → 39.9 | `SNAPSHOT_STRIP_DOCS=0` builds without it; the manifest records `optimize: 2`. It removes every library's `assert`s, so it rests on the checks below (identical results to the unstripped build), not on a proof |
| Files named `.bin`, kept compressed in the browser | **Done** | the Cache API holds 40 MB, not 229 | a `.br` name makes hosts send `Content-Encoding: br`, and the browser decodes before the cache sees it |
| Leave matplotlib out of the snapshot and fetch it at the first graph | **Not done** (step 4a of the plan; no code) | estimated about 9.7 less before "ready" | the first graph then pays about 0.9 s (0.3 s with `.pyc` files); needs the bundle in two parts and a fetch. [Experiment](lazy-matplotlib.md#experiment-loading-matplotlib-lazily) |
| Ship `.pyc` files for the lazily loaded part | **Not done** (part of the row above) | 0.6 s of the 0.87 s first graph is compiling | |
| Leave out the bundle's tests (6.6 MB raw) and type stubs (1.5 MB raw) | **Not done** | too small to matter | `bundle()` takes every file under site-packages |
| Leave out unused scipy subpackages (`io`, `signal`, `cluster`, `odr`: 4.1 of 40.8 MB raw) | **Not done** | little to gain | the corpus programs import 493 scipy modules |
| Zero the heap's free memory | **Tried, no gain** | 34.0 against 34.3 at brotli 5 | no large free blocks are left |
| zstd or gzip instead of brotli | **Tried, rejected** | zstd 22 decoded the heap wrongly without any error; gzip is half as good | the build compares the decoded files with the originals |
| Explain the 12 MB the heap gains from installing the packages, before any import | **Not investigated** | the largest piece nothing here removes | |
| A smaller Pyodide runtime, or self-hosting it | **Self-hosted** (2026-11-10), not smaller | the snapshot start asks nothing of another origin | `vite.config.ts` copies `pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` from the npm package into `public/pyodide/` (5.75 MB as a host sends them, 12.3 MB on disk); `?snapshot=0` still loads the runtime and the packages from jsDelivr |

**Start time and memory**

| Optimization | Status | Notes |
|---|---|---|
| The engine starts at page load, in the background | **Done** | `start()` in `src/app/engine.ts`, after the tab lock (a first visit asks first); only Run and Reset wait |
| Decompress in steps into one buffer per file | **Done** | the memory peak stays near the decompressed size; not a speed gain |
| One snapshot that starts on iOS | **Done** | built without Pyodide's trampoline, [below](#the-trampoline) |
| Starting from the snapshot at all | **Done, the default** (`?snapshot=0` = normal boot) | no fallback to the normal boot when the snapshot is missing, stale or fails: the page says why (a stale one: reload the page), so CI cannot pass by quietly booting the old way; it does not name `?snapshot=0`. An automatic fallback is a possible later step, not built. A crash on a low-memory phone (peak about 1.25 GB against 0.7 GB for the normal boot) is only checked on one iPhone 13 |
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

Brotli 11 is the smallest. fzstd with a 128 MB window produced wrong bytes without any error, so the build decodes both
files again and fails on any difference. The decoders output about 390 MB/s (Node's native brotli 600). The manifest
does not record the quality, but recompressing the decoded heap at quality 11 with the build's parameters reproduces
`heap.brotli.bin` byte for byte (at quality 5 it does not): that is how to check a built file.

Where the heap's size comes from (snapshot after each stage, brotli 5): bare Pyodide 5.2 MB; packages installed, nothing
imported 17.2 (not explained: the install itself adds 12); numpy 15.9; scipy 26.1; matplotlib 30.6 (4.5 for importing it,
and its files cost 7.4 in the bundle); openpyxl and one engine run 34.3.

## Correctness checks

`cd web && npm run check-snapshot` (`web/scripts/check-snapshot.mjs`) checks, in Node with the page's restore code, that
an engine restored from the snapshot gives the normal engine's results. Options: `-- --dir path` (another snapshot
folder), `--shards N` (default 4), `--timeout` (default 300 s), and `--normal` to run the same checks on a normal boot,
the baseline that tells a snapshot problem from one Pyodide has anyway. It runs:

- **conformance** (one process): the corpus (`tests/conformance`, `CHECK name=value` against `ref.json` to 1e-6), the
  probes (with graphs), a graph export, and 13 calls into the native libraries (`NATIVE_CHECKS` in
  `web/scripts/snapshot-node.ts`: scipy's linear algebra including LAPACK `dsytrf`, stats, special, optimize, sparse,
  integrate, interpolate, fft, numpy, and a matplotlib plot with text);
- **compat** (the other processes): the 98 Stata 14 reference cases of `tests_opendta/compat`, through
  `tests_opendta/tools/compare.py` mounted into Pyodide, the same acceptance rule as `tests/test_stata_compat.py`; the
  slowest cases start first.

It takes about 2.5 minutes for the snapshot start and is not part of `npm test`.

**Results, 2026-11-07.** On every snapshot start checked (brotli 5 and 11, with and without the trampoline and
stripping; the last on the 39.9 MB build, 150 s): 63 corpus checks, 12 probes and 13 native-library calls clean, and
**95 of 97 Stata cases pass**, the same two failures as a normal boot (`xlwt`, `pyreadstat`; all 97 pass since those
packages were added, see "Packages added" above). The count is 97, not 98: `1920_models4` has no Stata log. Before
PATCH-4 and the `numpy.linalg` shim (`src/dofile/linalgshim.py`) 16 cases failed on the snapshot and the normal boot
alike: 11 from one 32-bit numpy bug in `expand` and `stsplit`, 2 package gaps, and 3 numeric cases (also 20–500 times
slower). See [Known gaps](browser-engine.md#known-gaps-in-the-browser-engine) and the
[open investigation](browser-engine.md#open-investigation-model-fits-take-far-longer-in-pyodide). No failure is specific
to the snapshot or to stripping docstrings.

**Bugs the checks found in the snapshot's own code**
- **A restore bug, fixed 2026-11-07.** After a restore, `scipy.linalg.solve` ended the process with `Dynamic linking
  error: cannot resolve symbol dsytrf_`. Emscripten's `dlopen` gives each load a scope object (`localScope = global ?
  null : {}`) that collects its local dependencies' exports; the re-link passed none. The fix is one argument in
  `restoreOptions` (`r.global ? null : {}`). Earlier checks used numpy's own linear algebra and missed it.
- **Its regression test**, `web/test/snapshot-native.test.ts` (in `npm test`): 13 native-library calls after a restore.
  Without the fix it fails on `dsytrf_` at the first call.
- The matplotlib font descriptors bug (above) was found the same way, by comparing a graph after a restore with a
  normal one.

## On a real iPhone (2026-11-08)

One iPhone, Safari, the page served by `npm run dev` from a Mac over the LAN (plain HTTP, so **not a secure context**:
no Cache API, so the snapshot is downloaded and unpacked on every visit, and no cross-origin isolation, so Break
restarts the engine). Numbers read by hand, a few runs each: an indication, not a benchmark.

| Start | Total | Breakdown |
|---|---|---|
| Snapshot, brotli-wasm | 28–30 s | download 0.2 s, **unpack 25–28 s** (heap 13.9 s, site-packages 11.5 s), restore 2.1 s, files 0.1 s, engine 0 s |
| Snapshot, the browser's native brotli | not read; unpack about 3 s (as reported) | the rest was not changed |
| Normal boot | 9.2 s | runtime 2.3 s, files 0.1 s, packages 2.6 s, engine 3.9 s |

- **Unpacking was the problem, not the network or the restore.** brotli-wasm decoded about 9 MB/s on the phone against
  about 330 MB/s on a laptop (Node), for unknown reasons. The phone's Safari has `DecompressionStream("brotli")`, which
  brought the unpack to about 3 s. So the page uses the native decoder whenever the browser has one and falls back to
  brotli-wasm if it is missing or fails; `?brotli=wasm` forces the wasm decoder, to compare.
- **Desktop, same page** (Playwright's browsers, local server, unpack time of the two files, three loads each):

  | Browser | native | brotli-wasm |
  |---|---|---|
  | Firefox | 0.4–0.5 s | 0.8 s |
  | WebKit | 0.5 s | 0.7 s |
  | Chromium | fell back to wasm: 0.7 s | 0.7 s |

  Playwright's Chromium has no native brotli in `DecompressionStream`; a current Chrome or Edge was not tried.
- **A run of the sample program** (regress and a scatter plot), desktop, first run then second, in seconds: normal boot
  0.8–1.1 then 0.04–0.06; snapshot 0.09–0.13 then 0.05–0.06 (the snapshot has matplotlib loaded). On the phone a run
  took 2–3 s in snapshot mode until the snapshot, older than the code, was rebuilt: then 0.1–0.2 s, against 0.1–1 s on
  the normal boot (cause not established).
- **Where the time goes** is in the client's `startup`, the worker's `[dofile] snapshot start` console line and a run's
  `timing` (until prototype 1, step 3, the page's status line). A snapshot start: `[download|read from cache X s, unpack
  X s (heap, site-packages, decoder native|wasm), restore X s, files X s, engine X s; not cached]`. A normal boot:
  `[runtime, files, packages, engine]`. A run: `rc 0 in X s (engine, encode, json, save, other)`, where engine includes
  drawing the graphs and `save` is the write of the changed files to the IndexedDB store. The same facts go to the
  console (`[dofile] unpack with ...`).
- **Not measured on a phone:** a first visit over a real network, a return visit with the cache working (needs HTTPS: a
  tunnel such as `cloudflared`, or a host), memory use, Low Power Mode.

### Debugging an iPhone 13 (2026-11-08): the worker ran twice, and what was only the phone

On a real iPhone 13 (Safari; `wrangler dev` over the LAN and a Cloudflare https tunnel) the page failed with `the engine
did not start: undefined is not an object (evaluating 'V.loadPackage')`, every time with `?snapshot=1`, never on a
desktop. What was found:

- **The cause: a chunk imported the worker's own entry file.** iOS Safari evaluated `worker.js` twice for one `new
  Worker`: `mount` reached the first copy, later messages the second, so `boot` ran with no snapshot mounted. The second
  evaluation came when `loadBrotli()` imported `brotli-wasm`, which Vite had put in its own chunk that imported the
  worker's entry for the bundler's helpers (desktop browsers and Playwright's iPhone profile do not re-run it). **Fix:**
  `worker: { rollupOptions: { output: { inlineDynamicImports: true } } }` in `vite.config.ts`: the worker is one file.
  If a built `worker-*.js` is ever imported from another `assets/*.js`, this is back.
- **Web Inspector misleads.** With it attached the page was very slow and the console showed the duplicated worker's
  output. Read the console after a load, and time nothing with the inspector on.
- **The snapshot can crash the tab.** Safari reloaded the page ("a problem repeatedly occurred") on `?snapshot=1`, never
  on a normal boot. Peak memory in Node (`/usr/bin/time -l`): normal boot 0.7 GB, snapshot 1.25 GB, and a second Python
  (a duplicated worker) well beyond. Letting go of the compressed files and the site-packages bytes once unpacked was
  tried and removed: it did not change Node's peak and was never measured on the phone. After the single-file fix the
  snapshot worked on the phone.
- **`cProfile` is not a speed measurement.** Profiled, a scatter took 2.8–3 s on the phone against 0.1 s unprofiled, and
  a normal boot's first graph 64 s (39 s in `compile`: matplotlib ships without `.pyc` files). The profiler's hook costs
  far more on the phone than in Node (0.17 s profiled, 0.04 s not). Use it for the shape of the time only. A check that
  the phone itself is fine: `sum(range(10**7))` took 0.4 s in Pyodide's console (`pyodide.org/en/stable/console.html`).
- **The slow earlier numbers were the phone's state.** "2–3 s per graph in snapshot mode" and "normal boot too slow to
  start" were measured with the inspector on and did not come back after the fixes (the second graph 0.1 s or less).
- **`save` of 1 s on some runs**: Safari's IndexedDB took about 1 s on some of the worker's writes of `/work` after every
  run. Since 2026-11-10 there is no IDBFS: the files live in dofile's own store (`web/src/engine/store.ts`), and after a
  run the worker writes only the files whose size or time changed, in one transaction. Not timed on a phone yet.
- **Ruled out:** a 304 reply without COEP, a stale snapshot (its wheel hash matched), the iOS user agent (Node with an
  iPhone user agent: 0.05 s per graph), Pyodide's trampoline.
- **Method that worked:** a log line with a random id at the top of the worker script and in each `onmessage`, and one
  in the client's `call`; a `BroadcastChannel` between copies of the worker showed whether another copy was alive. Both
  were removed again.

## Tests

- `web/test/engine.test.ts` (Node, `npm test`): the snapshot start runs a regression, a scipy computation, a graph, file
  writes and Break (rc 1, data kept), and a list of another build is refused with its message. Skipped if
  `public/snapshot/` has not been built. Every worker it starts is ended in an `after` hook, so a failing assertion does
  not leave `npm test` hanging.
- `web/test/snapshot.test.ts`: `inflate` and `unpack` (a round trip in steps of any size, a file a host already
  decoded, and truncated, damaged, wrongly sized and mismatched-manifest files refused), and `inflateNative`/`unpackAsync`
  (the same bytes as brotli-wasm; a truncated file falls back and gives the wasm error; skipped without native brotli).
- e2e: the snapshot is the default start (`npm run e2e` builds it; a missing one fails the tests). The cached start, a
  reload that reads from the cache, and **everything in the browser's caches between 10 and 80 MB** (about 40 MB; the
  check that found the `.br` problem) are in `web/e2e/engine.spec.ts`; the stale manifest and `?snapshot=0` in
  `web/e2e/shell.spec.ts`. `web/e2e/poc.spec.ts`, where they started, is all fixme.

## Not done, and risks

- **Browsers.** `npm run e2e` covers Chromium, Firefox, WebKit and an iPhone 15 profile; one real iPhone was tried by
  hand. Not checked: other phones, Android, Chrome or Edge as shipped, a real phone over HTTPS with the cache working,
  Break in the browser with a snapshot (tested in Node), files restored from IndexedDB with a snapshot start. Two WebKit
  problems, both settled:
  - **Desktop WebKit: the cache was empty after a reload.** Playwright's default context keeps storage in memory, and
    WebKit drops the whole Cache API on reload there. The snapshot test runs in a persistent profile, as a real browser
    does.
  - **iPhone profile: "call_indirect to a signature that does not match".** See [The trampoline](#the-trampoline).
- **Browser memory** is higher: the heap image is 136 MB before anything runs, and during the start the compressed files
  (39.9 MB) and the decompressed ones (229 MB) are in memory together for a moment. The iPhone tried ran it without a
  crash; its memory use was not measured.
- **Cache errors.** The worker writes nothing to the Cache (`download()` does); only the browser refusing to open it
  (`QuotaExceededError`, `SecurityError`, `NotAllowedError`, or no Cache API) lets the engine start uncached, reported as
  `NOT CACHED: ...` with the start's timings; any other error is thrown.
- **A patched copy of Pyodide's loader**, generated from the installed file, fails loudly if the text changes and needs
  a rebuilt snapshot on every Pyodide upgrade. It relies on internals (`loadWebAssemblyModule`, `LDSO`, `wasmTable`).
  Check upstream for native-extension snapshot support before each upgrade.
- **`npm run build` copies `public/snapshot/`** (39.9 MB) into `dist/`. The files are already compressed, so the host
  needs no brotli setting and must not add a `Content-Encoding` (the `.bin` names keep common servers from doing that).
- The snapshot build needs the network once (openpyxl from PyPI) and takes about 2 minutes at quality 11.
- **A new dependency**, `brotli-wasm` (Apache-2.0, 1 MB of wasm): the browser cannot decode brotli from script by itself.

### The trampoline

WebAssembly's `call_indirect` traps when the callee's signature differs from the call site's, and CPython often calls
through function pointers cast to another type. Pyodide's loader embeds a small wasm "trampoline" that makes such calls
with the callee's real signature, and writes its pointer into `__PyRuntime` in the heap. On iOS (a `navigator.userAgent`
test) it writes 0 and CPython uses a JavaScript call path that tolerates a mismatch (inferred, not read in CPython's
source).

**What went wrong.** A snapshot made in Node has a non-zero pointer; on an iPhone that slot holds nothing valid, and the
first call through it fails (`Module._init_pyodide_proxy()`). Only the user agent matters (checked in WebKit with the
profiles mixed). A real iOS device was not tried.

**The fix.** `make-snapshot.mjs` patches the loader to behave as on iOS everywhere (`noTrampoline` in `snapshot.ts`),
for the build and the restore, so the pointer is always 0 and one snapshot starts in every browser.
`SNAPSHOT_TRAMPOLINE=1` keeps Pyodide's own choice.

**What it costs** (Node, normal boot against iOS user agent): 2M calls of `len` and `abs` 1.47x; 60 `regress` calls
1.13x; a pure Python loop, `list.append`, `sorted` and tiny numpy and scipy calls the same. OpenDTA's unit suite 128 s
against 134 s (about 5%), the 97 Stata cases 151 s against 153 s. The results are identical: the same 1,061 unit tests
agree with CPython (`npm run check-pytest -- --ios`; the wasm table length, 51558 against 51559, shows the trampoline
was off) and the same 95 of 97 Stata cases pass on a snapshot. Not measured: a desktop browser, where a plain boot would
still have the trampoline.

## Recommendation

The default start since 2026-11-09, with no fallback. A clear win for return visitors and for first visits faster than
about 100 Mbps, and level on a 30 Mbps first visit (13.9 s against 13.9 s). What is left, in order of effort (what is
done is in [File size](#file-size-what-is-done-and-what-is-not)):

1. ~~**Decide whether to make it the default**~~ decided 2026-11-09: the default, without a fallback. Memory on a phone
   (136 MB heap, 229 MB decompressed during the start) is the open question.
2. ~~**Decide on stripping docstrings**~~ done 2026-11-07: the default (2.4 MB less); the checks on the quality-11 build
   match the unstripped build.
3. **Load matplotlib and its dependencies on the first graph instead of in the snapshot** (not done; File size table;
   plan: [Experiment: loading matplotlib lazily](lazy-matplotlib.md#experiment-loading-matplotlib-lazily)).
4. **Normal boot: import scipy lazily and download the packages lazily** (not done). This helps first visits without a
   big download; combine with the snapshot for return visits.
5. Smaller things (File size table): the bundle's tests and type stubs, the 12 MB the package install adds to the heap,
   and openpyxl fetched from PyPI on every cold start.
