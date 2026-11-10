# CLAUDE.md (web/)

Loaded when work touches `web/`, the web demo: the engine in Pyodide inside a Web Worker, and a page on top of it. The root
`CLAUDE.md` still applies. What each script and folder does, with times: `web/README.md`. The plan and decisions:
`docs/phase2-plan.md`. The build plan and status of prototype 1: `docs/prototype1-plan.md` (read it first when picking that work up).
The build spec for the pages: `docs/design/SPEC.md`.

## Commands

Run from `web/` (`npm install` once). The wheel is rebuilt by the scripts that need it.

```bash
npm test                  # the engine in Pyodide under Node, the file store, the client (~45 s)
npm run dev               # the page, on the LAN too
npm run e2e               # builds the snapshot and the page, then Chromium, Firefox, WebKit, iPhone profile (`npx playwright install` once; SNAPSHOT_QUALITY=5 builds the snapshot in seconds instead of ~3 min)
npm run snapshot          # the Pyodide memory snapshot the page starts from; `npm run dev` needs it once, and again after a change to the engine
npm run check-snapshot [-- --normal]   # corpus, probes, native calls and the 97 Stata 14 cases inside Pyodide (~4 min; --normal: no snapshot; --cases a,b)
npm run check-numeric     # e()/r() of all 98 Stata 14 programs at full precision (~4 min; the diff: header of scripts/compare_numeric.py)
npm run check-pytest [-- --ios]        # OpenDTA's unit tests inside Pyodide (~2 min; --ios: an iPhone user agent, so Pyodide creates no trampoline; compare with CPython: scripts/compare-pytest.mjs)
npm run check             # TypeScript
npm run axe | tabwalk | contrast | fonts   # the design checks over docs/design/
```

## Rules

- **Dev servers listen on all interfaces**, so LAN devices (a phone) can connect, for now. All dev HTTP servers (`dev`,
  `preview`, `cf:dev`) keep `--host` / `--ip 0.0.0.0` in their scripts; give any new dev server the same.
- **The snapshot is the page's default start and there is no fallback.** `?snapshot=0` is the normal boot. A missing or stale
  snapshot is an error that names `?snapshot=0`. Rebuild it (`npm run snapshot`) after a change to the dofile code, a wheel or the
  Pyodide version: the manifest holds the wheel's SHA-256 and the page refuses a snapshot of another build. The e2e tests and
  `npm run deploy` build it first, and the deploy workflow builds it before `vite build`.
- **The snapshot's loader is a patched copy of Pyodide's** that re-links the native libraries. The patch throws if Pyodide's
  loader text changes: a Pyodide upgrade needs the patch updated. The two big files are unpacked with the browser's own brotli
  decoder when it has one, else brotli-wasm. See `docs/pyodide-snapshot.md`.
- **The files live in dofile's own store, not in the worker.** `src/engine/store.js` (IndexedDB database `dofile`: `info`,
  `data`, `pending`) is the one place a file is kept. The page reads and writes it directly (`FileStore`), with no engine,
  during a run and after a failed start. `/work` in the worker is a plain in-memory copy: there is no IDBFS. A page change
  goes **store first** (the records and a `pending` row in one transaction), then the op with that row's seq, which the
  worker mirrors into `/work`. The worker copies from the store at `mount` and after each run (`applyRun`, which also writes
  what the run changed); each copy returns the highest seq it covers (`upTo`), and the worker ignores the ops up to it, so
  no change is applied twice. Never write a file through the worker alone: its `write`/`remove`/`rename`/`mkdir` ops only
  mirror, and `files`/`read` are views of `/work` for the tests. Contract and tests: `docs/design/SPEC.md`, section 7.
- **One tab owns the files and the engine**: the Web Lock `dofile-engine` (`src/engine/tab.js`). A tab without it starts no
  worker and writes nothing (`store.blocked`). Without Web Locks (plain HTTP on a LAN) every tab owns them.
- **The snapshot start takes Pyodide's runtime from the page's own origin.** `vite.config.ts` copies three files from the
  `pyodide` npm package into `public/pyodide/` (gitignored). `?snapshot=0` keeps the CDN. The build writes
  `dist/start-files.json` (every start file with its size on disk and its compressed size: `scripts/start-files.mjs`) and
  the compressed total into `dist/index.html` (`<meta name="dofile-engine-bytes">`); it fails if it cannot. The page's
  `download()` fills the Cache `dofile-snapshot-<built>` from that list, and the worker reads the same Cache for
  everything while it starts (a cache-first `fetch`, the loader from a `blob:` URL): `docs/pyodide-snapshot.md`, "The start
  since prototype 1". `download()` is the Cache's only writer (it checks each file's size against the list); the worker
  never writes it.
- **Errors from `client.js` carry a `kind`** (its header lists them); the worker answers `{id, error, name}`. Keep both when
  adding a failure path: the page decides what to show from them, not from the text.
- **`vite.config.ts` builds the Web Worker as one file** (`inlineDynamicImports`). A chunk that imports the worker's entry made
  iOS Safari run the entry twice (a `V.loadPackage` error with a snapshot start); see `docs/pyodide-snapshot.md`, "Debugging an
  iPhone 13".
- **No pandas in the page, so `export sasxport` is refused there (rc 199, ODT-32).** Cases 1701 and 1911 are `EXPECTED_DIFFER`
  in `scripts/check-snapshot.mjs` for that, a strict xfail; `--normal --pandas` runs them with pandas to prove they match
  otherwise. `xlwt` and `xlrd` are core dependencies of dofile, so the CLI, MCP server and page all do `.xls`.
- **`wheels/`** holds wheels the page and the web scripts install after the dofile wheel: `pyreadstat` built for Pyodide (no
  upstream build; committed so CI and a fresh checkout need no Emscripten build, a choice rather than a limit; rebuild with
  `sh web/wheels/pyreadstat/build.sh`, see its README). `scripts/install-engine.mjs` installs them in Node as `worker.js` does
  in the page.

## Python files the page runs (in `src/dofile/`, web demo only)

- `browser.py`: what `src/engine/worker.js` calls through Pyodide: one Engine in `/work`, JSON text in and out, only
  `shell`/`webuse` denied, Break through a SIGINT handler (Pyodide's interrupt buffer). `src/engine/client.js` is the page's
  side (Break, restart = rc 9998).
- `pathshim.py`: through PATCH-3's hook (`core/userpath.py`) it maps file names written for someone's computer into one working
  folder and replaces `cd`. The CLI and MCP server never install it.
- `linalgshim.py`: numpy's `inv`, `solve` and `cholesky` return NaN instead of raising `LinAlgError` in Pyodide;
  `browser.start()` installs wrappers that raise (it probes first, so it is a no-op on CPython). The engine depends on that
  exception in about 100 places. Tests: `tests/test_linalgshim.py`, `web/test/linalgshim.test.mjs`.
