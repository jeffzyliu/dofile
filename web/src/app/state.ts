// The page's state: one module of signals (docs/design/SPEC.md, section 8). Any component reads any of them; each is
// written only by the owner named on its line. The types are in types.ts.
//
// A signal with one owner is exported read-only (ReadonlySignal): a view that assigns one fails `npm run check`. Its
// owner writes it through a writer object, and test/imports.test.ts checks that each writer is imported only by its
// owner: `engineWriter` by engine.ts, `runWriter` by run.ts, `filesWriter` by files.ts. `toast`, `banners` and `announce`
// are written through the helpers below. The signals that views write themselves stay plain signals.
//
// On @preact/signals-core, so the Node tests import this file as it is. Components read the same signals through
// @preact/signals (it re-exports this package's signals and re-renders a component that reads `.value`).

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import type {
  Banner,
  BrowseRows,
  DataSummary,
  Dialog,
  EngineState,
  FileInfo,
  Graph,
  LastRun,
  Layout,
  LogItem,
  Macros,
  Memory,
  OpenTab,
  OutputTab,
  PhoneTab,
  Results,
  Theme,
} from "./types.ts";

// localStorage, which a browser may refuse (some private modes) and Node does not have
export const saved = {
  get: (key: string) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* not kept: the page works the same this visit */
    }
  },
};

// ---- the engine (engine.ts) ----
/** The writer of the engine controller's signal. Only app/engine.ts imports it. */
export const engineWriter = {
  engine: signal<EngineState>({ s: "checking-lock" }), // the machine's state as views see it (engine.ts, view())
};
export const engine: ReadonlySignal<EngineState> = engineWriter.engine; // engine.ts, after every step of the state machine
export const isolated = signal(Boolean(globalThis.crossOriginIsolated)); // set once at load

// The download size for the prompt, in bytes as a host sends them: the build writes start-files.json's `compressed` total
// into the page (<meta name="dofile-engine-bytes">, vite.config.ts), so it is there at load, before any download.
// null: not a built page (a dev server with no snapshot).
function metaEngineBytes(doc: Document | undefined = globalThis.document): number | null {
  const bytes = Number(doc?.querySelector('meta[name="dofile-engine-bytes"]')?.getAttribute("content"));
  return bytes > 0 ? bytes : null;
}
export const engineBytes = metaEngineBytes();

// ---- files (files.ts) ----
/** The writers of the file service's signals. Only app/files.ts imports it. */
export const filesWriter = {
  files: signal<FileInfo[]>([]), // after every store change and every run
  fresh: signal<Set<string>>(new Set()), // paths the last run created or changed (the "new" badge)
  persisted: signal<boolean | null>(null), // from storage.persist() and persisted(); null: unknown
};
export const files: ReadonlySignal<FileInfo[]> = filesWriter.files;
/** Whether the store has a file (folders do not count): "Download all (.zip)" is disabled without one. */
export const hasFiles = computed(() => files.value.some((f) => !f.dir));
export const fresh: ReadonlySignal<Set<string>> = filesWriter.fresh;
export const persisted: ReadonlySignal<boolean | null> = filesWriter.persisted;

// ---- editor tabs (step 4a) ----
export const tabs = signal<OpenTab[]>([]); // 4a (files/): adds, closes, renames, orders; `dirty` only through setDirty()
export const activeTab = signal<string | null>(null); // 4a: the tabs, and the file tree when it opens a file (files/open.ts)

/** The unsaved dot of an open file: the editor (4b) sets it on an edit and clears it on a save; 4a's reload and discard
 *  clear it through the editor. A path with no tab is ignored. */
export function setDirty(path: string, on: boolean) {
  if (!tabs.value.some((t) => t.path === path && t.dirty !== on)) return;
  tabs.value = tabs.value.map((t) => (t.path === path ? { ...t, dirty: on } : t));
}

// ---- layout (App.tsx: the Log head, the tab bars) ----
export const split = signal(saved.get("dofile.split") !== "0"); // the Log head's Split and Unsplit; kept in localStorage
export const outputTab = signal<OutputTab>(split.value ? "graph" : "log"); // the Output tablist; "log" only unsplit
export const phoneTab = signal<PhoneTab>("editor"); // the phone's tab bar; Run sets "log"; 4a's openFile "editor" (text, .dta)
export const layout = signal<Layout>("desktop"); // main.tsx, from the width (phone under 700 px)
/** The phone layout: read this rather than passing a `phone` prop down. */
export const isPhone = computed(() => layout.value === "phone");

// ---- runs (run.ts) ----
/** The writers of the run controller's signals. Only app/run.ts imports it. */
export const runWriter = {
  log: signal<LogItem[]>([{ t: "head" }]), // "Clear log" empties it
  lastRun: signal<LastRun | null>(null),
  history: signal<string[]>([]), // runCommand(): the command line, Load and Import call it
  results: signal<Results | null>(null), // from each RunResult; null when the engine is gone (a reset, another tab)
  macros: signal<Macros | null>(null), // after each run; null when the engine is gone
  data: signal<DataSummary | null>(null), // after each run; null when the engine is gone
  rows: signal<BrowseRows | null>(null), // after each run (refreshData), and "Show 50 more" (moreRows); null when the engine is gone
  memory: signal<Memory | null>(null), // when an engine is ready and after each run; null when the engine is gone
  graphs: signal<Graph[]>([]), // a run's graphs, and addFileGraph() for a .png opened (4a); "Clear log" empties
};
export const log: ReadonlySignal<LogItem[]> = runWriter.log;
export const lastRun: ReadonlySignal<LastRun | null> = runWriter.lastRun;
export const history: ReadonlySignal<string[]> = runWriter.history;
export const results: ReadonlySignal<Results | null> = runWriter.results;
export const macros: ReadonlySignal<Macros | null> = runWriter.macros;
export const data: ReadonlySignal<DataSummary | null> = runWriter.data;
export const rows: ReadonlySignal<BrowseRows | null> = runWriter.rows;
export const memory: ReadonlySignal<Memory | null> = runWriter.memory;
export const pickedVar = signal<string | null>(null); // the Data tab
export const graphs: ReadonlySignal<Graph[]> = runWriter.graphs;
// An index into `graphs`, which keeps the last 20 (run.ts MAX_GRAPHS): the oldest drop off the front, so an index moves.
// Find a graph by its `n` (graphs.value.findIndex(g => g.n === n)), never keep an index: the log's links carry `n`.
export const graphIndex = signal(0); // the Graph tab, the full-size view and the log's graph links; run.ts: the newest
export const graphFull = signal(false); // the full-size graph view (4c, output/FullSize.tsx) is open, on graphIndex:
// 4c's "Open full size" and Close, 4b's tap on an inline graph (phone)

// ---- theme (theme.ts) ----
const asTheme = (v: string | null): Theme => (v === "light" || v === "dark" ? v : "system");
export const theme = signal<Theme>(asTheme(saved.get("dofile.theme"))); // the theme button; kept in localStorage (OQ-21)
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const systemDark = signal(Boolean(darkQuery?.matches));
darkQuery?.addEventListener?.("change", (e) => {
  systemDark.value = e.matches;
});
/** The theme in effect, "light" or "dark": what a run sends as plot_theme. */
export const resolvedTheme = computed(() =>
  theme.value === "system" ? (systemDark.value ? "dark" : "light") : theme.value,
);

// ---- dialogs, banners, toast, the live region (app/ui/) ----
const toastText = signal<string | null>(null),
  bannerList = signal<Banner[]>([]),
  announced = signal("");
export const toast: ReadonlySignal<string | null> = toastText; // anyone, through showToast(text); it clears itself after 4 s
export const dialog = signal<Dialog>(null); // whoever opens one; the dialog closes itself (sets null)
export const banners: ReadonlySignal<Banner[]> = bannerList; // their owners add (addBanner()); Dismiss removes one (dismiss())
export const announce: ReadonlySignal<string> = announced; // the hidden live region: through say()

let saying: string[] = []; // what say() was given in this 50 ms window
/** Say `text` once in the hidden live region (role=status, polite). The same words twice in a row are said twice. What is
 *  said in one 50 ms window is said as one text, joined by ". " (a new text in the region cuts a polite one short, so
 *  "Engine reset" then "Run ended: …" in the same tick would lose the first); the same words twice in one window once. */
export function say(text: string) {
  if (saying.at(-1) === text) return;
  saying.push(text);
  if (saying.length > 1) return;
  announced.value = "";
  // a screen reader hears a change of the region's text; the empty step makes a repeat a change
  setTimeout(() => {
    announced.value = saying.join(". ");
    saying = [];
  }, 50);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A toast: a short confirmation with no buttons ("Saved analysis.do", "Copied"). One at a time, 4 s; the live region says
 *  it too. `holdToast(true)` while the pointer is on it keeps it; `holdToast(false)` gives it 4 s again. */
export function showToast(text: string) {
  toastText.value = text;
  say(text);
  holdToast(false);
}
export function holdToast(hold: boolean) {
  clearTimeout(toastTimer);
  if (!hold && toastText.value !== null)
    toastTimer = setTimeout(() => {
      toastText.value = null;
    }, 4000);
}

/** Add a banner (one of each kind and path: a second replaces the first). Who adds each kind: types.ts, Banner. */
export function addBanner(b: Banner) {
  bannerList.value = [...bannerList.value.filter((x) => !sameBanner(x, b)), b];
}
/** Remove a banner: its Dismiss, or its cause went away. */
export function dismiss(b: Banner) {
  bannerList.value = bannerList.value.filter((x) => !sameBanner(x, b));
}
const sameBanner = (a: Banner, b: Banner) =>
  a.b === b.b && ("path" in a ? a.path : null) === ("path" in b ? b.path : null);
