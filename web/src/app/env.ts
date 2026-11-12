// What the page's URL and build say, read once at load.
import type { About } from "../engine/types.ts";
import { kbModeOf } from "./viewport.ts";

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

/** The landing page (web/landing.html, step 5), the site's root: the wordmark, "About dofile" and the other-tab dialog's
 *  "Close editor" go there. The build sets it (scripts/urls.ts SITE_URL: "/" while the editor is under /app/ on the same
 *  origin, a whole URL once the editor has its own). The editor's own files are under import.meta.env.BASE_URL. */
export const LANDING_URL = __SITE_URL__;

/** The commands page ("Commands" in the ⋯ menus): the site's /commands/, from the landing page's address (which ends in /). */
export const COMMANDS_URL = `${LANDING_URL}commands/`;

/** ?kb=…: the phone keyboard's strategy, an experiment for a real iPhone (docs/phone-keyboard-experiment.md; the modes:
 *  app/viewport.ts KB_MODES). Without the flag, or with an unknown value, "top": the page's behavior before it. */
export const kbMode = kbModeOf(q);
/** ?kblog: the keyboard experiment's overlay, which lists the viewport's events with their times (app/kblog.ts). */
export const kbLog = q.has("kblog");
/** ?slide: .app slides to its place while the keyboard opens or closes, instead of jumping (app.css). */
export const kbSlide = q.has("slide");
