// What the other parts ask of the editor (docs/design/SPEC.md, section 4). Editor.tsx replaces each function when it
// mounts; until then they do nothing, so the shell runs without an editor. The file list owns `tabs` and `activeTab`
// and calls open, reload, renamed and closed so the editor's state follows the tab; the editor owns each open file's
// text and the unsaved dot.
//
// Call through the object (`editorCommands.save(path)`), never destructure it or keep a field
// (`const { save } = editorCommands`): the copy would keep the no-op.
import { signal } from "@preact/signals-core";
import type { RunHead } from "../types.ts";

/** The code each run of the editor sent, by its head (the object run.ts keeps in the run-head item). The log needs the
 *  lines that were sent to put each graph's link after the echo of its line (log/align.ts). */
export const codeOf = new WeakMap<RunHead, string>();

/** The selected lines of the active editor tab, 1-based and whole, or null with no selection. Run selection is enabled
 *  only with one. */
export const selection = signal<[number, number] | null>(null);

/** A request the Editor takes from its own render, once the page has drawn (docs/web-page-flows.md, section 1): `{}`
 *  for the editor's focus (the engine's dialog gone), `{ path, line }` for Go to line (the phone's Editor view shown).
 *  It ends there, taken or not. */
export const editorAsked = signal<{ path?: string; line?: number } | null>(null);

export const editorCommands = {
  /** Run: the whole text of `path` (default: the active tab), saved or not, with no locals (fresh_locals). */
  runFile(_path?: string) {},
  /** Run selection: the selected lines, keeping the locals of earlier runs. */
  runSelection() {},
  /** Save `path` (default: the active tab). Resolves true once saved, false when not (no such tab, the store refused:
   *  the save-failed banner says why). */
  save(_path?: string): Promise<boolean> {
    return Promise.resolve(false);
  },
  /** Put the focus in the editor, at once. */
  focus() {
    ((globalThis.document?.querySelector("[data-editor]") ?? null) as HTMLElement | null)?.focus();
  },

  /** A text file was opened (its tab is in `tabs`; `text` is its strict UTF-8 decoding): make its editor state. */
  open(_path: string, _text: string) {},
  /** The store's copy of an open file was replaced (an upload over it, "Replace with uploaded"): show `text`; unsaved
   *  edits are dropped and the dot cleared. */
  reload(_path: string, _text: string) {},
  /** A run rewrote the open text file `path`; `text` is the store's version, or null when it is not text. Answers what
   *  the editor did:
   *  - "same": nothing changed (the run wrote the saved text again, or no such file is open), or the run wrote the
   *    editor's own text over edits: the tab is clean again and its run-changed banner goes;
   *  - "shown": no unsaved edits, so the run's text is shown, keeping the caret, the selection and the undo history;
   *  - "kept": unsaved edits, or a version that is not text: the editor keeps its text and takes the run's version as
   *    the saved one, so the tab stays unsaved and Save replaces the run's version knowingly. The caller then adds the
   *    run-changed banner.
   *  Not `reload`, which drops edits. */
  ranOver(_path: string, _text: string | null): "same" | "shown" | "kept" {
    return "same";
  },
  /** An open file was renamed or moved (a folder's rename calls it once for each open file under it): the editor keeps
   *  its text, edits and undo under the new path. The tab's path has already changed. */
  renamed(_from: string, _to: string) {},
  /** A tab was closed (the close-tab dialog's "Don't save" too: its edits go with it) or its file was deleted: drop its
   *  state. The tab has already been removed. */
  closed(_path: string) {},
  /** Make `path` (default: the active tab) the active tab, opening it when it is not open, put the cursor on line
   *  `line` (1-based), scroll it into view and focus the editor. */
  goToLine(_line: number, _path?: string) {},
};
