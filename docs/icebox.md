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
- **Alt+Left (the browser's Back on Windows) is swallowed** where the focus is in the file tree (`TreeRow`), a `Tablist`
  (`ui/Tablist.tsx`) or the open-file tabs (`files/EditorTabs.tsx`): their arrow, Home and End handlers do not check the
  modifier keys. The menu (`ui/Menu.tsx`) takes no Left, but its Up, Down, Home and End do not check them either. 2026-11-11.

The rest:
- **The tree's rows say no position.** Its flat rows (`TreeRow`) have `aria-level` but no `aria-setsize` or
  `aria-posinset`, and the tree has no typeahead (a letter moves nowhere). 2026-11-11.
- **Delete in the tree.** After a delete the focus goes to the open file's row, else the first row (`files/dialogs.tsx`
  `refocus`, the tree's `tabbable`), not the deleted row's neighbour; a row has no Delete key (only its menu). 2026-11-11.
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
