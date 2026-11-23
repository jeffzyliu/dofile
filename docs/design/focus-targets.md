# Focus targets: the registry, the modal trap and the roving keys

Design note for S6 of the web audit (`docs/web-audit-plan.md`, section 6, "The S6 note", and S6's row in phase 2's
table). It changes no code. **Status: proposed 2026-11-23, for the maintainer's approval.** Read from the code at
856e5b4. It names targets, functions and rules, not lines: S3 and S5 move code that registers targets before S6 starts,
and S6's builder checks this note against the code first and stops if what it relies on moved. Paths are under
`web/src/app/` unless they start with `web/` or `docs/`; "(new)" marks a name that does not exist yet. Where the focus
goes today, rule by rule, is `docs/web-page-flows.md`, section 1 ("rule N" below); this note does not change those
rules, only who holds the handles.

## In short

1. **Three tools, one job each.** A focus move between modules goes through the registry; a move inside one widget
   (a tablist, the tree, a menu, the variables table) through the roving-key hook; a move into, inside and out of a
   modal through the modal trap. A move that stays inside one component (the command line's tap, Find's close) stays
   where it is.
2. **The registry** (`ui/focus-targets.ts`, new) holds named targets. A component registers a getter for its element
   from a layout effect and unregisters in the cleanup. Callers ask by name, at once (`focusNow`) or from the target's
   next render (`ask`). No label or class query finds a target any more.
3. **A target that is gone moves nothing** and the caller's fallback runs; the focus never goes to `<body>` (section 4).

**The maintainer's choices** (today's behaviour, then the cost of each option):
- a. The registry as above, its names a closed union in one file. Today: each target is an export of its view
  (`focusTree`, `focusAfterClose`, `openFind`, `filesToggle`, `fullOpener`) or a label or class query (section 1).
  Cost: a target is found by name at run time, not by an import, so the compiler checks the name (the union) but not
  that a component registers it; a Node test does. The other option, S6's first reading: keep the exported handles and
  give each an owner function; it keeps the imports between views and the label queries of `focusStable` and
  `Editor`. Recommended: the registry.
- b. One waiting request at a time (`focusRequest`, new): a newer request replaces an older one, whatever its target.
  Today each target has its own signal, so two can wait together. Cost: a flow that needs two would lose the older one.
  From the code (section 4) the only request that waits past a render is a tree row's, and a later request moves the
  focus where that row's `from` would refuse it anyway, so nothing is lost today. The other option, one signal per
  target, keeps today's seven signals. Recommended: one.
- c. The full-size view moves onto the trap's hand-back. Today its cleanup focuses its opener at once, whatever has the
  focus, and an opener that has gone leaves the focus on `<body>`. With the trap: the hand-back is a microtask later,
  takes no focus that something else placed, and a gone opener gives the focus to `focusStable` (the gain). Cost: one
  e2e check of the hand-back's new timing (`web/e2e/output.spec.ts` already waits for the focus on "Open full size").
  The other option: `FullSize` keeps its own hand-back and uses the trap for Tab and Esc only. Recommended: the trap.
- d. The variables table gets the Alt/Ctrl/Cmd guard of the other roving widgets. Today Alt+Up and Alt+Down move between
  names there. Cost: those keys go back to the browser, as they do in the tree, the tablists and the menus. The other
  option: `rove` takes the guard as an option and the table keeps today's keys. Recommended: the guard.

## 1. The handles the registry replaces (today)

| Handle | Where | Who uses it |
|---|---|---|
| `editorCommands.focus` | `editor/commands.ts` (default: a `[data-editor]` query), replaced at mount by `editor/Editor.tsx` `focus`, which for a `.dta` tab queries `[role="tablist"][aria-label="Open files"]`'s selected tab and `.editor-pane .dta-view button` | `focusStable`, `EditorTabs` |
| `focusStable` | `ui/focus-targets.ts`: `editorCommands.focus()`, then the first shown `button[aria-label="More actions"]` | `ui/Dialog.tsx` hand-back, `useFocusOnLeave` (banners, `DismissibleBanner`), `DeclinedBanner` |
| `editorAsked` | `editor/commands.ts`: `{}` (focus) or `{ path, line }` (Go to line), taken by `Editor`'s layout effect | `engine.ts` (effect `close-dialog` with `focusEditor`), `goToLine` |
| `focusWanted`, `focusRow`, `focusTree`, `rove`, `treeShown` | `files/tree-state.ts`, taken by `useRovingFocus` (`files/TreeRow.tsx`) and `FilesHead` (`files/FilesPane.tsx`) | `App.tsx` `foldFiles`, `files/dialogs.tsx` (Delete), `EditorTabs`, `endDraft`; the test hook's `focusWanted` key (`web/src/main.tsx`, read by `web/e2e/files.spec.ts`) |
| `focusAfterClose`, `closeAsked`, `tabAsked` | `files/EditorTabs.tsx` | `files/dialogs.tsx` (close-tab), Delete on a tab |
| `openFind`, `findAsked`, `findReturn` | `log/find.ts`, taken by `FindBar` (`log/LogView.tsx`) | `log/LogActions.tsx`: the Log head's Find (passes its button), `logMenuItems` (passes `null`) |
| `filesToggle`, `foldFiles`, `onFilesKey` | `App.tsx` (a module `let` holding the Files button) | the Files button, Esc in the folded list |
| `fullOpener` | `output/view.ts`, set by `output/GraphTab.tsx`, read by `output/FullSize.tsx` | the full-size view's opener (Safari focuses no pressed button) |
| `leaving` | `ui/Dialog.tsx` (module `let`) | a dialog that follows another (rule 4) |
| the hooks and predicates | `ui/focus-hooks.ts` (`useFocusRequest`, `useFocusOnMount`, `useFocusOnLeave`, `useFocusTarget`: each takes `{ get?: Get<T> }` from `ui/element.ts` and returns the ref to attach); `ui/focus-targets.ts` (`fromNothing`, `fromAnywhere`, `register`, `ask`, `focusNow`, `focusStable`) | every taker above; banners; `RenameField` |

Not handles, and they stay: `log/CommandLine.tsx`'s `onTouchEnd` and the Run button's refocus, `output/clip.ts`
`fallbackCopy`, `FindBar`'s close falling back to the log `<pre>`, `ui/Menu.tsx`'s `restore` and `MenuEntry`, and
`output/view.ts` `focusVar` (the Data tab's roving stop, not a request).

## 2. The targets

| Name (new) | The element | Registered by, when | Asked by |
|---|---|---|---|
| `editor` | CodeMirror's content when a text tab is shown; the empty view when no tab is open; with a `.dta` tab active, the first shown of `open-file-tab` and `dta-load` | `Editor`, a getter, from mount to unmount | `focusStable`, `EditorTabs` after a close, the engine's `focusEditor` |
| `open-file-tab` | the selected tab of "Open files" | the selected `FileTab` | `editor`'s getter |
| `dta-load` | the first enabled button of a `.dta` tab's view (Load) | `output/DtaView.tsx` | `editor`'s getter |
| `more-actions` | the "More actions" button that is shown | both `MenuButton`s of `App.tsx` (desktop, phone): one name, several entries, the first shown wins | `focusStable` |
| `tree` (key: a path, or none for the row in the tab order) | a tree row; with no rows, `FilesHead`'s "File actions" | `TreeRow`; `FilesHead` while the list is empty | `focusRow`, `focusTree` |
| `find-field` | Find's field | `FindBar` while Find is open | `openFind` |
| `files-toggle` | the Files button (700 to 1199 px) | `FilesToggle` | `foldFiles` |

So `editorCommands.focus` goes (S0, `docs/design/workspace.md` section 5, already says S6 replaces it), `focusStable`
becomes `focusNow("editor") || focusNow("more-actions")`, and `editorAsked` keeps only Go to line's `{ path, line }`.

## 3. The registry and `useFocusRequest`

- `register(name, { get, key?, focus? })` (new) returns its unregister. `get` returns the element or `null`, so one entry
  follows a ref that changes (the editor's two elements).
- `focusNow(name, key?)` (new): synchronous; focuses the first entry whose element is in the page and shown
  (`getClientRects().length > 0`) and returns whether the focus is now on it. `focusStable` needs that answer at once
  (rule 2), which is why `editorCommands.focus` had to focus synchronously.
- `ask(name, { key?, from })` (new) sets the one waiting request (`focusRequest`, choice b); `cancel(name)` (new) ends
  it when it is for `name` (`rove` on another row, `startRename`).
- `useFocusTarget(name, { get?, key?, focus? })` (new, `ui/focus-hooks.ts`) does both halves in the component that draws the
  target: it registers in a layout effect, and in a layout effect of the render that follows `ask` it takes a matching
  request on `useFocusRequest`'s terms: the request ends there, taken or not, and the focus moves only when `from`
  allows (rule 7, unchanged, with the same `from` per target). `useFocusRequest` stays as the half that takes, used by
  `useFocusTarget`; its `get` is the optional getter of the shared contract (`web/STYLE.md`, "UI helpers"): it receives the hook's own
  element, and without it the hook acts on that element. Every one of these hooks returns the ref to attach, and
  `useFocusRequest`, `useFocusOnMount` and `useFocusOnLeave` take `{ get? }` the same way (`useFocusRequest` also
  `{ asked, end, from? }`). `useFocusOnLeave` and `focusStable` live in `ui/` (`ui/focus-hooks.ts`, `ui/focus-targets.ts`), so
  `ui/` imports nothing from `states/`. `useModalTrap` (section 5) takes `{ first, onEscape?, onKey?, get? }` and returns its root's ref.
- The test hook keeps its `focusWanted` key, as a computed: the waiting request when it is for `tree`, else `null`
  (same values, so no e2e read changes; plan rule 9 applies only if S6 changes what it means).

## 4. A request whose target is gone

- `focusNow` for a name with no entry, a getter that returns `null`, an element that has left the page or is not shown:
  nothing moves, it returns `false`, and the caller's fallback runs (`focusStable`: `editor`, then `more-actions`).
  A phone on another view makes `editor` "not shown", as today (rule 3).
- `ask` for a target: every taker is mounted while its target could be asked for, shown or not (`Editor`, whose slot is
  hidden, not unmounted; `EditorTabs` and each `FileTab`; `FindBar` inside `LogView`, which stays mounted under a
  hidden panel; `FilesHead`; and the tree's rows in a hidden or folded pane, since `App.tsx`'s `Pane` keeps its
  children under `hidden`). So a request is taken in the next render; a hidden target ends it with no move
  (`focus()` on an element under `display: none` does nothing): a tree request while the tree is hidden on a phone is
  lost, not late. The one request that waits is the tree's for a row not drawn yet: `focusRow(to)` after a rename or
  a draft until the list is read again, or a row still being renamed. It lands only on a focus at `<body>` or in the
  tree (its `from`), and `rove` and `startRename` cancel it. Delete asks only after the list is read again
  (`files/dialogs.tsx` `DeleteDialog`). A request ends when taken (moved or not), replaced, or cancelled; it has no
  time limit. The roving hook's own requests (`Tablist`'s `asked`, `tabAsked`) stay out of `focusRequest`.
- Openers are not targets. The trap gives the focus back to its opener if it is still in the page, else `focusStable`;
  Find falls back to the log; a menu's `restore` that has gone moves nothing (as today).
- No focus move from a timer (`web/biome/architecture.grit`); the registry adds none.

## 5. The modal trap

`useModalTrap` (new, `ui/`) does what `ui/Dialog.tsx` and `output/FullSize.tsx` each do today. It takes the opener:
the opener the caller passes, if it is still in the page (`FullSize`: `fullOpener`, since Safari focuses no pressed
button); else the focused element, not `<body>`; else `leaving` (`Dialog`). It blurs the opener before `showModal()`
(a native `<dialog>` only, as today). It focuses the first target the caller names: `FullSize` its root (so a Space
that opened the view cannot press Close, the first button); `Dialog` `[data-autofocus]`, else the first enabled
button, link or input. On unmount it hands the focus back in a microtask, only when it was left on nothing (rule 1), to
the opener or `focusStable`. For a modal that is not a native `<dialog>` it also keeps Tab inside (the shown, enabled
buttons), takes Esc, and yields the keys while a `dialog[open]` is over it. `Dialog` keeps `showModal()` (the browser
keeps Tab inside); `FullSize` stays a fixed overlay (the toast must show over it). This is not one component for both.
The menu is not a modal and keeps its `restore`. No e2e checks that the full-size view's first focus is the view and
not Close (`web/e2e/output.spec.ts` checks only that the focus is inside it): S6 adds that check before the move.

## 6. The roving-key hook

One pure function, `rove(key, at, count, { axis, wrap })` (new, `ui/keys.ts`): the next place, or `null` for a key it
leaves alone (any key with Alt, Ctrl or Cmd: Alt+Left is Back). The hook on top that keeps the moved-to item's
request and lets the item take it from its render was not built: `Tablist` (`asked`) and `EditorTabs` (`tabAsked`) each
keep that request with `useFocusRequest`. Each widget keeps its own extra keys.

| Widget | Arrows | Ends | Kept by the widget |
|---|---|---|---|
| `ui/Tablist.tsx` | both axes | wrap | |
| `files/EditorTabs.tsx` | Left, Right | wrap | Delete closes |
| `files/TreeRow.tsx` `TreeRow` | Up, Down | stop | Left and Right fold or go to the parent; Enter, Space |
| `ui/Menu.tsx` | Up, Down, over enabled items only | wrap | Esc, Tab, `keepOpen` |
| `output/VarTable.tsx` | Up, Down | stop | focuses at once, no request; gains the guard (choice d) |

## 7. Tests

Today no Node test covers the focus (`docs/web-page-flows.md`, section 1, "Tests that hold this", which lists the e2e
tests). Also pinning it: `web/e2e/output.spec.ts` "the Graph, Data and Results tabs and a .dta tab, after a run through
the hook" (the full-size view's focus in and back, the variables table's arrows); `web/e2e/files.spec.ts` "arrow, Home,
End and Delete keys with Alt, Ctrl or Cmd are left to the browser …", "an item that turns enabled while a menu is open
does not move the focus", the two "a renamed row drawn after the visitor clicked …" tests and "the row's ⋯: …";
`web/e2e/shell.spec.ts` "first visit: …" (Download focused); `web/e2e/editor.spec.ts` "the phone's command line: …" and
"while the engine starts, a command is refused …". With no e2e net (the R3 record, quoted by the lane survey, not
checked): the focus of the storage, store-failed and download-failed banners and B1's re-ask dialog; S6 adds e2e for
them before it moves their focus.

Node tests S6 adds (no DOM library in `web/`: fake elements with `focus()`, `getClientRects()`, `isConnected` and an
`ownerDocument.activeElement`): `register` and unregister; `focusNow` false for no entry, `null`, gone and hidden, and
the first shown of several; `ask` waits for a later registration, ends taken or not, is replaced and cancelled, and
obeys `from`; `focusStable`'s order and never `<body>`; the `editor` getter for a text tab, no tab and a `.dta` tab;
`rove` for each row of section 6's table, modifiers included. The trap needs a DOM: e2e, as S0 says.

## 8. What S3 and S5 must keep, so this note stays true

**S3** (`FilesPane.tsx` split, `files/rename.ts`): `focusWanted` keeps its name and shape (`{ path, anywhere? }`) and
stays exported for the hook (S0 puts it in `files/tree-state.ts` with `focusRow`, `focusTree` and `rove`);
`focusTree(anywhere)` and `treeShown()` stay exported. Each request is still taken in the render of the component
that draws its target (`useRovingFocus` in `TreeRow`, `FilesHead`'s request on its "File actions" `MenuButton` ref),
with today's `from` rules. `RenameField` keeps `useFocusOnMount`, and `startRename` and `startDraft` stay synchronous
(rule 8). The end of a request stays where it is: `rove`, `startRename`, Esc in a draft (`focusTree`), Enter
(`focusRow`, unless another field started). The tree's keys stay in `TreeRow`; S3 writes no roving helper of its own.

**S5** (`CommandLine.tsx` split, the status model, state out of `App.tsx`): `openFind(from)` and its two callers'
arguments; the `MenuButton` labels "More actions", "Log actions" and "File actions" (`focusStable` and the e2e find
them by name until S6); `foldFiles`'s moves stay synchronous in the handler, and `filesToggle` stays one element held
next to them, wherever they move; the command line's `onTouchEnd` and the Run button's refocus stay in the field's
component. No new focus move by label or class query, and none from a timer. `editor/StatusBar.tsx` and `PhoneStrip`
move no focus today (by grep), so the status model has no target to keep.
