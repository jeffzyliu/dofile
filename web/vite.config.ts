import { defineConfig, type Connect } from "vite";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// the dofile wheel the page installs: the newest in ../dist (`npm run wheel`), served from public/
const dist = new URL("../dist/", import.meta.url);
const wheel = readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1);
if (!wheel) throw new Error("no wheel in ../dist: run `npm run wheel`");
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
copyFileSync(new URL(wheel, dist), new URL(`./public/${wheel}`, import.meta.url));

// the extra wheels (web/wheels/: pyreadstat built for Pyodide), served next to it; the page installs them after the dofile wheel
const wheelsDir = new URL("./wheels/", import.meta.url);
const extraWheels = readdirSync(wheelsDir).filter(f => f.endsWith(".whl")).sort();
for (const f of extraWheels) copyFileSync(new URL(f, wheelsDir), new URL(`./public/${f}`, import.meta.url));

// Pyodide's runtime and packages come from its CDN, the same version as the npm package (decision 7: measure first)
const pyodide = JSON.parse(readFileSync(new URL("./node_modules/pyodide/package.json", import.meta.url), "utf8")).version;

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
    __WHEEL_HASH__: JSON.stringify(createHash("sha256").update(readFileSync(new URL(wheel, dist))).digest("hex")),   // a snapshot must be of this wheel
    __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/`),
  },
  plugins: [{
    name: "cross-origin-isolation",
    configureServer: server => { server.middlewares.use(isolate); },
    configurePreviewServer: server => { server.middlewares.use(isolate); },
  }],
  optimizeDeps: { exclude: ["pyodide", "brotli-wasm"] },   // both load a wasm file by URL, which pre-bundling breaks
  // One file for the worker: no chunks. A chunk (brotli-wasm's, loaded only for a snapshot) imports the bundler's helpers from the
  // worker's entry file, and iOS Safari then runs the entry a second time as another module; the second copy sets onmessage
  // again, so every later message reaches a copy that never got "mount" ("undefined is not an object (evaluating 'V.loadPackage')").
  worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
});
