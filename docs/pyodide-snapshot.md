# Starting the web demo from a Pyodide memory snapshot

Status (2026-11-07): built, measured and checked; opt-in in the demo with `?snapshot=1`. The default build is 42.3 MB
(brotli 11); a return visit starts in 1.2 s against 4.6–9.3 s for the normal boot, and a first visit in 1.7 s unthrottled
(5.4 s at 100 Mbps, 14.6 s at 30 Mbps, where the normal boot takes 14.1 s). It passes the conformance corpus, 95 of 97 Stata 14
cases (the other two need packages Pyodide lacks) and the browser tests in Chromium, Firefox, WebKit and an iPhone profile.
Not tried: a real phone. **Which size optimizations are done and which are not: [File size](#file-size-what-is-done-and-what-is-not).**
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
| `web/src/engine/snapshot.js` | the loader patch, the library log, the restore options, and `inflate`/`unpack` (brotli decoding); used by the script and the worker |
| `web/src/engine/worker.js` | `mount` loads from the snapshot when the page gives a URL (download or cache, decompress, restore); `boot` then skips the install |
| `web/src/engine/client.js`, `main.ts` | pass the URL; `?snapshot=1` turns it on and the status says `(snapshot)` |
| `web/spike/snapshot.mjs` | the standalone spike, with its own timing comparison |
| `docs/img/make-startup-times.mjs` | draws the chart below |

- The snapshot is made in Node and runs in the browser. There are two big files: the **snapshot** (the Python heap,
  136 MB) and the **bundle** (the site-packages folder as files, 93 MB, 3,884 files, which the snapshot needs because
  it holds memory and not the filesystem). They are written **brotli-compressed at quality 11**, as
  `heap.brotli.bin` (22.2 MB) and `site-packages.brotli.bin` (20.0 MB), so 42.3 MB in all (the heap was 26.5 MB, 46.5 MB in all,
  before the library copies were zeroed; see "Making the files smaller"). The small files are
  `dso.json` and `files.json`, the patched `pyodide.asm.patched.mjs`, and a `manifest.json` with the wheel's name, the
  Pyodide version, a build time, and each big file's name, compressed size and decompressed size. The build decodes
  both files again with the decoder the page uses and fails if they are not identical.
- **Only the compressed files are kept in the browser** (the Cache API, under a name with the build time; older builds
  are deleted): 42.3 MB of storage, not 229 MB. Every start reads them and decompresses them with brotli-wasm
  (a 1 MB wasm decoder, about 0.7 s for both files), in steps into one buffer per file so the memory peak stays near
  the decompressed size. The browser's own HTTP cache did not keep files this big across visits in the tests; the
  Cache API did.
- **The files end in `.bin`, not `.br`.** `vite preview` (and many hosts) send any `.br` file with
  `Content-Encoding: br`, so the browser decodes it before the page can store it, and the cache held the full 229 MB;
  the browser test that checks the stored size caught this. If a host decodes the files anyway, `unpack` notices the
  decompressed length and uses the bytes as they are: it still works, but the storage is larger.
- **A stale snapshot is refused with a message** (built for another wheel: "run `npm run snapshot` again"). It must
  be rebuilt after changing the dofile wheel or the Pyodide version.
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

Chromium 158, the built page, the network throttled through the DevTools protocol; measured on 2026-11-07 with the brotli 11
snapshot (42.3 MB, trampoline-free: see [The trampoline](#the-trampoline)) by `web/scripts/measure-startup.mjs`, which writes
`docs/img/startup-times.json` (every run, and the page's own breakdown of each snapshot start); `docs/img/make-startup-times.mjs`
draws the chart from it. The page is served by a small static server that does what a host does: brotli (quality 5) for text and
wasm, long caching for the hashed assets, the isolation headers, and the snapshot's `.bin` files as they are. Pyodide's runtime and
packages come from the real jsDelivr CDN, throttled too, so the unthrottled rows depend on this machine's connection. The time is
the page's own "ready in X s". Each cell is the median of 3 runs (a new browser context is a cold cache, and a reload in it is a
warm one); the runs agree within 0.3 s. The earlier version of this table was one run per cell, from a harness that was not kept
(it is in git history, with the 46.5 MB build):

![Time until the engine is ready, normal boot vs snapshot, by network speed, for a first and a return visit](img/startup-times.svg)

| Network | Normal, cold | Normal, warm | Snapshot, cold | Snapshot, warm |
|---|---|---|---|---|
| Unthrottled | 5.8 s | 4.6 s | 1.7 s | 1.2 s |
| 100 Mbps, 20 ms | 7.1 s | 5.4 s | 5.4 s | 1.2 s |
| 30 Mbps, 50 ms | 14.1 s | 9.3 s | 14.6 s | 1.3 s |

What it says:

- **Return visits win everywhere.** The snapshot starts in 1.2–1.3 s (0.66 s of it decompressing) against 4.6–9.3 s.
- **First visits depend on the network.** Faster than about 100 Mbps the snapshot wins (1.7 s against 5.8 s
  unthrottled). At 100 Mbps it is ahead (5.4 s against 7.1 s). At 30 Mbps it is about level and slightly behind (14.6 s against
  14.1 s; it was 16.0 s against 14.1 s with the 46.5 MB build). A cold visit is the download (the page's own timing: 0.06 s
  unthrottled, 3.5 s at 100 Mbps, 11.7 s at 30 Mbps) plus the browser's compile of the wasm module (0.5, 0.7 and 1.8 s) plus 1.1 s
  of decompressing (0.66 s) and restoring (site-packages 0.07 s, re-link 0.36 s, copy the heap 0.03 s). A warm start has the same
  1.1 s plus 0.02-0.08 s to read the cache and 0.06 s to start the module.
- **The download is the cost.** 42.3 MB (43.2 MB sent by the host on the first visit, with the page), against about 25 MB of wheels
  for the normal boot (the earlier measurement; both also download the Pyodide runtime). That is the whole of what the browser stores, too.
- **What compressed storage cost:** an earlier version kept the decompressed files in the cache and started in 0.6 s
  warm (1.0 s unthrottled). Keeping the files compressed (46.5 MB then, 42.3 MB now) instead of 229 MB makes every start 0.3–0.7 s slower (measured
  with the 46.5 MB build), and the first visit's download 10 MB smaller than the quality-5 brotli a host would send (52.3 MB,
  measured: 28.5 MB for the heap and 23.8 MB for the bundle).
- Only about 8 MB of the site-packages bundle is dead weight (tests 6.6 MB, type stubs 1.5 MB), so trimming it
  would not change the picture. The bulk is scipy (41 MB), matplotlib (17) and numpy (11).
- An earlier unthrottled run against plain `vite preview` gave 2.8 s cold and 2.4 s warm for the snapshot, against
  5.8 s and 4.5 s. That server does not compress and the files were not cached, so those figures are not in the
  table or the chart.

## File size: what is done and what is not

A first visit downloads two files, compressed: the **heap image** (the Python process's memory after the imports, 136 MB
raw, 22.2 MB compressed) and the **bundle** (the site-packages folder as files, 93 MB raw in 3,884 files, 20.0 MB
compressed), 42.3 MB in all (43.2 MB sent by the host with the page and the small files). By raw size the bundle is mostly
scipy (41 MB), matplotlib (17) and numpy (11). A return visit downloads none of it but still decompresses it (0.66 s).
Sizes below are compressed MB, measured unless marked; each row's code is in `web/src/engine/snapshot.js`,
`web/scripts/make-snapshot.mjs` or `web/src/engine/worker.js`. Checked against the code on 2026-11-07.

**Download size**

| Optimization | Status | Effect | Notes |
|---|---|---|---|
| Brotli 11 for both files, decoded in the page by brotli-wasm | **Done, the default** | smallest format tried: gzip -9 72.5, zstd 19 49.7, brotli 5 58.0, brotli 11 46.5 (all before the next row) | `SNAPSHOT_QUALITY` (default 11, window 24; 5 is for development: 52.3 MB, a 7 s build instead of 145 s). The quality of a built file is checked by recompressing the decoded file ([below](#making-the-files-smaller)) |
| Zero the copies of native libraries in the heap | **Done, the default** | heap 26.5 → 22.2; total 46.5 → 42.3 | Emscripten keeps each `.so`'s bytes after `dlopen`, and the bundle has them too: 135 of 136 buffers (30.5 MB raw) were identical to their files. `zeroLibraryCopies` |
| Files named `.bin`, kept compressed in the browser | **Done** | the Cache API holds 42 MB, not 229 | a `.br` name makes hosts send `Content-Encoding: br` and the browser decodes before the cache sees it |
| Strip docstrings and asserts (`PYTHONOPTIMIZE=2`) | **Implemented, off by default** | about 2.3 less (total about 40) | `SNAPSHOT_STRIP_DOCS=1`, recorded as `optimize: 2` in the manifest. Removes the `assert`s of every library. Checked against the corpus, the probes and the Stata cases on a quality-5 build, no new failure; not re-checked on the current build |
| Leave matplotlib out of the snapshot and fetch it at the first graph | **Not done** (step 4a of the plan; no code) | estimated about 9.7 less before "ready" (core about 32–33, graphics about 8 later) | costs about 0.9 s at the first graph, about 0.3 s if `.pyc` files are shipped; needs the bundle in two parts and a fetch, and `run` has to wait for it. [Experiment: loading matplotlib lazily](phase2-plan.md#experiment-loading-matplotlib-lazily) |
| Ship `.pyc` files for the lazily loaded part | **Not done** (part of the row above) | 0.6 s of the 0.87 s first graph is compiling matplotlib's source | |
| Leave out the bundle's tests (6.6 MB raw) and type stubs (1.5 MB raw) | **Not done** | too small to matter (not measured compressed) | `bundle()` takes every file under site-packages, nothing is excluded |
| Leave out unused scipy subpackages (`io`, `signal`, `cluster`, `odr`: 4.1 of 40.8 MB raw) | **Not done** | scipy cannot be trimmed much | the corpus programs import 493 scipy modules |
| Zero the heap's free memory | **Tried, no gain** | 34.0 against 34.3 at brotli 5 | no large free blocks are left |
| zstd or gzip instead of brotli | **Tried, rejected** | zstd 22 with a 128 MB window decoded the heap wrongly without any error; gzip is half as good | the build compares the decoded files with the originals |
| Explain the 12 MB the heap gains from installing the packages, before any import (5.2 → 17.2 at brotli 5) | **Not investigated** | the largest single piece that nothing here removes | |
| A smaller Pyodide runtime, or self-hosting it | **Not touched** | | both flows download Pyodide's runtime (13.5 MB raw, about 5.5 compressed) from jsDelivr |

**Start time and memory** (what a visit costs besides the download)

| Optimization | Status | Notes |
|---|---|---|
| The engine starts at page load, in the background; the editor and the files do not wait for it | **Done** | `engine.start()` in `main.ts`; only Run and Reset wait |
| Decompress in steps into one buffer per file | **Done** | the memory peak stays near the decompressed size; not a speed gain |
| Starting from the snapshot at all | **Done, opt-in** (`?snapshot=1`) | making it the default, with a fallback to the normal boot, is not done |
| One snapshot that starts on iOS | **Done** | built without Pyodide's trampoline, [below](#the-trampoline) |
| Keep the files decompressed in the browser's storage | **Rejected** | 0.3–0.7 s faster per start, 229 MB stored instead of 42 |
| Normal boot: import matplotlib only at the first graph | **Done already** (the engine imports it lazily) | measured 2026-11-07: `browser.start()` imports numpy and scipy (1.8 s in Node), matplotlib and PIL come with the first graph (0.82 s) |
| Normal boot: import scipy lazily | **Not done** | it is imported in `browser.start()` |
| Normal boot: download the packages lazily | **Not done** | `micropip.install` of the wheel fetches all its dependencies (about 25 MB, an earlier measurement) at boot, and openpyxl from PyPI on every cold start |

In short: brotli 11, the library-copy zeroing and the compressed storage are done and are what the 42.3 MB is; docstring
stripping exists but is off; **lazy-loading matplotlib, shipping `.pyc` files, trimming the bundle and trimming scipy are not
done**; the normal boot's imports of matplotlib are already lazy, its scipy import and its package downloads are not.

## Making the files smaller

Measured on 2026-11-07 on the 136 MB heap image and the 93 MB bundle, before the library copies were zeroed (the table
in [File size](#file-size-what-is-done-and-what-is-not) has the current build). Sizes are compressed, MB.

**Compression format** (decode time is for both files together, in Node):

| Format and decoder | Snapshot | Bundle | Total | Decode |
|---|---|---|---|---|
| gzip -9, the browser's `DecompressionStream` | 43.7 | 28.8 | 72.5 | 0.46 s |
| zstd 19, `--long=24`, fzstd (80 KB of JS) | 28.7 | 21.0 | 49.7 | 0.58 s |
| zstd 22, `--long=27`, fzstd | 27.8 | 20.5 | 48.3 | **decodes the heap wrongly** |
| **brotli 11, brotli-wasm (1 MB wasm)** | **26.5** | **20.0** | **46.5** | 0.59 s |
| brotli 5 (what a host usually sends) | 34.3 | 23.7 | 58.0 | native, not measured |

brotli 11 is the smallest, and its decoder was checked against the original. fzstd with a 128 MB window produced
different bytes from the original for the heap image without any error, so the build compares the decoded files with
the originals and fails on any difference. gzip decodes natively but is half as good. The decoders run at about 390
MB/s output (gzip 490, Node's native brotli 600).

**Found** (the saving is at brotli 11 or 5 as marked; what was done about each is in
[File size](#file-size-what-is-done-and-what-is-not): zeroing is the default, docstring stripping is opt-in, the others are not done):

- **The heap holds a copy of every native library.** Emscripten keeps each `.so`'s bytes after `dlopen` (136 wasm
  headers in the 136 MB image), and the bundle has the same bytes. 135 of 136 buffers (30.5 MB) are byte-identical to
  their files. Zeroing them before the snapshot is taken: **26.5 to 22.1 MB** for the heap at brotli 11 (5.8 MB at
  brotli 5). The restore reads the libraries from the filesystem, so nothing needs the buffers. **Done:**
  `zeroLibraryCopies` in `snapshot.js`, called by `make-snapshot.mjs` on every build, zeroing only a buffer that is
  byte-identical to its file. The default (brotli 11) build with it, 42.3 MB, was made and timed on 2026-11-07 (the table above).
  Recompressing the decoded heap at quality 11 with the build's parameters reproduces `heap.brotli.bin` byte for byte (22,211,148
  bytes; at quality 5 it is 28,514,671), which is how the quality of a built file can be checked: the manifest does not record it.
- **Stripping docstrings** (`PYTHONOPTIMIZE=2`): with the libraries zeroed, **22.1 to 19.8 MB** more at brotli 11 (34.3
  to 30.7 MB at brotli 5 without the zeroing). It also removes `assert`s from every library. **Opt-in:**
  `SNAPSHOT_STRIP_DOCS=1 npm run snapshot` (recorded as `optimize: 2` in the manifest). Checked against the corpus,
  the probes and the Stata 14 cases: no failure that the unstripped normal boot does not also have (see
  [Correctness checks](#correctness-checks)). That is evidence for the code those checks reach, not a proof for all of
  it, so it stays opt-in.
- **Importing matplotlib costs the heap 4.5 MB** (26.1 to 30.6 MB at brotli 5, from the stage-by-stage build below), and
  its files cost 7.4 MB (matplotlib, pillow, fonttools, kiwisolver, contourpy and the rest, at brotli 5). Loading them
  on the first graph instead would cut about 12 MB from a first visit. It needs the bundle in two parts and a fetch
  at the first graph. **Not done.**
- **scipy cannot be trimmed much**: the corpus programs import 493 scipy modules, and the only subpackages never
  imported (`io`, `signal`, `cluster`, `odr`) are 4.1 MB of 40.8 MB raw. **Not done.**
- The combined heap (libraries zeroed and docstrings stripped) is about 19.8 MB against 26.5 MB, so the total would
  be about 40 MB against 46.5 MB. With the zeroing now the default, the build is 42.3 MB and stripping docstrings (opt-in)
  would take it to about 40 MB.

**Tried, no gain:**

- **Zeroing the heap's free memory** before the snapshot: no large free blocks are left at that point (one 4 MB block),
  and filling the heap with small blocks only wrote allocator headers (the heap grew to 406 MB). 34.3 to 34.0 MB.

**Not tried:**

- **Trimming the bundle** (tests 6.6 MB and type stubs 1.5 MB raw): judged too small to be worth a build step, and never
  tried or measured compressed. `bundle()` takes every file under site-packages, so all of it is in the snapshot.

Where the heap's size comes from (snapshot after each stage, brotli 5): bare Pyodide 5.2 MB; after installing the
packages but importing nothing 17.2 MB (not explained: the install itself leaves 12 MB); numpy 15.9; scipy 26.1;
matplotlib 30.6; openpyxl and one engine run 34.3. The step from bare Pyodide to the packages installed is the
largest single piece that nothing here removes.

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

It takes over 30 minutes with four processes: a few estimation cases dominate (`0408_mata_moptimize` took 204–220 s in
Pyodide against 0.43 s on CPython), because the optimizer makes many times as many likelihood evaluations there (see the
[open investigation](phase2-plan.md#open-investigation-model-fits-take-far-longer-in-pyodide)). It has no per-case time
limit yet. It is not part
of `npm test`.

**Results, 2026-11-07**, on a snapshot built with `SNAPSHOT_QUALITY=5 SNAPSHOT_STRIP_DOCS=1` (docstrings and asserts
stripped, library copies zeroed) and on a normal boot (nothing stripped), run side by side:

| | Snapshot start | Normal boot |
|---|---|---|
| Corpus value checks | 63 as expected | 63 as expected |
| Probes | 12, no problem | 12, no problem |
| Native-library calls | 13, no problem | 13, no problem |
| Stata 14 cases (91 of 98 run) | 75 pass, **16 fail** | 75 pass, **16 fail**, the same 16 |

Of the 98 cases 91 were run, 75 passing and 16 failing, in both starts, with the same result for every case. The other 7
(`1904_timeseries`, `1910_programming`, `1914_panel`, `1915_timeseries`, `1919_other_suites2`, `1920_models4`,
`1921_graphics_look`) were still going when both runs were stopped by hand after about 35 minutes, so they are unchecked,
for the snapshot and for the normal boot alike. The 16 are
analysed in the Phase 2 plan, [Known gaps in the browser engine](phase2-plan.md#known-gaps-in-the-browser-engine): 11 are
one 32-bit numpy bug in `expand` and `stsplit` (PATCH-4), 2 need packages Pyodide lacks (`xlwt`, `pyreadstat`), and 3
are numeric known-difference cases that exceed their tolerance under WebAssembly. **None is specific to the snapshot or to
stripping docstrings**, since the normal boot fails the same cases.

**Update, later on 2026-11-07:** the 11 `expand`/`stsplit` cases and the 3 numeric cases now pass in Pyodide, after PATCH-4
and `src/dofile/linalgshim.py` (numpy's `inv`, `solve` and `cholesky` return NaN instead of raising `LinAlgError` in
Pyodide, which also made the slow fits run to their iteration limit). That was on a normal boot, one process per case. **The
whole check was then run on a snapshot start with the shim, three times**: on a brotli 5 build (151 s), on a brotli 5 build
made without the trampoline (153 s), and on the current build, brotli 11 and without the trampoline, 42.3 MB (153 s). Each
time: 63 corpus checks, 12 probes and 13 native-library calls clean, and **95 of 97 cases pass**, the same two failures as on
a normal boot (`xlwt`, `pyreadstat`). The 7 cases left unfinished above ran
too: six pass (`1904`, `1910`, `1914`, `1915`, `1919`, `1921`) and `1920_models4` has no Stata reference log, so it is not
compared (which is why the count is 97, not 98). See
[Open investigation](phase2-plan.md#open-investigation-model-fits-take-far-longer-in-pyodide).

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

## Tests

- `web/test/engine.test.mjs` (Node, `npm test`): the snapshot start runs a regression, a scipy computation, a graph,
  file writes and Break (rc 1, data kept), and a snapshot built for another wheel is refused with its message. They
  skip themselves if `public/snapshot/` has not been built.
- `web/test/snapshot.test.mjs`: `inflate` and `unpack` with the page's decoder: a round trip in steps of any size, a
  file already decoded by a host, and truncated, damaged, wrongly sized and mismatched-manifest files all refused.
  14 of 14 Node tests pass (3 of them these).
- `web/e2e/poc.spec.ts`: `?snapshot=1` starts, runs the sample program with a graph, a reload reads from the cache and
  decompresses, and **everything in the browser's caches adds up to between 10 and 80 MB** (about 42 MB now; this is the
  check that found the `.br` problem). Skipped without a snapshot. 5 of 5 pass in each of the four browser profiles.
- The test file now ends every worker it starts in an `after` hook. Before, a failing assertion skipped the
  `terminate()` at the end of its test and `npm test` hung with the worker alive.

## Not done, and risks

- **Browsers, checked 2026-11-07** (`npm run e2e`: Playwright's Chromium, Firefox, WebKit and iPhone 15 profile, 5 tests
  each, 20 of 20 pass, the snapshot test with a snapshot built for the current wheel). Not checked: a real phone (memory:
  the heap is 136 MB before anything runs, and 229 MB of files are decompressed during the start); Break in the browser with
  a snapshot (it is tested in Node); files restored from IndexedDB with a snapshot start (the mount is the same code, but
  the e2e does not exercise it). The first run found two problems in WebKit, both settled:
  - **Desktop WebKit: the cache was empty after a reload.** Not the page. In Playwright's default context, which keeps
    storage in memory, WebKit drops the whole Cache API when the page is reloaded (a 1 KB entry too, written from the page or
    from a worker, with or without the cross-origin isolation headers); in a persistent profile on disk, entries survive.
    The snapshot test now runs in a persistent profile, as a real browser has. Real Safari was not tried.
  - **iPhone profile: "call_indirect to a signature that does not match".** See [The trampoline](#the-trampoline).
  The conformance corpus and the Stata 14 cases have been run on a snapshot-started engine, in Node, with the
  `numpy.linalg` shim, on 2026-11-07: 63 corpus checks, 12 probes and 13 native-library calls clean, 95 of 97 cases pass in
  151 s (the same two package-gap failures as on a normal boot); the same again on a snapshot built without the trampoline
  (153 s) and on the current brotli 11 build (153 s); see [Correctness checks](#correctness-checks).

### The trampoline

WebAssembly's `call_indirect` traps when the callee's signature differs from the call site's, and CPython's C code often
calls through function pointers cast to another type. Pyodide's loader embeds a tiny wasm function (a "trampoline",
`getWasmTrampolineModule`) that makes such calls with the callee's real signature, and at start it writes that function's
pointer into the Python runtime (`__PyRuntime`, in the heap). On iOS it writes 0 and creates no function
(`getPyEMTrampolinePtr` tests `navigator.userAgent` for iPhone/iPad, or a Mac platform with touch). The loader also has a
JavaScript call path (`_PyEM_TrampolineCall_JS`) that tolerates a mismatch; CPython's choice between the two when the pointer is 0 was
inferred from that, not read in CPython's source.

**What went wrong.** A snapshot is made in Node, with the trampoline, and restoring it puts the Node-time pointer back into
the heap. On an iPhone that slot holds nothing valid, and the first call through it fails: `call_indirect to a signature that
does not match (evaluating 'Module._init_pyodide_proxy()')`. Only the user agent matters (checked in WebKit with the profiles
mixed: desktop with an iPhone user agent fails; iPhone with a desktop user agent starts; a phone viewport, touch and mobile
flags with a desktop user agent start). Real iOS devices run the same check; not tried.

**The fix.** `make-snapshot.mjs` now patches the loader so it behaves as on iOS everywhere (`noTrampoline` in
`snapshot.js`), and the build and the restore use the same patched file, so the pointer in the heap is always 0 and one snapshot
starts in every browser. `SNAPSHOT_TRAMPOLINE=1` keeps Pyodide's own choice (a snapshot that then fails on iOS).

**What it costs** (Node, a normal boot against one with an iOS user agent, best of 3, ms): a pure Python loop 97 / 99; 2M
calls of `len` and `abs` 47 / 69 (1.47x); `list.append`, `sorted` with a Python key, tiny-array numpy and scipy calls the same;
60 `regress` calls 54 / 61 (1.13x). Whole runs: OpenDTA's unit suite 128 s / 134 s (about 5%), conformance and the 97 Stata cases
151 s / 153 s. The results are identical: the same 1,061 unit tests agree with CPython (`npm run check-pytest -- --ios`; each result file
records the wasm table length, 51558 in all 72 files against 51559 in a normal run, which is how a run shows the trampoline was
off), and the same 95 of 97 Stata cases pass on a snapshot. A bare `loadPyodide` has 14175 table entries and 14174 with the iPhone
user agent. Not measured: a desktop browser, where the trampoline would still be on in a plain boot.

**Cache errors.** The worker used to swallow every error of `cache.put` (and of `caches.open`/`delete`). Now only the
browser refusing storage (`QuotaExceededError`, `SecurityError`, `NotAllowedError`, or no Cache API) lets the engine start
uncached, and it is reported with the start's timings (`NOT CACHED: ...`) and in `console.warn`; any other error is thrown.
The failure of the manifest request now says why.
- **Browser memory** is higher: the heap image is 136 MB before anything runs, and during the start the compressed
  files (42.3 MB) and the decompressed ones (229 MB) are in memory together for a moment. Not measured on a phone.
- **A patched copy of Pyodide's loader.** It is generated from the installed Pyodide file, fails loudly if the text
  changes, and needs a rebuilt snapshot on every Pyodide upgrade. This relies on internals (`loadWebAssemblyModule`,
  `LDSO`, `wasmTable`) that Pyodide may change or fix. Check upstream for native-extension snapshot support before
  each upgrade.
- **`npm run build` copies `public/snapshot/`** (42.3 MB now) into `dist/` when it exists. The files are already
  compressed, so the host needs no brotli setting; it must not add a `Content-Encoding` of its own (the `.bin` names
  keep common servers from doing that).
- The snapshot build needs the network once, for openpyxl from PyPI, and takes about 3 minutes at brotli quality 11.
- **A new dependency**, `brotli-wasm` (Apache-2.0, 1 MB of wasm), for the decoder. The browser cannot decode brotli
  from script by itself.

## Recommendation

Keep it opt-in for now. It is a clear win for return visitors and for first visits faster than about 100 Mbps, and about
level on a 30 Mbps first visit (14.6 s against 14.1 s). What is left, in order of effort (what is already done is in
[File size](#file-size-what-is-done-and-what-is-not)):

1. **Decide whether to make it the default, with a fallback to the normal boot.** The four browser profiles pass; a real
   phone has not been tried, and memory there (136 MB heap, 229 MB decompressed during the start) is the open question.
2. **Decide on stripping docstrings** (about 2.3 MB less; implemented, off by default). It removes the `assert`s of every
   library, and the checks run on it so far were on a quality-5 build.
3. **Load matplotlib and its dependencies on the first graph instead of in the snapshot** (not done; about 9.7 MB less before
   "ready" at brotli 11, estimated). The first plot then pays about 0.9 s, mostly compiling, unless `.pyc` files are shipped.
   Findings, conjectures and the plan to measure it: [Experiment: loading matplotlib lazily](phase2-plan.md#experiment-loading-matplotlib-lazily).
4. **Normal boot: import scipy lazily and download the packages lazily** (not done). Its matplotlib import is already lazy
   (first graph 0.82 s); scipy is imported in `browser.start()` and every package is downloaded at boot. This helps first
   visits without a big download; combine with the snapshot for return visits.
5. Smaller things: leave out the bundle's tests and type stubs (8 MB raw), explain the 12 MB the heap gains from the package
   install, and fetch openpyxl without PyPI on every cold start.

Done since this list was first written: zeroing the library copies (4.4 MB less in the first measurement, 4.3 MB now),
testing stripped docstrings, and starting the engine at page load in parallel with the editor.
