// The file service: lists the store into `files`, tracks `fresh` and `persisted`, and adds the storage and
// download-failed banners. Views change files through the store itself; each change calls store.onChange, which lists
// the store again here. docs/design/SPEC.md, sections 3.1 and 7.

import { keepFiles } from "../engine/tab.ts";
import type { FileChange, FileInfo, PendingRow } from "../engine/types.ts";
import { editorCommands } from "./editor/commands.ts";
import { reloadTab } from "./files/actions.ts";
import { decodeText } from "./files/open.ts";
import { saveAs } from "./files/save.ts";
import { SAMPLE_PATHS, seedSample } from "./sample.ts";
import * as S from "./state.ts";
import { filesWriter as W } from "./state.ts";

type Store = {
  list(): Promise<FileInfo[]>;
  zip(): Promise<File>;
  read(path: string): Promise<Uint8Array>;
  onChange: null | ((row: PendingRow) => void);
  blocked: boolean;
};
type Storage = Parameters<typeof keepFiles>[0];

let store: Store | null = null;
let storage: Storage; // navigator.storage, or the tests' own
let warned = false; // the storage banner was added in this visit
// the sample's paths while the first visit writes them: those writes bring no storage banner; any other change made
// meanwhile (an upload, a run) does
let seeding: ReadonlySet<string> = new Set();

/** Use `s` as the page's store (its changes list it again) and `manager` as the browser's storage manager. */
export function connectFiles(s: Store, manager: Storage = globalThis.navigator?.storage) {
  store = s;
  storage = manager;
  warned = false;
  s.onChange = (row) => {
    changed(row);
    refresh();
  };
}

/** The tab lock is this tab's: unblock the store, ask the browser to keep the files, list the store. Nothing waits for
 *  the list. */
export function own() {
  if (!store) return;
  store.blocked = false;
  keep(storage);
  refresh();
  // Writing the sample is not a change of the visitor's, so it does not bring the storage banner before they have done
  // anything. seedSample never rejects.
  seeding = new Set(SAMPLE_PATHS);
  seedSample().finally(() => {
    seeding = new Set();
  });
}

/** Another tab took the tab lock: this tab writes nothing from now on. */
export function block() {
  if (store) store.blocked = true;
}

// the files changed (the page's change, `row`, or a run's): the storage banner, once per visit, if the browser may
// clear them
function changed(row?: PendingRow) {
  if ((row && seeding.has(row.path)) || warned || S.persisted.value !== false) return;
  warned = true;
  S.addBanner({ b: "storage" });
}

/** List the store into `files`. A store that cannot be read leaves the list as it was (the reason goes to the console).
 *  A blocked tab does not list: the files are another tab's now (so a run that losing the lock cut lists nothing). */
export async function refresh() {
  if (!store || store.blocked) return;
  try {
    W.files.value = await store.list();
  } catch (e) {
    console.warn(`[dofile] the file list: ${(e as Error)?.message ?? e}`);
  }
}

/** Ask the browser once to keep the files; `persisted` gets what persisted() says now, and again when persist()
 *  answers. */
export function keep(manager: Storage = globalThis.navigator?.storage) {
  return keepFiles(manager, (kept) => {
    W.persisted.value = kept;
  });
}

/** After a run: `fresh` is what it created or changed, and the list is read again. An open text tab whose file the run
 *  rewrote follows it (editorCommands.ranOver): with no unsaved edits it shows the run's version, if that is text;
 *  otherwise it keeps its text and the banner run-changed says so. A file the run deleted keeps its tab (a Save writes
 *  it again). */
export function afterRun(changes: FileChange[] | undefined) {
  W.fresh.value = new Set((changes ?? []).filter((c) => c.status !== "removed").map((c) => c.name));
  if (changes?.length) changed();
  return Promise.all([refresh(), ...(changes ?? []).map(followOpen)]);
}

async function followOpen(c: FileChange) {
  const tab = S.tabs.value.find((t) => t.path === c.name && t.kind === "text");
  if (!tab || c.status === "removed" || !store) return;
  let bytes: Uint8Array;
  try {
    bytes = await store.read(c.name);
  } catch {
    return; // the store cannot give it now: nothing is known of the run's version
  }
  const text = decodeText(bytes, true);
  if (!S.tabs.value.some((t) => t.path === c.name && t.kind === "text")) return; // closed meanwhile
  if (editorCommands.ranOver(c.name, text) === "kept") S.addBanner({ b: "run-changed", path: c.name });
}

/** The text tab `path` shows the store's copy of the file. A copy that cannot be read or is not text changes nothing. */
export async function reloadFromStore(path: string): Promise<void> {
  if (!store) return;
  let bytes: Uint8Array;
  try {
    bytes = await store.read(path);
  } catch {
    return; // the store cannot give it now
  }
  reloadTab(path, bytes, "keep");
}

/** "Download all (.zip)": made in the page from the store, with or without an engine. Never rejects.
 *  @returns true once the zip is handed to the browser; false with no file in the store (folders do not count: no zip,
 *  no message, the buttons are disabled then) or when the store cannot be read (the banner `download-failed`, the live
 *  region and the console say so). A later download that works removes the banner. */
export async function downloadAll(): Promise<boolean> {
  if (!store) return false;
  try {
    if (!(await store.list()).some((f) => !f.dir)) return false; // nothing to download: no empty zip
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
