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
// With no engine (start.ts startOffer) Run is "Start engine": a press does what the state offers (the download prompt,
// a new try after a failed start, the take-over dialog) and runs nothing, and Run selection is off. "Start engine" is
// one of Run's labels, so the button is as wide with "Run" as with it and the toolbar does not move.
// Run is never `disabled`: off, it is aria-disabled and `.off`, so a Run that has the focus keeps it when its state
// turns it off ("Start engine" pressed by keyboard after a failed start becomes "Starting…"), and a press then says why
// in a toast (the words Ctrl/Cmd+Enter gives), except while a run is on, where a second Enter must stay silent.

import * as eng from "../engine.ts";
import { startEngine, startOffer } from "../start.ts";
import { activeTab, engine, isolated, phoneTab, showToast, tabs } from "../state.ts";
import { Icon, Key, Labels, modShortcut } from "../ui/Icon";
import { ignoreHeldEnter } from "../ui/keys.ts";
import { since } from "./clock.ts";
import { editorCommands, selection } from "./commands.ts";
import { PILL_WIDEST, pillTime, refusedRunWords } from "./words.ts";

// The play icon says Run and the stop icon says Break, so the state labels are short; the words a screen reader hears
// start with the shown ones (NAME).
const RUN = ["Run", "Start engine", "Starting…", "Not started"] as const;
const BREAK = ["Break", "Break (reset)", "Stopping…", "Reset now"] as const;
const NAME: Partial<Record<string, string>> = {
  "Starting…": "Starting… Run is not available until the engine is ready",
  "Not started": "Not started: the engine didn't start, so Run is not available",
  "Break (reset)": "Break (reset): Break resets the engine on this page",
};

/** Run's label and whether it can be pressed, by engine state (section 5's Run column). `start`: the button is "Start
 *  engine" (there is no engine, and a press starts it: start.ts), not a run. */
function runState(): { label: (typeof RUN)[number]; disabled: boolean; busy: boolean; start: boolean } {
  const st = engine.value,
    s = st.s;
  const offer = startOffer(st);
  if (offer !== null) {
    // no engine. A start that cannot be tried again from here (the banner says to reload, or to use another browser)
    // keeps "Not started"; while a take-over is in progress the button is off, with the label it had
    if (offer === "off" && s !== "other-tab-taking")
      return { label: "Not started", disabled: true, busy: false, start: false };
    return { label: "Start engine", disabled: offer === "off", busy: false, start: true };
  }
  if (s === "ready") return { label: "Run", disabled: false, busy: false, start: false };
  if (s === "running" || s === "breaking" || s === "waiting")
    return { label: "Run", disabled: s !== "running", busy: true, start: false };
  if (s === "downloading" || s === "starting-list" || s === "starting-worker")
    return { label: "Starting…", disabled: true, busy: false, start: false };
  return { label: "Run", disabled: true, busy: false, start: false }; // the page load (checking-lock, checking-cache)
}

/** Break's label and look (section 5's Break column). Not isolated, Break resets at once: "Break (reset)". */
function breakState(): { label: (typeof BREAK)[number]; live: boolean; disabled: boolean } {
  const st = engine.value;
  if (st.s === "running") return { label: isolated.value ? "Break" : "Break (reset)", live: true, disabled: false };
  if (st.s === "breaking") return { label: "Stopping…", live: false, disabled: true };
  if (st.s === "waiting") return { label: "Reset now", live: true, disabled: false };
  return { label: "Break", live: false, disabled: true };
}

/** A press of Run (the toolbar's, the phone's): "Start engine" with no engine; a run when one can be sent; nothing
 *  while a run is on; else a toast that says why Run is off. */
function pressRun(run: ReturnType<typeof runState>, go: () => void) {
  if (run.busy) return;
  if (run.disabled) {
    const words = refusedRunWords(engine.value.s);
    if (words) showToast(words, "error");
  } else if (run.start) startEngine();
  else go();
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
  const tab = tabs.value.find((t) => t.path === activeTab.value);
  const dirty = tab?.dirty ?? false;
  const text = tab?.kind === "text"; // Save saves a text tab; a .dta tab has nothing to save
  const usable = !run.disabled && !run.busy && !run.start; // a run can be sent
  // new elements for each label (one vnode is not placed twice)
  const play = () => <Icon name="play" />,
    stop = () => <Icon name="stop" />,
    enter = () => <Key mod k="↩" />;
  const keyS = () => <Key mod k="S" />,
    dot = () => <span class="dot" role="img" aria-label="unsaved changes" />;
  return (
    <>
      {/* Off, Run is aria-disabled, never disabled: a focused Run keeps the focus, so a second Enter can't reach Break. */}
      <button
        type="button"
        class={`btn primary run-ctl${run.busy || run.disabled ? " off" : ""}`}
        aria-label={NAME[run.label]}
        aria-disabled={run.busy || run.disabled || undefined}
        aria-keyshortcuts={(usable && !sel) || (run.start && !run.disabled) ? modShortcut("Enter") : undefined}
        onKeyDown={ignoreHeldEnter}
        onClick={() => pressRun(run, () => editorCommands.runFile())}
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
        disabled={!text}
        aria-keyshortcuts={text ? modShortcut("S") : undefined}
        onClick={() => editorCommands.save()}
      >
        <Labels
          at={(text ? 0 : 2) + (dirty ? 0 : 1)}
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
 *  the run. A tap that counts also shows the Log view, where the Break's countdown and its outcome are (decided at the
 *  step 4b review, from 4d's: its stopping banner is in the Log view's slot). Both buttons carry every label either can show, so they have one width and the ⋯ beside them never moves. */
export function PhoneRun() {
  const st = engine.value;
  const running = st.s === "running" || st.s === "breaking" || st.s === "waiting";
  const run = runState(),
    brk = breakState(),
    sel = running ? null : selection.value;
  const range = sel && !run.disabled && !run.start ? (sel[0] === sel[1] ? `${sel[0]}` : `${sel[0]}–${sel[1]}`) : null;
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
        onKeyDown={ignoreHeldEnter} // the Run button's node: a held Enter that ran the file must not press Break
        onClick={() => {
          if (Date.now() - st.t0 < 600) return;
          pressBreak();
          phoneTab.value = "log"; // Break's countdown, "wait for it" and the outcome show in the Log view
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
      class={`btn primary run-ctl${run.disabled ? " off" : ""}`}
      aria-label={name}
      aria-disabled={run.disabled || undefined}
      onKeyDown={ignoreHeldEnter}
      onClick={() => pressRun(run, () => (sel ? editorCommands.runSelection() : editorCommands.runFile()))}
    >
      <Labels at={range ? all.length - 2 : RUN.indexOf(run.label)} labels={all} />
    </button>
  );
}
