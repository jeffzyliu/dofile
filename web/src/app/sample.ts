// The sample project (docs/design/SPEC.md, section 3.12): analysis.do, helpers.do and data/wages.dta, synthetic data made
// by web/sample/make_sample.py (fixed seed). Their bytes are in sample-files.ts (generated: `npm run sample`).
//  - seedSample(): on a first visit, when the store is empty, writes them and opens analysis.do. "First visit" is the
//    localStorage mark `dofile.sample` plus an empty store: a visitor who deleted every file is not given the sample
//    again (the file menu's "Restore the sample" is there for that), and a store with any file is never written over. With
//    ?test in the URL it does nothing unless the URL also has ?sample (the e2e tests start from an empty store).
//  - restoreSample(): the file menu's item. Files the visitor has not changed, or that are missing, are written with no
//    question; if some differ from the sample, the dialog restore-sample asks first and names them (dialogs: files/dialogs.tsx).
//    Other files are never touched.
// Plain TypeScript (no JSX), tested in Node (test/sample.test.ts).
import { editorCommands } from "./editor/commands.ts";
import { openFile } from "./files/open.ts";
import { SAMPLE } from "./sample-files.ts";
import { dialog, saved, showToast, tabs } from "./state.ts";
import { store } from "./store.ts";

/** The file the first visit opens. */
export const SAMPLE_MAIN = "analysis.do";
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
    // an open tab of a file written over shows the sample's text
    const tab = tabs.value.find((t) => t.path === f.path && t.kind === "text");
    if (tab) editorCommands.reload(f.path, new TextDecoder().decode(f.bytes));
  }
}

/** First visit: write the sample into an empty store and open its main do-file. Resolves true when it did. */
export async function seedSample(): Promise<boolean> {
  if (!globalThis.location) return false; // not a page (the Node tests)
  const q = new URLSearchParams(globalThis.location.search);
  if (q.has("test") && !q.has("sample")) return false;
  if (saved.get(MARK) || store.blocked) return false;
  try {
    if ((await store.list()).length) {
      saved.set(MARK, "1"); // the visitor has files of their own: never the sample
      return false;
    }
    saved.set(MARK, "1");
    await put();
  } catch (e) {
    console.warn(`[dofile] the sample: ${(e as Error)?.message ?? e}`);
    return false;
  }
  await openFile(SAMPLE_MAIN);
  return true;
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

/** The file menu's "Restore the sample". Nothing is replaced without asking. */
export async function restoreSample(): Promise<void> {
  try {
    const { missing, changed } = await sampleState();
    if (changed.length) {
      dialog.value = { d: "restore-sample", paths: changed };
      return;
    }
    if (!missing.length) return void showToast("The sample is already here");
    await put(missing);
    showToast("Sample restored");
  } catch (e) {
    console.warn(`[dofile] restore the sample: ${(e as Error)?.message ?? e}`);
    showToast("Couldn't restore the sample");
  }
}

/** The dialog's "Replace": write every file of the sample that is missing or differs, then open the main do-file. */
export async function replaceWithSample(): Promise<void> {
  try {
    const { missing, changed } = await sampleState();
    await put([...missing, ...changed]);
    showToast("Sample restored");
    await openFile(SAMPLE_MAIN);
  } catch (e) {
    console.warn(`[dofile] restore the sample: ${(e as Error)?.message ?? e}`);
    showToast("Couldn't restore the sample");
  }
}
