// Proof-of-concept page (Phase 2, step 4): editor, files in the browser, Run, Break, log, graphs. No framework yet
// (decision 3 waits for the design step).
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { stata } from "./stata/language";
import { EngineClient, RC_RESET } from "./engine/client.js";

type FileInfo = { path: string; dir: boolean; size: number };
type RunResult = { rc: number; error: string | null; log: string; images: string[] };

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

const engine = new EngineClient({
  createWorker: () => new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" }),
  wheel: new URL(`${import.meta.env.BASE_URL}${__WHEEL__}`, location.href).href,
  indexURL: __PYODIDE__,
  onStatus: (s: string) => { status.textContent = `${s}…`; },
});

const editor = new EditorView({
  parent: $("editor"),
  extensions: [basicSetup, stata,
    Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => { run(true); return true; } }])),
    EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true); })],
});

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
  await engine.call("write", { path, data: new TextEncoder().encode(text) });
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
  const bytes: Uint8Array = await engine.call("read", { path });
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
  const files: FileInfo[] = await engine.call("files");
  fileList.replaceChildren(...files.filter(f => !f.dir).map(f => {
    const li = document.createElement("li");
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: f.path, title: `${f.size} bytes` });
    if (f.path === current) name.classList.add("open", ...(dirty ? ["dirty"] : []));
    if (TEXT.test(f.path)) name.onclick = () => open(f.path);
    const get = Object.assign(document.createElement("button"), { textContent: "↓", title: "Download" });
    get.onclick = async () => {
      const bytes: Uint8Array = await engine.call("read", { path: f.path });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: f.path.split("/").at(-1)!,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const del = Object.assign(document.createElement("button"), { textContent: "✕", title: "Delete" });
    del.onclick = async () => {
      if (!confirm(`Delete ${f.path}?`)) return;
      await engine.call("remove", { path: f.path });
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
    await engine.call("write", { path, data: new Uint8Array(await f.arrayBuffer()) });
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
  const r: RunResult = await engine.run(code);
  setRunning(false);
  status.textContent = `rc ${r.rc} in ${((performance.now() - t) / 1000).toFixed(2)} s`;
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
  if ((await engine.call("files") as FileInfo[]).some(f => f.path === name)) return alert(`${name} already exists`);
  if (!leave()) return;   // the new file replaces the editor's text
  await engine.call("write", { path: name, data: new Uint8Array() });
  await open(name);
};
for (const id of ["upload", "upload-dir"]) {
  const input = $<HTMLInputElement>(id);
  input.onchange = () => upload(input.files ?? []).then(() => { input.value = ""; });
}
document.body.ondragover = e => e.preventDefault();
document.body.ondrop = e => { e.preventDefault(); upload(e.dataTransfer?.files ?? []); };

// The engine loads in the background. The files and the editor don't wait for it: the worker answers file calls as
// soon as Python and the saved files are loaded, and edits, uploads and deletes made before the engine is ready are
// in the same /work folder it will run against. Only Run and Reset wait (`ready`).
const isolation = crossOriginIsolated ? "" : " (not cross-origin isolated: Break restarts the engine)";
engine.start().then(() => {
  ready = true;
  setRunning(false);
  status.textContent = `ready in ${((performance.now() - started) / 1000).toFixed(1)} s${isolation}`;
}, (e: Error) => {
  status.textContent = `the engine did not start: ${e.message}. You can still edit and download your files.`;
});
if (!(await engine.call("files") as FileInfo[]).length) {
  await engine.call("write", { path: current, data: new TextEncoder().encode(SAMPLE) });   // first visit
}
const files: FileInfo[] = await engine.call("files");
await open(files.some(f => f.path === current) ? current : files.find(f => /\.do$/.test(f.path))?.path ?? current);
