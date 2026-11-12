// What the page's URL and build say, read once at load.
import type { About } from "../engine/types.ts";

const q = new URLSearchParams(location.search);

/** What the page shows of the engine, with or without one: dofile's version (the "About dofile" hint), the engine's
 *  commit and the Stata version it emulates (the log's head, step 4b). Compiled in (scripts/build-id.ts, about()): the
 *  page is built against one wheel, so these are what `boot` answers when the engine starts (test/engine.test.ts
 *  compares them). */
export const ABOUT: Pick<About, "dofile" | "engine_commit" | "stata_version"> = __ABOUT__;

/** The snapshot start, the page's default; ?snapshot=0 is the normal boot (Pyodide's runtime and packages from the CDN).
 *  Any other value, a bare ?snapshot included, is the snapshot. */
export const snapshotStart = q.get("snapshot") !== "0";

/** The test hook (e2e): ?test sets window.__dofile; ?test=manual also starts no engine until the test calls start(). */
export const testMode = q.get("test"); // null: no hook

/** ?brotli=wasm: brotli-wasm instead of the browser's own decoder for the snapshot (to compare them). */
export const brotli = q.get("brotli") ?? undefined;

/** The landing page (web/landing.html, step 5): the wordmark, "About dofile" and the other-tab dialog's "Close editor" go
 *  there. The editor is the page at the site's root (`./` from the landing page); to make the landing page the root
 *  instead, move index.html and change these two paths (the e2e tests open the editor at `/`). */
export const LANDING_URL = `${import.meta.env.BASE_URL}landing.html`;
