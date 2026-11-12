// The editor (docs/design/SPEC.md, sections 3.3 and 4): one CodeMirror 6 view, mounted once (the layouts never mount it
// again), and one EditorState per open text tab, swapped in when the tab is shown. The text lives in CodeMirror, not in
// a signal. It fills editor/commands.ts field by field when it mounts (runFile, runSelection, save, focus, open, reload,
// renamed, closed, goToLine) and keeps `selection` current.
//  - What is shown follows `activeTab`: a text tab whose state exists (open() made it), else the empty view. A .dta tab
//    shows 4c's DtaView in the editor's place (App.tsx hides this one, never unmounts it).
//  - `data-editor` is on the element that takes the focus: CodeMirror's content with a file shown, the empty view
//    without one (commands.ts focus(), and the engine's dialog that closes by itself, focus there). With a .dta tab
//    active, focus() goes to that tab, or its view's Load, outside `[data-editor]` (see focus()).
//  - The unsaved dot: setDirty(path, text differs from the saved text) on each edit, so undoing back to the saved text
//    clears it; a save clears it unless the text changed while it was being written. A save that answers after its tab
//    was renamed answers for the new name (`saving`).
//  - Save keeps the file's form (ranover.ts formOf, noted at open, reload and a run's new version): its line break and
//    its UTF-8 byte order mark. The editor's text, which has "\n" only and never a BOM, is written with "\r\n" for a
//    "\r\n" file and with the BOM for a file that had one, except a .do or .ado file (fileText, dropsBom: by the name it
//    is saved under); the save-failed banner's Download too (textOf).
//    The texts compared (the dot, a run's version) and the text Run sends stay in the editor's form.
//  - Run sends the active tab's whole text (fresh locals); Run selection its whole selected lines (OQ-21); Ctrl/Cmd+Enter
//    is the one that applies (Ctrl or Cmd on every platform, as Save; held, it runs once). With no text tab shown, Run says so in a toast and runs nothing. A
//    Ctrl/Cmd+Enter the engine does not take (a run on, a start, no engine that can run) says why in a toast
//    (words.ts refusedRunWords); the buttons are disabled then. With no engine (`none`, `declined`) Run, Run selection and
//    Ctrl/Cmd+Enter open the download prompt and run nothing, now or when the engine is ready. The code of each run is kept by its head (commands.ts
//    codeOf) for the log's graph links.
//  - Line marks (cm.ts): the running lines of a selection run (a whole-file run marks none: every line would be marked),
//    and the error line of the file's last run (not for Break's rc 1, whose line is the command that did not start).
//    Both move with their text while it is edited.
//  - Ctrl/Cmd+S saves the active tab wherever the focus is, the editor too (the browser's own Save page is never wanted
//    here): one window listener, which takes Ctrl or Cmd on every platform, and S on any keyboard layout (keys.ts
//    isSaveKey); a held key saves once. Not CodeMirror's "Mod-s", whose Mod is Cmd alone on Apple devices, where Ctrl+S
//    in the editor was swallowed and saved nothing. With a dialog open it saves the active tab behind it.
//  - A file drop is the page's (4a's window listeners): CodeMirror is told it is handled (cm.ts leaveFileDrops).

import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { effect, signal, untracked } from "@preact/signals-core";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "preact/hooks";
import { openFile } from "../files/open.ts";
import { baseName } from "../files/tree.ts";
import { requestRun } from "../run.ts";
import {
  activeTab,
  addBanner,
  banners,
  dismiss,
  engine,
  lastRun,
  say,
  setDirty,
  showToast,
  tabs,
  wrap,
} from "../state.ts";
import { store } from "../store.ts";
import type { RunHead } from "../types.ts";
import {
  languageOf,
  leaveFileDrops,
  lineMarksField,
  selectedLines,
  setErrorLine,
  setRunLines,
  wholeLines,
} from "./cm.ts";
import { codeOf, editorCommands, selection } from "./commands.ts";
import { type MarkChange, onLastRun, onRunStart } from "./errormark.ts";
import { isSaveKey } from "./keys.ts";
import { editorText, type FileForm, fileText, followRun, formOf, PLAIN, savedForm } from "./ranover.ts";
import { refusedRunWords } from "./words.ts";

const states = new Map<string, EditorState>(); // the open text tabs' states, the shown one as it was when it was hidden
// what the store has of each, as last read or saved, with its line breaks as the editor holds them ("\n", no BOM:
// ranover.ts editorText), so a clean tab's document equals it; null when a run wrote something that is not text over
// it (the tab is then unsaved until a save, whatever its text)
const savedText = new Map<string, string | null>();
// each open file's form (line break, BOM), which Save writes (ranover.ts formOf): noted when the editor takes the store's
// text (open, reload, a run's version that becomes the saved one); a run that writes the same rows in another form
// changes nothing, so the tab keeps its own
const forms = new Map<string, FileForm>();
const scrolled = new Map<string, number>(); // where each was scrolled to
const shown = signal<string | null>(null); // the path whose state the view shows, or null (the empty view)
let view: EditorView | null = null;
let empty: HTMLElement | null = null;

const language = new Compartment(); // the file's language and its name, which change when it is renamed
const wrapping = new Compartment(); // EditorView.lineWrapping while the "Wrap lines" preference is on, else nothing
const wrapExt = () => (wrap.value ? EditorView.lineWrapping : []);
const named = (path: string): Extension => [
  languageOf(path),
  EditorView.contentAttributes.of({ "data-editor": "", "aria-label": `Editor: ${baseName(path)}` }),
];

// Ctrl or Cmd, on every platform (CodeMirror's "Mod" is one of them: Cmd on Apple devices, Ctrl elsewhere)
const runKey = () => {
  runEither();
  return true;
};
const keys = [
  keymap.of([
    { key: "Ctrl-Enter", run: runKey },
    { key: "Meta-Enter", run: runKey },
  ]),
  // a held Ctrl/Cmd+Enter runs once, as a held Ctrl/Cmd+S saves once: its repeats do nothing (no second run, no toast)
  Prec.highest(
    EditorView.domEventHandlers({
      keydown: (e) => {
        if (!(e.repeat && e.key === "Enter" && (e.ctrlKey || e.metaKey))) return false;
        e.preventDefault();
        return true;
      },
    }),
  ),
];

const follow = EditorView.updateListener.of((u) => {
  const path = shown.value;
  if (!path || u.view !== view) return;
  if (u.docChanged) setDirty(path, u.state.doc.toString() !== savedText.get(path));
  if (u.selectionSet || u.docChanged) selection.value = wholeLines(u.state);
});

function stateFor(path: string, text: string) {
  return EditorState.create({
    doc: text,
    extensions: [
      keys,
      minimalSetup,
      lineNumbers(),
      highlightActiveLineGutter(),
      lineMarksField,
      selectedLines,
      leaveFileDrops,
      follow,
      language.of(named(path)),
      wrapping.of(wrapExt()),
    ],
  });
}
const emptyState = EditorState.create({ doc: "", extensions: [EditorState.readOnly.of(true)] });

/** The state of `path` as it is now: the view's while it is shown. */
const current = (path: string) => (shown.value === path && view ? view.state : states.get(path));

/** The editor's text of an open file, saved or not, in the file's form (line break, BOM), as Save writes it (the
 *  save-failed banner's Download), or null. */
export function textOf(path: string) {
  const st = current(path);
  return st ? fileText(st.doc.toString(), forms.get(path) ?? PLAIN, path) : null;
}

/** Show `path`'s state (or the empty view). The shown one's state is kept first. */
function show(path: string | null) {
  if (!view || path === shown.value) return;
  const before = shown.value;
  if (before !== null && states.has(before)) {
    states.set(before, view.state);
    scrolled.set(before, view.scrollDOM.scrollTop);
  }
  const next = path !== null ? states.get(path) : undefined;
  shown.value = next ? path : null;
  view.setState(next ?? emptyState);
  selection.value = next ? wholeLines(next) : null;
  if (next) {
    const top = scrolled.get(path!) ?? 0;
    requestAnimationFrame(() => {
      if (view && shown.value === path) view.scrollDOM.scrollTop = top;
    });
  }
}

/** Change the state of `path` (shown or not) by `spec`. */
function update(path: string, effects: Parameters<EditorView["dispatch"]>[0]) {
  if (shown.value === path && view) view.dispatch(effects);
  else {
    const st = states.get(path);
    if (st) states.set(path, st.update(effects).state);
  }
}

// ---- runs ----

/** The active tab's path when it is a text tab the editor has. */
function activeText(): string | null {
  const path = activeTab.value;
  return path && tabs.value.some((t) => t.path === path && t.kind === "text") && states.has(path) ? path : null;
}

/** Send a run. `keyed`: Ctrl/Cmd+Enter, which has no disabled button to show that Run is off, so a run the engine does
 *  not take (run.ts requestRun: refused) says why in a toast, in the words of the engine's state (words.ts). One that
 *  opened the download prompt ("asked") has no toast: the prompt says why. */
function start(code: string, head: RunHead, keyed: boolean) {
  codeOf.set(head, code);
  if (requestRun(code, head).how !== "refused" || !keyed) return;
  const words = refusedRunWords(engine.value.s);
  if (words) showToast(words, "error");
}

function runFile(keyed = false) {
  const path = activeText();
  if (!path) {
    showToast("No file is open to run", "error");
    return;
  }
  start(current(path)!.doc.toString(), { kind: "file", path, fresh_locals: true }, keyed);
}

function runSelection(keyed = false) {
  const path = activeText();
  const st = path ? current(path) : undefined;
  const lines = st ? wholeLines(st) : null;
  if (!path || !st || !lines) return;
  const code = st.doc.sliceString(st.doc.line(lines[0]).from, st.doc.line(lines[1]).to);
  start(code, { kind: "selection", path, lines, fresh_locals: false }, keyed);
}

/** Ctrl/Cmd+Enter: Run selection with a selection, else Run (the toolbar's chip says which). */
function runEither() {
  if (selection.value) runSelection(true);
  else runFile(true);
}

// The run's marks: a selection run's lines while it runs; the file's error line (editor/errormark.ts says the rule). Each
// effect depends on its one signal (`engine`, `lastRun`) and on nothing it reads while it marks: `shown` above all, or a
// tab switch would place the error again at the run's line number, not where its text has moved since.
let marked: { head: RunHead; path: string } | null = null;
function followRuns() {
  const st = engine.value;
  untracked(() => {
    const run = st.s === "running" || st.s === "breaking" || st.s === "waiting" ? st.run : null;
    if (run && marked?.head === run) return;
    if (marked && states.has(marked.path)) update(marked.path, { effects: setRunLines.of(null) });
    marked = null;
    if (!run) return;
    markErrors(onRunStart(run));
    if (run.kind === "selection" && run.path && run.lines && states.has(run.path)) {
      marked = { head: run, path: run.path };
      update(run.path, { effects: setRunLines.of(run.lines) });
    }
  });
}
function followErrors() {
  const r = lastRun.value;
  untracked(() => markErrors(onLastRun(r)));
}
function markErrors({ clear, set }: MarkChange) {
  if (clear === "all") closedMarks.clear();
  else if (clear) closedMarks.delete(clear);
  for (const path of states.keys())
    if (clear === "all" || clear === path) update(path, { effects: setErrorLine.of(null) });
  const st = set ? current(set.path) : undefined;
  if (set && st && set.line <= st.doc.lines) update(set.path, { effects: setErrorLine.of(set.line) });
}
// The marks of files closed with one and no unsaved edits (errormark.ts): the line it was on, and the text it was on,
// so it comes back only on that same text.
const closedMarks = new Map<string, { line: number; text: string }>();
/** The line the error mark is on in `st`, or null. */
function errorLineOf(st: EditorState): number | null {
  const it = st.field(lineMarksField, false)?.err.iter();
  return it?.value ? st.doc.lineAt(it.from).number : null;
}

// ---- save ----

// The saves in progress, each with the path its tab has now: renamed() moves it and closed() ends it (null), so a save
// that answers after its tab was renamed leaves its outcome on the tab (the saved text, the form, the dot, the banners,
// the toast), not under the old name. The store has the bytes under the new name: its rename comes after the write.
const saving = new Set<{ path: string | null }>();

async function save(path: string | undefined = activeTab.value ?? undefined): Promise<boolean> {
  const st = path ? current(path) : undefined;
  if (!path || !st) return false;
  const text = st.doc.toString();
  const at: { path: string | null } = { path };
  saving.add(at);
  try {
    await store.write(path, new TextEncoder().encode(fileText(text, forms.get(path) ?? PLAIN, path)));
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (at.path !== null) addBanner({ b: "save-failed", path: at.path, message }); // not for a tab closed meanwhile
    say(`${baseName(at.path ?? path)} couldn't be saved`);
    return false;
  } finally {
    saving.delete(at);
  }
  const now = at.path; // the tab's path now, or null when it was closed while the file was written
  if (now !== null) {
    savedText.set(now, text);
    // the form as written: the name it was written under decided whether the BOM was dropped
    const form = forms.get(now);
    if (form) forms.set(now, savedForm(form, path));
    if (current(now)?.doc.toString() === text) setDirty(now, false);
    for (const b of banners.value) if ((b.b === "save-failed" || b.b === "run-changed") && b.path === now) dismiss(b);
  }
  showToast(`Saved ${baseName(now ?? path)}`);
  return true;
}

// ---- what 4a calls ----

function open(path: string, file: string) {
  const text = editorText(file); // the saved text as the editor holds it, so it compares with the document
  const fresh = stateFor(path, text);
  states.set(path, fresh);
  const kept = closedMarks.get(path);
  closedMarks.delete(path);
  if (kept && kept.text === text && kept.line <= fresh.doc.lines) update(path, { effects: setErrorLine.of(kept.line) });
  savedText.set(path, text);
  forms.set(path, formOf(file));
  scrolled.delete(path);
  if (activeTab.value === path) show(path);
}

function reload(path: string, file: string) {
  if (!states.has(path) || !tabs.value.some((t) => t.path === path)) return; // closed or renamed meanwhile
  const text = editorText(file);
  const fresh = stateFor(path, text);
  states.set(path, fresh);
  savedText.set(path, text);
  forms.set(path, formOf(file));
  if (shown.value === path && view) {
    view.setState(fresh);
    selection.value = null;
  }
  setDirty(path, false);
  // the editor has the store's text again: neither a run's banner nor a failed save's (its edits are gone) applies
  for (const b of banners.value) if ((b.b === "run-changed" || b.b === "save-failed") && b.path === path) dismiss(b);
}

function ranOver(path: string, text: string | null): "same" | "shown" | "kept" {
  const st = current(path);
  if (!st) return "same";
  // editor/ranover.ts decides, on the texts as the editor holds them (line breaks as "\n")
  const r = followRun(st.doc.toString(), savedText.get(path) ?? null, text);
  if (r.t === "same") return "same"; // rewritten with the same text: nothing changes
  savedText.set(path, text === null ? null : editorText(text));
  // the run's rows are now the saved ones: their form with them (not when the run wrote the editor's own rows, which
  // changes nothing the tab shows, or something that is not text)
  if (text !== null && (r.t === "shown" || r.dirty)) forms.set(path, formOf(text));
  // no unsaved edits: the run's text, changed in one transaction where the two differ, so the caret, the selection and
  // the undo history are kept
  if (r.t === "shown") update(path, { changes: { from: r.from, to: r.to, insert: r.insert } });
  const dirty = r.t === "kept" && r.dirty;
  setDirty(path, dirty);
  // the editor now has the run's version: an earlier run's banner (one that was not text, say) no longer applies
  if (!dirty) for (const b of banners.value) if (b.b === "run-changed" && b.path === path) dismiss(b);
  return r.t === "shown" ? "shown" : dirty ? "kept" : "same";
}

/** Whether the store's version of an open file is text, as far as the editor knows (false after a run wrote something
 *  that is not text over it; the run-changed banner says so). */
export const savedIsText = (path: string) => savedText.get(path) !== null;

function renamed(from: string, to: string) {
  const st = current(from);
  if (!st) return;
  const next = st.update({ effects: language.reconfigure(named(to)) }).state;
  states.delete(from);
  states.set(to, next);
  savedText.set(to, savedText.has(from) ? savedText.get(from)! : "");
  savedText.delete(from);
  // its form goes with it, the noted BOM too (the store's version has it unless a Save under a do-file name dropped
  // it): the new name decides at the next Save whether it is written (dropsBom)
  forms.set(to, forms.get(from) ?? PLAIN);
  forms.delete(from);
  // its banners follow it
  for (const b of banners.value)
    if ((b.b === "run-changed" || b.b === "save-failed") && b.path === from) {
      dismiss(b);
      addBanner({ ...b, path: to });
    }
  if (scrolled.has(from)) scrolled.set(to, scrolled.get(from)!);
  scrolled.delete(from);
  if (shown.value === from && view) {
    shown.value = to;
    view.dispatch({ effects: language.reconfigure(named(to)) });
  }
  if (marked?.path === from) marked = { ...marked, path: to };
  for (const at of saving) if (at.path === from) at.path = to; // a save in progress answers for the new name
  // 4a changes `activeTab` before it calls this: the editor then had no state for the new path and showed none
  if (activeText() === to && shown.value !== to) show(to);
}

function closed(path: string) {
  const st = current(path);
  const line = st ? errorLineOf(st) : null;
  const saved = savedText.get(path);
  if (st && line !== null && saved !== undefined && st.doc.toString() === saved)
    closedMarks.set(path, { line, text: saved });
  states.delete(path);
  savedText.delete(path);
  forms.delete(path);
  scrolled.delete(path);
  for (const b of banners.value) if ((b.b === "run-changed" || b.b === "save-failed") && b.path === path) dismiss(b);
  if (shown.value === path && view) {
    shown.value = null;
    view.setState(emptyState);
    selection.value = null;
  }
  if (marked?.path === path) marked = null;
  for (const at of saving) if (at.path === path) at.path = null;
}

async function goToLine(line: number, path: string | undefined = activeTab.value ?? undefined) {
  if (!path) return;
  await openFile(path); // opens it, or only makes it the active tab (and the Editor view on a phone)
  setTimeout(() => {
    if (!view || shown.value !== path) return;
    const n = Math.min(Math.max(1, line), view.state.doc.lines);
    const at = view.state.doc.line(n).from;
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    view.focus();
  });
}

/** Put the focus in the editor, at once, without changing the active tab or the phone's view:
 *  - a text tab shown: CodeMirror's content (`[data-editor]`);
 *  - no tab open: the empty view, "No file is open" (`[data-editor]` then);
 *  - a .dta tab active (no editor shows): its tab in "Open files" when that is shown, else the first enabled button of
 *    its view (Load); the focus is then not in `[data-editor]`, and when neither is shown it does not move;
 *  - the Editor pane hidden (a phone on another view): the focus does not move (no check here: the same element is
 *    focused, and the browser focuses none under `display: none`). */
function focus() {
  if (view && shown.value) {
    view.focus();
    return;
  }
  const active = tabs.value.find((t) => t.path === activeTab.value);
  if (!active || active.kind === "text") {
    empty?.focus();
    return;
  }
  const seen = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0;
  const tab = document.querySelector('[role="tablist"][aria-label="Open files"] [role="tab"][aria-selected="true"]');
  const button = document.querySelector(".editor-pane .dta-view button:not([disabled])");
  [tab, button].find(seen)?.focus();
}

/** Ctrl/Cmd+S anywhere on the page saves the active tab, once while the key is held (each repeat is only kept from the
 *  browser's own Save page). */
function onKey(e: KeyboardEvent) {
  if (!isSaveKey(e)) return;
  e.preventDefault();
  if (e.repeat) return;
  editorCommands.save();
}

/** Make the view in `host` and fill editorCommands. Called once, when Editor mounts. */
function mount(host: HTMLElement, emptyView: HTMLElement) {
  empty = emptyView;
  view = new EditorView({ parent: host, state: emptyState });
  editorCommands.runFile = () => runFile();
  editorCommands.runSelection = () => runSelection();
  editorCommands.save = save;
  editorCommands.focus = focus;
  editorCommands.open = open;
  editorCommands.reload = reload;
  editorCommands.ranOver = ranOver;
  editorCommands.renamed = renamed;
  editorCommands.closed = closed;
  editorCommands.goToLine = (line, path) => {
    goToLine(line, path);
  };
  const stops = [
    effect(() => {
      // the active tab (reading `tabs` too: a tab that became a .dta, or closed)
      show(activeText());
    }),
    effect(followRuns),
    effect(followErrors),
    effect(() => {
      // the preference, for every open text tab (a hidden tab's state is updated too)
      const ext = wrapExt();
      untracked(() => {
        for (const path of states.keys()) update(path, { effects: wrapping.reconfigure(ext) });
      });
    }),
  ];
  addEventListener("keydown", onKey);
  return () => {
    for (const stop of stops) stop();
    removeEventListener("keydown", onKey);
    view?.destroy();
    view = null;
  };
}

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  useEffect(() => mount(host.current!, emptyRef.current!), []);
  const none = shown.value === null;
  return (
    <div class="editor-host">
      <div class="editor-empty" ref={emptyRef} data-editor={none ? "" : undefined} tabIndex={-1} hidden={!none}>
        {"No file is open: open one from the file list."}
      </div>
      <div class="editor-cm" ref={host} hidden={none} />
    </div>
  );
}
