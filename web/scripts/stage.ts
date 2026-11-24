// Stages web/public/ (gitignored): the files the editor serves from its own origin besides the snapshot. The dofile wheel
// (the newest in .wheel/), the extra wheels (wheels/) and Pyodide's runtime (RUNTIME_FILES, copied from the npm package: the
// snapshot start takes them from the page's own origin; ?snapshot=0, the normal boot, keeps the CDN, which also has the
// packages). `npm run stage` builds the wheel first. This is the only writer of these files: vite.config.ts only reads
// them (staged(), build-id.ts), and the snapshot is public/snapshot/, which make-snapshot.ts owns and this never touches.
// `node scripts/stage.ts` alone stages the wheel already in .wheel/. A .ts file because test/stage.test.ts imports it.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { web } from "./lib/paths.ts";

import type { BuildInputs, StageRecord } from "./build-id.ts";
import { inputs, publicDir } from "./build-id.ts";
import { extraWheelsDir, wheelDir } from "./lib/wheels.ts";
import { RUNTIME_FILES } from "./start-files.ts";

/**
 * Replaces what is staged in `dir` with the files of `current`: removes every wheel and pyodide/ there (an older wheel
 * would be deployed with the page), copies, and writes stage.json last.
 * @param dir - public/, unless a test gives another
 * @param current - what to stage (inputs() reads the wheel in .wheel/)
 * @returns the record written
 */
export function stage(dir: string = publicDir, current: BuildInputs = inputs()): StageRecord {
  rmSync(`${dir}/stage.json`, { force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".whl")) rmSync(`${dir}/${f}`);
  rmSync(`${dir}/pyodide`, { recursive: true, force: true });
  mkdirSync(`${dir}/pyodide`);
  const copies: [from: string, path: string][] = [
    [`${wheelDir}/${current.wheel}`, current.wheel],
    ...Object.keys(current.extraWheels).map((f): [string, string] => [`${extraWheelsDir}/${f}`, f]),
    ...RUNTIME_FILES.map((f): [string, string] => [`${web}/node_modules/pyodide/${f}`, `pyodide/${f}`]),
  ];
  const files: Record<string, number> = {};
  for (const [from, path] of copies) {
    copyFileSync(from, `${dir}/${path}`);
    files[path] = statSync(`${dir}/${path}`).size;
  }
  const record = { ...current, files };
  writeFileSync(`${dir}/stage.json`, JSON.stringify(record));
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = stage();
  console.log(
    `staged ${Object.keys(record.files).length} files in ${publicDir}: ${record.wheel}, Pyodide ${record.pyodide}`,
  );
}
