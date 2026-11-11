// STEP 4a: the dialogs of the file panel (docs/design/SPEC.md, section 3.10), each drawn with ui/Dialog.tsx while
// `dialog` holds its kind; set `dialog.value = null` to close it. dialogs.tsx (in app/) maps each kind to its view.
//  - ClashDialog { d: "clash", path, index, total }: "data/wages.dta is already here" (role alertdialog; "Keep mine" focused).
//    "Replace with uploaded" over an open file: store.write, then editorCommands.reload(path, text).
//  - DeleteDialog { d: "delete", paths }: "Delete clean.do?" (Cancel focused; Delete is .btn.stop.live).
//  - DeleteAllDialog { d: "delete-all", count }: the head menu's "Delete all files…" (words decided, SPEC 3.10): title
//    "Delete all 12 files?" (`count`: the files that are not folders), body "This removes every file dofile keeps in this
//    browser. It can't be undone." / Cancel (focused), "Delete all" (.btn.stop.live).
//  - CloseTabDialog { d: "close-tab", path }: closing a tab with unsaved edits (words decided, SPEC 3.10): title "Save
//    changes to clean.do?" (the file's name) / Save (focused), "Don't save", Cancel; Esc is Cancel. Save: await
//    editorCommands.save(path), then close the tab (it stays open when save resolves false); Don't save: close the tab
//    (editorCommands.closed(path) drops the edits). No tab is dirty before 4b's editor exists: 4a's tests make one with
//    state.js setDirty(path, true).
// The host draws a new dialog for each new value (clash 2 after clash 1); a view unmounted with no answer (another dialog
// replaced it) answers Cancel: Esc's meaning (for a clash, "keep yours for every remaining clash").
import type { DialogOf } from "../dialogs";

export const ClashDialog = (_: { dialog: DialogOf<"clash"> }) => null;
export const DeleteDialog = (_: { dialog: DialogOf<"delete"> }) => null;
export const DeleteAllDialog = (_: { dialog: DialogOf<"delete-all"> }) => null;
export const CloseTabDialog = (_: { dialog: DialogOf<"close-tab"> }) => null;
