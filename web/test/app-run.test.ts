// The run controller (src/app/run.ts): the log, graphs, history, rows, toasts and banners.

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RunHead } from "../src/app/types.ts";
import type { Results } from "../src/engine/types.ts";
import { sleep } from "./harness.ts";
import type { Later } from "./wiring.ts";
import {
  addFileGraph,
  banners,
  begin,
  canClearLog,
  clearLog,
  client,
  D,
  engine,
  expectDrops,
  FILE,
  failure,
  heard,
  later,
  load,
  logItems,
  MAX_GRAPHS,
  moreRows,
  readyEngine,
  result,
  runCode,
  runCommand,
  S,
  setUp,
  startEngine,
  state,
  store,
  tick,
  useWiring,
  writable,
} from "./wiring.ts";

useWiring();

test("Clear log keeps the head (the banner and versions a fresh page shows) and drops the rest", () => {
  writable(S.log).value = [
    { t: "head" },
    { t: "runhead", run: { kind: "file", path: "a.do", fresh_locals: true }, first: false },
    { t: "text", run: 1, text: ". display 1\n1\n" },
    { t: "note", text: "n" },
  ];
  clearLog();
  assert.deepEqual(logItems(), [{ t: "head" }]);
});

test("canClearLog: false for the head alone and for a streaming run's text; true for any run text, note, run-head or graph", () => {
  const graph = { n: 1, png: "P", theme: "light", from: "run" } as const;
  writable(S.log).value = [{ t: "head" }];
  assert.equal(canClearLog(), false, "a fresh page");
  writable(S.log).value = [{ t: "head" }, { t: "text", run: 1, text: "1\n", streaming: true }];
  assert.equal(canClearLog(), false, "only the streaming run's text, which clearLog keeps");
  writable(S.log).value = [{ t: "head" }, { t: "text", run: 1, text: "1\n" }];
  assert.equal(canClearLog(), true, "run text");
  writable(S.log).value = [{ t: "head" }, { t: "note", text: "n" }];
  assert.equal(canClearLog(), true, "a note");
  writable(S.log).value = [
    { t: "head" },
    { t: "runhead", run: { kind: "file", path: "a.do", fresh_locals: true }, first: false },
  ];
  assert.equal(canClearLog(), true, "a run-head");
  writable(S.log).value = [{ t: "head" }];
  writable(S.graphs).value = [graph];
  assert.equal(canClearLog(), true, "a graph alone");
  clearLog();
  assert.equal(canClearLog(), false, "after Clear log there is nothing more to clear");
});

test("Clear log during a run keeps the run's text item, so its log still arrives; the graph numbers start again", async () => {
  writable(S.log).value = []; // this test counts the log's items: it starts with none, not with the head
  await readyEngine();
  const done = runCode("x", FILE);
  client.run1.onLog("1\n");
  clearLog();
  assert.deepEqual(
    logItems().map((i) => i.t),
    ["text"],
  );
  client.run1.done.ok(result({ log: "1\n2\n", images: ["PNG"], graph_commands: ["scatter y x"], graph_lines: [1] }));
  await done;
  assert.equal(logItems()[0].text, "1\n2\n");
  assert.equal(S.graphs.value[0].n, 1);
});

test("a run whose op failed in the worker (run-failed) is not a reset: rc 9998 with the worker's message, the data is asked again, and no reset is said", async () => {
  await readyEngine();
  await heard();
  writable(S.results).value = { e: {}, r: {}, e_changed: true, r_changed: false } as unknown as Results;
  const before = client.calls.length;
  const done = runCode("x", FILE);
  client.run1.onLog("partial\n");
  client.run1.done.no(failure("no memory for the result", { kind: "op", name: "PythonError" }));
  const r = (await done)!;
  assert.deepEqual([r.rc, r.kind, r.error], [9998, "run-failed", "no memory for the result"]);
  state("ready");
  assert.equal(client.worker.ended, null, "the worker stays");
  assert.equal(logItems().find((i) => i.t === "text")!.text, "partial\n");
  assert.equal(logItems().at(-1)!.text, "no memory for the result");
  assert.notEqual(S.results.value, null, "the results are not cleared");
  assert.deepEqual(
    client.calls.slice(before).map((c) => c[0]),
    ["describe", "browse", "macros", "memory"],
  );
  assert.doesNotMatch(await heard(), /reset/);
});

test("a run's graphs keep the theme the run was sent, not the one at its end", async () => {
  await readyEngine();
  S.theme.value = "light";
  const done = runCode("x", FILE);
  assert.equal(client.run1.args.plot_theme, "light");
  S.theme.value = "dark";
  client.run1.done.ok(result({ images: ["PNG"], graph_commands: ["scatter y x"], graph_lines: [1] }));
  await done;
  assert.equal(S.graphs.value.at(-1)!.theme, "light");
});

test("each run's text item keeps how it ended (rc, line, skipped, store_error) and the files unsaved when it started", async () => {
  await readyEngine();
  D.addText("a.do", "");
  D.addText("clean.do", "");
  D.update("clean.do", { changes: { from: 0, insert: "edited" } });
  const head: RunHead = { kind: "selection", path: "a.do", lines: [5, 9], fresh_locals: false };
  const done = runCode("x", head);
  assert.deepEqual(logItems().find((i) => i.t === "text")!.unsaved, ["clean.do"]);
  client.run1.done.ok(result({ rc: 1, error_line: 2, skipped: ["gone/out.csv"], store_error: "quota" }));
  await done;
  const end = logItems().find((i) => i.t === "text")!.end;
  assert.deepEqual(
    { ...end, seconds: 0 },
    { ...head, rc: 1, line: 6, seconds: 0, skipped: ["gone/out.csv"], store_error: "quota" },
  );
  assert.equal(S.lastRun.value, end, "lastRun is the same record");
  runCode("y", FILE);
  assert.equal(logItems().filter((i) => i.t === "text")[0].end!.rc, 1, "an older run keeps its own");
  client.run1.done.ok(result());
});

test("runCommand: added to history (not twice in a row), run as a command with the locals kept, no run-head", async () => {
  await readyEngine();
  const heads = logItems().filter((i) => i.t === "runhead").length;
  assert.equal(runCommand("  summarize  ").how, "started");
  assert.deepEqual(S.history.value, ["summarize"]);
  assert.deepEqual([client.run1.args.code, client.run1.args.fresh_locals], ["summarize", false]);
  assert.equal(logItems().filter((i) => i.t === "runhead").length, heads);
  client.run1.done.ok(result());
  await sleep(5);
  const again = runCommand("summarize");
  assert.deepEqual(S.history.value, ["summarize"]);
  client.run1.done.ok(result());
  assert.equal((await again.done)!.rc, 0, "done resolves with the result");
  const empty = runCommand("   ");
  assert.equal(empty.how, "refused");
  assert.equal(await empty.done, null);
});

test("runCommand: a command that does not run is not in history (so the field keeps it): refused, with no engine too, where it opens no prompt; one that runs is, an error too", async () => {
  // the page load: refused, in both of its states
  setUp();
  engine.open();
  assert.deepEqual([S.engine.value.s, runCommand("display 1").how], ["checking-lock", "refused"]);
  expectDrops([{ type: "run", row: "checking-lock", why: "not-valid" }]);

  await readyEngine();
  const first = runCommand("regress y x");
  assert.equal(first.how, "started");
  // a run is on: refused, nothing sent, history unchanged
  const busy = runCommand("describe");
  assert.equal(busy.how, "refused");
  assert.equal(await busy.done, null);
  assert.equal(client.worker.runs.length, 1);
  assert.deepEqual(S.history.value, ["regress y x"]);
  client.run1.done.ok(result({ rc: 111, log: "r(111);\n" }));
  await first.done;
  assert.deepEqual(S.history.value, ["regress y x"], "a command that ran and failed stays in history");

  // starting (a reset): refused
  engine.reset();
  state("starting-list");
  assert.equal(runCommand("summarize").how, "refused");
  await begin();
  assert.equal(runCommand("summarize").how, "refused");
  assert.deepEqual(S.history.value, ["regress y x"]);
  expectDrops([
    { type: "run", row: "running", why: "not-valid" },
    { type: "run", row: "starting-list", why: "not-valid" },
    { type: "run", row: "starting-worker", why: "not-valid" },
  ]);

  // no engine (declined): refused, no prompt, not in history, nothing sent; the same while the prompt asks; once the
  // engine is ready, nothing runs until the command is run again
  await load();
  engine.decline();
  writable(S.history).value = [];
  const refused = runCommand("use wages");
  assert.equal(refused.how, "refused");
  assert.equal(await refused.done, null);
  assert.equal(S.dialog.value, null, "a command with no engine opens no prompt");
  assert.deepEqual(S.history.value, [], "a command that did not run is not in history");
  startEngine();
  assert.deepEqual(S.dialog.value, { d: "download" });
  assert.equal(runCommand("summarize").how, "refused", "asking: refused");
  assert.deepEqual(S.history.value, []);
  expectDrops([
    { type: "run", row: "declined", why: "not-valid" },
    { type: "run", row: "asking", why: "not-valid" },
  ]);
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  await tick();
  state("ready");
  assert.equal(client.worker.runs.length, 0, "nothing ran once the engine was ready");
  const again = runCommand("use wages");
  assert.equal(again.how, "started");
  assert.deepEqual(S.history.value, ["use wages"]);
  client.run1.done.ok(result());
  assert.equal((await again.done)?.rc, 0);
});

test('moreRows(): "Show 50 more" appends the next rows to `rows`; nothing is appended when a run or a new engine replaced `rows` meanwhile', async () => {
  await readyEngine();
  const page = (offset: number, n: number, more: number) => ({
    nobs: 120,
    offset,
    vars: ["x", "s"],
    more,
    rows: Array.from({ length: n }, (_, i) => [`${offset + i + 1}`, "abc"]),
  });
  assert.equal(await moreRows(), false, "no rows yet");
  const first = page(0, 50, 70);
  writable(S.rows).value = first;
  const answers: Later<unknown>[] = [];
  client.query = ((op: string, args: unknown) => {
    client.calls.push([op, args]);
    const a = later();
    answers.push(a);
    return a;
  }) as typeof client.query;
  const more = moreRows();
  assert.deepEqual(client.calls.at(-1), ["browse", { offset: 50, limit: 50 }], "from the next offset");
  answers[0].ok(page(50, 50, 20));
  assert.equal(await more, true);
  assert.deepEqual(
    [
      S.rows.value && "rows" in S.rows.value && S.rows.value.rows.length,
      S.rows.value && "more" in S.rows.value && S.rows.value.more,
    ],
    [100, 20],
  );
  assert.deepEqual((S.rows.value as typeof first).rows[50], ["51", "abc"]);
  // a run replaced `rows` while the request was on its way: the answer is dropped
  const second = S.rows.value;
  const late = moreRows(20);
  assert.deepEqual(client.calls.at(-1), ["browse", { offset: 100, limit: 20 }]);
  writable(S.rows).value = page(0, 50, 70); // refreshData(), after a run
  answers[1].ok(page(100, 20, 0));
  assert.equal(await late, false);
  assert.notEqual(S.rows.value, second);
  assert.equal((S.rows.value as typeof first).rows.length, 50);
  // the engine was reset meanwhile: the call rejects, and nothing is written
  const cut = moreRows();
  answers[2].no(failure("session reset", { kind: "reset" }));
  assert.equal(await cut, false);
  writable(S.rows).value = page(100, 20, 0);
  assert.equal(await moreRows(), false, "no more rows: nothing is asked");
  assert.equal(answers.length, 3);
});

test("addFileGraph: the same .png opened again replaces its entry (new image, same n) and is selected", async () => {
  await readyEngine();
  const a = addFileGraph("a.png", "A1");
  addFileGraph("b.png", "B");
  assert.equal(S.graphIndex.value, 1);
  const again = addFileGraph("a.png", "A2");
  assert.deepEqual(
    S.graphs.value.map((g) => [g.n, g.path, g.png]),
    [
      [a.n, "a.png", "A2"],
      [a.n + 1, "b.png", "B"],
    ],
    "no duplicate",
  );
  assert.equal(again.n, a.n);
  assert.equal(S.graphIndex.value, 0, "the reopened one is shown");
  assert.equal(S.graphs.value[S.graphIndex.value], again);
});

test("a run's graphs take the run's theme, whatever colors their commands name", async () => {
  await readyEngine();
  S.theme.value = "dark";
  const done = runCode("x", FILE);
  client.run1.done.ok(
    result({
      images: ["A", "B"],
      graph_commands: ["scatter y x", "scatter y x, mcolor(black)"],
      graph_lines: [1, 2],
    }),
  );
  await done;
  assert.deepEqual(
    S.graphs.value.map((g) => g.theme),
    ["dark", "dark"],
  );
  S.theme.value = "system";
});

test("addFileGraph: a .png gets the next number after the run's graphs; graphs keep the last 20, so look one up by n", async () => {
  await readyEngine();
  const done = runCode("x", FILE);
  client.run1.done.ok(result({ images: ["A", "B"], graph_commands: ["a", "b"], graph_lines: [1, 2] }));
  await done;
  const g = addFileGraph("plots/p.png", "PNG");
  assert.deepEqual([g.n, g.from, g.path], [3, "file", "plots/p.png"]);
  assert.equal(S.graphs.value[S.graphIndex.value], g);
  for (let i = 0; i < MAX_GRAPHS; i++) addFileGraph(`p${i}.png`, "PNG");
  assert.equal(S.graphs.value.length, MAX_GRAPHS);
  assert.equal(
    S.graphs.value.findIndex((x) => x.n === 3),
    -1,
    "the oldest went",
  );
  assert.equal(S.graphs.value[0].n, 4);
});

test("showToast, holdToast; addBanner replaces one of a kind and path, dismiss removes it", async () => {
  await heard();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    S.showToast("Saved a.do");
    assert.equal(S.toast.value, "Saved a.do");
    mock.timers.tick(50);
    assert.equal(S.announce.value, "Saved a.do", "the live region says it too");
    S.holdToast(true);
    mock.timers.tick(10_000);
    assert.equal(S.toast.value, "Saved a.do", "kept while the pointer is on it");
    S.holdToast(false);
    mock.timers.tick(3999);
    assert.equal(S.toast.value, "Saved a.do");
    mock.timers.tick(1);
    assert.equal(S.toast.value, null);
    // an error: the warning icon's flag, and 6 s at least; a long text stays by its length, 10 s at most
    S.showToast("Couldn't copy: the browser refused", "error");
    assert.equal(S.toastError.value, true);
    mock.timers.tick(5999);
    assert.equal(S.toast.value, "Couldn't copy: the browser refused");
    mock.timers.tick(1);
    assert.equal(S.toast.value, null);
    S.showToast("Saved b.do");
    assert.equal(S.toastError.value, false, "a confirmation clears the flag");
    mock.timers.tick(50); // say()'s timer, before reset() drops it
    assert.equal(S.toastMs("x".repeat(100)), 6000, "60 ms a character");
    assert.equal(S.toastMs("x".repeat(100), true), 6000);
    assert.equal(S.toastMs("x".repeat(500)), S.TOAST_MAX_MS);
    assert.equal(S.toastMs("Saved a.do"), S.TOAST_MIN_MS);
    assert.equal(S.toastMs("Saved a.do", true), S.TOAST_ERROR_MIN_MS);
  } finally {
    mock.timers.reset();
  }
  S.addBanner({ b: "not-text", path: "a.xlsx" });
  S.addBanner({ b: "not-text", path: "b.xlsx" });
  S.addBanner({ b: "reset", reason: "one", kind: "crash", cause: "error", run: null });
  S.addBanner({ b: "reset", reason: "two", kind: "user", cause: null, run: null });
  assert.deepEqual(
    banners().map((b) => b.path ?? b.reason),
    ["a.xlsx", "b.xlsx", "two"],
  );
  S.dismiss({ b: "not-text", path: "a.xlsx" });
  assert.deepEqual(
    banners().map((b) => b.path ?? b.reason),
    ["b.xlsx", "two"],
  );
});

test("J5: a run's promise settles even when the after-run work throws (an open tab's follow-up fails)", async () => {
  await readyEngine();
  store.blocked = false;
  // a view that fails to show a run's text in the open tab
  const detach = D.attachView({
    extensions: [],
    show() {},
    dispatch(spec) {
      if (spec.changes) throw new Error("the editor failed");
    },
    scrollSnapshot: () => null,
  });
  try {
    D.addText("t.csv", "old");
    D.activate("t.csv");
    store.texts.set("t.csv", "new");
    const done = runCode("x", FILE);
    client.run1.done.ok(result({ files: [{ name: "t.csv", status: "modified", bytes: 3 }] }));
    const settled = await Promise.race([done.then(() => "settled"), sleep(100).then(() => "pending")]);
    assert.equal(settled, "settled");
    state("ready");
  } finally {
    detach();
  }
});

test("a read after a run swallows only no-engine and reset; any other failure is reported to the console", async () => {
  await readyEngine();
  const warn = mock.method(console, "warn", () => {});
  const { refreshData } = await import("../src/app/run.ts");
  const refuse = (kind: string) =>
    (client.query = (() => Promise.reject(failure("it said no", { kind }))) as typeof client.query);
  for (const kind of ["no-engine", "reset"]) {
    refuse(kind);
    await refreshData();
  }
  assert.equal(warn.mock.callCount(), 0, "the engine is gone: nothing to say");
  refuse("op");
  await refreshData();
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /it said no/);
  warn.mock.restore();
});
