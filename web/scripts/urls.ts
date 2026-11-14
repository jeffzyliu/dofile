// Where the site's pages live: the one setting of the editor's location (docs/design/SPEC.md, section 8, "URLs"). Read by
// vite.config.ts (the editor's `base` and output folder, the landing page's link to the editor, the editor's link to the
// landing page, the headers file), by the e2e config and its setup and by scripts/measure-startup.mjs and scripts/start-files.ts.
//
// The site is two origins, built into two folders and deployed as two Workers (wrangler.jsonc, wrangler.app.jsonc):
//   dist/site/   the landing and commands pages, at https://dofile.dev/
//   dist/app/    the editor, at the root of https://app.dofile.dev/ (EDITOR_BASE "/", every path cross-origin isolated)
// `npm run build` makes both. The two URLs they link each other by come from the environment, so a preview deployment (two
// workers.dev addresses) is the same build with other values:
//   DOFILE_SITE_URL=<the landing page's URL>   DOFILE_EDITOR_URL=<the editor's URL>   (each a whole URL ending in "/")
//   DOFILE_URLS=local     both at localhost (below): what `npm run e2e` builds, and what `npm run preview` serves
// With nothing set they are the production addresses. DOFILE_EDITOR_BASE moves the editor to a path (it is "/" at its own
// origin); that and a one-origin layout are not what the scripts or the e2e tests build any more (SPEC section 8, "URLs").

/** The production addresses: what a build with no environment links to. */
export const PRODUCTION_SITE_URL = "https://dofile.dev/";
export const PRODUCTION_EDITOR_URL = "https://app.dofile.dev/";

// `vite preview` serves the site's folder on this port and the editor's on the next one (E2E_PORT: another pair, so two
// worktrees can run the e2e tests at the same time).
const localPort = Number(process.env.E2E_PORT) || 4173;
/** The local addresses, for DOFILE_URLS=local, the e2e config and its tests. */
export const LOCAL_SITE_URL = `http://localhost:${localPort}/`;
export const LOCAL_EDITOR_URL = `http://localhost:${localPort + 1}/`;

/** The two build folders, from web/ (the Wrangler configs' `assets.directory` spell them: a test compares). */
export const SITE_OUT = "dist/site";
export const EDITOR_OUT = "dist/app";

const local = process.env.DOFILE_URLS === "local";

/** The editor's path on its origin, with a slash at each end: Vite's `base` for the editor's build and dev server. */
export const EDITOR_BASE = process.env.DOFILE_EDITOR_BASE ?? "/";
/** Where the landing and commands pages send a visitor to open the editor: a whole URL, ending in "/". */
export const EDITOR_URL = process.env.DOFILE_EDITOR_URL ?? (local ? LOCAL_EDITOR_URL : PRODUCTION_EDITOR_URL);
/** Where the editor sends a visitor for the landing page (its wordmark, "About dofile", "Close editor", "Browsers that
 *  work"; the page's own addresses are joined to it): a whole URL, ending in "/". */
export const SITE_URL = process.env.DOFILE_SITE_URL ?? (local ? LOCAL_SITE_URL : PRODUCTION_SITE_URL);

if (!/^\/(.*\/)?$/.test(EDITOR_BASE)) throw new Error(`EDITOR_BASE must start and end with "/": ${EDITOR_BASE}`);
// the links are joined to these ("commands/", "#browsers"): a URL without its slash would give "https://x.workers.devcommands/".
// Both must be whole http(s) URLs: "x.workers.dev/" would make a relative link, and the build would take the site and the
// editor for one origin (the editor's isolation headers on the landing page).
for (const [name, url] of [
  ["DOFILE_EDITOR_URL", EDITOR_URL],
  ["DOFILE_SITE_URL", SITE_URL],
] as const) {
  if (!/^https?:\/\/[^/]+/.test(url)) throw new Error(`${name} must be a whole http(s) URL: ${url}`);
  if (!url.endsWith("/")) throw new Error(`${name} must end with "/": ${url}`);
}
