import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connect, defineConfig, type Plugin, type UserConfig } from "vite";
import checker from "vite-plugin-checker";
import { about, buildId, inputs as readInputs, staleness } from "./scripts/build-id.ts";
import {
  deniedInBrowser,
  engineMB,
  fillCommands,
  fillTokens,
  headersFile,
  SITE_FILES,
  sitePageFor,
} from "./scripts/site-pages.ts";
import { engineBytesMeta, listStartFiles, RUNTIME_FILES, writeStartFiles } from "./scripts/start-files.ts";
import { EDITOR_BASE, EDITOR_URL, SITE_URL } from "./scripts/urls.ts";
import commandData from "./src/stata/commands.json" with { type: "json" };

// Two builds make the site (`npm run build`), and one dev server serves it (docs/design/SPEC.md, section 8, "URLs"):
//  - the editor (`vite build`): a single-page app under EDITOR_BASE (scripts/urls.ts; /app/ today), built into
//    dist/<EDITOR_BASE> (or `--outDir`) with its public/ files (the wheels, the runtime, the snapshot) and start-files.json.
//    A build into dist/ empties dist/ first, so nothing of an older layout is left to deploy. With EDITOR_BASE "/" (the
//    editor at the root of its own origin) it also writes its own _headers, every path isolated.
//  - the landing and commands pages (`vite build --mode site`): static HTML at the site's root, dist/index.html and
//    dist/commands/index.html (or `--outDir`), with their own two small scripts and stylesheet in assets/, and _headers
//    (the editor's isolation, when the editor is on this origin). Built after the editor: they say the editor's download
//    size, read from its start-files.json (in dist/<EDITOR_BASE>, or DOFILE_EDITOR_DIR). Nothing of public/ and no script of
//    the editor's. It refuses to build into the editor's own folder.
//  - `vite` (dev): the editor's config at EDITOR_BASE, plus the two static pages at / and /commands/ (a middleware).
//  - `vite preview`: all of dist/ at /, with the isolation headers under EDITOR_BASE only, as dist/_headers says for the host.

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
  siteDir = fileURLToPath(new URL("./dist", import.meta.url)), // the site's root: what the host serves
  // the editor's build: dist/<EDITOR_BASE> unless `vite build --outDir` says otherwise (the build takes the resolved folder);
  // the site's build reads the editor's start-files.json from DOFILE_EDITOR_DIR, else from here
  editorDefault = fileURLToPath(new URL(`./dist${EDITOR_BASE}`, import.meta.url)),
  editorSource = resolve(process.env.DOFILE_EDITOR_DIR ?? editorDefault);
/** Whether `dir` is `parent` or a folder inside it. */
const within = (dir: string, parent: string) => {
  const r = relative(parent, dir);
  return !r.startsWith("..") && !isAbsolute(r);
};
/** A build's output folder, as Vite resolved it (`build.outDir`, or `--outDir`). */
const outDirOf = (config: { root: string; build: { outDir: string } }) => resolve(config.root, config.build.outDir);
/** Whether the editor is on another origin than the static pages (EDITOR_URL a whole URL). */
const editorElsewhere = /^[a-z][a-z0-9+.-]*:/i.test(EDITOR_URL);
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
// WebKit refuses a worker script whose cached 304 reply lacks COEP. The static host must do the same (dist/_headers, for the
// editor's path). The dev server sends them everywhere (the checker's panel, a frame, needs them too); preview, like the host,
// only under EDITOR_BASE.
const isolate: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
};
const isolateEditor: Connect.NextHandleFunction = (req, res, next) =>
  (req.url ?? "").startsWith(EDITOR_BASE) ? isolate(req, res, next) : next();

// A folder's other addresses go to the folder, the query kept, as the host does (Cloudflare's html_handling
// "auto-trailing-slash", seen in `wrangler dev`): /app, /app.html and /app/index.html to /app/; /commands, /commands.html and
// /commands/index.html to /commands/; /index.html to /.
const FOLDERS = [EDITOR_BASE, "/commands/"].filter((f) => f !== "/").map((f) => f.slice(0, -1));
const slash: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const to = p.endsWith("/index.html")
    ? p.slice(0, -"index.html".length)
    : FOLDERS.find((f) => p === f || p === `${f}.html`)?.concat("/");
  if (!to) return next();
  res.writeHead(307, { Location: `${to}${url.search}` }).end();
};

// The landing and commands pages: the version, the download size, the editor's address and the commands list
// (scripts/site-pages.ts). `path` is the page's source path in web/ ("/landing.html").
const fillSite = (html: string, path: string, engineBytes: number) => {
  const tokens = { version: about(inputs).dofile, engineMB: engineMB(engineBytes), editorURL: EDITOR_URL };
  const filled = fillTokens(html, tokens);
  return path.endsWith("/commands.html") ? fillCommands(filled, commandData, deniedInBrowser()) : filled;
};
const isSitePage = (path: string) => Object.keys(SITE_FILES).some((p) => path.endsWith(`/${p}`));

/** The editor's built list, for the site's build: the download size its pages state. */
function editorList(): { compressed: number } {
  const file = `${editorSource}/start-files.json`;
  if (!existsSync(file))
    throw new Error(
      `site: no ${file}; build the editor first (\`npm run build\` does both; DOFILE_EDITOR_DIR names an editor built elsewhere)`,
    );
  return JSON.parse(readFileSync(file, "utf8"));
}

// The dev server's static pages: / and /commands/ from web/landing.html and web/commands.html, filled and transformed as
// a build does (their scripts are served from under EDITOR_BASE by the dev server, which a build does not do). The pages'
// source files are not served as pages under EDITOR_BASE.
const siteDev: Plugin = {
  name: "site-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(slash);
    if (EDITOR_BASE === "/") return; // the editor at the root of its own origin: the static pages are another site's
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (Object.keys(SITE_FILES).some((p) => path === `${EDITOR_BASE}${p}`)) {
        res.statusCode = 404;
        return void res.end();
      }
      const page = sitePageFor(path);
      if (!page) return next();
      try {
        const html = readFileSync(fileURLToPath(new URL(`./${page}`, import.meta.url)), "utf8");
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(`/${page}`, html, req.originalUrl));
      } catch (e) {
        next(e);
      }
    });
  },
};

const sitePages: Plugin = {
  name: "site-pages",
  transformIndexHtml: {
    order: "pre",
    handler(html, ctx) {
      if (!isSitePage(ctx.path)) return html;
      return fillSite(html, ctx.path, ctx.server ? JSON.parse(devStartFiles()).compressed : editorList().compressed);
    },
  },
};

// The site's build: each page to the path it is served at, and the headers file (the editor's isolation, when the editor is
// on this origin; none when it has its own). It refuses to write into the editor's own folder: with the editor at the root
// of its origin (EDITOR_BASE "/"), the landing page would take the place of the editor's index.html.
let siteOut = siteDir;
const siteFiles: Plugin = {
  name: "site-files",
  apply: "build",
  configResolved(config) {
    siteOut = outDirOf(config);
    if (siteOut === editorSource)
      throw new Error(
        `site: ${siteOut} is the editor's folder (EDITOR_BASE ${EDITOR_BASE}); its index.html is the editor's page. Build the ` +
          "landing and commands pages into another folder (`vite build --mode site --outDir <folder>`), as their own site",
      );
  },
  closeBundle(error?: Error) {
    if (error) return;
    for (const [source, served] of Object.entries(SITE_FILES)) {
      mkdirSync(dirname(`${siteOut}/${served}`), { recursive: true });
      renameSync(`${siteOut}/${source}`, `${siteOut}/${served}`);
    }
    if (!editorElsewhere) writeFileSync(`${siteOut}/_headers`, headersFile(EDITOR_BASE));
  },
};

// The landing and commands pages' build (`vite build --mode site`), and the server of the whole of dist/ (`vite preview`).
const site = (): UserConfig => ({
  appType: "mpa", // a path that is no file is a 404: never the editor in its place
  base: "/",
  publicDir: false, // the editor's public files (snapshot, runtime, wheels) are its own build's, under EDITOR_BASE
  build: {
    outDir: siteDir,
    emptyOutDir: false, // dist/ holds the editor's build already
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
    sitePages,
    siteFiles,
    {
      name: "site-preview",
      configurePreviewServer: (server) => {
        server.middlewares.use(slash);
        server.middlewares.use(isolateEditor);
        // dist/_headers is the host's setting, not a file of the site (the host does not serve it either)
        server.middlewares.use("/_headers", (_req, res) => {
          res.statusCode = 404;
          res.end();
        });
      },
    },
  ],
});

// The editor's build and the dev server.
let editorOut = editorDefault; // the editor's build folder, as resolved (configResolved below)
const editor = (): UserConfig => ({
  // No fallback to the editor for a path that is not a file: a missing page is a 404 (the editor is a single-page app only
  // in that it is one page; it has no routes of its own)
  appType: "mpa",
  base: EDITOR_BASE,
  build: { outDir: editorDefault, emptyOutDir: true },
  define: {
    __WHEEL__: JSON.stringify(wheel),
    __EXTRA_WHEELS__: JSON.stringify(extraWheels),
    __BUILD_ID__: JSON.stringify(buildId(stamp, inputs)), // start-files.json must carry the same (client.ts, checkBuild)
    __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/`),
    __ABOUT__: JSON.stringify(about(inputs)), // the version, the engine's commit, the Stata version: app/env.ts ABOUT
    __SITE_URL__: JSON.stringify(SITE_URL), // the landing page, from the editor: app/env.ts LANDING_URL
  },
  plugins: [
    {
      // A build into dist/ (or a folder in it) starts from an empty dist/, so nothing of an older layout is left to deploy;
      // a build into a folder elsewhere (`--outDir`) leaves dist/ alone (Vite empties that folder itself)
      name: "editor-out",
      apply: "build",
      configResolved(config) {
        editorOut = outDirOf(config);
        if (within(editorOut, siteDir)) rmSync(siteDir, { recursive: true, force: true });
      },
    },
    {
      name: "cross-origin-isolation",
      enforce: "pre", // before the checker below, which is "pre" too: the headers must be on its pages as well
      configureServer: (server) => {
        server.middlewares.use(isolate);
      },
    },
    // Biome's linter (biome.json), while the dev server runs and in a build. In development it runs again on each change:
    // an error opens a panel over the page, a warning is only listed (the badge in the corner, and the terminal). A build
    // fails on an error and not on a warning; CI and `npm run deploy` refuse warnings too (`npm run lint:strict`).
    // Formatting is not checked here: `npm run check` and CI do that. Its panel is a frame from the dev server, which the
    // isolated page refuses unless it has the isolation headers: so cross-origin-isolation comes first.
    checker({
      biome: {
        command: "lint",
        watchPath: ["src", "test", "e2e", "scripts"],
        dev: { logLevel: ["error", "warning"] },
      },
      overlay: { initialIsOpen: "error" },
    }),
    siteDev,
    sitePages,
    {
      name: "start-files-dev",
      apply: "serve",
      configureServer: (server) => {
        server.middlewares.use(`${EDITOR_BASE}start-files.json`, (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(devStartFiles());
        });
      },
      // the download size, in the page as in a build (there the total has the page's own files too)
      transformIndexHtml: (html, ctx) =>
        isSitePage(ctx.path)
          ? html
          : html.replace("</head>", `  ${engineBytesMeta(JSON.parse(devStartFiles()).compressed)}\n</head>`),
    },
    {
      name: "start-files",
      apply: "build",
      // the editor's folder is complete: its files have their final names and sizes. An error here fails the build.
      // An editor at the root of its own origin is a site of its own: it writes the host's headers file itself (every path
      // isolated); under a path, the site's build writes it (scripts/site-pages.ts, headersFile).
      closeBundle(error?: Error) {
        if (error) return;
        writeStartFiles(editorOut, { stamp, inputs });
        if (EDITOR_BASE === "/") writeFileSync(`${editorOut}/_headers`, headersFile("/"));
      },
    },
  ],
  optimizeDeps: { exclude: ["pyodide", "brotli-wasm"] }, // both load a wasm file by URL, which pre-bundling breaks
  // One file for the worker: no chunks. A chunk (brotli-wasm's, loaded only for a snapshot) imports the bundler's helpers from the
  // worker's entry file, and iOS Safari then runs the entry a second time as another module; the second copy sets onmessage
  // again, so every later message reaches a copy that never got "mount" ("undefined is not an object (evaluating 'V.loadPackage')").
  worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
});

export default defineConfig(({ mode, isPreview }) => (isPreview || mode === "site" ? site() : editor()));
