// The engine's Web Worker: Pyodide + the dofile wheel, the user's files in /work, saved to IndexedDB when the browser
// has it (in Node, for tests, /work is in memory only).
// Protocol: the page posts {id, op, args}; the worker answers {id, result} or {id, error}, one op at a time, and
// posts {status} lines while it starts. client.js is the page's side. Python's side: src/dofile/browser.py.
import { loadPyodide } from "pyodide";

const ROOT = "/work";
let py, browser, interrupt = null;
let queue = Promise.resolve();

const persistent = () => typeof indexedDB !== "undefined";
const syncfs = load => new Promise((ok, err) => py.FS.syncfs(load, e => (e ? err(e) : ok())));
const save = () => (persistent() ? syncfs(false) : undefined);
const status = text => self.postMessage({ status: text });

// a path from the page, relative to /work; it may not leave it
function inRoot(path) {
  const full = py.PATH.normalize(`${ROOT}/${path}`);
  if (full !== ROOT && !full.startsWith(`${ROOT}/`)) throw new Error(`not in the working folder: ${path}`);
  return full;
}

function walk(dir, out = []) {
  for (const name of py.FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const full = `${dir}/${name}`, st = py.FS.stat(full), isDir = py.FS.isDir(st.mode);
    out.push({ path: full.slice(ROOT.length + 1), dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtime.getTime() });
    if (isDir) walk(full, out);
  }
  return out;
}

function removeTree(full) {
  if (!py.FS.isDir(py.FS.stat(full).mode)) return py.FS.unlink(full);
  for (const name of py.FS.readdir(full)) if (name !== "." && name !== "..") removeTree(`${full}/${name}`);
  py.FS.rmdir(full);
}

const ops = {
  // wheel: the dofile wheel's URL, or {name, bytes}; interruptBuffer: an Int32Array on a SharedArrayBuffer, or null
  async init({ wheel, indexURL, interruptBuffer }) {
    status("loading Python");
    py = await loadPyodide({ indexURL, stdout: l => console.log(l), stderr: l => console.warn(l) });
    status("loading packages");
    await py.loadPackage("micropip", { messageCallback: () => {} });
    const name = typeof wheel === "string" ? wheel.split("/").at(-1) : wheel.name;
    const bytes = typeof wheel === "string" ? new Uint8Array(await (await fetch(wheel)).arrayBuffer()) : wheel.bytes;
    py.FS.writeFile(`/tmp/${name}`, bytes);
    await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${name}")`);
    status("loading your files");
    py.FS.mkdirTree(ROOT);
    if (persistent()) {
      py.FS.mount(py.FS.filesystems.IDBFS, {}, ROOT);
      await syncfs(true);
    }
    interrupt = interruptBuffer ?? null;
    if (interrupt) py.setInterruptBuffer(interrupt);
    status("starting the engine");
    browser = py.pyimport("dofile.browser");
    return JSON.parse(browser.start(ROOT));
  },
  async run({ code }) {
    if (interrupt) interrupt[0] = 0;   // a Break pressed while idle must not stop this run
    const result = JSON.parse(browser.run(code));
    await save();
    return result;
  },
  // undefined becomes Python's None (null would become JsNull)
  describe: ({ vars, offset = 0, limit }) => JSON.parse(browser.describe(vars, offset, limit)),
  matrix: ({ name }) => JSON.parse(browser.matrix(name)),
  files: () => walk(ROOT),
  read: ({ path }) => py.FS.readFile(inRoot(path)),
  async write({ path, data }) {
    const full = inRoot(path);
    py.FS.mkdirTree(py.PATH.dirname(full));
    py.FS.writeFile(full, data);
    await save();
  },
  async remove({ path }) {
    const full = inRoot(path);
    if (full === ROOT) throw new Error("cannot remove the working folder");
    removeTree(full);
    await save();
  },
  async rename({ from, to }) {
    const dest = inRoot(to);
    py.FS.mkdirTree(py.PATH.dirname(dest));
    py.FS.rename(inRoot(from), dest);
    await save();
  },
};

self.onmessage = ({ data: { id, op, args } }) => {
  queue = queue.then(async () => {
    try {
      if (!ops[op]) throw new Error(`unknown op ${op}`);
      const result = await ops[op](args ?? {});
      self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);   // a file: moved, not copied
    } catch (e) {
      self.postMessage({ id, error: String(e?.message ?? e) });
    }
  });
};
