// The time the status bar, the phone's strip and the Break pill count with: `now` (Date.now(), the clock of the engine
// states' t0) ticks every 100 ms while a timer shows (a run, a Break, a start), and stands still otherwise. It reads the
// engine's state and decides none: the timers only show the states' own times.
import { effect, signal } from "@preact/signals-core";
import { engine } from "../state.ts";
import type { EngineState } from "../types.ts";

export const now = signal(Date.now());

const TICKING = new Set<EngineState["s"]>(["running", "breaking", "waiting", "starting-list", "starting-worker"]);
let timer: ReturnType<typeof setInterval> | undefined;
effect(() => {
  const on = TICKING.has(engine.value.s);
  if (on && timer === undefined) {
    now.value = Date.now();
    timer = setInterval(() => {
      now.value = Date.now();
    }, 100);
  } else if (!on && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
});

/** Seconds since `t0` (a run's start, a stage's start), by the ticking clock. */
export const since = (t0: number) => Math.max(0, (now.value - t0) / 1000);

/** While Break waits for a command (`breaking`): the whole seconds left before the engine is reset ("resets in 4 s"). */
export const resetsIn = (st: Extract<EngineState, { s: "breaking" }>) =>
  Math.max(0, Math.ceil((st.resetAt - now.value) / 1000));
