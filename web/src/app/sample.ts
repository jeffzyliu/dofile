// The sample project (docs/design/SPEC.md, section 3.12): analysis.do, helpers.do and data/wages.dta, synthetic data
// made by web/sample/make_sample.py. Their bytes are in sample-files.ts (generated: `npm run sample`). Plain
// TypeScript, tested in Node (test/sample.test.ts).

import { upload } from "./files/actions.ts";
import { openFile } from "./files/open.ts";
import { fileTurn } from "./files/turns.ts";
import { SAMPLE } from "./sample-files.ts";
import { saved, showToast } from "./state.ts";
import { store } from "./store.ts";

/** The file the first visit opens. */
export const SAMPLE_MAIN = "analysis.do";
/** The sample's paths. */
export const SAMPLE_PATHS: readonly string[] = SAMPLE.map((f) => f.path);
const MARK = "dofile.sample";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The sample's files as bytes. */
export const sampleFiles = (): { path: string; bytes: Uint8Array }[] =>
  SAMPLE.map((f) => ({
    path: f.path,
    bytes: f.base64 !== undefined ? decode(f.base64) : new TextEncoder().encode(f.text),
  }));

/** The first visit's write of the sample's files, in one turn with the list that finds the store empty: false, writing
 *  nothing, when it is not. */
function put(): Promise<boolean> {
  return fileTurn(function* (io) {
    if ((yield* io.list()).length) return false;
    for (const f of sampleFiles()) yield* io.write(f.path, f.bytes, "absent");
    return true;
  });
}

/** On a first visit, write the sample into an empty store and open its main do-file. A first visit is the localStorage
 *  mark `dofile.sample` plus an empty store: a visitor who deleted every file is not given the sample again (the file
 *  menu's "Restore the sample" is there for that). The mark is set once all files are written, so a seed that fails is
 *  tried again on the next visit. With ?test in the URL it does nothing unless the URL also has ?sample. Never rejects.
 *  @returns true when it wrote the sample. */
export async function seedSample(): Promise<boolean> {
  try {
    if (!globalThis.location) return false; // not a page (the Node tests)
    const q = new URLSearchParams(globalThis.location.search);
    if (q.has("test") && !q.has("sample")) return false;
    if (saved.get(MARK) || store.blocked) return false;
    if (!(await put())) {
      saved.set(MARK, "1"); // the visitor has files of their own: never the sample
      return false;
    }
    // only once it is all there: a seed cut short is tried again on a later visit to an empty store
    saved.set(MARK, "1");
    await openFile(SAMPLE_MAIN);
    return true;
  } catch (e) {
    console.warn(`[dofile] the sample: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/** The file menu's "Restore the sample": an upload of the sample's files, so a file the visitor changed, or has open
 *  with unsaved edits, is asked about like an upload's clash, and one that holds the sample's bytes already is left
 *  alone. Other files are never touched. Then analysis.do is opened, when the store has it. */
export async function restoreSample(): Promise<void> {
  try {
    await upload(
      sampleFiles().map((f) => ({ path: f.path, data: f.bytes })),
      "sample",
    );
    // the store, not the list: it may be a moment old
    if (
      await store.read(SAMPLE_MAIN).then(
        () => true,
        () => false,
      )
    )
      await openFile(SAMPLE_MAIN);
  } catch (e) {
    console.warn(`[dofile] restore the sample: ${(e as Error)?.message ?? e}`);
    showToast("Couldn't restore the sample", "error");
  }
}
