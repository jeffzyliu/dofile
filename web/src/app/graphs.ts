// The session's graphs: a run's, and a .png opened from the files. Their numbers count from 1 until "Clear log".

import type { Graph } from "./types.ts";

import { selectGraph, runWriter as W } from "./state/run.ts";

import { resolvedTheme } from "./theme.ts";

export const MAX_GRAPHS = 20; // the graphs a session keeps; the oldest go first

let graphCount = 0; // graphs drawn since the log was cleared: their numbers

/** The number of the next graph. */
export const nextGraphNumber = () => ++graphCount;

/** No graphs, the first one selected, and the numbers start again from 1. */
export function clearGraphs() {
  W.graphs.value = [];
  selectGraph(null); // the numbers start again: a number picked before would meet a new graph
  graphCount = 0;
}

/** Keep `added` after the graphs there are (the last 20), and show the latest. */
export function keepGraphs(added: Graph[]) {
  W.graphs.value = [...W.graphs.value, ...added].slice(-MAX_GRAPHS);
  selectGraph(null); // the latest graph is the one shown
}

/** A .png opened from the files: it joins the session's graphs and is the one shown. Its colors are its own; `theme` is
 *  the page's at the time. The same file opened again replaces its entry (same `n`, same place) and selects it; one
 *  that has dropped out of the last 20 is added again. `png` is base64. */
export function addFileGraph(path: string, png: string): Graph {
  const i = W.graphs.value.findIndex((g) => g.from === "file" && g.path === path);
  if (i >= 0) {
    const g: Graph = { ...W.graphs.value[i], png, theme: resolvedTheme.value };
    W.graphs.value = W.graphs.value.map((x, j) => (j === i ? g : x));
    selectGraph(g.n);
    return g;
  }
  const g: Graph = { n: nextGraphNumber(), png, theme: resolvedTheme.value, from: "file", path };
  keepGraphs([g]);
  return g;
}
