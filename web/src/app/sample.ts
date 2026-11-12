// The sample project (docs/design/SPEC.md, section 3.12): analysis.do, helpers.do and data/wages.dta, synthetic data made
// by web/sample/make_sample.py (fixed seed). Their bytes are in sample-files.ts (generated: `npm run sample`).
//  - seedSample(): on a first visit, when the store is empty, writes them and opens analysis.do. "First visit" is the
//    localStorage mark `dofile.sample` plus an empty store: a visitor who deleted every file is not given the sample
//    again (the file menu's "Restore the sample" is there for that), and a store with any file is never written over. The
//    mark is set once the three files are written (or when the store has files of the visitor's): a seed that fails is
//    tried again on the next visit if the store is still empty. With ?test in the URL it does nothing unless the URL also
//    has ?sample (the e2e tests start from an empty store). It never rejects.
//  - restoreSample(): the file menu's item. Files the visitor has not changed, or that are missing, are written with no
//    question; if some differ from the sample, or are open with unsaved edits, the dialog restore-sample asks first and
//    names them (dialogs: files/dialogs.tsx). Other files are never touched.
// Plain TypeScript (no JSX), tested in Node (test/sample.test.ts).
import { editorCommands } from "./editor/commands.ts";
import { decodeText, openFile } from "./files/open.ts";
import { SAMPLE } from "./sample-files.ts";
import { dialog, saved, showToast, tabs } from "./state.ts";
import { store } from "./store.ts";

/** The file the first visit opens. */
export const SAMPLE_MAIN = "analysis.do";
/** The sample's paths (files.ts: the first visit's writes of these bring no storage banner). */
export const SAMPLE_PATHS: readonly string[] = SAMPLE.map((f) => f.path);
const MARK = "dofile.sample";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The sample's files as bytes. */
export const sampleFiles = (): { path: string; bytes: Uint8Array }[] =>
  SAMPLE.map((f) => ({
    path: f.path,
    bytes: f.base64 !== undefined ? decode(f.base64) : new TextEncoder().encode(f.text),
  }));

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function put(only?: string[]) {
  for (const f of sampleFiles()) {
    if (only && !only.includes(f.path)) continue;
    await store.write(f.path, f.bytes);
    // an open tab of a file written over shows the sample's text, decoded as the editor reads a file (a BOM kept, so the
    // editor notes the file's form): the sample's form, "\n" and no BOM, so a tab whose file had "\r\n" or a BOM saves
    // the sample's form from then on, as the store now holds it
    const tab = tabs.value.find((t) => t.path === f.path && t.kind === "text");
    if (tab) editorCommands.reload(f.path, decodeText(f.bytes, true) ?? "");
  }
}

/** First visit: write the sample into an empty store and open its main do-file. Resolves true when it did. */
export async function seedSample(): Promise<boolean> {
  try {
    if (!globalThis.location) return false; // not a page (the Node tests)
    const q = new URLSearchParams(globalThis.location.search);
    if (q.has("test") && !q.has("sample")) return false;
    if (saved.get(MARK) || store.blocked) return false;
    if ((await store.list()).length) {
      saved.set(MARK, "1"); // the visitor has files of their own: never the sample
      return false;
    }
    await put();
    saved.set(MARK, "1"); // only once it is all there: a seed cut short is tried again on a later visit to an empty store
    await openFile(SAMPLE_MAIN);
    return true;
  } catch (e) {
    console.warn(`[dofile] the sample: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/** Which of the sample's files are missing, and which are there with other contents. */
export async function sampleState(): Promise<{ missing: string[]; changed: string[] }> {
  const missing: string[] = [],
    changed: string[] = [];
  for (const f of sampleFiles()) {
    // the store, not the signal: the list may be a moment old
    try {
      if (!same(await store.read(f.path), f.bytes)) changed.push(f.path);
    } catch {
      missing.push(f.path);
    }
  }
  return { missing, changed };
}

/** The sample's files open in a tab with unsaved edits: Restore would drop the edits, so it counts them as changed. */
const unsaved = () => SAMPLE_PATHS.filter((p) => tabs.value.some((t) => t.path === p && t.dirty));

/** The file menu's "Restore the sample". Nothing is replaced without asking: a file whose stored copy differs from the
 *  sample, or that is open with unsaved edits, is named in the dialog restore-sample. */
export async function restoreSample(): Promise<void> {
  try {
    const state = await sampleState(),
      missing = state.missing.filter((p) => !unsaved().includes(p)),
      changed = SAMPLE_PATHS.filter((p) => state.changed.includes(p) || unsaved().includes(p));
    if (changed.length) {
      dialog.value = { d: "restore-sample", paths: changed };
      return;
    }
    if (!missing.length) return void showToast("The sample is already here");
    await put(missing);
    showToast("Sample restored");
  } catch (e) {
    console.warn(`[dofile] restore the sample: ${(e as Error)?.message ?? e}`);
    showToast("Couldn't restore the sample", "error");
  }
}

/** The dialog's "Replace": write every file of the sample that is missing, differs or is open with unsaved edits (an open
 *  tab shows the sample's text, its edits dropped), then open the main do-file. */
export async function replaceWithSample(): Promise<void> {
  try {
    const { missing, changed } = await sampleState();
    await put([...missing, ...changed, ...unsaved()]);
    showToast("Sample restored");
    await openFile(SAMPLE_MAIN);
  } catch (e) {
    console.warn(`[dofile] restore the sample: ${(e as Error)?.message ?? e}`);
    showToast("Couldn't restore the sample", "error");
  }
}
