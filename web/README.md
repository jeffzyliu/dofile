# dofile web demo

The dofile engine running in the browser: a code editor, a file panel, Run and Break, the log and graphs. There is no
server. The engine is the same Python (`src/dofile/`, with the vendored OpenDTA) run by [Pyodide](https://pyodide.org)
(CPython compiled to WebAssembly) in a Web Worker. Your files live in the page's own store in IndexedDB, so they survive
a reload (data in memory does not) and the page can list, edit and download them with no engine; the worker copies them
into its `/work` folder when it starts and writes back what each run changed.

This is Phase 2 of the project; the plan, decisions and measurements are in [`../docs/phase2-plan.md`](../docs/phase2-plan.md).
The page is Preact with signals on the project's own CSS (`src/app/`); prototype 1 is being built to
[`../docs/design/SPEC.md`](../docs/design/SPEC.md) (status: [`../docs/prototype1-plan.md`](../docs/prototype1-plan.md)).

## Setup

Needs Node 26 and [uv](https://docs.astral.sh/uv/) (the scripts build the dofile wheel with `uv build`).

```bash
cd web
npm install        # `npm ci` for a clean install from the lockfile
```

## Scripts

Run them from `web/` with `npm run <name>`. Those that need the dofile wheel build it first (`npm run wheel`, which writes
`../dist/dofile-*.whl`).

### Develop and build

| Script | What it does |
|---|---|
| `dev` | Builds the wheel, then starts the Vite dev server (`--host`: on every network interface, so a phone on your LAN can open it at `http://<your computer's address>:5173`). The server sends the cross-origin isolation headers the Break button needs, but a plain-HTTP address on the LAN is not a secure context: the page is then not cross-origin isolated (Break restarts the engine) and the browser keeps no snapshot cache (every visit downloads it again). |
| `build` | Builds the wheel, then `vite build` into `web/dist/`. |
| `preview` | Serves `web/dist/` (what the e2e tests use), also with `--host`, on port 4173. Run `build` first. |
| `wheel` | Builds the dofile wheel into `../dist/`. `vite.config.ts` copies the newest one into `public/`. |
| `commands` | Regenerates `src/stata/commands.json` (the command names and abbreviations the highlighter knows) from the engine's registry. Run it after the engine's command set changes; CI fails if the committed file is stale. |
| `check` | Type-checks the TypeScript (`tsc --noEmit`). |

**All dev HTTP servers (`dev`, `preview`, `cf:dev`) listen on every network interface, for now**, so a phone on the LAN can test the page. Anyone on the same network can reach them; keep that in mind on a shared network, and keep any new dev server's script the same way (`--host` for Vite, `--ip 0.0.0.0` for Wrangler).

### Test

| Script | What it does | Time |
|---|---|---|
| `test` | `node --test test/`: the real `worker.js` in a Node worker thread with the built wheel, the client (Break, wait or reset, restart, the counted download), the file store on `fake-indexeddb` with and without an engine (`store.test.mjs`, `files.test.mjs`), the page's controllers on a stand-in client (`app.test.mjs`: the engine states, the tab lock, the streamed log), the linalg shim in the real WebAssembly numpy, and the snapshot's `inflate`/`unpack`. Builds the wheel first. `snapshot-native.test.mjs` is skipped unless a snapshot has been built. | ~70 s |
| `e2e` | Builds the snapshot and the page, then runs `e2e/` with Playwright in Chromium, Firefox, WebKit and an iPhone 15 profile (emulation). The tests start the page the default way, from the snapshot; one starts it with `?snapshot=0`. A missing snapshot fails them, it does not skip them. `SNAPSHOT_QUALITY=5` builds the snapshot in seconds instead of ~3 min (CI does). Run `npx playwright install` once. | ~2 min + the snapshot |

### Memory snapshot

The normal start installs the wheel and imports numpy, scipy and matplotlib: about 5 s on a fast machine. A snapshot is a
saved Pyodide heap with all that already done, so the page restores it instead. **That is the page's default start**;
`?snapshot=0` is the normal start. There is no fallback: with no snapshot (a fresh checkout under `npm run dev`) or a stale one, the
engine does not start and the page gives the cause (it does not name `?snapshot=0`, a diagnostic mode for developers). Why it works, how it is built and what it costs:
[`../docs/pyodide-snapshot.md`](../docs/pyodide-snapshot.md).

| Script | What it does | Time |
|---|---|---|
| `snapshot` | Builds the wheel, then `scripts/make-snapshot.mjs` writes `public/snapshot/` (gitignored): the heap image and the site-packages bundle, both brotli-compressed (about 42 MB; 229 MB uncompressed), plus a manifest. Needs the network once (micropip fetches openpyxl). **Rebuild it after any change to the dofile code, a wheel in `wheels/` or the Pyodide version**: the manifest (the snapshot's build record, not deployed) holds the wheels' SHA-256s and the Pyodide version, `vite build` fails on a stale snapshot, and in development the page refuses it ("run `npm run snapshot`"; `scripts/build-id.ts`). The snapshot is unpacked with the browser's own brotli decoder when it has one (much faster on an iPhone), else with brotli-wasm; `?brotli=wasm` forces the wasm decoder, to compare. Where the start and each run spent their time: the client's `startup`, a run's `timing`, and the worker's `[dofile] snapshot start` console line. `SNAPSHOT_OUT=dir` writes elsewhere; `SNAPSHOT_STRIP_DOCS=0` keeps docstrings and asserts. | |
| `check-snapshot` | Starts the engine from the snapshot, with the page's own restore code, and runs the conformance corpus, the probes, native-library calls and the Stata 14 reference cases, one process per case. `-- --normal` skips the snapshot (the baseline); `-- --cases a,b` picks cases. | ~4 min |

### Checks against CPython (by hand)

These compare the engine in Pyodide with the same code on CPython. They are slow and not part of CI.

| Script | What it does | Time |
|---|---|---|
| `check-pytest` | Runs OpenDTA's unit tests and dofile's `tests/test_engine.py` inside Pyodide, one process per file. `-- --ios` uses an iPhone user agent. Compare with CPython using `scripts/compare-pytest.mjs`. | ~2 min |
| `check-numeric` | Records `e()` and `r()` of all 98 Stata 14 programs at full precision inside Pyodide. The CPython side and `scripts/compare_numeric.py` (the diff) are described in the header of that file. | ~4 min |

The design checks run over the pages in `../docs/design/` (see `../docs/design/system/README.md`): `axe`
(accessibility), `tabwalk` (visible keyboard focus), `contrast` (every token pair the components use) and `fonts`
(every face loads; no text in a weight we don't ship).

`scripts/measure-startup.mjs` times the page's start (normal boot against snapshot, by network speed) in Chromium; it
writes `../docs/img/startup-times.json`.

## What is in each folder

| Path | Contents |
|---|---|
| `index.html`, `src/main.tsx`, `src/app/` | The editor page: Preact with signals. `src/app/state.js` is the state (SPEC section 8); `engine.js`, `run.js` and `files.js` are the controllers; `App.tsx` is the layout and lists which file holds each part; `ui/` has the dialog, menu, tablist, banner, toast and live region. `src/styles/app.css` is the page's layout on `ui.css`. |
| `src/engine/` | `store.js` is the file store (the `dofile` IndexedDB database: `info`, `data` and the `pending` journal; `FileStore` is the page's API, and `zip.js` writes "Download all (.zip)" for it). `worker.js` is the Web Worker that boots Pyodide, loads the wheel, copies the store into `/work` and runs code (`src/dofile/browser.py` is its Python side); after each run it writes what changed back to the store. `client.js` is the page's handle on it (`download`, `start`, `run`, `breakRun`, `keepWaiting`, `restart`, `stop`; a worker that does not stop is replaced, rc 9998). `tab.js` has the tab lock and `storage.persist()`. `snapshot.js` restores a snapshot, and is shared with the build script and the tests. The contract: `../docs/design/SPEC.md`, sections 6 and 7. |
| `src/stata/` | `language.ts` is the Stata syntax highlighter; `commands.json` is generated by `npm run commands`. |
| `src/styles/` | `tokens.css`, the design tokens (colors, type, spacing, light and dark), `ui.css`, the components (moved here from `docs/design/mockups/` on 2026-11-10), and the IBM Plex fonts with their license (`fonts/OFL.txt`). The one source for the page and the design pages in `../docs/design/` (which load them); the page doesn't use them yet (steps 6 and 8). |
| `scripts/` | The snapshot builder and the checks above (`make-snapshot.mjs`, `check-*.mjs`, `snapshot-node.ts`, `measure-startup.mjs`; `build-id.ts`, the build id and the stale-snapshot check), and the Python files the checks run (`numeric_probe.py`, `pytest_report.py`, `compare_numeric.py`). `start-files.ts` lists every file the snapshot start loads with its size on disk and its compressed size; the build writes that as `dist/start-files.json` (`node scripts/start-files.ts` prints it for the built page). |
| `test/` | The Node tests behind `npm test` (`store.test.mjs`: the store alone; `files.test.mjs`: the store with the real worker; `client.test.mjs`: the client with stand-in workers, fetch and Cache; `engine.test.mjs`: the worker's own ops and the snapshot start). `node-worker.mjs` runs `worker.js` in a worker thread; `harness.mjs` gives the tests that worker, with the file store either in the test's own thread (as a page and its worker share one database) or in the worker's. |
| `e2e/` | The Playwright tests. `poc.spec.ts`: four tests of the proof-of-concept page's editor (no rewrite of an unedited file, explicit Save, Save and a reload), marked fixme until step 6 rewrites them. `engine.spec.ts`: through the page's test hook, cross-origin isolation, Break through the real interrupt buffer, files kept across a reload and a reset, the .xls and ReadStat formats, the cached snapshot start (a reload with the start files cached shows no download prompt; with them deleted it asks again). `shell.spec.ts`: the app shell (layouts, theme, the ⋯ menu, the prompt's Not now and a run's way back to it), a stale snapshot refused with reason "updated", and the `?snapshot=0` start. `fixtures.ts`: the specs' shared `test`, with storage kept (no storage banner) unless a test turns it off, and `startEngine(page)`, which presses Download through the test hook when the page asks. `step2.spec.ts`: the tab lock between two pages, the counted download and a start from the cached bytes, a start without `download()` that writes nothing to the Cache, no request to another origin. |
| `wheels/` | Wheels the page and the scripts install after the dofile wheel: `pyreadstat` built for Pyodide (committed; the recipe and how to rebuild it are in its README). `scripts/install-engine.mjs` installs them in Node, as `worker.js` does in the page. |
| `public/` | Static files Vite serves. `snapshot/`, `pyodide/` (Pyodide's runtime, copied from the npm package by `vite.config.ts`) and the copied wheels are generated and gitignored. |
| `dist/` | Build output (gitignored). |

**One tab at a time.** The tab that holds the Web Lock `dofile-engine` owns the files and the engine; a second tab is asked
whether to take over, and the tab that loses the lock ends its engine. Web Locks need a secure context: over plain HTTP on a
LAN (`npm run dev` opened from a phone) there is no lock, and every tab owns the engine. The deployed site (HTTPS) is not
affected.

**The test hook.** With `?test` in the URL the page sets `window.__dofile = { engine, store, start, persisted, engineBytes }`
for the browser tests (`e2e/step2.spec.ts`); with `?test=manual` it also starts no engine until the test calls `start()`.
Without the flag there is no such object.

**The download size** shown before the engine is fetched is a number the build writes into `dist/index.html`
(`<meta name="dofile-engine-bytes">`, read by `engineBytes()` in `src/engine/client.js`): the compressed total of
`dist/start-files.json`. The dev server writes the same tag from `public/` (without the page's own files).

`vite.config.ts` sets the cross-origin isolation headers (`COOP`/`COEP`) in the dev and preview servers. They give the page a
`SharedArrayBuffer`, which Break needs; **a static host must send the same two headers**. Without them Break can only restart
the engine. The snapshot start takes Pyodide's runtime (`pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`) from the
page's own origin (`public/pyodide/`), so it asks nothing of another origin; `?snapshot=0` loads the runtime and the packages
from the jsDelivr CDN, at the same version as the `pyodide` npm package.

## Cloudflare Workers (static assets)

`wrangler.jsonc` serves `dist/` as static assets; `public/_headers` (copied into `dist/`) sends the two isolation headers.
`npx wrangler login` once, then `npm run cf:dev` (local, workerd) or `npm run deploy`. Both build the snapshot first (the page
starts from it by default, and `public/snapshot/` is gitignored, so a page built without one would not start). Each asset must
be under 25 MiB; the two snapshot files are about 20 MB, so they fit with little room to spare. `deploy.yml` fails the job when any file in `dist/` is over 25 MiB and warns over 23 MiB, because the brotli-11 snapshot is built only there.

`.github/workflows/deploy.yml` deploys on every push to `main` (and by hand). It builds the snapshot too, cached on a hash of its
inputs, and needs the repo secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

## CI

`.github/workflows/web.yml` runs three jobs on every pull request. A push to `main` runs only the first (the fast one), and it can be started by hand:

- **types, unit tests, build:** `npm run check`, a check that `commands.json` is up to date, `npm test`, `npm run build`.
- **browsers:** `npm run e2e` (Chromium, Firefox, WebKit, iPhone profile) on Ubuntu; Playwright's results are kept as an
  artifact on failure.
- **memory snapshot:** `npm run snapshot`, then `npm test` (so the native-library test runs) and `npm run check-snapshot`.

`check-pytest` and `check-numeric` are run by hand. The Python suite is `.github/workflows/ci.yml`.
