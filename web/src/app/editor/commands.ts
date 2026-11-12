// What the other parts ask of the editor: the toolbar, the phone's top bar, the keyboard, the engine
// controller (4b, step 3), the file tree and tabs (4a), the log's "Go to line" (4b) and the reset banner (4d). The editor
// (Editor.tsx, CodeMirror 6) replaces each function when it mounts and keeps `selection` current; until then they do
// nothing, so the shell runs without an editor and 4a can call them before 4b exists. Run sends the active tab's text
// through run.ts's runCode() (docs/design/SPEC.md, section 4); Save writes it with store.write and shows the toast "Saved
// <name>".
//
// Who does what with an open file:
//  - 4a owns `tabs` and `activeTab` (state.ts): it adds a tab and makes it active, closes, renames and orders tabs. It reads
//    the file and decides how it opens (files/open.ts, SPEC 3.11); for a text file it then calls open(path, text). After a
//    change to an open file in the store it calls reload, renamed or closed, so the editor's state follows the tab.
//  - 4b's editor owns each open file's text (one EditorState per tab) and the unsaved dot: it calls state.ts setDirty(path,
//    on) on an edit and after a save; reload() and closed() drop the edits.
//
// The editor fills `editorCommands` field by field when it mounts. Call through the object (`editorCommands.save(path)`),
// never destructure it or keep a field (`const { save } = editorCommands`): the copy would keep the no-op.
import { signal } from "@preact/signals-core";
import type { RunHead } from "../types.ts";

/** The code each run of the editor sent, by its head (the object run.ts keeps in the run-head item): the log puts each
 *  graph's link after the echo of its line (log/align.ts), which needs the lines that were sent. Kept only as long as
 *  the log keeps the run-head. */
export const codeOf = new WeakMap<RunHead, string>();

/** The selected lines of the active editor tab, 1-based and whole (OQ-21), or null with no selection. Run selection is
 *  enabled only with one; the phone's Run says "Run 6–7". Owner: the editor. */
export const selection = signal<[number, number] | null>(null);

export const editorCommands = {
  /** Run: the active tab's whole text, saved or not, with no locals (fresh_locals). */
  runFile() {},
  /** Run selection: the selected lines, keeping the locals of earlier runs. */
  runSelection() {},
  /** Save `path` (default: the active tab) with store.write; Ctrl/Cmd+S, the Save button, the close-tab dialog's Save.
   *  Resolves true once saved, false when not (no such tab, the store refused: the save-failed banner says why). */
  save(_path?: string): Promise<boolean> {
    return Promise.resolve(false);
  },
  /** Put the focus in the editor (after the engine's dialog closes by itself, "Go to line"). */
  focus() {
    ((globalThis.document?.querySelector("[data-editor]") ?? null) as HTMLElement | null)?.focus();
  },

  /** 4a: a text file was opened (its tab is in `tabs`; `text` is its strict UTF-8 decoding): make its editor state. */
  open(_path: string, _text: string) {},
  /** 4a: the store's copy of an open file was replaced (an upload over it, F 3.3, "Replace with uploaded"): show `text`;
   *  unsaved edits are dropped and the dot cleared. */
  reload(_path: string, _text: string) {},
  /** files.ts afterRun: a run rewrote the open text file `path`; `text` is the store's version, or null when it is not
   *  text. Answers what the editor did: "same" (the run wrote the saved text again, or no such file is open: nothing),
   *  "shown" (no unsaved edits: the run's text is shown, changed in one transaction, so the caret, the selection and
   *  the undo history are kept), or "kept" (unsaved edits, or a version that is not text: the editor keeps its text and
   *  takes the run's version as the saved one, so the tab stays unsaved and Save replaces the run's version knowingly;
   *  files.ts then adds the banner run-changed). Not `reload`, which is 4a's "Replace with uploaded". */
  ranOver(_path: string, _text: string | null): "same" | "shown" | "kept" {
    return "same";
  },
  /** 4a: an open file was renamed or moved (a folder's rename calls it once for each open file under it): the editor
   *  keeps its text, edits and undo under the new path. 4a has already changed the tab's path. */
  renamed(_from: string, _to: string) {},
  /** 4a: a tab was closed (the close-tab dialog's "Don't save" too: its edits go with it) or its file was deleted: drop its
   *  state. 4a has already removed the tab. */
  closed(_path: string) {},
  /** The log's "Go to line N" (4b) and the reset banner (4d): make `path` the active tab (opening it through files/open.ts
   *  openFile when it is not open; default: the active tab), put the cursor on line `line` (1-based), scroll it into view
   *  and focus the editor. */
  goToLine(_line: number, _path?: string) {},
};
