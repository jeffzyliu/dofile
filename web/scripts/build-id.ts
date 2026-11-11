// The build's identity (prototype 1, step 3.5 B2). One function, buildId(), makes the id on both sides:
//   the page   vite.config.ts compiles in buildId(stamp, inputs()): the files it is built from;
//   the list   start-files.json carries buildId(stamp, the snapshot's manifest.json): what the snapshot was built from.
// The stamp is made once per `vite build` (or dev-server start) and given to both, so the two ids are equal only when page
// and list are of one build run and the snapshot is of that build's inputs. The client compares them (checkBuild).
// staleness() says why a snapshot is not of the inputs being built: a build with a stale snapshot fails (start-files.ts,
// writeStartFiles), and the deploy workflow asks it whether to rebuild the snapshot:
//   node scripts/build-id.ts      exit 0: public/snapshot/ is of the wheels and Pyodide in this checkout; 1: it is not (says why)
// Imported by the tests, so .ts (like install-engine.ts).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { About, SnapshotManifest } from "../src/engine/types.ts";

/** What a snapshot is built from, and what the page is built against. `extraWheels`: file name -> SHA-256, web/wheels/*.whl. */
export interface BuildInputs {
  wheel: string;
  wheelHash: string;
  extraWheels: Record<string, string>;
  pyodide: string;
}

const web = new URL("..", import.meta.url);
export const snapshotDir = fileURLToPath(new URL("public/snapshot", web));
const sha256 = (path: URL) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The inputs of this checkout: the newest wheel in ../dist (`npm run wheel`), web/wheels/*.whl, the pyodide npm package. */
export function inputs(): BuildInputs {
  const dist = new URL("../dist/", web),
    wheels = new URL("wheels/", web);
  const wheel = readdirSync(dist)
    .filter((f) => f.endsWith(".whl"))
    .sort()
    .at(-1);
  if (!wheel) throw new Error("no wheel in ../dist: run `npm run wheel`");
  const extraWheels: Record<string, string> = {};
  for (const f of readdirSync(wheels)
    .filter((f) => f.endsWith(".whl"))
    .sort())
    extraWheels[f] = sha256(new URL(f, wheels));
  const pyodide = JSON.parse(readFileSync(new URL("node_modules/pyodide/package.json", web), "utf8")).version;
  return { wheel, wheelHash: sha256(new URL(wheel, dist)), extraWheels, pyodide };
}

/** What the page shows of the engine without asking it (the "About dofile" hint, the log's head): the package's version,
 *  from the wheel's file name (dofile-0.1.0.dev1-py3-none-any.whl); the vendored engine's commit, from its VENDORED stamp;
 *  and the Stata version it emulates. All three are fixed when the page is built: the page is compiled against one wheel
 *  (vite.config.ts compiles this in as __ABOUT__), and the wheel is built from this tree. The engine says the same when
 *  it starts (`boot` answers About): test/engine.test.ts compares the two. */
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

/** Why the snapshot whose manifest is `record` is not of `current`, with what to run; null: it is. */
export function staleness(record: Partial<BuildInputs>, current: BuildInputs): string | null {
  const why: string[] = [];
  if (record.wheelHash !== current.wheelHash)
    why.push(
      `the dofile wheel differs (snapshot ${record.wheelHash?.slice(0, 12)}, build ${current.wheelHash.slice(0, 12)})`,
    );
  if (!record.extraWheels) why.push("the snapshot has no record of the extra wheels (built before they were recorded)");
  else {
    const names = [...new Set([...Object.keys(record.extraWheels), ...Object.keys(current.extraWheels)])].sort();
    for (const n of names) {
      if (record.extraWheels[n] !== current.extraWheels[n]) {
        why.push(
          `the extra wheel ${n} differs (snapshot ${record.extraWheels[n]?.slice(0, 12) ?? "none"}, build ${current.extraWheels[n]?.slice(0, 12) ?? "none"})`,
        );
      }
    }
  }
  if (record.pyodide !== current.pyodide)
    why.push(`the Pyodide version differs (snapshot ${record.pyodide}, build ${current.pyodide})`);
  return why.length ? `the snapshot is stale: ${why.join("; ")}. Run \`npm run snapshot\` in web/` : null;
}

/** public/snapshot/manifest.json, the snapshot's build record; null: no snapshot. */
export function readManifest(dir: string = snapshotDir): SnapshotManifest | null {
  return existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = readManifest();
  const why = record ? staleness(record, inputs()) : `no snapshot in ${snapshotDir}`;
  if (why) {
    console.log(why);
    process.exit(1);
  }
  console.log(`the snapshot in ${snapshotDir} is of this checkout's wheels and Pyodide ${record!.pyodide}`);
}
