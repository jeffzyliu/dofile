# CLAUDE.md (web/)

The web demo: the engine in Pyodide inside a Web Worker, and a Preact page on top of it. The root `CLAUDE.md` still
applies. Where to read:

- `web/README.md`: what each script and folder does, with times.
- `docs/phase2-plan.md`: the plan, its status and next steps (read it first when picking that work up).
- `docs/design/SPEC.md`: the build spec (section 5: the state machine; 6: the engine's types; 7: the file store; 8: the
  page state and URLs).
- `docs/web-engine-data-flow.md` (the engine code's data flow), `docs/web-page-flows.md` (the editor's focus, runs, open
  files, log links), `docs/pyodide-snapshot.md` (the snapshot), `docs/browser-engine.md` (gaps, the memory cap).

## Commands

Run from `web/` (`npm install` once). The scripts that need the dofile wheel rebuild it.

```bash
npm test                  # the engine in Pyodide under Node, the file store, the client, the controllers (~70 s)
npm run dev               # two dev servers, on the LAN too: the editor on 5173, the landing and commands pages on 5174
                          #   (prints a warning first when the snapshot is stale; `npm run snapshot` fixes it)
npm run e2e               # the snapshot, `build:local`, then Chromium, Firefox, WebKit, iPhone (`npx playwright install` once;
                          #   SNAPSHOT_QUALITY=5: the snapshot in seconds; E2E_PORT=4181: ports 4181/4182, not 4173/4174)
npm run shots:baseline -- <commit>   # N7, the screenshot run (outside e2e and CI): builds the commit in a worktree of its own
                          #   for this E2E_PORT (.claude/worktrees/shots-baseline-<port> in this checkout; `node scripts/shots.ts clean`
                          #   removes it), shoots into .shots/<port>/baseline: two callers on two ports never meet
npm run shots             # builds this tree, compares with that baseline (`--dir`, `--app <built web/>`; same E2E_PORT), prints the
                          #   near-misses (diffs of 1 to a state's allowance; also .shots/<port>/near-misses.txt)
npm run build             # the editor into dist/app/, the pages into dist/site/; needs DOFILE_URLS=production,
                          #   DOFILE_URLS=local (`npm run build:local`), or both DOFILE_SITE_URL and DOFILE_EDITOR_URL
npm run preview           # the two builds on two ports (4173 pages, 4174 editor, or E2E_PORT and the next)
npm run snapshot          # the Pyodide memory snapshot the page starts from; again after any engine change
npm run check-snapshot [-- --normal]   # corpus, probes, native calls and the Stata 14 cases inside Pyodide (~4 min);
                          #   refuses a stale snapshot (rc 2), except with --normal
npm run check-numeric     # e()/r() of the Stata 14 programs at full precision (~4 min)
npm run check-pytest [-- --ios]        # OpenDTA's unit tests inside Pyodide (~2 min)
npm run test-counts [unit|e2e]   # test counts per file and in total (docs/test-map.md keeps none)
npm run check             # Biome (errors), then TypeScript
npm run format            # Biome: layout, import order, safe lint fixes
npm run lint:strict       # Biome as CI runs it: warnings fail too
npm run axe | tabwalk | contrast | fonts   # the design checks over docs/design/
npm run sample            # the sample's data and src/app/sample-files.ts
```

## Rules

- **Biome formats and lints `web/`** (`biome.json`, pinned exactly). An **error** fails `npm run check`, a build, and
  shows a panel in `npm run dev`; a **warning** fails CI (`web ok`) and `npm run deploy`. Fix or ignore every finding
  before a commit to be merged: `// biome-ignore lint/<group>/<rule>: <reason>`, always with the reason. Run
  `npm run format` at the end of a task or before a commit, not after every edit. A `// @ts-expect-error` covers one
  line: if Biome would split the statement under it, put a `// biome-ignore format:` line above.
  `src/stata/commands.json` is generated (`npm run commands`, which CI checks) and not formatted.
- **TypeScript that Node can run as is.** `src/engine/`, the controllers, `test/`, `e2e/`, `scripts/` and the two configs have real annotations (no JSDoc
  types; one `tsconfig.json` covers them all); Node strips the types, so imports spell the `.ts` extension and only erasable syntax is allowed (no `enum`,
  `namespace` or constructor parameter properties; `npm run check` enforces it). The engine's types are
  `src/engine/types.ts`; keep them and SPEC section 6 in step.
- **Comments are sparse; the code says the rest.** A file header is 1-3 lines on the file's role, only when the name
  does not say it: no inventory of files, callers or signals. JSDoc on a function or type only for what its name and
  types leave out (units, what null means, an ordering, why); where it explains parameters or the result, TSDoc tags
  read better than prose: `@param name - ...`, `@returns ...` (no `{type}`: the signature has it; for a destructured
  options parameter, whose fields `@param` cannot name, explain them in prose). A JSDoc sits directly above the
  declaration it documents. Inline comments only for a non-obvious why (a browser quirk, a race, a workaround) or a unit
  or meaning on a field (`// ms`). Each fact lives in one place (a type first, then a test name, this file, a doc):
  point to it ("the plain logic: tree.ts"), never restate it or describe what another file does. No history or
  provenance (steps, issue IDs, dates, review rounds: git has them) and no links into `docs/archive/`. Keep hard-won
  knowledge (browser quirks, measured numbers, why a simpler way failed) on the line that handles it, shortened.
- **State.** One module of signals, `src/app/state.ts`, except the open tabs: `src/app/editor/documents.ts` keeps one
  record per tab, its `tabs`, `activeTab` and `selection` are computeds over them, and a tab changes only through its
  functions (it needs no view; the editor attaches its view on mount). A signal with one owner is exported `ReadonlySignal`, so a view
  that assigns it fails `npm run check`. The controllers (`src/app/engine.ts`, `run.ts`, `files.ts`, `start.ts`) are `.ts`
  files that import no `.tsx`, tested in Node (`test/app-*.test.ts`, on `test/wiring.ts`; each file starts from
  `resetState()`). Views read signals and call the controllers' actions; they never call the transport or the machine.
  Dialogs and banners go through the registries `dialogs.tsx` and `banners.tsx`, one view per kind; shared UI pieces are in `src/app/ui/`. A phone piece sits next to its desktop
  counterpart in `App.tsx`, and components read `isPhone` rather than take a `phone` prop. Toolbar buttons share one
  height (`--control` in `tokens.css`), a pane head's controls another (`--control-sm`).
- **One state machine decides the engine's state: `src/engine/machine.ts`.** `transition(machine, event)` is pure (type
  imports only, no clock, timer, console or top-level `let`/`var`; the time comes in the event) and returns the next state
  and the effects. Its state names are the `engine` signal's, `<html data-engine>`'s and SPEC section 5's. **Nothing
  outside it decides a state**: no counter, flag or comparison of state names in the transport or the controllers, and
  a view asks `src/app/states/predicates.ts` (`engineUp`, `runOn`, `takesRun`, ...) rather than spell or compare names.
  The groups are written once in `machine.ts` (key objects such as `RUN_ON`; `member()` makes a type guard from one);
  `predicates.ts` is one `member(...)` line per group, and with `app/engine.ts` the only place in `src/app/` that imports
  machine values. A control that exists to send an event asks `accepts(state, type)` (`takesRun`). To add a
  state, event or effect, change its tables (and place the state in SPEC section 5's states x groups table); the compiler and
  `test/machine.test.ts` then say what else must follow. After a change to a cell, run
  `PRINT_SPEC_MATRIX=1 node --test test/machine.test.ts` and paste the tables into SPEC section 5 (a test compares them).
- **Who constructs, who connects, who decides.** Only `src/main.tsx` makes the transport (`EngineClient`,
  `src/engine/client.ts`) and the tab lock and calls `connectFiles`, `connectRun`, `connectEngine` and `open()`. The
  transport decides nothing. The controller `src/app/engine.ts` feeds events in, performs effects, and writes the
  `engine` signal from the machine's state. A new failure path that needs a decision becomes an event, not a flag.
- **Tickets.** Each asynchronous request gets a `Ticket` from the machine, and the machine drops an answer whose ticket
  is not current. Performers never write a ticket: they answer through the `reply` bound to their effect. Every event
  that changed nothing is recorded (`drops()`).
- **Architecture rules are Biome rules, a type check and `test/imports.test.ts`**; a violation fails `npm run check`,
  `npm run lint:strict` or `npm test`: fix the code, not the rule, unless the rule has changed. `biome.json`, by folder:
  a view imports no transport, machine or `main.tsx`, and `main.tsx` no machine; `engine/` imports no `app/`; no `.ts` imports a `.tsx`;
  `src/site/` imports only `src/site/` and `src/styles/`, and the editor nothing of it; a relative import in a `.ts`
  file spells its extension; `machine.ts` names no clock, timer, console or global. `biome/architecture.grit` (a Biome
  plugin: each rule's files are a regex on `$filename`, in that file): `machine.ts` imports types only (a default import is left to `tsc`) and names no random number; `src/app/` takes only types from the transport; only `main.tsx` constructs the transport and the Worker,
  connects the controllers, takes the tab lock and calls `open()`; `openStore()` is called only in `src/app/store.ts`
  (the page) and `src/engine/worker*.ts` (the Worker); only the controller calls `transition()` and `initial()`, and its
  queue is written only in `enqueue()` (and emptied in `connectEngine()`), which only `dispatch()` and `reply()` call;
  `reply()` has no cast and puts its own effect's ticket on the event, and the `engine` signal is written with `view()`; each writer object is named only by `state.ts` and its owner;
  the Worker is posted to only in `#send`; no `.focus()` and no store write (`write`, `mkdir`, `rename`, `remove`, `change`, `applyRun`) inside a `setTimeout` or `setInterval` callback in `src/app/` (a timer's late move is the one `settle` in `e2e/fixtures.ts` cannot see; a `requestAnimationFrame` or microtask is allowed; a callback that only calls a function which focuses is not seen); in `src/app/` the store is written only through a turn's `Io` in `files/turns.ts` (an upload's writes and the first visit's sample excepted, until B1); no cast to `any` or `never` in `src/`; an `aria-disabled` or `.pill` button
  in `editor/` or `log/` has `onKeyDown={ignoreHeldEnter}`. `test/signals.types.ts` (compile-time, in `npm run check`):
  the writable signals `state.ts` exports are the views' own. `test/cycles.test.ts`: no import cycle in `src/` (type imports count: a type a view needs lives in `src/app/types.ts`, not in a registry). `test/imports.test.ts` holds the rest: no view reaches the
  transport through value imports (transitive); `machine.ts` has two casts and no top-level `let` or `var`, and the cast to
  `Ticket` occurs once in `web/`; the transport names no state, `run.ts` subscribes to nothing, no CSS reads `data-engine` and no `.tsx` spells a set
  of state names; the pages' HTML and CSS stay apart from the editor's; every `:hover` rule is inside `(hover: hover)`. Tests that read source text must not
  depend on how a line is wrapped.
- **The test hook stays, behind a flag.** `?test` sets `window.__dofile` (its keys: the object in `main.tsx`);
  `?test=manual` starts no engine until the test calls `start()`. Without the flag it does not exist. The store is
  blocked until the tab lock answers: a test waits for `!store.blocked` before it writes. `<html data-engine>` always holds
  the state name (for tests; no CSS reads it). Its type is `DofileHook`, derived from that object (`e2e/hook.ts`); a spec declares no hook type of its
  own. What a test sets up in the page's state goes through the helpers in `e2e/seed.ts` (`showEngine`, `addBanner`,
  `seedLog`, ...), not a signal written in the spec.
- **e2e specs import `test` and `expect` from `e2e/fixtures.ts`**, not `@playwright/test`. Its fixture answers
  `persisted()` true (`test.use({ persisted: false })` for the browser's own) and retries a stalled first `goto`; a context
  or page a test makes itself needs `keepFiles(context)` or `retryFirstGoto(page)`. The helpers several specs share
  (`isPhone`, `ready`, `settled`, `settle`, `putFiles`, `storedText`, `SAMPLE`, and the locators `toastOf`, `bannerOf`,
  `statusBar`, `toolbarOf`) are in `fixtures.ts` too. To assert that a late focus or write did not happen, wait for
  the event the move would follow, then `settle(page)`: it covers moves made by tasks, microtasks, effects and frames
  (and, with `{ store: true }`, the store's own order), not a timer over about 50 ms. A fixed sleep stays where it must
  let a run go on (Break's loop) and where a run, dialog or download must not start.
- **Dev servers listen on all interfaces** (LAN phones): every dev HTTP server (`dev`, `preview`, `cf:dev`) keeps `--host`
  or `--ip 0.0.0.0`; give any new one the same.
- **The snapshot is the page's only start; there is no fallback.** `?snapshot=0` is the normal boot, a developer's
  diagnostic, and nothing the page shows names it. A missing or stale snapshot makes the engine `failed` (stale: reason
  "updated"), with a plain `message` for the visitor (`FAILED` in `app/states/words.ts`) and the cause in `detail` (console).
  Rebuild it (`npm run snapshot`) after a change to the dofile code, a wheel or the Pyodide version: `vite build` fails on
  a stale one. Its loader is a patched copy of Pyodide's that throws if Pyodide's text changes, so a Pyodide upgrade needs
  the patch updated (`docs/pyodide-snapshot.md`). `download()` in the transport is the only writer of the start files'
  Cache (checked against `start-files.json`, the one statement of the build); the worker only reads it. One exception, a
  lazy snapshot's graphics part: the page's `#graphics` in `client.ts` also writes it (fetched at the end of `download()`:
  after the start files on a first visit, from the Cache while the worker starts on a return visit; written only when the
  heap is there); the worker never does, and `download()`'s clean-up keeps it. Without a
  SharedArrayBuffer the worker fetches the part itself and the page does not (nor writes it to the Cache); the worker's
  messages (`fetching`, `progress`, `landed`, `failed`) are how the page shows the download.
- **The files live in dofile's own store** (`src/engine/store.ts`, IndexedDB `dofile`), not in the worker; `/work` is an
  in-memory copy, no IDBFS. **The journal is the only way a page change reaches `/work`** (a `pending` row, then the op
  `sync`). Never write a file through the worker alone. A run's changes are found by **modification time and size**; do
  not drop either (`test/files.test.ts`, "a run that empties a file"). Contract: SPEC section 7.
- **One tab owns the files and the engine**: the Web Lock `dofile-engine` (`src/engine/tab.ts`). A tab without it starts
  no worker and writes nothing (`store.blocked`).
- **Errors from `client.ts` carry a `kind`** (`ClientError` in `src/engine/types.ts` lists them); the worker answers
  `{id, error, name, type?}` (`type`: the Python exception class of a `PythonError`). Keep these on a new failure path: the page decides from them, never from the text.
- **`vite.config.ts` holds the three configs (editor, pages, editor's preview) and staging (`stageFiles()`); the plugins are `scripts/vite/`**
  (`headers`, `site-plugins`, `editor-plugins`, `start-list-dev`): factories that take their inputs as arguments.
- **`vite.config.ts` builds the Web Worker as one file** (`inlineDynamicImports`): a chunk that imports the worker's
  entry made iOS Safari run it twice.
- **No pandas in the page**, so `export sasxport` is rc 199 there (ODT-32) and cases 1701 and 1911 are `EXPECTED_DIFFER`
  in `scripts/check-snapshot.ts`, a strict xfail.
- **`wheels/`** holds wheels installed after the dofile wheel: `pyreadstat` built for Pyodide, committed so CI needs no
  Emscripten build (rebuild: `sh web/wheels/pyreadstat/build.sh`).
- **Two origins, two Workers:** the landing and commands pages at `https://dofile.dev/` (`dist/site/`, `wrangler.jsonc`,
  Worker `dofile`), the editor at `https://app.dofile.dev/` (`dist/app/`, `wrangler.app.jsonc`, Worker `dofile-app`).
  The addresses are ONE setting, `scripts/urls.ts`; a build has no default and fails unless told them (Commands). Only a
  production build is indexable (canonical links; others get `X-Robots-Tag: noindex`). Everything of the editor's goes
  through `import.meta.env.BASE_URL` or `LANDING_URL` (`app/env.ts`): `test/site.test.ts` fails if any other file spells
  the old `/app/` path or a production address. The e2e `baseURL` is the editor's origin; the pages are `LOCAL_SITE_URL`.
  What does not follow the editor to a new origin, and the details: SPEC section 8, "URLs".
- **The landing and commands pages are static HTML** (`landing.html`, `commands.html`) whose code is `src/site/`, which
  imports only `src/site/` and stylesheets; the editor loads none of it (`biome.json`, `test/imports.test.ts`). They work with
  scripts off. The build fills their `{{tokens}}` (`scripts/site-pages.ts`); an unknown one fails `test/site.test.ts`.
- **The sample** is `sample/`; `npm run sample` rebuilds its data and the generated `src/app/sample-files.ts` (a test
  fails when it is stale). Under `?test` the first-visit sample is off unless the URL has `?sample`.

## Python files the page runs (`src/dofile/`, web demo only)

- `browser.py`: what `src/engine/worker.ts` calls: one Engine in `/work`, JSON in and out, only `shell`/`webuse` denied,
  Break through Pyodide's interrupt buffer.
- `pathshim.py`: through PATCH-3's hook it maps file names written for someone's computer into one working folder and
  replaces `cd`.
- `linalgshim.py`: in Pyodide numpy's `inv`, `solve` and `cholesky` return NaN instead of raising `LinAlgError`;
  `browser.start()` installs wrappers that raise (a no-op on CPython). The engine relies on that exception.
