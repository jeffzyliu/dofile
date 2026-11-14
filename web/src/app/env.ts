// What the page's URL and build say, read once at load.
import { chooseCap, factsOf } from "../engine/memcap.ts";
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

/** The cap on the engine's heap for this device (engine/memcap.ts): ?memcap=<MB> overrides the device rule (0: no cap), to try a
 *  cap on a real phone. main.tsx logs it and gives it to the transport. */
export const memcap = chooseCap(factsOf(navigator), q.get("memcap"));

/** The landing page (web/landing.html, step 5), the root of the site's own origin: the wordmark, "About dofile" and the
 *  other-tab dialog's "Close editor" go there. A whole URL ending in "/": the build's (scripts/urls.ts SITE_URL); in dev
 *  (`npm run dev`) the pages' dev server, at this page's own host name on its port (scripts/urls.ts DEV_SITE_PORT), so a
 *  phone on the LAN reaches it too. The editor's own files are under import.meta.env.BASE_URL. */
export const LANDING_URL = __SITE_URL__ ?? `${location.protocol}//${location.hostname}:${__DEV_SITE_PORT__}/`;

/** The commands page ("Commands" in the ⋯ menus): the site's /commands/, from the landing page's address (which ends in /). */
export const COMMANDS_URL = `${LANDING_URL}commands/`;

/** ?kblog: an overlay that lists the viewport's events around a phone's keyboard with their times (app/kblog.ts). */
export const kbLog = q.has("kblog");
