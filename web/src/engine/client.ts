// The transport: the page's side of the engine worker (worker.ts), and the build's files before a worker exists. It
// decides nothing. The state machine (machine.ts) says when a worker starts and ends; the controller (src/app/engine.ts)
// performs that here. Its interface is three parts (docs/prototype1-step3.5-c-design.md, item 7):
//   Reader     query(op, args): the read ops (types.ts, ReadOps). Safe at any time, from anywhere.
//   Lifecycle  start(n, build, reply), end(n, ending), run(n, args, onLog), interrupt(n): what changes the engine. Only the
//              effect performer holds this.
//   Builds     cached(), download(), build(), forgetDownload(): the build's list and its files in the Cache.
// `n` is the live worker's number: the performer passes the effect's ticket, and the transport only compares it. It never
// puts it on an event: what a worker's start has to say goes through the `reply` given with it (stage, started,
// start-failed, crashed), which the controller has bound to the ticket.
// The transport does not restart, count crashes, hold a timer, make run results or know a state name, and it awaits
// nothing before it makes a worker. One worker is live at a time: start() with one still live throws.
//
// Errors. Every error the transport rejects with has a `kind`:
//   "failed"        download() or build(): the build's list or a file did not arrive as the list says (`reason`
//                   "download"), or the build has no snapshot, or the Cache broke (`reason` "unknown"). Also a call cut
//                   because its worker's start failed.
//   "failed-twice"  the call was cut because its worker failed twice while starting.
//   "updated"       download() or build(): the build's list is of another build than the page (checkBuild); reload.
//   "reset"         the call was cut by a reset. `reset`: "break" | "crash" | "user".
//   "stopped"       the call was cut because another tab took the engine.
//   "no-engine"     query() or run() with no live worker.
//   "op"            the worker answered the call with an error; `name` is the worker's error name.
// download() rejects with an AbortError (the signal's reason when that is one) when its signal aborts.

import type { Ending, Reply } from "./machine.ts";
import { isStorageRefusal, openCache } from "./snapshot.ts";
import type { FileStore } from "./store.ts";
import type {
  About,
  Build,
  ClientError,
  Downloaded,
  FromWorker,
  MountArgs,
  Op,
  Ops,
  Progress,
  ReadOps,
  RunResult,
  StartFiles,
  Startup,
  Wheel,
} from "./types.ts";

/** One file of the build's list of start files. */
type StartFile = StartFiles["files"][number];
/** A call waiting for the worker's answer. */
type Pending = { resolve: (value: any) => void; reject: (error: ClientError) => void; onLog?: (text: string) => void };
/** The live worker's record: its number, its calls, its interrupt buffer. `ended`: what end() rejected its calls with. */
type Live = {
  n: number;
  worker: Worker;
  pending: Map<number, Pending>;
  interrupt: Int32Array<SharedArrayBuffer> | null;
  ended: ClientError | null;
};

/** Read ops only: safe at any time, from anywhere. */
export interface Reader {
  query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]>;
}
/** What changes the engine. Only the effect performer holds this. */
export interface Lifecycle {
  start(n: number, build: Build | null, reply: Reply<"start-worker">): void;
  end(n: number, ending: Ending): void;
  run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void): Promise<RunResult>;
  interrupt(n: number): void;
}
/** The build's files, before a worker exists. */
export interface Builds {
  cached(): Promise<boolean>;
  download(o: { onProgress?: (p: Progress) => void; signal?: AbortSignal }): Promise<Downloaded>;
  build(): Promise<Build | null>; // the list, fetched fresh and checked (checkBuild); null for the normal start
  forgetDownload(): Promise<void>;
}

const fail = (message: string, kind: ClientError["kind"], more: Partial<ClientError> = {}): ClientError =>
  Object.assign(new Error(message), { kind, ...more });
// what download() rejects with when the caller's signal aborted: an AbortError, whatever reason the caller gave
const aborted = (signal: AbortSignal) =>
  signal.reason?.name === "AbortError"
    ? signal.reason
    : new DOMException(String(signal.reason?.message ?? signal.reason ?? "aborted"), "AbortError");

// Delete from `cache` every entry that is not one of the list's download files, at the address the page and the worker
// use for it (relative to the list). Never rejects: a Cache that will not say or delete leaves the entries, as before.
async function dropUnlisted(cache: Cache, list: StartFiles & { base: string }): Promise<void> {
  const keep = new Set(list.files.filter((f) => f.download).map((f) => new URL(f.path, list.base).href));
  try {
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  } catch (e: any) {
    console.warn(`[dofile] could not drop the old start files: ${e?.message ?? e}`);
  }
}

// why a start failed or a worker crashed, from the worker's error
function reasonOf({ name, message }: { name?: string; message: string }): "download" | "memory" | "unknown" {
  if (name === "DownloadError") return "download";
  if (name === "RangeError" || /out of memory|MemoryError|could not allocate|allocation failed/i.test(message))
    return "memory";
  return "unknown";
}

export class EngineClient implements Reader, Lifecycle, Builds {
  declare createWorker: () => Worker;
  declare wheel: Wheel;
  declare extraWheels: Wheel[];
  declare buildId: string | undefined;
  declare indexURL: string | undefined;
  declare snapshot: string | undefined;
  declare brotli: string | undefined;
  declare store: Pick<FileStore, "attach"> | null;
  declare startFiles: string | (StartFiles & { base?: string }) | undefined;
  declare fetch: typeof globalThis.fetch;
  declare caches: CacheStorage | null | undefined;
  declare wasm: object | null | undefined;
  declare nextId: number;
  // facts of the last start, for the tests and the test hook; nothing decides by them
  declare storeError: string | null;
  declare about: About | null;
  declare startup: Startup | null;
  #live: Live | null = null;

  // createWorker: () => a Worker (in the page: new Worker(new URL("./worker.ts", import.meta.url), {type: "module"}))
  // snapshot: the URL (ending in "/") of a snapshot built by scripts/make-snapshot.mjs, to start from instead of
  // installing the packages. Its build (`built`, its two big files) comes from startFiles, which a snapshot start needs.
  // brotli: "wasm" forces brotli-wasm for the snapshot instead of the browser's own decoder (worker.ts), to compare them
  // extraWheels: more wheels installed after the dofile one (web/wheels/: pyreadstat), each a URL or {name, bytes} like `wheel`
  // buildId: the page's build id (scripts/build-id.ts, compiled in by vite.config.ts); a build's list with another one is of
  //   another build, or (in development) of a stale snapshot, and is refused (checkBuild)
  // store: the page's FileStore (store.ts). While a worker is live, the store tells it of each change the page makes.
  // startFiles: the URL of the build's list of start files (start-files.json), or the list itself; download(), build() and
  //   cached() need it
  // fetch, caches, wasm: the browser's, unless the tests give their own
  constructor({
    createWorker,
    wheel,
    extraWheels = [],
    buildId,
    indexURL,
    snapshot,
    brotli,
    store = null,
    startFiles = undefined,
    fetch = (...a) => globalThis.fetch(...a),
    caches = globalThis.caches,
    wasm = globalThis.WebAssembly,
  }: {
    createWorker: () => Worker;
    wheel: Wheel;
    extraWheels?: Wheel[];
    buildId?: string;
    indexURL?: string;
    snapshot?: string;
    brotli?: string;
    store?: Pick<FileStore, "attach"> | null;
    startFiles?: string | (StartFiles & { base?: string });
    fetch?: typeof globalThis.fetch;
    caches?: CacheStorage | null;
    wasm?: object | null;
  }) {
    Object.assign(this, {
      createWorker,
      wheel,
      extraWheels,
      buildId,
      indexURL,
      snapshot,
      brotli,
      store,
      startFiles,
      fetch,
      caches,
      wasm,
    });
    this.nextId = 0;
    this.storeError = null; // after a start: why the worker could not copy the files, if it could not
    this.about = null; // what boot answered, after a start
    this.startup = null; // where the last start's time went (worker.ts, `startup`)
  }

  /** The live worker, or null. */
  get worker(): Worker | null {
    return this.#live?.worker ?? null;
  }

  // ---- Builds: the build's list and its files in the Cache ----

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
      return { base: this.startFiles, ...(await res.json()) };
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
      throw fail(
        `dofile was updated: reload the page (the site's start files are of the build ${String(list.buildId).slice(0, 12)}, ` +
          `this page of ${this.buildId.slice(0, 12)}; in development: \`npm run snapshot\` if the snapshot is stale (the dev server's ` +
          "console says), else restart the dev server)",
        "updated",
      );
    }
  }

  // What `mount` needs of a list, after the checks: a list of another build is "updated", whatever it lacks; a build with
  // no snapshot rejects with kind "failed", reason "unknown".
  #buildOf(list: StartFiles): Build {
    const none = () =>
      fail("no snapshot in this build: run `npm run snapshot` in web/", "failed", { reason: "unknown" });
    if (!list.built) throw none();
    this.checkBuild(list);
    if (!list.snapshot) throw none();
    return { built: list.built, files: list.snapshot };
  }

  // The build's list, fetched fresh and checked: what `mount` needs of it for a snapshot start. null for the normal start
  // (?snapshot=0), which has no list. Every restart asks for it (the machine's `starting-list`): the Cache may have been
  // evicted since the first start, and the worker would then fetch the files of whatever build the site has now. A list
  // that does not arrive rejects with kind "failed", reason "download"; one of another build with kind "updated".
  async build(): Promise<Build | null> {
    if (!this.snapshot) return null;
    return this.#buildOf(await this.startList());
  }

  // Whether every file the build's list marks `download` is in the Cache `dofile-snapshot-<built>` of the list's build: the
  // page then starts without asking. False when it cannot tell (no snapshot start, no Cache API, the list cannot be fetched,
  // offline too: no start works offline, since a start needs the list). Never rejects; writes nothing.
  async cached(): Promise<boolean> {
    try {
      if (!this.snapshot || !this.caches) return false;
      const list = await this.startList();
      const name = `dofile-snapshot-${list.built}`;
      if (!list.built || !(await this.caches.has(name))) return false; // has() first: open() would make an empty one
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
      for (const name of (await this.caches?.keys()) ?? [])
        if (name.startsWith("dofile-snapshot-")) await this.caches!.delete(name);
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
  // Resolves with { cached: true, received, total, build }, or { cached: false, why, build } when there is nothing to fill
  // (no snapshot start, no Cache API, storage refused): the worker then downloads by itself, uncounted. `build`: what
  // `mount` needs of the list just checked (null: the normal start), so the start that follows fetches no list.
  async download({
    onProgress = (_progress) => {},
    signal = undefined,
  }: {
    onProgress?: (progress: Progress) => void;
    signal?: AbortSignal;
  } = {}): Promise<Downloaded> {
    if (!this.snapshot) return { cached: false, why: "the normal start loads from the CDN", build: null };
    if (signal?.aborted) throw aborted(signal);
    const list = await this.startList(signal);
    const build = this.#buildOf(list);
    if (!this.caches) return { cached: false, why: "there is no Cache API here (not a secure context?)", build };
    let cache: Cache;
    try {
      cache = await openCache(this.caches, build.built);
    } catch (e: any) {
      if (isStorageRefusal(e)) return { cached: false, why: `${e.name}: ${e.message}`, build };
      throw fail(String(e?.message ?? e), "failed", { reason: "unknown" });
    }
    // An entry of this Cache that the list does not name is never read again: the same build's files kept at another
    // address (the editor moved from / to /app/ with the snapshot unchanged, so the Cache's name stayed). Drop it, or it
    // keeps tens of MB until the next snapshot. The list's own files stay, so a download that resumes keeps what it has;
    // and not while a worker is live, which may be reading this Cache (the machine downloads only before a worker exists).
    if (!this.#live) await dropUnlisted(cache, list);
    const total = list.compressed,
      got = new Map<StartFile, number>();
    let received = list.files.reduce((n, f) => n + (f.download ? 0 : f.compressed), 0),
      last = -1;
    const count = (f: StartFile, bytes: number) => {
      // `bytes` of this file are here, decoded
      const scaled = Math.round(Math.min(bytes / (f.size || 1), 1) * f.compressed);
      received += scaled - (got.get(f) ?? 0);
      got.set(f, scaled);
      if (received !== last) {
        last = received;
        onProgress({ received, total });
      }
    };
    onProgress({ received, total });
    const stop = new AbortController(),
      abort = () => stop.abort(signal!.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort);
    const one = async (f: StartFile) => {
      const url = new URL(f.path, list.base).href;
      if (await cache.match(url)) return count(f, f.size); // kept from an earlier try
      const res = await this.fetch(url, { signal: stop.signal, cache: "no-cache" }); // not an older build's file from the HTTP cache
      if (!res.ok) throw fail(`${url}: ${res.status}`, "failed", { reason: "download" });
      const chunks: Uint8Array<ArrayBuffer>[] = [],
        reader = res.body!.getReader();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        stop.signal.throwIfAborted(); // a browser may still hand over what it had buffered: an aborted file is not kept
        if (done) break;
        chunks.push(value);
        n += value.length;
        count(f, n);
      }
      // a short answer, an error page sent with status 200, a file of another build: not what the list names
      if (n !== f.size)
        throw fail(`${url}: ${n} bytes arrived, the build's list says ${f.size}`, "failed", { reason: "download" });
      // the type matters for the .wasm: the engine compiles it from this answer as it reads it
      const type = f.path.endsWith(".wasm")
        ? "application/wasm"
        : (res.headers.get("Content-Type") ?? "application/octet-stream");
      await cache.put(url, new Response(new Blob(chunks), { headers: { "Content-Type": type } }));
    };
    const failed = (e: any): never => {
      // one file's error ends the others; a failure of the network is a failed download
      if (signal?.aborted) throw aborted(signal); // the caller's reason may be anything, a string too
      stop.abort(e);
      throw e?.kind || isStorageRefusal(e) ? e : fail(String(e?.message ?? e), "failed", { reason: "download" });
    };
    try {
      await Promise.all(list.files.filter((f) => f.download).map((f) => one(f).catch(failed)));
    } catch (e: any) {
      if (isStorageRefusal(e)) return { cached: false, why: `${e.name}: ${e.message}`, build }; // the browser would not keep a file
      throw e;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    return { cached: true, received, total, build };
  }

  // ---- Lifecycle: what changes the engine. Only the effect performer calls these. ----

  // Make worker `n` and start the engine in it: mount, boot, startup, in order. What happens is said through `reply`:
  // `stage` as each stage begins, then `started`; `start-failed` when there is no WebAssembly, the worker cannot be made,
  // or mount, boot or startup fails in the worker; `crashed` when the worker errors or the browser closes the file
  // storage, now or at any time while it is live. It fetches nothing first: `build` is what `mount` needs of the build's
  // list (null: the normal start). The worker is made before start() returns, so calls made right after it queue behind
  // "mount" in the worker. A worker that failed is not ended here: the machine says so (end()).
  // With a worker still live it throws: the machine always ends a worker before it starts another.
  start(n: number, build: Build | null, reply: Reply<"start-worker">): void {
    if (this.#live) throw new Error(`start(${n}): worker ${this.#live.n} is still live`);
    if (!this.wasm) {
      reply({ type: "start-failed", reason: "no-wasm", detail: "this browser has no WebAssembly support" });
      return;
    }
    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch (e: any) {
      reply({ type: "start-failed", reason: "unknown", detail: String(e?.message ?? e) });
      return;
    }
    const live: Live = {
      n,
      worker,
      pending: new Map(),
      ended: null,
      interrupt: typeof SharedArrayBuffer === "undefined" ? null : new Int32Array(new SharedArrayBuffer(4)),
    };
    this.#live = live;
    // A message for a call that end() has dropped finds nothing in `pending`. A stage or an error of a worker that was
    // ended is still said: its reply carries that worker's ticket, and the machine drops what is out of date.
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      if ("stage" in data) return reply({ type: "stage", stage: data.stage });
      const p = live.pending.get(data.id);
      if (!p) return;
      if ("log" in data) return p.onLog?.(data.log); // a chunk of a running run's log: the call stays pending
      live.pending.delete(data.id);
      if ("error" in data) p.reject(fail(data.error, "op", { name: data.name ?? "Error" }));
      else p.resolve(data.result);
    };
    worker.onerror = (e: any) => {
      const what = String(e?.message ?? e);
      reply({ type: "crashed", cause: "error", reason: reasonOf({ name: e?.name, message: what }), detail: what });
    };
    // The page's file changes reach this worker from now on: the store writes the change and a journal row first, then
    // calls `sync`, and the worker takes the store's version of what the journal names. A sync that end() cuts off loses
    // nothing: its row stays, and the next worker copies the whole store. If the browser closes the database under the
    // page (another page deleted it, "Clear site data"), /work may hold files the store no longer has, which no journal
    // row says: that is `crashed` with cause "storage", so that a new worker copies the store as it is now.
    const sync = () => {
      this.#send(live, "sync", undefined).catch((e: ClientError) => {
        if (e.kind === "op")
          console.warn(`[dofile] the engine's folder could not take a change to your files: ${e.message}`);
      });
    };
    const onClosed = () =>
      reply({ type: "crashed", cause: "storage", reason: "unknown", detail: "the browser closed the file storage" });
    this.store?.attach(sync, { onClosed });
    const mount: MountArgs =
      build && this.snapshot
        ? {
            indexURL: this.indexURL,
            brotli: this.brotli,
            snapshot: this.snapshot,
            built: build.built,
            files: build.files,
          }
        : { indexURL: this.indexURL, brotli: this.brotli };
    // Two steps (see worker.ts), then where the start's time went. Every step goes through this worker's own record: one
    // that resumes after end() rejects with what end() said, and reaches no other worker.
    const steps = async () => {
      await this.#send(live, "mount", mount);
      const about = await this.#send(live, "boot", {
        wheel: this.wheel,
        extraWheels: this.extraWheels,
        interruptBuffer: live.interrupt,
      });
      const startup = await this.#send(live, "startup", undefined); // where the start's time went: the page shows it in its status line
      return { about, startup };
    };
    steps().then(
      ({ about, startup }) => {
        if (live.ended) return; // ended just as its last step was answered: it says nothing more
        this.about = about;
        this.startup = startup;
        this.storeError = startup?.storeError ?? null;
        // A worker with no store cannot read the journal, so the page's changes cannot reach it: the store is detached, and
        // writes no row that no worker would clear. The start's storeError has said the files are not saved.
        if (this.storeError) this.store?.attach(null);
        reply({ type: "started" });
      },
      (e: ClientError) => {
        // "op": mount, boot or startup failed in the worker. Any other kind: the worker was ended, and whoever ended it knows.
        if (e.kind === "op") reply({ type: "start-failed", reason: reasonOf(e), detail: e.message });
      },
    );
  }

  // End worker `n`: it is terminated, the store is detached from it, and every call of it that is pending rejects with a
  // ClientError of the ending's kind (`reason` is its message). With no live worker it does nothing (a start that failed
  // before a worker existed). With another worker live it throws: a bug in the caller.
  end(n: number, ending: Ending): void {
    const live = this.#live;
    if (!live) return;
    if (live.n !== n) throw new Error(`end(${n}): the live worker is ${live.n}`);
    this.#live = null;
    live.worker.terminate();
    this.store?.attach(null);
    live.ended = fail(ending.reason, ending.kind, ending.kind === "reset" ? { reset: ending.reset } : {});
    const pending = [...live.pending.values()];
    live.pending.clear();
    for (const p of pending) p.reject(live.ended);
  }

  // Run code on worker `n`. onLog(text) is called with each chunk of the log while the run prints; the chunks are a
  // preview: the result's `log` replaces them. Resolves with the worker's result. Rejects with kind "op" when the worker
  // answered the op with an error (that worker stays), and with the ending's kind when the worker was ended meanwhile.
  run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void): Promise<RunResult> {
    const live = this.#live;
    if (live?.n !== n) return Promise.reject(fail("the engine is not running", "no-engine"));
    return this.#send(live, "run", args, onLog);
  }

  // Break: ask the run on worker `n` to stop at its next safe point (SIGINT in the shared buffer; the worker clears it
  // when a run starts). Nothing to do without a SharedArrayBuffer: the machine resets instead (machine.ts, BREAK).
  interrupt(n: number): void {
    const live = this.#live;
    if (live?.n === n && live.interrupt) Atomics.store(live.interrupt, 0, 2); // SIGINT
  }

  // ---- Reader: the read ops. Anyone may ask. ----

  // A read op (types.ts, ReadOps). With no live worker it rejects with kind "no-engine". While the worker starts or runs
  // it waits in the worker's queue; if its worker is ended first it rejects with the ending's kind.
  query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
    if (!this.#live) return Promise.reject(fail("the engine is not running", "no-engine"));
    return this.#send(this.#live, op, args);
  }

  // THE ONE PLACE the worker is posted to. The call is kept in the worker's own record until it is answered or the
  // worker is ended; on a record that has ended it rejects at once with what end() said.
  #send<K extends Op>(
    live: Live,
    op: K,
    args: Ops[K]["args"] | undefined,
    onLog?: (text: string) => void,
  ): Promise<Ops[K]["result"]> {
    return new Promise((resolve, reject) => {
      if (live.ended) return reject(live.ended);
      const id = ++this.nextId;
      live.pending.set(id, { resolve, reject, onLog });
      live.worker.postMessage({ id, op, args }); // a ToWorker message
    });
  }
}
