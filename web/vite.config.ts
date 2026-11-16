import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connect, defineConfig, type Plugin, searchForWorkspaceRoot, type UserConfig } from "vite";
import checker from "vite-plugin-checker";
import { about, buildId, inputs as readInputs, staleness } from "./scripts/build-id.ts";
import {
  canonicalURL,
  deniedInBrowser,
  engineMB,
  fillCommands,
  fillTokens,
  headersFile,
  SITE_FILES,
  sitePageFor,
} from "./scripts/site-pages.ts";
import { engineBytesMeta, listStartFiles, RUNTIME_FILES, writeStartFiles } from "./scripts/start-files.ts";
import {
  DEV_EDITOR_PORT,
  DEV_SITE_PORT,
  devURL,
  EDITOR_BASE,
  EDITOR_OUT,
  EDITOR_URL,
  PRODUCTION,
  SITE_OUT,
  SITE_URL,
  URLS_MISSING,
} from "./scripts/urls.ts";
import commandData from "./src/stata/commands.json" with { type: "json" };

// Two builds make the site (`npm run build`), and two dev servers serve it (docs/design/SPEC.md, section 8, "URLs"):
//  - the editor (`vite build`): a single-page app at the root of its own origin (EDITOR_BASE "/", scripts/urls.ts), built
//    into dist/app/ (EDITOR_OUT, or `--outDir`) with its public/ files, start-files.json and _headers.
//  - the landing and commands pages (`vite build --mode site`): static HTML at the root of another origin, in dist/site/
//    (SITE_OUT, or `--outDir`). Built after the editor: they say its download size, read from its start-files.json
//    (EDITOR_OUT, or DOFILE_EDITOR_DIR). It refuses to build into the editor's own folder.
//  - Both builds refuse to start unless the environment names the addresses they link each other by (scripts/urls.ts). A
//    production build gives each page a canonical link; any other build writes `X-Robots-Tag: noindex` into _headers.
//  - `vite` (dev) serves the editor on DEV_EDITOR_PORT; `vite --mode site` the pages on DEV_SITE_PORT (`npm run dev` starts
//    both). With EDITOR_BASE other than "/" the editor's server serves the two pages too.
//  - `vite preview` serves the editor's folder, or with `--mode site` the pages'.

// What the page is built from (scripts/build-id.ts): the dofile wheel (the newest in ../dist), the extra wheels
// (web/wheels/: pyreadstat built for Pyodide) and the Pyodide version, with their hashes.
const inputs = readInputs(),
  wheel = inputs.wheel,
  extraWheels = Object.keys(inputs.extraWheels);
// One stamp per `vite build`, or per dev-server start (this file is loaded once for each). The page's build id and the one
// in start-files.json are both made with it (client.ts, checkBuild).
const stamp = randomUUID();

// the dofile wheel and the extra wheels, served from public/
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
copyFileSync(new URL(`../dist/${wheel}`, import.meta.url), new URL(`./public/${wheel}`, import.meta.url));
for (const f of extraWheels)
  copyFileSync(new URL(`./wheels/${f}`, import.meta.url), new URL(`./public/${f}`, import.meta.url));

// The snapshot start takes Pyodide's runtime from the page's own origin: its three files are copied from the npm package
// into public/pyodide/ (gitignored). ?snapshot=0, the normal boot, keeps the CDN, which also has the packages.
const pyodide = inputs.pyodide;
mkdirSync(new URL("./public/pyodide/", import.meta.url), { recursive: true });
for (const f of RUNTIME_FILES)
  copyFileSync(
    new URL(`./node_modules/pyodide/${f}`, import.meta.url),
    new URL(`./public/pyodide/${f}`, import.meta.url),
  );

// start-files.json (scripts/start-files.ts): a build writes it into dist/ once the page's own files exist, and its total
// into dist/index.html; it fails on a stale snapshot. The dev server makes it from public/, again whenever the snapshot
// was rebuilt: a stale snapshot is then `updated` in the page, and one rebuilt to these inputs while the server runs is
// accepted without a restart (same stamp, same inputs).
const publicDir = fileURLToPath(new URL("./public", import.meta.url)),
  siteDir = fileURLToPath(new URL(`./${SITE_OUT}`, import.meta.url)), // the pages' root: what their Worker serves
  // the editor's build: EDITOR_OUT unless `vite build --outDir` says otherwise; the site's build reads the editor's
  // start-files.json from DOFILE_EDITOR_DIR, else from here
  editorDefault = fileURLToPath(new URL(`./${EDITOR_OUT}`, import.meta.url)),
  editorSource = resolve(process.env.DOFILE_EDITOR_DIR ?? editorDefault);
/** A build's output folder, as Vite resolved it (`build.outDir`, or `--outDir`). */
const outDirOf = (config: { root: string; build: { outDir: string } }) => resolve(config.root, config.build.outDir);
/** Whether the editor is on another origin than the static pages (EDITOR_URL a whole URL; none: a dev or preview server). */
const editorElsewhere = EDITOR_URL === undefined || /^[a-z][a-z0-9+.-]*:/i.test(EDITOR_URL);
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
// WebKit refuses a worker script whose cached 304 reply lacks COEP. The static host must do the same (dist/app/_headers).
// The dev server sends them everywhere (the checker's panel, a frame, needs them too); the editor's preview too; the
// pages' preview, like their host, none (unless the editor is on their origin).
const isolate: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
};
const isolateEditor: Connect.NextHandleFunction = (req, res, next) =>
  (req.url ?? "").startsWith(EDITOR_BASE) ? isolate(req, res, next) : next();

// A folder's other addresses go to the folder, the query kept, as the host does (Cloudflare's html_handling
// "auto-trailing-slash", seen in `wrangler dev`): /commands, /commands.html and /commands/index.html to /commands/;
// /index.html to /. `folders`: the origin's folders, each with a slash at each end ("/commands/"; "/" is the root).
const slash =
  (...folders: string[]): Connect.NextHandleFunction =>
  (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const to = p.endsWith("/index.html")
      ? p.slice(0, -"index.html".length)
      : folders
          .filter((f) => f !== "/")
          .map((f) => f.slice(0, -1))
          .find((f) => p === f || p === `${f}.html`)
          ?.concat("/");
    if (!to) return next();
    res.writeHead(307, { Location: `${to}${url.search}` }).end();
  };

// The landing and commands pages, filled (scripts/site-pages.ts). `path` is the page's source path in web/ ("/landing.html").
const fillSite = (html: string, path: string, engineBytes: number) => {
  const tokens = { version: about(inputs).dofile, engineMB: engineMB(engineBytes), editorURL: EDITOR_URL };
  const filled = fillTokens(html, tokens);
  return path.endsWith("/commands.html") ? fillCommands(filled, commandData, deniedInBrowser()) : filled;
};
const isSitePage = (path: string) => Object.keys(SITE_FILES).some((p) => path.endsWith(`/${p}`));

/** The editor's built list, for the site's build: the download size its pages state. */
function editorList(): { download: number } {
  const file = `${editorSource}/start-files.json`;
  if (!existsSync(file))
    throw new Error(
      `site: no ${file}; build the editor first (\`npm run build\` does both; DOFILE_EDITOR_DIR names an editor built elsewhere)`,
    );
  return JSON.parse(readFileSync(file, "utf8"));
}

// A dev server's static pages: / and /commands/, filled and transformed as a build does, before Vite's own pages (so /
// is never the editor's index.html). The editor's address comes from the request's Host header, so a phone on the LAN
// gets the computer's. The pages' source files are not served as pages under `root`.
const sitePagesDev = (root: string, editorURL: (host: string) => string): Plugin => ({
  name: "site-pages-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(slash(root, "/commands/"));
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (Object.keys(SITE_FILES).some((p) => path === `${root}${p}`)) {
        res.statusCode = 404;
        return void res.end();
      }
      const page = sitePageFor(path);
      if (!page) return next();
      try {
        const html = readFileSync(fileURLToPath(new URL(`./${page}`, import.meta.url)), "utf8");
        const filled = fillTokens(html, { editorURL: editorURL(req.headers.host ?? "localhost") });
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(`/${page}`, filled, req.originalUrl));
      } catch (e) {
        next(e);
      }
    });
  },
});

// A production build's canonical links (canonicalURL): the copies served at workers.dev addresses defer to the production
// ones. Other builds have none (their _headers say noindex instead).
const canonical: Plugin = {
  name: "canonical",
  apply: "build",
  transformIndexHtml: (html, ctx) =>
    PRODUCTION && SITE_URL && EDITOR_URL
      ? {
          html,
          tags: [
            {
              tag: "link",
              attrs: { rel: "canonical", href: canonicalURL(ctx.path.replace(/^\//, ""), SITE_URL, EDITOR_URL) },
              injectTo: "head",
            },
          ],
        }
      : html,
};

const sitePages: Plugin = {
  name: "site-pages",
  transformIndexHtml: {
    order: "pre",
    handler(html, ctx) {
      if (!isSitePage(ctx.path)) return html;
      return fillSite(html, ctx.path, ctx.server ? JSON.parse(devStartFiles()).download : editorList().download);
    },
  },
};

// The site's build: each page to the path it is served at, and the headers file. It refuses to write into the editor's own
// folder: with the editor at the root of its origin, the landing page would take the place of the editor's index.html.
let siteOut = siteDir;
const siteFiles: Plugin = {
  name: "site-files",
  apply: "build",
  configResolved(config) {
    siteOut = outDirOf(config);
    // the site's build empties its folder, so a folder that holds the editor's (dist/ around dist/app/) would delete it too
    const fromSite = relative(siteOut, editorSource);
    if (siteOut === editorSource || (fromSite && !fromSite.startsWith("..") && !isAbsolute(fromSite)))
      throw new Error(
        `site: ${siteOut} is or holds the editor's folder ${editorSource} (EDITOR_BASE ${EDITOR_BASE}); its index.html is the editor's page. Build the ` +
          "landing and commands pages into another folder (`vite build --mode site --outDir <folder>`), as their own site",
      );
  },
  closeBundle(error?: Error) {
    if (error) return;
    for (const [source, served] of Object.entries(SITE_FILES)) {
      mkdirSync(dirname(`${siteOut}/${served}`), { recursive: true });
      renameSync(`${siteOut}/${source}`, `${siteOut}/${served}`);
    }
    const headers = headersFile(editorElsewhere ? null : EDITOR_BASE, !PRODUCTION);
    if (headers) writeFileSync(`${siteOut}/_headers`, headers);
  },
};

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
    sitePagesDev("/", (host) => devURL(host, DEV_EDITOR_PORT)),
    sitePages,
    siteFiles,
    canonical,
    {
      name: "site-preview",
      configurePreviewServer: (server) => {
        server.middlewares.use(slash("/commands/", ...(editorElsewhere ? [] : [EDITOR_BASE])));
        if (!editorElsewhere) server.middlewares.use(isolateEditor); // else the pages' host sends no isolation: their _headers has none
        // _headers is the host's setting, not a file of the site (the host does not serve it either)
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
const editor = (dev: boolean): UserConfig => ({
  // No fallback to the editor for a path that is not a file: a missing page is a 404
  appType: "mpa",
  base: EDITOR_BASE,
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
    __WHEEL__: JSON.stringify(wheel),
    __EXTRA_WHEELS__: JSON.stringify(extraWheels),
    __BUILD_ID__: JSON.stringify(buildId(stamp, inputs)), // start-files.json must carry the same (client.ts, checkBuild)
    __PYODIDE__: JSON.stringify(`https://cdn.jsdelivr.net/pyodide/v${pyodide}/full/`),
    __ABOUT__: JSON.stringify(about(inputs)), // the version, the engine's commit, the Stata version: app/env.ts ABOUT
    // the landing page, from the editor (app/env.ts LANDING_URL): the build's address; null in dev, where the page finds
    // the pages' dev server at its own host name on DEV_SITE_PORT
    __SITE_URL__: JSON.stringify(dev ? null : (SITE_URL ?? null)),
    __DEV_SITE_PORT__: JSON.stringify(DEV_SITE_PORT),
  },
  plugins: [
    {
      name: "editor-out",
      apply: "build",
      configResolved(config) {
        editorOut = outDirOf(config); // Vite empties it before the build (emptyOutDir)
      },
    },
    {
      name: "cross-origin-isolation",
      enforce: "pre", // before the checker below, which is "pre" too: the headers must be on its pages as well
      configureServer: (server) => {
        server.middlewares.use(isolate);
      },
    },
    // Biome's linter (biome.json), in dev and in a build. In dev it runs on each change: an error opens a panel over the
    // page, a warning is only listed. A build fails on an error, not a warning (CI and `npm run deploy` refuse warnings:
    // `npm run lint:strict`). Its panel is a frame from the dev server, which the isolated page refuses unless it has the
    // isolation headers: so cross-origin-isolation comes first.
    checker({
      biome: {
        command: "lint",
        watchPath: ["src", "test", "e2e", "scripts"],
        dev: { logLevel: ["error", "warning"] },
      },
      overlay: { initialIsOpen: "error" },
    }),
    ...(EDITOR_BASE === "/" ? [] : [sitePagesDev(EDITOR_BASE, (host) => `http://${host}${EDITOR_BASE}`)]),
    sitePages,
    canonical,
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
          : html.replace("</head>", `  ${engineBytesMeta(JSON.parse(devStartFiles()).download)}\n</head>`),
    },
    {
      name: "start-files",
      apply: "build",
      // the editor's folder is complete: its files have their final names and sizes. An error here fails the build.
      // An editor at the root of its own origin writes the host's headers file itself; under a path, the site's build
      // writes it (site-pages.ts, headersFile).
      closeBundle(error?: Error) {
        if (error) return;
        writeStartFiles(editorOut, { stamp, inputs });
        if (EDITOR_BASE === "/") writeFileSync(`${editorOut}/_headers`, headersFile("/", !PRODUCTION));
      },
    },
  ],
  optimizeDeps: { exclude: ["pyodide", "brotli-wasm"] }, // both load a wasm file by URL, which pre-bundling breaks
  // One file for the worker: no chunks. A chunk (brotli-wasm's, loaded only for a snapshot) imports the bundler's helpers
  // from the worker's entry file, and iOS Safari then runs the entry a second time as another module; the second copy
  // sets onmessage again, so every later message reaches a copy that never got "mount" ("undefined is not an object
  // (evaluating 'V.loadPackage')").
  worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
});

// The editor's folder, served as its host serves it: every path isolated (its _headers), a missing page a 404.
const editorPreview = (): UserConfig => ({
  appType: "mpa",
  base: EDITOR_BASE,
  build: { outDir: editorDefault },
  plugins: [
    {
      name: "editor-preview",
      configurePreviewServer: (server) => {
        server.middlewares.use(isolate);
        server.middlewares.use(slash(EDITOR_BASE));
        // _headers is the host's setting, not a file of the site (the host does not serve it either)
        server.middlewares.use("/_headers", (_req, res) => {
          res.statusCode = 404;
          res.end();
        });
      },
    },
  ],
});

export default defineConfig(({ command, mode, isPreview }) => {
  // no default: a build for production says so (scripts/urls.ts)
  if (command === "build" && !(SITE_URL && EDITOR_URL)) throw new Error(URLS_MISSING);
  return mode === "site" ? site() : isPreview ? editorPreview() : editor(command === "serve");
});
