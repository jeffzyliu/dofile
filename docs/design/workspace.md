# The workspace: owners, order and modules

Design note S0 of the web audit (`docs/web-audit-plan.md`, section 6): who owns the file list, the tabs, each open
document and its saved text, and in what order the page writes files. S1, S2, S3, S5, S6 and R7r are built from it; it
changes no code. **Status: proposed 2026-11-16. Approved by the maintainer 2026-11-16: choices a, b, c (R7r deletes `state.ts`;
`hookState()` gathers the signals for the e2e hook), d, and decision 4. Decision 2 (the open documents) settled 2026-11-17:
the shape and the Save rule are in sections 2 and 3, so S1 may start.** Read from the code at f947053. Paths are under `web/src/app/` unless they start with `web/` or `docs/`; "(new)"
marks a name that does not exist yet.

## In short: what is to be approved

1. **Owners.** The file list stays with `files.ts`. The tabs, the active tab and every open document get one owner, a
   new DOM-free module, `editor/documents.ts`. The order of writes is a chain in `files/turns.ts`. Not one workspace
   module, and not tabs in one module with documents in another (section 1).
2. **Documents.** One record per tab. The unsaved dot, `tabs`, `activeTab` and the editor's "shown" are computed from
   the records and stored nowhere (section 2).
3. **Order.** The unit is a turn: the store calls that no question separates, and their follow-up on the documents.
   An operation that asks the visitor takes a turn per write, so an open dialog holds no Save, and each write checks
   again, in its own store transaction, what the question rested on: what changed meanwhile is asked again, never
   written blind (section 3).
4. **Graphs.** The selected graph is kept by its number, not its index (section 2).
5. **State.** `state.ts` is split into one state module per owner and deleted; the e2e hook keeps one `state` object,
   assembled from them (sections 4 and 6).
6. **`editorCommands`** keeps only the four calls that need the mounted Editor (section 5).

Found by trying: `editor/cm.ts` does not load under Node as it is; one line in another file fixes it (section 9).

**The maintainer's choices** (the rest is technical):

- a. Decision 1 itself. Recommended.
- b. Save's turn (section 3). Recommended: keep "take the text when pressed, issue the write, apply the answer later";
  nothing a visitor or a test sees changes. Or Save waits in its turn: simpler to argue, but a slow write then holds a
  rename, and both halves of the test at `web/e2e/editor.spec.ts:403` change (each renames before the write answers).
- c. R7r deletes `state.ts` and rewrites `web/CLAUDE.md`'s "State" rule (recommended), or keeps it as re-exports.
- d. The schedule, which this note changes. S1 is larger than its row: it takes `tabs` and `activeTab` from the file
  code and `files/EditorTabs.tsx`, so "owner functions for `activeTab`" leaves S6's row. A fair cut is three builder
  items: the records with the derived signals; Save and the file code's calls; the scroll snapshot. S2's split of
  `files/actions.ts` is three ways, not four. S1 also edits `web/src/main.tsx`, which lane a's S7 may touch (section 4).
  `graphIndex` joins S6. C2 and C4 (phase 1, merged 2026-11-17) moved names cited here (`decodeText` stays in `files/open.ts`; the import cycles are gone): rule 7's re-check
  before S1 settles them.

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

**One record per tab, with identity. The path is a field; the owner keeps nothing else by path.** Both types are new.
Banners and the run marks are keyed by path: who follows them is below.

```ts
interface Doc {                          // one record per tab, for its whole life; never copied. A Signal is what the computeds read
  path: Signal<string>;                  // a rename changes it
  content: Signal<TextPart | DtaPart>;   // a retype, a reload, or a run's text shown swaps the part; the record stays
}
interface TextPart {                     // a text tab's document; a new one at every swap, so its identity says "this document"
  kind: "text";                         // the tag of the union
  state: Signal<EditorState>;            // always current, shown or not
  saved: Signal<string | null>;          // the store's text in the editor's form; null: the store's version is not text
  form: FileForm;                        // line break and BOM, as Save writes them; no computed reads it
  dirty: ReadonlySignal<boolean>;        // computed: the text differs from `saved` (always, when `saved` is null)
}
interface DtaPart { kind: "dta" }         // nothing else: a .dta tab has no document
// The scroll snapshot lives on the record (`scroll`, null: the top), taken when the tab is hidden: a reload keeps
// it, a retype resets it (SPEC 3.2).
interface EditorSurface {                // what Editor.tsx hands attachView() at mount; a Node test hands none
  extensions: Extension;                 // what needs the view: the key bindings, the listener that calls edited()
  show(state: EditorState | null, scroll: StateEffect<unknown> | null): void; // null: the empty view
  dispatch(spec: TransactionSpec): void; // a change to the shown state; the listener then calls edited()
  scrollSnapshot(): StateEffect<unknown> | null; // null: the top; while the pane is hidden, the last place seen
}
```

**The shape, settled 2026-11-17 (decision 2).** One record per tab for its whole life: `path` and `content`, as above. A
holder that wants the tab holds the record; a holder that wants the document holds the part it took. **Staleness is the
identity of the part:** a holder compares the part it took with `content.peek()` and drops its work when they differ. There
is no counter. A retype to or from `.dta`, a reload, and a run's text shown each swap in a new part (a part is replaced
where it would have been rewritten in place); a close drops the record. A new content kind is a new member of the `Part`
union, not a new field. S1's reviewer lists every place that holds a `Doc` across an await and checks that each handles a
close, and S1 tests a pending Save while a rename retypes the same tab.

**The spike's evidence** (`spike/doc-shape`, a local branch kept for S1: 86dacb7 and 80390f9; reports of the audit's
session 2, read by two reviews). It built three shapes over one API and one suite (17 tests, 51 runs): the union
`TextDoc | DtaDoc`; `kind` as a signal with a counter bumped at five places; and one record per tab with
`text: Signal<TextPart | null>`. All three pass every test once their replacement points are chosen; each is about 205 to
220 lines, and the computeds carry 3 or 4 guards in each. The suite includes a pending Save while a clean tab is reloaded,
while it shows a run's text, while a rename retypes it, and a keystroke after Save is pressed. None of the three gets the
in-place cases (a reload, a run's text shown) for free: each had to be chosen as a replacement point, and an in-place
`ranOver` is the natural mistake in all of them. **Limits.** The chosen `Signal<TextPart | DtaPart>` was not built: the
closest built shape has `null` where `DtaPart` stands. No view, no marks (the error and run-lines marks live in the
`EditorState`, so they follow a part's state), no banners, no scroll snapshot and no e2e were built; the turns and the store
are toys. The cost of a record replaced at every reload was reasoned, not measured. The recommendation of the second
round, about 65% for the text shape, rested on the Save rule below.

The owner keeps the records in a private `Signal<Doc[]>`, in the tabs' order, and the active one in a
`Signal<Doc | null>`. `tabs`, `activeTab`, `selection` and each `dirty` are computeds over those and the `Signal`
fields, so a rename is one write to `path`; a field written as a plain value would leave them stale.

The records are private. Readers keep today's names and shapes, read-only:

| Today | Becomes |
|---|---|
| `tabs[].dirty`, `setDirty` | `tabs` is a computed `OpenTab[]`. Each `TextPart` has a computed `dirty`: its text differs from `saved` (always, when `saved` is null). `tabs` depends on those, so it changes when a dot flips, not at each keystroke. `setDirty` goes. |
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
- **What else follows a rename or a close.** The owner's `moved` moves, and its `close` drops, each record's
  save-failed and run-changed banners and the selection run's mark (`marked`), as `renamed` and `closed` do today
  (`editor/Editor.tsx:343-347, 354, 365, 371`). `renameEntry` keeps moving the reset banner's file
  (`files/actions.ts:84-86`), and `closeUnder` keeps dropping the not-text banner (`:45`). The run and error marks
  (`followRuns`, `followErrors`, `markErrors`, `editor/Editor.tsx:207-235`) and the wrap effect (`:473-479`) move to
  the owner: they write every record's state, hidden ones too, and need no view.
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

**Update 2026-11-16.** S2 builds turn bodies as generators, run by `fileTurn`, with an async thunk as the fallback; the
plan's S2 row (`docs/web-audit-plan.md`, phase 2) has the design. The rules below stand; only how a body is written
changes. S2's first half built them: `fileTurn(body)` in `files/turns.ts` takes a `function*` over `Io`, and
the comment at the top of that file is the guide to writing one. B1 built the rest of this section: the upload's
writes, the first visit's sample and `openFile` take turns; `store.write` takes the expectation and `store.info` reads
one path. Whole uploads run on their own queue in `files/actions.ts` (`upload`); it and the turns' queue are each a
`SequentialPromiseQueue` (`files/sequential-promise-queue.ts`).
The words of a dialog asked again are the maintainer's (SPEC, "Name clash"): its title and question, not its meta line.

**The unit of order is a turn: the store calls that no question separates, and what must stay next to them. Never a
whole operation.**

1. `fileTurn(fn)` runs `fn` once every earlier turn has ended, whichever way.
2. Inside a turn: the decision (the tab's path now, whether a name is free, whether the file has unsaved edits), the
   store call, and the follow-up on the documents (rename, close, reload, run-over). A check and the write it guards
   share a turn, as in `createEntry` (`files/actions.ts:126-135`). A turn may make several store calls that no
   question separates: `deleteEntries` keeps one turn for all its paths (`:139-146`).
3. Never inside a turn: a dialog, a timer, an engine call, or another turn (it would wait for itself).
4. An operation that asks the visitor takes one turn per write. An upload's every write, and every replace with its
   reload, is a turn; the clash dialog is awaited between turns. So an open dialog holds no Save. What was checked
   before the dialog is checked again in the write's turn (below).
5. Whole uploads still run one at a time: a second `SequentialPromiseQueue`, as the turns have. It may
   wait for the visitor and takes turns; a turn never takes it.
6. A store read whose answer is applied to a document is a turn: `followOpen` (`files.ts:96-113`), "Reload from the
   run" (`editor/banners.tsx:49-53`), and `openFile`'s read with the tab it adds (`files/open.ts:56, 75-77`), so a
   replace or a rename cannot land between them. No turn calls `openFile`: `retype` takes a text read inside the
   rename's own turn, where `reopenAs` calls `openFile` today (`files/actions.ts:97, 108`).
7. One door: in `web/src/app/` the store's `write`, `mkdir`, `rename`, `remove` and `change` are called only through
   the `Io` a turn's body is given (`files/turns.ts`). A Biome rule holds it (`web/biome/architecture.grit`), with no
   exceptions.

**What a write's turn checks again after a question.** An upload decides from a listing taken before any dialog
(`files/actions.ts:272, 290-295`) and from whether the file is open with unsaved edits (`:303`); a Save, a run or
`createEntry` can change either before the write's turn. So each upload write states what it expects at its path, and
a changed answer is never a write: the turn ends without writing, and the question is asked between turns.

- A path that was free at the listing and holds a file now (`createEntry` made `untitled.do`, a run wrote it) becomes
  a clash: asked like the others, or kept with no question after Esc or "Do the same" with Keep mine. A file that holds
  the uploaded bytes counts as uploaded (`holds`), as today.
- A clash answered with Replace whose file no longer matches what the answer expected is asked again with what is there
  now. A file deleted meanwhile is written, as a free path.
- A file that has unsaved edits now, and was not asked about with them (the dialog did not say so, or "Do the same"
  with Replace skipped it), is asked again in the unsaved words (`:304`; `files/dialogs.tsx:67`).
- A folder at the path: the store refuses the write, and it counts as failed, as today.

**"Changed" is measured against what the visitor answered about.** A clash's dialog reads the file's `size` and
`mtime` when it opens, shows them and keeps them as `ClashNow.yours`; its Replace expects them. (Today `yours` is the
listing from before the first dialog, `files/actions.ts:272, 305, 309`, so a Save during an earlier dialog would be
asked about twice.) A clash that "Do the same" with Replace decided has no dialog: it expects what a listing taken when
that answer came shows, so a change made before the visitor ticked the box is covered by the answer, and one made after
is asked. A path free at the first listing expects "absent".

**The check and the write are one store transaction.** `store.write` (`web/src/engine/store.ts:208`) takes the
expectation (an info, or "absent") and, inside the transaction that writes, rejects with an error of its own (new) when
the path does not match; the turn turns that error into the question. Not the other way, making the end-of-run write a
turn: `applyRun` (the same file, `:315`) is called in the worker (`web/src/engine/worker.ts:220`), which cannot join
the page's chain, so with a fresh `list()` and then a write it could commit between them. One `info.get` also
replaces a whole-store `list()` per uploaded file. **This adds to B1** a change to `web/src/engine/store.ts` and its
tests (so B1 runs the snapshot first), and `createEntry`, whose `list()` then `write` has the same window
(`files/actions.ts:126-135`), passes "absent" for a new file.

A dialog asked again says why it is back: its meta line names the change (say, "a.do changed after you were asked"; B1
picks the words and adds them to SPEC's "Name clash" row, `docs/design/SPEC.md:297`). An earlier "Do the same" still
decides the clashes after it, and the box of the dialog asked again can replace it.

"Restore the sample" is an upload and follows the same rules. The other writes that ask first: Delete and Delete all ask
about names (`files/dialogs.tsx:84-148`), and their turn removes what the names hold then, as today; close-tab's Save is
a Save. A rename onto a name in use asks nothing: the store refuses it inside its own call
(`web/src/engine/store.ts:237`) and the field says "already exists here" (`files/FilesPane.tsx:170`). A Save over a file
a run changed asks nothing either: the run-changed banner says Save overwrites the run's version
(`editor/banners.tsx:74, 79`), a Save during a run wins by design (SPEC section 7, "A page change during a run wins"),
and Save's turn checks only its record's path.

**Save is the one turn that does not wait for its store call.** It takes its text when pressed, as today
(`editor/Editor.tsx:248`), so a keystroke typed while it waits is not saved and keeps the dot. In its turn it reads its
record's path and issues the write, and it applies the answer to the record afterwards. `web/e2e/editor.spec.ts:403`
pins this: a rename goes through while a Save's write is pending. It is safe because the record has identity, and
because the store applies and answers changes in the order called (`web/src/engine/store.ts:172-176`): a later turn's
follow-up waits for its own call, so it runs after the Save's answer. S2's test of the store's order holds that.
Identity covers a rename or a close while the write is pending, which is what `web/e2e/editor.spec.ts:419-426` holds the
answer for. A later reload or run's text is covered by the Save rule below. The alternative is choice b.

**The Save rule (approved 2026-11-17: "Q1 yes").** A reload, "Reload from the run", an upload's Replace, or a run's text
shown in the tab **cancels a pending Save of that tab**: the later action wins. The Save took its `TextPart` when pressed;
in its turn it finds that the tab's `content` is another part (or the record is gone), writes nothing, and applies no
answer and no banner. It covers a tab with unsaved edits too: "Reload from the run" is offered only for such a tab (the
run-changed banner is raised only when the run's text was kept over the edits), so that case is the main one, not an
edge. A run that keeps the visitor's edits and shows nothing replaces no part, so a Save pressed before it still writes,
as SPEC section 7 says (a page change during a run wins). **This changes today's code,** which writes in the reload and
run-shown cases (`editor/Editor.tsx:254-258` checks only the path). S1 writes the rule into SPEC and tests each case,
including a Save pressed while a reload of an edited tab waits.

Not in a turn, or not wholly, at f947053, and the item that brings each in:

| Write, or read that is applied | Item |
|---|---|
| Save, the only store write in a view (`editor/Editor.tsx:245-280`) | S1 moves it to the owner, in its turn as now |
| An upload's `put` and `reopen` (`files/actions.ts:275-286, 338, 367-373`); "Restore the sample" is an upload | B1 |
| `followOpen` (`files.ts:96-113`) | S2, first half |
| `openFile`'s read and the tab it adds (`files/open.ts:56-77`); "Restore the sample" ends with one (`sample.ts:73`) | B1; S1 has `retype` read inside the rename's turn |
| "Reload from the run" (`editor/banners.tsx:49-53`) | S1 moves it to `files.ts`; S2 puts it in a turn |
| `deleteAll`'s list (`files/actions.ts:149-152`) | S2, first half |
| The first visit's `put` (`sample.ts:27-29`) | B1, with the upload |

- **Why.** A queue per operation holds every Save while an upload's clash dialog is open. Today's two chains do not
  know each other, so an upload is ordered against nothing but other uploads.
- **Against.** Rule 3 is held by the bodies' form (a generator has nothing to await) and by `fileTurn` refusing a turn
  started inside a body; a body that calls something which starts a turn is caught only when it runs. Section 7's order tests are
  its net. The worker's writes at the end of a run are not turns (SPEC section 7 orders them); an upload's write
  checks its expectation inside its own transaction, so they cannot land between that check and the write.

## 4. Modules, exports, signals

| Module | Signals it owns | Exports | Item |
|---|---|---|---|
| `editor/documents.ts` (new) | the records; `tabs`, `activeTab`, `selection` | `addText(path, text)`, `addDta(path)`, `activate(path)`; `close(path)`, `askClose(path)`, `closeUnder(top)`; `moved(from, to)`, `retype(path, text)`, `reload(path, text)`, `ranOver(path, text)`; `save(path?)`; `stateOf(path)`, `textOf(path)`, `savedIsText(path)`, `update(path, spec)`, `edited(state)`; `attachView(surface)` | S1 |
| `files/turns.ts` (new) | none | `fileTurn(body)`, the types `Io`, `Turn`, `Issued` (on a `SequentialPromiseQueue`, as `upload` is) | S1 moves `fileTurn` as it is; S2, first half, makes it run generators over `Io`; the queue class came after B1 |
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
- `moved` takes a file or a folder and moves every record under it. `retype` swaps a tab's `content` after
  a rename (a `DtaPart` for a `.dta` tab), where `reopenAs` closes and opens again.
- The owner imports neither `files/actions.ts`, `files/open.ts` nor `run.ts`: each imports it, or will. That is why
  `fileTurn` moves first, and why `reloadFromStore` (C4 renamed `textInStore` to it; it reads the store and calls
  `reloadTab` in `files/actions.ts`) sits in `files.ts`.

**S1's other files.** `files/EditorTabs.tsx` (`activate`); `files/dialogs.tsx`, `editor/RunControls.tsx` and
`editor/banners.tsx` (they take `save`, `textOf` and `savedIsText` from the owner); `files.ts:97, 111` and `run.ts:76`
(they read `S.tabs`); `web/src/main.tsx` (the `beforeunload` read of `S.tabs` at line 61, and the hook's `state` at
line 78, section 6). The other readers of `tabs` and `activeTab` (`App.tsx`, `files/FileBar.tsx`, `files/FilesPane.tsx`,
`states/banners.tsx`) change only an import line. Lane a's S7 takes the controller's wiring, which `web/src/main.tsx:66`
calls: if S7 edits that file, the plan's After column orders the two (rule 8).

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

`web/src/main.tsx:70-87` hands the specs the whole module as `state`; they name `state.<x>` 179 times in 12 files at
f947053 (`grep -roE 'state\.[A-Za-z]+' web/e2e`; rule 7's re-check at e711ba0 counted 198 with another pattern).

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
| S1 | `editor/Editor.tsx`: open, reload, run-over, rename, close, Save | On the real owner and the real store over fake-indexeddb, no view. (1) One test per row of "What each event does" (`docs/web-page-flows.md`, section 3) that needs no view, asserting the text, the saved text, the form, the dot, the banners and the stored bytes. (2) Rename against Save, delete against Save, a Save that answers after a rename (what `web/e2e/editor.spec.ts:403` holds in a browser). (3) A run against unsaved edits, through `afterRun`. (4) The dot is derived: a second keystroke leaves `tabs` unchanged; undoing to the saved text clears it. (5) A file opened before `attachView` gets the view's extensions. The tests that record `editorCommands` calls (`web/test/files-ui.test.ts:24-30`) assert the records instead, each replaced assertion named in the pull request. Existing tests it rewrites the same way: the writes of `S.tabs.value` and `S.activeTab.value` in `web/test/files-ui.test.ts:40-41, 227, 253, 746`, `web/test/sample.test.ts:57-58, 139-140, 150-151, 161, 207, 229` and `web/test/app.test.ts:295, 1398, 1816`; `S.setDirty` in `web/test/files-ui.test.ts:234, 463, 544, 666, 687, 707, 761`; the test "setDirty sets one tab's dot" (`web/test/app.test.ts:1815`), whose `decodeText` half stays; `web/test/imports.test.ts:434-451`, which counts `tabs` and `activeTab` among the 13 writable signals of `state.ts` (S1 takes those two out; S5 and S6 the ones they make read-only, section 4). |
| B1; S2, first half | nothing (order) | Failing first: Save against an upload's replace of the open file (03-F1), `createEntry` against an upload (03-F4) and the other way round (the upload held after its listing, say on the `holds` read of an earlier clash; `createEntry` makes `untitled.do`; the upload then asks about it, and the store keeps the empty file unless the answer is Replace), a clash whose file changes while its dialog is open (asked again, not written), Save against `followOpen` (03-F5), an upload's Replace against `openFile`'s read of the same file. Then: a file that gets unsaved edits after "Do the same" with Replace is asked about; an open clash dialog holds no Save; a turn that rejects does not stop the next (exists, `web/test/files-ui.test.ts:280`); the store applies and answers in the order called (02-F10). |
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
