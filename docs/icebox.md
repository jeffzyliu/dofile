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
- **The toolbar scrolls sideways at 700 to about 855 px with a 20 px default font size** (plan, step 4 C 22): its compact
  form starts below 56em, so a larger default font leaves a band where neither form fits. Rare, and nothing is lost (the
  toolbar scrolls); a fix needs a third toolbar form. The maintainer: "all recommendations". 2026-11-13.

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
- **The focus system may be replaced as a whole** in a later iteration of the app. Until then the bar for focus code is
  that it reads cleaner and holds fewer references to DOM elements (the maintainer, 2026-11-13, after the focus hooks of
  `ui/focus-hooks.ts`, pull request #45).

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
  `?snapshot=0` stall in `docs/phase2-history.md`, "Prototype 1: the record from 'Where things stand'") leaves a visitor on "Getting the engine ready" for good. Open question:
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
- **The pan guard's known gaps (#48, `viewport.ts`).** After a pinch the guard may judge a move from a stale finger
  position (fixing it needs a `touchend` listener, more raw DOM handling than was approved); a horizontal drag on the
  command line's text when it overflows is cancelled; a long-press drag of the caret where no scroller can follow is
  cancelled by design. Revisit if the iPhone shows a problem. 2026-11-13.

## Command line, log and files (decided in the post-merge review, 2026-11-13)

- **A multi-line command line.** Shift+Enter would start a new line, so a block or a `///` command could be typed or pasted
  and run as one; today such a paste stops with a toast that points to the editor (plan, step 4 A 5 and B 3). The
  maintainer: "making it expand for multiline inputs should be considered, but not at this time. priority is just making
  this single line one reliable with sensible defaults." 2026-11-13.
- **Two commands on one line in `#delimit ;` mode (step 4's C 11).** Both are echoed as the whole line twice, and the second
  echo can be matched to a later identical line, which puts a graph's link in the wrong place. Left as rare. 2026-11-13.
- **Rethink how files are kept in step between the store, the open tabs and runs: one redesign from ground rules, not
  one-off fixes.** The maintainer: "move all of the file save decisions to the icebox as one issue to rethink the file save
  synchronization flow. it should not happen as a bunch of one-off fixes but it should be redesigned according to some
  ground rules. but we do not have time for that now." The cases to cover (plan, steps 4 and 5):
  - step 4's B 7: a run that writes binary (not UTF-8) over an open text tab keeps the tab's text, marks it unsaved and
    shows the `run-changed` banner in other words, with no "Reload from the run";
  - step 4's C 7: a file a run deleted keeps its tab, and Save writes it again (kept, as other editors do; see the
    "(deleted)" mark below);
  - step 4's C 14: a clash over an open file with unsaved edits is asked again after "Do the same" with Replace;
  - step 5's C 6 and the uploads: "Restore the sample" and an upload that replaces an open file write outside the
    file-change turn (`files/actions.ts` `fileTurn` covers rename and delete only), so a Save that begins during the
    write ends after the `reload`: the store holds the Save's text while the tab shows the sample or the upload with no
    unsaved dot (a window of milliseconds, read from the code, not tested);
  - once Restore is an upload (step 5's B 4): a sample file missing from the store but open in a clean tab keeps its old
    text after Restore (the old Restore reloaded it). 2026-11-13.
- **A "(deleted)" mark on a tab whose file a run deleted.** The tab stays, as in other editors, and Save writes the file again
  (step 4's C 7, kept); a mark would tell the visitor the file is gone. 2026-11-13.
- **A close button (×) on each row of the phone's file dropdown.** The desktop tab has one; on the phone the dropdown has
  "Close <file>" for the open file only. A control inside a menu item needs focus logic the menu does not have. 2026-11-13.
- **The New draft row's small gaps (#50).** A draft committed by leaving the field shows only its new row (on a phone the
  tree may be hidden by the view tapped): a toast ("untitled.do made") could say so. The field's label stays "New name for
  untitled.do", naming a file that does not exist yet (the maintainer chose to keep it). If a run writes the offered name
  while the field is open, the field sits on that file's row until the commit (cosmetic). Enter in a second field while
  the first commit is still being written is ignored, a window of a few milliseconds. 2026-11-13.
- **Find and replace in the editor** (step 4's C 9; the editor has no find of its own, and Find searches the log only). The
  maintainer's fix, to build later: "add find and replace window to editor pane, add ctrl/cmd f listeners to both editor and log
  panes, and allow the user to do normal browser find when focused elsewhere". 2026-11-13.

- **Audit drag-and-drop.** The maintainer: "make another icebox entry for auditing drag-and-drop, with these two behaviors
  written down to revisit":
  - step 4's C 15: a drag that began in the page (a graph image, which Chromium and WebKit list as carrying a file) is
    not taken as an upload, a guard kept on partial evidence;
  - step 4's C 16: while a dialog is open, or another tab has the files, a drag of files over the page gives the Files
    pane no outline and the drop uploads nothing, with nothing that says why. 2026-11-13.

- **Pass the page's folder changes and deletes to the engine mid-run (a P2 idea from the step 2 review).** The engine cannot
  see the page's changes during a run (the worker is busy in one synchronous call), so a `save` into a folder the page
  renamed or removed meanwhile succeeds, where desktop Stata would give r(603); today the file is not kept and
  `RunResult.skipped` lists it, and the log says so. The idea: pass the changes through a `SharedArrayBuffer`, checked before
  each command, as Break is. Plan: "Known work found in steps 1 and 2". Moved here by the document pass, 2026-11-13.

## Engine memory (added 2026-11-13)

- **The engine unloads itself after a long idle time or while the visitor is away.** After a long period of inactivity, or
  while the page is hidden (a background tab), the engine would be ended to give its memory back: a browser returns a
  WebAssembly memory only when the worker ends. Open: how long to wait; what is kept (the files are in storage; the data,
  macros and results are lost, as after a restart); and how the page says so (a banner, the status bar, what the Run
  button then offers). 2026-11-13.
- **A run whose first command is `clear all` restarts the engine first** (from "Later UI work" item 9 of
  `docs/prototype1-plan.md`, moved here 2026-11-13; nothing in that work is built before step 6). The restart frees the
  engine's WebAssembly memory, which never shrinks otherwise (the status bar's "Engine memory" only grows until a restart).
  First step: measure how long a restart from the cached snapshot takes; build it only if that is under about 2 s.
  `clear all` anywhere else in a run clears as today. 2026-11-13.
- **`set max_memory`** (approved 2026-11-13, then iceboxed the same day by the maintainer: "icebox the set max_memory task").
  It would lower the engine's heap cap for the session (`set max_memory 500m`), never above the device's default, since raising
  it is how a visitor would crash the tab. The engine has no `max_memory` setting today, so it needs a hook in `browser.py` (or a
  patch) and the cap the worker sets; the loader reads the cap at each grow, so it can probably change while the engine runs
  (not checked). `docs/browser-engine.md`, "The memory cap". 2026-11-13.
- **Fewer copies in `generate`** (2026-11-13, from the post-merge review's section 6; the maintainer: "all recs"). The heap is
  3.5 to 6 times the data because `generate` and `replace` copy a column and wasm memory never shrinks, so a cap holds much
  less data than its size; fewer copies is the lever, and is not done (`docs/browser-engine.md`, "What a cap buys").
- **Memory cap: no fallback for `importCapped`, and the capped normal boot is tested only in Chromium e2e** (the memory cap's
  review, nice-to-have 3; iceboxed 2026-11-13). If the blob import fails there is no fallback, and no other browser's e2e
  runs the capped normal boot.
- **Desktop Firefox crash** (reported by the maintainer 2026-11-12; iceboxed 2026-11-13, to revisit if it happens again).
  Not reproduced (2026-11-13, Playwright's Firefox 159, headless, a 24 GB Mac): four fills of the uncapped 4 GB heap each
  ended in a clean r(909) with the data kept; 40 runs with resets, and 3 to 6 million rows through regress, graphs, sort and
  collapse, did not crash; the `?snapshot=0` e2e test passed 8 of 8. With the heap full the largest Firefox process held about
  4.8 GB, which could crash a machine with little memory (a reading, not seen). If it happens again: the `about:crashes`
  entry, the machine's memory and OS, whether the tab or the whole browser went, and whether `?memcap=1500` avoids it; an
  out-of-memory crash would mean a cap for desktop Firefox too (`engine/memcap.ts` `chooseCap`). 2026-11-13.

## Engine text (added 2026-11-13)

- **Reword the few help lines that read close to Stata's manual** (step 5's C 3). A sampled audit (2026-11-13: about 15 help
  topics and 20 to 30 error messages against 21 public manual entries and 17 online help pages) found no copied prose; the
  matches are functional (syntax, option names, Stata's own error messages). Close: 3 help page titles ("Linear regression",
  "Summary statistics", "Extensions to generate"), 2 more near them, and 2 or 3 one-line option descriptions (`beta`,
  `level`, `noconstant`). A rewording is an engine patch; the maintainer: "no engine patches that are non critical for
  correctness until phase 2(web editor) is done". A full audit of the 156 other help topics is about 3 to 5 hours. 2026-11-13.
