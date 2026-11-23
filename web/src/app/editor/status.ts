// What the status bar and the phone's strip say (docs/design/SPEC.md, sections 3.6 and 5), as typed parts in the order
// they are drawn. One model, two forms: the desktop's bar is the full form; the phone's strip is the short form, which
// leaves out what has no room there (the run's timer, the affiliation, the files note) and says the rest shorter ("Engine
// 612 MB"). The views, StatusBar.tsx and log/PhoneStrip.tsx, only draw the parts. No DOM and no signal: the signals'
// values and the clock come in as arguments, so Node tests it (test/status.test.ts).
import type { GraphicsProgress } from "../../engine/types.ts";
import type { EngineState, LastRun, Memory } from "../types.ts";

import { breakAsked, engineLoading, engineUp } from "../states/predicates.ts";
import { stageStatus, stagesOf } from "../states/words.ts";

import { megabytes } from "../bytes.ts";
import { jumpLine, lastRunWords, linesWords, memoryTitle, memoryWords, ticking } from "./words.ts";

/** LICENSE-POLICY.md's sentence; the status bar shows it short. */
export const AFFILIATION = "Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp.";

/** The desktop's bar (`full`) or the phone's strip (`short`). */
export type StatusForm = "full" | "short";

export type StatusPart =
  /** The state's words: the bold word, then the rest (the rest of a short form also holds Break's timer). `busy` is
   *  for the bar's pulse. */
  | { t: "state"; state: EngineState["s"]; busy: boolean; bold: string | null; rest: string | null }
  /** Break's timer, beside the state's words (the full form; the short form has it in the state's rest). */
  | { t: "timer"; text: string }
  /** The last run. Full: `lead` "Last run: whole file (started with no locals) · ", the rc in the error color, `tail`
   *  " at line 17 · 0.38 s". Short: `lead` is "" or "Last run: ", `tail` "line 17 · 0.38 s" or "0.38 s". */
  | { t: "lastRun"; lead: string; rc: string | null; tail: string }
  /** The graphics part is downloading after the start (`percent`: 0 to 100). */
  | { t: "graphs"; percent: number; label: string; title: string }
  | { t: "memory"; text: string; title: string }
  | { t: "spacer" }
  /** The last run's Go to line (the short form only: the log has its own). */
  | { t: "jump"; line: number; path: string | undefined }
  /** The affiliation line: `short` is drawn, `full` is for screen readers and the title (the full form only). */
  | { t: "affiliation"; short: string; full: string }
  /** What the page tells of the files, or of the start (the full form only). */
  | { t: "note"; text: string };

export interface StatusInput {
  st: EngineState;
  lastRun: LastRun | null;
  memory: Memory | null;
  graphics: GraphicsProgress | null;
  /** Whether the browser keeps the files (null: not known yet). */
  persisted: boolean | null;
  /** The start is the snapshot start (its stages are fewer). */
  snapshot: boolean;
  /** Seconds since a state's `t0`. */
  since: (t0: number) => number;
  /** The whole seconds left before a Break resets the engine. */
  resetsIn: (st: EngineState & { s: "breaking" }) => number;
}

/** " line 6" or " lines 6–7" for a run that has lines, else nothing. */
const linesNote = (l?: [number, number]) => (l ? ` ${linesWords(l)}` : "");

/** The state's words: the bold word, then the rest, with its timer. One case for each state: a new state fails the type
 *  check until it has its words. The page load (`checking-lock`, `checking-cache`) is "Loading", for the moment before
 *  the page knows whether the engine is there. */
function stateWords(i: StatusInput, form: StatusForm): [string | null, string | null] {
  const st = i.st;
  switch (st.s) {
    case "checking-lock":
    case "checking-cache":
      return ["Loading", null];
    case "none":
    case "asking":
      return [null, "No engine yet"];
    case "declined":
      return ["No engine", " · Start engine downloads it"];
    case "downloading":
      return ["Starting", " · downloading"];
    case "starting-list":
    case "starting-worker": {
      const all = stagesOf(i.snapshot);
      return [
        "Starting",
        ` · ${stageStatus[st.stage]} (step ${all.indexOf(st.stage) + 1} of ${all.length}) · ${ticking(i.since(st.t0))}`,
      ];
    }
    case "ready":
      return ["Ready", null];
    case "running":
      return [
        "Running",
        form === "full" ? `${linesNote(st.run.lines)} · ${ticking(i.since(st.t0))}` : linesNote(st.run.lines),
      ];
    case "breaking":
      return ["Stopping", ` · resets in ${i.resetsIn(st)} s`];
    case "waiting":
      return ["Waiting", " · Break after this command"];
    case "failed":
      return ["Not started", " · the engine didn't start"];
    case "failed-twice":
      return ["Stopped", " · failed twice"];
    case "other-tab-idle":
    case "other-tab-taking":
      return ["Paused", " · another tab has the engine"];
  }
}

/** The last run's words in the full form: "Last run: whole file (started with no locals) · r(111) at line 17 · 0.38 s". */
function lastRunFull(r: LastRun): StatusPart {
  const w = lastRunWords(r);
  const lead = `Last run: ${w.what} · `;
  if (!w.rc) return { t: "lastRun", lead, rc: null, tail: w.time };
  return { t: "lastRun", lead, rc: w.rc, tail: `${w.where ? ` ${w.where} · ` : " · "}${w.time}` };
}

/** The same in the short form, from the same words: "r(111)" and "line 17 · 0.38 s", "before line 17 · 18.4 s" for a Break,
 *  "Last run: 0.38 s". */
function lastRunShort(r: LastRun): StatusPart {
  const w = lastRunWords(r);
  if (w.line !== null) {
    return { t: "lastRun", lead: "", rc: w.rc, tail: `${r.rc === 1 ? "before line" : "line"} ${w.line} · ${w.time}` };
  }
  return { t: "lastRun", lead: w.rc === null ? "Last run: " : "", rc: w.rc, tail: w.time };
}

/** "Graphs loading" and a ring of its percent while the graphics part downloads after the start. Nothing before the
 *  engine started, once it landed, or after a failed fetch (a graph's own error says why). */
function graphsPart(i: StatusInput): StatusPart | null {
  const g = i.graphics;
  if (g?.state !== "fetching" || !engineUp(i.st)) return null;
  const mb = (n: number) => megabytes(n, 1);
  const of = `${mb(g.received)} of ${mb(g.total)} MB`;
  return {
    t: "graphs",
    percent: g.total ? Math.min(100, (100 * g.received) / g.total) : 0,
    label: `Graphs loading, ${of}`,
    title: of,
  };
}

/** The parts of the status bar (`full`) or the phone's strip (`short`), in the order they are drawn. */
export function statusParts(i: StatusInput, form: StatusForm): StatusPart[] {
  const { st, memory: mem } = i;
  const full = form === "full";
  const [bold, rest] = stateWords(i, form);
  const timer = breakAsked(st) ? ticking(i.since(st.t0)) : null;
  const run = st.s === "ready" ? i.lastRun : null;
  const graphs = graphsPart(i);
  const memory: StatusPart | null = mem ? { t: "memory", text: memoryWords(mem, !full), title: memoryTitle } : null;
  const parts: (StatusPart | null)[] = [];

  if (full) {
    parts.push({ t: "state", state: st.s, busy: st.s !== "ready", bold, rest });
    if (timer) parts.push({ t: "timer", text: timer });
    if (run) parts.push(lastRunFull(run));
    parts.push(
      graphs,
      memory,
      { t: "spacer" },
      { t: "affiliation", short: "Not affiliated with StataCorp", full: AFFILIATION },
    );
    if (engineLoading(st)) parts.push({ t: "note", text: "You can edit and upload while it starts" });
    else if (i.persisted !== null) {
      parts.push({
        t: "note",
        text: i.persisted ? "Files are kept in this browser" : "Files may be cleared by this browser",
      });
    }
    return parts.filter((p) => p !== null);
  }

  if (run) {
    const jump = jumpLine(run);
    parts.push(
      lastRunShort(run),
      memory,
      { t: "spacer" },
      jump === null ? null : { t: "jump", line: jump, path: run.path },
    );
  } else {
    parts.push(
      { t: "state", state: st.s, busy: st.s !== "ready", bold, rest: timer ? `${rest ?? ""} · ${timer}` : rest },
      memory,
    );
  }
  parts.push(graphs);
  return parts.filter((p) => p !== null);
}
