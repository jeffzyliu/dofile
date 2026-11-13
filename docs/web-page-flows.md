# Flows of the editor page

**This describes the code as built on branch `prototype1-step4` (pull request #17, 2026-11-11), with what step 5
(`prototype1-step5`, pull request #18) adds to these flows: the editor is served under `/app/`, and the sample's first-visit
seed and "Restore the sample" (`sample.ts`) are events of section 3 (the restore asks through the clash dialog of section 1).** It
is a sibling of [web-engine-data-flow.md](web-engine-data-flow.md), which covers the engine under the page. This
document covers four parts of the editor page that no single file shows: where the focus goes, a run as the views see
it, an open file's state in the editor, and where the log puts graph links and notes. Each spans several modules and
depends on an order of events.

Written from the code. Paths are relative to `web/src/app/` unless they start with `web/` or `engine/` (that is
`web/src/engine/`). The document names files and functions, not line numbers.

**Timing words used below.**

- **Synchronous:** in the same call stack.
- **Signal effect:** an `effect()` from `@preact/signals-core`. It runs synchronously when a signal it read is written.
- **Render:** a component that reads a signal re-renders in a microtask (`@preact/signals` calls `setState`, and Preact
  11 queues renders with `queueMicrotask`). One microtask renders every queued component. A step of the engine's
  machine therefore reaches the views as one render, with all of its writes.
- **Layout effect:** `useLayoutEffect`. It runs in that render, before the next microtask. Its cleanup runs while the
  component's nodes are still in the page.
- **Timer:** `setTimeout(f)` or `setTimeout(f, 0)`. It runs after all microtasks, and after every timer set before it.

---

## 1. Where the focus goes

### The rules

1. **A hand-off moves only a focus left on nothing** (`document.activeElement` is `<body>` or null). The dialog's
   hand-back and `useFocusOnLeave` check this first. So whoever places the focus first wins, and
   the focus moves once.
2. **The fallback is `states/focus.ts` `focusStable()`:** first `editorCommands.focus()`, then, if that moved the focus
   nowhere, the first visible `button[aria-label="More actions"]`. It is never `<body>`.
3. **`editorCommands.focus()`** (`editor/Editor.tsx` `focus`) focuses at once, without changing the active tab or the
   phone's view:
   - a text tab shown: CodeMirror's content (`[data-editor]`);
   - no tab, or a text tab with no editor state yet: the empty view ("No file is open", `[data-editor]` then);
   - a `.dta` tab: its tab in "Open files" when that is visible, else the first enabled button of its view (Load), else
     nothing;
   - the Editor pane hidden (a phone on another view): the code calls `view.focus()` (or the empty view's `focus()`) all
     the same. The browser does not
     focus an element under `display: none`, so the focus does not move, and `focusStable` goes on to "More actions".
4. **A dialog gives the focus back to its opener** (what had the focus when it opened). When the opener has left the
   page, or it had none, the dialog calls `focusStable()`. `<body>` is never an opener. A dialog that opens while
   another one is still handing the focus back takes that one's opener as its own (`ui/Dialog.tsx`, the module variable
   `leaving`).
5. **A view that takes the focus when it appears takes it in a layout effect:** a dialog (`ui/Dialog.tsx`), the
   stopping banner's "Don't reset: wait for it", and the waiting banner itself (`states/banners.tsx`), and the inline
   rename field (`files/FilesPane.tsx`), the last three through `ui/focus-hooks.ts` `useFocusOnMount`. So a hand-off
   that waits for a microtask finds the focus already taken.
6. **After a tab closes** (`files/EditorTabs.tsx` `focusAfterClose` sets `closeAsked`, which `EditorTabs` takes in a
   layout effect of its next render) the focus goes to the selected tab (its `tabAsked` request), else the file tree's
   row in the tab order when the tree is shown (`focusTree`), else `editorCommands.focus()`. When that moves nothing, the
   close-tab dialog's own hand-back follows (its opener, else `focusStable`).
7. **A focus request is taken by the render of the component that draws the target.** The action sets a signal (the
   tree's `focusWanted`, the open-file tabs' `tabAsked` and `closeAsked`, a tablist's own, Find's `findAsked`, the
   editor's `editorAsked`); the target takes it in a layout effect of its own render (`ui/focus-hooks.ts`
   `useFocusRequest`, or a plain layout effect where taking it is more than a focus: Go to line, a closed tab), and the
   request ends there, taken or not. No timer stands in for that render: Preact renders the queued components
   shallowest first, so `App` shows a pane, and the dialog host closes its dialog, before a deeper target takes its
   request. Each says whose focus it may take (`from`): from inside its own list (or the page body, after a close) for
   the tablists, from the page body or the tree for the tree's rows, from anywhere for the Files button's request, Find
   and the editor. The tree's request names a row (`focusRow`) or none (`focusTree`: the row in the tab order, or with
   no rows the head's File actions). It is set once its action has succeeded (a rename, a delete once the list has been
   read again), and it also ends when a new one replaces it, a rename starts, or the visitor focuses or clicks another
   row. A tablist's request is set by a key, never by a click: Safari does not focus a tapped button (`ui/Menu.tsx`
   focuses a `keepOpen` item itself for that reason), so a request from a click on a tab would move the focus there
   where a click alone moves none. The other requests follow an action that may be a click (the Files button, a
   dialog's answer, "Go to line", Find), and so does a rename that a click elsewhere ends: the field's blur ends it and
   `focusRow` asks for the renamed row, which takes the focus where that click left it on the page body (WebKit) and
   not where the click focused something outside the tree.
8. **On an iPhone the keyboard comes up only for a focus made while the tap is handled** (the tap's own microtasks
   count: a signal set in the tap renders, and its layout effect runs, before the tap's dispatch ends; an `await` of
   IndexedDB does not). A field that is to raise the keyboard is drawn in the tap, before anything is written or awaited.
   That is why "New .do file" and "New folder" show their name field at once (a draft row) and write the file or folder
   when the field is left (Enter or blur; Esc writes nothing), and why `startRename` and `startDraft` are synchronous.
   The commit (`endDraft`) then awaits the store, reads the list again (`files.ts` `refresh`) and clears the draft in
   the same tick, so the real row replaces the draft with no frame between, and the tree's row takes the focus
   (`focusRow`) unless another field was started meanwhile (each field has an `id`; a commit that ends after another began
   touches neither the state nor the focus). Nobody can test the keyboard in Playwright: the e2e test makes sure the
   field has the focus within the tap's microtasks.

### Who moves the focus

| Who | When | Timing | Where to |
|---|---|---|---|
| `ui/Dialog.tsx`, opening | it mounts | layout effect | It blurs the opener, then calls `showModal()`. Then `[data-autofocus]`, else the first enabled button, link or input. |
| `ui/Dialog.tsx`, closing | it unmounts | cleanup (blur inside, `close()`), then a microtask, after the render's other layout effects; only a focus on nothing | the opener if it is still in the page, else `focusStable()` |
| `states/focus.ts` `useFocusOnLeave` | a banner unmounts with the focus inside | layout cleanup, then a microtask; only a focus on nothing | `focusStable()` |
| `KeepWaitingButton` (in `StoppingBanner`), `WaitingBanner` (`states/banners.tsx`) | the button appears (1 s after the Break press), the waiting banner mounts | layout effect (`useFocusOnMount`) | "Don't reset: wait for it"; the waiting banner's box (`tabindex=-1`) |
| `DeclinedBanner` (`states/banners.tsx`) | "Start engine" | synchronous, before `eng.ask()` | `focusStable()`, so the prompt takes the editor as its opener |
| `engine.ts`, effect `close-dialog` with `focusEditor` | `started` closes the download dialog, if it is still open (no other cell sets `focusEditor`) | sets `editorAsked` (`{}`) in the step; the Editor takes it in a layout effect of the render that removes the dialog | `editorCommands.focus()` |
| `files/EditorTabs.tsx` `focusAfterClose` | Delete on a tab (no dialog); close-tab's Save or "Don't save" | sets `closeAsked`; `EditorTabs` takes it in a layout effect of its next render | the selected tab (`tabAsked`), else the tree's row (`focusTree`) when the tree is shown, else `editorCommands.focus()` |
| `files/dialogs.tsx` `DeleteDialog` | Delete's store change is done and the list read again (`files.ts` `refresh`) | `focusTree()`, taken by the tree's render; only a focus on nothing or in the tree | the tree's row in the tab order; with no rows, the head's File actions (`FilesHead`) |
| `App.tsx` `foldFiles` | the Files button (700 to 1199 px) opens the list | `focusTree(true)`, taken by the render that shows the pane; from anywhere (the focus is on the button) | the tree's row in the tab order; with no rows, the head's File actions |
| `ui/Menu.tsx` `closeMenu(true)` | Esc, Tab, a picked item (before its `onSelect`) | synchronous | the trigger (`restore`, else `anchor`). A click outside, a resize or the window's blur close it with no focus move. |
| `ui/Menu.tsx` `MenuEntry` | the menu opens and is placed; an arrow, Home or End changes the menu's active item (a position among all its items, disabled ones included, so an item that turns enabled or disabled while it is open does not move the focus) | layout effect, from the item's own render | the active item; the open file's item (`current`) is scrolled into view the same way |
| `files/FilesPane.tsx` `RenameField` | F2, New .do file, New folder: the field mounts. A New's field is a draft (`renaming.draft`): `startDraft` sets it in the tap, with nothing written and no `await` before it (rule 8) | layout effect (`useFocusOnMount`), then the name without its extension selected | the field |
| `files/FilesPane.tsx` `endDraft` | Esc in a draft's field | `focusTree()`, taken by the tree's render; only a focus on nothing or in the tree | the tree's row in the tab order; with no rows, the head's File actions (hidden on a phone, as after Delete) |
| `ui/Tablist.tsx` `Tab`, `files/EditorTabs.tsx` `FileTab` | an arrow, Home or End in the tablist (a click sets no request) | layout effect of the tab's render (`useFocusRequest`); the request ends there | the tab moved to, only while the focus is inside that tablist |
| `files/FilesPane.tsx` `TreeRow` (`useRovingFocus`, on `useFocusRequest`) | `focusRow` (after a rename, a new file or folder is written, the arrow keys) sets the roving path and the signal `focusWanted`; `focusTree` (the Files button, Delete once the list is read again) sets a keyless request, taken by the row in the tab order, else File actions; the row's own render takes it | layout effect; the request ends when its row is drawn, taken or not, and when a new one replaces it, a rename starts, or the visitor focuses or clicks another row | the row, only while the focus is on the page body or inside the tree (the tree's `role`); on WebKit and the iPhone a click elsewhere leaves the focus on the body, so the row may take it (rule 7) |
| `log/LogView.tsx` `FindBar` open | `openFind` sets `findAsked` | layout effect of the bar's render (`useFocusRequest`); once per `openFind`, so the Log drawn again with Find open takes no focus | the field |
| `log/LogView.tsx` `FindBar` close | Esc or Close | synchronous | what opened Find (`openFind`'s `from`, else the focus at that time), if it is visible; else the log `<pre>` |
| `editor/Editor.tsx` `goToLine` | "Go to line N" | sets `editorAsked` (`{ path, line }`) after `openFile`; the Editor takes it in a layout effect of its next render, after the render that shows its pane | CodeMirror, at the line, if that file is shown |

A mouse click on a tab's × that closes a clean tab calls no `focusAfterClose` (`EditorTabs` passes `keyboard: false`).

### A dialog opens and closes

The Reset dialog, opened from the ⋯ menu:

```mermaid
sequenceDiagram
  participant V as Visitor
  participant M as ui/Menu.tsx
  participant S as dialog signal
  participant D as ui/Dialog.tsx
  V->>M: picks Reset in More actions
  M->>M: closeMenu focuses the trigger (synchronous)
  M->>S: onSelect, askReset sets dialog to reset when it asks
  Note over S,D: microtask, the view mounts
  D->>D: layout effect, opener = the trigger, opener.blur(), showModal(), focus Cancel
  V->>D: Cancel
  D->>S: dialog = null
  Note over S,D: microtask, the view unmounts
  D->>D: cleanup, blur inside, close(), leaving = opener, queue microtask T
  Note over D: T runs after the render, so after any layout effect that took the focus
  D->>D: focus on nothing, so opener.focus(), or focusStable() if the opener left the page
```

The opener lets go of the focus before `showModal()`, so the browser keeps no element to give it back to on `close()`.
Only T gives it back, once.

"Restore the sample" (`sample.ts`) is an upload (`upload(items, "sample")`), so its questions are the clash dialog with the
sample's words and follow the clash rules below: "Keep mine" focused, the focus back to the menu's trigger. Once the upload
has ended `analysis.do` is opened, which moves no focus.

### A dialog that follows another (the clash chain)

An upload with two clashes; the visitor presses "Keep mine" on the first. The same chain runs when the download prompt
becomes the progress dialog (`states/DownloadDialog.tsx`: two `<Dialog>`s with different keys), and when the other-tab
dialog replaces any dialog (the host keys each view on the whole `dialog` value).

```mermaid
sequenceDiagram
  participant V as Visitor
  participant C1 as clash 1 view
  participant U as files/actions.ts uploadNow
  participant D as ui/Dialog.tsx
  participant C2 as clash 2 view
  V->>C1: Keep mine
  C1->>U: dialog = null, then answerClash
  Note over C1,D: microtask 1, clash 1 unmounts
  D->>D: cleanup, close(), leaving = opener 1, queue microtask T1
  Note over U: microtask 2, the upload goes on
  U->>U: next clash, no dialog open, dialog = clash 2
  Note over C2,D: microtask 3, clash 2 mounts
  D->>D: layout effect, focus is on body, so opener = leaving = opener 1
  Note over D: T1 runs, leaving is cleared, the focus is in clash 2, nothing moves
  V->>C2: answers
  D->>D: cleanup and microtask T2, opener 1 gets the focus
```

T1 can also run before the upload goes on (after "Replace with uploaded" the upload first awaits `store.write`). If T1 runs before clash 2 opens, it gives the
focus to opener 1, and clash 2 takes opener 1 as the active element. The result is the same.

### A dialog whose opener leaves the page (other-tab over the stopping banner)

```mermaid
sequenceDiagram
  participant O as Other tab
  participant E as engine.ts and the machine
  participant SB as stopping banner
  participant D as other-tab dialog
  participant F as states/focus.ts
  Note over SB: the focus is on Don't reset, taken in its layout effect
  O->>E: lock-lost
  E->>E: one step, engine = other-tab-idle, effects cancel-break-timer, end-worker, block-store, engine-gone, show-dialog, end-run
  Note over SB,D: one microtask renders both
  SB->>F: layout cleanup, the focus is inside, queue a microtask
  D->>D: layout effect, opener = the banner button, or nothing if the banner went first
  D->>D: showModal(), focus on Close editor
  F->>F: microtask, the focus is in the dialog, nothing moves
  Note over D: later, Use dofile in this tab, the take-over, close-dialog with focusEditor false
  D->>D: cleanup microtask, the opener has left the page or there is none
  D->>F: focusStable(), the editor, else More actions
```

Both orders of the two renders end in `focusStable()`: the opener is either the button that has left the page, or
nothing.

### A banner leaves with the focus in it

Stopping, then waiting, then the run ends:

```mermaid
sequenceDiagram
  participant V as Visitor
  participant E as engine.ts
  participant SB as stopping banner
  participant WB as waiting banner
  participant F as states/focus.ts
  V->>E: Don't reset, wait for it (keepWaiting)
  E->>E: engine = waiting
  Note over SB,WB: microtask, LogStateBanners draws WaitingBanner in place of the stopping one
  SB->>F: layout cleanup, the focus is inside, queue a microtask
  WB->>WB: layout effect, the banner box takes the focus
  F->>F: microtask, the focus is on the waiting banner, nothing moves
  Note over E: the run ends, engine = ready
  WB->>F: layout cleanup, the focus is inside, queue a microtask
  F->>F: microtask, the focus is on body, focusStable()
```

Dismiss on a banner that uses `useFocusOnLeave` (reset, storage, download-failed, the failed-start banners, the
editor's save-failed and run-changed, the Files pane's not-text) follows the last two lines, and so does run-changed's
"Reload from the run". With a `.dta` tab active, `editorCommands.focus()` puts the focus on that tab, so `focusStable`
stops there and the focus moves once.

The banners that hold no control (running, memory) do not use it, nor does the declined banner, which calls
`focusStable()` itself before it goes.

### A tab closes from the close-tab dialog

```mermaid
sequenceDiagram
  participant V as Visitor
  participant CT as CloseTabDialog
  participant Ed as editor/Editor.tsx
  participant A as files/actions.ts
  participant ET as files/EditorTabs.tsx
  participant D as ui/Dialog.tsx
  alt Save
    V->>CT: Save
    CT->>Ed: await editorCommands.save(path), the dialog stays open
    Ed-->>CT: true
    CT->>CT: dialog = null
    CT->>A: closeTab(path), tabs and activeTab, then editorCommands.closed
    CT->>ET: focusAfterClose(), closeAsked = true
  else Do not save
    V->>CT: Don't save
    CT->>CT: dialog = null
    CT->>A: closeTab(path)
    CT->>ET: focusAfterClose(), closeAsked = true
  end
  Note over D,ET: one microtask renders both, the dialog host first (shallower)
  D->>D: cleanup, blur inside, close(), queue microtask T
  ET->>ET: layout effect, tabAsked for the selected tab (FileTab takes it in the same loop), or focusTree(), or editorCommands.focus()
  D->>D: T, the focus is not on body, nothing moves
```

The three writes are made synchronously in the click handler, so one render takes them all and the request is taken
before T runs. When Save resolves false
(the store refused), the dialog closes, the tab stays and nothing calls `focusAfterClose`. T then gives the focus back
to the opener (the tab).

### Phone variants

On a phone, one view shows at a time, so the Editor pane is often hidden.

```mermaid
sequenceDiagram
  participant B as a banner on the Log view
  participant F as focusStable
  participant Ed as editorCommands.focus
  participant M as More actions in the top bar
  B->>F: microtask after it leaves, the focus is on body
  F->>Ed: focus()
  Ed-->>F: view.focus() on a hidden pane, the browser moves nothing
  F->>M: focus the visible More actions button
```

| Case | Desktop | Phone |
|---|---|---|
| A banner leaves, or a dialog's opener has left | the editor (or the `.dta` tab, or Load) | the editor (or a `.dta` tab's Load) on the Editor view; "More actions" on any other view |
| Close-tab's Save or "Don't save" | the selected tab in "Open files" | the editor: "Open files" is not shown, and neither is the tree on the Editor view |
| The engine's dialog closes itself (`started`) | the editor | the editor on the Editor view. On any other view nothing moves, and the dialog's hand-back gives the focus to its opener. Nothing runs then: with no engine the page offers only "Start engine", which opened the prompt, so the focus is not taken from the Log view by a run. |
| A dialog opened from a menu (Reset, Delete all, Clear log) | the menu's trigger: ⋯ for Reset, "File actions" for Delete all, "Log actions" for Clear log | the ⋯ trigger for Reset; the strip's "Files ⋯" ("File actions") for Delete all; the strip's "Log ⋯" ("Log actions") for Clear log |
| The Clear log dialog opened from the Log head's "Clear…" | the button, back on Cancel and Esc | after "Clear log" the button is disabled (nothing is left to clear) and cannot take the focus, so `ui/Dialog.tsx` hands it to `focusStable()`: the editor, or "More actions" |
| Find opened from the phone strip's "Log ⋯" | (desktop: the Log head's Find button) | `openFind(null)` takes the focused element, the "Log ⋯" button that `closeMenu` just focused |
| A tap on the command line while it does not have the focus | the browser's own focus | `log/CommandLine.tsx` takes the tap (`touchend`) and focuses the field itself with `preventScroll`, the caret at the end: the browser's focus would scroll the page up to the field, which iOS does before the page can stop it (`app/viewport.ts`, `docs/phone-keyboard-experiment.md`) |

### Tests that hold this

- `web/e2e/keyboard.spec.ts`: "a tap on the phone's command line focuses it without scrolling the page, the caret at the end"
- `web/e2e/states.spec.ts`:
  - "a banner that goes with the focus in it hands the focus on: the editor, or More actions when it is hidden"
  - "the editor's and the Files pane's banners hand the focus on too: save-failed, run-changed (Dismiss, Reload from the
    run), not-text"
  - "a dialog whose opener has left the page gives the focus to the editor, or More actions, not to the page"
  - "with a .dta tab active, a banner that goes with the focus hands it to that tab, in one move"
  - "from the stopping banner to the waiting banner the focus goes straight across, never through the editor"
  - "the banners above the log: running, stopping (focus on Don't reset), waiting (takes the focus)"
- `web/e2e/files.spec.ts`:
  - "tabs: … the focus goes to a tab or the tree, never the page, in one move after Save and Don't save"
  - "the row menu (Shift+F10, right click, the ⋯): Delete asks, …" (the focus after Delete, on the tree's row)
  - "New .do file and New folder: the name field has the focus within the tap's microtasks, from the link and from the
    menu" (rule 8), and the tests after it: Esc (the focus back on the tree's row), Enter, leaving the field, a name in
    use, a second New while the first is written
  - "a clash dialog that follows another (Keep mine, then the next clash at once): the focus goes back to what had it
    before the first, not the page"
- `web/e2e/editor.spec.ts`:
  - "a .dta tab: Save is off, and when the engine's dialog closes by itself the focus goes to that tab"
  - "Find in the log: … Esc gives the focus back"
  - "the Output tabs by keyboard: each key moves the focus to the tab it selects; with Find open, the Log tab drawn again
    leaves the focus on the tab, not in Find's field"
- `web/e2e/shell.spec.ts`:
  - "the layout: … the ⋯ menu works by keyboard"
  - "the folded file list: … Esc folds it and gives the focus back"
  - "the folded file list with no files: opened by keyboard, the focus goes to the head's File actions, once"

No Node test covers the focus. The rules hold only in a browser.

### If you change this

- **A view that takes the focus when it appears must do it in a layout effect.** In a `useEffect` (after paint), the
  hand-off's microtask finds `<body>` first and sends the focus through the editor.
- **`useFocusOnLeave`'s cleanup must stay a layout cleanup.** A `useEffect` cleanup runs after the nodes are removed, so
  `el.contains(activeElement)` is never true and nothing is handed on.
- **`editorCommands.focus()` must focus synchronously.** `focusStable` reads `activeElement` right after it. A `.dta`
  tab's own target must win in that call, or the focus moves twice (the e2e test records every `focusin`).
- **An answer that places the focus sets its request in the same turn as `dialog = null`.** The render that closes
  the dialog then takes the request before the dialog's microtask hand-back. That is why the close-tab dialog stays
  open while Save writes: after an `await`, the dialog would give the focus to the opener first, and then the close
  would move it again.
- **No timer stands in for a render.** A request is a signal its target takes in its own render; a target drawn later
  than the action (Delete's rows, once the list is read again) gets its request when that is done (Delete awaits a
  fresh list), not after a guessed delay.
- **Keep the opener's `blur()` before `showModal()`, and the `leaving` hand-over.** Without the first, WebKit gives the
  focus back on `close()` before an answer can place it. Without the second, a dialog that follows another takes
  `<body>` as its opener.

---

## 2. A run, seen from the views

### Who decides what

- `engine/machine.ts` decides whether a run is taken:
  - `ready`: sent at once (effect `send-run`);
  - every other state has no `run` cell, so the event is not valid and changes nothing. That includes the states with
    no engine: a run opens no prompt there, and no state holds a run's code or a "for a run" mark, so nothing runs when
    the engine becomes ready (`started` always leads to `ready`). With no engine the page offers one action, "Start
    engine" (next section). (Until 2026-11-12 the machine held the run in `none` and `declined`, sent it on `started`
    and dropped it with an effect when the start did not happen; the maintainer removed that, and then the prompt a
    run opened: `docs/prototype1-plan.md`, Post-merge review.)
  - Every exit from `running`, `breaking` or `waiting` has one `end-run`, as its last effect: `END` (`run-ended`,
    `run-failed`), `RESET` (`reset`, `crashed`, `break-timeout`, or Break with no `SharedArrayBuffer`) and `LOST`.
- `engine.ts` `run(code, head)` dispatches the event and answers whether the run started (true) or was refused, from
  the step. It throws while a step is in progress (`stepping`). A step writes the `engine` signal before it performs its effects
  (`apply`).
- `run.ts` turns that into a `Requested`, `{how, done}`: `done` is `current.promise` for a started run (`began()`, which
  the effect `send-run` called inside the step, made it), and `Promise.resolve(null)` for a refused one.
  `runCode` returns `done`; `requestRun` (the editor) and `runCommand` return the whole `Requested`.
- `runCommand(text)` adds `kind: "command"`, `fresh_locals: false`, and `history` when it started.

### With no engine: "Start engine"

With no engine, nothing on the page offers to run, and one action is offered: starting the engine. `app/start.ts` is
the one statement of it: `startOffer(state)` says what "Start engine" does in a state, or null when the state is not
"no engine"; `startEngine()` does it (the toolbar's button, the command line's button and Ctrl/Cmd+Enter all call it);
`noEngine()` is `startOffer() !== null`. It runs nothing, and nothing runs when the engine becomes ready.

| State | `startOffer` | The toolbar's Run | A press, or Ctrl/Cmd+Enter | The command line |
|---|---|---|---|---|
| `checking-lock`, `checking-cache` (the page load) | null | "Run", off | the button and Ctrl/Cmd+Enter: toast "The engine is starting. Try again when it is ready." | on; "Run command", off; Enter and the off button: the same toast, and the text stays |
| `none` (only `?test=manual`), `declined` | `prompt` | "Start engine" | `ask`: the download prompt (`asking`) | off, hint "Start the engine to run code"; "Start engine" |
| `asking` | `prompt` | "Start engine" (under the blocking prompt) | `ask`: the prompt again, should another dialog have taken its place | the same |
| `downloading`, `starting-list`, `starting-worker` | null | "Starting…", off | the "starting" toast | on; "Run command", off; Enter and the off button: the "starting" toast, and the text stays |
| `ready` | null | "Run" | a run | on; "Run command" |
| `running`, `breaking`, `waiting` | null | "Run", off | the button: nothing (a second Enter on a focused Run must stay silent). Ctrl/Cmd+Enter: toast "Run is not available until the current run ends" | on; "Run command", off; Enter and the off button: that toast, and the text stays |
| `failed`, reason `download`, `memory` or `unknown` (the banner has "Try again") | `retry` | "Start engine" | `start`: a new try, as the banner's "Try again" | off, hint "Start the engine to run code"; "Start engine" |
| `failed`, reason `updated` or `no-wasm` (the banner says to reload, or which browsers work) | `off` | "Not started", off | toast "Run is not available: the engine isn't running in this tab"; no event reaches the machine | off, hint "The engine isn't running"; "Start engine", off: a press says the hint in a toast |
| `failed-twice` | `off` | "Not started", off | the same | the same |
| `other-tab-idle` | `take-over` | "Start engine" (hidden with the other run controls, and under the blocking dialog) | `ask`: the take-over dialog again (the state stays; no lock is taken, nothing starts). Only its "Use dofile in this tab" takes over | off, hint "Start the engine to run code"; "Start engine" |
| `other-tab-taking` | `off` | "Start engine", off (hidden) | nothing started; the "isn't running in this tab" toast | off, hint "The engine isn't running"; "Start engine", off |

"Off" in this table is never the `disabled` attribute. The toolbar's Run and the command line's button are
`aria-disabled` with `.off`; the command line's field is `aria-disabled` and read-only. All stay focusable.

A button that keeps the focus through "Start engine", "Starting…" and "Run" (the toolbar's Run, the phone's Run and Break
pill, the command line's three buttons: one element each) ignores a held Enter's repeats (`ui/keys.ts`
`ignoreHeldEnter`), so a key held down on "Start engine" presses it once: it starts nothing twice, toasts once, and
runs nothing when the engine is ready. A hint's `help x` link has the same rule: held during a run or a start it toasts
once, and held in `ready` it runs `help x` once.

- **Why not `disabled`: the focus.** These states change under the visitor's hands: a start fails while a command is
  being typed, and a press of "Start engine" after a failed start turns that very button into "Starting…" (the
  toolbar) or into the off "Run command" (the command line, the same element). A `disabled` element that has the focus
  loses it to `<body>`. `aria-disabled` keeps the focus where it was, which is the pattern `RunControls.tsx` already
  used for `running`; handing the focus on (as a banner that leaves does) would instead take it out of the field the
  visitor is typing in, and it would not come back when the engine does. The field's text is never changed.
- **An off control that is pressed is not silent**, except Run while a run is on: Enter in the field with text, and a
  press of the off "Run command" or of the off Run, show the toast Ctrl/Cmd+Enter shows in that state
  (`editor/words.ts` `refusedRunWords`); Enter in the off field, and a press of the off "Start engine", show the
  field's hint. So a second click at the spot where "Start engine" was is answered: "The engine is starting. Try again
  when it is ready."
- **A returning visitor whose browser has the engine** never sees "Start engine": the page load shows "Run", disabled,
  then `cache-checked` starts the engine by itself ("Starting…", off), then "Run". A first visit shows "Run",
  off, for the moment of the page load, then the prompt, with "Start engine" under it.
- **The toolbar does not move.** "Start engine" is one of the labels the Run button holds in its one cell (`ui/Icon.tsx`
  `Labels`), so the button is as wide with "Run" as with "Start engine" (`e2e/shell.spec.ts`, "the toolbar does not
  move"). The command line's button reserves no width: it is "Run command" (on a phone the 44 px icon button) with an
  engine and "Start engine", in words on a phone too, without one; the field takes what is left.
- **Run selection** is disabled with no engine (the phone's one button stays "Start engine" with a selection).
- **The command line** is off with no engine. That never changes its text: a typed draft stays, greyed, and
  is usable when the engine is back. The hint is the placeholder, so it shows only while the field is empty (on a phone it is set in the UI font,
  smaller, so it shows whole beside the wider button). Hint and
  draft are the muted color at full opacity on `--surface-2` (the text contrast, 4.5, in both themes; an e2e test
  measures it).
- **A paste** into the command line is decided before anything changes (`log/pasterun.ts` `pastePlan`). With no engine
  it is an ordinary paste, whatever it holds (the field is read-only then, so this guards the instant before it is
  drawn so). With an engine that is there or on its way but not `ready`, a paste of lines is refused whole (the table
  under "Three pasted lines").
- **Load, Import and the log's `help x` links** are off with no engine: `aria-disabled` and `.off` (the take-over
  button's pattern), still focusable. A press reaches no machine and opens no prompt; a toast says why, by the offer
  (`start.ts` `startFirst`): where "Start engine" can start it, "Start the engine to load wages.dta", "Start the engine
  to import survey.csv", "Start the engine to see help regress"; where nothing can start it from the page (`off`), "The
  engine isn't running: can't load wages.dta" (and "can't import survey.csv", "can't see help regress").
- **A held Ctrl/Cmd+Enter acts once.** The key works anywhere on the page (one window listener in `Editor.tsx`; not with a dialog open, and not in another text field, which keeps it) and ignores the key's repeats, and a dialog ignores a repeated Enter
  (`ui/Dialog.tsx`), so the repeats do not press the prompt's "Download", which has the focus once the prompt is open.

### Where a run starts

| Control | Calls | When it can be pressed |
|---|---|---|
| Run (`editor/RunControls.tsx`) | `editorCommands.runFile()`: the active text tab's whole text, `kind: "file"`, fresh locals; with no text tab, the toast "No file is open to run" | enabled in `ready`; off in every other state with an engine or one on its way: `aria-disabled`, never `disabled`, so a focused Run keeps the focus and a second Enter cannot reach Break. With no engine it is "Start engine" or "Not started" (the table above) and runs nothing. |
| Run selection | `runSelection()`: the selected whole lines, `kind: "selection"`, locals kept | enabled in `ready` with a selection; `disabled` in every other state, `running` too (not `aria-disabled`) |
| Ctrl/Cmd+Enter (anywhere on the page) | `runEither()`: with no engine `startEngine()`; else Run selection with a selection, else Run; held, it acts once | in any state: with no engine it does what "Start engine" does (the table above); in `ready` it runs; in the other states the run is refused (`run.ts` `requestRun`), and a toast says why by the state (`editor/words.ts` `refusedRunWords`) |
| Break | `running`: `breakRun()` ("Break", or "Break (reset)" with no cross-origin isolation); `waiting`: "Reset now", `eng.reset()` with no question | disabled in `breaking` ("Stopping…") and when no run is on |
| The phone's pill | replaces the phone's Run in `running`, `breaking` and `waiting`; does what Break does, then sets `phoneTab` to `"log"` | a tap within 600 ms of the run's `t0` is ignored, so a double tap on Run does not break the run |
| "Run the file again" (the reset banner) | `editorCommands.runFile(path)` for the file whose run the reset cut (`rerunPath`), then the banner is dismissed | drawn only for a Break or a crash that cut a file run (not after a Reset the visitor asked for); enabled in `ready` with that file open as a text tab |
| The command line | `runCommand(text)` | in `ready` it runs. With an engine that is not ready, or one on its way, the field is on and the command is refused with a toast (the button is off). Off with no engine |
| A hint's `help x` link (`log/LogView.tsx`) | `runCommand(text)` | in `ready` the machine accepts it. While a run is on or a start is on its way, the machine refuses it and a toast says why (`editor/words.ts` `refusedRunWords`, the command line's words). Off with no engine (`aria-disabled`, a toast) |
| Load (`output/DtaView.tsx`), Import (`files/FileBar.tsx`) | `runCommand(text)` | enabled in `ready`; off with no engine (`aria-disabled`, a toast); `disabled` in the other states |

The error mark's hooks are signal effects in `editor/Editor.tsx`: `followRuns` on `engine`, `followErrors` on
`lastRun`. Both run inside a step.

### One command's fate

```mermaid
stateDiagram-v2
  state "runCommand(text)" as sub
  state "refused" as refused
  state "running" as running
  state "ended by the engine" as ended
  state "cut by a reset" as cut
  state "cut by another tab" as taken
  [*] --> sub
  sub --> refused: empty text, or a state with no run cell
  sub --> running: ready, send-run
  running --> ended: run-ended or run-failed
  running --> cut: reset, crash, Break timeout, Break with no SharedArrayBuffer
  running --> taken: lock-lost
  refused --> [*]
  ended --> [*]
  cut --> [*]
  taken --> [*]
```

| Fate | `how` | `done` settles with | `lastRun` | `history` | The command line's text |
|---|---|---|---|---|---|
| Refused | `refused` | null, at once | unchanged | unchanged | kept |
| Ran (from `ready`) | `started` | the result, after the after-run work | the run, written in the step that ended it | + the command (not twice in a row) | cleared |
| Its op failed in the worker | `started` | the machine's rc 9998, kind `run-failed` | the run, rc 9998 (the worker stays) | + | cleared |
| Cut by a reset | `started` | the machine's rc 9998, kind `break`, `crash` or `user` | null (`engine-gone`), then the cut run, rc 9998, in the same step | + | cleared |
| Cut by another tab | `started` | the machine's rc 9998, kind `stopped` | null (`engine-gone`), and not written again | + | cleared |

`runCode` (Run, Run selection) is the same without `history` and the field. Its head is `kind: "file"` or
`"selection"`, and `began` adds a run-head to the log and, on a phone, sets `phoneTab` to `"log"`.

### An ordinary run, from Enter to the after-run reads

```mermaid
sequenceDiagram
  participant CL as log/CommandLine.tsx
  participant R as run.ts
  participant E as engine.ts
  participant T as machine.ts
  participant C as engine/client.ts
  participant V as views
  CL->>R: Enter, runCommand(text)
  R->>E: run(code, head)
  E->>T: transition, ready to running, effect send-run
  E->>V: engine = running, signal effects run now (Editor followRuns)
  E->>R: began, a text item (streaming) into the log
  E->>C: run, posted now
  E-->>R: started
  R->>R: history gets the command
  R-->>CL: how started, and done
  CL->>CL: the field is cleared
  C-->>R: log chunks, outside any step, the text item grows
  C-->>E: the result, reply run-ended
  E->>T: transition, running to ready, effect end-run
  E->>V: engine = ready, while log, lastRun and results are still the old values
  E->>R: ended, the text becomes result.log with end, notes, graphs, lastRun, results
  R->>R: afterRun, fresh written now, the file list and the open tabs follow later
  R->>C: refreshData, describe, browse, macros, memory, all posted inside the step
  Note over V: Preact renders the whole step in one microtask
  R-->>CL: done settles once both are over (allSettled)
```

What a view may rely on, and when:

| When | What is true |
|---|---|
| `runCommand` has returned | `how` is known. When started: `history` has the command, `engine` is `running`, and the log has the run's text item. |
| A signal effect on `engine` sees `ready` | The run has ended, but `ended` has not run yet: `log`, `lastRun`, `results` and `graphs` are the old ones. |
| A signal effect on `lastRun` sees the new run | The log text is final, with `end`, and the graphs are added. `results` is still the old one (written next). |
| A component renders after the step | The whole step: `engine`, the log, `graphs`, `lastRun`, `results`, and `fresh` (and the storage banner, when it is due), which `afterRun` writes before its first `await`. |
| Later, as each answers | `data`, `rows`, `macros`, `memory` (`refreshData`); `files` and the open tabs (`afterRun`). |
| `done` has settled | All of the above. An after-run read that failed leaves its signal as it was. A failed file list, and an open tab's follow-up that throws, go to the console; `refreshData` drops its error. |

`refreshData` sends its four reads synchronously inside the end step (`client.ts` `#send` posts at once). So they are
ahead, in the worker's queue, of any run started after the step.

### Three pasted lines, the second fails

```mermaid
sequenceDiagram
  participant CL as CommandLine onPaste
  participant P as log/paste.ts runInTurn
  participant O as log/pasterun.ts runOne
  participant R as run.ts
  participant E as the end step
  CL->>P: lines a, b, c (pastedLines)
  P->>O: runOne(a)
  O->>R: runCommand(a), started
  O->>O: whenEnds, a signal effect on lastRun, and done
  E->>R: the step that ends a, lastRun = rc 0
  R->>O: the effect sees the new lastRun, end(0), settle in a microtask
  Note over E: the step ends (synchronous)
  O-->>P: microtask, rc 0
  P->>O: runOne(b), before any input event
  E->>R: the step that ends b, lastRun = rc 111
  O-->>P: rc 111
  P-->>CL: stop at line 2, why error, ran 2 of 3
  CL->>CL: toast, 1 of 3 pasted lines not run, line 2 ended with r(111)
  Note over R: the done of a and b settle later, after their after-run reads, and are ignored
```

- **Why `whenEnds` waits on `lastRun`.** `lastRun` is written in the step that ends the run. `done` settles only
  after the after-run reads. Between the two the engine is `ready`, so an Enter or a Run pressed then would take the
  engine, and the next pasted line would be refused. Starting it in a microtask after the step leaves no gap. It cannot
  start inside the step: `run()` would throw.
- **Why `done` is still awaited.** A line cut by another tab writes no new `lastRun`: `done` settles with kind
  `stopped`. `done` settling also stops the effect, so no wait
  outlives its run. The first of the two to come wins (`over`).

| `stop.why` | When | Lines counted as run | Toast (`inTurnWords`) |
|---|---|---|---|
| `block` | the line opens a block, a `/*` comment it does not close, or holds `///` (`opensBlock`); it is not sent | those before it | "N of T pasted lines not run: line L starts a block, a comment or a /// command; run those from the editor" |
| refused whole (`pastePlan`: `refused`) | the engine is there or on its way but not `ready` when the paste comes (the page load, a download, a start, a run) | none: no line is sent | "T of T pasted lines not run: the engine can't take a command now". The paste is prevented and the field is exactly as it was: nothing is pasted, nothing cleared, and the text before and after the cursor stays. (Before 2026-11-12 the field was cleared, line 1 was refused and put back, and the other lines and the text after the cursor were lost.) |
| `refused` | `how` is `refused` for a line after the first (the engine was `ready` when the paste began, and was not when this line's turn came) | those before it | "N of T pasted lines not run: the engine can't take a command now". The line goes back into the field if the field is empty and not off (`pasterun.ts` `putBack`: with no engine by then, nothing is put into the off field). |
| `error` | rc is not 0: an error, Break's rc 1, or rc 9998 (a reset, `run-failed`) | up to and with it | "N of T pasted lines not run: line L ended with r(rc)" |
| `taken` | `done` gave kind `stopped` | up to and with it | "N of T pasted lines not run: another tab took over the engine during line L" |
| none | every line ran | all | no toast |

When the last line ends with an error or is cut by another tab, nothing is left (`total - ran` is 0), and there is no
toast: its error is in the log. A last line that is refused or a block's leaves one line, and the toast shows.

With no engine no line is run at all: the paste is an ordinary paste (`pastePlan` answers before `pastedLines` is
asked). An engine lost while pasted lines run keeps the rules above: `taken` when another tab took it during a line,
`error` (rc 9998) when a reset cut the line.

### Invariants a change must keep

- **No run is held.** A run is sent in the step of its `run` event, from `ready`, or never: no state keeps a run's code
  (a property in `machine.test.ts`), and run.ts keeps no promise for a run that has not begun. No state carries a
  "for a run" mark through the download either: the prompt has one title.
- **With no engine nothing offers to run.** A new control that runs code reads `start.ts` `noEngine()` and is off
  then; a new way to start the engine calls `startEngine()`, so another tab's engine is never taken without the
  take-over dialog.
- **`done` always settles.** A started run settles through `end-run` (every exit from a running state has one). A
  refused run settles at once. The after-run work uses
  `Promise.allSettled`, so a failed read does not keep `done` open.
- **No run starts during a step.** A view never calls `runCode` or `runCommand` inside a handler given to `connectRun`,
  or inside a signal effect on `engine` or `lastRun`. Both are written only during a step, so the call throws. A `log`
  write from a step (`began`, `ended`) throws too. A streamed chunk and "Clear log" write `log` outside a step, where
  the call does not throw: during a run it is refused, and after "Clear log" in `ready` the run starts. Start the next
  run after the step: in a microtask, or when `done` settles.
- **`ended` comes after the `engine` signal has its new state.** When the machine cut the run, it also comes after
  `engine-gone`.
- **A cut of kind `stopped` writes no `lastRun`.** The tab no longer owns the engine, and a quick take-over may already
  have started a new one.

### Tests that hold this

- `web/test/app.test.ts`:
  - "a run: the streamed log grows one item and the result's log replaces it; graphs, lastRun, results and the
    after-run calls"
  - "a crash cuts a run: the new state first, then engine-gone, then the cut run's result; …"
  - "runCode while a run is on does nothing; with no engine a run is refused, settles with null at once and opens no
    prompt, and after Start engine, Not now or a failed start nothing runs"
  - "run() called while a step is in progress throws before it queues anything"
  - "runCommand: added to history (not twice in a row), …"
  - "runCommand: a command that does not run is not in history (so the field keeps it): refused, with no engine too,
    where it opens no prompt; …"
  - "a run whose op failed in the worker (run-failed) is not a reset: …"
  - "Stop download declines; a run then is refused and opens no prompt; Start engine opens the prompt and runs nothing,
    not when the engine is ready either; Run then runs"
  - "Start engine: what each engine state offers (start.ts startOffer), every state named; the words of the off
    controls and the hint"
  - "Start engine pressed (startEngine, the buttons' and Ctrl/Cmd+Enter's one action) in each state: the prompt, a new
    try, the take-over dialog, or nothing; …"
  - "C1: a run cut by losing the tab lock does not set lastRun, and the store is not listed afterwards"
  - "J1: pasted lines: a line cut because another tab took the engine stops the rest; …"
  - "a paste is decided before anything changes (pastePlan): with no engine an ordinary paste …; with an engine that
    is not ready, refused whole with the toast's words; ready, the lines run; no line is put back into an off field"
  - "J5: a run's promise settles even when the after-run work throws (an open tab's follow-up fails)"
- `web/test/machine.test.ts`:
  - "property: a transition from running, breaking or waiting to a state that is none of those has exactly one end-run,
    as its last effect; no other has one"
  - "property: no run is held: send-run comes only from a run in ready, with that run's code and head, and no state
    keeps a run's code"
  - "scenario 12. with no engine a run is not valid; Start engine (ask) opens the prompt and nothing runs: …"
  - "property: a transition from ready, running, breaking or waiting to a state that does not hold the same worker has
    engine-gone, once"
- `web/test/editor.test.ts`:
  - "pasted lines run in turn and stop at the first refused or failed one"
  - "pasted lines stop before a block's, a comment's or a /// line, …"
  - "pasted lines: the next starts only once the one before has ended"
  - "a paste with no line break is an ordinary paste; …"
  - "a dialog's held-Enter rule (ui/keys.ts isHeldEnter): only a repeat of Enter, …"
  - "a refused Ctrl/Cmd+Enter's toast: the words by the engine's state; none where a run is taken or the key does what
    Start engine does (the download prompt, the take-over dialog)"
- `web/test/imports.test.ts`:
  - "events get in through two doors: …; transition() is called once"
  - "each signal has one writer: …"
- `web/e2e/editor.spec.ts`:
  - "the command line: Enter runs and clears, ↑ recalls; a paste of lines runs each in turn and stops at an error; …"
  - "the command line with no engine: disabled, with the hint while it is empty; the button is Start engine; a paste is
    an ordinary paste; a typed draft stays through a loss of the engine and runs when the engine is back"
  - "with no engine nothing offers to run: Run is Start engine and Ctrl/Cmd+Enter does what it does, once while held;
    Run selection is off; nothing runs when the engine is ready"
  - "with no engine Import and the log's help links are off: aria-disabled and still focusable, and a press only says
    why"
  - "while the engine starts, a command is refused with words and the draft stays; a start that fails under the caret,
    and Start engine pressed by keyboard, leave the focus where it was; Ctrl/Cmd+Enter after a failed start tries
    again, and says why where it cannot"
  - "a .dta tab: Save is off, and when the engine's dialog closes by itself the focus goes to that tab" (Start engine
    opens the prompt, and nothing runs once the engine is ready)
  - "Ctrl/Cmd+Enter that the engine does not take says why in a toast and starts nothing; …"
- `web/e2e/shell.spec.ts`: "first visit: … Run is Start engine, which brings the prompt back; a run does nothing and
  opens no prompt"; "the toolbar does not move: …; Run is Start engine with no engine"
- `web/e2e/states.spec.ts`: "a second tab: Start engine goes into the take-over dialog, never straight to a start; the
  dialog's button takes over"; "where nothing can start the engine from the page …: the command line and its Start
  engine are off, and say so; …"; "the phone's command line at 320 px with no engine: the hint shows whole beside Start
  engine, …"
- `web/e2e/output.spec.ts`: "a .dta tab with no engine …; Load is off and a press only says why"

### If you change this

- **Taking the rc from `done` in `whenEnds`** leaves a gap between two pasted lines in which another run takes the
  engine. The next line is then refused.
- **Changing `Promise.allSettled` to `Promise.all` in `ended`** leaves `done` unsettled when an open tab's follow-up
  fails, and a paste then waits for ever (J5).
- **Holding a run again** (sending it when the engine is ready) would need a state field, the promise that waits for
  it and an effect for each way it is let go; that is what was removed on 2026-11-12. The no-held-run property in
  `machine.test.ts` fails first.
- **The order of writes in `ended`:** log and graphs, then `lastRun`, then `results`. The editor's error mark and
  `whenEnds` react to `lastRun`. Moving `lastRun` earlier gives them a log that is not final.
- **The `RunHead` object is passed through unchanged**, from `runCode` through the machine to `began` and the run-head
  item. `codeOf` (section 4) and the editor's running-lines mark (`marked?.head === run`) look it up by identity.

---

## 3. An open file's state in the editor

The editor (`editor/Editor.tsx`) keeps, per open text tab, keyed by path:

- `states`: the `EditorState`. The shown one lives in the view and is copied back when the tab is hidden.
- `savedText`: the store's text in the editor's form, or null when the store's version is not text.
- `forms`: the noted line break and BOM.
- `saving`: each Save in progress with the path its tab has now (`renamed` moves it, `closed` sets it to null), so a
  Save that answers after a rename leaves its outcome on the renamed tab. A Save writes in its turn
  (`files/actions.ts` `fileTurn`): a rename or a delete keeps the turn until the tabs have followed it, so a Save pressed
  meanwhile writes under the new name, or nothing when its tab was closed; a Save's turn ends once its write is issued,
  and the store applies changes in the order they are called, so a rename after it moves the bytes it wrote.

`tabs[].dirty` (the unsaved dot) is written only through `state.ts` `setDirty`. The file code (`files/open.ts`,
`files/actions.ts`) changes `tabs` and `activeTab` first, then calls the editor through `editorCommands`.

### The three text forms

```mermaid
flowchart LR
  B[("store bytes: the file's line break, a BOM or not")]
  D["decoded text, BOM kept"]
  Doc["editor text: LF only, no BOM"]
  F["noted form: line break, BOM"]
  W["bytes Save writes"]
  Run["code Run sends"]
  B -->|"decodeText(bytes, true), followOpen, textInStore"| D
  D -->|"editorText"| Doc
  D -->|"formOf"| F
  Doc -->|"fileText(doc, form, path)"| W
  F -->|"savedForm drops the BOM of .do and .ado"| W
  W -->|"store.write"| B
  Doc -->|"as it is: runFile, or the selected lines"| Run
```

- `editorText` (`editor/ranover.ts`) drops a leading BOM and turns `\r\n` and `\r` into `\n`.
- `formOf` notes `lineBreakOf` (`\r\n` when it outnumbers lone `\n`; else `\n`, also on a tie, for an empty file and
  for lone `\r`) and whether the text starts with a BOM.
- `fileText` writes the editor's text with the noted break, and with the BOM unless `dropsBom(path)` (a `.do` or
  `.ado` name, case ignored, at the time of the Save).
- `textOf` (the save-failed banner's Download) gives the same text as Save would write.

### What each event does

| Event | Editor's text | Saved text | Noted form | Unsaved dot | Error mark | run-changed, save-failed | The store |
|---|---|---|---|---|---|---|---|
| **Open** (`openFile` → `open`) | `editorText` of the file | the same | `formOf` the file | off (the tab is added clean) | none (the mark lives in the tab's state, which a close drops) | none (`openFile` dismisses any not-text banner) | read only |
| **Edit** | changed | unchanged | unchanged | on when the text differs from the saved text (`follow`, on each change) | moves with the text; gone when its line is deleted (`cm.ts` `lineMarksField`, `errormark.ts` `lineDeleted`) | unchanged | unchanged |
| **Undo back to the saved text** | equals the saved text | unchanged | unchanged | off | mapped as any edit | unchanged | unchanged |
| **Save succeeds** (`save`) | unchanged | the text Save wrote | `savedForm`: a `.do` or `.ado` loses its BOM, by the name it was written under | off, unless the text changed while it was written | unchanged | both dismissed for the tab's path; toast "Saved name". A tab renamed while it was written gets all of this under its new path. | `fileText` bytes |
| **Save fails** | unchanged | unchanged | unchanged | stays on | unchanged | save-failed added (one per path, under the tab's path at the time it fails; none for a tab closed meanwhile); the live region says it | unchanged |
| **Rename** (`renameEntry` → `renamed`) | the same state, its language set by the new name | moved to the new path | moved, BOM and all; the new name decides at the next Save | kept | kept | both moved to the new path; a Save in progress answers there (`saving`) | the same bytes under the new name |
| **Rename across a `.do` name** | as Rename | as Rename | `a.txt` with a BOM renamed `a.do`: the next Save writes no BOM. `a.do` with a BOM, never saved here, renamed `a.txt`: the next Save keeps it. | kept | kept | moved | the same bytes |
| **Rename to a name that opens another way** | a clean tab is closed and opened again in its place (as Close, then Open); a tab with edits stays as it is; a `.png` name closes a clean tab | | | | | | |
| **Close** (`closeTab` → `closed`) | dropped | dropped | dropped | the tab is gone | dropped with the tab's state | both dismissed | unchanged ("Don't save" loses the edits) |
| **First visit's sample** (`sample.ts` `seedSample`: an empty store and no mark) | as Open, of `analysis.do`, once the three files are written | the same | `\n`, no BOM | off | none | none; the seed's own writes bring no storage banner (`files.ts`, by the store's change row) | the sample's three files |
| **"Restore the sample" over an open tab** (an upload: `reopen` → `reload`) | the sample's text (`decodeText(bytes, true)`), a new state | the same | `formOf` it: `\n`, no BOM, so a `\r\n` or BOM tab saves the sample's form from then on | off | gone (new state) | both dismissed | the sample's bytes. Asked first (the clash dialog, the sample's words) when the file differs from the sample or the tab has unsaved edits; a file that holds the sample's bytes, with no unsaved edits, is not written and its tab is left as it is; a missing file is written with no question, and its open tab, if any, is not reloaded. |
| **Upload and "Replace with uploaded"** (`reopen` → `reload`) | the uploaded text, a new state (undo history gone) | the same | `formOf` the upload | off | gone (new state) | both dismissed | the uploaded bytes. Not text: the tab closes. A clash with the same bytes, no unsaved edits, is not written and its tab is left as it is. |
| **A run writes the same text** (in the editor's form) | unchanged | unchanged | unchanged, even if the run wrote other line breaks | unchanged (a tab with edits stays unsaved) | unchanged | unchanged | the run's bytes |
| **A run writes other text, tab clean** | the run's text, as one change where the two differ: caret, selection and undo kept | the run's text | `formOf` the run's text | off | mapped through the change | run-changed dismissed | the run's bytes |
| **A run writes other text, tab unsaved** | kept | the run's text | `formOf` the run's text; unchanged when the run wrote exactly the editor's text | on. When the run wrote exactly the editor's text: off, and the answer is "same". | unchanged | run-changed added (files.ts, on "kept"); when "same", dismissed | the run's bytes |
| **A run writes something that is not text** | kept | null (`savedIsText` is false) | unchanged | on | unchanged | run-changed in its not-text words, with no "Reload from the run" | the run's bytes. A later run that writes the editor's text makes the tab clean and removes the banner. |
| **A run deletes the file** | unchanged (`followOpen` skips `removed`) | unchanged | unchanged | unchanged | unchanged | unchanged | removed; the file leaves the list, and Save writes it again |
| **"Reload from the run"** (`textInStore` → `reload`) | the store's text, a new state | the same | `formOf` it | off | gone | both dismissed. When the store gives no text: only run-changed, dismissed. | unchanged |
| **The file's own run starts** | sent as it is, edits included, never saved first | unchanged | unchanged | unchanged | this file's mark cleared (`onRunStart`); a selection run marks its lines while the state is `running`, `breaking` or `waiting` | unchanged | unchanged |
| **It ends with an error** | unchanged | unchanged | unchanged | unchanged | set on `lastRun.line` (the file's line: a selection's offset added in `run.ts`) when rc is not 0 or 1 and the line exists. The number is applied to the text as it is then. | unchanged | what the run wrote follows (rows above), after this step |
| **A command-line command runs** | unchanged | unchanged | unchanged | unchanged | unchanged (`onRunStart`, `onLastRun`: a command changes no mark) | unchanged | as the run rows, if it writes the file |
| **A reset** | unchanged | unchanged | unchanged | unchanged | every mark cleared, the closed files' too (`lastRun` is null in the `engine-gone` effect); the running lines cleared | unchanged | unchanged |

What "the run changed" means: the worker compares `/work` before and after the run by modification time and size, and
writes the changes in `store.applyRun` (`engine/store.ts`). It leaves out any path the page changed during the run,
because the page's version wins. `RunResult.files` lists only what it wrote. `files.ts` `afterRun` calls `followOpen`
for each listed path that is open in a text tab. `followOpen` reads it, decodes it strictly (BOM kept, null when not
UTF-8), and calls `editorCommands.ranOver`, which applies `ranover.ts` `followRun`.

### Rules a change must keep

- **Compare in the editor's form.** The dot (document against `savedText`) and a run's version (`followRun` passes the
  run's text through `editorText`) are compared with `\n` breaks and no BOM. Otherwise a clean `\r\n` tab is never
  clean.
- **Save is the editor's only write to the store.** Run sends the text and writes nothing. The Download in save-failed
  gives the browser a file and writes nothing. The editor follows the other writers: an upload (`reload`), a run
  (`ranOver`).
- **A `.do` or `.ado` file is written without its BOM,** by the name it is saved under (`savedForm`). After a Save,
  the noted form is the one written.
- **`tabs` first, then the editor.** `open`, `renamed` and `closed` assume the tab already has its new state in `tabs`
  and `activeTab`.
- **A null `savedText` means "the store's version is not text".** Keep it null when it moves (`renamed`), and keep
  `?? null` where it is read.

### Tests that hold this

- `web/test/editor.test.ts`:
  - "a run's version of an open file (editor/ranover.ts): compared with line breaks as the editor holds them; …"
  - "a file's form (editor/ranover.ts): its line break, the more common one, \n on a tie or with none, and its BOM; …"
  - "the error mark's rule (editor/errormark.ts): …"
- `web/test/app.test.ts`:
  - "a run that rewrites an open file: the editor follows it (ranOver); the banner when it keeps the tab's text: …"
  - "setDirty sets one tab's dot; decodeText takes strict UTF-8 only"
- `web/test/files-ui.test.ts`:
  - "openFile: a text file gets a tab, made active, before the editor is told; …"
  - "closing a tab: …"
  - "rename: an open file, and a folder with open files under it: the tabs follow, then the editor is told for each"
  - "upload over an open file: … Replace reloads it in the editor; one no longer text closes its tab"
  - "rename: a .dta tab renamed to .csv opens again as text in its place; …"
- `web/e2e/editor.spec.ts`:
  - "the editor: typing marks the tab unsaved, Ctrl/Cmd+S saves it with a toast, a failed save shows a banner; …"
  - "a failed save's banner goes when the editor's text is replaced: Reload from the run, Replace with uploaded"
  - "a rename while Save writes: the save follows the tab to its new name (clean, its toast), and so does a failed
    save's banner"
  - "a Save pressed while a rename is being written saves under the new name, not the old one"
  - "a Save pressed while a delete is being written does not bring the file back"
  - "Save keeps a file's form: …"
  - "the error line keeps to its text when the tab is left and shown again"
  - "the error line goes with its tab: a file closed and opened again with the same text has none"
  - "a run that rewrites open files: …"
  - "a clean tab of a .csv with \r\n line breaks follows a run that rewrites it: …"
  - "a file's form follows the store's text the editor takes: …"

### If you change this

- **`ranOver` calls `setDirty` itself.** The `follow` listener sees only the shown view's transactions. A hidden tab
  changed through `update()` gives the listener nothing.
- **The error mark's effects (`followRuns`, `followErrors`) must read only their one signal.** If they also read
  `shown`, a tab switch would place the error again at the run's line number, not where its text has moved.
- **`renamed` shows the new path itself.** `activeTab` changed before the call, when the editor had no state for the
  new name and showed the empty view.
- **A rename must keep `savedText`'s null.** Code such as `savedText.get(from) ?? ""` would make a not-text tab look
  like an empty saved text.
- **A Save answers for the path its tab has when the store answers** (`saving`). Code that awaits between taking a
  tab's path and writing the editor's maps under it must follow a rename the same way, or it writes under the old name.
- **A change that tabs follow takes a turn** (`fileTurn`). A new action that renames, moves or removes files and then
  updates the tabs must hold a turn until the tabs have followed it, or a Save pressed in between writes under the old
  name (and brings a deleted file back).

---

## 4. Placing graph links and notes in the log

### The problem

The log is plain text that the engine prints, with no marks. The engine reports, for each graph, only the line number
in the code it was sent (`RunResult.graph_lines`), and not where in the log that line ran. `log/align.ts` `echoLines`
walks the log's echoes beside the code to find, for each code line, the index of its echo.

### The pieces

- **Line kinds** (`log/classify.ts` `classify`). The walk uses:
  - `echo`: `. cmd`; a loop's or program's body line `  2. cmd` and a continued `> ` line, but only right after another
    echo;
  - the text `end of do-file`, which is classed `out`.
- **`runError(lines)`:** the last `err` line that is not `r(N);`.
- **The code** (`editor/commands.ts` `codeOf`): a `WeakMap` from the run's `RunHead` to the code sent, which
  `Editor.tsx` `start` fills before `runCode`. A command has no run-head. `LogView` takes its first echo's text as
  the code. A run started from elsewhere (the test hook) has no code, so its links go to the run's end.
- **Per code line** (`blocks`, `comments`):
  - `inside` a block: `{ }`, `program define` … `end`, `mata` … `end`. `inBlocks` exports it.
  - `silent`: the body of a `quietly { }` or `capture { }` outside a loop or program.
  - `skip`: blank, or in or opening a `/* */` comment.
  - Braces in strings, comments and a `local`'s or `global`'s text are not counted.
- **The index:**
  - `real[j]`: the next line from `j` that is surely echoed.
  - `all`: the code lines by text.
  - `far`: the lines by text that the look-ahead may jump to (outside blocks, not skipped, not silent).
  - The lookups use a binary search (`atLeast`), so the walk is linear in the log.
- **`endFirst[i]`** (a backward pass): whether an `end of do-file` comes after log line `i` and before the next echo of
  a `do` that shows its echoes.
- **The walk's state:**
  - `p`: the next code line to find.
  - `depth`: the nested do-files open.
  - `jump`: whether a top-level echo may be taken and looked for further down.

`opens(x)` is true for `do` or `include`, after any `capture`, `quietly` and `noisily` prefixes (abbreviated too),
when its echoes show: no prefix, or `noisily` last.

### The walk, per log line

```mermaid
flowchart TD
  A["log line i"] --> B{"depth above 0?"}
  B -->|yes| C{"end of do-file?"}
  C -->|yes| C1["depth minus 1, at 0 jump goes off"]
  C -->|no| C2{"a do that shows its echoes?"}
  C2 -->|yes| C3["depth plus 1"]
  B -->|no| E{"an echo?"}
  E -->|no| E1{"end of do-file?"}
  E1 -->|yes| E2["jump goes off"]
  E -->|"yes, empty"| Z["next line"]
  E -->|yes| G{"jump off, a dot echo, not a do?"}
  G -->|yes| H{"endFirst at i?"}
  H -->|yes| Z
  H -->|no| H1["jump goes on"]
  H1 --> I
  G -->|no| I{"same text at a code line from p to real at p?"}
  I -->|yes| K["found: that line is at i, p moves past it"]
  I -->|no| J{"jump on and a dot echo, and found further down in far?"}
  J -->|"yes, by look-ahead"| K
  J -->|no| J1["passed over, a do still adds to depth"]
  K --> M["jump goes on if the line is outside a block and was not found by look-ahead"]
  M --> L{"the echo opens a do-file?"}
  L -->|"its line is in a block"| L1["jump goes off"]
  L -->|"its line is outside"| L2["depth plus 1"]
```

A candidate between `p` and `real[p]` is taken when it is `real[p]` itself, or when it is not silent and either not
inside a comment or matched by a continued `> ` echo.

### A worked example: a loop that runs a nested do-file

`step.do` holds one line, `count`. The editor runs this file, and its line 8 draws a graph (`graph_lines` is `[8]`):

```
1  clear
2  set obs 3
3  generate x = _n
4  forvalues i = 1/2 {
5      do step.do
6  }
7  count
8  scatter x x
```

The engine's log (run through dofile's engine; the page receives it without the CLI's outer `do`), with the walk's
state before each line. `depth` stays 0 throughout: the `do` is in a block, so it opens nothing. `endFirst` is computed
before the walk. A line with no entry in the last column is passed over.

| i | Log line | Kind | `p` | `jump` | `endFirst` | What happens |
|---|---|---|---|---|---|---|
| 0 | `. clear` | echo | 0 | on | no | code line 1 found |
| 1 | (blank) | out | 1 | on | no | |
| 2 | `. set obs 3` | echo | 1 | on | no | code line 2 found |
| 3 | `number of observations (_N) was 0, now 3` | out | 2 | on | no | |
| 5 | `. generate x = _n` | echo | 2 | on | no | code line 3 found |
| 7 | `. forvalues i = 1/2 {` | echo | 3 | on | no | code line 4 found |
| 8 | `  2.     do step.do` | echo | 4 | on | yes | code line 5 found. It opens a do-file, and line 5 is in a block, so `jump` goes off. |
| 9 | `  3. }` | echo | 5 | off | yes | code line 6 found (not a dot echo, so `jump` does not stop it) |
| 11 | `. count` | echo | 6 | off | yes | an `end of do-file` comes before any `do`, so this echo may be `step.do`'s: passed over |
| 14 | `. ` | echo | 6 | off | yes | empty |
| 15 | `end of do-file` | out | 6 | off | yes | `jump` stays off |
| 17 | `. count` | echo | 6 | off | yes | passed over, as at 11 |
| 21 | `end of do-file` | out | 6 | off | no | |
| 23 | `. count` | echo | 6 | off | no | no `end of do-file` follows, so `jump` goes on. Code line 7 found. |
| 26 | `. scatter x x` | echo | 7 | on | no | code line 8 found |

The result is `{1→0, 2→2, 3→5, 4→7, 5→8, 6→9, 7→23, 8→26}`, and the link "graph 1" goes after log line 26. Without
`endFirst`, line 11, the first `. count` (`step.do`'s), would be taken as code line 7.

A `do` at the top level (outside any block) works the other way. Its echo raises `depth`, and every log line until the
matching `end of do-file` is passed over. A `do` echoed inside that file raises `depth` again. When `depth` is back to
0, `jump` goes off: a `do` in a loop of that file may still print ends that were not seen opening.

### Where `LogView` uses the result

`log/LogView.tsx` `runText`, for each text item:

- **Graph links.** Each graph of this run (`graphs` with `from: "run"` and this `run`) goes after
  `commandEnd(lines, echoes.get(g.line))`, the last `> ` line of that command. When the line has no echo, or the graph
  has no line, it goes after the item's last line (the one before the text's final line break, which may be blank). A
  graph drawn inside its run's text is not drawn again by its `{t: "graph"}` log item (`placed`).
- **S 15's note.** The item keeps `unsaved`, the open files with unsaved edits when the run started (`run.ts`
  `began`). For each found echo, `nestedTarget` reads the command `align.ts` `echoed` gives (the echo without its
  `. `, `  2. ` or `> ` prefix, the one rule the walk uses too). The note "Note: name has unsaved edits in the editor;
  do runs the saved file. …" goes after that command when `unsavedTarget` finds the file: the same path, else the one
  unsaved file with that name. A loop's or program's body is echoed once, where it is defined, so a `do` there gets
  one note after that echo, however many passes run the file (for a program, at its definition, not its call). A `do`
  whose file name is on a continued `> ` line gets none.
- **OQ-10's note.** When the run ended with rc above 1, `states/words.ts` `noteFor(end.rc, runError(lines))` picks
  the note, which goes at the run's end, after "Go to line" when that is there (Break's note is rc 1's, so never with
  it).
- **Caches.** `kinds` (each item's `classify`) and `aligned` (each item's echoes, kept with the code they were
  computed for) are `WeakMap`s keyed by the text item. `run.ts` replaces an item on every change (`setText` maps to a
  new object), so a streamed chunk is classified again, and an ended run is aligned once.

### Late rather than wrong

Where the walk cannot know which echo is a line's, the line gets none, and its link goes to the run's end. A link in
the wrong place is worse than a late one. These cases give no echo on purpose:

- **An echo that may belong to a do-file run from a block** (a loop, a program, an `if`): after such a `do`, or after
  any nested file's end, a top-level echo is taken only when no `end of do-file` comes before the next `do`
  (`endFirst`).
- **A program's call followed by its do-file's echoes:** the call (`zp`) may get no echo. The test allows "unknown,
  never wrong".
- **Silent lines:** the body of a `quietly { }` or `capture { }` outside a loop or program.
- **A line inside a `/* */` comment:** it is taken only as a continued `> ` echo of a comment that began in a command.
- **Blank lines.**
- **Lines echoed in another form** (a mata block's `: ` lines). The walk gets back in step at the next top-level echo,
  through the look-ahead.
- **`quietly do`:** it prints no echoes and opens nothing.
- **A top-level echo with no candidate while the look-ahead is off:** passed over (a `do` there still adds to `depth`).

The look-ahead is off (`jump` off) after a `do` in a block, and after any `end of do-file` seen at depth 0. It comes on
again at a dot echo with no nested end before the next `do`, or when a line outside a block is found in step.

### The known limit

In `#delimit ;` mode, two commands on one line are echoed as the whole line twice. The second echo can be matched to a
later identical line, and a graph's link then goes in the wrong place (`docs/prototype1-plan.md`, list C, item 11).

### Tests that hold this

- `web/test/editor.test.ts`:
  - "echoLines: each code line finds its echo; blank lines and block comments are passed over"
  - "echoLines: a nested do-file's echoes are passed over, even one with the text of a later line"
  - "echoLines: a do-file run from a block opens nothing, and the walk stays in step after it"
  - "echoLines: after lines echoed in another form (a mata block) the walk finds the next line further down"
  - "echoLines: capture noisily do shows its file's echoes, which are passed over; quietly do shows none"
  - "echoLines: a do-file run from a loop, then a line its file holds too: the main file's echo, after the loop's runs"
  - "echoLines: a do-file run from a program: a later line its file holds is not taken for the program's echo"
  - "echoLines: a do-file that runs a do-file from a loop is passed over whole"
  - "echoLines: `n` is noisily too (cap n do shows its file's echoes); include and noi do"
  - "echoLines: a quietly or capture block echoes nothing inside; a line there is not taken for a later line's echo"
  - "echoLines: a line in a /* */ comment is not taken for the echo of the same line after it; a comment's continued
    line is"
  - "inBlocks: a local or global's braces open no block"
  - "nestedTarget and unsavedTarget: the file a do or include runs, and the open file with unsaved edits it is" (also
    `echoed` on a top-level and a body echo)
  - "runError: the error a run ended with is its last error line, not one capture noisily caught before it"
  - the three ".log tokenizer" tests
- `web/e2e/editor.spec.ts`:
  - "Run: the run-head, the graph after its echo, the error line marked, Go to line, the last run; Run selection keeps
    locals"
  - "the log: under an error, the OQ-10 note where the engine's own words do not say it"
  - "S 15's note under a nested do in a loop: one note, after the loop's echo of that line, however many passes run it"
- `web/e2e/shell.spec.ts`: "key hints: … the Editor and Log views with a nested do's note …"

### If you change this

- **Mutating a log text item** in place, instead of replacing it, leaves the `WeakMap` caches with old answers.
- **`graph_lines` are lines of the code sent.** For a selection, that is the selected slice, which is also what
  `codeOf` holds. `error_line` is offset to the file's line in `run.ts`; `graph_lines` must not be.
- **`codeOf` is keyed by the `RunHead` object.** A head that is copied anywhere between `Editor.tsx` `start` and the
  run-head item loses the code, and every link goes to the run's end.
- **The echo rules of `classify`** (a body line or `> ` counts only after another echo) decide what the walk sees. A
  change there changes where links go.
- **A new case should give no echo rather than a guess.** The tests assert "unknown, never wrong" where the walk
  cannot know.
