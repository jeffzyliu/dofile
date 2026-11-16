// The page's state: one module of signals (docs/design/SPEC.md, section 8). Any component reads any of them; each is
// written only by the owner named on its line. The types are in types.ts.
//
// A signal with one owner is exported read-only (ReadonlySignal): a view that assigns one fails `npm run check`. Its
// owner writes it through a writer object, and test/imports.test.ts checks that each writer is imported only by its
// owner: `engineWriter` and `graphicsWriter` by engine.ts, `runWriter` by run.ts, `filesWriter` by files.ts. `toast`, `banners` and `announce`
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

// ---- the engine ----
export const engineWriter = {
  engine: signal<EngineState>({ s: "checking-lock" }),
};
export const engine: ReadonlySignal<EngineState> = engineWriter.engine;
export const isolated = signal(Boolean(globalThis.crossOriginIsolated)); // set once at load
/** The writer of the graphics part's progress. Only app/engine.ts imports it. Progress is not an engine state: it does not go through the machine. */
export const graphicsWriter = {
  part: signal<import("../engine/types.ts").GraphicsProgress | null>(null), // the transport's onGraphics (engine.ts)
};
/** A lazy snapshot's graphics part (client.ts, onGraphics): null with none. The status bar shows it until it lands. */
export const graphicsPart: ReadonlySignal<import("../engine/types.ts").GraphicsProgress | null> = graphicsWriter.part;

// The download size for the prompt, in bytes as a host sends them. The build writes it into the page
// (<meta name="dofile-engine-bytes">, vite.config.ts), so it is there before any download. null: not a built page.
function metaEngineBytes(doc: Document | undefined = globalThis.document): number | null {
  const bytes = Number(doc?.querySelector('meta[name="dofile-engine-bytes"]')?.getAttribute("content"));
  return bytes > 0 ? bytes : null;
}
export const engineBytes = metaEngineBytes();

// ---- files ----
export const filesWriter = {
  files: signal<FileInfo[]>([]),
  fresh: signal<Set<string>>(new Set()), // paths the last run created or changed (the "new" badge)
  persisted: signal<boolean | null>(null), // null: unknown
};
export const files: ReadonlySignal<FileInfo[]> = filesWriter.files;
/** Whether the store has a file (folders do not count): "Download all (.zip)" is disabled without one. */
export const hasFiles = computed(() => files.value.some((f) => !f.dir));
export const fresh: ReadonlySignal<Set<string>> = filesWriter.fresh;
export const persisted: ReadonlySignal<boolean | null> = filesWriter.persisted;

// ---- editor tabs ----
export const tabs = signal<OpenTab[]>([]); // `dirty` is set only through setDirty()
export const activeTab = signal<string | null>(null);

/** Set the unsaved dot of an open file. A path with no tab is ignored. */
export function setDirty(path: string, on: boolean) {
  if (!tabs.value.some((t) => t.path === path && t.dirty !== on)) return;
  tabs.value = tabs.value.map((t) => (t.path === path ? { ...t, dirty: on } : t));
}

// ---- layout ----
export const split = signal(saved.get("dofile.split") !== "0"); // kept in localStorage
export const outputTab = signal<OutputTab>(split.value ? "graph" : "log"); // "log" only unsplit
export const phoneTab = signal<PhoneTab>("editor");
export const layout = signal<Layout>("desktop"); // from the width: phone under 700 px (SPEC section 2)
/** The phone layout: read this rather than passing a `phone` prop down. */
export const isPhone = computed(() => layout.value === "phone");

// ---- runs ----
export const runWriter = {
  log: signal<LogItem[]>([{ t: "head" }]), // "Clear log" keeps the head
  lastRun: signal<LastRun | null>(null),
  engineRuns: signal(0), // runs begun on the engine now live: 0 on a new or reset engine, whatever a run cut left (Reset's question)
  history: signal<string[]>([]), // the commands run through runCommand()
  results: signal<Results | null>(null), // results, macros, data, rows and memory are null when the engine is gone (a reset, another tab)
  macros: signal<Macros | null>(null),
  data: signal<DataSummary | null>(null),
  rows: signal<BrowseRows | null>(null),
  memory: signal<Memory | null>(null),
  graphs: signal<Graph[]>([]), // a run's graphs, and a .png opened from the files; "Clear log" empties
};
export const log: ReadonlySignal<LogItem[]> = runWriter.log;
export const lastRun: ReadonlySignal<LastRun | null> = runWriter.lastRun;
export const engineRuns: ReadonlySignal<number> = runWriter.engineRuns;
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
export const graphIndex = signal(0);
export const graphFull = signal(false); // the full-size graph view is open, on graphIndex

// ---- theme ----
const asTheme = (v: string | null): Theme => (v === "light" || v === "dark" ? v : "system");
export const theme = signal<Theme>(asTheme(saved.get("dofile.theme"))); // kept in localStorage
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const systemDark = signal(Boolean(darkQuery?.matches));
darkQuery?.addEventListener?.("change", (e) => {
  systemDark.value = e.matches;
});
/** The theme in effect, "light" or "dark": what a run sends as plot_theme. */
export const resolvedTheme = computed(() =>
  theme.value === "system" ? (systemDark.value ? "dark" : "light") : theme.value,
);

// ---- wrap lines ----
export const wrap = signal(saved.get("dofile.wrap") === "1"); // kept in localStorage

// ---- dialogs, banners, toast, the live region ----
const toastText = signal<string | null>(null),
  bannerList = signal<Banner[]>([]),
  toastIsError = signal(false),
  announced = signal("");
export const toast: ReadonlySignal<string | null> = toastText; // set through showToast(); it clears itself (toastMs)
export const toastError: ReadonlySignal<boolean> = toastIsError; // the toast reports an error (the warning icon), not a confirmation
export const dialog = signal<Dialog>(null); // the one open dialog; it sets null when it closes
export const banners: ReadonlySignal<Banner[]> = bannerList; // through addBanner() and dismiss()
export const announce: ReadonlySignal<string> = announced; // the hidden live region, through say()

let saying: string[] = []; // what say() was given in this 50 ms window
/** Say `text` once in the hidden live region (role=status, polite). What is said in one 50 ms window is said as one text,
 *  joined by ". ": a new text in the region cuts a polite one short, so "Engine reset" then "Run ended: …" in the same
 *  tick would lose the first. The same words twice in one window are said once; in a row across windows, twice. */
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
/** How long a toast stays: 60 ms a character (a reading time), at least 4 s (an error 6 s), at most 10 s. */
export const TOAST_MIN_MS = 4000,
  TOAST_ERROR_MIN_MS = 6000,
  TOAST_MAX_MS = 10_000,
  TOAST_MS_PER_CHAR = 60;
export const toastMs = (text: string, error = false) =>
  Math.min(TOAST_MAX_MS, Math.max(error ? TOAST_ERROR_MIN_MS : TOAST_MIN_MS, text.length * TOAST_MS_PER_CHAR));
/** A toast, with no buttons: a short confirmation, or, with `"error"`, an error that needs no action from the visitor;
 *  what the visitor must act on is a banner or a dialog (SPEC 3.10). One at a time, for toastMs(text, error); the live
 *  region says it too. `holdToast(true)` while the pointer is on it keeps it; `holdToast(false)` restarts its time. */
export function showToast(text: string, kind?: "error") {
  toastText.value = text;
  toastIsError.value = kind === "error";
  say(text);
  holdToast(false);
}
export function holdToast(hold: boolean) {
  clearTimeout(toastTimer);
  if (!hold && toastText.value !== null)
    toastTimer = setTimeout(
      () => {
        toastText.value = null;
      },
      toastMs(toastText.value ?? "", toastIsError.value),
    );
}

/** Add a banner (one of each kind and path: a second replaces the first). */
export function addBanner(b: Banner) {
  bannerList.value = [...bannerList.value.filter((x) => !sameBanner(x, b)), b];
}
/** Remove a banner: its Dismiss, or its cause went away. */
export function dismiss(b: Banner) {
  bannerList.value = bannerList.value.filter((x) => !sameBanner(x, b));
}
const sameBanner = (a: Banner, b: Banner) =>
  a.b === b.b && ("path" in a ? a.path : null) === ("path" in b ? b.path : null);
