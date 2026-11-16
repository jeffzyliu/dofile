# The workspace: owners, order and modules

Design note S0 of the web audit (`docs/web-audit-plan.md`, section 6): who owns the file list, the tabs, each open
document and its saved text, and in what order the page writes files. S1, S2, S3, S5, S6 and R7r are built from it; it
changes no code. **Status: proposed 2026-11-16, not approved. None of those items starts before the maintainer approves
it.** Read from the code at f947053. Paths are under `web/src/app/` unless they start with `web/` or `docs/`; "(new)"
marks a name that does not exist yet.

## In short: what is to be approved

1. **Owners.** The file list stays with `files.ts`. The tabs, the active tab and every open document get one owner, a
   new DOM-free module, `editor/documents.ts`. The order of writes is a chain in `files/turns.ts`. Not one workspace
   module, and not tabs in one module with documents in another (section 1).
2. **Documents.** One record per tab. The unsaved dot, `tabs`, `activeTab` and the editor's "shown" are computed from
   the records and stored nowhere (section 2).
3. **Order.** The unit is a turn: one store call and its follow-up on the documents. An operation that asks the
   visitor takes a turn per write, so an open dialog holds no Save (section 3).
4. **Graphs.** The selected graph is kept by its number, not its index (section 2).
5. **State.** `state.ts` is split into one state module per owner and deleted; the e2e hook keeps one `state` object,
   assembled from them (sections 4 and 6).
6. **`editorCommands`** keeps only the four calls that need the mounted Editor (section 5).

Found by trying: `editor/cm.ts` does not load under Node as it is; one line in another file fixes it (section 9).

**The maintainer's choices** (the rest is technical):

- a. Decision 1 itself. Recommended.
- b. Save's turn (section 3). Recommended: keep "issue the write, apply the answer later"; nothing a visitor or a test
  sees changes. Or Save waits in its turn: simpler to argue, but a slow write then holds a rename, and the first half
  of the test at `web/e2e/editor.spec.ts:403` changes.
- c. R7r deletes `state.ts` and rewrites `web/CLAUDE.md`'s "State" rule (recommended), or keeps it as re-exports.
- d. The schedule, which this note changes. S1 is larger than its row: it takes `tabs` and `activeTab` from the file
  code and `files/EditorTabs.tsx`, so "owner functions for `activeTab`" leaves S6's row. A fair cut is three builder
  items: the records with the derived signals; Save and the file code's calls; the scroll snapshot. S2's split of
  `files/actions.ts` is three ways, not four. `graphIndex` joins S6. C2 and C4 (phase 1) move names cited here
  (`decodeText`, the import cycles): rule 7's re-check before S1 settles them.

## 1. Owners (decision 1)

**Three owners, by lifetime. Not one workspace module (R7), and not the proposal's sketch, which leaves the tabs with
the file code and the documents with the editor.**

| What | Owner | Today |
|---|---|---|
| The file list: `files`, `fresh`, `persisted` | `files.ts`, unchanged | `files.ts` through `filesWriter` (`state.ts:68-77`) |
| The tabs and the active tab | `editor/documents.ts` (new) | `tabs`, `activeTab`: writable by anyone (`state.ts:80-81`); written in `files/open.ts`, `files/actions.ts`, `files/EditorTabs.tsx:47, 110, 161` |
| Each open document: text, saved text, form, scroll, saves in progress | the same module | four Maps, `shown` and `saving` in `editor/Editor.tsx:47-57, 243` |
| The unsaved dot | derived there, stored nowhere | `tabs[].dirty` through `setDirty` (`state.ts:84-87`) |
| The order of writes | `files/turns.ts` (new): a chain, no state | `fileTurn` and a second chain, `uploads` (`files/actions.ts:50-60, 251-268`) |

- **Why.** The fragile seam is between tabs and documents. The file code writes `tabs` and `activeTab` "first, then
  the editor" (`files/actions.ts:1-4`), so `renamed` patches a view that showed nothing (`editor/Editor.tsx:356-357`),
  `reopenAs` undoes `openFile`'s side effects after the fact (`files/actions.ts:103-117`), and the dot is stored by one
  module and computed by another. One owner for both ends that protocol. The file list has no such seam: it mirrors the
  store, and no tab state is derived from it. The write order is a device, not state.
- **Against one workspace module.** An estimated 900 lines with four jobs; a command queue would hold every Save
  behind an upload's dialog (section 3); and it replaces the plan's stepwise S1, S2, S3 with one large move.
- **Against the proposal's sketch.** While another module stores `tabs`, the dot cannot be derived and "tabs first"
  stays.
- **Against this decision.** S1 grows (choice d). A `.dta` tab is a record with no document. Whatever reads `tabs`
  (`run.ts`, `files.ts`) loads CodeMirror in its Node tests: about 30 ms a process, measured.

## 2. The open documents (decision 2; S1)

**One record per tab, with identity. The path is a field; nothing else is keyed by path.** Both types are new.

```ts
interface Doc {                          // lives as long as its tab; never copied
  kind: "text" | "dta";
  path: string;                          // a rename changes it
  state: EditorState;                    // text tabs only, as the three below; always current, shown or not
  saved: string | null;                  // the store's text in the editor's form; null: the store's version is not text
  form: FileForm;                        // line break and BOM, as Save writes them
  scroll: StateEffect<unknown> | null;   // EditorView.scrollSnapshot(), taken when the tab is hidden
}
interface EditorSurface {                // what Editor.tsx hands attachView() at mount; a Node test hands none
  extensions: Extension;                 // what needs the view: the key bindings, the listener that calls edited()
  show(state: EditorState | null, scroll: StateEffect<unknown> | null): void; // null: the empty view
  dispatch(spec: TransactionSpec): void; // a change to the shown state; the listener then calls edited()
  scrollSnapshot(): StateEffect<unknown>;
}
```

The records are private. Readers keep today's names and shapes, read-only:

| Today | Becomes |
|---|---|
| `tabs[].dirty`, `setDirty` | `tabs` is a computed `OpenTab[]`. Each text record has a computed `dirty`: its text differs from `saved` (always, when `saved` is null). `tabs` depends on those, so it changes when a dot flips, not at each keystroke. `setDirty` goes. |
| `activeTab` against the Editor's `shown` (`editor/Editor.tsx:55`) | The owner holds the active record; `activeTab` is a computed of its path, so a rename writes nothing. "Shown" is the active record when it is a text tab: a computed, not a second signal. |
| The four Maps and `saving` | Fields of the record. A Save holds its record, and sees a rename or a close on it. |
| `selection` (`editor/commands.ts:17`) | A computed of the shown record's state. |
| `graphIndex` (`state.ts:123-126`) | A computed (decision 4). |

- A text record is made with its state in one step, so "an active text tab with no editor state" cannot exist: the
  test in `openText` (`editor/Editor.tsx:158`), the `show` in `open` (`:290`) and the patch in `renamed` go.
- The owner makes each state, with an empty CodeMirror `Compartment` for `EditorSurface.extensions` that is filled
  for every record when the view attaches (as the wrap setting is, `editor/Editor.tsx:473-479`). A file opened before
  the Editor mounts is then complete: the window in which `editorCommands` does nothing (`editor/commands.ts:1-7`)
  closes.
- **Why.** `renamed` and `closed` follow each Map by hand (`editor/Editor.tsx:331-373`). With one record there is one
  thing to move or drop, and the rules of `docs/web-page-flows.md` section 3 become Node tests.
- **Against.** One signal write per transaction of the shown document. The dot still compares the whole text at each
  change (`editor/Editor.tsx:92`), now in one function.
- **Prerequisite, found by trying (section 9).** `editor/cm.ts` does not load under Node as it is. S1's first commit
  adds `with { type: "json" }` to the import in `web/src/stata/language.ts:5`.

**Decision 4: the selected graph is kept by its `n`.** `run.ts` keeps the picked graph's `n` (null: the newest);
`graphIndex` becomes a computed, that graph's place in `graphs`, or the last when it is gone or none is picked.
`selectGraph(n)` (new) replaces the eight assignments in `run.ts:186, 196, 247`, `output/GraphTab.tsx:45, 81`,
`output/FullSize.tsx:25` and `log/LogView.tsx:87, 99`. Readers do not change. Why: the signal's own comment says never
to keep an index. Against: nothing found; every flow picks the newest graph when one is added, so no behaviour changes.
S6 builds it.

## 3. The order of writes (decision 3; S2 and B1)

**The unit of order is a turn: one store call and what must stay next to it. Never a whole operation.**

1. `fileTurn(fn)` runs `fn` once every earlier turn has ended, whichever way.
2. Inside a turn: the decision (the tab's path now, whether a name is free, whether the file has unsaved edits), the
   store call, and the follow-up on the documents (rename, close, reload, run-over). A check and the write it guards
   share a turn, as in `createEntry` (`files/actions.ts:126-135`).
3. Never inside a turn: a dialog, a timer, an engine call, or another turn (it would wait for itself).
4. An operation that asks the visitor takes one turn per write. An upload's every write, and every replace with its
   reload, is a turn; the clash dialog is awaited between turns. So an open dialog holds no Save.
5. Whole uploads still run one at a time: a second chain from the same factory, `serial()` (new). It may wait for the
   visitor and takes turns; a turn never takes it.
6. A store read whose answer is applied to a document is a turn: `followOpen` (`files.ts:96-113`), "Reload from the
   run" (`editor/banners.tsx:49-53`).
7. One door: in `web/src/app/` the store's `write`, `rename`, `remove` and `mkdir` are called only on the `Writer`
   (new) a turn hands to `fn`. S2 picks what holds it (a type, or N1's path table).

**Save is the one turn that does not wait for its store call.** It reads its record and issues the write in its turn,
and applies the answer to the record afterwards. `web/e2e/editor.spec.ts:403` pins this: a rename goes through while a
Save's write is pending. It is safe because the record has identity, and because the store applies and answers
changes in the order called (`web/src/engine/store.ts:172-176`): a later turn's follow-up waits for its own call, so it
runs after the Save's answer. S2's test of the store's order holds that. The alternative is choice b.

Outside any turn at f947053, and the item that brings each in:

| Write, or read that is applied | Item |
|---|---|
| Save, the only store write in a view (`editor/Editor.tsx:245-280`) | S1 moves it to the owner, in its turn as now |
| An upload's `put` and `reopen` (`files/actions.ts:275-286, 338, 367-373`); "Restore the sample" is an upload | B1 |
| `followOpen` (`files.ts:96-113`) | B1 |
| "Reload from the run" (`editor/banners.tsx:49-53`) | S1 moves it to `files.ts`; S2 puts it in a turn |
| `deleteAll`'s list (`files/actions.ts:149-152`); the first visit's `put` (`sample.ts:27-29`) | S2, first half |

- **Why.** A queue per operation holds every Save while an upload's clash dialog is open. Today's two chains do not
  know each other, so an upload is ordered against nothing but other uploads.
- **Against.** Rule 3 is a convention that no type holds: a nested turn hangs silently. Section 7's order tests are
  its net. The worker's writes at the end of a run are not turns (SPEC section 7 orders them).

## 4. Modules, exports, signals

| Module | Signals it owns | Exports | Item |
|---|---|---|---|
| `editor/documents.ts` (new) | the records; `tabs`, `activeTab`, `selection` | `addText(path, text)`, `addDta(path)`, `activate(path)`; `close(path)`, `askClose(path)`, `closeUnder(top)`; `moved(from, to)`, `retype(path, text)`, `reload(path, text)`, `ranOver(path, text)`; `save(path?)`; `stateOf(path)`, `textOf(path)`, `savedIsText(path)`, `update(path, spec)`, `edited(state)`; `attachView(surface)` | S1 |
| `files/turns.ts` (new) | none | `fileTurn(fn)`; then `serial()` and the type `Writer` | S1 moves `fileTurn` as it is; S2, first half, adds the rest |
| `files/open.ts` | none | as today; it calls `addText`, `addDta`, `activate` | S1 edits it |
| `files.ts` | `files`, `hasFiles`, `fresh`, `persisted` | as today, and `reloadFromStore(path)` (new) | S1 |
| `files/ops.ts` (new) | none | `renameEntry`, `createEntry`, `deleteEntries`, `deleteAll`, `zipFolder`, `downloadEntry`, `NEW_NAMES` | S2, second half |
| `files/upload.ts` (new) | the clash being asked | `upload`, `clashNow`, `answerClash`, `WORDS`; the types `Incoming`, `ClashNow`, `ClashAnswer`, `WordsOf` | S2, second half |
| `files/intake.ts` (new) | none | `fromFileList`, `entriesOf`, `fromDrop` | S2, second half |
| `files/rename.ts` (new) | `renaming` | `startRename`, `startDraft`, `endRename` | S3 |
| `files/tree-state.ts` (new) | `folded`, `rovingPath`, `currentDir`, `focusWanted` | `toggle`, `unfold`, `focusRow`, `focusTree`, `rove`, `newFileDir` | S3 |

- `files/actions.ts` ends with S2's second half. Its tab functions (`closeTab`, `askCloseTab`, `closeUnder`) are the
  owner's from S1 on, so the proposal's four-way split has no "tabs" module: it is three ways.
- In a new module, an export that carries a name from today's code is that function, moved. New in the owner:
  `addText`, `addDta`, `activate`, `askClose` (today's `askCloseTab`), `moved`, `retype`, `stateOf`, `edited` and
  `attachView`.
- `moved` takes a file or a folder and moves every record under it. `retype` changes a tab's kind in its place after
  a rename (`text` null: a `.dta` tab), where `reopenAs` closes and opens again.
- The owner imports neither `files/actions.ts`, `files/open.ts` nor `run.ts`: each imports it, or will. That is why
  `fileTurn` moves first, and why `reloadFromStore` sits in `files.ts` beside `textInStore`.

**The layout R7r applies to `state.ts` (decision 5).** One state module per owner, in `state/` (new); `state.ts` is
deleted. 37 source files and 4 test files import it at f947053; their import lines change.

| Module | Signals | Written by |
|---|---|---|
| `state/engine.ts` | `engine`, `graphicsPart`, `isolated` (nothing writes it today); the constant `engineBytes` | `engine.ts`, through `engineWriter` and `graphicsWriter` |
| `state/files.ts` | `files`, `hasFiles`, `fresh`, `persisted` | `files.ts`, through `filesWriter` |
| `state/run.ts` | `log`, `lastRun`, `engineRuns`, `history`, `results`, `macros`, `data`, `rows`, `memory`, `graphs`; `graphIndex`, `graphFull` | `run.ts`, through `runWriter`; `selectGraph`, `showFullSize` (new, S6) |
| `state/layout.ts` | `layout`, `isPhone`, `phoneTab`, `outputTab`, `split`, `wrap` | its own functions: `showOutput` (new), `setSplit`, `toggleWrap` (S5; the last two are in `App.tsx:170-180` today); `showPhone` (new, S6); `setLayout` (new, R7r) |
| `state/notices.ts` | `dialog`, `banners`, `toast`, `toastError`, `announce` | its own functions: `openDialog`, `closeDialog` (new, S6); `addBanner`, `dismiss`, `showToast`, `holdToast`, `say` as today |
| `state/saved.ts` | none | `saved` (localStorage) |
| `theme.ts` (exists) | `theme`, `resolvedTheme` | `cycleTheme`, as today |
| `output/view.ts` (exists) | gains `pickedVar` | the Data tab |

- A state module imports only types, the signals package and other state modules, so no controller cycle passes
  through one. Every signal is exported `ReadonlySignal`: the writable signal under a narrower type (as `state.ts:50`),
  not a computed over it. A signal a controller writes sits in a writer object that only its state module and that
  controller name, as today (`web/test/imports.test.ts:397-410`); the others are written by their module's functions.
  `editor/documents.ts` is the exception: its signals are computeds over private records, so they stay with it.
- The signals become read-only item by item, each with its owner function, written in `state.ts` until R7r: S1
  `tabs`, `activeTab`, `selection`; S5 `split`, `wrap`, `outputTab`; S6 `dialog`, `phoneTab`, `graphIndex`,
  `graphFull`; R7r `layout`, `theme`, `pickedVar`, `isolated`. Otherwise R7r moves text only.
- **Why.** The import line says who owns a signal, and N1's path table can state the rule by folder. **Against.**
  `web/CLAUDE.md`'s rule "One module of signals" and SPEC section 8 are rewritten, and 41 files change an import. The
  alternative keeps `state.ts` as a file of re-exports: no importer changes, and the file goes on saying the signals
  have one home.

## 5. What a view may call, and `editorCommands` (decision 6)

A view reads any exported signal and calls the exported functions of the owners and controllers. It may keep signals
of its own in a `.ts` beside it when no controller, test or hook needs them (`output/view.ts` is the model;
`focusWanted`, which the hook reads, goes to `files/tree-state.ts`). It assigns no shared signal (that stops compiling
as each export becomes `ReadonlySignal`), calls no write method of the store, and keeps no document's state.

After S1, `editorCommands` holds only the calls into the mounted Editor:

| Today (`editor/commands.ts:24-65`) | After S1 |
|---|---|
| `open`, `reload`, `ranOver`, `renamed`, `closed` | Functions of `editor/documents.ts` (`renamed` and `closed` become `moved` and `close`). |
| `save` | `save` of `editor/documents.ts`, imported by its callers (`editor/RunControls.tsx:148`, `files/EditorTabs.tsx:144`, `files/dialogs.tsx:157`, `editor/Editor.tsx:425`). It needs no mounted view. |
| `runFile`, `runSelection`, `focus`, `goToLine` | Stay, filled at mount; "call through the object, never destructure" stays for these four. S6's focus-target registry then replaces `focus`. |

`textOf` and `savedIsText` come from the owner, not from `editor/Editor.tsx` (`editor/banners.tsx:11`). `editorAsked`
and `codeOf` stay in `editor/commands.ts`. The three writes of `activeTab` in `files/EditorTabs.tsx` become `activate`.
The two run calls stay because an owner that imported `run.ts` would close a cycle (`run.ts` imports `files.ts`).

- **Why.** The object exists so that the file code can call an editor that is a view. With the owner in a `.ts`, the
  file code and the Node tests call it directly, and nothing waits for a mount.
- **Against.** The Node tests' recorder of editor calls goes (section 7), and two ways into the editor remain until
  S6.

## 6. The e2e hook

`main.tsx:70-87` hands the specs the whole module as `state`; they name `state.<x>` 179 times in 12 files at f947053
(`grep -roE 'state\.[A-Za-z]+' web/e2e`; rule 7's re-check at e711ba0 counted 198 with another pattern).

**The hook keeps one `state` object with every name the specs use, built by one function, `hookState()` (new), in a
`.ts` file** (N3's hook module, if it is one). From S1 on it is the `state.ts` module plus the owner's `tabs` and
`activeTab`; after R7r, the state modules plus those. A Node test lists the names the specs use and fails when one is
missing, so a move alone breaks no read. Three uses change meaning in S1. Each becomes a named helper in lane b's file
(rule 9), built from the owner's exports, with no door made for tests:

- `state.setDirty(path, true)` (`web/e2e/files.spec.ts:45-46`): a dot cannot be set. The helper edits with `update`.
- Assignments to `state.tabs.value` and `state.activeTab.value` (`web/e2e/shell.spec.ts:306-307, 368-369`;
  `web/e2e/output.spec.ts:106, 131, 535`): a computed cannot be assigned. The helper opens tabs with `addText`,
  `addDta` and `activate`. The unsaved text tab with no document that `web/e2e/shell.spec.ts:368` seeds cannot exist:
  its helper gives it a document and an edit.
- Assignments to the hook's `selection.value` (`web/e2e/shell.spec.ts:308, 370`): a selection made with `update`.

Reads of `tabs[].dirty`, `activeTab` and `graphIndex` keep their shape. Writes to the signals that S5, S6 and R7r make
read-only keep working at run time (the same objects); their helpers call the owner function once it exists. The
hook's other keys do not change; `selection` and `focusWanted` come from their new modules. N3 is not merged at
f947053, so its helper names are not known here.

- **Why.** No spec changes for a move, and the three that must change are named before S1 starts.
- **Against.** `state` stays a namespace that nobody designed; making it a small named surface is R6, which is not in
  the plan.

## 7. Node tests that must exist before a view loses its logic

In the same pull request as the move, passing against the new module before the view's code goes.

| Item | Loses logic | Tests |
|---|---|---|
| S1 | `editor/Editor.tsx`: open, reload, run-over, rename, close, Save | On the real owner and the real store over fake-indexeddb, no view. (1) One test per row of "What each event does" (`docs/web-page-flows.md`, section 3) that needs no view, asserting the text, the saved text, the form, the dot, the banners and the stored bytes. (2) Rename against Save, delete against Save, a Save that answers after a rename (what `web/e2e/editor.spec.ts:403` holds in a browser). (3) A run against unsaved edits, through `afterRun`. (4) The dot is derived: a second keystroke leaves `tabs` unchanged; undoing to the saved text clears it. (5) A file opened before `attachView` gets the view's extensions. The tests that record `editorCommands` calls (`web/test/files-ui.test.ts:24-30`) assert the records instead, each replaced assertion named in the pull request. |
| B1; S2, first half | nothing (order) | Failing first: Save against an upload's replace of the open file (03-F1), `createEntry` against an upload (03-F4), Save against `followOpen` (03-F5). Then: an open clash dialog holds no Save; a turn that rejects does not stop the next (exists, `web/test/files-ui.test.ts:280`); the store applies and answers in the order called (02-F10). |
| S3 | `files/FilesPane.tsx:110-230`: rename and drafts | `files/rename.ts`, the focus read as the values of `focusWanted` and `rovingPath`: Enter with a good name; a name problem keeps the field; "already exists" from the store; Esc; leaving a draft writes the free default and says so; Enter then the blur (the `ending` guard); another field started meanwhile (`renaming.id`). |
| S5 | `runText` in `log/LogView.tsx`; `toggleWrap`, `setSplit` in `App.tsx` | `runText` as a pure function: the graph links, the unsaved-do notes, the phone hints, the wide-table hint, the jump, the end notes. `setSplit` and `toggleWrap`: the signal, localStorage, `outputTab`. Scroll-follow needs a DOM: its net is e2e, with N6's streamed-run test. |
| S6 | the roving keys of `files/EditorTabs.tsx` and `ui/Tablist.tsx`; the writers of `dialog`, `phoneTab`, `graphIndex` | The roving rule as a pure function (key, place, count: the next place). `closeDialog` closes only its own dialog. `selectGraph` still shows its graph after the oldest drops. The focus-target registry, if it is a `.ts`. The modal trap needs a DOM: e2e. |
| R7r | nothing | `hookState()` has every name the specs use; N1's architecture tests. |

## 8. Room for remembering the open tabs

**Remembering the open tabs across reloads** (`docs/phase2-plan.md`, "Later UI work", item 8) is not built here. Its
place is `editor/documents.ts`: the tab list is one private list, so one effect there sees every change it would save
(the paths, their kinds, the active one). Restoring is `openFile` for each path in order, then `activate`; `openFile`
already opens nothing for a file that is gone (`files/open.ts:54-60`). Only the tab that holds the lock saves and
restores: where `own` unblocks the store (`files.ts:41-52`), beside the first visit's sample. Where it is kept
(localStorage or the store) stays that item's open choice; nothing here depends on it. Unsaved text across a reload is
not part of it.

## 9. Evidence

**The experiment: does `editor/cm.ts` load under Node?** Node v26.10.0 (CI uses 26). The scripts are outside the
repository; the builder's report quotes them.

- As it is, no. `node try-1-cm-as-is.mjs <web>` imports the file and gets `ERR_IMPORT_ATTRIBUTE_MISSING`: the module
  `web/src/stata/commands.json` "needs an import attribute of type: json" (`web/src/stata/language.ts:5`).
- With that line changed, in a copy of `web/src`, yes. `node try-2-cm-patched.mjs <copy>` loads it, builds the state
  of `stateFor` (`editor/Editor.tsx:96-112`) for six kinds of file, and applies an edit, the run and error marks, a
  selection, a rename's language change and the wrap setting, with no `document` or `window`. `tsc --noEmit` passes on
  the copy. The update listener is never called without a view, so a Node test changes a document through `update`.
- `EditorView.prototype.scrollSnapshot` is a function in the installed `@codemirror/view`. Loading `editor/cm.ts`
  after `state.ts` costs about 30 ms (three runs: 34, 28, 29).
- Not tried: a Vite build and Biome on the changed line (`web/vite.config.ts:31` and `web/test/site.test.ts:39` use the
  attribute already); `scrollSnapshot` on a tab whose pane is hidden (S1's last item tries it in a browser); the
  store's answer order, read from `web/src/engine/store.ts` and not run.

**The reports against the code at f947053** (`docs/archive/web-audit-surveys/`; the code is followed). 05 left "Node
must load cm.ts" untried: tried, above. 05-F1 counts five `setDirty` sites: the code has four calls
(`editor/Editor.tsx:92, 275, 304, 321`). 06-F14 says `FileBar` and `FilesPane` call the store directly: they read it
(`files/FileBar.tsx:25`) and test `store.blocked` (`files/FilesPane.tsx:121, 577`); the only store write in a view is
Save. 03 left open what drives the Editor's `mount`: a `useEffect` (`editor/Editor.tsx:493`), after the first paint.
03-F7, 03-F9 and the plan's "179 times in 12 files" hold. The engine files changed since the reports are not relied on.
