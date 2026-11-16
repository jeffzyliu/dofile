// Builds the Pyodide memory snapshot the page starts from by default, unless ?snapshot=0 (`npm run snapshot`): Python started, the dofile wheel
// installed, numpy, scipy, matplotlib, openpyxl and the engine's modules imported and one program run, so the page doesn't
// repeat that. Writes public/snapshot/ (gitignored): the heap image and the site-packages bundle, brotli-compressed
// (about 27 MB at brotli 11 with docstrings stripped; 229 MB uncompressed, matplotlib's part included), plus the lazy graphics part in a third file (7.7 MB), small JSON files and a manifest, the snapshot's build record (what it was built from:
// scripts/build-id.ts, inputs()). Rebuild after changing the dofile wheel, a wheel in web/wheels/ or the pyodide version: a build
// refuses a stale snapshot, and in development the page says "updated" (scripts/build-id.ts, staleness). Needs the network once
// (micropip fetches openpyxl from PyPI); numpy and the rest come from node_modules/pyodide.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { loadPyodide } from "pyodide";
import {
  bundle,
  inflate,
  makeOptions,
  makeSnapshot,
  packGraphics,
  patchAsm,
  zeroFreeMemory,
  zeroLibraryCopies,
} from "../src/engine/snapshot.ts";
import { inputs } from "./build-id.ts";
import { installEngine } from "./install-engine.ts";

const here = new URL("..", import.meta.url);
const OUT = process.env.SNAPSHOT_OUT
  ? `${process.env.SNAPSHOT_OUT.replace(/\/*$/, "")}/`
  : fileURLToPath(new URL("public/snapshot/", here));
// Python runs with PYTHONOPTIMIZE=2 by default: docstrings and `assert` statements are left out of everything imported or
// compiled in it, in the snapshot and after the restore (the flag is part of the heap). Smaller heap. SNAPSHOT_STRIP_DOCS=0
// builds without it.
const stripDocs = process.env.SNAPSHOT_STRIP_DOCS !== "0";
// what the snapshot is built from (the dofile wheel, web/wheels/, the Pyodide version), with their hashes: the manifest records it
const record = inputs();
// The lazy graphics part (experiment E1c, docs/lazy-matplotlib.md; the default, SNAPSHOT_NO_MPL=0 builds the old single snapshot):
// leave matplotlib and what only it needs out of the snapshot: not imported before the heap is taken, its files not in the
// bundle, but in a third file, graphics.brotli.bin, that the page fetches after the start files (client.ts, graphics) and
// hands to the worker, whose first graph waits for it (worker.ts, waitGraphics).
const noMpl = process.env.SNAPSHOT_NO_MPL !== "0";
const pyodideDir = new URL("node_modules/pyodide/", here);

const t0 = performance.now();
const lap = (what) => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const patched = `${OUT}pyodide.asm.patched.mjs`;
writeFileSync(
  patched,
  patchAsm(readFileSync(new URL("pyodide.asm.mjs", pyodideDir), "utf8"), {
    noTrampoline: process.env.SNAPSHOT_TRAMPOLINE !== "1",
  }),
);
const create = (await import(patched)).default;

const py = await loadPyodide({ ...makeOptions(create), ...(stripDocs ? { env: { PYTHONOPTIMIZE: "2" } } : {}) });
lap(
  `Pyodide started${stripDocs ? ` (docstrings and asserts stripped: sys.flags.optimize = ${py.runPython("import sys; sys.flags.optimize")})` : ""}`,
);
const mplParts = [
  "matplotlib",
  "pillow",
  "kiwisolver",
  "fonttools",
  "contourpy",
  "cycler",
  "pyparsing",
  "python-dateutil",
  "pytz",
  "six",
];
await installEngine(py, { mock: noMpl ? mplParts : [] }); // the dofile wheel and the wheels of web/wheels/ (pyreadstat)
lap("dofile and its dependencies installed");

if (noMpl) {
  // removed before the imports (openpyxl imports pillow when it finds it): distributions that only matplotlib needs (checked against the others' Requires-Dist below); the build stops if one was imported
  const dropped = py.runPython(`
import sys, os, shutil, json, importlib.metadata as md, re
drop = ${JSON.stringify(mplParts)}
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
dists = {norm(d.metadata["Name"]): d for d in md.distributions()}
needed_by = {}
for name, d in dists.items():
    if name in drop: continue
    for r in d.requires or []:
        r = norm(re.split(r"[ ;<>=!~\\[(]", r.strip())[0])
        if r in drop and ";" not in r: needed_by.setdefault(r, []).append(name)
site = "/lib/python3.14/site-packages"
removed = {}
for name in drop:
    d = dists.get(name)
    if d is None: continue
    size = 0
    tops = set()
    for f in d.files or []:
        p = str(d.locate_file(f))
        if os.path.isfile(p): size += os.path.getsize(p); os.remove(p)
        tops.add(str(f).split("/")[0])
    for t in tops:
        shutil.rmtree(f"{site}/{t}", ignore_errors=True)
        if os.path.isfile(f"{site}/{t}"): os.remove(f"{site}/{t}")
    removed[name] = size
json.dumps({"removed": removed, "needed_by_others": needed_by})
`);
  console.log(dropped);
}

// import what a first run needs, and run a program in a throwaway engine so the lazily imported modules are loaded too
// (the filesystem is saved, but a module imported later has to be linked again; this keeps that to the rare ones)
await py.runPythonAsync(`
import numpy, scipy.stats, scipy.optimize, scipy.linalg, openpyxl, xlrd, xlwt, pyreadstat
${noMpl ? "" : 'import matplotlib; matplotlib.use("agg"); import matplotlib.pyplot'}
import os
os.makedirs("/work", exist_ok=True)
from dofile.engine import Engine
e = Engine("/work")
e.run("clear\\nset obs 60\\ngen x = _n\\ngen y = 3*x + mod(_n, 7)\\nregress y x, robust${noMpl ? "" : "\\nscatter y x"}", images=True)
del e
import dofile.browser
# matplotlib keeps drawn-with fonts open (an FT2Font reads its file through a file descriptor); descriptors are not part
# of a snapshot, so a restored font would fail to read ("Bad file descriptor") and its text would be missing. Drop them.
${
  noMpl
    ? ""
    : `import matplotlib.pyplot as plt
plt.close("all")
from matplotlib import font_manager
font_manager._get_font.cache_clear()   # the lru_cache under get_font (matplotlib 3.10)
`
}# micropip keeps a fetch Response alive, which a snapshot can't hold
import sys, gc
for m in [m for m in sys.modules if m == "micropip" or m.startswith("micropip.")]: del sys.modules[m]${
  noMpl
    ? `
# the mock packages' import finder (micropip.add_mock_package) would otherwise stay in the heap and answer "import matplotlib"
# with an empty stand-in module, hiding the real files that the graphics part writes later
sys.meta_path[:] = [f for f in sys.meta_path if not type(f).__module__.startswith("micropip")]
if [p for p in sys.path if "micropip" in p]: raise AssertionError(sys.path)  # not assert: PYTHONOPTIMIZE=2 drops it`
    : ""
}
del micropip
gc.collect()
`);
lap("imports done, program run");
if (noMpl) {
  // libraries opened before the removal (loadPackage may link some at once) are in the log, and their files are gone
  const log = py._module.__dsoLog;
  const gone = log.filter((r) => !py._module.FS.analyzePath(r.libName).exists);
  console.log(
    `dso log: ${gone.length} of ${log.length} entries point at removed files: ${gone.map((r) => r.libName).join(", ")}`,
  );
  py._module.__dsoLog = log.filter((r) => !gone.includes(r));
  const bad = py
    .runPython(`
import sys
[m for m in sys.modules if m.split(".")[0] in {"matplotlib", "PIL", "kiwisolver", "fontTools", "contourpy", "cycler", "pyparsing", "dateutil", "pytz", "six", "mpl_toolkits", "pylab"}]
`)
    .toJs();
  if (bad.length) throw new Error(`a matplotlib part is in the heap: ${bad.slice(0, 5)}`);
}

const saved = bundle(py, "/lib/python3.14/site-packages");
const copies = zeroLibraryCopies(py);
lap(
  `zeroed ${copies.zeroed} copies of native libraries in the heap (${(copies.bytes / 1e6).toFixed(1)} MB; ${copies.kept} left as they were)`,
);
const free = zeroFreeMemory(py);
lap(`zeroed ${(free.bytes / 1e6).toFixed(1)} MB of free memory in the heap (${free.blocks} blocks)`);
const snapshot = makeSnapshot(py);
lap(
  `snapshot ${(snapshot.length / 1e6).toFixed(0)} MB, ${saved.index.length} files ${(saved.blob.length / 1e6).toFixed(0)} MB, ${saved.dso.length} libraries`,
);

// Only the compressed files are written, and the page stores them compressed too. They end in .bin, not .br: servers
// (vite preview, many hosts) send a .br file with Content-Encoding: br, the browser decodes it, and the cache would hold
// the 229 MB. Brotli quality 11 takes about 3 minutes
// (the two files in parallel); SNAPSHOT_QUALITY=5 makes a build in seconds that is about 25% bigger, for development.
const quality = Number(process.env.SNAPSHOT_QUALITY ?? 11);
const brotliCompress = promisify(zlib.brotliCompress);
const compress = (data) =>
  brotliCompress(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
const [snapshotBr, bundleBr] = await Promise.all([compress(snapshot), compress(saved.blob)]);
lap(
  `compressed with brotli quality ${quality}: snapshot ${(snapshotBr.length / 1e6).toFixed(1)} MB, bundle ${(bundleBr.length / 1e6).toFixed(1)} MB`,
);

// Decode both with the decoder the page uses and compare, so a bad build fails here, not in a user's browser.
const brotli = createRequire(import.meta.url)("brotli-wasm");
for (const [name, packed, original] of [
  ["snapshot", snapshotBr, snapshot],
  ["bundle", bundleBr, saved.blob],
]) {
  const back = inflate(brotli, new Uint8Array(packed), original.length);
  if (
    Buffer.compare(
      Buffer.from(back.buffer, back.byteOffset, back.length),
      Buffer.from(original.buffer, original.byteOffset, original.length),
    ) !== 0
  ) {
    throw new Error(`the decoded ${name} differs from the original`);
  }
}
lap("decoded again with brotli-wasm: identical");

// The graphics part of a lazy snapshot: matplotlib and the packages only it needs, installed in a second, fresh Pyodide (with
// the same PYTHONOPTIMIZE) from the wheels in node_modules/pyodide, with an unchecked-hash .pyc next to each module that a few
// graphs import (opt-2 names when docstrings are stripped, the ones the page's Python looks for: compiling matplotlib was 2/3
// of a first plot, docs/lazy-matplotlib.md); a module only a rarer graph imports is compiled when it is first imported. One file (packGraphics), brotli at the build's quality; the worker fetches it after "ready".
let graphics = null;
if (noMpl) {
  const py2 = await loadPyodide({ ...(stripDocs ? { env: { PYTHONOPTIMIZE: "2" } } : {}) });
  await installEngine(py2); // with matplotlib this time: the dofile wheel and its dependencies
  const listed = JSON.parse(
    py2.runPython(`
import importlib.metadata as md, os, re, json, py_compile, sys
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
# packaging too: matplotlib imports it, and with matplotlib mocked the core never installed it
drop = ${JSON.stringify([...mplParts, "packaging"])}
import os
os.makedirs("/work", exist_ok=True)
from dofile.engine import Engine
r = Engine("/work").run("clear\\nset obs 60\\ngen x = _n\\ngen y = 3*x + mod(_n, 7)\\nscatter y x, title(t)\\nhistogram y\\ntwoway line y x\\ngraph bar y, over(x)\\ngraph export /work/g.png, replace", images=True)
if not (r.rc == 0 and len(r.images) == 4): raise AssertionError((r.rc, len(r.images), r.log[-500:]))  # not assert: PYTHONOPTIMIZE=2 drops it
used = {os.path.normpath(m.__file__) for m in list(sys.modules.values()) if getattr(m, "__file__", None)}
files, pyc = set(), 0
for d in md.distributions():
    if norm(d.metadata["Name"]) not in drop: continue
    for f in d.files or []:
        p = os.path.normpath(str(d.locate_file(f)))
        if os.path.isfile(p) and "/__pycache__/" not in p: files.add(p)
for p in sorted(files):
    if not p.endswith(".py") or p not in used: continue
    try:
        c = py_compile.compile(p, doraise=True, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
    except py_compile.PyCompileError:
        continue
    files.add(c); pyc += os.path.getsize(c)
# what the page's worker imports once the part is written and the engine is idle (browser.py, warm_graphics), in the order
# these graphs imported it: the part's modules and the engine's graphics modules that the core heap does not hold
tops = {"matplotlib", "mpl_toolkits", "PIL", "kiwisolver", "fontTools", "contourpy", "cycler", "pyparsing", "dateutil", "pytz", "six", "packaging"}
warm = [n for n in list(sys.modules) if n.split(".")[0] in tops or n.startswith("dofile._vendor.opendta.graphics.render")]
site = "/lib/python3.14/site-packages"
with open(f"{site}/_dofile_graphics_warm.txt", "w") as fh: fh.write("\\n".join(warm))
files.add(f"{site}/_dofile_graphics_warm.txt")
# (no font list file: Pyodide's matplotlib writes none and builds its list at import, which the warm-up does in the background)
json.dumps({"files": sorted(files), "pyc": pyc, "warm": len(warm)})
`),
  );
  const index = listed.files.map((path) => ({ path, size: py2.FS.stat(path).size }));
  const blob = new Uint8Array(index.reduce((n, f) => n + f.size, 0));
  let at = 0;
  for (const { path } of index) {
    const data = py2.FS.readFile(path);
    blob.set(data, at);
    at += data.length;
  }
  const raw = packGraphics(index, blob);
  const packed = await compress(raw);
  const back = inflate(brotli, new Uint8Array(packed), raw.length);
  if (Buffer.compare(Buffer.from(back), Buffer.from(raw)) !== 0) throw new Error("the decoded graphics part differs");
  graphics = { name: "graphics.brotli.bin", raw: raw.length, size: packed.length, packed };
  lap(
    `graphics part: ${index.length} files (${(listed.pyc / 1e6).toFixed(1)} MB of .pyc, ${listed.warm} modules to warm), ${(raw.length / 1e6).toFixed(1)} MB, ` +
      `${(packed.length / 1e6).toFixed(2)} MB compressed`,
  );
}

writeFileSync(`${OUT}heap.brotli.bin`, snapshotBr);
if (graphics) writeFileSync(`${OUT}${graphics.name}`, graphics.packed);
writeFileSync(`${OUT}site-packages.brotli.bin`, bundleBr);
writeFileSync(`${OUT}dso.json`, JSON.stringify(saved.dso));
writeFileSync(`${OUT}files.json`, JSON.stringify(saved.index));
writeFileSync(
  `${OUT}manifest.json`,
  JSON.stringify({
    ...record, // wheel, wheelHash, extraWheels, pyodide: a build compares them with its own (scripts/build-id.ts, staleness)
    built: Date.now(),
    optimize: stripDocs ? 2 : 0,
    files: {
      snapshot: { name: "heap.brotli.bin", raw: snapshot.length, size: snapshotBr.length },
      bundle: { name: "site-packages.brotli.bin", raw: saved.blob.length, size: bundleBr.length },
      ...(graphics && { graphics: { name: graphics.name, raw: graphics.raw, size: graphics.size } }),
    },
  }),
);
lap(`written to ${OUT} (${((snapshotBr.length + bundleBr.length) / 1e6).toFixed(1)} MB compressed)`);
