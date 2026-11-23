// The build's identity. buildId() makes the id on both sides: the page (vite.config.ts compiles in the id of the files
// it is built from) and the list (start-files.json carries the id of what the snapshot was built from). The client
// compares them (checkBuild). One stamp per `vite build` is given to both.
// staged() is the same for the files scripts/stage.ts copies into public/ (stage.json). Both records are compared with
// inputs(), and each message names its fix.
// `node scripts/build-id.ts [--warn]` exits 0 when public/snapshot/ is of this checkout's wheels and Pyodide, else 1
// with the reason (SNAPSHOT_QUALITY and the other SNAPSHOT_ settings, when set, must be what the snapshot was built with;
// `--warn` prefixes "warning: ", for `npm run dev`, which starts anyway). Imported by the tests, so .ts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { About, SnapshotManifest } from "../src/engine/types.ts";
import { extraWheelsDir, wheels } from "./lib/wheels.ts";

/** What a snapshot is built from, and what the page is built against. `extraWheels`: file name -> SHA-256. */
export interface BuildInputs {
  wheel: string;
  wheelHash: string;
  extraWheels: Record<string, string>;
  pyodide: string;
}

/** The settings that shape a snapshot beyond its inputs (scripts/make-snapshot.ts), recorded in its manifest. `optimize`:
 *  PYTHONOPTIMIZE (2 strips docstrings and asserts), `quality`: Brotli's, `noMpl`: matplotlib left out of the heap (the lazy
 *  graphics part), `trampoline`: Pyodide's own choice kept (not patched out). */
export interface SnapshotKnobs {
  quality: number;
  optimize: 0 | 2;
  noMpl: boolean;
  trampoline: boolean;
}

/** Each knob's environment variable: setting one is what asks for it (askedKnobs). */
const KNOB_ENV = {
  quality: "SNAPSHOT_QUALITY",
  optimize: "SNAPSHOT_STRIP_DOCS",
  noMpl: "SNAPSHOT_NO_MPL",
  trampoline: "SNAPSHOT_TRAMPOLINE",
} as const satisfies Record<keyof SnapshotKnobs, string>;

/** The settings a snapshot build reads from the environment, with their defaults: what make-snapshot.ts builds with. */
export function knobs(env: NodeJS.ProcessEnv = process.env): SnapshotKnobs {
  return {
    quality: env.SNAPSHOT_QUALITY === undefined ? 11 : Number(env.SNAPSHOT_QUALITY),
    optimize: env.SNAPSHOT_STRIP_DOCS === "0" ? 0 : 2,
    noMpl: env.SNAPSHOT_NO_MPL !== "0",
    trampoline: env.SNAPSHOT_TRAMPOLINE === "1",
  };
}

/** Only the settings the caller's environment sets (SNAPSHOT_QUALITY=11 asks for quality 11): what a check holds a
 *  snapshot to. One that is not set is not asked: CI builds at quality 5 and must pass. */
export function askedKnobs(env: NodeJS.ProcessEnv = process.env): Partial<SnapshotKnobs> {
  const all = knobs(env);
  const asked: Partial<SnapshotKnobs> = {};
  for (const k of Object.keys(KNOB_ENV) as (keyof SnapshotKnobs)[])
    if (env[KNOB_ENV[k]] !== undefined) Object.assign(asked, { [k]: all[k] });
  return asked;
}

const web = new URL("..", import.meta.url);
export const publicDir = fileURLToPath(new URL("public", web));
export const snapshotDir = `${publicDir}/snapshot`;
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The inputs of this checkout: the newest wheel in web/.wheel (`npm run wheel`), web/wheels/*.whl, the pyodide npm package. */
export function inputs(): BuildInputs {
  const { dir, dofile: wheel, extras } = wheels();
  const extraWheels: Record<string, string> = {};
  for (const f of extras) extraWheels[f] = sha256(`${extraWheelsDir}/${f}`);
  const pyodide = JSON.parse(readFileSync(new URL("node_modules/pyodide/package.json", web), "utf8")).version;
  return { wheel, wheelHash: sha256(`${dir}/${wheel}`), extraWheels, pyodide };
}

/** What the page shows of the engine without asking it (the "About dofile" hint, the log's head). The wheel's file name
 *  gives the version; the VENDORED stamp gives the engine's commit. Fixed when the page is built. */
export function about(
  { wheel }: Pick<BuildInputs, "wheel"> = inputs(),
): Pick<About, "dofile" | "engine_commit" | "stata_version"> {
  const version = wheel.split("-")[1]; // {name}-{version}-{python}-{abi}-{platform}.whl
  if (!wheel.startsWith("dofile-") || !version)
    throw new Error(`cannot read the version from the wheel's name: ${wheel}`);
  const stamp = readFileSync(new URL("../src/dofile/_vendor/opendta/VENDORED", web), "utf8");
  return { dofile: version, engine_commit: /^commit: (\S+)$/m.exec(stamp)?.[1] ?? null, stata_version: 14 };
}

/** SHA-256 over the stamp, the dofile wheel's hash, the extra wheels' hashes (by file name) and the Pyodide version. A record
 *  with no `extraWheels` (a snapshot from before they were recorded) hashes them as null, so its id is never a page's. */
export function buildId(
  stamp: string,
  {
    wheelHash,
    extraWheels,
    pyodide,
  }: Pick<BuildInputs, "wheelHash" | "pyodide"> & { extraWheels?: BuildInputs["extraWheels"] },
): string {
  const extra = extraWheels
    ? Object.keys(extraWheels)
        .sort()
        .map((name) => [name, extraWheels[name]])
    : null;
  return createHash("sha256")
    .update(JSON.stringify([stamp, wheelHash, extra, pyodide]))
    .digest("hex");
}

/** How a record's wheels and Pyodide version differ from `current`, one sentence each; `what` names the record ("snapshot",
 *  "staged"). */
function differences(what: string, record: Partial<BuildInputs>, current: BuildInputs): string[] {
  const why: string[] = [];
  if (record.wheelHash !== current.wheelHash)
    why.push(
      `the dofile wheel differs (${what} ${record.wheelHash?.slice(0, 12)}, build ${current.wheelHash.slice(0, 12)})`,
    );
  if (!record.extraWheels) why.push(`the ${what} has no record of the extra wheels`);
  else {
    const names = [...new Set([...Object.keys(record.extraWheels), ...Object.keys(current.extraWheels)])].sort();
    for (const n of names) {
      if (record.extraWheels[n] !== current.extraWheels[n]) {
        why.push(
          `the extra wheel ${n} differs (${what} ${record.extraWheels[n]?.slice(0, 12) ?? "none"}, build ${current.extraWheels[n]?.slice(0, 12) ?? "none"})`,
        );
      }
    }
  }
  if (record.pyodide !== current.pyodide)
    why.push(`the Pyodide version differs (${what} ${record.pyodide}, build ${current.pyodide})`);
  return why;
}

/** Why the snapshot whose manifest is `record` is not of `current`, with what to run; null: it is. `asked`: settings the
 *  caller wants it built with (`askedKnobs()`): each is compared with the record's, and only those; none asked, none checked. */
export function staleness(
  record: Partial<BuildInputs> & Partial<SnapshotKnobs>,
  current: BuildInputs,
  asked: Partial<SnapshotKnobs> = {},
): string | null {
  const why = differences("snapshot", record, current);
  for (const k of Object.keys(asked) as (keyof SnapshotKnobs)[])
    if (record[k] !== asked[k])
      why.push(`the snapshot was built with ${k} ${record[k] ?? "(not recorded)"}, ${asked[k]} was asked for`);
  return why.length ? `the snapshot is stale: ${why.join("; ")}. Run \`npm run snapshot\` in web/` : null;
}

/** public/stage.json (scripts/stage.ts): the inputs the staged files are of, and each file's size in bytes by its path under
 *  public/. Written last, so a stage that died half-way leaves none. */
export interface StageRecord extends BuildInputs {
  files: Record<string, number>;
}

/** Why the files in `dir` (public/) are not the staging of `current`, with what to run; null: they are. Reads only. Every
 *  file the record names must exist with the recorded size, so a deleted or cut-short file is told too. */
export function staged(current: BuildInputs, dir: string = publicDir): string | null {
  const fix = "Run `npm run stage` in web/";
  let record: Partial<StageRecord>;
  try {
    record = JSON.parse(readFileSync(`${dir}/stage.json`, "utf8"));
  } catch {
    return `nothing is staged in ${dir} (no readable stage.json). ${fix}`;
  }
  const why = differences("staged", record, current);
  for (const [path, size] of Object.entries(record.files ?? {})) {
    const have = existsSync(`${dir}/${path}`) ? statSync(`${dir}/${path}`).size : null;
    if (have === null) why.push(`${path} is missing`);
    else if (have !== size) why.push(`${path} is ${have} bytes, staged as ${size}`);
  }
  return why.length ? `the staged files are stale: ${why.join("; ")}. ${fix}` : null;
}

/** public/snapshot/manifest.json, the snapshot's build record; null: no snapshot. */
export function readManifest(dir: string = snapshotDir): SnapshotManifest | null {
  return existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = readManifest();
  const why = record
    ? staleness(record, inputs(), askedKnobs())
    : `no snapshot in ${snapshotDir}. Run \`npm run snapshot\` in web/`;
  if (why) {
    console.log(process.argv.includes("--warn") ? `warning: ${why}` : why); // --warn: `npm run dev`, which starts anyway
    process.exit(1);
  }
  console.log(`the snapshot in ${snapshotDir} is of this checkout's wheels and Pyodide ${record!.pyodide}`);
}
