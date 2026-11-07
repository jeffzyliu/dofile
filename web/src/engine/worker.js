// The engine's Web Worker: Pyodide + the dofile wheel, the user's files in /work, saved to IndexedDB when the browser
// has it (in Node, for tests, /work is in memory only).
// Protocol: the page posts {id, op, args}; the worker answers {id, result} or {id, error}, one op at a time, and
// posts {status} lines while it starts. client.js is the page's side. Python's side: src/dofile/browser.py.
import { loadPyodide } from "pyodide";
import { isStorageRefusal, restoreOptions, unpack } from "./snapshot.js";

const ROOT = "/work";
let py, browser, interrupt = null, fromSnapshot = false;
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

// Starting is two steps so the page can show the user's files early:
//   mount: Pyodide itself and the files in /work. It is an ordinary queued op, so every file op posted after it waits
//          for it (a write can't reach /work before the saved files have been loaded into it).
//   boot:  the packages, the dofile wheel and the engine. It runs outside the queue, so file ops are answered while it
//          loads; the ops that need the engine (run, describe, matrix) wait for it.
let bootDone;
const booted = new Promise((ok, err) => { bootDone = { ok, err }; });
booted.catch(() => {});   // the error reaches the page through boot's own answer

// The files of a snapshot (scripts/make-snapshot.mjs) at `base`, an http(s) or file: URL ending in "/". The patched
// pyodide.asm.mjs is imported from there too: Pyodide's own loader has no hook for linking libraries again.
// `store`: { cache, refused } or undefined. `cache` is a Cache the bytes are kept in (the browser's HTTP cache doesn't
// reliably keep files this big); `refused(error)` is told when the browser would not take them: it returns for a refusal
// of storage (the engine then starts uncached, and says so) and throws for anything else.
async function fetchBytes(url, store) {
  if (url.startsWith("file:")) {
    const fsName = "node:fs/promises";   // Node only (the tests); a variable so the bundler leaves it alone
    return new Uint8Array(await (await import(/* @vite-ignore */ fsName)).readFile(new URL(url)));
  }
  const hit = await store?.cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (store) {
    try { await store.cache.put(url, new Response(bytes)); } catch (e) { store.refused(e, url); }
  }
  return bytes;
}
const fetchJSON = async (url, store) => JSON.parse(new TextDecoder().decode(await fetchBytes(url, store)));

// A cache holding one build of the snapshot: a rebuild has a new `built` in its manifest, and the old build is dropped.
async function snapshotCache(built, refused) {
  if (typeof caches === "undefined") { refused(Object.assign(new Error("there is no Cache API here (not a secure context?)"), { name: "NoCacheAPI" })); return undefined; }
  try {
    for (const name of await caches.keys()) if (name.startsWith("dofile-snapshot-") && name !== `dofile-snapshot-${built}`) await caches.delete(name);
    return await caches.open(`dofile-snapshot-${built}`);
  } catch (e) { refused(e); return undefined; }   // a refusal (private mode, blocked storage) is reported; anything else is thrown
}

// The brotli-wasm decoder. In a browser it loads its wasm from the page's own files; in Node (the tests) the package's
// own entry is the one that works (the browser entry fetches its wasm by URL, which Node's fetch cannot do for files).
async function loadBrotli() {
  if (typeof process !== "undefined" && process.versions?.node) {
    const mod = "node:module";   // a variable so the bundler leaves it alone
    return (await import(/* @vite-ignore */ mod)).createRequire(import.meta.url)("brotli-wasm");
  }
  return (await import("brotli-wasm")).default;
}

async function loadFromSnapshot(base, indexURL, wheelName, io) {
  const t0 = performance.now();
  let last = t0;
  const laps = [];
  const notCached = [];   // why the browser kept nothing, if it would not (reported with the timings, and in the console)
  const isFile = base.startsWith("file:");   // Node, the tests: no Cache API by design
  const refused = (e, url) => {
    if (!isStorageRefusal(e)) throw e;   // not the browser saying no: a bug, shown as the start's error
    const why = `${e.name + ": "}${e.message}${url ? ` (${url.split("/").pop()})` : ""}`;
    if (!isFile) { notCached.push(why); console.warn(`[dofile] snapshot not cached: ${why}`); }
  };
  const lap = what => { const t = performance.now(); laps.push(`${what} ${((t - last) / 1000).toFixed(2)}s`); last = t; };
  // the manifest is the one file that must be fresh: it says which build the cached files belong to
  const manifest = await (base.startsWith("file:") ? fetchJSON(`${base}manifest.json`)
    : fetch(`${base}manifest.json`, { cache: "no-cache" }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  ).catch(e => {
    throw new Error(`no snapshot at ${base}: run \`npm run snapshot\` in web/ (${e?.message ?? e})`);
  });
  if (manifest.wheel !== wheelName) {
    throw new Error(`the snapshot is for ${manifest.wheel} but the page has ${wheelName}: run \`npm run snapshot\` again`);
  }
  if (!manifest.files) throw new Error("the snapshot is in an older format: run `npm run snapshot` again");
  const { snapshot: snapFile, bundle: bundleFile } = manifest.files;
  const cache = isFile ? undefined : await snapshotCache(manifest.built, refused);
  const store = cache && { cache, refused };
  const hadCache = Boolean(cache) && Boolean(await cache.match(`${base}${snapFile.name}`));
  // The two big files are kept in the cache as they were sent, compressed (46 MB, not 229), and decompressed here.
  const [snapPacked, dso, index, bundlePacked, { default: create }, brotli] = await Promise.all([
    fetchBytes(`${base}${snapFile.name}`, store), fetchJSON(`${base}dso.json`, store), fetchJSON(`${base}files.json`, store),
    fetchBytes(`${base}${bundleFile.name}`, store), import(/* @vite-ignore */ `${base}pyodide.asm.patched.mjs?v=${manifest.built}`),
    loadBrotli(),
  ]);
  lap(hadCache ? "read from cache" : "download");
  const snapshot = unpack(brotli, snapPacked, snapFile);
  const blob = unpack(brotli, bundlePacked, bundleFile);
  lap("decompress");
  const options = restoreOptions(create, { snapshot, dso, index, blob }, lap);
  const loaded = await loadPyodide({ indexURL, ...options, ...io });
  lap("copy the heap");
  console.info(`[dofile] snapshot start: ${laps.join(", ")}, total ${((performance.now() - t0) / 1000).toFixed(2)}s` +
    (notCached.length ? `, NOT CACHED: ${[...new Set(notCached)].join("; ")}` : ""));
  return loaded;
}

const ops = {
  async mount({ indexURL, snapshot, wheelName }) {
    status("loading Python");
    const io = { stdout: l => console.log(l), stderr: l => console.warn(l) };
    fromSnapshot = Boolean(snapshot);
    py = snapshot ? await loadFromSnapshot(snapshot, indexURL, wheelName, io) : await loadPyodide({ indexURL, ...io });
    py.FS.mkdirTree(ROOT);
    if (persistent()) {
      status("loading your files");
      py.FS.mount(py.FS.filesystems.IDBFS, {}, ROOT);
      await syncfs(true);
    }
  },
  // wheel: the dofile wheel's URL, or {name, bytes}; interruptBuffer: an Int32Array on a SharedArrayBuffer, or null
  async boot({ wheel, interruptBuffer }) {
    if (!fromSnapshot) {   // a snapshot has the packages and the wheel in it already
      status("loading packages");
      await py.loadPackage("micropip", { messageCallback: () => {} });
      const name = typeof wheel === "string" ? wheel.split("/").at(-1) : wheel.name;
      const bytes = typeof wheel === "string" ? new Uint8Array(await (await fetch(wheel)).arrayBuffer()) : wheel.bytes;
      py.FS.writeFile(`/tmp/${name}`, bytes);
      await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${name}")`);
    }
    interrupt = interruptBuffer ?? null;
    if (interrupt) py.setInterruptBuffer(interrupt);
    status("starting the engine");
    browser = py.pyimport("dofile.browser");
    return JSON.parse(browser.start(ROOT));
  },
  async run({ code }) {
    await booted;
    if (interrupt) interrupt[0] = 0;   // a Break pressed while idle must not stop this run
    const result = JSON.parse(browser.run(code));
    await save();
    return result;
  },
  // undefined becomes Python's None (null would become JsNull)
  describe: async ({ vars, offset = 0, limit }) => (await booted, JSON.parse(browser.describe(vars, offset, limit))),
  matrix: async ({ name }) => (await booted, JSON.parse(browser.matrix(name))),
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

const answer = async (id, op, args) => {
  try {
    if (!ops[op]) throw new Error(`unknown op ${op}`);
    const result = await ops[op](args ?? {});
    self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);   // a file: moved, not copied
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};

self.onmessage = ({ data: { id, op, args } }) => {
  if (op === "boot") {   // outside the queue, so file ops are answered while the engine loads
    ops.boot(args ?? {}).then(about => { bootDone.ok(); self.postMessage({ id, result: about }); },
      e => { bootDone.err(e); self.postMessage({ id, error: String(e?.message ?? e) }); });
    return;
  }
  queue = queue.then(() => answer(id, op, args));
};
