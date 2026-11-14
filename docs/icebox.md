# Icebox

Things knowingly left for later, by area. Each item says what it is, where it shows, why it was left, and when.

Rules:
- An item enters when the maintainer puts it here.
- It leaves when it is fixed, dropped, or promoted to a plan (`docs/prototype1-plan.md` or a later one).
- Nothing here blocks a merge.

Paths are relative to `web/src/app/`.

## Accessibility (from the library sizing study, 2026-11-11; read from the code and tests, not run with a screen reader)

Each item was checked against the code on 2026-11-11 and is stated as the code behaves. Left as not critical for the
prototype, by the maintainer's decision of 2026-11-11; they belong with the plan's step 6 (accessibility on the real pages).

To weigh first in the post-merge review:
- **The row menu is out of reach without a keyboard or a pointer.** The file tree row's ⋯ (`files/FilesPane.tsx` `TreeRow`)
  is `aria-hidden` and opens only on a click, so the row menu needs Shift+F10, the menu key or a right click. A touch
  screen-reader user may have no way to it. Left because a control inside a `treeitem` would be nested. 2026-11-11.

The rest:
- **The tree's rows say no position.** Its flat rows (`TreeRow`) have `aria-level` but no `aria-setsize` or
  `aria-posinset`, and the tree has no typeahead (a letter moves nowhere). 2026-11-11.
- **Delete in the tree.** After a delete the focus goes to the open file's row, else the first row (`files/dialogs.tsx`
  `focusTree` once the list is read again, the tree's `tabbable`), not the deleted row's neighbour; a row has no Delete key (only its menu). 2026-11-11.
- **Rename in the tree.** The rename field sits inside the `treeitem` (`RenameField`); leaving it with a name that cannot be
  used cancels the rename and says nothing (its `onBlur`). Enter with such a name says why. 2026-11-11.
- **Tree states.** Folders never have `aria-selected`, and an empty folder has `aria-expanded` (`TreeRow`). 2026-11-11.
- **Menu keys.** `ui/Menu.tsx` has no typeahead; the arrows skip disabled items; a menu whose items were all disabled would
  take no focus, so Esc would not reach it (no current menu has all its items disabled); a key hint is part of the item's
  name ("Rename F2"), not `aria-keyshortcuts`. 2026-11-11.
- **Tabs.** Up and Down also move in the horizontal `Tablist`; `tabpanelProps` sets no `tabindex`; the open-file tabs
  (`files/EditorTabs.tsx`) have no `aria-controls`, and the editor is not a `tabpanel`. 2026-11-11.
- **The full-size graph view** (`output/FullSize.tsx`) is a hand-made `role="dialog" aria-modal` with its own focus trap;
  the rest of the page is not inert under it (a native `<dialog>` would make it so). 2026-11-11.

## Code to join (no dependency)

- **Two tablists:** `ui/Tablist.tsx` (the Output tabs, the unsplit Log pane, the phone's Views bar) and
  `files/EditorTabs.tsx` (the open files, with Delete to close and the × in each tab). **Two focus traps of the page's
  own:** `ui/Dialog.tsx` (through the native `<dialog>`'s `showModal()`) and `output/FullSize.tsx` (its own Tab handling).
  Joining each pair was estimated at 50 to 60 lines saved in all (the library sizing study). Left as not critical
  (the maintainer's decision of 2026-11-11). 2026-11-11.

## Libraries for the UI primitives (sized 2026-11-11, no change made)

The result of the library sizing study, kept so it is not redone. Its figures (measured line counts and package sizes,
estimated splits) are the study's, not checked again here.
- About 400 to 450 of about 1,400 lines in `ui/`, the focus code and the tree are generic behavior a library provides.
- A library would save about 0 to 150 lines and add 7 to 70 kB gzipped to a 183 kB bundle.
- None of the candidates keeps the native `<dialog>`.
- The closest fits: Zag.js (menu, tabs, tree; its Preact adapter imports `preact/compat`), and `@headless-tree/core`
  (framework-free, about 6.5 kB gzipped) for the tree. The case for the tree is behavior (typeahead, position in set), not
  lines.

## Infrastructure and CI (added 2026-11-12)

- **Infrastructure as code, and branch previews.** One entry, three parts, put here by the maintainer. (a) A research report
  on infrastructure as code (Terraform and the others) for a reader who knows nothing about Terraform; it should compare the
  options with what the site does today (`deploy.yml` runs wrangler against Cloudflare, `web/wrangler.jsonc`). (b) A
  requirement for it: branch previews, a preview deployment for each branch or pull request. (c) Block the deploy until main's
  CI has passed: today `deploy.yml` deploys on the push to main without waiting for the `ci` and `web` runs. Not checked:
  the release notes of `cloudflare/wrangler-action` (seen in #20) mention "Workers Previews", which needs Wrangler 4.136.3 or
  later, so previews may need no Terraform at all; the report should say. Nothing is written yet.
- **A watchdog for the engine start.** Nothing times out the `starting-worker` state: `machine.ts` has only the Break grace
  timer, and `client.ts` `start()` waits on `mount`, `boot` and `startup` with no limit. A worker that stalls (the
  `?snapshot=0` stall in `docs/prototype1-plan.md`) leaves a visitor on "Getting the engine ready" for good. Open question:
  can the snapshot start, the page's default, stall the same way? The stall was seen only with `?snapshot=0`, and the code
  has no automatic fallback from the snapshot to the normal boot (by grep, not a full read). The words a failed start shows
  are the maintainer's. 2026-11-12.
- **Split `check-snapshot` in CI.** The `memory snapshot` job takes about 8 to 11 minutes, `check-snapshot` being most of
  it. It now runs on a pull request only when the snapshot's inputs change (`web.yml`, `ENGINE`); when it runs, `web ok`
  still waits for it. Not tried: split it into shards with its `--cases` and `--only` options. 2026-11-12, 2026-11-13.
- **More Playwright workers.** The config sets no worker count, so a browsers job runs the default 2 workers; they are busy
  about 97% of the time. The CI speed investigation replayed past runs: 3 workers saves 0 to 3 minutes and 4 workers about 4
  to 5, a guess that assumes 1.3 to 1.5 times slower tests from sharing the runner. More load may make the WebKit navigation
  hang and the memory-heavy Firefox runs worse. Left because the matrix of four projects (#32) paid more with less risk.
  2026-11-12.

## Phone (added 2026-11-12)

- **Zoom on the editor page needs an iPhone check before it comes back.** The editor page's viewport meta turns pinch zoom
  off (`minimum-scale=1, maximum-scale=1, user-scalable=no` in `web/index.html`, set on 2026-11-12 to steady the phone
  keyboard), and whether to turn it back on is the plan's decision 6. All three rounds of the keyboard experiment
  (`docs/phone-keyboard-experiment.md`, #27) ran with zoom off, and `viewport.ts` does nothing while the page is zoomed (at a
  scale other than 1 it counts no keyboard: no area above it, no scroll-back of Safari's pan, no caret reveal), so a tap
  low in the editor while zoomed in may jump as before. If zoom comes back: one more sitting on an iPhone with `?kblog`,
  including taps while zoomed in. Nothing to do while zoom stays off. 2026-11-12.

## Command line, log and files (decided in the post-merge review, 2026-11-13)

- **A multi-line command line.** Shift+Enter would start a new line, so a block or a `///` command could be typed or pasted
  and run as one; today such a paste stops with a toast that points to the editor (plan, step 4 A 5 and B 3). The
  maintainer: "making it expand for multiline inputs should be considered, but not at this time. priority is just making
  this single line one reliable with sensible defaults." 2026-11-13.
- **Two commands on one line in `#delimit ;` mode (step 4's C 11).** Both are echoed as the whole line twice, and the second
  echo can be matched to a later identical line, which puts a graph's link in the wrong place. Left as rare. 2026-11-13.
- **"Restore the sample" and uploads write outside the file-change turn (step 5's C 6).** A Save in progress of the same
  file, with the restore, or with an upload that replaces an open file (`files/actions.ts` `fileTurn` covers rename and
  delete only): the store's writes run in the order they began, so a Save that begins during the write ends after the
  `reload`, and the store holds the Save's text while the tab shows the sample or the upload with no unsaved dot. A window
  of milliseconds, read from the code and not tested. To be looked at in the step 6 audit. 2026-11-13.
- **A "(deleted)" mark on a tab whose file a run deleted.** The tab stays, as in other editors, and Save writes the file again
  (step 4's C 7, kept); a mark would tell the visitor the file is gone. 2026-11-13.
- **A close button (×) on each row of the phone's file dropdown.** The desktop tab has one; on the phone the dropdown has
  "Close <file>" for the open file only. A control inside a menu item needs focus logic the menu does not have. 2026-11-13.

## Engine memory (added 2026-11-13)

- **The engine unloads itself after a long idle time or while the visitor is away.** After a long period of inactivity, or
  while the page is hidden (a background tab), the engine would be ended to give its memory back: a browser returns a
  WebAssembly memory only when the worker ends. Open: how long to wait; what is kept (the files are in storage; the data,
  macros and results are lost, as after a restart); and how the page says so (a banner, the status bar, what the Run
  button then offers). 2026-11-13.
