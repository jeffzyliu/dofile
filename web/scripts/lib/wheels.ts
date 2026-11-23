// The wheels a build is made of: the newest dofile wheel in web/.wheel/ (`npm run wheel` builds it there, so the release
// wheels in the repository's dist/ stay), and the extra wheels of web/wheels/ (pyreadstat built for Pyodide).
import { readdirSync } from "node:fs";

import { web } from "./paths.ts";

export const wheelDir = `${web}/.wheel`;
export const extraWheelsDir = `${web}/wheels`;

const list = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".whl"))
    .sort();

/** The newest dofile wheel in `dir` (and its folder), and the extra wheels' file names, sorted. */
export function wheels(dir = wheelDir) {
  const dofile = list(dir).at(-1);
  if (!dofile) throw new Error(`no wheel in ${dir}: run \`npm run wheel\``);
  return { dir, dofile, extras: list(extraWheelsDir) };
}
