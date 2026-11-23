// What the page's URL and build say, read once at load.

import type { About } from "../engine/types.ts";

import { chooseCap, factsOf } from "../engine/memcap.ts";

const q = new URLSearchParams(location.search);

/** What the page shows of the engine, with or without one running. Compiled in (scripts/build-id.ts): the page is built
 *  against one wheel, so these are what `boot` answers (test/engine.test.ts compares them). */
export const ABOUT: Pick<About, "dofile" | "engine_commit" | "stata_version"> = __ABOUT__;

/** The snapshot start is the default; ?snapshot=0 is the normal boot (Pyodide's runtime and packages from the CDN). */
export const snapshotStart = q.get("snapshot") !== "0";

/** The test hook (e2e): ?test sets window.__dofile; ?test=manual also starts no engine until the test calls start(). */
export const testMode = q.get("test"); // null: no hook

/** ?brotli=wasm: brotli-wasm instead of the browser's own decoder for the snapshot (to compare them). */
export const brotli = q.get("brotli") ?? undefined;

/** The cap on the engine's heap for this device (engine/memcap.ts). ?memcap=<MB> overrides it (0: no cap). */
export const memcap = chooseCap(factsOf(navigator), q.get("memcap"));

/** The landing page (web/landing.html), a URL ending in "/". In dev it is the pages' dev server at this page's own host
 *  name, so a phone on the LAN reaches it too. */
export const LANDING_URL = __SITE_URL__ ?? `${location.protocol}//${location.hostname}:${__DEV_SITE_PORT__}/`;

/** The commands page. */
export const COMMANDS_URL = `${LANDING_URL}commands/`;

/** ?kblog: an overlay of the viewport's events, to measure a phone's keyboard (docs/phone-keyboard-experiment.md). */
export const kbLog = q.has("kblog");
