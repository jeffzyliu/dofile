// What the file panel does to files and folders (docs/design/SPEC.md, sections 3.1 and 3.10): rename, new, delete, a
// folder's .zip, download. Plain TypeScript, so the Node tests run it. Files change through the store in turns
// (turns.ts), which lists itself again (files.ts); the tabs follow (editor/documents.ts).
import { batch } from "@preact/signals-core";
import { StoreConflict } from "../../engine/store.ts";
import { zipParts } from "../../engine/zip.ts";
import { close, closeUnder, moved, retype, tabs } from "../editor/documents.ts";
import { movedPath, within } from "../paths.ts";
import { files } from "../state/files.ts";
import { runMoved } from "../state/run.ts";
import { addBanner, banners, say } from "../state.ts";
import { store } from "../store.ts";
import { decodeText, noteNotText } from "./open.ts";
import { saveAs } from "./save.ts";
import { baseName, extOf, freeName, joinPath, parentOf } from "./tree.ts";
import { fileTurn, type Io, type Turn } from "./turns.ts";

/** A failure handler for a call whose promise nobody awaits: the cause to the console, `said` to the visitor. */
export const fail = (what: string, said: string) => (e: unknown) => {
  console.warn(`[dofile] ${what}: ${(e as Error)?.message ?? e}`);
  say(said);
};

/** How a file opens by its name: a .dta tab, the editor (open.ts says which text files the editor takes), or no tab (a
 *  .png goes to the Graph tab). */
const kindOf = (path: string) => {
  const ext = extOf(path);
  return ext === ".dta" ? "dta" : ext === ".png" ? null : "text";
};

/** Rename (or move) `from` to `to` in the store; the tabs of it and of everything under it follow (documents.ts
 *  moved). A tab whose new name opens another way (a .dta renamed to .csv, a text file to .dta) opens as its new name
 *  says, in its place, unless it has unsaved edits (the editor keeps them); one whose new name opens in no tab (a .png)
 *  just closes, and the Graph tab is left alone. Rejects as the store does (`to` exists, ...), and when a tab with
 *  unsaved edits is still open at `to` (its file deleted by a run); such a tab with no edits closes. */
export async function renameEntry(from: string, to: string): Promise<void> {
  return fileTurn((io) => renameNow(io, from, to)); // a Save pressed meanwhile waits for the tabs to have the new name
}

function* renameNow(io: Io, from: string, to: string): Turn<void> {
  if (from === to) return;
  // a tab left open at the new name after a run deleted its file (files.ts afterRun keeps it): with unsaved edits the
  // name is taken, as if the file were there; with none it closes, so the one tab of that name shows the renamed file
  const left = () => tabs.value.filter((t) => within(t.path, to) && !within(t.path, from));
  if (left().some((t) => t.dirty)) throw new StoreConflict(`${to} already exists`, null);
  yield* io.rename(from, to);
  for (const t of left()) if (!t.dirty) close(t.path);
  const before = new Set(tabs.value.map((t) => t.path));
  runMoved(from, to); // the last run and the log's run heads: Go to line follows the rename
  // the reset banner's cut file follows too, open in a tab or not (one banner: addBanner replaces it)
  for (const b of banners.value)
    if (b.b === "reset" && b.run?.path !== undefined && within(b.run.path, from))
      addBanner({ ...b, run: { ...b.run, path: movedPath(b.run.path, from, to) } });
  // the tabs that become text tabs are read first, so no tab shows its new name as the wrong kind meanwhile
  // new path: the tab's old path, and the text (null when not text, or why it was not read)
  const reads = new Map<string, { was: string; text: string | null | Error }>();
  for (const t of tabs.value.filter((t) => within(t.path, from))) {
    const p = movedPath(t.path, from, to);
    if (kindOf(p) === "text" && retypes(t.path, "text")) reads.set(p, { was: t.path, text: yield* readText(io, p) });
  }
  // one batch: the tabs are seen moved and retyped together
  batch(() => {
    // the new name opened meanwhile (openFile, from the list or Go to line) has a tab of the store's text already: the
    // old name's tab goes, so no two tabs share a path
    for (const [p, { was }] of reads) if (!before.has(p) && tabs.value.some((t) => t.path === p)) close(was);
    for (const p of moved(from, to)) {
      const kind = kindOf(p);
      if (!retypes(p, kind)) continue; // closed, or edited, meanwhile
      if (kind === null) close(p);
      else if (kind === "dta") retype(p);
      else {
        const text = reads.get(p)?.text;
        if (text === undefined) continue; // a guard: every tab that retypes to text was read above
        if (text instanceof Error) {
          // a file the store cannot give opens nothing, as openFile would
          console.warn(`[dofile] open ${p}: ${text.message}`);
          close(p);
          continue;
        }
        noteNotText(p, text);
        if (text === null) close(p);
        else retype(p, text);
      }
    }
  });
}

/** Whether the tab `path` is open, has no unsaved edits, and opens as another `kind` than it does. */
const retypes = (path: string, kind: "text" | "dta" | null) => {
  const tab = tabs.value.find((t) => t.path === path);
  return !!tab && !tab.dirty && tab.kind !== kind;
};

/** The store's copy of `path` as the editor takes it (decodeText, BOM kept): null when it is not text. */
function* readText(io: Io, path: string): Turn<string | null | Error> {
  try {
    return decodeText(yield* io.read(path), true);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** What a new file or folder is called when the name field is left empty or unchanged. */
export const NEW_NAMES = { file: "untitled.do", folder: "folder" } as const;

/** Make an empty file or a folder when the visitor leaves the name field of a draft row (rename.ts,
 *  docs/web-page-flows.md section 1): `name` in `dir`, or with no `name` the first free `untitled.do` (`untitled-2.do`,
 *  ...) or `folder`. The store is listed fresh and in a turn, so two quick ones cannot both take a name; a `name` in
 *  use rejects with a StoreConflict, "already exists" (a write would replace it). Returns its path. */
export async function createEntry(kind: keyof typeof NEW_NAMES, dir = "", name?: string): Promise<string> {
  return fileTurn(function* (io) {
    const listed = yield* io.list();
    const taken = listed.map((f) => f.path);
    const path = name === undefined ? freeName(dir, NEW_NAMES[kind], taken) : joinPath(dir, name);
    const there = listed.find((f) => f.path === path);
    if (there) throw new StoreConflict(`${path} already exists`, there);
    if (kind === "file") yield* io.write(path, new Uint8Array(0), "absent");
    else yield* io.mkdir(path);
    return path;
  });
}

/** Delete each path (a folder with everything under it) and close their tabs (in a turn: a Save pressed meanwhile finds
 *  its tab closed and writes nothing). */
export async function deleteEntries(paths: string[]): Promise<void> {
  return fileTurn((io) => removeAll(io, paths));
}

function* removeAll(io: Io, paths: string[]): Turn<void> {
  for (const p of paths) {
    yield* io.remove(p);
    closeUnder(p);
  }
}

/** "Delete all files…": every file and folder the store has when its turn comes; every tab closes. */
export async function deleteAll(): Promise<void> {
  return fileTurn(function* (io) {
    const top = (yield* io.list()).filter((f) => !f.path.includes("/")).map((f) => f.path);
    yield* removeAll(io, top);
  });
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
