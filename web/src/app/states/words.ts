// STEP 4d: the logic and the words of the dialogs and banners that are plain text, with no view and no signal of their own
// (so Node tests them: test/states.test.ts). The words the spec draws are in the views, as drawn; the words it does not
// give are drafts, marked DRAFT here and listed in SPEC section 8 ("Step 4d: draft words") for the maintainer to approve.

import { BREAK_GRACE_MS } from "../../engine/types.ts";
import type {
  DataSummary,
  EngineStateName,
  FailReason,
  LastRun,
  ResetKind,
  Results,
  RunHead,
  Stage,
} from "../types.ts";

/** How long Break waits before the engine is reset (`BREAK_GRACE_MS` in engine/types.ts, the machine's `graceMs` by default). The page's words
 *  count from it ("In 4 s the engine is reset"); the machine decides, not these words. */
export const GRACE_S = BREAK_GRACE_MS / 1000;
/** The stopping banner (S 9) shows once the Break has been pending this long: a run that stops at once never shows it. */
export const STOPPING_AFTER_S = 1;

/** A time as the drawings write it: "6 s", "7.1 s" (under 10 s one decimal, else whole seconds). */
export const secs = (s: number): string => (s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);
/** "14.2 of 48 MB": what arrived, of the total, both in MB (one decimal for what arrived). */
export const ofTotal = (received: number, total: number): string =>
  `${(received / 1e6).toFixed(1)} of ${Math.round(total / 1e6)} MB`;

/** What S 3's first line says at each stage of a start (the `Stage` ids are the state machine's). */
export const stageNow: Record<Stage, string> = {
  download: "Downloading the engine",
  unpack: "Unpacking the engine",
  python: "Starting Python",
  files: "Loading your files",
  packages: "Loading packages",
  engine: "Starting the engine",
};

/** Whether Reset has anything to lose: data in memory, or e() or r() results. Not asked when it has none (S 14). */
export function nothingToLose(data: DataSummary | null, results: Results | null): boolean {
  const dataInMemory = data !== null && !("error" in data) && (data.nobs > 0 || data.nvars > 0);
  const has = (r: Results["e"]) =>
    Object.keys(r.scalars).length + Object.keys(r.macros).length + Object.keys(r.matrices).length > 0;
  const anyResults = results !== null && (has(results.e) || has(results.r));
  return !dataInMemory && !anyResults;
}

/** Whether Reset asks first, on what is known now (S 14): it may reset at once only while the engine is `ready` with nothing
 *  to lose. A run in progress always asks: what it holds is known only when it ends. */
export const resetAsks = (state: EngineStateName, data: DataSummary | null, results: Results | null): boolean =>
  state !== "ready" || !nothingToLose(data, results);

/** What Reset reads: the engine's state and what is in memory (state.ts `engine`, `data`, `results`, `lastRun`). */
export interface ResetSnapshot {
  state: EngineStateName;
  data: DataSummary | null;
  results: Results | null;
  lastRun: LastRun | null;
}

/** What a press of "Reset the engine…" does: "ask" (the dialog), "reset" (at once) or "none" (the engine can no longer
 *  be reset). `read` gives the state now; `refresh` is run.ts refreshData. After a run, `data` may still describe the
 *  memory as it was before that run (run.ts sets `results` at the run's end and `data` only when refreshData answers), so
 *  "nothing to lose" after a run is checked again on a fresh description: a run that made data and no r() or e() is asked
 *  about. A description that does not come (`data` is the same object after `refresh`) asks. Before any run (`lastRun`
 *  null: a new engine, or one just reset) nothing is described again. */
export async function resetDecision(
  read: () => ResetSnapshot,
  refresh: () => Promise<unknown>,
): Promise<"ask" | "reset" | "none"> {
  const before = read();
  if (resetAsks(before.state, before.data, before.results)) return "ask";
  if (before.lastRun === null) return "reset";
  try {
    await refresh();
  } catch {
    // no description: `data` is unchanged, so it asks
  }
  const now = read();
  if (!["ready", "running", "breaking", "waiting"].includes(now.state)) return "none";
  if (now.data === before.data) return "ask";
  return resetAsks(now.state, now.data, now.results) ? "ask" : "reset";
}

/** The bold part of the stopping banner's countdown (S 9). At 0 the reset is under way: no "In 0 s". DRAFT (the 0 case). */
export const resetIn = (left: number): string =>
  left > 0 ? `In ${left} s the engine is reset:` : "The engine is being reset now:";

/** The reset banner (P/Notices, OQ-9): `head` in bold, then `rest`. `reason` is the machine's, the developer's words for what
 *  happened ("the engine crashed (<cause>)"); the visitor sees it with a cause in parentheses cut off. DRAFT (OQ-9, OQ-19c). */
export function resetWords(kind: ResetKind, reason: string, isolated: boolean): { head: string; rest: string } {
  const kept = "The data in memory is lost; your files are kept.";
  if (kind === "user") return { head: "You reset the engine.", rest: kept };
  if (kind === "break" && !isolated)
    return {
      head: "Break reset the engine.",
      rest: `This page can't ask a run to stop, so Break resets it. ${kept}`,
    };
  const why = reason.replace(/\s*\(.*\)\s*$/, "").trim();
  if (kind === "crash")
    return {
      head: /file storage/.test(why)
        ? "The browser closed the file storage, and the engine was reset."
        : "The engine crashed and was reset.",
      rest: kept,
    };
  return { head: `The engine was reset: ${why}.`, rest: kept };
}

/** The file "Run the file again" (the reset banner) runs: the file whose run the reset cut, when it was a run of a whole file
 *  and not a Reset the visitor asked for (`kind` "user"); else null, and the banner has only "Dismiss". A cut selection or
 *  command, or a reset with no run in progress, is not offered: running the file would not be what was cut. */
export const rerunPath = (kind: ResetKind, run: RunHead | null): string | null =>
  kind !== "user" && run?.kind === "file" && run.path ? run.path : null;

/** What the running banner (E?r) calls the run: "lines 14–15", "analysis.do", "a command". DRAFT (E?r draws lines only). */
export function runningWhat(run: RunHead): string {
  if (run.kind === "selection" && run.lines) {
    const [a, b] = run.lines;
    return a === b ? `line ${a}` : `lines ${a}–${b}`;
  }
  if (run.kind === "file" && run.path) return run.path.split("/").pop() ?? run.path;
  return "a command";
}

/** The first line of the not-started banner (S 6) for a reason; the reason's own sentence (the engine's `message`) follows. */
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
  rest: "It won't restart by itself, since each attempt can use a lot of memory. Your files are safe.",
});

// ---- OQ-10: the two notes in the page's own words (DRAFT; log/LogView.tsx shows them: see SPEC 8, "Step 4d") ----

/** Community commands the engine does not have (F 3.5). */
export const COMMUNITY = ["reghdfe", "esttab", "estout", "outreg2", "ivreg2", "xtivreg2", "ftools", "winsor2"];

/** A note to put under a run's error, in the page's words, or null (log/LogView.tsx shows it). `rc` and `error` are the
 *  run's. DRAFT (OQ-10): 1. `restore` with nothing preserved (r(622)); 2. a community command (r(199)). A temporary name
 *  from an earlier run (r(601) naming the engine's temporary file) has no note: the engine's own line says it
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
