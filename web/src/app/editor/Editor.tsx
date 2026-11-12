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
//    clears it; a save clears it unless the text changed while it was being written.
//  - Run sends the active tab's whole text (fresh locals); Run selection its whole selected lines (OQ-21); Ctrl/Cmd+Enter
//    is the one that applies. With no text tab shown, Run says so in a toast and runs nothing. The code of each run is
//    kept by its head (commands.ts codeOf) for the log's graph links.
//  - Line marks (cm.ts): the running lines of a selection run (a whole-file run marks none: every line would be marked),
//    and the error line of the file's last run (not for Break's rc 1, whose line is the command that did not start).
//    Both move with their text while it is edited.
//  - Ctrl/Cmd+S saves the active tab wherever the focus is (the browser's own Save page is never wanted here).
//  - A file drop is the page's (4a's window listeners): CodeMirror is told it is handled (cm.ts leaveFileDrops).

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { effect, signal, untracked } from "@preact/signals-core";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "preact/hooks";
import { openFile } from "../files/open.ts";
import { baseName } from "../files/tree.ts";
import { runCode } from "../run.ts";
import { activeTab, addBanner, banners, dismiss, engine, lastRun, say, setDirty, showToast, tabs } from "../state.ts";
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

const states = new Map<string, EditorState>(); // the open text tabs' states, the shown one as it was when it was hidden
const savedText = new Map<string, string>(); // what the store has of each, as last read or saved
const scrolled = new Map<string, number>(); // where each was scrolled to
const shown = signal<string | null>(null); // the path whose state the view shows, or null (the empty view)
let view: EditorView | null = null;
let empty: HTMLElement | null = null;

const language = new Compartment(); // the file's language and its name, which change when it is renamed
const named = (path: string): Extension => [
  languageOf(path),
  EditorView.contentAttributes.of({ "data-editor": "", "aria-label": `Editor: ${baseName(path)}` }),
];

const keys = keymap.of([
  {
    key: "Mod-Enter",
    run: () => {
      runEither();
      return true;
    },
  },
  {
    key: "Mod-s",
    run: () => {
      editorCommands.save();
      return true;
    },
  },
]);

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
    ],
  });
}
const emptyState = EditorState.create({ doc: "", extensions: [EditorState.readOnly.of(true)] });

/** The state of `path` as it is now: the view's while it is shown. */
const current = (path: string) => (shown.value === path && view ? view.state : states.get(path));

/** The editor's text of an open file, saved or not (the save-failed banner's Download), or null. */
export const textOf = (path: string) => current(path)?.doc.toString() ?? null;

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

function start(code: string, head: RunHead) {
  codeOf.set(head, code);
  runCode(code, head);
}

function runFile() {
  const path = activeText();
  if (!path) {
    showToast("No file is open to run");
    return;
  }
  start(current(path)!.doc.toString(), { kind: "file", path, fresh_locals: true });
}

function runSelection() {
  const path = activeText();
  const st = path ? current(path) : undefined;
  const lines = st ? wholeLines(st) : null;
  if (!path || !st || !lines) return;
  const code = st.doc.sliceString(st.doc.line(lines[0]).from, st.doc.line(lines[1]).to);
  start(code, { kind: "selection", path, lines, fresh_locals: false });
}

/** Ctrl/Cmd+Enter: Run selection with a selection, else Run (the toolbar's chip says which). */
function runEither() {
  if (selection.value) runSelection();
  else runFile();
}

// The run's marks: a selection run's lines while it runs; the file's error line when it ends. Each effect depends on its
// one signal (`engine`, `lastRun`) and on nothing it reads while it marks: `shown` above all, or a tab switch would
// place the error again at the run's line number, not where its text has moved since.
let marked: { head: RunHead; path: string } | null = null;
function followRuns() {
  const st = engine.value;
  untracked(() => {
    const run = st.s === "running" || st.s === "breaking" || st.s === "waiting" ? st.run : null;
    if (run && marked?.head === run) return;
    if (marked && states.has(marked.path)) update(marked.path, { effects: setRunLines.of(null) });
    marked = null;
    if (!run) return;
    for (const path of states.keys()) update(path, { effects: setErrorLine.of(null) }); // a new run: the old error goes
    if (run.kind === "selection" && run.path && run.lines && states.has(run.path)) {
      marked = { head: run, path: run.path };
      update(run.path, { effects: setRunLines.of(run.lines) });
    }
  });
}
function followErrors() {
  const r = lastRun.value;
  untracked(() => {
    for (const path of states.keys()) update(path, { effects: setErrorLine.of(null) });
    if (!r || r.rc === 0 || r.rc === 1 || r.line === null || r.kind === "command" || !r.path) return;
    const st = current(r.path);
    if (st && r.line <= st.doc.lines) update(r.path, { effects: setErrorLine.of(r.line) });
  });
}

// ---- save ----

async function save(path: string | undefined = activeTab.value ?? undefined): Promise<boolean> {
  const st = path ? current(path) : undefined;
  if (!path || !st) return false;
  const text = st.doc.toString();
  try {
    await store.write(path, new TextEncoder().encode(text));
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    addBanner({ b: "save-failed", path, message });
    say(`${baseName(path)} couldn't be saved`);
    return false;
  }
  savedText.set(path, text);
  if (current(path)?.doc.toString() === text) setDirty(path, false);
  for (const b of banners.value) if (b.b === "save-failed" && b.path === path) dismiss(b);
  showToast(`Saved ${baseName(path)}`);
  return true;
}

// ---- what 4a calls ----

function open(path: string, text: string) {
  states.set(path, stateFor(path, text));
  savedText.set(path, text);
  scrolled.delete(path);
  if (activeTab.value === path) show(path);
}

function reload(path: string, text: string) {
  const fresh = stateFor(path, text);
  states.set(path, fresh);
  savedText.set(path, text);
  if (shown.value === path && view) {
    view.setState(fresh);
    selection.value = null;
  }
  setDirty(path, false);
}

function renamed(from: string, to: string) {
  const st = current(from);
  if (!st) return;
  const next = st.update({ effects: language.reconfigure(named(to)) }).state;
  states.delete(from);
  states.set(to, next);
  savedText.set(to, savedText.get(from) ?? "");
  savedText.delete(from);
  if (scrolled.has(from)) scrolled.set(to, scrolled.get(from)!);
  scrolled.delete(from);
  if (shown.value === from && view) {
    shown.value = to;
    view.dispatch({ effects: language.reconfigure(named(to)) });
  }
  if (marked?.path === from) marked = { ...marked, path: to };
  // 4a changes `activeTab` before it calls this: the editor then had no state for the new path and showed none
  if (activeText() === to && shown.value !== to) show(to);
}

function closed(path: string) {
  states.delete(path);
  savedText.delete(path);
  scrolled.delete(path);
  if (shown.value === path && view) {
    shown.value = null;
    view.setState(emptyState);
    selection.value = null;
  }
  if (marked?.path === path) marked = null;
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
 *  - the Editor pane hidden (a phone on another view): the focus does not move. */
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

/** Ctrl/Cmd+S anywhere on the page saves the active tab. */
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!view?.hasFocus) editorCommands.save(); // in the editor its own key binding has saved
  }
}

/** Make the view in `host` and fill editorCommands. Called once, when Editor mounts. */
function mount(host: HTMLElement, emptyView: HTMLElement) {
  empty = emptyView;
  view = new EditorView({ parent: host, state: emptyState });
  editorCommands.runFile = runFile;
  editorCommands.runSelection = runSelection;
  editorCommands.save = save;
  editorCommands.focus = focus;
  editorCommands.open = open;
  editorCommands.reload = reload;
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
