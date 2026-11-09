# UX Analysis: dofile web demo, high-fidelity mockups (round 3)

## Scope

- **Analyzed (source, not renders):** `docs/design/mockups/editor.html` (idle after an error, and `?running`),
  `landing.html` (desktop and the ≤700 px phone layout), `phone-log.html`, `panels.html` (Data, Results, Help tabs;
  opened .dta/.csv/.log/.xlsx; full-size graph; name clash, upload report, reset, memory and delete notices),
  `ui.css`, `../tokens.css`, `art.js` (how the banner is inserted). `ascii.html` was read only as far as the
  banner's markup; picking a banner is the maintainer's call, so the candidates aren't critiqued.
- **Context read first:** `docs/phase2-plan.md` (the UI/UX section, rounds 1–3, the answers of 2026-11-09, "What the
  page does", "Scope"), the READMEs of `mockups/`, `wireframes/`, `moodboard/`, `specimen/`, and the "Decisions" and
  "States and messages" sections of `../flows/index.html`. Wireframes were consulted only where a hi-fi file defers
  to them (phone Run/Break, long-press).
- **Not used:** the `.png` renders (as asked). No automated checker (axe, Lighthouse) was run: every accessibility
  finding is from reading markup and CSS, plus contrast ratios computed from the token hex values (WCAG 2.x relative
  luminance, opacity blended over the stated background).
- Branch: `main`, working tree; the whole `mockups/` folder and `tokens.css` are untracked (new).

## User Context

- **Primary goal (JTBD):** *When I have a Stata-syntax do-file (my own, a class exercise, or a replication
  package) and no Stata license at hand, I want to run it in a browser tab and read the log, results and graphs, so I
  can check, learn from or reproduce the analysis without installing anything or sending my data anywhere.*
- **Secondary goal:** *When I use an AI agent or a terminal, I want to install the same engine (`pip`, MCP), so I can
  run do-files outside the browser.* (Landing page "On your computer" card.)
- **Tasks covered:**
  1. Understand what dofile is and decide to try it (landing).
  2. Open the editor; wait for the engine to start.
  3. Upload files (drop, Upload, .zip), resolve name clashes, read the upload report.
  4. Open and edit a do-file; Save.
  5. Run the whole file / a selection / one command; watch progress; Break.
  6. Read the log, find and fix an error (Go to line, help link).
  7. Inspect graphs, data (variables, first rows), e()/r() results and macros; open Help.
  8. Load a .dta / import a .csv from the file list.
  9. Recover from a reset or memory warning; delete files; download work.
  10. Copy install commands (landing).
- **Persona spectrum considered:** screen-reader users (log, landing page); keyboard-only users (the plan's rule
  "everything usable by keyboard"); low vision and zoom (line numbers, 11 px phone log); motor / touch precision (tab
  close, small links); one-handed phone use and accidental double taps (phone Run/Break); low bandwidth or metered
  data on a phone (first visit, ~36 MB); cognitive load and fatigue during a long replication run; new-to-Stata
  students vs. experienced Stata users (jargon such as `r(111)`); second-language readers (plain-English copy,
  which the project already favors).

## Question Log

**Access and Entry**
- **Q1 [Answered]:** How does the user arrive? — Landing page → "Open the editor →" (`landing.html:75,87`); the editor's
  wordmark links back (`editor.html:23`). A first visit loads a sample project (`phase2-plan.md` "What the page does").
- **Q2 [Answered]:** Can they leave and return without losing state? — Files and the editor text persist in IndexedDB;
  data in memory does not (`phase2-plan.md` decision 1; flows "Behavior": the last log is kept across a reload, an
  unsaved draft is kept).
- **Q3 [Open]:** Does storage actually persist on every target browser (persist() granted or denied; WebKit's
  eviction rules)? The note about Safari was removed from the PoC on purpose (commit 43be0ac), and the flows list
  "storage: kept or not kept by the browser" as a required state. → OQ2.

**Goal and Intent**
- **Q4 [Assumed]:** Is there one primary goal? — Assumed: run an existing do-file and read the result; writing new code
  from scratch is secondary. Basis: flows F3 (upload a replication package) and the upload report's focus on
  missing commands (`panels.html:248-253`).

**Usage Pattern**
- **Q5 [Assumed]:** First-time, occasional or habitual? — Assumed mostly first-time and occasional (a free demo, no
  accounts). This raises the weight of discoverability findings (UX-002, UX-012, UX-013).

**Context of Use**
- **Q6 [Answered]:** Devices? — Desktop at 1440 × 900 and a 390 × 844 phone are both designed (`mockups/README.md`).
- **Q7 [Open]:** What share of first visits are on phones, and over what connection? A real iPhone took 9.2 s
  (normal boot) and 28–30 s (snapshot) to start (`phase2-plan.md:21-23`); the first visit downloads about 36 MB
  (`phase2-plan.md:79`). → OQ3.

**Persona Spectrum**
- **Q8 [Answered]:** Accessibility bar? — WCAG AA contrast, everything usable by keyboard, the log readable by screen
  readers (`phase2-plan.md:271`).
- **Q9 [Assumed]:** Screen-reader users will hit the landing page's static HTML as built from this mockup. Basis: step
  8 builds the landing page and `ui.css` "become[s] the page's CSS" (`ui.css:1`).

**Information Needs**
- **Q10 [Answered]:** What must the user already know? — Stata syntax, `r()` codes, e()/r() conventions. The target is
  people who write do-files; the log's error hint explains in plain words (`editor.html:91-96`).
- **Q11 [Answered]:** Does the user need to know that a whole-file run clears locals and a selection keeps them? —
  Yes; it changes results (`phase2-plan.md:364-367`). Nothing on screen says so (UX-004).

**Decision and Stakes**
- **Q12 [Answered]:** Which actions are destructive? — Overwrite on upload, Delete, "Delete all files", Reset (data in
  memory lost), Break that turns into a reset (data lost), closing a tab with unsaved edits (`panels.html:239,266`;
  flows "Behavior"; `editor.html:32,57,100`). Files exist only in this browser: there is no server copy to restore.
- **Q13 [Open]:** Does Reset (in the ⋯ menu) ask for confirmation? Not drawn. → OQ9.

**Failure and Recovery**
- **Q14 [Answered]:** How are run errors surfaced? — Red error line in the log, plain-English hint, "Go to line 17",
  error bar in the editor gutter, rc in the status bar (`editor.html:90-97,119`; `ui.css:92-93`). Strong.
- **Q15 [Answered]:** Engine start failure, failed twice, not cross-origin isolated? — Required by the flows
  ("States and messages", `flows/index.html:355-366`) but not in any hi-fi file (UX-005).

**Exit and Completion**
- **Q16 [Answered]:** How does a run signal it's done? — Status bar flips from "Running … 3.4 s" to "Ready / Last
  run …" (`editor.html:118-120`); the log scrolls to its end.
- **Q17 [Open]:** How does a user take all their work away? "Download all" is in the toolbar's ⋯ menu
  (`editor.html:32`); the menu itself isn't drawn. → part of UX-008.

**Comparison and Expectation**
- **Q18 [Assumed]:** What mental model do users bring? — Stata's own do-file editor and Results window (layout and
  workflow may be referenced, `phase2-plan.md:250-252`), and VS Code-style tabs. Assumed: users expect one Run control
  whose scope follows the selection, and expect Run to use what they see in the editor.
- **Q19 [Answered]:** Keyboard shortcuts (Cmd+. vs Safari's Stop, Cmd+L vs the address bar)? — Tabled by the maintainer;
  the chips are placeholders (`phase2-plan.md:342-345`). Not re-raised here.
- **Q20 [Answered]:** Graphs on a white card in dark mode? — A dark plotting style is decided (`phase2-plan.md:336-339`).
  Not re-raised here.
- **Q21 [Answered]:** Is there a theme toggle? — Yes, drawn, not wired (`editor.html:31`, `landing.html:66`;
  `phase2-plan.md:340-341`).

**Measurement and Validation**
- **Q22 [Open]:** Has any of this been tried with a screen reader (VoiceOver, NVDA) or a real phone keyboard? The plan
  lists `@axe-core/playwright` as a future check and says emulation has no phone keyboard (`phase2-plan.md:130,268`).
  → OQ3, OQ7.

**Protocol-seeded questions**
- **Q23 [Answered] (P2):** Is any critical state gated on color alone? — The error line uses bar + tint + bold number
  (multi-channel, good). The running lines use only a faint tint, the same as a selection (UX-003).
- **Q24 [Answered] (P4):** With sound off, can a first-time user tell what's clickable? — Mostly, except pane-head links,
  the theme button and "Copy" (UX-012).
- **Q25 [Answered] (P5):** Does anything animate? — No `@keyframes`, `transition` or `animation` in `ui.css` or the
  mockups; `.pulse` is a static dot (`ui.css:151-152`). Reduced motion: nothing to respect yet.
- **Q26 [Open] (P4):** What does Run execute when the file has unsaved edits, and what does `do clean.do` from another
  file see? → OQ1.
- **Q27 [Open] (P4):** On desktop, where are rename, download and delete for one file? → OQ4.
- **Q28 [Open] (P7):** On a phone, does the button that becomes Break in place ignore a quick second tap? → OQ8.

## Assumptions

- The mockups are the intended look *and* the starting markup/CSS for steps 6 and 8 (`ui.css:1`; plan "Tools":
  "so the mockups become the start of steps 6 and 8"). Markup gaps are flagged because they are likely to carry over,
  not because a mockup must be accessible.
- Behavior described in figcaptions, `title` attributes and the plan is the intended behavior.
- Primary users are first-time or occasional visitors who know Stata syntax; a sizeable minority are on phones.
- CodeMirror 6 will provide its own editor semantics (gutter, focus, selection); findings about the editor gutter are
  about our tokens, not CodeMirror's markup.
- Severity is judged for the built page. No finding is "Blocks task" because no flow is drawn far enough to prove a
  dead end.

## Open Questions

**OQ1: When a file has unsaved edits, does Run run the editor's text or the saved file, and what does `do clean.do` (or
`include`) see when clean.do is open with unsaved edits?**
- **Why it matters:** the only hint is a `title` "unsaved changes (Run doesn't save)" (`editor.html:57`). If nested
  `do` calls read the saved file, a user who edits clean.do and runs master.do gets old results with no warning.
- **Findings affected:** UX-007, UX-002
- **How to resolve:** product decision, written into the flows (F4), then a short line in the UI.

**OQ2: Is storage persistence granted on each target browser, and what does the page say when it isn't?**
- **Why it matters:** the status bar and landing page say files "are kept" unconditionally (`editor.html:123`,
  `landing.html:88`); the flows require a "not kept" state that has no mockup.
- **Findings affected:** UX-009, UX-008
- **How to resolve:** test `navigator.storage.persist()` and `persisted()` in Chromium, Firefox and Safari (desktop and
  iOS, installed and not), then draw the "not kept" state.

**OQ3: What share of first visits are phones on cellular data?**
- **Why it matters:** decides whether the start screen and the download-size disclosure are first-screen content, and
  how much weight the phone findings get.
- **Findings affected:** UX-005, UX-024, UX-026
- **How to resolve:** privacy-respecting analytics after launch, or a decision to design for the worst case now.

**OQ4: Where do rename, download and delete for one file live on desktop?**
- **Why it matters:** the Files pane shows no per-file control; only a ⋯ in its header (`editor.html:37`). The phone
  uses a long press (`wireframes/phone.html:131`).
- **Findings affected:** UX-013
- **How to resolve:** design decision; add a row ⋯ or a context menu with a visible trigger, and draw it.

**OQ5: Can the user edit the file while it runs, including the lines being run?**
- **Why it matters:** decides whether the running highlight (UX-003) also needs a read-only signifier.
- **Findings affected:** UX-003
- **How to resolve:** product decision; add to the running mockup.

**OQ6: Does a click on a variable in the Data tab insert the name into the editor or the command line, and which wins?**
- **Findings affected:** UX-015
- **How to resolve:** product decision (recommendation: command line only, unless the editor has focus and the user
  chose it).

**OQ7: Does a long press inside CodeMirror on iOS Safari reach the page, or does the native selection callout take it?**
- **Findings affected:** UX-013
- **How to resolve:** a real-phone test (the plan notes emulation has no phone keyboard).

**OQ8: On a phone, Run turns into Break in place. Is a quick second tap guarded?**
- **Findings affected:** UX-026
- **How to resolve:** design decision plus a real-phone test.

**OQ9: Does Reset ask for confirmation?**
- **Findings affected:** UX-008
- **How to resolve:** design decision; draw it next to the Delete confirm.

## Summary

The high-fidelity mockups (editor idle and running, landing desktop and phone, phone Log, the panels/dialogs sheet,
`ui.css` and `tokens.css`) were audited from source against the Phase 2 plan and the flows. Error reporting and recovery
in the log are strong, and no dark patterns were found; the main risks are a destructive default in the name-clash dialog,
a run-scope rule (locals) the UI never shows, a start-up wait the design undersells and doesn't draw, and a landing page
and component CSS that a screen-reader or keyboard user would struggle with as built.

| Severity      | Count |
|---------------|-------|
| Blocks task   | 0     |
| Degrades task | 5     |
| Friction      | 17    |
| Polish        | 4     |

Open Questions: 9 (must be answered before findings are fully actionable)

Full analysis written to: /Users/cassandra/dev/dofile/docs/design/mockups/ux-analysis.md

## Findings

### Protocol 1: Critical Inquiry and User Context

Done above (Question Log, Assumptions, Open Questions). No findings of its own.

### Protocol 2: Universal Design Sweep

**UX-001: Name-clash dialog makes "Overwrite" the default**
- **Principle:** Universal Design 5 (Tolerance for Error); Nielsen 5 (Error prevention); Fitts's Law (the destructive
  choice is the largest-weight, pre-focused target)
- **Location:** `panels.html:238-239`
- **Evidence:** `<span class="btn">Keep all</span><span class="btn">Overwrite all</span><span class="spacer"></span>
  <span class="btn">Keep existing</span><span class="btn primary focus">Overwrite</span>`. Overwrite is both the
  primary style and the focused button, so Enter replaces the file.
- **User Impact:** A user uploading a replication folder over a project they've been editing presses Enter to get
  through a run of dialogs ("2 of 5 clashes") and replaces their edited `data/wages.dta` or do-file with the
  package's original. Files live only in this browser (`panels.html:265`, "there is no undo"), so nothing restores
  them. Users who move fast through dialogs (keyboard users, people working through fatigue) are hit hardest. The
  Delete confirm on the same sheet (`panels.html:266`) gets this right: Cancel is neutral, the red Delete isn't
  focused.
- **Related questions:** Q12 (answered), Q5 (assumed)
- **Severity:** Degrades task
- **Remediation:** Focus "Keep existing" and give it the primary style; give Overwrite the neutral style (or the
  `.stop` outline). Keep the question's wording on the buttons (see UX-025).

**UX-002: Information that appears only on hover (`title`)**
- **Principle:** Universal Design 2 (Flexibility in Use); Modality monoculture; WCAG 1.3.1 / 4.1.2 (the `title` isn't
  reliably exposed and never reaches touch)
- **Location:** `editor.html:59` (line 18: `<span class="warnword" title="reghdfe is a community command; dofile does
  not have it">`), `editor.html:57` (`title="unsaved changes (Run doesn't save)"`), `editor.html:32` (`title="More:
  Reset, Clear log, Download all, About dofile"`), `panels.html:128` ("all digits on hover")
- **Evidence:** In each case the explanation exists only in a `title` or on hover.
- **User Impact:** On a phone or with the keyboard, the user sees a wavy underline under `reghdfe` with no way to learn
  why. They can't get a result's full precision to compare with a paper's table. They can't learn that Run doesn't
  save. The upload report (`panels.html:249-252`) covers the `reghdfe` case for uploaded files only, not for code
  typed or pasted in.
- **Related questions:** Q5 (assumed), Q6 (answered), OQ1
- **Severity:** Friction
- **Remediation:** Put the `reghdfe` reason in a CodeMirror lint diagnostic, which shows on cursor focus and is
  announced. Show full precision in a row's focus state and in Copy (Copy is already planned). The other two are
  UX-007 and UX-008.
- Unverified: could not inspect how CodeMirror will expose the underline, because the editor in the mockups is a
  static `<pre>`.

**UX-003: The lines being run are shown only by a faint tint, the same as a selection**
- **Principle:** Universal Design 4 (Perceptible Information); WCAG 1.4.1 (Use of Color); Nielsen 1
- **Location:** `editor.html` `?running` (script adds `.sel` to lines 14–15); `ui.css:91`
  (`.code .ln.sel { background: var(--accent-soft); }`)
- **Evidence:** `--accent-soft` against `--surface` is 1.22:1 (light, `#e6e8f3` on `#fff`) and 1.25:1 (dark). A
  running line and a selected line look the same, and there is no gutter mark.
- **User Impact:** During a long replication run, a user who looks back at the editor can't tell which lines are
  running and which are just selected. A user with low contrast sensitivity, or on a phone in sunlight, may not see
  the tint at all. The status bar does say "lines 14–15" (`editor.html:120`), which helps.
- **Related questions:** Q23 (answered), OQ5
- **Severity:** Friction
- **Remediation:** Add a gutter mark for running lines: a 3 px accent bar like the error bar (`ui.css:92`), or a ▶
  icon. Keep the tint for selection only. If the engine adds "report the current line" (flows, possible engine
  additions), move the mark with it.

> **Universal Design 1 (Equitable Use):** No separate issue. Checked: phone and desktop get the same functions (the
> phone moves Help and the graph to sheets per the wireframes); no degraded fallback path is drawn. Phone-specific
> gaps are UX-013 and UX-026.
> **Universal Design 3 (Simple and Intuitive Use):** see UX-004 and UX-005.
> **Universal Design 6 and 7 (Low Physical Effort; Size and Space):** see UX-023 (10 px close target) and UX-024
> (11 px phone log). Toolbar buttons (13 px text, 7 px × 12 px padding, about 29 px tall) meet 24 × 24 px. The phone
> tab bar is about 60 px tall per tab, and phone Run is about 37 px tall, both fine.

### Protocol 3: Nielsen Heuristic Walkthrough

**UX-004: Run vs Run selection: a scope rule that changes results is invisible, and the shortcut label disagrees with the rule**
- **Principle:** Nielsen 1 (Visibility of system status); Nielsen 5 (Error prevention); signifier mismatch
- **Location:** `editor.html:24-26`; rule at `phase2-plan.md:364-366` (a whole-file run, i.e. Run or Ctrl/Cmd+Enter
  with nothing selected, starts with no locals; a selection and the command line keep locals) and
  `phase2-plan.md:399` (Ctrl/Cmd+Enter runs the selection)
- **Evidence:** `<span class="btn primary idle-only">…Run <span class="key">⌘ ↩</span></span>` then `<span
  class="btn">Run selection</span>`, which has no chip. The ⌘ ↩ chip sits on whole-file "Run", but when there is a
  selection, ⌘ ↩ runs only the selection and keeps locals. The sample file shows the trap: line 12 builds
  `` `controls' ``, and line 14 is `regress wage `controls'`.
- **User Impact:** A user loads the data (Load on `wages.dta`, `panels.html:165`, or runs lines 1–10 as a selection),
  then selects lines 14–15 and runs them. `` `controls' `` was never set in this session, so `regress wage` fits a
  constant-only model with rc 0 and no error. Checked with `dofile run`: `clear`, `set obs 50`, `gen wage =
  rnormal()`, `regress wage `controls'` gives rc 0 and `e(df_m)` = 0. A Stata user expects this, but a student does
  not. The opposite case also misleads: a user with a stray selection presses ⌘ ↩, reading the chip as "run the file",
  and runs only the selection with the old locals. The Results tab does list locals (`panels.html:147-150`), so a
  careful user can find out after the fact.
- **Related questions:** Q11 (answered), Q18 (assumed)
- **Severity:** Degrades task (wrong result with no warning)
- **Remediation:** (1) Move the ⌘ ↩ chip so it describes the rule: show it on Run selection while there's a selection
  and on Run otherwise. (2) Add one line to the run's log echo or status, e.g. "Run (whole file, starts with no
  locals)" vs "Run lines 14–15 (keeps locals from earlier runs)". (3) Optionally, in a selection, underline a local
  that's empty at run time (the editor's tokenizer already finds macros).
- Unverified: could not inspect the run behavior itself, because it isn't built yet (an `Engine.run` option, plan
  line 367).

**UX-005: The start-up wait and the engine's failure states have no high-fidelity design, and the landing copy promises "a few seconds"**
- **Principle:** Nielsen 1 (Visibility of system status); Nielsen 9; Protocol 6 (empty, loading and error states)
- **Location:** `landing.html:88` ("It takes a few seconds to start."); the required states in
  `flows/index.html:355-366` against the hi-fi files; measured times in `phase2-plan.md:19-23`
- **Evidence:** States the flows require, and where they are drawn in hi-fi:

  | Required state (flows) | Hi-fi |
  |---|---|
  | starting, with the stage (4 stages) | none (wireframe only) |
  | breaking, with the reset countdown | none |
  | stopped by Break (rc 1, data kept) | none |
  | failed twice: reload the page | none |
  | did not start: files still available | none |
  | not cross-origin isolated: Break resets | none |
  | another tab is open | none |
  | uploading (count), drop target while dragging | none |
  | could not save | none |
  | storage not kept | none (see UX-009) |
  | reset (rc 9998) with its reason, memory warning, delete confirm, name clash, upload report | `panels.html` |

  Measured start times: 4.6–6.6 s on desktop, 9.2 s on a real iPhone with the normal boot, 28–30 s with the snapshot;
  about 36 MB on a first visit.
- **User Impact:** Every first-time user goes through the start-up state, and it is the moment they decide whether the
  page works. "A few seconds" is accurate on desktop but not on a phone over cellular, where the wait is longer and
  the download costs data (metered-data and low-bandwidth users). With no designed starting screen, the build will
  improvise the first thing every visitor sees.
- **Related questions:** Q7 (open), Q15 (answered), OQ3
- **Severity:** Degrades task
- **Remediation:** Draw the starting state (editor usable, Run labelled "Run · starting…", the stage, a determinate
  bar where the stage is a download), and the failed-twice and did-not-start states. On the landing page, write "about
  5–10 seconds the first time; it downloads about 36 MB" (use measured numbers), so phone users can choose to wait for
  Wi-Fi.

**UX-006: The running notice says Break "resets the engine (files are kept)" but not that the data in memory is lost**
- **Principle:** Nielsen 5 (Error prevention); Nielsen 2 (Match with the real world)
- **Location:** `editor.html:100-101`
- **Evidence:** "Break stops between commands; one long command that doesn't stop within 5 s resets the engine (files are
  kept)." The flows' own wording says "Data in memory is gone; your files are kept" (`flows/index.html:255`).
- **User Impact:** A user an hour into a replication, holding merged data in memory that was never saved to a file,
  reads "files are kept" as "safe" and presses Break. If the command doesn't stop, the merged data is gone. "Resets the
  engine" is developer language: the user needs to know the consequence.
- **Related questions:** Q12 (answered)
- **Severity:** Friction
- **Remediation:** "…resets the engine: the data in memory is lost, your files are kept." Use the same sentence in the
  breaking countdown.

**UX-007: Whether Run saves, and what it runs, is explained only in a tooltip**
- **Principle:** Nielsen 1; Nielsen 4 (Consistency and standards: other editors either autosave or run the buffer)
- **Location:** `editor.html:57` (`title="unsaved changes (Run doesn't save)"`), `editor.html:29` (Save with a dot)
- **Evidence:** The dot appears on the tab, in the file list and on Save (good, three places). The rule that Run
  doesn't save exists only in the tab dot's `title`.
- **User Impact:** A user edits `clean.do`, doesn't save it, then runs `master.do`, which calls `do clean.do`. If the
  nested call reads the saved file (OQ1), they get results from the old code and nothing tells them. The PoC already
  had a data-loss bug in this area (`phase2-plan.md:121-126`), so this rule needs to be visible.
- **Related questions:** OQ1 (open; if nested `do` reads the editor's buffer, this drops to Polish)
- **Severity:** Friction
- **Remediation:** When a run starts and any open file used by it has unsaved edits, add a note line to the log:
  "clean.do has unsaved edits; `do clean.do` ran the saved version." This follows the path-shim note pattern the log
  already uses.
- Unverified: could not inspect run and save behavior for nested `do`, because it isn't built.

**UX-008: "Download all" and "Reset" are hidden behind an unlabeled ⋯ icon**
- **Principle:** Nielsen 6 (Recognition rather than recall); information scent; Nielsen 3 (User control)
- **Location:** `editor.html:32` (`<span class="btn quiet icon" title="More: Reset, Clear log, Download all, About
  dofile"><span class="ico i-more"></span></span>`), and another ⋯ in the Files pane head (`editor.html:37`)
- **Evidence:** Two ⋯ menus with no labels. "Download everything" is one of the flows the design is built around
  (`phase2-plan.md:256`), and files exist only in this browser.
- **User Impact:** A user leaving the session (or warned about memory) wants a copy of all their work. Nothing visible
  says this is possible. Two ⋯ buttons also mean guessing which one has it. Reset is destructive (data in memory)
  and its confirmation isn't drawn (OQ9).
- **Related questions:** Q17 (open), OQ2, OQ9
- **Severity:** Friction
- **Remediation:** Add a visible "Download all (.zip)" text link in the Files pane, e.g. in the dropzone line next to
  Upload and New .do file (`editor.html:51`). Give the ⋯ buttons accessible names ("More actions", "File actions") and
  draw the menu and the Reset confirmation.

**UX-009: "Files are kept in this browser" is stated unconditionally**
- **Principle:** Nielsen 1 (Visibility of system status); Universal Design 5
- **Location:** `editor.html:123` (status bar), `landing.html:88` ("Your files are kept in this browser between visits.")
- **Evidence:** One fixed string. The flows require "storage: kept or not kept by the browser" (`flows/index.html:376`),
  and `navigator.storage.persist()` can be refused.
- **User Impact:** A user who relies on the message and comes back a week later may find their uploaded project gone
  in a browser that didn't grant persistence, with no warning beforehand. Phone users (who are most likely to be
  evicted under storage pressure) are hit hardest.
- **Related questions:** Q3 (open), OQ2 (open; if every target browser grants persistence, this is Polish)
- **Severity:** Friction
- **Remediation:** Draw the second state: "Files are in this browser, which may clear them. Download all to keep a copy"
  (links to UX-008's link). Show "kept" only when `persisted()` is true.
- Unverified: could not inspect actual persistence behavior per browser, because it depends on runtime grants not
  present in a static mockup.

**UX-010: Two "Run" buttons with different scopes**
- **Principle:** Nielsen 4 (Consistency); information scent
- **Location:** `editor.html:24` (toolbar "Run": the file) and `editor.html:102-103` (command line "Run": the typed
  command)
- **Evidence:** Same label, same `.btn` style family, different targets, both visible at once.
- **User Impact:** A user who has typed a command and reaches for the big Run runs the whole file instead (and locals
  are cleared, UX-004). Low cost (it's re-runnable), but confusing.
- **Related questions:** Q18 (assumed)
- **Severity:** Polish
- **Remediation:** Make the command line's button a ↵ icon with accessible name "Run command", or label it "Run
  command". Enter is the main trigger there anyway.

**UX-011: Browse shows six rows; more requires typing a command**
- **Principle:** Nielsen 6 (Recognition rather than recall)
- **Location:** `panels.html:68` ("first 6 of 500 rows · read only"), `panels.html:80` ("More rows: `list in` in the
  command line")
- **User Impact:** A student checking that an import worked has to recall `list in 1/50`. Experienced users are fine.
- **Related questions:** Q10 (answered)
- **Severity:** Polish
- **Remediation:** A "Show 50 more" link that runs nothing in the log (like View for matrices), or a link that fills
  the command line with `list in 1/50` for the user to edit.

> **Nielsen 2 (Match with the real world):** Mostly sound. Checked: Stata's own terms (`r(111)`, e()/r()) are used for
> an audience that knows them; the error hint is plain English (`editor.html:91-96`). One case of developer language:
> UX-006.
> **Nielsen 3 (User control and freedom):** Break, Close (Esc) on the full-size graph, Dismiss on notices, Cancel on
> Delete, ask-first on closing an unsaved tab (`editor.html:57`). Gaps: UX-001, UX-008.
> **Nielsen 7 (Flexibility and efficiency):** a command line with history, shortcut chips (tabled, Q19), Copy for
> Load/Import commands. No issue beyond UX-004's chip placement.
> **Nielsen 8 (Aesthetic and minimalist design):** No issue. Checked the toolbar (5 controls + theme + ⋯), pane heads,
> and the status bar (4 facts); nothing competes with Run and the log.
> **Nielsen 9 (Recognize, diagnose and recover from errors):** A strength. The `r(111)` block states what happened, why,
> how to fix it, a help link, and "Go to line 17"; the editor marks line 17. The reset notice offers "Run the file
> again" (`panels.html:262`).
> **Nielsen 10 (Help and documentation):** A Help tab with OpenDTA's text, a field to look up a topic, and a "no help
> yet" message for GAP-6 topics (`panels.html:85-102`). Discoverability of long-press help: UX-013.

### Protocol 4: Affordance and Signifier Audit

**UX-012: Several controls look like plain labels**
- **Principle:** Signifier erosion; Nielsen 4
- **Location:** `ui.css:67` (`.head-link { color: var(--muted); … }`, no underline, used for "Find", "Download log",
  "Unsplit" at `editor.html:65`); `ui.css:50-51` (`.theme`: muted text, `border: 1px solid transparent`, no
  background); `landing.html:28` (`.cmd .copy`: 11.5 px muted text)
- **Evidence:** These are the same color as non-interactive muted text (e.g. `.statusbar` and `.facts`), with no
  underline, chrome or icon.
- **User Impact:** A user looking for how to save the log scans the log pane and reads "Find  Download log  Unsplit" as
  a caption. "System" next to the half-filled circle reads as a status, not a button that changes the theme. A
  first-time visitor on the landing page may not see that "Copy" can be pressed.
- **Related questions:** Q5 (assumed), Q24 (answered)
- **Severity:** Friction
- **Remediation:** Give `.head-link` the accent color or an underline on hover and focus, plus a pointer; give `.theme`
  and `.copy` the `.btn.quiet` chrome with a visible border on hover and focus. Keep them quiet, but different from
  static text.

**UX-013: Gestures with no visible trigger, and no drawn per-file actions on desktop**
- **Principle:** Invisible interactions; Modality monoculture; Nielsen 6
- **Location:** `panels.html:101` (Help: "a long press on a command opens it"); `wireframes/phone.html:131` ("a long
  press on a file: rename, download, delete"); desktop Files pane `editor.html:39-50` (rows with no row-level control)
- **Evidence:** Help by long press has no keyboard or desktop equivalent drawn (on desktop, typing `help regress` or
  using the field works). Rename, download and delete for one file are drawn nowhere in hi-fi.
- **User Impact:** A desktop user who wants to rename `analysis.do` or download `output/analysis.log` has no visible
  path. A phone user who doesn't know about the long press can't delete a file. On iOS, a long press in a contenteditable
  normally starts native text selection, so the Help gesture may never reach the page (OQ7).
- **Related questions:** Q27 / OQ4 (open), OQ7 (open)
- **Severity:** Friction
- **Remediation:** Show a ⋯ on the hovered, focused or selected file row (always visible on touch), opening Rename,
  Download, Delete. For Help, add a "Help for `regress`" item to the editor's context menu, and keep long-press as a
  shortcut if the phone test passes.
- Unverified: could not inspect iOS long-press behavior in CodeMirror, because it needs a real phone (emulation has no
  phone keyboard, per the plan).

**UX-014: The from-source MCP command is cut off, has a placeholder to edit, and Copy shows no feedback**
- **Principle:** Nielsen 5 (Error prevention); Microinteraction silence (Saffer: feedback)
- **Location:** `landing.html:96` (`claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp
  --workdir "$PWD"`), `landing.html:27` (`text-overflow: ellipsis`), `landing.html:28` (`.copy`)
- **Evidence:** The command is about 100 characters. At 1440 px the code area is roughly 495 px of 12.5 px monospace,
  about 66 characters, so `--extra mcp dofile-mcp --workdir "$PWD"` is cut off. The visible part contains
  `/path/to/dofile`, a placeholder that fails if pasted as is, and nothing says to replace it. No copied state is drawn.
- **User Impact:** A user setting up an agent copies, pastes, and gets an error from `uv` about a missing directory,
  because nothing marks `/path/to/dofile` as a placeholder. They also can't read the end of the command they're about
  to run. A user who can't tell whether Copy worked presses it again or selects the text by hand.
- **Related questions:** Q4 (assumed)
- **Severity:** Friction
- **Remediation:** Let the command wrap (`white-space: pre-wrap; word-break: break-all`), give the placeholder a
  distinct style, and add "replace /path/to/dofile with where you cloned it". Draw Copy's feedback ("Copied" for 2 s,
  announced through a polite live region).
- Unverified: could not inspect the copy interaction, because Copy is a static span.

**UX-015: A click on a variable inserts its name into "the editor or the command line", and the rows don't look clickable**
- **Principle:** Saffer: rules; WCAG 3.2.2 (no unexpected change of context); Nielsen 5
- **Location:** `panels.html:79-80` ("a click puts the name in the editor or the command line; the highlighted row is
  the hover"); `panels.html:65` (`tr.hl`, a hover state only)
- **Evidence:** The rule doesn't say which target. The only signifier is a hover tint (no touch or keyboard
  equivalent).
- **User Impact:** A user who clicks a variable to read its label may silently change their do-file. That changes the
  file, adds an unsaved dot, and in the worst case puts a stray word into a line that later fails. Touch users get no
  hover hint at all.
- **Related questions:** OQ6 (open)
- **Severity:** Friction
- **Remediation:** Insert into the command line only (never the do-file) unless the user picks "Insert into editor"
  from a row action. Add a visible row affordance (an "insert" icon on focus and hover; always visible on touch).

**UX-016: On desktop, the landing page's pitch is drawn as a static editor, in the comment color**
- **Principle:** Affordance mismatch (looks editable, isn't); visual hierarchy (Protocol 6)
- **Location:** `landing.html:79-81` (`welcome.do` tab, line numbers and every sentence in `<span class="c">`, i.e.
  `--tok-comment` = `--muted`)
- **Evidence:** A pane with an active tab, line numbers and code styling, with no Run button and no cursor. The main
  message is in the lowest-emphasis text color on the page. The side card's lede (`landing.html:86`) is ink-colored and
  larger.
- **User Impact:** A first-time visitor may click into it and try to type or run (it looks like the product), and gets
  nothing. The pitch competes poorly with the CTA card for attention. The concept is charming and fits the brief
  (legacy OpenStata's landing was an editor), so this is about signifiers, not the idea.
- **Related questions:** Q5 (assumed)
- **Severity:** Polish
- **Remediation:** Either make welcome.do a real read-only CodeMirror with a "Run this" button that opens the editor
  with it, or give the first comment block `--ink` and keep comment-gray for the rest.

> **Microinteractions sound in the mockups:** Save (trigger: button or ⌘S; feedback: the unsaved dot clears in three
> places), Load/Import (the command is shown before you press; echoed in the log; added to history,
> `panels.html:176-178`), View/Hide matrix (in place, labelled), Break (trigger visible; feedback planned as a
> countdown in the flows, see UX-005 for the missing hi-fi).

### Protocol 5: Accessibility Sweep (WCAG 2.2)

**UX-017: The landing page reads poorly in a screen reader: no `<h1>`, an unlabeled block-letter logo, and the pitch read with line numbers and asterisks**
- **Principle:** WCAG 1.3.1 (Info and Relationships), 2.4.6 (Headings and Labels), 1.1.1 (Non-text Content)
- **Location:** `landing.html` (no `<h1>`; the only headings are `<h2>` at `:92` and `:107`); `landing.html:72` and
  `:81` (`data-art`, filled by `art.js:57-66` with `innerHTML` of block characters, no `aria-hidden` or
  `aria-label`); `landing.html:81` (each line is `<span class="n">7</span><span class="c">* Run Stata-syntax…`)
- **Evidence:** In the desktop layout, the product name exists only as ▀▄█ characters, and the pitch is inside a
  `<pre>` where the line numbers and `*` / `//` are real text. The phone hero (`landing.html:74`) has a plain `<p>`.
- **User Impact:** A blind researcher arrives from a README link and gets "seven, star, Run Stata-syntax do-files…",
  and before that a long run of block-element characters that VoiceOver reads out one by one, or skips with nothing
  said. Heading navigation (the most common way to skim) finds "On your computer" and "What a run looks like" but no
  page title or "what is this".
- **Related questions:** Q8 (answered), Q9 (assumed)
- **Severity:** Degrades task
- **Remediation:** Add `<h1 class="visually-hidden">dofile: run Stata-syntax do-files in your browser</h1>`. Put
  `aria-hidden="true"` on every `[data-art]`, and have `art.js` add it. Mark the gutter `.n` spans `aria-hidden`, and
  give the welcome.do pane a visually hidden plain-text copy of its sentences (or render the comments with the `*`
  in a CSS `::before`).
- Unverified: could not inspect the result in VoiceOver or NVDA, because no screen-reader test was run (static review
  only).

**UX-018: `ui.css` has no `:focus-visible` style; focus exists only as a demo class**
- **Principle:** WCAG 2.4.7 (Focus Visible); the plan's rule "everything usable by keyboard"
- **Location:** `ui.css:41` (`.focus { box-shadow: var(--focus); }`), `tokens.css:37` (`--focus`); no `:focus` or
  `:focus-visible` selector anywhere in `ui.css`
- **Evidence:** The ring is defined well (2 px gap + 2 px accent, ≥ 3:1 per the tokens' header), but only applied by
  hand-placed `class="focus"` (`editor.html:27`, `panels.html:239,253`).
- **User Impact:** If `ui.css` becomes the page's CSS as planned, a keyboard user tabbing through the toolbar, the file
  list, tabs and Results rows sees the browser default ring on some elements and nothing on custom ones (rows with
  `overflow: hidden` such as `.rs td` and `.pane` clip outlines).
- **Related questions:** Q8 (answered), Q9 (assumed)
- **Severity:** Degrades task
- **Remediation:** `:where(a, button, [tabindex], input, [role=tab]):focus-visible { outline: none; box-shadow:
  var(--focus); }`, and an inset variant for elements inside `overflow: hidden` panes. Add a focus-order check to the
  planned `@axe-core/playwright` run.
- Unverified: could not inspect real focus behavior, because the mockups use `<span>`s, not focusable controls.

**UX-019: Editor line numbers fall below 4.5:1, which contradicts `tokens.css`'s own contrast note**
- **Principle:** WCAG 1.4.3 (Contrast, Minimum)
- **Location:** `ui.css:89-90` (`.code .n { color: var(--muted); opacity: .8; }`); `tokens.css:3-4` ("all text >=
  4.5:1")
- **Evidence:** Muted at 80% opacity, computed: **3.97:1** on `--surface` (light), 3.48:1 on a selected or running line
  (`--accent-soft`, light), 3.82:1 on `--accent-soft` (dark). (The error line's own number sets opacity 1 and the error
  color, so it is not affected.) Dark on `--surface` passes at 4.57:1.
- **User Impact:** "Go to line 17", "Running lines 14–15", and the status "at line 17" all send the user to a line
  number. Low-vision users and anyone on a dim laptop screen have to squint at the exact element the error text points to.
- **Related questions:** Q8 (answered)
- **Severity:** Friction
- **Remediation:** Remove `opacity: .8` (`--muted` alone is 6.32:1 on white), and update the contrast note.

**UX-020: Text inputs have 1.4:1 borders**
- **Principle:** WCAG 1.4.11 (Non-text Contrast); internal inconsistency with `tokens.css:5` ("control borders >= 3:1")
- **Location:** `ui.css:135` (`.cmdline .field { border: 1px solid var(--border); }`), `ui.css:166-167` (`.filter`),
  `panels.html:86` (Help field, inline `border:1px solid var(--border)`)
- **Evidence:** `--border` `#d9dbe0` on `#fff` = **1.39:1**; dark `#30343d` on `#1c1f26` = **1.32:1**. Buttons and the
  dropzone use `--border-strong` (3.3 and 3.7:1).
- **User Impact:** The command line is the main way to run one command. A user with low contrast sensitivity, or on a
  phone in daylight, can't see where to tap; the muted placeholder is the only cue.
- **Related questions:** Q8 (answered)
- **Severity:** Friction
- **Remediation:** Use `--border-strong` for every input border (one rule in `ui.css`), matching the buttons.

**UX-021: The status bar is a polite live region that holds a ticking timer and a memory figure**
- **Principle:** WCAG 4.1.3 (Status Messages), used in a way that floods the user
- **Location:** `editor.html:117-123` (`<footer class="statusbar" role="status" aria-live="polite">` containing
  "Running lines 14–15 · 3.4 s" and "Memory 612 MB")
- **Evidence:** If the elapsed time updates each second and memory updates after each run, every change is announced.
- **User Impact:** A screen-reader user running a two-minute model hears "Running lines 14–15 · 3.5 s… 3.6 s…" over the
  log they're trying to read, or turns speech off and then misses "Ready" and the error code.
- **Related questions:** Q8 (answered)
- **Severity:** Friction
- **Remediation:** Make the live region a separate, visually hidden element that announces only changes of state ("Run
  started", "Run finished: error r(111) at line 17", "Engine reset"). Take `aria-live` off the footer itself.
- Unverified: could not inspect update frequency, because the timer is static text in the mockup.

**UX-022: ARIA patterns are half applied: a tablist with no tabs, and the desktop log isn't a log**
- **Principle:** WCAG 4.1.2 (Name, Role, Value), 1.3.1; the plan's rule "the log readable by screen readers"
- **Location:** `editor.html:106` (`<div class="pane-head" role="tablist">` with `<span class="tab">` children, no
  `role="tab"`, `aria-selected` or `aria-controls`); `phone-log.html:63` (the same); `editor.html:85` (desktop log
  `<pre class="log">` with no `role="log"`), against `phone-log.html:44` (`role="log" aria-label="Log"`); the editor's
  file tabs (`editor.html:57`) have no role at all
- **Evidence:** `role="tablist"` with non-tab children is invalid and announces as an empty tab list.
- **User Impact:** A screen-reader user hears "tab list" and can't find any tabs to move between Graph, Data and
  Results. On desktop, new log output isn't announced, so after a run they don't hear the error.
- **Related questions:** Q8 (answered), Q9 (assumed)
- **Severity:** Friction
- **Remediation:** Either finish the pattern (`role="tab"`, `aria-selected`, roving `tabindex`, arrow keys,
  `role="tabpanel"`) or remove `role="tablist"` until the build. Put `role="log"` on the desktop log too. Add these
  to the component list in deliverable 5.
- Unverified: could not inspect real semantics, because the mockups are static `<span>`s; the build may differ.

**UX-023: The editor tab's close × is 10 px wide**
- **Principle:** WCAG 2.5.8 (Target Size, Minimum, 24 × 24 CSS px); Fitts's Law
- **Location:** `ui.css:66` (`.tab .x { width: 10px; }`) inside `.tab` (`padding: 9px 10px 8px; gap: 7px`,
  `ui.css:62-63`)
- **Evidence:** The × target is 10 px × about 19 px (line height). It sits 7 px from the unsaved dot and 10 px from
  the tab's edge, so the spacing exception (a 24 px circle that doesn't overlap another target) fails against the
  neighboring tab.
- **User Impact:** A user with a tremor, or anyone on a touchscreen laptop, misses × and switches tabs instead, or hits
  the neighbor's ×. Close asks first when there are unsaved edits (`editor.html:57`), so this costs time, not work.
- **Related questions:** Q8 (answered)
- **Severity:** Friction
- **Remediation:** Make `.x` a 20–24 px square with a hover background, `aria-label="Close analysis.do"`.

> **Perceivable (other):** Graph images carry real `alt` text (`editor.html:109`, `panels.html:225`,
> `phone-log.html:54`). `lang="en"` is set on every page. Text color pairs other than UX-019 meet 4.5:1 (spot-checked:
> muted on surface 6.32, muted on surface-2 5.49, `.soon` 6.48, dark Delete text on error 6.66; the rest per
> `tokens.css`). The disabled Run and Break buttons use `opacity: .45` (`ui.css:35`). WCAG exempts inactive controls,
> so it isn't reported.
> **Motion:** Clear. Checked `ui.css`, `tokens.css` and every mockup's `<style>` for `transition`, `animation` and
> `@keyframes`: none. `.pulse` (`ui.css:151`) is a static dot with a text label beside it. When a spinner or progress
> animation is added for the starting state (UX-005), give it a `prefers-reduced-motion` static fallback.
> **Understandable:** Error identification and suggestion are strong (Nielsen 9 above). The command line has a
> placeholder and no label (`editor.html:102`). Give it `aria-label="Command"`. Folded into UX-022's component list.

### Protocol 6: On-Screen Hierarchy and Wayfinding

The biggest gap under this protocol, undrawn loading and error states, is UX-005.

**UX-024: Phone: an unlabeled memory figure and an 11 px log**
- **Principle:** Information scent; Universal Design 4; WCAG 1.4.4 (resize text is possible, but the default is small)
- **Location:** `phone-log.html:42` (`<span>612 MB</span>` with no label), `phone-log.html:22` (`.log { font-size: 11px; }`)
- **Evidence:** Desktop says "Memory 612 MB" (`editor.html:121`); the phone drops the word. The phone log is 11 px
  against 12.5 px on desktop.
- **User Impact:** A phone user sees "612 MB" next to "r(111)" and may read it as file or data size. A user reading
  a regression table on a phone on the bus squints at 11 px monospace; pinch zoom works (the viewport doesn't block
  it), but then they're also scrolling sideways.
- **Related questions:** Q7 / OQ3
- **Severity:** Polish
- **Remediation:** "Mem 612 MB", or a memory icon with an accessible name. Try 12 px with the existing sideways scroll;
  the wide table already scrolls.

> **Hierarchy:** Sound on the editor. Run is the only filled button; the error is the most saturated element; the
> active tab, open file and selected thumbnail use the same accent language consistently. Landing hierarchy: UX-016.
> **Grouping:** Sound. Run, Run selection, Break, Save are together; Find/Download log/Unsplit sit on the log's head;
> notices sit above the log ("not in the status bar only", `panels.html:268`).
> **Wayfinding:** Sound. The open file is shown in three ways (tab, list row with accent bar, bold). The phone has a
> title ("Log") and an active tab. "Go to line 17" links log to editor.
> **Progressive disclosure:** Results groups fold with counts and e() scalars open by default (`panels.html:110-125`);
> "Globals 6, all set by the system" folded. Good.
> **Empty states:** Not drawn: an empty Graph tab (no graph yet), empty Results, Data with nothing in memory. These
> are in the same family as UX-005; add them to its list.

### Protocol 7: Dark-Pattern and Cognitive-Load Scan

> **Dark patterns:** None found. Checked the flows involving consent (none: no accounts, no tracking drawn), delete
> (confirm with "there is no undo", neutral Cancel, `panels.html:265-266`), overwrite (UX-001: an unsafe default, but
> not manipulative), the landing CTAs (two "Open the editor" with equal, honest copy), and "with the first release"
> labelling for an install line that doesn't work yet (`landing.html:93`): the opposite of a hidden cost.
> Privacy copy says files stay in the browser *and* discloses the CDN download (`landing.html:81`, lines 16–18).

**UX-025: The name-clash dialog has four choices whose labels don't match the question**
- **Principle:** Hick's Law; Nielsen 4 (Consistency of wording)
- **Location:** `panels.html:235-239`
- **Evidence:** The question says "Keep the one here, or replace it with the uploaded one?" The buttons say "Keep all",
  "Overwrite all", "Keep existing", "Overwrite". "Keep all" sits next to "Keep existing" and reads as "keep both
  copies".
- **User Impact:** A user facing five clashes reads four equal-weight buttons and translates "replace" to
  "Overwrite" and "the one here" to "existing" under time pressure. Some will pick "Keep all" thinking it keeps
  both versions.
- **Related questions:** Q12 (answered)
- **Severity:** Friction
- **Remediation:** Two primary choices in the question's words, "Keep mine" / "Replace with uploaded", plus a "Do the
  same for the other 4" checkbox (the `.check` component already exists, `ui.css:222-223`). This also fixes UX-001's
  default.

**UX-026: Phone: Run turns into Break in place**
- **Principle:** Fitts's Law (a destructive-ish action appears under the finger that just pressed); Nielsen 5
- **Location:** `wireframes/README.md:11` ("Run turns into Break in place"); hi-fi `phone-log.html:41` shows only the
  idle Run
- **Evidence:** One target, two opposite actions, swapped by the system at the moment of the first tap.
- **User Impact:** A user who double-taps Run (common when the first tap seems not to register during a slow start)
  breaks their own run at once. If the command doesn't stop, the engine resets and the data in memory is lost (UX-006).
  One-handed and tremor-affected users are most at risk.
- **Related questions:** OQ8 (open), Q7 / OQ3
- **Severity:** Friction
- **Remediation:** Ignore taps on the swapped button for about 600 ms, and give Break a different shape and color (the
  desktop `.btn.stop.live` style). Draw the phone running state in hi-fi.
- Unverified: could not inspect the phone running state in hi-fi, because it is only in the wireframes.

### Protocol 8: Recency and Churn Context

`git log --since="90 days ago" --name-only` over `docs/design` and `web/src`: every file in the focus area
(`docs/design/mockups/*`, `docs/design/tokens.css`) is **untracked**, so all of it is new. The wireframes they build
on were committed once (ebeb28d). The page code that will carry this design (`web/src/main.ts`, 5 changes;
`web/src/engine/client.js`, 7; `worker.js`, 8) has the most recent churn, around start-up, restart and Break, which is
where UX-005, UX-006 and UX-026 sit. Priority is raised on those three.

## UX Improvement Summary

### What Was Found

The mockups get error recovery right: the `r(111)` block with its plain-English fix, "Go to line 17" and the marked
editor line are better than most tools in this space. The Delete confirm is a good model, and there are no dark
patterns. The problems cluster in four places:

- **Destructive defaults and hidden consequences:** the name-clash dialog defaults to Overwrite (UX-001, UX-025); Break's
  notice doesn't say data in memory is lost (UX-006); the phone's Run becomes Break in place (UX-026).
- **Rules the UI doesn't show:** the locals rule for Run vs Run selection, with a shortcut chip on the wrong button
  (UX-004); whether Run saves (UX-007); storage persistence (UX-009); tooltip-only explanations (UX-002); the running
  lines (UX-003).
- **Start-up and failure states:** the first thing every visitor sees isn't designed, and the landing copy undersells
  the wait on phones (UX-005).
- **Accessibility in the parts that will carry into the build:** the landing page for screen readers (UX-017), no
  `:focus-visible` (UX-018), line-number and input-border contrast (UX-019, UX-020), live region and ARIA patterns
  (UX-021, UX-022), the tab close target (UX-023).
- Smaller signifier and discoverability gaps: UX-008, UX-010–016, UX-024.

### How to Improve

1. Name-clash dialog: focus and style "Keep existing" as primary; reword it as two choices plus "do the same for the rest" (UX-001, UX-025).
2. Draw the starting, failed-twice and did-not-start states; put measured time and download size on the landing page (UX-005).
3. Put the ⌘ ↩ chip on whichever button it triggers, and say in the log whether a run starts with no locals or keeps them (UX-004).
4. Landing page: add a hidden `<h1>`, `aria-hidden` on the banner art and gutter numbers, and plain text for the pitch (UX-017).
5. Add a `:focus-visible` rule to `ui.css` using `--focus`, with an inset variant (UX-018).
6. Break copy: "the data in memory is lost, your files are kept" (UX-006). Phone: guard the Run→Break swap (UX-026).
7. Decide OQ1, then add a log note when a run used the saved version of a file with unsaved edits (UX-007).
8. Add a visible "Download all" link and name the ⋯ menus; draw Reset's confirmation (UX-008). Draw the "storage not kept" state (UX-009).
9. Token fixes: drop the line numbers' `opacity: .8`, and use `--border-strong` on inputs (UX-019, UX-020).
10. Semantics: a separate state-only live region; finish or remove `role="tablist"`; `role="log"` on desktop; a 24 px close target (UX-021, UX-022, UX-023).
11. Signifiers: head links, theme button and Copy get hover and focus chrome; Copy gets a "Copied" state; the MCP command wraps (UX-012, UX-014).
12. Per-file ⋯ on file rows; Help from the editor's context menu (UX-013). Data tab inserts into the command line only (UX-015). A gutter mark for running lines (UX-003). Lint-style reason for unknown commands (UX-002).
13. Polish: label the command line's Run as "Run command" (UX-010), "Show more rows" (UX-011), welcome.do emphasis (UX-016), the phone memory label and log size (UX-024).

### How to Prevent This Going Forward

- Add the `@axe-core/playwright` check the plan already lists to the mockups now, not only the built page. It would
  catch UX-017's headings, UX-022's tablist and the missing names.
- Extend the contrast note in `tokens.css` into a script (the computation in this audit is about 20 lines) that runs
  over every token pair *and* every `opacity` applied to text. That catches UX-019-type regressions.
- Make "States and messages" in `flows/index.html` a checklist with a hi-fi file column, so the gaps in UX-005 stay
  visible.
- For every dialog with a destructive choice, record which button has default focus in the mockup's figcaption.
- When the plan defines a rule that changes results (locals, saving), add a "where does the user see this?" line next
  to it.
- One real-phone and one VoiceOver session per design round; several findings here (UX-013, UX-017, UX-026) can only
  be settled that way.

### Balancing Shipping vs Improving

Fix before the editor is built (step 6), because they're cheap in a mockup and expensive after: **UX-001, UX-004,
UX-005, UX-017, UX-018**, plus the one-line copy fix UX-006 and the token fixes UX-019 and UX-020. UX-004 is the most
important: a user can get a wrong answer with no warning. Decide OQ1, OQ2 and OQ4 in the next design round, because
UX-007, UX-009 and UX-013 depend on them. The rest (signifiers, ARIA completion, phone polish) can go into the step 6
build checklist and be verified there by the axe run and a real-phone pass, rather than redrawn now.
