// Memory-snapshot spike: does restoring a Pyodide heap that already has numpy/scipy/matplotlib/dofile imported beat
// booting + importing them? Node only, packages from node_modules/pyodide (no network), so it shows the CPU part.
//
// What stock Pyodide 314.0.7 leaves out, and what this script adds:
//  - makeMemorySnapshot saves the Python heap, not the wasm filesystem or the function table. Native extensions
//    (numpy, scipy, ...) are linked into the table and heap at dlopen time, so a restored heap points at table slots
//    that don't exist ("table index is out of bounds"). Here a patched copy of pyodide.asm.mjs logs every library load
//    (name, memoryBase, tableBase, flags); on restore the libraries are linked again at the same addresses *before*
//    Pyodide copies the heap image in, so the image overwrites whatever the re-link wrote.
//  - the filesystem: the site-packages tree is saved next to the snapshot and written back first.
//  - this build ignores INITIAL_MEMORY (heap starts at 30 MiB): grow it to the image's size before the restore.
//  - the snapshot check wants Pyodide's loadedPackages to be {} and no live JS objects; both are worked around.
//
// RESULT (Node, local files, Pyodide 314.0.7): works. Restore to a running engine 0.64-0.80 s (re-link of 136 libraries
// 0.42 s is the biggest part) against 5.2 s for the normal boot; regression, scipy, linalg and a matplotlib graph give
// the same results after the restore. Cost: the download. Snapshot 136 MB (44 MB gzip) + site-packages 93 MB (29 MB
// gzip) against 25 MB of wheels. Not yet checked: the browser, the conformance corpus, Break (SIGINT handler lives in
// the heap), IndexedDB files, and a patched Pyodide file per release (the patch fails loudly if the loader changes).
//
// Usage: node snapshot.mjs make     -> writes .snapshot/ (snapshot, dso log, site-packages bundle)
//        node snapshot.mjs restore  -> boots from it and runs a regression; prints the timings
//        node snapshot.mjs plain    -> the normal boot, for comparison
//        node snapshot.mjs          -> make, restore x3, plain
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPyodide } from "pyodide";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, ".snapshot");
const SNAP = join(OUT, "dofile.snap"), DSO = join(OUT, "dso.json"), PKG_INDEX = join(OUT, "files.json"),
  PKG_BLOB = join(OUT, "files.bin"), PATCHED = join(OUT, "pyodide.asm.patched.mjs");
const SITE = "/lib/python3.14/site-packages";
const DIST = join(HERE, "../../dist");
const WHEEL = readdirSync(DIST).filter(f => f.endsWith(".whl")).sort().at(-1);
const mode = process.argv[2];

process.on("uncaughtException", e => { console.log("ERR", String(e?.stack ?? e).slice(0, 1800)); process.exit(1); });
process.on("unhandledRejection", e => { console.log("ERR", String(e?.stack ?? e).slice(0, 1800)); process.exit(1); });

const t0 = performance.now();
let last = t0;
const lap = name => {
  const t = performance.now();
  console.log(`  ${name.padEnd(34)} ${((t - last) / 1000).toFixed(2).padStart(6)} s`);
  last = t;
};
const total = () => console.log(`  ${"TOTAL".padEnd(34)} ${((performance.now() - t0) / 1000).toFixed(2).padStart(6)} s`);

// ---- the patched Pyodide module -----------------------------------------------------------------------------------
const ORIGINAL = "var memoryBase=metadata.memorySize?alignMemory(getMemory(metadata.memorySize+memAlign),memAlign):0;" +
  "var tableBase=metadata.tableSize?wasmTable.length:0;";
const REPLACEMENT =
  "var __rec=Module.__dsoReplay&&Module.__dsoReplay.find(r=>!r.used&&r.libName===libName);" +
  "var memoryBase=__rec?(__rec.used=true,__rec.memoryBase):(metadata.memorySize?alignMemory(getMemory(metadata.memorySize+memAlign),memAlign):0);" +
  "var tableBase=metadata.tableSize?wasmTable.length:0;" +
  "if(__rec&&metadata.tableSize){if(tableBase>__rec.tableBase)console.warn('table drift',libName,tableBase,__rec.tableBase);" +
  "while(wasmTable.length<__rec.tableBase)wasmTable.grow(1);tableBase=wasmTable.length}" +
  "(Module.__dsoLog||=[]).push({libName,handle,memoryBase,memorySize:metadata.memorySize,tableBase,global:flags.global,nodelete:flags.nodelete,allowUndefined:flags.allowUndefined});";

// When re-linking (__rec set) don't run the library's data relocations and constructors: they ran before the snapshot,
// their effects are in the heap image, and running them again on a runtime where Python isn't up crashes (ft2font).
const SKIPS = [
  ['var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs){', 'var applyRelocs=moduleExports["__wasm_apply_data_relocs"];if(applyRelocs&&!__rec){'],
  ['var init=moduleExports["__wasm_call_ctors"];if(init){', 'var init=moduleExports["__wasm_call_ctors"];if(init&&!__rec){'],
];

async function patchedCreate() {
  let src = readFileSync(new URL("pyodide.asm.mjs", import.meta.resolve("pyodide")), "utf8");
  for (const [from, to] of [[ORIGINAL, REPLACEMENT], ...SKIPS]) {
    if (!src.includes(from)) throw new Error("pyodide.asm.mjs changed: the loader patch no longer applies");
    src = src.replace(from, to);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(PATCHED, src);
  return (await import(PATCHED)).default;
}

// ---- files ----------------------------------------------------------------------------------------------------
function walk(FS, dir, out) {
  for (const name of FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const full = `${dir}/${name}`, st = FS.stat(full);
    if (FS.isDir(st.mode)) walk(FS, full, out);
    else if (FS.isFile(st.mode)) out.push(full);
  }
  return out;
}

const IMPORTS = `
import numpy, scipy.stats, scipy.optimize, scipy.linalg, openpyxl
import matplotlib; matplotlib.use("agg"); import matplotlib.pyplot
import dofile.browser as b
import os
os.makedirs("/work", exist_ok=True)
b.start("/work")
b.run("clear\\nset obs 50\\ngen x = _n\\ngen y = 3*x + mod(_n, 7)\\nregress y x")   # import everything a first run needs
`;
const USE = `
import dofile.browser as b, json
r = json.loads(b.run("clear\\nset obs 80\\ngen x = _n\\ngen y = 2*x + mod(_n, 5)\\nregress y x\\nscalar n = e(N)"))
import scipy.interpolate, numpy.polynomial.chebyshev     # not imported before the snapshot: needs files + dlopen
print(r["log"][:300]) if r["rc"] else None
import scipy.stats, scipy.optimize, numpy as np
g = json.loads(b.run("scatter y x"))
print("native checks: norm.cdf(1.96) =", round(float(scipy.stats.norm.cdf(1.96)), 6),
      "| minimize =", round(float(scipy.optimize.minimize_scalar(lambda t: (t - 3) ** 2).x), 4),
      "| matrix inv =", np.linalg.inv(np.array([[2.0, 0], [0, 4.0]])).tolist(),
      "| graph rc", g["rc"], "png bytes", sum(len(i) for i in g["images"]) * 3 // 4)
print("rc", r["rc"], "| nobs", r["nobs"], "| coef table in log:", "_cons" in r["log"], "| slope line:", [l for l in r["log"].splitlines() if l.strip().startswith("x ")][:1], "| scipy.interpolate ok")
`;

async function make() {
  const create = await patchedCreate();
  const py = await loadPyodide({ _makeSnapshot: true, createPyodideModule: create });
  await py.loadPackage("micropip", { messageCallback: () => {} });
  py.FS.writeFile(`/tmp/${WHEEL}`, readFileSync(join(DIST, WHEEL)));
  await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${WHEEL}")`);
  await py.runPythonAsync(IMPORTS);
  await py.runPythonAsync(`
import sys, gc
for m in [m for m in sys.modules if m == "micropip" or m.startswith("micropip.")]: del sys.modules[m]
del micropip
gc.collect()`);

  // site-packages -> one bundle
  const files = walk(py.FS, SITE, []), index = [], parts = [];
  for (const path of files) { const data = py.FS.readFile(path); index.push({ path, size: data.length }); parts.push(data); }
  const blob = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { blob.set(p, at); at += p.length; }
  writeFileSync(PKG_INDEX, JSON.stringify(index));
  writeFileSync(PKG_BLOB, blob);
  writeFileSync(DSO, JSON.stringify(py._module.__dsoLog));

  // Pyodide's snapshot check insists its loadedPackages object is still {}; empty it for the call
  for (const k of Object.keys(py.loadedPackages)) delete py.loadedPackages[k];
  // two JS objects are still held (a fetch Response and its arrayBuffer method, left by micropip's download of
  // openpyxl); nothing uses them again, so they are stored as null
  const snap = py.makeMemorySnapshot({ serializer: () => null });
  writeFileSync(SNAP, snap);
  console.log(`snapshot ${(snap.length / 1e6).toFixed(1)} MB; ${files.length} files ${(blob.length / 1e6).toFixed(1)} MB; ` +
    `${py._module.__dsoLog.length} libraries linked`);
}

async function restore() {
  const bytes = readFileSync(SNAP), log = JSON.parse(readFileSync(DSO, "utf8")),
    index = JSON.parse(readFileSync(PKG_INDEX, "utf8")), blob = readFileSync(PKG_BLOB);
  lap("read snapshot + bundle");
  const create = await patchedCreate();
  const e = new Uint32Array(bytes.buffer, bytes.byteOffset, 3), image = bytes.length - e[1];
  const createPyodideModule = async cfg => {
    const m = await create(cfg);
    lap("create wasm module");
    m.growMemory(image);
    let at = 0;
    for (const { path, size } of index) {
      m.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      m.FS.writeFile(path, blob.subarray(at, at + size));
      at += size;
    }
    lap("write site-packages to FS");
    // The recorded addresses come from the original heap's malloc; in this fresh heap malloc doesn't know them, so a
    // library's start-up allocations could land on another library's range. Reserve the whole span first (the image
    // replaces malloc's state afterwards anyway).
    const lo = Math.min(...log.map(r => r.memoryBase)), hi = Math.max(...log.map(r => r.memoryBase + r.memorySize));
    const reserved = m._malloc(hi);
    if (reserved > lo) throw new Error(`cannot reserve ${lo}..${hi}: malloc returned ${reserved}`);
    m.__dsoReplay = log.map(r => ({ ...r }));
    for (const [i, r] of log.entries()) {
      try { m.loadDynamicLibrary(r.libName, { global: r.global, nodelete: r.nodelete, allowUndefined: r.allowUndefined }); }
      catch (err) { console.log("RELINK FAILED at", i, r.libName, String(err).slice(0, 120)); throw err; }
    }
    // Python holds the handle dlopen gave it for each library and dlsyms through it later
    for (const r of log) if (r.handle) m.LDSO.loadedLibsByHandle[r.handle] = m.LDSO.loadedLibsByName[r.libName];
    m.__dsoReplay = null;
    lap(`re-link ${log.length} libraries`);
    return m;
  };
  const py = await loadPyodide({ _loadSnapshot: bytes, createPyodideModule, _snapshotDeserializer: () => null });
  lap("copy heap image + finish boot");
  await py.runPythonAsync(USE);
  lap("first regress + new imports");
  total();
}

async function plain() {
  const py = await loadPyodide();
  lap("loadPyodide");
  await py.loadPackage("micropip", { messageCallback: () => {} });
  py.FS.writeFile(`/tmp/${WHEEL}`, readFileSync(join(DIST, WHEEL)));
  await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${WHEEL}")`);
  lap("micropip install");
  await py.runPythonAsync(IMPORTS);
  lap("imports + engine start + regress");
  await py.runPythonAsync(USE);
  lap("second regress + new imports");
  total();
}

if (mode === "make") await make();
else if (mode === "restore") await restore();
else if (mode === "plain") await plain();
else {
  const run = m => { const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), m], { stdio: "inherit" }); if (r.status) process.exit(r.status); };
  console.log("make:"); run("make");
  for (let i = 0; i < 3; i++) { console.log("restore:"); run("restore"); }
  console.log("plain boot:"); run("plain");
}
