// The editor's CodeMirror pieces (SPEC 3.3 and 3.11): the highlighting of each kind of file, the line marks, and the
// guard that leaves a file drop to the page. Editor.tsx puts them together. The class names are ui.css's and app.css's
// (step 4b's block): tokens .k .s .c .m .num; line marks .cm-sel-line, .cm-run-line, .cm-err-line and their gutter
// numbers .cm-run-n, .cm-err-n; a .csv's columns .csv-c0 to .csv-c4 and .csv-d; a .log's lines .lg-echo, .lg-err,
// .lg-hint, .lg-note.
import { json } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { stata } from "../../stata/language.ts";
import { isTypedInput, straighten } from "../../stata/straighten.ts";
import { extOf } from "../files/tree.ts";
import { classify } from "../log/classify.ts";
import { CSV_COLORS, csvFields } from "./csv.ts";
import { lineDeleted } from "./errormark.ts";

// ---- highlighting ----

/** .md and .json (CodeMirror's packages, SPEC 3.11), on the same token classes as Stata's. */
const docStyle = HighlightStyle.define([
  { tag: [tags.heading, tags.strong, tags.bool, tags.null], class: "k" },
  { tag: [tags.string, tags.url, tags.link, tags.monospace], class: "s" },
  { tag: [tags.comment, tags.quote, tags.processingInstruction], class: "c" },
  { tag: tags.propertyName, class: "m" },
  { tag: tags.number, class: "num" },
]);

const stataStyle = HighlightStyle.define([
  { tag: tags.keyword, class: "k" },
  { tag: tags.string, class: "s" },
  { tag: tags.comment, class: "c" },
  { tag: tags.special(tags.variableName), class: "m" },
  { tag: tags.number, class: "num" },
]);

/** A view plugin that decorates the lines in view, from a function of the line's text. */
function byLine(mark: (text: string, from: number, add: (from: number, to: number, d: Decoration) => void) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const b = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges)
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos);
            mark(line.text, line.from, (f, t, d) => b.add(f, t, d));
            pos = line.to + 1;
          }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const COLS = Array.from({ length: CSV_COLORS }, (_, i) => Decoration.mark({ class: `csv-c${i}` }));
const SEP = Decoration.mark({ class: "csv-d" });
/** A .csv's or .tsv's columns, each its own color, the separators muted (P/.csv). */
const csvColumns = (sep: "," | "\t") =>
  byLine((text, from, add) => {
    let last = -1;
    for (const f of csvFields(text, sep)) {
      if (last >= 0 && f.from > last) add(from + last, from + f.from, SEP);
      if (f.to > f.from) add(from + f.from, from + f.to, COLS[f.col % CSV_COLORS]);
      last = f.to;
    }
  });

/** The line kinds of a .log (log/classify.ts), over the whole text, since a message is known by the line under it. */
const LOG_LINE = {
  echo: Decoration.line({ class: "lg-echo" }),
  err: Decoration.line({ class: "lg-err" }),
  hint: Decoration.line({ class: "lg-hint" }),
  note: Decoration.line({ class: "lg-note" }),
};
const logKinds = StateField.define<DecorationSet>({
  create: (state) => logDecorations(state),
  update: (deco, tr) => (tr.docChanged ? logDecorations(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});
function logDecorations(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  classify(state.doc.toString()).forEach((l, i) => {
    if (l.kind !== "out") b.add(state.doc.line(i + 1).from, state.doc.line(i + 1).from, LOG_LINE[l.kind]);
  });
  return b.finish();
}

/** In a Stata buffer, typed curly quotes (a phone's Smart Punctuation) become straight ones. `beforeinput`'s type says
 *  whether the keyboard typed the text or replaced a word (never a paste or a drop, which CodeMirror's own handlers take),
 *  and a change that replaces text with a curly quote in it is left alone. CodeMirror's content already says
 *  autocorrect="off", spellcheck="false", autocapitalize="off" and writingsuggestions="false". */
const straightTyping: Extension = (() => {
  let kind = "";
  return [
    EditorView.domEventHandlers({
      beforeinput: (e) => {
        kind = e.inputType;
        return false;
      },
    }),
    EditorView.inputHandler.of((view, from, to, text) => {
      const typed = isTypedInput(kind);
      kind = "";
      const fixed = straighten(text);
      const old = view.state.sliceDoc(from, to);
      if (!typed || fixed === text || straighten(old) !== old) return false;
      view.dispatch({
        changes: { from, to, insert: fixed },
        selection: { anchor: from + fixed.length },
        userEvent: "input.type",
      });
      return true;
    }),
  ];
})();

/** The language of a file, by its extension: Stata for .do and .ado, the column colors for .csv and .tsv, the log
 *  tokenizer for .log, CodeMirror's packages for .md and .json; plain text for the rest. */
export function languageOf(path: string): Extension {
  const ext = extOf(path);
  if (ext === ".do" || ext === ".ado") return [stata, syntaxHighlighting(stataStyle), straightTyping];
  if (ext === ".csv") return csvColumns(",");
  if (ext === ".tsv") return csvColumns("\t");
  if (ext === ".log") return logKinds;
  if (ext === ".md") return [markdownLanguage, syntaxHighlighting(docStyle)]; // the language alone: markdown() would bring HTML, CSS and JavaScript
  if (ext === ".json") return [json(), syntaxHighlighting(docStyle)];
  return [];
}

// ---- line marks ----

/** The lines a run is running (the accent bar), or none. They move with their text while it is edited. */
export const setRunLines = StateEffect.define<[number, number] | null>();
/** The error line of the file's last run (the red bar and tint), or none. */
export const setErrorLine = StateEffect.define<number | null>();

class NumberClass extends GutterMarker {
  elementClass: string;
  constructor(cls: string) {
    super();
    this.elementClass = cls;
  }
}
const RUN = { line: Decoration.line({ class: "cm-run-line" }), n: new NumberClass("cm-run-n") };
const ERR = { line: Decoration.line({ class: "cm-err-line" }), n: new NumberClass("cm-err-n") };

interface Marks {
  run: DecorationSet;
  err: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}
function lineMarks(state: EditorState, lines: [number, number], m: typeof RUN) {
  const deco = new RangeSetBuilder<Decoration>(),
    gut = new RangeSetBuilder<GutterMarker>();
  const last = Math.min(lines[1], state.doc.lines);
  for (let n = Math.max(1, lines[0]); n <= last; n++) {
    const at = state.doc.line(n).from;
    deco.add(at, at, m.line);
    gut.add(at, at, m.n);
  }
  return { deco: deco.finish(), gut: gut.finish() };
}
const gutterOf = (run: DecorationSet, err: DecorationSet, state: EditorState) => {
  const b: { from: number; m: GutterMarker }[] = [];
  for (const [set, m] of [
    [run, RUN.n],
    [err, ERR.n],
  ] as const) {
    const it = set.iter();
    for (; it.value; it.next()) b.push({ from: state.doc.lineAt(it.from).from, m });
  }
  return RangeSet.of(
    b.map((x) => x.m.range(x.from)),
    true,
  );
};

export const lineMarksField = StateField.define<Marks>({
  create: () => ({ run: Decoration.none, err: Decoration.none, gutter: RangeSet.empty }),
  update(marks, tr) {
    let { run, err } = marks;
    run = run.map(tr.changes);
    const at = marks.err.iter().value ? marks.err.iter().from : null; // the error line's start, before the changes
    err =
      at !== null && tr.docChanged && lineDeleted(tr.changes, tr.startState.doc, at)
        ? Decoration.none
        : err.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setRunLines)) run = e.value ? lineMarks(tr.state, e.value, RUN).deco : Decoration.none;
      if (e.is(setErrorLine)) err = e.value ? lineMarks(tr.state, [e.value, e.value], ERR).deco : Decoration.none;
    }
    if (run === marks.run && err === marks.err && !tr.docChanged) return marks;
    return { run, err, gutter: gutterOf(run, err, tr.state) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (m) => m.run),
    EditorView.decorations.from(f, (m) => m.err),
    gutterLineClass.from(f, (m) => m.gutter),
  ],
});

/** The whole lines of the selection, tinted (SPEC 3.3: selected, the soft accent). */
const SEL = Decoration.line({ class: "cm-sel-line" });
export const selectedLines = EditorView.decorations.compute(["selection", "doc"], (state) => {
  const lines = wholeLines(state);
  if (!lines) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  for (let n = lines[0]; n <= lines[1]; n++) b.add(state.doc.line(n).from, state.doc.line(n).from, SEL);
  return b.finish();
});

/** The selected lines, 1-based and whole (OQ-21), or null with no selection. A selection that ends at the start of a
 *  line (lines picked by dragging down the margin, or Shift+Down) does not take that line. */
export function wholeLines(state: EditorState): [number, number] | null {
  const r = state.selection.main;
  if (r.empty) return null;
  const a = state.doc.lineAt(r.from);
  let b = state.doc.lineAt(r.to);
  if (r.to === b.from && b.number > a.number) b = state.doc.line(b.number - 1);
  return [a.number, b.number];
}

// ---- a file drop is the page's ----

/** A drop of files anywhere uploads them (4a: window listeners in the capture phase). CodeMirror would also insert a
 *  dropped file's text: it is told the drop is handled. A drag of text inside the editor still works. */
export const leaveFileDrops = EditorView.domEventHandlers({
  drop: (e) => Boolean(e.dataTransfer?.types.includes("Files")),
  dragover: (e) => Boolean(e.dataTransfer?.types.includes("Files")),
});
