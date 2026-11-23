// The engine controller (src/app/engine.ts): the page load, the download, the start, failures, the tab lock, Break and
// resets, on the stand-in transport.

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type { EngineStateName, RunHead } from "../src/app/types.ts";
import type { FileInfo, Results, RunResult } from "../src/engine/types.ts";

import { EngineClient } from "../src/engine/client.ts";

import { focusRequest } from "../src/app/ui/focus-targets.ts";

import { FAILED, FAILED_TWICE, UPDATED } from "../src/app/states/words.ts";

import { fakeWorker, sleep, starts } from "./harness.ts";
import {
  BUILD,
  banners,
  begin,
  CRASH,
  client,
  DONE,
  engine,
  expectDrops,
  FakeTransport,
  FILE,
  failure,
  handlers,
  heard,
  later,
  load,
  lock,
  logItems,
  readyEngine,
  result,
  runCode,
  runCommand,
  S,
  SENTENCE,
  setUp,
  startEngine,
  state,
  store,
  tick,
  useWiring,
  writable,
} from "./wiring.ts";

useWiring();

test("with nothing cached the page asks; Download counts bytes, the stages come from the worker's typed ids, then ready", async () => {
  setUp({ files: ["a.do"] });
  engine.open();
  assert.deepEqual(S.engine.value, { s: "checking-lock" }, "the page load is a state of its own");
  assert.equal(store.blocked, true, "nothing is written before the lock answers");
  await tick();
  assert.deepEqual(S.engine.value, { s: "asking" });
  assert.deepEqual(S.dialog.value, { d: "download" });
  assert.equal(store.blocked, false);
  assert.deepEqual(
    S.files.value.map((f) => f.path),
    ["a.do"],
    "the store was listed",
  );
  engine.start();
  state("downloading");
  client.dl.progress({ received: 10, total: 100 });
  assert.deepEqual([state("downloading").received, state("downloading").total], [10, 100]);
  client.dl.done.ok(DONE);
  await tick();
  assert.equal(state("starting-worker").stage, "download");
  assert.ok(state("starting-worker").done.download! >= 0, "the download's time is the first stage's");
  assert.deepEqual(
    [client.worker.build, client.lists.length],
    [BUILD, 0],
    "the worker gets the list download() has just checked: no second fetch",
  );
  client.worker.reply({ type: "stage", stage: "download" }); // the cache read after download(): the same stage
  client.worker.reply({ type: "stage", stage: "unpack" });
  client.worker.reply({ type: "stage", stage: "python" });
  assert.equal(state("starting-worker").stage, "python");
  assert.deepEqual(Object.keys(state("starting-worker").done).sort(), ["download", "unpack"]);
  client.worker.reply({ type: "started" });
  assert.deepEqual(S.engine.value, { s: "ready" });
  assert.equal(S.dialog.value, null, "the dialog closed by itself");
  assert.equal(focusRequest.value?.name, "editor", "and asked the editor for the focus");
  assert.deepEqual(client.calls.at(-1), ["memory", undefined]);
});

test("the machine's close-dialog closes its own dialog only: a dialog that replaced it stays, and the editor is not asked for the focus", async () => {
  setUp({});
  engine.open();
  await tick();
  engine.start();
  state("downloading");
  client.dl.done.ok(DONE);
  await tick();
  S.openDialog({ d: "other-tab" }); // took the place of the download dialog
  const before = focusRequest.value;
  client.worker.reply({ type: "started" }); // the machine closes the download dialog and asks for the editor's focus
  assert.deepEqual(S.engine.value, { s: "ready" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.equal(focusRequest.value, before);
});

test("start files all cached: the page starts with no dialog; ?snapshot=0 has no list and starts at Python", async () => {
  await load({ cached: true });
  state("downloading");
  assert.equal(S.dialog.value, null);
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  await load({ cached: true, snapshot: false });
  client.dl.done.ok({ cached: false, why: "the normal start loads from the CDN", build: null });
  await tick();
  assert.deepEqual([state("starting-worker").stage, client.worker.build], ["python", null]);
});

test("?test=manual: the page load rests in `none` until start()", async () => {
  await load({ manual: true, cached: true });
  assert.deepEqual(S.engine.value, { s: "none" });
  assert.deepEqual([store.blocked, client.downloads.length, S.dialog.value], [false, 0, null]);
  engine.start();
  state("downloading");
});

test("an answer given while its effect is being performed waits for the step's other effects (a start that fails at once: no WebAssembly)", async () => {
  await load({ cached: true });
  await heard();
  const start = client.start.bind(client);
  // as the transport does with no WebAssembly: the answer comes before start() returns
  client.start = (n, build, reply) => {
    start(n, build, reply);
    reply({ type: "start-failed", reason: "no-wasm", detail: "this browser has no WebAssembly support" });
  };
  const seen: string[] = [];
  const off = S.engine.subscribe((st) => {
    seen.push(st.s);
  });
  client.dl.done.ok(DONE);
  await tick();
  off();
  assert.deepEqual(seen, ["downloading", "starting-worker", "failed"], "one step after the other");
  assert.deepEqual(S.engine.value, {
    s: "failed",
    reason: "no-wasm",
    message: FAILED["no-wasm"],
    detail: "this browser has no WebAssembly support",
  });
  assert.deepEqual(client.worker.ended, { kind: "failed", reason: "this browser has no WebAssembly support" });
  assert.equal(
    await heard(),
    "Downloading the engine. The engine didn't start",
    "the first step's last effect (its stage is said) came before the failure's",
  );
});

test("a subscriber of the `engine` signal that throws does not stop the step: its effects are performed all the same, and the error reaches whoever raised the event", async () => {
  await readyEngine();
  const done = runCode("long", FILE);
  const old = client.worker;
  // as a view's effect that starts a run when it sees the new state: run() throws while a step is in progress
  const off = S.engine.subscribe((st) => {
    if (st.s === "starting-list") engine.run("again", FILE);
  });
  assert.throws(() => engine.reset(), /run\(\) was called while a step of the engine's state machine is in progress/);
  off();
  state("starting-list");
  assert.deepEqual(
    old.ended,
    { kind: "reset", reset: "user", reason: SENTENCE("reset by you") },
    "the old worker was ended",
  );
  assert.deepEqual(
    [client.live, client.lists.length],
    [null, 1],
    "and the new start has begun: the list is being fetched",
  );
  assert.deepEqual(banners(), [{ b: "reset", reason: "reset by you", kind: "user", cause: null, run: FILE }]);
  const cut = (await done)!;
  assert.deepEqual(
    [cut.rc, cut.kind],
    [9998, "user"],
    "the cut run's result was handed over: end-run, the step's last effect",
  );
  assert.equal(S.results.value, null, "engine-gone");
  // and the machine goes on from there
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(client.workers.length, 2);
});

// The stand-in transport above keeps the real one's rules by hand (start() throws while a worker is live, end() with no
// worker does nothing, a call cut by end() rejects with the ending's kind). Here the controller drives the real
// EngineClient, with client.test.ts's scripted worker, so that those rules are held against the real thing.
test("the controller on the real transport, with a scripted worker: ready, a run, a crash during a run and the restart, a late stage, then two crashes: failed-twice", async () => {
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const answerRun: ((result: RunResult) => void)[] = [];
  let silent = false; // the next workers answer nothing
  const transport = new EngineClient({
    wheel: "dofile.whl",
    caches: null,
    createWorker: () => {
      const quiet = silent;
      const worker = fakeWorker((m, post) => {
        if (quiet || starts(m, post)) return;
        if (m.op === "run") answerRun.push((r) => post({ id: m.id, result: r }));
        else if (m.op !== "describe_file") post({ id: m.id, result: { op: m.op } }); // describe_file waits for ever
      });
      workers.push(worker);
      return worker;
    },
  });
  const until = async (name: EngineStateName) => {
    for (let i = 0; i < 500 && S.engine.value.s !== name; i++) await sleep(2);
    state(name);
  };
  setUp({ transport, snapshot: false });
  engine.open();
  await until("asking"); // the real cached(): no snapshot start, so it cannot tell
  engine.start(); // the real download(): nothing to fill, and no list
  await until("ready");
  assert.deepEqual([workers.length, transport.worker === workers[0], transport.about], [1, true, { dofile: "test" }]);
  await sleep(10);
  assert.deepEqual(S.memory.value, { op: "memory" }, "engine-ready asked through the real query()");

  const done = runCode("display 1", FILE);
  await sleep(10);
  answerRun[0](result({ log: "1\n" }));
  assert.equal((await done)!.log, "1\n");
  state("ready");
  assert.deepEqual(S.data.value, { op: "describe" });

  // the worker crashes during a run, with a read op waiting: the real end() fails both, and the machine's own result
  // ends the run
  const cutRun = runCode("long", FILE);
  const waiting = engine.call("describe_file", { path: "d.dta" });
  await sleep(10);
  workers[0].onerror!(new Error("boom"));
  state("starting-list");
  await assert.rejects(waiting, { kind: "reset", reset: "crash", message: SENTENCE("the engine crashed (boom)") });
  const cut = (await cutRun)!;
  assert.deepEqual([cut.rc, cut.kind, cut.error], [9998, "crash", SENTENCE("the engine crashed (boom)")]);
  // the real build() (no list: null), then start(): it would throw if the old worker were still live
  await until("ready");
  assert.deepEqual([workers.length, workers[0].terminated, transport.worker === workers[1]], [2, true, true]);
  assert.deepEqual(banners(), [
    { b: "reset", reason: "the engine crashed (boom)", kind: "crash", cause: "error", run: FILE },
  ]);
  // what the ended worker still says goes through its own reply, with its own ticket: the machine drops it
  workers[0].onmessage!({ data: { stage: "engine" } });
  state("ready");

  // two crashes in a row: the second, while the new worker starts, stops it for good
  silent = true;
  workers[1].onerror!(new RangeError("out of memory"));
  await until("starting-worker");
  assert.equal(workers.length, 3);
  workers[2].onerror!(new RangeError("out of memory"));
  assert.deepEqual(S.engine.value, {
    s: "failed-twice",
    reason: "memory",
    message: FAILED_TWICE,
    detail: "the engine's worker failed twice (out of memory); reload the page",
  });
  assert.deepEqual(
    [workers.map((w) => w.terminated), transport.worker],
    [[true, true, true], null],
    "every worker was ended, and no fourth was made",
  );
  await assert.rejects(engine.call("memory"), { kind: "no-engine" });
  engine.start();
  state("failed-twice");
  expectDrops([
    { type: "stage", n: 4, row: "ready", why: "stale" },
    { type: "start", row: "failed-twice", why: "not-valid" },
  ]);

  // a start that fails before a worker exists (no WebAssembly): the machine's end-worker finds no worker, and that is
  // not an error
  let made = 0;
  const none = new EngineClient({
    wheel: "dofile.whl",
    caches: null,
    wasm: null,
    createWorker: () => {
      made++;
      return fakeWorker(() => {});
    },
  });
  setUp({ transport: none, snapshot: false });
  engine.open();
  await until("asking");
  engine.start();
  await until("failed");
  assert.deepEqual([state("failed").reason, made, none.worker], ["no-wasm", 0, null]);
});

test("open() is once for each wiring, and an action before it throws", () => {
  setUp();
  assert.throws(() => engine.start(), /not open: call open\(\) first/);
  assert.throws(() => engine.run("display 1", FILE), /not open/);
  engine.open();
  assert.throws(() => engine.open(), /open\(\) was called twice on one wiring/);
  setUp();
  engine.open(); // a new wiring: a new machine
  assert.deepEqual(S.engine.value, { s: "checking-lock" });
});

test("Stop download declines; a run then is refused and opens no prompt; Start engine opens the prompt and runs nothing, not when the engine is ready either; Run then runs", async () => {
  writable(S.log).value = []; // this test counts the log's items: it starts with none, not with the head
  await load();
  engine.start();
  engine.stopDownload();
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(client.dl.signal.aborted, true);
  assert.equal(S.dialog.value, null);
  const refused = runCode("display 1", FILE);
  assert.equal(S.dialog.value, null, "a run with no engine opens no prompt");
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(await refused, null, "it did not run: null at once");
  assert.deepEqual(logItems(), [], "no run-head, no text: nothing began");
  expectDrops([{ type: "run", row: "declined", why: "not-valid" }]);
  assert.equal(startEngine(), "prompt"); // the one action offered: "Start engine"
  assert.deepEqual(S.dialog.value, { d: "download" });
  assert.deepEqual(S.engine.value, { s: "asking" });
  engine.start();
  await begin();
  const seen: string[] = [];
  const off = S.engine.subscribe((st) => {
    seen.push(st.s);
  });
  client.worker.reply({ type: "started" });
  off();
  assert.deepEqual(seen, ["starting-worker", "ready"], "ready, and nothing runs by itself");
  await tick();
  state("ready");
  assert.equal(client.worker.runs.length, 0, "the run pressed with no engine was not kept");
  assert.deepEqual(client.calls.at(-1), ["memory", undefined], "engine-ready");
  const ran = runCode("display 1", FILE); // the visitor runs it again
  assert.equal(client.worker.runs.length, 1);
  assert.deepEqual([client.run1.args.code, client.run1.args.fresh_locals], ["display 1", true]);
  assert.equal(logItems().find((i) => i.t === "runhead")!.first, true);
  client.run1.done.ok(result());
  assert.equal((await ran)?.rc, 0);
});

test("a failed download is `failed` (reason download) with no worker; a failed start is `failed` with its cause; a second crash is `failed-twice`", async () => {
  await load();
  engine.start();
  client.dl.done.no(failure("https://dofile.test/snapshot/heap.bin: 503", { kind: "failed", reason: "download" }));
  await tick();
  const failed = state("failed"); // no offline start: a failed download ends there
  assert.deepEqual(
    [failed.reason, failed.message, failed.detail],
    ["download", FAILED.download, "https://dofile.test/snapshot/heap.bin: 503"],
    "plain words for the visitor, and the cause for a developer",
  );
  assert.equal(client.workers.length, 0, "no worker is made");
  // the reason is the error's own, as for the list: a Cache that breaks is "unknown", not a failed download
  engine.start();
  client.dl.done.no(failure("the cache is broken", { kind: "failed", reason: "unknown" }));
  await tick();
  assert.deepEqual([state("failed").reason, client.workers.length], ["unknown", 0]);
  assert.equal(state("failed").message, FAILED.unknown);

  engine.start();
  await begin();
  client.worker.reply({ type: "start-failed", reason: "download", detail: "no snapshot at /snapshot/" });
  assert.deepEqual(S.engine.value, {
    s: "failed",
    reason: "download",
    message: FAILED.download,
    detail: "no snapshot at /snapshot/",
  });
  assert.deepEqual(
    client.worker.ended,
    { kind: "failed", reason: "no snapshot at /snapshot/" },
    "the worker that could not start is ended",
  );
  assert.equal(client.forgot, 0, "one failure keeps the cached files");

  // "Try again", and the worker crashes twice: a new start after the first crash, then it stops for good
  engine.start();
  await begin();
  client.worker.reply({ type: "crashed", cause: "error", reason: "memory", detail: "out of memory" });
  state("starting-list");
  await begin();
  client.worker.reply({ type: "crashed", cause: "error", reason: "memory", detail: "out of memory" });
  assert.deepEqual(S.engine.value, {
    s: "failed-twice",
    reason: "memory",
    message: FAILED_TWICE,
    detail: "the engine's worker failed twice (out of memory); reload the page",
  });
  assert.deepEqual(
    [client.workers.length, client.live],
    [3, null],
    "two workers for this start, both ended, and no third",
  );
  assert.deepEqual(client.worker.ended!.kind, "failed-twice");
  assert.equal(client.forgot, 0, "memory: the files are not at fault, the cache stays");
  // failed twice is not started again by the page: a reload is the way out
  engine.start();
  state("failed-twice");
  expectDrops([{ type: "start", row: "failed-twice", why: "not-valid" }]);
});

test("failed twice for reason unknown or download deletes the cached start files, so a reload downloads them fresh", async () => {
  for (const reason of ["unknown", "download"] as const) {
    await load({ cached: true });
    await begin();
    client.worker.reply({ type: "crashed", cause: "error", reason, detail: "boom" });
    await begin();
    client.worker.reply({ type: "crashed", cause: "error", reason, detail: "boom" });
    state("failed-twice");
    assert.equal(client.forgot, 1, reason);
  }
});

test("an empty or partial cache asks; the lock lost while the cache check is pending starts nothing", async () => {
  await load({ cached: false }); // cached() is false for an empty cache and for a partly filled one alike
  assert.deepEqual(S.engine.value, { s: "asking" });
  assert.equal(client.downloads.length, 0, "nothing downloads before the visitor says so");

  S.closeDialog();
  const answer = later<boolean>();
  await load({ cached: answer });
  assert.deepEqual(S.engine.value, { s: "checking-cache" });
  // Download or Run pressed now is refused: the page has not decided yet whether to ask
  engine.start();
  assert.equal(runCommand("display 1").how, "refused");
  assert.deepEqual(S.engine.value, { s: "checking-cache" });
  engine.lost(); // another tab takes the lock while the cache is checked
  answer.ok(true);
  await tick();
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  assert.deepEqual(
    [client.downloads.length, client.workers.length, store.blocked],
    [0, 0, true],
    "no download, no worker",
  );
  expectDrops([
    { type: "start", row: "checking-cache", why: "not-valid" },
    { type: "run", row: "checking-cache", why: "not-valid" },
    { type: "cache-checked", n: 2, row: "other-tab-idle", why: "stale" },
  ]);
});

test("tab lock: without it the tab is blocked and asks; taking over steals the lock and starts; losing it ends the worker", async () => {
  await load({ free: false, cached: true });
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.equal(store.blocked, true);
  assert.equal(S.files.value.length, 0, "a blocked tab does not even list");
  engine.takeOver();
  assert.deepEqual(S.engine.value, { s: "other-tab-taking" });
  await tick();
  assert.deepEqual(lock.asked.at(-1), { steal: true });
  assert.equal(store.blocked, false);
  assert.equal(S.dialog.value, null);
  state("downloading");
  await begin();
  engine.lost();
  assert.deepEqual(client.worker.ended, { kind: "stopped", reason: SENTENCE("another tab took over") });
  assert.equal(store.blocked, true);
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
});

test("a run: the streamed log grows one item and the result's log replaces it; graphs, lastRun, results and the after-run calls", async () => {
  await readyEngine();
  const head: RunHead = { kind: "selection", path: "a.do", lines: [11, 14], fresh_locals: false };
  const done = runCode("x", head);
  state("running");
  const { onLog, done: answer } = client.run1;
  onLog(". display 1\n");
  onLog("1\n");
  const texts = () => logItems().filter((i) => i.t === "text");
  assert.equal(texts().length, 1);
  assert.equal(texts()[0].text, ". display 1\n1\n");
  assert.equal(texts()[0].streaming, true);
  assert.deepEqual(
    logItems().find((i) => i.t === "runhead"),
    { t: "runhead", run: head, first: true },
  );
  const ended = result({
    rc: 111,
    log: ". display 1\n1\n(the complete log)\n",
    error_line: 3,
    images: ["PNG"],
    graph_commands: ["scatter y x"],
    graph_lines: [2],
    files: [{ name: "out.png", status: "created", bytes: 3 }],
  });
  answer.ok(ended);
  assert.equal(await done, ended, "runCode resolves with the engine's result itself");
  assert.equal(texts()[0].text, ". display 1\n1\n(the complete log)\n", "replaced, not appended");
  assert.equal(texts()[0].streaming, false);
  assert.deepEqual(
    S.graphs.value.map((g) => [g.n, g.command, g.line, g.theme]),
    [[1, "scatter y x", 2, "light"]],
  );
  assert.deepEqual(logItems().at(-1), { t: "graph", n: 1 });
  assert.deepEqual(
    S.lastRun.value,
    { ...head, rc: 111, line: 13, seconds: S.lastRun.value!.seconds },
    "the error line in the file",
  );
  assert.deepEqual([...S.fresh.value], ["out.png"]);
  assert.deepEqual(
    client.calls.slice(-4).map((c) => c[0]),
    ["describe", "browse", "macros", "memory"],
  );
  assert.deepEqual(S.data.value, { op: "describe" });
  state("ready");
  // the next run in the same session is not the first
  runCode("y", FILE);
  assert.equal(
    logItems()
      .filter((i) => i.t === "runhead")
      .at(-1)!.first,
    false,
  );
  client.run1.done.ok(result());
});

test("a crash cuts a run: the new state first, then engine-gone, then the cut run's result; the banner; the cut run keeps what streamed and says why", async () => {
  await readyEngine();
  const order: string[] = [];
  engine.connectRun({
    ...handlers,
    engineGone: () => {
      order.push(`engine-gone in ${S.engine.value.s}`);
      handlers.engineGone();
    },
    ended: (r) => {
      order.push(`ended (rc ${r.rc}, ${r.kind}) in ${S.engine.value.s}`);
      handlers.ended(r);
    },
  });
  writable(S.results).value = { e: {}, r: {}, e_changed: true, r_changed: false } as unknown as Results;
  const done = runCode("loop", FILE);
  client.run1.onLog("pass 1\n");
  const old = client.worker;
  old.reply({ type: "crashed", cause: "error", reason: "unknown", detail: "x" });
  state("starting-list");
  assert.deepEqual(
    order,
    ["engine-gone in starting-list", "ended (rc 9998, crash) in starting-list"],
    "run.ts gets the cut result after the `engine` signal has the new state, and after the engine is gone",
  );
  assert.deepEqual(old.ended, { kind: "reset", reset: "crash", reason: SENTENCE("the engine crashed (x)") });
  assert.deepEqual(banners(), [
    { b: "reset", reason: "the engine crashed (x)", kind: "crash", cause: "error", run: FILE },
  ]);
  const cut = (await done)!;
  assert.deepEqual([cut.rc, cut.kind, cut.results], [9998, "crash", null], "the machine's own result");
  assert.equal(cut.error, SENTENCE("the engine crashed (x)"));
  state("starting-list");
  assert.equal(logItems().find((i) => i.t === "text")!.text, "pass 1\n");
  assert.match(logItems().at(-1)!.text!, /session reset: the engine crashed/);
  assert.equal(S.results.value, null);
  assert.equal(S.lastRun.value!.rc, 9998, "the cut run is the last run");
  assert.equal(
    S.engineRuns.value,
    0,
    "but nothing has run on the new engine: Reset would not ask (engineRuns, not lastRun)",
  );
  assert.equal(client.lists.length, 1, "a restart fetches the build's list fresh");
  await begin();
  assert.deepEqual(client.worker.build, BUILD);
  client.worker.reply({ type: "started" });
  state("ready");
  // the new engine has no locals yet: its first run says so, although the cut run ended after the reset began
  runCode("display 1", { kind: "selection", path: "a.do", lines: [1, 1], fresh_locals: false });
  assert.equal(S.engineRuns.value, 1, "a run begun on this engine: Reset now asks");
  assert.equal(
    logItems()
      .filter((i) => i.t === "runhead")
      .at(-1)!.first,
    true,
  );
  client.run1.done.ok(result());
});

test("Break: `breaking` with the deadline, then `waiting` on Don't reset; the run's end makes it `ready`, with the engine's own rc", async () => {
  await readyEngine({ graceMs: 5000 });
  const done = runCode("long", FILE);
  const before = Date.now();
  engine.breakRun();
  const { resetAt } = state("breaking");
  assert.ok(resetAt >= before + 5000 && resetAt <= Date.now() + 5000, "the deadline is the grace time from now");
  assert.deepEqual(client.interrupted, [client.worker.n], "the run was asked to stop");
  engine.breakRun(); // a second Break keeps the first deadline
  assert.equal(state("breaking").resetAt, resetAt);
  engine.keepWaiting();
  state("waiting");
  // the run had ended before a safe point: its own rc
  const ended = result({ rc: 0, log: "the last command finished\n" });
  client.run1.done.ok(ended);
  assert.equal(await done, ended, "not rewritten");
  state("ready");
  assert.equal(S.lastRun.value!.rc, 0);
  expectDrops([{ type: "break", row: "breaking", why: "not-valid" }]);
});

test("Break on a page that cannot ask a run to stop (no SharedArrayBuffer) resets at once", async () => {
  await readyEngine({ canInterrupt: false });
  const done = runCode("while 1 {\n}", FILE);
  engine.breakRun();
  state("starting-list");
  assert.deepEqual(client.interrupted, [], "there was nothing to ask");
  const reason = "Break reset the engine, because this page is not cross-origin isolated and cannot ask a run to stop";
  assert.deepEqual(banners(), [{ b: "reset", reason, kind: "break", cause: null, run: FILE }]);
  const r = (await done)!;
  assert.deepEqual([r.rc, r.kind, r.error], [9998, "break", SENTENCE(reason)]);
});

// The one answer the stale guard does not protect: two runs on one worker share its ticket, so a timer left from the
// first run would reset the second. Every exit from `breaking` emits cancel-break-timer; this pins that the controller
// performs it.
test("the Break timer across two runs on one worker (a simulated clock): the first run's timer never fires in the second, whose Break gets its own whole grace time", async () => {
  await readyEngine({ graceMs: 5000 });
  const micro = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    runCode("first", FILE);
    mock.timers.tick(1000);
    engine.breakRun();
    assert.equal(state("breaking").resetAt, Date.now() + 5000);
    mock.timers.tick(2000);
    // the engine takes the Break, before the deadline
    client.run1.done.ok(result({ rc: 1, log: "--Break--\nr(1);\n" }));
    await micro();
    state("ready");
    assert.equal(S.lastRun.value!.rc, 1);
    runCode("second", FILE);
    state("running");
    mock.timers.tick(10_000); // well past the first run's deadline
    state("running");
    assert.deepEqual(
      engine.drops(),
      [],
      "no break-timeout was raised: the first timer was cancelled, not left to be dropped",
    );
    assert.equal(client.workers.length, 1);
    engine.breakRun();
    assert.equal(state("breaking").resetAt, Date.now() + 5000);
    mock.timers.tick(4999);
    state("breaking");
    mock.timers.tick(1); // the second run's own deadline
    state("starting-list");
    assert.deepEqual(client.worker.ended, {
      kind: "reset",
      reset: "break",
      reason: SENTENCE("the code did not stop at Break"),
    });
    assert.deepEqual(banners(), [
      { b: "reset", reason: "the code did not stop at Break", kind: "break", cause: null, run: FILE },
    ]);
    await micro();
    assert.deepEqual(
      [S.lastRun.value!.rc, logItems().at(-1)!.text],
      [9998, SENTENCE("the code did not stop at Break")],
    );
    // "Don't reset" cancels it too
    client.list.ok(BUILD);
    await micro();
    client.worker.reply({ type: "started" });
    runCode("third", FILE);
    engine.breakRun();
    engine.keepWaiting();
    mock.timers.tick(60_000);
    state("waiting");
    assert.equal(client.workers.length, 2, "no reset");
  } finally {
    mock.timers.reset();
  }
});

test("losing the tab lock clears what the old engine left; after a take-over the new engine starts with none of it", async () => {
  await readyEngine();
  const done = runCode("x", FILE);
  client.run1.done.ok(result({ results: { e: {}, r: {}, e_changed: true, r_changed: false } }));
  await done;
  const left = ["results", "macros", "data", "rows", "memory", "lastRun"] as const;
  for (const k of left) assert.notEqual(S[k].value, null, k);
  engine.lost();
  for (const k of left) assert.equal(S[k].value, null, `${k} after the lock was lost`);
  engine.takeOver();
  await tick();
  await begin();
  for (const k of left) assert.equal(S[k].value, null, `${k} after the take-over`);
});

test('a crash during the first start: ready once, no reset banner and no "Engine reset" (no engine had been ready)', async () => {
  await load({ cached: true });
  await heard();
  let readies = 0;
  const off = S.engine.subscribe((st) => {
    if (st.s === "ready") readies++;
  });
  await begin();
  const first = client.worker;
  first.reply({ type: "stage", stage: "unpack" });
  first.reply(CRASH); // the worker failed by itself: a new start
  state("starting-list");
  assert.deepEqual(banners(), []);
  first.reply({ type: "started" }); // what the first worker still says is out of date
  state("starting-list");
  await begin();
  client.worker.reply({ type: "started" });
  off();
  state("ready");
  assert.equal(readies, 1, "ready once");
  assert.equal(client.calls.filter((c) => c[0] === "memory").length, 1);
  const words = await heard();
  assert.doesNotMatch(words, /Engine reset/);
  assert.match(words, /Engine ready/);
  expectDrops([{ type: "started", n: 4, row: "starting-list", why: "stale" }]);
});

test("start() acts only in none, asking, declined and failed; a second take-over press steals the lock once", async () => {
  await load();
  state("asking");
  engine.start();
  engine.start(); // a second press of Download while it downloads
  assert.equal(client.downloads.length, 1, "one download");
  await begin();
  engine.start(); // while starting
  assert.deepEqual([client.downloads.length, client.workers.length], [1, 1]);
  expectDrops([
    { type: "start", row: "downloading", why: "not-valid" },
    { type: "start", row: "starting-worker", why: "not-valid" },
  ]);

  await load({ free: false, cached: true });
  engine.takeOver();
  engine.takeOver();
  await tick();
  assert.equal(lock.asked.filter((o) => o.steal).length, 1, "the lock was stolen once");
  state("downloading");
  engine.takeOver(); // not from other-tab-idle: nothing
  assert.equal(lock.asked.filter((o) => o.steal).length, 1);
  expectDrops([
    { type: "take-over", row: "other-tab-taking", why: "not-valid" },
    { type: "take-over", row: "downloading", why: "not-valid" },
  ]);
});

test('an updated site fails with reason "updated", from download() at once or from the list a restart fetches, in plain words; the reason is never read from the text', async () => {
  await load();
  engine.start();
  client.dl.done.no(failure("dofile was updated: reload the page", { kind: "updated" }));
  await tick();
  assert.deepEqual(
    [state("failed").reason, state("failed").message],
    ["updated", UPDATED],
    "plain words: a newer version, reload",
  );
  assert.match(UPDATED, /newer version.*Reload the page/);
  assert.equal(client.workers.length, 0, "no worker after an updated download");

  // a page that was open when the site was deployed again: its next restart finds the list of another build
  const stale =
    "dofile was updated: reload the page (the site's start files are of the build 0123456789ab, this page of ba9876543210; in development: `npm run snapshot`)";
  await readyEngine();
  const cut = runCode("x", FILE);
  engine.reset();
  client.list.no(failure(stale, { kind: "updated" }));
  await tick();
  assert.deepEqual(S.engine.value, { s: "failed", reason: "updated", message: UPDATED, detail: stale });
  assert.deepEqual([client.workers.length, client.live], [1, null], "the old worker is ended, and no new one is made");
  assert.equal((await cut)!.kind, "user");
  // "Try again" after a reset whose new start failed: the cut run is still the last run
  engine.start();
  state("downloading");
  assert.equal(S.lastRun.value!.rc, 9998);

  // a list that does not arrive is reason download; anything else unknown
  for (const [error, reason] of [
    [{ kind: "failed", reason: "download" }, "download"],
    [{ kind: "failed", reason: "unknown" }, "unknown"],
    [{}, "unknown"],
  ] as const) {
    await readyEngine();
    engine.reset();
    client.list.no(failure("dofile has a newer version (not from the text)", error));
    await tick();
    assert.equal(state("failed").reason, reason);
  }
  // a start that fails says its reason itself (the transport worked it out from the error's name)
  for (const reason of ["unknown", "memory", "download", "no-wasm"] as const) {
    await load({ cached: true });
    await begin();
    client.worker.reply({ type: "start-failed", reason, detail: "dofile was updated (not from the text)" });
    assert.deepEqual(S.engine.value, {
      s: "failed",
      reason,
      message: FAILED[reason],
      detail: "dofile was updated (not from the text)",
    });
  }
  // and a download that fails with such words is reason unknown: the error's reason, not its text
  await load();
  engine.start();
  client.dl.done.no(failure("dofile was updated (not from the text)", { kind: "failed", reason: "unknown" }));
  await tick();
  assert.equal(state("failed").reason, "unknown");
});

test("a failed start's message is plain words for every reason, with no developer terms; the cause is `detail` and goes to the console", async () => {
  const dev = /npm|snapshot|manifest|bytes|worker|wheel|\.js|\.json|\?|`/i;
  for (const m of [...Object.values(FAILED), FAILED_TWICE]) assert.doesNotMatch(m, dev, m);
  const warn = mock.method(console, "warn", () => {});
  const cause = "snapshot: a file is 10 bytes, the manifest says 99; run `npm run snapshot` again";
  try {
    for (const reason of ["no-wasm", "download", "memory", "unknown"] as const) {
      await load({ cached: true });
      await begin();
      client.worker.reply({ type: "start-failed", reason, detail: cause });
      const st = state("failed");
      assert.doesNotMatch(st.message, dev, reason);
      assert.equal(st.detail, cause);
      assert.equal(warn.mock.calls.at(-1)!.arguments[0], `[dofile] the engine didn't start (${reason}): ${cause}`);
    }
    for (const reason of ["memory", "unknown"] as const) {
      await load({ cached: true });
      await begin();
      client.worker.reply({ type: "crashed", cause: "error", reason, detail: cause });
      await begin();
      client.worker.reply({ type: "crashed", cause: "error", reason, detail: cause });
      const st = state("failed-twice");
      assert.doesNotMatch(st.message, dev, `failed-twice ${reason}`);
      assert.equal(st.detail, `the engine's worker failed twice (${cause}); reload the page`);
      assert.match(String(warn.mock.calls.at(-1)!.arguments[0]), /npm run snapshot/);
    }
  } finally {
    warn.mock.restore();
  }
});

test("Reset: the banner carries the kind; the reason is the user's; the old worker is ended and the list is fetched fresh", async () => {
  await readyEngine();
  const old = client.worker;
  engine.reset();
  assert.deepEqual(banners(), [{ b: "reset", reason: "reset by you", kind: "user", cause: null, run: null }]);
  assert.deepEqual(old.ended, { kind: "reset", reset: "user", reason: SENTENCE("reset by you") });
  assert.deepEqual(
    [state("starting-list").stage, client.lists.length, client.live],
    ["download", 1, null],
    "no worker yet",
  );
  engine.reset(); // a second press: a start is in progress
  assert.equal(client.lists.length, 1);
  expectDrops([{ type: "reset", row: "starting-list", why: "not-valid" }]);
});

test('say(): what is said in one tick is heard together; a reset says "Engine reset", not "Download the engine"', async () => {
  await heard();
  S.say("Engine reset");
  S.say("Run ended: the engine was reset");
  assert.equal(await heard(), "Engine reset. Run ended: the engine was reset");
  S.say("Run finished");
  assert.equal(S.announce.value, "", "the empty step: the same words again are a change");
  assert.equal(await heard(), "Run finished");
  await readyEngine();
  await heard();
  client.worker.reply(CRASH);
  await begin(); // the new start's first stage is not announced
  assert.equal(await heard(), "Engine reset");
});

test("the page's store is blocked until the tab lock answers", async () => {
  const { store } = await import("../src/app/store.ts");
  assert.equal(store.blocked, true);
  await assert.rejects(store.write("a.do", new Uint8Array(1)), /another tab/);
});

test("runCode while a run is on does nothing; with no engine a run is refused, settles with null at once and opens no prompt, and after Start engine, Not now or a failed start nothing runs", async () => {
  await readyEngine();
  const first = runCode("a", FILE);
  assert.equal(await runCode("b", FILE), null);
  assert.equal(client.worker.runs.length, 1);
  client.run1.done.ok(result());
  await first;
  expectDrops([{ type: "run", row: "running", why: "not-valid" }]);

  await load(); // nothing cached: the prompt
  engine.decline();
  const refused = runCode("not kept", FILE);
  let settled = false;
  refused.then(() => (settled = true));
  for (let i = 0; i < 10; i++) await Promise.resolve(); // runCode is async: a few microtasks, and no timer or engine event
  assert.equal(settled, true, "it settles without waiting for the engine");
  assert.equal(await refused, null);
  assert.equal(S.dialog.value, null, "a run opens no prompt");
  assert.equal(startEngine(), "prompt");
  assert.deepEqual(S.dialog.value, { d: "download" });
  engine.decline();
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(client.worker.runs.length, 0, "after Not now: nothing ran");
  expectDrops([{ type: "run", row: "declined", why: "not-valid" }]);

  await load();
  engine.decline();
  assert.equal(await runCode("not kept", FILE), null);
  assert.deepEqual(S.engine.value, { s: "declined" });
  expectDrops([{ type: "run", row: "declined", why: "not-valid" }]);
  startEngine();
  assert.deepEqual(S.engine.value, { s: "asking" });
  engine.start();
  await begin();
  client.worker.reply({ type: "start-failed", reason: "unknown", detail: "no" });
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(client.worker.runs.length, 0, "after a failed start: nothing ran");
});

test("run() called while a step is in progress throws before it queues anything", async () => {
  await readyEngine();
  const thrown: unknown[] = [];
  // a handler that tries to start the next run as soon as one ends: inside the step that ended it
  engine.connectRun({
    ...handlers,
    ended: (r) => {
      try {
        engine.run("the next one", FILE);
      } catch (e) {
        thrown.push(e);
      }
      handlers.ended(r);
    },
  });
  const done = runCode("display 1", FILE);
  client.run1.done.ok(result());
  await done;
  assert.equal(thrown.length, 1);
  assert.match(
    String((thrown[0] as Error).message),
    /run\(\) was called while a step of the engine's state machine is in progress/,
  );
  state("ready");
  assert.equal(client.worker.runs.length, 1, "nothing was queued: no run started later");
  await tick();
  state("ready");
  assert.deepEqual(engine.drops(), []);
  // after the step (the run's promise has resolved) it is an ordinary run
  assert.equal(engine.run("the next one", FILE), true);
  client.run1.done.ok(result());
});

// Every machine counts its tickets from 1 along the same path, so a late answer of an earlier wiring would present a
// ticket the new machine has issued too.
test("a reply of an earlier wiring does nothing: the first wiring's download completes after connectEngine, with the new download's ticket number", async () => {
  await load();
  client.deaf = true; // its download does not hear the abort, and completes
  engine.start();
  const first = client;
  await load(); // connectEngine and open() again
  engine.start();
  state("downloading"); // the new machine's download has ticket 3, as the first one's had
  first.dl.progress({ received: 99, total: 100 });
  first.dl.done.ok(DONE);
  await tick();
  assert.deepEqual(
    [state("downloading").received, client.workers.length, first.workers.length],
    [0, 0, 0],
    "nothing changed",
  );
  assert.deepEqual(engine.drops(), [], "and it is not recorded: the drop record belongs to the new wiring");
  await begin(); // the new wiring's own download is taken
});

test("the download handle is the wiring's own: a second connectEngine aborts the first wiring's download, and the new wiring's Stop download aborts its own", async () => {
  await load();
  engine.start();
  const first = client.dl;
  await load(); // connectEngine and open() again
  assert.equal(first.signal.aborted, true, "the first wiring's download is aborted when the wiring is replaced");
  engine.start();
  const own = client.dl;
  assert.equal(own.signal.aborted, false);
  engine.stopDownload();
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(own.signal.aborted, true, "Stop download aborts the new wiring's download");
});

// A wrong ticket: the old download's reply is bound to its own ticket.
test("an older download still talking: its progress and its end are dropped as stale, and the drop record names them", async () => {
  await load();
  client.deaf = true;
  engine.start();
  const old = client.dl;
  engine.stopDownload();
  assert.deepEqual(S.engine.value, { s: "declined" });
  engine.start();
  old.progress({ received: 50, total: 100 });
  assert.equal(state("downloading").received, 0);
  assert.deepEqual(engine.drops(), [{ type: "download-progress", n: 3, row: "downloading", why: "stale" }]);
  client.dl.progress({ received: 7, total: 100 });
  assert.equal(state("downloading").received, 7);
  old.done.ok(DONE);
  await tick();
  assert.equal(client.workers.length, 0, "the old download's end starts no worker");
  expectDrops([
    { type: "download-progress", n: 3, row: "downloading", why: "stale" },
    { type: "download-done", n: 3, row: "downloading", why: "stale" },
  ]);
});

// A read op is outside the machine: it raises no event in any of these steps.
test("call(): a read op with no worker is rejected (no-engine); one that waits behind a run is cut by a reset (kind reset), or answered after the run", async () => {
  await load();
  engine.decline();
  await assert.rejects(engine.call("matrix", { name: "e(b)", runId: 1 }), { kind: "no-engine" });
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.deepEqual(engine.drops(), []);

  await readyEngine();
  runCode("long", FILE);
  client.hold = true;
  const waiting = engine.call("describe_file", { path: "d.dta" });
  engine.reset();
  await assert.rejects(waiting, { kind: "reset" });
  state("starting-list");
  assert.deepEqual(engine.drops(), []);
  assert.deepEqual(client.calls.at(-1), ["describe_file", { path: "d.dta" }]);

  // and when the run ends first, the op is answered after it: it was neither cut nor dropped
  client.hold = false;
  await begin();
  client.worker.reply({ type: "started" });
  const done = runCode("long", FILE);
  let answer: unknown = "pending";
  client.hold = true;
  engine.call("describe_file", { path: "d.dta" }).then((a) => {
    answer = a;
  });
  client.hold = false;
  client.run1.done.ok(result());
  await done;
  state("ready");
  assert.equal(answer, "pending", "the run's end did not settle it");
  client.waiting[0].ok({ nobs: 60 }); // the worker reaches it in its queue
  await tick();
  assert.deepEqual(answer, { nobs: 60 });
});

test('A1: a tab that loses the lock while the files are still being listed: the download is aborted and no worker starts; "Use dofile in this tab" still works', async () => {
  setUp({ cached: true });
  const listed = later<FileInfo[]>();
  store.list = () => listed;
  engine.open();
  await tick();
  state("downloading"); // the cache check does not wait for the list
  const first = client.dl;
  engine.lost(); // another tab takes the lock
  listed.ok([]);
  await tick();
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.deepEqual(
    [store.blocked, first.signal.aborted, client.workers.length],
    [true, true, 0],
    "no download, no worker",
  );
  engine.takeOver(); // the dialog's button acts
  await tick();
  state("downloading");
  assert.equal(S.dialog.value, null);
  assert.equal(store.blocked, false);
  assert.equal(client.downloads.length, 2);
});

test("A1: a take-over whose lock is taken back while it waits for the lock starts no engine; a second press acts", async () => {
  await load({ free: false, cached: true });
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  const granted = later<boolean>();
  lock.take = async (o) => {
    lock.asked.push(o ?? {});
    return o?.steal ? granted : false;
  };
  engine.takeOver();
  await tick();
  engine.lost(); // the other tab steals it back
  granted.ok(true);
  await tick();
  assert.deepEqual(S.engine.value, { s: "other-tab-idle" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" }, "the dialog stays");
  assert.equal(store.blocked, true);
  assert.equal(client.downloads.length, 0);
  lock.take = async (o) => {
    lock.asked.push(o ?? {});
    return true;
  };
  engine.takeOver();
  await tick();
  assert.equal(lock.asked.filter((o) => o.steal).length, 2, "the second press stole again");
  state("downloading");
  assert.equal(S.dialog.value, null);
  expectDrops([{ type: "lock-answered", n: 2, row: "other-tab-idle", why: "stale" }]);
});

test("A2: reset() acts only in ready, running, breaking and waiting; never in failed-twice or while downloading", async () => {
  await load();
  engine.start();
  engine.reset();
  state("downloading");
  await begin();
  client.worker.reply(CRASH);
  await begin();
  client.worker.reply(CRASH);
  state("failed-twice");
  engine.reset(); // the Reset dialog confirmed after the engine failed twice
  state("failed-twice");
  assert.deepEqual(
    [client.workers.length, client.lists.length],
    [2, 1],
    "a worker that must stay stopped is not started again",
  );
  expectDrops([
    { type: "reset", row: "downloading", why: "not-valid" },
    { type: "reset", row: "failed-twice", why: "not-valid" },
  ]);
  await readyEngine();
  engine.reset();
  state("starting-list"); // ready: it resets
});

// reset() is refused while a start is in progress, so the second restart is the machine's own: the new worker crashed
test("A3: two restarts in a row, then one start completes: ready once", async () => {
  await readyEngine();
  engine.reset();
  let readies = 0;
  const off = S.engine.subscribe((st) => {
    if (st.s === "ready") readies++;
  }); // it calls at once: now `starting-list`
  await begin();
  client.worker.reply(CRASH); // the new worker crashes while it starts: a second restart
  state("starting-list");
  await begin();
  client.worker.reply({ type: "started" });
  off();
  state("ready");
  assert.equal(readies, 1, "ready once");
  assert.equal(client.workers.length, 3);
});

test("C1: a run cut by losing the tab lock does not set lastRun, and the store is not listed afterwards", async () => {
  await readyEngine();
  const done = runCode("long", FILE);
  let listed = 0;
  const list = store.list;
  store.list = () => {
    listed++;
    return list();
  };
  engine.lost();
  assert.equal(S.lastRun.value, null);
  const cut = (await done)!;
  assert.deepEqual([cut.rc, cut.kind, cut.error], [9998, "stopped", SENTENCE("another tab took over")]);
  assert.equal(S.lastRun.value, null, "not after the other-tab clear");
  assert.equal(logItems().find((i) => i.t === "text")!.end!.rc, 9998, "the log keeps how it ended");
  assert.equal(
    listed,
    0,
    "the store is blocked before the run's result is handed over: the files are the other tab's now",
  );
  assert.equal(store.blocked, true);
});

test('C2: "Not now" during the download aborts it: no start follows, also when the download completes anyway', async () => {
  await load();
  client.deaf = true; // the download does not stop in time
  engine.start();
  state("downloading");
  engine.decline();
  assert.equal(client.dl.signal.aborted, true);
  assert.deepEqual(S.engine.value, { s: "declined" });
  client.dl.done.ok(DONE); // too late
  await tick();
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(client.workers.length, 0);
  expectDrops([{ type: "download-done", n: 3, row: "declined", why: "stale" }]);
});

test("a worker that could not open the file store: ready, and the store-failed banner; a start that finds a newer database fails with reason updated", async () => {
  await load({ cached: true });
  await begin();
  client.worker.reply({ type: "started", storeFailed: "copy" });
  state("ready");
  assert.deepEqual(banners(), [{ b: "store-failed", cause: "copy" }]);

  await load({ cached: true });
  await begin();
  client.worker.reply({ type: "start-failed", reason: "updated", detail: "VersionError: the database is newer" });
  assert.deepEqual(S.engine.value, {
    s: "failed",
    reason: "updated",
    message: UPDATED,
    detail: "VersionError: the database is newer",
  });
});

test("the store-failed banner goes when a later start opens the store (a reset after a store error that passed)", async () => {
  await load({ cached: true });
  await begin();
  client.worker.reply({ type: "started", storeFailed: "open" });
  assert.deepEqual(
    banners().map((b) => b.b),
    ["store-failed"],
  );
  client.worker.reply(CRASH);
  await tick();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.deepEqual(
    banners().map((b) => b.b),
    ["reset"],
    "the new worker copied the files: no store-failed banner",
  );
});

test("the reset banner carries the crash's cause (storage, folder, error), and none for a reset the visitor or Break made", async () => {
  for (const cause of ["error", "storage", "folder"] as const) {
    await readyEngine();
    client.worker.reply({ type: "crashed", cause, reason: "unknown", detail: "x" });
    await tick();
    assert.equal(banners().at(-1)!.cause, cause);
  }
  await readyEngine();
  engine.reset();
  await tick();
  assert.equal(banners().at(-1)!.cause, null);
});

test("a run that rejects with a kind other than op is not swallowed: no-engine ends the run (run-failed); an ending's kind says nothing, the machine cut the run", async () => {
  await readyEngine();
  const run = runCode("x", FILE);
  client.run1.done.no(failure("the engine is not running", { kind: "no-engine" }));
  await tick();
  state("ready"); // not left in `running` for ever
  const r = (await run)!;
  assert.deepEqual([r.rc, r.kind, r.error], [9998, "run-failed", "the engine is not running"]);
});

test("connectEngine called again lets go of the earlier client's graphics subscription", async () => {
  let subscribed = 0;
  const transport = Object.assign(new FakeTransport(), {
    onGraphics() {
      subscribed++;
      return () => {
        subscribed--;
      };
    },
  });
  setUp({ transport });
  setUp({ transport });
  assert.equal(subscribed, 1);
});
