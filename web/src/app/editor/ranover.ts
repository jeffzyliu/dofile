// What a run's version of an open text file does to its tab (Editor.tsx ranOver; files.ts afterRun calls it), and the
// text the editor compares: CodeMirror keeps every line break as "\n" (doc.toString()), so a file's text is compared
// in that form, or a clean tab of a file with "\r\n" breaks would never equal its saved text. Each open file's form is
// noted when its text is read (formOf: its line break, and whether it starts with a UTF-8 byte order mark), and Save
// writes the editor's text in it (fileText), so a "\r\n" file stays "\r\n" and a file with a BOM keeps it; a file with
// both kinds of line break takes the more common one on its first Save. A new or empty file is "\n", without a BOM. The
// editor never holds the BOM (editorText drops it), so neither Run nor the comparisons see it. The texts given here are
// decoded with the BOM kept (files/open.ts decodeText(bytes, true)). Plain TypeScript, no DOM: tested in Node
// (test/editor.test.ts).

const BOM = "\uFEFF";

/** `text` as the editor holds it: line breaks "\n" ("\r\n" and "\r" as "\n"), and no leading BOM. */
export const editorText = (text: string) => (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n?/g, "\n");

export type LineBreak = "\r\n" | "\n";

/** The line break a file's text uses: "\r\n" when it has more "\r\n" than lone "\n", else "\n" (a tie, an empty file, a
 *  file with no line break). A lone "\r" (old Mac) is not counted, so a file of those is "\n". */
export function lineBreakOf(text: string): LineBreak {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** How a file is written: its line break and whether it starts with a BOM. */
export type FileForm = { br: LineBreak; bom: boolean };
/** A new file's form. */
export const PLAIN: FileForm = { br: "\n", bom: false };

/** The form of a file's text (decoded with its BOM kept). */
export const formOf = (text: string): FileForm => ({ br: lineBreakOf(text), bom: text.startsWith(BOM) });

/** The editor's text (line breaks "\n", no BOM) as the file is written, in the form `form`. */
export const fileText = (doc: string, form: FileForm) =>
  (form.bom ? BOM : "") + (form.br === "\n" ? doc : doc.replace(/\n/g, "\r\n"));

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
