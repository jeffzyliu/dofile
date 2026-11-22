// The logic and the words of the dialogs and banners that are plain text, with no view and no signal of their own (so
// Node tests them: test/states.test.ts).

import type { Line } from "../../engine/machine.ts";
import { BREAK_GRACE_MS } from "../../engine/types.ts";
import { megabytes } from "../bytes.ts";
import type { CrashCause, EngineStateName, FailReason, ResetKind, RunHead, Stage } from "../types.ts";

/** How long Break waits before the engine is reset (`BREAK_GRACE_MS` in engine/types.ts, the machine's `graceMs` by
 *  default). The page's words count from it ("In 4 s the engine is reset"); the machine decides, not these words. */
export const GRACE_S = BREAK_GRACE_MS / 1000;
/** The stopping banner's "Don't reset: wait for it" (S 9) and its focus come once the Break has been pending this
 *  long. */
export const STOPPING_AFTER_S = 1;

/** A time as the drawings write it: "6 s", "7.1 s" (under 10 s one decimal, else whole seconds). */
export const secs = (s: number): string => (s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);
/** "14.2 of 48 MB": what arrived, of the total, both in MB (one decimal for what arrived). */
export const ofTotal = (received: number, total: number): string =>
  `${megabytes(received, 1)} of ${megabytes(total, 0)} MB`;

/** What S 3's first line says at each stage of a start (the `Stage` ids are the state machine's). */
export const stageNow: Record<Stage, string> = {
  download: "Downloading the engine",
  unpack: "Unpacking the engine",
  python: "Starting Python",
  files: "Loading your files",
  packages: "Loading packages",
  engine: "Starting the engine",
};

/** The stages a start goes through, in order: the snapshot start, or ?snapshot=0. */
export const stagesOf = (snapshot: boolean): Stage[] =>
  snapshot
    ? ["download", "unpack", "python", "files", "engine"]
    : ["download", "python", "files", "packages", "engine"];

/** The stage words with a small first letter: the status bar says them after its "Starting · ". */
export const stageStatus = Object.fromEntries(
  Object.entries(stageNow).map(([k, v]) => [k, v[0].toLowerCase() + v.slice(1)]),
) as Record<Stage, string>;

/** The message of a start that failed with reason "updated". Views key on the reason, not on these words. */
export const UPDATED = "dofile has a newer version on this site. Reload the page to use it.";

/** What a failed start tells the visitor (`message`), by reason: what happened and what they can do, in plain words.
 *  The developer's cause is `detail`, and goes to the console. */
export const FAILED: Record<FailReason, string> = {
  "no-wasm": "This browser can't run the engine: it has no WebAssembly support. Try another browser.",
  download: "The engine didn't download completely. Check your connection, then try again.",
  memory: "There wasn't enough memory to start the engine. Close other tabs, then try again.",
  updated: UPDATED,
  unknown: "Something went wrong while starting the engine. Try again, or reload the page.",
};
/** The message of `failed-twice`, whatever the reason: it is not started again, so only a reload helps. */
export const FAILED_TWICE =
  "The engine failed twice while starting, so it won't try again by itself. Reload the page to try again.";

/** The fixed lines of the live region. A stage's line is stageNow. */
export const SAY: Record<Exclude<Line, { stage: Stage }>, string> = {
  ready: "Engine ready",
  reset: "Engine reset",
  "download-stopped": "Download stopped",
  failed: "The engine didn't start",
  "failed-twice": "The engine stopped after failing twice",
};

/** Whether Reset asks first (S 14): it may reset at once only while the engine is `ready` and nothing has run on it
 *  since it started (a new engine, or one just reset: `engineRuns` 0). Anything the dialog says it clears (data, e()
 *  and r(), macros, Stata scalars and matrices, graphs) can only come from a run, so this asks whenever there may be
 *  something and needs no question put to the engine. A run in progress asks: what it holds is known only when it
 *  ends. */
export const resetAsks = (state: EngineStateName, engineRuns: number): boolean => state !== "ready" || engineRuns > 0;

/** The bold part of the stopping banner's countdown (S 9). At 0 the reset is under way: no "In 0 s". */
export const resetIn = (left: number): string =>
  left > 0 ? `In ${left} s the engine is reset:` : "The engine is being reset now:";

/** The reset banner: `head` in bold, then `rest`. A crash's head comes from its `cause`; `reason` is the machine's
 *  words for a Break that ran out of time, and the developer's for the rest. */
export function resetWords(
  kind: ResetKind,
  cause: CrashCause | null,
  reason: string,
  isolated: boolean,
): { head: string; rest: string } {
  const kept = "The data in memory is lost; your files are kept.";
  if (kind === "user") return { head: "You reset the engine.", rest: kept };
  if (kind === "break" && !isolated)
    return {
      head: "Break reset the engine.",
      rest: `This page can't ask a run to stop, so Break resets it. ${kept}`,
    };
  if (kind === "crash")
    return {
      head:
        cause === "storage"
          ? "The browser closed the file storage, and the engine was reset."
          : cause === "folder"
            ? "The engine's version of your files was out of date, so the engine was reset."
            : "The engine crashed and was reset.",
      rest: kept,
    };
  return { head: `The engine was reset: ${reason}.`, rest: kept };
}

/** The file "Run the file again" (the reset banner) runs: the file whose run the reset cut, when it was a run of a
 *  whole file and not a Reset the visitor asked for (`kind` "user"); else null, and the banner has only "Dismiss". A
 *  cut selection or command, or a reset with no run in progress, is not offered: running the file would not be what was
 *  cut. */
export const rerunPath = (kind: ResetKind, run: RunHead | null): string | null =>
  kind !== "user" && run?.kind === "file" && run.path ? run.path : null;

/** What the running banner (E?r) calls the run: "lines 14–15", "analysis.do", "a command". */
export function runningWhat(run: RunHead): string {
  if (run.kind === "selection" && run.lines) {
    const [a, b] = run.lines;
    return a === b ? `line ${a}` : `lines ${a}–${b}`;
  }
  if (run.kind === "file" && run.path) return run.path.split("/").pop() ?? run.path;
  return "a command";
}

/** The first line of the not-started banner (S 6) for a reason; the reason's own sentence (the engine's `message`)
 *  follows. */
export const FAILED_HEAD = "The engine didn't start.";
/** S 6's second sentence, after the reason: what still works. */
export const FILES_SAFE = "Your files are safe: you can still edit and download them.";

/** Which action each failed reason gets, in the order shown (S 6: "other reasons, other first action"). */
export type FailedAction = "browsers" | "try-again" | "reload" | "download-all";
export function failedActions(reason: FailReason): FailedAction[] {
  switch (reason) {
    case "no-wasm":
      return ["browsers", "download-all"];
    case "download":
    case "memory":
      return ["try-again", "download-all"];
    case "updated":
      return ["reload", "download-all"];
    case "unknown":
      return ["try-again", "reload", "download-all"];
    default:
      return reason satisfies never;
  }
}

/** The second line of S 7 (failed twice), with the reason when it is memory. */
export const twiceWords = (reason: FailReason): { head: string; rest: string } => ({
  head: `The engine stopped after failing twice${reason === "memory" ? " (out of memory)" : ""}.`,
  rest: "It won't restart by itself, since each attempt can use a lot of memory. Your files are safe: you can still edit and download them.",
});

// ---- the two notes in the page's own words (log/LogView.tsx shows them) ----

/** Community commands the engine does not have (F 3.5). */
export const COMMUNITY = ["reghdfe", "esttab", "estout", "outreg2", "ivreg2", "xtivreg2", "ftools", "winsor2"];

/** A note to put under a run's error, in the page's words, or null (log/LogView.tsx shows it). `rc` and `error` are the
 *  run's. Two cases: `restore` with nothing preserved (r(622)); a community command (r(199)). A temporary name from an
 *  earlier run (r(601) naming the engine's temporary file) has no note: the engine's own line says it
 *  (src/dofile/browser.py TEMPFILE_HINT, "a tempfile lasts one run: save it under a name to use it in a later run"). */
export function noteFor(rc: number, error: string | null): string | null {
  if (!error) return null;
  if (rc === 622 && /nothing to restore/.test(error))
    return "Nothing was preserved. A run restores its data when it ends, so put preserve and restore in the same run.";
  const m = rc === 199 ? /command (\S+) is unrecognized/.exec(error) : null;
  if (m && COMMUNITY.includes(m[1]))
    return `${m[1]} is a community command. OpenDTA, the engine behind dofile, doesn't include it.`;
  return null;
}
