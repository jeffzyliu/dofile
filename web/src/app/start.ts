// "Start engine": with no engine nothing on the page offers to run, and one action is offered, starting the engine
// (docs/web-page-flows.md, section 2; docs/design/SPEC.md, sections 3.4, 3.5 and 5). This module is the one statement
// of which engine states are "no engine" and of what a press of "Start engine" does in each. Plain TypeScript, no DOM:
// tested in Node (test/app-start.test.ts).

import type { EngineState } from "./types.ts";

import { engine as engineState } from "./state/engine.ts";

import * as engine from "./engine.ts";

import { takesRun } from "./states/predicates.ts";
import { failedActions } from "./states/words.ts";

/** What "Start engine" does in a state with no engine:
 *   "prompt"     the download prompt opens (`none`, `declined`; `asking`: it is open already, and is shown again);
 *   "retry"      the start is tried again, as the failed banner's "Try again" does (states/words.ts failedActions);
 *   "take-over"  the take-over dialog opens, where the visitor chooses (`other-tab-idle`): never straight to a start;
 *   "off"        nothing can start the engine from here: a failed start whose banner says to reload or to use another
 *                browser, `failed-twice`, and `other-tab-taking`. */
export type StartOffer = "prompt" | "retry" | "take-over" | "off";

/** The state's offer, or null when the state is not "no engine": the page load (the engine may start by itself from the
 *  browser's copy), a download or a start in progress, and an engine that is up. */
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

/** Whether there is no engine: nothing offers to run then. Reads a signal: call it while drawing. */
export const noEngine = (): boolean => startOffer(engineState.value) !== null;

/** A press of "Start engine" (the buttons, and Ctrl/Cmd+Enter): what the state's offer says. It runs nothing.
 *  @returns the offer it acted on ("off": it did nothing), or null when there is an engine, or one on its way, and
 *  nothing was done: the caller then goes on with its run. */
export function startEngine(): StartOffer | null {
  const offer = startOffer(engineState.value);
  if (offer === "prompt" || offer === "take-over") engine.ask();
  else if (offer === "retry") engine.start();
  return offer;
}

/** The toast of a control that is off because there is no engine (Load, Import, a `help x` link), by the offer.
 *  @param what - what the visitor wanted to do: "see help regress", "load wages.dta" */
export const startFirst = (offer: StartOffer, what: string): string =>
  offer === "off" ? `The engine isn't running: can't ${what}` : `Start the engine to ${what}`;
/** The primary button of a command bar (Import, Load).
 *  @param command - null when the file's name cannot be put in a command
 *  @param takesRun - whether the engine takes a run now
 *  @returns off: aria-disabled and focusable, a press says why in a toast; disabled: the attribute */
export const barButton = (offer: StartOffer | null, command: string | null, takesRun: boolean) => ({
  off: offer !== null,
  disabled: command === null || (offer === null && !takesRun),
});
/** The offer and the primary button of a command bar in engine state `st` (barButton, with the engine's gate). */
export const barOf = (st: EngineState, command: string | null) => {
  const offer = startOffer(st);
  return { offer, ...barButton(offer, command, takesRun(st)) };
};
/** The command line's placeholder while it is off, by the offer. */
export const startHint = (offer: StartOffer): string =>
  offer === "off" ? "The engine isn't running" : "Start the engine to run code";
