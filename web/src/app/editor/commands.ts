// What the other parts ask of the editor's view (docs/design/SPEC.md, section 4). Editor.tsx replaces each function
// when it mounts; until then they do nothing, so the shell runs without an editor. The tabs and their documents are
// editor/documents.ts's, which needs no view.
//
// Call through the object (`editorCommands.runFile(path)`), never destructure it or keep a field
// (`const { runFile } = editorCommands`): the copy would keep the no-op.
import { signal } from "@preact/signals-core";

import type { RunHead } from "../types.ts";

/** The code each run of the editor sent, by its head (the object run.ts keeps in the run-head item). The log needs the
 *  lines that were sent to put each graph's link after the echo of its line (log/align.ts). */
export const codeOf = new WeakMap<RunHead, string>();

/** Go to line, taken by the Editor from its own render, once the page has drawn (the phone's Editor view shown). It ends
 *  there, taken or not. The editor's focus is the registry's target `editor` (ui/focus-targets.ts). */
export const editorAsked = signal<{ path: string; line: number } | null>(null);

export const editorCommands = {
  /** Run: the whole text of `path` (default: the active tab), saved or not, with no locals (fresh_locals). */
  runFile(_path?: string) {},
  /** Run selection: the selected lines, keeping the locals of earlier runs. */
  runSelection() {},

  /** Make `path` (default: the active tab) the active tab, opening it when it is not open, put the cursor on line
   *  `line` (1-based), scroll it into view and focus the editor. */
  goToLine(_line: number, _path?: string) {},
};
