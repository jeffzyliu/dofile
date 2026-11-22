// The open tabs and their documents (docs/design/workspace.md, section 2): one record per tab, with no DOM; `tabs`,
// `activeTab`, `selection` and each dot are computed from the records.

import { Compartment, EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { batch, computed, effect, type ReadonlySignal, type Signal, signal, untracked } from "@preact/signals-core";
import { minimalSetup } from "codemirror";
import { baseName, movedPath, within } from "../files/tree.ts";
import { fileTurn } from "../files/turns.ts";
import { addBanner, banners, dialog, dismiss, engine, lastRun, say, showToast, wrap } from "../state.ts";
import { runOn } from "../states/predicates.ts";
import { store } from "../store.ts";
import type { OpenTab, RunHead } from "../types.ts";
import {
  languageOf,
  leaveFileDrops,
  lineMarksField,
  selectedLines,
  setErrorLine,
  setRunLines,
  wholeLines,
} from "./cm.ts";
import { type MarkChange, onLastRun, onRunStart } from "./errormark.ts";
import { editorText, type FileForm, fileText, followRun, formOf, savedForm } from "./ranover.ts";

interface TextPart {
  kind: "text";
  state: Signal<EditorState>; // always current, shown or not: the view writes it through edited()
  saved: Signal<string | null>; // the store's text in the editor's form (ranover.ts editorText); null: not text
  form: FileForm; // line break and BOM, as Save writes them; no computed reads it
  dirty: ReadonlySignal<boolean>; // the text differs from `saved` (always, when `saved` is null)
}
interface DtaPart {
  kind: "dta";
}
interface Doc {
  path: Signal<string>; // a rename changes it
  content: Signal<TextPart | DtaPart>; // a retype, a reload or a run's text shown swaps in a new part: compare by identity
  scrollTop: number; // where its text was scrolled to when it was last hidden (the view keeps it while shown)
}

/** What Editor.tsx hands attachView() when it mounts. */
export interface EditorSurface {
  /** What needs the view (the key bindings, the listener that calls edited()); every document gets them. */
  extensions: Extension;
  /** Show `state` (null: the empty view). `scroll`: where to scroll it to, or null to leave the scroll as it is. */
  show(state: EditorState | null, scroll: number | null): void;
  /** Change the shown state; the view's listener then calls edited(). */
  dispatch(spec: TransactionSpec): void;
  /** Where the shown text is scrolled to now. */
  scrollTop(): number;
}

const records = signal<Doc[]>([]); // in the tabs' order
const active = signal<Doc | null>(null);

/** The open tabs, in order, each with its unsaved dot. Changes when a dot flips, not at each keystroke. */
export const tabs: ReadonlySignal<OpenTab[]> = computed(() =>
  records.value.map((d) => {
    const c = d.content.value;
    return { path: d.path.value, kind: c.kind, dirty: c.kind === "text" && c.dirty.value };
  }),
);
/** The active tab's path, or null with no tab open. */
export const activeTab: ReadonlySignal<string | null> = computed(() => active.value?.path.value ?? null);

// the active record when it is a text tab: the one the view shows
const shownDoc = computed(() => {
  const d = active.value;
  return d && d.content.value.kind === "text" ? d : null;
});

let lastLines: [number, number] | null = null;
/** The selected lines of the shown text, 1-based and whole, or null with no selection. Run selection is enabled only
 *  with one. */
export const selection: ReadonlySignal<[number, number] | null> = computed(() => {
  const part = shownDoc.value?.content.value as TextPart | undefined;
  const lines = part ? wholeLines(part.state.value) : null;
  // the same lines keep the same array, so a keystroke that moves no line boundary changes nothing downstream
  if (lines && lastLines && lines[0] === lastLines[0] && lines[1] === lastLines[1]) return lastLines;
  lastLines = lines;
  return lines;
});

// ---- the state of a text document ----

const language = new Compartment(); // the file's language and its name, which change when it is renamed
const wrapping = new Compartment(); // EditorView.lineWrapping while the "Wrap lines" preference is on, else nothing
const viewing = new Compartment(); // the view's extensions (EditorSurface), once it is attached
const wrapExt = () => (wrap.value ? EditorView.lineWrapping : []);
const named = (path: string): Extension => [
  languageOf(path),
  EditorView.contentAttributes.of({ "data-editor": "", "aria-label": `Editor: ${baseName(path)}` }),
];

let surface: EditorSurface | null = null;

function stateFor(path: string, text: string) {
  return EditorState.create({
    doc: text,
    extensions: [
      viewing.of(surface?.extensions ?? []), // first: its keys (Ctrl/Cmd+Enter) go before minimalSetup's
      minimalSetup,
      lineNumbers(),
      highlightActiveLineGutter(),
      lineMarksField,
      selectedLines,
      leaveFileDrops,
      language.of(named(path)),
      wrapping.of(untracked(wrapExt)),
    ],
  });
}

/** A text document of `path` from the store's text `file` (its strict UTF-8 decoding, a BOM kept), or from `state`. */
function textPart(path: string, file: string, state?: EditorState): TextPart {
  const text = editorText(file); // the saved text as the editor holds it, so it compares with the document
  const st = signal(state ?? stateFor(path, text));
  const saved = signal<string | null>(text);
  // a selection or a mark changes the state, not the text: compare again only when the text or `saved` changed
  let doc: unknown = null;
  let was: string | null = null;
  let differs = false;
  const dirty = computed(() => {
    const now = st.value.doc;
    const want = saved.value;
    if (now !== doc || want !== was) differs = want === null || now.toString() !== want;
    doc = now;
    was = want;
    return differs;
  });
  return { kind: "text", state: st, saved, form: formOf(file), dirty };
}

const find = (path: string) => records.peek().find((d) => d.path.peek() === path);
const textOfDoc = (d: Doc | undefined) => {
  const c = d?.content.peek();
  return c?.kind === "text" ? c : undefined;
};
const isOpen = (d: Doc) => records.peek().includes(d);

let onView: TextPart | null = null; // the part whose state the view shows now
let viewDoc: Doc | null = null; // its record

/** Change `part`'s state by `spec`: through the view while it shows it, else in place. */
function updatePart(part: TextPart, spec: TransactionSpec) {
  if (surface && onView === part) surface.dispatch(spec);
  else part.state.value = part.state.peek().update(spec).state;
}

// ---- what the file code calls ----

/** Open a text tab of `path` with the store's text `file` (its strict UTF-8 decoding, a BOM kept), at the end. Does
 *  not make it active (activate). Nothing when `path` is open already. */
export function addText(path: string, file: string): void {
  if (find(path)) return;
  records.value = [...records.peek(), { path: signal(path), content: signal(textPart(path, file)), scrollTop: 0 }];
}

/** Open a .dta tab of `path`, at the end. Nothing when `path` is open already. */
export function addDta(path: string): void {
  if (find(path)) return;
  records.value = [
    ...records.peek(),
    { path: signal(path), content: signal<TextPart | DtaPart>({ kind: "dta" }), scrollTop: 0 },
  ];
}

/** Make the open tab `path` the active one. */
export function activate(path: string): void {
  const d = find(path);
  if (d) active.value = d;
}

/** Close the tab of `path` with no question: the tab to its right becomes active (else the one to its left). Its
 *  run-changed and save-failed banners go, and a Save waiting for its turn writes nothing. */
export function close(path: string): void {
  const list = records.peek();
  const i = list.findIndex((d) => d.path.peek() === path);
  if (i < 0) return;
  const d = list[i];
  const rest = list.filter((x) => x !== d);
  batch(() => {
    records.value = rest;
    if (active.peek() === d) active.value = rest[i] ?? rest[i - 1] ?? null;
  });
  for (const b of banners.peek()) if ((b.b === "run-changed" || b.b === "save-failed") && b.path === path) dismiss(b);
  if (marked?.doc === d) marked = null;
}

/** The ×, Delete on a tab, the phone's "Close": a tab with unsaved edits asks first (dialog close-tab); another closes.
 *  Returns true when it closed now. */
export function askClose(path: string): boolean {
  const tab = tabs.peek().find((t) => t.path === path);
  if (!tab) return false;
  if (tab.dirty) {
    dialog.value = { d: "close-tab", path };
    return false;
  }
  close(path);
  return true;
}

/** The tabs of `top` and of everything under it are closed (it was deleted), and the not-text banner under it goes. */
export function closeUnder(top: string): void {
  for (const t of tabs.peek().filter((t) => within(t.path, top))) close(t.path);
  for (const b of banners.peek()) if (b.b === "not-text" && within(b.path, top)) dismiss(b);
}

/** `from` (a file or a folder) was renamed or moved to `to`: every tab under it takes its new path, keeping its text,
 *  edits and undo. Its banners and a Save in progress follow it. Returns the tabs' new paths. */
export function moved(from: string, to: string): string[] {
  const docs = records.peek().filter((d) => within(d.path.peek(), from));
  const paths: string[] = [];
  batch(() => {
    for (const d of docs) {
      const was = d.path.peek();
      const now = movedPath(was, from, to);
      d.path.value = now;
      paths.push(now);
      const part = textOfDoc(d);
      if (part) updatePart(part, { effects: language.reconfigure(named(now)) });
      // its banners follow it
      for (const b of banners.peek())
        if ((b.b === "run-changed" || b.b === "save-failed") && b.path === was) {
          dismiss(b);
          addBanner({ ...b, path: now });
        }
    }
  });
  return paths;
}

/** The tab `path` opens another way after a rename: as text with the store's text `file`, or as a .dta (no `file`).
 *  It keeps its place and the active tab; a Save waiting for its turn writes nothing, as for a tab closed. */
export function retype(path: string, file?: string): void {
  const d = find(path);
  if (!d) return;
  if (marked?.doc === d) marked = null;
  d.scrollTop = 0;
  d.content.value = file === undefined ? { kind: "dta" } : textPart(path, file);
}

/** The store's copy of the open text file `path` was replaced (an upload over it, "Reload from the run"): show `file`;
 *  unsaved edits are dropped, the dot cleared, and its run-changed and save-failed banners go. */
export function reload(path: string, file: string): void {
  const d = find(path);
  if (!textOfDoc(d)) return; // closed, renamed or retyped meanwhile
  d!.content.value = textPart(path, file);
  // the editor has the store's text again: neither a run's banner nor a failed save's applies
  for (const b of banners.peek()) if ((b.b === "run-changed" || b.b === "save-failed") && b.path === path) dismiss(b);
}

/** A run rewrote the open text file `path`; `text` is the store's version, or null when it is not text. Answers what
 *  the tab did:
 *  - "same": nothing changed (the run wrote the saved text again, or no such file is open), or the run wrote the
 *    editor's own text over edits: the tab is clean again and its run-changed banner goes;
 *  - "shown": no unsaved edits, so the run's text is shown, keeping the caret, the selection and the undo history;
 *  - "kept": unsaved edits, or a version that is not text: the tab keeps its text and takes the run's version as the
 *    saved one, so it stays unsaved and Save replaces the run's version knowingly. The caller then adds the
 *    run-changed banner.
 *  Not `reload`, which drops edits. */
export function ranOver(path: string, text: string | null): "same" | "shown" | "kept" {
  const d = find(path);
  const part = textOfDoc(d);
  if (!d || !part) return "same";
  const r = followRun(part.state.peek().doc.toString(), part.saved.peek(), text);
  if (r.t === "same") return "same"; // rewritten with the same text: nothing changes
  const saved = text === null ? null : editorText(text);
  if (r.t === "shown") {
    // change only where the texts differ, so the caret, the selection and the undo history are kept; then a new part
    // with that state. One batch: `tabs` sees no dot in between, and the view is handed the state it already shows
    batch(() => {
      updatePart(part, { changes: { from: r.from, to: r.to, insert: r.insert } });
      d.content.value = textPart(path, text!, part.state.peek());
    });
  } else {
    part.saved.value = saved;
    // the run's rows are now the saved ones, and their form with them (not when the run wrote the editor's own rows,
    // or something that is not text)
    if (text !== null && r.dirty) part.form = formOf(text);
  }
  const dirty = r.t === "kept" && r.dirty;
  // an earlier run's banner (one that was not text, say) no longer applies
  if (!dirty) for (const b of banners.peek()) if (b.b === "run-changed" && b.path === path) dismiss(b);
  return r.t === "shown" ? "shown" : dirty ? "kept" : "same";
}

// ---- what the editor and its banners read ----

/** The state of the open text tab `path` as it is now, shown or not. */
export const stateOf = (path: string): EditorState | undefined => textOfDoc(find(path))?.state.peek();

/** The editor's text of an open file, saved or not, in the file's form (line break, BOM), as Save writes it (the
 *  save-failed banner's Download), or null. */
export function textOf(path: string): string | null {
  const part = textOfDoc(find(path));
  return part ? fileText(part.state.peek().doc.toString(), part.form, path) : null;
}

/** Whether the store's version of an open file is text, as far as the editor knows (false after a run wrote something
 *  that is not text over it; the run-changed banner says so). */
export const savedIsText = (path: string): boolean => textOfDoc(find(path))?.saved.peek() !== null;

/** Change the state of the open text tab `path` (shown or not) by `spec`. */
export function update(path: string, spec: TransactionSpec): void {
  const part = textOfDoc(find(path));
  if (part) updatePart(part, spec);
}

/** The view's state changed (its listener calls this): the shown document has it. */
export function edited(state: EditorState): void {
  if (onView && onView.state.peek() !== state) onView.state.value = state;
}

// ---- Save ----

/** Save `path` (default: the active tab): its text as it is now, written in its turn (files/turns.ts) under the tab's
 *  path then, so a rename or delete pressed before it is honoured. The later action wins (the Save rule, SPEC section
 *  4): a tab closed, retyped, reloaded or showing a run's text by then is not written, and an answer that comes after
 *  one of these is not applied. A save that answers after a rename leaves its outcome on the tab under the new name;
 *  the store has the bytes there too, as its rename is called after the write is issued. Resolves true once written,
 *  false when not (no such text tab, cancelled, the store refused: the save-failed banner says why). */
export async function save(path: string | undefined = activeTab.peek() ?? undefined): Promise<boolean> {
  const d = path ? find(path) : undefined;
  const part = textOfDoc(d);
  if (!d || !part) return false;
  const text = part.state.peek().doc.toString(); // taken now: a keystroke while it waits is not saved
  const ours = () => isOpen(d) && d.content.peek() === part; // the document it took is still the tab's
  let written = d.path.peek(); // the name the text is written under: the tab's when its turn comes
  try {
    let write = null as Promise<unknown> | null;
    await fileTurn(async () => {
      if (!ours()) return;
      written = d.path.peek();
      write = store.write(written, new TextEncoder().encode(fileText(text, part.form, written)));
    });
    if (!write) return false;
    await write;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (ours()) addBanner({ b: "save-failed", path: d.path.peek(), message });
    say(`${baseName(ours() ? d.path.peek() : written)} couldn't be saved`);
    return false;
  }
  const now = ours() ? d.path.peek() : null;
  if (now !== null) {
    // the store has `text`: it is the saved text, in the form as written (the name decided whether the BOM was dropped)
    part.saved.value = text;
    part.form = savedForm(part.form, written);
    for (const b of banners.peek()) if ((b.b === "save-failed" || b.b === "run-changed") && b.path === now) dismiss(b);
  }
  showToast(`Saved ${baseName(now ?? written)}`);
  return true;
}

// ---- the run's marks, the wrap setting ----

// The run's marks: a selection run's lines while it runs, and the file's error line (errormark.ts has the rule). Each
// effect depends on its one signal (`engine`, `lastRun`) and on nothing it reads while it marks, the shown tab above
// all: a tab switch would place the error again at the run's line number, not where its text has moved since.
let marked: { head: RunHead; doc: Doc } | null = null;
function followRuns() {
  const st = engine.value;
  untracked(() => {
    const run = runOn(st) ? st.run : null;
    if (run && marked?.head === run) return;
    const was = marked && isOpen(marked.doc) ? textOfDoc(marked.doc) : undefined;
    if (was) updatePart(was, { effects: setRunLines.of(null) });
    marked = null;
    if (!run) return;
    markErrors(onRunStart(run));
    const d = run.kind === "selection" && run.path && run.lines ? find(run.path) : undefined;
    const part = textOfDoc(d);
    if (d && part && run.lines) {
      marked = { head: run, doc: d };
      updatePart(part, { effects: setRunLines.of(run.lines) });
    }
  });
}
function followErrors() {
  const r = lastRun.value;
  untracked(() => markErrors(onLastRun(r)));
}
function markErrors({ clear, set }: MarkChange) {
  for (const d of records.peek()) {
    const part = textOfDoc(d);
    if (part && (clear === "all" || clear === d.path.peek())) updatePart(part, { effects: setErrorLine.of(null) });
  }
  const part = set ? textOfDoc(find(set.path)) : undefined;
  if (set && part && set.line <= part.state.peek().doc.lines) updatePart(part, { effects: setErrorLine.of(set.line) });
}
effect(followRuns);
effect(followErrors);
effect(() => {
  // the "Wrap lines" preference, for hidden tabs' states too
  const ext = wrapExt();
  untracked(() => {
    for (const d of records.peek()) {
      const part = textOfDoc(d);
      if (part) updatePart(part, { effects: wrapping.reconfigure(ext) });
    }
  });
});

// ---- the view ----

/** The Editor mounted: every document, open now or later, gets the view's extensions, and the view shows the active
 *  text tab from now on. Returns the detach, for the Editor's unmount. */
export function attachView(view: EditorSurface): () => void {
  surface = view;
  onView = null;
  viewDoc = null;
  for (const d of records.peek()) {
    const part = textOfDoc(d);
    if (part) part.state.value = part.state.peek().update({ effects: viewing.reconfigure(view.extensions) }).state;
  }
  const stop = effect(() => {
    const d = shownDoc.value;
    const part = d ? (d.content.value as TextPart) : null;
    untracked(() => {
      if (part === onView) return;
      // the tab hidden keeps where it was scrolled to; a part swapped in the same tab (a reload) leaves the scroll
      if (viewDoc && viewDoc !== d && isOpen(viewDoc)) viewDoc.scrollTop = view.scrollTop();
      const scroll = d && d !== viewDoc ? d.scrollTop : null;
      onView = part;
      viewDoc = d;
      view.show(part?.state.peek() ?? null, scroll);
    });
  });
  return () => {
    stop();
    if (surface === view) surface = null;
    onView = null;
    viewDoc = null;
  };
}
