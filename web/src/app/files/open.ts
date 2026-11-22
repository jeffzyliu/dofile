// Opening a file (docs/design/SPEC.md, section 3.11): every way to open one (the tree, the phone's file switcher, "Go
// to line") goes through openFile. Plain TypeScript (no JSX), so the Node tests can run it.
import { activate, addDta, addText, tabs } from "../editor/documents.ts";
import { addFileGraph } from "../graphs.ts";
import { addBanner, banners, dismiss, graphFull, isPhone, outputTab, phoneTab, say } from "../state.ts";
import { baseName, extOf } from "./tree.ts";
import { fileTurn } from "./turns.ts";

/** A file's text when its bytes are strict UTF-8, else null: the editor would change such a file, so it is not opened
 *  as text. A leading BOM is dropped, or with `keepBom` kept as "\uFEFF": the editor's text is decoded so
 *  (editor/ranover.ts formOf notes the BOM, which Save writes back). */
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
  activate(path);
  if (isPhone.value) phoneTab.value = "editor";
}

/** Open `path` from the store as section 3.11 says. Resolves once it is shown; a file
 *  the store cannot read (deleted meanwhile) opens nothing, and the reason goes to the console. A file that is not
 *  text, .dta or .png gets no tab but the not-text banner (one at a time: an earlier file's goes). */
export async function openFile(path: string): Promise<void> {
  if (tabs.value.some((t) => t.path === path)) return show(path);
  const ext = extOf(path);
  if (ext === ".dta") {
    addDta(path);
    return show(path);
  }
  // the read and the tab in one turn: an upload's Replace of the file comes wholly before it or after it (and reloads
  // the tab), so the tab never keeps bytes the store has replaced
  return fileTurn(function* (io) {
    let bytes: Uint8Array;
    try {
      bytes = yield* io.read(path);
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
    noteNotText(path, text);
    if (text === null) return;
    if (tabs.value.some((t) => t.path === path)) return show(path); // opened twice at once: the first one won
    addText(path, text);
    show(path);
  });
}

/** A file is opened as text (`text`) or cannot be (null): the not-text banner of an earlier file goes, and one comes
 *  for `path` when it is not text. */
export function noteNotText(path: string, text: string | null): void {
  for (const b of banners.value) if (b.b === "not-text") dismiss(b);
  if (text === null) {
    addBanner({ b: "not-text", path });
    say(`${baseName(path)} can't be opened in the editor`); // the banner has no role: the focus stays in the tree
  }
}
