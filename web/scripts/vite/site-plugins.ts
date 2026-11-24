import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import commandData from "../../src/stata/commands.json" with { type: "json" };
import { outDirOf } from "./paths.ts";

import type { BuildInputs } from "../build-id.ts";
import { about } from "../build-id.ts";
import {
  canonicalURL,
  engineMB,
  fillCommands,
  fillTokens,
  headersFile,
  SITE_FILES,
  sitePageFor,
} from "../site-pages.ts";
import { EDITOR_URL, PRODUCTION, SITE_URL } from "../urls.ts";
import { hideHeadersFile, slash } from "./headers.ts";

const web = new URL("../../", import.meta.url);

export const isSitePage = (path: string) => Object.keys(SITE_FILES).some((p) => path.endsWith(`/${p}`));

/** The editor's built list, for the site's build: the download size its pages state. */
function editorList(editorSource: string): { download: number } {
  const file = `${editorSource}/start-files.json`;
  if (!existsSync(file))
    throw new Error(
      `site: no ${file}; build the editor first (\`npm run build\` does both; DOFILE_EDITOR_DIR names an editor built elsewhere)`,
    );
  return JSON.parse(readFileSync(file, "utf8"));
}

// A dev server's static pages: / and /commands/, filled and transformed as a build does, before Vite's own pages (so /
// is never the editor's index.html). The editor's address comes from the request's Host header, so a phone on the LAN
// gets the computer's. The pages' source files are not served as pages.
export const sitePagesDev = (editorURL: (host: string) => string): Plugin => ({
  name: "site-pages-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(slash("/", "/commands/"));
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (Object.keys(SITE_FILES).some((p) => path === `/${p}`)) {
        res.statusCode = 404;
        return void res.end();
      }
      const page = sitePageFor(path);
      if (!page) return next();
      try {
        const html = readFileSync(fileURLToPath(new URL(`./${page}`, web)), "utf8");
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
export const canonical: Plugin = {
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

/**
 * The landing and commands pages, filled (scripts/site-pages.ts).
 * @param editorSource - the editor's build folder, whose start-files.json says the download size
 * @param inputs - what the page is built from, read when a page is filled
 * @param devList - the dev server's start-files.json (start-list-dev.ts), which a build reads from the editor's folder instead
 */
export const sitePages = (editorSource: string, inputs: () => BuildInputs, devList: () => string): Plugin => ({
  name: "site-pages",
  transformIndexHtml: {
    order: "pre",
    handler(html, ctx) {
      if (!isSitePage(ctx.path)) return html;
      const engineBytes = ctx.server ? JSON.parse(devList()).download : editorList(editorSource).download;
      const tokens = { version: about(inputs()).dofile, engineMB: engineMB(engineBytes), editorURL: EDITOR_URL };
      const filled = fillTokens(html, tokens);
      return ctx.path.endsWith("/commands.html") ? fillCommands(filled, commandData, commandData.denied) : filled;
    },
  },
});

/**
 * The site's build: each page to the path it is served at, and the headers file. It refuses to write into the editor's own
 * folder: the landing page would take the place of the editor's index.html.
 * @param siteDir - the pages' folder unless `--outDir` says otherwise
 * @param editorSource - the editor's build folder
 */
export function siteFiles(siteDir: string, editorSource: string): Plugin {
  let siteOut = siteDir;
  return {
    name: "site-files",
    apply: "build",
    configResolved(config) {
      siteOut = outDirOf(config);
      // the site's build empties its folder, so a folder that holds the editor's (dist/ around dist/app/) would delete it too
      const fromSite = relative(siteOut, editorSource);
      if (siteOut === editorSource || (fromSite && !fromSite.startsWith("..") && !isAbsolute(fromSite)))
        throw new Error(
          `site: ${siteOut} is or holds the editor's folder ${editorSource}; its index.html is the editor's page. Build the ` +
            "landing and commands pages into another folder (`vite build --mode site --outDir <folder>`), as their own site",
        );
    },
    closeBundle(error?: Error) {
      if (error) return;
      for (const [source, served] of Object.entries(SITE_FILES)) {
        mkdirSync(dirname(`${siteOut}/${served}`), { recursive: true });
        renameSync(`${siteOut}/${source}`, `${siteOut}/${served}`);
      }
      const headers = headersFile(null, !PRODUCTION);
      if (headers) writeFileSync(`${siteOut}/_headers`, headers);
    },
  };
}

/** The pages' folder, served as their host serves it: folders redirect, no isolation. */
export const sitePreview: Plugin = {
  name: "site-preview",
  configurePreviewServer: (server) => {
    server.middlewares.use(slash("/commands/"));
    hideHeadersFile(server.middlewares);
  },
};
