// Step 4d's plain logic (src/app/states/words.ts): when Reset asks (not while the engine is new, and always during a run or
// after one), which file the reset banner runs again, the words of
// the reset banner and the running banner, the stopping countdown at 0, the action each
// failed reason gets, the times, and the three drafted notes (OQ-10).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  failedActions,
  noteFor,
  ofTotal,
  rerunPath,
  resetAsks,
  resetIn,
  resetWords,
  runningWhat,
  secs,
  twiceWords,
} from "../src/app/states/words.ts";
import type { FailReason, RunHead } from "../src/app/types.ts";

test("Reset resets at once only when the engine is ready and nothing has run on it; anything else asks", () => {
  assert.equal(resetAsks("ready", 0), false, "a new engine, or one just reset");
  // anything a run can leave (data, e() and r(), globals, scalars, matrices, graphs) is held after a run, so it asks
  assert.equal(resetAsks("ready", 1), true);
  assert.equal(resetAsks("ready", 7), true);
  // a run in progress: what it holds is known only when it ends
  for (const s of ["running", "breaking", "waiting"] as const) {
    assert.equal(resetAsks(s, 0), true, s);
    assert.equal(resetAsks(s, 1), true, s);
  }
});

test('the reset banner offers "Run the file again" only for a reset that was not asked for and cut a run of a file', () => {
  const file: RunHead = { kind: "file", path: "data/a.do", fresh_locals: true };
  assert.equal(rerunPath("break", file), "data/a.do", "the file whose run was cut, not the active tab");
  assert.equal(rerunPath("crash", file), "data/a.do");
  assert.equal(rerunPath("user", file), null, "a Reset the visitor asked for");
  assert.equal(rerunPath("crash", null), null, "no run was in progress");
  assert.equal(rerunPath("break", { kind: "command", fresh_locals: false }), null);
  assert.equal(rerunPath("break", { kind: "selection", path: "a.do", lines: [2, 3], fresh_locals: false }), null);
});

test("the stopping banner's countdown never says In 0 s", () => {
  assert.equal(resetIn(4), "In 4 s the engine is reset:");
  assert.equal(resetIn(1), "In 1 s the engine is reset:");
  assert.equal(resetIn(0), "The engine is being reset now:");
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
    rest: "The data in memory is lost; your files are kept.",
  });
  assert.equal(
    resetWords("break", "the code did not stop at Break", true).head,
    "The engine was reset: the code did not stop at Break.",
  );
  assert.equal(
    resetWords("crash", "the engine crashed (out of memory: x)", true).head,
    "The engine crashed and was reset.",
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
  assert.match(twiceWords("memory").head, /out of memory/);
  assert.doesNotMatch(twiceWords("unknown").head, /memory/);
});

test("the two notes (drafts) are chosen by the run's rc and error", () => {
  assert.match(noteFor(622, "nothing to restore") ?? "", /preserve and restore in the same run/);
  assert.equal(noteFor(601, "file /tmp/opendta-123/S__000001.dta not found"), null); // the engine's own line says it
  assert.match(noteFor(199, "command reghdfe is unrecognized") ?? "", /^reghdfe is a community command/);
  assert.equal(noteFor(199, "command frobnicate is unrecognized"), null);
  assert.equal(noteFor(601, "file wages.dta not found"), null);
  assert.equal(noteFor(0, null), null);
});
