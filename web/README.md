# dofile web demo

The dofile engine running in the browser: a code editor, a file panel, Run and Break, the log and graphs. There is no
server. The engine is the same Python (`src/dofile/`, with the vendored OpenDTA) run by [Pyodide](https://pyodide.org)
(CPython compiled to WebAssembly) in a Web Worker. Files you open live in the worker's `/work` folder and are saved to
IndexedDB, so they survive a reload (data in memory does not).

This is Phase 2 of the project; the plan, decisions and measurements are in [`../docs/phase2-plan.md`](../docs/phase2-plan.md).
It is a proof-of-concept page: no framework yet.

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
| `test` | `node --test test/`: the real `worker.js` in a Node worker thread with the built wheel, the client (Break, restart), the linalg shim in the real WebAssembly numpy, and the snapshot's `inflate`/`unpack`. Builds the wheel first. `snapshot-native.test.mjs` is skipped unless a snapshot has been built. | ~30 s |
| `e2e` | Builds the snapshot and the page, then runs `e2e/` with Playwright in Chromium, Firefox, WebKit and an iPhone 15 profile (emulation). The tests start the page the default way, from the snapshot; one starts it with `?snapshot=0`. A missing snapshot fails them, it does not skip them. `SNAPSHOT_QUALITY=5` builds the snapshot in seconds instead of ~3 min (CI does). Run `npx playwright install` once. | ~1 min + the snapshot |

### Memory snapshot

The normal start installs the wheel and imports numpy, scipy and matplotlib: about 5 s on a fast machine. A snapshot is a
saved Pyodide heap with all that already done, so the page restores it instead. **That is the page's default start**;
`?snapshot=0` is the normal start. There is no fallback: with no snapshot (a fresh checkout under `npm run dev`) or a stale one, the
status line says so and names `?snapshot=0`. Why it works, how it is built and what it costs:
[`../docs/pyodide-snapshot.md`](../docs/pyodide-snapshot.md).

| Script | What it does | Time |
|---|---|---|
| `snapshot` | Builds the wheel, then `scripts/make-snapshot.mjs` writes `public/snapshot/` (gitignored): the heap image and the site-packages bundle, both brotli-compressed (about 40 MB; 229 MB uncompressed), plus a manifest. Needs the network once (micropip fetches openpyxl). **Rebuild it after any change to the dofile code or the Pyodide version**: the manifest holds a SHA-256 of the wheel, and the page refuses a snapshot built from a different build ("run `npm run snapshot` again"). The snapshot is unpacked with the browser's own brotli decoder when it has one (much faster on an iPhone), else with brotli-wasm; `?brotli=wasm` forces the wasm decoder, to compare. The status line shows where the start and each run spent their time. `SNAPSHOT_OUT=dir` writes elsewhere; `SNAPSHOT_STRIP_DOCS=0` keeps docstrings and asserts. | |
| `check-snapshot` | Starts the engine from the snapshot, with the page's own restore code, and runs the conformance corpus, the probes, native-library calls and the Stata 14 reference cases, one process per case. `-- --normal` skips the snapshot (the baseline); `-- --cases a,b` picks cases. | ~4 min |

### Checks against CPython (by hand)

These compare the engine in Pyodide with the same code on CPython. They are slow and not part of CI.

| Script | What it does | Time |
|---|---|---|
| `check-pytest` | Runs OpenDTA's unit tests and dofile's `tests/test_engine.py` inside Pyodide, one process per file. `-- --ios` uses an iPhone user agent. Compare with CPython using `scripts/compare-pytest.mjs`. | ~2 min |
| `check-numeric` | Records `e()` and `r()` of all 98 Stata 14 programs at full precision inside Pyodide. The CPython side and `scripts/compare_numeric.py` (the diff) are described in the header of that file. | ~4 min |

`scripts/measure-startup.mjs` times the page's start (normal boot against snapshot, by network speed) in Chromium; it
writes `../docs/img/startup-times.json`.

## What is in each folder

| Path | Contents |
|---|---|
| `index.html`, `src/main.ts` | The page: CodeMirror editor, file panel, Run/Break, log and graph output. |
| `src/engine/` | `worker.js` is the Web Worker that boots Pyodide, loads the wheel and runs code (`src/dofile/browser.py` is its Python side). `client.js` is the page's handle on it (`run`, `breakRun`, `restart`; a worker that does not stop is replaced, rc 9998). `snapshot.js` restores a snapshot, and is shared with the build script and the tests. |
| `src/stata/` | `language.ts` is the Stata syntax highlighter; `commands.json` is generated by `npm run commands`. |
| `scripts/` | The snapshot builder and the checks above (`make-snapshot.mjs`, `check-*.mjs`, `snapshot-node.mjs`, `measure-startup.mjs`), and the Python files the checks run (`numeric_probe.py`, `pytest_report.py`, `compare_numeric.py`). |
| `test/` | The Node tests behind `npm test`. `node-worker.mjs` runs `worker.js` in a worker thread with an in-memory IndexedDB. |
| `e2e/` | The Playwright test (`poc.spec.ts`): cross-origin isolation, Break through the real interrupt buffer, files kept across a reload. |
| `public/` | Static files Vite serves. `snapshot/` and the copied wheel are generated and gitignored. |
| `spike/` | The Phase 2 spikes (Pyodide loading, the snapshot) with their own `package.json`, kept for the numbers. Not used by the page. |
| `dist/` | Build output (gitignored). |

`vite.config.ts` sets the cross-origin isolation headers (`COOP`/`COEP`) in the dev and preview servers. They give the page a
`SharedArrayBuffer`, which Break needs; **a static host must send the same two headers**. Without them Break can only restart
the engine. Pyodide's runtime and packages are loaded from the jsDelivr CDN, at the same version as the `pyodide` npm package.

## Cloudflare Workers (static assets)

`wrangler.jsonc` serves `dist/` as static assets; `public/_headers` (copied into `dist/`) sends the two isolation headers.
`npx wrangler login` once, then `npm run cf:dev` (local, workerd) or `npm run deploy`. Both build the snapshot first (the page
starts from it by default, and `public/snapshot/` is gitignored, so a page built without one would not start). Each asset must
be under 25 MiB; the two snapshot files are about 20 MB, so they fit with little room to spare.

`.github/workflows/deploy.yml` deploys on every push to `main` (and by hand). It builds the snapshot too, cached on a hash of its
inputs, and needs the repo secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

## CI

`.github/workflows/web.yml` runs three jobs on every pull request. A push to `main` runs only the first (the fast one), and it can be started by hand:

- **types, unit tests, build:** `npm run check`, a check that `commands.json` is up to date, `npm test`, `npm run build`.
- **browsers:** `npm run e2e` (Chromium, Firefox, WebKit, iPhone profile) on Ubuntu; Playwright's results are kept as an
  artifact on failure.
- **memory snapshot:** `npm run snapshot`, then `npm test` (so the native-library test runs) and `npm run check-snapshot`.

`check-pytest` and `check-numeric` are run by hand. The Python suite is `.github/workflows/ci.yml`.
