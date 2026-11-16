# 04 Census of web/ (worktree 145a557). Scratch: `.dofile/audit-census/` on the machine that ran it, not in the repository (S below)

## 1. Baseline
| step | result | time |
|---|---|---|
| `npm run check` (biome check + tsc --noEmit) | pass, 159 files, no fixes | 1.4 s |
| `npm run lint:strict` | pass | 0.2 s |
| `npm test` (incl. wheel build) | pass: 363 tests, 358 pass, 0 fail, 5 skipped | 58 s wall |
Logs: S/check.log, lint.log, test.log. Not run: e2e, snapshot, build, check-*.

## 2. Unused code (knip)
Default run failed to load vite.config.ts (needs DOFILE_URLS; also misread site entries). Re-ran with S/knip.json (entries per brief, `DOFILE_URLS=local`, vite/playwright plugins off): S/knip2.log; first run S/knip.log.
- Unused files: 1, `e2e/global-setup.ts`. False positive: `playwright.config.ts:13` names it (playwright plugin was off). So 0 real.
- Unused dependencies: 0. Unlisted dependencies: 0. Unlisted binary: `uv` (package.json scripts; expected).
- Unused exports (20; each grepped by whole word over src, scripts, test, e2e, html, docs/design; S/knip-grep.txt):
  - Survive grep (used elsewhere, i.e. exported only for a test): `refreshData` (src/app/run.ts:201, test/app.test.ts), `BROWSERS_URL` (src/app/states/banners.tsx:32, test/site.test.ts).
  - Referenced only inside the defining file (export keyword unneeded): AFFILIATION (editor/StatusBar.tsx:15), KBLOG_ID, KBLOG_ROWS (kblog.ts:10,12), pngBytes, pngName (output/clip.ts:45,53), EmptyData (DataTab.tsx:20), EmptyGraph (GraphTab.tsx:15), EmptyResults (ResultsTab.tsx:33), SAMPLE_MAIN (sample.ts:12), COMMUNITY (states/words.ts:112), inflateSteps (engine/snapshot.ts:354), DB_NAME, cleanPath (engine/store.ts:32,37), LOCK (engine/tab.ts:3), isCommand (stata/language.ts:41).
  - Generic names, grep inconclusive (word hits in many files): `now` (app/editor/clock.ts:9), `src` (output/GraphTab.tsx:30), `mb` (states/DownloadDialog.tsx:18). Not confirmed unused.
- Unused exported types (15): LineKind (log/classify.ts:14), DtaVariable (output/view.ts:32), About, EngineStateChecked (app/types.ts:20,68), machine.ts: TicketedEvent, RowsMatchEffects, AnswersMatchEvents, NoEventTwice, RowsOk, EventsOk, NoDuplicates, EventOf (type-level checks, used within file), AsmModule (snapshot.ts:23), ResultSet, Variable (engine/types.ts:134,183). All referenced only in their own file.
- First run (without config) also flagged scripts/compare-pytest.mjs, scripts/measure-startup.mjs as unused files: they are only reached by hand (not by package.json scripts); not verified further. install-engine.ts exports extraWheelsDir/newestWheel are used inside that file.

## 3. Licences (S/licences.txt)
Direct deps: all MIT except brotli-wasm 3.0.1 Apache-2.0 and pyodide 314.0.7 MPL-2.0. Dev: @axe-core/playwright 4.14.0 MPL-2.0; @playwright/test, fake-indexeddb, typescript Apache-2.0; biome, wrangler MIT OR Apache-2.0; @types/node, vite, vite-plugin-checker MIT. (Versions in licences.txt.)
Installed tree (103 packages, from node_modules/.package-lock.json): MIT 76, Apache-2.0 12, MPL-2.0 5, MIT OR Apache-2.0 5, ISC 2, LGPL-3.0-or-later 1, CC0-1.0 1, BSD-3-Clause 1.
Flag: `@img/sharp-libvips-darwin-arm64` LGPL-3.0-or-later (dev only, optional native binary pulled by wrangler/sharp; platform-specific, not shipped). No GPL/AGPL, no unknown. MPL-2.0 (pyodide is shipped to users) is weak copyleft, not forbidden by the stated rule.

## 4. Raw DOM and timing (src, excl. commands.json; table S/dom-table.txt, every match with line S/dom-matches.tsv)
Totals: `.focus(` 27, `.blur(` 2, querySelector/getElementById/closest 33, setTimeout/setInterval 20, rAF/queueMicrotask 8, addEventListener 29 vs removeEventListener 19, useEffect/useLayoutEffect 25 (2 with no dep array, both LogView.tsx:471,479), useRef 42, casts/ts-expect-error/biome-ignore 5 (all 4 biome-ignore a11y + 1 control-char regex; no `as any`), TODO/FIXME/XXX/HACK 0, old-step/poc/#N 2 (both false hits: DownloadDialog.tsx:113 "step 1 of N" aria text, Menu.tsx:120 "prototype").
Files with the most (focus/blur | query | timer | raf | addEL | effect | ref):
| file | focus | blur | query | timer | raf | addEL | rmEL | effect | ref |
|---|---|---|---|---|---|---|---|---|---|
| app/editor/Editor.tsx | 4 | | 2 | | 1 | 1 | 1 | 2 | 3 |
| app/files/FilesPane.tsx | | | 4 | | | 1 | 1 | 2 | 5 |
| app/log/LogView.tsx | 1 | | 1 | | | 5 | 5 | 4 | 4 |
| app/output/FullSize.tsx | 4 | | 2 | 1 | | 1 | 1 | 3 | 4 |
| app/states/focus.ts | 4 | | 2 | | 1 | | | 1 | 2 |
| app/ui/Dialog.tsx | 2 | 2 | 2 | | 1 | | | 1 | 4 |
| app/ui/Menu.tsx | 3 | | | | | 3 | 3 | 3 | 4 |
| app/ui/focus-hooks.ts | 2 | | | | | | | 2 | |
| app/state.ts | | | 1 | 3 | | 1 | | | |
| app/kblog.ts | | | 2 | | 2 | 2 | | | |
| app/viewport.ts | | | | 1 | | 5 (via on/off toggle) | 5 | | |
| engine/worker.ts | | | | 4 | | | | | |
| site/commands.ts, site/site.ts, main.tsx | | | 8,4,1 | 0,3,0 | | 1,2,2 | | | |
addEventListener with no removeEventListener in the file (my script's flag; includes page-lifetime listeners): kblog.ts, state.ts (dark-mode query, :134), main.tsx (:47,:60), site/commands.ts, site/site.ts, client.ts partially (signal abort :322 has one remove; `online` :481 is `once`).
Other timers: app/editor/clock.ts (2), app/engine.ts (2), app/files.ts (1), app/output/ResultsTab.tsx (2), app/states/clock.ts (1).

## 5. Comment weight (S/comments.txt)
38 files in src exceed 100 lines; every one has a top-of-file `//` or `/* */` block. Comment lines = whole-line comments only (trailing comments not counted). Largest by comment lines: worker.ts 120 of 1039, client.ts 110/698, snapshot.ts 85/465, engine.ts 73/461, actions.ts 70/432, types.ts(engine) 67/307, Editor.tsx 66/508, machine.ts 56/581.
Churn: commits among the last 60 touching the file that changed lines in the header (`git log -L1,<end>`, approximate; the count can exceed "commits touching" because -L follows renames/merges, so read as "often"):
| file | header lines | header-changing commits | of commits touching |
|---|---|---|---|
| app/log/align.ts | 18 | 5 | 6 |
| app/log/CommandLine.tsx | 13 | 13 | 23 |
| app/editor/RunControls.tsx | 9 | 6 | 13 |
| app/run.ts | 8 | 6 | 17 |
| engine/store.ts | 8 | 2 | 10 |
| app/engine.ts | 6 | 4 | 17 |
| app/states/DownloadDialog.tsx | 6 | 7 | 13 |
| app/files/actions.ts | 4 | 6 | 12 |
| app/log/LogView.tsx | 4 | 9 | 22 |
| app/output/DtaView.tsx | 4 | 7 | 9 |
| app/output/FullSize.tsx | 4 | 6 | 6 |
| app/output/ResultsTab.tsx | 4 | 6 | 7 |
| app/states/banners.tsx | 4 | 13 | 17 |
| app/ui/Tablist.tsx | 4 | 3 | 7 |
| app/editor/Editor.tsx | 3 | 17 | 31 |
Note: the top-15 by header length stops at 3-4 line headers; the long headers are only align.ts, CommandLine.tsx, RunControls.tsx, run.ts, store.ts.

## 6. Size and shape (S/shape.txt, S/madge.txt)
Measured by a regex script: a function/arrow-const/method header at some indent, end = next line at the same indent starting with `}` or `)`. Rough; treat as +-10%.
Top 25 (lines, name, file:line): crashReason 165 engine/machine.ts:409; CommandLine 163 log/CommandLine.tsx:61; TreeRow 144 files/FilesPane.tsx:408; hintLine 144 log/LogView.tsx:142; runText 126 log/LogView.tsx:160; LogView 118 log/LogView.tsx:374; performer 116 app/engine.ts:272; MenuHost 110 ui/Menu.tsx:125; Viewer 103 output/FullSize.tsx:18; DtaView 99 output/DtaView.tsx:22; start 96 engine/client.ts:545; Row 93 output/ResultsTab.tsx:169; FilesBody 90 files/FilesPane.tsx:624; echoLines 90 log/align.ts:157; ProgressDialog 89 states/DownloadDialog.tsx:64; RunControls 88 editor/RunControls.tsx:76; isField 84 kblog.ts:16; uploadNow 82 files/actions.ts:270; showKbLog 81 kblog.ts:19; Variables 79 and Browse 79 output/DataTab.tsx:41,149; play 78 and keyS 75 editor/RunControls.tsx:85,88 (nested inside RunControls, overlapping); FileBar 74 files/FileBar.tsx:39; App 72 app/App.tsx:304. (hintLine/isField/showKbLog look long because my end-finder may mis-pair; unverified.)
Imports most local modules: App.tsx 23, main.tsx 18, CommandLine.tsx 16, LogView.tsx 16, Editor.tsx 15, states/banners.tsx 13, FileBar.tsx 10, FilesPane.tsx 10, DtaView.tsx 10, EditorTabs.tsx 9.
Imported by most: app/state.ts 37, app/types.ts 27, engine/types.ts 16, editor/commands.ts 14, app/files.ts 11, ui/Icon.tsx 11, files/tree.ts 11, run.ts 10, engine.ts 10, files/actions.ts 7.
Import cycles (madge, ts/tsx, 91 files): 10.
1. app/banners.tsx > app/editor/banners.tsx; 5. app/banners.tsx > app/files/banners.tsx; 6. app/banners.tsx > app/states/banners.tsx; 7-10. app/dialogs.tsx > each of files/dialogs.tsx, log/ClearLogDialog.tsx, states/DownloadDialog.tsx, states/ResetDialog.tsx (barrel files that the children import back);
2. app/files/actions.ts > app/files.ts > app/sample.ts;
3. app/files.ts > app/sample.ts > app/files/open.ts > app/run.ts > app/engine.ts;
4. app/files.ts > app/sample.ts > app/files/open.ts > app/run.ts.

## 7. Duplication (jscpd, min-lines 8, min-tokens 60; S/jscpd-src-full.log, jscpd-test-full.log)
- src: 1 clone total (23 lines): `styles/tokens.css` 152-174 vs 176-198. No TS clones in src.
- test + e2e: 28 clones, 323 duplicated lines (1.56%) of 20,739. Largest 5: files.spec.ts 264-283 vs 300-319 (20 lines); graphics.spec.ts 128-143 vs engine.spec.ts 153-170 (18); engine.test.ts 420-435 vs 450-465 (16); editor.spec.ts 313-328 vs 427-439 (16); states.spec.ts 153-168 vs 680-695 (16). (machine.test.ts 1474-1482 vs 1502-1510 appears in the src+test cross run.)

## 8. CSS (S/css-unused.txt)
Corpus: src ts/tsx, html, scripts, e2e, test, docs/design (md/mjs/html), excluding css and json.
- ui.css: 153 classes, 4 unreferenced: i-plus, i-split, i-unsplit, file-ico (the `i-*` ones are probably built from icon names: false positives likely).
- app.css: 148 classes, 7 unreferenced: cm-cursor, cm-lineNumbers, cm-gutterElement, cm-activeLineGutter, cm-selectionBackground, cm-selectionLayer (CodeMirror-generated: false positives), csv-c3 (possibly string-built).
- site.css: 46 classes, 0 unreferenced.
- tokens.css: 63 custom properties, 0 never used via `var()`.

## 9. Stale docs (S/stale-docs.txt)
Checked backticked paths (against git ls-files, by exact or trailing path) and `npm run` names (against package.json). All npm script names exist in all three docs (the "npm run e" hit is a truncated `e2e`).
No missing paths other than generated or removed artifacts:
- web/CLAUDE.md: `start-files.json`, `dist/site/`, `dist/app/` (build output, not tracked).
- web/README.md: `dist/app/`, `dist/site/`, `public/snapshot/`, `dist/app/start-files.json`, `dist/app/index.html`, `dist/app/_headers`, `pyodide.asm.wasm`, `pyodide-lock.json` (generated or upstream).
- docs/test-map.md: `pyodide.asm.mjs`, `dist/site`, `dist/app`, `start-files.json` (generated); `make_data.py`, `reference.py` (line 326 says removed 2026-11-10; intended).
So no stale paths or scripts found. Stale narrative instead: README.md:97 and test-map.md:194,269 say `poc.spec.ts` is fixme "until step 6 rewrites them"; `e2e/poc.spec.ts` (171 lines) and `e2e/step2.spec.ts` (443 lines) still carry step names.

## 10. Churn, last 6 weeks (251 commits touch web/; S/churn.txt)
src top: styles/app.css 38, files/FilesPane.tsx 32, editor/Editor.tsx 31, App.tsx 24, log/CommandLine.tsx 23, log/LogView.tsx 22, engine/types.ts 21, engine/client.ts 19, styles/ui.css 17, states/banners.tsx 17, run.ts 17, engine.ts 17, main.tsx 15, ui/Menu.tsx 15, files/EditorTabs.tsx 15, editor/StatusBar.tsx 15, engine/worker.ts 14, engine/snapshot.ts 14, app/types.ts 14, states/words.ts 14, engine/machine.ts 13, ui/Dialog.tsx 13, states/DownloadDialog.tsx 13, log/paste.ts 13, editor/RunControls.tsx 13.
test top 10: app.test.ts 29, imports.test.ts 22, editor.test.ts 21, site.test.ts 16, machine.test.ts 14, files-ui.test.ts 13, engine.test.ts 12, client.test.ts 12, states.test.ts 9, files.test.ts 8.
e2e top 10: editor.spec.ts 45, files.spec.ts 36, shell.spec.ts 26, states.spec.ts 23, poc.spec.ts 16, step2.spec.ts 15, output.spec.ts 13, landing.spec.ts 11, keyboard.spec.ts 9, engine.spec.ts 9.

## Not done / not verified
- knip default run failed (vite.config needs DOFILE_URLS); the config-based run is what is reported. Playwright's globalSetup was therefore flagged unused (false positive).
- Export "unused" verdicts rest on whole-word grep; `now`, `src`, `mb`, `About` have too many hits to confirm by grep.
- Function lengths are a regex heuristic; a few (hintLine, isField, showKbLog) may be mis-paired. Nested closures overlap in the list.
- Comment-line counts exclude trailing comments; header churn via `git log -L` is approximate.
- addEventListener/removeEventListener pairing is per file, not per call site; I did not check each remove is reachable.
- CSS: string-built class names are false positives; I did not check selectors that are reachable only at runtime, or descendant-only rules.
- Licence list covers the installed (darwin) tree only; platform-optional packages for other OSes are absent.
- Did not run e2e, snapshot, build, check-* scripts, as instructed.
