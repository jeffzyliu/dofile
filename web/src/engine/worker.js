// The engine's Web Worker: Pyodide + the dofile wheel, the user's files in /work, saved to IndexedDB when the browser
// has it (in Node, for tests, /work is in memory only).
// Protocol: the page posts {id, op, args}; the worker answers {id, result} or {id, error}, one op at a time, and
// posts {status} lines while it starts. client.js is the page's side. Python's side: src/dofile/browser.py.
import { loadPyodide } from "pyodide";
import { hasNativeBrotli, isStorageRefusal, restoreOptions, unpackAsync } from "./snapshot.js";

const ROOT = "/work";
let py, browser, interrupt = null, fromSnapshot = false;
let queue = Promise.resolve();

const persistent = () => typeof indexedDB !== "undefined";
const syncfs = load => new Promise((ok, err) => py.FS.syncfs(load, e => (e ? err(e) : ok())));
// Writing /work to IndexedDB took 1 s on an iPhone even when nothing had changed. After a run the write is skipped when the
// folder looks as it did at the last write (paths, sizes, times); file operations from the page always write.
let saved = null;
const folder = () => walk(ROOT).map(f => `${f.path}\0${f.size}\0${f.mtime}`).join("\n");
async function save(onlyIfChanged = false) {
  if (!persistent()) return;
  const now = onlyIfChanged ? folder() : null;
  if (onlyIfChanged && now === saved) return;
  await syncfs(false);
  saved = now ?? folder();
}
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

async function loadFromSnapshot(base, indexURL, wheelName, wheelHash, io, brotliMode) {
  const t0 = performance.now();
  let last = t0;
  const laps = [], secs = [];   // laps: text for the console; secs: [name, seconds] for the page's summary
  const notCached = [];   // why the browser kept nothing, if it would not (reported with the timings, and in the console)
  const isFile = base.startsWith("file:");   // Node, the tests: no Cache API by design
  const refused = (e, url) => {
    if (!isStorageRefusal(e)) throw e;   // not the browser saying no: a bug, shown as the start's error
    const why = `${e.name + ": "}${e.message}${url ? ` (${url.split("/").pop()})` : ""}`;
    if (!isFile) { notCached.push(why); console.warn(`[dofile] snapshot not cached: ${why}`); }
  };
  const lap = what => {
    const t = performance.now(), s = (t - last) / 1000;
    laps.push(`${what} ${s.toFixed(2)}s`); secs.push([what, s]); last = t;
  };
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
  // The wheel's name stays the same while its code changes, so the name alone cannot tell a stale snapshot (it holds the old
  // dofile code). A page without a hash (the Node tests) skips this.
  if (wheelHash && manifest.wheelHash !== wheelHash) {
    throw new Error(`the snapshot was built from a different build of ${wheelName} than this page has: run \`npm run snapshot\` again`);
  }
  const { snapshot: snapFile, bundle: bundleFile } = manifest.files;
  const cache = isFile ? undefined : await snapshotCache(manifest.built, refused);
  const store = cache && { cache, refused };
  const hadCache = Boolean(cache) && Boolean(await cache.match(`${base}${snapFile.name}`));
  // The two big files are kept in the cache as they were sent, compressed (46 MB, not 229), and decompressed here.
  let [snapPacked, dso, index, bundlePacked, { default: create }, brotli] = await Promise.all([
    fetchBytes(`${base}${snapFile.name}`, store), fetchJSON(`${base}dso.json`, store), fetchJSON(`${base}files.json`, store),
    fetchBytes(`${base}${bundleFile.name}`, store), import(/* @vite-ignore */ `${base}pyodide.asm.patched.mjs?v=${manifest.built}`),
    loadBrotli(),
  ]);
  lap(hadCache ? "read from cache" : "download");
  // The browser's own brotli decoder when it has one (brotli-wasm took 25 s for the 229 MB on an iPhone); `?brotli=wasm` in
  // the page's URL forces brotli-wasm, to compare. In Node (the tests) the wasm decoder stays, so they run what the build checks.
  const native = !isFile && brotliMode !== "wasm" && hasNativeBrotli();
  const timed = async (file, packed) => {
    const t = performance.now();
    const [out, decoder] = await unpackAsync(brotli, packed, file, native);
    return [out, since(t), decoder];
  };
  // Peak memory is what kills a phone's tab (an iPhone 13 reloaded the page on the snapshot), so each packed file is let go as
  // soon as it is unpacked, and the site-packages bytes as soon as they are in the file system (restoreOptions).
  const [snapshot, heapS, decoder] = await timed(snapFile, snapPacked);
  snapPacked = null;
  let [blob, sitePackagesS] = await timed(bundleFile, bundlePacked);
  bundlePacked = null;
  lap("decompress");
  console.info(`[dofile] unpack with ${decoder}: heap ${heapS.toFixed(2)}s (${(snapFile.raw / 1e6 / heapS).toFixed(0)} MB/s out), ` +
    `site-packages ${sitePackagesS.toFixed(2)}s (${(bundleFile.raw / 1e6 / sitePackagesS).toFixed(0)} MB/s out), ` +
    `native brotli available ${hasNativeBrotli()}, hardwareConcurrency ${navigator.hardwareConcurrency}, deviceMemory ${navigator.deviceMemory ?? "n/a"}`);
  const options = restoreOptions(create, { snapshot, dso, index, blob }, lap);
  blob = null;   // restoreOptions holds it until it has written the files
  const loaded = await loadPyodide({ indexURL, ...options, ...io });
  lap("copy the heap");
  console.info(`[dofile] snapshot start: ${laps.join(", ")}, total ${((performance.now() - t0) / 1000).toFixed(2)}s` +
    (notCached.length ? `, NOT CACHED: ${[...new Set(notCached)].join("; ")}` : ""));
  // For the page's status line: the first lap is the download (or the read from the cache), "decompress" is the unpack,
  // every lap after it (the wasm module, site-packages, re-linking the libraries, the heap) is the restore.
  const [[fetched, fetchS], [, unpackS], ...rest] = secs;
  const summary = { fetched, fetchS, unpackS, heapS, sitePackagesS, decoder, restoreS: rest.reduce((a, [, s]) => a + s, 0),
    notCached: [...new Set(notCached)] };
  return { loaded, summary };
}

// Where the start's time went, in seconds, for the page's status line (the "startup" op). From a snapshot: fetched (the
// name of the first step: download, or read from cache), fetchS, unpackS, restoreS, filesS, engineS, notCached. A normal
// boot: runtimeS (Pyodide itself), filesS, packagesS (micropip and the wheel with numpy, scipy, matplotlib), engineS.
const startup = {};
const since = t => (performance.now() - t) / 1000;

const ops = {
  async mount({ indexURL, snapshot, wheelName, wheelHash, brotli: brotliMode }) {
    status("loading Python");
    const io = { stdout: l => console.log(l), stderr: l => console.warn(l) };
    fromSnapshot = Boolean(snapshot);
    const tRuntime = performance.now();
    if (snapshot) {
      const { loaded, summary } = await loadFromSnapshot(snapshot, indexURL, wheelName, wheelHash, io, brotliMode);
      py = loaded;
      Object.assign(startup, { mode: "snapshot", ...summary });
    } else {
      py = await loadPyodide({ indexURL, ...io });
      Object.assign(startup, { mode: "normal", runtimeS: since(tRuntime) });
    }
    py.FS.mkdirTree(ROOT);
    const tFiles = performance.now();
    if (persistent()) {
      status("loading your files");
      py.FS.mount(py.FS.filesystems.IDBFS, {}, ROOT);
      await syncfs(true);
      saved = folder();
    }
    startup.filesS = since(tFiles);
  },
  startup: () => startup,
  // wheel: the dofile wheel's URL, or {name, bytes}; interruptBuffer: an Int32Array on a SharedArrayBuffer, or null
  async boot({ wheel, interruptBuffer }) {
    const tPackages = performance.now();
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
    if (!fromSnapshot) startup.packagesS = since(tPackages);
    status("starting the engine");
    const tEngine = performance.now();
    browser = py.pyimport("dofile.browser");
    const about = JSON.parse(browser.start(ROOT));
    startup.engineS = since(tEngine);
    return about;
  },
  async run({ code }) {
    await booted;
    if (interrupt) interrupt[0] = 0;   // a Break pressed while idle must not stop this run
    const t0 = performance.now();
    const result = JSON.parse(browser.run(code));
    const t1 = performance.now();
    await save(true);
    // where the run's time went, for the page's status line (the Python side gave engine and encode; a snapshot built from an
    // older wheel gives none, and then there is no breakdown)
    const k = result.timing;
    if (k) result.timing = { ...k, parse: (t1 - t0) / 1000 - k.engine - k.encode, save: (performance.now() - t1) / 1000 };
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
