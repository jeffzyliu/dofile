// Load an engine's source into Pyodide and run one .do file. Usage: node try.mjs <engine> <srcdir> <datadir> <dofile>
import { loadPyodide } from "pyodide";
process.on("uncaughtException", e => { console.log("UNCAUGHT", String(e?.message ?? e).slice(-900)); process.exit(1); });
process.on("unhandledRejection", e => { console.log("REJECT", String(e?.message ?? e).slice(-900)); process.exit(1); });
const [engine, src, data, dofile] = process.argv.slice(2);
const py = await loadPyodide();
const t0 = Date.now();
await py.loadPackage(["numpy", "scipy", "matplotlib", "pandas", "statsmodels", "regex", "micropip"], { messageCallback: () => {} });
await py.runPythonAsync("import micropip; await micropip.install('openpyxl')");
console.log(`packages ready ${(Date.now() - t0) / 1000}s`);
py.FS.mkdirTree("/src"); py.FS.mount(py.FS.filesystems.NODEFS, { root: src }, "/src");
py.FS.mkdirTree("/data"); py.FS.mount(py.FS.filesystems.NODEFS, { root: data }, "/data");
const code = engine === "opendta" ? `
import sys, io, contextlib, os
sys.path.insert(0, "/src"); os.chdir("/data")
from opendta.session import Session
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    s = Session()
    s.output.add_listener(lambda text, style: buf.write(text))
    rc = s.run(open("${dofile}").read(), echo=True)
out = buf.getvalue() + f"\\nRC {rc}"
` : `
import sys, os
sys.path.insert(0, "/src"); os.chdir("/data")
from openstat.engine import Engine
r = Engine(cwd="/data").run(open("${dofile}").read())
out = r.output + f"\\nRC {r.rc}"
`;
try {
  await py.runPythonAsync(code);
  const out = py.globals.get("out");
  console.log(out.split("\n").filter(l => /CHECK|RC |rror|unrecognized/.test(l)).join("\n"));
} catch (e) { console.log("PYERR", String(e).split("\n").slice(-6).join("\n")); }
console.log(`elapsed ${(Date.now() - t0) / 1000}s`);
