// Which engine states mean what, stated once for the views (the machine decides the state: engine/machine.ts). Each
// table names all sixteen states, so a new state does not compile until it is placed.

import type { EngineState, EngineStateName } from "../types.ts";

type Named<S extends EngineStateName> = Extract<EngineState, { s: S }>;
const table = (names: readonly EngineStateName[]): Record<EngineStateName, boolean> =>
  ({
    "checking-lock": false,
    "checking-cache": false,
    none: false,
    asking: false,
    declined: false,
    downloading: false,
    "starting-list": false,
    "starting-worker": false,
    ready: false,
    running: false,
    breaking: false,
    waiting: false,
    failed: false,
    "failed-twice": false,
    "other-tab-idle": false,
    "other-tab-taking": false,
    ...Object.fromEntries(names.map((n) => [n, true])),
  }) satisfies Record<EngineStateName, boolean>;

const UP = table(["ready", "running", "breaking", "waiting"]);
const RUN_ON = table(["running", "breaking", "waiting"]);
const BREAK_ASKED = table(["breaking", "waiting"]);
const STARTING = table(["downloading", "starting-list", "starting-worker"]);
const LOADING = table(["starting-list", "starting-worker"]);
const REACHABLE = table(["starting-worker", "ready", "running", "breaking", "waiting"]);
const OTHER_TAB = table(["other-tab-idle", "other-tab-taking"]);

/** An engine exists: it can be reset, and the graphics part is fetched for it. */
export const engineUp = (st: EngineState): boolean => UP[st.s];
/** A run is on (running, or Break asked for and not yet over). */
export const runOn = (st: EngineState): st is Named<"running" | "breaking" | "waiting"> => RUN_ON[st.s];
/** Break was asked for: the countdown, or the reset offered once it ran out. */
export const breakAsked = (st: EngineState): st is Named<"breaking" | "waiting"> => BREAK_ASKED[st.s];
/** The engine is on its way: the download, or one of the two stages after it. */
export const engineStarting = (st: EngineState): boolean => STARTING[st.s];
/** The start has the engine's files and a worker (no download left): "You can edit and upload while it starts". */
export const engineLoading = (st: EngineState): st is Named<"starting-list" | "starting-worker"> => LOADING[st.s];
/** A worker is there, or on its way, to answer a read (the client queues a call while the worker starts). */
export const workerReachable = (st: EngineState): boolean => REACHABLE[st.s];
/** Another tab holds the engine: the toolbar's run controls keep their place, unseen. */
export const otherTab = (st: EngineState): boolean => OTHER_TAB[st.s];
