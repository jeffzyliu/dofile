// The editor (docs/design/SPEC.md, sections 3.3 and 4): one CodeMirror 6 view, mounted once, and one EditorState per
// open text tab, swapped in when the tab is shown. The text lives in CodeMirror, not in a signal. mount() fills
// editorCommands.

import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { effect, signal, untracked } from "@preact/signals-core";
import { minimalSetup } from "codemirror";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { fileTurn } from "../files/actions.ts";
import { openFile } from "../files/open.ts";
import { baseName } from "../files/tree.ts";
import { requestRun } from "../run.ts";
import { startEngine } from "../start.ts";
import {
  activeTab,
  addBanner,
  banners,
  dialog,
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
import { openMenuState } from "../ui/Menu.tsx";
import {
  languageOf,
  leaveFileDrops,
  lineMarksField,
  selectedLines,
  setErrorLine,
  setRunLines,
  wholeLines,
} from "./cm.ts";
import { codeOf, editorAsked, editorCommands, selection } from "./commands.ts";
import { type MarkChange, onLastRun, onRunStart } from "./errormark.ts";
import { isRunKey, isSaveKey } from "./keys.ts";
import { editorText, type FileForm, fileText, followRun, formOf, PLAIN, savedForm } from "./ranover.ts";
import { refusedRunWords } from "./words.ts";

const states = new Map<string, EditorState>(); // the open text tabs' states, the shown one as it was when it was hidden
// What the store has of each, in the editor's form (ranover.ts editorText), so a clean tab's document equals it. Null
// when a run wrote something that is not text over it: the tab is unsaved until a save, whatever its text.
const savedText = new Map<string, string | null>();
// Each open file's form (line break, BOM), which Save writes (ranover.ts formOf). Noted when the editor takes the
// store's text; a run that writes the same rows in another form changes nothing, so the tab keeps its own.
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

// Ctrl or Cmd on every platform, not CodeMirror's "Mod" (Cmd alone on Apple devices)
const runKey = () => {
  runEither();
  return true;
};
const keys = [
  keymap.of([
    { key: "Ctrl-Enter", run: runKey },
    { key: "Meta-Enter", run: runKey },
  ]),
  // a held Ctrl/Cmd+Enter runs once: its repeats do nothing (no second run, no toast)
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

/** `path` when it is a text tab the editor has. */
function openText(path: string | null): string | null {
  return path && tabs.value.some((t) => t.path === path && t.kind === "text") && states.has(path) ? path : null;
}

/** The active tab's path when it is a text tab the editor has. */
const activeText = (): string | null => openText(activeTab.value);

/** Send a run. A `keyed` run (Ctrl/Cmd+Enter) has no disabled button to show that Run is off, so one the engine does
 *  not take (requestRun: refused) says why in a toast. */
function start(code: string, head: RunHead, keyed: boolean) {
  codeOf.set(head, code);
  if (requestRun(code, head).how !== "refused" || !keyed) return;
  const words = refusedRunWords(engine.value.s);
  if (words) showToast(words, "error");
}

/** Run a whole file: `at` (the reset banner's "Run the file again" names the file whose run it cut), or the active
 *  tab. */
function runFile(keyed = false, at?: string) {
  const path = at === undefined ? activeText() : openText(at);
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

/** Ctrl/Cmd+Enter: with no engine, what the "Start engine" button does (where it can do nothing, a toast says why);
 *  else Run selection with a selection, else Run. It runs nothing when it starts the engine, even once the engine is
 *  ready. */
function runEither() {
  const offer = startEngine();
  if (offer !== null) {
    const words = offer === "off" ? refusedRunWords(engine.value.s) : null;
    if (words) showToast(words, "error");
    return;
  }
  if (selection.value) runSelection(true);
  else runFile(true);
}

// The run's marks: a selection run's lines while it runs, and the file's error line (errormark.ts has the rule). Each
// effect depends on its one signal (`engine`, `lastRun`) and on nothing it reads while it marks, `shown` above all: a
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
  for (const path of states.keys())
    if (clear === "all" || clear === path) update(path, { effects: setErrorLine.of(null) });
  const st = set ? current(set.path) : undefined;
  if (set && st && set.line <= st.doc.lines) update(set.path, { effects: setErrorLine.of(set.line) });
}

// ---- save ----

// The saves in progress, each with the path its tab has now: renamed() moves it and closed() ends it (null). A save
// writes in its turn (fileTurn), under the tab's path then, so a rename or delete pressed before it is honoured
// (closed: nothing is written). A save that answers after a rename leaves its outcome on the tab under the new name;
// the store has the bytes there too, as its rename is called after the write is issued.
const saving = new Set<{ path: string | null }>();

async function save(path: string | undefined = activeTab.value ?? undefined): Promise<boolean> {
  const st = path ? current(path) : undefined;
  if (!path || !st) return false;
  const text = st.doc.toString();
  const at: { path: string | null } = { path };
  saving.add(at);
  let written = path; // the name the text is written under: the tab's when its turn comes
  try {
    let write = null as Promise<unknown> | null;
    await fileTurn(async () => {
      if (at.path === null) return;
      written = at.path;
      write = store.write(written, new TextEncoder().encode(fileText(text, forms.get(written) ?? PLAIN, written)));
    });
    if (!write) return false; // its tab closed while it waited (a delete): nothing to write
    await write;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (at.path !== null) addBanner({ b: "save-failed", path: at.path, message }); // not for a tab closed meanwhile
    say(`${baseName(at.path ?? written)} couldn't be saved`);
    return false;
  } finally {
    saving.delete(at);
  }
  const now = at.path; // the tab's path now, or null when it was closed while the file was written
  if (now !== null) {
    savedText.set(now, text);
    // the form as written: the name it was written under decided whether the BOM was dropped
    const form = forms.get(now);
    if (form) forms.set(now, savedForm(form, written));
    if (current(now)?.doc.toString() === text) setDirty(now, false);
    for (const b of banners.value) if ((b.b === "save-failed" || b.b === "run-changed") && b.path === now) dismiss(b);
  }
  showToast(`Saved ${baseName(now ?? written)}`);
  return true;
}

// ---- what the file list calls ----

function open(path: string, file: string) {
  const text = editorText(file); // the saved text as the editor holds it, so it compares with the document
  states.set(path, stateFor(path, text));
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
  // the editor has the store's text again: neither a run's banner nor a failed save's applies
  for (const b of banners.value) if ((b.b === "run-changed" || b.b === "save-failed") && b.path === path) dismiss(b);
}

function ranOver(path: string, text: string | null): "same" | "shown" | "kept" {
  const st = current(path);
  if (!st) return "same";
  const r = followRun(st.doc.toString(), savedText.get(path) ?? null, text);
  if (r.t === "same") return "same"; // rewritten with the same text: nothing changes
  savedText.set(path, text === null ? null : editorText(text));
  // the run's rows are now the saved ones, and their form with them (not when the run wrote the editor's own rows, or
  // something that is not text)
  if (text !== null && (r.t === "shown" || r.dirty)) forms.set(path, formOf(text));
  // no unsaved edits: change only where the texts differ, so the caret, the selection and the undo history are kept
  if (r.t === "shown") update(path, { changes: { from: r.from, to: r.to, insert: r.insert } });
  const dirty = r.t === "kept" && r.dirty;
  setDirty(path, dirty);
  // an earlier run's banner (one that was not text, say) no longer applies
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
  // its form goes with it, the BOM too: the new name decides at the next Save whether the BOM is written (dropsBom)
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
  // `activeTab` changes before this is called: the editor then had no state for the new path and showed none
  if (activeText() === to && shown.value !== to) show(to);
}

function closed(path: string) {
  states.delete(path); // the error mark, which lives in it, goes with it (errormark.ts)
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
  editorAsked.value = { path, line }; // taken once the page has drawn it
}

/** Take a request in `editorAsked`, from Editor's render: Go to line in the file shown, or the editor's focus. */
function takeAsk(ask: { path?: string; line?: number }) {
  editorAsked.value = null;
  if (ask.line === undefined) return focus();
  if (!view || shown.value !== ask.path) return;
  const n = Math.min(Math.max(1, ask.line), view.state.doc.lines);
  const at = view.state.doc.line(n).from;
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  view.focus();
}

/** Put the focus in the editor, at once, without changing the active tab or the phone's view. `[data-editor]` marks the
 *  element that takes it:
 *  - a text tab shown: CodeMirror's content;
 *  - no tab open: the empty view;
 *  - a .dta tab active: its tab in "Open files" when that is shown, else the first enabled button of its view (Load);
 *    neither is `[data-editor]`, and when neither is shown the focus does not move;
 *  - the Editor pane hidden (a phone on another view): the focus does not move, as the browser focuses nothing under
 *    `display: none`. */
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

/** Ctrl/Cmd+S anywhere on the page, the editor too, saves the active tab, once while the key is held. With a dialog
 *  open it saves nothing, so no Save begins behind a dialog that is about to decide what happens to the file. Not
 *  CodeMirror's "Mod-s": Mod is Cmd alone on Apple devices, where Ctrl+S in the editor was swallowed and saved
 *  nothing. */
function onKey(e: KeyboardEvent) {
  if (isRunKey(e)) return onRunKey(e);
  if (!isSaveKey(e)) return;
  e.preventDefault();
  if (e.repeat || dialog.value) return;
  editorCommands.save();
}

const TEXT_LESS_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/** Whether `target` takes typed text: a textarea, an input of a text-like type, or an editable element
 *  (`isContentEditable` is false under contenteditable="false", and true under an editable ancestor). A checkbox, radio
 *  or button does not. */
function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !TEXT_LESS_INPUTS.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Ctrl/Cmd+Enter anywhere on the page does what the toolbar's Run does (runEither). Not with a dialog open, and not in
 *  another text field, which keeps the key. In the editor CodeMirror's keymap has run it already. A held key runs
 *  once. */
function onRunKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || dialog.value) return;
  if (openMenuState.value) return e.preventDefault(); // an open menu: nothing runs, and its focused item is not picked
  if (isTextEntry(e.target)) return;
  e.preventDefault(); // also keeps a focused button from taking the Enter as a press
  if (!e.repeat) runEither();
}

/** Make the view in `host` and fill editorCommands. Called once, when Editor mounts. */
function mount(host: HTMLElement, emptyView: HTMLElement) {
  empty = emptyView;
  view = new EditorView({ parent: host, state: emptyState });
  editorCommands.runFile = (path) => runFile(false, path);
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
      // reads `tabs` too, for a tab that became a .dta or closed
      show(activeText());
    }),
    effect(followRuns),
    effect(followErrors),
    effect(() => {
      // the "Wrap lines" preference, for hidden tabs' states too
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
  const ask = editorAsked.value;
  useLayoutEffect(() => {
    if (ask) takeAsk(ask);
  }, [ask]);
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
