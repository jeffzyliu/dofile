// Installs the dofile wheel and the extra wheels of web/wheels/ into a Pyodide, as the page's worker does: micropip, then every
// wheel with its dependencies resolved together. No pandas, as in the page: `export sasxport` is not available there.
//   await installEngine(py, { dist, pandas })   // dist: folder holding the dofile wheel (default ../dist, `npm run wheel`);
//   pandas: also load it, which the page does not (only for checking `export sasxport`: check-snapshot.mjs --pandas)
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
export const extraWheelsDir = `${repo}web/wheels`;

export const newestWheel = dir => readdirSync(dir).filter(f => f.endsWith(".whl")).sort().at(-1);

export async function installEngine(py, { dist = `${repo}dist`, pandas = false } = {}) {
  await py.loadPackage(pandas ? ["micropip", "pandas"] : "micropip", { messageCallback: () => {} });
  const names = [];
  const put = (dir, name) => { py.FS.writeFile(`/tmp/${name}`, readFileSync(`${dir}/${name}`)); names.push(name); };
  const wheel = newestWheel(dist);
  put(dist, wheel);
  for (const f of readdirSync(extraWheelsDir).filter(f => f.endsWith(".whl"))) put(extraWheelsDir, f);
  await py.runPythonAsync(`import micropip; await micropip.install(${JSON.stringify(names.map(n => `emfs:/tmp/${n}`))})`);
  return wheel;
}
