// The toolbar's Run, Run selection, Break and Save (docs/design/SPEC.md, sections 3.4 and 5), and the phone's one Run
// button that Break replaces while a run is on.
// Each button holds all its labels in one cell (ui/Icon.tsx Labels), so it keeps one size in every engine state and
// nothing in the toolbar moves (e2e/shell.spec.ts measures it). A new label goes into the button's list, and the pill's
// time ("Break" "3.4 s") goes in with a sizer of its widest form. The phone's Run and Break pill have the same list, so
// they are the same width.
// Run is never `disabled`: off, it is aria-disabled and `.off`, so a Run that has the focus keeps it when its state
// turns it off ("Start engine" pressed by keyboard after a failed start becomes "Starting…"). A press then says why in
// a toast, except while a run is on, where a second Enter must stay silent.

import * as eng from "../engine.ts";
import { startEngine, startOffer } from "../start.ts";
import { activeTab, engine, isolated, phoneTab, showToast, tabs } from "../state.ts";
import { Icon, Key, Labels, modShortcut } from "../ui/Icon";
import { ignoreHeldEnter } from "../ui/keys.ts";
import { since } from "./clock.ts";
import { editorCommands, selection } from "./commands.ts";
import { PILL_WIDEST, pillTime, refusedRunWords } from "./words.ts";

// The play and stop icons say Run and Break, so the labels are short; NAME is what a screen reader hears.
const RUN = ["Run", "Start engine", "Starting…", "Not started"] as const;
const BREAK = ["Break", "Break (reset)", "Stopping…", "Reset now"] as const;
const NAME: Partial<Record<string, string>> = {
  "Starting…": "Starting… Run is not available until the engine is ready",
  "Not started": "Not started: the engine didn't start, so Run is not available",
  "Break (reset)": "Break (reset): Break resets the engine on this page",
};

/** Run's label and whether it can be pressed, by engine state (SPEC section 5's Run column). `start`: the button is
 *  "Start engine" (there is no engine, and a press starts it), not a run. */
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

/** Break's label and look (SPEC section 5's Break column). Not isolated, Break resets at once: "Break (reset)". */
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
  // new elements for each label: one vnode is not placed twice
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
          at={text && dirty ? 0 : 1}
          labels={[
            <>
              Save{dot()}
              {keyS()}
            </>,
            <>Save{keyS()}</>,
          ]}
        />
      </button>
    </>
  );
}

/** The phone's one button: Run (or "Run 6–7" with a selection, named "Run lines 6–7"), and while a run is on, Break in
 *  its place as a pill. A tap in Break's first 600 ms is ignored, so a double tap on Run doesn't break the run. A tap
 *  that counts also shows the Log view, where Break's countdown and outcome are. Both buttons carry every label either
 *  can show, so the ⋯ beside them never moves. */
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
