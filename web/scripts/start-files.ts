// The list of every file the snapshot start loads, with its size on disk and its compressed size (SPEC.md, OQ-12 a).
// vite.config.ts writes it as dist/start-files.json after a build (and serves it in dev); the page's download prompt
// and progress bar take their numbers from it (src/engine/client.ts, download).
//   node scripts/start-files.ts [dir]      prints the list for a built page (default: dist); with no build stamp, no build id
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import type { SnapshotManifest, StartFiles } from "../src/engine/types.ts";
import { type BuildInputs, buildId, readManifest, staleness } from "./build-id.ts";

// Pyodide's own files that the snapshot start needs; vite.config.ts copies them from the npm package into public/pyodide/
export const RUNTIME_FILES = ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

// What a host sends for these bytes: brotli at quality 5 (about what a CDN does as it serves), or the file as it is when
// that is no smaller (the snapshot's two big files are brotli already). An estimate: the host decides.
function compressedSize(bytes: Uint8Array): number {
  const packed = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.min(packed, bytes.length);
}

// `dir`: the folder the page is served from (dist/ after a build; public/ in dev, which has no page files).
// `stamp`: the build's stamp (vite.config.ts, made once per build or dev-server start); none: no build id.
// `manifest`: the snapshot's build record, public/snapshot/manifest.json (it is not deployed: the build removes it from
// dist/); null: no snapshot.
// Returns { built, buildId, snapshot, files: [{ path, size, compressed, download }], size, compressed }, the one statement
// of the build: the page reads it, and gives the worker what it needs from it (client.ts, start; the worker reads no manifest):
//   built      the snapshot's build time (its manifest), which names the Cache the files are kept in; null: no snapshot
//   buildId    scripts/build-id.ts, buildId(stamp, the manifest): equal to the page's only when both are of one build run and
//              the snapshot is of that build's inputs; null: no snapshot or no stamp
//   snapshot   the snapshot's two big files, { snapshot, bundle }, each { name, raw, size } (raw: decompressed; size: as
//              stored, brotli), as in its manifest; null: no snapshot
//   path       relative to the page
//   size       bytes on disk, which is what a fetch counts
//   compressed bytes a host sends
//   download   true: download() fetches it into the Cache before the engine starts (the snapshot, the runtime, and the
//              brotli decoder's .wasm, which the worker loads as it starts). false: it came with the page (index.html
//              and the rest of assets/).
// The snapshot's manifest.json is read here, at build time, and is not a start file: the start never fetches it.
// (A .ts file because a test imports it: test/build-id.test.ts.)
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
  let built: number | null = null,
    id: string | null = null,
    snapshot: List["snapshot"] = null;
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
  return { built, buildId: id, snapshot, files, size: sum("size"), compressed: sum("compressed") };
}

// The page reads the download size from its own HTML, so the prompt has the number at load, offline too
// (src/app/state.ts, engineBytes). index.html is not hashed, so the build can write into it.
export const engineBytesMeta = (bytes: number) => `<meta name="dofile-engine-bytes" content="${bytes}">`;
const META = /\s*<meta name="dofile-engine-bytes" content="\d+">/g;

// After a build: write the list as `dir`/start-files.json and its compressed total into `dir`/index.html, and remove the
// snapshot's manifest.json from `dir` (Vite copied it from public/). Throws if it cannot (the build then fails: a page
// without the number would show a prompt without a size), and if the snapshot is not of `inputs`, what the page is built
// from (scripts/build-id.ts, staleness). With no snapshot the list says so (built: null) and the build goes on, as the
// page then fails with "no snapshot in this build". Returns the list.
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
  const list = listStartFiles(dir, { stamp, manifest }),
    entry = list.files.find((f) => f.path === "index.html");
  const html = entry ? readFileSync(`${dir}/index.html`, "utf8").replace(META, "") : "";
  if (!html.includes("</head>")) throw new Error(`start-files: no index.html with a <head> in ${dir}`);
  const rest = { size: list.size - entry!.size, compressed: list.compressed - entry!.compressed };
  const page = (total: number) => Buffer.from(html.replace("</head>", `  ${engineBytesMeta(total)}\n</head>`));
  // the number is part of the file it measures: a few rounds settle it
  let total = list.compressed;
  for (let i = 0; i < 5; i++) {
    const next = rest.compressed + compressedSize(page(total));
    if (next === total) break;
    total = next;
  }
  const text = page(total);
  Object.assign(entry!, { size: text.length, compressed: total - rest.compressed });
  Object.assign(list, { size: rest.size + text.length, compressed: total });
  writeFileSync(`${dir}/index.html`, text);
  writeFileSync(`${dir}/start-files.json`, JSON.stringify(list));
  rmSync(`${dir}/snapshot/manifest.json`, { force: true }); // the build's record, not a file of the site
  return list;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = listStartFiles(resolve(process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url))));
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
