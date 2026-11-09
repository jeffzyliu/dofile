# UX Analysis: dofile web demo, hi-fi mockups, iteration 2

A shorter follow-up to `ux-analysis.md` (the crit of iteration 1). Part 1 checks each of UX-001 to UX-026 against the
iteration-2 changes. Part 2 lists new findings, numbered from UX-027. Severity scale and principles are the same as in
the first crit.

## Scope and method

- **Read:** the working-tree diff against c0cab10 of `editor.html`, `landing.html`, `panels.html`, `phone-log.html`,
  `ui.css`, `../tokens.css`, `art.js`, `../flows/index.html`, `../README.md` ("Iteration 2"), the `dev:` answers and the
  resolution table in `ux-analysis.md`, and the new `states.html` (drawings 1–18).
- **Automated:** `cd web && npm run axe` gave **0 violations in 32 runs** (6 pages × light/dark × 1440/390, plus
  `?running`). axe's "needs review" items are all `color-contrast` checks it couldn't settle over scrims, `aria-hidden`
  banner art or stacked backgrounds. Spot-checked by hand from the tokens: none fail.
- **Keyboard walk:** Playwright pressed Tab through `landing.html` (1440 and 390) and `editor.html` (1440) and logged
  each focused element and its box. axe can't see focus order or focus landing on something invisible. Two findings
  below come from this walk (UX-017 regression, UX-013 / UX-027).
- **Not used:** the `.png` renders. No screen reader or real phone (OQ7, OQ8 are still open).
- Mockup line numbers refer to the working tree on `design/hifi-mockups`.

## Summary

Iteration 2 handled the first crit well. Of 26 findings, **17 are verified fixed, 1 was dropped by decision (UX-015),
1 was deferred (UX-009), and 7 are only partly fixed**. `states.html` covers most of the states the flows asked for, and
its build notes are useful (the IDBFS dependency of "Not now", and the fact that `loadPackage` reports no bytes). The
gaps cluster in three places:

- Things claimed to work by keyboard that can't take focus.
- The UX-004 trap, which is still drawn in the running mockup itself.
- A few new start-up and Break states that leave the user without an exit.

| Severity      | New findings |
|---------------|-------|
| Blocks task   | 0 |
| Degrades task | 2 (UX-027, UX-028) |
| Friction      | 6 |
| Polish        | 3 (UX-037 groups 7 small items) |

## Part 1: was the first crit's feedback addressed?

| ID | Verdict | Evidence / what's left |
|---|---|---|
| UX-001 | Verified | `panels.html:239-245`: Keep mine is primary and focused, Replace is neutral. Esc in a multi-clash upload: see UX-037. |
| UX-002 | **Partial** | The `reghdfe` lint is drawn (`editor.html:64`). "All digits when the row has keyboard focus" (`panels.html:133`) can't happen, because the Results rows have no `tabindex`. See UX-027. |
| UX-003 | Verified | `ui.css` `.ln.run`: an accent gutter bar and bold number, no tint. Nit: `tokens.css:4-5` still names "line numbers on a running … line" as the lowest pair (muted on accent-soft), but running lines are no longer tinted. |
| UX-004 | **Partial** | The chip moved and the run-head line exists (remediations 1 and 2). Remediation 3, flagging a local that is empty, wasn't adopted, and the mockup now draws the trap itself. See UX-028. |
| UX-005 | Verified | `states.html` 1–8; the landing page states 36 MB. New issues in the new states: UX-029, UX-030, UX-031, UX-033. |
| UX-006 | Verified | `editor.html:106`, `phone-log.html`, `states.html:234`: "the data in memory is lost; your files are kept". |
| UX-007 | Verified | `states.html:338-341`: the nested-`do` note, which matches the OQ1 answer. Unclear: whether the note goes into Download log. The run-head says "shown only", but the note doesn't say. |
| UX-008 | Verified | "Download all (.zip)" under the list (`editor.html:56`); ⋯ buttons named; the menu and Reset's confirm drawn (`states.html` 12, 14). |
| UX-009 | Deferred (agree), but spreading | See UX-032: iteration 2 added more copy that assumes storage persists. |
| UX-010 | Verified | "Run command". |
| UX-011 | Verified | "Show 50 more" (`panels.html:69`). |
| UX-012 | Verified | Head links in the accent, the theme button and Copy get button chrome. |
| UX-013 | **Partial** | Only `analysis.do` has a row ⋯ in the markup (`editor.html:43`). The other rows have none and can't take focus, so the keyboard reaches one file's menu and no other file. The ⋯ is 22 × 16 px, under the 24 px minimum. See UX-027. |
| UX-014 | Verified | The command wraps, the placeholder is marked and explained, and the Copied state is drawn. Accessible names: UX-035. |
| UX-015 | Dropped by decision | A click now marks the column. "Enter on its focused row" (`panels.html` Data caption) has the same focus gap as UX-002 (UX-027). `aria-selected` on a plain `<tr>` belongs to the `grid` pattern; use a listbox or a grid. |
| UX-016 | Verified | `.code .lead` puts the pitch's first lines in ink. |
| UX-017 | **Partial, with a regression** | The hidden `<h1>`, `aria-hidden` art and the plain-text copy are done. But the copy holds a real link (`landing.html:94`, `:130`) while the visible link got `tabindex="-1"`. The Tab walk lands on "the list of commands", which is inside a 1 px clipped box, so a sighted keyboard user sees no focus ring (WCAG 2.4.7, 2.4.11). Fix: leave the visible link focusable and make the hidden copy's version plain text, or hide only the gutter and the `*`s, not the sentences. |
| UX-018 | Verified | The `:focus-visible` ring, inset inside panes. The Tab walk shows a sensible order on the editor. |
| UX-019 | Verified | No opacity on `.n`. |
| UX-020 | Verified | Inputs use `--border-strong`. |
| UX-021 | Verified | The status bar isn't live; a hidden region announces state changes (`editor.html:123`). |
| UX-022 | **Partial** | Output tabs are done. The editor's file tabs hang off an **empty** `role=tablist` through `aria-owns` (`editor.html:62`). axe can't test this, and `aria-owns` has historically been unreliable in Safari/VoiceOver, the browser this page cares most about; confirm it in the VoiceOver session. Pick a build pattern now: put the close × inside the tab with `tabindex=-1` and close on Delete (the VS Code pattern), or don't use tab roles for the file strip at all. |
| UX-023 | **Partial** | `editor.html` is done. In `panels.html:168, 188, 199`, the opened-file tabs (wages.dta, survey.csv) still use `<span class="x">×</span>` inside the tab, and survey.csv's dot has no label. |
| UX-024 | Verified | "Mem 612 MB"; 12 px log. |
| UX-025 | Verified | Two choices in the question's words, plus "Do the same for the other 3 clashes". The checkbox is drawn as spans; the build needs an `<input type=checkbox>`. |
| UX-026 | **Partial** | The color change and the 600 ms guard do the work. The "other shape" is `border-radius: 2px` against the 4 px default (`phone-log.html:40`), which nobody will notice. Either claim color, position of the time and the guard, or make the shape really different (an icon-only square, or full width). |

The resolution table at the end of `ux-analysis.md` should be corrected in two places. It says "No automated checker
was run: axe isn't installed in `web/` yet" (`ux-analysis.md:818`), but `npm run axe` now exists and passes. It also
marks UX-002, UX-004, UX-013, UX-017, UX-022, UX-023 and UX-026 as Fixed.

### Open questions, status

OQ1, OQ3, OQ4, OQ5, OQ6 and OQ9 are answered and applied. OQ2 (persistence) is unknown; it is cheap to test (UX-032).
OQ7 and OQ8 still need a real phone.

## Part 2: new findings

**UX-027: Keyboard behavior is promised for elements that can't take focus**
- **Principle:** WCAG 2.1.1 (Keyboard); the brief's "everything usable by keyboard"
- **Location:** file rows (`editor.html:43-53`, plain `<li>`s); Data variable rows (`panels.html:65-67`); Results rows
  (`panels.html` `.rs tr.row`)
- **Evidence:** The Tab walk on `editor.html` goes from "File actions" to "Actions for analysis.do" to "Upload". No file
  can be opened or chosen, and no other file's menu can be reached. The captions promise "Enter on its focused row"
  (Data) and "all digits when the row has keyboard focus" (Results).
- **User Impact:** A keyboard-only user can't open `clean.do`, rename it, or read a coefficient to full precision.
- **Severity:** Degrades task
- **Remediation:** Make the file list a `tree` (or a `listbox`) with roving `tabindex` and arrow keys, with Enter to open,
  F2 to rename, Shift+F10 or the context-menu key for the ⋯ menu. Use the same roving pattern for Data and Results rows.
  Add one row of each to the Tab walk as a regression check, since axe passes all of this.

**UX-028: The running mockup draws the UX-004 trap and calls it fine**
- **Principle:** Nielsen 1, 5 (a wrong result with no warning)
- **Location:** `editor.html:102-104` (running state). The comment says "the first run of a session", and the run-head
  says "**keeps the locals of earlier runs**" over `. regress wage `controls'`.
- **Evidence:** This is the session's first run, so there are no earlier runs and `` `controls' `` is empty. `regress wage`
  fits a constant-only model with rc 0, which the first crit checked with `dofile run`. The new line describes the rule
  correctly, in muted 12.5 px text, and says nothing about the consequence.
- **User Impact:** The student from UX-004 sees an honest but abstract note and still gets the wrong model.
- **Severity:** Degrades task
- **Remediation:** The page knows which locals exist (the Results panel lists them), and the tokenizer finds `` `name' ``.
  Before a selection run, compare the two (excluding names the selection itself assigns: `local`, and `foreach`/`forvalues`
  loop names) and add the result to the run-head in the warn color: "`controls` is not set
  in this session; it expands to nothing". At minimum, on a session's first run say "no earlier runs: no locals are set".

**UX-029: No way to stop the download once it has started**
- **Principle:** Nielsen 3 (User control and freedom)
- **Location:** `states.html:93-106` (drawing 2); its only button is "Edit files while it loads"
- **User Impact:** A phone user who pressed "Download 36 MB" on mobile data, then saw the bar moving slowly, can only close
  the tab. The prompt existed to give them that choice.
- **Severity:** Friction
- **Remediation:** Add "Stop download", which leads to drawing 5 (Not now). The fetch-into-cache plan in the caption
  makes this an `AbortController` call, and the download resumes from the cache later.

**UX-030: "Not now" disables Run instead of making it the way back**
- **Principle:** Nielsen 3, 6; disabled controls explain nothing and can't take focus
- **Location:** `states.html:164` (`Run · no engine`, `disabled`); the only way back is the banner over the editor
  (`:166-168`)
- **User Impact:** A user who said Not now, edited a file and now wants to run it presses Run and nothing happens. A
  keyboard or screen-reader user never reaches Run at all.
- **Severity:** Friction
- **Remediation:** Keep Run enabled. Pressing it opens drawing 1 again ("Download the engine to run code"). The same
  applies to the command line's Run.

**UX-031: The Break countdown has no "let it finish"**
- **Principle:** Nielsen 3; Universal Design 5 (Tolerance for Error)
- **Location:** `states.html:231-235` (drawing 9): "In 4 s the engine is reset", and the only button is a disabled
  "Stopping…"
- **User Impact:** A user who pressed Break on a merge that was nearly done, or pressed it by mistake, loses the data in
  memory with no way to back out. This is the most destructive automatic action in the product.
- **Severity:** Friction
- **Remediation:** During the countdown, offer "Don't reset: wait for it". It cancels the page's kill timer and leaves
  the interrupt flag set, so the engine takes the Break at its next safe point (rc 1, data kept, as PATCH-2 already
  does). Ask whether the engine side allows this; the page side is one timer.

**UX-032: More copy now assumes storage persists, while OQ2 stays untested**
- **Principle:** Nielsen 1; the UX-009 risk is growing
- **Location:** `landing.html` CTA ("Your files are kept in this browser between visits"); `states.html:72-73` ("Later
  visits use the copy your browser keeps"); the first-visit flag in drawing 1 lives in the same storage
- **Evidence:** The caption of drawing 1 already admits iOS can clear the cache.
- **Severity:** Friction
- **Remediation:** Before more copy builds on it, run the cheap half of OQ2: call `navigator.storage.persist()` and
  `persisted()` in the three Playwright engines and in Safari on one iPhone, and record the results in the plan. Write the
  "not kept" copy now (one sentence plus the Download all link), even if the state is only drawn later.

**UX-033: "Upload" means two opposite things**
- **Principle:** Nielsen 2, 4 (one word, one meaning)
- **Location:** `states.html:74`, `:215-216` ("Your files are never uploaded anywhere"), against `editor.html:55`
  ("Upload"), `panels.html:242` ("the other 37 files are uploaded") and the "Upload report"
- **User Impact:** A privacy-minded user, the one this sentence is for, reads "never uploaded" next to an Upload button
  and stops trusting either.
- **Severity:** Friction
- **Remediation:** Keep "Upload" for the button, a convention people know. Change the privacy line to "Your files stay
  in this browser; they are never sent anywhere", which matches the landing page's own words.

**UX-034: The failure state offers a retry that can't help**
- **Principle:** Nielsen 9
- **Location:** `states.html:183-185` (drawing 6): "no WebAssembly support", with Try again as the primary action
- **Severity:** Friction
- **Remediation:** Give each reason its own action. No WebAssembly: "Use a current browser" (a link) and Download all,
  with no Try again. A failed download: Try again. Out of memory: close other tabs, then Try again.

**UX-035: Every Copy button has the same accessible name, and "Copied" may be read twice**
- **Principle:** WCAG 2.4.6, 4.1.2
- **Location:** `landing.html` (two Copy buttons), `panels.html` (Load and Import bars, the graph viewer); the landing
  Copied button changes its `aria-label` *and* fills a live region
- **Severity:** Polish
- **Remediation:** `aria-label="Copy pip install dofile"` and similar, or `aria-describedby` pointing at the command.
  Announce through the live region only, and keep the button's name stable.

**UX-036: The start-up bar reads as done while it isn't**
- **Principle:** Nielsen 1
- **Location:** `states.html:127-128` (drawing 3): the bar is full while the row says "step 4 of 5"
- **Severity:** Polish
- **Remediation:** Hide the bar once the download stage is done (the stage list already carries progress), or make it a
  bar in five segments.

**UX-037: Smaller items**
- Download prompt: "Download 36 MB" is primary and focused (`states.html:75`). That's reasonable, but it is the opposite
  of the rule applied to UX-001 (don't pre-focus the costly choice), so record it as a decision in the README.
- Name clash: with N clashes left, Esc means "keep this one". Say whether it also stops asking (keep the rest) or cancels
  the remaining clashes.
- Desktop focus on Run: Run disables itself when pressed, so focus falls to `<body>` unless the build moves it. If it
  moves to Break (the `focus` class at `editor.html:31`), a second Enter breaks the run: UX-026's double tap, on the
  keyboard. Recommend `aria-disabled` on Run (focus stays put) and Break reachable by Tab and its shortcut.
- `phone-log.html:41`: `.t { opacity: .9 }` on Break's timer breaks the new rule in `tokens.css` (no opacity on text).
  It still passes contrast; use a color instead.
- The ⌘ ↩ chip sits on the disabled Run selection while running (`editor.html:29`). Drop chips from disabled buttons.
- `display: contents` on `main`, `nav` and the tablists (`phone-log.html`, `editor.html`): older WebKit dropped the roles
  of such elements. Check in Safari, or use wrappers that take part in layout.
- What Run runs (OQ1, OQ5): a temporary copy. Write down that the log, error messages, "Go to line" and `c(filename)`-style
  output still name `analysis.do`, never the temporary path.

## What to do next

Fix first, because these are cheap and keyboard users hit them: **UX-017 regression, UX-027, UX-028**. Then the start-up
and Break exits: **UX-029, UX-030, UX-031**. Then the one-line copy fixes, UX-033 and UX-034. Correct the resolution
table (Part 1) and decide the UX-022 tab pattern before step 6. Add a Tab walk next to `axe.mjs` (about 20 lines of
Playwright that press Tab and log each focused element and its box). It caught two problems that axe passed.

## Resolution (iteration 3, 2026-11-09)

The maintainer's answers: add "Don't reset: wait for it"; keep Download as the prompt's default; Esc in a name clash
keeps yours for every remaining clash; editor tabs use the × inside the tab (mouse only) with Delete from the
keyboard (⌘ W and Ctrl+W are the browser's own close-tab keys; a page can't take them). Checks after the changes: `npm run axe` 0 violations in 32 runs; `npm run tabwalk` (new,
`docs/design/tabwalk.mjs`) 0 hidden focus stops on 6 page states.

| ID | Outcome | Where |
|---|---|---|
| UX-002 | Fixed: Results values are buttons (one in the tab order); e(F) is drawn focused with all digits and "↵ Copy"; group headers are fold buttons | `panels.html` Results, `ui.css` `.rs .val`, `.rs .fold` |
| UX-003 nit | Fixed: the contrast note no longer names running lines | `../tokens.css` |
| UX-013 | Fixed: the file list is a tree (flat, `aria-level`) with roving focus; every row has a 24 px ⋯ for mouse and touch; Shift+F10 or the menu key opens the same menu | `editor.html`, `states.html` 13, `ui.css` |
| UX-017 | Fixed: the hidden copies hold no link (they point to Commands in the nav); no focus stop is hidden | `landing.html` |
| UX-022 | Fixed: the file tabs are a plain tablist; the × is inside the tab, hidden from screen readers; Delete closes (`aria-keyshortcuts`); no `aria-owns` | `editor.html`, `panels.html` |
| UX-023 | Fixed in `panels.html` too (same tab pattern; survey.csv's dot labelled) | `panels.html` |
| UX-026 | Fixed: the phone's Break is a pill with the time split off, not a 2 px corner | `phone-log.html` |
| UX-027 | Fixed: file rows, Data names (buttons; the picked one has `aria-current`) and Results values take focus | `editor.html`, `panels.html` |
| UX-028 | Fixed: the run-head says "first run: none yet" and warns that `` `controls' `` isn't set, so `regress wage` has no regressors | `editor.html?running`, `ui.css` `.runwarn` |
| UX-029 | Fixed: "Stop download" while bytes come in, leading to Not now | `states.html` 2 |
| UX-030 | Fixed: Run stays enabled after Not now and opens the prompt | `states.html` 5 |
| UX-031 | Fixed (decision): "Don't reset: wait for it", focused, cancels the page's 5 s timer; the Break still lands at the next safe point; then Break becomes "Reset now" in case the command never ends | `states.html` 9, 9b |
| UX-032 | Copy written and drawn: "This browser may clear your files…" with Download all, shown when `persisted()` is false. Testing which browsers grant it is still open (OQ2) | `states.html` 19 |
| UX-033 | Fixed: "Your files stay in this browser; they are never sent anywhere" | `states.html` 1, 8 |
| UX-034 | Fixed: the action follows the reason ("Browsers that work" for no WebAssembly) | `states.html` 6 |
| UX-035 | Fixed: each Copy names what it copies; "Copied" shows beside the button (its name stays stable, the live region speaks once) | `landing.html`, `panels.html` |
| UX-036 | Fixed: no bar after the download; the stage list carries progress | `states.html` 3 |
| UX-037 | Fixed: Download default recorded as a decision; Esc in a clash keeps yours for the rest; Run is `aria-disabled` while running so focus doesn't jump to Break; no key chip on a disabled button; no text opacity on the phone's Break; no `display: contents` on tablists, `main` or `nav`; the temp copy is never named in the log | `states.html` 1, 15, `panels.html`, `editor.html`, `phone-log.html`, `ui.css` |

Still open: OQ2 (which browsers persist storage), OQ7 and OQ8 (a real phone), and a VoiceOver pass over the tree, the
tabs and the run-head warning.
