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
npm run dev               # `stage`, then two dev servers, on the LAN too: the editor on 5173, the landing and commands pages on 5174
                          #   (prints a warning first when the snapshot is stale; `npm run snapshot` fixes it)
npm run e2e               # `e2e:prepare` (`stage`, the snapshot, `build:vite` for local), then Chromium, Firefox, WebKit, iPhone (`npx playwright install` once;
                          #   SNAPSHOT_QUALITY=5: the snapshot in seconds; E2E_PORT=4181: ports 4181/4182, not 4173/4174)
npm run build             # `stage`, then the editor into dist/app/ and the pages into dist/site/; needs DOFILE_URLS=production,
                          #   DOFILE_URLS=local (`npm run build:local`), or both DOFILE_SITE_URL and DOFILE_EDITOR_URL
npm run snapshot          # the Pyodide memory snapshot the page starts from; again after any engine change
npm run stage             # the wheel, then `public/` (wheels, Pyodide's runtime): the only writer of them; `vite` only reads
npm run check             # Biome (errors), then TypeScript
npm run format            # Biome: layout, import order, safe lint fixes
npm run lint:strict       # Biome as CI runs it: warnings fail too
```

The other scripts (the screenshot run, `preview`, the `check-*` runs inside Pyodide, `test-counts`, the design checks,
`sample`): `web/README.md`.

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
- **Code style: `web/STYLE.md`** (comments, functions, the contract of the shared UI helpers in `src/app/ui/`). Read it before
  writing or reviewing code here.
- **State.** One module of signals per owner, in `src/app/state/` (`engine.ts`, `files.ts`, `run.ts`, `layout.ts`,
  `notices.ts`, `saved.ts`; `theme` is in `theme.ts`, the Data tab's `pickedVar` in `output/view.ts`), except the open tabs:
  `src/app/editor/documents.ts` keeps one record per tab, its `tabs`, `activeTab` and `selection` are computeds over them,
  and a tab changes only through its functions (it needs no view; the editor attaches its view on mount). A state module
  imports only types, `app/paths.ts` (pure path helpers), the signals package and other state modules. The tests read
  the modules joined as `S` (`test/state-all.ts`); the test hook's `state` is the same join. A signal with one owner is exported `ReadonlySignal`, so a view
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
  The groups are written once in `machine.ts`; `predicates.ts` and `app/engine.ts` are the only files in `src/app/` that
  import machine values. A control that exists to send an event asks `accepts(state, type)` (`takesRun`). To add a
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
- **Architecture rules are Biome rules, a type check and tests**: `biome.json` (imports by folder),
  `biome/architecture.grit` (a Biome plugin: each rule's files are a regex on `$filename`), `test/signals.types.ts`,
  `test/imports.test.ts` and `test/cycles.test.ts`. Each rule says itself in its message or test name. A violation
  fails `npm run check`, `npm run lint:strict` or `npm test`: fix the code, not the rule, unless the rule has changed.
  A type a view needs lives in `src/app/types.ts`, not in a registry (type imports count as cycles). Tests that read
  source text must not depend on how a line is wrapped.
- **Test-only code is one module, loaded only with the flag.** `src/app/test-hook.ts` holds the hook `window.__dofile`
  (its keys: the object there), the tab seeds (`editor/seeds.ts`) and `<html data-engine>`; `main.tsx` imports it
  dynamically only under `?test` (as it does `kblog.ts` under `?kblog`, which stays its own). `?test=manual` starts no
  engine until the test calls `start()`. Without the flag none of it is loaded or runs: **a spec that needs the hook or
  `data-engine` opens with `?test`**, and test code outside the module never writes either. The store is blocked until the tab
  lock answers: a test waits for `!store.blocked` before it writes. `data-engine` holds the state name (no CSS reads it).
  The hook's type is `DofileHook`, derived from that object (`e2e/hook.ts`); a spec declares no hook type of its own. What a test sets up in the page's state goes through the helpers in `e2e/seed.ts` (`showEngine`, `addBanner`,
  `seedLog`, ...), not a signal written in the spec.
- **e2e specs import `test` and `expect` from `e2e/fixtures.ts`**, not `@playwright/test`. Its fixture answers
  `persisted()` true (`test.use({ persisted: false })` for the browser's own) and retries a stalled first `goto`; a context
  or page a test makes itself needs `keepFiles(context)` or `retryFirstGoto(page)`. The helpers several specs share are in
  `fixtures.ts` too. To assert that a late focus or write did not happen, wait for
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
  the patch updated (`docs/pyodide-snapshot.md`). Only the page writes the start
  files' Cache, never the worker: `download()`, and `#graphics` in `client.ts` for a lazy snapshot's graphics part
  (`docs/pyodide-snapshot.md`, "The worker reads that Cache").
- **The files live in dofile's own store** (`src/engine/store.ts`, IndexedDB `dofile`), not in the worker; `/work` is an
  in-memory copy, no IDBFS. **The journal is the only way a page change reaches `/work`** (a `pending` row, then the op
  `sync`). Never write a file through the worker alone. A run's changes are found by **modification time and size**; do
  not drop either (`test/files.test.ts`, "a run that empties a file"). Contract: SPEC section 7.
- **One tab owns the files and the engine**: the Web Lock `dofile-engine` (`src/engine/tab.ts`). A tab without it starts
  no worker and writes nothing (`store.blocked`).
- **Errors from `client.ts` carry a `kind`** (`ClientError` in `src/engine/types.ts` lists them); the worker answers
  `{id, error, name, type?}` (`type`: the Python exception class of a `PythonError`). Keep these on a new failure path: the page decides from them, never from the text.
- **`vite.config.ts` builds the Web Worker as one file** (`inlineDynamicImports`): a chunk that imports the worker's
  entry made iOS Safari run it twice. Its plugins are factories in `scripts/vite/` that take their inputs as arguments.
- **No pandas in the page**, so `export sasxport` is rc 199 there (ODT-32) and cases 1701 and 1911 are `EXPECTED_DIFFER`
  in `scripts/check-snapshot.ts`, a strict xfail.
- **`wheels/`** holds wheels installed after the dofile wheel: `pyreadstat` built for Pyodide, committed so CI needs no
  Emscripten build (rebuild: `sh web/wheels/pyreadstat/build.sh`).
- **Two origins, two Workers:** the landing and commands pages at `https://dofile.dev/` (`dist/site/`), the editor at
  `https://app.dofile.dev/` (`dist/app/`); the Workers, their configs and what is indexed: SPEC section 8, "URLs". The
  addresses are ONE setting, `scripts/urls.ts`; a build has no default and fails unless told them (Commands). Everything
  of the editor's goes through `import.meta.env.BASE_URL` or `LANDING_URL` (`app/env.ts`): `test/site.test.ts` fails if
  any other file spells the old `/app/` path or a production address. The e2e `baseURL` is the editor's origin; the
  pages are `LOCAL_SITE_URL`.
- **The landing and commands pages are static HTML** (`landing.html`, `commands.html`) whose code is `src/site/`, kept
  apart from the editor's by the architecture rules. They work with scripts off. The build fills their `{{tokens}}`
  (`scripts/site-pages.ts`); an unknown one fails `test/site.test.ts`.
- **The sample** is `sample/`; `npm run sample` rebuilds its data and the generated `src/app/sample-files.ts` (a test
  fails when it is stale). Under `?test` the first-visit sample is off unless the URL has `?sample`.

## Python files the page runs (`src/dofile/`, web demo only)

`browser.py` (what `src/engine/worker.ts` calls), `pathshim.py` (maps file names into the working folder; replaces `cd`)
and `linalgshim.py` (makes numpy's `inv`, `solve` and `cholesky` raise `LinAlgError` in Pyodide; the engine relies on
that exception). The rest is in each module's docstring.
