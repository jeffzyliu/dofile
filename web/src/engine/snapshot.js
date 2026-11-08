// Start the engine from a Pyodide memory snapshot instead of installing and importing numpy, scipy, matplotlib and dofile
// (opt-in: the page's ?snapshot=1; built by `npm run snapshot`, scripts/make-snapshot.mjs). Used by the build script
// (Node) and by worker.js (browser and Node). web/spike/snapshot.mjs is where it was worked out, with the numbers.
//
// What stock Pyodide 314 leaves out of a snapshot, and what is done about it:
//  - Native extensions are linked into the wasm function table and heap when Python first imports them, and a snapshot
//    holds neither the table nor the filesystem. patchAsm() adds to pyodide.asm.mjs a log of every library load (name,
//    dlopen handle, memory base, table base, flags). On restore the libraries are linked again at the recorded addresses
//    before Pyodide copies the heap image in (the image then overwrites what the re-link wrote), without running their
//    constructors and data relocations: those already ran, and need Python, which is not up yet.
//  - The site-packages tree is saved beside the snapshot and written back first.
//  - This Pyodide build ignores INITIAL_MEMORY (the heap starts at 30 MiB): grow it to the image's size first.

// the loader code in pyodide.asm.mjs that gets replaced
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
  ['var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs){',
    'var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs&&!__rec){'],
  ['var init=moduleExports["__wasm_call_ctors"];if(init){', 'var init=moduleExports["__wasm_call_ctors"];if(init&&!__rec){'],
];

// pyodide.asm.mjs's text -> the same with the library log and the re-link. Throws if Pyodide's loader looks different.
export function patchAsm(src, { noTrampoline = false } = {}) {
  for (const [from, to] of [[ALLOC, ALLOC_PATCHED], ...SKIPS, ...(noTrampoline ? [NO_TRAMPOLINE] : [])]) {
    if (!src.includes(from)) throw new Error("pyodide.asm.mjs is not the version the snapshot patch was written for");
    src = src.replace(from, to);
  }
  return src;
}

// Pyodide writes the pointer of a WebAssembly trampoline function into the Python runtime (in the heap) at start, except on
// iOS, where it writes 0 and creates no function (getPyEMTrampolinePtr tests the user agent). A snapshot restores the heap
// of the machine that made it, so a snapshot made with the trampoline fails on an iPhone with "call_indirect to a signature
// that does not match" (checked: only the user agent matters). This makes the loader behave as on iOS everywhere, so the
// pointer in the heap is always 0 and one snapshot starts in every browser. The default of make-snapshot.mjs;
// SNAPSHOT_TRAMPOLINE=1 keeps Pyodide's own choice (a snapshot that then fails on iOS). The build and the restore use the
// same patched loader file.
const NO_TRAMPOLINE = ["let isIOS=globalThis.navigator&&(", "let isIOS=true||globalThis.navigator&&("];

// The errors that mean the browser will not give us storage: full, blocked, private mode, or no Cache API at all. The
// engine can start without the cache, and says so. Any other error from the Cache API is a bug and is not swallowed.
const STORAGE_REFUSALS = new Set(["QuotaExceededError", "SecurityError", "NotAllowedError", "NoCacheAPI", "UnknownError"]);   // UnknownError: Chrome's damaged cache storage
export const isStorageRefusal = e => STORAGE_REFUSALS.has(e?.name);

// loadPyodide options that go with a snapshot being made: two JS objects are still held (a fetch Response and its
// arrayBuffer method, left by micropip's download of openpyxl), and nothing uses them again, so they are stored as null
export const makeOptions = create => ({ _makeSnapshot: true, createPyodideModule: create });
export const makeSnapshot = py => {
  // Pyodide's check insists its loadedPackages object is still {}
  for (const k of Object.keys(py.loadedPackages)) delete py.loadedPackages[k];
  return py.makeMemorySnapshot({ serializer: () => null });
};

// Emscripten keeps the bytes of every library Python opened with dlopen in the heap (a buffer the library's handle points
// to: size at handle+32, address at handle+28), and the site-packages bundle holds the same files, so the snapshot
// carried each of them twice (30 MB, 4.4 MB compressed). The restore links the libraries from the filesystem and never
// reads these buffers. Zero each one that is byte-identical to its file (a buffer that differs is left alone, whatever it
// is now), so it compresses to nothing. Returns {zeroed, bytes, kept}. Call it before makeSnapshot.
export function zeroLibraryCopies(py) {
  const m = py._module;
  let zeroed = 0, bytes = 0, kept = 0;
  for (const r of m.__dsoLog ?? []) {
    if (!r.handle) continue;
    const ptr = m.HEAPU32[(r.handle + 28) >> 2], size = m.HEAPU32[(r.handle + 32) >> 2];
    if (!ptr || !size) continue;
    const file = m.FS.readFile(r.libName), copy = m.HEAPU8.subarray(ptr, ptr + size);
    let same = file.length === size;
    for (let i = 0; same && i < size; i++) if (file[i] !== copy[i]) same = false;
    if (same) { copy.fill(0); zeroed++; bytes += size; } else kept++;
  }
  return { zeroed, bytes, kept };
}

// What to save next to the snapshot: the library log and the site-packages tree (an index and one blob).
export function bundle(py, site) {
  const files = [], walk = dir => {
    for (const name of py.FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const full = `${dir}/${name}`, st = py.FS.stat(full);
      if (py.FS.isDir(st.mode)) walk(full);
      else if (py.FS.isFile(st.mode)) files.push(full);
    }
  };
  walk(site);
  const index = [], parts = [];
  for (const path of files) { const data = py.FS.readFile(path); index.push({ path, size: data.length }); parts.push(data); }
  const blob = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { blob.set(p, at); at += p.length; }
  return { dso: py._module.__dsoLog, index, blob };
}

// loadPyodide options for a restore. `create` is the patched module's default export; `saved` is {snapshot, dso, index,
// blob} as written by the build script. `lap(name)` is called after each step, for timing.
export function restoreOptions(create, { snapshot, dso, index, blob }, lap = () => {}) {
  const e = new Uint32Array(snapshot.buffer, snapshot.byteOffset, 3), image = snapshot.length - e[1];
  const createPyodideModule = async cfg => {
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
    const lo = Math.min(...dso.map(r => r.memoryBase)), hi = Math.max(...dso.map(r => r.memoryBase + r.memorySize));
    const reserved = m._malloc(hi);
    if (reserved > lo) throw new Error(`snapshot: cannot reserve ${lo}..${hi}, malloc returned ${reserved}`);
    m.__dsoReplay = dso.map(r => ({ ...r }));
    // Each dlopen gets a scope object (`global ? null : {}`) that collects the exports of the library's local dependencies,
    // and the library finds the symbols it needs there (scipy's LAPACK wrapper finds dsytrf_ in its dependency). Without
    // one, a call that needs such a symbol fails after the restore: "Dynamic linking error: cannot resolve symbol".
    for (const r of dso) m.loadDynamicLibrary(r.libName, { global: r.global, nodelete: r.nodelete, allowUndefined: r.allowUndefined }, r.global ? null : {});
    // Python holds the handle dlopen gave it for each library and dlsyms through it later
    for (const r of dso) if (r.handle) m.LDSO.loadedLibsByHandle[r.handle] = m.LDSO.loadedLibsByName[r.libName];
    m.__dsoReplay = null;
    m.__dsoLog = [];
    lap(`re-link ${dso.length} libraries`);
    return m;
  };
  return { _loadSnapshot: snapshot, createPyodideModule, _snapshotDeserializer: () => null };
}

// ---- compressed files ---------------------------------------------------------------------------------------------
// The snapshot and the site-packages bundle are stored and sent brotli-compressed (quality 11: 229 MB -> 46 MB) and
// decompressed on every start; the browser's own Content-Encoding handling is not used, so the compressed bytes are what
// the Cache API keeps and no host setting changes the size. `brotli` is the brotli-wasm module (the same wasm decoder in
// the browser and in Node, so the Node tests run the code the page runs).

// Decode `input` (brotli) into a new Uint8Array of exactly `rawSize` bytes, in steps, so the peak memory is about the
// output plus one step (a one-shot decode holds the output in wasm memory and again as a copy).
export function inflate(brotli, input, rawSize, { inStep = 2 << 20, outStep = 4 << 20 } = {}) {
  const out = new Uint8Array(rawSize), stream = new brotli.DecompressStream(), Code = brotli.BrotliStreamResultCode;
  let at = 0, code;
  for (let inAt = 0; inAt < input.length || code === undefined; inAt += inStep) {
    const chunk = input.subarray(inAt, inAt + inStep);
    let used = 0;
    do {
      const r = stream.decompress(chunk.subarray(used), outStep);
      if (at + r.buf.length > rawSize) throw new Error(`snapshot: the decompressed data is larger than the ${rawSize} bytes expected`);
      out.set(r.buf, at);
      at += r.buf.length;
      used += r.input_offset;
      code = r.code;
    } while (code === Code.NeedsMoreOutput);
    if (code !== Code.NeedsMoreInput && code !== Code.ResultSuccess) throw new Error(`snapshot: brotli decompression failed (code ${code})`);
  }
  if (code !== Code.ResultSuccess || at !== rawSize) throw new Error(`snapshot: decompressed ${at} bytes of ${rawSize} expected (a truncated or damaged file)`);
  return out;
}

// `file` is a manifest entry {raw, size}. A host that applied its own Content-Encoding hands over the bytes already
// decoded (length === raw): use them as they are.
export function unpack(brotli, bytes, file) {
  if (bytes.length === file.raw) return bytes;
  if (bytes.length !== file.size) throw new Error(`snapshot: a file is ${bytes.length} bytes, the manifest says ${file.size}; run \`npm run snapshot\` again`);
  return inflate(brotli, bytes, file.raw);
}
