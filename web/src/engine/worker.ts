// The engine's Web Worker: Pyodide + the dofile wheel, the user's files in /work.
// /work is a plain in-memory folder. The files live in dofile's own store in IndexedDB (store.ts), which the page reads
// and writes directly: "mount" copies the store into /work; a page change is journalled in the store and the op "sync"
// (with nothing in it) makes the worker take the store's version of what the journal names; after each run the worker
// writes what the run changed back to the store, and takes the journal in the same transaction (docs/design/SPEC.md,
// section 7).
// Protocol (types.ts: Ops, ToWorker, FromWorker): the page posts {id, op, args}; the worker answers {id, result} or
// {id, error, name}, one op at a time, posts {stage} (a typed id, never text for the page to match) as each start-up
// stage begins and {id, log} chunks while a run prints. client.ts is the page's side. Python's side: src/dofile/browser.py.
// The handlers are three objects, one per set of ops (LifecycleOps, ReadOps, JournalOps): a new op must choose its set,
// here and in types.ts.

import type { BrotliWasmType } from "brotli-wasm";
import { loadPyodide } from "pyodide";
import { MIB } from "./memcap.ts";
import type { CreateModule, SnapshotPy } from "./snapshot.ts";
import {
  hasNativeBrotli,
  inflateNative,
  isStorageRefusal,
  openCache,
  PART_HEADER,
  patchHeapMax,
  restoreOptions,
  unpackAsync,
  unpackSteps,
  withHeapCap,
  writeGraphics,
} from "./snapshot.ts";
import type { AppliedRun, FileStore, RunChange } from "./store.ts";
import { openStore } from "./store.ts";
import type {
  BootArgs,
  DescribeArgs,
  FileChange,
  FileInfo,
  JournalOps,
  LifecycleOps,
  MountArgs,
  ReadOps,
  RunOptions,
  SnapshotFile,
  SnapshotFiles,
  Stage,
  Startup,
  ToWorker,
} from "./types.ts";

/** What the worker uses of the file store: the page's FileStore, or in the Node tests a stand-in for it (test/node-worker.ts). */
type WorkerStore = Pick<FileStore, "takeAll" | "applyRun">;
declare global {
  var dofileStore: WorkerStore | undefined; // the Node tests give the page's store (test/node-worker.ts)
}
/** dofile.browser (src/dofile/browser.py) through Pyodide: JSON text in and out. */
interface Browser {
  start(root: string): string;
  lazy_graphics(wait: (ms: number) => string): void; // a lazy snapshot (waitGraphics)
  graphics_written(): void;
  warm_graphics(start: number, count: number): number;
  run(
    code: string,
    images: boolean,
    freshLocals: boolean,
    plotTheme: string | undefined,
    onOutput: (text: string) => void,
  ): string;
  describe(vars: string | undefined, offset: number, limit: number | undefined): string;
  describe_file(path: string): string;
  matrix(name: string): string;
  macros(): string;
  browse(vars: string | undefined, offset: number, limit: number): string;
  memory(): string;
}
type Io = { stdout: (line: string) => void; stderr: (line: string) => void };
// This worker's global scope. The page's types are the DOM's, where `self` is a Window, which has no postMessage(message, transfer).
declare const self: Window & typeof globalThis & { postMessage(message: unknown, transfer: Transferable[]): void };

const ROOT = "/work",
  HIDDEN = ".dofile";
let py: SnapshotPy,
  browser: Browser,
  interrupt: Int32Array | null = null,
  fromSnapshot = false,
  brotliPick: string | undefined; // mount's `brotli`: "wasm" forces brotli-wasm
let queue = Promise.resolve();
let store: WorkerStore | null = null,
  storeError = ""; // the file store, or why there is none
// path -> { status, dir }: what a run did to /work that the store refused to take. The next run tries it again.
let unsaved = new Map<string, { status: FileChange["status"]; dir: boolean }>();

/** Tell the page a start-up stage began. */
const stage = (id: Stage) => self.postMessage({ stage: id });
const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`); // `path` is `top` or under it

// An error for the page: { message, name }. Emscripten's file system errors carry only a number.
function errorForPage(e: any): { message: string; name: string } {
  if (e?.errno != null) {
    const code = Object.keys(py?.ERRNO_CODES ?? {}).find((k) => py.ERRNO_CODES[k] === e.errno);
    return { message: `file system error ${code ?? e.errno}`, name: "ErrnoError" };
  }
  const message = e?.message ?? (typeof e === "object" ? JSON.stringify(e) : e);
  return { message: String(message), name: e?.name ?? "Error" };
}
const failedDownload = (message: string) => Object.assign(new Error(message), { name: "DownloadError" });

// a path from the page, relative to /work; it may not leave it
function inRoot(path: string): string {
  const full = py.PATH.normalize(`${ROOT}/${path}`);
  if (full !== ROOT && !full.startsWith(`${ROOT}/`)) throw new Error(`not in the working folder: ${path}`);
  return full;
}

// every file and folder under /work, except the engine's hidden folder
function walk(dir: string, out: FileInfo[] = []): FileInfo[] {
  for (const name of py.FS.readdir(dir)) {
    if (name === "." || name === ".." || (dir === ROOT && name === HIDDEN)) continue;
    const full = `${dir}/${name}`,
      st = py.FS.stat(full),
      isDir = py.FS.isDir(st.mode);
    out.push({ path: full.slice(ROOT.length + 1), dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtime.getTime() });
    if (isDir) walk(full, out);
  }
  return out;
}

const exists = (full: string) => py.FS.analyzePath(full).exists;

function removeTree(full: string): void {
  if (!py.FS.isDir(py.FS.stat(full).mode)) {
    py.FS.unlink(full);
    return;
  }
  for (const name of py.FS.readdir(full)) if (name !== "." && name !== "..") removeTree(`${full}/${name}`);
  py.FS.rmdir(full);
}

// records of the store ({ infos, data }, as takeAll and applyRun give them) into /work
function putRecords({ infos, data }: { infos: FileInfo[]; data: [IDBValidKey, ArrayBuffer][] }) {
  const mtimes = new Map(infos.map((i) => [i.path, i.mtime]));
  for (const i of infos) if (i.dir) py.FS.mkdirTree(`${ROOT}/${i.path}`);
  for (const [path, bytes] of data) {
    const full = `${ROOT}/${path}`,
      mtime = mtimes.get(path as string) ?? Date.now();
    py.FS.mkdirTree(py.PATH.dirname(full));
    py.FS.writeFile(full, new Uint8Array(bytes), { canOwn: true }); // the bytes just read: no second copy
    py.FS.utime(full, mtime, mtime);
  }
}

// "mount": the store's files into /work. With no store (the browser refused, or there is no IndexedDB) /work starts
// empty, the start's summary says why (startup.storeError), and every run that writes a file says so too (store_error).
async function copyStore() {
  try {
    store = self.dofileStore ?? openStore(); // dofileStore: the Node tests give the page's store (test/node-worker.ts)
    putRecords(await store.takeAll());
  } catch (e) {
    store = null;
    storeError = `the files are not saved: ${errorForPage(e).message}`;
    console.warn(`[dofile] ${storeError}`);
  }
}

// What store.applyRun gives back besides the run's files (`resync`): the page's version of the paths the journal named,
// which /work now takes. This is the one way a page change reaches /work.
function takePageVersion({ resync }: AppliedRun) {
  for (const path of resync.paths) {
    if (exists(`${ROOT}/${path}`)) removeTree(`${ROOT}/${path}`);
    forget(path); // /work has the store's version there now: a run's refused write to it is not owed any more
  }
  // Where the store has a folder (above each record it gives, and at each folder the page made), /work may have a file:
  // a run's that the store refused. mkdirTree would pass over it (it ignores EEXIST) and the write under it would fail.
  for (const i of resync.infos) foldersAt(i.path, i.dir);
  for (const path of resync.dirs) foldersAt(path, true);
  putRecords(resync);
  for (const path of resync.dirs) py.FS.mkdirTree(`${ROOT}/${path}`);
}

// The folders above `path` (and `path` itself, with `self`) are folders in the store: a file /work has at one of them goes,
// and is not owed any more. The page's version wins, as everywhere else.
function foldersAt(path: string, self: boolean) {
  const parts = path.split("/");
  for (let n = 1; n <= parts.length - (self ? 0 : 1); n++) {
    const p = parts.slice(0, n).join("/"),
      full = `${ROOT}/${p}`;
    if (exists(full) && !py.FS.isDir(py.FS.stat(full).mode)) {
      py.FS.unlink(full);
      forget(p);
    }
  }
}

// After a run: what it did to /work, written to the store. `before`: walk() from before the run. Files the run created or
// changed (another modification time or size) are written, files that were there before and are gone are deleted, and
// the rest is not read at all. The store leaves out what the page changed meanwhile, and /work then takes the page's
// version of that. Returns RunResult's `files` and `skipped`, and `store_error` if the store refused (the next run then
// tries again).
// Why the two: the wait in `run` makes the time enough for any write of one byte or more (it gets a time later than any
// time in `before`, or, for a time in the future, another one). A truncation is not stamped by MEMFS (its setattr takes
// no time with a size, and a write of 0 bytes sets none), so a run that empties a file changes only its size.
async function saveRun(before: FileInfo[]): Promise<{ files: FileChange[]; skipped: string[]; store_error?: string }> {
  const was = new Map(before.map((f) => [f.path, f])),
    now = new Set<string>(),
    changes: RunChange[] = [];
  for (const f of walk(ROOT)) {
    now.add(f.path);
    const old = was.get(f.path),
      failed = unsaved.get(f.path);
    const what = failed
      ? failed.status === "created"
        ? "created"
        : "modified"
      : !old
        ? "created"
        : old.dir !== f.dir || (!f.dir && (old.size !== f.size || old.mtime !== f.mtime))
          ? "modified"
          : null;
    if (what) changes.push({ ...f, status: what, data: f.dir ? undefined : py.FS.readFile(`${ROOT}/${f.path}`) });
  }
  for (const f of before) if (!now.has(f.path) && !unsaved.has(f.path)) changes.push({ ...f, status: "removed" });
  for (const [path, failed] of unsaved) {
    // gone now; if the store never had it, there is nothing to delete
    if (!now.has(path) && failed.status !== "created")
      changes.push({ path, dir: failed.dir, size: 0, mtime: 0, status: "removed" });
  }
  if (!changes.length) return { files: [], skipped: [] };
  if (!store) return { files: [], skipped: [], store_error: storeError };
  let saved: AppliedRun;
  try {
    saved = await store.applyRun(changes);
  } catch (e) {
    unsaved = new Map(changes.map((c) => [c.path, { status: c.status, dir: c.dir }]));
    return { files: [], skipped: [], store_error: errorForPage(e).message };
  }
  unsaved = new Map();
  try {
    takePageVersion(saved);
  } catch (e) {
    return {
      files: saved.files,
      skipped: saved.skipped,
      store_error: `the engine's folder could not take your changes: ${errorForPage(e).message}`,
    };
  }
  return { files: saved.files, skipped: saved.skipped };
}

// Starting is two steps so the page can show the user's files early:
//   mount: Pyodide itself and the files in /work. It is an ordinary queued op, so every `sync` posted after it waits
//          for it (and then finds the journal that mount's copy emptied, or the rows written since).
//   boot:  the packages, the dofile wheel and the engine. It runs outside the queue, so `sync`, `files` and `read` are
//          answered while it loads; the ops that need the engine (run, describe, matrix) wait for it.
let bootDone: { ok: () => void; err: (e: unknown) => void };
const booted = new Promise<void>((ok, err) => {
  bootDone = { ok, err };
});
booted.catch(() => {}); // the error reaches the page through boot's own answer

// The files of a snapshot (scripts/make-snapshot.mjs) at `base`, an http(s) or file: URL ending in "/". The patched
// pyodide.asm.mjs comes from there too: Pyodide's own loader has no hook for linking libraries again.
// `cache`: the Cache the page's download() filled, read first, or undefined. The worker never writes it: download() is
// the one writer, and it keeps only a file with the byte count of the build's list (a host that answers a missing file
// with its index.html and status 200 must not end up in the cache).
async function fetchBytes(url: string, cache?: Cache, init?: RequestInit): Promise<Uint8Array<ArrayBuffer>> {
  if (url.startsWith("file:")) {
    const fsName = "node:fs/promises"; // Node only (the tests); a variable so the bundler leaves it alone
    return new Uint8Array(await (await import(/* @vite-ignore */ fsName)).readFile(new URL(url)));
  }
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  // watchFetch's error names the URL already
  const res = await fetch(url, init).catch((e) => {
    throw e?.name === "DownloadError" ? e : failedDownload(`${url}: ${e?.message ?? e}`);
  });
  if (!res.ok) throw failedDownload(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
const fetchJSON = async (url: string, cache?: Cache) =>
  JSON.parse(new TextDecoder().decode(await fetchBytes(url, cache)));

// The Cache holding this build's start files (snapshot.ts, openCache): the page's download() fills it; this worker only
// reads it.
async function snapshotCache(built: number, refused: (e: any) => void): Promise<Cache | undefined> {
  if (typeof caches === "undefined") {
    refused(Object.assign(new Error("there is no Cache API here (not a secure context?)"), { name: "NoCacheAPI" }));
    return undefined;
  }
  try {
    return await openCache(caches, built);
  } catch (e) {
    refused(e);
    return undefined;
  } // a refusal (private mode, blocked storage) is reported; anything else is thrown
}

// a .wasm is compiled from its answer as it arrives, which browsers do only for this type
function asWasm(res: Response, url: string): Response {
  if (!url.split("?")[0].endsWith(".wasm") || res.headers.get("Content-Type") === "application/wasm") return res;
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/wasm" } });
}

// Pyodide's loader fetches its own files (pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json) and has no option to be
// given the .wasm's bytes. So while the engine starts, every GET in this worker goes through here:
//  - with a `cache`, it looks there first: the start then uses the bytes the page's counted download put there. A miss
//    goes to the network, and the answer is not stored (see fetchBytes);
//  - a fetch that fails rejects `failed`: Pyodide's loader only logs a failed .wasm and then waits for ever.
// Returns { failed, restore }: restore() puts the real fetch back.
function watchFetch({ cache }: { cache?: Cache } = {}): { failed: Promise<never>; restore: () => void } {
  const real = self.fetch;
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_, err) => {
    fail = err;
  });
  failed.catch(() => {});
  self.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input?.url ?? input);
    if ((init?.method ?? input?.method ?? "GET") !== "GET") return real(input, init);
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) return asWasm(hit, url);
    let res: Response;
    try {
      res = await real(input, init);
    } catch (e: any) {
      const error = failedDownload(`${url}: ${e?.message ?? e}`);
      fail(error);
      throw error;
    }
    if (!res.ok) fail(failedDownload(`${url}: ${res.status}`));
    return asWasm(res, url);
  };
  return {
    failed,
    restore: () => {
      self.fetch = real;
    },
  };
}

// The patched loader, as a module. In a browser it is imported from the cached bytes (a blob: URL), so the start does
// not fetch it a second time; if the browser will not import that, from its own URL.
async function importLoader(
  url: string,
  cache: Cache | undefined,
  isFile: boolean,
  version: number,
): Promise<CreateModule> {
  if (isFile) return (await import(/* @vite-ignore */ `${url}?v=${version}`)).default;
  const blob = URL.createObjectURL(new Blob([await fetchBytes(url, cache)], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ blob)).default;
  } catch (e: any) {
    console.warn(`[dofile] the loader could not be imported from the cache (${e?.message ?? e}); using ${url}`);
    return (await import(/* @vite-ignore */ `${url}?v=${version}`)).default;
  } finally {
    URL.revokeObjectURL(blob);
  }
}

// The normal boot's loader (?snapshot=0) with the heap cap (snapshot.ts, HEAP_MAX): Pyodide's own pyodide.asm.mjs from the runtime's
// URL, with that one change, as a module. Only used when there is a cap; with none, Pyodide imports its own loader.
async function importCapped(indexURL: string | undefined, bytes: number): Promise<CreateModule> {
  if (!indexURL) throw new Error("a memory cap on the normal boot needs the URL of Pyodide's runtime (indexURL)");
  const url = `${indexURL.endsWith("/") ? indexURL : `${indexURL}/`}pyodide.asm.mjs`;
  const src = patchHeapMax(new TextDecoder().decode(await fetchBytes(url)));
  const blob = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  try {
    return withHeapCap((await import(/* @vite-ignore */ blob)).default, bytes);
  } finally {
    URL.revokeObjectURL(blob);
  }
}

// The brotli-wasm decoder. In a browser it loads its wasm from the page's own files; in Node (the tests) the package's
// own entry is the one that works (the browser entry fetches its wasm by URL, which Node's fetch cannot do for files).
async function loadBrotli(): Promise<BrotliWasmType> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const mod = "node:module"; // a variable so the bundler leaves it alone
    return (await import(/* @vite-ignore */ mod)).createRequire(import.meta.url)("brotli-wasm");
  }
  return (await import("brotli-wasm")).default;
}

// `built` and `files` come from the build's list (start-files.json), which the page read and checked against its own build
// before it made this worker: no manifest is fetched here.
async function loadFromSnapshot(
  base: string,
  built: number,
  files: SnapshotFiles,
  indexURL: string | undefined,
  io: Io,
  brotliMode: string | undefined,
  capBytes: number,
) {
  const t0 = performance.now();
  let last = t0;
  const laps: string[] = [],
    secs: [string, number][] = []; // laps: text for the console; secs: [name, seconds] for the page's summary
  const notCached: string[] = []; // why there is no Cache to read, if there is none (reported with the timings, and in the console)
  const isFile = base.startsWith("file:"); // Node, the tests: no Cache API by design
  const refused = (e: any, url?: string) => {
    if (!isStorageRefusal(e)) throw e; // not the browser saying no: a bug, shown as the start's error
    const why = `${e.name}: ${e.message}${url ? ` (${url.split("/").pop()})` : ""}`;
    if (!isFile) {
      notCached.push(why);
      console.warn(`[dofile] snapshot not cached: ${why}`);
    }
  };
  const lap = (what: string) => {
    const t = performance.now(),
      s = (t - last) / 1000;
    laps.push(`${what} ${s.toFixed(2)}s`);
    secs.push([what, s]);
    last = t;
  };
  stage("download"); // or reading it from the cache, when the page's download() or an earlier visit filled it
  const { snapshot: snapFile, bundle: bundleFile } = files;
  const cache = isFile ? undefined : await snapshotCache(built, refused);
  const hadCache = Boolean(cache) && Boolean(await cache!.match(`${base}${snapFile.name}`));
  // from here to the end of the start, fetches read the cache first
  const fetches = isFile ? { failed: new Promise(() => {}), restore() {} } : watchFetch({ cache });
  try {
    // The two big files are kept in the cache as they were sent, compressed (about 42 MB, not 229), and decompressed here.
    const [snapPacked, dso, index, bundlePacked, create, brotli] = await Promise.all([
      fetchBytes(`${base}${snapFile.name}`, cache),
      fetchJSON(`${base}dso.json`, cache),
      fetchJSON(`${base}files.json`, cache),
      fetchBytes(`${base}${bundleFile.name}`, cache),
      importLoader(`${base}pyodide.asm.patched.mjs`, cache, isFile, built),
      loadBrotli(),
    ]);
    brotliWasm = brotli; // for the graphics part, which a waiting graph unpacks synchronously (waitGraphics)
    lap(hadCache ? "read from cache" : "download");
    stage("unpack");
    // The browser's own brotli decoder when it has one (brotli-wasm took 25 s for the 229 MB on an iPhone); `?brotli=wasm` in
    // the page's URL forces brotli-wasm, to compare. In Node (the tests) the wasm decoder stays, so they run what the build checks.
    const native = !isFile && brotliMode !== "wasm" && hasNativeBrotli();
    const timed = async (
      file: SnapshotFile,
      packed: Uint8Array<ArrayBuffer>,
    ): Promise<[Uint8Array, number, "native" | "wasm" | "none"]> => {
      const t = performance.now();
      try {
        const [out, decoder] = await unpackAsync(brotli, packed, file, native);
        return [out, since(t), decoder];
      } catch (e) {
        await cache?.delete(`${base}${file.name}`).catch(() => {}); // a damaged or wrong file: the next start fetches it again
        throw e;
      }
    };
    const [snapshot, heapS, decoder] = await timed(snapFile, snapPacked);
    const [blob, sitePackagesS] = await timed(bundleFile, bundlePacked);
    lap("decompress");
    console.info(
      `[dofile] unpack with ${decoder}: heap ${heapS.toFixed(2)}s (${(snapFile.raw / 1e6 / heapS).toFixed(0)} MB/s out), ` +
        `site-packages ${sitePackagesS.toFixed(2)}s (${(bundleFile.raw / 1e6 / sitePackagesS).toFixed(0)} MB/s out), ` +
        `native brotli available ${hasNativeBrotli()}, hardwareConcurrency ${navigator.hardwareConcurrency}, deviceMemory ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? "n/a"}`,
    );
    stage("python");
    const options = restoreOptions(
      capBytes ? withHeapCap(create, capBytes) : create,
      { snapshot, dso, index, blob },
      lap,
    );
    const loaded = (await Promise.race([loadPyodide({ indexURL, ...options, ...io }), fetches.failed])) as SnapshotPy;
    lap("copy the heap");
    console.info(
      `[dofile] snapshot start: ${laps.join(", ")}, total ${((performance.now() - t0) / 1000).toFixed(2)}s` +
        (notCached.length ? `, NOT CACHED: ${[...new Set(notCached)].join("; ")}` : ""),
    );
    // For the page's status line: the first lap is the download (or the read from the cache), "decompress" is the unpack,
    // every lap after it (the wasm module, site-packages, re-linking the libraries, the heap) is the restore.
    const [[fetched, fetchS], [, unpackS], ...rest] = secs;
    const summary = {
      fetched,
      fetchS,
      unpackS,
      heapS,
      sitePackagesS,
      decoder,
      restoreS: rest.reduce((a, [, s]) => a + s, 0),
      notCached: [...new Set(notCached)],
    };
    return { loaded, summary };
  } finally {
    fetches.restore();
  }
}

// ---- a lazy snapshot's graphics part (experiment E1c, docs/lazy-matplotlib.md) --------------------------------------------
// matplotlib and what only it needs are not in the heap or the bundle but in one more file (files.graphics). With a
// SharedArrayBuffer the PAGE fetches it (client.ts, #graphics), never this worker: a worker busy in Python cannot advance a
// fetch of its own. The page hands it over in the SharedArrayBuffer given with boot: Int32 [state, length, tries, 0] (state
// 0 pending, 1 landed, 2 failed; tries: the page's fetches of it, counted; a graph that finds it failed asks for one more,
// {graphics: "again"}, and waits), then from byte PART_HEADER the compressed part (landed) or the reason (failed). Without
// one (no cross-origin isolation) THIS WORKER fetches it, and the page never does: a graph blocked in Python could not be
// handed the page's bytes, so it would fetch them again (prefetch, fetchPartNow). The page then shows the download from this
// worker's messages ({graphics: "fetching" | "progress" | "landed" | "failed"}, client.ts): inputs, as "again" and "damaged"
// are; the page alone writes the progress it shows.
// Only a graph waits for it (browser.py: the graph store's put and a finder for matplotlib call waitGraphics); no other run
// touches it. A return visit must not be slower: nothing of it happens before `startup` is answered. Then the browser's
// own decoder (off this thread) unpacks it as soon as it is here (nativeSoon); what runs on this thread waits until the
// engine is idle (no run sent or running) and has been for IDLE_MS: a brotli-wasm unpack, the write and the import of what
// a first graph needs (so it costs what it did with matplotlib in the heap), in steps of one task each (idleStep), so a run
// sent meanwhile waits for one step at most.
const PART_PENDING = 0,
  PART_LANDED = 1,
  PART_FAILED = 2,
  IDLE_MS = 1000,
  PROGRESS_MS = 100, // at most one {graphics: "progress"} this often
  DECODE_STEP = 256 << 10; // input bytes per decode step: ~1.1 MB out, ~0.12 s at the 9 MB/s brotli-wasm did on an iPhone
let share: {
    file: SnapshotFile;
    hdr: Int32Array | null;
    sab: SharedArrayBuffer | null;
    bytes?: Uint8Array;
    error?: string;
  } | null = null,
  brotliWasm: BrotliWasmType | null = null,
  snapshotBase = "", // mount's `snapshot`: where the part is, for fetchPartNow
  started = false, // `startup` was answered
  runs = 0, // runs sent and not ended (counted as they arrive, before the queue)
  idleSince = 0,
  idleTimer: ReturnType<typeof setTimeout> | 0 = 0,
  decode: { steps: Generator<number, Uint8Array, void>; t0: number; how: string; longest: number } | null = null,
  native = false, // the browser's decoder is unpacking it (idle only)
  decoded: { raw: Uint8Array; t0: number; how: string; longest: number } | null = null, // unpacked, not yet written
  graphicsWritten = false,
  askedAt: number | null = null, // this run asked the page to fetch a failed part again, at that tries
  graphicsError = "", // the part arrived but could not be unpacked or written (damaged): final for this worker
  warmAt = 0, // the next step of browser.warm_graphics; -1: done
  tWarm = 0,
  warmLongest = 0,
  prefetching: { stop: AbortController; done: Promise<void> } | null = null, // this worker's own fetch (no shared buffer)
  fetchSaid = false, // waitGraphics said "pending" for this graph's own fetch, so that the log says it is waiting
  fresh = false, // no shared buffer: the part arrived damaged, so the next fetch of it must not come from the HTTP cache
  writtenInRun = 0; // when a graph of the run in progress wrote the part (performance.now()), for the run's end line

// The part as the page left it: [state, the compressed bytes (a copy, never a view of the shared buffer) or the reason]
function partNow(): [number, Uint8Array<ArrayBuffer> | string | null] {
  if (!share) return [PART_FAILED, "this build has no graphics part"];
  if (share.sab && share.hdr) {
    const state = Atomics.load(share.hdr, 0);
    if (state === PART_PENDING) return [state, null];
    const data = new Uint8Array(share.sab, PART_HEADER, share.hdr[1]).slice(); // TextDecoder and Blob refuse a shared view
    return [state, state === PART_LANDED ? data : new TextDecoder().decode(data)];
  }
  if (share.bytes) return [PART_LANDED, share.bytes.slice()];
  return share.error ? [PART_FAILED, share.error] : [PART_PENDING, null];
}

// The part will not unpack or write: it is dropped (the page deletes it from the Cache and fetches it again), the graph that
// finds this says why, and the idle steps stop until then (graphicsError; the next graph clears it).
function damaged(e: unknown): string {
  graphicsError = `the graphics files arrived damaged (${errorForPage(e).message}); they are fetched again for the next graph`;
  decode = decoded = null;
  if (share && !share.sab) {
    share.bytes = undefined; // this worker's own copy: the next graph fetches it again
    fresh = true; // and not from the browser's HTTP cache, which may hold these same bytes
  }
  self.postMessage({ graphics: "damaged" });
  console.warn(`[dofile] ${graphicsError}`);
  return graphicsError;
}

// One step of the brotli-wasm decode (DECODE_STEP of input), started on the first call: the decoded part when done, else
// null. One decode for this worker: a graph that waits and the idle steps go on with it, neither starts over.
function decodeStep(part?: Uint8Array): Uint8Array | null {
  decode ??= {
    steps: unpackSteps(brotliWasm!, part!, share!.file, DECODE_STEP),
    t0: performance.now(),
    how: "wasm",
    longest: 0,
  };
  const t = performance.now(),
    r = decode.steps.next();
  decode.longest = Math.max(decode.longest, since(t));
  if (!r.done) return null;
  decoded = { raw: r.value, t0: decode.t0, how: decode.how, longest: decode.longest };
  decode = null;
  return r.value;
}

// Write the unpacked part into site-packages (one step)
function writePart(where: string) {
  const d = decoded!,
    tWrite = performance.now(),
    n = writeGraphics(py, d.raw);
  graphicsWritten = true;
  decoded = decode = null;
  console.info(
    `[dofile] graphics part: written ${where} (unpack (${d.how}) ${since(d.t0).toFixed(2)}s, longest step ${d.longest.toFixed(2)}s; write ${n} files ${since(tWrite).toFixed(2)}s)`,
  );
}

// Called by Python (browser.py, _LazyGraphics.ensure) while a graph waits, so synchronous: "" once the files are written
// (unpacked here, in steps, if the part landed and the idle steps have not done it), "break" for a Break (the buffer is
// cleared: Python takes it as the engine's Break; the unpack goes on from there later), "pending" after waiting up to `ms`,
// or why the graphs cannot be had (the page's next fetch failed too, or the part is damaged).
function waitGraphics(ms: number): string {
  if (graphicsWritten) return "";
  if (graphicsError) {
    const why = graphicsError;
    graphicsError = ""; // said once: the page is fetching the part again, the next graph waits for it
    return why;
  }
  for (;;) {
    if (interrupt && Atomics.load(interrupt, 0) !== 0) {
      Atomics.store(interrupt, 0, 0);
      return "break";
    }
    try {
      if (decoded) {
        writePart("in a run");
        writtenInRun = performance.now();
        return "";
      }
      if (decode) {
        decodeStep();
        continue;
      }
      const [state, part] = partNow();
      if (state === PART_LANDED) {
        decodeStep(part as Uint8Array);
        continue;
      }
      if (!share!.hdr) {
        // no shared buffer: the page cannot hand the part over while this graph runs, so fetch it here. "pending" first:
        // browser.py then prints its waiting line and sends the log so far before this call blocks for the download
        if (!fetchSaid) {
          fetchSaid = true;
          self.postMessage({ graphics: "fetching" });
          return "pending";
        }
        const why = fetchPartNow();
        if (why) return why;
        continue;
      }
      if (state === PART_FAILED) {
        // a failed fetch: once per run, ask the page for another and wait for it (Break still works); its failure is final
        const tries = Atomics.load(share!.hdr, 2);
        if (askedAt === null) {
          askedAt = tries;
          self.postMessage({ graphics: "again" });
        } else if (tries !== askedAt) return part as string;
        Atomics.wait(share!.hdr, 0, PART_FAILED, ms);
        return "pending";
      }
    } catch (e) {
      const why = damaged(e);
      graphicsError = ""; // this graph says it; the next one waits for the page's fresh fetch
      return why;
    }
    Atomics.wait(share!.hdr, 0, PART_PENDING, ms);
    return "pending";
  }
}

// Without a SharedArrayBuffer (a page that is not cross-origin isolated: plain http on a LAN address, say) a message from
// the page cannot reach a graph blocked in Python, so the graph fetches the part itself, with a synchronous request (allowed
// in a worker; there is no Break without a shared buffer either: the machine resets instead). The page's own fetch may
// have filled the HTTP cache. "" when it is here (share.bytes), else why not. The page is told, so that it shows the
// download ({graphics: "fetching"} was posted by waitGraphics; a synchronous request has no progress to tell).
function fetchPartNow(): string {
  const at = new URL(`${snapshotBase}${share!.file.name}`, self.location.href),
    t0 = performance.now();
  // a damaged part may be in the HTTP cache with the right length: an address of its own is never in it (a request cannot
  // ask a synchronous XHR to reload; the address is ignored by the server)
  if (fresh) at.searchParams.set("fresh", String(Date.now()));
  const url = at.href;
  if (prefetching) {
    // its bytes could only arrive once this graph is over: stopped, so the part comes whole once (what it had is lost)
    prefetching.stop.abort();
    prefetching = null;
    console.info("[dofile] graphics part: the worker's own fetch was still on its way; a graph fetches it now");
  }
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.responseType = "arraybuffer";
    xhr.send();
    if (xhr.status !== 200) throw new Error(`${url}: ${xhr.status}`);
    const bytes = new Uint8Array(xhr.response as ArrayBuffer);
    if (bytes.length !== share!.file.size)
      throw new Error(`${url}: ${bytes.length} bytes arrived, the build's list says ${share!.file.size}`);
    Object.assign(share!, { bytes, error: undefined });
    fresh = false;
    console.info(
      `[dofile] graphics part: fetched by the worker in a run (no shared buffer) ${since(t0).toFixed(2)}s, ${bytes.length} bytes`,
    );
    self.postMessage({ graphics: "landed" });
    return "";
  } catch (e) {
    const why = `the graphics files could not be downloaded (${errorForPage(e).message}); they are fetched again for the next graph`;
    self.postMessage({ graphics: "failed", why });
    return why;
  } finally {
    fetchSaid = false; // the next graph that fetches it says it is waiting again
  }
}

// Without a shared buffer, this worker's own fetch of the part, once started (not before `startup` is answered): it runs
// while the engine is idle or busy, and lands in share.bytes. A graph that comes first stops it and fetches it itself.
function prefetch(): Promise<void> {
  if (!share || share.sab || share.bytes) return Promise.resolve();
  if (prefetching) return prefetching.done;
  const stop = new AbortController(),
    url = new URL(`${snapshotBase}${share.file.name}`, self.location.href).href,
    t0 = performance.now();
  const done = (async () => {
    try {
      self.postMessage({ graphics: "fetching" });
      // after damage: not from the HTTP cache (and the new bytes replace what it held)
      const res = await fetch(url, { signal: stop.signal, ...(fresh && { cache: "reload" as const }) });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      // read as they come, so that the page can show how much is here (throttled)
      const out = new Uint8Array(share!.file.size),
        reader = res.body!.getReader();
      let n = 0,
        sent = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (n + value.length > out.length) throw new Error(`${url}: more bytes than the build's list says`);
        out.set(value, n);
        n += value.length;
        const now = performance.now();
        if (now - sent >= PROGRESS_MS && !stop.signal.aborted) {
          sent = now;
          self.postMessage({ graphics: "progress", received: n });
        }
      }
      if (n !== share!.file.size)
        throw new Error(`${url}: ${n} bytes arrived, the build's list says ${share!.file.size}`);
      if (stop.signal.aborted || share!.bytes || graphicsWritten) return; // a graph fetched it meanwhile
      share!.bytes = out;
      fresh = false;
      console.info(
        `[dofile] graphics part: fetched by the worker (no shared buffer) ${since(t0).toFixed(2)}s, ${n} bytes`,
      );
      self.postMessage({ graphics: "landed" });
      nativeSoon();
      idleSoon();
    } catch (e: any) {
      // a graph fetches it again (fetchPartNow), and says why if that fails too
      if (!stop.signal.aborted) {
        console.warn(`[dofile] graphics part: the worker's fetch failed (${e?.message ?? e})`);
        self.postMessage({
          graphics: "failed",
          why: `the graphics files could not be downloaded (${e?.message ?? e}); they are fetched again for the next graph`,
        });
      }
    } finally {
      prefetched(stop);
    }
  })();
  prefetching = { stop, done };
  return done;
}

// the fetch `stop` belongs to has ended: it is no longer this worker's fetch on its way (unless another one is)
function prefetched(stop: AbortController) {
  if (prefetching?.stop === stop) prefetching = null;
}

// The browser's own decoder (off this thread) unpacks the part as soon as it is here, run or no run: what is left for
// this thread is the write and the import (idleStep). A graph that comes meanwhile cannot use its result: it is blocked in
// Python, and the result comes through a promise on this thread's own event loop, which then never runs. So that graph
// unpacks with brotli-wasm itself and this result is dropped (the .then). Called by `startup`, the op `graphics` and a run's
// end; it does nothing where there is no native decoder (Chromium) or once it ran.
function nativeSoon() {
  if (!started || !share || native || decode || decoded || graphicsWritten || graphicsError) return;
  if (!hasNativeBrotli() || brotliPick === "wasm") return;
  setTimeout(startNative, 0); // a task of its own: never inside the answer to `startup`
}

function startNative() {
  if (!share || native || decode || decoded || graphicsWritten || graphicsError) return;
  const [state, part] = partNow();
  if (state !== PART_LANDED) return;
  const bytes = part as Uint8Array<ArrayBuffer>,
    file = share.file;
  if (bytes.length !== file.size || bytes.length === file.raw) return; // not brotli: the wasm step says what is wrong
  native = true;
  const t0 = performance.now();
  inflateNative(bytes, file.raw)
    .then(
      (raw) => {
        // a graph that came meanwhile could not wait for this (see nativeSoon): it decoded and wrote the part itself, or
        // its decode is in progress; this result is then spare
        if (!graphicsWritten && !decode && !decoded) decoded = { raw, t0, how: "native", longest: 0 };
      },
      (e) => {
        console.warn(`[dofile] graphics part: native brotli failed (${e?.message ?? e}); using brotli-wasm`);
        brotliPick = "wasm"; // the next step starts the brotli-wasm decode, which gives the error if it is damaged
      },
    )
    .finally(() => {
      native = false;
      idleSoon(0);
    });
}

// The one door to the part's work while idle: after `startup`, with no run sent or running, IDLE_MS after the last of them.
// Called by `startup`, the op `graphics` (the part landed), the end of each run and each step.
function idleSoon(delay = Math.max(0, idleSince + IDLE_MS - performance.now())) {
  if (!started || !share || idleTimer || native || graphicsError || (graphicsWritten && warmAt < 0)) return;
  idleTimer = setTimeout(idleStep, delay);
}

// One step: a decode step (or the browser's decoder, all at once but off this thread), the write, or one import step
function idleStep() {
  idleTimer = 0;
  if (runs > 0) return; // the run's end calls idleSoon
  if (performance.now() - idleSince < IDLE_MS) return idleSoon();
  const t = performance.now();
  try {
    if (decoded) {
      writePart("while idle");
      browser.graphics_written();
    } else if (decode) decodeStep();
    else if (!graphicsWritten) {
      const [state, part] = partNow();
      if (state !== PART_LANDED) return; // the op graphics calls idleSoon when it lands
      const bytes = part as Uint8Array<ArrayBuffer>,
        file = share!.file;
      if (hasNativeBrotli() && brotliPick !== "wasm" && bytes.length === file.size && bytes.length !== file.raw)
        return startNative(); // normally under way already (nativeSoon); its end calls idleSoon
      decodeStep(bytes);
    } else {
      // the import of what a first graph needs, after the write: the three heavy modules one at a time, then 20 a step
      if (!tWarm) tWarm = performance.now();
      warmAt = browser.warm_graphics(warmAt, warmAt < 3 ? 1 : 20);
      warmLongest = Math.max(warmLongest, since(t));
      if (warmAt < 0)
        console.info(
          `[dofile] graphics part: warmed (imported) in ${since(tWarm).toFixed(2)}s, longest step ${warmLongest.toFixed(2)}s`,
        );
    }
  } catch (e) {
    damaged(e);
    return;
  }
  idleSoon(0);
}

// Where the start's time went, in seconds, for the page's status line (the "startup" op). From a snapshot: fetched (the
// name of the first step: download, or read from cache), fetchS, unpackS, restoreS, filesS, engineS, notCached. A normal
// boot: runtimeS (Pyodide itself), filesS, packagesS (micropip and the wheel with numpy, scipy, matplotlib), engineS.
// storeError, when the files could not be copied from the store: the engine runs, and nothing it writes is kept.
const startup: Partial<Startup> = {};
const since = (t: number) => (performance.now() - t) / 1000;

// what a run's failed write to the store still owes, kept right when the page moves or replaces the file
function forget(path: string) {
  for (const p of [...unsaved.keys()]) if (within(p, path)) unsaved.delete(p);
}

/** One handler for each op of the set S, with that op's arguments. */
type Handlers<S> = { [K in keyof S]: (args: S[K] extends { args: infer A } ? A : never, id: number) => unknown };

// The ops that change the engine: the transport sends them from start() and run() only.
const lifecycle: Handlers<LifecycleOps> = {
  async mount({ indexURL, snapshot, built, files, brotli: brotliMode, memcap }: MountArgs) {
    brotliPick = brotliMode;
    snapshotBase = snapshot ?? "";
    if (!snapshot) stage("python"); // a snapshot start names its own steps (loadFromSnapshot)
    const io: Io = { stdout: (l) => console.log(l), stderr: (l) => console.warn(l) };
    fromSnapshot = Boolean(snapshot);
    const tRuntime = performance.now();
    const capBytes = (memcap ?? 0) * MIB;
    if (snapshot) {
      const { loaded, summary } = await loadFromSnapshot(snapshot, built, files, indexURL, io, brotliMode, capBytes);
      py = loaded;
      Object.assign(startup, { mode: "snapshot", ...summary });
    } else {
      const fetches = watchFetch(); // a failed fetch ends the start with its error
      try {
        const createPyodideModule = capBytes ? await importCapped(indexURL, capBytes) : undefined;
        py = (await Promise.race([
          loadPyodide({ indexURL, ...(createPyodideModule && { createPyodideModule }), ...io }),
          fetches.failed,
        ])) as SnapshotPy;
      } finally {
        fetches.restore();
      }
      Object.assign(startup, { mode: "normal", runtimeS: since(tRuntime) });
    }
    py.FS.mkdirTree(ROOT);
    const tFiles = performance.now();
    stage("files");
    await copyStore();
    startup.filesS = since(tFiles);
    if (storeError) startup.storeError = storeError;
  },
  startup: async () => {
    started = true; // the part's work may begin: the native unpack at once (after this answer), the rest IDLE_MS from now
    idleSince = performance.now();
    if (share && !share.sab) setTimeout(() => void prefetch(), 0); // after this answer, as nativeSoon
    nativeSoon();
    idleSoon();
    return startup;
  },
  // wheel: the dofile wheel's URL, or {name, bytes}; extraWheels: more of the same, installed with it; interruptBuffer: an
  // Int32Array on a SharedArrayBuffer, or null
  async boot({ wheel, extraWheels = [], interruptBuffer, graphics }: BootArgs) {
    const tPackages = performance.now();
    if (!fromSnapshot) {
      // a snapshot has the packages and the wheel in it already
      stage("packages");
      // no pandas: pyreadstat reads SAS transport and SPSS without it; only export sasxport needs it (about 5 MB more
      // to download and 2 s on a cold start, docs/pyodide-snapshot.md, "Packages added"), so that command is not available here
      await py.loadPackage("micropip", { messageCallback: () => {} });
      const names = await Promise.all(
        [wheel, ...extraWheels].map(async (w) => {
          const name = typeof w === "string" ? w.split("/").at(-1) : w.name;
          const bytes = typeof w === "string" ? await fetchBytes(w) : w.bytes;
          py.FS.writeFile(`/tmp/${name}`, bytes);
          return `emfs:/tmp/${name}`;
        }),
      );
      py.globals.set("wheel_urls", py.toPy(names));
      await py.runPythonAsync(`import micropip; await micropip.install(list(wheel_urls))`);
    }
    interrupt = interruptBuffer ?? null;
    if (interrupt) py.setInterruptBuffer(interrupt);
    if (!fromSnapshot) startup.packagesS = since(tPackages);
    stage("engine");
    const tEngine = performance.now();
    browser = py.pyimport("dofile.browser");
    const about = JSON.parse(browser.start(ROOT));
    if (graphics) {
      // a lazy snapshot: graphs wait for the part (browser.py). Nothing else of it before `startup` (idleSoon)
      share = { ...graphics, hdr: graphics.sab ? new Int32Array(graphics.sab, 0, 4) : null };
      browser.lazy_graphics(waitGraphics);
    }
    startup.engineS = since(tEngine);
    return about;
  },
  // While the run prints, {id, log} chunks go to the page (browser.py calls on_output with the log as it grows).
  async run({ code, fresh_locals, plot_theme }: { code: string } & RunOptions, id: number) {
    try {
      await booted;
      askedAt = null;
      return await runNow({ code, fresh_locals, plot_theme }, id);
    } finally {
      if (writtenInRun) {
        console.info(
          `[dofile] graphics part: in the run, after the write: import and draw ${since(writtenInRun).toFixed(2)}s`,
        );
        writtenInRun = 0;
      }
      runs--; // counted in onmessage
      idleSince = performance.now();
      nativeSoon();
      idleSoon();
    }
  },
  // the page's graphics part (in the shared buffer) landed, failed, or is fetched again (client.ts). Answered at once,
  // outside the queue; the native unpack starts now, the rest waits for an idle engine (idleSoon)
  graphics() {
    nativeSoon();
    idleSoon();
  },
};

async function runNow({ code, fresh_locals, plot_theme }: { code: string } & RunOptions, id: number) {
  {
    if (interrupt) interrupt[0] = 0; // a Break pressed while idle must not stop this run
    const before = walk(ROOT);
    // A file's time has 1 ms steps. Wait until the clock is past the newest file, so that anything the run writes gets a
    // later time than any file had before: saveRun then tells any write of one byte or more by the time, a same-size
    // rewrite too (a truncation, which MEMFS does not stamp, it tells by the size). A time after now (a file from a clock
    // that was ahead) is left out: any rewrite changes it anyway.
    const now = Date.now(),
      newest = before.reduce((m, f) => (f.mtime <= now ? Math.max(m, f.mtime) : m), 0);
    while (Date.now() <= newest) {
      /* one clock step (up to 100 ms with a clamped clock) */
    }
    const t0 = performance.now();
    // Positional: a plain Pyodide call passes no keyword arguments; undefined (not null) is Python's None.
    const result = JSON.parse(
      browser.run(code, true, fresh_locals === true, plot_theme ?? undefined, (text) =>
        self.postMessage({ id, log: text }),
      ),
    );
    const t1 = performance.now();
    Object.assign(result, await saveRun(before));
    // where the run's time went, for the page's status line (the Python side gave engine and encode); save: writing the
    // run's files to the store
    const k = result.timing;
    if (k)
      result.timing = { ...k, parse: (t1 - t0) / 1000 - k.engine - k.encode, save: (performance.now() - t1) / 1000 };
    return result;
  }
}

// The ops declared to change nothing (types.ts, ReadOps): anyone may send one.
const read: Handlers<ReadOps> = {
  // undefined becomes Python's None (null would become JsNull)
  describe: async ({ vars, offset = 0, limit }: DescribeArgs) => {
    await booted;
    return JSON.parse(browser.describe(vars, offset, limit));
  },
  matrix: async ({ name }: { name: string }) => {
    await booted;
    return JSON.parse(browser.matrix(name));
  },
  // a .dta in /work, without loading it; `path` as the page names it, inside the working folder
  async describe_file({ path }: { path: string }) {
    await booted;
    inRoot(path);
    return JSON.parse(browser.describe_file(path));
  },
  macros: async () => {
    await booted;
    return JSON.parse(browser.macros());
  },
  // the first rows of the data: 50 from the top unless the page says otherwise
  browse: async ({ vars, offset, limit }: DescribeArgs) => {
    await booted;
    return JSON.parse(browser.browse(vars ?? undefined, offset ?? 0, limit ?? 50));
  },
  // data_bytes from the engine; heap_bytes is the size of this worker's WebAssembly memory
  memory: async () => {
    await booted;
    return { ...JSON.parse(browser.memory()), heap_bytes: py._module.HEAPU8.length };
  },
  // `files` and `read` are views of /work, for the tests: the page lists and reads the store
  files: () => walk(ROOT),
  read: ({ path }: { path: string }) => py.FS.readFile(inRoot(path)),
};

// The page's changes, told by the function the transport gives the store: the store's version of what the journal names
// (the journal is emptied in the same transaction). A sync that finds the journal empty (a run's after-run write or an
// earlier sync took it) does nothing. With no store (mount could not open it) there is no journal to read, and the
// transport attaches none: a sync that arrives before it knows that does nothing.
const journal: Handlers<JournalOps> = {
  async sync() {
    if (store) takePageVersion(await store.applyRun([]));
  },
};

const ops = { ...lifecycle, ...read, ...journal };

// One op, answered: {id, result}, or {id, error, name}. An op with no arguments is given {}.
const answer = async ({ id, op, args }: ToWorker) => {
  try {
    if (!ops[op]) throw new Error(`unknown op ${op}`);
    const result = await (ops[op] as (args: unknown, id: number) => unknown)(args ?? {}, id);
    self.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []); // a file: moved, not copied
  } catch (e) {
    const { message, name } = errorForPage(e);
    self.postMessage({ id, error: message, name });
  }
};

// answers: FromWorker
self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  if (data.op === "graphics") {
    void answer(data); // outside the queue: it only notes the part, so a run sent after it does not wait for it
    return;
  }
  if (data.op === "run") runs++; // at once, not when the queue reaches it: the part's idle steps stop for it (idleStep)
  if (data.op === "boot") {
    // outside the queue, so `sync`, `files` and `read` are answered while the engine loads
    const { id } = data;
    Promise.resolve(lifecycle.boot(data.args, id)).then(
      (about) => {
        bootDone.ok();
        self.postMessage({ id, result: about });
      },
      (e) => {
        bootDone.err(e);
        const { message, name } = errorForPage(e);
        self.postMessage({ id, error: message, name });
      },
    );
    return;
  }
  queue = queue.then(() => answer(data));
};
