// Where the site's pages live: the one setting of the editor's location (docs/design/SPEC.md, section 8, "URLs"). Read by
// vite.config.ts (the editor's `base` and output folder, the landing page's link to the editor, the editor's link to the
// landing page, the headers file), by the e2e config and by scripts/measure-startup.mjs and scripts/start-files.ts.
//
// Today the editor is a single-page app under /app/ on the site's own origin, and the landing page is the root /.
// To move the editor elsewhere on the same origin: change EDITOR_BASE (or set DOFILE_EDITOR_BASE), nothing else.
// To move it to its own subdomain (app.<domain>), two builds into two folders, deployed as two Workers:
//   DOFILE_EDITOR_BASE=/ DOFILE_SITE_URL=https://<domain>/ npx vite build --outDir <editor folder>
//   DOFILE_EDITOR_URL=https://app.<domain>/ DOFILE_EDITOR_DIR=<editor folder> npx vite build --mode site --outDir <site folder>
// and by hand: a Wrangler config for the editor's Worker, package.json's build and deploy scripts, deploy.yml, and the e2e
// setup (one origin today). SPEC section 8, "URLs", has the exact list and what does not follow the editor to a new origin.

/** The editor's path on its origin, with a slash at each end: Vite's `base` for the editor's build and dev server. */
export const EDITOR_BASE = process.env.DOFILE_EDITOR_BASE ?? "/app/";
/** Where the landing and commands pages send a visitor to open the editor: a path on the site's origin, or a whole URL. */
export const EDITOR_URL = process.env.DOFILE_EDITOR_URL ?? EDITOR_BASE;
/** Where the editor sends a visitor for the landing page (its wordmark, "About dofile", "Close editor", "Browsers that
 *  work"): a path on the editor's origin, or a whole URL. */
export const SITE_URL = process.env.DOFILE_SITE_URL ?? "/";

if (!/^\/(.*\/)?$/.test(EDITOR_BASE)) throw new Error(`EDITOR_BASE must start and end with "/": ${EDITOR_BASE}`);
