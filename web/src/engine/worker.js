// The engine's Web Worker: Pyodide + the dofile wheel, the user's files in /work.
// /work is a plain in-memory folder. The files live in dofile's own store in IndexedDB (store.js), which the page reads
// and writes directly: "mount" copies the store into /work, the page's changes arrive as ops that mirror them into /work,
// and after each run the worker writes what the run changed back to the store (docs/design/SPEC.md, section 7).
// Protocol: the page posts {id, op, args}; the worker answers {id, result} or {id, error, name}, one op at a time, posts
// {status} lines while it starts and {id, log} chunks while a run prints. client.js is the page's side. Python's side:
// src/dofile/browser.py.
import { loadPyodide } from "pyodide";
import { hasNativeBrotli, isStorageRefusal, openCache, restoreOptions, unpackAsync } from "./snapshot.js";
import { openStore } from "./store.js";

const ROOT = "/work", HIDDEN = ".dofile";
let py, browser, interrupt = null, fromSnapshot = false;
let queue = Promise.resolve();
let store = null, storeError = "";   // the file store, or why there is none
// The page's changes with a seq up to this are in /work already: the worker copied the store after they were made
// (at mount, or after a run), so their ops, still in the queue, are not applied again.
let upTo = 0;
// path -> { status, dir }: what a run did to /work that the store refused to take. The next run tries it again.
let unsaved = new Map();

/** @typedef {import("./types").ToWorker} ToWorker @typedef {import("./types").FromWorker} FromWorker
 *  @typedef {import("./types").StatusText} StatusText @typedef {import("./types").SnapshotManifest} SnapshotManifest */

/** @param {StatusText} text */
const status = text => self.postMessage({ status: text });
const within = (path, top) => path === top || path.startsWith(`${top}/`);   // `path` is `top` or under it

// An error for the page: { message, name }. Emscripten's file system errors carry only a number.
function describe(e) {
  if (e?.errno != null) {
    const code = Object.keys(py?.ERRNO_CODES ?? {}).find(k => py.ERRNO_CODES[k] === e.errno);
    return { message: `file system error ${code ?? e.errno}`, name: "ErrnoError" };
  }
  const message = e?.message ?? (typeof e === "object" ? JSON.stringify(e) : e);
  return { message: String(message), name: e?.name ?? "Error" };
}
const failedDownload = message => Object.assign(new Error(message), { name: "DownloadError" });
// the page's code and the snapshot (or its files) are of different builds: the site was updated since the page loaded
const updated = message => Object.assign(new Error(message), { name: "UpdatedError" });

// a path from the page, relative to /work; it may not leave it
function inRoot(path) {
  const full = py.PATH.normalize(`${ROOT}/${path}`);
  if (full !== ROOT && !full.startsWith(`${ROOT}/`)) throw new Error(`not in the working folder: ${path}`);
  return full;
}

// every file and folder under /work, except the engine's hidden folder
function walk(dir, out = []) {
  for (const name of py.FS.readdir(dir)) {
    if (name === "." || name === ".." || (dir === ROOT && name === HIDDEN)) continue;
    const full = `${dir}/${name}`, st = py.FS.stat(full), isDir = py.FS.isDir(st.mode);
    out.push({ path: full.slice(ROOT.length + 1), dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtime.getTime() });
    if (isDir) walk(full, out);
  }
  return out;
}

const exists = full => py.FS.analyzePath(full).exists;

function removeTree(full) {
  if (!py.FS.isDir(py.FS.stat(full).mode)) return py.FS.unlink(full);
  for (const name of py.FS.readdir(full)) if (name !== "." && name !== "..") removeTree(`${full}/${name}`);
  py.FS.rmdir(full);
}

// records of the store ({ infos, data }, as takeAll and applyRun give them) into /work
function putRecords({ infos, data }) {
  const mtimes = new Map(infos.map(i => [i.path, i.mtime]));
  for (const i of infos) if (i.dir) py.FS.mkdirTree(`${ROOT}/${i.path}`);
  for (const [path, bytes] of data) {
    const full = `${ROOT}/${path}`, mtime = mtimes.get(path) ?? Date.now();
    py.FS.mkdirTree(py.PATH.dirname(full));
    py.FS.writeFile(full, new Uint8Array(bytes), { canOwn: true });   // the bytes just read: no second copy
    py.FS.utime(full, mtime, mtime);
  }
}

// "mount": the store's files into /work. With no store (the browser refused, or there is no IndexedDB) /work starts
// empty, the start's summary says why (startup.storeError), and every run that writes a file says so too (store_error).
async function copyStore() {
  try {
    store = self.dofileStore ?? openStore();   // dofileStore: the Node tests give the page's store (test/node-worker.mjs)
    const all = await store.takeAll();
    upTo = all.upTo;
    putRecords(all);
  } catch (e) {
    store = null;
    storeError = `the files are not saved: ${describe(e).message}`;
    console.warn(`[dofile] ${storeError}`);
  }
}

// What store.applyRun gives back besides the run's files: the page's version of what the page changed and /work has not
// got yet (`resync`), and the seq those changes go up to. /work takes that version, and their ops are then skipped.
function takePageVersion({ upTo: seq, resync }) {
  upTo = Math.max(upTo, seq);
  for (const path of resync.paths) {
    if (exists(`${ROOT}/${path}`)) removeTree(`${ROOT}/${path}`);
    forget(path);   // /work has the store's version there now: a run's refused write to it is not owed any more
  }
  putRecords(resync);
  for (const path of resync.dirs) py.FS.mkdirTree(`${ROOT}/${path}`);
}

// a page change with this seq is in /work now: its `pending` row can go
async function applied(seq) {
  if (seq == null || !store) return;
  await store.done(seq).catch(e => console.warn(`[dofile] pending ${seq}: ${describe(e).message}`));
}

// A change the page made: `apply` puts it into /work, then its `pending` row goes. The page wrote the store first.
// An op the worker has covered already by a copy of the store (seq <= upTo) is not applied again. If it cannot be
// applied (a file where a folder should go, no memory for a big upload), /work takes the store's version of everything
// the page changed, the row goes all the same, and the op's error tells the page.
async function mirror(what, seq, apply) {
  if (seq != null && seq <= upTo) return;
  try {
    apply();
  } catch (e) {
    try {
      if (store) takePageVersion(await store.applyRun([]));
    } catch (again) {
      console.warn(`[dofile] ${what}: ${describe(again).message}`);
    }
    throw Object.assign(new Error(`${what}: ${describe(e).message}`), { name: "MirrorError" });
  } finally {
    await applied(seq);
  }
}

// After a run: what it did to /work, written to the store. `before`: walk() from before the run. Files the run created or
// changed (size or time) are written, files that were there before and are gone are deleted, and the rest is not read at
// all. The store leaves out what the page changed meanwhile, and /work then takes the page's version of that. Returns
// RunResult's `files` and `skipped`, and `store_error` if the store refused (the next run then tries again).
async function saveRun(before) {
  const was = new Map(before.map(f => [f.path, f])), now = new Set(), changes = [];
  for (const f of walk(ROOT)) {
    now.add(f.path);
    const old = was.get(f.path), failed = unsaved.get(f.path);
    const what = failed ? (failed.status === "created" ? "created" : "modified")
      : !old ? "created" : old.dir !== f.dir || (!f.dir && (old.size !== f.size || old.mtime !== f.mtime)) ? "modified" : null;
    if (what) changes.push({ ...f, status: what, data: f.dir ? undefined : py.FS.readFile(`${ROOT}/${f.path}`) });
  }
  for (const f of before) if (!now.has(f.path) && !unsaved.has(f.path)) changes.push({ ...f, status: "removed" });
  for (const [path, failed] of unsaved) {   // gone now; if the store never had it, there is nothing to delete
    if (!now.has(path) && failed.status !== "created") changes.push({ path, dir: failed.dir, size: 0, mtime: 0, status: "removed" });
  }
  if (!changes.length) return { files: [], skipped: [] };
  if (!store) return { files: [], skipped: [], store_error: storeError };
  let saved;
  try {
    saved = await store.applyRun(changes);
  } catch (e) {
    unsaved = new Map(changes.map(c => [c.path, { status: c.status, dir: c.dir }]));
    return { files: [], skipped: [], store_error: describe(e).message };
  }
  unsaved = new Map();
  try {
    takePageVersion(saved);
  } catch (e) {
    return { files: saved.files, skipped: saved.skipped, store_error: `the engine's folder could not take your changes: ${describe(e).message}` };
  }
  return { files: saved.files, skipped: saved.skipped };
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
// pyodide.asm.mjs comes from there too: Pyodide's own loader has no hook for linking libraries again.
// `cache`: the Cache the page's download() filled, read first, or undefined. The worker never writes it: download() is
// the one writer, and it keeps only a file with the byte count of the build's list (a host that answers a missing file
// with its index.html and status 200 must not end up in the cache).
async function fetchBytes(url, cache) {
  if (url.startsWith("file:")) {
    const fsName = "node:fs/promises";   // Node only (the tests); a variable so the bundler leaves it alone
    return new Uint8Array(await (await import(/* @vite-ignore */ fsName)).readFile(new URL(url)));
  }
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  // watchFetch's error names the URL already
  const res = await fetch(url).catch(e => { throw e?.name === "DownloadError" ? e : failedDownload(`${url}: ${e?.message ?? e}`); });
  if (!res.ok) throw failedDownload(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
const fetchJSON = async (url, cache) => JSON.parse(new TextDecoder().decode(await fetchBytes(url, cache)));

// The Cache holding this build's start files (snapshot.js, openCache): the page's download() fills it; this worker only
// reads it.
async function snapshotCache(built, refused) {
  if (typeof caches === "undefined") { refused(Object.assign(new Error("there is no Cache API here (not a secure context?)"), { name: "NoCacheAPI" })); return undefined; }
  try {
    return await openCache(caches, built);
  } catch (e) { refused(e); return undefined; }   // a refusal (private mode, blocked storage) is reported; anything else is thrown
}

// a .wasm is compiled from its answer as it arrives, which browsers do only for this type
function asWasm(res, url) {
  if (!url.split("?")[0].endsWith(".wasm") || res.headers.get("Content-Type") === "application/wasm") return res;
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/wasm" } });
}

// Pyodide's loader fetches its own files (pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json) and has no option to be
// given the .wasm's bytes. So while the engine starts, every GET in this worker goes through here:
//  - with a `cache`, it looks there first: the start then uses the bytes the page's counted download put there. A miss
//    goes to the network, and the answer is not stored (see fetchBytes);
//  - a fetch that fails rejects `failed`: Pyodide's loader only logs a failed .wasm and then waits for ever.
// Returns { failed, restore }: restore() puts the real fetch back.
function watchFetch({ cache } = {}) {
  const real = self.fetch;
  let fail;
  const failed = new Promise((_, err) => { fail = err; });
  failed.catch(() => {});
  self.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    if ((init?.method ?? input?.method ?? "GET") !== "GET") return real(input, init);
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) return asWasm(hit, url);
    let res;
    try {
      res = await real(input, init);
    } catch (e) {
      const error = failedDownload(`${url}: ${e?.message ?? e}`);
      fail(error);
      throw error;
    }
    if (!res.ok) fail(failedDownload(`${url}: ${res.status}`));
    return asWasm(res, url);
  };
  return { failed, restore: () => { self.fetch = real; } };
}

// The patched loader, as a module. In a browser it is imported from the cached bytes (a blob: URL), so the start does
// not fetch it a second time; if the browser will not import that, from its own URL.
async function importLoader(url, cache, isFile, version) {
  if (isFile) return (await import(/* @vite-ignore */ `${url}?v=${version}`)).default;
  const blob = URL.createObjectURL(new Blob([await fetchBytes(url, cache)], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ blob)).default;
  } catch (e) {
    console.warn(`[dofile] the loader could not be imported from the cache (${e?.message ?? e}); using ${url}`);
    return (await import(/* @vite-ignore */ `${url}?v=${version}`)).default;
  } finally {
    URL.revokeObjectURL(blob);
  }
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
  const notCached = [];   // why there is no Cache to read, if there is none (reported with the timings, and in the console)
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
  status("downloading the engine");   // or reading it from the cache, when the page's download() or an earlier visit filled it
  // the manifest is the one file that must be fresh: it says which build the cached files belong to
  /** @type {SnapshotManifest} */
  const manifest = await (isFile ? fetchJSON(`${base}manifest.json`)
    : fetch(`${base}manifest.json`, { cache: "no-cache" }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  ).catch(e => {
    throw failedDownload(`no snapshot at ${base}: run \`npm run snapshot\` in web/ (${e?.message ?? e})`);
  });
  if (manifest.wheel !== wheelName) {
    throw updated(`the snapshot is for ${manifest.wheel} but the page has ${wheelName}: run \`npm run snapshot\` again`);
  }
  if (!manifest.files) throw updated("the snapshot is in an older format: run `npm run snapshot` again");
  // The wheel's name stays the same while its code changes, so the name alone cannot tell a stale snapshot (it holds the old
  // dofile code). A page without a hash (the Node tests) skips this.
  if (wheelHash && manifest.wheelHash !== wheelHash) {
    throw updated(`the snapshot was built from a different build of ${wheelName} than this page has: run \`npm run snapshot\` again`);
  }
  const { snapshot: snapFile, bundle: bundleFile } = manifest.files;
  const cache = isFile ? undefined : await snapshotCache(manifest.built, refused);
  const hadCache = Boolean(cache) && Boolean(await cache.match(`${base}${snapFile.name}`));
  // from here to the end of the start, fetches read the cache first
  const fetches = isFile ? { failed: new Promise(() => {}), restore() {} } : watchFetch({ cache });
  try {
    // The two big files are kept in the cache as they were sent, compressed (about 42 MB, not 229), and decompressed here.
    const [snapPacked, dso, index, bundlePacked, create, brotli] = await Promise.all([
      fetchBytes(`${base}${snapFile.name}`, cache), fetchJSON(`${base}dso.json`, cache), fetchJSON(`${base}files.json`, cache),
      fetchBytes(`${base}${bundleFile.name}`, cache), importLoader(`${base}pyodide.asm.patched.mjs`, cache, isFile, manifest.built),
      loadBrotli(),
    ]);
    lap(hadCache ? "read from cache" : "download");
    status("unpacking the engine");
    // The browser's own brotli decoder when it has one (brotli-wasm took 25 s for the 229 MB on an iPhone); `?brotli=wasm` in
    // the page's URL forces brotli-wasm, to compare. In Node (the tests) the wasm decoder stays, so they run what the build checks.
    const native = !isFile && brotliMode !== "wasm" && hasNativeBrotli();
    const timed = async (file, packed) => {
      const t = performance.now();
      try {
        const [out, decoder] = await unpackAsync(brotli, packed, file, native);
        return [out, since(t), decoder];
      } catch (e) {
        await cache?.delete(`${base}${file.name}`).catch(() => {});   // a damaged or wrong file: the next start fetches it again
        throw e;
      }
    };
    const [snapshot, heapS, decoder] = await timed(snapFile, snapPacked);
    const [blob, sitePackagesS] = await timed(bundleFile, bundlePacked);
    lap("decompress");
    console.info(`[dofile] unpack with ${decoder}: heap ${heapS.toFixed(2)}s (${(snapFile.raw / 1e6 / heapS).toFixed(0)} MB/s out), ` +
      `site-packages ${sitePackagesS.toFixed(2)}s (${(bundleFile.raw / 1e6 / sitePackagesS).toFixed(0)} MB/s out), ` +
      `native brotli available ${hasNativeBrotli()}, hardwareConcurrency ${navigator.hardwareConcurrency}, deviceMemory ${navigator.deviceMemory ?? "n/a"}`);
    status("loading Python");
    const options = restoreOptions(create, { snapshot, dso, index, blob }, lap);
    const loaded = await Promise.race([loadPyodide({ indexURL, ...options, ...io }), fetches.failed]);
    lap("copy the heap");
    console.info(`[dofile] snapshot start: ${laps.join(", ")}, total ${((performance.now() - t0) / 1000).toFixed(2)}s` +
      (notCached.length ? `, NOT CACHED: ${[...new Set(notCached)].join("; ")}` : ""));
    // For the page's status line: the first lap is the download (or the read from the cache), "decompress" is the unpack,
    // every lap after it (the wasm module, site-packages, re-linking the libraries, the heap) is the restore.
    const [[fetched, fetchS], [, unpackS], ...rest] = secs;
    const summary = { fetched, fetchS, unpackS, heapS, sitePackagesS, decoder, restoreS: rest.reduce((a, [, s]) => a + s, 0),
      notCached: [...new Set(notCached)] };
    return { loaded, summary };
  } finally {
    fetches.restore();
  }
}

// Where the start's time went, in seconds, for the page's status line (the "startup" op). From a snapshot: fetched (the
// name of the first step: download, or read from cache), fetchS, unpackS, restoreS, filesS, engineS, notCached. A normal
// boot: runtimeS (Pyodide itself), filesS, packagesS (micropip and the wheel with numpy, scipy, matplotlib), engineS.
// storeError, when the files could not be copied from the store: the engine runs, and nothing it writes is kept.
const startup = {};
const since = t => (performance.now() - t) / 1000;

// what a run's failed write to the store still owes, kept right when the page moves or replaces the file
function forget(path) {
  for (const p of [...unsaved.keys()]) if (within(p, path)) unsaved.delete(p);
}

const ops = {
  async mount({ indexURL, snapshot, wheelName, wheelHash, brotli: brotliMode }) {
    if (!snapshot) status("loading Python");   // a snapshot start names its own steps (loadFromSnapshot)
    const io = { stdout: l => console.log(l), stderr: l => console.warn(l) };
    fromSnapshot = Boolean(snapshot);
    const tRuntime = performance.now();
    if (snapshot) {
      const { loaded, summary } = await loadFromSnapshot(snapshot, indexURL, wheelName, wheelHash, io, brotliMode);
      py = loaded;
      Object.assign(startup, { mode: "snapshot", ...summary });
    } else {
      const fetches = watchFetch();   // a failed fetch ends the start with its error
      try {
        py = await Promise.race([loadPyodide({ indexURL, ...io }), fetches.failed]);
      } finally {
        fetches.restore();
      }
      Object.assign(startup, { mode: "normal", runtimeS: since(tRuntime) });
    }
    py.FS.mkdirTree(ROOT);
    const tFiles = performance.now();
    status("loading your files");
    await copyStore();
    startup.filesS = since(tFiles);
    if (storeError) startup.storeError = storeError;
  },
  startup: () => startup,
  // wheel: the dofile wheel's URL, or {name, bytes}; extraWheels: more of the same, installed with it; interruptBuffer: an
  // Int32Array on a SharedArrayBuffer, or null
  async boot({ wheel, extraWheels = [], interruptBuffer }) {
    const tPackages = performance.now();
    if (!fromSnapshot) {   // a snapshot has the packages and the wheel in it already
      status("loading packages");
      // no pandas: pyreadstat reads SAS transport and SPSS without it; only export sasxport needs it (about 5 MB more
      // to download and 2 s on a cold start, docs/pyodide-snapshot.md, "Packages added"), so that command is not available here
      await py.loadPackage("micropip", { messageCallback: () => {} });
      const names = await Promise.all([wheel, ...extraWheels].map(async w => {
        const name = typeof w === "string" ? w.split("/").at(-1) : w.name;
        const bytes = typeof w === "string" ? await fetchBytes(w) : w.bytes;
        py.FS.writeFile(`/tmp/${name}`, bytes);
        return `emfs:/tmp/${name}`;
      }));
      py.globals.set("wheel_urls", py.toPy(names));
      await py.runPythonAsync(`import micropip; await micropip.install(list(wheel_urls))`);
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
  // While the run prints, {id, log} chunks go to the page (browser.py calls on_output with the log as it grows).
  async run({ code, fresh_locals, plot_theme }, id) {
    await booted;
    if (interrupt) interrupt[0] = 0;   // a Break pressed while idle must not stop this run
    const before = walk(ROOT);
    // A file's time has 1 ms steps. Wait until the clock is past the newest file, so that anything the run writes gets a
    // later time: a rewrite with the same size is then still seen as a change. A time after now (a file from a clock that
    // was ahead) is left out: any rewrite changes it anyway.
    const now = Date.now(), newest = before.reduce((m, f) => (f.mtime <= now ? Math.max(m, f.mtime) : m), 0);
    while (Date.now() <= newest) { /* one clock step (up to 100 ms with a clamped clock) */ }
    const t0 = performance.now();
    // Positional: a plain Pyodide call passes no keyword arguments; undefined (not null) is Python's None.
    const result = JSON.parse(browser.run(code, true, fresh_locals === true, plot_theme ?? undefined, text => self.postMessage({ id, log: text })));
    const t1 = performance.now();
    Object.assign(result, await saveRun(before));
    // where the run's time went, for the page's status line (the Python side gave engine and encode); save: writing the
    // run's files to the store
    const k = result.timing;
    if (k) result.timing = { ...k, parse: (t1 - t0) / 1000 - k.engine - k.encode, save: (performance.now() - t1) / 1000 };
    return result;
  },
  // undefined becomes Python's None (null would become JsNull)
  describe: async ({ vars, offset = 0, limit }) => (await booted, JSON.parse(browser.describe(vars, offset, limit))),
  matrix: async ({ name }) => (await booted, JSON.parse(browser.matrix(name))),
  // a .dta in /work, without loading it; `path` as the page names it, inside the working folder
  async describe_file({ path }) {
    await booted;
    inRoot(path);
    return JSON.parse(browser.describe_file(path));
  },
  macros: async () => (await booted, JSON.parse(browser.macros())),
  // the first rows of the data: 50 from the top unless the page says otherwise
  browse: async ({ vars, offset, limit }) => (await booted, JSON.parse(browser.browse(vars ?? undefined, offset ?? 0, limit ?? 50))),
  // data_bytes from the engine; heap_bytes is the size of this worker's WebAssembly memory
  memory: async () => (await booted, { ...JSON.parse(browser.memory()), heap_bytes: py._module.HEAPU8.length }),
  // `files` and `read` are views of /work, for the tests: the page lists and reads the store
  files: () => walk(ROOT),
  read: ({ path }) => py.FS.readFile(inRoot(path)),
  // The page's changes (see mirror). Each is safe to apply twice.
  write: ({ path, data, seq }) => mirror(`write ${path}`, seq, () => {
    const full = inRoot(path);
    py.FS.mkdirTree(py.PATH.dirname(full));
    py.FS.writeFile(full, data, { canOwn: true });   // the bytes were moved here: no copy
    forget(path);
  }),
  mkdir: ({ path, seq }) => mirror(`mkdir ${path}`, seq, () => { py.FS.mkdirTree(inRoot(path)); }),
  remove: ({ path, seq }) => mirror(`remove ${path}`, seq, () => {
    const full = inRoot(path);
    if (full === ROOT) throw new Error("cannot remove the working folder");
    if (exists(full)) removeTree(full);
    forget(path);
  }),
  rename: ({ from, to, seq }) => mirror(`rename ${from}`, seq, () => {
    const src = inRoot(from), dest = inRoot(to);
    if (!exists(src)) return;   // applied already
    if (exists(dest)) removeTree(dest);
    py.FS.mkdirTree(py.PATH.dirname(dest));
    py.FS.rename(src, dest);
    forget(to);
    for (const [p, failed] of [...unsaved]) {   // what the store still owes for the old name, it owes for the new one
      if (within(p, from)) { unsaved.delete(p); unsaved.set(to + p.slice(from.length), failed); }
    }
  }),
};

const answer = async (id, op, args) => {
  try {
    if (!ops[op]) throw new Error(`unknown op ${op}`);
    const result = await ops[op](args ?? {}, id);
    self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);   // a file: moved, not copied
  } catch (e) {
    const { message, name } = describe(e);
    self.postMessage({ id, error: message, name });
  }
};

/** @param {MessageEvent<ToWorker>} message (answers: FromWorker) */
self.onmessage = ({ data: { id, op, args } }) => {
  if (op === "boot") {   // outside the queue, so file ops are answered while the engine loads
    ops.boot(args ?? {}).then(about => { bootDone.ok(); self.postMessage({ id, result: about }); },
      e => { bootDone.err(e); const { message, name } = describe(e); self.postMessage({ id, error: message, name }); });
    return;
  }
  queue = queue.then(() => answer(id, op, args));
};
