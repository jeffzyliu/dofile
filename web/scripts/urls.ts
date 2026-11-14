// Where the site's pages live: the one setting of the editor's location (docs/design/SPEC.md, section 8, "URLs"). Read by
// vite.config.ts (the editor's `base` and output folder, the landing page's link to the editor, the editor's link to the
// landing page, the dev servers' ports, the headers files and the canonical links), by the e2e config and its setup and by
// scripts/measure-startup.mjs, scripts/start-files.ts and scripts/smoke.ts.
//
// The site is two origins, built into two folders and deployed as two Workers (wrangler.jsonc, wrangler.app.jsonc):
//   dist/site/   the landing and commands pages, at https://dofile.dev/
//   dist/app/    the editor, at the root of https://app.dofile.dev/ (EDITOR_BASE "/", every path cross-origin isolated)
// `npm run build` makes both. The two URLs they link each other by come from the environment, and a build refuses to start
// without them (there is no default, so nothing builds for production by accident). One of:
//   DOFILE_URLS=production   the production addresses (below): what deploy.yml and `npm run deploy` build
//   DOFILE_URLS=local        both at localhost (below): what `npm run e2e` builds, and what `npm run preview` serves
//   DOFILE_SITE_URL=<the landing page's URL> DOFILE_EDITOR_URL=<the editor's URL>   both, each a whole URL ending in "/":
//                            a preview deployment (two workers.dev addresses), `npm run cf:dev`
// An empty value counts as unset (a workflow's input that was not given). The dev servers need none: each finds the other at
// the page's own host name on the other's port (DEV_SITE_PORT, DEV_EDITOR_PORT). DOFILE_EDITOR_BASE moves the editor to a path
// (it is "/" at its own origin); that and a one-origin layout are not what the scripts or the e2e tests build any more (SPEC
// section 8, "URLs").

/** The production addresses: what DOFILE_URLS=production links to. */
export const PRODUCTION_SITE_URL = "https://dofile.dev/";
export const PRODUCTION_EDITOR_URL = "https://app.dofile.dev/";

// `vite preview` serves the site's folder on this port and the editor's on the next one (E2E_PORT: another pair, so two
// worktrees can run the e2e tests at the same time).
const localPort = Number(process.env.E2E_PORT) || 4173;
/** The local addresses, for DOFILE_URLS=local, the e2e config and its tests. */
export const LOCAL_SITE_URL = `http://localhost:${localPort}/`;
export const LOCAL_EDITOR_URL = `http://localhost:${localPort + 1}/`;

/** `npm run dev`: the editor's dev server and the landing and commands pages' (each listens on its port or fails). */
export const DEV_EDITOR_PORT = 5173;
export const DEV_SITE_PORT = 5174;
/** The other dev server's address, from the host a request came to (its Host header, "192.168.1.5:5174"): the same host
 *  name on `port`, so a phone on the LAN is sent to the computer's address, not to its own localhost. */
export function devURL(host: string, port: number): string {
  const url = new URL(`http://${host}`);
  url.port = String(port);
  return `${url.origin}/`;
}

/** The two build folders, from web/ (the Wrangler configs' `assets.directory` spell them: a test compares). */
export const SITE_OUT = "dist/site";
export const EDITOR_OUT = "dist/app";

/** The editor's path on its origin, with a slash at each end: Vite's `base` for the editor's build and dev server. */
export const EDITOR_BASE = process.env.DOFILE_EDITOR_BASE ?? "/";
if (!/^\/(.*\/)?$/.test(EDITOR_BASE)) throw new Error(`EDITOR_BASE must start and end with "/": ${EDITOR_BASE}`);

const env = (name: string) => process.env[name] || undefined; // empty: unset
const urls = env("DOFILE_URLS"),
  siteGiven = env("DOFILE_SITE_URL"),
  editorGiven = env("DOFILE_EDITOR_URL");
// the links are joined to these ("commands/", "#browsers"): a URL without its slash would give "https://x.workers.devcommands/".
// Both must be whole http(s) URLs: "x.workers.dev/" would make a relative link, and the build would take the site and the
// editor for one origin (the editor's isolation headers on the landing page).
for (const [name, url] of [
  ["DOFILE_EDITOR_URL", editorGiven],
  ["DOFILE_SITE_URL", siteGiven],
] as const) {
  if (url === undefined) continue;
  if (!/^https?:\/\/[^/]+/.test(url)) throw new Error(`${name} must be a whole http(s) URL: ${url}`);
  if (!url.endsWith("/")) throw new Error(`${name} must end with "/": ${url}`);
}
if (urls !== undefined && urls !== "production" && urls !== "local")
  throw new Error(`DOFILE_URLS must be "production" or "local": ${urls}`);
if (urls !== undefined && (siteGiven || editorGiven))
  throw new Error(`DOFILE_URLS=${urls} and DOFILE_SITE_URL or DOFILE_EDITOR_URL: give one or the other`);
if (!siteGiven !== !editorGiven)
  throw new Error("DOFILE_SITE_URL and DOFILE_EDITOR_URL go together: give both (or DOFILE_URLS=production or local)");

/** Where the landing and commands pages send a visitor to open the editor: a whole URL, ending in "/". Undefined when the
 *  environment names no addresses: a dev or preview server, never a build (vite.config.ts throws URLS_MISSING). */
export const EDITOR_URL =
  urls === "production" ? PRODUCTION_EDITOR_URL : urls === "local" ? LOCAL_EDITOR_URL : editorGiven;
/** Where the editor sends a visitor for the landing page (its wordmark, "About dofile", "Close editor", "Browsers that
 *  work"; the page's own addresses are joined to it): a whole URL, ending in "/". Undefined as EDITOR_URL is. */
export const SITE_URL = urls === "production" ? PRODUCTION_SITE_URL : urls === "local" ? LOCAL_SITE_URL : siteGiven;
/** A build for the production addresses (however they were given): it has canonical links, and no noindex header. */
export const PRODUCTION = SITE_URL === PRODUCTION_SITE_URL && EDITOR_URL === PRODUCTION_EDITOR_URL;
/** Why `vite build` refuses to start without addresses. */
export const URLS_MISSING =
  "Say which addresses the two builds link each other by: DOFILE_URLS=production (" +
  `${PRODUCTION_SITE_URL} and ${PRODUCTION_EDITOR_URL}), DOFILE_URLS=local (localhost: \`npm run build:local\`), or both ` +
  "DOFILE_SITE_URL and DOFILE_EDITOR_URL (whole URLs ending in /). See web/scripts/urls.ts.";
