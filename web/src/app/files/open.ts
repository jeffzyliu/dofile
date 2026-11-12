// Opening a file (docs/design/SPEC.md, section 3.11): the file tree's Enter and click, the phone's file switcher, and
// 4b's "Go to line" for a file that is not open (editor/commands.ts goToLine) all go through openFile(path), so the rules
// of 3.11 live in one place:
//  - an open file (a tab in `tabs`): only made active;
//  - .dta: a tab { path, kind: "dta" }, made active; App.tsx shows output/DtaView.tsx (4c) in the editor's place;
//  - .png: run.ts addFileGraph(path, base64), then the Graph tab (desktop: outputTab "graph"; phone: state.ts graphFull);
//  - text (decodeText is not null): a tab { path, kind: "text" } in `tabs`, made active, then editorCommands.open(path,
//    text) (`tabs` first, then the editor: SPEC 8);
//  - for a text or .dta tab on a phone (state.ts layout "phone"): phoneTab = "editor", so the tab shows (the Files view
//    opened it);
//  - anything else: no tab; the banner { b: "not-text", path } in the Files pane (state.ts addBanner), one at a time:
//    an earlier file's goes; the live region says it.
// Plain TypeScript (no JSX), so the Node tests can run it.
import { editorCommands } from "../editor/commands.ts";
import { addFileGraph } from "../run.ts";
import {
  activeTab,
  addBanner,
  banners,
  dismiss,
  graphFull,
  isPhone,
  outputTab,
  phoneTab,
  say,
  tabs,
} from "../state.ts";
import { store } from "../store.ts";
import { baseName, extOf } from "./tree.ts";

/** A file's text when its bytes are strict UTF-8 (the test the proof-of-concept page used), else null: the editor would
 *  change such a file, so it is not opened as text. A leading BOM is dropped, or with `keepBom` kept as "\uFEFF": the
 *  editor's text is decoded so (editor/ranover.ts formOf notes the BOM, which Save writes back). */
export function decodeText(bytes: Uint8Array, keepBom = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: keepBom }).decode(bytes);
  } catch {
    return null;
  }
}

/** Bytes as base64, in chunks (a big image would overflow the argument list of one String.fromCharCode call). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Make `path` the active tab; on a phone show the Editor view. */
function show(path: string) {
  activeTab.value = path;
  if (isPhone.value) phoneTab.value = "editor";
}

/** Open `path` from the store as section 3.11 says (see above). Resolves once it is shown; a file the store cannot read
 *  (it was deleted meanwhile) opens nothing, and the reason goes to the console. */
export async function openFile(path: string): Promise<void> {
  if (tabs.value.some((t) => t.path === path)) return show(path);
  const ext = extOf(path);
  if (ext === ".dta") {
    tabs.value = [...tabs.value, { path, kind: "dta", dirty: false }];
    return show(path);
  }
  let bytes: Uint8Array;
  try {
    bytes = await store.read(path);
  } catch (e) {
    console.warn(`[dofile] open ${path}: ${(e as Error)?.message ?? e}`);
    return;
  }
  if (ext === ".png") {
    addFileGraph(path, toBase64(bytes));
    if (isPhone.value) graphFull.value = true;
    else outputTab.value = "graph";
    return;
  }
  const text = decodeText(bytes, true);
  for (const b of banners.value) if (b.b === "not-text") dismiss(b);
  if (text === null) {
    addBanner({ b: "not-text", path });
    say(`${baseName(path)} can't be opened in the editor`); // the banner has no role: the focus stays in the tree
    return;
  }
  if (tabs.value.some((t) => t.path === path)) return show(path); // opened twice at once: the first one won
  tabs.value = [...tabs.value, { path, kind: "text", dirty: false }];
  show(path);
  editorCommands.open(path, text);
}
