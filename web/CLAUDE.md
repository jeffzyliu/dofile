# CLAUDE.md (web/)

Loaded when work touches `web/`, the web demo: the engine in Pyodide inside a Web Worker, and a page on top of it. The root
`CLAUDE.md` still applies. What each script and folder does, with times: `web/README.md`. The plan and decisions:
`docs/phase2-plan.md`. The build plan and status of prototype 1: `docs/prototype1-plan.md` (read it first when picking that work up). The rework of the engine code (step 3.5, done
and merged with step 3 by pull request #13): `docs/prototype1-step3.5-plan.md`; the state machine's design:
`docs/prototype1-step3.5-c-design.md`. Biome was added after step 3.5, in the same pull request (`docs/formatting-proposal.md`). How data flows through the engine code, as built: `docs/web-engine-data-flow.md`; the editor page's focus, runs, open files and log links: `docs/web-page-flows.md`.
The build spec for the pages: `docs/design/SPEC.md` (section 5 holds the machine's transition matrix, which a test checks).

## Commands

Run from `web/` (`npm install` once). The wheel is rebuilt by the scripts that need it.

```bash
npm test                  # the engine in Pyodide under Node, the file store, the client, the page's controllers (~70 s)
npm run dev               # the site on the LAN too: the landing page at /, the editor at /app/
npm run e2e               # builds the snapshot and the page, then Chromium, Firefox, WebKit, iPhone profile (`npx playwright install` once; SNAPSHOT_QUALITY=5 builds the snapshot in seconds instead of ~3 min; E2E_PORT=4181 serves the build on another port than 4173, for a second worktree)
npm run snapshot          # the Pyodide memory snapshot the page starts from; `npm run dev` needs it once, and again after a change to the engine
npm run check-snapshot [-- --normal]   # corpus, probes, native calls and the 97 Stata 14 cases inside Pyodide (~4 min; --normal: no snapshot; --cases a,b)
npm run check-numeric     # e()/r() of all 98 Stata 14 programs at full precision (~4 min; the diff: header of scripts/compare_numeric.py)
npm run check-pytest [-- --ios]        # OpenDTA's unit tests inside Pyodide (~2 min; --ios: an iPhone user agent, so Pyodide creates no trampoline; compare with CPython: scripts/compare-pytest.mjs)
npm run check             # Biome (format, import order, lint errors), then TypeScript
npm run format            # Biome: fix the layout and the import order, apply the safe lint fixes
npm run lint:strict       # Biome as CI runs it: warnings fail too (npm run lint: the findings only)
npm run axe | tabwalk | contrast | fonts   # the design checks over docs/design/ (the mockups, from file: URLs)
npm run sample            # the sample's data (uv run python sample/make_sample.py) and src/app/sample-files.ts
```

## Rules

- **Biome formats and lints `web/`** (`biome.json`: width 120, the recommended rules less six; version pinned exactly;
  decisions in `docs/formatting-proposal.md`). A lint **error** fails `npm run check` and a build, and in `npm run dev` opens
  a panel over the page (`vite-plugin-checker` in `vite.config.ts`, again on each change); a **warning** is only listed
  there, and fails CI (`web ok`) and `npm run deploy`. So fix or ignore every finding before a commit that is to be
  merged: `// biome-ignore lint/<group>/<rule>: <reason>`, always with the reason. Run `npm run format` at the end of a
  task or before a commit, not after every edit. `src/stata/commands.json` is generated and not formatted. A
  `// @ts-expect-error` covers one line: if Biome would split the statement under it, put a `// biome-ignore format:`
  line above. The tests that read source text (`test/imports.test.ts`) must not depend on how a line is wrapped.
- **The page is Preact with signals, in `src/app/`** (`src/main.tsx` wires it). The state is one module of signals,
  `src/app/state.ts` (SPEC section 8; types in `src/app/types.ts`); a signal with one owner is exported
  `ReadonlySignal`, so a view that assigns one fails `npm run check`, and the others (`tabs`, `activeTab`, `dialog`,
  `split`, `outputTab`, `phoneTab`, `graphIndex`, `graphFull`, `pickedVar`, `theme`, `layout`, `isolated`) are plain
  signals that views write. The controllers own most of them and are `.ts` files that
  import no `.tsx`, tested in Node (`test/app.test.ts`): `engine.ts` (the only caller of the state machine, below; the tab
  lock; asking at load unless `client.cached()` finds this build's start files all in the Cache; there is no "downloaded"
  flag), `run.ts` (runs, the log, results, graphs, the after-run calls; it reads no engine state, the engine controller tells
  it through the handlers given to `connectRun`), `files.ts` (the file list, `persisted`), `start.ts` ("Start engine": with no engine nothing on the page offers to
  run; `startOffer` is the one table of which states are "no engine" and what a press does in each, `startEngine()` the one
  action of the Run buttons and Ctrl/Cmd+Enter then, and a control that runs code is off while `noEngine()`: the table is in
  `docs/web-page-flows.md`, section 2). Views read signals and call the
  controllers' actions; they never call the transport or the machine. Each step 4 part has its own files, which `App.tsx` only places (its header lists
  them; each phone piece sits there next to its desktop counterpart, and components read `isPhone` rather than a `phone` prop); dialogs and banners are drawn through the registries `dialogs.tsx` and `banners.tsx`, one view per kind. The
  shared pieces are in `src/app/ui/`: `Dialog` (native `<dialog>`, a bottom sheet under 700 px), `Menu` (`MenuButton`,
  `openMenu`; an item with `keepOpen` leaves the menu open), `Tablist`, `Live` (the live region `say()`, the toast `showToast()` and `Banner`), `Icon` (and `Key`), `Labels` (a control's
  labels in one cell, so the toolbar never changes size; keep labels short, the widest sets the width). Toolbar buttons
  share one height (`--control` in `tokens.css`), a pane head's controls another (`--control-sm`). `src/app/viewport.ts` sizes the page to the area above a phone's
  on-screen keyboard. For an experiment on a real iPhone (`docs/phone-keyboard-experiment.md`), `?kb=transform|height|unpan|pre|focus`
  picks another way to follow the keyboard (`<html data-kb>`), `?slide` eases `.app` to its place and `?kblog` loads an overlay
  of the viewport's events (`src/app/kblog.ts`, imported only with the flag); without them the page is as before (`top`).
  `src/app/wakelock.ts` keeps the screen awake (Screen Wake Lock) while the engine
  is working, by one table over the state names (`WAKE_LOCK`) that it reads from the `engine` signal.
- **One state machine decides the engine's state: `src/engine/machine.ts`.** `transition(machine, event)` is a pure function
  (only type imports, no clock, timer, console or variable at the top level; the time comes in the event) that gives the next
  state and the effects to perform. Its sixteen state names are the `engine` signal's, `<html data-engine>`'s and SPEC section
  5's. **Nothing outside it decides a state**: no counter, flag or comparison of state names in the transport, the
  controllers or a view (a test greps for the old ones). To add a state, an event or an effect, change the tables there; the
  compiler (exhaustive `switch`es, the `Answers` map) and `test/machine.test.ts` (every state by every event, the properties,
  the race scenarios) then say what else must follow. SPEC section 5's transition matrix is generated from the machine and a
  test compares the two: after a change to a cell, run `PRINT_SPEC_MATRIX=1 node --test test/machine.test.ts` and paste the
  tables into SPEC section 5.
- **Who constructs, who connects, who decides.** `src/main.tsx` is the only module that makes the transport
  (`EngineClient`, `src/engine/client.ts`) and the tab lock and calls `connectFiles`, `connectRun`, `connectEngine` and
  `open()`. The transport decides nothing: it creates and ends the worker, numbers calls, holds the interrupt buffer and the
  Cache; its interface is `Reader` (`query`, the read ops), `Lifecycle` (`start`, `end`, `run`, `interrupt`, held only by
  the effect performer) and `Builds` (`cached`, `download`, `build`, `forgetDownload`). The controller (`src/app/engine.ts`)
  feeds events in, performs effects, and writes the `engine` signal from the machine's state. A new failure path that needs a
  decision becomes an event, not a flag.
- **Tickets and the drop record.** Each asynchronous request (the lock, the cache check, the download, the list fetch, each
  worker, each take-over) gets a `Ticket` from the machine; an answer presents it, and the machine drops an answer whose
  ticket is not the state's current one. Performers never write a ticket: they answer through a `reply` bound to their
  effect. Every event that changed nothing, stale or not valid in its state, is recorded (`drops()`, also in the test hook).
- **`test/imports.test.ts` holds what no type can.** It checks the source text and the import graph: no view reaches
  `client.ts` or `worker.ts`; no `.tsx` imports the machine or `main.tsx`; `engine/` never imports `app/`; the controller takes
  only types from `client.ts`; `machine.ts` is pure and has two casts; the cast to `Ticket` occurs once in `web/`; events enter
  the controller through two doors and `transition()` is called once; the worker is posted to in one place (`#send`); only
  `main.tsx` constructs or connects (and the store is opened once on each thread); each signal has one writer; the old
  counters and flags are gone. A rule that breaks one fails `npm test`; fix the code, not the test, unless the rule has changed.
- **The engine's types are in `src/engine/types.ts`** (SPEC section 6). Everything in `src/engine/`, the controllers
  and `test/` is TypeScript with real annotations (no JSDoc types). Node runs these `.ts` files as they are, by
  removing the types, so: imports spell the `.ts` extension, and only syntax that can be erased is allowed (no `enum`,
  no `namespace`, no constructor parameter properties; `npm run check` enforces it). Keep the types and the spec in step.
- **The test hook stays, behind a flag.** With `?test` in the URL the page sets `window.__dofile = {engine, store, start,
  persisted, engineBytes, state, run, breakRun, reset, selection, drops}` (the transport, the store, the controller's start,
  persisted(), the download size, the signals, a run through the controller, the controller's Break and Reset, the editor's
  `selection` signal, the drop record); with `?test=manual` it starts no engine until the test calls
  `start()`. Without the flag the object does not exist. The store is blocked until the tab lock answers: a test waits
  for `!store.blocked` before it writes. `<html data-engine>` always holds the engine's state name. The e2e tests use
  both; the four tests left in `e2e/poc.spec.ts` (the proof-of-concept editor's) are marked fixme until step 6 rewrites them.
- **The e2e specs import `test` and `expect` from `e2e/fixtures.ts`**, not from `@playwright/test`. Its fixture makes
  `storage.persisted()` and `persist()` answer true in every page of the test's context, so the storage banner (S 19) does
  not show in every run; `test.use({ persisted: false })` (in a file or a `describe`) gives the browser's own answers, and
  `keepFiles(context)` covers a context the test makes itself (`launchPersistentContext`). The `page` fixture also retries a `goto` once when it times out on a fresh page still at `about:blank` (WebKit on Linux CI cancels a first navigation now and then); a page the test opens itself gets `retryFirstGoto(page)`.
- **Dev servers listen on all interfaces**, so LAN devices (a phone) can connect, for now. All dev HTTP servers (`dev`,
  `preview`, `cf:dev`) keep `--host` / `--ip 0.0.0.0` in their scripts; give any new dev server the same.
- **The snapshot is the page's default start and there is no fallback.** `?snapshot=0` is the normal boot, a diagnostic mode for
  developers. A missing or stale snapshot is an error: the engine is `failed` (a stale one has reason "updated" and says to
  reload the page). Its `message` is plain words for the visitor, one per reason (`app/engine.ts` `FAILED`); the cause,
  `npm run snapshot` and all, is its `detail` and goes to the console. Nothing the page shows names `?snapshot=0`. An automatic fallback to the normal boot
  when the snapshot fails is a possible later step, not built. Rebuild it (`npm run snapshot`) after a change to the dofile code, a wheel or the
  Pyodide version: its `manifest.json` (the build record, not deployed) holds the wheels' SHA-256s and the Pyodide version,
  `vite build` fails on a snapshot of other inputs, and in development the page says `updated`. The build id
  (`scripts/build-id.ts`) covers a per-build stamp, the wheels and Pyodide: the page compiles in its own and
  `start-files.json` carries the list's. The e2e tests and `npm run deploy` build the snapshot first, and the deploy workflow
  rebuilds it before `vite build` when `node scripts/build-id.ts` says the cached one is stale.
- **The snapshot's loader is a patched copy of Pyodide's** that re-links the native libraries. The patch throws if Pyodide's
  loader text changes: a Pyodide upgrade needs the patch updated. The two big files are unpacked with the browser's own brotli
  decoder when it has one, else brotli-wasm. See `docs/pyodide-snapshot.md`.
- **The files live in dofile's own store, not in the worker.** `src/engine/store.ts` (IndexedDB database `dofile`: `info`,
  `data`, `pending`) is the one place a file is kept. The page reads and writes it directly (`FileStore`), with no engine,
  during a run and after a failed start. `/work` in the worker is a plain in-memory copy: there is no IDBFS. **The journal is
  the only way a page change reaches `/work`:** the store writes the records and a `pending` row in one transaction, then the
  transport posts the one op `sync`, which carries nothing; the worker reads the journal, takes the store's version of those
  paths, clears it, and puts that version into `/work`. The worker also copies the store at `mount` and, after each run,
  writes what the run changed in the same transaction that takes the journal (`applyRun`). No seq, no message order, nothing
  applied twice. Never write a file through the worker alone: `files` and `read` are views of `/work` for the tests. A run's
  changes are found by **modification time and size**: the worker waits until the clock is past the newest file before the
  run, which makes the time enough for any write of one byte or more, and the size catches a truncation, which Pyodide's file
  system does not stamp with a time (`test/files.test.ts`, "a run that empties a file"). Do not drop either. Contract and
  tests: `docs/design/SPEC.md`, section 7.
- **One tab owns the files and the engine**: the Web Lock `dofile-engine` (`src/engine/tab.ts`). A tab without it starts no
  worker and writes nothing (`store.blocked`). Without Web Locks (plain HTTP on a LAN) every tab owns them.
- **The snapshot start takes Pyodide's runtime from the page's own origin.** `vite.config.ts` copies three files from the
  `pyodide` npm package into `public/pyodide/` (gitignored). `?snapshot=0` keeps the CDN. The build writes
  `dist/app/start-files.json` (every start file with its size on disk and its compressed size: `scripts/start-files.ts`) and
  the compressed total into `dist/app/index.html` (`<meta name="dofile-engine-bytes">`, which the page reads as `engineBytes`:
  the size is there before any request); it fails if it cannot. The page's `download()` fills the Cache `dofile-snapshot-<built>` from that list, and the worker reads the same Cache for
  everything while it starts (a cache-first `fetch`, the loader from a `blob:` URL): `docs/pyodide-snapshot.md`, "The start
  since prototype 1". `download()` is the Cache's only writer (it checks each file's size against the list); the worker
  never writes it.
- **Errors from `client.ts` carry a `kind`** (its header lists them); the worker answers `{id, error, name}`. Keep both when
  adding a failure path: the page decides what to show from them, not from the text. A snapshot that cannot be used
  throws a named error in the worker (`DownloadError`, `SnapshotError`): the transport turns it into the event's `reason`, never
  by the text. Another build of the site is `kind: "updated"`, from the transport's `checkBuild` (the build id; in `download()`
  and in `build()`, which a restart calls before any worker is made); the worker fetches no `manifest.json` and compares no
  build, and neither does the page at start: `start-files.json` is the one statement of the build.
- **`vite.config.ts` builds the Web Worker as one file** (`inlineDynamicImports`). A chunk that imports the worker's entry made
  iOS Safari run the entry twice (a `V.loadPackage` error with a snapshot start); see `docs/pyodide-snapshot.md`, "Debugging an
  iPhone 13".
- **No pandas in the page, so `export sasxport` is refused there (rc 199, ODT-32).** Cases 1701 and 1911 are `EXPECTED_DIFFER`
  in `scripts/check-snapshot.mjs` for that, a strict xfail; `--normal --pandas` runs them with pandas to prove they match
  otherwise. `xlwt` and `xlrd` are core dependencies of dofile, so the CLI, MCP server and page all do `.xls`.
- **`wheels/`** holds wheels the page and the web scripts install after the dofile wheel: `pyreadstat` built for Pyodide (no
  upstream build; committed so CI and a fresh checkout need no Emscripten build, a choice rather than a limit; rebuild with
  `sh web/wheels/pyreadstat/build.sh`, see its README). `scripts/install-engine.ts` installs them in Node as `worker.ts` does
  in the page.

- **The site's addresses: the landing page is `/`, the commands page `/commands/`, the editor a single-page app under
  `/app/`.** The editor's location is ONE setting, `scripts/urls.ts` (`EDITOR_BASE`, and `EDITOR_URL`/`SITE_URL` for links
  across origins); everything of the editor's goes through `import.meta.env.BASE_URL` (`main.tsx`) or `LANDING_URL`
  (`app/env.ts`), and `test/site.test.ts` fails if another source (CSS and JSON too), script, e2e test, config, page or
  workflow spells the editor's path after a quote, a backquote, `(` or `=`. Never write a root-absolute path to an editor file,
  nor one joined from pieces. Another path on the same origin is a change of `EDITOR_BASE` alone (the tests compare with the
  setting). Its own subdomain later is two builds into two folders (the editor with `DOFILE_EDITOR_BASE=/` and `--outDir`, the
  pages with `DOFILE_EDITOR_URL`, `DOFILE_EDITOR_DIR` and `--outDir`; both builds follow `--outDir`, and the pages' build
  refuses the editor's folder) plus hand edits to the Wrangler configs, `package.json`, `deploy.yml` and the e2e setup: the
  exact list, and what does not follow the editor to a new origin (the stored files, the downloaded engine, the sample's mark,
  the theme), is in `docs/design/SPEC.md`, section 8, "URLs". `npm run build` is two builds:
  `vite build` (the editor into `dist/app/`, emptying `dist/` first) and `vite build --mode site` (the landing and commands
  pages into `dist/index.html` and `dist/commands/index.html`, their own assets in `dist/assets/`, and `dist/_headers`, which
  isolates `/app/*` only; `public/` has no `_headers`). `vite preview` serves all of `dist/` as the host does; the dev server
  is the editor's with the two pages added at `/` and `/commands/`. The e2e `baseURL` ends in `/app/`: `goto("?test")` is the
  editor, `goto("/")` the landing page. A missing page is a 404 everywhere (`appType: "mpa"`; `not_found_handling: "none"`).
- **The landing and commands pages (step 5) are static HTML** (`landing.html`, `commands.html`; the editor is `index.html`).
  Their code is `src/site/` and imports only `src/site/` and the stylesheets, CSS `@import`s included, and the editor's
  `index.html` loads none of it (`test/imports.test.ts`): no signals, no store, no
  tab lock, and no module-preload polyfill. The build fills `{{version}}`, `{{engine-mb}}`, `{{editor-url}}` and the commands list
  into them (`scripts/site-pages.ts`; the commands come from `src/stata/commands.json`, `npm run commands`); an unknown token
  fails `test/site.test.ts`, and the e2e tests check the served pages have none left. With scripts off both are complete (the
  Copy, theme and filter controls are hidden until their script runs). The sample project is `sample/` (do-files, and `data/wages.dta` made by `sample/make_sample.py`
  with a fixed seed); `npm run sample` rebuilds the data and the generated `src/app/sample-files.ts` that the page loads
  (`src/app/sample.ts`; a test fails when that file is stale). Under `?test` the first-visit sample is off unless the URL has `?sample`.

## Python files the page runs (in `src/dofile/`, web demo only)

- `browser.py`: what `src/engine/worker.ts` calls through Pyodide: one Engine in `/work`, JSON text in and out, only
  `shell`/`webuse` denied, Break through a SIGINT handler (Pyodide's interrupt buffer). `src/engine/client.ts` is the page's
  side (the interrupt buffer; a reset, decided by the machine, gives rc 9998).
- `pathshim.py`: through PATCH-3's hook (`core/userpath.py`) it maps file names written for someone's computer into one working
  folder and replaces `cd`. The CLI and MCP server never install it.
- `linalgshim.py`: numpy's `inv`, `solve` and `cholesky` return NaN instead of raising `LinAlgError` in Pyodide;
  `browser.start()` installs wrappers that raise (it probes first, so it is a no-op on CPython). The engine depends on that
  exception in about 100 places. Tests: `tests/test_linalgshim.py`, `web/test/linalgshim.test.ts`.
