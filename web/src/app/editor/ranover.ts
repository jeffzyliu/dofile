// What a run's version of an open text file does to its tab (Editor.tsx ranOver; files.ts afterRun calls it), and the
// text the editor compares: CodeMirror keeps every line break as "\n" (doc.toString()), so a file's text is compared
// in that form, or a clean tab of a file with "\r\n" breaks would never equal its saved text. Each open file's line
// break is noted when its text is read (lineBreakOf), and Save writes the editor's text with it (fileText), so a
// "\r\n" file stays "\r\n"; a file with both kinds takes the more common one on its first Save. A new or empty file is
// "\n". Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).

/** `text` with its line breaks as the editor holds them ("\r\n" and "\r" as "\n"). */
export const editorText = (text: string) => text.replace(/\r\n?/g, "\n");

export type LineBreak = "\r\n" | "\n";

/** The line break a file's text uses: "\r\n" when it has more "\r\n" than lone "\n", else "\n" (a tie, an empty file, a
 *  file with no line break). A lone "\r" (old Mac) is not counted, so a file of those is "\n". */
export function lineBreakOf(text: string): LineBreak {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** The editor's text (line breaks "\n") as the file is written, with the line break `br`. */
export const fileText = (doc: string, br: LineBreak) => (br === "\n" ? doc : doc.replace(/\n/g, "\r\n"));

/** What the tab does with a run's version:
 *  - same: the run wrote the saved text again; nothing changes;
 *  - shown: no unsaved edits; the document changes from `from` to `to` into `insert` (one change where the two differ,
 *    so the caret, the selection and the undo history are kept), and the tab stays clean;
 *  - kept: unsaved edits, or a version that is not text; the editor keeps its text and takes the run's version as the
 *    saved one; `dirty`: whether the two differ (not when the run wrote the editor's own text). */
export type RanOver =
  | { t: "same" }
  | { t: "shown"; from: number; to: number; insert: string }
  | { t: "kept"; dirty: boolean };

/** `doc`: the editor's text; `saved`: the saved text in the editor's form (null when the store's version is not text);
 *  `text`: the run's version as the store has it, or null when it is not text. */
export function followRun(doc: string, saved: string | null, text: string | null): RanOver {
  const run = text === null ? null : editorText(text);
  if (run !== null && run === saved) return { t: "same" };
  if (run === null || doc !== saved) return { t: "kept", dirty: run === null || doc !== run };
  let from = 0;
  while (from < doc.length && from < run.length && doc[from] === run[from]) from++;
  let end = 0;
  while (end < doc.length - from && end < run.length - from && doc[doc.length - 1 - end] === run[run.length - 1 - end])
    end++;
  return { t: "shown", from, to: doc.length - end, insert: run.slice(from, run.length - end) };
}
