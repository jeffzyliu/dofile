// Where the site's pages live: the one setting of the editor's location (docs/design/SPEC.md, section 8, "URLs"). Read by
// vite.config.ts (the editor's `base` and output folder, the landing page's link to the editor, the editor's link to the
// landing page, the headers file), by the e2e config and by scripts/measure-startup.mjs and scripts/start-files.ts.
//
// Today the editor is a single-page app under /app/ on the site's own origin, and the landing page is the root /.
// To move the editor elsewhere on the same origin: change EDITOR_BASE (or set DOFILE_EDITOR_BASE), nothing else.
// To move it to its own subdomain (app.<domain>): set DOFILE_EDITOR_BASE=/ (the editor at the root of its origin),
// DOFILE_EDITOR_URL=https://app.<domain>/ (the landing page's links) and DOFILE_SITE_URL=https://<domain>/ (the editor's
// links back), and deploy the two parts as two Workers (SPEC section 8 lists the steps and what does not follow the move).

/** The editor's path on its origin, with a slash at each end: Vite's `base` for the editor's build and dev server. */
export const EDITOR_BASE = process.env.DOFILE_EDITOR_BASE ?? "/app/";
/** Where the landing and commands pages send a visitor to open the editor: a path on the site's origin, or a whole URL. */
export const EDITOR_URL = process.env.DOFILE_EDITOR_URL ?? EDITOR_BASE;
/** Where the editor sends a visitor for the landing page (its wordmark, "About dofile", "Close editor", "Browsers that
 *  work"): a path on the editor's origin, or a whole URL. */
export const SITE_URL = process.env.DOFILE_SITE_URL ?? "/";

if (!/^\/(.*\/)?$/.test(EDITOR_BASE)) throw new Error(`EDITOR_BASE must start and end with "/": ${EDITOR_BASE}`);
