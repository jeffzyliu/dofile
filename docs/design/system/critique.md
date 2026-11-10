# Design system crit (2026-11-09)

A review of the first draft of deliverable 5 (`index.html`, `web/src/styles/tokens.css`, `web/src/styles/ui.css`), after the
maintainer approved the sheet and the toast. Each finding was checked in a browser, not by reading the CSS alone.

## Fixed

**DS-1. Forced colors (Windows High Contrast) hid icons, markers and the focus ring.** In forced colors the browser
replaces every color and drops backgrounds and box shadows. Our icons are SVG masks over a `background`, and the focus
ring, the open file's bar, the running and error lines' bars and the picked row's bar are all `box-shadow`. Checked in
Chromium with `emulateMedia({ forcedColors: 'active' })` on `editor.html`: Run's play, Break's stop, ⋯, the folder
arrows and the warning sign were gone; the focused button had no ring; line 17 (the error) looked like any other line.
Fix (end of `ui.css`): a transparent outline next to every focus shadow (forced colors draws it), icons and dots in
`CanvasText`/`ButtonText`/`LinkText`, the marker bars as `Highlight` borders, the error line in the `Mark`/`MarkText`
pair, the progress fill in `Highlight`, a border on the toast, the picked Browse column and the hovered menu item
outlined, disabled buttons' icons in `GrayText`. The outline is drawn inset inside panes, which clip. Error banners now
carry the warning icon too, so they differ from info banners without color. Checked by emulation in Chromium only, not
on a real Windows machine; real system colors (`Mark` especially) may look different.

**DS-2. No hover or pressed state on most controls.** Only the quiet button, the theme button and a few icon links had
hover styles; default and primary buttons, editor tabs and file rows had none (the file row's hover existed only as a
`.hover` class for the mockups), and nothing showed a press. Fix: hover is a step darker in light mode and lighter in
dark (`--surface-2`, and new tokens `--accent-hover`, `--error-hover`, both checked by `contrast.mjs`: 10.9 and 8.3
light, 10.3 and 8.2 dark); a press moves a button down 1 px; disabled buttons have neither. Tabs turn ink on hover.
Hover applies only with a real pointer (`@media (hover: hover)`), since iOS leaves `:hover` on after a tap.

**DS-3. Touch targets too small on phones.** Measured at 390 px with touch: file rows 28 px tall, menu items 32 px, the
tab × 22 px, the row ⋯ 24 px. axe's WCAG 2.2 target-size rule passes (the × is not focusable, and small targets
have the spacing exception), but a finger needs about 44. Fix: under
`@media (pointer: coarse)`, rows and menu items are 44 px, the ⋯ 44 px square and the × 32 px.

**DS-4. The renders could not show forced colors.** `shot.mjs --forced` now renders a page in forced colors. Playwright's
context option only matches the media query without replacing colors, and a full-page screenshot drops `emulateMedia`;
the script grows the viewport to the page instead.

## Open, not applied (recommendations)

**DS-5. Text sizes in px ignore the browser's font-size setting.** Zoom works (WCAG 1.4.4 passes), but someone who set a
larger default font in their browser settings gets 13 px anyway. All text sizes go through tokens, so switching them to
`rem` is a change to `tokens.css` alone (13 px = 0.8125rem). Recommended when the page is built (step 6), with a check
at 20 px default that the log's 80 columns still fit or scroll.

**DS-6. The dark palette is written twice.** CSS `light-dark()` would hold both themes in one declaration, but needs
Safari 17.5 or later. `contrast.mjs` already fails if the two copies differ, so this is tidiness only. Not recommended
until the page's supported browsers are fixed.

**DS-7. Components the sheet doesn't draw yet.** A text field's states (focus, invalid with its message), used by the
inline rename (F2) and its "a file with that name exists" error; the dialog as a bottom sheet on a phone; the phone's
tab bar. The toast's place on a phone (above the bottom bar and the on-screen keyboard, read from `visualViewport`) is
written in no spec. Draw them when the page needs them (steps 6 and 8), or before if the maintainer wants them reviewed.

**DS-8. No tokens for motion or stacking.** The toast's 0.16 s and the spinner's 1 s are literals, and only the toast
has a `z-index`. Add `--dur-*` and a short `z-index` scale (menu, toast, dialog) when the page has more than one
floating layer.
