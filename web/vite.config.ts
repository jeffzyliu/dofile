import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import type { BuildInputs } from "./scripts/build-id.ts";
import { about, buildId, inputs as readInputs, staged } from "./scripts/build-id.ts";
import { SITE_FILES } from "./scripts/site-pages.ts";
import {
  DEV_EDITOR_PORT,
  DEV_SITE_PORT,
  devURL,
  EDITOR_OUT,
  EDITOR_URL,
  SITE_OUT,
  SITE_URL,
  URLS_MISSING,
} from "./scripts/urls.ts";
import {
  crossOriginIsolation,
  editorOut,
  editorPreview,
  lint,
  startFiles,
  startFilesDev,
} from "./scripts/vite/editor-plugins.ts";
import { canonical, siteFiles, sitePages, sitePagesDev, sitePreview } from "./scripts/vite/site-plugins.ts";
import { startListDev } from "./scripts/vite/start-list-dev.ts";

// Two builds make the site (`npm run build`), and two dev servers serve it (docs/design/SPEC.md, section 8, "URLs"):
//  - the editor (`vite build`): a single-page app at the root of its own origin (scripts/urls.ts), built
//    into dist/app/ (EDITOR_OUT, or `--outDir`) with its public/ files, start-files.json and _headers.
//  - the landing and commands pages (`vite build --mode site`): static HTML at the root of another origin, in dist/site/
//    (SITE_OUT, or `--outDir`). Built after the editor: they say its download size, read from its start-files.json
//    (EDITOR_OUT, or DOFILE_EDITOR_DIR). It refuses to build into the editor's own folder.
//  - Both builds refuse to start unless the environment names the addresses they link each other by (scripts/urls.ts). A
//    production build gives each page a canonical link; any other build writes `X-Robots-Tag: noindex` into _headers.
//  - `vite` (dev) serves the editor on DEV_EDITOR_PORT; `vite --mode site` the pages on DEV_SITE_PORT (`npm run dev` starts
//    both).
//  - `vite preview` serves the editor's folder, or with `--mode site` the pages'. It needs no wheel and no public/.
//  - The config writes no file. public/ (the wheels and Pyodide's runtime) is staged by `npm run stage` (scripts/stage.ts), which
//    `dev` and `build` run first; the editor's `vite` and `vite build` fail when it is not staged, or staged for other inputs.

// What the page is built from (scripts/build-id.ts): the dofile wheel (the newest in .wheel/), the extra wheels
// (web/wheels/: pyreadstat built for Pyodide) and the Pyodide version, with their hashes. Read when a command needs it: a
// preview serves a built folder and needs none, and the URLs check comes before it.
let read: BuildInputs | undefined;
const inputs = () => (read ??= readInputs());
// One stamp per `vite build`, or per dev-server start (this file is loaded once for each). The page's build id and the one
// in start-files.json are both made with it (client.ts, checkBuild).
const stamp = randomUUID();

const publicDir = fileURLToPath(new URL("./public", import.meta.url));
const siteDir = fileURLToPath(new URL(`./${SITE_OUT}`, import.meta.url)); // the pages' root: what their Worker serves
// the editor's build: EDITOR_OUT unless `vite build --outDir` says otherwise; the site's build reads the editor's
// start-files.json from DOFILE_EDITOR_DIR, else from here
const editorDefault = fileURLToPath(new URL(`./${EDITOR_OUT}`, import.meta.url));
const editorSource = resolve(process.env.DOFILE_EDITOR_DIR ?? editorDefault);
// start-files.json (scripts/start-files.ts): a build writes it into dist/ once the page's own files exist, and its total
// into dist/index.html; it fails on a stale snapshot (scripts/vite/editor-plugins.ts). The dev server makes it from public/.
const devList = startListDev(publicDir, stamp, inputs);

// The landing and commands pages' build, dev server and preview (`--mode site`).
const site = (): UserConfig => ({
  appType: "mpa", // a path that is no file is a 404: never the editor in its place
  base: "/",
  server: { port: DEV_SITE_PORT, strictPort: true }, // the editor's dev server links here
  publicDir: false, // the editor's public files (snapshot, runtime, wheels) are its own build's
  build: {
    outDir: siteDir,
    emptyOutDir: true, // the pages' folder is their own (never the editor's: siteFiles refuses that)
    modulePreload: { polyfill: false }, // no script but the pages' own
    rollupOptions: {
      input: Object.fromEntries(
        Object.keys(SITE_FILES).map((p) => [
          p.replace(/\.html$/, ""),
          fileURLToPath(new URL(`./${p}`, import.meta.url)),
        ]),
      ),
    },
  },
  plugins: [
    sitePagesDev((host) => devURL(host, DEV_EDITOR_PORT)),
    sitePages(editorSource, inputs, devList),
    siteFiles(siteDir, editorSource),
    canonical,
    sitePreview,
  ],
});

// The editor's build and the dev server.
const out = editorOut(editorDefault);
const editor = (dev: boolean): UserConfig => {
  const now = inputs();
  const unstaged = staged(now);
  if (unstaged) throw new Error(unstaged);
  const extraWheels = Object.keys(now.extraWheels);
  return {
    // No fallback to the editor for a path that is not a file: a missing page is a 404
    appType: "mpa",
    base: "/",
    server: {
      port: DEV_EDITOR_PORT, // the pages' dev server links here
      strictPort: true,
      // a worktree's node_modules may be a symlink to the main checkout's: Vite serves brotli-wasm's .wasm by its real
      // path, which is outside the default allow list (403)
      fs: {
        allow: [
          searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))),
          realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url))),
        ],
      },
    },
    build: { outDir: editorDefault, emptyOutDir: true },
    define: {
      __WHEEL__: JSON.stringify(now.wheel),
      __EXTRA_WHEELS__: JSON.stringify(extraWheels),
      __BUILD_ID__: JSON.stringify(buildId(stamp, now)), // start-files.json must carry the same (client.ts, checkBuild)
      __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${now.pyodide}/full/`),
      __ABOUT__: JSON.stringify(about(now)), // the version, the engine's commit, the Stata version: app/env.ts ABOUT
      // the landing page, from the editor (app/env.ts LANDING_URL): the build's address; null in dev, where the page finds
      // the pages' dev server at its own host name on DEV_SITE_PORT
      __SITE_URL__: JSON.stringify(dev ? null : (SITE_URL ?? null)),
      __DEV_SITE_PORT__: JSON.stringify(DEV_SITE_PORT),
    },
    plugins: [
      out.plugin,
      crossOriginIsolation,
      lint(),
      sitePages(editorSource, inputs, devList),
      canonical,
      startFilesDev(devList),
      startFiles(out.dir, stamp, now),
    ],
    optimizeDeps: { exclude: ["pyodide", "brotli-wasm"] }, // both load a wasm file by URL, which pre-bundling breaks
    // One file for the worker: no chunks. A chunk (brotli-wasm's, loaded only for a snapshot) imports the bundler's helpers
    // from the worker's entry file, and iOS Safari then runs the entry a second time as another module; the second copy
    // sets onmessage again, so every later message reaches a copy that never got "mount" ("undefined is not an object
    // (evaluating 'V.loadPackage')").
    worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
  };
};

const editorPreviewConfig = (): UserConfig => ({
  appType: "mpa",
  base: "/",
  build: { outDir: editorDefault },
  plugins: [editorPreview],
});

export default defineConfig(({ command, mode, isPreview }) => {
  // no default: a build for production says so (scripts/urls.ts)
  if (command === "build" && !(SITE_URL && EDITOR_URL)) throw new Error(URLS_MISSING);
  return mode === "site" ? site() : isPreview ? editorPreviewConfig() : editor(command === "serve");
});
