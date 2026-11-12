// The toolbar's Run, Run selection, Break and Save (docs/design/SPEC.md, sections 3.4 and 5), and the phone's one Run
// button that Break replaces while a run is on. Step 3 built what the engine states decide (enabled, disabled,
// aria-disabled, the labels); step 4b added the running time on the phone's Break pill ("Break" "3.4 s", on Break and
// "Break (reset)"; editor/words.ts pillTime, with the sizer PILL_WIDEST). The actions are editor/commands.ts's (the
// editor fills them in) and app/engine.ts's.
// Each button holds all its labels in one cell (ui/Icon.tsx Labels), so it keeps one size in every engine state, with or
// without a selection or unsaved edits, and nothing in the toolbar moves (e2e/shell.spec.ts measures it). Keep it so: a
// new label goes into the button's list, and the pill's time ("Break" "3.4 s") goes in with a sizer of its widest form.
// The phone's Run and Break pill are two buttons with the same list (PHONE_LABELS), so they are the same width. In
// `other-tab-idle` and `other-tab-taking` the buttons stay in place, hidden (app.css), so the bar keeps its height.

import * as eng from "../engine.ts";
import { activeTab, engine, isolated, tabs } from "../state.ts";
import { Icon, Key, Labels, modShortcut } from "../ui/Icon";
import { since } from "./clock.ts";
import { editorCommands, selection } from "./commands.ts";
import { PILL_WIDEST, pillTime } from "./words.ts";

// The play icon says Run and the stop icon says Break, so the state labels are short; the words a screen reader hears
// start with the shown ones (NAME).
const RUN = ["Run", "Starting…", "Stopped"] as const;
const BREAK = ["Break", "Break (reset)", "Stopping…", "Reset now"] as const;
const NAME: Partial<Record<string, string>> = {
  "Starting…": "Starting… Run is off until the engine is ready",
  Stopped: "Stopped: the engine didn't start, so Run is off",
  "Break (reset)": "Break (reset): Break resets the engine on this page",
};

/** Run's label and whether it can be pressed, by engine state (section 5's Run column). */
function runState(): { label: (typeof RUN)[number]; disabled: boolean; busy: boolean } {
  const s = engine.value.s;
  if (s === "ready" || s === "declined") return { label: "Run", disabled: false, busy: false };
  if (s === "running" || s === "breaking" || s === "waiting")
    return { label: "Run", disabled: s !== "running", busy: true };
  if (s === "downloading" || s === "starting-list" || s === "starting-worker")
    return { label: "Starting…", disabled: true, busy: false };
  if (s === "failed" || s === "failed-twice") return { label: "Stopped", disabled: true, busy: false };
  return { label: "Run", disabled: true, busy: false }; // the page load (checking-lock, checking-cache), none, asking, other-tab-idle, other-tab-taking
}

/** Break's label and look (section 5's Break column). Not isolated, Break resets at once: "Break (reset)". */
function breakState(): { label: (typeof BREAK)[number]; live: boolean; disabled: boolean } {
  const st = engine.value;
  if (st.s === "running") return { label: isolated.value ? "Break" : "Break (reset)", live: true, disabled: false };
  if (st.s === "breaking") return { label: "Stopping…", live: false, disabled: true };
  if (st.s === "waiting") return { label: "Reset now", live: true, disabled: false };
  return { label: "Break", live: false, disabled: true };
}

const pressBreak = () => {
  if (engine.value.s === "waiting")
    eng.reset(); // "Reset now": asks nothing
  else eng.breakRun();
};

export function RunControls() {
  const run = runState(),
    brk = breakState(),
    sel = selection.value;
  const dirty = tabs.value.find((t) => t.path === activeTab.value)?.dirty ?? false;
  const usable = !run.disabled && !run.busy;
  // new elements for each label (one vnode is not placed twice)
  const play = () => <Icon name="play" />,
    stop = () => <Icon name="stop" />,
    enter = () => <Key mod k="↩" />;
  const keyS = () => <Key mod k="S" />,
    dot = () => <span class="dot" role="img" aria-label="unsaved changes" />;
  return (
    <>
      {/* While running, Run is aria-disabled, not disabled: a focused Run keeps the focus, so a second Enter can't reach Break. */}
      <button
        type="button"
        class={`btn primary run-ctl${run.busy ? " off" : ""}`}
        disabled={run.disabled}
        aria-label={NAME[run.label]}
        aria-disabled={run.busy || undefined}
        aria-keyshortcuts={usable && !sel ? modShortcut("Enter") : undefined}
        onClick={() => {
          if (!run.busy) editorCommands.runFile();
        }}
      >
        <Labels
          at={usable && !sel ? 0 : 1 + RUN.indexOf(run.label)}
          labels={[
            <>
              {play()}Run{enter()}
            </>,
            ...RUN.map((l) => (
              <>
                {play()}
                {l}
              </>
            )),
          ]}
        />
      </button>
      <button
        type="button"
        class="btn run-ctl"
        disabled={!usable || !sel}
        aria-keyshortcuts={usable && sel ? modShortcut("Enter") : undefined}
        onClick={() => editorCommands.runSelection()}
      >
        <Labels at={usable && sel ? 0 : 1} labels={[<>Run selection{enter()}</>, "Run selection"]} />
      </button>
      <button
        type="button"
        class={`btn stop run-ctl${brk.live ? " live" : ""}`}
        disabled={brk.disabled}
        aria-label={NAME[brk.label]}
        onClick={pressBreak}
      >
        <Labels
          at={BREAK.indexOf(brk.label)}
          labels={BREAK.map((l) => (
            <>
              {stop()}
              {l}
            </>
          ))}
        />
      </button>
      <button
        type="button"
        class="btn run-ctl"
        disabled={!activeTab.value}
        aria-keyshortcuts={activeTab.value ? modShortcut("S") : undefined}
        onClick={() => editorCommands.save()}
      >
        <Labels
          at={(activeTab.value ? 0 : 2) + (dirty ? 0 : 1)}
          labels={[
            <>
              Save{dot()}
              {keyS()}
            </>,
            <>Save{keyS()}</>,
            <>Save{dot()}</>,
            "Save",
          ]}
        />
      </button>
    </>
  );
}

/** The phone's one button (PH, WP 1, WP 2): Run (or "Run 6–7" with a selection, named "Run lines 6–7"), and while a run
 *  is on, Break in its place as a pill. A tap in Break's first 600 ms is ignored, so a double tap on Run doesn't break
 *  the run. Both buttons carry every label either can show, so they have one width and the ⋯ beside them never moves. */
export function PhoneRun() {
  const st = engine.value;
  const running = st.s === "running" || st.s === "breaking" || st.s === "waiting";
  const run = runState(),
    brk = breakState(),
    sel = running ? null : selection.value;
  const range = sel && !run.disabled ? (sel[0] === sel[1] ? `${sel[0]}` : `${sel[0]}–${sel[1]}`) : null;
  const time = running ? pillTime(since(st.t0)) : "";
  const all = [
    ...RUN.map((l) => (
      <>
        <Icon name="play" />
        {l}
      </>
    )),
    <>
      <Icon name="play" />
      Run 8888–8888
    </>,
    ...BREAK.map((l) => (
      <>
        <Icon name="stop" />
        {l}
        {l.startsWith("Break") && <span class="pill-time">{time}</span>}
      </>
    )),
    <>
      <Icon name="play" />
      Run {range}
    </>,
    <>
      <Icon name="stop" />
      Break (reset)<span class="pill-time">{PILL_WIDEST}</span>
    </>, // the sizer: the widest the pill can be
  ];
  if (running) {
    return (
      <button
        type="button"
        class={`btn stop${brk.live ? " live" : ""} pill run-ctl`}
        disabled={brk.disabled}
        aria-label={NAME[brk.label] ?? brk.label}
        onClick={() => {
          if (Date.now() - st.t0 >= 600) pressBreak();
        }}
      >
        <Labels at={RUN.length + 1 + BREAK.indexOf(brk.label)} labels={all} />
      </button>
    );
  }
  const name = !range ? NAME[run.label] : range.includes("–") ? `Run lines ${range}` : `Run line ${range}`;
  return (
    <button
      type="button"
      class="btn primary run-ctl"
      disabled={run.disabled}
      aria-label={name}
      onClick={() => (sel ? editorCommands.runSelection() : editorCommands.runFile())}
    >
      <Labels at={range ? all.length - 2 : RUN.indexOf(run.label)} labels={all} />
    </button>
  );
}
