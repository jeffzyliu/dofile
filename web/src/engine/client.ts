// The transport: the page's side of the engine worker (worker.ts), and the build's start files before a worker exists.
// It decides nothing: the controller (app/engine.ts) calls it when the state machine says. One worker is live at a
// time; `n` is that worker's ticket, which the transport only compares.

import { failPart, landPart, PART_HEADER, partReason, partRegion, readOwnPart, retryPart } from "./lazy-part.ts";
import type { Ending, Reply } from "./machine.ts";
import type { SeqRegion } from "./seqlock.ts";
import { isStorageRefusal, openCache } from "./snapshot.ts";
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
 *  never fetched twice. `region`: what the page writes and the worker reads (pending, landed or failed, the copy, the
 *  bytes or the reason), or null without cross-origin isolation (then it is a start file, download(), which the worker
 *  writes at boot); `sab`, its buffer, only for boot's arguments. The other fields are the page's own: the worker needs
 *  none of them. */
type GraphicsPart = {
  built: number;
  file: SnapshotFile;
  url: string;
  heapURL: string;
  sab: SharedArrayBuffer | null;
  region: SeqRegion | null;
  fetch: PartFetch | null; // the fetch on its way: at most one
  fresh: boolean; // the worker found a copy damaged: fetched past the HTTP cache until a copy lands
  damagedCopy: number | null; // the copy the last `damaged` named (the region's then); never cleared: copies only grow
  listening: boolean; // the part's one `online` listener is set
};
/** The graphics part's fetch on its way: whether the Cache missed and it downloads, and the bytes received so far. */
type PartFetch = { downloading: boolean; received: number };
/** The part's progress for the status bar, from the region and the page's fetch; nothing stores it. Pending is shown as
 *  fetching while the fetch downloads; without a region (a start file) it stays pending. */
function graphicsProgress(part: GraphicsPart): GraphicsProgress {
  const total = part.file.size;
  const now = part.region && readOwnPart(part.region);
  if (now?.state === "landed") return { state: "landed", received: total, total };
  if (now?.state === "failed") return { state: "failed", received: 0, total, error: now.reason };
  return { state: part.fetch?.downloading ? "fetching" : "pending", received: part.fetch?.received ?? 0, total };
}
/** A call waiting for the worker's answer. */
type Pending = { resolve: (value: any) => void; reject: (error: ClientError) => void; onLog?: (text: string) => void };
/** What a start learnt, once it is complete: what boot answered, where its time went (worker.ts, `startup`), and why
 *  the worker could not copy the files, if it could not. */
type Facts = { about: About; startup: Startup; storeError: Startup["storeError"] | null };
/** The live worker's record: its number, its calls, its interrupt buffer, its start's facts. `ended`: what end()
 *  rejected its calls with. */
type Live = {
  n: number;
  worker: Worker;
  pending: Map<number, Pending>;
  interrupt: Int32Array<SharedArrayBuffer> | null;
  run: object | null; // the run sent last, until it answers
  facts: Facts | null; // null until its start is complete
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
function reasonOf({ name, type }: { name?: string; type?: string }): "download" | "memory" | "unknown" {
  if (name === "DownloadError") return "download";
  // a PythonError is every Python exception: its class is `type`
  if (name === "RangeError" || type === "MemoryError") return "memory";
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
  }

  /** The live worker, or null. */
  get worker(): Worker | null {
    return this.#live?.worker ?? null;
  }

  // The live worker's facts (Facts), for the tests and the test hook; nothing decides by them. Null with no live worker
  // or before its start is complete.
  get about(): About | null {
    return this.#live?.facts?.about ?? null;
  }
  get startup(): Startup | null {
    return this.#live?.facts?.startup ?? null;
  }
  get storeError(): Startup["storeError"] | null {
    return this.#live?.facts?.storeError ?? null;
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
      // without a shared buffer the graphics part is a start file too (download())
      const part = list.snapshot && this.#graphicsOf({ built: list.built, files: list.snapshot });
      return !part || Boolean(part.region) || Boolean(await cache.match(part.url));
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
    // the files below, not the page's own (here already). With a shared buffer the graphics part follows the start: its
    // progress is said here first so that the dialog can show its size. Without one it is a start file, which the
    // worker writes at boot.
    const part = this.#graphicsOf(build);
    if (part?.region) this.#showGraphics(part);
    const files = list.files.filter((f) => f.download);
    if (part && !part.region)
      files.push({ path: part.url, size: part.file.size, compressed: part.file.size, download: true });
    const total = list.download - (part?.region ? part.file.size : 0);
    const got = new Map<StartFile, number>();
    let received = 0;
    let last = -1;
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
    const stop = new AbortController();
    const abort = () => stop.abort(signal!.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort);
    const one = async (f: StartFile) => {
      const url = new URL(f.path, list.base).href;
      if (await cache.match(url)) return count(f, f.size); // kept from an earlier try
      // not an older build's file from the HTTP cache
      const res = await this.fetch(url, { signal: stop.signal, cache: "no-cache" });
      if (!res.ok) throw fail(`${url}: ${res.status}`, "failed", { reason: "download" });
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const reader = res.body!.getReader();
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
      await Promise.all(files.map((f) => one(f).catch(failed)));
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
  // busy in Python cannot advance a fetch of its own; without a SharedArrayBuffer it is a start file instead
  // (download()), which the worker writes at boot. The worker reads it from a SharedArrayBuffer, so a graph blocked in
  // Python sees it land. It is cached only beside start files that are cached already. A failed fetch is tried again
  // when a graph finds it failed, and when the browser is back online. The region is the one record of pending, landed
  // or failed, the copy and the reason; the page writes it only in #writePart, and the status bar's progress is read
  // from it. The page keeps the rest (the fetch on its way, `fresh`, `damagedCopy`) on the part.

  /** The part's progress, now and at each change. @returns the function that removes the listener */
  onGraphics(listener: (p: GraphicsProgress) => void): () => void {
    this.#graphicsListeners.add(listener);
    if (this.#graphics) listener(graphicsProgress(this.#graphics));
    return () => this.#graphicsListeners.delete(listener);
  }

  #graphicsOf(build: Build | null): GraphicsPart | null {
    const file = build?.files.graphics;
    if (!build || !file || !this.snapshot) return null;
    if (this.#graphics?.built !== build.built) {
      const at = (name: string) => new URL(`${this.snapshot}${name}`, globalThis.location?.href).href;
      const sab = typeof SharedArrayBuffer === "undefined" ? null : new SharedArrayBuffer(PART_HEADER + file.size);
      this.#graphics = {
        built: build.built,
        file,
        url: at(file.name),
        heapURL: at(build.files.snapshot.name),
        sab,
        region: sab && partRegion(sab),
        fetch: null,
        fresh: false,
        damagedCopy: null,
        listening: false,
      };
    }
    return this.#graphics;
  }

  // The listeners see the page's current part; an older build's part says nothing.
  #showGraphics(part: GraphicsPart) {
    if (this.#graphics !== part) return;
    const p = graphicsProgress(part);
    for (const f of this.#graphicsListeners) f(p);
  }

  // Every write of the region goes through here: then the live worker is told to look at it (the op `graphics`), and
  // the listeners see it.
  #writePart(part: GraphicsPart, write: () => void) {
    write();
    const live = this.#live;
    if (live && !live.ended) this.#send(live, "graphics", undefined).catch(() => {});
    this.#showGraphics(part);
  }

  // Fetch the first copy (the Cache first) unless one is on its way or the region says it landed or failed. Not
  // without a region: then it is a start file.
  #wantGraphics(build: Build | null): void {
    const part = this.#graphicsOf(build);
    const region = part?.region;
    if (!part || !region || part.fetch || readOwnPart(region).state !== "pending") return;
    void this.#fetchGraphics(part, region);
  }

  // A part that failed is fetched again; the worker sees it pending, and a waiting graph waits for it. Failed has no
  // fetch on its way: a fetch ends in the same step as its write.
  #retryGraphics(part: GraphicsPart): void {
    const region = this.#graphics === part ? part.region : null;
    if (!region || readOwnPart(region).state !== "failed") return;
    this.#refetch(part, region);
  }

  // One copy more: the region pending, and a fetch.
  #refetch(part: GraphicsPart, region: SeqRegion): void {
    this.#writePart(part, () => retryPart(region));
    void this.#fetchGraphics(part, region);
  }

  // A part the worker could not unpack: dropped from the Cache (a reload would read it again) and fetched again. The
  // copy fetched right after a damaged copy is damaged too: the part fails instead, and only a graph's `again` or the
  // browser back online fetches it again (the worker's damage is tied to its copy, so without this a part that fails on
  // every copy would be fetched and unpacked in a loop).
  #refetchDamaged(part: GraphicsPart): void {
    const region = this.#graphics === part ? part.region : null;
    const now = region && readOwnPart(region);
    if (!region || now?.state !== "landed") return;
    const again = part.damagedCopy !== null && now.copy === part.damagedCopy + 1;
    part.damagedCopy = now.copy;
    part.fresh = true;
    if (!again) {
      this.#refetch(part, region); // its fetch drops the copy from the Cache first
      return;
    }
    const why = "the graphics files arrived damaged twice in a row; they are fetched again for the next graph";
    void this.#uncache(part); // a reload would read it again
    console.warn(`[dofile] graphics part: ${why}`);
    this.#writePart(part, () => failPart(region, partReason(why)));
    this.#listenOnline(part);
  }

  // Deletes the part's copy from the Cache; a Cache that cannot be opened has none to delete.
  async #uncache(part: GraphicsPart): Promise<void> {
    if (!this.caches || part.url.startsWith("file:")) return;
    try {
      await (await openCache(this.caches, part.built)).delete(part.url);
    } catch {}
  }

  // The fetch on its way: the Cache, else a download (past the HTTP cache when `fresh`); then the region written landed
  // or failed, in the same step as the fetch ends.
  async #fetchGraphics(part: GraphicsPart, region: SeqRegion): Promise<void> {
    const fetch: PartFetch = { downloading: false, received: 0 };
    part.fetch = fetch;
    const fresh = part.fresh;
    const t0 = performance.now();
    let cache: Cache | null = null;
    try {
      if (this.caches && !part.url.startsWith("file:")) cache = await openCache(this.caches, part.built);
    } catch (e: any) {
      if (!isStorageRefusal(e)) console.warn(`[dofile] graphics part: no Cache (${e?.message ?? e})`);
    }
    let hit: Response | undefined;
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    let why = "";
    try {
      if (fresh) await cache?.delete(part.url).catch(() => {}); // damaged: not read again, now or after a reload
      hit = await cache?.match(part.url);
      if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
      else {
        fetch.downloading = true;
        this.#showGraphics(part);
        bytes = await this.#downloadGraphics(part, fetch, fresh);
        if (cache && (await cache.match(part.heapURL)))
          await cache
            .put(part.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }))
            .catch((e: any) => console.warn(`[dofile] graphics part not cached: ${e?.name}: ${e?.message}`));
      }
      if (bytes.length !== part.file.size)
        throw new Error(`${part.url}: ${bytes.length} bytes arrived, the build's list says ${part.file.size}`);
    } catch (e: any) {
      why = `the graphics files could not be downloaded (${e?.message ?? e}); they are fetched again for the next graph`;
    }
    part.fetch = null;
    if (!why && bytes) {
      const landed = bytes;
      part.fresh = false;
      console.info(
        `[dofile] graphics part: landed (${hit ? "cache" : "network"}) ${((performance.now() - t0) / 1000).toFixed(2)}s, ${landed.length} bytes`,
      );
      this.#writePart(part, () => landPart(region, landed));
      return;
    }
    console.warn(`[dofile] graphics part: ${why}`);
    this.#writePart(part, () => failPart(region, partReason(why)));
    this.#listenOnline(part);
  }

  // A failed part is fetched again when the browser is back online: one listener per part, however often it fails.
  #listenOnline(part: GraphicsPart): void {
    if (part.listening || !globalThis.addEventListener) return;
    part.listening = true;
    globalThis.addEventListener(
      "online",
      () => {
        part.listening = false;
        this.#retryGraphics(part);
      },
      { once: true },
    );
  }

  async #downloadGraphics(part: GraphicsPart, fetch: PartFetch, fresh: boolean): Promise<Uint8Array<ArrayBuffer>> {
    if (part.url.startsWith("file:")) {
      const fsName = "node:fs/promises"; // Node only (the tests); a variable so the bundler leaves it alone
      return new Uint8Array(await (await import(/* @vite-ignore */ fsName)).readFile(new URL(part.url)));
    }
    // not an older build's part from the HTTP cache; after damage not even a revalidated one (a 304 would hand back the
    // same bytes)
    const res = await this.fetch(part.url, { cache: fresh ? "reload" : "no-cache" });
    if (!res.ok) throw new Error(`${part.url}: ${res.status}`);
    const out = new Uint8Array(part.file.size);
    const reader = res.body!.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > out.length) throw new Error(`${part.url}: more bytes than the build's list says`);
      out.set(value, n);
      n += value.length;
      fetch.received = n;
      this.#showGraphics(part);
    }
    return out.subarray(0, n);
  }

  // A graph found the part failed ("again") or damaged. Only with a shared buffer: without one boot wrote the part.
  #workerSaysGraphics(part: GraphicsPart, m: Extract<FromWorker, { graphics: string }>) {
    if (m.graphics === "damaged") this.#refetchDamaged(part);
    else this.#retryGraphics(part);
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
      facts: null,
      ended: null,
      interrupt: typeof SharedArrayBuffer === "undefined" ? null : new Int32Array(new SharedArrayBuffer(4)),
      run: null,
    };
    this.#live = live;
    // A stage or an error of an ended worker is still said: its reply carries that worker's ticket, and the machine
    // drops what is out of date.
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      if ("stage" in data) return reply({ type: "stage", stage: data.stage });
      if ("folderError" in data)
        return reply({ type: "crashed", cause: "folder", reason: "unknown", detail: data.folderError });
      if ("graphics" in data) {
        // an ended worker's `again` or `damaged` was about its own graphs: dropped
        if (this.#live === live && this.#graphics) this.#workerSaysGraphics(this.#graphics, data);
        return;
      }
      const p = live.pending.get(data.id);
      if (!p) return;
      if ("log" in data) return p.onLog?.(data.log); // a chunk of a running run's log: the call stays pending
      live.pending.delete(data.id);
      if ("error" in data)
        p.reject(fail(data.error, "op", { name: data.name ?? "Error", ...(data.type && { type: data.type }) }));
      else p.resolve(data.result);
    };
    worker.onerror = (e: any) => {
      const what = String(e?.message ?? e);
      // an ErrorEvent holds the thrown value in `error`; a test or another browser may hand over the value itself
      const thrown = e?.error ?? e;
      reply({
        type: "crashed",
        cause: "error",
        reason: reasonOf({ name: thrown?.name, type: thrown?.type }),
        detail: what,
      });
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
        live.facts = { about, startup, storeError };
        reply(storeError ? { type: "started", storeFailed: storeError.cause } : { type: "started" });
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
  async run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void): Promise<RunResult> {
    const live = this.#live;
    if (live?.n !== n) return Promise.reject(fail("the engine is not running", "no-engine"));
    // a Break from before this run was the run before's; one from now on is this run's, however long it waits in the
    // worker's queue (the worker lets Python read the buffer only during a run)
    if (live.interrupt) Atomics.store(live.interrupt, 0, 0);
    const run = {};
    live.run = run;
    const sent = this.#send(live, "run", args, onLog);
    const done = () => {
      if (live.run === run) live.run = null;
    };
    sent.then(done, done);
    return sent;
  }

  /** Break: SIGINT in the shared buffer stops the run sent last at its next safe point (`run()` clears it).
   *  Without a SharedArrayBuffer it does nothing: the machine resets instead. */
  interrupt(n: number): void {
    const live = this.#live;
    if (live?.n !== n || !live.interrupt) return;
    const buffer = live.interrupt;
    const run = live.run;
    Atomics.store(buffer, 0, 2); // SIGINT
    if (!run) return;
    // Pyodide reads the buffer, then writes 0, in two steps: a store between them is lost (in Node, 8 of 2350; WebKit's
    // Break test lost about 1 in 100). So it is written again until the run answers; then run()'s clear decides for the
    // next run. A repeat after Python took the Break only sets the engine's flag again (cleared when a run starts), or
    // is put back and cleared with the buffer (browser.py).
    const again = setInterval(() => {
      if (this.#live !== live || live.run !== run) clearInterval(again);
      else Atomics.store(buffer, 0, 2);
    }, 100);
  }

  // ---- Reader ----

  /** While the worker starts or runs, the call waits in its queue. Rejects with kind "no-engine" with no live worker,
   *  or with the ending's kind when its worker is ended first. */
  async query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
    if (!this.#live) return Promise.reject(fail("the engine is not running", "no-engine"));
    return this.#send(this.#live, op, args);
  }

  // The one place the worker is posted to. On an ended record a call rejects at once with what end() said.
  async #send<K extends Op>(
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
