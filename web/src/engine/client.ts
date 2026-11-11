// The page's handle on the engine worker (worker.js): cached(), download(), forgetDownload(), start(), call(op, args),
// run(code, options), breakRun(), keepWaiting(), restart(reason), stop(reason).
// Break works like the MCP server's: the interrupt buffer asks the engine to stop at the next safe point (rc 1, data
// kept). If it hasn't stopped after graceMs, the worker is replaced (rc 9998: data in memory is gone, files stay), unless
// keepWaiting() was called first. Without a SharedArrayBuffer (a page that isn't cross-origin isolated) Break can only restart.
//
// Errors. Every error this client rejects with has a `kind`:
//   "failed"        start() could not start the engine. `reason`: "no-wasm" | "download" | "memory" | "unknown"; `name` is
//                   the worker's error name ("DownloadError": a start file did not arrive; "SnapshotError": the snapshot is
//                   damaged or unusable). Also download(), and start() before it makes a worker, with reason "download" when
//                   the build's list or a file did not arrive as the list says.
//   "failed-twice"  the worker failed twice before a start finished; it is not started again. `reason` as above.
//   "updated"       download() or start(): the build's list is of another build than the page (checkBuild); reload.
//   "reset"         the call was cut by a restart. `reset`: "break" | "crash" | "user".
//   "stopped"       the call was cut by stop(), or by a second start().
//   "no-engine"     call() with no worker.
//   "busy"          run() while a run is in progress.
//   "op"            the worker answered the call with an error; `name` is the worker's error name. Never from run().
// download() rejects with an AbortError (the signal's reason when that is one) when its signal aborts. run() never rejects,
// "busy" excepted: a run that is cut resolves with an rc 9998 result whose `kind` is "break", "crash" or "user" (a
// restart), "stopped", "failed-twice" or "no-engine"; a run whose op failed in the worker (no memory for its result, say)
// resolves with an rc 9998 result of kind "run-failed" and the worker's message as `error`. That worker is not restarted.
import { isStorageRefusal, openCache } from "./snapshot.ts";
import type { FileStore } from "./store.ts";
import type { About, ClientError, CutKind, Downloaded, MountArgs, OpResults, PendingRow, Progress, ResetKind, RunOptions, RunResult,
  StartFiles, Startup, StatusText } from "./types.ts";

/** The dofile wheel, or one of the extra wheels: a URL, or its name and bytes. */
type Wheel = string | { name: string, bytes: Uint8Array };
/** One file of the build's list of start files. */
type StartFile = StartFiles["files"][number];
/** A call waiting for the worker's answer. */
type Pending = { op: string, resolve: (value: any) => void, reject: (error: ClientError) => void, onLog?: (text: string) => void };

export const RC_RESET = 9998;

const fail = (message: string, kind: ClientError["kind"], more: Partial<ClientError> = {}): ClientError => Object.assign(new Error(message), { kind, ...more });
// what download() rejects with when the caller's signal aborted: an AbortError, whatever reason the caller gave
const aborted = (signal: AbortSignal) => (signal.reason?.name === "AbortError" ? signal.reason
  : new DOMException(String(signal.reason?.message ?? signal.reason ?? "aborted"), "AbortError"));
const lost = (what: string) => `session reset: ${what}. Data in memory is gone; your files are kept.`;

// what a run that was cut resolves with: every RunResult field and no timing, plus `kind` (why)
const resetResult = (error: string, kind: CutKind): RunResult => ({ rc: RC_RESET, error, error_command: null, log: "", results: null, nobs: 0, nvars: 0, new_graphs: 0,
  images: [], error_line: null, graph_commands: [], graph_lines: [], kind });

// why a start failed, from the worker's error
function reasonOf({ name, message }: { name?: string, message: string }): "download" | "memory" | "unknown" {
  if (name === "DownloadError") return "download";
  if (name === "RangeError" || /out of memory|MemoryError|could not allocate|allocation failed/i.test(message)) return "memory";
  return "unknown";
}

// The download size for the prompt, in bytes as a host sends them: the build writes it into the page
// (<meta name="dofile-engine-bytes">, vite.config.ts), so it is there at load, offline too. null: not a built page.
export function engineBytes(doc: Document | undefined = globalThis.document): number | null {
  const bytes = Number(doc?.querySelector('meta[name="dofile-engine-bytes"]')?.getAttribute("content"));
  return bytes > 0 ? bytes : null;
}

export class EngineClient {
  declare createWorker: () => Worker;
  declare wheel: Wheel;
  declare extraWheels: Wheel[];
  declare buildId: string | undefined;
  declare indexURL: string | undefined;
  declare snapshot: string | undefined;
  declare brotli: string | undefined;
  declare graceMs: number;
  // the callbacks, for the page's types; the engine controller (app/engine.js) sets its own after construction
  declare onStatus: (status: StatusText) => void;
  declare onRestart: (reason: string, started: Promise<About>, kind: ResetKind) => void;
  declare onFileError: (error: ClientError, op: string, path: string) => void;
  declare store: Pick<FileStore, "attach"> | null;
  declare startFiles: string | (StartFiles & { base?: string }) | undefined;
  declare fetch: typeof globalThis.fetch;
  declare caches: CacheStorage | null | undefined;
  declare wasm: object | null | undefined;
  declare nextId: number;
  declare pending: Map<number, Pending>;
  declare running: Promise<RunResult> | null;
  declare errorRestarts: number;
  declare worker: Worker | null;
  declare breakTimer: ReturnType<typeof setTimeout> | null;
  declare resetAt: number | null;
  declare storeError: string | null;
  declare about: About | null;
  declare startup: Startup | null;
  declare interrupt: Int32Array<SharedArrayBuffer> | null;
  declare gen: number | undefined;

  // createWorker: () => a Worker (in the page: new Worker(new URL("./worker.ts", import.meta.url), {type: "module"}))
  // snapshot: the URL (ending in "/") of a snapshot built by scripts/make-snapshot.mjs, to start from instead of
  // installing the packages. Its build (`built`, its two big files) comes from startFiles, which a snapshot start needs.
  // brotli: "wasm" forces brotli-wasm for the snapshot instead of the browser's own decoder (worker.js), to compare them
  // extraWheels: more wheels installed after the dofile one (web/wheels/: pyreadstat), each a URL or {name, bytes} like `wheel`
  // buildId: the page's build id (scripts/build-id.ts, compiled in by vite.config.ts); a build's list with another one is of
  //   another build, or (in development) of a stale snapshot, and is refused (checkBuild)
  // store: the page's FileStore (store.js). While a worker exists, the store sends it each change the page makes.
  // startFiles: the URL of the build's list of start files (start-files.json), or the list itself; download() and a
  //   snapshot start() need it
  // onRestart(reason, started, kind): a new worker was started; kind is "break" (Break ran out of time, or the page
  //   cannot ask a run to stop), "crash" (the worker failed) or "user" (restart() was called); `started` is its start().
  //   It is called at once, before the cut run's promise resolves with rc 9998.
  // onFileError(error, op, path): a change the page made to the store could not be put into the engine's folder; the
  //   folder then has the store's version, unless that failed too (the next start has it).
  // fetch, caches, wasm: the browser's, unless the tests give their own
  constructor({ createWorker, wheel, extraWheels = [], buildId, indexURL, snapshot, brotli, graceMs = 5000,
    onStatus = (_status) => {}, onRestart = (_reason, _started, _kind) => {}, onFileError = (_error, _op, _path) => {},
    store = null, startFiles = undefined,
    fetch = (...a) => globalThis.fetch(...a), caches = globalThis.caches, wasm = globalThis.WebAssembly }: {
    createWorker: () => Worker, wheel: Wheel, extraWheels?: Wheel[],
    buildId?: string, indexURL?: string, snapshot?: string, brotli?: string, graceMs?: number,
    onStatus?: (status: StatusText) => void,
    onRestart?: (reason: string, started: Promise<About>, kind: ResetKind) => void,
    onFileError?: (error: ClientError, op: string, path: string) => void,
    store?: Pick<FileStore, "attach"> | null, startFiles?: string | (StartFiles & { base?: string }), fetch?: typeof globalThis.fetch,
    caches?: CacheStorage | null, wasm?: object | null }) {
    Object.assign(this, { createWorker, wheel, extraWheels, buildId, indexURL, snapshot, brotli, graceMs, onStatus, onRestart, onFileError,
      store, startFiles, fetch, caches, wasm });
    this.onStatus = onStatus;
    this.onRestart = onRestart;
    this.nextId = 0;
    this.pending = new Map();
    this.running = null;
    this.errorRestarts = 0;
    this.worker = null;
    this.breakTimer = null;
    this.resetAt = null;   // while Break counts down: the time (Date.now()) the engine is reset at
    this.storeError = null;   // after a start: why the worker could not copy the files, if it could not
    this.about = null;     // what boot answered, after a start
    this.startup = null;   // where the last start's time went (worker.js, `startup`)
  }

  // The build's list of start files: { built, buildId, snapshot, files: [{ path, size, compressed, download }], size,
  // compressed } (scripts/start-files.ts).
  // `path` is relative to the list's own URL; `size` is the file on disk and `compressed` what a host sends; `download`
  // marks the files download() fetches (the rest came with the page).
  // A list that cannot be fetched or read (offline, a host's error page) rejects with kind "failed", reason "download".
  async startList(signal: AbortSignal | undefined = undefined): Promise<StartFiles & { base: string }> {
    if (typeof this.startFiles !== "string") return { base: globalThis.location?.href, ...this.startFiles! };
    try {
      const res = await this.fetch(this.startFiles, { cache: "no-cache", signal });
      if (!res.ok) throw new Error(`${res.status}`);
      return { base: this.startFiles, ...await res.json() };
    } catch (e: any) {
      if (signal?.aborted) throw aborted(signal);
      throw fail(`${this.startFiles}: ${e?.message ?? e}`, "failed", { reason: "download" });
    }
  }

  // The one comparison of the page's build with the list's: the build id (scripts/build-id.ts: the build's stamp, the wheels'
  // hashes, the Pyodide version). A list of another build (the site was deployed again since the page loaded; in development,
  // a snapshot of other wheels or another Pyodide than the page, or a dev server restarted since the page loaded) throws kind
  // "updated". A page without an id (some Node tests) skips it.
  checkBuild(list: StartFiles): void {
    if (this.buildId && list.buildId !== this.buildId) {
      throw fail(`dofile was updated: reload the page (the site's start files are of the build ${String(list.buildId).slice(0, 12)}, ` +
        `this page of ${this.buildId.slice(0, 12)}; in development: \`npm run snapshot\` if the snapshot is stale (the dev server's ` +
        "console says), else restart the dev server)", "updated");
    }
  }

  // Whether every file the build's list marks `download` is in the Cache `dofile-snapshot-<built>` of the list's build: the
  // page then starts without asking. False when it cannot tell (no snapshot start, no Cache API, the list cannot be fetched,
  // offline too: no start works offline, since start() fetches the list). Never rejects; writes nothing.
  async cached(): Promise<boolean> {
    try {
      if (!this.snapshot || !this.caches) return false;
      const list = await this.startList();
      const name = `dofile-snapshot-${list.built}`;
      if (!list.built || !(await this.caches.has(name))) return false;   // has() first: open() would make an empty one
      const cache = await this.caches.open(name);
      for (const f of list.files) if (f.download && !(await cache.match(new URL(f.path, list.base).href))) return false;
      return true;
    } catch {
      return false;
    }
  }

  // Delete the start files download() kept (every `dofile-snapshot-*` Cache), so that the next page load downloads them
  // fresh. The page calls it when a start failed twice for a reason the files may be at fault for. Never rejects.
  async forgetDownload(): Promise<void> {
    try {
      for (const name of (await this.caches?.keys()) ?? []) if (name.startsWith("dofile-snapshot-")) await this.caches!.delete(name);
    } catch (e: any) {
      console.warn(`[dofile] could not delete the downloaded start files: ${e?.message ?? e}`);
    }
  }

  // Fetch every file the start needs into the Cache the worker reads, before a worker exists, counting bytes.
  // onProgress({ received, total }): bytes as a host sends them (compressed): the total is the list's, and each file counts
  // its decoded bytes scaled to its compressed size. The files that came with the page count as received from the start.
  // A file that is already in the cache is not fetched again, so a second try goes on where the first one stopped (by
  // file: an unfinished file starts again). `signal` aborts the fetches: download() then rejects with an AbortError.
  // A file that does not arrive whole (a failed fetch, another size than the list says) is not kept, and download()
  // rejects (kind "failed", reason "download"); a list from another build than the page rejects with kind "updated"; a
  // Cache that fails other than by refusing storage rejects with kind "failed", reason "unknown".
  // Resolves with { cached: true, received, total }, or { cached: false, why } when there is nothing to fill (no snapshot
  // start, no Cache API, storage refused): start() then downloads by itself, uncounted.
  async download({ onProgress = (_progress) => {}, signal = undefined }: { onProgress?: (progress: Progress) => void, signal?: AbortSignal } = {}):
    Promise<Downloaded> {
    if (!this.snapshot) return { cached: false, why: "the normal start loads from the CDN" };
    if (signal?.aborted) throw aborted(signal);
    const list = await this.startList(signal);
    if (!list.built) throw fail("no snapshot in this build: run `npm run snapshot` in web/", "failed", { reason: "unknown" });
    this.checkBuild(list);
    if (!this.caches) return { cached: false, why: "there is no Cache API here (not a secure context?)" };
    let cache: Cache;
    try {
      cache = await openCache(this.caches, list.built);
    } catch (e: any) {
      if (isStorageRefusal(e)) return { cached: false, why: `${e.name}: ${e.message}` };
      throw fail(String(e?.message ?? e), "failed", { reason: "unknown" });
    }
    const total = list.compressed, got = new Map<StartFile, number>();
    let received = list.files.reduce((n, f) => n + (f.download ? 0 : f.compressed), 0), last = -1;
    const count = (f: StartFile, bytes: number) => {   // `bytes` of this file are here, decoded
      const scaled = Math.round(Math.min(bytes / (f.size || 1), 1) * f.compressed);
      received += scaled - (got.get(f) ?? 0);
      got.set(f, scaled);
      if (received !== last) onProgress({ received: last = received, total });
    };
    onProgress({ received, total });
    const stop = new AbortController(), abort = () => stop.abort(signal!.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort);
    const one = async (f: StartFile) => {
      const url = new URL(f.path, list.base).href;
      if (await cache.match(url)) return count(f, f.size);   // kept from an earlier try
      const res = await this.fetch(url, { signal: stop.signal, cache: "no-cache" });   // not an older build's file from the HTTP cache
      if (!res.ok) throw fail(`${url}: ${res.status}`, "failed", { reason: "download" });
      const chunks: Uint8Array<ArrayBuffer>[] = [], reader = res.body!.getReader();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        stop.signal.throwIfAborted();   // a browser may still hand over what it had buffered: an aborted file is not kept
        if (done) break;
        chunks.push(value);
        count(f, n += value.length);
      }
      // a short answer, an error page sent with status 200, a file of another build: not what the list names
      if (n !== f.size) throw fail(`${url}: ${n} bytes arrived, the build's list says ${f.size}`, "failed", { reason: "download" });
      // the type matters for the .wasm: the engine compiles it from this answer as it reads it
      const type = f.path.endsWith(".wasm") ? "application/wasm" : res.headers.get("Content-Type") ?? "application/octet-stream";
      await cache.put(url, new Response(new Blob(chunks), { headers: { "Content-Type": type } }));
    };
    const failed = (e: any): never => {   // one file's error ends the others; a failure of the network is a failed download
      if (signal?.aborted) throw aborted(signal);   // the caller's reason may be anything, a string too
      stop.abort(e);
      throw e?.kind || isStorageRefusal(e) ? e : fail(String(e?.message ?? e), "failed", { reason: "download" });
    };
    try {
      await Promise.all(list.files.filter(f => f.download).map(f => one(f).catch(failed)));
    } catch (e: any) {
      if (isStorageRefusal(e)) return { cached: false, why: `${e.name}: ${e.message}` };   // the browser would not keep a file
      throw e;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    return { cached: true, received, total };
  }

  // Start a worker and the engine in it. A worker that is still there (a second start()) is ended first. A snapshot start
  // first fetches the build's list, fresh, and checks it (checkBuild): a list that does not arrive (kind "failed", reason
  // "download") or is of another build (kind "updated") makes no worker. If the start fails, the worker is ended, the store
  // stops sending to it, and start() rejects (kind "failed", "failed-twice" or "updated").
  async start(): Promise<About> {
    if (this.worker) this.end(fail(lost("the engine was started again"), "stopped"), null);
    if (!this.wasm) throw fail("this browser has no WebAssembly support", "failed", { reason: "no-wasm" });
    // A stop() or another start() while the list is fetched takes the next number: this start then makes no worker.
    const gen = this.gen = (this.gen ?? 0) + 1;
    let mountArgs: MountArgs = { indexURL: this.indexURL, brotli: this.brotli };
    if (this.snapshot) {   // the build's list, fresh: the worker gets the build's identity from it, and fetches no manifest
      try {
        const list = await this.startList();
        if (!list.built) throw fail("no snapshot in this build: run `npm run snapshot` in web/", "failed", { reason: "unknown" });
        this.checkBuild(list);   // first, as in download(): a list of another build is "updated", whatever it lacks
        if (!list.snapshot) throw fail("no snapshot in this build: run `npm run snapshot` in web/", "failed", { reason: "unknown" });
        mountArgs = { ...mountArgs, snapshot: this.snapshot, built: list.built, files: list.snapshot };
      } catch (e) {
        if (gen === this.gen) { this.store?.attach(null); throw e; }
      }
      if (gen !== this.gen) throw fail("the start was stopped before its worker existed", "stopped");
    }
    this.interrupt = typeof SharedArrayBuffer === "undefined" ? null : new Int32Array(new SharedArrayBuffer(4));
    let worker: Worker;
    try {
      worker = this.worker = this.createWorker();
    } catch (e: any) {
      this.store?.attach(null);
      throw fail(String(e?.message ?? e), "failed", { reason: "unknown", name: e?.name ?? "Error" });
    }
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;   // a message from before a restart
      if (data.status) return this.onStatus(data.status);
      const p = this.pending.get(data.id);
      if (!p) return;
      if ("log" in data) return p.onLog?.(data.log);   // a chunk of a running run's log: the call stays pending
      this.pending.delete(data.id);
      if (!("error" in data)) p.resolve(data.result);
      else if (p.op === "run") p.resolve(resetResult(data.error, "run-failed"));   // run() never rejects; the worker stays
      else p.reject(fail(data.error, "op", { name: data.name ?? "Error" }));
    };
    // An error restarts the worker once; a second one before a start() has finished (a script that never loads, a crash while
    // starting) ends the start instead of looping, since each new worker can cost a phone a GB.
    // A closed database (below) counts the same way.
    const crashed = (reason: string, what: string, name: string | undefined) => {
      if (worker !== this.worker) return;
      if (this.errorRestarts++ < 1) {   // a failed start reaches the caller through its own start(); the catch only keeps it from being unhandled
        this.restart(reason, "crash").catch(() => {});
        return;
      }
      this.errorRestarts = 0;
      this.end(fail(`the engine's worker failed twice (${what}); reload the page`, "failed-twice", { reason: reasonOf({ name, message: what }) }), null);
    };
    worker.onerror = (e: any) => {
      const what = String(e?.message ?? e);
      crashed(`the engine crashed (${what})`, what, e?.name);
    };
    // The page's file changes go to this worker from now on (the store writes itself first). One that a restart cut off
    // is not lost: the new worker copies the whole store. If the browser closes the database under the page (another
    // page deleted it, "Clear site data"), its seqs may start again from 1, below what the worker has covered: the worker
    // is restarted (kind "crash"), so that it copies the store as it is now.
    const send = (op: PendingRow["op"], args: { path?: string, from?: string }, transfer: Transferable[]) => {
      this.call(op, args, transfer).catch(e => { if (e.kind === "op") this.onFileError(e, op, (args.path ?? args.from)!); });
    };
    const onClosed = () => crashed("the browser closed the file storage", "the browser closed the file storage", "Error");
    this.store?.attach(send, { onClosed });
    // Two steps (see worker.js). Calls the page makes once the worker exists queue behind "mount" in the worker: they are
    // answered before the engine has loaded. (A snapshot start makes the worker only after the list has arrived; a call
    // before that rejects with kind "no-engine".)
    // If a restart happens during a step (mount, boot or startup), that step's answer is the new start()'s result and this
    // one ends with it.
    try {
      const mounted = await this.call("mount", mountArgs);
      if (gen !== this.gen) return mounted as unknown as About;   // end() answered this step with the new start()
      const about = await this.call("boot", { wheel: this.wheel, extraWheels: this.extraWheels, interruptBuffer: this.interrupt });
      if (gen !== this.gen) return about;
      this.about = about;
      const startup = await this.call("startup");   // where the start's time went (worker.js); the page shows it in its status line
      if (gen !== this.gen) return startup as unknown as About;
      this.startup = startup;
      this.storeError = this.startup?.storeError ?? null;
      // a worker with no store never deletes a `pending` row: the page's changes go to it without one
      if (this.storeError) this.store?.attach(send, { onClosed, journal: false });
      this.errorRestarts = 0;
      return about;
    } catch (e: any) {
      if (e.kind !== "op" || gen !== this.gen) throw e;   // ended from outside (stop, a restart, a second failure): it said why
      const error = fail(e.message, "failed", { reason: reasonOf(e), name: e.name });   // mount or boot failed in the worker
      // errorRestarts is not cleared here, on purpose: a retry after a failed start that crashes again is "failed twice"
      this.end(error, null);
      throw error;
    }
  }

  call<K extends keyof OpResults>(op: K, args: object = {}, transfer: Transferable[] = [], extra: object = {}): Promise<OpResults[K]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(fail("the engine is not running", "no-engine"));
      const id = ++this.nextId;
      this.pending.set(id, { op, resolve, reject, ...extra });
      this.worker.postMessage({ id, op, args }, transfer);
    });
  }

  // options: fresh_locals, plot_theme (RunOptions), and onLog(text), called with each chunk of the log while the run
  // prints. The chunks are a preview: when the result comes, its `log` replaces them.
  // One run at a time: a second run() while one is in progress rejects (kind "busy"). With no worker it resolves with an
  // rc 9998 result (kind "no-engine").
  run(code: string, { onLog = undefined, fresh_locals = undefined, plot_theme = undefined }: RunOptions & { onLog?: (text: string) => void } = {}):
    Promise<RunResult> {
    if (this.running) return Promise.reject(fail("a run is in progress", "busy"));
    if (!this.worker) return Promise.resolve(resetResult(lost("the engine is not running"), "no-engine"));
    const p = this.call("run", { code, fresh_locals, plot_theme }, [], { onLog });
    this.running = p;
    const done = () => {
      if (this.running !== p) return;
      this.running = null;
      this.clearBreak();
    };
    p.then(done, done);
    return p;
  }

  // The Break button: asks the run to stop, and starts the timer that resets the engine if it has not stopped after
  // graceMs (`resetAt` is when). A second Break before that keeps the first deadline. A page that is not cross-origin
  // isolated has no way to ask: it resets at once.
  breakRun(): void {
    const running = this.running;
    if (!running) return;
    if (!this.interrupt) {
      this.restart("Break reset the engine, because this page is not cross-origin isolated and cannot ask a run to stop", "break").catch(() => {});
      return;
    }
    Atomics.store(this.interrupt, 0, 2);   // SIGINT
    if (this.breakTimer) return;
    this.resetAt = Date.now() + this.graceMs;
    this.breakTimer = setTimeout(() => {
      this.clearBreak();
      if (this.running === running) this.restart("the code did not stop at Break", "break").catch(() => {});
    }, this.graceMs);
  }

  // "Don't reset: wait for it": the timer is cancelled and the Break stays asked, so the run stops after the command it
  // is in, with the data kept.
  keepWaiting(): void { this.clearBreak(); }

  clearBreak(): void {
    clearTimeout(this.breakTimer as ReturnType<typeof setTimeout> | undefined);
    this.breakTimer = this.resetAt = null;
  }

  // The worker is ended, with `error` (its kind says why). A run in progress resolves with rc 9998 and `runKind`; a start
  // in progress gets `started` (the new worker's start) or, with none, fails; every other call fails with `error`.
  end(error: ClientError, started: Promise<About> | null, runKind: CutKind = error.kind as CutKind): void {
    this.clearBreak();
    this.worker?.terminate();
    this.worker = null;
    if (!started) this.store?.attach(null);
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.running = null;
    for (const p of pending) {
      if (p.op === "run") p.resolve(resetResult(error.message, runKind));
      else if (started && ["mount", "boot", "startup"].includes(p.op)) p.resolve(started);   // a restart while starting: the first start() ends with the new one
      else p.reject(error);
    }
  }

  // Reset, and "Reset now": a new worker. A run in progress ends with rc 9998, other calls fail (kind "reset"). The files
  // come back from the store; the run that was cut wrote nothing to it. kind: "user" unless the client restarts by
  // itself ("break", "crash"). onRestart is called before this returns, so before the cut run's promise resolves.
  async restart(reason: string, kind: ResetKind = "user"): Promise<About> {
    if (kind !== "crash") this.errorRestarts = 0;
    let begin!: (value: Promise<About>) => void;
    const started = new Promise<About>(ok => { begin = ok; });
    this.end(fail(lost(reason), "reset", { reset: kind }), started, kind);
    begin(this.start());
    this.onRestart(reason, started, kind);
    return started;
  }

  // End the worker and start no new one (another tab took over). start() makes one again.
  stop(reason: string): void {
    this.gen = (this.gen ?? 0) + 1;
    this.errorRestarts = 0;
    this.end(fail(lost(reason), "stopped"), null);
  }
}
