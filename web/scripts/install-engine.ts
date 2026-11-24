// Installs the dofile wheel and the extra wheels of web/wheels/ into a Pyodide, as the page's worker does. No pandas,
// as in the page: `export sasxport` is not available there.
//   await installEngine(py, { dist, pandas, mock })   // dist: folder holding the dofile wheel (default web/.wheel);
//   pandas: also load it (only for checking `export sasxport`: check-snapshot.ts --pandas);
//   mock: names micropip treats as installed, so neither they nor their libraries are loaded (a lazy snapshot's build)
import { readFileSync } from "node:fs";

import type { PyodideAPI } from "pyodide";

import { extraWheelsDir, wheelDir, wheels } from "./lib/wheels.ts";

export async function installEngine(
  py: PyodideAPI,
  { dist = wheelDir, pandas = false, mock = [] as string[] } = {},
): Promise<string> {
  await py.loadPackage(pandas ? ["micropip", "pandas"] : "micropip", { messageCallback: () => {} });
  const names: string[] = [];
  const put = (dir: string, name: string) => {
    py.FS.writeFile(`/tmp/${name}`, readFileSync(`${dir}/${name}`));
    names.push(name);
  };
  const { dofile: wheel, extras } = wheels(dist);
  put(dist, wheel);
  for (const f of extras) put(extraWheelsDir, f);
  await py.runPythonAsync(
    `import micropip
for n in ${JSON.stringify(mock)}: micropip.add_mock_package(n, "999")
await micropip.install(${JSON.stringify(names.map((n) => `emfs:/tmp/${n}`))})`,
  );
  return wheel;
}
