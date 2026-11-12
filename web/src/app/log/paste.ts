// The command line is one line. Text pasted into it with line breaks runs each line in turn (the maintainer's decision,
// 2026-11-11), as if each were typed and run with Enter, the next only once the one before has ended:
//  - a paste with no line break, or with line breaks only at its end (one copied line), is an ordinary paste
//    (pastedLines answers null); the browser then pastes it as it is, and a one-line field drops the breaks;
//  - the field's text before and after the cursor joins the first and the last pasted line, as a paste would put them;
//  - lines that are empty or only spaces are left out; "\r\n" and "\r" are line breaks too;
//  - with no engine (start.ts) no pasted line runs: the paste is an ordinary paste (pasterun.ts linesToRun checks the
//    engine first), into a field that is disabled then;
//  - the lines stop at the first one that is not run (refused: the page load, a start or a run in progress), that ends
//    with an error (any rc but 0, Break's rc 1 too), or whose run is cut because another tab took the engine (the rest
//    never go to the engine this tab gets back). The rest are not run, and the page says how many in a toast; a refused
//    line goes back into the field, as a typed one stays, unless the field is disabled by then (pasterun.ts putBack);
//  - a block (`forvalues i = 1/3 {` ... `}`, `program define` ... `end`, `mata` ... `end`), a comment that goes on to
//    the next lines (`/*` ... `*/`) or a command continued with `///` cannot run this way, one line at a time (a pasted
//    `/*`, `drop _all`, `*/` would run `drop _all`): the lines stop before the line that opens it (it is not sent), and
//    the toast says to run it from the editor.
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts). log/CommandLine.tsx gives runInTurn the real runner.
import { opensEndBlock } from "./align.ts";

/** The lines a paste runs, or null when the pasted text has no line break (an ordinary paste). */
export function pastedLines(before: string, pasted: string, after: string): string[] | null {
  const text = pasted.replace(/[\r\n]+$/, ""); // trailing line breaks do not count: one copied line is an ordinary paste
  if (!/[\r\n]/.test(text)) return null;
  return `${before}${text}${after}`.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
}

/** What running one line gave, at once (runCommand's `how`): when it started, `done` is the run's rc, or "taken" when
 *  another tab took the engine during it. */
export type RunOne = (line: string) => { how: "started"; done: Promise<number | "taken"> } | { how: "refused" };

/** How a pasted run of lines ended. `ran`: the lines run (an error's line counts). `stop`: why the rest did not run. */
export interface InTurn {
  total: number;
  ran: number;
  stop: null | { line: number; why: "refused" | "error" | "block" | "taken"; rc?: number }; // line: 1-based, of the paste
}

/** Whether a `/*` comment is still open at the end of `line` (strings left out). */
function opensComment(line: string): boolean {
  const text = line.replace(/`"[\s\S]*?"'/g, "").replace(/"[^"]*"/g, "");
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("/*", i)) {
      depth++;
      i++;
    } else if (depth && text.startsWith("*/", i)) {
      depth--;
      i++;
    } else if (!depth && text.startsWith("//", i)) break;
  }
  return depth > 0;
}

/** Whether a line cannot run on its own: it opens a block (`{` at its end, `program define`, `mata`), a comment that
 *  goes on (`/*` with no `*/ `) or goes on to the next line (`; ///`). */
export const opensBlock = (line: string) =>
  /\{\s*$/.test(line) || line.includes("///") || opensEndBlock(line) || opensComment(line);

/** Run `lines` one after the other through `runOne`, as the module's header says. */
export async function runInTurn(lines: readonly string[], runOne: RunOne): Promise<InTurn> {
  for (let i = 0; i < lines.length; i++) {
    if (opensBlock(lines[i])) return { total: lines.length, ran: i, stop: { line: i + 1, why: "block" } };
    const one = runOne(lines[i]);
    if (one.how !== "started") return { total: lines.length, ran: i, stop: { line: i + 1, why: one.how } };
    const rc = await one.done;
    if (rc === "taken") return { total: lines.length, ran: i + 1, stop: { line: i + 1, why: "taken" } };
    if (rc !== 0) return { total: lines.length, ran: i + 1, stop: { line: i + 1, why: "error", rc } };
  }
  return { total: lines.length, ran: lines.length, stop: null };
}

/** The toast after a pasted run that stopped with lines left, or null when every line ran (or the last one failed, with
 *  nothing left: its error is in the log). */
export function inTurnWords(r: InTurn): string | null {
  if (!r.stop) return null;
  const left = r.total - r.ran;
  if (left <= 0) return null;
  const lines = `${left} of ${r.total} pasted lines`;
  if (r.stop.why === "error") return `${lines} not run: line ${r.stop.line} ended with r(${r.stop.rc})`;
  if (r.stop.why === "refused") return `${lines} not run: the engine can't take a command now`;
  if (r.stop.why === "taken") return `${lines} not run: another tab took over the engine during line ${r.stop.line}`;
  return `${lines} not run: line ${r.stop.line} can't be run from the command line; run it from the editor`; // block
}
