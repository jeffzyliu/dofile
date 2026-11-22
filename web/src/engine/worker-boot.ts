// The worker's start: Python from the snapshot (or `?snapshot=0`'s normal boot) for `mount`, then the wheels and the
// engine for `boot`. Given what it needs; it posts nothing (worker.ts's `stage` does) and holds no state.

import type { BrotliWasmType } from "brotli-wasm";
import { loadPyodide } from "pyodide";
import { MIB } from "./memcap.ts";
import type { CreateModule, SnapshotPy } from "./snapshot.ts";
import {
  hasNativeBrotli,
  isStorageRefusal,
  openCache,
  patchHeapMax,
  restoreOptions,
  unpackAsync,
  withHeapCap,
} from "./snapshot.ts";
import type { BootArgs, MountArgs, SnapshotFile, SnapshotFiles, Stage, Startup } from "./types.ts";
import { ROOT } from "./work-mirror.ts";

/** dofile.browser (src/dofile/browser.py): JSON text in and out. */
export interface Browser {
  start(root: string): string;
  keep_breaks(putBack: () => void): void;
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
type StageOf = (id: Stage) => void;
/** A lazy snapshot's graphics part, as `boot` was given it. */
export type GraphicsArgs = NonNullable<BootArgs["graphics"]>;

export const since = (t: number) => (performance.now() - t) / 1000; // seconds
export const failedDownload = (message: string) => Object.assign(new Error(message), { name: "DownloadError" });

// Reads `url`: a file: URL from disk (Node, the tests); otherwise from `cache` first, then the network. The worker
// never writes the Cache: download() in client.ts keeps only a file with the byte count of the build's list (a host
// that answers a missing file with its index.html and status 200 must not end up in it).
export async function fetchBytes(url: string, cache?: Cache, init?: RequestInit): Promise<Uint8Array<ArrayBuffer>> {
  if (url.startsWith("file:")) {
    const fsName = "node:fs/promises"; // a variable so the bundler leaves it alone
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

// The Cache of this build's start files (openCache). A refusal (private mode, blocked storage) is reported; any other
// error is thrown.
export async function snapshotCache(built: number, refused: (e: any) => void): Promise<Cache | undefined> {
  if (typeof caches === "undefined") {
    refused(Object.assign(new Error("there is no Cache API here (not a secure context?)"), { name: "NoCacheAPI" }));
    return undefined;
  }
  try {
    return await openCache(caches, built);
  } catch (e) {
    refused(e);
    return undefined;
  }
}

// Browsers compile a .wasm as it arrives only with this Content-Type.
export function asWasm(res: Response, url: string): Response {
  if (!url.split("?")[0].endsWith(".wasm") || res.headers.get("Content-Type") === "application/wasm") return res;
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/wasm" } });
}

// Pyodide's loader has no option to be given the .wasm's bytes, so while the engine starts every GET in this worker
// goes through here: it looks in `cache` first (a miss goes to the network and is not stored), and a fetch that fails
// rejects `failed`, because Pyodide's loader only logs a failed .wasm and then waits for ever. `restore()` puts the
// real fetch back.
export function watchFetch({ cache }: { cache?: Cache } = {}): { failed: Promise<never>; restore: () => void } {
  const real = globalThis.fetch;
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_, err) => {
    fail = err;
  });
  failed.catch(() => {});
  globalThis.fetch = async (input: any, init?: RequestInit) => {
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
      globalThis.fetch = real;
    },
  };
}

// In a browser the patched loader is imported from the cached bytes (a blob: URL), so the start does not fetch it
// twice; if the browser will not import that, from its own URL.
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

// The `?snapshot=0` boot's loader with the heap cap (snapshot.ts, HEAP_MAX). Used only when there is a cap.
export async function importCapped(indexURL: string | undefined, bytes: number): Promise<CreateModule> {
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

// In Node (the tests) the package's own entry is the one that works: the browser entry fetches its wasm by URL, which
// Node's fetch cannot do for files.
async function loadBrotli(): Promise<BrotliWasmType> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const mod = "node:module"; // a variable so the bundler leaves it alone
    return (await import(/* @vite-ignore */ mod)).createRequire(import.meta.url)("brotli-wasm");
  }
  return (await import("brotli-wasm")).default;
}

// `built` and `files` come from the build's list (start-files.json), which the page already checked against its own
// build.
async function loadFromSnapshot(
  base: string,
  built: number,
  files: SnapshotFiles,
  indexURL: string | undefined,
  io: Io,
  brotliMode: string | undefined,
  capBytes: number,
  stage: StageOf,
) {
  const t0 = performance.now();
  let last = t0;
  const laps: string[] = [],
    secs: [string, number][] = []; // laps: text for the console; secs: [name, seconds] for the page's summary
  const notCached: string[] = []; // why there is no Cache to read, if there is none
  const isFile = base.startsWith("file:"); // Node, the tests: no Cache API by design
  const refused = (e: any, url?: string) => {
    if (!isStorageRefusal(e)) throw e; // a bug, not the browser saying no
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
  stage("download"); // also names reading from the cache
  const { snapshot: snapFile, bundle: bundleFile } = files;
  const cache = isFile ? undefined : await snapshotCache(built, refused);
  const hadCache = Boolean(cache) && Boolean(await cache!.match(`${base}${snapFile.name}`));
  const fetches = isFile ? { failed: new Promise(() => {}), restore() {} } : watchFetch({ cache });
  try {
    // The two big files are cached compressed (about 42 MB, not 229) and decompressed here.
    const [snapPacked, dso, index, bundlePacked, create, brotli] = await Promise.all([
      fetchBytes(`${base}${snapFile.name}`, cache),
      fetchJSON(`${base}dso.json`, cache),
      fetchJSON(`${base}files.json`, cache),
      fetchBytes(`${base}${bundleFile.name}`, cache),
      importLoader(`${base}pyodide.asm.patched.mjs`, cache, isFile, built),
      loadBrotli(),
    ]);
    lap(hadCache ? "read from cache" : "download");
    stage("unpack");
    // The browser's own brotli decoder when it has one (brotli-wasm took 25 s for the 229 MB on an iPhone);
    // `?brotli=wasm` forces brotli-wasm. Node keeps the wasm decoder, so the tests run what the build checks.
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
        // a damaged or wrong file: the next start fetches it again
        await cache?.delete(`${base}${file.name}`).catch(() => {});
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
    // The first lap is the download (or cache read), "decompress" is the unpack, every lap after it is the restore.
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
    return { loaded, summary, brotli };
  } finally {
    fetches.restore();
  }
}

/** The `mount` op's Python: from the snapshot when `snapshot` is given, else the normal boot. Writes where the time
 *  went into `startup` once Python is there.
 *  @returns Pyodide, and brotli-wasm (null on the normal boot), which the graphics part's unpack needs */
export async function startPython(
  { indexURL, snapshot, built, files, brotli, memcap }: MountArgs,
  stage: StageOf,
  startup: Partial<Startup>,
): Promise<{ py: SnapshotPy; brotli: BrotliWasmType | null }> {
  if (!snapshot) stage("python"); // a snapshot start names its own steps (loadFromSnapshot)
  const io: Io = { stdout: (l) => console.log(l), stderr: (l) => console.warn(l) };
  const tRuntime = performance.now();
  const capBytes = (memcap ?? 0) * MIB;
  if (snapshot) {
    const {
      loaded,
      summary,
      brotli: wasm,
    } = await loadFromSnapshot(snapshot, built, files, indexURL, io, brotli, capBytes, stage);
    Object.assign(startup, { mode: "snapshot", ...summary });
    return { py: loaded, brotli: wasm };
  }
  const fetches = watchFetch(); // a failed fetch ends the start with its error
  let py: SnapshotPy;
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
  return { py, brotli: null };
}

/** The `boot` op's work: the wheels (the normal boot only: a snapshot has them), then dofile.browser in /work. Writes
 *  where the time went into `startup`.
 *  @param lazyGraphics - called with the engine when the build has a lazy graphics part, before `boot` answers
 *  @returns the engine and what it says about itself (`About`, as JSON) */
export async function startEngine(
  py: SnapshotPy,
  { wheel, extraWheels = [], interruptBuffer, graphics }: BootArgs,
  {
    fromSnapshot,
    stage,
    startup,
    lazyGraphics,
  }: {
    fromSnapshot: boolean;
    stage: StageOf;
    startup: Partial<Startup>;
    lazyGraphics: (browser: Browser, part: GraphicsArgs) => void;
  },
): Promise<{ browser: Browser; about: unknown }> {
  const tPackages = performance.now();
  if (!fromSnapshot) {
    stage("packages");
    // No pandas: only export sasxport needs it (about 5 MB more to download and 2 s on a cold start,
    // docs/pyodide-snapshot.md, "Packages added"), so that command is not available here.
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
  if (!fromSnapshot) startup.packagesS = since(tPackages);
  stage("engine");
  const tEngine = performance.now();
  const browser: Browser = py.pyimport("dofile.browser");
  const about = JSON.parse(browser.start(ROOT));
  const buffer = interruptBuffer ?? null;
  if (buffer) browser.keep_breaks(() => Atomics.store(buffer, 0, 2));
  if (graphics) lazyGraphics(browser, graphics); // a lazy snapshot: nothing else of the part before `startup`
  startup.engineS = since(tEngine);
  return { browser, about };
}
