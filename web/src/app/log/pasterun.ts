// The command line's runner for pasted lines (log/paste.ts runInTurn takes it): one line run as Enter would run it, and
// the wait for its end. Plain TypeScript with signals, tested in Node (test/app.test.ts) on the real controllers.
import { effect } from "@preact/signals-core";
import type { RunResult } from "../../engine/types.ts";
import { runCommand } from "../run.ts";
import { noEngine } from "../start.ts";
import { engine, lastRun } from "../state.ts";
import { type InTurn, inTurnWords, pastedLines, type RunOne } from "./paste.ts";

/** What a paste into the command line does, decided before anything is changed:
 *   "ordinary"  the browser pastes it: text with no line break (paste.ts pastedLines), and any text while there is no
 *               engine (start.ts). The engine is checked first: the field is off then, so this guards the instant
 *               before it is drawn so, and a paste never opens a prompt or runs a line;
 *   "refused"   lines, and an engine that is there or on its way but not `ready` (the page load, a start, a run): the
 *               paste is refused whole. Nothing is pasted, the field stays exactly as it was, and `words` is the toast
 *               (the refusal's, with every line counted). Running the first line would have it refused and put back,
 *               with the other lines and the text after the cursor lost;
 *   "run"       `lines` run in turn (paste.ts runInTurn): the engine is `ready`. */
export type Paste = { do: "ordinary" } | { do: "refused"; words: string } | { do: "run"; lines: string[] };
export function pastePlan(before: string, pasted: string, after: string): Paste {
  if (noEngine()) return { do: "ordinary" };
  const lines = pastedLines(before, pasted, after);
  if (!lines) return { do: "ordinary" };
  if (engine.value.s === "ready") return { do: "run", lines };
  const refused: InTurn = { total: lines.length, ran: 0, stop: { line: 1, why: "refused" } };
  return { do: "refused", words: inTurnWords(refused) ?? "The engine can't take a command now" };
}

/** The line to put back into the field after pasted lines stopped (`r`), or null: a line refused part of the way (the
 *  engine was `ready` when the paste began: pastePlan), when the field is empty (`fieldText`) and not off. With no
 *  engine the field is off, and nothing is put into it. */
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
