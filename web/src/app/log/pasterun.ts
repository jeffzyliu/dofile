// The command line's runner for pasted lines (paste.ts runInTurn takes it): one line run as Enter would run it, and the
// wait for its end.
import { effect } from "@preact/signals-core";
import type { RunResult } from "../../engine/types.ts";
import { runCommand } from "../run.ts";
import { noEngine } from "../start.ts";
import { engine, lastRun } from "../state.ts";
import { takesRun } from "../states/predicates.ts";
import { type InTurn, inTurnWords, pastedLines, type RunOne } from "./paste.ts";

/** What a paste into the command line does, decided before anything is changed:
 *   "ordinary"  the browser pastes it: text with no line break (pastedLines), and any text while there is no engine.
 *               The engine is checked first: the field is off then, so this guards the instant before it is drawn so,
 *               and a paste never opens a prompt or runs a line;
 *   "refused"   lines, and an engine that is on its way but not `ready` (the page load, a start, a run): refused whole.
 *               Nothing is pasted, the field stays as it was, and `words` is the toast. Running the first line would
 *               have it refused and put back, with the other lines and the text after the cursor lost;
 *   "run"       `lines` run in turn (runInTurn): the engine is `ready`. */
export type Paste = { do: "ordinary" } | { do: "refused"; words: string } | { do: "run"; lines: string[] };
export function pastePlan(before: string, pasted: string, after: string): Paste {
  if (noEngine()) return { do: "ordinary" };
  const lines = pastedLines(before, pasted, after);
  if (!lines) return { do: "ordinary" };
  if (takesRun(engine.value)) return { do: "run", lines };
  const refused: InTurn = { total: lines.length, ran: 0, stop: { line: 1, why: "refused" } };
  return { do: "refused", words: inTurnWords(refused) ?? "The engine can't take a command now" };
}

/** The line to put back into the field after pasted lines stopped (`r`), or null: a line refused part of the way, when
 *  the field is empty (`fieldText`) and not off. */
export const putBack = (lines: readonly string[], r: InTurn, fieldText: string): string | null =>
  r.stop?.why === "refused" && !fieldText && !noEngine() ? lines[r.stop.line - 1] : null;

/** Wait for the end of a command that started: its rc once it has run (lastRun is a new run), or "taken" when its run
 *  was cut because another tab took the engine (`done` settles with kind "stopped", and lastRun is not written). The rc
 *  is taken from lastRun, not from `done`, which settles only after the run's after-run reads: lastRun is written in
 *  the state machine's step that ended the run, and this resolves in a microtask after that synchronous step, so the
 *  next pasted line starts before the page takes any other input. A Run or an Enter pressed between two pasted lines is
 *  then refused as during any run. `done` settling ends the wait too (the first of the two wins), so no wait outlives
 *  its run. */
function whenEnds(before: unknown, done: Promise<RunResult>): Promise<number | "taken"> {
  return new Promise((settle) => {
    let stop = () => {};
    let over = false;
    const end = (rc: number | "taken") => {
      if (over) return;
      over = true;
      queueMicrotask(() => {
        stop();
        settle(rc);
      });
    };
    stop = effect(() => {
      const r = lastRun.value;
      if (r && r !== before) end(r.rc);
    });
    done.then((r) => end(r.kind === "stopped" ? "taken" : r.rc));
  });
}

/** One pasted line, as Enter would run it. */
export const runOne: RunOne = (line) => {
  const before = lastRun.value;
  const run = runCommand(line);
  return run.how === "started" ? { how: "started", done: whenEnds(before, run.done) } : { how: "refused" };
};
