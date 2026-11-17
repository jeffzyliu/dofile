// The transport: the page's side of the engine worker (worker.ts), and the build's start files before a worker exists.
// It decides nothing: the controller (app/engine.ts) calls it when the state machine says. One worker is live at a
// time; `n` is that worker's ticket, which the transport only compares.

import type { Ending, Reply } from "./machine.ts";
import { isStorageRefusal, openCache, PART_HEADER } from "./snapshot.ts";
import type { FileStore } from "./store.ts";
import type {
  About,
  Build,
  ClientError,
  Downloaded,
  FromWorker,
  GraphicsProgress,
  MountArgs,
  Op,
  Ops,
  Progress,
  ReadOps,
  RunResult,
  SnapshotFile,
  StartFiles,
  Startup,
  Wheel,
} from "./types.ts";

/** One file of the build's list of start files. */
type StartFile = StartFiles["files"][number];
/** A lazy snapshot's graphics part: one per build for the page's life, so a restarted worker gets the same and it is
 *  never fetched twice. `sab`: what the worker reads, or null without cross-origin isolation (then the worker fetches
 *  it). */
type GraphicsPart = {
  built: number;
  file: SnapshotFile;
  url: string;
  heapURL: string;
  sab: SharedArrayBuffer | null;
  loading: Promise<void> | null;
  progress: GraphicsProgress;
  damaged: boolean; // the worker found the last copy damaged: fetched past the HTTP cache until a copy lands
};
/** A call waiting for the worker's answer. */
type Pending = { resolve: (value: any) => void; reject: (error: ClientError) => void; onLog?: (text: string) => void };
/** The live worker's record: its number, its calls, its interrupt buffer. `ended`: what end() rejected its calls
 *  with. */
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
  onGraphics?(listener: (p: GraphicsProgress) => void): () => void; // the tests' fakes have none
}

const fail = (message: string, kind: ClientError["kind"], more: Partial<ClientError> = {}): ClientError =>
  Object.assign(new Error(message), { kind, ...more });
/** An AbortError, whatever reason the caller aborted with. */
const aborted = (signal: AbortSignal) =>
  signal.reason?.name === "AbortError"
    ? signal.reason
    : new DOMException(String(signal.reason?.message ?? signal.reason ?? "aborted"), "AbortError");

/** Delete every entry of `cache` that is not one of the list's download files at its address (relative to the list).
 *  Never rejects. */
async function dropUnlisted(cache: Cache, list: StartFiles & { base: string }): Promise<void> {
  const keep = new Set(list.files.filter((f) => f.download).map((f) => new URL(f.path, list.base).href));
  // the graphics part is no start file, but #fetchGraphics keeps it in this Cache
  const graphics = list.snapshot?.graphics;
  if (graphics) keep.add(new URL(`snapshot/${graphics.name}`, list.base).href);
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
  declare memcap: number | undefined;
  declare store: Pick<FileStore, "attach"> | null;
  declare startFiles: string | (StartFiles & { base?: string }) | undefined;
  declare fetch: typeof globalThis.fetch;
  declare caches: CacheStorage | null | undefined;
  declare wasm: object | null | undefined;
  declare nextId: number;
  // facts of the last start, for the tests and the test hook; nothing decides by them
  declare storeError: { name: string; message: string } | null;
  declare about: About | null;
  declare startup: Startup | null;
  #live: Live | null = null;
  #graphics: GraphicsPart | null = null;
  #graphicsListeners = new Set<(p: GraphicsProgress) => void>();

  /**
   * @param snapshot - the URL (ending in "/") of a snapshot from scripts/make-snapshot.ts; a snapshot start needs
   * startFiles.
   * @param brotli - "wasm" forces brotli-wasm over the browser's own decoder.
   * @param memcap - the cap on the engine's WebAssembly heap, in MiB (memcap.ts); none: no cap.
   * @param extraWheels - wheels installed after the dofile one (web/wheels/).
   * @param buildId - the page's build id (scripts/build-id.ts); a list of start files with another id is refused
   * (checkBuild).
   * @param store - while a worker is live, it tells the worker of each change the page makes.
   * @param startFiles - the URL of start-files.json, or the list itself; download(), build() and cached() need it.
   */
  constructor({
    createWorker,
    wheel,
    extraWheels = [],
    buildId,
    indexURL,
    snapshot,
    brotli,
    memcap,
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
    memcap?: number;
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
      memcap,
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

  // ---- Builds ----

  /** The build's list of start files. `base` is the list's own URL, which the files' paths are relative to. A list that
   *  cannot be fetched or read (offline, a host's error page) rejects with kind "failed", reason "download". */
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

  /** The one comparison of the page's build with the list's. A list of another build throws kind "updated": the site
   *  was deployed again since the page loaded, or in development the snapshot is stale or the dev server restarted. A
   *  page without a build id (some Node tests) skips it. */
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

  /** What `mount` needs of a list. A list of another build is "updated" whatever it lacks; a build with no snapshot is
   *  kind "failed", reason "unknown". */
  #buildOf(list: StartFiles): Build {
    const none = () =>
      fail("no snapshot in this build: run `npm run snapshot` in web/", "failed", { reason: "unknown" });
    if (!list.built) throw none();
    this.checkBuild(list);
    if (!list.snapshot) throw none();
    return { built: list.built, files: list.snapshot };
  }

  /** The build's list, fetched fresh and checked; null for the normal start (?snapshot=0). Every restart fetches it
   *  again: the Cache may have been evicted since the first start, and the worker would then fetch whatever build the
   *  site has now. */
  async build(): Promise<Build | null> {
    if (!this.snapshot) return null;
    return this.#buildOf(await this.startList());
  }

  /** Whether the Cache holds every file the list marks `download`, so the page can start without asking. False when it
   *  cannot tell (no snapshot start, no Cache API, the list does not arrive, offline). Never rejects or writes. */
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

  /** Delete every `dofile-snapshot-*` Cache, so the next page load downloads the start files fresh (after a start
   *  failed twice for a reason the files may be at fault for). Never rejects. */
  async forgetDownload(): Promise<void> {
    try {
      for (const name of (await this.caches?.keys()) ?? [])
        if (name.startsWith("dofile-snapshot-")) await this.caches!.delete(name);
    } catch (e: any) {
      console.warn(`[dofile] could not delete the downloaded start files: ${e?.message ?? e}`);
    }
  }

  /** Fetch the start files into the Cache the worker reads, before a worker exists. A file already cached is not
   *  fetched again, so a second try resumes by file. A file that does not arrive whole is not kept. Rejects with an
   *  AbortError when `signal` aborts; kind "failed", reason "download" for a missing file or one of the wrong size;
   *  "updated" for another build's list; kind "failed", reason "unknown" for a Cache that breaks other than by refusing
   *  storage.
   *  @param onProgress - counts bytes as a host sends them (compressed): each file's decoded bytes are scaled to its
   *  compressed size, and the files that came with the page count as received from the start.
   *  @returns `cached: false` when there is nothing to fill (no snapshot start, no Cache API, storage refused): the
   *  worker then downloads by itself, uncounted. */
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
    // Entries the list does not name are the same build's files at another address (the editor moved, the snapshot
    // did not): nothing reads them again, and they keep tens of MB. Skipped while a worker is live, which may be
    // reading this Cache.
    if (!this.#live) await dropUnlisted(cache, list);
    // the files below, not the page's own (here already) nor the graphics part, which follows the start; its progress
    // is said here first so that the dialog can show its size
    const part = this.#graphicsOf(build);
    if (part) this.#graphicsSay(part, {});
    const total = list.download - (list.snapshot?.graphics?.size ?? 0),
      got = new Map<StartFile, number>();
    let received = 0,
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
      // not an older build's file from the HTTP cache
      const res = await this.fetch(url, { signal: stop.signal, cache: "no-cache" });
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
      // the browser would not keep a file
      if (isStorageRefusal(e)) return { cached: false, why: `${e.name}: ${e.message}`, build };
      throw e;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    this.#wantGraphics(build); // after the start files: "ready" does not wait for it
    return { cached: true, received, total, build };
  }

  // ---- a lazy snapshot's graphics part (docs/lazy-matplotlib.md) ----
  // matplotlib is one more file (build.files.graphics). The page fetches it at the end of download(), because a worker
  // busy in Python cannot advance a fetch of its own; without a SharedArrayBuffer the worker fetches it
  // (#workerSaysGraphics). The worker reads it from a SharedArrayBuffer, so a graph blocked in Python sees it land. It
  // is cached only beside start files that are cached already. A failed fetch is tried again when a graph finds it
  // failed, and when the browser is back online.

  /** The part's progress, now and at each change. @returns the function that removes the listener */
  onGraphics(listener: (p: GraphicsProgress) => void): () => void {
    this.#graphicsListeners.add(listener);
    if (this.#graphics) listener(this.#graphics.progress);
    return () => this.#graphicsListeners.delete(listener);
  }

  #graphicsOf(build: Build | null): GraphicsPart | null {
    const file = build?.files.graphics;
    if (!build || !file || !this.snapshot) return null;
    if (this.#graphics?.built !== build.built) {
      const at = (name: string) => new URL(`${this.snapshot}${name}`, globalThis.location?.href).href;
      this.#graphics = {
        built: build.built,
        file,
        url: at(file.name),
        heapURL: at(build.files.snapshot.name),
        sab: typeof SharedArrayBuffer === "undefined" ? null : new SharedArrayBuffer(PART_HEADER + file.size),
        loading: null,
        progress: { state: "pending", received: 0, total: file.size },
        damaged: false,
      };
    }
    return this.#graphics;
  }

  #graphicsSay(part: GraphicsPart, p: Partial<GraphicsProgress>) {
    part.progress = { ...part.progress, ...p };
    for (const f of this.#graphicsListeners) f(part.progress);
  }

  // Fetch the part (the Cache first), unless it is here, failed, on its way, or the worker's to fetch.
  #wantGraphics(build: Build | null): void {
    const part = this.#graphicsOf(build);
    if (!part?.sab || part.loading || part.progress.state === "landed" || part.progress.state === "failed") return;
    part.loading = this.#fetchGraphics(part).finally(() => {
      part.loading = null;
    });
  }

  // A part that failed is fetched again; the worker sees it pending, and a waiting graph waits for it.
  #retryGraphics(part: GraphicsPart): void {
    if (this.#graphics !== part || !part.sab || part.progress.state !== "failed" || part.loading) return;
    const hdr = new Int32Array(part.sab, 0, 4);
    Atomics.store(hdr, 1, 0);
    Atomics.add(hdr, 2, 1); // tries: a graph that asked takes the next failure as final
    Atomics.store(hdr, 0, 0); // pending
    Atomics.notify(hdr, 0);
    this.#graphicsSay(part, { state: "pending", received: 0, error: undefined });
    this.#tellGraphics(part);
    part.loading = this.#fetchGraphics(part, part.damaged).finally(() => {
      part.loading = null;
    });
  }

  // A part the worker could not unpack: dropped from the Cache (a reload would read it again) and fetched again.
  #refetchDamaged(part: GraphicsPart): void {
    if (this.#graphics !== part || part.loading || part.progress.state !== "landed") return;
    part.progress = { ...part.progress, state: "failed" }; // so that #retryGraphics takes it
    part.damaged = true;
    this.#retryGraphics(part);
  }

  async #fetchGraphics(part: GraphicsPart, fresh = false): Promise<void> {
    const sab = part.sab!, // #wantGraphics and #retryGraphics take only a part with one
      t0 = performance.now();
    let cache: Cache | null = null;
    try {
      if (this.caches && !part.url.startsWith("file:")) cache = await openCache(this.caches, part.built);
    } catch (e: any) {
      if (!isStorageRefusal(e)) console.warn(`[dofile] graphics part: no Cache (${e?.message ?? e})`);
    }
    let hit: Response | undefined;
    try {
      if (fresh) await cache?.delete(part.url).catch(() => {}); // damaged: not read again, now or after a reload
      hit = await cache?.match(part.url);
      let bytes: Uint8Array<ArrayBuffer>;
      if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
      else {
        this.#graphicsSay(part, { state: "fetching" });
        bytes = await this.#downloadGraphics(part, fresh);
        if (cache && (await cache.match(part.heapURL)))
          await cache
            .put(part.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }))
            .catch((e: any) => console.warn(`[dofile] graphics part not cached: ${e?.name}: ${e?.message}`));
      }
      if (bytes.length !== part.file.size)
        throw new Error(`${part.url}: ${bytes.length} bytes arrived, the build's list says ${part.file.size}`);
      new Uint8Array(sab, PART_HEADER).set(bytes);
      const hdr = new Int32Array(sab, 0, 4);
      part.damaged = false;
      Atomics.store(hdr, 1, bytes.length);
      Atomics.store(hdr, 0, 1); // landed
      Atomics.notify(hdr, 0);
      console.info(
        `[dofile] graphics part: landed (${hit ? "cache" : "network"}) ${((performance.now() - t0) / 1000).toFixed(2)}s, ${bytes.length} bytes`,
      );
      this.#graphicsSay(part, { state: "landed", received: part.file.size });
    } catch (e: any) {
      const why = `the graphics files could not be downloaded (${e?.message ?? e}); they are fetched again for the next graph`;
      const text = new TextEncoder().encode(why).subarray(0, sab.byteLength - PART_HEADER),
        hdr = new Int32Array(sab, 0, 4);
      new Uint8Array(sab, PART_HEADER).set(text);
      Atomics.store(hdr, 1, text.length);
      Atomics.store(hdr, 0, 2); // failed
      Atomics.notify(hdr, 0);
      console.warn(`[dofile] graphics part: ${why}`);
      this.#graphicsSay(part, { state: "failed", error: why });
      // back online: fetch it again
      globalThis.addEventListener?.("online", () => this.#retryGraphics(part), { once: true });
    }
    this.#tellGraphics(part);
  }

  async #downloadGraphics(part: GraphicsPart, fresh: boolean): Promise<Uint8Array<ArrayBuffer>> {
    if (part.url.startsWith("file:")) {
      const fsName = "node:fs/promises"; // Node only (the tests); a variable so the bundler leaves it alone
      return new Uint8Array(await (await import(/* @vite-ignore */ fsName)).readFile(new URL(part.url)));
    }
    // not an older build's part from the HTTP cache; after damage not even a revalidated one (a 304 would hand back the
    // same bytes)
    const res = await this.fetch(part.url, { cache: fresh ? "reload" : "no-cache" });
    if (!res.ok) throw new Error(`${part.url}: ${res.status}`);
    const out = new Uint8Array(part.file.size),
      reader = res.body!.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > out.length) throw new Error(`${part.url}: more bytes than the build's list says`);
      out.set(value, n);
      n += value.length;
      this.#graphicsSay(part, { received: n });
    }
    return out.subarray(0, n);
  }

  // With a SharedArrayBuffer the worker says only that a graph found the part failed ("again") or damaged. Without one
  // its messages are the page's only news of the download; the page still writes the progress it shows.
  #workerSaysGraphics(part: GraphicsPart, m: Extract<FromWorker, { graphics: string }>) {
    if (part.sab) {
      if (m.graphics === "damaged") this.#refetchDamaged(part);
      else if (m.graphics === "again") this.#retryGraphics(part);
      return;
    }
    switch (m.graphics) {
      case "fetching":
        return this.#graphicsSay(part, { state: "fetching", received: 0, error: undefined });
      case "progress":
        return this.#graphicsSay(part, { state: "fetching", received: m.received });
      case "landed":
        return this.#graphicsSay(part, { state: "landed", received: part.file.size });
      case "failed":
        return this.#graphicsSay(part, { state: "failed", error: m.why });
      case "damaged": // the worker dropped its copy: nothing is on its way until a graph fetches it again
        return this.#graphicsSay(part, { state: "pending", received: 0 });
    }
  }

  // Tells the live worker that the part in the shared buffer landed, failed or is fetched again
  #tellGraphics(_part: GraphicsPart) {
    const live = this.#live;
    if (!live || live.ended) return;
    this.#send(live, "graphics", undefined).catch(() => {});
  }

  // ---- Lifecycle: only the effect performer calls these ----

  /** Make worker `n` and start the engine in it: mount, boot, startup. The worker exists when start() returns, so calls
   *  made right after it queue behind mount. A worker that failed is not ended here: the machine ends it. Throws while
   *  another worker is live.
   *  @param build - what `mount` needs (null: the normal start); nothing is fetched first.
   *  @param reply - says `stage` as each begins, then `started`; `start-failed` with no WebAssembly, no worker, or a
   *  step that failed in the worker; `crashed` when the worker errors or the browser closes the file storage, at any
   *  time while it is live. */
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
    // A stage or an error of an ended worker is still said: its reply carries that worker's ticket, and the machine
    // drops what is out of date.
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      if ("stage" in data) return reply({ type: "stage", stage: data.stage });
      if ("folderError" in data)
        return reply({ type: "crashed", cause: "folder", reason: "unknown", detail: data.folderError });
      if ("graphics" in data) {
        if (this.#graphics) this.#workerSaysGraphics(this.#graphics, data);
        return;
      }
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
    // A sync that end() cuts loses nothing: its journal row stays, and the next worker copies the whole store. A
    // database the browser closes under the page ("Clear site data") may leave /work with files no row explains: that
    // is `crashed`, cause "storage", so that a new worker copies the store as it is. A sync the worker fails leaves
    // /work out of step with the store: cause "folder", for the same new copy.
    const sync = () => {
      this.#send(live, "sync", undefined).catch((e: ClientError) => {
        if (e.kind === "op") reply({ type: "crashed", cause: "folder", reason: "unknown", detail: e.message });
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
            memcap: this.memcap,
            snapshot: this.snapshot,
            built: build.built,
            files: build.files,
          }
        : { indexURL: this.indexURL, brotli: this.brotli, memcap: this.memcap };
    // Each step goes through this worker's own record, so one that resumes after end() rejects and reaches no other.
    const part = this.#graphicsOf(build);
    // no shared buffer: the part is this worker's own (a restarted worker has none), so not begun until it says
    if (part && !part.sab) this.#graphicsSay(part, { state: "pending", received: 0, error: undefined });
    const steps = async () => {
      await this.#send(live, "mount", mount);
      const about = await this.#send(live, "boot", {
        wheel: this.wheel,
        extraWheels: this.extraWheels,
        interruptBuffer: live.interrupt,
        ...(part && { graphics: { file: part.file, sab: part.sab } }),
      });
      const startup = await this.#send(live, "startup", undefined);
      return { about, startup };
    };
    steps().then(
      ({ about, startup }) => {
        if (live.ended) return; // ended just as its last step was answered: it says nothing more
        const storeError = startup?.storeError ?? null;
        // A worker with no store cannot read the journal: detach the store, so it writes no row no worker would clear.
        if (storeError) this.store?.attach(null);
        // a store of a newer version: another page of a newer build upgraded it, and only a reload helps
        if (storeError?.name === "VersionError")
          return reply({ type: "start-failed", reason: "updated", detail: storeError.message });
        this.about = about;
        this.startup = startup;
        this.storeError = storeError;
        reply(storeError ? { type: "started", storeFailed: true } : { type: "started" });
        this.#wantGraphics(build);
      },
      (e: ClientError) => {
        // "op": mount, boot or startup failed in the worker. Any other kind: the worker was ended, and whoever ended it
        // knows.
        if (e.kind === "op") reply({ type: "start-failed", reason: reasonOf(e), detail: e.message });
      },
    );
  }

  /** Terminate worker `n`, detach the store, and reject its pending calls with a ClientError of the ending's kind (the
   *  ending's `reason` is the message). With no live worker it does nothing (a start that failed before a worker
   *  existed); with another worker live it throws. */
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

  /** Rejects with kind "op" when the worker answered with an error (the worker stays), or the ending's kind when it was
   *  ended meanwhile.
   *  @param onLog - gets each chunk of the log as the run prints: a preview, which the result's `log` replaces. */
  run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void): Promise<RunResult> {
    const live = this.#live;
    if (live?.n !== n) return Promise.reject(fail("the engine is not running", "no-engine"));
    return this.#send(live, "run", args, onLog);
  }

  /** Break: SIGINT in the shared buffer stops the run at its next safe point (the worker clears it when a run starts).
   *  Without a SharedArrayBuffer it does nothing: the machine resets instead. */
  interrupt(n: number): void {
    const live = this.#live;
    if (live?.n === n && live.interrupt) Atomics.store(live.interrupt, 0, 2); // SIGINT
  }

  // ---- Reader ----

  /** While the worker starts or runs, the call waits in its queue. Rejects with kind "no-engine" with no live worker,
   *  or with the ending's kind when its worker is ended first. */
  query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
    if (!this.#live) return Promise.reject(fail("the engine is not running", "no-engine"));
    return this.#send(this.#live, op, args);
  }

  // The one place the worker is posted to. On an ended record a call rejects at once with what end() said.
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
