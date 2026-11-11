// The Graph tab (docs/design/SPEC.md, section 3.7; E, S 16): the shown graph on its card, and under it a foot with a
// thumbnail for each of the session's graphs, "graph 1 of 1 · scatter wage educ", "Open full size" and "Export PNG".
// The graph shown is `graphs[graphIndex]`; `graphIndex` is kept in range here, so a "Clear log" or a drop of the oldest
// graph never leaves the tab on nothing. Its state is all in signals (state.ts: graphs, graphIndex, graphFull).

import type { ComponentChildren } from "preact";
import { graphFull, graphIndex, graphs } from "../state.ts";
import type { Graph } from "../types.ts";
import { exportPng } from "./clip.ts";
import { graphAlt, graphSubject, graphTitle } from "./format.ts";
import { fullOpener } from "./view.ts";

const NO_GRAPHS = "Graphs drawn by a run appear here, for example ";
const FILE_HINT = ". A .png from the file list opens here too.";

export const EmptyGraph = () => (
  <div class="empty">
    <b>No graphs yet</b>
    {NO_GRAPHS}
    <code>scatter wage educ</code>
    {FILE_HINT}
  </div>
);

/** The graph in the signal's range: the index is clamped, never wrapped. */
export function shownGraph(list: Graph[], index: number): number {
  return Math.min(Math.max(index, 0), list.length - 1);
}

/** The data URL of a graph's PNG. */
export const src = (g: Graph) => `data:image/png;base64,${g.png}`;

/** A thumbnail for each graph: a button that shows that graph (the tab's foot, and the full-size view's strip). */
export function Thumbs({ list, current, label }: { list: Graph[]; current: number; label: string }) {
  return (
    <fieldset class="thumbs" aria-label={label}>
      {list.map((g, i) => (
        <button
          type="button"
          key={g.n}
          class={`thumb${i === current ? " on" : ""}`}
          style={{ backgroundImage: `url(${src(g)})` }}
          aria-label={`Show graph ${g.n}${graphSubject(g) ? `: ${graphSubject(g)}` : ""}`}
          aria-current={i === current ? "true" : undefined}
          onClick={() => {
            graphIndex.value = i;
          }}
        />
      ))}
    </fieldset>
  );
}

/** The card the graph is drawn on: its own background when the plot is dark (OQ-21: the card follows the plot's theme). */
export const GraphCard = ({ g, list, children }: { g: Graph; list: Graph[]; children?: ComponentChildren }) => (
  <div class="graph-card" data-theme={g.theme}>
    <img src={src(g)} alt={graphAlt(g, list)} />
    {children}
  </div>
);

export function GraphTab() {
  const list = graphs.value;
  if (!list.length) return <EmptyGraph />;
  const at = shownGraph(list, graphIndex.value);
  const g = list[at];
  return (
    <div class="graph-wrap">
      <GraphCard g={g} list={list} />
      <div class="graph-foot">
        <Thumbs list={list} current={at} label="Graphs" />
        <span class="foot-title">{graphTitle(g, list)}</span>
        <span class="spacer" />
        <button
          type="button"
          class="head-link"
          onClick={(e) => {
            fullOpener.el = e.currentTarget;
            graphIndex.value = at;
            graphFull.value = true;
          }}
        >
          Open full size
        </button>
        <button type="button" class="head-link" onClick={() => exportPng(g)}>
          Export PNG
        </button>
      </div>
    </div>
  );
}
