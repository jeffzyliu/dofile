// The status bar (docs/design/SPEC.md, sections 3.6 and 5). Not a live region: say() in state.ts announces changes.
// Step 3 built the state dot and words of section 5. STEP 4b adds: the timers ("3.4 s", "resets in 4 s", the stage's
// seconds), the last run (`lastRun`), "Memory 612 MB" (`memory`), and at the right "Files are kept in this browser" or
// "Files may be cleared by this browser" (`persisted`), or "You can edit and upload while it starts" while starting.
import type { ComponentChildren } from "preact";
import { stageStatus, stagesOf } from "../engine.ts";
import { snapshotStart } from "../env";
import { engine } from "../state.ts";
import type { EngineState } from "../types.ts";

const lines = (l?: [number, number]) => (l ? (l[0] === l[1] ? ` line ${l[0]}` : ` lines ${l[0]}–${l[1]}`) : "");

/** The state's words: the bold word, then the rest. One case for each of the sixteen states: a new state fails the
 *  check until it has its words. The page load (`checking-lock`, `checking-cache`) takes the words of `none` until step 4b
 *  chooses others. */
export function stateWords(st: EngineState): [ComponentChildren, ComponentChildren] {
  switch (st.s) {
    case "checking-lock":
    case "checking-cache":
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
      return ["Starting", ` · ${stageStatus[st.stage]} (step ${all.indexOf(st.stage) + 1} of ${all.length})`];
    }
    case "ready":
      return ["Ready", null];
    case "running":
      return ["Running", lines(st.run.lines)];
    case "breaking":
      return ["Stopping", null];
    case "waiting":
      return ["Waiting", " · Break after this command"];
    case "failed":
      return ["Stopped", " · the engine didn't start"];
    case "failed-twice":
      return ["Stopped", " · failed twice"];
    case "other-tab-idle":
    case "other-tab-taking":
      return [null, "paused"];
  }
}

export function StatusBar() {
  const st = engine.value;
  const [bold, rest] = stateWords(st);
  const busy = st.s !== "ready";
  return (
    <footer class="statusbar">
      <span data-state={st.s}>
        <span class={`pulse${busy ? " busy" : ""}`} aria-hidden="true" />
        {bold && <b>{bold}</b>}
        {rest}
      </span>
      <span class="spacer" />
    </footer>
  );
}
