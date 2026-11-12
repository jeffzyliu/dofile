// The command line is one line. Text pasted into it with line breaks runs each line in turn (the maintainer's decision,
// 2026-11-11), as if each were typed and run with Enter, the next only once the one before has ended:
//  - a paste with no line break is an ordinary paste (pastedLines answers null);
//  - the field's text before and after the cursor joins the first and the last pasted line, as a paste would put them;
//  - lines that are empty or only spaces are left out; "\r\n" and "\r" are line breaks too;
//  - the lines stop at the first one that is not run (refused: a start or a run in progress; or accepted while there is
//    no engine and then dropped, by "Not now" say) or that ends with an error (any rc but 0, Break's rc 1 too). The rest
//    are not run, and the page says how many in a toast; a refused line goes back into the field, as a typed one stays.
// A block (`forvalues i = 1/3 {` ... `}`) does not run as one this way: each line is its own command. Run it from the editor.
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts). log/CommandLine.tsx gives runInTurn the real runner.

/** The lines a paste runs, or null when the pasted text has no line break (an ordinary paste). */
export function pastedLines(before: string, pasted: string, after: string): string[] | null {
  if (!/[\r\n]/.test(pasted)) return null;
  return `${before}${pasted}${after}`.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
}

/** What running one line gave: `accepted` at once (runCommand's), then `done`: the run's rc, or null when it did not run
 *  (it was queued for an engine that then did not start). */
export type RunOne = (line: string) => { accepted: boolean; done: Promise<number | null> };

/** How a pasted run of lines ended. `ran`: the lines run (an error's line counts). `stop`: why the rest did not run. */
export interface InTurn {
  total: number;
  ran: number;
  stop: null | { line: number; why: "refused" | "not-run" | "error"; rc?: number }; // line: 1-based, of the paste
}

/** Run `lines` one after the other through `runOne`, as the module's header says. */
export async function runInTurn(lines: readonly string[], runOne: RunOne): Promise<InTurn> {
  for (let i = 0; i < lines.length; i++) {
    const { accepted, done } = runOne(lines[i]);
    if (!accepted) return { total: lines.length, ran: i, stop: { line: i + 1, why: "refused" } };
    const rc = await done;
    if (rc === null) return { total: lines.length, ran: i, stop: { line: i + 1, why: "not-run" } };
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
  return `${lines} not run: line ${r.stop.line} didn't run`;
}
