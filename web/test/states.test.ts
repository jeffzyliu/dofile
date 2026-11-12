// Step 4d's plain logic (src/app/states/words.ts): what Reset asks (and when: never at once during a run, and after a run
// only once the memory is described again), the words of
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
  type ResetSnapshot,
  resetAsks,
  resetDecision,
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
  assert.equal(resetAsks("ready", null, null), false, "a new engine, no run yet");
  assert.equal(resetAsks("ready", summary(0, 0), results()), false);
  assert.equal(resetAsks("ready", summary(74, 12), results()), true);
  // a run in progress: its data and results are known only when it ends (the first run of a visit has neither yet)
  for (const s of ["running", "breaking", "waiting"] as const) assert.equal(resetAsks(s, null, null), true, s);
  assert.equal(resetAsks("running", summary(0, 0), results()), true);
});

test("after a run, Reset describes the memory again before it resets with no question", async () => {
  const run = { kind: "file" as const, path: "a.do", fresh_locals: true, rc: 0, line: null, seconds: 1 };
  type Snap = ResetSnapshot;
  /** The signals as `read` sees them; `refresh` writes `fresh` into `data` (as refreshData does), or fails. */
  const memory = (now: Snap, fresh: Snap["data"] | "fails" | "never-called", after: Partial<Snap> = {}) => {
    let calls = 0;
    const refresh = async () => {
      calls++;
      if (fresh === "fails" || fresh === "never-called") throw new Error("no engine");
      now = { ...now, ...after, data: fresh };
    };
    return { read: () => now, refresh, calls: () => calls };
  };
  const decide = async (m: ReturnType<typeof memory>) => [await resetDecision(m.read, m.refresh), m.calls()];

  // run 1 left nothing (described 0 x 0); run 2 made 10 observations and no r() or e(), and its refreshData has not
  // answered: `data` is still run 1's description. Described again, there is data: the dialog.
  const stale = summary(0, 0);
  assert.deepEqual(
    await decide(memory({ state: "ready", data: stale, results: results(), lastRun: run }, summary(10, 1))),
    ["ask", 1],
  );
  // described again and still nothing: at once
  assert.deepEqual(
    await decide(memory({ state: "ready", data: stale, results: results(), lastRun: run }, summary(0, 0))),
    ["reset", 1],
  );
  // a run that a reset cut: no data and no description yet; the new engine's memory is empty: at once, no question
  assert.deepEqual(await decide(memory({ state: "ready", data: null, results: null, lastRun: run }, summary(0, 0))), [
    "reset",
    1,
  ]);
  // no description came (the call failed, `data` is the same): the dialog
  assert.deepEqual(await decide(memory({ state: "ready", data: stale, results: results(), lastRun: run }, "fails")), [
    "ask",
    1,
  ]);
  // a run started meanwhile: the dialog; the engine went to another tab meanwhile: nothing
  assert.deepEqual(
    await decide(
      memory({ state: "ready", data: stale, results: results(), lastRun: run }, summary(0, 0), { state: "running" }),
    ),
    ["ask", 1],
  );
  assert.deepEqual(
    await decide(
      memory({ state: "ready", data: stale, results: results(), lastRun: run }, summary(0, 0), {
        state: "other-tab-idle",
      }),
    ),
    ["none", 1],
  );
  // no run yet (a new engine, or one just reset): at once, nothing described; with something to lose, or during a run:
  // the dialog at once, nothing described
  assert.deepEqual(await decide(memory({ state: "ready", data: null, results: null, lastRun: null }, "never-called")), [
    "reset",
    0,
  ]);
  assert.deepEqual(
    await decide(memory({ state: "ready", data: summary(74, 12), results: results(), lastRun: run }, "never-called")),
    ["ask", 0],
  );
  assert.deepEqual(
    await decide(memory({ state: "running", data: null, results: null, lastRun: null }, "never-called")),
    ["ask", 0],
  );
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
