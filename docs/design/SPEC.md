# dofile web demo: build spec (prototype 1)

What to build, for the agents of steps 1 to 6 (`docs/prototype1-plan.md`). It replaces reading the design history; where an
older design file differs, this file holds the later decision. Text in quotes is verbatim from the mockups. *Proposed* marks
a name this spec gives to something no source names. "OQ-n" points to section 10, where each question is decided (2026-11-10). Source tags (files in `docs/design/`):

| Tag | File | Tag | File |
|---|---|---|---|
| `E`, `E?r` | `mockups/editor.html`, and with `?running` | `WB` | `wireframes/desktop-b.html` |
| `P/name` | `mockups/panels.html`, the figure whose caption starts with **name** | `WP n` | `wireframes/phone.html`, screen n |
| `S n` | `mockups/states.html`, drawing n (1 to 19; 19 sits between 15 and 16) | `WS n` | `wireframes/states.html`, drawing n |
| `L` | `mockups/landing.html` | `DS`, DS-n | `system/index.html`; `system/critique.md` |
| `PH`, `PH?r` | `mockups/phone-log.html`, and with `?running` | `F n.m`, `FD` | `flows/index.html`: flow n, step m; its Decisions |
| `R` | `README.md` | UX-n | `mockups/ux-analysis.md`, `ux-analysis-2.md` |

## 1. Scope and rules

**Prototype 1 (P1):** the editor page in the desktop and phone layouts, the landing page, the commands page and a sample
project, with flows F1 to F7. No server: the engine is Python in Pyodide in a Web Worker.

**Prototype 2 (P2), deferred, not dropped:** the Help tab, its field and "Help for `cmd`" in the editor's context menu
(`P/Help`); highlighters for .py, .R, .tex, .sql, .yaml; the unknown-command underline, its lint message (`E` line 18) and the
per-file command list of the upload report; the selection-run warning about an unset local (`.runwarn`, `E?r`); unpacking a
.zip on upload and its refused entries; the upload report; unsaved drafts kept across a reload and the last log kept across a
reload (OQ-17); Load's question when the data in memory has changed (OQ-6). **Tabled:** keyboard shortcuts other than those named in this file (the "⌘ ." chip
on Break in `E?r` is a placeholder: do not show or bind it); the Safari "7 days" storage note.

**Build steps**, cited as "step n": 1 engine API; 2 worker and client; 3 app shell; 4a files and tabs; 4b editor, run, log;
4c graph, data, results; 4d dialogs and states; 5 landing, commands, sample; 6 tests.

**Standing rules**
- **Framework:** Preact with signals on the project's own CSS; no component library. Native `<dialog>` and the popover API
  for dialogs and menus where they fit. The editor is CodeMirror 6.
- **Styles:** `web/src/styles/tokens.css` and `web/src/styles/ui.css` are the one source for the page and the design pages.
  Tokens, not literals. Bold is `--w-bold-ui` or `--w-bold-mono`. No text opacity below 1, disabled controls excepted.
- **Accessibility:** WCAG AA (text 4.5:1; edges, bars and the focus ring 3:1). Everything works by keyboard and every focus
  stop is visible. The log is `role="log"`. The status bar is not a live region (its timer would be read every second): one
  hidden `role="status" aria-live="polite"` region says each change once ("Run started", "Run finished: error r(111) at line
  17", "Engine reset", "Engine ready", each start-up stage, each toast). Meaning is never color alone.
- **Forced colors, touch, motion:** keep the forced-colors block at the end of `ui.css` and add new bars, icons and rings to
  it. Under `pointer: coarse`, rows and menu items are 44 px, the row ⋯ 44 px square, the tab × 32 px. Hover styles only
  under `hover: hover`. Reduced motion stops the spinner and the toast's animation.
- **Glyphs:** ⌘ ▶ ■ ● ▾ ⋯ are SVG icons (`.ico`), never typed. Key chips say ⌘ on a Mac, Ctrl elsewhere; a disabled button
  shows none. An icon-only button has an `aria-label`.
- **Clean room** (`LICENSE-POLICY.md`): no Stata manual or help text, no Stata example datasets, nothing copied from its
  screens. **Naming:** the product is "dofile"; it runs "Stata-syntax" code.
- **Runtime:** for the snapshot start, `pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` are copied from the
  `pyodide` npm package at build time and served from the page's own origin. `?snapshot=0` keeps the CDN: a diagnostic mode.
- **From the build, never literals:** the version, and the download size: 48.6 MB for the snapshot start today (42.1 MB
  snapshot, 5.75 MB runtime, 0.68 MB page and small files). The build writes `start-files.json` (`{built, wheelHash, files:
  [{path, size, compressed, download}], size, compressed}`; `compressed` is an estimate, brotli quality 5, never more than
  `size`) and puts the total in the page as `<meta name="dofile-engine-bytes">`, so the prompt has it before any download
  (OQ-12). The build fails if it cannot write either.

## 2. Pages and layout

| Page | Content | Step |
|---|---|---|
| Editor | The app; its own Vite entry. | 3, 4 |
| Landing | `L`: static HTML that shows at once. Nav: Commands, GitHub, the theme button. "Open the editor →". | 5 |
| Commands | A static list made from `web/src/stata/commands.json`; no links to help pages (`R` round 1). Not drawn: OQ-18. | 5 |

**Desktop B, split** (`E`, 1440 x 900): toolbar; columns `230px | 1fr | 660px` with `--s2` gaps; status bar. The right column
is two panes: Log above (`1.35fr`, the command line at its foot) and, below (`1fr`), a tablist "Output": Graph, Data, Results
(Help is P2: leave the tab out). The Log head has "Find", "Download log", "Unsplit". Unsplit exists only as a wireframe
(`WB`): one pane with tabs Log, Graph, Data, Results and "Split"; the choice is kept in the browser (OQ-15). Focus order:
toolbar, files, editor, output, command line, lower pane (`WB`).

**Phone** (`PH`, `WP`; under 700 px): top bar, the view, the command line, and a bottom tablist "Views": Files, Editor, Log,
Data, Results. The top bar has a title (on the Editor tab it is the file switcher, `WP 1`), ⋯ and one Run button. Graphs show
inline in the log; a tap opens the full-size view (`WP 3`, `WP 6`). Dialogs are bottom sheets (`S 8`). Only the Log tab and
the prompt sheet are drawn in high fidelity; from 700 px the desktop layout is used "with the file list folded away": OQ-14.

**Theme** (step 3): the theme button cycles System, Light, Dark. System sets nothing; the others set `data-theme` on `<html>`.
`aria-label="Theme: follows the system. Press for light, then dark."` The landing page has it too.

## 3. Components

Files and the editor work in every engine state except `other-tab` (section 5).

### 3.1 File panel and tree (P1, step 4a; calls `store.*` only, section 7)
- **Behavior** (`E`): a tree of the store's files. 16 px per level with guide lines; folders end in `/` and fold; sizes muted;
  the open file has the soft accent and the bar; a "new" badge marks files the last run wrote. Under it: the dropzone ("Drop
  files or folders" in P1; the mockup's "or a .zip" is P2, OQ-19; links "Upload" and "New .do file") and "Download all (.zip)".
- **Upload:** the Upload link, "Upload a folder", or a drop anywhere; folder paths are kept. A name that exists asks (3.10).
  Replacing the open file reloads it in the editor (`F 3.3`). P1 stores a .zip as one file.
- **Row menu** (`S 13`): "Open", "Rename" (hint F2; edits the name in place), "Download", rule, "Delete…" (asks, 3.10). From
  the row's ⋯ (on the hovered, focused or open row; always on touch), right click, Shift+F10 or the menu key.
- **Head menu** ("File actions", `S 13` caption): "New .do file", "New folder", "Upload a folder", "Download all (.zip)",
  "Delete all files…" (asks first, `FD`). "Restore the sample" (`F 2.4`) is not in that list: OQ-13.
- **States:** drawn: open, unsaved dot, hover, folder open and closed, size, new badge (`E`), row menu (`S 13`). In the flows'
  list, not drawn: drop target, upload count (`WS 4`), inline rename and "name already exists" (DS-7), could not save, too big
  (OQ-16).
- **Keyboard and ARIA:** `role="tree"`, flat rows with `aria-level`, `aria-expanded` on folders, `aria-selected`,
  `aria-haspopup="menu"`. Roving focus: one row in the tab order (the open file); arrows move, Enter opens (3.11), F2 renames.
  The ⋯ is `aria-hidden` (a control inside a treeitem would be nested).

### 3.2 Editor tabs (P1, step 4a)
- One tab per open file, several at once (`FD` 2026-11-08; `F 2.2`, where opening replaced the text, is superseded). A tab
  shows the name, the unsaved dot and a ×. Closing an unsaved tab asks first (`E` comment; not drawn: OQ-16). Leaving the page
  with unsaved edits gets the browser's own warning.
- **Keyboard and ARIA:** `role="tablist" aria-label="Open files"`; tabs have `aria-selected` and `aria-keyshortcuts="Delete"`;
  arrows move; Delete closes the selected tab. The × is `aria-hidden`, mouse only, 22 px. Do not bind Ctrl/Cmd+W: the browser
  owns it. The dot is `role="img" aria-label="unsaved changes"`.

### 3.3 Editor (P1, step 4b)
- CodeMirror 6 with `web/src/stata/language.ts` for .do and .ado; other text as in 3.11. Edits are never blocked, during a run
  too. Save is explicit (button, Ctrl/Cmd+S): `store.write`, then the toast "Saved analysis.do".
- **Line marks:** selected (soft accent); running (accent bar, bold number; it moves with its text, so use a decoration that
  maps through edits); error (red bar and tint, bold number; from the run's error line, OQ-2). P2: warning.
- The unsaved dot shows on the tab, the file row and Save (`R` round 1). Unsaved drafts kept across a reload: P2 (OQ-17).

### 3.4 Toolbar (P1, steps 3 and 4b)
- **Order** (`E`): wordmark (to the landing page), Run, Run selection, Break, Save, spacer, theme button, ⋯ ("More actions").
  There is no Reset button: Reset is in the ⋯ menu.
- **Run** is the one primary button. The "⌘ ↩" chip sits on Run with nothing selected and on Run selection with a selection;
  Run selection is disabled with none. While running, Run is `aria-disabled="true"`, not `disabled`: focus stays on it, so a
  second Enter cannot reach Break.
- **Break** (`.btn.stop`): outlined and disabled when idle, filled red (`.live`) while running; its other labels are in
  section 5. **Save** has the dot when the active tab is unsaved, and the "⌘ S" chip.
- **⋯ menu** (`S 12`): "Download all (.zip)", "Clear log" (the log and the graphs, not the data), "Reset the engine…", rule,
  "About dofile" with the version at the right (goes to the landing page, `WP 1`).
- **Phone** (`PH`, `PH?r`, `WP 1`, `WP 2`): one Run button; with a selection its label names the lines ("Run lines 6–7"). Run
  opens the Log tab. While running, Break takes Run's place as a pill with the time ("Break" "3.4 s") and ignores taps in its
  first 600 ms. Save and Reset are in ⋯. The theme button's place: OQ-14.

### 3.5 Log pane and command line (P1, step 4b)
- **Lines, top to bottom** (`DS` "Log"): the head (`.head`: banner B2, `book+drop+skew` in `mockups/art.js`, `aria-hidden`;
  "dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax" from `About`; "Files stay in this browser. Try: help regress"); per run a
  run-head (`.runhead`, section 4); each echo (`.echo`); output; notes (`.note`: the path shim's "(path … is … in the working
  folder)"); the error and its `r(N);` (`.err`); the engine's hint (`.hint`); "Go to line 17" (`.jump`), which moves the
  editor's cursor. Mono at `--log`, 80 columns, no wrapping; wide tables scroll sideways.
- The head, run-heads and the page's own notes are shown only: never in Download log or a log file (`S 15`).
- The log streams during a run (OQ-1): the worker posts `{id, log}` chunks, and the page appends them. When the run ends, the
  page replaces the streamed text with `RunResult.log`, which is the complete text. If step 1 finds that streaming does not
  work in Pyodide, the log arrives when the run ends and the page shows the run-head and the running banner until then. The
  engine sends plain text, so the page tells the line kinds apart with the .log tokenizer (OQ-4). The pane follows the end of
  the log unless the user has scrolled up.
- **Graphs:** desktop puts a link "graph 1" (`.glink`) after the command that drew it; it selects that graph in the Graph tab.
  The phone shows the graph inline. `RunResult.graph_commands` names the command that drew each image, and `graph_lines` gives its line, where the link goes (OQ-3).
- **Head links:** "Download log" saves the log as text. "Find", and the flows' "next error", have no drawn behavior: OQ-16.
- **Command line** (`.cmdline`; at the foot of the Log pane, above the tab bar on a phone): prompt ".", an input
  `aria-label="Command"` with placeholder "Type a command · ↑ ↓ for earlier ones" (phone: "Type a command"), and "Run
  command". Enter runs; ↑ ↓ recall earlier commands; it waits while a run is on (`WP 2`).
- **Phone only** (`PH`): a strip under the top bar ("r(111)", "line 17 · 0.38 s", "Mem 612 MB", "Go to line 17"; running:
  "Running lines 14–15", "Mem 612 MB"); the hint as a block (`.explain`); "← wide table: swipe sideways →".
- **States:** drawn: after an error (`E`, `PH`), first run running (`E?r`, `PH?r`), stopping and waiting (`S 9`, `9b`), stopped
  by Break (`S 10`), nested do with unsaved edits (`S 15`). Not drawn: the notes of OQ-10.

### 3.6 Status bar (P1, step 4b)
- Left to right (`E`): state dot and word, the last run, "Memory 612 MB", spacer, "Files are kept in this browser" (or "Files
  may be cleared by this browser", `S 19`). State texts: section 5. Last run: "Last run: whole file (started with no locals)
  · r(111) at line 17 · 0.38 s" (`E`); "Last run: stopped by Break · r(1) · 18.4 s" (`S 10`); the rc in the error color.
  Memory comes from the `memory` op after the start and each run; it cannot update during a run (OQ-8).

### 3.7 Graph tab and full-size view (P1, step 4c)
- **Tab** (`E`): the latest graph on `.graph-card`; a foot with thumbnails of the session's graphs, "graph 1 of 1 · scatter
  wage educ", "Open full size", "Export PNG". A .png opened from the files shows here too.
- **Full size** (`P/Full size`): over the whole editor; "graph 1 of 2 · scatter wage educ", "Export PNG", "Copy image", "Close"
  with an Esc chip; the session's graphs in a strip at the right; ← → move; Esc closes.
- **Empty** (`S 16`): "No graphs yet" / "Graphs drawn by a run appear here, for example `scatter wage educ`. A .png from the
  file list opens here too."
- **Calls:** `RunResult.images` (base64 PNG, the last 5 a run drew at most; `new_graphs` counts all). Every run sends
  `plot_theme`: the page's resolved light or dark. Graphs already drawn keep their colors. Alt text: the graph's command from `graph_commands`, for example "Graph: scatter wage educ" (OQ-3).

### 3.8 Data tab and Browse (P1, step 4c)
- **Tab** (`P/Data`): facts ("500 obs", "3 vars", "from data/wages.dta", "6 KB in memory"); the field "Filter variables"; a
  table Name, Label, Type, Format ("no label" muted); "Browse" with "first 6 of 500 rows · read only · Show 50 more" and the
  grid. A click on a name picks it: Browse scrolls to its column and marks it. Nothing else happens: no command, nothing in
  the log, the editor or the command line. "Show 50 more" adds rows and runs nothing.
- **Empty** (`S 17`): "No data in memory" / "Load a .dta from the file list, or run `use` or `import delimited`, or a do-file
  that builds the data." After a reset: "The engine was reset, so no data is in memory".
- **Keyboard and ARIA:** names are buttons, one in the tab order; arrows move, Enter or Space picks; the picked one has
  `aria-current="true"`. The grid's corner header holds a hidden "Obs".
- **Calls**, after each run: `describe` (facts, variables), `browse` (rows), `memory` (`data_bytes`).

### 3.9 Results tab and matrix view (P1, step 4c)
- **Tab** (`P/Results, top`, `P/Results, scrolled`): one table, three fixed columns (name, value, action). Sections "e() ·
  regress" (`e(cmd)`), "r() · summarize", "Locals and globals" hold groups that fold, with counts: Scalars, Macros, Matrices,
  Functions; Locals, Globals ("6, all set by the system"). e() scalars start open. "changed by the last run" shows when
  `e_changed` or `r_changed` is true. Functions and the r() name: OQ-7.
- **Values:** 8 significant digits; all digits when focused or hovered and when copied. Enter or Ctrl/Cmd+C on a focused value
  copies it ("↵ Copy" hint; toast "Copied").
- **Matrices:** the row shows the size ("1 x 3", from the engine's "1x3") and "View", which opens the matrix in place as a
  grid: no command, nothing in the log or the history. "Hide" folds it. Copying a matrix copies tab-separated text.
- **Empty** (`S 18`): "No results yet" / "e() and r() appear after an estimation or a command such as `summarize`, with the
  locals and globals your runs set."
- **Keyboard and ARIA:** values are buttons, one in the tab order, arrows move; group heads are buttons with `aria-expanded`.
  **Calls:** `RunResult.results`; `macros` after each run; `matrix {name}` on View.

### 3.10 Dialogs, banners, toast, menus (P1, step 4d unless noted)
A dialog is a `<dialog>` centered over the scrim, a bottom sheet on a phone. Focus starts on the safe choice, Esc cancels,
focus returns to what opened it (`DS`). A destructive button is `.btn.stop.live` and never the default.

| Dialog | Drawn | Content and rules |
|---|---|---|
| Download prompt, progress | `S 1`, `S 8`; `S 2`, `S 3` | Section 5. Download is the default (Enter) on purpose (UX-037). The bar is `role="progressbar"` with `aria-valuetext`; screen readers hear the stages, not the megabytes. |
| Name clash (4a) | `P/Name clash` | `role="alertdialog"`. "data/wages.dta is already here" / "The upload has a file with the same name. Keep yours, or replace it with the uploaded one?" / "Yours: 8 KB, 9 Nov · uploaded: 15 KB · clash 2 of 5 · the other 37 files are uploaded." / checkbox "Do the same for the other 3 clashes" / "Replace with uploaded", "Keep mine" (primary, focused). Enter keeps this one. Esc keeps yours for every remaining clash and stops asking. For the open file with unsaved edits: "analysis.do is open with unsaved edits; replacing it discards them". |
| Delete (4a) | `P/Notices` | "Delete clean.do?" / "It's kept only in this browser; there is no undo." / Cancel (focused), Delete. `DS` words it differently: OQ-19. |
| Reset | `S 14` | `role="alertdialog"`. "Reset the engine?" / "The data in memory, e() and r() results, macros and graphs are cleared, as if you had reloaded. Your files are kept." / Cancel (focused), Reset. Not asked with no data in memory and no results. |
| Upload report | `P/Upload report` | Drawn with P2 content only. P1: the toast "3 files uploaded" (OQ-19). |
| Another tab | `WS 6` (wireframe) | Sections 5 and 7. |
| Close tab; Delete all files | not drawn | The step 4d agent drafts the words; the maintainer approves them (OQ-16). Load over changed data: P2 (OQ-6). |

- **Banners** sit in a pane above its content until their cause goes or they are dismissed; warning and error banners carry
  the warning icon. Above the editor: no engine (`S 5`), did not start (`S 6`), failed twice (`S 7`), storage (`S 19`: "**This
  browser may clear your files** when it needs space. Download all to keep a copy." / "Download all (.zip)", "Dismiss"; when
  `persisted()` is false, once per visit after files change). Above the log: running (`E?r`), stopping (`S 9`), waiting
  (`S 9b`), Break resets (`S 11`), reset (`P/Notices`), memory (`P/Notices`: "**Memory 1.6 GB of about 2 GB.** A bigger
  dataset may reset the engine. `compress` or `keep` fewer variables to save memory."; OQ-8). In the Files pane: not UTF-8.
- **Toast** (`DS`; no mockup): a confirmation with no buttons ("Saved analysis.do", "Copied", "3 files uploaded"); inverted
  colors, bottom center above the status bar, one at a time, 4 s (longer while hovered), never focused; the live region says
  the same words. Anything to act on is a banner or a dialog. Its place on a phone: DS-7.
- **Menus** (`DS`): buttons with `role="menuitem"`; arrows move, Esc closes; a key hint at the right; a destructive item in
  the error color, with "…" when it asks first. The trigger has `aria-haspopup="menu"` and `aria-expanded`.

### 3.11 Opening files (P1, step 4a; .dta and .png with 4c)
A file is text when its bytes decode as strict UTF-8, the test `main.ts` uses today.

| File | Opens as | Drawn |
|---|---|---|
| .do, .ado | Editor tab with our highlighter. | `E` |
| .dta | A tab that is not an editor. Bar 1: "data/wages.dta · 500 obs · 3 vars · 8 KB". Bar 2: `use "data/wages.dta", clear`, "Load" (primary), "Copy" (`aria-label="Copy the use command"`). Then the variables table and "Read with `describe using`; the data in memory is untouched until you press Load." The table comes from the `describe_file` op (OQ-5); with no engine, the two bars and no table. | `P/.dta` |
| .csv, .tsv | Editor tab, each column its own color (a small tokenizer: commas outside quotes). Bar 1: "data/raw/survey.csv · 1,204 rows". Bar 2: `import delimited "data/raw/survey.csv", clear`, "Import", "Copy" (`aria-label="Copy the import command"`). | `P/.csv` |
| .log | Editor tab with a small log tokenizer (commands bold, errors red). Bar: "output/analysis.log · written by the last run", "Download". | `P/.log` |
| other UTF-8 text | Editor tab; .md and .json with CodeMirror's packages, anything else plain. P2: .py, .R, .tex, .sql, .yaml. | `P/.log` caption |
| .png | The Graph tab, and full size the same way. | `S 16` (text) |
| not UTF-8 (.xlsx, ...) | No tab. A warning banner in the Files pane: "**survey.xlsx can't be opened in the editor.** It isn't UTF-8 text, so the editor would change it. Download it to edit it elsewhere." / "Download", "Dismiss". No Import button for .xlsx (OQ-19). | `P/.xlsx` |

### 3.12 Landing page, commands page, sample (P1, step 5)
- Build `L` as drawn, desktop and phone. The banner and the do-file drawing are `aria-hidden`, with a hidden plain-text copy
  that holds no link. Each Copy button names what it copies; "Copied" shows beside it for 2 s and the live region says "Copied
  to the clipboard". `pip install dofile` keeps its label "with the first release".
- **Strings to change** (the runtime now comes from the page's own origin): delete " from a public CDN" in `S 1` ("…the
  engine: **about 48 MB** from a public CDN. Later visits…"), in `L`'s hidden desktop copy ("…about 48 MB) from a public
  CDN.") and in `L`'s welcome.do line 18 ("* WebAssembly, about 48 MB) from a public CDN."); delete " from a CDN" in `L`'s
  hidden phone copy. `FD`'s "(the runtime itself comes from a CDN)" no longer holds.
- **Every "48 MB" comes from the build:** `S 1` (text and button), `S 2`, `S 5`, `S 8`, and six places in `L`.
- **Sample** (`F 2.1`): a main do-file, a small synthetic dataset of our own, maybe a second do-file. The page writes it into
  the store when the store is empty on a first visit and opens the main do-file. Check all text for the clean room.

## 4. Run semantics (P1, steps 1 and 4b)

| Trigger | Sends | `fresh_locals` | Run-head |
|---|---|---|---|
| Run; Ctrl/Cmd+Enter with nothing selected | the active tab's whole text, saved or not | `true` | "**Run**: master.do, whole file · starts with no locals" (`S 15`) |
| Run selection; Ctrl/Cmd+Enter with a selection | the selection (whole lines? OQ-21) | `false` | "**Run selection**: lines 14–15 of analysis.do · keeps the locals of earlier runs", plus " (first run: none yet)" on a session's first run (`E?r`); the phone omits the file name (`PH?r`) |
| Command line; Load; Import | one command | `false` | none drawn (OQ-21) |

- Every run is one do-file call: `preserve` is restored and temporary names are dropped at its end. Globals, data and e()/r()
  carry over. A whole-file run starts with no locals, so running a file twice gives the same answer. The MCP server and the
  CLI keep today's behavior (`fresh_locals` defaults to false).
- The page sends text, never a path, so no temporary name exists: the log, errors, "Go to line" and the run-head say
  `analysis.do`. One run at a time. Run does not save. Editing during a run is allowed and does not change the run.
- `do` and `include` read the saved file in `/work`. When the log shows a nested `do` or `include` of a file that was open with
  unsaved edits when the run started, the page adds under that echo (`S 15`): "Note: clean.do has unsaved edits in the editor;
  do runs the saved file. Save it (⌘ S) to run your edits."
- Load and Import run their shown command as if typed in the command line: echoed in the log, added to the history (↑ brings
  it back), never written into a do-file. Load does not ask first in P1 (OQ-6: P2). Copy puts the command on
  the clipboard.
- After every run the page calls `describe`, `browse`, `macros` and `memory`, and lists the store.
- An error stops the run; the data is as the last complete command left it. "Run the file again" (the reset banner) runs the
  whole active file.

## 5. Engine states (P1; step 2 for the client, 4b and 4d for the views)

One state at a time, in the `engine` signal (section 8). `**` marks `<b>` in the mockups.

| State | Status bar | Dialog or banner | Run | Break |
|---|---|---|---|---|
| `none`, `asking` | "No engine yet" | Blocking prompt `S 1` (phone `S 8`): "Download the engine?", its two paragraphs, "Not now", "Download 48 MB" (default) | disabled | disabled |
| `declined` | "**No engine** · Run downloads it first" | `S 5`: "**The engine isn't downloaded.** You can open, edit, upload and download files; running code needs the engine (about 48 MB)." / "Download the engine" | enabled: it, and the command line, open the prompt titled "Download the engine to run code"; the run starts when the engine is ready | disabled |
| `downloading` | "**Starting** · downloading" | `S 2`: "Getting the engine ready" / "**Downloading**" "14.2 of 48 MB · 6 s" / the bar / the stage list / "Stop download", "Edit files while it loads" (focused) | "Run · starting…", disabled | disabled |
| `starting` | "**Starting** · loading packages (step 4 of 5) · 2.1 s" (the drawn text, for `?snapshot=0`; the snapshot start names its own stages, OQ-11); at the right "You can edit and upload while it starts" (`S 4`) | While the dialog is open, `S 3`: "**Loading packages**" "step 4 of 5 · 9 s"; no bar; done stages keep their time | "Run · starting…", disabled | disabled |
| `ready` | "**Ready**", the last run, memory (`E`) | none | enabled | disabled |
| `running` | "**Running** lines 14–15 · 3.4 s" (`E?r`); "**Running** · 12 s" (`S 11`) | Log banner (`E?r`): "Running lines 14–15 · **3.4 s**. Break stops between commands. If one long command doesn't stop within 5 s, the engine is reset: **the data in memory is lost**; your files are kept." | `aria-disabled` | "Break", live |
| `breaking` | "**Stopping** · resets in 4 s", the run's time | `S 9`, once it takes a moment: "**Stopping…** This command can't stop until it ends. **In 4 s the engine is reset:** the data in memory is lost; your files are kept." / "Don't reset: wait for it" (focused) | disabled | "Stopping…", disabled |
| `waiting` | "**Waiting** · Break after this command", the run's time | `S 9b`, a banner with `tabindex="-1"` that takes the focus: "**Waiting for this command to end.** The Break is still pending: the run stops after this command, with the data kept. If it never ends, **Reset now** resets the engine: the data in memory is lost; your files are kept." | disabled | "Reset now", live; asks nothing |
| `failed` | "**Stopped** · the engine didn't start" | `S 6`, `role="alert"`: "**The engine didn't start:** this browser has no WebAssembly support. Your files are safe: you can still edit and download them." / "Browsers that work" (a link), "Download all (.zip)". Other reasons, other first action: download failed, "Try again"; not enough memory, "Close other tabs, then try again". | "Run · engine stopped", disabled | disabled |
| `failed-twice` | "**Stopped** · failed twice" | `S 7`: "**The engine stopped after failing twice** (it ran out of memory). It won't restart by itself, since each try can use a lot of a phone's memory. Your files are safe." / "Reload the page", "Download all (.zip)" | "Run · engine stopped", disabled | disabled |
| `other-tab` | "paused" | `WS 6`, blocking: "dofile is open in another tab" / "Only one tab can use your files at a time, so they are not overwritten. The other tab keeps its data until you take over here." / "Use dofile in this tab", "Close this tab" | none | none |

| From | Event | To, and what happens |
|---|---|---|
| page load | the tab lock is taken | `other-tab`. "Use dofile in this tab" takes the lock and goes on as a page load; the tab that lost it ends its worker and shows the same dialog. |
| page load | no download on record (a localStorage flag, *proposed* `dofile.downloaded`, set when the engine first reaches `ready`) | `asking`. Otherwise `downloading` then `starting`, with no dialog (`S 4`). |
| `asking` | "Download 48 MB"; "Not now" | `downloading`; `declined`. From `declined`, the banner's button or Run leads back to `asking`. |
| `downloading` | all bytes in; "Stop download"; a failed fetch | `starting`; the fetches are aborted, `declined`; `failed`. "Edit files while it loads" only closes the dialog. Stage list (`S 2`): "Download the engine", "Start Python", "Load your files", "Load packages", "Start the engine" (the snapshot start differs: OQ-11). |
| `starting` | the last stage ends; the start is rejected | `ready`: the dialog closes by itself, focus goes to the editor, the live region says "Engine ready". `failed`, or `failed-twice` when the worker failed twice. |
| `ready`, `running` | a run starts; its result arrives; Break | `running`; `ready`; `breaking`. |
| `breaking` | the run ends with rc 1; 5 s pass; "Don't reset: wait for it" | `ready` (the log has "--Break--", "r(1);" and the note of `S 10`, OQ-9); reset; `waiting`. |
| `waiting` | the run ends; "Reset now" | `ready`; reset. |
| any | reset (rc 9998): Break did not stop it, the worker crashed, Reset confirmed, "Reset now" | The run in progress ends with rc 9998; a new worker starts by itself (`starting`, `ready`). Above the log (`P/Notices`): "**The engine was reset: it ran out of memory.** The data in memory is gone; your files are kept." / "Run the file again", "Dismiss" (the reason's wording: OQ-9). A second worker error before a start finishes: `failed-twice`, never a loop. |

**Not cross-origin isolated** (no `SharedArrayBuffer`) is a flag, not a state. Break reads "Break · resets" (`S 11`) and resets
at once. With the first run a warning banner shows: "**Break resets the engine on this page**, because the page isn't
cross-origin isolated (some hosts, or plain HTTP on a local network). The data in memory is lost; your files are kept."

## 6. Worker protocol (step 2; step 1 for the Python side of the new calls)

The page posts `{id, op, args}`; the worker answers `{id, result}` or `{id, error, name}`, and posts `{status}` while it starts. Ops
run one at a time in a queue, except `boot`. A file's bytes are transferred, not copied.

| Op | Args | Result | Errors | Needs | Owner after the file-store change |
|---|---|---|---|---|---|
| `mount` | `{indexURL, snapshot?, wheelName, wheelHash?, brotli?}` | none | no or stale snapshot (names `npm run snapshot`); a failed fetch | nothing | Worker. Loads Python, then copies the store into `/work` (no IDBFS). |
| `boot` | `{wheel, extraWheels, interruptBuffer}` | `About` | install or import failure | `mount` | Worker, outside the queue. |
| `startup` | none | `Startup` | | `mount` | Worker. |
| `run` | `{code, fresh_locals?, plot_theme?}` | `RunResult`; while it runs, `{id, log}` chunks | never rejects, except `busy` (rc 9998 comes from the client on a restart, on `stop()`, after the worker failed twice, with no worker, and when the run op failed in the worker: `kind: "run-failed"`, the worker stays) | engine | Worker. Then writes the run's difference to the store (section 7). |
| `describe_file` (new) | `{path}` | `DataSummary` of a .dta in `/work`, without loading it | a path outside the folder rejects; other errors are `{error}` as the result | engine | Worker. Step 1: `Engine.describe_file(path)`, `browser.describe_file(path)`. It leaves the data in memory, r() and the log as they were. |
| `describe` | `{vars?, offset?, limit?}` | `DataSummary` | `{error}` as the result | engine | Worker. |
| `matrix` | `{name}` | `Matrix` | `{error}` as the result | engine | Worker. |
| `macros` (new) | none | `Macros` | | engine | Worker. Step 1: `Engine.macros()`, `browser.macros()`. |
| `browse` (new) | `{vars?, offset?, limit?}` | `BrowseRows` | `{error}` as the result | engine | Worker. Step 1: `Engine.data_rows()`, `browser.browse()`. |
| `memory` (new) | none | `Memory` | | engine | Worker; it adds `heap_bytes`. Step 1: `Engine.memory()`, `browser.memory()`. |
| `write` | `{path, data, seq}` | none | "not in the working folder: …" | `mount` | Page first (`store.write`), then this op, which only mirrors into `/work`. `seq` is new (section 7). |
| `remove` | `{path, seq}` | none | "cannot remove the working folder" | `mount` | Same. A missing path is not an error. |
| `rename` | `{from, to, seq}` | none | as `write` | `mount` | Same. |
| `mkdir` (new) | `{path, seq}` | none | as `write` | `mount` | Same (`store.mkdir`). |
| `files`, `read` | none; `{path}` | `FileInfo[]`; bytes | | `mount` | Page: `store.list()`, `store.read()`. The worker keeps them as views of `/work` for the Node tests only. |

Not worker ops: the zip (`store.zip()`, OQ-12), the engine download, the tab lock, `storage.persist()`.

**Client** (`web/src/engine/client.js`): `download({onProgress, signal})` fetches every file the start needs into the Cache the
worker reads, counting bytes, before a worker exists; `start()`; `run(code, options)`; `breakRun()` sets the interrupt and
starts the 5 s timer; `keepWaiting()` cancels the timer and leaves the interrupt set; `restart(reason)` is Reset and "Reset
now". Today `breakRun` ties the interrupt to the timer: step 2 parts them. A `{id, log}` message goes to the run's `onLog`
callback (`run(code, {onLog, ...})`) and never settles the pending call.

As built in step 2:
- `download()` resolves `{cached: true, received, total}`, or `{cached: false, why}` (no Cache API, storage refused,
  `?snapshot=0`). On abort it rejects with an `AbortError` (the signal's reason when that is one) and no `kind`; every other
  failure is a client error with a `kind` (an unreachable list: `failed`/`download`). It checks `wheelHash` before fetching
  anything, fetches with `cache: "no-cache"`, and never caches a file whose byte count is not the listed size.
  `download()` is the Cache's only writer: the worker only reads it, so a `start()` without `download()` fetches uncached.
  The page calls `download()` before every start the user triggers (and goes on to `start()` if it fails, so an offline start
  reads what is cached); `restart()` reads what is cached. `engineBytes()` reads the page's meta tag; `startList()` fetches
  the list.
- `start()` ends any worker that exists first. A rejected `mount`, `boot` or `startup` ends the worker and detaches the store.
  A crash restarts once; a second error before a start finishes rejects `start()` with `kind: "failed-twice"`. A restart
  during `mount`, `boot` or `startup` hands the pending start to the new worker. When the browser closes the database (site
  data cleared), the worker is restarted (`kind: "crash"`, "the browser closed the file storage"), under the same guard.
- `stop(reason)` ends the worker for good (the tab lost the lock). `resetAt` is the time (epoch ms) the Break timer resets the
  engine, else null. A second `breakRun()` keeps the first deadline. Without `SharedArrayBuffer`, `breakRun()` restarts at once.
- One run at a time: `run()` while a run is pending rejects with `kind: "busy"` and never reaches the worker (a caller bug).
  `run()` with no worker resolves with an rc 9998 result, `kind: "no-engine"`. A run whose op fails in the worker (no memory
  for its result) resolves with rc 9998, `kind: "run-failed"`, the worker's message as `error`; the worker is not restarted.
- **Order on a reset:** `onRestart(reason, started, kind)` is called synchronously inside `restart()`, before the cut run's
  promise resolves with rc 9998. `kind` is `"break"`, `"crash"` or `"user"`.
- `onFileError(error, op, path)`: a mirror op failed in the worker; `/work` took the store's version and the row was deleted.
  `storeError` holds the reason the worker could not open the store at `mount`; the page's changes then still reach `/work`,
  with no `pending` row.
- **Errors** are `Error`s with `kind`: `"failed"` (`start()` could not start, or a file did not arrive as listed; with
  `reason`: `"no-wasm" | "download" | "memory" | "unknown"`, and the worker's `name`), `"failed-twice"` (with `reason`),
  `"updated"` ("dofile was updated: reload the page"), `"reset"` (a call cut by a restart; `reset` holds the restart kind),
  `"stopped"` (cut by `stop()` or a second `start()`), `"no-engine"`, `"busy"`, `"op"` (the worker answered with an error;
  `name`). The worker answers `{id, error, name}`. A snapshot of another build fails with `kind: "failed"`, `name:
  "UpdatedError"`.
- **Status texts:** the snapshot start posts "downloading the engine" (again after `download()`: then it is a cache read),
  "unpacking the engine", "loading Python", "loading your files", "starting the engine". `?snapshot=0` posts "loading
  Python", "loading your files", "loading packages", "starting the engine". A failed fetch during the start ends it with a
  `DownloadError`.
- **Test hook:** with `?test` in the URL the page sets `window.__dofile = {engine, store, start, persisted, engineBytes}`;
  with `?test=manual` it also starts no engine until the test calls `start()`. Without the flag the object does not exist.
  The real page (step 3) keeps this hook.

Types. The new calls are *proposed*; the rest is what the code returns today. Step 3 puts them in one shared file. None of the
new calls or options changes the MCP schema.

```ts
type Op = "mount" | "boot" | "startup" | "run" | "describe" | "describe_file" | "matrix" | "macros" | "browse" | "memory"
        | "write" | "mkdir" | "remove" | "rename" | "files" | "read";
type ToWorker = { id: number; op: Op; args?: object };
type StatusText = "downloading the engine" | "unpacking the engine" | "loading Python" | "loading your files"
                | "loading packages" | "starting the engine";
type FromWorker = { id: number; result: unknown } | { id: number; error: string; name?: string } | { status: StatusText }
               | { id: number; log: string };   // a chunk of a running run's log (OQ-1)
interface About { dofile: string; engine: "OpenDTA"; engine_commit: string | null; engine_patches: string[]; stata_version: number }
interface Startup {                              // seconds; the fields depend on mode
  mode: "snapshot" | "normal"; filesS: number; engineS: number;
  fetched?: "download" | "read from cache"; fetchS?: number; unpackS?: number; heapS?: number; sitePackagesS?: number;
  decoder?: "native" | "wasm" | "none"; restoreS?: number; notCached?: string[];        // snapshot
  runtimeS?: number; packagesS?: number;                                                  // normal
  storeError?: string;                           // the worker could not open the store; `/work` started empty
}
interface FileInfo { path: string; dir: boolean; size: number; mtime: number }           // path inside the working folder

type Value = number | string | null;             // null: missing "." (or infinity); ".a" to ".z": extended missing
interface ResultSet { scalars: Record<string, Value>; macros: Record<string, string>; matrices: Record<string, string> }  // "3x3"
interface Results { e: ResultSet; r: ResultSet; e_changed: boolean; r_changed: boolean }  // as `results` in MCP-SCHEMA.md
interface RunOptions {
  fresh_locals?: boolean;                        // true: clear the top-level locals first. Default false.
  plot_theme?: "light" | "dark";                 // the style of the PNGs in `images` only; `graph export` files unchanged
}
interface RunResult {
  rc: number; error: string | null; error_command: string | null; log: string;
  results: Results | null;                       // null only in the client's rc 9998 result
  nobs: number; nvars: number; new_graphs: number;
  images: string[];                              // base64 PNG, the last 5 at most
  timing?: { engine: number; encode: number; parse: number; save: number };   // seconds; absent for rc 9998
  error_line: number | null;                     // new (OQ-2): 1-based line of the failed command in the text sent; null if
                                                 // the error is inside a nested do-file, or rc 0
  graph_commands: string[];                      // new (OQ-3): the command that drew each entry of `images`, same order
  graph_lines: (number | null)[];                // new (OQ-3): 1-based line of that command in the text sent (the calling
                                                 // line for a program, the `do` line for a nested file); same order
  files?: FileChange[];                          // new: what the after-run difference wrote to the store
  store_error?: string;                          // new: the store refused that write
  skipped?: string[];                            // new: files the run made or changed strictly under a folder the page
                                                 // removed, or under the old name of a folder it renamed, during the run;
                                                 // not saved, and the page's log says so. Not listed (dropped silently, the
                                                 // page's version wins): a file the page itself changed, a run's file
                                                 // under a path the page made a file, or under a rename's new name
  kind?: string;                                 // only on the client's rc 9998 result: "break" | "crash" | "user" |
                                                 // "stopped" | "failed" | "failed-twice" | "no-engine" | "run-failed"
}
interface FileChange { name: string; status: "created" | "modified" | "removed"; bytes: number }   // as MCP's `files`
// A run cut by a restart resolves in the client as { rc: 9998, error: "session reset: <reason>. Data in memory is gone;
// your files are kept.", error_command: null, log: "", results: null, nobs: 0, nvars: 0, new_graphs: 0, images: [],
// error_line: null, graph_commands: [], graph_lines: [], kind } (step 2 adds the fields today's client leaves out).
interface Variable { name: string; type: string; format: string; label: string | null; value_label: string | null }
type DataSummary = { nobs: number; nvars: number; matched: number; offset: number; variables: Variable[]; more: number;
                     filename: string | null } | { error: string };
type Matrix = { rows: string[]; cols: string[]; data: Value[][] } | { error: string };    // names as "eq:name"

// Step 1. Python: Engine.run(code, images=False, *, fresh_locals=False, plot_theme=None, on_output=None);
// browser.run(code, images=True, fresh_locals=False, plot_theme=None, on_output=None).
// on_output(text) is called with the log as it grows, batched: at most every 100 ms within a command; what is pending is
// sent before each top-level command starts (inside a loop, block, program or nested file: when the last send was 15 ms
// ago or more), so a slow command never holds back the output before it. A runaway loop prints about 5 MB/s, and
// browser.py's Engine has no log cap today (log_keep=None), so step 1 gives it one: browser.py passes a log_keep, and past the
// cap on_output stops sending and Result.log drops the middle with a marker, as _BoundedCapture does for MCP. The worker
// passes a JS function that posts {id, log}. Result.log stays the complete text, so the CLI, MCP and tests keep one source of truth.
// Step 1 first checks that a postMessage made from Python during a run reaches the page; if not, on_output is not used.
// The new fields (error_line, graph_commands, graph_lines, describe_file, macros, data_rows, memory, fresh_locals, plot_theme, on_output)
// are on engine.Result and browser.py's JSON only: mcp_server.py does not send them, so the MCP schema does not change.
// Tempfile hint: Engine takes the text (default: today's MCP wording); browser.py passes the page's wording, a draft in step 1
// that step 4d's word list replaces (OQ-10).
interface Macros {                               // Engine.macros(): the top-level locals, and the globals
  locals: Record<string, string>; globals: Record<string, string>;
  system_globals: string[];                      // names in `globals` that still hold the engine's own value
}                                                // internal temporary names are left out (FD)
type BrowseRows = {                              // Engine.data_rows(vars=None, offset=0, limit=50); `vars` as in describe
  nobs: number; offset: number; vars: string[]; more: number;   // more: observations after this page
  rows: string[][];                              // rows[i][j]: observation offset+1+i, variable vars[j], as `list` prints it
} | { error: string };
interface Memory { heap_bytes: number; data_bytes: number }   // Engine.memory() gives data_bytes, the dataset's size; the
                                                               // worker adds heap_bytes, the size of its WebAssembly memory
```

## 7. File store contract (step 2)

**Database** `dofile`, version 1 (IndexedDB; store names *proposed*). The old IDBFS database (`/work`) is not read, changed
or imported. A file's `info` and `data` records are written and deleted in one transaction. Paths are relative, use `/`, and
never hold `..` or a leading `/`. A path whose first part is `.dofile` is refused by every store call.

| Store | Key | Value |
|---|---|---|
| `info` | `path` | `FileInfo`: one record per file or folder |
| `data` | `path` | the file's bytes (`ArrayBuffer`); none for a folder |
| `pending` | `seq` (auto) | `{op: "write" \| "mkdir" \| "remove" \| "rename", path, to?}`: a page change the worker has not mirrored yet |

```ts
interface FileStore {                                // the page's API: works with no worker, during a run, after a failed start
  list(): Promise<FileInfo[]>;                       // reads `info` only
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<FileInfo>;   // makes parent folders
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;   // a file, or a folder with everything under it
  remove(path: string): Promise<void>;               // the same
  zip(): Promise<File>;                              // "Download all (.zip)": dofile-YYYY-MM-DD.zip (local date, F 7.2),
                                                     // stored (no compression), at most 65,535 entries and 4 GB
  onChange: (() => void) | null;                     // after each page change (not after a run's write); the tree re-lists
  attach(post, opts: {onClosed, journal}): void;     // the client connects the store to its worker; journal false: no
                                                     // pending rows (a worker with no store); onClosed: database closed
  blocked: boolean;                                  // set by the page in a tab without the lock: every change rejects
}
```

| Rule | Contract |
|---|---|
| Page change while a worker exists | One transaction changes `info` and `data` and adds a `pending` row; then the page posts the op with that `seq`. The worker applies it to `/work` and deletes the row. Whenever the worker copies from the store (`mount`, the after-run write), it reads the highest `pending` seq in the same transaction (`upTo`) and ignores mirror ops up to it. A mirror op that fails: `/work` takes the store's version, the row is deleted, `onFileError`. `rename` rejects when `to` exists or lies inside `from`; `write` rejects when the path is a folder or a parent is a file. |
| Engine start | `mount` copies every record into `/work`, a plain in-memory folder, then clears `pending`. A restarted worker does the same: files come back, data in memory does not. |
| After each run | Inside the `run` op, the worker lists `/work` (path, size, mtime) before and after the run. It writes created and changed files to the store, and deletes from the store only files that were in the "before" list and are gone. `RunResult.files` lists what it wrote. Before the run it waits until the clock is past the newest mtime in the list that is not in the future (one clock step, up to 100 ms with a clamped clock), so a same-size rewrite is seen. A write the store refused is tried again by the next run. |
| A page change during a run wins | After the run the worker reads `pending` and leaves those paths (both names of a rename) out of the difference: a changed path is left out when it is a pending path, under one, or above one (for a `mkdir` row: the path and the paths above it only). The store's records for those paths go into `/work`. A run's file under a folder the page removed, or under a folder's old name after a page rename, is not saved and is listed in `RunResult.skipped`; the other dropped cases are not listed (see `RunResult.skipped`). So after a save during a run that writes the same file, the store and `/work` both hold the user's text. |
| A run that is cut | A reset, a crash or a closed tab while the run's code is still running: nothing is written to the store. A reset that lands during the after-run write may leave that run's files in the store although the client reports rc 9998. |
| Tab lock | The tab that holds the Web Lock `dofile-engine` (*proposed*) owns the engine. A tab that cannot get it shows the take-over dialog (section 5), starts no worker and writes nothing to the store (OQ-16). "Use dofile in this tab" takes the lock with `steal`; the tab that loses it ends its worker and shows the same dialog. A closed tab frees the lock. Without Web Locks (not a secure context: plain HTTP on a LAN, the dev server only) every tab owns the engine; accepted. |
| Persistence | The page calls `navigator.storage.persist()` once at start (a browser may show its own prompt, `F1` branches) and puts `persisted()` in the `persisted` signal. |
| Failures | A failed write (quota exceeded) rejects with the browser's error and keeps the old record; the tab stays unsaved. A failed after-run write sets `RunResult.store_error`. A worker that cannot open the store still mounts, with an empty `/work`, and sets the client's `storeError`. A database that cannot be opened (storage refused, some private modes) leaves nowhere to keep files. None of these states is drawn: OQ-16. |

**Tests step 2 must have** (Node with `fake-indexeddb` and the real `worker.js`, unless "e2e"):
1. Store API: write, list, read, mkdir; rename and remove of a file and of a folder; a path that leaves the folder is refused;
   `list` reads no file bytes.
2. No engine: every call works with no worker, while `mount` runs, and after a start that failed.
3. Start copy: a run reads files written before the worker existed; a write posted during `mount` is not lost.
4. After-run difference: a run that creates, changes and deletes files leaves the store equal to `/work`; an untouched large
   file is not rewritten; a file the page added during the run is still in the store.
5. A page save, delete and rename during a run that touches the same file: the store and `/work` hold the page's version.
6. Restart (rc 9998): `/work` is rebuilt from the store, `pending` is empty, the cut run wrote nothing.
7. The old `/work` database is left as it was.
8. A failing transaction rejects the page's write, and gives a run `store_error`.
9. Tab lock (e2e, two pages, each browser): the second gets no engine; take-over ends the first one's worker.
10. Download: the counts reach the total; abort leads to `declined`; a second try reuses finished files; the snapshot start
    makes no request to another origin (e2e).
11. Break: `keepWaiting()` after `breakRun()` lets a long command end with rc 1 and its data; `restart` gives rc 9998.
12. Zip: every file with its folders, no `.dofile/`, made with no engine loaded.
13. `persist()` is called once (`keepFiles(storage, onAnswer)` answers at once with `persisted()` and again when `persist()` is
    answered, since Firefox can leave it unanswered behind its prompt; a `persisted()` that rejects answers null); step 3 tests that a false value reaches the signal.

## 8. State model (step 3)

One module of signals. Components read any of them and write only through the owner named on the line. The banners for no
engine, did not start, failed twice, running, stopping, waiting and "Break resets" are drawn from `engine` and `isolated`;
they are not in `banners`.

```ts
type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";   // snapshot start: no "packages";
                                                                                   // ?snapshot=0: no "unpack" (OQ-11)
// One status text per stage: downloading the engine = download, unpacking the engine = unpack, loading Python = python,
// loading your files = files, loading packages = packages, starting the engine = engine.
interface RunHead { kind: "file" | "selection" | "command"; path?: string; lines?: [number, number]; fresh_locals: boolean }
type EngineState =
  | { s: "none" } | { s: "asking"; forRun: boolean } | { s: "declined" } | { s: "ready" } | { s: "other-tab" }
  | { s: "downloading"; received: number; total: number; t0: number }
  | { s: "starting"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }   // seconds per finished stage
  | { s: "running" | "waiting"; run: RunHead; t0: number }
  | { s: "breaking"; run: RunHead; t0: number; resetAt: number }
  | { s: "failed"; reason: "no-wasm" | "download" | "memory" | "unknown"; message: string }
  | { s: "failed-twice"; message: string };
interface LastRun extends RunHead { rc: number; line: number | null; seconds: number }
interface OpenTab { path: string; kind: "text" | "dta"; dirty: boolean }               // the text lives in CodeMirror
type LogItem = { t: "head" } | { t: "runhead"; run: RunHead; first: boolean } | { t: "text"; text: string }
             | { t: "note"; text: string } | { t: "graph"; n: number };
interface Graph { n: number; png: string; theme: "light" | "dark"; from: "run" | "file"; path?: string }
type Dialog = null | { d: "download"; forRun: boolean } | { d: "clash"; path: string; index: number; total: number }
            | { d: "delete"; paths: string[] } | { d: "reset" } | { d: "close-tab"; path: string } | { d: "other-tab" };
type Banner = { b: "reset"; reason: string } | { b: "memory" } | { b: "storage" } | { b: "not-text"; path: string }
            | { b: "save-failed"; path: string; message: string };

export const engine: Signal<EngineState>;        // the engine controller, the one wrapper around EngineClient
export const isolated: Signal<boolean>;          // set once at load from crossOriginIsolated
export const about: Signal<About | null>;        // engine controller, when boot answers
export const engineBytes: number;                // the download size, from the page's meta tag written at build (OQ-12)
export const memory: Signal<Memory | null>;      // engine controller, after the start and after each run
export const files: Signal<FileInfo[]>;          // file service, after every store change and every run
export const fresh: Signal<Set<string>>;         // file service: paths the last run created or changed (the "new" badge)
export const persisted: Signal<boolean | null>;  // file service, from storage.persist() and persisted()
export const tabs: Signal<OpenTab[]>;            // editor tabs
export const activeTab: Signal<string | null>;   // editor tabs, and the file tree when it opens a file
export const split: Signal<boolean>;             // the Log head's Split and Unsplit; kept in localStorage
export const outputTab: Signal<"log" | "graph" | "data" | "results" | "help">;   // the Output tablist; "log" only unsplit
export const phoneTab: Signal<"files" | "editor" | "log" | "data" | "results">;  // the phone's tab bar; Run sets "log"
export const log: Signal<LogItem[]>;             // run controller; "Clear log" empties it
export const lastRun: Signal<LastRun | null>;    // run controller
export const history: Signal<string[]>;          // the command line, Load and Import
export const results: Signal<Results | null>;    // run controller, from each RunResult; null after a reset
export const macros: Signal<Macros | null>;      // run controller, after each run; null after a reset
export const data: Signal<DataSummary | null>;   // run controller, after each run; null after a reset
export const rows: Signal<BrowseRows | null>;    // the Data tab ("Show 50 more" appends); the run controller resets it
export const pickedVar: Signal<string | null>;   // the Data tab
export const graphs: Signal<Graph[]>;            // run controller appends; opening a .png appends; "Clear log" empties
export const graphIndex: Signal<number>;         // the Graph tab, the full-size view and the log's graph links
export const theme: Signal<"system" | "light" | "dark">;   // the theme button
export const toast: Signal<string | null>;       // anyone, through showToast(text); it clears itself after 4 s
export const dialog: Signal<Dialog>;             // whoever opens one; the dialog closes itself
export const banners: Signal<Banner[]>;          // their owners; Dismiss removes one
export const announce: Signal<string>;           // the hidden live region: the two controllers and showToast
```

## 9. Tests (step 6)

One Playwright file per flow in `web/e2e/`, in Chromium, Firefox, WebKit and the iPhone profile. `web/e2e/poc.spec.ts` is tied
to the proof-of-concept page's element ids and is rewritten; its cases move as listed. `npm run axe`, `tabwalk`, `contrast`
and `fonts` also run over the real editor, landing and commands pages, light and dark, 1440 and 390 wide.

| Flow | The e2e test that must exist | Covered in part today by |
|---|---|---|
| F1 First visit | The prompt shows once. Download shows byte counts, the stages, then "Ready". "Stop download" and "Not now" leave a working file panel and editor, and Run reopens the prompt. A later visit shows no dialog. No request leaves the origin. A refused snapshot gives the did-not-start banner. `?snapshot=0` still starts. | poc: "the default start: from the memory snapshot…", "a snapshot from a different build of the wheel is refused…", "?snapshot=0: the normal boot…"; `web/test/engine.test.mjs`: "files can be listed, written and read while the engine is still loading…" |
| F2 Open the sample | A first visit lists the sample and opens its main do-file; a second file opens a second tab; closing an unsaved tab asks; the sample runs to a table and a graph. | poc: "Save writes the file; Discard opens the other file" (the one-file model) |
| F3 Upload a package | Files and a folder upload and show as a tree; a clash asks, and Enter, Esc and "Do the same" act as in 3.10; a Windows path in a do-file is mapped, with its note; a .dta, .csv, .log, .png and a non-UTF-8 file open as in 3.11. | poc: "the page runs .do code on uploaded files…", "legacy .xls and the ReadStat formats work…"; engine.test: "run with a Windows path…" |
| F4 Run | Run, Run selection and Ctrl/Cmd+Enter send what section 4 says (a whole file run twice gives the same result; a selection keeps locals). The run-head, the error line, "Go to line", the status bar. Run does not save; an edit during a run does not change it; the nested-do note. Graph, Data with Browse, Results with a matrix. The command line and its history. New files get the badge. | poc: "the page runs .do code…", "Save is explicit: Run doesn't save…", "the editor never rewrites a file it didn't change" |
| F5 Break | Break ends a loop with rc 1 and the data kept. A command that cannot stop shows the countdown; "Don't reset: wait for it" leads to "Reset now"; letting it count down resets. A page that is not isolated shows "Break · resets". The phone's Break ignores an early tap. | poc: the first test (Break through the real interrupt buffer); engine.test: "Break stops at a safe point and keeps the data", "restart: the run in progress ends with rc 9998…" |
| F6 Crash and Reset | Reset asks, clears the data and keeps the files. A killed worker gives the reset banner, and "Run the file again" works. A worker that fails twice shows its banner, and files still open and download. A reload brings the files back. | poc: the first test (reload, Reset); engine.test: "a worker that fails to load is replaced…", "a worker that always fails to load ends start()…" |
| F7 Download | One file from the row menu. "Download all (.zip)" with the engine up and with no engine. "Download log" holds no head and no run-head. | none |

## 10. Open questions, decided 2026-11-10

The last column is the decision: the spec's recommendation, accepted by the maintainer, except for these, which the rows
already say:
- **OQ-1:** the log streams during a run (`on_output`, section 6); step 1 checks first that it works in Pyodide, and falls back
  to the recommendation in the row if it does not.
- **OQ-6:** P2. No `changed` flag in step 1, and Load does not ask in P1.
- **OQ-17:** P2, drafts as well as the last log.
- **OQ-10, OQ-16, OQ-18:** the step 4d agent drafts the missing words (the three notes, the undrawn states, the dialogs, the
  target of "Browsers that work"); the maintainer approves the list before step 4d is merged.
- **File store (section 7):** the `pending` journal and the blocked second tab are confirmed. The old IDBFS database stays in
  the visitor's browser, unused and not deleted.

**A. The mockups draw what the engine cannot do today, and no build step covers it**

| # | What the sources say | Decision |
|---|---|---|
| OQ-1 | Log during a run. `E?r` and `WP 2` show an echo line while the run is on. `browser.run` returns the log once; `F 4.3`: "There is no current line or progress: the engine does not report any during a run." | Stream the log (`on_output`, section 6), in step 1. If a message from Python cannot reach the page during a run in Pyodide, fall back: the run-head and the running banner until the result arrives. |
| OQ-2 | Error line. `E`, `PH`: "r(111) at line 17", "Go to line 17", the error line's mark. `RunResult` has `error_command` only. | Add `error_line` to step 1 (1-based, in the text sent; null inside a nested do-file). The page adds the selection's first line. |
| OQ-3 | Which command drew a graph. `E`: the link "graph 1" under `. scatter wage educ`; "graph 1 of 1 · scatter wage educ"; images need alt text. The engine returns PNGs and a count. | Add `graph_commands: string[]` and `graph_lines`, one per image, to step 1. The page puts the link after the echo of that line and uses the command as label and alt text. |
| OQ-4 | Kinds of log line. `ui.css` styles echo, note, error and hint lines; `Result.log` is plain text. | The page classifies lines with the log tokenizer it needs for .log files (3.11). No engine change. |
| OQ-5 | A .dta's variables without loading it. `P/.dta`: "Read with `describe using`; the data in memory is untouched". Running that command would echo in the log and replace r(). | Add `Engine.describe_file(path)` (a `DataSummary`) and a worker op `describe_file` to steps 1 and 2. With no engine: the two bars and no table. |
| OQ-6 | `P/.dta`: Load "asks first if the data in memory has changed". The engine knows (`c(changed)`); no call returns it; the question is not drawn. | P2: no `changed` flag, and Load does not ask in P1. |
| OQ-7 | `P/Results` draws a group "Functions 1" and "r() · summarize". `results()` has scalars, macros and matrices; nothing records which command set r(). | P1: no Functions group; the section is titled "r()". |
| OQ-8 | Memory. `F 4.3`: "running · 3.4 s · 610 MB", but the worker cannot answer during a run. `P/Notices`: "of about 2 GB", "limit is a guess until measured". | Show the last measured value while running. No memory banner until step 7 measures a limit. |
| OQ-9 | Reasons the page cannot know. `S 10`: "Stopped by Break after pass 212 of the loop." `P/Notices`, `S 7`: "it ran out of memory". The engine reports no loop pass; a dead worker gives only an error event. | "Stopped by Break. The data is as the last complete command left it." For a reset, the client's reasons ("the code did not stop at Break", "the engine crashed", Reset by the user) in the banner's first sentence. |
| OQ-10 | Notes in the page's own words. `FD`: the log explains a `restore` with nothing preserved and a temporary name that is gone; `F 3.5` proposes a line under r(199) for community commands. No text exists. The engine's tempfile hint says "a tempfile lasts one run_do call" (`engine.py`, MCP wording) and would show in the page's log. | The step 4d agent drafts the three notes; the maintainer approves them. Step 1 lets `browser.py` pass its own tempfile wording (a draft until then). |

**B. The sources disagree, or are silent**

| # | What the sources say | Decision |
|---|---|---|
| OQ-11 | Start-up stages. `S 2`, `S 3`: five stages, "Load packages" fourth. The snapshot start (the default) loads no packages; it unpacks and restores instead (`worker.js`). | Snapshot start: "Download the engine", "Unpack the engine", "Start Python", "Load your files", "Start the engine". The drawn list for `?snapshot=0`. |
| OQ-12 | (a) The size is to come from the snapshot manifest and the runtime files' sizes (decision of 2026-11-10), but the manifest lists two of the snapshot's files, and the runtime's 5.7 MB is a compressed transfer size (12.3 MB on disk; a fetch counts decoded bytes). (b) `F 7.2` makes the zip with Python's `zipfile` in the worker; `S 6` and `S 7` offer "Download all (.zip)" when Python cannot start. (c) `S 2` caption: "what arrived stays in the cache, so a later download resumes"; the Cache API keeps whole files. | (a) The build writes one list of every start file with its size on disk and its compressed size (`start-files.json`, fetched by the download) and puts the total in the page; the prompt shows the compressed total, and the bar counts decoded bytes scaled to it. (b) Make the zip in the page from the store, with no Python. (c) Resume by file: finished files are kept, an unfinished one starts again. |
| OQ-13 | "Restore the sample" (`F 2.4`: "in the file list's menu") is missing from the head menu listed in `S 13`. | Add it above "Delete all files…". |
| OQ-14 | Phone. Only `PH` and `S 8` are high fidelity; Files, Editor, Data, Results, the full-screen graph, the tab bar and the folded file list at 700 px are wireframes (`WP`; DS-7). No phone drawing of the editor has the theme button. `WP 1`'s ⋯ (Save, Reset, Download all, About dofile) differs from `S 12`. | Build from `WP` with the `ui.css` components. Phone ⋯: Save, the theme button, then the four items of `S 12`. |
| OQ-15 | Unsplit. Only `WB` draws it (with a corner preview of a new graph and a dot on the Graph tab). No source says which layout a first visit gets. | Split is the default; Unsplit as `WB` draws it. |
| OQ-16 | States listed, not drawn (`R` "Still open, not drawn"; the flows' list of states): another tab is open (`WS 6` has words; decision 2 says the lock owns the engine, `WS 6` says "Only one tab can use your files"); the drop target and the upload count; could not save; storage unavailable; too big; the close-tab, Delete-all and name-exists dialogs; "Find" and "next error"; what a reload says about lost data (`F6` branches). | Block the second tab with `WS 6`'s words. A failed save: an error banner above the editor with Download. Drop target: an accent outline on the Files pane. The step 4d agent drafts the missing words; the maintainer approves them before step 4d is merged. |
| OQ-17 | `FD` 2026-11-08: "an unsaved draft kept in the browser's storage"; "The last log is kept across a reload". Nothing draws a restored draft; no step lists either. | P2, both. The browser's own warning on leaving with unsaved edits stays. |
| OQ-18 | No drawing: the commands page; the targets of "Browsers that work" (`S 6`) and "What dofile has" (`E` line 18). | The commands page has the landing page's top bar and footer and lists the names in columns. "What dofile has" goes to it. The step 4d agent proposes the other target; the maintainer approves it. |
| OQ-19 | Words that differ, or promise P2 work. (a) Delete: `P/Notices` against `DS` "It is removed from this browser. This can't be undone." (b) Storage: `S 19` against `DS` "Files may be cleared by the browser after a while." / "Keep files", "Not now". (c) Reset banner: `P/Notices` against `DS` "The engine stopped and was reset: **the data in memory is lost**; your files are kept." (d) Last run: `E` has "(started with no locals)", `DS` does not. (e) The dropzone says "or a .zip", and the upload report lists .zip entries and missing commands, all P2; its third trigger, "files that aren't UTF-8 text", fits every .dta. (f) `R` round 3 leaves an Import button for .xlsx to the maintainer. | The mockups' words for (a) to (d). P1 dropzone: "Drop files or folders"; no upload report in P1. No .xlsx button in P1. |
| OQ-20 | Landing claims (`mockups/README.md`: every claim "is true today, or labeled"). "from a public CDN" stops being true (3.12). "0.1 preview" (`L`) and "0.1.0" (`E?r`, `S 12`) are literals; the package says `0.1.0.dev1`. "Your files are kept in this browser between visits" and "Later visits use the copy your browser keeps" are untested per browser (UX-032). The log head says "Try: help regress" and the hint links "help summarize" while the Help tab is P2; today `help` prints in the log. | Show `About.dofile` everywhere. Keep the storage sentences and rely on `S 19`. In P1 `help x` prints in the log, and the hint's link runs it as a command. |
| OQ-21 | Small values no source fixes: whether a selection run sends whole lines (the run-head says "lines 14–15"); a run-head for a command-line command; the last-run text for rc 0; Browse's first page; when the stopping banner appears; how many graphs a session keeps; whether the theme is kept across visits; the graph card once plots are dark (`--graph-card` is white in both themes); a folder row's menu; how a new file gets its name; the sample's file names. | Whole lines. No run-head for one command. "Last run: whole file (started with no locals) · 0.38 s". 50 rows. After 1 s. 20 graphs. The theme in localStorage. The card follows the plot's theme. Folders: Rename, Download (.zip), Delete…. A new file is `untitled.do` in inline rename. `analysis.do` and `data/wages.dta`. |

**C. Open recommendations of the design-system crit** (`system/critique.md`)

| # | What it says | Decision |
|---|---|---|
| DS-5 | Text sizes in px ignore the browser's font-size setting; switching to `rem` is a change to `tokens.css` alone. | Do it in step 3; check that the log's 80 columns fit or scroll at a 20 px default. |
| DS-6 | The dark palette is written twice; `light-dark()` needs Safari 17.5. | Not now: `contrast.mjs` already fails if the copies differ. |
| DS-7 | Not on the sheet: text field states and the inline rename, the bottom sheet, the phone's tab bar, the toast's place on a phone. | Draw each in `system/index.html` in the step that builds it (4a, 3, 3, 4d). |
| DS-8 | No tokens for motion or stacking. | Add `--dur-*` and a three-step z scale (menu, toast, dialog) in step 3. |
