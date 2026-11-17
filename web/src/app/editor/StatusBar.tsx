// The status bar (docs/design/SPEC.md, sections 3.6 and 5). Not a live region: say() in state.ts announces changes.
// "Not affiliated with StataCorp" shows from 1200 px only (app.css): under it the bar has no room for it beside the
// longest last run. Screen readers get the full sentence (AFFILIATION).

import type { ComponentChildren } from "preact";
import { stageStatus, stagesOf } from "../engine.ts";
import { snapshotStart } from "../env";
import { engine, graphicsPart, lastRun, memory, persisted } from "../state.ts";
import { breakAsked, engineLoading, engineUp } from "../states/predicates.ts";
import type { EngineState } from "../types.ts";
import { resetsIn, since } from "./clock.ts";
import { lastRunWords, linesWords, memoryTitle, memoryWords, ticking } from "./words.ts";

const lines = (l?: [number, number]) => (l ? ` ${linesWords(l)}` : "");

/** LICENSE-POLICY.md's sentence; the status bar shows it short. */
export const AFFILIATION = "Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp.";

/** The state's words: the bold word, then the rest, with its timer. One case for each state: a new state fails the
 *  type check until it has its words. The page load (`checking-lock`, `checking-cache`) is "Loading", for the moment
 *  before the page knows whether the engine is there. */
export function stateWords(st: EngineState): [ComponentChildren, ComponentChildren] {
  switch (st.s) {
    case "checking-lock":
    case "checking-cache":
      return ["Loading", null];
    case "none":
    case "asking":
      return [null, "No engine yet"];
    case "declined":
      return ["No engine", " · Start engine downloads it"];
    case "downloading":
      return ["Starting", " · downloading"];
    case "starting-list":
    case "starting-worker": {
      const all = stagesOf(snapshotStart);
      return [
        "Starting",
        ` · ${stageStatus[st.stage]} (step ${all.indexOf(st.stage) + 1} of ${all.length}) · ${ticking(since(st.t0))}`,
      ];
    }
    case "ready":
      return ["Ready", null];
    case "running":
      return ["Running", `${lines(st.run.lines)} · ${ticking(since(st.t0))}`];
    case "breaking":
      return ["Stopping", ` · resets in ${resetsIn(st)} s`];
    case "waiting":
      return ["Waiting", " · Break after this command"];
    case "failed":
      return ["Not started", " · the engine didn't start"];
    case "failed-twice":
      return ["Stopped", " · failed twice"];
    case "other-tab-idle":
    case "other-tab-taking":
      return ["Paused", " · another tab has the engine"];
  }
}

/** "Last run: whole file (started with no locals) · r(111) at line 17 · 0.38 s". */
function LastRunText() {
  const r = lastRun.value;
  if (!r) return null;
  const w = lastRunWords(r);
  return (
    <span class="last-run">
      {`Last run: ${w.what} · `}
      {w.rc && (
        <>
          <span class="rc-err">{w.rc}</span>
          {w.where ? ` ${w.where} · ` : " · "}
        </>
      )}
      {w.time}
    </span>
  );
}

export function StatusBar() {
  const st = engine.value;
  const [bold, rest] = stateWords(st);
  const busy = st.s !== "ready";
  const starting = engineLoading(st);
  const mem = memory.value;
  const kept = persisted.value;
  return (
    <footer class="statusbar">
      <span data-state={st.s}>
        <span class={`pulse${busy ? " busy" : ""}`} aria-hidden="true" />
        {bold && <b>{bold}</b>}
        {rest}
      </span>
      {breakAsked(st) && <span>{ticking(since(st.t0))}</span>}
      {st.s === "ready" && <LastRunText />}
      <GraphsLoading />
      {mem && <span title={memoryTitle}>{memoryWords(mem)}</span>}
      <span class="spacer" />
      <span class="affiliation">
        <span aria-hidden="true" title={AFFILIATION}>
          {"Not affiliated with StataCorp"}
        </span>
        <span class="visually-hidden">{AFFILIATION}</span>
      </span>
      {starting ? (
        <span>{"You can edit and upload while it starts"}</span>
      ) : kept === null ? null : (
        <span>{kept ? "Files are kept in this browser" : "Files may be cleared by this browser"}</span>
      )}
    </footer>
  );
}

/** "Graphs loading" and a ring of its percent while the graphics part downloads after the start. Nothing before the
 *  engine started, once it landed, or after a failed fetch (a graph's own error says why). Not a live region. */
export function GraphsLoading() {
  const g = graphicsPart.value;
  if (g?.state !== "fetching" || !engineUp(engine.value)) return null;
  const pct = g.total ? Math.min(100, (100 * g.received) / g.total) : 0,
    mb = (n: number) => (n / 1e6).toFixed(1);
  return (
    <span
      class="graphs-loading"
      data-graphics="fetching"
      role="progressbar"
      aria-label={`Graphs loading, ${mb(g.received)} of ${mb(g.total)} MB`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      title={`${mb(g.received)} of ${mb(g.total)} MB`}
    >
      <svg class="ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" pathLength="100" />
        <circle cx="8" cy="8" r="6" pathLength="100" stroke-dasharray={`${pct} 100`} />
      </svg>
      <span class="graphs-loading-words" aria-hidden="true">
        Graphs loading
      </span>
    </span>
  );
}
