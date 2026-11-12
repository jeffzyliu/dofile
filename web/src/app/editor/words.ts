// The words of the run-head, the status bar, the phone's strip and the Break pill (SPEC 3.4 to 3.6 and 4). Plain
// TypeScript, no DOM: tested in Node (test/editor.test.ts). Text in quotes in the spec is used as it is; where it gives
// none, the words here are drafts for the maintainer (SPEC section 8, "As built in step 4b").
import type { EngineState, LastRun, Memory, RunHead } from "../types.ts";

/** "line 6" or "lines 6–7". */
export const linesWords = ([a, b]: [number, number]) => (a === b ? `line ${a}` : `lines ${a}–${b}`);

/** A finished run's time: "0.38 s", "18.4 s", "2 min 5 s". */
export function seconds(s: number): string {
  if (s < 1) return `${s.toFixed(2)} s`;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
}

/** A running timer: "3.4 s", "12 s", "2 min 5 s". */
export function ticking(s: number): string {
  if (s < 10) return `${Math.max(0, s).toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
}

/** The Break pill's time, short so the pill keeps its width: "3.4 s", "42 s", "12 min" (its sizer is PILL_WIDEST). */
export function pillTime(s: number): string {
  if (s < 10) return `${Math.max(0, s).toFixed(1)} s`;
  if (s < 60) return `${Math.floor(s)} s`;
  return `${Math.min(99, Math.floor(s / 60))} min`;
}
export const PILL_WIDEST = "88 min";

/** The run-head (section 4): the bold word, then the rest. On a phone a selection's head leaves out the file (PH?r). */
export function runheadWords(head: RunHead, first: boolean, phone: boolean): [string, string] {
  if (head.kind === "file") return ["Run", `: ${head.path ?? "the file"}, whole file · starts with no locals`];
  const where = head.lines ? linesWords(head.lines) : "the selection";
  const of = phone || !head.path ? "" : ` of ${head.path}`;
  return [
    "Run selection",
    `: ${where}${of} · keeps the locals of earlier runs${first ? " (first run: none yet)" : ""}`,
  ];
}

/** The status bar's last run, in pieces (E, S 10): "Last run: " + what, then rc (in the error color) and where, then
 *  the time. "whole file (started with no locals)" and "stopped by Break" are drawn; a selection's and a command's words
 *  are drafts. */
export function lastRunWords(r: LastRun): { what: string; rc: string | null; where: string | null; time: string } {
  const what =
    r.rc === 1
      ? "stopped by Break"
      : r.kind === "file"
        ? "whole file (started with no locals)"
        : r.kind === "selection"
          ? r.lines
            ? linesWords(r.lines)
            : "the selection"
          : "a command";
  const rc = r.rc === 0 ? null : `r(${r.rc})`;
  const where = r.rc !== 0 && r.rc !== 1 && r.line !== null && r.kind !== "command" ? `at line ${r.line}` : null;
  return { what, rc, where, time: seconds(r.seconds) };
}

/** "Memory 612 MB" (status bar) or "Mem 612 MB" (the phone's strip), from the heap the engine reports. */
export const memoryWords = (m: Memory, short = false) =>
  `${short ? "Mem" : "Memory"} ${Math.round(m.heap_bytes / 1e6).toLocaleString("en")} MB`;

/** Whether a run's end goes to a line in its file ("Go to line 17"): an error or Break with a line, not a command's. */
export const jumpLine = (r: LastRun): number | null =>
  r.rc !== 0 && r.line !== null && r.kind !== "command" && r.path ? r.line : null;

/** The toast when Ctrl/Cmd+Enter in the editor asks for a run the engine does not take, by the state, as the status bar
 *  picks its words (drafts for the maintainer, from the Run button's own: SPEC section 8). null where a run is taken or
 *  queued (`ready`; `none` and `declined` open the prompt). */
export function refusedRunWords(s: EngineState["s"]): string | null {
  switch (s) {
    case "ready":
    case "none":
    case "declined":
      return null;
    case "running":
    case "breaking":
    case "waiting":
      return "Run is off until this run ends";
    case "checking-lock":
    case "checking-cache":
    case "asking":
    case "downloading":
    case "starting-list":
    case "starting-worker":
      return "Starting… Run is off until the engine is ready";
    case "failed":
    case "failed-twice":
    case "other-tab-idle":
    case "other-tab-taking":
      return "Run is off: the engine isn't running in this tab";
  }
}
