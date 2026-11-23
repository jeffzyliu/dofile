// The run's state: the log, the last run, the engine's data (results, macros, data, rows, memory) and the graphs, with the
// graph shown and the full-size view over it. The writer is app/run.ts, through `runWriter`; the graph pick and the
// full-size view are written by this module's functions; everything else reads.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import { movedPath, within } from "../paths.ts";
import type { BrowseRows, DataSummary, Graph, LastRun, LogItem, Macros, Memory, Results } from "../types.ts";

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
 *  files/ops.ts cannot import (app/run.ts imports app/files.ts). */
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
