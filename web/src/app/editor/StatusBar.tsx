// The status bar (docs/design/SPEC.md, sections 3.6 and 5): draws the parts of status.ts's full form. Not a live region:
// say() in state.ts announces changes. "Not affiliated with StataCorp" shows from 1200 px only (app.css): under it the
// bar has no room for it beside the longest last run. Screen readers get the full sentence (AFFILIATION).
import { snapshotStart } from "../env";
import { engine, graphicsPart, lastRun, memory, persisted } from "../state.ts";
import { resetsIn, since } from "./clock.ts";
import { type StatusForm, type StatusPart, statusParts } from "./status.ts";

/** The parts of the bar or the strip, from the signals (read here, so the view that calls it follows them). */
export const statusNow = (form: StatusForm) =>
  statusParts(
    {
      st: engine.value,
      lastRun: lastRun.value,
      memory: memory.value,
      graphics: graphicsPart.value,
      persisted: persisted.value,
      snapshot: snapshotStart,
      since,
      resetsIn,
    },
    form,
  );

function BarPart({ p }: { p: StatusPart }) {
  switch (p.t) {
    case "state":
      return (
        <span data-state={p.state}>
          <span class={`pulse${p.busy ? " busy" : ""}`} aria-hidden="true" />
          {p.bold && <b>{p.bold}</b>}
          {p.rest}
        </span>
      );
    case "timer":
    case "note":
      return <span>{p.text}</span>;
    case "lastRun":
      return (
        <span class="last-run">
          {p.lead}
          {p.rc && <span class="rc-err">{p.rc}</span>}
          {p.tail}
        </span>
      );
    case "graphs":
      return <GraphsLoading g={p} />;
    case "memory":
      return <span title={p.title}>{p.text}</span>;
    case "spacer":
      return <span class="spacer" />;
    case "affiliation":
      return (
        <span class="affiliation">
          <span aria-hidden="true" title={p.full}>
            {p.short}
          </span>
          <span class="visually-hidden">{p.full}</span>
        </span>
      );
    case "jump":
      return null;
  }
}

export function StatusBar() {
  return (
    <footer class="statusbar">
      {statusNow("full").map((p) => (
        <BarPart key={p.t} p={p} />
      ))}
    </footer>
  );
}

/** "Graphs loading" and a ring of its percent while the graphics part downloads after the start. Not a live region. */
export function GraphsLoading({ g }: { g: Extract<StatusPart, { t: "graphs" }> }) {
  return (
    <span
      class="graphs-loading"
      data-graphics="fetching"
      role="progressbar"
      aria-label={g.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(g.percent)}
      title={g.title}
    >
      <svg class="ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" pathLength="100" />
        <circle cx="8" cy="8" r="6" pathLength="100" stroke-dasharray={`${g.percent} 100`} />
      </svg>
      <span class="graphs-loading-words" aria-hidden="true">
        Graphs loading
      </span>
    </span>
  );
}
