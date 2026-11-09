// Builds the Pyodide memory snapshot the page starts from by default, unless ?snapshot=0 (`npm run snapshot`): Python started, the dofile wheel
// installed, numpy, scipy, matplotlib, openpyxl and the engine's modules imported and one program run, so the page doesn't
// repeat that. Writes public/snapshot/ (gitignored): the heap image and the site-packages bundle, brotli-compressed
// (about 40 MB at brotli 11 with docstrings stripped; 229 MB uncompressed), plus small JSON files and a manifest. Rebuild after changing the dofile
// wheel or the pyodide version: the page checks the manifest and refuses a stale snapshot. Needs the network once
// (micropip fetches openpyxl from PyPI); numpy and the rest come from node_modules/pyodide.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { loadPyodide } from "pyodide";
import { patchAsm, makeOptions, makeSnapshot, bundle, inflate, zeroLibraryCopies } from "../src/engine/snapshot.js";

const here = new URL("..", import.meta.url);
const OUT = process.env.SNAPSHOT_OUT ? `${process.env.SNAPSHOT_OUT.replace(/\/*$/, "")}/` : fileURLToPath(new URL("public/snapshot/", here));
// Python runs with PYTHONOPTIMIZE=2 by default: docstrings and `assert` statements are left out of everything imported or
// compiled in it, in the snapshot and after the restore (the flag is part of the heap). Smaller heap. SNAPSHOT_STRIP_DOCS=0
// builds without it.
const stripDocs = process.env.SNAPSHOT_STRIP_DOCS !== "0";
const dist = new URL("../dist/", here);
const wheel = readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1);
if (!wheel) throw new Error("no wheel in ../dist: run `npm run wheel`");
const pyodideDir = new URL("node_modules/pyodide/", here);
const version = JSON.parse(readFileSync(new URL("package.json", pyodideDir), "utf8")).version;

const t0 = performance.now();
const lap = what => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const patched = `${OUT}pyodide.asm.patched.mjs`;
writeFileSync(patched, patchAsm(readFileSync(new URL("pyodide.asm.mjs", pyodideDir), "utf8"), { noTrampoline: process.env.SNAPSHOT_TRAMPOLINE !== "1" }));
const create = (await import(patched)).default;

const py = await loadPyodide({ ...makeOptions(create), ...(stripDocs ? { env: { PYTHONOPTIMIZE: "2" } } : {}) });
lap(`Pyodide started${stripDocs ? ` (docstrings and asserts stripped: sys.flags.optimize = ${py.runPython("import sys; sys.flags.optimize")})` : ""}`);
await py.loadPackage("micropip", { messageCallback: () => {} });
py.FS.writeFile(`/tmp/${wheel}`, readFileSync(new URL(wheel, dist)));
await py.runPythonAsync(`import micropip; await micropip.install("emfs:/tmp/${wheel}")`);
lap("dofile and its dependencies installed");

// import what a first run needs, and run a program in a throwaway engine so the lazily imported modules are loaded too
// (the filesystem is saved, but a module imported later has to be linked again; this keeps that to the rare ones)
await py.runPythonAsync(`
import numpy, scipy.stats, scipy.optimize, scipy.linalg, openpyxl
import matplotlib; matplotlib.use("agg"); import matplotlib.pyplot
import os
os.makedirs("/work", exist_ok=True)
from dofile.engine import Engine
e = Engine("/work")
e.run("clear\\nset obs 60\\ngen x = _n\\ngen y = 3*x + mod(_n, 7)\\nregress y x, robust\\nscatter y x", images=True)
del e
import dofile.browser
# matplotlib keeps drawn-with fonts open (an FT2Font reads its file through a file descriptor); descriptors are not part
# of a snapshot, so a restored font would fail to read ("Bad file descriptor") and its text would be missing. Drop them.
import matplotlib.pyplot as plt
plt.close("all")
from matplotlib import font_manager
font_manager._get_font.cache_clear()   # the lru_cache under get_font (matplotlib 3.10)
# micropip keeps a fetch Response alive, which a snapshot can't hold
import sys, gc
for m in [m for m in sys.modules if m == "micropip" or m.startswith("micropip.")]: del sys.modules[m]
del micropip
gc.collect()
`);
lap("imports done, program run");

const saved = bundle(py, "/lib/python3.14/site-packages");
const copies = zeroLibraryCopies(py);
lap(`zeroed ${copies.zeroed} copies of native libraries in the heap (${(copies.bytes / 1e6).toFixed(1)} MB; ${copies.kept} left as they were)`);
const snapshot = makeSnapshot(py);
lap(`snapshot ${(snapshot.length / 1e6).toFixed(0)} MB, ${saved.index.length} files ${(saved.blob.length / 1e6).toFixed(0)} MB, ${saved.dso.length} libraries`);

// Only the compressed files are written, and the page stores them compressed too. They end in .bin, not .br: servers
// (vite preview, many hosts) send a .br file with Content-Encoding: br, the browser decodes it, and the cache would hold
// the 229 MB. Brotli quality 11 takes about 3 minutes
// (the two files in parallel); SNAPSHOT_QUALITY=5 makes a build in seconds that is about 25% bigger, for development.
const quality = Number(process.env.SNAPSHOT_QUALITY ?? 11);
const brotliCompress = promisify(zlib.brotliCompress);
const compress = data => brotliCompress(data, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
const [snapshotBr, bundleBr] = await Promise.all([compress(snapshot), compress(saved.blob)]);
lap(`compressed with brotli quality ${quality}: snapshot ${(snapshotBr.length / 1e6).toFixed(1)} MB, bundle ${(bundleBr.length / 1e6).toFixed(1)} MB`);

// Decode both with the decoder the page uses and compare, so a bad build fails here, not in a user's browser.
const brotli = createRequire(import.meta.url)("brotli-wasm");
for (const [name, packed, original] of [["snapshot", snapshotBr, snapshot], ["bundle", bundleBr, saved.blob]]) {
  const back = inflate(brotli, new Uint8Array(packed), original.length);
  if (Buffer.compare(Buffer.from(back.buffer, back.byteOffset, back.length), Buffer.from(original.buffer, original.byteOffset, original.length)) !== 0) {
    throw new Error(`the decoded ${name} differs from the original`);
  }
}
lap("decoded again with brotli-wasm: identical");

writeFileSync(`${OUT}heap.brotli.bin`, snapshotBr);
writeFileSync(`${OUT}site-packages.brotli.bin`, bundleBr);
writeFileSync(`${OUT}dso.json`, JSON.stringify(saved.dso));
writeFileSync(`${OUT}files.json`, JSON.stringify(saved.index));
writeFileSync(`${OUT}manifest.json`, JSON.stringify({
  wheel, wheelHash: createHash("sha256").update(readFileSync(new URL(wheel, dist))).digest("hex"),   // the page compares it with its own wheel's
  pyodide: version, built: Date.now(), optimize: stripDocs ? 2 : 0,
  files: { snapshot: { name: "heap.brotli.bin", raw: snapshot.length, size: snapshotBr.length },
    bundle: { name: "site-packages.brotli.bin", raw: saved.blob.length, size: bundleBr.length } },
}));
lap(`written to ${OUT} (${((snapshotBr.length + bundleBr.length) / 1e6).toFixed(1)} MB compressed)`);
