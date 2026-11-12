// The status bar (docs/design/SPEC.md, sections 3.6 and 5). Not a live region: say() in state.ts announces changes.
// Left to right: the state's dot and words, with its timer ("Running lines 14–15 · 3.4 s", "Stopping · resets in 4 s",
// the start's stage and its seconds), the run's time while Break waits; when ready, the last run (`lastRun`: "Last
// run: whole file (started with no locals) · r(111) at line 17 · 0.38 s", the rc in the error color); "Memory 612 MB"
// (`memory`, the last measured value, also during a run: OQ-8); then at the right "You can edit and upload while it
// starts" while it starts, else "Files are kept in this browser" or "Files may be cleared by this browser"
// (`persisted`; nothing while it is unknown), with "Not affiliated with StataCorp" before it (LICENSE-POLICY.md's
// sentence in full for screen readers and as its title; muted text, no link, no tab stop; from 1200 px only, app.css:
// under it the bar has no room for it beside the longest last run). The timers count with editor/clock.ts.
import type { ComponentChildren } from "preact";
import { stageStatus, stagesOf } from "../engine.ts";
import { snapshotStart } from "../env";
import { engine, lastRun, memory, persisted } from "../state.ts";
import type { EngineState } from "../types.ts";
import { resetsIn, since } from "./clock.ts";
import { lastRunWords, linesWords, memoryWords, seconds, ticking } from "./words.ts";

const lines = (l?: [number, number]) => (l ? ` ${linesWords(l)}` : "");

/** LICENSE-POLICY.md's sentence; the status bar shows it short. */
export const AFFILIATION = "Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp.";

/** The state's words: the bold word, then the rest, with its timer. One case for each of the sixteen states: a new state
 *  fails the check until it has its words. The page load (`checking-lock`, `checking-cache`) is "Loading": a word for
 *  the moment before the page knows whether the engine is there (a draft; the spec left it to step 4b). */
export function stateWords(st: EngineState): [ComponentChildren, ComponentChildren] {
  switch (st.s) {
    case "checking-lock":
    case "checking-cache":
      return ["Loading", null];
    case "none":
    case "asking":
      return [null, "No engine yet"];
    case "declined":
      return ["No engine", " · Run downloads it first"];
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
  const starting = st.s === "starting-list" || st.s === "starting-worker";
  const mem = memory.value;
  const kept = persisted.value;
  return (
    <footer class="statusbar">
      <span data-state={st.s}>
        <span class={`pulse${busy ? " busy" : ""}`} aria-hidden="true" />
        {bold && <b>{bold}</b>}
        {rest}
      </span>
      {(st.s === "breaking" || st.s === "waiting") && <span>{seconds(since(st.t0))}</span>}
      {st.s === "ready" && <LastRunText />}
      {mem && <span>{memoryWords(mem)}</span>}
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
