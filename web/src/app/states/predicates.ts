// Which engine states mean what, for the views: guards made from the groups in engine/machine.ts, which decides the
// state. A view asks one of these, never a set of state names.

import {
  accepts,
  BREAK_ASKED,
  LOADING,
  member,
  OTHER_TAB,
  RUN_ON,
  STARTING,
  UP,
  WORKER_LIVE,
} from "../../engine/machine.ts";
import type { EngineState } from "../types.ts";

/** An engine exists: it can be reset, and the graphics part is fetched for it. */
export const engineUp = member(UP);
/** A run is on (running, or Break asked for and not yet over). */
export const runOn = member(RUN_ON);
/** Break was asked for: the countdown, or the reset offered once it ran out. */
export const breakAsked = member(BREAK_ASKED);
/** The engine is on its way: the download, or one of the two stages after it. */
export const engineStarting = member(STARTING);
/** The start has the engine's files and a worker (no download left): "You can edit and upload while it starts". */
export const engineLoading = member(LOADING);
/** A worker is there, or on its way, to answer a read (the client queues a call while the worker starts). */
export const workerReachable = member(WORKER_LIVE);
/** Another tab holds the engine: the toolbar's run controls keep their place, unseen. */
export const otherTab = member(OTHER_TAB);

/** The engine takes a run now (the machine's table has a `run` cell in this state). */
export const takesRun = (st: EngineState): boolean => accepts(st.s, "run");
