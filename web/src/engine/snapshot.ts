// Starts the engine from a Pyodide memory snapshot (built by `npm run snapshot`, scripts/make-snapshot.mjs;
// docs/pyodide-snapshot.md) instead of importing numpy, scipy, matplotlib and dofile. Runs in Node (the build script)
// and in worker.ts.

import type { BrotliWasmType } from "brotli-wasm";
import type { PyodideAPI, PyodideConfig } from "pyodide";
import type { SnapshotFile } from "./types.ts";

// Pyodide's Emscripten module, plus what its types leave out: patchAsm's library log and replay, and the loader's
// functions.
type PyodideModule = Awaited<ReturnType<NonNullable<PyodideConfig["createPyodideModule"]>>>;
/** One library load, as patchAsm's log records it (dso.json). */
export interface DsoRecord {
  libName: string;
  handle: number;
  memoryBase: number;
  memorySize: number;
  tableBase: number;
  global: boolean;
  nodelete: boolean;
  allowUndefined: boolean;
}
export type AsmModule = PyodideModule & {
  growMemory(size: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _sbrk(increment: number): number;
  dofileHeapMax?: number;
  loadDynamicLibrary(
    name: string,
    flags: { global: boolean; nodelete: boolean; allowUndefined: boolean },
    localScope: object | null,
  ): unknown;
  LDSO: PyodideModule["LDSO"] & { loadedLibsByHandle: Record<number, unknown> };
  __dsoLog?: DsoRecord[];
  __dsoReplay?: (DsoRecord & { used?: boolean })[] | null;
};
export type SnapshotPy = PyodideAPI & { _module: AsmModule };
export type CreateModule = (
  settings: Parameters<NonNullable<PyodideConfig["createPyodideModule"]>>[0],
) => Promise<AsmModule>;
/** Each file's path and size, in the order of the blob. */
export type BundleIndex = { path: string; size: number }[];

const ALLOC =
  "var memoryBase=metadata.memorySize?alignMemory(getMemory(metadata.memorySize+memAlign),memAlign):0;" +
  "var tableBase=metadata.tableSize?wasmTable.length:0;";
const ALLOC_PATCHED =
  "var __rec=Module.__dsoReplay&&Module.__dsoReplay.find(r=>!r.used&&r.libName===libName);" +
  "var memoryBase=__rec?(__rec.used=true,__rec.memoryBase):(metadata.memorySize?alignMemory(getMemory(metadata.memorySize+memAlign),memAlign):0);" +
  "var tableBase=metadata.tableSize?wasmTable.length:0;" +
  "if(__rec&&metadata.tableSize){if(tableBase>__rec.tableBase)console.warn('table drift',libName,tableBase,__rec.tableBase);" +
  "while(wasmTable.length<__rec.tableBase)wasmTable.grow(1);tableBase=wasmTable.length}" +
  "(Module.__dsoLog||=[]).push({libName,handle,memoryBase,memorySize:metadata.memorySize,tableBase," +
  "global:flags.global,nodelete:flags.nodelete,allowUndefined:flags.allowUndefined});";
const SKIPS = [
  [
    'var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs){',
    'var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs&&!__rec){',
  ],
  [
    'var init=moduleExports["__wasm_call_ctors"];if(init){',
    'var init=moduleExports["__wasm_call_ctors"];if(init&&!__rec){',
  ],
];

// The most the heap may grow to. This Pyodide creates its WebAssembly memory inside pyodide.asm.wasm (480 pages to 4
// GB), so no Emscripten option caps it; what can be capped is malloc's growth: the loader's emscripten_resize_heap
// refuses a request over getHeapMax(). A big allocation then fails inside Python (MemoryError, r(909)) instead of the
// browser killing the tab (iOS does not return a failed grow). `dofileHeapMax` (bytes) comes from the module's
// configuration; the snapshot's build sets none, so it keeps 4 GB. The restore's own growMemory() bypasses the cap, so
// the cap must leave room above the restored heap (130 MB).
const HEAP_MAX = ["getHeapMax=()=>4294901760", 'getHeapMax=()=>Module["dofileHeapMax"]??4294901760'] as const;

function replaceAll(src: string, pairs: readonly (readonly string[])[]): string {
  for (const [from, to] of pairs) {
    if (!src.includes(from))
      throw snapshotError("pyodide.asm.mjs is not the version the snapshot patch was written for");
    src = src.replace(from, to);
  }
  return src;
}

/** pyodide.asm.mjs's text with only the heap cap added (the `?snapshot=0` boot with a cap). */
export const patchHeapMax = (src: string): string => replaceAll(src, [HEAP_MAX]);

/** `create` with the heap capped at `bytes`. */
export const withHeapCap =
  (create: CreateModule, bytes: number): CreateModule =>
  (cfg) =>
    create(Object.assign(cfg, { dofileHeapMax: bytes }));

// A snapshot that cannot be used (damaged, cut short, made for another Pyodide). The page decides from the name.
const snapshotError = (message: string) => Object.assign(new Error(message), { name: "SnapshotError" });

/** pyodide.asm.mjs's text with the library log and the re-link added. Throws if Pyodide's loader looks different. */
export function patchAsm(src: string, { noTrampoline = false } = {}): string {
  return replaceAll(src, [[ALLOC, ALLOC_PATCHED], ...SKIPS, HEAP_MAX, ...(noTrampoline ? [NO_TRAMPOLINE] : [])]);
}

// Pyodide writes the pointer of a WebAssembly trampoline function into the Python runtime (in the heap) at start,
// except on iOS, where it writes 0 (getPyEMTrampolinePtr tests the user agent). A snapshot restores the heap of the
// machine that made it, so one made with the trampoline fails on an iPhone with "call_indirect to a signature that does
// not match". This makes the loader behave as on iOS everywhere, so one snapshot starts in every browser.
// SNAPSHOT_TRAMPOLINE=1 keeps Pyodide's choice. The build and the restore must use the same patched loader.
const NO_TRAMPOLINE = ["let isIOS=globalThis.navigator&&(", "let isIOS=true||globalThis.navigator&&("];

// Errors that mean the browser will not give us storage: full, blocked, private mode, or no Cache API. The engine can
// start without the cache. Any other Cache API error is a bug and is not swallowed.
const STORAGE_REFUSALS = new Set([
  "QuotaExceededError",
  "SecurityError",
  "NotAllowedError",
  "NoCacheAPI",
  "UnknownError",
]); // UnknownError: Chrome's damaged cache storage
export const isStorageRefusal = (e: any): boolean => STORAGE_REFUSALS.has(e?.name);

/** The Cache that holds one build's start files. A rebuild has a new `built`; the older builds' Caches are dropped. */
export async function openCache(caches: CacheStorage, built: number): Promise<Cache> {
  const name = `dofile-snapshot-${built}`;
  for (const other of await caches.keys())
    if (other.startsWith("dofile-snapshot-") && other !== name) await caches.delete(other);
  return caches.open(name);
}

// Making a snapshot: loadPyodide's options (makeOptions), then the snapshot itself (makeSnapshot). Two JS objects are
// still held after micropip's download of openpyxl (a fetch Response and its arrayBuffer method), and nothing uses them
// again, so the serializer stores them as null.
export const makeOptions = (create: CreateModule): PyodideConfig => ({
  _makeSnapshot: true,
  createPyodideModule: create,
});
export const makeSnapshot = (py: SnapshotPy): Uint8Array => {
  // Pyodide's check insists its loadedPackages object is still {}
  for (const k of Object.keys(py.loadedPackages)) delete py.loadedPackages[k];
  return py.makeMemorySnapshot({ serializer: () => null });
};

/**
 * Zeroes the heap copy of every library Python opened with dlopen, so it compresses to nothing (the snapshot carried
 * each twice: 30 MB, 4.4 MB compressed). Emscripten keeps the bytes in a buffer the library's handle points to (size at
 * handle+32, address at handle+28, path at handle+36); the site-packages bundle holds the same files, and the restore
 * links from the filesystem and never reads the buffers. A buffer that differs from its file is left alone. Every
 * handle is visited, not only the library log's: a library first loaded as another's dependency and then dlopened by
 * Pyodide's package loader (libopenblas) has a second handle with its own copy (6.5 MB raw, 1.3 MB compressed). Call it
 * before makeSnapshot.
 */
export function zeroLibraryCopies(py: SnapshotPy): { zeroed: number; bytes: number; kept: number } {
  const m = py._module;
  let zeroed = 0,
    bytes = 0,
    kept = 0;
  for (const key of Object.keys(m.LDSO.loadedLibsByHandle)) {
    const handle = Number(key); // handle 0 is the main module, which has no C struct
    if (!handle) continue;
    const ptr = m.HEAPU32[(handle + 28) >> 2],
      size = m.HEAPU32[(handle + 32) >> 2];
    if (!ptr || !size) continue;
    const file = m.FS.readFile(m.UTF8ToString(handle + 36, 4096)),
      copy = m.HEAPU8.subarray(ptr, ptr + size);
    let same = file.length === size;
    for (let i = 0; same && i < size; i++) if (file[i] !== copy[i]) same = false;
    if (same) {
      copy.fill(0);
      zeroed++;
      bytes += size;
    } else kept++;
  }
  return { zeroed, bytes, kept };
}

/**
 * Zeroes the heap's free memory so it compresses to nothing: malloc every free block (1 MB down to 16 bytes), zero them
 * all, free them all. Safe because only free memory is written (correct C never reads it; calloc clears its own) and
 * the frees rewrite the allocator's bookkeeping. The heap must not grow, which would enlarge the image, so it runs
 * under the loader's heap cap (malloc then returns 0); the length check after it is a second guard. Call it before
 * makeSnapshot.
 */
export function zeroFreeMemory(py: SnapshotPy): { bytes: number; blocks: number } {
  const m = py._module,
    len = m.HEAPU8.length,
    got: [number, number][] = [];
  let bytes = 0;
  m.dofileHeapMax = len;
  try {
    for (let size = 1 << 20; size >= 16; size >>= 1)
      for (;;) {
        const before = m._sbrk(0),
          p = m._malloc(size);
        if (!p) break;
        if (m._sbrk(0) !== before) {
          m._free(p);
          break;
        }
        got.push([p, size]);
        bytes += size;
      }
    for (const [p, size] of got) m.HEAPU8.fill(0, p, p + size);
    for (const [p] of got) m._free(p);
  } finally {
    delete m.dofileHeapMax;
  }
  if (m.HEAPU8.length !== len) throw new Error(`zeroFreeMemory grew the heap ${len} -> ${m.HEAPU8.length}`);
  return { bytes, blocks: got.length };
}

// Files the bundle leaves out (path relative to site-packages): everything under a folder named `tests` or `test`
// (6.6 MB raw, almost all scipy test data) and type stubs (`*.pyi`, `py.typed`: 1.5 MB). Nothing imports them at run
// time; the Stata cases of `npm run check-snapshot` pass without them. Whole folder names only: `testing`
// (numpy.testing), `latest` and `pytest` stay.
export function isDeadWeight(relPath: string): boolean {
  const parts = relPath.split("/");
  return parts.slice(0, -1).some((d) => d === "tests" || d === "test") || /\.pyi$|(^|\/)py\.typed$/.test(relPath);
}

/** What to save next to the snapshot: the library log and the site-packages tree (an index and one blob). */
export function bundle(
  py: SnapshotPy,
  site: string,
): { dso: DsoRecord[] | undefined; index: BundleIndex; blob: Uint8Array } {
  const files: string[] = [],
    walk = (dir: string) => {
      for (const name of py.FS.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const full = `${dir}/${name}`,
          st = py.FS.stat(full);
        if (py.FS.isDir(st.mode)) walk(full);
        else if (py.FS.isFile(st.mode) && !isDeadWeight(full.slice(site.length + 1))) files.push(full);
      }
    };
  walk(site);
  const index: BundleIndex = [],
    parts: Uint8Array[] = [];
  for (const path of files) {
    const data = py.FS.readFile(path);
    index.push({ path, size: data.length });
    parts.push(data);
  }
  const blob = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    blob.set(p, at);
    at += p.length;
  }
  return { dso: py._module.__dsoLog, index, blob };
}

// Where the part (or the reason it failed) starts in the shared buffer the page hands the graphics part over in; the
// header is Int32 [state, length, tries, 0] (worker.ts).
export const PART_HEADER = 16;

// The graphics part of a lazy snapshot (docs/lazy-matplotlib.md), decompressed, as one file: the index's length (4
// bytes, little-endian), the index (JSON, a BundleIndex of absolute paths under site-packages), then the files in its
// order.
export function packGraphics(index: BundleIndex, blob: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(index)),
    out = new Uint8Array(4 + head.length + blob.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(blob, 4 + head.length);
  return out;
}

// Writes the files of a graphics part (packGraphics) into Pyodide's file system; Python finds them at the next import.
// Returns the number of files written. Throws on a part that does not add up.
export function writeGraphics(py: PyodideAPI, raw: Uint8Array): number {
  const n = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  const index: BundleIndex = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + n)));
  let at = 4 + n;
  if (at + index.reduce((s, f) => s + f.size, 0) !== raw.length)
    throw snapshotError("snapshot: the graphics part's files do not add up to its size");
  for (const { path, size } of index) {
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    py.FS.writeFile(path, raw.subarray(at, at + size));
    at += size;
  }
  py.runPython("import importlib; importlib.invalidate_caches()");
  return index.length;
}

/**
 * loadPyodide options for a restore. The second argument is {snapshot, dso, index, blob} as the build script wrote
 * them.
 * @param create - the patched module's default export.
 * @param lap - called after each step, for timing.
 */
export function restoreOptions(
  create: CreateModule,
  { snapshot, dso, index, blob }: { snapshot: Uint8Array; dso: DsoRecord[]; index: BundleIndex; blob: Uint8Array },
  lap: (name: string) => void = () => {},
): PyodideConfig {
  const e = new Uint32Array(snapshot.buffer, snapshot.byteOffset, 3),
    image = snapshot.length - e[1];
  const createPyodideModule = async (cfg: Parameters<CreateModule>[0]) => {
    const m = await create(cfg);
    lap("start the wasm module");
    m.growMemory(image);
    let at = 0;
    for (const { path, size } of index) {
      m.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      m.FS.writeFile(path, blob.subarray(at, at + size));
      at += size;
    }
    lap("write site-packages");
    // The recorded addresses come from the original heap's malloc; here malloc doesn't know them, so a library's
    // start-up allocations could land on another library's range. Reserve the whole span first.
    const lo = Math.min(...dso.map((r) => r.memoryBase)),
      hi = Math.max(...dso.map((r) => r.memoryBase + r.memorySize));
    const reserved = m._malloc(hi);
    if (reserved > lo) throw snapshotError(`snapshot: cannot reserve ${lo}..${hi}, malloc returned ${reserved}`);
    m.__dsoReplay = dso.map((r) => ({ ...r }));
    // Each dlopen needs a scope object (`global ? null : {}`) that collects the exports of its local dependencies;
    // without it a later call fails with "Dynamic linking error: cannot resolve symbol" (scipy's LAPACK wrapper needs
    // dsytrf_).
    for (const r of dso)
      m.loadDynamicLibrary(
        r.libName,
        { global: r.global, nodelete: r.nodelete, allowUndefined: r.allowUndefined },
        r.global ? null : {},
      );
    // Python holds the handle dlopen gave it for each library and dlsyms through it later
    for (const r of dso) if (r.handle) m.LDSO.loadedLibsByHandle[r.handle] = m.LDSO.loadedLibsByName[r.libName];
    m.__dsoReplay = null;
    m.__dsoLog = [];
    lap(`re-link ${dso.length} libraries`);
    return m;
  };
  return { _loadSnapshot: snapshot, createPyodideModule, _snapshotDeserializer: () => null };
}

// ---- compressed files ----
// The snapshot and the bundle are stored and sent brotli-compressed (quality 11: 229 MB -> 46 MB) and decompressed on
// every start. The browser's own Content-Encoding is not used, so the Cache API keeps the compressed bytes and no host
// setting changes the size. brotli-wasm runs the same decoder in the browser and in Node.

/** Decodes brotli `input` into exactly `rawSize` bytes, in steps: the peak memory is about the output plus one step (a
 *  one-shot decode holds the output in wasm memory and again as a copy). */
export function inflate(
  brotli: BrotliWasmType,
  input: Uint8Array,
  rawSize: number,
  steps: { inStep?: number; outStep?: number } = {},
): Uint8Array {
  const it = inflateSteps(brotli, input, rawSize, steps);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

// `inflate`, resumable: each next() decodes `inStep` bytes of input and yields the output's length so far; the last
// returns the output. The graphics part is decoded so: between two steps a run can start or a Break be taken.
export function* inflateSteps(
  brotli: BrotliWasmType,
  input: Uint8Array,
  rawSize: number,
  { inStep = 2 << 20, outStep = 4 << 20 } = {},
): Generator<number, Uint8Array, void> {
  const out = new Uint8Array(rawSize),
    stream = new brotli.DecompressStream(),
    Code = brotli.BrotliStreamResultCode;
  let at = 0,
    code: number | undefined;
  for (let inAt = 0; inAt < input.length || code === undefined; inAt += inStep) {
    const chunk = input.subarray(inAt, inAt + inStep);
    let used = 0;
    do {
      const r = stream.decompress(chunk.subarray(used), outStep);
      if (at + r.buf.length > rawSize)
        throw snapshotError(`snapshot: the decompressed data is larger than the ${rawSize} bytes expected`);
      out.set(r.buf, at);
      at += r.buf.length;
      used += r.input_offset;
      code = r.code;
    } while (code === Code.NeedsMoreOutput);
    if (code !== Code.NeedsMoreInput && code !== Code.ResultSuccess)
      throw snapshotError(`snapshot: brotli decompression failed (code ${code})`);
    if (inAt + inStep < input.length) yield at;
  }
  if (code !== Code.ResultSuccess || at !== rawSize)
    throw snapshotError(`snapshot: decompressed ${at} bytes of ${rawSize} expected (a truncated or damaged file)`);
  return out;
}

/** Whether the browser has a brotli DecompressionStream. brotli-wasm decoded at about 9 MB/s on an iPhone (229 MB: 25
 *  s). */
export function hasNativeBrotli() {
  try {
    new DecompressionStream("brotli" as CompressionFormat);
    return true;
  } catch {
    return false;
  }
}

/** `inflate` with the native decoder. */
export async function inflateNative(input: Uint8Array<ArrayBuffer>, rawSize: number): Promise<Uint8Array> {
  const out = new Uint8Array(rawSize);
  const reader = new Blob([input])
    .stream()
    .pipeThrough(new DecompressionStream("brotli" as CompressionFormat))
    .getReader();
  let at = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    if (at + r.value.length > rawSize)
      throw snapshotError(`snapshot: the decompressed data is larger than the ${rawSize} bytes expected`);
    out.set(r.value, at);
    at += r.value.length;
  }
  if (at !== rawSize)
    throw snapshotError(`snapshot: decompressed ${at} bytes of ${rawSize} expected (a truncated or damaged file)`);
  return out;
}

/** `file` is a manifest entry. A host that applied its own Content-Encoding hands over bytes already decoded (length
 *  === raw). */
export function unpack(
  brotli: BrotliWasmType,
  bytes: Uint8Array,
  file: Pick<SnapshotFile, "raw" | "size">,
): Uint8Array {
  if (bytes.length === file.raw) return bytes;
  if (bytes.length !== file.size)
    throw snapshotError(
      `snapshot: a file is ${bytes.length} bytes, the manifest says ${file.size}; run \`npm run snapshot\` again`,
    );
  return inflate(brotli, bytes, file.raw);
}

// `unpack` in steps of `inStep` input bytes (inflateSteps).
export function* unpackSteps(
  brotli: BrotliWasmType,
  bytes: Uint8Array,
  file: Pick<SnapshotFile, "raw" | "size">,
  inStep: number,
): Generator<number, Uint8Array, void> {
  if (bytes.length === file.raw) return bytes;
  if (bytes.length !== file.size)
    throw snapshotError(
      `snapshot: a file is ${bytes.length} bytes, the manifest says ${file.size}; run \`npm run snapshot\` again`,
    );
  return yield* inflateSteps(brotli, bytes, file.raw, { inStep });
}

/** `unpack` with the native decoder when `native` is set; a failure of it falls back to brotli-wasm, which then reports
 *  a damaged file. Returns the bytes and the decoder used ("none": already decoded). */
export async function unpackAsync(
  brotli: BrotliWasmType,
  bytes: Uint8Array<ArrayBuffer>,
  file: Pick<SnapshotFile, "raw" | "size">,
  native: boolean,
): Promise<[Uint8Array, "native" | "wasm" | "none"]> {
  if (native && bytes.length === file.size && bytes.length !== file.raw) {
    try {
      return [await inflateNative(bytes, file.raw), "native"];
    } catch (e: any) {
      console.warn(`[dofile] native brotli failed (${e?.message ?? e}); using brotli-wasm`);
    }
  }
  return [unpack(brotli, bytes, file), bytes.length === file.raw ? "none" : "wasm"];
}
