// The command line's runner for pasted lines (log/paste.ts runInTurn takes it): one line run as Enter would run it, and
// the wait for its end. Plain TypeScript with signals, tested in Node (test/app.test.ts) on the real controllers.
import { effect } from "@preact/signals-core";
import type { RunResult } from "../../engine/types.ts";
import { runCommand } from "../run.ts";
import { noEngine } from "../start.ts";
import { lastRun } from "../state.ts";
import { type InTurn, pastedLines, type RunOne } from "./paste.ts";

/** The lines a paste into the command line runs, or null for an ordinary paste: text with no line break (paste.ts
 *  pastedLines), and any text while there is no engine (start.ts). The engine is checked first: the field is disabled
 *  then, so this guards the instant before it is drawn so, and a paste never opens a prompt or runs a line. */
export const linesToRun = (before: string, pasted: string, after: string): string[] | null =>
  noEngine() ? null : pastedLines(before, pasted, after);

/** The line to put back into the field after pasted lines stopped (`r`), or null: a refused line, when the field is
 *  empty (`fieldText`) and not disabled. With no engine the field is disabled, and nothing is put into it. */
export const putBack = (lines: readonly string[], r: InTurn, fieldText: string): string | null =>
  r.stop?.why === "refused" && !fieldText && !noEngine() ? lines[r.stop.line - 1] : null;

/** Wait for the end of a command that started: its rc once it has run (lastRun is a new run), or "taken" when its run was
 *  cut because another tab took the engine (`done` settles with the machine's rc 9998 result of kind "stopped", and
 *  lastRun is not written). The rc is taken from lastRun when it comes, not from `done`, which settles only after the
 *  run's after-run reads (files.ts afterRun, run.ts refreshData): lastRun is written in the step of the state machine
 *  that ended the run, and this resolves in a microtask after that step (a run cannot start inside it; the step is
 *  synchronous, so it is over by then), so the next pasted line starts before the page takes any other input: a Run or
 *  an Enter pressed between two pasted lines waits for the next line's run and is refused as during any run. `done`
 *  settling always ends the wait too (the first of the two wins; the effect is then stopped), so no wait outlives its
 *  run. */
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
