// What the file panel and the editor's tabs do to files and tabs (docs/design/SPEC.md, sections 3.1, 3.2 and 3.10), in
// plain TypeScript so the Node tests run it; FilesPane.tsx, EditorTabs.tsx and dialogs.tsx call these.
//  - Files change through the store (app/store.ts); a change lists the store again by itself (files.ts).
//  - Tabs: this file and open.ts write `tabs` and `activeTab` (never `dirty`: the editor's, state.ts setDirty), always
//    before they call the editor (editorCommands.closed, renamed, reload), through the object.
//  - Upload: the files that clash with none are written first, then each clash is asked in its own dialog
//    ({ d: "clash", path, index, total }); what the dialog shows beyond those is `clashNow()`. The dialog answers with
//    answerClash(). Esc, or another dialog put in the clash's place with no answer, keeps yours for every clash left. Uploads run one at a
//    time (a second waits for the first to end), and a clash waits while another dialog is open: it never replaces one.
//    A clash over an open file with unsaved edits is asked even after "Do the same" with Replace (never after Esc or
//    Keep mine for the rest: keeping it loses nothing).
//  - The changes that tabs follow (a rename, a delete) and the editor's Save take turns (fileTurn): a rename or a delete
//    keeps its turn until the tabs have followed it, so a Save pressed meanwhile writes under the tab's path as it is
//    then (renamed, or closed: no write). A Save's turn only issues its write: the store applies changes in the order
//    they are called (engine/store.ts `change`), so a rename that comes after it moves the bytes it wrote.
import { effect } from "@preact/signals-core";
import { zipParts } from "../../engine/zip.ts";
import { CONTROL } from "../../stata/quote.ts";
import { editorCommands } from "../editor/commands.ts";
import { saveAs } from "../files.ts";
import { activeTab, banners, dialog, dismiss, files, phoneTab, say, showToast, tabs } from "../state.ts";
import { store } from "../store.ts";
import type { Dialog } from "../types.ts";
import { decodeText, openFile } from "./open.ts";
import { baseName, extOf, freeName, joinPath, movedPath, parentOf, within } from "./tree.ts";

// ---- tabs ----

/** Close the tab of `path` with no question: the tab to its right becomes active (else the one to its left), then the
 *  editor drops its state. */
export function closeTab(path: string): void {
  const i = tabs.value.findIndex((t) => t.path === path);
  if (i < 0) return;
  const rest = tabs.value.filter((t) => t.path !== path);
  tabs.value = rest;
  if (activeTab.value === path) activeTab.value = (rest[i] ?? rest[i - 1])?.path ?? null;
  editorCommands.closed(path);
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

// ---- turns ----

let turns: Promise<unknown> = Promise.resolve(); // the changes that tabs follow, one after the other

/** Run `fn` once the changes started before it have ended (a rejection ends one too). Resolves or rejects as `fn`. */
export function fileTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = turns.then(fn);
  turns = run.catch(() => {});
  return run;
}

// ---- rename, new, delete, download ----

/** How a file opens by its name: a .dta tab, the editor (open.ts says which text files the editor takes), or no tab (a
 *  .png goes to the Graph tab). */
const kindOf = (path: string) => {
  const ext = extOf(path);
  return ext === ".dta" ? "dta" : ext === ".png" ? null : "text";
};

/** Rename (or move) `from` to `to` in the store; the tabs of it and of everything under it follow (`tabs` first, then
 *  editorCommands.renamed for each open file). A tab whose new name opens another way (a .dta renamed to .csv, a text
 *  file to .dta) is opened again as its new name says, in its place, unless it has unsaved edits (the editor keeps
 *  them); one whose new name opens in no tab (a .png) just closes, and the Graph tab is left alone. Rejects as the store
 *  does (`to` exists, ...). */
export function renameEntry(from: string, to: string): Promise<void> {
  return fileTurn(() => renameNow(from, to)); // a Save pressed meanwhile waits for the tabs to have the new name
}

async function renameNow(from: string, to: string) {
  if (from === to) return;
  await store.rename(from, to);
  const moved = tabs.value.filter((t) => within(t.path, from)).map((t) => t.path);
  if (!moved.length) return;
  tabs.value = tabs.value.map((t) => ({ ...t, path: movedPath(t.path, from, to) }));
  if (activeTab.value !== null) activeTab.value = movedPath(activeTab.value, from, to);
  for (const p of moved) editorCommands.renamed(p, movedPath(p, from, to));
  for (const p of moved.map((p) => movedPath(p, from, to))) {
    const tab = tabs.value.find((t) => t.path === p);
    const kind = kindOf(p);
    if (!tab || tab.dirty || tab.kind === kind) continue;
    if (kind === null) closeTab(p);
    else await reopenAs(p);
  }
}

/** Close the tab of `path` and open the file again (open.ts), in the same place, leaving the active tab and the phone's
 *  view as they were. */
async function reopenAs(path: string) {
  const place = tabs.value.findIndex((t) => t.path === path);
  const active = activeTab.value;
  const view = phoneTab.value;
  closeTab(path);
  await openFile(path);
  const tab = tabs.value.find((t) => t.path === path);
  if (tab) {
    const rest = tabs.value.filter((t) => t !== tab);
    rest.splice(place, 0, tab);
    tabs.value = rest;
  }
  if (active !== path && tabs.value.some((t) => t.path === active)) activeTab.value = active;
  phoneTab.value = view;
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

/** Delete each path (a folder with everything under it) and close their tabs (in a turn: a Save pressed meanwhile finds
 *  its tab closed and writes nothing). */
export function deleteEntries(paths: string[]): Promise<void> {
  return fileTurn(async () => {
    for (const p of paths) {
      await store.remove(p);
      closeUnder(p);
    }
  });
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

/** Resolves once no dialog is open (at once when none is). */
const noDialog = () =>
  new Promise<void>((ok) => {
    const stop = effect(() => {
      if (dialog.value === null)
        queueMicrotask(() => {
          stop();
          ok();
        });
    });
  });

let uploads: Promise<unknown> = Promise.resolve(); // the uploads in progress, one after the other

/** Upload `items` into the store. The files that clash with no file in the store are written first; then each clash is
 *  asked (Keep mine is the default). Replacing an open file reloads it in the editor (F 3.3); one that is no longer
 *  UTF-8 text closes its tab. Ends with the toast "3 files uploaded". A file the store refuses (a path where a folder
 *  is, the browser's quota) or whose name holds a control character (a line break) is counted, and its reason goes to
 *  the console. Uploads run one at a time: a second one starts when the first has ended. Resolves with the paths
 *  written. */
export function upload(items: Incoming[]): Promise<string[]> {
  const run = uploads.then(() => uploadNow(items));
  uploads = run.catch(() => {});
  return run;
}

async function uploadNow(items: Incoming[]): Promise<string[]> {
  if (!items.length) return [];
  const before = new Map((await store.list()).map((f) => [f.path, f]));
  const written: string[] = [];
  let failed = 0;
  const put = async ({ path, data }: Incoming) => {
    try {
      if (CONTROL.test(path)) throw new Error("a name with a control character");
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
    if (before.get(it.path)?.dir === false && !CONTROL.test(it.path)) clashes.push(it);
    else await put(it);
  }
  const others = written.length;
  let sticky: boolean | null = null; // "Do the same": replace (true) or keep (false) every clash left
  let shown: Dialog = null; // the last clash dialog this upload opened
  for (const [i, it] of clashes.entries()) {
    let replace: boolean | null = sticky;
    // an open file with unsaved edits is asked before "Do the same" replaces it; keeping it (Esc, Keep mine for the
    // rest) needs no question
    const unsaved = tabs.value.some((t) => t.path === it.path && t.dirty);
    if (replace === null || (replace === true && unsaved)) {
      const mine = before.get(it.path)!;
      while (dialog.value !== null) await noDialog(); // never over another dialog
      now = {
        path: it.path,
        yours: { size: mine.size, mtime: mine.mtime },
        uploaded: it.data.byteLength,
        others,
        left: clashes.length - i - 1,
        unsaved,
      };
      const ask: Dialog = { d: "clash", path: it.path, index: i + 1, total: clashes.length };
      shown = ask;
      const a = await new Promise<ClashAnswer>((ok) => {
        answer = ok;
        dialog.value = ask;
        // another dialog put in its place (another tab took the engine), with no answer: Esc's meaning. Here, not only
        // in the view, so an upload never waits for an answer that cannot come (the uploads after it would wait too).
        const stop = effect(() => {
          if (dialog.value === ask) return;
          queueMicrotask(() => {
            stop();
            if (answer === ok) answerClash("stop");
          });
        });
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
  if (shown !== null && dialog.value === shown) dialog.value = null;
  if (written.length || failed) {
    const done = `${written.length} ${plural(written.length, "file", "files")} uploaded`;
    showToast(failed ? `${done} · ${failed} failed` : done, failed ? "error" : undefined);
  }
  return written;
}

// an upload replaced an open file: the editor shows the new text, or the tab closes if it is not text any more
function reopen({ path, data }: Incoming) {
  const tab = tabs.value.find((t) => t.path === path);
  if (tab?.kind !== "text") return;
  const text = decodeText(data, true);
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
