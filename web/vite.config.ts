import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Connect, defineConfig } from "vite";
import checker from "vite-plugin-checker";
import { about, buildId, inputs as readInputs, staleness } from "./scripts/build-id.ts";
import { engineBytesMeta, listStartFiles, RUNTIME_FILES, writeStartFiles } from "./scripts/start-files.ts";

// What the page is built from (scripts/build-id.ts): the dofile wheel (the newest in ../dist, `npm run wheel`), the extra
// wheels (web/wheels/: pyreadstat built for Pyodide) and the Pyodide version, with their hashes.
const inputs = readInputs(),
  wheel = inputs.wheel,
  extraWheels = Object.keys(inputs.extraWheels);
// The build's stamp: one per `vite build`, or per dev-server start (this file is loaded once for each). The page's build id
// and the one start-files.json carries are both made with it, so they are equal only for a page and a list of one build run
// whose snapshot is of these inputs (client.ts, checkBuild).
const stamp = randomUUID();

// the dofile wheel and the extra wheels, served from public/; the page installs the extra ones after the dofile wheel
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
copyFileSync(new URL(`../dist/${wheel}`, import.meta.url), new URL(`./public/${wheel}`, import.meta.url));
for (const f of extraWheels)
  copyFileSync(new URL(`./wheels/${f}`, import.meta.url), new URL(`./public/${f}`, import.meta.url));

// The snapshot start takes Pyodide's runtime from the page's own origin: its three files are copied from the npm package
// into public/pyodide/ (gitignored). ?snapshot=0, the normal boot, keeps the CDN (the same version as the npm package),
// which also has the packages.
const pyodide = inputs.pyodide;
mkdirSync(new URL("./public/pyodide/", import.meta.url), { recursive: true });
for (const f of RUNTIME_FILES)
  copyFileSync(
    new URL(`./node_modules/pyodide/${f}`, import.meta.url),
    new URL(`./public/pyodide/${f}`, import.meta.url),
  );

// start-files.json: every file the snapshot start loads, with its size on disk and its compressed size, and the build id
// (scripts/start-files.ts). A build writes it into dist/ once the page's own files exist, and its total into dist/index.html;
// it fails on a stale snapshot. The dev server makes it from public/ (the snapshot and the runtime, no page files), again
// whenever the snapshot was rebuilt: a stale snapshot is then `updated` in the page (and said here), and one rebuilt to
// these inputs while the server runs is accepted without a restart (same stamp, same inputs).
const publicDir = fileURLToPath(new URL("./public", import.meta.url)),
  distDir = fileURLToPath(new URL("./dist", import.meta.url));
let devList = { key: "", json: "" };
function devStartFiles() {
  let key = "";
  try {
    key = readFileSync(`${publicDir}/snapshot/manifest.json`, "utf8");
  } catch {
    /* no snapshot: the list says so */
  }
  if (key !== devList.key || !devList.json) {
    const manifest = key ? JSON.parse(key) : null;
    // the page says "updated" with the cause in the console; this says which side is old: the snapshot, or this server
    if (manifest && staleness(manifest, inputs)) {
      console.warn(
        `[dofile] ${staleness(manifest, readInputs()) ?? "the snapshot is newer than this dev server's page: restart the dev server"}`,
      );
    }
    devList = { key, json: JSON.stringify(listStartFiles(publicDir, { stamp, manifest })) };
  }
  return devList.json;
}

// SharedArrayBuffer (the Break button) needs cross-origin isolation. The headers go on every response, 304s included:
// WebKit refuses a worker script whose cached 304 reply lacks COEP. The static host must do the same.
const isolate: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
};

export default defineConfig({
  define: {
    __WHEEL__: JSON.stringify(wheel),
    __EXTRA_WHEELS__: JSON.stringify(extraWheels),
    __BUILD_ID__: JSON.stringify(buildId(stamp, inputs)), // start-files.json must carry the same (client.ts, checkBuild)
    __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/`),
    __ABOUT__: JSON.stringify(about(inputs)), // the version, the engine's commit, the Stata version: app/env.ts ABOUT
  },
  plugins: [
    {
      name: "cross-origin-isolation",
      enforce: "pre", // before the checker below, which is "pre" too: the headers must be on its pages as well
      configureServer: (server) => {
        server.middlewares.use(isolate);
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(isolate);
      },
    },
    // Biome's linter (biome.json), while the dev server runs and in a build. In development it runs again on each change:
    // an error opens a panel over the page, a warning is only listed (the badge in the corner, and the terminal). A build
    // fails on an error and not on a warning; CI and `npm run deploy` refuse warnings too (`npm run lint:strict`).
    // Formatting is not checked here: `npm run check` and CI do that. Its panel is a frame from /__checker/, which the
    // isolated page refuses unless it has the isolation headers: so cross-origin-isolation comes first.
    checker({
      biome: { command: "lint", watchPath: ["src", "test", "e2e", "scripts"], dev: { logLevel: ["error", "warning"] } },
      overlay: { initialIsOpen: "error" },
    }),
    {
      name: "start-files-dev",
      apply: "serve",
      configureServer: (server) => {
        server.middlewares.use("/start-files.json", (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(devStartFiles());
        });
      },
      // the download size, in the page as in a build (there the total has the page's own files too)
      transformIndexHtml: (html) =>
        html.replace("</head>", `  ${engineBytesMeta(JSON.parse(devStartFiles()).compressed)}\n</head>`),
    },
    {
      name: "start-files",
      apply: "build",
      // dist/ is complete: the page's files have their final names and sizes. An error here fails the build.
      closeBundle(error?: Error) {
        if (!error) writeStartFiles(distDir, { stamp, inputs });
      },
    },
  ],
  optimizeDeps: { exclude: ["pyodide", "brotli-wasm"] }, // both load a wasm file by URL, which pre-bundling breaks
  // One file for the worker: no chunks. A chunk (brotli-wasm's, loaded only for a snapshot) imports the bundler's helpers from the
  // worker's entry file, and iOS Safari then runs the entry a second time as another module; the second copy sets onmessage
  // again, so every later message reaches a copy that never got "mount" ("undefined is not an object (evaluating 'V.loadPackage')").
  worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
});
