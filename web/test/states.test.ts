// Step 4d's plain logic (src/app/states/words.ts): what Reset asks (and when: never at once during a run), the words of
// the reset banner and the running banner, the stopping countdown at 0, the memory banner with no size, the action each
// failed reason gets, the times, and the three drafted notes (OQ-10).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  failedActions,
  memoryHead,
  noteFor,
  nothingToLose,
  ofTotal,
  resetAsks,
  resetIn,
  resetWords,
  runningWhat,
  secs,
  twiceWords,
} from "../src/app/states/words.ts";
import type { FailReason } from "../src/app/types.ts";

const empty = { scalars: {}, macros: {}, matrices: {} };
const results = (r = empty, e = empty) => ({ e, r, e_changed: false, r_changed: false });
const summary = (nobs: number, nvars: number) => ({
  nobs,
  nvars,
  matched: nvars,
  offset: 0,
  variables: [],
  more: 0,
  filename: null,
});

test("Reset is not asked with no data in memory and no results", () => {
  assert.equal(nothingToLose(null, null), true);
  assert.equal(nothingToLose(summary(0, 0), results()), true);
  assert.equal(nothingToLose({ error: "no data" }, results()), true);
  assert.equal(nothingToLose(summary(74, 12), null), false);
  assert.equal(nothingToLose(summary(0, 3), null), false, "variables with no observations are data");
  assert.equal(nothingToLose(null, results({ ...empty, scalars: { N: 74 } })), false);
  assert.equal(nothingToLose(null, results(empty, { ...empty, matrices: { b: "1x3" } })), false);
});

test("Reset resets at once only when the engine is ready with nothing to lose; a run in progress always asks", () => {
  const run = { kind: "file" as const, path: "a.do", fresh_locals: true, rc: 0, line: null, seconds: 1 };
  assert.equal(resetAsks("ready", null, null, null), false, "a new engine, no run yet");
  assert.equal(resetAsks("ready", summary(0, 0), results(), run), false, "a run left nothing");
  assert.equal(resetAsks("ready", summary(74, 12), results(), run), true);
  // a run in progress: its data and results are known only when it ends (the first run of a visit has neither yet)
  for (const s of ["running", "breaking", "waiting"] as const) assert.equal(resetAsks(s, null, null, null), true, s);
  assert.equal(resetAsks("running", summary(0, 0), results(), run), true);
  // a run has ended and its data is not described yet (run.ts sets `results` at the end, `data` when refreshData answers)
  assert.equal(resetAsks("ready", null, results(), run), true);
});

test("the stopping banner's countdown never says In 0 s; the memory banner never shows an empty size", () => {
  assert.equal(resetIn(4), "In 4 s the engine is reset:");
  assert.equal(resetIn(1), "In 1 s the engine is reset:");
  assert.equal(resetIn(0), "The engine is being reset now:");
  assert.equal(memoryHead(1.6e9), "Memory 1.6 GB of about 2 GB.");
  for (const none of [null, undefined, 0]) assert.equal(memoryHead(none), "Memory is near its limit of about 2 GB.");
});

test("the times and sizes are written as the drawings write them", () => {
  assert.equal(secs(0.94), "0.9 s");
  assert.equal(secs(7.14), "7.1 s");
  assert.equal(secs(14.4), "14 s");
  assert.equal(ofTotal(14.2e6, 48.4e6), "14.2 of 48 MB");
});

test("the reset banner's words follow the kind, and cut a cause in parentheses off", () => {
  assert.deepEqual(resetWords("user", "reset by you", true), {
    head: "You reset the engine.",
    rest: "The data in memory is gone; your files are kept.",
  });
  assert.equal(
    resetWords("break", "the code did not stop at Break", true).head,
    "The engine was reset: the code did not stop at Break.",
  );
  assert.equal(
    resetWords("crash", "the engine crashed (out of memory: x)", true).head,
    "The engine was reset: the engine crashed.",
  );
  assert.equal(resetWords("break", "Break reset the engine, because ...", false).head, "Break reset the engine.");
});

test("the running banner names the run", () => {
  assert.equal(runningWhat({ kind: "selection", lines: [14, 15], fresh_locals: false }), "lines 14–15");
  assert.equal(runningWhat({ kind: "selection", lines: [9, 9], fresh_locals: false }), "line 9");
  assert.equal(runningWhat({ kind: "file", path: "code/analysis.do", fresh_locals: true }), "analysis.do");
  assert.equal(runningWhat({ kind: "command", fresh_locals: false }), "a command");
});

test("each failed reason has its own first action, and Download all is always offered", () => {
  const reasons: FailReason[] = ["no-wasm", "download", "memory", "updated", "unknown"];
  const first = Object.fromEntries(reasons.map((r) => [r, failedActions(r)[0]]));
  assert.deepEqual(first, {
    "no-wasm": "browsers",
    download: "try-again",
    memory: "try-again",
    updated: "reload",
    unknown: "try-again",
  });
  for (const r of reasons) assert.ok(failedActions(r).includes("download-all"), r);
  assert.ok(!failedActions("no-wasm").includes("try-again"), "Try again cannot help without WebAssembly");
  assert.match(twiceWords("memory").head, /ran out of memory/);
  assert.doesNotMatch(twiceWords("unknown").head, /memory/);
});

test("the three notes (drafts) are chosen by the run's rc and error", () => {
  assert.match(noteFor(622, "nothing to restore") ?? "", /preserve and restore in the same run/);
  assert.match(noteFor(601, "file /tmp/opendta-123/S__000001.dta not found") ?? "", /lasts one run/);
  assert.match(noteFor(199, "command reghdfe is unrecognized") ?? "", /^reghdfe is a community command/);
  assert.equal(noteFor(199, "command frobnicate is unrecognized"), null);
  assert.equal(noteFor(601, "file wages.dta not found"), null);
  assert.equal(noteFor(0, null), null);
});
