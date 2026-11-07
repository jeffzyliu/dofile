# Starting the web demo from a Pyodide memory snapshot

Status (2026-11-07): built and measured in Node and in Chromium; opt-in in the demo with `?snapshot=1`. Not yet
checked in Firefox, WebKit or on a phone. Part of Phase 2 (`phase2-plan.md`); the engine itself is unchanged.

## The question

The page starts the engine by installing the dofile wheel into Pyodide and importing numpy, scipy, matplotlib and the
engine. That takes about 5 s on a fast machine before the first run. Could it load something prebuilt instead, such as
a PyInstaller or Nuitka binary?

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
  `heap.brotli.bin` (26.5 MB) and `site-packages.brotli.bin` (20.0 MB), so 46.5 MB in all. The small files are
  `dso.json` and `files.json`, the patched `pyodide.asm.patched.mjs`, and a `manifest.json` with the wheel's name, the
  Pyodide version, a build time, and each big file's name, compressed size and decompressed size. The build decodes
  both files again with the decoder the page uses and fails if they are not identical.
- **Only the compressed files are kept in the browser** (the Cache API, under a name with the build time; older builds
  are deleted): 46.5 MB of storage, not 229 MB. Every start reads them and decompresses them with brotli-wasm
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

Chromium, the built page and the network throttled through the DevTools protocol (the Pyodide runtime and the wheels
still come from the real jsDelivr CDN, throttled too). Each row is one run; a new browser context is a cold cache,
and a reload in it is a warm one:

![Time until the engine is ready, normal boot vs snapshot, by network speed, for a first and a return visit](img/startup-times.svg)

| Network | Normal, cold | Normal, warm | Snapshot, cold | Snapshot, warm |
|---|---|---|---|---|
| Unthrottled | 6.0 s | 5.3 s | 1.7 s | 1.3 s |
| 100 Mbps, 20 ms | 7.2 s | 5.5 s | 5.8 s | 1.3 s |
| 30 Mbps, 50 ms | 14.1 s | 9.4 s | 16.0 s | 1.3 s |

What it says:

- **Return visits win everywhere.** The snapshot starts in 1.3 s (0.7 s of it decompressing) against 5.3–9.4 s.
- **First visits depend on the network.** Faster than about 100 Mbps the snapshot wins (1.7 s against 6.0 s
  unthrottled). At 100 Mbps it is a little ahead (5.8 s against 7.2 s). At 30 Mbps it loses (16.0 s against 14.1 s).
  A cold visit is the download (3.9 s at 100 Mbps, 12.9 s at 30 Mbps) plus the browser's compile of the wasm module
  (0.4–1.8 s) plus the 1.3 s of decompressing and restoring.
- **The download is the cost.** 46.5 MB, against about 25 MB of wheels for the normal boot (both also download the
  Pyodide runtime). That is the whole of what the browser stores, too.
- **What compressed storage cost:** an earlier version kept the decompressed files in the cache and started in 0.6 s
  warm (1.0 s unthrottled). Keeping the 46.5 MB compressed instead of 229 MB makes every start 0.3–0.7 s slower, and the
  first visit's download 11.5 MB smaller than the quality-5 brotli a host would send (58 MB).
- Only about 8 MB of the site-packages bundle is dead weight (tests 6.6 MB, type stubs 1.5 MB), so trimming it
  would not change the picture. The bulk is scipy (41 MB), matplotlib (17) and numpy (11).
- An earlier unthrottled run against plain `vite preview` gave 2.8 s cold and 2.4 s warm for the snapshot, against
  5.8 s and 4.5 s. That server does not compress and the files were not cached, so those figures are not in the
  table or the chart.

## Making the files smaller

Measured on 2026-11-07 on the 136 MB heap image and the 93 MB bundle. Sizes are compressed, MB.

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

**Found** (the saving is at brotli 11 or 5 as marked). The first two are now build options, added 2026-11-07:

- **The heap holds a copy of every native library.** Emscripten keeps each `.so`'s bytes after `dlopen` (136 wasm
  headers in the 136 MB image), and the bundle has the same bytes. 135 of 136 buffers (30.5 MB) are byte-identical to
  their files. Zeroing them before the snapshot is taken: **26.5 to 22.1 MB** for the heap at brotli 11 (5.8 MB at
  brotli 5). The restore reads the libraries from the filesystem, so nothing needs the buffers. **Done:**
  `zeroLibraryCopies` in `snapshot.js`, called by `make-snapshot.mjs` on every build, zeroing only a buffer that is
  byte-identical to its file. The default (brotli 11) build with it has not been made or timed in a browser yet; the
  snapshots the correctness checks ran on have it.
- **Stripping docstrings** (`PYTHONOPTIMIZE=2`): with the libraries zeroed, **22.1 to 19.8 MB** more at brotli 11 (34.3
  to 30.7 MB at brotli 5 without the zeroing). It also removes `assert`s from every library. **Opt-in:**
  `SNAPSHOT_STRIP_DOCS=1 npm run snapshot` (recorded as `optimize: 2` in the manifest). Checked against the corpus,
  the probes and the Stata 14 cases: no failure that the unstripped normal boot does not also have (see
  [Correctness checks](#correctness-checks)). That is evidence for the code those checks reach, not a proof for all of
  it, so it stays opt-in.
- **Importing matplotlib costs the heap 4.5 MB** (26.1 to 30.6 MB at brotli 5, from the stage-by-stage build below), and
  its files cost 7.4 MB (matplotlib, pillow, fonttools, kiwisolver, contourpy and the rest, at brotli 5). Loading them
  on the first graph instead would cut about 12 MB from a first visit. It needs the bundle in two parts and a fetch
  at the first graph.
- **scipy cannot be trimmed much**: the corpus programs import 493 scipy modules, and the only subpackages never
  imported (`io`, `signal`, `cluster`, `odr`) are 4.1 MB of 40.8 MB raw.
- The combined heap (libraries zeroed and docstrings stripped) is about 19.8 MB against 26.5 MB, so the total would
  be about 40 MB against 46.5 MB.

**Tried, no gain:**

- **Zeroing the heap's free memory** before the snapshot: no large free blocks are left at that point (one 4 MB block),
  and filling the heap with small blocks only wrote allocator headers (the heap grew to 406 MB). 34.3 to 34.0 MB.
- **Trimming the bundle** (tests 6.6 MB and type stubs 1.5 MB raw): too small to be worth a build step. Not measured
  compressed.

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
one 32-bit numpy bug in `expand` and `stsplit` (ODT-29), 2 need packages Pyodide lacks (`xlwt`, `pyreadstat`), and 3
are numeric known-difference cases that exceed their tolerance under WebAssembly. **None is specific to the snapshot or to
stripping docstrings**, since the normal boot fails the same cases.

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
  decompresses, and **everything in the browser's caches adds up to between 10 and 80 MB** (it is 46.5 MB; this is the
  check that found the `.br` problem). Skipped without a snapshot. 5 of 5 pass in Chromium in 42 s.
- The test file now ends every worker it starts in an `after` hook. Before, a failing assertion skipped the
  `terminate()` at the end of its test and `npm test` hung with the worker alive.

## Not done, and risks

- **Not checked:** Firefox, WebKit and the iPhone profile; Break in the browser with a snapshot (it is tested in
  Node); files restored from IndexedDB with a snapshot start (the mount is the same code, but the e2e does not exercise
  it). The conformance corpus and the Stata 14 cases have been run on a snapshot-started engine, in Node; see
  [Correctness checks](#correctness-checks).
- **Browser memory** is higher: the heap image is 136 MB before anything runs, and during the start the compressed
  files (46.5 MB) and the decompressed ones (229 MB) are in memory together for a moment. Not measured on a phone.
- **A patched copy of Pyodide's loader.** It is generated from the installed Pyodide file, fails loudly if the text
  changes, and needs a rebuilt snapshot on every Pyodide upgrade. This relies on internals (`loadWebAssemblyModule`,
  `LDSO`, `wasmTable`) that Pyodide may change or fix. Check upstream for native-extension snapshot support before
  each upgrade.
- **`npm run build` copies `public/snapshot/`** (46.5 MB now) into `dist/` when it exists. The files are already
  compressed, so the host needs no brotli setting; it must not add a `Content-Encoding` of its own (the `.bin` names
  keep common servers from doing that).
- The snapshot build needs the network once, for openpyxl from PyPI, and takes about 3 minutes at brotli quality 11.
- **A new dependency**, `brotli-wasm` (Apache-2.0, 1 MB of wasm), for the decoder. The browser cannot decode brotli
  from script by itself.

## Recommendation

Keep it opt-in for now. It is a clear win for return visitors and fast connections, and a loss for a first visit
on a slow one. Ways to improve the first visit, in order of effort:

1. Check Firefox and WebKit, then decide whether to make it the default with a fallback to the normal boot.
2. Zero the library copies in the heap before the snapshot (4.4 MB less, measured, and nothing reads them), and test
   stripped docstrings against the corpus (2.3 MB more). See "Making the files smaller".
3. Load matplotlib and its dependencies on the first graph instead of in the snapshot (about 12 MB less for a first
   visit at brotli 5; about 9.7 MB at brotli 11, estimated). The first plot then pays about 0.9 s of mostly bytecode
   compiling unless `.pyc` files are shipped. Findings, conjectures and the plan to measure it are in the Phase 2
   plan: [Experiment: loading matplotlib lazily](phase2-plan.md#experiment-loading-matplotlib-lazily).
4. Import scipy and matplotlib lazily on the normal boot (about 2.6 s of the 6 s in Node), which helps first
   visits without a big download. Combine with the snapshot for return visits.
5. Start the worker on page load, in parallel with the editor.
