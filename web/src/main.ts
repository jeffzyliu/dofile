// Proof-of-concept page (Phase 2, step 4): editor, files in the browser, Run, Break, log, graphs. No framework yet
// (decision 3 waits for the design step).
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { stata } from "./stata/language";
import { EngineClient, RC_RESET, engineBytes } from "./engine/client.js";
import { openStore } from "./engine/store.js";
import { keepFiles, tabLock } from "./engine/tab.js";

type FileInfo = { path: string; dir: boolean; size: number };
type RunResult = { rc: number; error: string | null; log: string; images: string[];
  timing?: { engine: number; encode: number; parse: number; save: number } };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const [runBtn, breakBtn, resetBtn, saveBtn] = ["run", "break", "reset", "save"].map(id => $<HTMLButtonElement>(id));
const status = $("status"), log = $("log"), graphs = $("graphs"), fileList = $("files");
const TEXT = /\.(do|ado|txt|csv|log|smcl|md|json|raw|dct)$/i;
const SAMPLE = `* dofile: Stata-syntax code, run in your browser. Files stay in this browser.
* Upload .dta/.csv/.do files on the left; do-files can name them by any path.
clear
set obs 200
set seed 1
generate x = rnormal()
generate y = 1 + 2*x + rnormal()
regress y x, robust
scatter y x
`;

let current = "main.do";   // the file in the editor
let dirty = false;   // edited since it was loaded or saved: only then can it be written back (never rewrite a file just opened)
let ready = false;
const started = performance.now();
// The page starts from the memory snapshot unless the URL says ?snapshot=0 (the normal boot: Pyodide's runtime and packages
// from the CDN). Any other value, a bare ?snapshot and an old ?snapshot=1 link included, is the snapshot.
const useSnapshot = new URLSearchParams(location.search).get("snapshot") !== "0";

// The files live in the page's own store (IndexedDB): the list, the editor and the downloads read and write it directly, with
// or without an engine. The engine's worker gets a copy when it starts and writes back what each run changed.
const store = openStore();

const engine = new EngineClient({
  createWorker: () => new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" }),
  wheel: new URL(`${import.meta.env.BASE_URL}${__WHEEL__}`, location.href).href,
  extraWheels: __EXTRA_WHEELS__.map(f => new URL(`${import.meta.env.BASE_URL}${f}`, location.href).href),
  wheelHash: __WHEEL_HASH__,
  // the snapshot start takes Pyodide's runtime from the page's own origin (public/pyodide/); the normal boot uses the CDN
  indexURL: useSnapshot ? new URL(`${import.meta.env.BASE_URL}pyodide/`, location.href).href : __PYODIDE__,
  store,
  startFiles: new URL(`${import.meta.env.BASE_URL}start-files.json`, location.href).href,   // the build's list, for download()
  // the Pyodide memory snapshot `npm run snapshot` builds (faster to start, a bigger download); no fallback if it is
  // missing or stale: the page says so, and ?snapshot=0 is the normal boot
  snapshot: useSnapshot ? new URL(`${import.meta.env.BASE_URL}snapshot/`, location.href).href : undefined,
  brotli: new URLSearchParams(location.search).get("brotli") ?? undefined,   // ?brotli=wasm: brotli-wasm, not the browser's decoder
  onStatus: (s: string) => { status.textContent = `${s}…`; },
});

const editor = new EditorView({
  parent: $("editor"),
  extensions: [basicSetup, stata,
    Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => { run(true); return true; } }])),
    EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true); })],
});

(window as unknown as { __editor: EditorView }).__editor = editor;   // for e2e/poc.spec.ts: replaces the text without Ctrl+A, which
                                                                     // WebKit on Linux (iPhone profile) leaves a last line out of

// Files are written only by Save (and by New file and uploads), never by Run: like Stata's do-file editor, Run executes the
// editor's text and leaves the file alone. `dirty` shows next to the file's name and on the Save button, and the page
// warns before a switch to another file or closing the page would lose the edits.
function setDirty(on: boolean) {
  dirty = on;
  saveBtn.disabled = !on;
  document.querySelector("#files .open")?.classList.toggle("dirty", on);
}

// true when it is fine to replace the editor's text: nothing unsaved, or the user agreed to discard it
function leave(): boolean {
  if (!dirty) return true;
  if (!confirm(`${current} has unsaved changes. Discard them? (Cancel keeps them; then use Save.)`)) return false;
  setDirty(false);
  return true;
}
addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });   // the browser's own wording
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
});

function setRunning(on: boolean) {
  runBtn.disabled = on || !ready;   // one run at a time: Break follows the run in progress
  breakBtn.disabled = !on;
  resetBtn.disabled = !ready;
}

async function save() {
  if (!dirty) return;
  const path = current, text = editor.state.doc.toString();
  await store.write(path, new TextEncoder().encode(text));
  if (path === current && editor.state.doc.toString() === text) setDirty(false);   // not if typing went on while it was written
}

async function saveNow() {
  if (!dirty) return;
  const path = current;
  try {
    await save();
    status.textContent = `saved ${path}`;
  } catch (e) {
    status.textContent = `could not save ${path}: ${(e as Error).message}`;
  }
}
saveBtn.onclick = saveNow;

function show(text: string) {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  setDirty(false);
}

async function open(path: string) {
  const bytes = await store.read(path);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    alert(`${path} is not UTF-8 text, so the editor would change it. Download it to edit it elsewhere.`);
    return;
  }
  if (!leave()) return;
  current = path;
  show(text);
  await refreshFiles();
}

async function refreshFiles() {
  const files: FileInfo[] = await store.list();
  fileList.replaceChildren(...files.filter(f => !f.dir).map(f => {
    const li = document.createElement("li");
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: f.path, title: `${f.size} bytes` });
    if (f.path === current) name.classList.add("open", ...(dirty ? ["dirty"] : []));
    if (TEXT.test(f.path)) name.onclick = () => open(f.path);
    const get = Object.assign(document.createElement("button"), { textContent: "↓", title: "Download" });
    get.onclick = async () => {
      const bytes = await store.read(f.path);
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: f.path.split("/").at(-1)!,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const del = Object.assign(document.createElement("button"), { textContent: "✕", title: "Delete" });
    del.onclick = async () => {
      if (!confirm(`Delete ${f.path}?`)) return;
      await store.remove(f.path);
      await refreshFiles();
    };
    li.append(name, get, del);
    return li;
  }));
}

async function upload(files: Iterable<File>) {
  let replacedOpen = false;
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    await store.write(path, new Uint8Array(await f.arrayBuffer()));
    replacedOpen ||= path === current;
  }
  if (replacedOpen) {   // the upload wins over the editor's copy, which would otherwise be saved over it
    setDirty(false);
    await open(current);
  }
  await refreshFiles();
}

async function run(selection = false) {
  if (!ready || engine.running) return;
  const sel = editor.state.selection.main;
  const code = selection && !sel.empty ? editor.state.sliceDoc(sel.from, sel.to) : editor.state.doc.toString();
  setRunning(true);
  status.textContent = "running…";
  const t = performance.now();
  const r = await engine.run(code) as RunResult;
  setRunning(false);
  const total = (performance.now() - t) / 1000, k = r.timing;
  // where the run's time went: the engine (drawing the graphs is in it), base64 of the images, JSON, saving the files the
  // run changed to the store, and what is left (messages between the worker and the page); absent for a reset (rc 9998)
  status.textContent = `rc ${r.rc} in ${total.toFixed(2)} s` + (k?.engine !== undefined
    ?` (engine ${k.engine.toFixed(2)}, encode ${k.encode.toFixed(2)}, json ${k.parse.toFixed(2)}, save ${k.save.toFixed(2)}, ` +
      `other ${(total - k.engine - k.encode - k.parse - k.save).toFixed(2)})` : "");
  log.textContent += r.log + (r.rc === RC_RESET ? `\n${r.error}\n` : "") + "\n";
  // Like Stata's Graph window: only the latest graph is shown; a run that draws nothing keeps the previous one.
  const latest = r.images.at(-1);
  if (latest) graphs.replaceChildren(Object.assign(new Image(), { src: `data:image/png;base64,${latest}` }));
  $("output").scrollTop = log.scrollHeight;
  await refreshFiles();
}

runBtn.onclick = () => run();
breakBtn.onclick = () => { status.textContent = "breaking…"; engine.breakRun(); };
resetBtn.onclick = async () => {
  ready = false;
  setRunning(false);
  await engine.restart("reset by you");
  ready = true;
  setRunning(false);
  status.textContent = "new engine: data cleared, files kept";
};
$("clear").onclick = () => { log.textContent = ""; graphs.replaceChildren(); };
$("new").onclick = async () => {
  const name = prompt("New file name", "analysis.do");
  if (!name) return;
  if ((await store.list()).some(f => f.path === name)) return alert(`${name} already exists`);
  if (!leave()) return;   // the new file replaces the editor's text
  await store.write(name, new TextEncoder().encode(SAMPLE));
  await open(name);
};
for (const id of ["upload", "upload-dir"]) {
  const input = $<HTMLInputElement>(id);
  input.onchange = () => upload(input.files ?? []).then(() => { input.value = ""; });
}
document.body.ondragover = e => e.preventDefault();
document.body.ondrop = e => { e.preventDefault(); upload(e.dataTransfer?.files ?? []); };

// The engine loads in the background. The files and the editor don't wait for it: they use the store, and the engine's
// worker copies the store when it starts, so edits, uploads and deletes made before the engine is ready are in the folder
// it will run against. Only Run and Reset wait (`ready`).
const isolation = crossOriginIsolated ? "" : " (not cross-origin isolated: Break restarts the engine)";
// download() first: it is the one writer of the Cache the start reads (a start without it works, uncached). If it fails
// (offline, say), the start goes on and reads what the Cache has, or fetches the rest.
const mb = (n: number) => (n / 1e6).toFixed(1);
const startEngine = () => engine.download({ onProgress: ({ received, total }: { received: number; total: number }) => {
  status.textContent = `downloading the engine: ${mb(received)} of ${mb(total)} MB…`;
} }).catch((e: Error) => console.warn(`[dofile] download: ${e.message}`)).then(() => engine.start()).then(() => {
  ready = true;
  setRunning(false);
  // Where the time went (worker.js, `startup`). From a snapshot: download (or read from the browser's cache), unpack (brotli),
  // restore (the heap and the native libraries), your files, the engine's start; "not cached" is the browser refusing the
  // cache (plain http on a LAN). A normal boot: Pyodide's runtime, your files, packages (micropip, the wheel, numpy, scipy,
  // matplotlib), the engine's start.
  const t = engine.startup as { mode: "snapshot" | "normal"; fetched: string; fetchS: number; unpackS: number; heapS: number; sitePackagesS: number; decoder: string; restoreS: number;
    runtimeS: number; packagesS: number; filesS: number; engineS: number; notCached: string[] } | null;
  const s = (x: number) => `${x.toFixed(1)} s`;
  const parts = !t ? [] : t.mode === "snapshot"
    ? [`${t.fetched} ${s(t.fetchS)}`, `unpack ${s(t.unpackS)} (heap ${s(t.heapS)}, site-packages ${s(t.sitePackagesS)}, decoder ${t.decoder})`, `restore ${s(t.restoreS)}`, `files ${s(t.filesS)}`, `engine ${s(t.engineS)}`]
    : [`runtime ${s(t.runtimeS)}`, `files ${s(t.filesS)}`, `packages ${s(t.packagesS)}`, `engine ${s(t.engineS)}`];
  const where = parts.length ? ` [${parts.join(", ")}${t?.notCached?.length ? "; not cached" : ""}]` : "";
  status.textContent = `ready in ${((performance.now() - started) / 1000).toFixed(1)} s${useSnapshot ? " (snapshot)" : ""}${where}${isolation}`;
}, (e: Error) => {
  if (store.blocked) return;   // another tab took over while this one was starting: the status says so already
  const hint = useSnapshot ? " (or open the page with ?snapshot=0 for the normal start, without the snapshot)" : "";
  status.textContent = `the engine did not start: ${e.message}${hint}. You can still edit and download your files.`;
});

// One tab owns the files and the engine (the Web Lock "dofile-engine"). A tab that cannot get it starts no engine and
// writes nothing, unless the user takes over; the tab that loses the lock ends its engine.
const OTHER_TAB = "dofile is open in another tab";
function pause() {
  store.blocked = true;
  ready = false;
  setRunning(false);
  status.textContent = `${OTHER_TAB}: this tab is paused (reload it to use dofile here)`;
}
const lock = tabLock({ onLost: () => { engine.stop("another tab took over"); pause(); } });
// Does the browser keep the files: true, false, null (it has no such API), undefined (not known yet). What a real page
// puts in its `persisted` signal.
let persisted: boolean | null | undefined;
// The test hook, only with ?test in the URL (e2e/step2.spec.ts): window.__dofile = { engine, store, start, persisted,
// engineBytes }. persisted() is the value above. With ?test=manual the page starts no engine: the test calls start().
const test = new URLSearchParams(location.search).get("test");
if (test !== null) {
  Object.assign(window, { __dofile: { engine, store, start: startEngine, persisted: () => persisted, engineBytes: engineBytes() } });
}

if (await lock.take() || (confirm(`${OTHER_TAB}. Only one tab can use your files at a time. Use dofile in this tab?`) && await lock.take({ steal: true }))) {
  keepFiles(undefined, kept => { persisted = kept; });   // asks the browser once to keep the files; it may answer later
  if (test !== "manual") startEngine();
  if (!(await store.list()).length) await store.write(current, new TextEncoder().encode(SAMPLE));   // first visit
  const files = await store.list();
  await open(files.some(f => f.path === current) ? current : files.find(f => /\.do$/.test(f.path))?.path ?? current);
} else {
  pause();
}
