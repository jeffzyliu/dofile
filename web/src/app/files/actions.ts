// What the file panel and the editor's tabs do to files and tabs (docs/design/SPEC.md, sections 3.1, 3.2 and 3.10), in
// plain TypeScript so the Node tests run it. Files change through the store (app/store.ts), which lists itself again
// (files.ts). The tabs and their documents are editor/documents.ts's.
import { batch, effect } from "@preact/signals-core";
import { type Expect, isConflict, StoreConflict } from "../../engine/store.ts";
import { zipParts } from "../../engine/zip.ts";
import { CONTROL } from "../../stata/quote.ts";
import { close, closeUnder, moved, reload, retype, tabs } from "../editor/documents.ts";
import { addBanner, banners, dialog, files, runMoved, say, showToast } from "../state.ts";
import { store } from "../store.ts";
import type { Dialog, FileInfo } from "../types.ts";
import { decodeText, noteNotText } from "./open.ts";
import { saveAs } from "./save.ts";
import { SequentialPromiseQueue } from "./sequential-promise-queue.ts";
import { baseName, extOf, freeName, joinPath, movedPath, parentOf, within } from "./tree.ts";
import { fileTurn, type Io, type Turn } from "./turns.ts";

// ---- rename, new, delete, download ----

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

/** Make an empty file or a folder when the visitor leaves the name field of a draft row (FilesPane.tsx,
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

// ---- upload ----

export interface Incoming {
  path: string; // where it goes in the store: a folder upload keeps its folders
  data: Uint8Array;
}

/** The words of an upload's clash dialog and toast: an upload's own, or the sample's (a restore, sample.ts). */
export const WORDS = {
  upload: {
    title: (path: string) => `${path} is already here`,
    question: "The upload has a file with the same name. Keep yours, or replace it with the uploaded one?",
    replace: "Replace with uploaded",
    theirs: "uploaded",
    others: (n: number) => `the other ${n === 1 ? "file is" : `${n} files are`} uploaded`,
    changedTitle: (path: string) => `${path} changed while you were deciding`,
    changedQuestion: "It was saved again since you were asked. Keep yours, or replace it with the uploaded one?",
  },
  sample: {
    title: (path: string) => `${path} differs from the sample`,
    question: "Keep yours, or replace it with the sample's? Your other files are untouched.",
    replace: "Replace with the sample",
    theirs: "sample",
    others: (n: number) => `the other ${n === 1 ? "file is" : `${n} files are`} in place`,
    changedTitle: (path: string) => `${path} changed while you were deciding`,
    changedQuestion: "It was saved again since you were asked. Keep yours, or replace it with the sample's?",
  },
};

/** Whose words: "upload" (the default) or "sample". */
export type WordsOf = keyof typeof WORDS;

/** What the open clash dialog shows beyond the `dialog` value. */
export interface ClashFacts {
  path: string;
  yours: { size: number; mtime: number } | null; // null: the store has no such file now (its tab has unsaved edits)
  uploadedBytes: number; // the uploaded file's size
  unaskedCount: number; // the files of the upload that clashed with none, or with a file of the same bytes (in place)
  remainingCount: number; // the clashes after this one
  hasUnsavedEdits: boolean; // the file is open with unsaved edits
  changedWhileAsked: boolean; // asked again: the file changed while its dialog was open
  words: (typeof WORDS)[WordsOf];
}

/** The dialog's answer: replace this one or keep it; `isForRest`: the box "Do the same for the other n clashes".
 *  "stop" is Esc: keep yours for every clash left, and ask no more. */
export type ClashAnswer = { replace: boolean; isForRest: boolean } | "stop";

let askedClash: ClashFacts | null = null;
let answerWith: ((a: ClashAnswer) => void) | null = null;

/** The clash the dialog is asking about, or null. */
export const clashNow = () => askedClash;

/** The clash dialog's answer (Esc and an unmount with no answer give "stop"). A second answer does nothing. */
export function answerClash(a: ClashAnswer) {
  const give = answerWith;
  answerWith = null;
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

const uploadQueue = new SequentialPromiseQueue();

/** Upload `items` into the store. Files that clash with none are written first; then each clash is asked in its own
 *  dialog (Keep mine is the default). A clash whose stored bytes are the uploaded ones is neither asked nor written
 *  (it counts as uploaded), unless the file is open with unsaved edits. A clash over an open file with unsaved edits is
 *  asked even after "Do the same" with Replace. After Esc, or "Do the same" with Keep mine, the clashes left are kept
 *  with no question: keeping loses nothing. A clash waits while another dialog is open: it never replaces one. A Replace writes only over the file the dialog showed: one changed while it was open is asked again ("changed while you were deciding"), even after "Do the same" with Replace; one deleted meanwhile is written without asking. Each write takes a turn (files/turns.ts), with the list it was checked against.
 *  Replacing an open file reloads it in the editor; one that is no longer UTF-8 text closes its tab. Ends with the
 *  toast "3 files uploaded". A file the store refuses (a path where a folder is, the quota) or whose name holds a
 *  control character is counted, and its reason goes to the console. Uploads run one at a time.
 *  @param words - "sample" (a restore, sample.ts) has the dialog and the toast say "Sample restored", "The sample is
 *  already here" (nothing to write, nothing asked), "Couldn't restore the sample".
 *  @returns the paths written */
export async function upload(items: Incoming[], words: WordsOf = "upload"): Promise<string[]> {
  return uploadQueue.enqueue(() => uploadNow(items, words));
}

async function uploadNow(items: Incoming[], words: WordsOf): Promise<string[]> {
  if (!items.length) return [];
  const writtenPaths: string[] = [];
  let failedCount = 0;
  /** Write `item` (in a turn's body), expecting `expected` at its path (none: whatever is there); a replace reloads its
   *  open tab. True once written, false when refused (counted), or the file found when the expectation fails. */
  function* writeItem(io: Io, item: Incoming, expected?: Expect, isReplace = false): Turn<boolean | FileInfo> {
    try {
      if (CONTROL.test(item.path)) throw new Error("a name with a control character");
      yield* io.write(item.path, item.data, expected);
    } catch (e) {
      if (isConflict(e) && e.now === null && expected !== "absent")
        return yield* writeItem(io, item, undefined, isReplace); // deleted since it was asked about: written unasked
      if (isConflict(e) && e.now?.dir === false) return e.now;
      failedCount++;
      console.warn(`[dofile] upload ${item.path}: ${(e as Error)?.message ?? e}`);
      return false;
    }
    writtenPaths.push(item.path);
    if (isReplace) reopen(item);
    return true;
  }
  const itemByPath = new Map(items.map((item) => [item.path, item])); // the same path twice in one upload: the last one
  const clashes: Incoming[] = [];
  let alreadyStoredCount = 0; // the clashes that hold the uploaded bytes already: not asked, not written
  // the list, and the writes of the files that clash with none, in one turn: no page change comes between them
  await fileTurn(function* (io) {
    const storedByPath = new Map((yield* io.list()).map((f) => [f.path, f]));
    for (const item of itemByPath.values()) {
      if (storedByPath.get(item.path)?.dir === false && !CONTROL.test(item.path)) {
        if (!openUnsaved(item.path) && (yield* holds(io, item))) alreadyStoredCount++;
        else clashes.push(item);
      } else if (typeof (yield* writeItem(io, item, storedByPath.has(item.path) ? undefined : "absent")) === "object")
        clashes.push(item); // a run wrote it meanwhile
    }
  });
  const unaskedCount = writtenPaths.length + alreadyStoredCount; // "N other files uploaded" in the clash dialog
  let answerForRest: boolean | null = null; // "Do the same": replace (true) or keep (false) every clash left
  let storedWhenRestDecided = new Map<string, FileInfo | null>(); // the clashes left, as they were when "Do the same" with Replace came
  let lastClashDialog: Dialog = null;
  for (const [index, clash] of clashes.entries()) {
    let willReplace: boolean | null = answerForRest;
    // what a Replace writes over: the file as its dialog showed it, or as it was when "Do the same" decided it
    let expectedStored: Expect | undefined = answerForRest
      ? (storedWhenRestDecided.get(clash.path) ?? "absent")
      : undefined;
    let changedWhileAsked = false; // asked again
    let askedAboutUnsaved = false; // asked with the unsaved words
    let triesSinceAnswer = 0; // writes tried since the last question: every retry asks first, so more than 3 is a bug
    for (;;) {
      // an open file with unsaved edits is asked before "Do the same" replaces it; keeping it (Esc, Keep mine for the
      // rest) needs no question
      const hasUnsavedEdits = openUnsaved(clash.path);
      if (
        changedWhileAsked ||
        willReplace === null ||
        (willReplace === true && hasUnsavedEdits && !askedAboutUnsaved)
      ) {
        while (dialog.value !== null) await noDialog(); // never over another dialog
        const storedNow = await fileTurn((io) => io.info(clash.path)); // not as the upload first listed it
        if (dialog.value !== null) continue; // another dialog opened while the file was read: wait for it too
        if (storedNow === null && !hasUnsavedEdits) {
          willReplace = true; // deleted meanwhile: written without asking, as a free path
          expectedStored = "absent";
        } else {
          // a file deleted meanwhile whose tab has unsaved edits is asked, in the unsaved words
          expectedStored = storedNow ?? "absent";
          askedAboutUnsaved = hasUnsavedEdits;
          triesSinceAnswer = 0;
          const reply = await askClash(clash, index, clashes.length, {
            path: clash.path,
            yours: storedNow && { size: storedNow.size, mtime: storedNow.mtime },
            uploadedBytes: clash.data.byteLength,
            unaskedCount,
            remainingCount: clashes.length - index - 1,
            hasUnsavedEdits,
            changedWhileAsked,
            words: WORDS[words],
          });
          lastClashDialog = reply.shown;
          if (reply.answer === "stop") answerForRest = willReplace = false;
          else {
            willReplace = reply.answer.replace;
            if (reply.answer.isForRest) answerForRest = reply.answer.replace;
            if (reply.answer.isForRest && reply.answer.replace) {
              const restPaths = clashes.slice(index + 1).map((c) => c.path);
              storedWhenRestDecided = await fileTurn(function* (io) {
                const stored = new Map<string, FileInfo | null>();
                for (const p of restPaths) stored.set(p, yield* io.info(p));
                return stored;
              });
            }
          }
        }
      }
      if (!willReplace) break;
      if (++triesSinceAnswer > 3) {
        failedCount++;
        console.warn(`[dofile] upload ${clash.path}: tried again without an answer`);
        break;
      }
      const outcome = await fileTurn(function* (io) {
        if (openUnsaved(clash.path) && !askedAboutUnsaved) return "unsaved"; // edited since: asked in the unsaved words
        return yield* writeItem(io, clash, expectedStored, true);
      });
      if (outcome === "unsaved") continue;
      if (typeof outcome !== "object") break;
      changedWhileAsked = true; // the file found instead of the one expected: asked again
    }
  }
  if (lastClashDialog !== null && dialog.value === lastClashDialog) dialog.value = null;
  if (words === "sample") {
    if (failedCount) showToast("Couldn't restore the sample", "error");
    else if (writtenPaths.length) showToast("Sample restored");
    // none asked: what was asked and kept says nothing
    else if (!clashes.length) showToast("The sample is already here");
  } else {
    const uploadedCount = writtenPaths.length + alreadyStoredCount; // the clashes replaced count too
    if (!uploadedCount && !failedCount) return writtenPaths;
    const summary = `${uploadedCount} ${plural(uploadedCount, "file", "files")} uploaded`;
    showToast(failedCount ? `${summary} · ${failedCount} failed` : summary, failedCount ? "error" : undefined);
  }
  return writtenPaths;
}

/** Ask the clash `facts` (clash `index` + 1 of `clashCount`) in the clash dialog and wait for the answer. */
async function askClash(
  clash: Incoming,
  index: number,
  clashCount: number,
  facts: ClashFacts,
): Promise<{ answer: ClashAnswer; shown: Dialog }> {
  askedClash = facts;
  const shown: Dialog = { d: "clash", path: clash.path, index: index + 1, total: clashCount };
  const answer = await new Promise<ClashAnswer>((resolve) => {
    answerWith = resolve;
    dialog.value = shown;
    // another dialog put in its place (another tab took the engine), with no answer: Esc's meaning. Here, not only
    // in the view, so an upload never waits for an answer that cannot come (the uploads after it would wait too).
    const stop = effect(() => {
      if (dialog.value === shown) return;
      queueMicrotask(() => {
        stop();
        if (answerWith === resolve) answerClash("stop");
      });
    });
  });
  askedClash = null;
  return { answer, shown };
}

/** The file is open in a tab with unsaved edits. */
const openUnsaved = (path: string) => tabs.value.some((t) => t.path === path && t.dirty);

/** The store's copy of the file is the uploaded bytes (a copy that cannot be read is not). */
function* holds(io: Io, { path, data }: Incoming): Turn<boolean> {
  try {
    const mine = yield* io.read(path);
    return mine.length === data.length && mine.every((x, i) => x === data[i]);
  } catch {
    return false;
  }
}

/** The editor of the text tab `path` shows `bytes` (a leading BOM kept: the editor notes it). Bytes that are not text
 *  close the tab, or with `notText` "keep" leave it as it is. */
export function reloadTab(path: string, bytes: Uint8Array, notText: "close" | "keep"): void {
  const text = decodeText(bytes, true);
  if (text !== null) reload(path, text);
  else if (notText === "close") close(path);
}

// an upload replaced an open file: the editor shows the new text, or the tab closes if it is not text any more
function reopen({ path, data }: Incoming) {
  if (tabs.value.find((t) => t.path === path)?.kind === "text") reloadTab(path, data, "close");
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
