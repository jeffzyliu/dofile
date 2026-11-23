// The list of every file the snapshot start loads, with its size on disk and its compressed size. vite.config.ts writes
// it as dist/start-files.json after a build (and serves it in dev); the page's download prompt and progress bar read
// it. `node scripts/start-files.ts [dir]` prints it for a built editor (default dist/app/), with no build id.
// A .ts file because test/build-id.test.ts imports it.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import type { SnapshotManifest, StartFiles } from "../src/engine/types.ts";
import { type BuildInputs, buildId, readManifest, staleness } from "./build-id.ts";
import { EDITOR_OUT } from "./urls.ts";

// Pyodide's own files that the snapshot start needs; scripts/stage.ts copies them from the npm package into public/pyodide/
export const RUNTIME_FILES = ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

// What a host sends for these bytes: brotli at quality 5 (about what a CDN does), or the file as it is when that is no
// smaller (the snapshot's two big files are brotli already). An estimate: the host decides.
function compressedSize(bytes: Uint8Array): number {
  const packed = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.min(packed, bytes.length);
}

// `dir`: the folder the editor is served from (dist/app/ after a build, public/ in dev, which has no page files). Paths
// in the list are relative to it, as the page reads them. `stamp`: the build's stamp (none: no build id). `manifest`:
// public/snapshot/manifest.json, not deployed (the build removes it from dist/); null: no snapshot. Returns the
// build's StartFiles (types.ts). `download` marks the files that download() fetches into the Cache before the engine
// starts; the rest came with the page. The manifest is read at build time only: the start never fetches it.
type List = Omit<StartFiles, "built" | "buildId" | "snapshot"> & {
  built: number | null;
  buildId: string | null;
  snapshot: StartFiles["snapshot"] | null;
};
export function listStartFiles(
  dir: string,
  { stamp = undefined, manifest = readManifest() }: { stamp?: string; manifest?: SnapshotManifest | null } = {},
): List {
  const files: List["files"] = [];
  const add = (path: string, download: boolean) => {
    const bytes = readFileSync(`${dir}/${path}`);
    files.push({ path, size: bytes.length, compressed: compressedSize(bytes), download });
  };
  let built: number | null = null;
  let id: string | null = null;
  let snapshot: List["snapshot"] = null;
  if (manifest) {
    built = manifest.built ?? null;
    id = stamp ? buildId(stamp, manifest) : null;
    snapshot = manifest.files ?? null;
    for (const name of [
      manifest.files?.snapshot.name,
      manifest.files?.bundle.name,
      "dso.json",
      "files.json",
      "pyodide.asm.patched.mjs",
    ]) {
      if (name && existsSync(`${dir}/snapshot/${name}`)) add(`snapshot/${name}`, true);
    }
  }
  for (const name of RUNTIME_FILES) if (existsSync(`${dir}/pyodide/${name}`)) add(`pyodide/${name}`, true);
  if (existsSync(`${dir}/index.html`)) add("index.html", false);
  if (existsSync(`${dir}/assets`)) {
    for (const name of readdirSync(`${dir}/assets`, { recursive: true }).map(String).sort()) {
      if (statSync(`${dir}/assets/${name}`).isFile())
        add(`assets/${name.replaceAll("\\", "/")}`, name.endsWith(".wasm"));
    }
  }
  const sum = (key: "size" | "compressed") => files.reduce((n, f) => n + f[key], 0);
  // the graphics part of a lazy snapshot is no start file, but it counts in the size the visitor is told
  const download =
    files.reduce((n, f) => n + (f.download ? f.compressed : 0), 0) + (manifest?.files?.graphics?.size ?? 0);
  return { built, buildId: id, snapshot, files, size: sum("size"), compressed: sum("compressed"), download };
}

// The page reads the download size from its own HTML, so the prompt has the number at load, offline too
// (state/engine.ts, engineBytes). index.html is not hashed, so the build can write into it.
export const engineBytesMeta = (bytes: number) => `<meta name="dofile-engine-bytes" content="${bytes}">`;
const META = /\s*<meta name="dofile-engine-bytes" content="\d+">/g;

// After a build: write the list as `dir`/start-files.json and its download size into `dir`/index.html, and remove the
// snapshot's manifest.json and the staging record, stage.json, from `dir` (Vite copied them from public/). Throws if it cannot (a page without the number
// would show a prompt without a size), and if the snapshot is not of `inputs` (build-id.ts, staleness). With no snapshot
// the list says so (built: null) and the build goes on: the page then fails with "no snapshot in this build". Returns
// the list.
export function writeStartFiles(
  dir: string,
  {
    stamp,
    inputs,
    manifest = readManifest(),
  }: { stamp: string; inputs: BuildInputs; manifest?: SnapshotManifest | null },
): List {
  const stale = manifest && staleness(manifest, inputs);
  if (stale) throw new Error(`start-files: ${stale}`);
  const list = listStartFiles(dir, { stamp, manifest });
  const entry = list.files.find((f) => f.path === "index.html");
  const html = entry ? readFileSync(`${dir}/index.html`, "utf8").replace(META, "") : "";
  if (!html.includes("</head>")) throw new Error(`start-files: no index.html with a <head> in ${dir}`);
  // index.html is not a download file, so the number in it does not change the number: one pass
  const rest = { size: list.size - entry!.size, compressed: list.compressed - entry!.compressed };
  const text = Buffer.from(html.replace("</head>", `  ${engineBytesMeta(list.download)}\n</head>`));
  Object.assign(entry!, { size: text.length, compressed: compressedSize(text) });
  Object.assign(list, { size: rest.size + text.length, compressed: rest.compressed + entry!.compressed });
  writeFileSync(`${dir}/index.html`, text);
  writeFileSync(`${dir}/start-files.json`, JSON.stringify(list));
  rmSync(`${dir}/snapshot/manifest.json`, { force: true }); // the build's records, not files of the site
  rmSync(`${dir}/stage.json`, { force: true });
  return list;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = listStartFiles(resolve(process.argv[2] ?? fileURLToPath(new URL(`../${EDITOR_OUT}`, import.meta.url))));
  const mb = (n: number) => (n / 1e6).toFixed(2).padStart(7);
  console.log("on disk  sent (MB)  fetched by download()");
  for (const f of list.files)
    console.log(`${mb(f.size)}  ${mb(f.compressed)}   ${f.download ? "yes" : "no "}  ${f.path}`);
  const part = (label: string, keep: (f: List["files"][number]) => boolean) => {
    const some = list.files.filter(keep);
    console.log(
      `${mb(some.reduce((n, f) => n + f.size, 0))}  ${mb(some.reduce((n, f) => n + f.compressed, 0))}        ${label}`,
    );
  };
  part("snapshot", (f) => f.path.startsWith("snapshot/"));
  part("runtime", (f) => f.path.startsWith("pyodide/"));
  part("page", (f) => !f.path.startsWith("snapshot/") && !f.path.startsWith("pyodide/"));
  console.log(`${mb(list.size)}  ${mb(list.compressed)}        total (built ${list.built})`);
}
