# Prototype 1 of the web demo: build plan and status

The working plan for steps 6 to 8 of [phase2-plan.md](phase2-plan.md): the editor page, the landing page and the sample
project, built to the design in `docs/design/`. This file is the one place for the step table and its status. Update the
Status column and the "Where things stand" section at the end of every session.

To pick up after a break: read this file, then `docs/design/SPEC.md` (the build spec), then run `git status` and
`git log --oneline -5`.

## Where things stand (2026-11-10)

- **Steps 0, 1 and 2 are merged into `main`** (not pushed). Each was reviewed (step 2 twice) and its fixes are in. Step 3
  starts from `main`.
- `docs/design/SPEC.md` is the build spec. Its open questions (section 10) were decided on 2026-11-10. Sections 6 and 7 now
  describe steps 1 and 2 as built (the "As built in step 2" list).
- Checked on `main` after step 2 merged: `uv run poe test` (1346 passed), `npm run check`, `npm test` (98 tests, all pass with
  a current snapshot), `npm run e2e` (56 passed: Chromium, Firefox, WebKit, iPhone profile).
- **Next:** step 3, alone. Read "Known work found in steps 1 and 2" below first: it lists the joins step 3 owns.

## Decisions (2026-11-10)

The reasons are in `phase2-plan.md` (decisions 1, 3 and 7); the detail a builder needs is in `docs/design/SPEC.md`.

1. **File store:** dofile's own store in IndexedDB, one record per file, shared by the page and the worker. `/work` in the
   worker becomes a plain in-memory folder; Emscripten's IDBFS is dropped. The page works on the store directly. The
   worker copies the store into `/work` at engine start and writes back only what each run changed. A save made during a
   run wins over that run's write of the same file: a `pending` journal in the store holds page changes the worker has not
   applied yet, and the worker leaves those paths out of the run's difference. A Web Lock lets one tab own the engine; a
   second tab is blocked entirely and writes nothing. Files in the old IDBFS store are not imported, and that database is
   left in the visitor's browser, unused.
2. **Framework:** Preact with signals, on the project's own `ui.css`. No component library.
3. **Runtime:** for the snapshot start, `pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` are copied from the
   `pyodide` npm package into `public/pyodide/` at build time and served from the page's own origin. `?snapshot=0` keeps
   the CDN and is a diagnostic mode.
4. **Download size:** about 48 MB for the snapshot start, added up from file sizes, not measured in a browser. The pages
   take the number from the build. Step 2 measures it.
5. **Deploy size check:** in `deploy.yml`, after the build: fail over 25 MiB per file, warn over 23 MiB. The snapshot files
   are not split.
6. **Styles:** `web/src/styles/tokens.css` and `web/src/styles/ui.css` are the one source for the page and the design pages.
7. **Scope of prototype 1:** desktop and phone layouts with the core flows. Deferred to prototype 2: the Help tab; the
   highlighters for .py, .R, .tex, .sql and .yaml; the unknown-command underline and per-file list; the selection-run
   warning about an unset local; unpacking a .zip on upload.
8. **The spec's open questions** (SPEC.md section 10): its recommendations are accepted, except: the log streams during a run
   (OQ-1); Load's question about changed data and drafts kept across a reload are P2 (OQ-6, OQ-17); the step 4d agent
   drafts the missing words and the maintainer approves them (OQ-10, OQ-16, OQ-18).
9. **Tabled:** the Safari 7-day storage note (re-verify after the prototype, step 7); keyboard shortcuts beyond the design's.
10. **Cleanup:** `web/spike/` and `eval/` are deleted (in git history at `10e0f1c`).

## Steps

Status values: `not started`, `running`, `to review`, `done`.

| Step | Work | Agent | Model, effort | Runs | Status |
|---|---|---|---|---|---|
| 0a | `docs/design/SPEC.md`: the build spec, with the worker protocol and state model types | general-purpose | Fable, high | first | done |
| 0b | Doc restructure (`CLAUDE.md` and plan splits), cleanup, `ui.css` into `web/`, the deploy size check | general-purpose | Sonnet, medium | with 0a | done |
| 1 | Engine API with tests (`engine.py`, `browser.py`): a whole-file run with no locals, the dark plot style, locals and globals, the first rows for Browse, memory use, the log streamed during a run (`on_output`; check first that it works in Pyodide), the error line, the command per graph, describing a .dta without loading it, the page's tempfile wording. Spec section 6. No MCP schema change: `mcp_server.py` does not send the new fields | general-purpose, worktree | Opus, medium | parallel with 2 | done |
| 2 | The file store with its `pending` journal, the self-hosted runtime, a build-written list of the start files with their sizes, download with byte counts and abort (resumed per file), Break as wait / reset now, the zip made in the page, the tab lock, `storage.persist()`, relaying the streamed log and the new ops; Node tests (spec section 7) | general-purpose, worktree | Fable, high | parallel with 1 | done |
| 3 | App shell: Preact, the tokens and `ui.css` in the page, layouts (desktop B, phone tabs), the theme toggle, the state store, and the shared primitives that 4a needs (dialog, menu, toast, the live region) | general-purpose, alone | Opus, high | after 1 and 2 | not started |
| 4a | File tree, editor tabs, upload and name clash, row menus | general-purpose, worktree | Opus, medium | after 3, with 4c | not started |
| 4b | Editor, Run, Break, log, run-head, status bar | general-purpose, worktree | Opus, medium | after 4a and 4c, with 4d | not started |
| 4c | Graph, Data and Browse, Results and the matrix view | general-purpose, worktree | Sonnet, medium | with 4a | not started |
| 4d | Dialogs and states: download prompt, failures, reset, toast; drafts the missing words (OQ-10, OQ-16, OQ-18) for the maintainer to approve before merge | general-purpose, worktree | Sonnet, medium | with 4b | not started |
| 5 | Landing page, commands page, the sample project on synthetic data, clean-room check of all text | general-purpose, worktree | Sonnet, medium | parallel with 4 | not started |
| 6 | e2e per user flow; `axe`, `tabwalk`, `contrast` on the real pages | general-purpose | Sonnet, medium | after each of 3 to 5 | not started |
| 6r | Review of each merge (`/code-review`) | fresh context | Opus, high (Fable for step 2) | per merge | not started |
| 7 | The Phase 2 verification list; a real-phone pass; the Safari storage re-check | maintainer | | last | not started |

## How to run a step

- Step 0 must be committed before any worktree step starts: a worktree is made from the last commit, so it would not have
  the spec or the moved files.
- Give each agent: this file, `docs/design/SPEC.md`, the sections of the spec its step owns, and the rule that it does not
  commit unless told to.
- Steps 1 and 2 touch different files (`src/dofile/` and `tests/` against `web/src/engine/` and `web/test/`). The worker
  ops that call step 1's new Python functions are joined after both merge, at the start of step 3.
- Step 3 fixes the state model that the step 4 agents write against. Do not start step 4 before step 3 is merged.
- After each merge: step 6 for that part, then the review in 6r, then update the Status column here.

## Known work inside the steps (found in the review of 2026-11-10)

- **Step 2:** risk: the patched loader is loaded with `import()`, and it is not checked that `loadPyodide` can be given the
  runtime's bytes instead of fetching them itself; if it cannot, a counted download cannot hand those files to the start.
  `client.js` `breakRun` ties the interrupt to the 5 s kill timer; "Don't reset: wait for it" and "Reset now"
  need them apart. Today the snapshot start downloads everything before any file call answers, so the file panel waits
  for the engine; the file store removes that. The page does not call `navigator.storage.persist()` yet.
- **Step 3:** `worker.js`, `client.js` and `snapshot.js` are plain JavaScript and `main.ts` casts their results; add a
  shared types file from the spec's declarations, without converting them (the Node tests run them directly).
- **Step 6:** `web/e2e/poc.spec.ts` is bound to the proof-of-concept page's element ids and is rewritten with the page.
  `axe`, `tabwalk` and `contrast` check the mockups today, not the real page.
- **Step 7:** the 48 MB figure, Break on a long model fit in a browser, `pyreadstat` on a real iPhone, a phone over HTTPS
  with the cache working, "no request leaves the page except for static assets", and that the host compresses the `.wasm`.

## Known work found in steps 1 and 2 and the step 1 review

Decided in the step 2 review:
- A run's new file inside a folder the page renamed or removed during the run is not saved; `RunResult.skipped` lists it, and
  the log says so (step 4b). A file the page itself changed during the run is not listed: the page's version wins by design.
  The engine cannot see page changes during a run (the worker is busy in one synchronous call), so such a `save` succeeds
  where desktop Stata would give r(603). **P2 idea:** pass folder changes and deletes to the engine mid-run through a
  `SharedArrayBuffer`, checked before each command, as Break is.
- With no Web Locks (plain HTTP on a LAN, the dev server only), every tab owns the engine. Accepted and documented.
- `engineBytes` is written into the page at build time, so the prompt has the size before any download, offline too.
- The real page keeps a test hook, on only behind a flag, so step 2's tab-lock and download e2e tests keep running through
  steps 3 to 5. Step 2 lists what the hook must expose.

- **Step 3:**
  - Rebuild the snapshot after merging step 1 (`npm run snapshot`). Run `npm test`: the three tests in `files.test.mjs` that need
    step 1 turn on by themselves.
  - `engineBytes` is not a build constant: step 2's build writes `start-files.json` (each start file, its size on disk and its
    compressed size). The page reads `compressed` from it.
  - The engine controller builds the states of section 5 from `onStatus`, `onRestart(reason, started)`, `resetAt`, a
    `download()` rejection (`AbortError` means declined) and `start()` rejecting with "failed twice". The `dofile.downloaded`
    flag is the controller's, not the client's.
  - Wire `main.ts` in this order: `tabLock`, then `keepFiles()`, then `store.*` (set `store.blocked` when the lock is lost),
    then `client.download()` and `client.start()`. Leave out the proof-of-concept page's `?start=manual`, `window.__dofile`
    and its `confirm()` take-over (or keep them for tests only).
  - Show the streamed log with `run(code, {onLog})`, and at the end replace it with `RunResult.log`, never append: the stream
    can stop short of the log with no marker (log cap, and the sandbox notes added after the run).
  - Add `graph_lines: []` to the client's rc 9998 result (`graph_lines` was added after step 2 was built).
  - Docs left stale by step 2: `web/CLAUDE.md` and `docs/pyodide-snapshot.md` (the loader from a `blob:` URL, the runtime
    from the page's origin, the cache-first fetch during the start).
- **Step 4b:** a run stopped by Break (rc 1) has `error_line` on the command that did not start: say "stopped before line N"
  and give it no error mark. Put each "graph n" link after the echo on line `graph_lines[i]`, not by matching the text.
- **Step 4c:**
  - Dark plots: colors the user names (`mcolor(black)`, `lcolor(navy)`) nearly vanish on the dark card. Decide whether to
    draw such a graph light, or accept it.
  - Three graphs from one loop share one label and alt text (`graph_commands` is the unexpanded command). Add the graph
    number to the alt text.
  - `browse` returns string cells whole (a strL can be thousands of characters with newlines). Cut long cells in the grid.
- **Step 6:** one Playwright test of a streamed run in a real browser (step 1 checked streaming in Node `worker_threads` only).
