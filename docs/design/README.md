# dofile web demo: design

The UI/UX design step of Phase 2 (`../phase2-plan.md`, "UI/UX design"): it comes after the proof of concept and before
the full editor, and produces the design that steps 6 and 8 build. The PoC page is deliberately unstyled. This file holds
the design brief, the deliverables, the rules, and the history of each round of feedback. It was moved here out of the
plan on 2026-11-09 (iteration 2); the plan keeps a short summary of the decisions.

| Folder | What |
|---|---|
| `moodboard/` | deliverable 1: legacy screenshots and references |
| `flows/` | deliverable 2: user flows, decisions, and the states the design must show |
| `wireframes/` | deliverable 3: low fidelity, desktop A and B, phone, states |
| `mockups/` | deliverable 4: high fidelity, light and dark; `ux-analysis.md` is the UX crit of iteration 1 with its resolution |
| `system/` | deliverable 5: the component sheet and its README; the tokens are `web/src/styles/tokens.css`, the components `mockups/ui.css` |
| `specimen/` | the font specimen; the chosen IBM Plex files and their license are in `web/src/styles/fonts/` |
| `axe.mjs`, `tabwalk.mjs`, `contrast.mjs`, `fonts.mjs` | the checks (`cd web && npm run axe`, `tabwalk`, `contrast`, `fonts`) |
| `shot.mjs` | screenshots any page with Playwright from `web/node_modules` |

Each folder's README has the commands that rebuild its renders; renders are not committed.

## Brief

- **Inspiration: legacy OpenStata** (`legacy/openstata/`, screenshots and GIFs in `legacy/openstata/docs/img/`). It is rough, with a
  bare-bones, academic, scrappy feel that we want to keep:
  - Material UI (v4): a navy top bar (`#1b1464`) with a pixel-style wordmark;
  - a gray left drawer with collapsible sections (Do Files, Log Files, Sample Data, Your Data) and upload below;
  - a monospace log pane with line numbers on the left, and the editor on the right;
  - a bottom action bar (Delete, Clear, Save, Run);
  - the landing page as an editor showing an ASCII-art banner and plain-text "what is this", next to a navy
    graph-paper grid.

  Keep the plain-text, editor-first character. Drop the graph paper (noisy, dated) and soften the navy, which is too
  strong as a page color. Fix what was rough: dead space, the low contrast of the gray-on-gray drawer, no Break or
  busy state, and no highlighting. Light and dark mode, following the system setting.
- **Other UI to note:**
  - OpenDTA GUI: screenshots exist in upstream readme.
  - Real Stata GUI: as in OpenDTA's clean-room policy, its layout and workflow may inform ours (they are not 1:1
    what we need anyway); its colors, fonts, icons, graphics and text are not copied.
- **Deliverables, in order:**
  1. a moodboard: legacy screenshots plus a few references (terminal and notebook UIs, academic sites)
     (draft: `docs/design/moodboard/`);
  2. user flows: first visit, open the sample, upload a replication package, run, Break, a crashed worker, download
     everything (draft: `docs/design/flows/`, each step tagged done in the PoC or to build);
  3. low-fidelity wireframes for desktop and phone (the phone layout stacks the editor and the log with tabs)
     (draft: `docs/design/wireframes/`; chosen 2026-11-09: desktop B, one output pane with tabs that can split, Log
     above and the other tabs below);
  4. high-fidelity mockups of the landing page and the editor, light and dark (draft: `docs/design/mockups/`, on
     `docs/design/tokens.css`, now `web/src/styles/tokens.css`);
  5. a small design system: color and type tokens (one monospace font, one UI font), spacing, and the components
     (file list, pane, toolbar button, log line, error line, results table, toast). Fonts chosen 2026-11-08: IBM Plex
     Mono + IBM Plex Sans (`docs/design/specimen/`, files and license in `web/src/styles/fonts/`).
- **Tools:** HTML and CSS for wireframes and mockups, screenshotted with Playwright (Chromium, Firefox, WebKit;
  desktop and phone; light and dark), so the mockups become the start of steps 6 and 8. Excalidraw (a `.excalidraw`
  file opened at excalidraw.com) only for hand sketches. `@axe-core/playwright` for the accessibility checks. Keep
  the HTML sources and exported images in `docs/design/` and the tokens as CSS variables in `web/`.
- **Rules:**
  - Accessibility: contrast at least WCAG AA, everything usable by keyboard, the log readable by screen readers.
  - Clean room (`LICENSE-POLICY.md`, following OpenDTA's): Stata's and OpenDTA's layout and workflow may be
    referenced; no colors, fonts, icons, graphics or text copied, and no Stata screenshots committed. The legacy
    app is our own and can be reused.
  - Names: the product is "dofile", described as running "Stata-syntax" code. "Stata" is not used as our name, and
    the old "OpenStata" wordmark is not reused.

## Status and history
Everything lives in `docs/design/` (each folder has a README with the rebuild commands; `docs/design/shot.mjs`
screenshots any page with Playwright from `web/node_modules`).
- **Done and committed:** the moodboard (`moodboard/`; third-party screenshots gitignored in `moodboard/refs/`), the
  font specimen (`specimen/`; IBM Plex Mono + IBM Plex Sans chosen, files and OFL in `fonts/`, the OFL line in
  `LICENSE-POLICY.md`), the user flows (`flows/`, with the decisions of 2026-11-08 in their "Decisions" section) and
  the wireframes (`wireframes/`: desktop A and B, B chosen with the split; phone; the states sheet). GAP-6 (help pages
  for `if`, `foreach`, ...) went into `docs/opendta-issues.md`.
- **Drafted, round 1 of feedback applied (2026-11-09; committed in c0cab10, final in iteration 3):** the high-fidelity mockups (`mockups/`: editor
  light/dark and running, landing desktop/phone, phone Log tab, `panels.html` for the Data/Results/Help tabs, opened
  files, the full-size graph and the dialogs, `ascii.html` for the banner candidates) on `tokens.css` and
  `mockups/ui.css` (the start of deliverable 5). Their content is a sample do-file run with `dofile run` on synthetic
  data (`mockups/sample.do`, `img/scatter.png`).
- **Round 1 of hi-fi feedback (2026-11-09), applied:**
  - Landing: welcome.do rewrapped to 72 columns (the phone gets its own 40-column text); the right column reaches the
    bottom of welcome.do and shows a whole `regress` output; on a phone the first screen holds the banner, the pitch,
    Open the editor and `pip install` (the from-source MCP line stays on phones for now). Nav: Commands, GitHub, the
    theme button. "Command line" and "For AI agents" are gone. A "For agents" page may come with a public HTTP demo
    MCP server (phase 3).
  - **Commands page:** a static list made from the engine's registry (`commands.json`); no links to help pages, since
    OpenDTA's help is Python strings, not pages. (A build step could render them; not planned.)
  - **Banner:** candidates in `ascii.html`; the mockups use A (ANSI Shadow, 44 x 6), pending the maintainer's pick. It is
    also the head of the page's Log pane, with the version line. The head is shown only: not in Download log, saved
    logs, the engine, the CLI or MCP (it would cost agents tokens and change the Stata 14 log comparison).
  - **Fonts:** the Latin subsets lacked ⌘ ▶ ■ ● ▾ ⋯, arrows and box/block characters, which fell back to system
    fonts (the tiny key labels). Now: the complete, unmodified Plex files load only for arrows and box/block
    (`unicode-range`; the OFL reserves the name "Plex", so no subsets of our own); UI symbols are SVG icons; key labels
    are chips in the UI font (⌘ on a Mac, Ctrl elsewhere).
  - Editor: the file tree indents 16 px per level with faint guide lines, folders as `data/` in ink; the error bar has a
    gap before the line number; the unsaved dot is on the tab, the file and the Save button; the theme button.
  - **Opening files:** .png in the Graph tab; .dta as its variables (`describe using`) with Load it (`use`); plain
    text is editable. Highlighting: .do/.ado with ours; .log with a small log tokenizer (echo lines, errors);
    .csv/.tsv with a small column tokenizer (CodeMirror has no CSV mode); .md and .json with CodeMirror's packages;
    .py, .R, .tex, .sql, .yaml with `@codemirror/legacy-modes`; anything else plain. (Approved in round 2.)
- **Round 2 (2026-11-09), applied:**
  - Banner: the maintainer liked A (legible) and D (lowercase charm). New A1, A2: lowercase letters drawn by hand in
    A's style (`mockups/art.js`); the mockups use A1 (45 x 8), pending the final pick.
  - The active editor tab has its ×, next to the unsaved dot.
  - Results: one list in three fixed columns (name, value, action), sections (e(), r(), locals and globals) holding
    groups that fold, with counts. View opens a matrix in place: no command, nothing in the log or the command
    history. 8 significant digits approved (all digits on hover and when copied).
  - Load (.dta, `use`) and Import (.csv, `import delimited`) show their command and run it as if typed in the
    command line: echoed in the log and added to the command history, never written into a do-file; Copy puts the
    command on the clipboard.
  - .xlsx: not openable in the editor (the not-UTF-8 notice) and no import button for now. Note: the engine has
    `import excel` (openpyxl, which the page already installs), and it works in the CLI.
- **Round 3 (2026-11-09), applied:**
  - `import excel` works in the browser engine: checked in Pyodide under Node with the page's own worker and wheel
    (`EngineClient` as in `web/test/engine.test.mjs`): a workbook written by the CLI imports (500 obs, same means),
    `import excel ..., describe` lists its sheets, and `export excel` then `import excel` round-trips inside Pyodide,
    all rc 0. Not yet checked: a real browser, and a workbook saved by Excel itself. Whether .xlsx gets an Import button
    is the maintainer's call.
  - Banner: A1 was a touch too tall and thick. The B series is lowercase on half-line pixels (stems two characters
    wide, horizontals half a line): 5 lines instead of 8. The mockups use B2: B1 slanted 12 degrees and given a
    one-pixel drop shadow, both in CSS, for D's lean. Slanting the characters themselves (B5) comes out jagged. WebKit
    and Firefox draw hairline seams between skewed block characters; a 0.04em same-color text shadow covers them.
    Pending the maintainer's pick. **Picked on 2026-11-09: B2 (`book+drop+skew`) is the banner from now on.**
- **Answers given on 2026-11-09, not yet applied:**
  1. **Dark-mode graphs:** add a dark plotting style to the engine, and pass the page's current light/dark mode to the
     engine call, so graphs match the page (today the PNGs are light, shown on a white card in dark mode). Engine work:
     an option on the run call (`Engine.run` / `browser.run`) that picks the style; check that `graph export` files
     and the CLI/MCP defaults stay as they are unless asked.
  2. **A light/dark toggle** is needed in the wireframes and the mockups (it was missing): the page follows the system
     by default, and the toggle overrides it (`[data-theme]` in `tokens.css` already supports this).
  3. **Keyboard shortcuts are tabled** for later. Open questions: Break on Cmd/Ctrl+. (Safari's Stop is Cmd+.),
     the command line on Cmd/Ctrl+L (the address bar in every browser), F6 between panes, Esc in dialogs; a test that
     sends keys from Playwright reaches the page but does not prove a real browser lets them through. The mockups
     show them only as placeholders.
  4. **PyPI:** the name `dofile` was free on 2026-11-09 (no project); the maintainer now has a PyPI account and will
     register it (only a first upload creates a project; PyPI does not reserve names). The landing page labels
     `pip install dofile` "with the first release". Steps and what was checked: `docs/releasing.md`.
- **Engine and page work decided along the way (to build, steps 6–8; also listed in the plan):** a whole-file run starts with no locals (see
  "Scope" in `../phase2-plan.md`); list locals and globals for the Results panel; report memory use; unpack and make .zip files in the
  worker; return the first rows of the data (Browse); the dark plotting style (answer 1); the editor's tokenizer
  underlines commands the engine lacks and lists them per uploaded do-file.
- **Next session (as of round 3; superseded by iteration 2 below):** the maintainer picks a banner and reviews round 1 (and `panels.html`). Then: add the theme toggle
  to the wireframes (done in the mockups), plan the dark plotting style, and finish
  the design system (deliverable 5: tokens into `web/`, the component list, `@axe-core/playwright` checks).

## Iteration 2 of the hi-fi mockups (2026-11-09)

A UX crit of round 3 (`mockups/ux-analysis.md`: 26 findings, 9 open questions) and the maintainer's answers. Every
finding is fixed in the mockups, dropped by a decision, or deferred: see the resolution table at the end of
`ux-analysis.md`.

**Decisions:**
- **What Run runs:** Run and Run selection send a copy of the editor's text, saved or not, so editing during a run
  doesn't change it. `do` and `include` read the saved file, as on a computer. When a nested `do` reads a file that is
  open with unsaved edits, the log says so (`states.html` 15). There is no read-only state while running; the running
  lines get a gutter bar that moves with their text.
- **Engine download:** a first visit asks before downloading the engine (about 36 MB, the figure taken from the build),
  in a dialog that blocks the page, on desktop and phone alike (a bottom sheet on a phone). The same dialog then shows the
  download as a bar and the start-up stages in words; "Edit files while it loads" closes it. Later visits (a flag in
  the browser's storage) get no dialog: the stage shows on Run and in the status bar, as in the flows. "Not now" leaves an
  editor and file manager with a banner to download later. To build: the files live in Pyodide's IDBFS today, so "Not
  now" needs the page to read that IndexedDB store itself, and a byte-accurate bar needs the page's own fetch wrapper.
- **Data tab:** a click on a variable picks it; Browse scrolls to its column and marks it. Nothing is inserted into the
  editor or the command line.
- **Reset** asks first (Cancel focused, as Delete), unless there is nothing to lose.
- **Name clash:** "Keep mine" (default, focused; Enter and Esc) or "Replace with uploaded", plus "Do the same for the
  other N clashes".
- **Per-file actions:** a ⋯ on the hovered, focused or open file row (always on touch), and the same menu on right
  click: Open, Rename, Download, Delete. "Download all (.zip)" is also a link under the file list.
- **Help** opens from "Help for `cmd`" in the editor's context menu; a long press on a phone only if a real-phone test
  shows it reaches the page.
- **The ⌘ ↩ chip** sits on the button it triggers: Run with nothing selected, Run selection with a selection. Each run's
  output starts with a line saying what ran and whether it started with no locals (shown only, not in saved logs); the
  status bar repeats it.
- **The phone's Break** takes Run's place, with another shape and color, and ignores taps in its first 600 ms.
- **Deferred:** whether storage persists on each browser (OQ2; "Files are kept in this browser" stays as is until it is
  tested), the iOS long press (OQ7), and the real-phone test of the Break guard (OQ8).

**New:** `mockups/states.html` (download prompt and progress, loading stages, later visits, Not now, did not start,
failed twice, Break countdown, stopped by Break, not cross-origin isolated, the ⋯ menus, Reset's confirm, the nested-do
note, empty Graph/Data/Results tabs); `phone-log.html?running` (the phone's Break).

**Fixed in place:** `ui.css` (`:focus-visible` ring with an inset variant inside panes; real `<button>`s with a reset;
line numbers at full contrast; inputs with `--border-strong`; links in pane heads in the accent; the theme button and
Copy look like buttons; a 22 px tab close; a hidden live region for state changes instead of a live status bar;
`.visually-hidden`, menus, progress, stages, empty states, lint message, scrim that dims in dark mode), `editor.html`,
`panels.html`, `landing.html` (a hidden `<h1>`, the banner and the do-file drawing hidden from screen readers with a
plain-text copy, the MCP command wraps with its placeholder marked, "Copied" state, the download size), `phone-log.html`,
`art.js` (`aria-hidden` on banners), `tokens.css` (contrast note rechecked).

**Still open, not drawn:** another tab is open, the drop target while dragging and the upload count, could not save,
storage not kept (OQ2). They stay in the flows' list of states.

## Iteration 3 of the hi-fi mockups (2026-11-09)

A second crit (`mockups/ux-analysis-2.md`) checked iteration 2: 7 findings only partly fixed and 11 new ones (UX-027 to
UX-037). All are fixed in the mockups; its resolution table lists where.

**Decisions:**
- **Break's countdown** offers "Don't reset: wait for it" (focused): it cancels the page's 5 s timer, and the Break still
  lands at the next safe point (rc 1, data kept). While it waits, Break becomes "Reset now" (`states.html` 9b).
- **The download prompt** keeps Download as the default (Enter), on purpose; "Stop download" while it runs; after Not now,
  Run stays enabled and opens the prompt.
- **Name clash:** Enter keeps this one; Esc keeps yours for every remaining clash and stops asking.
- **Editor tabs:** a plain tablist; the × inside the tab is for the mouse; Delete closes the selected tab (⌘ W and Ctrl+W are the browser's own close-tab keys; a page can't take them).
- **File list:** a tree with roving focus (Enter opens, F2 renames, Shift+F10 or the menu key opens the row menu); the ⋯
  on each row is for mouse and touch.
- **Run-head:** a selection run warns about a local it uses that no earlier run has set.
- **Storage not kept:** the notice is written (`states.html` 19); which browsers persist is still to test (OQ2).
- **Checks:** `npm run axe` and the new `npm run tabwalk` (`tabwalk.mjs`) both pass.

**Status:** iteration 3 is the final hi-fi iteration; deliverable 4 is done. Deliverable 5: below.

## Deliverable 5: the design system (2026-11-09)

The component sheet is `system/index.html` (its README has the render command and what each check does).
- **Tokens moved into `web/`:** `web/src/styles/tokens.css` and `web/src/styles/fonts/` (with `OFL.txt`) are the one
  source; `mockups/ui.css`, the wireframes and the flows load them from there. The page doesn't import them yet (steps
  6 and 8).
- **Weights:** text asked for weights we don't ship (Sans 700 and 500, Mono 600 and 900), which the browser faked. Now
  `--w-bold-ui` (600) and `--w-bold-mono` (700), base rules for `b`, `strong`, headings and `th`, and
  `font-synthesis: none`. The key chip is 400 (was 500).
- **New tokens** for literals repeated in `ui.css`: `--radius-sm` (3 px, 21 uses), `--bar` (the 3 px marker),
  `--text-row` (13 px: buttons, file rows, menus, banners; file rows and menus were 13.5 px), `--disabled-opacity`,
  `--shadow-menu`, `--shadow-dialog`, `--scrim` (its dark value moved from `ui.css` into the tokens). Icon sizes and
  one-off sizes (the wordmark, the badge) stay in their components.
- **Checks:** `contrast.mjs` reads the tokens as the browser resolves them in four modes (system light and dark, and
  `[data-theme]` forcing each), fails if a forced theme differs from the system one, and checks 37 pairs in use (4.5:1 for
  text, 3:1 for edges and bars); the lowest text pair is 5.05:1 (string on accent-soft, light). `fonts.mjs` checks that
  every face loads and that no text node is in an unshipped weight. `axe.mjs` now covers `system/` too. All four checks
  pass (axe: 0 violations in 36 runs; tabwalk: every focus stop visible), and the fonts in Chromium, Firefox and WebKit.
- **New component: the toast**, approved by the maintainer on 2026-11-09: a short confirmation with no buttons ("Saved analysis.do",
  "Copied", "3 files uploaded"), inverted colors, bottom center, 4 s, announced by the existing hidden live region, never
  focused. Anything to act on stays a banner or a dialog. No mockup draws it yet.

**Maintainer's answers (2026-11-09):** the sheet and the toast are approved; B2 is the final banner.

**Crit of the design system** (`system/critique.md`), each finding checked in a browser. Fixed: forced colors (Windows
High Contrast) hid every icon, the focus ring and the marker bars, so the error line looked like any other (DS-1; now
redrawn in system colors, and error banners carry the warning icon); default and primary buttons, tabs and file rows had
no hover and nothing showed a press (DS-2; new tokens `--accent-hover`, `--error-hover`); touch targets were 22 to 32 px
on a phone (DS-3; 44 px under `pointer: coarse`); `shot.mjs --forced` renders forced colors (DS-4). Open
recommendations: text sizes in `rem` when the page is built (DS-5), `light-dark()` later (DS-6), components not drawn
yet: text field states and the inline rename, the phone's bottom sheet and tab bar, the toast's place on a phone (DS-7),
motion and z-index tokens (DS-8).

**Status:** deliverable 5 is done, and with it the design step. Steps 6 and 8 build the page on `tokens.css` and `ui.css`;
the items still open for them are DS-5 to DS-8 above, the dark plotting style (answer 1 of round 3), and the states not
drawn (another tab is open, the drop target and upload count, could not save).

