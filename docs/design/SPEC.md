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
- **Accessibility:** WCAG AA (text 4.5:1; edges, bars and the focus ring 3:1; the ring is 2 px on small controls and a 1 px inset ring on large areas: the editor, the log, the command line's field, the files pane). Everything works by keyboard and every focus
  stop is visible. The log is `role="log"`. The status bar is not a live region (its timer would be read every second): one
  hidden `role="status" aria-live="polite"` region says each change once ("Run started", "Run finished: error r(111) at line
  17", "Engine reset", "Engine ready", each start-up stage, each toast). Meaning is never color alone.
- **Forced colors, touch, motion:** keep the forced-colors block at the end of `ui.css` and add new bars, icons and rings to
  it. (Step 4's parts put their forced-colors rules in their own blocks of `app.css` instead: an open question, plan, "Step 4: decisions and open questions",
  C 17.) Under `pointer: coarse`, rows and menu items are 44 px, the row ⋯ 44 px square, the tab × 32 px. Hover styles only
  under `hover: hover`. Reduced motion stops the spinner and the toast's animation.
- **Glyphs:** ⌘ ▶ ■ ● ▾ ⋯ are SVG icons (`.ico`), never typed. Key chips say ⌘ on a Mac, Ctrl elsewhere; a disabled button
  shows none. The phone layout (under 700 px) shows no key chip or key hint (the shortcuts still work with a keyboard,
  app.css): a chip (`Key`) is `aria-hidden` and its control's `aria-keyshortcuts` says the key; a menu's key hint
  ("Rename F2": an item with `hintIsKey`, class `key-hint` in `ui/Menu.tsx`) is only hidden from sight, so the item's
  name keeps it; a Results row's "↵ Copy" goes (a tap copies, and the toast says so; for the maintainer to confirm: plan, "Step 4: decisions and open questions", B 8); the nested-do note (`S 15`) names
  the file dropdown's Save instead of the key (on a phone). An icon-only button has an `aria-label`.
- **Clean room** (`LICENSE-POLICY.md`): no Stata manual or help text, no Stata example datasets, nothing copied from its
  screens. **Naming:** the product is "dofile"; it runs "Stata-syntax" code.
- **Runtime:** for the snapshot start, `pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` are copied from the
  `pyodide` npm package at build time and served from the page's own origin. `?snapshot=0` keeps the CDN: a diagnostic mode.
- **From the build, never literals:** the version, and the download size: 48.6 MB for the snapshot start today (42.1 MB
  snapshot, 5.75 MB runtime, 0.68 MB page and small files). The build writes `start-files.json` (`{built, buildId, snapshot, files:
  [{path, size, compressed, download}], size, compressed}`; `compressed` is an estimate, brotli quality 5, never more than
  `size`) and puts the total in the page as `<meta name="dofile-engine-bytes">`, so the prompt has it before any download
  (OQ-12). The build fails if it cannot write either.

## 2. Pages and layout

| Page | URL | Content | Step |
|---|---|---|---|
| Landing | `/` | `L`: static HTML that shows at once. Nav: Commands, GitHub, the theme button. "Open the editor →". | 5 |
| Commands | `/commands/` | A static list made from `web/src/stata/commands.json`; no links to help pages (`R` round 1). Not drawn: OQ-18. | 5 |
| Editor | `/app/` | The app, a single-page app under its own path (one setting: `web/scripts/urls.ts`, section 8 "URLs"); its own Vite build. | 3, 4 |

**Desktop B, split** (`E`, 1440 x 900): toolbar; columns `230px | 1fr | 660px` with `--s2` gaps; status bar. The right column
is two panes: Log above (`1.35fr`, the command line at its foot) and, below (`1fr`), a tablist "Output": Graph, Data, Results
(Help is P2: leave the tab out). The Log head has "Find", "Download log", "Clear…" (accessible name "Clear log…"; it asks first, 3.10, and is disabled when there is nothing to clear) and "Split"/"Unsplit" (an icon left of its word); in the unsplit head, when it is narrow, the three log actions collapse into one "Log actions" ⋯ menu button and the tabs are never clipped. Unsplit exists only as a wireframe
(`WB`): one pane with tabs Log, Graph, Data, Results and "Split"; the choice is kept in the browser (OQ-15). Focus order:
toolbar, files, editor, output, command line, lower pane (`WB`).

**Phone** (`PH`, `WP`; under 700 px): top bar, the view, the command line (on the Log view only: `WP 1`, the Editor view,
has none), and a bottom tablist "Views": Files, Editor, Log, Data, Results. The top bar has a title (on the Editor tab it is the file switcher, `WP 1`: a menu with Save at the top, the open files in a list that scrolls (at most 60% of the window's height), then "Close <file>" and "Show all files", which stay in reach), ⋯ and one Run button. The strip under it carries a button at its right end: "Files ⋯" (accessible name "File actions") on the Files view and "Log ⋯" ("Log actions": Find, Download log, Clear log…; the last asks first and is disabled with nothing to clear) on the Log view; the word is hidden when the strip is narrow, leaving the ⋯; the strip is one height on every view, with or without the button, whose tap target is 44 px tall (UI fix round, 2026-11-12; it replaces the file actions in the top bar's ⋯). Graphs show
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
  Replacing the open file reloads it in the editor (`F 3.3`). P1 stores a .zip as one file. Uploads run one at a time, a
  name clash never replaces another dialog (it waits for it to close), and a drop while a dialog is open, or while another
  tab has the files, uploads nothing. A name with a control character (a line break) is refused, as the store refuses a
  file, and counted in the toast.
- **Row menu** (`S 13`): "Open", "Rename" (hint F2; edits the name in place), "Download", rule, "Delete…" (asks, 3.10). From
  the row's ⋯ (on the hovered, focused or open row; always on touch), right click, Shift+F10 or the menu key.
- **Head menu** ("File actions", `S 13` caption): "New .do file", "New folder", "Upload a folder", "Download all (.zip)",
  "Delete all files…" (asks first, `FD`; the words are in 3.10). "Restore the sample" (`F 2.4`, OQ-13; built in step 5) sits above "Delete all files…", after a rule.
- **States:** drawn: open, unsaved dot, hover, folder open and closed, size, new badge (`E`), row menu (`S 13`). In the flows'
  list, not drawn: drop target, upload count (`WS 4`), inline rename and "name already exists" (DS-7), could not save, too big
  (OQ-16).
- **Keyboard and ARIA:** `role="tree"`, flat rows with `aria-level`, `aria-expanded` on folders, `aria-selected`,
  `aria-haspopup="menu"`. Roving focus: one row in the tab order (the open file); arrows move, Enter opens (3.11), F2 renames.
  The ⋯ is `aria-hidden` (a control inside a treeitem would be nested).

### 3.2 Editor tabs (P1, step 4a)
- One tab per open file, several at once (`FD` 2026-11-08; `F 2.2`, where opening replaced the text, is superseded). A tab
  shows the name, the unsaved dot and a ×. Closing an unsaved tab asks first (`E` comment; not drawn; the words are in 3.10). Leaving the page
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
  second Enter cannot reach Break. **With no engine nothing offers to run, and Run is "Start engine"** (the play icon;
  no key chip): a press, and Ctrl/Cmd+Enter, which does exactly what the button does (held, once), open the download
  prompt (`none`, `asking`, `declined`), try the start again as the failed banner's "Try again" does (`failed`, where
  the banner has that button), or go into the take-over dialog (`other-tab-idle`; never straight to a start); they run
  nothing, then or when the engine is ready. Run selection is disabled then. Run itself is never `disabled`: off, it is
  `aria-disabled` with `.off`, so a Run that has the focus keeps it when its state turns it off ("Start engine"
  pressed by keyboard after a failed start becomes "Starting…"), and a press of it then says why in a toast, in the
  words Ctrl/Cmd+Enter gives, except while a run is on. "Start engine" is one of the labels the
  button holds in its one cell, so the button is as wide with "Run" as with "Start engine" and the toolbar does not
  move. The table of states is in section 5; the code's one statement of it is `app/start.ts`, and the flow is in
  `docs/web-page-flows.md`, section 2.
- **Break** (`.btn.stop`): outlined and disabled when idle, filled red (`.live`) while running; its other labels are in
  section 5. **Save** has the dot when the active tab is unsaved, and the "⌘ S" chip.
- **⋯ menu** (`S 12`): "Download all (.zip)" (disabled while the store has no file), "Wrap lines" (a switch, below), "Reset the engine…",
  rule, "Commands" (the commands page), "About dofile" with the version at the right (the landing page, `WP 1`). "Commands" and "About dofile"
  open in a new tab, since leaving the editor would end the engine. "Clear log" is not here: the Log head has it (on a phone, the strip's "Log ⋯").
  "Wrap lines" is a display preference kept in the browser (`dofile.wrap`): the editor and the log wrap long lines when it is on.
- **One size** (step 3): no change of engine state, selection or unsaved edits changes the toolbar's height or moves anything
  but the button that changed. Each button is as wide as its widest label (all its labels in one cell, the others
  hidden), so the state labels are short (the icon says Run or Break: "Starting…", "Not started", "Break (reset)"), and the bar is one
  row. Every toolbar button is one height (`--control`, 2rem), with or without a key chip; ⋯ is square. The phone's Run and
  Break pill are bigger, the primary action. A pane head's controls (the "Files" fold button, Split, Unsplit, the Log
  head's actions) share one smaller height (`--control-sm`). Below 56em (896 px at the default font size) the theme button shows its icon only and Run
  selection and Save drop their key chips, so the bar fits from 700 px; with a larger font it scrolls sideways rather than
  widen the page. The phone's Run and its Break pill have one width (every label of both). In `other-tab` the run buttons
  keep their place, unseen.
- **Phone** (`PH`, `PH?r`, `WP 1`, `WP 2`): one Run button; with a selection its label names the lines ("Run 6–7", "Run 6" for one line; named "Run lines 6–7", "Run line 6"). Run
  opens the Log tab. While running, Break takes Run's place as a pill with the time ("Break" "3.4 s") and ignores taps in its
  first 600 ms. Reset is in ⋯, which is Theme, Wrap lines, Reset the engine…, Commands, About dofile. The theme button's place: OQ-14.

### 3.5 Log pane and command line (P1, step 4b)
- **Lines, top to bottom** (`DS` "Log"): the head (`.head`: banner B2, `book+drop+skew` in `mockups/art.js`, `aria-hidden`;
  "dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax" from `ABOUT` (`web/src/app/env.ts`: compiled in, section 8); "Files stay in this browser. Try: help regress"); per run a
  run-head (`.runhead`, section 4); each echo (`.echo`); output; notes (`.note`: the path shim's "(path … is … in the working
  folder)"); the error and its `r(N);` (`.err`); the engine's hint (`.hint`); "Go to line 17" (`.jump`), which moves the
  editor's cursor. Mono at `--log`, 80 columns, no wrapping unless "Wrap lines" is on (class `.log.wrap`); wide tables scroll sideways. The notes at a run's end are the
  exception: they wrap in the pane (section 8, "As built in step 4b").
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
  command" (on a phone a compact icon button at the right end, the Run triangle with the accessible name "Run command": a
  tap runs the text as Enter does and the field keeps the focus, so the keyboard stays open; it is `aria-disabled`, not
  `disabled`, while the field is empty, since a tap on a disabled button would take the focus away). The field asks the
  phone's keyboard for plain typing: `autocomplete`, `autocapitalize` and `autocorrect` "off", `spellcheck` false,
  `enterkeyhint` "go", and `data-1p-ignore` and `data-lpignore` against password managers; the other text fields (Find,
  Filter variables, the rename field) and CodeMirror's content say off too. A curly quote (U+2018, U+2019, U+201C,
  U+201D) or an em dash (U+2014) that the keyboard's Smart Punctuation makes of typed text becomes `'`, `"` or `--`
  (`src/stata/straighten.ts`), in the command line and in a .do or .ado buffer; never in a paste or a drop, in the en
  dash, or in text already there. Enter runs; ↑ ↓ recall earlier commands; it waits while a run is on (`WP 2`). A command that does not run (the
  engine can't take it now: it is asking, downloading, starting, failed or in another tab; or a run is on) stays in the
  field and is not added to the history; One that runs is cleared from the field and added
  to the history, also when it ends in an error. While the engine is there or on its way but not ready (the page load, a
  download, a start, a run) the field stays on, so a draft can be typed, the button is off (`aria-disabled`), and
  Enter with text, or a press of the off button, says why in a toast (the words Ctrl/Cmd+Enter gives; the text stays);
  a paste of several lines is refused whole then, with the field left exactly as it was and the toast "3 of 3 pasted
  lines not run: the engine can't take a command now". **With no engine** (section 5; `app/start.ts`) the field is off
  (`aria-disabled` and read-only, not `disabled`: a field that has the focus when a start fails keeps it),
  with the hint "Start the engine to run code" as its placeholder, a dashed border, `cursor: not-allowed` and a muted (not accent) focus ring, so the hint shows only while the field is empty.
  Enter in the off field says the hint in a toast. Turning the field off never changes its text: a typed draft stays, greyed, and is usable when the engine is back. The
  hint and the draft are the muted color at full opacity (the text contrast, 4.5), not the disabled opacity. The
  button is then "Start engine" (what the toolbar's does), in words on a phone too: no width is reserved for it, so
  the phone's button is the 44 px icon with an engine and wider without one, and the field takes what is left. A paste
  into the field with no engine is an ordinary paste. The log's `help x` links are off then (`aria-disabled` and
  `.off`, still focusable): a press runs nothing and a toast says "Start the engine to see help regress", or, where nothing can
  start the engine from the page, "The engine isn't running: can't see help regress".
- **Phone only** (`PH`): a strip under the top bar ("r(111)", "line 17 · 0.38 s", "Engine 612 MB", "Go to line 17"; running:
  "Running lines 14–15", "Engine 612 MB"); the hint as a block (`.explain`); "← wide table: swipe sideways →".
- **States:** drawn: after an error (`E`, `PH`), first run running (`E?r`, `PH?r`), stopping and waiting (`S 9`, `9b`), stopped
  by Break (`S 10`), nested do with unsaved edits (`S 15`). Not drawn: the notes of OQ-10.

### 3.6 Status bar (P1, step 4b)
- Left to right (`E`): state dot and word, the last run, "Engine memory 612 MB" (a tooltip says it is the memory the engine has reserved, which a browser gives back only when the engine restarts), spacer, "Not affiliated with StataCorp", "Files
  are kept in this browser" (or "Files may be cleared by this browser", `S 19`). The affiliation line is muted text, no
  link, no tab stop, not a live region; screen readers get `LICENSE-POLICY.md`'s sentence, "Stata is a registered
  trademark of StataCorp LLC; dofile is not affiliated with StataCorp.", which is also the short text's `title`. It shows
  from 1200 px only: at 1200 px the widest bar (ready, the longest last run, "Engine memory 4,096 MB", "Files may be cleared by
  this browser") leaves about 143 px beside it, so under about 1060 px it would not fit; the phone has no status bar,
  and the landing page carries the line. State texts: section 5. Last run: "Last run: whole file (started with no locals)
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
  `plot_theme`: the page's resolved light or dark. Graphs already drawn keep their colors, and a graph is drawn in the run's theme whatever colors its command names (decided 2026-11-11: `docs/prototype1-plan.md`, 4c). The card of a run's graph follows the run's theme; a .png from the files is always on the light card (its colors are its own). Alt text: the graph's command from `graph_commands`, for example "Graph: scatter wage educ" (OQ-3).

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
| Name clash (4a) | `P/Name clash` | `role="alertdialog"`. "data/wages.dta is already here" / "The upload has a file with the same name. Keep yours, or replace it with the uploaded one?" / "Yours: 8 KB, 9 Nov · uploaded: 15 KB · clash 2 of 5 · the other 37 files are uploaded." / checkbox "Do the same for the other 3 clashes" / "Replace with uploaded", "Keep mine" (primary, focused). Enter keeps this one. Esc keeps yours for every remaining clash and stops asking. For the open file with unsaved edits: "analysis.do is open with unsaved edits; replacing it discards them"; such a clash is asked even after "Do the same" with Replace (not after Esc, or "Do the same" with Keep mine: keeping it loses nothing; an open question: plan, "Step 4: decisions and open questions", C 14). |
| Delete (4a) | `P/Notices` | "Delete clean.do?" / "It exists only in this browser. This can't be undone." / Cancel (focused), Delete. `DS` words it differently: OQ-19. |
| Reset | `S 14` | `role="alertdialog"`. "Reset the engine?" / "The data in memory, e() and r() results, macros and graphs are cleared, as if you had reloaded. Your files are kept." / Cancel (focused), Reset. Not asked while the engine is new or just reset (nothing has run on it since it started). |
| Upload report | `P/Upload report` | Drawn with P2 content only. P1: the toast "3 files uploaded" (OQ-19). |
| Another tab | `WS 6` (wireframe) | Sections 5 and 7. |
| Close a tab with unsaved edits (4a) | not drawn; words decided 2026-11-10 | "Save changes to clean.do?" (the file's name) / **Save** (focused), **Don't save**, **Cancel**. Esc is Cancel. Save saves, then closes the tab; Don't save closes it and drops the edits. |
| Delete all files (4a) | not drawn; words decided 2026-11-10 | "Delete all 12 files?" (the count of files, not folders) / "This removes every file dofile keeps in this browser. This can't be undone." / **Cancel** (focused), **Delete all** (`.btn.stop.live`). |
| Clear the log (step 4d fix round) | not drawn; words are drafts (section 8, "Clear log dialog: draft words") | `role="alertdialog"`. "Clear the log?" / "This removes the log and the graphs. Your data and your files stay." / **Cancel** (focused), **Clear log** (`.btn.stop.live`). Opened by the Log head's "Clear…" and the menus' "Clear log…"; those are disabled when the log holds only its head (or only the running run's text) and there are no graphs. Esc is Cancel. A run in progress keeps its text item. |
| Load over changed data | not drawn | P2 (OQ-6). |

- **Banners** sit in a pane above its content until their cause goes or they are dismissed; warning and error banners carry
  the warning icon. Above the editor: no engine (`S 5`), did not start (`S 6`), failed twice (`S 7`), storage (`S 19`: "**This
  browser may clear your files** when it needs space. Download all to keep a copy." / "Download all (.zip)", "Dismiss"; when
  `persisted()` is false, once per visit after files change). Above the log: running (`E?r`), stopping (`S 9`), waiting
  (`S 9b`), Break resets (`S 11`), reset (`P/Notices`). The memory banner is not built (no limit is measured, OQ-8; the code was removed in the post-merge review). In the Files pane: not UTF-8.
- **Toast** (`DS`; no mockup): a confirmation with no buttons ("Saved analysis.do", "Copied", "3 files uploaded"), or an
  error that needs no action from the visitor (a copy the browser refused, a matrix that could not be read, a load that
  failed with its rc: "Couldn't load wages.dta: r(601)"; decided 2026-11-11); inverted colors, bottom center above the
  status bar, one at a time, never focused, no buttons; the live region says the same words. It stays 60 ms a character, 4 s at least (6 s at least for an error), 10 s at most, and longer while hovered; an error shows the warning icon, a confirmation the check mark (`showToast(text, "error")`); a long toast wraps inside the viewport.
  Anything the visitor must act on, or choose between, is a banner or a dialog. Its place on a phone: DS-7; it sits lower on the views with no command line (UI fix round, 2026-11-12).
- **Menus** (`DS`): buttons with `role="menuitem"` (a switch item, "Wrap lines", is `role="menuitemcheckbox"` with `aria-checked`, drawn as a track and knob at the right); arrows move, Esc closes; a key hint at the right; a destructive item in
  the error color, with "…" when it asks first. The trigger has `aria-haspopup="menu"` and `aria-expanded`.

### 3.11 Opening files (P1, step 4a; .dta and .png with 4c)
A file is text when its bytes decode as strict UTF-8: `decodeText` in `web/src/app/files/open.ts`.

| File | Opens as | Drawn |
|---|---|---|
| .do, .ado | Editor tab with our highlighter. | `E` |
| .dta | A tab that is not an editor. Bar 1: "data/wages.dta · 500 obs · 3 vars · 8 KB". Bar 2: `use "data/wages.dta", clear`, "Load" (primary), "Copy" (`aria-label="Copy the use command"`). Then the variables table and "Read with `describe using`; the data in memory is untouched until you press Load." The table comes from the `describe_file` op (OQ-5); with no engine, the two bars and no table, and Load is off (`aria-disabled` and `.off`, still focusable): a press loads nothing and a toast says "Start the engine to load wages.dta". | `P/.dta` |
| .csv, .tsv | Editor tab, each column its own color (a small tokenizer: commas outside quotes). Bar 1: "data/raw/survey.csv · 1,204 rows". Bar 2: `import delimited "data/raw/survey.csv", clear`, "Import", "Copy" (`aria-label="Copy the import command"`). With no engine Import is off as Load is: "Start the engine to import survey.csv". | `P/.csv` |
| .log | Editor tab with a small log tokenizer (commands bold, errors red). Bar: "output/analysis.log · written by the last run", "Download". | `P/.log` |
| other UTF-8 text | Editor tab; .md and .json with CodeMirror's packages, anything else plain. P2: .py, .R, .tex, .sql, .yaml. | `P/.log` caption |
| .png | The Graph tab, and full size the same way. | `S 16` (text) |
| not UTF-8 (.xlsx, ...) | No tab. A warning banner in the Files pane: "**survey.xlsx can't be opened in the editor.** It isn't UTF-8 text, so the editor would change it. Download it to edit it elsewhere." / "Download", "Dismiss". No Import button for .xlsx (OQ-19). | `P/.xlsx` |

In the `use` and `import delimited` commands a `$` in the path is written `\$`, and a double quote puts it in compound
quotes. A name the command cannot hold (a backquote, a control character, `"'`) gives no command: bar 2 says why in its
place and Load or Import and Copy are off (`web/src/stata/quote.ts`).

### 3.12 Landing page, commands page, sample (P1, step 5)
- Build `L` as drawn, desktop and phone. The banner and the do-file drawing are `aria-hidden`, with a hidden plain-text copy
  that holds no link. Each Copy button names what it copies; it shows a clipboard icon and "Copy", and for 2 s after a press
  a check and "Copied" in its place (both faces in one cell, so it keeps its width; its name does not change), and the live
  region says "Copied to the clipboard". It fits inside its code box (26 px high, taking one code line's height; WCAG 2.2's
  24 px target, also with a finger). `pip install dofile` keeps its label "with the first release". The theme button keeps
  its word (System, Light, Dark) down to 360 px; below that it shows the icon only, its `aria-label` unchanged (at 320 px the word pushed it past the edge) and its icon says the choice: a screen, a sun, a moon (`.i-theme` in `ui.css`,
  from `<html data-theme>`, so the editor's theme button shows the same three). welcome.do (desktop) and "What a run looks
  like" keep their lines and scroll sideways where their column is too narrow (each a `<section>` in the tab order, named
  "welcome.do" and by its heading), never the page. The phone's banner is five block lines with nothing between them in
  the `<pre>` (a line break there drew an empty line between each two rows, and the strokes no longer joined).
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
  do runs the saved file. Save it (⌘ S) to run your edits." (Ctrl S off a Mac; on the phone layout "Save it (the file name's menu › Save) to
  run your edits.")
- Load and Import run their shown command as if typed in the command line: echoed in the log, added to the history (↑ brings
  it back), never written into a do-file. Load does not ask first in P1 (OQ-6: P2). Copy puts the command on
  the clipboard.
- After every run the page calls `describe`, `browse`, `macros` and `memory`, and lists the store.
- An error stops the run; the data is as the last complete command left it. "Run the file again" (the reset banner) runs the
  whole file whose run the reset cut (a Break or a crash during a file run; not after a Reset the visitor asked for).

## 5. Engine states (P1; step 2 for the client, 4b and 4d for the views; the machine, step 3.5 C)

One state at a time, in the `engine` signal (section 8). The states are the sixteen members of `State` in the engine's state
machine, `web/src/engine/machine.ts`: `checking-lock`, `checking-cache`, `none`, `asking`, `declined`, `downloading`,
`starting-list`, `starting-worker`, `ready`, `running`, `breaking`, `waiting`, `failed`, `failed-twice`, `other-tab-idle`,
`other-tab-taking`. The same names are in the `engine` signal, in `<html data-engine>`, in the table below and in the
matrix after it; no mapping stands between them. A row below that lists two states (the page load, `starting-*`,
`other-tab-*`) draws them alike. `**` marks `<b>` in the mockups.

| State | Status bar | Dialog or banner | Run | Break |
|---|---|---|---|---|
| `checking-lock`, `checking-cache` | "**Loading**" (step 4b's word for the page load; decided 2026-11-12) | none | "Run", disabled | disabled |
| `none` | "No engine yet" | none (`none` is seen only with `?test=manual`: no start until the test calls `start()`) | "Start engine": opens the prompt | disabled |
| `asking` | "No engine yet" | Blocking prompt `S 1` (phone `S 8`): "Download the engine?" (its one title), its two paragraphs, "Not now", "Download 48 MB" (default) | "Start engine" (under the prompt): the prompt again | disabled |
| `declined` | "**No engine** · Start engine downloads it" | `S 5`: "**The engine isn't downloaded.** You can open, edit, upload and download files; running code needs the engine (about 48 MB)." / "Start engine" (opens the prompt, as the toolbar's) | "Start engine": opens the prompt; nothing runs, then or when the engine is ready | disabled |
| `downloading` | "**Starting** · downloading" | `S 2`: "Getting the engine ready" / "**Downloading**" "14.2 of 48 MB · 6 s" / the bar / the stage list / "Stop download", "Edit files while it loads" (focused) | "Starting…" (the play icon; named "Starting… Run is not available until the engine is ready"), disabled | disabled |
| `starting-list`, `starting-worker` | "**Starting** · loading packages (step 4 of 5) · 2.1 s" (the drawn text, for `?snapshot=0`; the snapshot start names its own stages, OQ-11); at the right "You can edit and upload while it starts" (`S 4`) | While the dialog is open, `S 3`: "**Loading packages**" "step 4 of 5 · 9 s"; no bar; done stages keep their time | "Starting…" (the play icon; named "Starting… Run is not available until the engine is ready"), disabled | disabled |
| `ready` | "**Ready**", the last run, memory (`E`) | none | enabled | disabled |
| `running` | "**Running** lines 14–15 · 3.4 s" (`E?r`); "**Running** · 12 s" (`S 11`) | Log banner (`E?r`): "Running lines 14–15 · **3.4 s**. Break stops between commands. If one long command doesn't stop within 5 s, the engine is reset: **the data in memory is lost**; your files are kept." | `aria-disabled` | "Break", live |
| `breaking` | "**Stopping** · resets in 4 s", the run's time | `S 9` from the press until the engine confirms (OQ-21): "**Stopping…** This command can't stop until it ends. **In 4 s the engine is reset:** the data in memory is lost; your files are kept." / "Don't reset: wait for it" (focused), after 1 s | disabled | "Stopping…", disabled |
| `waiting` | "**Waiting** · Break after this command", the run's time | `S 9b`, a banner with `tabindex="-1"` that takes the focus: "**Waiting for this command to end.** The Break is still pending: the run stops after this command, with the data kept. If it never ends, **Reset now** resets the engine: the data in memory is lost; your files are kept." | disabled | "Reset now", live; asks nothing |
| `failed` | "**Not started** · the engine didn't start" | `S 6` (not `role="alert"`: the live region says "The engine didn't start" once): "**The engine didn't start:** this browser has no WebAssembly support. Your files are safe: you can still edit and download them." / "Browsers that work" (a link), "Download all (.zip)". Other reasons, other first action: download failed, "Try again"; not enough memory, "Try again", after a message that says "Close other tabs, then try again" (`FAILED` in `engine.ts`). | "Start engine" where the banner has "Try again" (download, memory, unknown): the same new try. Else (no-wasm, updated) "Not started" (the play icon; named "Not started: the engine didn't start, so Run is not available"), disabled | disabled |
| `failed-twice` | "**Stopped** · failed twice" | `S 7` (not `role="alert"`; the live region says it once): "**The engine stopped after failing twice (out of memory).** It won't restart by itself, since each attempt can use a lot of memory. Your files are safe." / "Reload the page", "Download all (.zip)" | "Not started" (the play icon; named "Not started: the engine didn't start, so Run is not available"), disabled | disabled |
| `other-tab-idle`, `other-tab-taking` | "**Paused** · another tab has the engine" | `WS 6`, blocking: "dofile is open in another tab" / "Only one tab can use your files at a time, so they are not overwritten. The other tab keeps its data until you take over here." / "Close editor" (focused, so a stray Enter does not take over), "Use dofile in this tab". WS 6 draws "Close this tab", but a page may close only a tab a script opened: "Close editor" goes to the landing page (`landing.html`, built in step 5) | none shown (hidden, under the blocking dialog). "Start engine" in `other-tab-idle` (Ctrl/Cmd+Enter, the command line's button, should the dialog not be up) opens this dialog again and takes no lock; off in `other-tab-taking` | none |

**With no engine nothing offers to run** (decided 2026-11-12). "No engine" is `none`, `asking`, `declined`, `failed`,
`failed-twice`, `other-tab-idle` and `other-tab-taking` (`app/start.ts` `startOffer`; not the page load, nor a download
or a start in progress, where the engine is on its way and Run is disabled). In those states: Run is "Start engine" (the
Run column above), Run selection is disabled, the command line is disabled with its hint (section 3.5), a paste into
it is an ordinary paste, and Load, Import and the log's `help x` links are off and say why in a toast. Nothing runs
when the engine becomes ready: no state carries a run, or a mark that a run was wanted. A returning visitor whose
browser has the engine never sees "Start engine": "Run" (disabled, the page load), "Starting…", "Run".
In the Run column "disabled" is the look and the role, not the attribute: Run is `aria-disabled` with `.off` and stays
focusable (section 3.4).


### Transition matrix

What each event does in each state: the state it leads to. The machine's function `transition(machine, event)` is pure and
is the only place that decides; the engine controller (`web/src/app/engine.ts`) feeds it events and performs the effects it
returns. This matrix is generated from that function by `web/test/machine.test.ts`, and the same test reads it back from
this file and fails, naming the cell, when a cell differs. To regenerate it after a change to the machine:
`PRINT_SPEC_MATRIX=1 node --test test/machine.test.ts` (from `web/`), and paste the five tables below. What each cell
does besides changing the state (the effects, in order, and the crash count) is in `docs/prototype1-step3.5-c-design.md`,
item 4.2, and is tested there cell for cell.

Rows are states, columns are events. A cell is one of:

- `·`: the event is not valid in this state. The machine returns the same machine with no effects, and the controller
  records the drop (`drops()`).
- `STALE`: the event answers a request (it carries a ticket) and the state has none to answer: it is always dropped.
- one state, or several separated by ", ": the state the event leads to. Several when the cell depends on the event's
  payload or on the machine: `lock-answered` in `checking-lock` leads to `checking-cache`, or to `none` with
  `?test=manual`, or to `other-tab-idle` when another tab holds the lock; `cache-checked` to `downloading` (cached) or
  `asking`; `crashed` in `starting-worker` to
  `starting-list` (the first crash) or `failed-twice`; `break` in `running` to `breaking`, or to `starting-list` on a page
  that cannot ask a run to stop. The same state as the row is a cell that changes only a field (`downloading` on progress,
  `starting-worker` on a stage).

A request has a ticket, a number the machine issues (the tab lock, the cache check, the download, each worker, each
take-over); an answer presents it, and an answer whose ticket is not the state's current one is stale and is dropped, in
every state. So an event with a ticket that is not the state's is dropped whatever the cell says; `STALE` marks the states
that hold no ticket at all. `lock-lost` (another tab took the lock) is valid in every state but `other-tab-idle`.

**A. The visitor's engine actions**

| State | `start` | `ask` | `decline` | `stop-download` | `reset` | `take-over` |
|---|---|---|---|---|---|---|
| `checking-lock` | · | · | · | · | · | · |
| `checking-cache` | · | · | · | · | · | · |
| `none` | downloading | asking | · | · | · | · |
| `asking` | downloading | asking | declined | · | · | · |
| `declined` | downloading | asking | · | · | · | · |
| `downloading` | · | · | declined | declined | · | · |
| `starting-list` | · | · | · | · | · | · |
| `starting-worker` | · | · | · | · | · | · |
| `ready` | · | · | · | · | starting-list | · |
| `running` | · | · | · | · | starting-list | · |
| `breaking` | · | · | · | · | starting-list | · |
| `waiting` | · | · | · | · | starting-list | · |
| `failed` | downloading | · | · | · | · | · |
| `failed-twice` | · | · | · | · | · | · |
| `other-tab-idle` | · | other-tab-idle | · | · | · | other-tab-taking |
| `other-tab-taking` | · | · | · | · | · | · |

**B. Tab lock and cache check**

| State | `lock-answered` | `lock-lost` | `cache-checked` |
|---|---|---|---|
| `checking-lock` | checking-cache, none, other-tab-idle | other-tab-idle | · |
| `checking-cache` | · | other-tab-idle | downloading, asking |
| `none` | STALE | other-tab-idle | STALE |
| `asking` | STALE | other-tab-idle | STALE |
| `declined` | STALE | other-tab-idle | STALE |
| `downloading` | · | other-tab-idle | · |
| `starting-list` | · | other-tab-idle | · |
| `starting-worker` | · | other-tab-idle | · |
| `ready` | · | other-tab-idle | · |
| `running` | · | other-tab-idle | · |
| `breaking` | · | other-tab-idle | · |
| `waiting` | · | other-tab-idle | · |
| `failed` | STALE | other-tab-idle | STALE |
| `failed-twice` | STALE | other-tab-idle | STALE |
| `other-tab-idle` | STALE | · | STALE |
| `other-tab-taking` | checking-cache, none, other-tab-idle | other-tab-idle | · |

**C. Download and the build's list**

| State | `download-progress` | `download-done` | `download-failed` | `list-checked` | `list-failed` |
|---|---|---|---|---|---|
| `checking-lock` | · | · | · | · | · |
| `checking-cache` | · | · | · | · | · |
| `none` | STALE | STALE | STALE | STALE | STALE |
| `asking` | STALE | STALE | STALE | STALE | STALE |
| `declined` | STALE | STALE | STALE | STALE | STALE |
| `downloading` | downloading | starting-worker | failed | · | · |
| `starting-list` | · | · | · | starting-worker | failed |
| `starting-worker` | · | · | · | · | · |
| `ready` | · | · | · | · | · |
| `running` | · | · | · | · | · |
| `breaking` | · | · | · | · | · |
| `waiting` | · | · | · | · | · |
| `failed` | STALE | STALE | STALE | STALE | STALE |
| `failed-twice` | STALE | STALE | STALE | STALE | STALE |
| `other-tab-idle` | STALE | STALE | STALE | STALE | STALE |
| `other-tab-taking` | · | · | · | · | · |

**D. Worker start and crash**

| State | `stage` | `started` | `start-failed` | `crashed` |
|---|---|---|---|---|
| `checking-lock` | · | · | · | · |
| `checking-cache` | · | · | · | · |
| `none` | STALE | STALE | STALE | STALE |
| `asking` | STALE | STALE | STALE | STALE |
| `declined` | STALE | STALE | STALE | STALE |
| `downloading` | · | · | · | · |
| `starting-list` | · | · | · | · |
| `starting-worker` | starting-worker | ready | failed | starting-list, failed-twice |
| `ready` | · | · | · | starting-list |
| `running` | · | · | · | starting-list |
| `breaking` | · | · | · | starting-list |
| `waiting` | · | · | · | starting-list |
| `failed` | STALE | STALE | STALE | STALE |
| `failed-twice` | STALE | STALE | STALE | STALE |
| `other-tab-idle` | STALE | STALE | STALE | STALE |
| `other-tab-taking` | · | · | · | · |

**E. Runs**

| State | `run` | `break` | `keep-waiting` | `run-ended` | `run-failed` | `break-timeout` |
|---|---|---|---|---|---|---|
| `checking-lock` | · | · | · | · | · | · |
| `checking-cache` | · | · | · | · | · | · |
| `none` | · | · | · | STALE | STALE | STALE |
| `asking` | · | · | · | STALE | STALE | STALE |
| `declined` | · | · | · | STALE | STALE | STALE |
| `downloading` | · | · | · | · | · | · |
| `starting-list` | · | · | · | · | · | · |
| `starting-worker` | · | · | · | · | · | · |
| `ready` | running | · | · | · | · | · |
| `running` | · | breaking, starting-list | · | ready | ready | · |
| `breaking` | · | · | waiting | ready | ready | starting-list |
| `waiting` | · | · | · | ready | ready | · |
| `failed` | · | · | · | STALE | STALE | STALE |
| `failed-twice` | · | · | · | STALE | STALE | STALE |
| `other-tab-idle` | · | · | · | STALE | STALE | STALE |
| `other-tab-taking` | · | · | · | · | · | · |

What the cells mean as a visitor meets them:

| From | Event | To, and what happens |
|---|---|---|
| `checking-lock` | the tab lock is taken by another tab | `other-tab-idle`. "Use dofile in this tab" (`take-over`) takes the lock with `steal` (`other-tab-taking`) and goes on as a page load; the tab that lost it ends its worker and shows the same dialog (`lock-lost`). "Close editor" leaves for the landing page; the other tab keeps the lock. A tab that loses the lock while it asks for it (`checking-lock`, `other-tab-taking`) drops the late answer. |
| `checking-lock` | the lock is this tab's | `checking-cache` (or `none` with `?test=manual`): the store is unblocked and listed, and `client.cached()` is asked. |
| `checking-cache` | this build's start files are not all in the Cache (`client.cached()`: every file `start-files.json` marks `download` is in `dofile-snapshot-<built>`; false offline, with no Cache API, storage refused or `?snapshot=0`) | `asking`. Otherwise `downloading` then `starting-worker`, with no dialog (`S 4`). There is no "downloaded" flag: evicted or cleared files, a partial download, or a new build ask again. |
| `asking` | "Download 48 MB"; "Not now" | `downloading`; `declined`. From `declined` (and `none`), "Start engine" (the toolbar's, the command line's, the banner's, Ctrl/Cmd+Enter: the event `ask`) leads back to `asking`; a `run` is not valid with no engine, so nothing is run or kept. |
| `downloading` | all bytes in; "Stop download" or "Not now"; a failed fetch | `starting-worker`; the fetches are aborted, `declined`; `failed`. "Edit files while it loads" only closes the dialog. Stage list (`S 2`): "Downloading the engine", "Starting Python", "Loading your files", "Loading packages", "Starting the engine" (the snapshot start differs: OQ-11; the words are one list, `stageNow` in `states/words.ts`, decided 2026-11-12). A download that fails is `failed`: no worker is made and there is no offline start. |
| `starting-worker` | the last stage ends; the start is rejected | `ready` (nothing runs by itself: with no engine only "Start engine" is offered): the dialog closes by itself, focus goes to the editor, the live region says "Engine ready". `failed`, or `failed-twice` when the worker failed twice. |
| `ready`, `running` | a run starts; its result arrives; Break | `running`; `ready`; `breaking`. |
| `breaking` | the run ends with rc 1; 5 s pass; "Don't reset: wait for it" | `ready` (the log has "--Break--", "r(1);" and the note of `S 10`, OQ-9; a run that had ended before a safe point keeps its own rc); reset; `waiting`. |
| `waiting` | the run ends; "Reset now" | `ready`; reset. |
| `ready`, `running`, `breaking`, `waiting`, and `starting-worker` for a crash | reset (rc 9998): Break did not stop it, the worker crashed, Reset confirmed, "Reset now" | The run in progress ends with rc 9998; the worker is ended and the build's list is fetched afresh (`starting-list`), then a new worker starts by itself (`starting-worker`, `ready`). Above the log (`P/Notices`), for an engine that had been `ready`: "**The engine was reset: it ran out of memory.** The data in memory is gone; your files are kept." / "Run the file again" (only after a Break or a crash that cut a file run: it runs that file, and is on while the engine is `ready` and the file is open as a text tab), "Dismiss" (the reason's wording: OQ-9). A crash during a start adds no banner. A second worker crash before a start finishes: `failed-twice`, never a loop. A page that cannot ask a run to stop resets at once on Break. |
| `failed` | "Try again" (`start`) | `downloading`. `failed-twice` has no way out but a reload. |

**Not cross-origin isolated** (no `SharedArrayBuffer`) is a flag, not a state. Break reads "Break (reset)" (`S 11`'s "Break · resets", shortened; its name is "Break (reset): Break resets the engine on this page") and resets
at once. With the first run a warning banner shows: "**Break resets the engine on this page**, because the page isn't
cross-origin isolated (some hosts, or plain HTTP on a local network). The data in memory is lost; your files are kept."

## 6. Worker protocol (step 2; step 1 for the Python side of the new calls; the transport and the ops, step 3.5 C and D)

The page posts `{id, op, args}`; the worker answers `{id, result}` or `{id, error, name}`, posts `{stage}` (a typed `Stage` id,
never text) as each start-up stage begins, and `{id, log}` chunks while a run prints. Ops run one at a time in a queue, except
`boot`. The ops are one typed map, `Ops` in `web/src/engine/types.ts`, in three sets; each op belongs to one set, in the types
and in the worker (`web/src/engine/worker.ts` has one handler object for each set), and the set decides who may send it:

- **`LifecycleOps`** (`mount`, `boot`, `startup`, `run`) change the engine. Only the transport's `start()` and `run()` send
  them, and only the machine's effect performer calls those.
- **`ReadOps`** (`describe`, `describe_file`, `matrix`, `macros`, `browse`, `memory`, and the two views of `/work`, `files` and
  `read`, for the tests) are declared to change nothing: not the data, r(), e(), the macros, the matrices, the graphs, the sort
  order, the log or `/work`. Anyone may send one, through the transport's `query()`. The declaration is tested
  (`web/test/engine.test.ts`), not proved.
- **`JournalOps`** (the page's file changes; formerly `MirrorOps`, when it held four mirror ops) holds one op,
  `sync`. Only the function the transport gives to `store.attach` sends it.

| Op | Set | Args | Result | Errors | Needs | Owner |
|---|---|---|---|---|---|---|
| `mount` | lifecycle | `MountArgs`: `{indexURL?, brotli?}`, and for a snapshot start `{snapshot, built, files}` (the folder's URL; from `start-files.json`: the build time `built` and the two big files, `{snapshot, bundle}`, each `{name, raw, size}`) | none | a failed fetch; a damaged file | nothing | Worker. Loads Python, then copies the store into `/work` (no IDBFS). It fetches no manifest: the page has checked the list's build (`checkBuild`) before it made the worker. |
| `boot` | lifecycle | `{wheel, extraWheels, interruptBuffer}` | `About` | install or import failure | `mount` | Worker, outside the queue. |
| `startup` | lifecycle | none | `Startup` | | `mount` | Worker. |
| `run` | lifecycle | `{code, fresh_locals?, plot_theme?}` | `RunResult`; while it runs, `{id, log}` chunks | rejects (kind `op`) when the op fails in the worker, for example with no memory for its result; the machine then ends the run with rc 9998, kind `run-failed`, and the worker stays | engine | Worker. Then writes the run's difference to the store (section 7). |
| `describe_file` (new) | read | `{path}` | `DataSummary` of a .dta in `/work`, without loading it | a path outside the folder rejects; other errors are `{error}` as the result | engine | Worker. Step 1: `Engine.describe_file(path)`, `browser.describe_file(path)`. It leaves the data in memory, r() and the log as they were. |
| `describe` | read | `{vars?, offset?, limit?}` | `DataSummary` | `{error}` as the result | engine | Worker. |
| `matrix` | read | `{name}` | `Matrix` | `{error}` as the result | engine | Worker. |
| `macros` (new) | read | none | `Macros` | | engine | Worker. Step 1: `Engine.macros()`, `browser.macros()`. |
| `browse` (new) | read | `{vars?, offset?, limit?}` | `BrowseRows` | `{error}` as the result | engine | Worker. Step 1: `Engine.data_rows()`, `browser.browse()`. |
| `memory` (new) | read | none | `Memory` | | engine | Worker; it adds `heap_bytes`. Step 1: `Engine.memory()`, `browser.memory()`. |
| `files`, `read` | read | none; `{path}` | `FileInfo[]`; bytes | | `mount` | Page: `store.list()`, `store.read()`. The worker keeps them as views of `/work` for the Node tests only; `ViewOp` (the ops the controller's `call` accepts) leaves them out. |
| `sync` | page changes | none | none | a `/work` that cannot take the store's version is said on the console | `mount` | Page first (a `store.*` change and a journal row, one transaction), then this op, which carries nothing: the worker reads the journal and takes the store's version of what it names (section 7). With no store (`mount` could not open it) it does nothing. |

Not worker ops: the zip (`store.zip()`, OQ-12), the engine download, the tab lock, `storage.persist()`.

**The transport** (`web/src/engine/client.ts`, class `EngineClient`) is the page's side of the worker and of the build's files
before a worker exists. It decides nothing: the state machine (section 5) says when a worker starts and ends, and the engine
controller performs that through the transport. Its interface is three parts:

- **`Reader`**: `query(op, args)`, the read ops only. Safe at any time, from anywhere.
- **`Lifecycle`**: `start(n, build, reply)`, `end(n, ending)`, `run(n, args, onLog)` and `interrupt(n)`. Only the effect
  performer holds this part. `n` is the worker's number (the effect's ticket); the transport only compares it with the live
  worker's. It never puts a ticket on an event: what a worker has to say goes through `reply`, which the controller bound to
  the ticket.
- **`Builds`**: `cached()`, `download({onProgress, signal})`, `build()` and `forgetDownload()`: the build's list and its files in
  the Cache.

The transport does not restart, count crashes, hold a timer, make run results or know a state name, and it awaits nothing
before it makes a worker. One worker is live at a time: `start()` with one still live throws, and so does `end(n)` for a
number that is not the live worker's. The worker is posted to in one place (`#send`, tested on the source text).

As built:
- `download()` resolves `{cached: true, received, total, build}`, or `{cached: false, why, build}` (no Cache API, storage
  refused, `?snapshot=0`). `build` is what `mount` needs of the list `download()` has just checked (`null`: the normal start),
  so a start the visitor begins fetches no list a second time. On abort it rejects with an `AbortError` (the signal's reason
  when that is one) and no `kind`; every other failure is a client error with a `kind` (an unreachable list:
  `failed`/`download`). It checks the list's build (`checkBuild`, below) before fetching anything, fetches with
  `cache: "no-cache"`, and never caches a file whose byte count is not the listed size.
  `download()` is the Cache's only writer: the worker only reads it. Before it fetches, and only when no worker is live, it
  deletes every entry of that Cache that is not one of the list's `download` files at its URL (relative to the list): the same
  build kept at an older address (the editor's move to `/app/` with an unchanged snapshot) would otherwise stay until the next
  snapshot. The list's own files are never deleted, so a resumed download keeps what it has.
  The machine's effect `start-download` calls `download()` before every start the visitor triggers; if it fails (other than by
  "Stop download") the state is `failed` and no worker is made. There is no offline start. `startList()` fetches the list.
  A restart is another path: the machine's `starting-list` state asks `build()` for the list, fetched fresh and checked, before
  it makes a worker (the Cache may have been evicted since the first start). The page's download size, `engineBytes`, is a
  constant of `web/src/app/state.ts`, read from the page's meta tag at load.
- **One statement of the build:** `start-files.json`. `checkBuild(list)` is the one comparison of the page's build with
  it: the build id, a SHA-256 over a stamp made once per build (or per dev-server start), the dofile wheel's hash, the extra
  wheels' hashes and the Pyodide version (`scripts/build-id.ts`, `buildId`). The page's id is made from the files it is
  built from and compiled in; the list's from the same stamp and the snapshot's record, so the two are equal only for a page
  and a list of one build whose snapshot is of that build's inputs. Another build throws `kind: "updated"`; so does, in
  development, a stale snapshot. `download()` calls it, and so does `build()`, and a snapshot start passes `built` and the two
  big files in `mount`'s arguments (`MountArgs`). Accepted cost: after any deploy, a page that was open says "reload" at its
  next start or Reset.
- **The snapshot's `manifest.json` is its build record, not deployed:** what it was built from (the dofile wheel's name and
  hash, the extra wheels' hashes, the Pyodide version), its build time `built` and its two big files. It stays in
  `public/snapshot/` (CI restores it with the snapshot); the build reads it, fails if it differs from the wheels or the
  Pyodide version being built (saying which, and to run `npm run snapshot`; a record without the extra wheels is stale), and
  removes it from `dist/`. A build with no snapshot still succeeds, with `built: null` in the list. The page and the worker
  never fetch it. The Cache stays named by `built`, so a deploy that changes only the page does not download the snapshot or the runtime again.
- `cached()` resolves `true` when every file the list marks `download` is in `dofile-snapshot-<built>` (checked with
  `caches.has`, then `match`: it creates and deletes nothing), else `false`, and never rejects: `false` with no snapshot start,
  no Cache API, or a list that cannot be fetched (offline, say). `forgetDownload()` deletes every `dofile-snapshot-*` Cache,
  logging any error; the machine's effect `forget-download` calls it after `failed-twice` whose reason is not `memory` or
  `no-wasm`.
- `start(n, build, reply)` makes worker `n` and sends `mount`, `boot` and `startup` to it in order. It says what happens
  through `reply`: `stage` as each stage begins, then `started`; `start-failed` when there is no WebAssembly, the worker cannot
  be made, or `mount`, `boot` or `startup` fails in the worker; `crashed` when the worker errors (cause `error`) or the browser
  closes the file storage (cause `storage`), now or at any time while it is live. The worker is made before `start()`
  returns, so calls made right after it queue behind `mount`. A worker that failed is not ended by the transport: the machine
  says so (`end()`). The store is attached to the worker with `store.attach(sync, {onClosed})`.
- `end(n, ending)` terminates worker `n`, detaches the store, and rejects every call of it still pending with a `ClientError`
  of the ending's kind (`reset`, `stopped`, `failed` or `failed-twice`). With no live worker it does nothing.
- `run(n, args, onLog)` runs code on worker `n`; `onLog(text)` gets each chunk of the log while the run prints (a preview: the
  result's `log` replaces it). It resolves with the worker's `RunResult`, and rejects with kind `op` when the worker answered
  with an error (that worker stays), with the ending's kind when the worker was ended meanwhile, and with `no-engine` when `n`
  is not live. The transport makes no run result: rc 9998 results are the machine's (`cutResult`).
- `interrupt(n)` puts SIGINT in the shared interrupt buffer, which the worker clears when a run starts. Without
  `SharedArrayBuffer` it does nothing, and the machine resets at once instead of asking for a Break. The 5 s Break timer, the
  deadline `resetAt` and "keep waiting" are the machine's and the controller's (section 5), not the transport's.
- `query(op, args)` rejects with kind `no-engine` with no live worker. While the worker starts or runs, the call waits in the
  worker's queue; if its worker is ended first it rejects with the ending's kind.
- `storeError` holds the reason the worker could not open the store at `mount` (also `startup.storeError`); `/work` then
  starts empty, and the transport detaches the store from that worker, so the page's changes stay in the store and do not reach
  it (section 7). The transport also keeps `about` and `startup`, the facts of the last start, for the tests and the hook.
- **Errors** are `Error`s with `kind`: `"failed"` (`download()` or `build()` could not get the build's list or a file as
  listed, or the build has no snapshot; also a call cut because its worker's start failed; with `reason`:
  `"no-wasm" | "download" | "memory" | "unknown"`), `"failed-twice"` (a call cut because its worker failed twice),
  `"updated"` (from `download()` or `build()`: "dofile was updated: reload the page", then the cause), `"reset"` (a call cut
  by a reset; `reset` holds the kind: `"break" | "crash" | "user"`), `"stopped"` (cut because another tab took the engine),
  `"no-engine"` (`query()` or `run()` with no live worker), `"op"` (the worker answered with an error; `name` is the worker's
  error name). The worker answers `{id, error, name}`. The page decides from these fields and from the worker's error name
  (`DownloadError`, `SnapshotError`), never from a message's text.
- **Stages:** the worker posts `{stage}` with a typed id: `download` (the snapshot start: the cache read, also after the
  page's `download()`), `unpack`, `python`, `files`, `packages`, `engine`. The snapshot start has no `packages`; `?snapshot=0`
  has no `unpack` (OQ-11). The words are the controller's (`stageWords`, `stageStatus`). A failed fetch during the start ends
  it with a `DownloadError`.
- **Test hook:** with `?test` in the URL the page sets `window.__dofile = {engine, store, start, persisted, engineBytes, state,
  run, breakRun, reset, selection, drops}`: `engine` is the transport (its facts `worker` and `startup`, and `cached()` and
  `download()`), `start` is the engine controller's (download, then the worker), `state` is the signals of section 8,
  `run(code)` is a run through the run controller, `breakRun` and `reset` are the controller's, and `drops()` lists the events
  that changed nothing. With `?test=manual` the page starts no engine until the test calls `start()`. Without the flag the
  object does not exist. See "As built in step 3", section 8.

Types. The code's own are in `web/src/engine/types.ts` (the ops, `Stage`, `FailReason`, `Build`, `ClientError`, `Downloaded`,
`StartFiles`, `SnapshotManifest`); this is the part of them that crosses the worker's boundary, with the origin of the new
calls noted. None of the new calls or options changes the MCP schema.

```ts
// The ops: one typed map in three sets (types.ts); the page and the worker both use it, so an op's arguments and result match
// on both sides, and the transport's types let each set be sent only by whom it belongs to.
interface LifecycleOps {                         // sent only by the transport's start() and run()
  mount:   { args: MountArgs; result: void };    boot: { args: BootArgs; result: About };
  startup: { args: void; result: Startup };      run:  { args: { code: string } & RunOptions; result: RunResult };
}
interface ReadOps {                              // declared to change nothing: anyone may send them, through query()
  describe: { args: DescribeArgs; result: DataSummary };   describe_file: { args: { path: string }; result: DataSummary };
  matrix: { args: { name: string }; result: Matrix };      macros: { args: void; result: Macros };
  browse: { args: DescribeArgs; result: BrowseRows };      memory: { args: void; result: Memory };
  files: { args: void; result: FileInfo[] };               read: { args: { path: string }; result: Uint8Array };   // views of /work, for tests
}
interface JournalOps { sync: { args: void; result: void } }   // the page's file changes: the worker reads the journal (section 7)
type Ops = LifecycleOps & ReadOps & JournalOps;
type Op = keyof Ops;
type ViewOp = Exclude<keyof ReadOps, "files" | "read">;      // what the controller's call() accepts
type ToWorker = { [K in Op]: { id: number; op: K; args: Ops[K]["args"] } }[Op];
type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";
type FromWorker = { id: number; result: Ops[Op]["result"] } | { id: number; error: string; name: string }
               | { id: number; log: string }    // a chunk of a running run's log (OQ-1)
               | { stage: Stage };              // a start-up stage began
// `mount`'s arguments: the start's folders, and for a snapshot start the build's list (built, and the two big files)
type MountArgs = { indexURL?: string; brotli?: string }
  & ({ snapshot: string; built: number; files: SnapshotFiles } | { snapshot?: undefined; built?: undefined; files?: undefined });
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
  results: Results | null;                       // null only in the machine's rc 9998 result
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
  kind?: CutKind;                                // only on the machine's rc 9998 result: "break" | "crash" | "user" |
                                                 // "stopped" | "run-failed"
}
interface FileChange { name: string; status: "created" | "modified" | "removed"; bytes: number }   // as MCP's `files`
type CutKind = "break" | "crash" | "user" | "stopped" | "run-failed";   // why the machine cut a run (a reset, another tab, a failed op)
// A run cut by a reset resolves, from the state machine (cutResult), as { rc: 9998, error: "session reset: <reason>. Data in memory is lost;
// your files are kept.", error_command: null, log: "", results: null, nobs: 0, nvars: 0, new_graphs: 0, images: [],
// error_line: null, graph_commands: [], graph_lines: [], kind }.
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
| `pending` | a key (auto) | `{op: "write" \| "mkdir" \| "remove" \| "rename", path, to?}`: the journal, a page change `/work` has not taken yet |

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
  attach(sync: (() => void) | null, opts?: {onClosed}): void;   // the transport connects the store to its live worker:
                                                     // `sync` posts it the op `sync`; null: no worker, or one with no store
                                                     // (no row is written then); onClosed: the browser closed the database
  blocked: boolean;                                  // set by the page in a tab without the lock: every change rejects
}
```

| Rule | Contract |
|---|---|
| Page change while a worker exists | **The journal is the only way a page change reaches `/work`.** One transaction changes `info` and `data` and adds a `pending` row; then the store calls `sync`, which posts the worker the op `sync`, with no arguments and no bytes. The worker, in one transaction, reads the `pending` rows, takes the store's version of those paths (the path and everything under it, both names of a rename; for a `mkdir` row, the folder) and clears the journal; then it puts that version into `/work`, replacing what `/work` had there. A sync that finds the journal empty (an earlier sync, a `mount` or a run's after-run write took it) does nothing. So the order in which the syncs arrive does not matter, and no change is applied twice: whichever sync or copy finds a row takes the store's version as it is then. A sync that `/work` cannot take is said on the console. Cost, accepted: the worker reads an upload back from the store, and a renamed folder is copied again, not renamed in place. `rename` rejects when `to` exists or lies inside `from`; `write` rejects when the path is a folder or a parent is a file. |
| Page change with no worker | One transaction changes `info` and `data`; no row is written and nothing is posted. The next `mount` copies the whole store. |
| Engine start | `mount` copies every record into `/work`, a plain in-memory folder, and clears `pending`, in one transaction. A worker started after a reset does the same: files come back, data in memory does not. |
| After each run | Inside the `run` op, the worker lists `/work` (path, size, mtime) before and after the run. It writes created and changed files to the store, and deletes from the store only files that were in the "before" list and are gone; in the same transaction it takes the journal, as `sync` does. A file counts as changed when its modification time or its size changed. Before the run the worker waits until the clock is past the newest mtime in the list that is not in the future (one clock step, up to 100 ms with a clamped clock): that makes the time enough for any write of one byte or more, which gets a later time than any file had (or, for a time in the future, another one), so a same-size rewrite is seen. The size catches a truncation (a file the run empties), which MEMFS does not stamp with a time. `RunResult.files` lists what it wrote. A write the store refused is tried again by the next run, unless the page changes that path first, or makes a folder where the run left a file (then the page's version wins in `/work` and the store, and nothing is owed for it). |
| A page change during a run wins | The page's syncs wait behind the run in the worker's queue. The after-run write reads `pending` and leaves those paths (both names of a rename) out of the difference: a changed path is left out when it is a pending path, under one, or above one (for a `mkdir` row: the path and the paths above it only). The store's records for those paths go into `/work`, and the waiting syncs then find the journal empty. A run's file under a folder the page removed, or under a folder's old name after a page rename, is not saved and is listed in `RunResult.skipped`; the other dropped cases are not listed (see `RunResult.skipped`). So after a save during a run that writes the same file, the store and `/work` both hold the user's text. |
| A run that is cut | A reset, a crash or a closed tab while the run's code is still running: nothing is written to the store. A reset that lands during the after-run write may leave that run's files in the store although the machine reports rc 9998. |
| Tab lock | The tab that holds the Web Lock `dofile-engine` (*proposed*) owns the engine. A tab that cannot get it shows the take-over dialog (section 5), starts no worker and writes nothing to the store (OQ-16). "Use dofile in this tab" takes the lock with `steal`; the tab that loses it ends its worker and shows the same dialog. A closed tab frees the lock. Without Web Locks (not a secure context: plain HTTP on a LAN, the dev server only) every tab owns the engine; accepted. |
| Persistence | The page calls `navigator.storage.persist()` once at start (a browser may show its own prompt, `F1` branches) and puts `persisted()` in the `persisted` signal. |
| Failures | A failed write (quota exceeded) rejects with the browser's error, keeps the old record and writes no row; the tab stays unsaved. A failed after-run write sets `RunResult.store_error`. A worker that cannot open the store still mounts, with an empty `/work`, and sets the client's `storeError`; it cannot read the journal, so the client detaches the store from it: the page's changes stay in the store and do not reach `/work`. When the browser closes the database, the worker is replaced (`crashed`, cause `storage`). If another page deleted it ("Clear site data"), `/work` may hold files the store no longer has, which no row says, and the new worker's `mount` copies the store as it is now (empty, with what the page wrote since). If another page upgraded it to a newer version, this page still opens version 1, which fails (`VersionError`) in both threads: the new worker mounts with `storeError` and an empty `/work`, and the store is detached from it, as above. A database that cannot be opened (storage refused, some private modes) leaves nowhere to keep files. None of these states is drawn: OQ-16. |

**Tests step 2 must have** (Node with `fake-indexeddb` and the real `worker.ts`, unless "e2e"):
1. Store API: write, list, read, mkdir; rename and remove of a file and of a folder; a path that leaves the folder is refused;
   `list` reads no file bytes.
2. No engine: every call works with no worker, while `mount` runs, and after a start that failed.
3. Start copy: a run reads files written before the worker existed; a change made during `mount` is neither lost nor applied
   twice.
4. After-run difference: a run that creates, changes and deletes files leaves the store equal to `/work`; an untouched large
   file is not rewritten; a file the page added during the run is still in the store.
5. A page save, delete and rename during a run that touches the same file: the store and `/work` hold the page's version.
6. Restart (rc 9998): `/work` is rebuilt from the store, `pending` is empty, the cut run wrote nothing.
7. The old `/work` database is left as it was.
8. A failing transaction rejects the page's write, and gives a run `store_error`.
9. Tab lock (e2e, two pages, each browser): the second gets no engine; take-over ends the first one's worker.
10. Download: the counts reach the total; abort leads to `declined`; a second try reuses finished files; the snapshot start
    makes no request to another origin (e2e).
11. Break: `keepWaiting()` after `breakRun()` lets a long command end with rc 1 and its data; a reset gives rc 9998.
12. Zip: every file with its folders, no `.dofile/`, made with no engine loaded.
13. `persist()` is called once (`keepFiles(storage, onAnswer)` answers at once with `persisted()` and again when `persist()` is
    answered, since Firefox can leave it unanswered behind its prompt; a `persisted()` that rejects answers null); step 3 tests that a false value reaches the signal.
14. The journal (step 3.5 D): each kind of change alone reaches `/work` and leaves no row; changes during a run (the page's
    version wins; `skipped`); a change made with no worker, then a start; a sync when the journal is empty; the store closed
    by the browser; a run's write the store refuses, then the next run.

## 8. State model (steps 3 and 3.5)

One module of signals. Components read any of them and write only through the owner named on the line. The banners for no
engine, did not start, failed twice, running, stopping, waiting and "Break resets" are drawn from `engine` and `isolated`;
they are not in `banners`.

Step 4's decisions, the review decisions waiting for the maintainer's confirmation and the open questions are listed
once, in `docs/prototype1-plan.md`, "Step 4: decisions and open questions" (step 5's in "Step 5: decisions and open
questions"); this section points there. They do not block the merge: they are reviewed after it (the plan's "Post-merge
review"), with the draft words. The words drafted
for the visitor are below, per part: "Words the spec does not give" in 4a and 4b, "Step 4c: draft words", "Step 4d:
draft words", "Start engine: draft words".

```ts
type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";   // snapshot start: no "packages";
                                                                                   // ?snapshot=0: no "unpack" (OQ-11)
interface RunHead { kind: "file" | "selection" | "command"; path?: string; lines?: [number, number]; fresh_locals: boolean }
// The engine's state as views see it (step 3.5 C): the sixteen state names of the engine's state machine
// (web/src/engine/machine.ts), without its tickets. Written out by hand in web/src/app/types.ts.
type EngineState =
  | { s: "checking-lock" }                                                    // the page load: waiting for the tab lock
  | { s: "checking-cache" }                                                   // then for the cache check
  | { s: "none" }                                                             // only with ?test=manual
  | { s: "asking" }                                                           // the download prompt is open
  | { s: "declined" }
  | { s: "downloading"; received: number; total: number; t0: number }
  | { s: "starting-list"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }     // a restart fetches the build's list
  | { s: "starting-worker"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }   // done: seconds per finished stage
  | { s: "ready" }
  | { s: "running"; run: RunHead; t0: number }
  | { s: "breaking"; run: RunHead; t0: number; resetAt: number }
  | { s: "waiting"; run: RunHead; t0: number }
  | { s: "failed"; reason: FailReason; detail: string; message: string }      // message: the visitor's words;
  | { s: "failed-twice"; reason: FailReason; detail: string; message: string }   // detail: the cause, for a developer
  | { s: "other-tab-idle" }
  | { s: "other-tab-taking" };                                                // a take-over is in progress
type FailReason = "no-wasm" | "download" | "memory" | "updated" | "unknown";            // "updated": reload the page
interface LastRun extends RunHead { rc: number; line: number | null; seconds: number; skipped?: string[]; store_error?: string }
interface OpenTab { path: string; kind: "text" | "dta"; dirty: boolean }               // the text lives in CodeMirror
type LogItem = { t: "head" } | { t: "runhead"; run: RunHead; first: boolean }
             | { t: "text"; text: string; run?: number; streaming?: boolean; unsaved?: string[]; end?: LastRun }
             | { t: "note"; text: string } | { t: "graph"; n: number };
interface Graph { n: number; png: string; theme: "light" | "dark"; from: "run" | "file"; path?: string;
                  command?: string; line?: number | null; run?: number }
type Dialog = null | { d: "download" } | { d: "clash"; path: string; index: number; total: number }
            | { d: "delete"; paths: string[] } | { d: "delete-all"; count: number } | { d: "clear-log" } | { d: "reset" }
            | { d: "close-tab"; path: string } | { d: "other-tab" };
type Banner = { b: "reset"; reason: string; kind: "break" | "crash" | "user"; run: RunHead | null } | { b: "storage" }
            | { b: "download-failed" } | { b: "not-text"; path: string } | { b: "save-failed"; path: string; message: string }
            | { b: "run-changed"; path: string };

// A signal with one owner is a ReadonlySignal (step 3.5 C): a view that assigns one fails `npm run check`.
export const engine: ReadonlySignal<EngineState>;        // the engine controller, from the state machine's state; starts as checking-lock
export const isolated: Signal<boolean>;          // set once at load from crossOriginIsolated
export const engineBytes: number | null;         // the download size, from the page's meta tag written at build (OQ-12)
export const memory: ReadonlySignal<Memory | null>;      // run controller, after the start and after each run
export const files: ReadonlySignal<FileInfo[]>;          // file service, after every store change and every run
export const fresh: ReadonlySignal<Set<string>>;         // file service: paths the last run created or changed (the "new" badge)
export const persisted: ReadonlySignal<boolean | null>;  // file service, from storage.persist() and persisted()
export const tabs: Signal<OpenTab[]>;            // editor tabs (4a); `dirty` only through setDirty(path, on) (the editor, 4b)
export const activeTab: Signal<string | null>;   // editor tabs, and the file tree when it opens a file (4a, files/open.ts)
export const split: Signal<boolean>;             // the Log head's Split and Unsplit; kept in localStorage
export const outputTab: Signal<"log" | "graph" | "data" | "results" | "help">;   // the Output tablist; "log" only unsplit; Unsplit always shows it
export const phoneTab: Signal<"files" | "editor" | "log" | "data" | "results">;  // the phone's tab bar; Run sets "log";
                                                 // 4a's openFile sets "editor" (a text or .dta tab)
export const log: ReadonlySignal<LogItem[]>;             // run controller; "Clear log" empties it but the head
export const lastRun: ReadonlySignal<LastRun | null>;    // run controller
export const history: ReadonlySignal<string[]>;          // run controller's runCommand(): the command line, Load and Import
export const results: ReadonlySignal<Results | null>;    // run controller, from each RunResult; null when the engine is gone
export const macros: ReadonlySignal<Macros | null>;      // run controller, after each run; null when the engine is gone
export const data: ReadonlySignal<DataSummary | null>;   // run controller, after each run; null when the engine is gone
export const rows: ReadonlySignal<BrowseRows | null>;    // run controller alone: after each run (null as data), and
                                                 // moreRows() for the Data tab's "Show 50 more"
export const pickedVar: Signal<string | null>;   // the Data tab
export const graphs: ReadonlySignal<Graph[]>;            // run controller: a run's, and addFileGraph() for a .png; "Clear log" empties
export const graphIndex: Signal<number>;         // the Graph tab, the full-size view and the log's graph links (by `n`)
export const graphFull: Signal<boolean>;         // the full-size view is open: 4c's Open full size and Close, 4b's inline tap
export const theme: Signal<"system" | "light" | "dark">;   // the theme button
export const wrap: Signal<boolean>;              // "Wrap lines" in the ⋯ menus (App.tsx toggleWrap); views read it; kept in localStorage
export const toast: ReadonlySignal<string | null>;       // anyone, through showToast(text, kind?); it clears itself (toastMs: 4 to 10 s)
export const toastError: ReadonlySignal<boolean>;        // the toast reports an error (warning icon), not a confirmation
export const dialog: Signal<Dialog>;             // whoever opens one; the dialog closes itself
export const banners: ReadonlySignal<Banner[]>;          // their owners, through addBanner(); Dismiss removes one (dismiss())
export const announce: ReadonlySignal<string>;           // the hidden live region: through say() (controllers, showToast, views)
```

**As built** (steps 3 and 3.5; the step 4 agents write against this and the header of `web/src/app/App.tsx`, which say the same):
- **Files.** The signals: `web/src/app/state.ts` (TypeScript on `@preact/signals-core`, so the Node tests import it as it is;
  components read the same signals through `@preact/signals`). The types above: `web/src/app/types.ts`; section 6's:
  `web/src/engine/types.ts`. Everything in `web/src/engine/`, the controllers and `web/test/` is TypeScript, which Node runs by
  removing the types. The controllers are `.ts` files that import no `.tsx`, tested in `web/test/app.test.ts`.
- **The wiring.** `web/src/main.tsx` is the only module that constructs or connects anything (a source-text test checks it):
  the transport (`EngineClient`, with its worker factory), the tab lock, and `connectFiles(store)`, `connectRun(handlers)` and
  `connectEngine({client, lock, snapshot, manual})`, each once, in that order, then `open()`. Views never reach the
  transport or the machine (an import-graph test checks it).
- **Who writes a signal.** A signal with one owner is a `ReadonlySignal`, so a view that assigns one fails `npm run check`:
  `engine`; `memory`, `log`, `lastRun`, `history`, `results`, `macros`, `data`, `rows`, `graphs`; `files`, `fresh`,
  `persisted`; `banners`, `toast`, `announce` (these three through `addBanner`/`dismiss`, `showToast` and `say`). The owner
  writes through a writer object (`engineWriter`, `runWriter`, `filesWriter` in `state.ts`), which only its owner imports (a
  test checks it). The others stay writable by views: `graphIndex`, `graphFull`, `dialog`, `tabs`, `activeTab`, `split`,
  `outputTab`, `phoneTab`, `pickedVar`, `theme`, `layout`, `isolated`.
- **`ABOUT`** (`web/src/app/env.ts`) is compiled in: `dofile` (the version), `engine_commit` and `stata_version`. It is there
  from the first paint, with or without an engine; there is no `about` signal. `web/test/engine.test.ts` compares it with what
  `boot` answers.
  - `engine.ts` owns `engine` and the reset banner. It is the one caller of the engine's state machine
    (`web/src/engine/machine.ts`): each action is one event, the machine's table (section 5) says in which states it acts (in
    any other it does nothing), and the `engine` signal is the machine's state as views see it (`EngineState`, with the
    sixteen names, the tickets left out, and `message` added to the two failed states).
    `<html data-engine>` shows the same name; CSS that keys on it matches by prefix (`[data-engine^="other-tab"]`). The
    signal starts as `checking-lock`. At load the machine asks unless `client.cached()` says the start files are all in the
    Cache; a start that ends `failed-twice` (reason not `memory` or `no-wasm`) deletes the `dofile-snapshot-*` Caches
    (`client.forgetDownload()`), so the reload the message asks for downloads them fresh. Actions, all returning nothing
    (a second press does nothing): `open()` (the page load; main.tsx calls it once), `ask()` (only in `none` and `declined`),
    `decline` (only in `asking`, and in `downloading`, where it also aborts the download), `start` (also "Try again"; only in
    `none`, `asking`, `declined`, `failed`), `stopDownload`, `takeOver` (only in `other-tab-idle`; a second press while the
    take-over is in progress does nothing), `lost` (the tab lock was taken), `breakRun`, `keepWaiting`, `reset` (only in
    `ready`, `running`, `breaking`, `waiting`). `run(code, head)` is run.ts's way in: it answers true (the engine was
    ready and the run began) or false (any other state: nothing runs, then or later, and no prompt opens); `ask()` is
    "Start engine" (`app/start.ts` `startEngine`, which also calls `start` after a failed start): the download prompt in
    `none`, `asking` and `declined`, the take-over dialog in `other-tab-idle`; views call `runCode` and `runCommand`, not `run`. It
    throws, before it queues anything, when called while a step of the machine is in progress: inside a handler given to
    `connectRun`, and also inside a signal effect on `engine` or `lastRun`, which are written only during a step, or on a
    `log` write a step makes (a run's start and end; a streamed chunk and "Clear log" write `log` outside a step, where the
    call does not throw: during a run it is refused). Start the
    next run after the step, for example when the run's promise has resolved. `call(op, args)` is the page's one provider of
    read ops (`ViewOp`: `describe`, `describe_file`, `matrix`, `macros`, `browse`, `memory`); views use `matrix` and
    `describe_file`. It raises no event, and rejects with kind `no-engine` with no worker and `reset` when a reset cut it.
    `drops()` lists the last 200 events that changed nothing (`{type, n?, row, why}`, `why` "stale" or "not-valid"). A second
    `connectEngine` replaces the wiring: the machine, the queue, the timers and the drop record are cleared, and nothing of
    the earlier wiring can act again. `FAILED[reason]` and `FAILED_TWICE` are the visitor's messages of a failed start
    (`UPDATED` is reason "updated"'s); `stageWords` (the live region) and `stageStatus` (the status bar) are the words of each
    `Stage`, which the worker sends as typed ids; `stagesOf(snapshot)` is the stages in order.
  - `run.ts` is the one writer of `log`, `lastRun`, `results`, `macros`, `data`, `rows`, `memory`, `graphs` and
    `history`; it also moves `graphIndex` to the newest graph (views write `graphIndex` too). It reads no engine state: the engine controller tells it, through the
    handlers it gives to `connectRun` (a run began, a chunk of its log, its end, an engine is ready, the engine is gone).
    It clears `results`, `macros`, `data`, `rows`, `memory` and `lastRun` when the engine is gone (a reset, or another tab
    took it: the machine's effect `engine-gone`), and asks for `memory` when an engine is ready. Actions: `runCode(code,
    head)`, `runCommand(text)` (both throw during a step, as `run` does), `addFileGraph(path, png)` (a .png opened; the same
    path opened again replaces its entry, with the new image and the same `n`, and selects it), `refreshData`,
    `moreRows(count = 50)` (the Data tab's "Show 50 more": the next rows appended to `rows`, since run.ts alone writes it;
    resolves true when rows were added, and appends nothing if a run or a new engine replaced `rows` meanwhile), `clearLog`.
    `refreshData()` does not look at the state: with no engine its calls reject and nothing is written; while an engine starts
    or a run is on, the calls wait in the worker's queue and the signals are written when they are answered.
  - `runCommand(text)` (the command line, Load, Import; kind "command", locals kept) returns `{ how, done }` at once, as
    `requestRun` does (`Requested` in run.ts). `how` is `"started"` when the command runs now (`ready`); only then is it
    added to `history` (not twice in a row), also when the run ends in an error, and the command line clears its field.
    `"refused"` in any other state (the page load: `checking-lock`, `checking-cache`; a start or a run in
    progress; no engine, where the views offer no run) and for an empty command. When it did not start, `history`
    is unchanged and the text stays in the field. `done` is the run's result once it has run (after the after-run reads),
    or null at once when it did not start. Nothing is held for later: no run waits for the engine.
  - `files.ts` owns `files`, `fresh`, `persisted`, the download-failed banner (below) and the storage banner (S 19: once per visit, when `persisted` is false
    and the files change, by the page or a run). It also performs two effects of the machine: `own()` when the tab lock is
    this tab's (unblocks the store, asks the browser to keep the files, lists the store) and `block()` when another tab took
    it. Actions: `refresh` (a blocked tab does not list), `keep`, `afterRun`, `downloadAll` (resolves true
    once the zip is handed to the browser; false when the store cannot make it: then it adds the banner
    `{b: "download-failed"}` above the editor (on a phone on every view; since the UI fix round of 2026-11-12 the phone's "Download all" is only in the Files view's "Files ⋯", so this banner's place on the other views is stale),
    one at a time (a second failure replaces it), says "Your files couldn't be
    downloaded" once in the live region and logs the cause to the console; a later download that works removes the
    banner. No toast: it offers "Try again", and what the visitor can act on is a banner, 3.10. It never rejects), `saveAs`. With no file in the store (folders do not
    count) `downloadAll` makes no zip, shows and says nothing and resolves false; the ⋯ menu's item is disabled then
    (`hasFiles`).
  - The page's one store: `web/src/app/store.ts`; views change files through it. It starts `blocked` and is unblocked
    once the tab lock is this tab's (`files.ts` `own()`).
  - Helpers in `state.ts`: `say`, `showToast`, `holdToast`, `addBanner`, `dismiss`, `setDirty(path, on)`, `saved`
    (localStorage); computed `isPhone` (the layout is the phone's: read it, never pass a `phone` prop) and `hasFiles`
    (the store has a file; folders do not count).
- **Where each step 4 part goes.** `App.tsx` places the parts; each part edits only its own files. (`App.tsx` was edited
  three times in step 4, its header says which: the phone ⋯'s file actions and the focus on the tree's row when 4a was
  joined, and the phone's Save off on a .dta tab when 4b and 4d were joined.) A part reads any signal; it writes only those listed for it.
  - **4a** `files/FilesPane.tsx` (`FilesHead`, `FilesBody`), `files/EditorTabs.tsx` (`EditorTabs`, the phone's
    `FileSwitcher`), `files/FileBar.tsx` (`FileBar`: the bars over an open .csv, .tsv or .log), `files/open.ts`
    (`openFile(path)`, the one way a file opens, 3.11; `decodeText(bytes)`, built), `files/dialogs.tsx` (clash, delete,
    delete-all, close-tab; the words of the last two are decided in 3.10), `files/banners.tsx` (not-text). Writes `tabs`
    (not `dirty`), `activeTab`, `dialog` (its four kinds), `banners` (not-text); `openFile` sets `phoneTab` to "editor" on
    a phone when a text or .dta tab opens, and for a .png `outputTab` "graph" (desktop) or `graphFull` (phone); the phone's
    `FileSwitcher` sets `phoneTab` to "files" ("Show all files"). Calls `store.*`, `downloadAll`, `saveAs`,
    `editorCommands.open`, `reload`, `renamed`, `closed`, `save(path)` and `focus` (after a tab closes), `addFileGraph`,
    `runCommand` (Import), `addBanner`, `dismiss`, `showToast`, `say`. Its "Download all (.zip)" is disabled while
    `hasFiles` is false. In the file list at 700 to 1199 px, Esc folds the list: a handler of 4a's that uses Esc itself (the
    inline rename) calls `preventDefault()`. No tab can become dirty before 4b's
    editor exists, so 4a's tests of the close-tab and reload paths call `setDirty(path, true)` themselves.
    **As built in step 4a:** the plain logic is in `files/tree.ts` (the rows: in each folder its folders first, then its
    files, by name with numbers in order and case ignored; sizes in decimal units, "41 KB"; free names; what is wrong
    with a new name; tab labels, the folder added when two open files share a name) and `files/actions.ts` (close,
    rename, new, delete, a folder's .zip from the store with `engine/zip.ts`, and upload: the files that clash with none
    are written first, then each clash is asked; what the clash dialog shows beyond the `dialog` value is
    `clashNow()`, its answer `answerClash()`; uploads run one after the other, a clash waits while another dialog is
    open, another dialog put in its place with no answer counts as Esc, and a clash over an open file with unsaved edits
    is asked even after "Do the same" with Replace, never after Esc: C 14 of the plan's list), both tested in Node
    (`web/test/files-ui.test.ts`). A rename that changes how a file opens (a .dta renamed .csv) opens its tab again, in
    its place, unless it has unsaved edits; one renamed to a .png closes its tab (a .png opens in no tab). After a tab closes (Delete, the close-tab dialog) the focus goes to the tab
    now selected, else the tree's row, else the editor; the close-tab dialog stays open while its Save writes the file,
    so the focus moves once there too. The commands built from a path (Import here, Load in 4c) come
    from `web/src/stata/quote.ts` `fileCommand` (3.11). The page's drop listeners are the window's, in the capture phase,
    so 4b's CodeMirror never sees a file drop; a drag that began in the page (a graph image, which Chromium and WebKit
    list as carrying a file) is not an upload (a guard kept on partial evidence: C 15 of the plan's list). `FilesPane.tsx` exports
    `fileMenuItems()` (the head menu); on a phone the Files pane's head is hidden (the top bar already says "Files") and
    `App.tsx` puts those items in a "Files ⋯" button in the phone strip while the Files view is shown, as it does the Log head's in "Log ⋯" (decided 2026-11-11 for the top bar's ⋯; changed by the maintainer on 2026-11-12). A drop of files anywhere on the page uploads them (3.1); the Files pane is outlined meanwhile (OQ-16), except while a
    dialog is open or another tab has the files, when the drop uploads nothing and there is no outline (C 16 of the
    plan's list).
    When the folded list is opened (700 to 1199 px) the focus goes to the tree's row in the tab order. "Restore the sample" (OQ-13) is in the head menu since step 5, above "Delete all files…". A new folder is `folder` (`folder-2`, ...) in inline rename. The
    phone's `FileSwitcher` is one button as wide as the title in every state ("Editor" with no open file, so the top
    bar's boxes never move); its menu lists the open files, then "Close <name>" (the phone has no ×) and "Show all
    files" (the Files view). Words the spec does not
    give, drafts for the maintainer: the inline rename's reasons ("clean.do already exists here.", "Enter a name.", "A
    name can't contain / or \.", "A name can't contain a line break.", "That name isn't
    allowed.", "That name is dofile's own."); the bar of a file whose name a command can't hold ("Its name has a character a command can't use: rename the file.", also the .dta tab's); a folder's delete ("Delete
    data/?" / "The folder and its files exist only in this browser. This can't be undone."); an upload with files
    the store refused ("2 files uploaded · 1 failed", the pattern "N files uploaded · M failed"); the live region's "survey.xlsx can't be opened in the
    editor" and "Couldn't create the file", "Couldn't create the folder", "The upload failed". The rename's refusal from the store is "That name isn't allowed.", the same sentence as for `.` and `..` (`NAME_NOT_ALLOWED`).
  - **4b** `editor/Editor.tsx`, `editor/commands.ts` (fills `editorCommands` and `selection`), `editor/RunControls.tsx`
    (built for the section 5 states, each button at one size, 3.4; 4b adds the timers, and the pill's time goes into
    its `Labels` with a sizer of its widest form), `editor/StatusBar.tsx` (built: the state words; 4b adds the
    timers, last run, memory, the right side, and the "Not affiliated with StataCorp" line from 1200 px),
    `editor/banners.tsx` (save-failed; run-changed, which files.ts adds), `log/LogView.tsx` (the log),
    `log/CommandLine.tsx` (`CommandLine`, `LogActions`: Find and Download log, `logMenuItems` for the phone strip's "Log ⋯" button; "Clear" too,
    `PhoneStrip`). Writes `dirty` only through `setDirty`, `banners` (`addBanner` for save-failed; `dismiss` for
    save-failed and run-changed), `graphIndex` and `outputTab` (a graph link; `outputTab` "log" when Find opens with the
    Output pane unsplit), `graphFull` (a tap on an inline graph, phone), `phoneTab` "log" (a tap on the phone's Break
    pill). Calls `runCode`, `runCommand` (the command line clears its field only when it answers `how: "started"`), `breakRun`, `reset`
    ("Reset now"), `openFile` (Go to line in a file that is not open), `store.write`, `saveAs` (Download log, the
    save-failed banner's Download), `textInStore` and `editorCommands.reload` (the run-changed banner's "Reload from the
    run"), `showToast`, `say`. `keepWaiting` is 4d's (the stopping banner). On a phone the command line's field and the editor's text are 16 px or more, or iOS
    Safari zooms in when they take the focus: `app.css` sets every `input`, `textarea` and `[contenteditable]` (CodeMirror's
    `.cm-content`) to at least 16 px under 700 px; do not set a smaller size on them there.
    **As built in step 4b:** the logic with no DOM is in plain `.ts` files tested in Node (`web/test/editor.test.ts`):
    `log/classify.ts` (the .log tokenizer, OQ-4, used by the log and by a .log in the editor: an echo is `. cmd`, or a
    loop body `  2. cmd` or a continued `> ` line right after an echo; the error is `r(N);`, `--Break--` and the line
    right above the hint or above `r(N);`; the hint runs from `  → ` to `r(N);`; notes are the path shim's lines, the
    tempfile note and a log file's head, before the file's first echo only; the rest is output), `log/align.ts` (the echo
    of each line of the code sent: the echoes are walked beside the code, an echo that is not the code's next line is
    passed over, so a graph's link goes after the echo of line `graph_lines[i]`, and at the run's end when it is not found;
    a nested do-file is passed over whole when its `do` or `include` is a line outside any block (`{ }`, a program, a mata
    block) and shows its echoes (no prefix, or `noisily`, abbreviated to `n` too, the last of `capture`, `quietly`,
    `noisily`); a `do` inside a block opens nothing, and after it, or after a nested file's end, a top-level echo is taken
    only when no `end of do-file` comes before the next `do` (else the walk cannot know whose echo it is: a link in the
    wrong place is worse than one at the run's end); a top-level echo that is not the next line is looked for further
    down, so the walk gets back in step after a mata block; lines never echoed are passed over (a `/* */` comment's inside,
    the body of a `quietly { }` or `capture { }` outside a loop or a program), and a local's or global's braces open no
    block; the code is indexed by text, so the walk is linear, and the log keeps each run's answer; the code is kept by the
    run's head, `editor/commands.ts` `codeOf`), `log/paste.ts` (the command line's pasted lines),
    `log/find.ts`, `editor/csv.ts` (a .csv's columns), `editor/words.ts` (the run-head, last-run, time and memory words).
    `editor/cm.ts` has the CodeMirror pieces (the languages by extension, the line marks as a state field mapped through
    edits, the drop guard) and `editor/clock.ts` the 100 ms clock of the timers (it reads `breaking`'s `resetAt`; `test/imports.test.ts`
    allows two view files to, this one and 4d's `states/banners.tsx`, for the Break countdown). The editor is one `EditorView`, mounted once, with one `EditorState` per
    open text tab; `data-editor` is on CodeMirror's content with a file shown and on the empty view without one. The unsaved
    dot is "the text differs from the saved text", so an undo back clears it. Ctrl/Cmd+S saves anywhere on the page, the
    editor too, and Ctrl/Cmd+Enter runs from anywhere on the page too (not with a dialog open, not in another text field), each with Ctrl or Cmd on every platform; S is the key that types "s" or, on a
    layout whose key there types no Latin letter (Cyrillic, Greek...), the key in S's place (`editor/keys.ts`); a held
    Ctrl/Cmd+S saves once, and a held Ctrl/Cmd+Enter runs once; a Ctrl/Cmd+Enter that the engine does not take (run.ts
    `requestRun` answers it was refused, where the Run buttons are disabled) says why in a toast, in the words of the
    engine's state (`editor/words.ts` `refusedRunWords`, decided by the maintainer, plan's list A; nothing where the
    press runs, `ready`, or does what "Start engine" does: `none`, `asking`, `declined`, `other-tab-idle`, and a `failed` start that can be tried again); with a dialog open it saves nothing (the browser's Save page is still kept away; C 8 of the plan's list); a failed save adds the banner `save-failed`, which a Save that works removes, and so does the editor taking the store's text again (`reload`: "Reload from the run", "Replace with uploaded"); a Save that answers after a rename of its tab follows the tab to its new name (its dot, its noted form, its banner, its toast), and a Save pressed while a rename or a delete is being written waits for it, then writes under the new name or, for a deleted file, nothing; Save (and Ctrl/Cmd+S) is off unless the active tab is a text tab. The error
    mark keeps to its text when the tab is left and shown again. **The error mark's rule** (`editor/errormark.ts`, one
    place to change it; the joining agent's, for the maintainer to approve: plan, "Step 4: decisions and open questions", B 1): the mark belongs to the file's last run: set
    when a run of that file (whole or a selection) ends with an error on a line (not Break's rc 1); cleared when a new run
    of that same file starts, when the engine is reset or restarted (the effect `engine-gone` sets `lastRun` to null, which
    clears every mark; a run the reset cut is `lastRun` again in the same step, rc 9998 with no line), and when the marked line is
    deleted; it moves with edits; a command from the command line and a run of another file leave it; it lives in the
    tab's editor state, so it goes when the tab closes (a file opened again has none) and stays with a renamed tab. **A run that
    rewrites an open file** (files.ts `afterRun`, from the run's `files`, through `editorCommands.ranOver`; the decision
    in `editor/ranover.ts`, Node-tested, on the texts with their line breaks as CodeMirror holds them, `\n`, so a clean
    tab of a `\r\n` file follows a run as any other; Save keeps the file's form, noted when its text is read
    (`formOf`): its line break (`lineBreakOf`: `\r\n` or `\n`, the more common one in a file with both, `\n` on a tie, for
    a new or empty file and for lone `\r`; the mixed and lone-`\r` cases are for the maintainer to confirm, B 9 of the
    plan's list) and its UTF-8 byte order mark, which the editor never holds (so neither Run nor
    the comparisons see it); Save writes the editor's text in that form (`fileText`), as does the save-failed banner's
    Download, except that a `.do` or `.ado` file (case ignored) is written without its BOM (`dropsBom`), since the engine
    reads a BOM as part of the first command (ODT-34) and a do-file saved here must run in a nested `do`; the name it is
    saved under decides, so a rename keeps the noted BOM and the new name decides at the next Save, and after a Save the
    noted form is the one written; a run that becomes the saved version brings its own form, one that writes the same
    rows in another form leaves the tab's): the same text
    again (a byte-identical rewrite, a `.log` open during every run) changes nothing; a text tab with no unsaved edits
    shows the run's version, changed in one transaction where the two differ, so the caret, the selection and the undo
    history are kept; one with edits keeps them and takes the run's version as its saved text (the tab stays unsaved, so
    Save then replaces the run's version knowingly; the dot clears if the two are the same) and gets the warning banner
    `run-changed` above the editor, on a phone on every view: "**The run changed t.csv.** Your unsaved edits are still in
    the editor; saving them overwrites the file the run wrote." / "Reload from the run", "Dismiss" (a banner, not a question:
    several files at once, a dialog already open and the phone made a dialog the harder path; a save or a reload of the
    file removes it, a close or delete of its tab too, and a rename moves it to the new name, as it does `save-failed`).
    A run that writes something that is not text over an open text tab (binary, not UTF-8: a `.dta` saved as `t.csv`)
    keeps the tab's text, edits or not, makes the tab unsaved, and gets the same banner with other words and no reload:
    "**The run changed t.csv, and it is no longer text.** The editor still shows your text; saving it overwrites the file the run wrote." / "Dismiss" (chosen over closing a clean tab: one path, and no edits are ever lost; for the maintainer to confirm, B 7
    of the plan's list); a later run that writes
    the editor's own text over it makes the tab clean again and takes the banner away. A file the run deleted
    keeps its tab (not handled): the file leaves the file list, the tab keeps its dot as it was, and Save writes the file
    again (an open question: C 7 of the plan's list). `editorCommands.focus()` focuses at once and never changes
    the active tab or the phone's view: CodeMirror's content with a text tab shown, the empty view with no tab (both
    `[data-editor]`); with a .dta tab active, that tab in "Open files" when it is shown, else its view's first enabled
    button (Load), else the focus does not move (for the maintainer to confirm, B 6 of the plan's list); with the Editor pane hidden (a phone on another view) it makes no check of its own: it focuses the same element, which the browser does not focus under `display: none`, so the focus does not move.
    Decisions where this spec is silent: a whole-file run marks no running
    lines (a selection run marks its lines); Break's rc 1 gives no error mark and the note "Stopped by Break before line
    N. The data is as the last complete command left it." with "Go to line N" (a command from the command line: "Stopped
    by Break. The data is as the last complete command left it.", no line); the notes at a run's end (Break's with its
    "Go to line", OQ-10's, the files not kept) wrap in the Log pane at every width; on a phone, a tap on the Break pill also shows
    the Log view, where Break's countdown and its outcome are (decided at the step 4b review, from step 4d's; for the
    maintainer to confirm, B 2 of the plan's list); a phone's
    inline graph is on the card of its run's theme; Run with no text tab open runs nothing and
    says so in a toast; Run runs any open text tab, a .csv too; a selection that ends at the start of a line leaves that
    line out; the page load's status words are "Loading"; a selection's last run is "Last run: lines 6–7 · …" and a
    command's "Last run: a command · …"; the phone's strip shows the state's words where it has no last run; Find is a
    field over the log ("Find in the log", "2 of 5", Enter and Shift+Enter, Esc closes; every match is counted and
    numbered in the log's order; on the desktop with the Output pane unsplit, Find shows the Log tab first; Esc and Close
    give the focus back to the Find button, on a phone to the ⋯ button); Download log saves
    `dofile.log`; the phone's "Run command" is a 44 px icon button (`.send`) that keeps the field's focus (`pointerdown` and `mousedown` cancelled, the click refocuses the field; `aria-disabled` while the field is empty); on a phone the command line has a fixed height
    (`--cmdline-h`, 3.25rem, app.css 4b block) and the toast sits above it and the tab bar (taken as 61 px and the safe
    area, from ui.css's `.tabbar`: a figure, not a measure); the Break pill's time is "3.4 s", "42 s", "12 min"; `.md` and `.json` are highlighted with CodeMirror's
    `@codemirror/lang-markdown` (its `markdownLanguage` alone: `markdown()` would bring the HTML, CSS and JavaScript
    languages, about 160 KB more) and `@codemirror/lang-json`, on the Stata tokens' classes (added when 4b and 4d were
    joined). **Pasted lines** (the maintainer's decision: each line runs in turn): a paste
    with no line break, or with breaks only at its end (one copied line), is an ordinary paste and runs nothing; with
    other breaks, the field's text before and after the cursor joins the first and
    last lines, empty lines are left out, and the lines run one after the other, each once the one before has ended; they
    stop at the first that does not run (refused), that ends with any rc
    but 0 (Break too), or whose run another tab cut by taking the engine (the rest never reach the engine this tab may
    get back; the wait for a line also ends when its run's promise settles), and before a line that cannot run alone (not sent: it runs from the editor): one that ends with
    `{`, holds `///`, opens a `/*` comment it does not close (a pasted `/*`, `drop _all`, `*/` runs nothing), or is
    `program define` or `mata` on its own (`mata: x = 1` runs); a
    toast says how many were not run, and a line that did not run goes back into the field unless the field is disabled
    by then; with no engine a paste is an ordinary paste and no line runs, and with an engine that is not ready a paste
    of lines is refused whole, the field untouched (`log/pasterun.ts` `pastePlan`, `putBack`)
    (these stops are for the maintainer to confirm, B 3 of the plan's list). The next line starts in a microtask
    after the step that ended the one before, so no other Run or Enter is taken between two pasted lines. Load on a phone's
    .dta tab still shows only its toast (4c): the Log view does not open, as a command run from the command line opens
    nothing either (for the maintainer to confirm, B 4 of the plan's list). Words the spec does not give, drafts for the
    maintainer: "No file is open: open one from the file
    list." (the empty editor); "No file is open to run" (toast); a refused Ctrl/Cmd+Enter's toast: "Run is not available until the current run ends" (`running`,
    `breaking`, `waiting`), "The engine is starting. Try again when it is ready." (the page load, `downloading`, `starting-*`; the Run button's own name is "Starting… Run is not available until the engine is ready"), "Run is not available: the engine isn't running in this tab" (a `failed` start that cannot be tried again,
    `failed-twice`, `other-tab-taking`); "Loading" (status bar, the page load); the save-failed
    banner ("analysis.do couldn't be saved: <reason>. Your edits are still in the editor; download them to keep a copy."
    / Download, Dismiss); the pasted lines' toasts ("2 of 4 pasted lines not run: line 2 ended with r(111)", "… not run:
    the engine can't take a command now", "… not run: another tab took over the engine
    during line 1", "… not run: line 2 can't be run from the command line; run it from the editor"); "Stopped by Break before line N. …", and for a command "Stopped by Break. The
    data is as the last complete command left it."; "Not
    kept: a.dta, b.dta. Its folder was renamed or deleted during the run" ("Their folder …" when several files are named);; "The files this run wrote couldn't be kept in
    this browser: <reason>"; the last-run words above; the strip's "Last run: 0.38 s" and "before line 17 · 18.4 s";
    "Find in the log", "no match", "Close"; the editor's name "Editor: analysis.do"; the inline graph's name "Open graph full size: scatter y x"; the live region's "analysis.do couldn't be saved" (a failed save); the run-changed banner
    ("**The run changed t.csv.** Your unsaved edits are still in the editor; saving them overwrites the file the run wrote." /
    "Reload from the run", "Dismiss"; for a version that is not text "**The run changed t.csv, and it is no longer
    text.** The editor still shows your text; saving it overwrites the file the run wrote." / "Dismiss"); a time of a minute or
    more in the status bar and the last run, "2 min 5 s"; "the selection" (a selection's run-head or last run with no
    lines) and "the file" (a run-head with no path).
  - **4c** `output/tabs.tsx` (`GraphTab`, `DataTab`, `ResultsTab`; they may be mounted again when the layout changes, so
    their state lives in signals), `output/FullSize.tsx` (`FullSize`, placed once over the page for every width, open
    while `graphFull`), `output/DtaView.tsx` (`DtaView({path})`, a .dta tab, shown in the editor's place). Writes
    `graphIndex`, `graphFull`, `pickedVar`. It does not write `rows` and does not call `browse`: "Show 50 more" calls
    run.ts `moreRows()`, which appends (run.ts is the one writer of `rows`). Calls
    `call("matrix" | "describe_file", ...)`, `moreRows()`, `runCommand` (Load), `showToast` ("Copied").
    As built (step 4c): `tabs.tsx` only re-exports the three tabs, one file each (`GraphTab.tsx`, `DataTab.tsx`,
    `ResultsTab.tsx`); the logic with no DOM is `format.ts` (tested in Node, `test/output.test.ts`), the clipboard and PNG
    helpers `clip.ts`, and the views' own state `view.ts` (module signals: the filter text, the focused name and value,
    the folds, the open matrices, the cells shown whole, what `describe_file` said of each .dta). Details where the
    sections above are silent: "graph n of N" counts by the graph's number `n` (the log's links) against the newest
    graph's number; the alt text is "Graph: scatter wage educ", and "Graph 2: scatter wage educ" when another kept graph
    has the same command; the card of a run's graph drawn dark is dark (`--graph-card-dark`, OQ-21: the run's theme), and a
    .png from the files is on the light card; the full-size view is a fixed overlay (not a native modal dialog, whose top
    layer would hide the toast) with its own focus trap, which leaves the keys to a native dialog opened over it, and a
    move to another graph is said through `say()` (the graph's alt text); the .dta bar's size is the tree's
    (`formatSize`, decimal units); picking the picked
    name again clears it; a Browse cell over 60 characters, or with a line break, is cut to one line (a break shows as ↵)
    and shows whole when pressed; the r() scalars start open when e() has no scalars; an open matrix closes when another
    run replaces the results; Load says "Loaded wages.dta" (or "Couldn't load wages.dta: r(601)") in a toast when it
    ends; a matrix grid shows 100 rows and 30 columns at most (Copy has all).
    **Step 4c: draft words**, for the maintainer to approve (the words the spec draws are not listed): Load's toasts
    "Loaded wages.dta" and "Couldn't load wages.dta: r(601)"; the alt text "Graph 2: scatter wage educ" (a command that
    another kept graph shares) and "Graph 3" (a graph with no command); a thumbnail's name "Show graph 2: scatter wage
    educ", the thumbnails' list "Graphs"; the full-size view's name "Full-size graph" and, on a phone, "Previous" and
    "Next"; the toasts "Couldn't read the matrix", "Couldn't copy: the browser refused" and "Couldn't copy the image: the browser refused"; a matrix opened in place: "Reading e(b)…", "Couldn't read e(b): <reason>" ("the engine isn't running" with no engine), the buttons' names "View e(b)" and "Hide e(b)"; Browse with every row shown "500
    rows · read only"; the live region's "More rows shown" (Show 50 more) and "Copied" (Copy image in the full-size
    view).
  - **4d** `states/DownloadDialog.tsx` (the prompt and "dofile is open in another tab", built as far as the start and the
    tab lock need: 4d adds S 2's stage times and S 3; "Close editor" goes to `LANDING_URL`, the landing page since step 5),
    `states/ResetDialog.tsx` (`askReset`, which the ⋯ menu calls, and the dialog), `states/banners.tsx` (the engine-state
    banners above the editor and the log, and the reset and storage banners (the unused memory banner view was removed in the post-merge review); `DownloadFailedBanner` was built in
    step 3, "Try again" (`downloadAll`), "Dismiss", an error banner with no role, since the live region says it; 4d
    reworded it: "Step 4d: draft words" below). A failed start's `message` is for the visitor and `detail` is the cause (see "Engine controller choices"). Writes `dialog` (reset; it closes download and other-tab), `banners` (only `dismiss`). Calls `start`,
    `ask()` (the declined banner's "Start engine" leads back to `asking`, section 5), `decline`,
    `stopDownload`, `takeOver` (while the take-over is in progress the state is `other-tab-taking`, for a few
    milliseconds, and a second press does nothing: 4d may mark "Use dofile in this tab" `aria-disabled` then, with the
    same label), `keepWaiting`, `reset`, `editorCommands.runFile` ("Run the file again"), `editorCommands.focus` (through
    `states/focus.ts` `focusStable`), `downloadAll`, and run.ts `refreshData`.
    **As built (4d, to review).** `states/words.ts` holds the logic and the words with no view (Node-tested:
    `test/states.test.ts`), `states/clock.ts` the `useNow` timer of the download dialog (the machine has no clock; a view reads `Date.now()`). Every other elapsed time (the Break pill, the status bar, the running and stopping banners) reads the one `now` of `editor/clock.ts` and the status bar's `ticking` formatter, so they show the same seconds at every tick.
    S 2 and S 3 are one progress dialog: while `downloading` the header row "Downloading  14.2 of 48 MB · 6 s", the bar
    (`aria-valuetext` "Downloading the engine, step 1 of 5": the stage, not the megabytes) and the stage list with the
    bytes on the current stage; from `starting-*` the row "Loading packages  step 4 of 5 · 9 s" (a stage seen twice adds up),
    no bar, done stages keep their time (the download's as "48 MB · 7.1 s"). "Use dofile in this tab" is `aria-disabled`
    and `.off` (same label; ui.css's disabled look, as Run's) in `other-tab-taking`, and a press then does nothing.
    Reset (the maintainer settled it with C 1, 2026-11-13: B 5 and C 1 of the plan's list): `askReset()` is synchronous and
    resets at once only while the engine is `ready` and nothing has run on it since it started (`state.ts` `engineRuns`, a
    count of runs begun on the live engine, 0 after a reset; `words.ts` `resetAsks`). Anything that has run asks, so a run
    that left only a global or a scalar asks too; it no longer describes the memory again. The dialog closes itself if the engine can no
    longer be reset. A banner with controls that goes away with the focus inside it (Dismiss, "Try again", the run ending
    under "Don't reset: wait for it"; the editor's save-failed and run-changed banners and the Files pane's not-text banner too) hands the focus to the editor (`editorCommands.focus()`, which must focus at once; with a .dta tab
    active its own target wins, the tab or Load, in one move), or to the top bar's "More actions" when that moved the
    focus nowhere (the Editor pane hidden: another phone view) (`states/focus.ts` `focusStable`). `ui/Dialog.tsx` uses
    the same `focusStable` when a dialog closes and its opener has left the page (a banner's button: another tab took
    the lock during a Break, then "Use dofile in this tab"), after the timers its answer set and only for a focus left on
    `<body>`; the opener lets go of the focus before `showModal()`, so the browser keeps no element to give it back to on
    `close()`, and the dialog gives it back itself, the same way: a focus its answer places (the close-tab dialog's "Don't
    save") moves once. A dialog that opens while the one before it is still handing the focus back (the next clash after
    "Keep mine", other-tab over a dialog) takes that one's opener as its own, and `<body>` is never an opener (a dialog
    opened with the focus on nothing gives it to `focusStable` when it closes). The
    hand-off waits for a microtask and moves only a focus left on nothing, and the banners that take the focus (the stopping
    banner's button, the waiting banner) take it in a layout effect: so from the stopping banner to the waiting one the focus goes straight across,
    never through the editor. The declined banner's "Start engine" moves the focus to the editor before the prompt
    opens, so the prompt gives it back there. The banners above the editor follow the
    `reason` of a failed start (`failedActions`): no-wasm "Browsers that work" and Download all; download and memory "Try
    again"; updated "Reload the page"; unknown "Try again" and "Reload the page"; failed twice "Reload the page" and
    Download all, never "Try again". Download all is `disabled` while `hasFiles` is false. Above the log: running
    (`not isolated`: S 11's words instead of the Break sentence, as a warning banner with its icon, as S 11 draws it),
    stopping from the Break press until the engine confirms (the button and the pill say "Stopping…" too; "Don't reset: wait for it" and the
    focus on it come once Break has been pending 1 s, `STOPPING_AFTER_S`, so a Break that lands at once moves no focus; the 5 s is the constant `GRACE_S`, as in the running banner's own text, and the time Break was pressed is `resetAt` minus it: `breakPending` in `editor/clock.ts`; at 0 s, until the reset lands, the bold part
    reads "The engine is being reset now:" instead of "In 0 s"), waiting (takes
    the focus), the reset banner ("Run the file again" is drawn only after a Break or a crash that cut a file run, runs that file, is on while the engine is `ready` and the file is open as a text tab, and dismisses the banner: C 3 of the plan's list, fixed 2026-11-13). The toast was not changed. Not built (no signal or owner exists): a "too big" state, "next error",
    the memory banner (not in prototype 1: no limit is measured, OQ-8; its unused view was removed in the post-merge review, C 12 of the plan's list). ("Find" and the failed save's banner `save-failed` are 4b's, built.)
    **Step 4d: draft words**, for the maintainer to approve (OQ-10, OQ-16, OQ-18; the words the spec draws are not listed).
    Reset banner by kind: user "You reset the engine." / break "The engine was reset: the code did not stop at Break."
    (the reason, a cause in parentheses cut off) or, with no cross-origin isolation, "Break reset the engine." "This page
    can't ask a run to stop, so Break resets it." / crash "The engine crashed and was reset." (a storage failure: "The browser closed the file storage, and the engine was reset."); each then "The data in memory is lost; your files are kept." Running banner: "Running lines 14–15 · 3.4 s" also "Running line 9",
    "Running analysis.do", "Running a command". The failed banner: "The engine didn't start." then the engine's
    `message` for the reason (`FAILED` in `engine.ts`), then "Your files are safe: you can still edit and download them."
    The declined banner's "(about 48 MB)" is the build's size. Failed twice: "The engine stopped after failing twice (out of memory)." (the parenthesis only for reason memory) "It won't restart by itself, since each attempt can use a lot of memory. Your files are safe." `DownloadFailedBanner` (OQ-16, storage unavailable): "Your files couldn't be downloaded. This browser wouldn't open the storage where dofile keeps your files. Try again, or reload the page." / Try again, Dismiss. Stopping banner at 0 s: "**The engine is being
    reset now:** the data in memory is lost; your files are kept."  The memory banner is not in prototype 1: no limit is measured (OQ-8); its code is removed. Progress rows: "Downloading the engine",
    "Unpacking the engine", "Starting Python", "Loading your files", "Loading packages", "Starting the engine", "step N
    of M". OQ-18: "Browsers that work" goes to `/#browsers` (`BROWSERS_URL` in `states/banners.tsx`), the section
    step 5 built listing the browsers that run dofile, opened in a new tab. OQ-10, the
    notes (`noteFor(rc, error)` in `words.ts`; 4b's log shows the note as a `.note` line after the run's text, under its
    error, where `error` is the error the run ended with, its last error line that is not `r(N);`, not one an earlier
    `capture noisily` caught: `log/classify.ts` `runError`): `restore` with nothing preserved (r(622);
    the engine prints only "nothing to restore") "Nothing was preserved. A run restores its data when it ends, so put preserve and restore in the same run."; a community command (the engine says "command reghdfe is unrecognized" with r(199), which the code matches, so the note shows; it may suggest a near name, "did you mean recode?") (r(199), `reghdfe`, `esttab`, `estout`, `outreg2`, `ivreg2`, `xtivreg2`, `ftools`, `winsor2`)
    "reghdfe is a community command. OpenDTA, the engine behind dofile, doesn't include it." No note for a
    temporary name from an earlier run (r(601) naming the engine's temporary file): the engine's own line after `r(601);`
    says it (`browser.py` TEMPFILE_HINT, "(a tempfile lasts one run: save it under a name to use it in a later run)"), so
    the draft "A tempfile, tempvar or tempname lasts one run. …" was dropped when 4b and 4d were joined.
  - **Start engine: draft words**, for the maintainer to approve (2026-11-12, with the queued run's removal; the words
    are in `app/start.ts`, `editor/RunControls.tsx`, `editor/StatusBar.tsx`, `log/CommandLine.tsx` and
    `states/banners.tsx`): the button "Start engine" (the toolbar's Run, the command line's button on a desktop and a
    phone, and the declined banner's button, which was "Download the engine"); the command line's hint "Start the
    engine to run code", and "The engine isn't running" where nothing can start it from here (a failed start whose
    banner says to reload or to use another browser, failed twice, a take-over in progress); the toasts of the controls
    that are off, "Start the engine to see help regress" (the link's own text after "see"), "Start the engine to load
    wages.dta" and "Start the engine to import survey.csv" (the file's name), and where nothing can start the engine
    from the page (the same states as the hint's) "The engine isn't running: can't see help regress", "The engine
    isn't running: can't load wages.dta", "The engine isn't running: can't import survey.csv"; the toast of Enter in
    the off command line and of a press of the off "Start engine" is the hint's words; the toast of a command, or of a
    press of the off "Run command" or the off Run, while the engine takes none is the refused Ctrl/Cmd+Enter's ("The
    engine is starting. Try again when it is ready.", "Run is not available until the current run ends"); the status bar's "**No engine** · Start
    engine downloads it" (`declined`; was "Run downloads it first"). The download prompt has one title again, "Download
    the engine?": "Download the engine to run code" is gone with the run behind it.
  - **Clear log dialog: draft words**, for the maintainer to approve (UI fix round): the title "Clear the log?", the body
    "This removes the log and the graphs. Your data and your files stay.", the buttons "Clear log" (danger) and "Cancel"
    (focused, as Delete all's); the Log head's button "Clear…" (accessible name "Clear log…") and the menus' item "Clear
    log…" (the "…" says it asks first). They are disabled when `canClearLog()` (`run.ts`) is false: no log item but the
    head and the streaming run's text, and no graph. The view is `log/ClearLogDialog.tsx`. The focus goes back to the
    opener (a menu's item: the menu's button); when the answer disabled the opener (the head's "Clear…"), `ui/Dialog.tsx`
    gives it to the editor or "More actions" (`focusStable`), as for an opener that has left the page.
  - A dialog kind or banner kind maps to its view in `dialogs.tsx` and `banners.tsx`; a new kind goes there, in
    `types.ts` and here together. A kind's entry there has its place (files, editor, log) and may add `phone: "every"`:
    on a phone every view draws it (download-failed, run-changed); the hidden views are `display: none`, so it is read and tabbed once.
- **The editor's interface** (`editor/commands.ts`; no-op defaults until 4b's editor mounts, so 4a can call them first):
  `runFile()`, `runSelection()`, `save(path?)` (resolves true once saved), `focus()`, and for 4a `open(path, text)` (a
  text file was opened: its tab is in `tabs`), `reload(path, text)` (an upload replaced an open file, F 3.3: edits
  dropped), `renamed(from, to)` (an open file was renamed or moved: the editor keeps text, edits and undo), `closed(path)`
  (a tab closed, the close-tab dialog's "Don't save" too, or its file deleted: the state is dropped); for 4b's log and 4d
  `goToLine(line, path?)`; for files.ts `ranOver(path, text)` (a run rewrote an open text file; `text` is null when the
  run's version is not text; it answers "same", "shown" or "kept", and files.ts adds the banner `run-changed` on
  "kept"). `reload` returns at once when the file has no tab or state. 4a changes `tabs` first, then calls these. `selection` is the editor's. The editor fills
  `editorCommands` field by field when it mounts: call through the object (`editorCommands.save(path)`) and never
  destructure it or keep a field, or the caller keeps the no-op.
- **Slots in `App.tsx`.** `FileBar` above the editor; the editor sits in `.editor-slot`, hidden (never unmounted) while a
  `dta` tab shows `DtaView`; `FullSize` once, after `main`; on a phone the Log head is hidden, so its actions are in the strip's "Log ⋯"
  button through `logMenuItems()` (its "Clear log…" asks first) while the Log view is shown (the phone's top bar, `PhoneTopBar` in `App.tsx`, which also
  places `PhoneRun` and `FileSwitcher`; `PhoneStrip` goes under it); the command line is at the Log pane's foot,
  so on a phone it shows on the Log view only (section 2).
- **Dialogs.** The host keys each view on the whole `dialog` value, so a new value (clash 2 after clash 1) is a new
  `<Dialog>` with its focus on `data-autofocus` again. A view that another dialog replaces is unmounted with no answer:
  it treats that as Cancel.
- **Primitives** (`web/src/app/ui/`): `Dialog` (a native modal `<dialog>`: `title`, `actions`, `role`, `onCancel` = Esc,
  none = blocking; `data-autofocus` marks the first focus; focus returns to the opener when it unmounts, or, when the
  opener has left the page, to the editor or "More actions" (`states/focus.ts` `focusStable`), after the timers its answer
  set and only for a focus left on nothing, so it moves once; a bottom sheet
  under 700 px); `MenuButton` and `openMenu({label, items, anchor | at})` (one menu at a time, in the top layer, arrows,
  Home, End (the menu owns its active item, a position among all its items; an item takes the focus from its own render), Esc returns focus, Tab closes and moves on from the trigger; an item is `{label, onSelect | href, hint,
  danger, disabled, keepOpen}` or `"rule"`; `keepOpen` leaves the menu open with the focus on the item, as the phone's
  "Theme: ◐ System" does to cycle the theme; `items` may be a function, called at each render of the open menu, so the
  signals it reads keep the labels current); `Tablist` (roving focus, arrows select; `tabpanelProps(prefix, id)` for the panel);
  `Banner` (`kind` info, warn, error, `role`, `actions`, `focusable`); the live region and `say(text)` (what is said
  in one 50 ms window is said as one text, joined by ". "); the toast and `showToast(text)`; `Icon`, `Key` (⌘ on a Mac,
  Ctrl elsewhere), `Labels({labels, at})` (a control's labels in one cell: it keeps the size of the widest; only
  `labels[at]` is seen and named), `Placeholder`.
- **Pinned down or changed:** `engineBytes` is `number | null` (null: no meta tag, a dev server with no snapshot); it is
  the meta tag, which holds start-files.json's `compressed` total; the page fetches nothing for it. `t0` of `starting-list` and `starting-worker` is when
  the current stage began, and a stage seen twice adds up in `done` (the snapshot start reads the cache after
  `download()`). `outputTab` has no "help" (P2). New signals: `layout` ("phone" under 700 px), `resolvedTheme` (computed:
  what a run sends as `plot_theme`), `graphFull`. Kept in localStorage: `dofile.theme`, `dofile.split`, `dofile.wrap`. Whether
  to ask before the download is read from the Cache, not stored.
- **Engine controller choices.** The controller decides nothing itself; the machine's table does (section 5). It reads an
  error's `kind`, `reason` and `name`, never its text. A `download()` failure other than "Stop download" is `failed` with
  reason "download" at once, with no worker (section 6); `kind: "updated"`, from `download()` or `build()`, is `failed` with
  reason "updated": 4d offers "Reload the page", keyed on the reason. The message of reason "updated" says in plain words
  that the site has a newer version and the page must be reloaded (`UPDATED`), with no cause. The visitor's `message` is one
  fixed sentence per reason (`FAILED` in `engine.ts`; `FAILED_TWICE` for `failed-twice`): what happened and what to do (try
  again, reload the page, close other tabs, another browser), with no command, file name, byte count or build term. The
  cause (it may name `npm run snapshot`, a file, bytes) is `detail`, logged to the console by the effect `warn` and not shown
  by default. No message names `?snapshot=0`, and there is no automatic fallback to the normal boot. The failed states'
  banners are 4d's (`states/banners.tsx`).
  - **Tickets and the drop record.** Each request (the tab lock, the cache check, the download, the list fetch, each worker,
    each take-over) has a ticket, a number the machine issues. An answer presents the ticket of the request it answers, and the
    machine drops an answer whose ticket is not the state's current one: a reset during a start, a lock lost during a
    download, a second take-over. A dropped event, and an event that is not valid in the state it finds, changes nothing and
    is recorded (`drops()`). So no counter or flag outside the machine decides a state, and the performers cannot put a
    ticket on an event themselves: they answer through a `reply` bound to their effect.
  - **Resets.** A reset ends the worker, fetches the build's list afresh (`starting-list`), then starts a new worker; every
    reset goes that way, and its first stage is not announced (it reads the cache; "Download the engine" would mislead). A
    reset of an engine that had been ready adds `{b: "reset", reason, kind, run}` (`run`: the run the reset cut, or null) and says "Engine reset"; a crash during a start
    adds nothing. Reset and "Reset now" give the reason "reset by you" (4d's words may
    change it). A page that cannot ask a run to stop (no `SharedArrayBuffer`) resets at once on Break. Every exit from
    `breaking` cancels the Break timer.
  - **No run is held, and with no engine nothing offers to run.** A `run` is valid in `ready` alone. With no engine
    (`app/start.ts`) the one action is "Start engine": the event `ask` (the download prompt; in `other-tab-idle` the
    take-over dialog) or, after a failed start that can be tried again, `start`. No state keeps a run or a mark that a
    run was wanted (`asking` has no fields, the prompt one title), so when the engine is ready nothing runs by itself.
    (Until 2026-11-12 the machine held the run and sent it when the engine had started, and dropped it when the start
    did not happen; the maintainer removed that, and then the prompt that a run opened: plan, Post-merge review.)
  - **The tab lock.** Losing it ends the worker, blocks the store, shows the take-over dialog, tells run.ts the engine is gone
    (it clears what the engine left) and cuts a run in progress with rc 9998, kind `stopped`. A lock answer that arrives after
    the lock was lost, or after a take-over was cancelled, is stale and dropped; there is no counter for it.
  - **A step.** The `engine` signal is written before the step's effects are performed, and the effects are performed also when
    a subscriber of the signal throws. Events raised while a step's effects run wait in a queue and run in order after it.
- **Run controller choices.** A result the machine made (rc 9998) keeps the text that streamed in and adds its `error`
  as a note, since its `log` is empty; one of kind "run-failed" (the worker stays) is not a reset: the data is asked
  again. After Break, a run's result stands as the engine gave it: rc 1 when the engine took the Break at a safe point,
  the run's own rc when it had ended before one; rc 9998 is always a reset (or kind `run-failed`). After a reset whose new
  start fails, "Try again" does not clear `lastRun`: it stays the run the reset cut. Each run's text item keeps `unsaved` (the open files with unsaved edits when it started, for S 15's note) and,
  when it ends, `end` (the same object as `lastRun`: rc, the error line in the file, seconds, `skipped`,
  `store_error`), so an older run keeps its own "Go to line". The run-head's `first` is per engine: a reset starts
  again, and the run it cut counts for the old engine. "Clear log" empties the log but its head (the banner and the versions line, as a fresh page shows it; this reverses the first spec, "the head too") and the graphs, keeps
  a running run's text item, and graph numbers start again at 1. `graphs` keeps the last 20, so a graph is found by `n`,
  never by a kept index. A run's graphs keep the theme it was sent with. Run sets `phoneTab` to "log" on a phone; a
  command does not. A run cut because another tab took the lock (kind "stopped") does not set `lastRun`.
- **Layout as built.** One component tree for every width (the editor and the log are never mounted twice), in
  `web/src/app/App.tsx`, each phone piece next to its desktop counterpart (`PhoneTopBar` after `Toolbar`, the phone's ⋯
  items after the desktop's, `PhoneOutputViews` after `OutputPane`, the `PhoneViews` tab bar in place of the status bar);
  each pane is a `Pane`, which on a phone is also a Views panel. Desktop B from 1200 px: `230px | minmax(400px, 1fr) | minmax(0, 660px)`.
  From 700 to 1199 px the file list is folded away; a "Files" button with the count of files ("Files 3"; `aria-expanded`,
  `aria-controls`, a pressed look while open) at the start of the Editor head unfolds it, moves the focus into it (the
  tree's row in the tab order, else the pane), and Esc in the list folds it and gives the focus back. Under 700 px: the
  top bar (title, ⋯, the one Run button), the view, the Views tab bar; no status bar (4b's `PhoneStrip` goes under the top
  bar); the toast sits above the command line and the tab bar (lower on the views with no command line). The page itself never scrolls or bounces, only panes do:
  `.app` is fixed to the window. iOS Safari, and by default Chrome (108+) and Firefox (132+) on Android, keep the page's
  height when the on-screen keyboard opens (only the visual viewport shrinks; the viewport meta sets no
  `interactive-widget`, so Android keeps that default), so on a phone `app/viewport.ts` follows `window.visualViewport`:
  while it is shorter than the layout viewport by more than 120 px at a zoom of 1, `<html data-keyboard>` is set with
  `--vv-height`, `.app` takes that height from the top, the tab bar is hidden, so the command line sits right above the
  keyboard, and the toast goes above the command line at that area's foot. A browser that shrinks the layout viewport
  instead counts the keyboard open while a text field has the focus and the page is more than 120 px shorter than its
  tallest at that width. Safari pans the page up to a focused field before the page hears of it, so while the keyboard
  is open a pan is scrolled straight back; the phone's command line takes a tap's focus itself with `preventScroll`, so
  it is never panned; and the editor's caret is scrolled above the keyboard when it opens and again once it has settled
  (iPhone measurements: `docs/phone-keyboard-experiment.md`; `?kblog` shows the viewport's events on screen). The editor page's viewport meta has `minimum-scale=1, maximum-scale=1, user-scalable=no` (the maintainer's choice on 2026-11-12, to steady the phone keyboard; it limits pinch zoom, and axe's `meta-viewport` would flag it if axe ran on the editor). The theme button's labels for light and dark follow the spec's for system:
  "Theme: light. Press for dark, then to follow the system." and "Theme: dark. Press to follow the system, then light."
  A tab controls its panel only while selected (`aria-controls`).
- **Screen wake lock (`app/wakelock.ts`).** On a phone a locked screen suspends the page and the browser may discard it,
  which would lose a download of about 48 MB, an engine start or a long run. So while the engine is working for the
  visitor the page asks the browser to keep the screen awake (`navigator.wakeLock.request("screen")`). The policy is one
  table in that file, `WAKE_LOCK`, over the sixteen state names (a new state does not compile until it has an answer):
  wanted in `downloading`, `starting-list`, `starting-worker`, `running`, `breaking` and `waiting`; not wanted in
  `checking-lock`, `checking-cache`, `none`, `asking`, `declined`, `ready`, `failed`, `failed-twice`, `other-tab-idle`
  and `other-tab-taking`. The lock is asked for when a state first wants it and let go when none does. The browser lets it
  go by itself when the page is hidden, so the page asks again when it is visible again and the lock is still wanted; a
  request that is refused is ignored, with no message; at most one lock is held, and one that arrives after it is no
  longer wanted is let go. A browser without the API gets nothing. No setting, no toast. The module only reads the
  `engine` signal; `main.tsx` starts it once.
- **Tests.** `web/test/app.test.ts` (the controllers on a stand-in transport, and `viewport.ts` on a stand-in
  `visualViewport`), `web/e2e/shell.spec.ts` (the shell: the toolbar's boxes in every engine state at three widths, one
  height for the desktop toolbar's buttons and for the pane heads' controls, the phone ⋯'s Theme that keeps the menu
  open, the editor and log never mounted again, the folded file list by keyboard, a phone page that cannot scroll, the
  phone toast's place with the keyboard closed and open, the failed "Download all" banner on every phone view),
  `web/e2e/engine.spec.ts` (the proof of concept's engine cases through the hook, Break and Reset through the
  controller); `web/e2e/step2.spec.ts` goes through the hook and the shell's dialogs. The Node tests of the engine code: `web/test/machine.test.ts` (the transition table cell by cell, the properties, the race scenarios, and SPEC section 5's matrix), `web/test/imports.test.ts` (the contracts no type can hold: the import graph, single instances, one writer for each signal), `web/test/client.test.ts`, `web/test/engine.test.ts`, `web/test/files.test.ts` and `web/test/store.test.ts`. The specs import `test` from
  `web/e2e/fixtures.ts`, which makes `persisted()` true (no storage banner) unless a test sets `persisted: false`. The four editor tests left in
  `web/e2e/poc.spec.ts` are fixme until step 6.
- **Design-system items done here:** DS-5 (text sizes in rem; at a 20 px default the log's 80 columns scroll sideways),
  DS-8 (`--dur-fast`, `--dur`, `--z-menu` < `--z-toast` < `--z-dialog`), DS-7's bottom sheet and tab bar (drawn in
  `system/index.html`).

### As built in step 5 (landing, commands, sample; branch `prototype1-step5`)

The maintainer's list for step 5 (decided, waiting for confirmation, open) is the plan's "Step 5: decisions and open
questions" (`docs/prototype1-plan.md`); the first real deploy's checks are below, under "To look at on the first real deploy".

- **URLs** (decided by the maintainer in the review of step 5): the landing page is the site's root, `/`; the commands page is
  `/commands/`; the editor is a single-page app under `/app/` (`/app/?test` and the other flags as before). Every address,
  in `npm run dev`, `npm run preview` (and the e2e tests) and on the host (Cloudflare Workers static assets, `wrangler.jsonc`):

  | Address | Serves |
  |---|---|
  | `/` | the landing page (`dist/index.html`, from `web/landing.html`); `/#browsers` its "Browsers that work"; `/index.html` redirects to `/` |
  | `/commands/` | the commands page (`dist/commands/index.html`, from `web/commands.html`); `/commands`, `/commands.html` and `/commands/index.html` redirect to it |
  | `/app/`, `/app/?test`, ... | the editor (`dist/app/index.html`, from `web/index.html`); `/app`, `/app.html` and `/app/index.html` redirect to `/app/`, the query kept |
  | `/app/assets/…`, `/app/snapshot/…`, `/app/pyodide/…`, `/app/start-files.json`, `/app/*.whl` | the editor's files |
  | `/assets/…` | the two static pages' own script, stylesheet and fonts |
  | anything else (`/landing.html`, `/nope.html`, `/nope/`, `/app/nope.html`, `/_headers`) | 404, never a page in its place |

  `/commands/` and not `/commands.html`: a folder's index is served at the same address, with no redirect, by the dev server,
  `vite preview` and Cloudflare's `html_handling: "auto-trailing-slash"`. `wrangler dev` (local workerd) redirected `/index.html`,
  `/commands`, `/commands.html` and `/app` (with and without `?test`) as the table says; the dev and preview servers do the
  same for every redirect in the table (`slash` in `vite.config.ts`), and `/app.html`, `/app/index.html` and
  `/commands/index.html` are redirected there to match what auto-trailing-slash is documented to do, not seen on workerd. `/landing.html`
  was never deployed (step 5 is the first to build it), so it is a 404, not redirected. Headers: the cross-origin isolation the editor's Break needs (`COOP: same-origin`, `COEP: require-corp`) on
  `/app/*` only (`dist/_headers`, written by the site's build); the static pages get none. The dev server sends them on every
  response (Biome's checker panel is a frame and needs them). Links: the static pages name each other by absolute path (`/`,
  `/commands/`) and the editor by `{{editor-url}}`, which the build fills; the editor names the landing page by
  `LANDING_URL` (`app/env.ts`, from the build's `__SITE_URL__`) and `BROWSERS_URL` (`${LANDING_URL}#browsers`); its own files
  by `import.meta.env.BASE_URL` (`main.tsx`), so the worker, the wheels, `pyodide/`, `snapshot/`, `start-files.json` and the
  paths in it (relative to the list) all follow the base.
- **Checked on `wrangler dev`** (local workerd, Cloudflare's runtime on this machine, not the edge), with `dist/` built on the
  quality-11 snapshot as `deploy.yml` builds it (no file over 21 MB): every address in the table, its status, redirect and
  headers, and in Chromium the landing page's and the commands page's scripts, and the editor at `/app/?test` starting from
  the snapshot, cross-origin isolated, and running code. `vite preview` (the e2e tests) answers as the table says, which is
  the documented host behavior, not the edge's.
- **To look at on the first real deploy** (the edge itself is not checked: its compression and caching, `deploy.yml`'s upload):
  1. `/`, `/commands/` and `/app/`: in the editor's console `crossOriginIsolated` is true, and the download size on the prompt
     and on the landing page agree.
  2. The redirects: `/app` and `/commands` to their folders, the query kept (`/app?test`); and, not requested on workerd,
     `/app.html`, `/app/index.html?test` and `/commands/index.html` (the preview server redirects them as auto-trailing-slash is
     documented to). Note the status code and whether `Location` is a path or a whole URL.
  3. What preview serves and the edge may not: `/index`, `/app/index`, `/commands/index` and `/app//` answer 200 in preview;
     the edge should redirect them to the folder. Harmless either way, since every URL the editor uses is absolute.
  4. A missing page is a 404 (`/nope.html`, `/app/nope.html`, `/landing.html`), and `/_headers` is a 404 (not uploaded as a
     file).
  5. The isolation headers on a 304 under `/app/*`: reload the editor in Safari once the engine has started (WebKit refuses a
     worker script whose cached 304 reply lacks COEP).
  6. "Browsers that work" from the editor opens `/#browsers`.
  7. A tab of the old build (the editor at `/`) left open across the deploy: its next start or Reset fetches `/start-files.json`,
     now a 404, so it shows a failed download ("Try again" fails the same way) rather than "dofile was updated"; a reload loads
     the landing page, and "Open the editor" the new editor, with the visitor's files (same origin). Unsaved edits in that tab
     can still be saved to the store before the reload.
  8. If step 4 deployed before step 5 with the same snapshot (`built` unchanged): after one download at `/app/`, DevTools'
     Cache Storage `dofile-snapshot-<built>` holds only `/app/…` entries (`download()` dropped the root-keyed ones).
- **One setting: `web/scripts/urls.ts`.** `EDITOR_BASE` (`/app/`; or `DOFILE_EDITOR_BASE`) is the editor's Vite `base` and
  its output folder (`dist/app/`); `EDITOR_URL` (default `EDITOR_BASE`; `DOFILE_EDITOR_URL`) is what the static pages link
  to; `SITE_URL` (`/`; `DOFILE_SITE_URL`) is the landing page, from the editor. `vite.config.ts`, `playwright.config.ts`
  (its `baseURL` ends in the base, so a relative `goto("?test")` is the editor and `goto("/")` the landing page),
  `e2e/global-setup.ts`, `scripts/start-files.ts` and `scripts/measure-startup.mjs` read it; the tests compare with the
  setting, not with `/app/`. `test/site.test.ts` fails if another source (`.ts`, `.tsx`, `.mjs`, `.html`, `.css`, `.json`), script,
  e2e test, config, page or workflow spells the editor's path after a quote, a backquote, `(` or `=` (comments may name it; a
  path joined from pieces, `"/" + "app"`, is not caught: never write one).
  **Another path on the same origin:** change `EDITOR_BASE` (or set `DOFILE_EDITOR_BASE`); nothing else. Checked with
  `/editor/`: `npm run build` wrote `dist/editor/`, `_headers` for `/editor/*` and the landing page's links to `/editor/`;
  `npm test`'s site tests and the e2e specs `landing`, `sample`, `commands` and `step2` (Chromium) passed on it.
  **Its own subdomain later** (`app.<domain>`), two folders deployed as two Workers; checked into `/tmp`:
  1. The editor: `DOFILE_EDITOR_BASE=/ DOFILE_SITE_URL=https://<domain>/ npx vite build --outDir <editor folder>`. It writes
     the editor at the folder's root, its `start-files.json`, and its own `_headers` with every path isolated (`/*`); it leaves
     `dist/` alone (only a build into `dist/` empties `dist/`).
  2. The static pages: `DOFILE_EDITOR_URL=https://app.<domain>/ DOFILE_EDITOR_DIR=<editor folder> npx vite build --mode site
     --outDir <site folder>`. The download size comes from the editor's list in `DOFILE_EDITOR_DIR`; no `_headers` (the editor is
     elsewhere, and the pages need none). The site's build refuses to write into the editor's own folder (with `EDITOR_BASE` `/`,
     `npm run build` as it is fails there, so the landing page never replaces the editor's `index.html`).
  3. By hand: a second Wrangler config for the editor's Worker (`assets.directory` the editor folder, the same `html_handling`
     and `not_found_handling: "none"`) and this one's `directory` the site folder; `package.json`'s `build`, `cf:dev` and
     `deploy` and `deploy.yml` (two builds, two deploys, the size check over both folders) changed to match; the e2e setup,
     which serves one origin (`vite preview` of one folder, `baseURL` the site's origin plus the base), needs a second server
     for the editor's origin before the tests that cross between the pages run; the dev server has no static pages with
     `EDITOR_BASE` `/` (they are another site's).
  What does not follow the editor to
  a new origin, because the browser keeps it per origin: the visitors' files (IndexedDB `dofile`; they must "Download all
  (.zip)" on the old address and upload them on the new), the downloaded engine (the Cache `dofile-snapshot-<built>`: a first
  visit's download again), the tab lock (`dofile-engine`, per origin), the sample's mark (everyone gets the sample again) and the
  theme choice (`dofile.theme`: the landing page and the editor no longer share it). Moving the path on one origin keeps the
  files, the tab lock and the theme (all per origin), but the Cache's entries are keyed by their full URL, so a visitor whose
  engine was cached at `/snapshot/…` downloads it once more at `/app/snapshot/…`; that download removes the old copy
  (`download()` drops every entry of the Cache it fills that the build's list does not name, when no worker is live; the list's
  own files stay, so a resumed download keeps them).
- **Builds.** `npm run build` = the wheel, then `vite build` (the editor: empties `dist/`, writes `dist/app/` with its
  `public/` files and `start-files.json`, which lists only `dist/app/`), then `vite build --mode site` (the static pages:
  `publicDir: false`, no module-preload polyfill, so they load nothing of the editor's; their download size read from
  `dist/app/start-files.json`, which must exist; the pages moved to `index.html` and `commands/index.html`; `_headers`).
  Both builds take their folder from Vite's resolved `build.outDir`, so `--outDir` moves the whole output, `start-files.json`
  included. `vite preview` serves all of `dist/` at `/` with the isolation headers under `/app/` and the folder redirects, as the
  host does. The dev server is the editor's (base `/app/`) with a middleware for `/` and `/commands/` (their scripts are then
  served from under `/app/`, a dev-only detail).
- **Files.** `web/landing.html`, `web/commands.html`; `web/src/site/` (`site.css`, the one stylesheet of these two pages, which
  the editor does not load; `site.ts`, the theme button and the Copy buttons, shared; `theme.ts`, the theme button's words,
  the editor's (a test compares them); `landing.ts`; `commands.ts` and `filter.ts`, the filter). These import nothing but
  `src/site/` and the stylesheets (CSS `@import`s too), and nothing imports them, the editor's `index.html` and CSS included (`test/imports.test.ts`): no signals, no store, no tab lock, so
  reading the landing page never touches the editor's files. `web/scripts/site-pages.ts` fills the pages at build time (a
  plugin in `vite.config.ts`): `{{version}}` (the package's version, `0.1.0.dev1`, OQ-20), `{{engine-mb}}` (`Math.round` of
  the compressed total in MB, the editor prompt's number: in dev from `public/`, in a build from the editor's
  `start-files.json`), `{{editor-url}}` (section 8, "URLs") and the commands list.
- **Landing page** as drawn (`L`): desktop two columns, the phone's hero, both banner drawings and `welcome.do` hidden from
  screen readers with a plain copy that holds no link; Copy buttons that name what they copy (the button says "Copied" for
  2 s, the live region says "Copied to the clipboard" once); " from a public CDN" and " from a CDN" are gone; "48 MB" is the
  build's number in every place. Added: the section `#browsers` ("Browsers that work", the target of the editor's banner link and
  of the section's own heading), full width under the two columns.
- **Commands page** (OQ-18): the landing page's top bar and footer, one column of text, then every name of
  `src/stata/commands.json` (`npm run commands` makes it from the engine's registry) in columns, written into the HTML by the
  build, so the list is there with no script. In each name the shortest form you can type is bold. Names `browser.py` turns off
  (`DENIED`, read from the source text) carry "off in the browser". A second list holds the prefixes: the six the interpreter
  handles itself (`OWN_PREFIXES` in `scripts/site-pages.ts`, a test compares them with `src/stata/language.ts`) and the
  registry's. Each list is a `<section>` with its heading (and the prefixes' note). A filter field (shown only when the script
  runs) keeps the names that contain the text, hides a section with no name left, and says "N of M commands", with ", 1 prefix"
  or ", N prefixes" when prefixes are shown (`countText` in `src/site/filter.ts`).
  No descriptions and no links to help pages: a name's meaning is the visitor's own knowledge or a search away, and the
  clean-room risk of 515 descriptions is not worth it (`R` round 1).
- **Sample** (`F 2.1`, `F 2.4`; OQ-21's names): `web/sample/analysis.do` (the main do-file: `use`, `describe`, `summarize`,
  `tabulate`, `tabstat`, `regress`, a `foreach` loop, `do helpers.do`, a `scatter`), `web/sample/helpers.do` (a `program` that
  compares two groups' average wage), `web/sample/data/wages.dta` (500 rows: `id age educ female region wage`, made by
  `web/sample/make_sample.py` with numpy's `default_rng(2026)` and written by the engine itself, with a fixed time in the .dta
  header, so every run makes the same bytes; `--check` says whether the committed file is what the script makes, and
  `tests/test_sample_data.py` checks it in CI. The draws repeat while numpy is the version `uv.lock` pins). `npm run sample` runs the script and `scripts/make-sample.ts`, which writes the generated
  module `src/app/sample-files.ts` (text as strings, the .dta as base64) so the sample is in the page's own bundle and needs no
  request. `src/app/sample.ts`: `seedSample()` is called by `files.ts own()` once the tab lock is this tab's; it writes the three
  files and opens `analysis.do` when the store has no entry at all and the localStorage mark `dofile.sample` is not set, and sets
  the mark once the three files are written (a seed that fails sets none and never rejects). A store with a file of the
  visitor's is never written (the mark is set so it never will be); a visitor who deleted everything is not given it again.
  The seed's own writes (of the sample's paths) bring no storage banner (S 19); any other change meanwhile, and the visitor's
  first change afterwards (a Save, an upload, a run that writes a file), does (`files.ts`, from the store's change row). With `?test` in the URL it does nothing unless the URL has `?sample` too, so the e2e specs
  start from an empty store. "Restore the sample" (`fileMenuItems`, above "Delete all files…" after a rule): writes the missing
  files with no question and the toast "Sample restored"; if any file of the sample is there with other contents, or is open
  with unsaved edits, the dialog `restore-sample` ({ d, paths }; `files/dialogs.tsx`, `role="alertdialog"`) asks first and
  Replace drops those edits. Other files are never touched. A restored file that is open is reloaded in its tab with the text
  decoded as the editor reads a file (`decodeText(bytes, true)`), so the tab takes the sample's form, `\n` and no BOM: a tab
  whose file had `\r\n` or a BOM saves the sample's form from then on, as the store holds it.
- **Words decided by the maintainer on 2026-11-12** (the UI fix round; the rest of the draft words stay drafts): "Home" (the
  commands page's link to the landing page, was "Back to the start"), "Clear" (accessible name "Clear log"), "Wrap lines",
  "Commands", "Files" / "File actions", "Log" / "Log actions", and the footers' "open source" link to the GitHub repository.
    Step 5 also has a sticky top bar on both static pages (`--bar-h`; the commands filter sticks under it).
- **Words decided by the maintainer on 2026-11-12, in the review of all five draft lists** (the entries not named here stay
  drafts; "was" gives the old words, which the code no longer has). 4a: "Enter a name." (was "Type a name."); "A name can't
  contain a line break."; "Its name has a character a command can't use: rename the file."; the delete bodies "The folder
  and its files exist only in this browser. This can't be undone." / "It exists only in this browser. This can't be undone."
  and Delete all's "This can't be undone."; "2 files uploaded · 1 failed"; the live region's "Couldn't create the file",
  "Couldn't create the folder", "The upload failed"; "That name isn't allowed." for a refusal from the store too. 4b: "Run is
  not available until the current run ends"; "The engine is starting. Try again when it is ready."; "Run is not available:
  the engine isn't running in this tab"; the status bar's "Loading"; the pasted-line toast "… line 2 can't be run from the
  command line; run it from the editor"; "Their folder was renamed or deleted during the run." (several files; "Its" for
  one); the Find count "no match"; the run-changed banners' "…saving them overwrites the file the run wrote." and "…saving it
  overwrites the file the run wrote."; the strip's "Last run: 0.38 s"; the inline graph's name "Open graph full size: scatter y x".
  4c: "Couldn't copy: the browser refused", "Couldn't copy the image: the browser refused", "the engine isn't running". 4d:
  "The engine crashed and was reset." and "The browser closed the file storage, and the engine was reset."; "the data in
  memory is lost" everywhere (the engine's own message too: "Data in memory is lost; your files are kept."); the "updated"
  reason "dofile has a newer version on this site. Reload the page to use it."; failed twice "(out of memory) … since each
  attempt can use a lot of memory"; the download-failed banner "This browser wouldn't open the storage where dofile keeps your
  files. Try again, or reload the page."; the stage names, one list (`stageNow`: the dialog's rows as they are, the status bar
  with a small first letter after "Starting · ", the live region as they are; the status bar's `downloading` stays "downloading",
  short, since no room was measured at 1200 px); "Nothing was preserved. A run restores its data when it ends, so put preserve
  and restore in the same run."; "reghdfe is a community command. OpenDTA, the engine behind dofile, doesn't include it."
  (the engine says "command reghdfe is unrecognized", r(199), which the code matches; the note shows); the status bar's
  "Not started · the engine didn't start" and the Run button's "Not started" (the failed-twice state shows it too; "Stopped ·
  failed twice" stays in the bar), and "**Paused** · another tab has the engine". The memory banner (4d) is dropped from the
  draft words: it is not in prototype 1. The failed banner's "Browsers that work" link opens in a new tab (it did already).
  Step 5: "Your other files are untouched."; the section "Browsers that work" of `landing.html` (new text: computers, iPhone
  13 checked by hand, Android not tested, the files stored in this browser only, Break resetting the engine on some networks);
  the commands page's first list is "Command names" and its last link "Open the editor →"; "Home" stays. The Log head's "Clear"
  and the menus' "Clear log" take the danger color (`.danger`).

- **Words of the landing page's fix round** (2026-11-12, drafts for the maintainer): the Copy button's face "Copied" (was
  beside the button; same word); the scrolling regions' names "welcome.do" and "What a run looks like" (its heading). The
  theme icons (a screen for System, a sun for Light, a moon for Dark) are drafts too.
- **Words not in the sources** (drafts for the maintainer): the dialog "Restore the sample?" / "helpers.do differs from the
  sample. Replacing it discards your changes. Your other files are untouched." (plural: "analysis.do, helpers.do differ from
  the sample. Replacing them discards your changes. …") / **Cancel** (focused), **Replace** (`.btn.stop.live`); the toasts
  "Sample restored", "The sample is already here", "Couldn't restore the sample"; the Copy failure line in the live region
  "Couldn't copy: select the text and copy it by hand"; the section "Browsers that work"; the commands page's text (below the
  title, the Filter label and its placeholder "for example: reg", the count "N of M commands, 1 prefix", "No command starts with
  or contains that.", "off in the browser", "Prefixes", "Home" (decided 2026-11-12), "Open the editor →"). The Copy buttons and the theme
  button are hidden until the script that makes them work runs. Their exact text is in the two HTML files and in
  `docs/prototype1-plan.md`, "Step 5: the clean-room record".
- **Tests.** Node: `web/test/site.test.ts` (placeholders, the commands list against `commands.json`, `DENIED`, the six prefixes,
  the filter, the clean-room greps), `web/test/sample.test.ts` (the first visit, never over a visitor's files, Restore and its
  dialog on the real store module; the generated module is current), `web/test/sample-run.test.ts` (both do-files run with
  rc 0 in Pyodide, draw one graph, and every output line of the landing page's regression block appears in that run's log).
  e2e: `landing.spec.ts` (content, 404 for a missing page, the links in both directions and from the other-tab dialog and the
  failed-start banner, the build's size, the theme, Copy, axe in both themes on both pages, no sideways scroll, forced colors),
  `commands.spec.ts`, `sample.spec.ts` (first load, a later visit, never over files, Restore with its dialog, a run in the real
  engine).

## 9. Tests (step 6)

One Playwright file per flow in `web/e2e/`, in Chromium, Firefox, WebKit and the iPhone profile. `web/e2e/poc.spec.ts` is tied
to the proof-of-concept page's element ids and is rewritten; its cases move as listed. `npm run axe`, `tabwalk`, `contrast`
and `fonts` also run over the real editor, landing and commands pages, light and dark, 1440 and 390 wide.

| Flow | The e2e test that must exist | Covered in part today by |
|---|---|---|
| F1 First visit | The prompt shows once. Download shows byte counts, the stages, then "Ready". "Stop download" and "Not now" leave a working file panel and editor, and "Start engine" reopens the prompt. A later visit shows no dialog. No request leaves the origin. A refused snapshot gives the did-not-start banner. `?snapshot=0` still starts. | poc: "the default start: from the memory snapshot…", "a snapshot from a different build of the wheel is refused…", "?snapshot=0: the normal boot…"; `web/test/engine.test.ts`: "files can be listed, written and read while the engine is still loading…" |
| F2 Open the sample | A first visit lists the sample and opens its main do-file; a second file opens a second tab; closing an unsaved tab asks; the sample runs to a table and a graph. | poc: "Save writes the file; Discard opens the other file" (the one-file model) |
| F3 Upload a package | Files and a folder upload and show as a tree; a clash asks, and Enter, Esc and "Do the same" act as in 3.10; a Windows path in a do-file is mapped, with its note; a .dta, .csv, .log, .png and a non-UTF-8 file open as in 3.11. | poc: "the page runs .do code on uploaded files…", "legacy .xls and the ReadStat formats work…"; engine.test: "run with a Windows path…" |
| F4 Run | Run, Run selection and Ctrl/Cmd+Enter send what section 4 says (a whole file run twice gives the same result; a selection keeps locals). The run-head, the error line, "Go to line", the status bar. Run does not save; an edit during a run does not change it; the nested-do note. Graph, Data with Browse, Results with a matrix. The command line and its history. New files get the badge. | poc: "the page runs .do code…", "Save is explicit: Run doesn't save…", "the editor never rewrites a file it didn't change" |
| F5 Break | Break ends a loop with rc 1 and the data kept. A command that cannot stop shows the countdown; "Don't reset: wait for it" leads to "Reset now"; letting it count down resets. A page that is not isolated shows "Break (reset)" on Break. The phone's Break ignores an early tap. | poc: the first test (Break through the real interrupt buffer); engine.test: "Break stops at a safe point and keeps the data", "restart: the run in progress ends with rc 9998…" |
| F6 Crash and Reset | Reset asks, clears the data and keeps the files. A killed worker gives the reset banner, and "Run the file again" works. A worker that fails twice shows its banner, and files still open and download. A reload brings the files back. | poc: the first test (reload, Reset); engine.test: "a worker that fails to load is replaced…", "a worker that always fails to load ends start()…" |
| F7 Download | One file from the row menu. "Download all (.zip)" with the engine up and with no engine. "Download log" holds no head and no run-head. | none |

## 10. Open questions, decided 2026-11-10

The last column is the decision: the spec's recommendation, accepted by the maintainer, except for these, which the rows
already say:
- **OQ-1:** the log streams during a run (`on_output`, section 6); step 1 checks first that it works in Pyodide, and falls back
  to the recommendation in the row if it does not.
- **OQ-6:** P2. No `changed` flag in step 1, and Load does not ask in P1.
- **OQ-17:** P2, drafts as well as the last log.
- **OQ-10, OQ-16, OQ-18:** the step 4d agent drafts the missing words (the three notes, the undrawn states, the name-exists
  dialog, the target of "Browsers that work"); the maintainer approves the list before step 4d is merged. The close-tab
  and Delete-all dialogs' words were decided on 2026-11-10 (3.10).
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
| OQ-11 | Start-up stages. `S 2`, `S 3`: five stages, "Load packages" fourth. The snapshot start (the default) loads no packages; it unpacks and restores instead (`worker.ts`). | Snapshot start: "Downloading the engine", "Unpacking the engine", "Starting Python", "Loading your files", "Starting the engine" (words decided 2026-11-12; the status bar shows them with a small first letter, the live region as they are). The drawn list for `?snapshot=0`. |
| OQ-12 | (a) The size is to come from the snapshot manifest and the runtime files' sizes (decision of 2026-11-10), but the manifest lists two of the snapshot's files, and the runtime's 5.7 MB is a compressed transfer size (12.3 MB on disk; a fetch counts decoded bytes). (b) `F 7.2` makes the zip with Python's `zipfile` in the worker; `S 6` and `S 7` offer "Download all (.zip)" when Python cannot start. (c) `S 2` caption: "what arrived stays in the cache, so a later download resumes"; the Cache API keeps whole files. | (a) The build writes one list of every start file with its size on disk and its compressed size (`start-files.json`, fetched by the download) and puts the total in the page; the prompt shows the compressed total, and the bar counts decoded bytes scaled to it. (b) Make the zip in the page from the store, with no Python. (c) Resume by file: finished files are kept, an unfinished one starts again. |
| OQ-13 | "Restore the sample" (`F 2.4`: "in the file list's menu") is missing from the head menu listed in `S 13`. | Add it above "Delete all files…". |
| OQ-14 | Phone. Only `PH` and `S 8` are high fidelity; Files, Editor, Data, Results, the full-screen graph, the tab bar and the folded file list at 700 px are wireframes (`WP`; DS-7). No phone drawing of the editor has the theme button. `WP 1`'s ⋯ (Save, Reset, Download all, About dofile) differs from `S 12`. | Build from `WP` with the `ui.css` components. Phone ⋯: Save, the theme button, then the four items of `S 12`. |
| OQ-15 | Unsplit. Only `WB` draws it (with a corner preview of a new graph and a dot on the Graph tab). No source says which layout a first visit gets. | Split is the default; Unsplit as `WB` draws it. |
| OQ-16 | States listed, not drawn (`R` "Still open, not drawn"; the flows' list of states): another tab is open (`WS 6` has words; decision 2 says the lock owns the engine, `WS 6` says "Only one tab can use your files"); the drop target and the upload count; could not save; storage unavailable; too big; the close-tab, Delete-all and name-exists dialogs; "Find" and "next error"; what a reload says about lost data (`F6` branches). | Block the second tab with `WS 6`'s words. A failed save: an error banner above the editor with Download. Drop target: an accent outline on the Files pane. The close-tab and Delete-all dialogs: words decided in 3.10 (2026-11-10). The step 4d agent drafts the other missing words (storage unavailable includes a failed "Download all"); the maintainer approves them before step 4d is merged. |
| OQ-17 | `FD` 2026-11-08: "an unsaved draft kept in the browser's storage"; "The last log is kept across a reload". Nothing draws a restored draft; no step lists either. | P2, both. The browser's own warning on leaving with unsaved edits stays. |
| OQ-18 | No drawing: the commands page; the targets of "Browsers that work" (`S 6`) and "What dofile has" (`E` line 18). | The commands page has the landing page's top bar and footer and lists the names in columns. "What dofile has" goes to it. The step 4d agent proposes the other target; the maintainer approves it. |
| OQ-19 | Words that differ, or promise P2 work. (a) Delete: `P/Notices` against `DS` "It is removed from this browser. This can't be undone." (b) Storage: `S 19` against `DS` "Files may be cleared by the browser after a while." / "Keep files", "Not now". (c) Reset banner: `P/Notices` against `DS` "The engine stopped and was reset: **the data in memory is lost**; your files are kept." (d) Last run: `E` has "(started with no locals)", `DS` does not. (e) The dropzone says "or a .zip", and the upload report lists .zip entries and missing commands, all P2; its third trigger, "files that aren't UTF-8 text", fits every .dta. (f) `R` round 3 leaves an Import button for .xlsx to the maintainer. | The mockups' words for (a) to (d). P1 dropzone: "Drop files or folders"; no upload report in P1. No .xlsx button in P1. |
| OQ-20 | Landing claims (`mockups/README.md`: every claim "is true today, or labeled"). "from a public CDN" stops being true (3.12). "0.1 preview" (`L`) and "0.1.0" (`E?r`, `S 12`) are literals; the package says `0.1.0.dev1`. "Your files are kept in this browser between visits" and "Later visits use the copy your browser keeps" are untested per browser (UX-032). The log head says "Try: help regress" and the hint links "help summarize" while the Help tab is P2; today `help` prints in the log. | Show `About.dofile` everywhere. Keep the storage sentences and rely on `S 19`. In P1 `help x` prints in the log, and the hint's link runs it as a command. |
| OQ-21 | Small values no source fixes: whether a selection run sends whole lines (the run-head says "lines 14–15"); a run-head for a command-line command; the last-run text for rc 0; Browse's first page; when the stopping banner's button appears; how many graphs a session keeps; whether the theme is kept across visits; the graph card once plots are dark (`--graph-card` is white in both themes); a folder row's menu; how a new file gets its name; the sample's file names. | Whole lines. No run-head for one command. "Last run: whole file (started with no locals) · 0.38 s". 50 rows. The banner at once ("Stopping…" with the Break pill, from the press until the engine confirms); its button, and the focus on it, after 1 s (the maintainer, 2026-11-13). 20 graphs. The theme in localStorage. The card follows the plot's theme. Folders: Rename, Download (.zip), Delete…. A new file is `untitled.do` in inline rename. `analysis.do` and `data/wages.dta`. |

**C. Open recommendations of the design-system crit** (`system/critique.md`)

| # | What it says | Decision |
|---|---|---|
| DS-5 | Text sizes in px ignore the browser's font-size setting; switching to `rem` is a change to `tokens.css` alone. | Do it in step 3; check that the log's 80 columns fit or scroll at a 20 px default. |
| DS-6 | The dark palette is written twice; `light-dark()` needs Safari 17.5. | Not now: `contrast.mjs` already fails if the copies differ. |
| DS-7 | Not on the sheet: text field states and the inline rename, the bottom sheet, the phone's tab bar, the toast's place on a phone. | Draw each in `system/index.html` in the step that builds it (4a, 3, 3, 4d). |
| DS-8 | No tokens for motion or stacking. | Add `--dur-*` and a three-step z scale (menu, toast, dialog) in step 3. |
