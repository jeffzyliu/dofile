// The list of every file the snapshot start loads, with its size on disk and its compressed size (SPEC.md, OQ-12 a).
// vite.config.ts writes it as dist/start-files.json after a build (and serves it in dev); the page's download prompt
// and progress bar take their numbers from it (src/engine/client.js, download).
//   node scripts/start-files.mjs [dir]     prints the list for a built page (default: dist)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// Pyodide's own files that the snapshot start needs; vite.config.ts copies them from the npm package into public/pyodide/
export const RUNTIME_FILES = ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

// What a host sends for these bytes: brotli at quality 5 (about what a CDN does as it serves), or the file as it is when
// that is no smaller (the snapshot's two big files are brotli already). An estimate: the host decides.
function compressedSize(bytes) {
  const packed = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.min(packed, bytes.length);
}

// `dir`: the folder the page is served from (dist/ after a build; public/ in dev, which has no page files).
// Returns { built, wheelHash, snapshot, files: [{ path, size, compressed, download }], size, compressed }, the one statement
// of the build: the page reads it, and gives the worker what it needs from it (client.js, start; the worker reads no manifest):
//   built      the snapshot's build time (its manifest), which names the Cache the files are kept in; null: no snapshot
//   wheelHash  SHA-256 of the dofile wheel the snapshot was built from: a page with another wheel is of an older build
//   snapshot   the snapshot's two big files, { snapshot, bundle }, each { name, raw, size } (raw: decompressed; size: as
//              stored, brotli), as in its manifest; null: no snapshot
//   path       relative to the page
//   size       bytes on disk, which is what a fetch counts
//   compressed bytes a host sends
//   download   true: download() fetches it into the Cache before the engine starts (the snapshot, the runtime, and the
//              brotli decoder's .wasm, which the worker loads as it starts). false: it came with the page (index.html
//              and the rest of assets/).
// The snapshot's manifest.json is read here, at build time, and is not a start file: the start never fetches it.
export function listStartFiles(dir) {
  const files = [];
  const add = (path, download) => {
    const bytes = readFileSync(`${dir}/${path}`);
    files.push({ path, size: bytes.length, compressed: compressedSize(bytes), download });
  };
  let built = null, wheelHash = null, snapshot = null;
  if (existsSync(`${dir}/snapshot/manifest.json`)) {
    const manifest = JSON.parse(readFileSync(`${dir}/snapshot/manifest.json`, "utf8"));
    built = manifest.built ?? null;
    wheelHash = manifest.wheelHash ?? null;
    snapshot = manifest.files ?? null;
    for (const name of [manifest.files?.snapshot.name, manifest.files?.bundle.name, "dso.json", "files.json", "pyodide.asm.patched.mjs"]) {
      if (name && existsSync(`${dir}/snapshot/${name}`)) add(`snapshot/${name}`, true);
    }
  }
  for (const name of RUNTIME_FILES) if (existsSync(`${dir}/pyodide/${name}`)) add(`pyodide/${name}`, true);
  if (existsSync(`${dir}/index.html`)) add("index.html", false);
  if (existsSync(`${dir}/assets`)) {
    for (const name of readdirSync(`${dir}/assets`, { recursive: true }).map(String).sort()) {
      if (statSync(`${dir}/assets/${name}`).isFile()) add(`assets/${name.replaceAll("\\", "/")}`, name.endsWith(".wasm"));
    }
  }
  const sum = key => files.reduce((n, f) => n + f[key], 0);
  return { built, wheelHash, snapshot, files, size: sum("size"), compressed: sum("compressed") };
}

// The page reads the download size from its own HTML, so the prompt has the number at load, offline too
// (src/engine/client.js, engineBytes). index.html is not hashed, so the build can write into it.
export const engineBytesMeta = bytes => `<meta name="dofile-engine-bytes" content="${bytes}">`;
const META = /\s*<meta name="dofile-engine-bytes" content="\d+">/g;

// After a build: write the list as `dir`/start-files.json and its compressed total into `dir`/index.html. Throws if it
// cannot (the build then fails: a page without the number would show a prompt without a size). Returns the list.
export function writeStartFiles(dir) {
  const list = listStartFiles(dir), entry = list.files.find(f => f.path === "index.html");
  const html = entry ? readFileSync(`${dir}/index.html`, "utf8").replace(META, "") : "";
  if (!html.includes("</head>")) throw new Error(`start-files: no index.html with a <head> in ${dir}`);
  const rest = { size: list.size - entry.size, compressed: list.compressed - entry.compressed };
  const page = total => Buffer.from(html.replace("</head>", `  ${engineBytesMeta(total)}\n</head>`));
  // the number is part of the file it measures: a few rounds settle it
  let total = list.compressed;
  for (let i = 0; i < 5; i++) {
    const next = rest.compressed + compressedSize(page(total));
    if (next === total) break;
    total = next;
  }
  const text = page(total);
  Object.assign(entry, { size: text.length, compressed: total - rest.compressed });
  Object.assign(list, { size: rest.size + text.length, compressed: total });
  writeFileSync(`${dir}/index.html`, text);
  writeFileSync(`${dir}/start-files.json`, JSON.stringify(list));
  return list;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = listStartFiles(resolve(process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url))));
  const mb = n => (n / 1e6).toFixed(2).padStart(7);
  console.log("on disk  sent (MB)  fetched by download()");
  for (const f of list.files) console.log(`${mb(f.size)}  ${mb(f.compressed)}   ${f.download ? "yes" : "no "}  ${f.path}`);
  const part = (label, keep) => {
    const some = list.files.filter(keep);
    console.log(`${mb(some.reduce((n, f) => n + f.size, 0))}  ${mb(some.reduce((n, f) => n + f.compressed, 0))}        ${label}`);
  };
  part("snapshot", f => f.path.startsWith("snapshot/"));
  part("runtime", f => f.path.startsWith("pyodide/"));
  part("page", f => !f.path.startsWith("snapshot/") && !f.path.startsWith("pyodide/"));
  console.log(`${mb(list.size)}  ${mb(list.compressed)}        total (built ${list.built})`);
}
