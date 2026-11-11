// @ts-check
// The file service: owns `files` (the store's list), `fresh` (what the last run wrote) and `persisted`, and adds the
// storage banner (S 19: once per visit, when persisted() is false and the files change; 4d draws it) and the
// download-failed banner (downloadAll() below). The file tree (step 4a) reads them and changes files through the store itself (`store.write`, `rename`, `remove`, `mkdir`, `zip`):
// each change calls store.onChange, which lists the store again here. docs/design/SPEC.md, sections 3.1 and 7.
import * as S from "./state.js";
import { keepFiles } from "../engine/tab.js";

/** @typedef {import("../engine/types").FileChange} FileChange
 *  @typedef {{ list(): Promise<import("../engine/types").FileInfo[]>, zip(): Promise<File>, onChange: null | (() => void),
 *    blocked: boolean }} Store */

/** @type {Store | null} */
let store = null;
let warned = false;   // the storage banner was added in this visit

/** The store the page uses (main.tsx). Its changes list the store again. */
export function connectFiles(/** @type {Store} */ s) {
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
    console.warn(`[dofile] the file list: ${/** @type {Error} */ (e)?.message ?? e}`);
  }
}

/** Ask the browser once to keep the files; `persisted` gets what persisted() says now, and again when persist() answers. */
export function keep(storage = globalThis.navigator?.storage) {
  return keepFiles(storage, kept => { S.persisted.value = kept; });
}

/** After a run: `fresh` is what it created or changed, and the list is read again. */
export function afterRun(/** @type {FileChange[] | undefined} */ changes) {
  S.fresh.value = new Set((changes ?? []).filter(c => c.status !== "removed").map(c => c.name));
  if (changes?.length) changed();
  return refresh();
}

/** "Download all (.zip)": made in the page from the store, with or without an engine. Resolves true once the zip is
 *  handed to the browser, false when not: with no file in the store (folders do not count) it makes no zip and says
 *  nothing (the buttons are disabled then: `hasFiles`); a store that cannot be read (the browser will not open the
 *  database) adds the banner `download-failed` (one: a second failure replaces it) with its "Try again", says it once in
 *  the live region, and logs the cause to the console. A later download that works removes that banner. It never
 *  rejects. @returns {Promise<boolean>} */
export async function downloadAll() {
  if (!store) return false;
  try {
    if (!(await store.list()).some(f => !f.dir)) return false;   // nothing to download: no empty zip
    saveAs(await store.zip());
    S.dismiss({ b: "download-failed" });
    return true;
  } catch (e) {
    console.warn(`[dofile] download all: ${/** @type {Error} */ (e)?.message ?? e}`);
    S.addBanner({ b: "download-failed" });
    S.say("Your files couldn't be downloaded");
    return false;
  }
}

/** Hand a file to the browser's download. `name` defaults to the File's own. */
export function saveAs(/** @type {Blob} */ blob, name = /** @type {File} */ (blob).name ?? "download") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
