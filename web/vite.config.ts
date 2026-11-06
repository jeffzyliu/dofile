import { defineConfig, type Connect } from "vite";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";

// the dofile wheel the page installs: the newest in ../dist (`npm run wheel`), served from public/
const dist = new URL("../dist/", import.meta.url);
const wheel = readdirSync(dist).filter(f => f.endsWith(".whl")).sort().at(-1);
if (!wheel) throw new Error("no wheel in ../dist: run `npm run wheel`");
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
copyFileSync(new URL(wheel, dist), new URL(`./public/${wheel}`, import.meta.url));

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
    __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/`),
  },
  plugins: [{
    name: "cross-origin-isolation",
    configureServer: server => { server.middlewares.use(isolate); },
    configurePreviewServer: server => { server.middlewares.use(isolate); },
  }],
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
});
