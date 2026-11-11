// The run controller: what a run leaves in the state: the log, lastRun, results, graphs, history, and after the run the
// data, rows, macros, memory and the file list (docs/design/SPEC.md, sections 3.5 and 4). It is the one writer of those
// signals (state.ts, runWriter). Views start runs with runCode() and runCommand(), ask for more rows with moreRows(), and
// add a .png opened from the files with addFileGraph(); they never write these signals themselves.
//
// It does not read the engine's state. A run goes to the engine controller (engine.run()), which answers at once whether
// it started, was queued for an engine that is not there yet, or was refused; the state machine decides. What happens to
// a run and to the engine reaches this file through `handlers`, which main.tsx gives to the engine controller
// (connectRun): began (a run started: this one, or a queued one when its engine is up), log (a chunk of its log), ended
// (its result, also when the machine cut it), engineReady, and engineGone (a reset, or another tab took the engine:
// nothing of the old engine is in memory).
//
// The log streams: the worker sends chunks while the run prints, and they grow one text item. When the result comes, its
// `log` replaces that item's text, never adds to it: the stream can stop short of the log with no marker (the log cap,
// the sandbox notes added after the run). A result the machine made itself (rc 9998: a reset, or a run whose op failed in
// the worker) has no log of its own, so what streamed in stays, with the reason as a note.

import type { BrowseRows, RunResult } from "../engine/types.ts";
import * as engine from "./engine.ts";
import { afterRun } from "./files.ts";
import * as S from "./state.ts";
import { runWriter as W } from "./state.ts";
import type { Graph, LastRun, LogItem, RunHead } from "./types.ts";

export const MAX_GRAPHS = 20; // the graphs a session keeps (OQ-21); the oldest go first

/** The run in progress: its number, how it was started, what streamed in, and its promise. */
type Current = {
  id: number;
  head: RunHead;
  theme: "light" | "dark";
  t0: number;
  streamed: string;
  promise: Promise<RunResult>;
  done: (result: RunResult) => void;
};

let runs = 0; // runs so far in this page: each run's items carry its number
let sessionRuns = 0; // runs since the engine started: the first one's run-head says "(first run: none yet)"
let graphCount = 0; // graphs drawn since the log was cleared: their numbers
let current: Current | null = null;

/** What the engine controller calls (main.tsx: connectRun(handlers)). */
export const handlers: engine.RunHandlers = { began, log: streamed, ended, engineReady, engineGone };

/** Ask the engine controller for a run. `done`: the run's promise when it started now, else null at once. */
function request(
  code: string,
  head: RunHead,
): { how: "started" | "queued" | "refused"; done: Promise<RunResult | null> } {
  const how = engine.run(code, head);
  return { how, done: how === "started" && current ? current.promise : Promise.resolve(null) };
}

/** Run `code` as `head` says (section 4). With no engine yet (`none`, `declined`) the download prompt opens titled for a
 *  run, and the code runs when the engine has started. In any other state but `ready` (the page load, a start or a run
 *  in progress, no engine that can start) it does nothing. Resolves with the result, or null when nothing ran now. */
export function runCode(code: string, head: RunHead): Promise<RunResult | null> {
  return request(code, head).done;
}

/** One command, as the command line, Load and Import send it (section 4): run with kind "command" and the locals kept.
 *  `accepted` (known at once) is true when the command runs now (`ready`) or is queued for the engine (`none`,
 *  `declined`: the prompt opens, and it runs when the engine has started); only then is it added to `history` (not twice
 *  in a row), also when the run ends in an error, and the command line clears its field. In any other state (the page
 *  load, a start or a run in progress, no engine that can start) it is refused: not in `history`, and the text stays in
 *  the field. An empty command is refused. `done`: runCode's promise (the result, or null when nothing ran now). */
export function runCommand(text: string): { accepted: boolean; done: Promise<RunResult | null> } {
  const command = text.trim();
  if (!command) return { accepted: false, done: Promise.resolve(null) };
  const { how, done } = request(command, { kind: "command", fresh_locals: false });
  if (how === "refused") return { accepted: false, done };
  if (W.history.value.at(-1) !== command) W.history.value = [...W.history.value, command];
  return { accepted: true, done };
}

/** A run started (the effect `send-run`): its items go into the log. `theme`: what the run is sent as plot_theme. */
function began(head: RunHead, theme: "light" | "dark") {
  const id = ++runs;
  if (head.kind !== "command" && S.layout.value === "phone") S.phoneTab.value = "log"; // Run opens the Log tab
  const add: LogItem[] = head.kind === "command" ? [] : [{ t: "runhead", run: head, first: sessionRuns === 0 }];
  sessionRuns++; // now, not after the run: a reset that cuts it starts the count again, and the next run is first
  const unsaved = S.tabs.value.filter((t) => t.dirty).map((t) => t.path); // for S 15's note under a nested do
  W.log.value = [...W.log.value, ...add, { t: "text", text: "", run: id, streaming: true, unsaved }];
  S.say("Run started");
  let done!: (result: RunResult) => void;
  const promise = new Promise<RunResult>((ok) => {
    done = ok;
  });
  current = { id, head, theme, t0: performance.now(), streamed: "", promise, done };
}

/** A chunk of the running run's log. */
function streamed(chunk: string) {
  if (!current) return;
  current.streamed += chunk;
  setText(current.id, current.streamed);
}

/** The run ended (the effect `end-run`): with the engine's result, or with the machine's own (rc 9998) when it was cut.
 *  When a reset or another tab cut it, the effect `engine-gone` came first, in the same step. */
function ended(r: RunResult) {
  const run = current;
  if (!run) return;
  current = null;
  const { id, head } = run,
    seconds = (performance.now() - run.t0) / 1000;
  const own = engine.fromClient(r); // no log of its own
  const reset = own && r.kind !== "run-failed"; // the engine is gone (or another tab has it); run-failed keeps it

  const offset = head.kind === "selection" && head.lines ? head.lines[0] - 1 : 0;
  const line = r.error_line == null ? null : r.error_line + offset;
  const end: LastRun = { ...head, rc: r.rc, line, seconds };
  if (r.skipped?.length) end.skipped = r.skipped;
  if (r.store_error) end.store_error = r.store_error;
  setText(id, own ? run.streamed : r.log, end);
  if (own && r.error) W.log.value = [...W.log.value, { t: "note", text: r.error }];
  addGraphs(r, id, run.theme);
  // a run cut because another tab took the lock (kind "stopped") is not this tab's last run: engine-gone cleared lastRun,
  // and a quick take-over may already have started a new engine
  if (!(own && r.kind === "stopped")) W.lastRun.value = end;
  if (r.results) W.results.value = r.results;
  S.say(
    r.rc === 0
      ? "Run finished"
      : r.rc === 1
        ? "Run stopped by Break"
        : reset
          ? r.kind === "stopped"
            ? "Run ended: another tab took over"
            : "Run ended: the engine was reset"
          : own
            ? "Run failed: the engine could not finish it"
            : `Run finished: error r(${r.rc})${line ? ` at line ${line}` : ""}`,
  );
  Promise.all([afterRun(r.files), reset ? null : refreshData()]).then(() => run.done(r));
}

/** An engine is ready (the effect `engine-ready`): its memory. */
function engineReady() {
  engine.call("memory").then(
    (m) => {
      W.memory.value = m;
    },
    () => {},
  );
}

/** The engine is gone (the effect `engine-gone`): a reset, or another tab has it. Nothing of it is in memory. */
function engineGone() {
  sessionRuns = 0;
  W.results.value = W.macros.value = null;
  W.data.value = W.rows.value = null;
  W.memory.value = null;
  W.lastRun.value = null;
}

/** The text item of run `id`: still streaming, or (with `end`) the run has ended. */
function setText(id: number, text: string, end: LastRun | undefined = undefined) {
  W.log.value = W.log.value.map((i) =>
    i.t === "text" && i.run === id ? { ...i, text, streaming: !end, ...(end ? { end } : {}) } : i,
  );
}

function addGraphs(r: RunResult, id: number, theme: "light" | "dark") {
  if (!r.images.length) return;
  const added: Graph[] = r.images.map((png, i) => ({
    n: ++graphCount,
    png,
    theme,
    from: "run",
    run: id,
    command: r.graph_commands[i],
    line: r.graph_lines[i] ?? null,
  }));
  W.log.value = [...W.log.value, ...added.map((g) => ({ t: "graph", n: g.n }) as LogItem)];
  keepGraphs(added);
}

/** A .png opened from the files (4a's openFile): it joins the session's graphs and is the one shown. Its colors are its
 *  own; `theme` is the page's at the time. The same file opened again replaces its entry (the new image, the same `n`,
 *  the same place) and selects it; one that has dropped out of the last 20 is added again. `png`: base64. */
export function addFileGraph(path: string, png: string): Graph {
  const i = W.graphs.value.findIndex((g) => g.from === "file" && g.path === path);
  if (i >= 0) {
    const g: Graph = { ...W.graphs.value[i], png, theme: S.resolvedTheme.value };
    W.graphs.value = W.graphs.value.map((x, j) => (j === i ? g : x));
    S.graphIndex.value = i;
    return g;
  }
  const g: Graph = { n: ++graphCount, png, theme: S.resolvedTheme.value, from: "file", path };
  keepGraphs([g]);
  return g;
}

function keepGraphs(added: Graph[]) {
  W.graphs.value = [...W.graphs.value, ...added].slice(-MAX_GRAPHS);
  S.graphIndex.value = W.graphs.value.length - 1; // the latest graph is the one shown
}

/** The data, its first rows, the macros and the memory, after a run (and whenever a view needs them fresh). With no
 *  engine, or when the engine is reset meanwhile, nothing is written: the calls reject, and engine-gone clears these. */
export async function refreshData() {
  try {
    const [data, rows, macros, memory] = await Promise.all([
      engine.call("describe"),
      engine.call("browse", { limit: 50 }),
      engine.call("macros"),
      engine.call("memory"),
    ]);
    W.data.value = data;
    W.rows.value = rows;
    W.macros.value = macros;
    W.memory.value = memory;
  } catch {
    // no engine, or it was reset meanwhile
  }
}

/** "Show 50 more": the next rows of the data, appended to `rows`. Nothing is appended if a run or a new engine replaced
 *  `rows` meanwhile. Resolves true when rows were added. */
export async function moreRows(count = 50): Promise<boolean> {
  const from = W.rows.value;
  if (!from || "error" in from || from.more <= 0) return false;
  let next: BrowseRows;
  try {
    next = await engine.call("browse", { offset: from.offset + from.rows.length, limit: count });
  } catch {
    return false; // no engine, or it was reset meanwhile
  }
  if (W.rows.value !== from || "error" in next || !next.rows.length) return false;
  // rows of other data (a run ended, and its refreshData() has not answered yet) do not continue these
  if (next.offset !== from.offset + from.rows.length || next.vars.join(" ") !== from.vars.join(" ")) return false;
  W.rows.value = { ...from, rows: [...from.rows, ...next.rows], more: next.more };
  return true;
}

/** "Clear log": the log and the graphs, not the data. A run in progress keeps its text item, so its log still arrives. */
export function clearLog() {
  W.log.value = W.log.value.filter((i) => i.t === "text" && i.streaming);
  W.graphs.value = [];
  S.graphIndex.value = 0;
  graphCount = 0;
}
