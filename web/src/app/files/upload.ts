// An upload into the store (docs/design/SPEC.md, sections 3.1 and 3.10) and its clash dialog: the clash being asked,
// its words and its answer. "Restore the sample" is an upload (sample.ts). Plain TypeScript, so the Node tests run it.
// Each write takes a turn (turns.ts); a replaced open file is reloaded in its tab (editor/documents.ts).
import { effect } from "@preact/signals-core";
import type { Expect } from "../../engine/store.ts";
import { isConflict } from "../../engine/store.ts";
import { CONTROL } from "../../stata/quote.ts";
import { close, reload, tabs } from "../editor/documents.ts";
import { closeDialog, dialog, openDialog, showToast } from "../state/notices.ts";
import type { Dialog, FileInfo } from "../types.ts";
import { decodeText } from "./open.ts";
import { SequentialPromiseQueue } from "./sequential-promise-queue.ts";
import type { Io, Turn } from "./turns.ts";
import { fileTurn } from "./turns.ts";

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
 *  control character is counted, and its reason goes to the console. Uploads run one at a time, in the order of the
 *  calls: two quick drops of one path apply in drop order, whichever read ends first.
 *  @param items - the items, or their read still under way (intake.ts), which the upload waits for in its place; a read
 *  that fails rejects the upload, and the uploads after it go on.
 *  @param words - "sample" (a restore, sample.ts) has the dialog and the toast say "Sample restored", "The sample is
 *  already here" (nothing to write, nothing asked), "Couldn't restore the sample".
 *  @returns the paths written */
export async function upload(items: Incoming[] | Promise<Incoming[]>, words: WordsOf = "upload"): Promise<string[]> {
  const read = Promise.resolve(items);
  read.catch(() => {}); // a read that fails while it waits for its place is not an unhandled rejection: the task takes it
  return uploadQueue.enqueue(async () => uploadNow(await read, words));
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
  if (lastClashDialog !== null) closeDialog(lastClashDialog);
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
    openDialog(shown);
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
