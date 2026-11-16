# 03: Controllers, state and asynchronous ordering (web/src/app)

## 1. Covered
- **Read fully:** state.ts, types.ts, env.ts, theme.ts, store.ts, start.ts, sample.ts, run.ts, files.ts, files/actions.ts, files/open.ts, files/tree.ts, wakelock.ts, viewport.ts, kblog.ts, editor/commands.ts, test/harness.ts.
- **Read in part:** editor/Editor.tsx 225-305 and 450-480; editor/banners.tsx 40-70; main.tsx 40-75; App.tsx 340-360; engine/store.ts 165-185; files-ui.test.ts 1-53 and 280-296; app.test.ts 734-800.
- **Grepped:** test names in app, files-ui, sample and the e2e editor/files specs; who writes each plain signal; who calls the state setters; the imports between controllers; timers.
- **Not read:** app/engine.ts (another agent covers it), the views, and most test bodies.
- **Commands:** grep, sed and cat only. Nothing was run.

## 2. Shape
`state.ts` holds the signals. Writer objects guard `engine`, `runWriter` and `filesWriter`; every other signal can be written by anyone.

The controllers:
- `run.ts`: a run's log, graphs and data, through handlers that engine.ts pushes in.
- `files.ts`: lists the store, shows the storage banner, follows a run's file changes.
- `files/actions.ts`: tabs, rename/create/delete, upload with its clash-dialog protocol, drop parsing.
- `files/open.ts`: opens a file.
- `sample.ts`: seeds and restores the sample.

All of them reach the editor through `editorCommands`, whose functions do nothing until the Editor mounts.

What happens when a run ends is spread over three files but flows one way: `run.ts ended` → `files.ts afterRun/followOpen` → `ranOver`, plus Editor's `followErrors` effect.

**The risk is in `files/actions.ts` and in Save, which lives in a view (`editor/Editor.tsx:243-280`).**

## 3. Findings

| id | file:line | kind | what and why it costs | confidence |
|---|---|---|---|---|
| F1 | files/actions.ts:278,338 | bug | An upload that replaces an open file writes outside `fileTurn`, so a Save pressed during it ends with the store holding Save's text while the tab shows the upload's text, clean (the icebox case, interleaving below). | read |
| F2 | editor/Editor.tsx:240-280 | tangle | Save, the write most sensitive to ordering, lives in a view, and the Node tests stub `editorCommands`, so only e2e `editor.spec.ts:403` races a real Save against anything. | read |
| F3 | files/actions.ts:50-60, 251-268 | fragile | Two copies of one serial-chain helper (`turns`, `uploads`) that do not know each other, so an upload is ordered only against other uploads, never against rename, delete or create. | read |
| F4 | files/actions.ts:127-134 | bug | Unlikely in practice: `createEntry` sees no `untitled.do`, an upload outside the turn (its `before` list older, so no clash) writes one, and `createEntry` then overwrites it empty, breaking its own "never replace" rule. | read |
| F5 | files.ts:96-113 | suspected | `followOpen` reads the store and then calls `ranOver` outside any turn, so a Save finishing in between might leave the run's text shown clean over Save's bytes (some orders end correctly). | guess |
| F6 | engine/store.ts:172-175, actions.ts:52-55, Editor.tsx:240 | fragile | `fileTurn` is correct only while three comments are obeyed: Save's turn only issues its write, and IndexedDB runs readwrite transactions in the order they were made. | read |
| F7 | state.ts:153 (writers in 8 files) | fragile | `dialog` is writable from 8 files, so the upload's clash protocol has to watch for its dialog being replaced, with effects that dispose themselves through `queueMicrotask` (actions.ts:240-249, 318-330). | read |
| F8 | files/actions.ts:224-235, 307-320; dialogs.tsx:38 | fragile | The clash dialog's facts live in module variables read without reactivity through `clashNow()`, which works only because `now` is set before `dialog.value`. | read |
| F9 | imports.test.ts:397; state.ts:80-127 | inconsistent | "One writer per signal" is enforced only for writer objects: `phoneTab` has 6 writer files (run.ts:72 among them), `graphIndex` 4, and `activeTab` 3, including EditorTabs.tsx:47,110,161, which bypasses open.ts `show()`. | read |
| F10 | state.ts:80, 123-127; Editor.tsx:50,55 | fragile | State is kept twice: `tabs[].dirty` is stored though derived from doc ≠ `savedText`, `activeTab` duplicates Editor's `shown`, and `graphIndex` is the moving index its own comment says never to keep. | read |
| F11 | run.ts:12, open.ts:4, files.ts:8, actions.ts:9, engine.ts:29 | tangle | Import cycles: run → files → sample → open → run, and files → sample → actions → files; on the lock, engine.ts → `own()` → `seedSample` → store writes and `openFile`, a chain no single file shows. | read |
| F12 | files/actions.ts:103-117 | fragile | `reopenAs` opens the file again, then reorders `tabs` and puts `activeTab` and `phoneTab` back, undoing `openFile`'s side effects after the fact. | read |
| F13 | run.ts:139-144, 213, 226 | inconsistent | `refreshData`, `engineReady` and `moreRows` swallow every rejection as "no engine or reset" though `ClientError.kind` could tell them apart, so a real failure there is invisible. | read |
| F14 | files.ts:107,120; open.ts:25; files.ts:1-3 | chaff | The strict UTF-8 decode is written three times, "reload a tab from the store" three ways (`reopen`, `followOpen`, the banner), and the files.ts header no longer matches the code. | read |
| F15 | state.ts:51; types.ts:143; files.ts:23-26; run.ts:102 | chaff | `isolated` is a signal nothing writes, "help is P2" is left over, the `seeding`/`warned` flags patch the storage banner's timing, and `engineRuns` is a counter outside the machine. | read |

The ordering devices, one line each:
- **`fileTurn` (actions.ts:56):** protects tabs following rename and delete, Save's path, and `createEntry`'s name check. Bypassed by the upload's write and `reopen` (:278, :338), `seedSample`'s put (sample.ts:28; harmless: it runs only into an empty store with no tabs), the banner's reload (banners.tsx:50), `followOpen` (files.ts:96) and `deleteAll`'s list (:150).
  - F1's interleaving: (1) the upload issues its write; (2) Save's turn runs, since nothing holds it, and issues its write; (3) the store applies them in call order and keeps Save's text; (4) `reopen` loads the upload's text into the tab and clears its dot.
- **`uploads` (:251):** one clash dialog at a time (F3, F4).
- **`noDialog` and the effect watchers (:240, :323):** correct, but needed only because of F7.
- **`current` with the synchronous `began` contract (run.ts:43-49):** checked by a runtime throw. "engineGone before ended" is pinned by app.test.ts:791.
- **`moreRows` (run.ts:229-231):** an identity check. Sound.
- **`refresh()` (files.ts:69):** has no generation check against two lists answering out of order. Suspected only.
- **Timers:** `say()`'s 50 ms window, viewport's 300 ms `SETTLE` (measured; the browser fires no event for it), and the revoke in `saveAs`. None stands in for an app event.
- **`editorCommands` no-op window:** the Editor is always mounted (App.tsx:357). An `openFile` before `mount()` would leave a tab with no editor state. Unlikely; this rests on a comment (commands.ts:6-7).

Platform code is contained, wired only by main.tsx, and tested (app.test.ts:1973-2255, wakelock.test.ts). `revealCaret` (viewport.ts:183) reaches into CodeMirror through the DOM. kblog is kept on purpose (icebox.md:105).

## 4. Candidate work items
1. **Move Save's store write into a controller** (actions.ts or `files/save.ts`). The Editor keeps only `savedText`, the forms and the dot.
   - Size: M. Risk: med.
   - Tests: e2e editor.spec.ts:403, files-ui.test.ts:280.
   - Needs: nothing.
2. **Make `fileTurn` the one door for page writes.**
   - Turns are per write, never per upload: each upload write, and each replace with its `reopen`, takes its own `fileTurn`. Also in turns: the banner's reload, `followOpen` and `deleteAll`'s list.
   - One factory makes both chains: `uploads` keeps uploads in order among themselves, and does not join `turns` (a clash dialog would hold every Save).
   - Add an imports.test rule: store writes only inside a turn.
   - Size: M. Risk: med.
   - Tests: files-ui.test.ts 280 and 374-720, sample.test.ts, app.test.ts:1623.
   - Needs: 1.
3. **Node tests of the races**: Save vs an upload's replace, Save vs `followOpen`, `createEntry` vs an upload.
   - Size: S. Risk: low. Tests: none exist (this item adds them). Needs: 1.
4. **Split files/actions.ts** into tabs (with open.ts), fileops, upload (the clash protocol) and intake (the DOM drop helpers). One decoder, and one "reload a tab from bytes".
   - Size: M. Risk: low. Tests: files-ui.test.ts, sample.test.ts. Needs: 2.
5. **Break the import cycles**: open.ts reaches `addFileGraph` through a graphs module; main.tsx or the lock handler starts `seedSample` instead of `own()`; `saveAs` moves into a util.
   - Size: S. Risk: low. Tests: imports.test.ts, sample.test.ts. Needs: nothing.
6. **Owner functions for the shared signals**: `dialog` opens and closes through one registry, `activeTab` through `show()`, and `phoneTab` likewise. The selected graph is kept by `n`, not by index.
   - Size: M. Risk: med. Tests: app.test.ts 1549-1600, files-ui.test.ts, e2e. Needs: nothing.
7. **Decide from `kind` in run.ts's catches**: swallow `no-engine` and `reset`, log the rest.
   - Size: S. Risk: low. Tests: app.test.ts 1278, 1500, 2465. Needs: nothing.
8. **Chaff**: `isolated` becomes a const, drop "P2", fix the files.ts header.
   - Size: S. Risk: low. Tests: none needed (check only). Needs: nothing.

## 5. Redesign question
Would one serial operations queue, or a machine for file operations, make future work easier?

**For:** it would remove F1 and F3-F5 in one stroke, and a test could check who writes.

**Against a machine:**
- File operations have no state to decide.
- The store already runs transactions in call order.
- What needs ordering is each pair of a store write and its tab or editor follow-up.
- A queue per whole operation is wrong for upload: its clash dialog would hold Save for as long as the visitor hesitates.

**My answer: no machine.** Make `fileTurn` the single door for writes, one write and its follow-up per turn, after Save moves into a controller (items 1-3). Cost: about M+M+S. The risk is in the Editor's `savedText` and dot bookkeeping. I would do it now: it fixes the icebox bug and makes the area testable in Node.

## 6. What is good
- run.ts's `Requested` shape and its runtime check of the synchronous `began` contract.
- `moreRows`'s identity guard.
- The writer objects.
- The `editorCommands` seam, which lets Node tests record the editor's calls.
- tree.ts, which is pure.
- start.ts's single exhaustive switch.
- viewport.ts and wakelock.ts, which take their dependencies as parameters.
- The upload's handling of a dialog replaced under it, which is tested (files-ui.test.ts:651, 702).

## 7. Not verified
- F1 was read from the code, not reproduced. It matches icebox.md:128-132.
- F4 and F5 were not run.
- Whether IndexedDB can answer two overlapping readonly `list()` calls out of order (the `refresh` race) was not checked.
- engine.ts's writes to `dialog` were not read beyond lines 369-373.
- Whether `useEffect` or `useLayoutEffect` drives Editor's `mount()` was not checked.
- The e2e coverage of an upload over an open file is known from test names only.
- Most test bodies were not read.
