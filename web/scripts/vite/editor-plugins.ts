import { writeFileSync } from "node:fs";

import type { Plugin } from "vite";
import checker from "vite-plugin-checker";

import { outDirOf } from "./paths.ts";

import type { BuildInputs } from "../build-id.ts";
import { headersFile } from "../site-pages.ts";
import { engineBytesMeta, writeStartFiles } from "../start-files.ts";
import { PRODUCTION } from "../urls.ts";
import { hideHeadersFile, isolate, slash } from "./headers.ts";
import { isSitePage } from "./site-plugins.ts";

/**
 * Where the editor's build goes, as Vite resolved it (`vite build --outDir` too).
 * @param defaultDir - EDITOR_OUT, absolute
 * @returns the plugin that learns it, and `dir()`, which is valid once the build has started
 */
export function editorOut(defaultDir: string): { plugin: Plugin; dir: () => string } {
  let out = defaultDir;
  return {
    plugin: {
      name: "editor-out",
      apply: "build",
      configResolved(config) {
        out = outDirOf(config); // Vite empties it before the build (emptyOutDir)
      },
    },
    dir: () => out,
  };
}

export const crossOriginIsolation: Plugin = {
  name: "cross-origin-isolation",
  enforce: "pre", // before the checker, which is "pre" too: the headers must be on its pages as well
  configureServer: (server) => {
    server.middlewares.use(isolate);
  },
};

// Biome's linter (biome.json), in dev and in a build. In dev it runs on each change: an error opens a panel over the
// page, a warning is only listed. A build fails on an error, not a warning (CI and `npm run deploy` refuse warnings:
// `npm run lint:strict`). Its panel is a frame from the dev server, which the isolated page refuses unless it has the
// isolation headers: so crossOriginIsolation comes first.
export const lint = () =>
  checker({
    biome: {
      command: "lint",
      watchPath: ["src", "test", "e2e", "scripts"],
      dev: { logLevel: ["error", "warning"] },
    },
    overlay: { initialIsOpen: "error" },
  });

/** The dev server's start-files.json, and the download size in the page, as in a build (there the total has the page's own files too). */
export const startFilesDev = (devList: () => string): Plugin => ({
  name: "start-files-dev",
  apply: "serve",
  configureServer: (server) => {
    server.middlewares.use("/start-files.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(devList());
    });
  },
  transformIndexHtml: (html, ctx) =>
    isSitePage(ctx.path)
      ? html
      : html.replace("</head>", `  ${engineBytesMeta(JSON.parse(devList()).download)}\n</head>`),
});

/**
 * A build writes start-files.json and the editor's own `_headers`: the editor's folder is complete, its files have their
 * final names and sizes. An error here fails the build.
 */
export const startFiles = (out: () => string, stamp: string, inputs: BuildInputs): Plugin => ({
  name: "start-files",
  apply: "build",
  closeBundle(error?: Error) {
    if (error) return;
    writeStartFiles(out(), { stamp, inputs });
    writeFileSync(`${out()}/_headers`, headersFile("/", !PRODUCTION));
  },
});

/** The editor's folder, served as its host serves it: every path isolated (its _headers), a missing page a 404. */
export const editorPreview: Plugin = {
  name: "editor-preview",
  configurePreviewServer: (server) => {
    server.middlewares.use(isolate);
    server.middlewares.use(slash("/"));
    hideHeadersFile(server.middlewares);
  },
};
