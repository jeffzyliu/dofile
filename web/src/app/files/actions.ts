// What the file panel and the editor's tabs do to files and tabs (docs/design/SPEC.md, sections 3.1, 3.2 and 3.10), in
// plain TypeScript so the Node tests run it; FilesPane.tsx, EditorTabs.tsx and dialogs.tsx call these.
//  - Files change through the store (app/store.ts); a change lists the store again by itself (files.ts).
//  - Tabs: this file and open.ts write `tabs` and `activeTab` (never `dirty`: the editor's, state.ts setDirty), always
//    before they call the editor (editorCommands.closed, renamed, reload), through the object.
//  - Upload: the files that clash with none are written first, then each clash is asked in its own dialog
//    ({ d: "clash", path, index, total }); what the dialog shows beyond those is `clashNow()`. The dialog answers with
//    answerClash(). Esc, or a dialog unmounted with no answer, keeps yours for every clash left.
import { zipParts } from "../../engine/zip.ts";
import { editorCommands } from "../editor/commands.ts";
import { saveAs } from "../files.ts";
import { activeTab, banners, dialog, dismiss, files, say, showToast, tabs } from "../state.ts";
import { store } from "../store.ts";
import { decodeText } from "./open.ts";
import { baseName, freeName, joinPath, movedPath, parentOf, within } from "./tree.ts";

// ---- tabs ----

/** Close the tab of `path` with no question: the tab to its right becomes active (else the one to its left), then the
 *  editor drops its state. Returns the new active path. */
export function closeTab(path: string): string | null {
  const i = tabs.value.findIndex((t) => t.path === path);
  if (i < 0) return activeTab.value;
  const rest = tabs.value.filter((t) => t.path !== path);
  tabs.value = rest;
  if (activeTab.value === path) activeTab.value = (rest[i] ?? rest[i - 1])?.path ?? null;
  editorCommands.closed(path);
  return activeTab.value;
}

/** The ×, Delete on a tab, the phone's "Close": a tab with unsaved edits asks first (dialog close-tab); another closes.
 *  Returns true when it closed now. */
export function askCloseTab(path: string): boolean {
  const tab = tabs.value.find((t) => t.path === path);
  if (!tab) return false;
  if (tab.dirty) {
    dialog.value = { d: "close-tab", path };
    return false;
  }
  closeTab(path);
  return true;
}

/** The tabs of `top` and of everything under it are closed (it was deleted). */
function closeUnder(top: string) {
  for (const t of tabs.value.filter((t) => within(t.path, top))) closeTab(t.path);
  for (const b of banners.value) if (b.b === "not-text" && within(b.path, top)) dismiss(b);
}

// ---- rename, new, delete, download ----

/** Rename (or move) `from` to `to` in the store; the tabs of it and of everything under it follow (`tabs` first, then
 *  editorCommands.renamed for each open file). Rejects as the store does (`to` exists, ...). */
export async function renameEntry(from: string, to: string): Promise<void> {
  if (from === to) return;
  await store.rename(from, to);
  const moved = tabs.value.filter((t) => within(t.path, from)).map((t) => t.path);
  if (!moved.length) return;
  tabs.value = tabs.value.map((t) => ({ ...t, path: movedPath(t.path, from, to) }));
  if (activeTab.value !== null) activeTab.value = movedPath(activeTab.value, from, to);
  for (const p of moved) editorCommands.renamed(p, movedPath(p, from, to));
}

/** The head menu's and the dropzone's "New .do file": an empty `untitled.do` (`untitled-2.do`, ... when taken) at the
 *  top, which the tree then shows in inline rename. Returns its path. */
export async function newDoFile(dir = ""): Promise<string> {
  const path = freeName(
    dir,
    "untitled.do",
    (await store.list()).map((f) => f.path),
  );
  await store.write(path, new Uint8Array(0));
  return path;
}

/** "New folder": `folder` (`folder-2`, ...) at the top, then inline rename. Returns its path. */
export async function newFolder(dir = ""): Promise<string> {
  const path = freeName(
    dir,
    "folder",
    (await store.list()).map((f) => f.path),
  );
  await store.mkdir(path);
  return path;
}

/** Delete each path (a folder with everything under it) and close their tabs. */
export async function deleteEntries(paths: string[]): Promise<void> {
  for (const p of paths) {
    await store.remove(p);
    closeUnder(p);
  }
}

/** "Delete all files…": every file and folder; every tab closes. */
export async function deleteAll(): Promise<void> {
  const top = (await store.list()).filter((f) => !f.path.includes("/")).map((f) => f.path);
  await deleteEntries(top);
}

/** The files under the folder `dir` as a .zip named after it ("data.zip"), its entries under the folder's name
 *  ("data/raw/survey.csv"), made in the page from the store with no engine. */
export async function zipFolder(dir: string): Promise<File> {
  const infos = (await store.list()).filter((f) => within(f.path, dir));
  const cut = parentOf(dir) ? parentOf(dir).length + 1 : 0;
  const entries = await Promise.all(
    infos.map(async (f) => ({
      name: f.dir ? `${f.path.slice(cut)}/` : f.path.slice(cut),
      mtime: f.mtime,
      data: f.dir ? new Uint8Array(0) : new Uint8Array(await store.read(f.path)),
    })),
  );
  return new File(zipParts(entries), `${baseName(dir)}.zip`, { type: "application/zip" });
}

/** The row menu's Download: a file as it is in the store; a folder as a .zip (zipFolder). */
export async function downloadEntry(path: string): Promise<void> {
  const info = files.value.find((f) => f.path === path);
  try {
    if (info?.dir) saveAs(await zipFolder(path));
    else saveAs(new File([new Uint8Array(await store.read(path))], baseName(path)));
  } catch (e) {
    console.warn(`[dofile] download ${path}: ${(e as Error)?.message ?? e}`);
    say(`${baseName(path)} couldn't be downloaded`);
  }
}

// ---- upload ----

export interface Incoming {
  path: string; // where it goes in the store: a folder upload keeps its folders
  data: Uint8Array;
}

/** What the open clash dialog shows beyond the `dialog` value. */
export interface ClashNow {
  path: string;
  yours: { size: number; mtime: number };
  uploaded: number; // its size
  others: number; // the files of the upload that clashed with none (already written)
  left: number; // the clashes after this one
  unsaved: boolean; // the file is open with unsaved edits
}

/** The dialog's answer: replace this one or keep it; `same`: the box "Do the same for the other n clashes". "stop" is
 *  Esc: keep yours for every clash left, and ask no more. */
export type ClashAnswer = { replace: boolean; same: boolean } | "stop";

let now: ClashNow | null = null;
let answer: ((a: ClashAnswer) => void) | null = null;

/** The clash the dialog is asking about, or null. */
export const clashNow = () => now;

/** The clash dialog's answer (Esc and an unmount with no answer give "stop"). A second answer does nothing. */
export function answerClash(a: ClashAnswer) {
  const give = answer;
  answer = null;
  give?.(a);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Upload `items` into the store. The files that clash with no file in the store are written first; then each clash is
 *  asked (Keep mine is the default). Replacing an open file reloads it in the editor (F 3.3); one that is no longer
 *  UTF-8 text closes its tab. Ends with the toast "3 files uploaded". A file the store refuses (a path where a folder
 *  is, the browser's quota) is counted and its reason goes to the console. Resolves with the paths written. */
export async function upload(items: Incoming[]): Promise<string[]> {
  if (!items.length) return [];
  const before = new Map((await store.list()).map((f) => [f.path, f]));
  const written: string[] = [];
  let failed = 0;
  const put = async ({ path, data }: Incoming) => {
    try {
      await store.write(path, data);
      written.push(path);
      return true;
    } catch (e) {
      failed++;
      console.warn(`[dofile] upload ${path}: ${(e as Error)?.message ?? e}`);
      return false;
    }
  };
  const last = new Map(items.map((it) => [it.path, it])); // the same path twice in one upload: the last one
  const clashes: Incoming[] = [];
  for (const it of last.values()) {
    if (before.get(it.path)?.dir === false) clashes.push(it);
    else await put(it);
  }
  const others = written.length;
  let sticky: boolean | null = null; // "Do the same": replace (true) or keep (false) every clash left
  for (const [i, it] of clashes.entries()) {
    let replace: boolean | null = sticky;
    if (replace === null) {
      const mine = before.get(it.path)!;
      now = {
        path: it.path,
        yours: { size: mine.size, mtime: mine.mtime },
        uploaded: it.data.byteLength,
        others,
        left: clashes.length - i - 1,
        unsaved: tabs.value.some((t) => t.path === it.path && t.dirty),
      };
      const a = await new Promise<ClashAnswer>((ok) => {
        answer = ok;
        dialog.value = { d: "clash", path: it.path, index: i + 1, total: clashes.length };
      });
      now = null;
      if (a === "stop") sticky = replace = false;
      else {
        replace = a.replace;
        if (a.same) sticky = a.replace;
      }
    }
    if (replace && (await put(it))) reopen(it);
  }
  if (dialog.value?.d === "clash") dialog.value = null;
  if (written.length || failed) {
    const done = `${written.length} ${plural(written.length, "file", "files")} uploaded`;
    showToast(failed ? `${done} · ${failed} couldn't be` : done);
  }
  return written;
}

// an upload replaced an open file: the editor shows the new text, or the tab closes if it is not text any more
function reopen({ path, data }: Incoming) {
  const tab = tabs.value.find((t) => t.path === path);
  if (tab?.kind !== "text") return;
  const text = decodeText(data);
  if (text === null) closeTab(path);
  else editorCommands.reload(path, text);
}

/** The files of a file input (`webkitRelativePath` keeps a folder upload's folders) put under the folder `dir`. */
export async function fromFileList(list: Iterable<File>, dir = ""): Promise<Incoming[]> {
  return Promise.all(
    [...list].map(async (f) => ({
      path: joinPath(dir, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
      data: new Uint8Array(await f.arrayBuffer()),
    })),
  );
}

// the browser's entry API for a drop (FileSystemEntry), the parts used here
interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, no: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (es: Entry[]) => void, no: (e: unknown) => void): void };
}

/** The files of a drop, folders walked, paths kept. Call `entriesOf` inside the drop handler, before any await: the
 *  items are gone after it. */
export function entriesOf(dt: DataTransfer): (Entry | File)[] {
  const out: (Entry | File)[] = [];
  for (const item of dt.items ?? []) {
    if (item.kind !== "file") continue;
    // a folder is walked through its entry; a file is taken as it is (a made-up drop's entry gives no file in WebKit)
    const entry = (item as DataTransferItem & { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.();
    const file = entry?.isDirectory ? null : item.getAsFile();
    if (file) out.push(file);
    else if (entry) out.push(entry);
  }
  if (!out.length) out.push(...(dt.files ?? []));
  return out;
}

export async function fromDrop(entries: (Entry | File)[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  const walk = async (e: Entry, dir: string): Promise<void> => {
    const path = joinPath(dir, e.name);
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, no) => e.file!(ok, no));
      out.push({ path, data: new Uint8Array(await f.arrayBuffer()) });
    } else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, no) => reader.readEntries(ok, no)); // at most 100 at a time
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const e of entries) {
    if (e instanceof File) out.push(...(await fromFileList([e])));
    else await walk(e, "");
  }
  return out;
}
