// The editor's view (docs/design/SPEC.md, sections 3.3 and 4): one CodeMirror 6 view, mounted once, which shows the
// active text tab of editor/documents.ts (attachView). mount() fills editorCommands.

import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { signal } from "@preact/signals-core";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { openFile } from "../files/open.ts";
import { baseName } from "../files/tree.ts";
import { fileTurn } from "../files/turns.ts";
import { requestRun } from "../run.ts";
import { startEngine } from "../start.ts";
import { addBanner, dialog, engine, say, showToast } from "../state.ts";
import { store } from "../store.ts";
import type { RunHead } from "../types.ts";
import { openMenuState } from "../ui/Menu.tsx";
import { wholeLines } from "./cm.ts";
import { codeOf, editorAsked, editorCommands } from "./commands.ts";
import {
  activeTab,
  attachView,
  edited,
  formAt,
  saveBegins,
  savedAs,
  saveEnds,
  selection,
  stateOf,
  tabs,
} from "./documents.ts";
import { isRunKey, isSaveKey } from "./keys.ts";
import { fileText } from "./ranover.ts";
import { refusedRunWords } from "./words.ts";

let view: EditorView | null = null;
let empty: HTMLElement | null = null;
const showing = signal(false); // the view shows a text tab (else the empty view)

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

// the shown document takes each change of the view's state
const follow = EditorView.updateListener.of((u) => {
  if (u.view === view && u.state !== u.startState) edited(u.state);
});
const emptyState = EditorState.create({ doc: "", extensions: [EditorState.readOnly.of(true)] });

/** `path` when it is an open text tab. */
const openText = (path: string | null): string | null => (path && stateOf(path) ? path : null);

/** The active tab's path when it is a text tab. */
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
  start(stateOf(path)!.doc.toString(), { kind: "file", path, fresh_locals: true }, keyed);
}

function runSelection(keyed = false) {
  const path = activeText();
  const st = path ? stateOf(path) : undefined;
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

// ---- save ----

// A save writes in its turn (fileTurn), under the tab's path then, so a rename or delete pressed before it is honoured
// (closed: nothing is written). A save that answers after a rename leaves its outcome on the tab under the new name;
// the store has the bytes there too, as its rename is called after the write is issued.
async function save(path: string | undefined = activeTab.value ?? undefined): Promise<boolean> {
  const st = path ? stateOf(path) : undefined;
  if (!path || !st) return false;
  const text = st.doc.toString();
  const at = saveBegins(path);
  let written = path; // the name the text is written under: the tab's when its turn comes
  try {
    let write = null as Promise<unknown> | null;
    await fileTurn(async () => {
      if (at.path === null) return;
      written = at.path;
      write = store.write(written, new TextEncoder().encode(fileText(text, formAt(written), written)));
    });
    if (!write) return false; // its tab closed while it waited (a delete): nothing to write
    await write;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (at.path !== null) addBanner({ b: "save-failed", path: at.path, message }); // not for a tab closed meanwhile
    say(`${baseName(at.path ?? written)} couldn't be saved`);
    return false;
  } finally {
    saveEnds(at);
  }
  const now = at.path; // the tab's path now, or null when it was closed while the file was written
  if (now !== null) savedAs(now, text, written);
  showToast(`Saved ${baseName(now ?? written)}`);
  return true;
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
  if (!view || !showing.value || activeTab.value !== ask.path) return;
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
  if (view && showing.value) {
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

/** Make the view in `host`, attach it to the documents and fill editorCommands. Called once, when Editor mounts. */
function mount(host: HTMLElement, emptyView: HTMLElement) {
  empty = emptyView;
  const v = new EditorView({ parent: host, state: emptyState });
  view = v;
  editorCommands.runFile = (path) => runFile(false, path);
  editorCommands.runSelection = () => runSelection();
  editorCommands.save = save;
  editorCommands.focus = focus;
  editorCommands.goToLine = (line, path) => {
    goToLine(line, path);
  };
  let shows = 0; // the scroll of an earlier show is not applied to a later one
  const detach = attachView({
    extensions: [keys, follow],
    show(state, scroll) {
      const next = state ?? emptyState;
      if (v.state !== next) v.setState(next);
      showing.value = state !== null;
      const mine = ++shows;
      if (state && scroll !== null)
        requestAnimationFrame(() => {
          if (view === v && shows === mine) v.scrollDOM.scrollTop = scroll;
        });
    },
    dispatch: (spec) => v.dispatch(spec),
    scrollTop: () => v.scrollDOM.scrollTop,
  });
  addEventListener("keydown", onKey);
  return () => {
    detach();
    removeEventListener("keydown", onKey);
    v.destroy();
    view = null;
    showing.value = false;
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
  const none = !showing.value;
  return (
    <div class="editor-host">
      <div class="editor-empty" ref={emptyRef} data-editor={none ? "" : undefined} tabIndex={-1} hidden={!none}>
        {"No file is open: open one from the file list."}
      </div>
      <div class="editor-cm" ref={host} hidden={none} />
    </div>
  );
}
