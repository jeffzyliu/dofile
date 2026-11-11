// What the page's URL and build say, read once at load.
const q = new URLSearchParams(location.search);

/** The snapshot start, the page's default; ?snapshot=0 is the normal boot (Pyodide's runtime and packages from the CDN).
 *  Any other value, a bare ?snapshot included, is the snapshot. */
export const snapshotStart = q.get("snapshot") !== "0";

/** The test hook (e2e): ?test sets window.__dofile; ?test=manual also starts no engine until the test calls start(). */
export const testMode = q.get("test");   // null: no hook

/** ?brotli=wasm: brotli-wasm instead of the browser's own decoder for the snapshot (to compare them). */
export const brotli = q.get("brotli") ?? undefined;

/** The landing page (step 5 builds it): the wordmark and "About dofile" go there. */
export const LANDING_URL = `${import.meta.env.BASE_URL}landing.html`;
