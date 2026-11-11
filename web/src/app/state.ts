// The page's state: one module of signals (docs/design/SPEC.md, section 8). Any component reads any of them; each is
// written only by the owner named on its line. The controllers that own most of them: engine.js (the engine), run.js
// (runs and their results), files.js (the file list). The types are in types.d.ts.
//
// Plain JavaScript on @preact/signals-core, so the Node tests import it as it is. Components read the same signals through
// @preact/signals (it re-exports this package's signals and re-renders a component that reads `.value`).
import { computed, signal } from "@preact/signals-core";
import { engineBytes as metaEngineBytes } from "../engine/client.ts";
import type { About, Banner, BrowseRows, DataSummary, Dialog, EngineState, FileInfo, Graph, LastRun, Layout, LogItem, Macros, Memory,
  OpenTab, OutputTab, PhoneTab, Results, Theme } from "./types.ts";

// localStorage, which a browser may refuse (some private modes) and Node does not have
export const saved = {
  get: (key: string) => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set: (key: string, value: string | null) => {
    try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); }
    catch { /* not kept: the page works the same this visit */ }
  },
};

// ---- the engine (engine.js) ----
export const engine = signal<EngineState>({ s: "none" });          // engine.js: the one wrapper around EngineClient
export const isolated = signal(Boolean(globalThis.crossOriginIsolated));   // set once at load
export const about = signal<About | null>(null);                     // engine.js, when boot answers
// The download size in bytes as a host sends them: start-files.json's `compressed` total, which the build writes into the
// page (<meta name="dofile-engine-bytes">), so the prompt has it before any download, offline too. null: not a built page
// (a dev server with no snapshot).
export const engineBytes = metaEngineBytes();
export const memory = signal<Memory | null>(null);                    // run.js: after a start and after each run; null on a new engine

// ---- files (files.js) ----
export const files = signal<FileInfo[]>([]);                       // files.js, after every store change and every run
/** Whether the store has a file (folders do not count): "Download all (.zip)" is disabled without one. */
export const hasFiles = computed(() => files.value.some(f => !f.dir));
export const fresh = signal<Set<string>>(new Set());                // files.js: paths the last run created or changed (the "new" badge)
export const persisted = signal<boolean | null>(null);                 // files.js, from storage.persist() and persisted(); null: unknown

// ---- editor tabs (step 4a) ----
export const tabs = signal<OpenTab[]>([]);                        // 4a (files/): adds, closes, renames, orders; `dirty` only through setDirty()
export const activeTab = signal<string | null>(null);                 // 4a: the tabs, and the file tree when it opens a file (files/open.js)

/** The unsaved dot of an open file: the editor (4b) sets it on an edit and clears it on a save; 4a's reload and discard
 *  clear it through the editor. A path with no tab is ignored. */
export function setDirty(path: string, on: boolean) {
  if (!tabs.value.some(t => t.path === path && t.dirty !== on)) return;
  tabs.value = tabs.value.map(t => (t.path === path ? { ...t, dirty: on } : t));
}

// ---- layout (App.tsx: the Log head, the tab bars) ----
export const split = signal(saved.get("dofile.split") !== "0");   // the Log head's Split and Unsplit; kept in localStorage
export const outputTab = signal<OutputTab>(split.value ? "graph" : "log");   // the Output tablist; "log" only unsplit
export const phoneTab = signal<PhoneTab>("editor");             // the phone's tab bar; Run sets "log"; 4a's openFile "editor" (text, .dta)
export const layout = signal<Layout>("desktop");               // main.tsx, from the width (phone under 700 px)
/** The phone layout: read this rather than passing a `phone` prop down. */
export const isPhone = computed(() => layout.value === "phone");

// ---- runs (run.js) ----
export const log = signal<LogItem[]>([{ t: "head" }]);            // run.js; "Clear log" empties it
export const lastRun = signal<LastRun | null>(null);                   // run.js
export const history = signal<string[]>([]);                     // run.js runCommand(): the command line, Load and Import call it
export const results = signal<Results | null>(null);                   // run.js, from each RunResult; null on a new engine and in other-tab
export const macros = signal<Macros | null>(null);                    // run.js, after each run; null on a new engine and in other-tab
export const data = signal<DataSummary | null>(null);                      // run.js, after each run; null on a new engine and in other-tab
export const rows = signal<BrowseRows | null>(null);                      // run.js after each run (null on a new engine); the Data tab's "Show 50 more" appends
// Two writers: run.js refreshData() replaces `rows`, "Show 50 more" (4c) appends. 4c appends only if rows.value is still the
// object its request started from (a run or a new engine replaced it meanwhile: drop the answer).
export const pickedVar = signal<string | null>(null);                 // the Data tab
export const graphs = signal<Graph[]>([]);                      // run.js only: a run's graphs, and addFileGraph() for a .png opened (4a); "Clear log" empties
// An index into `graphs`, which keeps the last 20 (run.js MAX_GRAPHS): the oldest drop off the front, so an index moves.
// Find a graph by its `n` (graphs.value.findIndex(g => g.n === n)), never keep an index: the log's links carry `n`.
export const graphIndex = signal(0);                   // the Graph tab, the full-size view and the log's graph links; run.js: the newest
export const graphFull = signal(false);                // the full-size graph view (4c, output/FullSize.tsx) is open, on graphIndex:
                                                       // 4c's "Open full size" and Close, 4b's tap on an inline graph (phone)

// ---- theme (theme.js) ----
const asTheme = (v: string | null): Theme => (v === "light" || v === "dark" ? v : "system");
export const theme = signal<Theme>(asTheme(saved.get("dofile.theme")));   // the theme button; kept in localStorage (OQ-21)
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const systemDark = signal(Boolean(darkQuery?.matches));
darkQuery?.addEventListener?.("change", e => { systemDark.value = e.matches; });
/** The theme in effect, "light" or "dark": what a run sends as plot_theme. */
export const resolvedTheme = computed(() => (theme.value === "system" ? (systemDark.value ? "dark" : "light") : theme.value));

// ---- dialogs, banners, toast, the live region (app/ui/) ----
export const toast = signal<string | null>(null);                     // anyone, through showToast(text); it clears itself after 4 s
export const dialog = signal<Dialog>(null);                    // whoever opens one; the dialog closes itself (sets null)
export const banners = signal<Banner[]>([]);                     // their owners add; Dismiss removes one (dismiss())
export const announce = signal("");                    // the hidden live region: through say()

let saying: string[] = [];   // what say() was given in this 50 ms window
/** Say `text` once in the hidden live region (role=status, polite). The same words twice in a row are said twice. What is
 *  said in one 50 ms window is said as one text, joined by ". " (a new text in the region cuts a polite one short, so
 *  "Engine reset" then "Run ended: …" in the same tick would lose the first); the same words twice in one window once. */
export function say(text: string) {
  if (saying.at(-1) === text) return;
  saying.push(text);
  if (saying.length > 1) return;
  announce.value = "";
  // a screen reader hears a change of the region's text; the empty step makes a repeat a change
  setTimeout(() => { announce.value = saying.join(". "); saying = []; }, 50);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A toast: a short confirmation with no buttons ("Saved analysis.do", "Copied"). One at a time, 4 s; the live region says
 *  it too. `holdToast(true)` while the pointer is on it keeps it; `holdToast(false)` gives it 4 s again. */
export function showToast(text: string) {
  toast.value = text;
  say(text);
  holdToast(false);
}
export function holdToast(hold: boolean) {
  clearTimeout(toastTimer);
  if (!hold && toast.value !== null) toastTimer = setTimeout(() => { toast.value = null; }, 4000);
}

/** Add a banner (one of each kind and path: a second replaces the first). Who adds each kind: types.d.ts, Banner. */
export function addBanner(b: Banner) {
  banners.value = [...banners.value.filter(x => !sameBanner(x, b)), b];
}
/** Remove a banner: its Dismiss, or its cause went away. */
export function dismiss(b: Banner) {
  banners.value = banners.value.filter(x => !sameBanner(x, b));
}
const sameBanner = (a: Banner, b: Banner) => a.b === b.b && ("path" in a ? a.path : null) === ("path" in b ? b.path : null);
