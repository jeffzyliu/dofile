// The run controller: one run at a time, through the engine controller, and what a run leaves in the state: the log,
// lastRun, results, graphs, history, and after the run the data, rows, macros, memory and the file list
// (docs/design/SPEC.md, sections 3.5 and 4). It is the one writer of those signals (the Data tab's "Show 50 more" also
// appends to `rows`): it clears what an engine left when a new one starts (`starting`, a reset too) and when another tab
// takes over (`other-tab`), and asks for `memory` when an engine is ready. Views start runs with runCode() and
// runCommand(), and add a .png opened from the files with addFileGraph(); they never write these signals themselves.
//
// The log streams: the worker sends chunks while the run prints (run(code, {onLog})), and they grow one text item. When
// the result comes, its `log` replaces that item's text, never adds to it: the stream can stop short of the log with no
// marker (the log cap, the sandbox notes added after the run). A result the client made itself (rc 9998: a reset, or a
// run whose op failed in the worker) has no log of its own, so what streamed in stays, with the reason as a note.
import * as S from "./state.ts";
import * as engine from "./engine.ts";
import { afterRun } from "./files.ts";
import type { RunResult } from "../engine/types.ts";
import type { Graph, LastRun, LogItem, RunHead } from "./types.ts";

export const MAX_GRAPHS = 20;   // the graphs a session keeps (OQ-21); the oldest go first

let runs = 0;          // runs so far in this page: each run's items carry its number
let sessionRuns = 0;   // runs since the engine started: the first one's run-head says "(first run: none yet)"
let graphCount = 0;    // graphs drawn since the log was cleared: their numbers
let queued: { code: string, head: RunHead } | null = null;     // Run with no engine: it runs once the engine is ready, unless the download is declined
let was = S.engine.value.s;

S.engine.subscribe(st => {
  const before = was;
  was = st.s;
  // a new engine (a reset too), or another tab has the engine: nothing of the old one is in memory
  if ((st.s === "starting" || st.s === "other-tab") && before !== st.s) {
    sessionRuns = 0;
    S.results.value = S.macros.value = null;
    S.data.value = S.rows.value = null;
    S.memory.value = null;
    S.lastRun.value = null;
  }
  if (st.s === "ready" && before === "starting") {
    engine.call("memory").then(m => { S.memory.value = m; }, () => {});
  }
  if (st.s === "ready" && queued) {
    const q = queued;
    queued = null;
    queueMicrotask(() => { runCode(q.code, q.head); });
  } else if (st.s === "declined" || st.s === "failed" || st.s === "failed-twice" || st.s === "other-tab") {
    queued = null;
  }
});

/** Run `code` as `head` says (section 4). With no engine yet (`none`, `declined`) it opens the download prompt titled for
 *  a run, and runs when the engine is ready. In any other state but `ready` (a start or a run in progress) it does nothing.
 *  Resolves with the result, or null when nothing ran now. */
export async function runCode(code: string, head: RunHead): Promise<RunResult | null> {
  const st = S.engine.value.s;
  if (st === "none" || st === "declined") {
    queued = { code, head };
    engine.ask(true);
    return null;
  }
  if (st !== "ready") return null;
  const id = ++runs;
  if (head.kind !== "command" && S.layout.value === "phone") S.phoneTab.value = "log";   // Run opens the Log tab
  const add: LogItem[] = head.kind === "command" ? [] : [{ t: "runhead", run: head, first: sessionRuns === 0 }];
  sessionRuns++;   // now, not after the run: a reset that cuts it starts the count again, and the next run is first
  const unsaved = S.tabs.value.filter(t => t.dirty).map(t => t.path);   // for S 15's note under a nested do
  S.log.value = [...S.log.value, ...add, { t: "text", text: "", run: id, streaming: true, unsaved }];
  S.say("Run started");
  const theme = S.resolvedTheme.value;   // what engine.run() sends as plot_theme, now
  const t0 = performance.now();
  let streamed = "";
  const r = await engine.run(code, head, { onLog: chunk => { streamed += chunk; setText(id, streamed); } });
  const seconds = (performance.now() - t0) / 1000;
  const own = engine.fromClient(r);                 // no log of its own
  const reset = own && r.kind !== "run-failed";     // the engine is gone (or another tab has it); run-failed keeps it

  const offset = head.kind === "selection" && head.lines ? head.lines[0] - 1 : 0;
  const line = r.error_line == null ? null : r.error_line + offset;
  const end: LastRun = { ...head, rc: r.rc, line, seconds };
  if (r.skipped?.length) end.skipped = r.skipped;
  if (r.store_error) end.store_error = r.store_error;
  setText(id, own ? streamed : r.log, end);
  if (own && r.error) S.log.value = [...S.log.value, { t: "note", text: r.error }];
  addGraphs(r, id, theme);
  // a run cut because another tab took the lock (kind "stopped") is not this tab's last run: `other-tab` cleared lastRun,
  // and a quick take-over may already have started a new engine
  if (!(own && r.kind === "stopped")) S.lastRun.value = end;
  if (r.results) S.results.value = r.results;
  S.say(r.rc === 0 ? "Run finished" : r.rc === 1 ? "Run stopped by Break"
    : reset ? (r.kind === "stopped" ? "Run ended: another tab took over" : "Run ended: the engine was reset")
    : own ? "Run failed: the engine could not finish it"
    : `Run finished: error r(${r.rc})${line ? ` at line ${line}` : ""}`);
  await Promise.all([afterRun(r.files), reset ? null : refreshData()]);
  return r;
}

/** One command, as the command line, Load and Import send it (section 4): run with kind "command" and the locals kept.
 *  `accepted` (known at once) is true when the command runs now (`ready`) or is queued for the engine (`none`,
 *  `declined`: the prompt opens, and it runs once the engine is ready); only then is it added to `history` (not twice in
 *  a row), also when the run ends in an error, and the command line clears its field. In any other state (a start or a
 *  run in progress, no engine that can start) it is refused: not in `history`, and the text stays in the field. An empty
 *  command is refused. `done`: runCode's promise (the result, or null when nothing ran now). */
export function runCommand(text: string): { accepted: boolean, done: Promise<RunResult | null> } {
  const command = text.trim(), st = S.engine.value.s;
  if (!command || !(st === "ready" || st === "none" || st === "declined")) return { accepted: false, done: Promise.resolve(null) };
  if (S.history.value.at(-1) !== command) S.history.value = [...S.history.value, command];
  return { accepted: true, done: runCode(command, { kind: "command", fresh_locals: false }) };
}

/** The text item of run `id`: still streaming, or (with `end`) the run has ended. */
function setText(id: number, text: string, end: LastRun | undefined = undefined) {
  S.log.value = S.log.value.map(i => (i.t === "text" && i.run === id ? { ...i, text, streaming: !end, ...(end ? { end } : {}) } : i));
}

function addGraphs(r: RunResult, id: number, theme: "light" | "dark") {
  if (!r.images.length) return;
  const added: Graph[] = r.images.map((png, i) => ({ n: ++graphCount, png, theme, from: "run", run: id,
    command: r.graph_commands[i], line: r.graph_lines[i] ?? null }));
  S.log.value = [...S.log.value, ...added.map(g => ({ t: "graph", n: g.n }) as LogItem)];
  keepGraphs(added);
}

/** A .png opened from the files (4a's openFile): it joins the session's graphs and is the one shown. Its colors are its
 *  own; `theme` is the page's at the time. The same file opened again replaces its entry (the new image, the same `n`,
 *  the same place) and selects it; one that has dropped out of the last 20 is added again. `png`: base64. */
export function addFileGraph(path: string, png: string): Graph {
  const i = S.graphs.value.findIndex(g => g.from === "file" && g.path === path);
  if (i >= 0) {
    const g: Graph = { ...S.graphs.value[i], png, theme: S.resolvedTheme.value };
    S.graphs.value = S.graphs.value.map((x, j) => (j === i ? g : x));
    S.graphIndex.value = i;
    return g;
  }
  const g: Graph = { n: ++graphCount, png, theme: S.resolvedTheme.value, from: "file", path };
  keepGraphs([g]);
  return g;
}

function keepGraphs(added: Graph[]) {
  S.graphs.value = [...S.graphs.value, ...added].slice(-MAX_GRAPHS);
  S.graphIndex.value = S.graphs.value.length - 1;   // the latest graph is the one shown
}

/** The data, its first rows, the macros and the memory, after a run (and whenever a view needs them fresh). */
export async function refreshData() {
  if (S.engine.value.s !== "ready") return;
  try {
    const [data, rows, macros, memory] = await Promise.all([
      engine.call("describe"), engine.call("browse", { limit: 50 }), engine.call("macros"), engine.call("memory")]);
    S.data.value = data;
    S.rows.value = rows;
    S.macros.value = macros;
    S.memory.value = memory;
  } catch {
    // the engine was reset meanwhile: the new engine's `starting` cleared these
  }
}

/** "Clear log": the log and the graphs, not the data. A run in progress keeps its text item, so its log still arrives. */
export function clearLog() {
  S.log.value = S.log.value.filter(i => i.t === "text" && i.streaming);
  S.graphs.value = [];
  S.graphIndex.value = 0;
  graphCount = 0;
}
