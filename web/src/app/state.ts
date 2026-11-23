// The page's state: one module of signals (docs/design/SPEC.md, section 8; web/CLAUDE.md, "State"). On
// @preact/signals-core, so the Node tests import this file as it is; components read the same signals through
// @preact/signals.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import { movedPath, within } from "./files/tree.ts";
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
/** Progress of the graphics part: not an engine state, so it does not go through the machine. */
export const graphicsWriter = {
  part: signal<import("../engine/types.ts").GraphicsProgress | null>(null), // the transport's onGraphics (engine.ts)
};
/** A lazy snapshot's graphics part; null with none. */
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
  // runs begun on the engine now live: 0 on a new or reset engine, whatever a run cut left (Reset's question)
  engineRuns: signal(0),
  history: signal<string[]>([]), // the commands run through runCommand()
  // results, macros, data, rows and memory are null when the engine is gone (a reset, another tab)
  results: signal<Results | null>(null),
  macros: signal<Macros | null>(null),
  data: signal<DataSummary | null>(null),
  rows: signal<BrowseRows | null>(null),
  memory: signal<Memory | null>(null),
  graphs: signal<Graph[]>([]), // a run's graphs, and a .png opened from the files; "Clear log" empties
};
/** A rename moved the file or folder `from` to `to`: the last run and the log's run heads and ends follow it, so
 *  "Go to line" opens the renamed file, not the old name (which a new file may take). Lives here, not in run.ts, which
 *  files/actions.ts cannot import (run.ts imports files.ts). */
export function runMoved(from: string, to: string) {
  const move = <T extends { path?: string }>(r: T): T =>
    r.path !== undefined && within(r.path, from) ? { ...r, path: movedPath(r.path, from, to) } : r;
  if (runWriter.lastRun.value) runWriter.lastRun.value = move(runWriter.lastRun.value);
  runWriter.log.value = runWriter.log.value.map((i) =>
    i.t === "runhead" ? { ...i, run: move(i.run) } : i.t === "text" && i.end ? { ...i, end: move(i.end) } : i,
  );
}
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
// An index into `graphs`, which keeps the last 20 (graphs.ts MAX_GRAPHS): the oldest drop off the front, so an index
// moves. Find a graph by its `n` (graphs.value.findIndex(g => g.n === n)), never keep an index: the log's links carry
// `n`.
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
// the toast reports an error (the warning icon), not a confirmation
export const toastError: ReadonlySignal<boolean> = toastIsError;
export const dialog = signal<Dialog>(null); // the one open dialog; it sets null when it closes
export const banners: ReadonlySignal<Banner[]> = bannerList; // through addBanner() and dismiss()
export const announce: ReadonlySignal<string> = announced; // the hidden live region, through say()

let saying: string[] = []; // what say() was given in this 50 ms window
/** Say `text` once in the hidden live region (role=status, polite). What is said in one 50 ms window is said as one
 *  text, joined by ". ": a new text in the region cuts a polite one short, so "Engine reset" then "Run ended: …" in the
 *  same tick would lose the first. Only a repeat straight after the same words in the window is dropped (A, B, A says
 *  all three); across windows the same words are said again. */
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
