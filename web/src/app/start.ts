// "Start engine": with no engine nothing on the page offers to run, and one action is offered, starting the engine
// (docs/web-page-flows.md, section 2, has the table; docs/design/SPEC.md, sections 3.4, 3.5 and 5). This module is the
// one statement of which engine states are "no engine" and of what a press of "Start engine" does in each. The toolbar's
// Run, the command line's button and Ctrl/Cmd+Enter in the editor all call startEngine(); the command line's field,
// Run selection, Load, Import and the log's `help x` links are off while startOffer() is not null.
// Plain TypeScript, no DOM: tested in Node (test/app.test.ts).
import * as engine from "./engine.ts";
import * as S from "./state.ts";
import { failedActions } from "./states/words.ts";
import type { EngineState } from "./types.ts";

/** What "Start engine" does in a state with no engine:
 *   "prompt"     the download prompt opens (`none`, `declined`; `asking`: it is open already, and is shown again);
 *   "retry"      the start is tried again, as the failed banner's "Try again" does (`failed`, for the reasons whose
 *                banner has that button: states/words.ts failedActions);
 *   "take-over"  the take-over dialog opens, where the visitor chooses (`other-tab-idle`): never straight to a start;
 *   "off"        nothing can start the engine from here: a failed start whose banner says to reload or to use another
 *                browser, `failed-twice`, and `other-tab-taking` (the take-over is in progress). */
export type StartOffer = "prompt" | "retry" | "take-over" | "off";

/** The state's offer, or null when the state is not "no engine": the page load (`checking-lock`, `checking-cache`: the
 *  engine may start by itself from the browser's copy), a download or a start in progress, and an engine that is up. */
export function startOffer(st: EngineState): StartOffer | null {
  switch (st.s) {
    case "none":
    case "asking":
    case "declined":
      return "prompt";
    case "failed":
      return failedActions(st.reason).includes("try-again") ? "retry" : "off";
    case "failed-twice":
    case "other-tab-taking":
      return "off";
    case "other-tab-idle":
      return "take-over";
    case "checking-lock":
    case "checking-cache":
    case "downloading":
    case "starting-list":
    case "starting-worker":
    case "ready":
    case "running":
    case "breaking":
    case "waiting":
      return null;
    default:
      return st satisfies never;
  }
}

/** Whether there is no engine: nothing offers to run then (the `engine` signal is read: call it while drawing). */
export const noEngine = (): boolean => startOffer(S.engine.value) !== null;

/** A press of "Start engine" (the buttons, and Ctrl/Cmd+Enter): what the state's offer says. It runs nothing, and nothing
 *  runs when the engine is ready. Returns the offer it acted on ("off": it did nothing), or null when there is an
 *  engine, or one on its way, and nothing was done: the caller then goes on with its run. */
export function startEngine(): StartOffer | null {
  const offer = startOffer(S.engine.value);
  if (offer === "prompt" || offer === "take-over") engine.ask();
  else if (offer === "retry") engine.start();
  return offer;
}

/** The toast of a control that is off because there is no engine (Load, Import, a `help x` link): what to do, and what
 *  for. `what`: "see help regress", "load wages.dta". Draft words (SPEC section 8). */
export const startFirst = (what: string): string => `Start the engine to ${what}`;
/** The command line's hint while it is disabled, by the offer (shown while the field is empty). Draft words. */
export const startHint = (offer: StartOffer): string =>
  offer === "off" ? "The engine isn't running" : "Start the engine to run code";
