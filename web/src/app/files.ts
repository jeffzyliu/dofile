// The file service: owns `files` (the store's list), `fresh` (what the last run wrote) and `persisted`, and adds the
// storage banner (S 19: once per visit, when persisted() is false and the files change; 4d draws it) and the
// download-failed banner (downloadAll() below). The file tree (step 4a) reads them and changes files through the store itself (`store.write`, `rename`, `remove`, `mkdir`, `zip`):
// each change calls store.onChange, which lists the store again here. docs/design/SPEC.md, sections 3.1 and 7.
import * as S from "./state.ts";
import { keepFiles } from "../engine/tab.ts";
import type { FileChange, FileInfo } from "../engine/types.ts";

type Store = { list(): Promise<FileInfo[]>, zip(): Promise<File>, onChange: null | (() => void), blocked: boolean };

let store: Store | null = null;
let warned = false;   // the storage banner was added in this visit

/** The store the page uses (main.tsx). Its changes list the store again. */
export function connectFiles(s: Store) {
  store = s;
  warned = false;
  s.onChange = () => { changed(); refresh(); };
}

// the files changed (the page's change, or a run's): S 19's banner, once per visit, if the browser may clear them
function changed() {
  if (warned || S.persisted.value !== false) return;
  warned = true;
  S.addBanner({ b: "storage" });
}

/** List the store into `files`. A store that cannot be read leaves the list as it was (the reason goes to the console). */
export async function refresh() {
  if (!store) return;
  try {
    S.files.value = await store.list();
  } catch (e) {
    console.warn(`[dofile] the file list: ${(e as Error)?.message ?? e}`);
  }
}

/** Ask the browser once to keep the files; `persisted` gets what persisted() says now, and again when persist() answers. */
export function keep(storage: Parameters<typeof keepFiles>[0] = globalThis.navigator?.storage) {
  return keepFiles(storage, kept => { S.persisted.value = kept; });
}

/** After a run: `fresh` is what it created or changed, and the list is read again. */
export function afterRun(changes: FileChange[] | undefined) {
  S.fresh.value = new Set((changes ?? []).filter(c => c.status !== "removed").map(c => c.name));
  if (changes?.length) changed();
  return refresh();
}

/** "Download all (.zip)": made in the page from the store, with or without an engine. Resolves true once the zip is
 *  handed to the browser, false when not: with no file in the store (folders do not count) it makes no zip and says
 *  nothing (the buttons are disabled then: `hasFiles`); a store that cannot be read (the browser will not open the
 *  database) adds the banner `download-failed` (one: a second failure replaces it) with its "Try again", says it once in
 *  the live region, and logs the cause to the console. A later download that works removes that banner. It never
 *  rejects. */
export async function downloadAll(): Promise<boolean> {
  if (!store) return false;
  try {
    if (!(await store.list()).some(f => !f.dir)) return false;   // nothing to download: no empty zip
    saveAs(await store.zip());
    S.dismiss({ b: "download-failed" });
    return true;
  } catch (e) {
    console.warn(`[dofile] download all: ${(e as Error)?.message ?? e}`);
    S.addBanner({ b: "download-failed" });
    S.say("Your files couldn't be downloaded");
    return false;
  }
}

/** Hand a file to the browser's download. `name` defaults to the File's own. */
export function saveAs(blob: Blob, name = (blob as File).name ?? "download") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
