// The layout's actions: what a view calls to change how the page is laid out. They write the signals of state.ts and
// the visitor's choice in localStorage; no DOM, so a Node test runs them.

import { outputTab, saved, split, wrap } from "../state.ts";

/** "Wrap lines": the log's long lines wrap; kept across visits. */
export function toggleWrap() {
  wrap.value = !wrap.value;
  saved.set("dofile.wrap", wrap.value ? "1" : null);
}

/** Split puts the Output pane beside the Log, unsplit makes the Log its first tab; the choice is kept across visits. */
export function setSplit(on: boolean) {
  split.value = on;
  saved.set("dofile.split", on ? null : "0");
  if (on && outputTab.value === "log") outputTab.value = "graph";
  if (!on) outputTab.value = "log"; // unsplit: the Log is what the visitor sees first
}
