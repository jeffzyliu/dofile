// The clock the run, Break and start timers count with, so they agree (docs/design/SPEC.md, S 9): `now` (Date.now(), as
// the engine states' t0) ticks every 100 ms while a timer shows, and stands still otherwise. The download dialog keeps
// its own (states/clock.ts).
import { effect, signal } from "@preact/signals-core";
import { BREAK_GRACE_MS } from "../../engine/types.ts";
import { engine } from "../state/engine.ts";
import { engineLoading, runOn } from "../states/predicates.ts";
import type { EngineStateOf } from "../types.ts";

export const now = signal(Date.now());

let timer: ReturnType<typeof setInterval> | undefined;
effect(() => {
  const on = runOn(engine.value) || engineLoading(engine.value);
  if (on) now.value = Date.now(); // each new state starts from the true time, not up to one tick late
  if (on && timer === undefined) {
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

/** While Break waits for a command: the whole seconds left before the engine is reset ("resets in 4 s"). */
export const resetsIn = (st: EngineStateOf<"breaking">) => Math.max(0, Math.ceil((st.resetAt - now.value) / 1000));

/** While Break waits for a command: the seconds since Break was pressed (`resetAt` is that moment plus the grace). */
export const breakPending = (st: EngineStateOf<"breaking">) => (now.value - (st.resetAt - BREAK_GRACE_MS)) / 1000;
