// The page's state: one module of signals (docs/design/SPEC.md, section 8; web/CLAUDE.md, "State"). On
// @preact/signals-core, so the Node tests import this file as it is; components read the same signals through
// @preact/signals.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import { movedPath, within } from "./paths.ts";
import { saved } from "./state/saved.ts";
import type {
  Banner,
  BrowseRows,
  DataSummary,
  Dialog,
  DialogName,
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
const shownPhoneTab = signal<PhoneTab>("editor");
export const phoneTab: ReadonlySignal<PhoneTab> = shownPhoneTab; // through showPhone()
/** Show the phone's `tab` view. */
export function showPhone(tab: PhoneTab) {
  shownPhoneTab.value = tab;
}
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
 *  files/ops.ts cannot import (run.ts imports files.ts). */
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
// `graphs` keeps the last 20 (graphs.ts MAX_GRAPHS): the oldest drop off the front, so a graph's place moves. The shown
// graph is kept by its `n` (the log's links carry it), never by its place.
const pickedGraph = signal<number | null>(null); // the `n` of the graph picked; null: the newest
/** The shown graph's place in `graphs`: the picked one's, or the last when it is gone or none is picked (0 when there
 *  are no graphs). Always in range. */
export const graphIndex = computed(() => {
  const list = graphs.value;
  const at = list.findIndex((g) => g.n === pickedGraph.value);
  return at >= 0 ? at : Math.max(list.length - 1, 0);
});
/** Show the graph numbered `n`; null shows the newest. A number that is not kept shows the last graph. */
export function selectGraph(n: number | null) {
  pickedGraph.value = n;
}
/** Show the graph at this place in `graphs`, held to the first and the last (the full-size view's previous and next). */
export function selectGraphAt(place: number) {
  const list = graphs.value;
  if (list.length) selectGraph(list[Math.min(Math.max(place, 0), list.length - 1)].n);
}
const fullSizeOpen = signal(false);
export const graphFull: ReadonlySignal<boolean> = fullSizeOpen; // the full-size graph view is open, on graphIndex
export function showFullSize() {
  fullSizeOpen.value = true;
}
export function closeFullSize() {
  fullSizeOpen.value = false;
}

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
const toastText = signal<string | null>(null);
const bannerList = signal<Banner[]>([]);
const toastIsError = signal(false);
const announced = signal("");
export const toast: ReadonlySignal<string | null> = toastText; // set through showToast(); it clears itself (toastMs)
// the toast reports an error (the warning icon), not a confirmation
export const toastError: ReadonlySignal<boolean> = toastIsError;
const openedDialog = signal<Dialog>(null);
export const dialog: ReadonlySignal<Dialog> = openedDialog; // the one open dialog, through openDialog() and closeDialog()
/** Open `d`, in the place of any dialog open. */
export function openDialog(d: NonNullable<Dialog>) {
  openedDialog.value = d;
}
/** Close the open dialog. With `own`, a kind or the object openDialog was given, only that dialog: one that another
 *  replaced meanwhile stays open. Returns whether a dialog closed. */
export function closeDialog(own?: DialogName | NonNullable<Dialog>): boolean {
  const open = openedDialog.peek();
  if (open === null) return false;
  if (own !== undefined && (typeof own === "string" ? open.d !== own : open !== own)) return false;
  openedDialog.value = null;
  return true;
}
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
