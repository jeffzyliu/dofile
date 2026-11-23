// Pasting lines and the Start engine action (src/app/start.ts), in each engine state.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep } from "./harness.ts";
import {
  begin,
  client,
  engine,
  expectDrops,
  FILE,
  failure,
  load,
  lock,
  readyEngine,
  result,
  runCode,
  runCommand,
  S,
  startEngine,
  state,
  tick,
  useWiring,
  writable,
} from "./wiring.ts";

useWiring();

test("J1: pasted lines: a line cut because another tab took the engine stops the rest; after a take-over and a later run, no leftover line runs", async () => {
  const { runOne } = await import("../src/app/log/pasterun.ts");
  const { runInTurn, inTurnWords } = await import("../src/app/log/paste.ts");
  await readyEngine();
  let ended: unknown = "not yet";
  const pasted = runInTurn(["display 1", "erase results.csv"], runOne).then((r) => {
    ended = r;
    return r;
  });
  state("running");
  assert.equal(client.run1.args.code, "display 1");
  // another tab takes the engine: the line's run is cut (rc 9998, kind "stopped"), and lastRun is not written
  engine.lost();
  state("other-tab-idle");
  await sleep(20);
  // "Use dofile in this tab", the engine starts again, and the visitor runs something
  engine.takeOver();
  await tick();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  const next = runCommand("display 2");
  assert.equal(next.how, "started");
  client.run1.done.ok(result());
  await next.done;
  await sleep(20);
  const sent = client.workers.flatMap((w) => w.runs.map((r) => r.args.code));
  assert.deepEqual(sent, ["display 1", "display 2"], "the leftover pasted line is never sent");
  assert.deepEqual(ended, { total: 2, ran: 1, stop: { line: 1, why: "taken" } });
  assert.equal(
    inTurnWords(await pasted),
    "1 of 2 pasted lines not run: another tab took over the engine during line 1",
  );
});

test("a paste is decided before anything changes (pastePlan): with no engine an ordinary paste (no line runs, no prompt, the machine hears nothing); with an engine that is not ready, refused whole with the toast's words; ready, the lines run; no line is put back into an off field", async () => {
  const { pastePlan, putBack, runOne } = await import("../src/app/log/pasterun.ts");
  const linesToRun = (before: string, pasted: string, after: string) => {
    const plan = pastePlan(before, pasted, after);
    return plan.do === "run" ? plan.lines : plan.do === "refused" ? plan.words : null;
  };
  const REFUSED = "3 of 3 pasted lines not run: the engine can't take a command now";
  const { runInTurn } = await import("../src/app/log/paste.ts");
  const TEXT = "use wages\nsummarize\nregress y x";
  await load(); // nothing cached: the prompt
  engine.decline();
  writable(S.history).value = [];
  assert.equal(linesToRun("", TEXT, ""), null, "declined: an ordinary paste");
  assert.equal(S.dialog.value, null, "no prompt");
  assert.deepEqual(S.engine.value, { s: "declined" });
  startEngine();
  assert.equal(linesToRun("", TEXT, ""), null, "asking: an ordinary paste");
  engine.start();
  // a download, then a start, in progress: refused whole, and one line alone is still an ordinary paste
  assert.deepEqual(pastePlan("", TEXT, ""), { do: "refused", words: REFUSED }, "downloading");
  assert.deepEqual(pastePlan("typed ", "one line\n", " after"), { do: "ordinary" });
  await begin();
  assert.equal(linesToRun("", TEXT, ""), REFUSED, "starting-worker");
  client.worker.reply({ type: "started" });
  await sleep(20);
  state("ready");
  assert.equal(client.worker.runs.length, 0, "nothing ran once the engine was ready");
  assert.deepEqual(S.history.value, [], "no line is in history");
  assert.deepEqual(engine.drops(), [], "the paste reached no machine");
  assert.deepEqual(linesToRun("display ", "1\ndisplay 2", ""), ["display 1", "display 2"], "ready: the lines run");
  assert.equal(linesToRun("", "one line\n", ""), null, "no line break inside: an ordinary paste, as before");

  // a refused line goes back into an empty field; not into one with text
  const first = runCommand("regress y x"); // a run is on: a paste is refused whole, the text around the cursor counted
  assert.equal(
    linesToRun("gen x = ", "1\nlist", " in 1/5"),
    "2 of 2 pasted lines not run: the engine can't take a command now",
  );
  assert.equal(client.worker.runs.length, 1, "the refused paste sent nothing");
  const r = await runInTurn(["a", "b"], runOne);
  assert.deepEqual(r, { total: 2, ran: 0, stop: { line: 1, why: "refused" } });
  assert.equal(putBack(["a", "b"], r, ""), "a");
  assert.equal(putBack(["a", "b"], r, "typed since"), null);
  client.run1.done.ok(result());
  await first.done;
  expectDrops([{ type: "run", row: "running", why: "not-valid" }]);

  // the engine fails meanwhile (no engine: the field is disabled): nothing is put back
  await load();
  engine.start();
  client.dl.done.no(failure("offline", { kind: "failed", reason: "download" }));
  await tick();
  state("failed");
  assert.equal(putBack(["a", "b"], r, ""), null, "not into a disabled field");
  assert.equal(linesToRun("", TEXT, ""), null, "failed: an ordinary paste");
});

test("Start engine: what each engine state offers (start.ts startOffer), every state named; the words of the off controls and the hint", async () => {
  const { startOffer, startFirst, startHint } = await import("../src/app/start.ts");
  const run = { kind: "file", fresh_locals: true } as const;
  const stage = { stage: "download", t0: 0, done: {} } as const;
  const failed = (reason: "no-wasm" | "download" | "memory" | "updated" | "unknown") =>
    ({ s: "failed", reason, detail: "d", message: "m" }) as const;
  const table: [Parameters<typeof startOffer>[0], ReturnType<typeof startOffer>][] = [
    // not "no engine": the page load, a download or a start in progress, an engine that is up
    [{ s: "checking-lock" }, null],
    [{ s: "checking-cache" }, null],
    [{ s: "downloading", received: 0, total: 1, t0: 0 }, null],
    [{ s: "starting-list", ...stage }, null],
    [{ s: "starting-worker", ...stage }, null],
    [{ s: "ready" }, null],
    [{ s: "running", run, t0: 0 }, null],
    [{ s: "breaking", run, t0: 0, resetAt: 1 }, null],
    [{ s: "waiting", run, t0: 0 }, null],
    // no engine
    [{ s: "none" }, "prompt"],
    [{ s: "asking" }, "prompt"],
    [{ s: "declined" }, "prompt"],
    [failed("download"), "retry"], // the reasons whose banner has "Try again"
    [failed("memory"), "retry"],
    [failed("unknown"), "retry"],
    [failed("updated"), "off"], // the banner says to reload
    [failed("no-wasm"), "off"], // the banner says which browsers work
    [{ s: "failed-twice", reason: "unknown", detail: "d", message: "m" }, "off"],
    [{ s: "other-tab-idle" }, "take-over"],
    [{ s: "other-tab-taking" }, "off"],
  ];
  for (const [st, offer] of table)
    assert.equal(startOffer(st), offer, `${st.s}${"reason" in st ? ` (${st.reason})` : ""}`);
  const names = new Set(table.map(([st]) => st.s));
  assert.equal(names.size, 16, "every state of the machine is in the table");
  // the off controls' toast: what to do where a start is offered; where none is, that the engine is not running
  for (const offer of ["prompt", "retry", "take-over"] as const) {
    assert.equal(startFirst(offer, "see help regress"), "Start the engine to see help regress");
    assert.equal(startFirst(offer, "load wages.dta"), "Start the engine to load wages.dta");
  }
  assert.equal(startFirst("off", "see help regress"), "The engine isn't running: can't see help regress");
  assert.equal(startFirst("off", "load wages.dta"), "The engine isn't running: can't load wages.dta");
  assert.equal(startFirst("off", "import survey.csv"), "The engine isn't running: can't import survey.csv");
  assert.equal(startHint("prompt"), "Start the engine to run code");
  assert.equal(startHint("retry"), "Start the engine to run code");
  assert.equal(startHint("take-over"), "Start the engine to run code");
  assert.equal(startHint("off"), "The engine isn't running");
});

test("Start engine pressed (startEngine, the buttons' and Ctrl/Cmd+Enter's one action) in each state: the prompt, a new try, the take-over dialog, or nothing; it never runs, and where it is off or there is an engine the machine hears nothing", async () => {
  // none (?test=manual) and declined: the download prompt; asking: the prompt again, should it have been replaced
  await load({ manual: true });
  state("none");
  assert.equal(startEngine(), "prompt");
  assert.deepEqual([S.engine.value, S.dialog.value], [{ s: "asking" }, { d: "download" }]);
  S.closeDialog(); // another dialog took its place and closed
  assert.equal(startEngine(), "prompt");
  assert.deepEqual([S.engine.value, S.dialog.value], [{ s: "asking" }, { d: "download" }]);
  engine.decline();
  assert.equal(startEngine(), "prompt");
  assert.deepEqual([S.engine.value, S.dialog.value], [{ s: "asking" }, { d: "download" }]);
  assert.equal(client.downloads.length, 0, "the prompt starts nothing: the visitor answers it");

  // a download or a start in progress, and an engine that is up: null, and nothing is done
  engine.start();
  assert.equal(startEngine(), null);
  state("downloading");
  await begin();
  assert.equal(startEngine(), null);
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(startEngine(), null);
  assert.equal(client.worker.runs.length, 0, "nothing ran");
  const ran = runCode("display 1", FILE);
  assert.equal(startEngine(), null);
  state("running");
  client.run1.done.ok(result());
  await ran;
  assert.deepEqual(engine.drops(), [], "no event reached the machine where the press does nothing");

  // failed for a reason whose banner has "Try again": the same new try
  await load();
  engine.start();
  client.dl.done.no(failure("offline", { kind: "failed", reason: "download" }));
  await tick();
  assert.equal(S.engine.value.s === "failed" && S.engine.value.reason, "download");
  assert.equal(startEngine(), "retry");
  state("downloading");
  assert.equal(client.downloads.length, 2);

  // failed for "updated" (the banner says to reload), and failed twice: off
  await load();
  engine.start();
  client.dl.done.no(failure("dofile was updated: reload the page", { kind: "updated" }));
  await tick();
  assert.equal(S.engine.value.s === "failed" && S.engine.value.reason, "updated");
  assert.equal(startEngine(), "off");
  state("failed");
  assert.equal(client.downloads.length, 1, "no new try");
  assert.deepEqual(engine.drops(), []);

  // another tab has the engine: the take-over dialog, never a start; the lock is taken only by the dialog's button
  await load({ free: false, cached: true });
  state("other-tab-idle");
  S.closeDialog();
  assert.equal(startEngine(), "take-over");
  assert.deepEqual([S.engine.value, S.dialog.value], [{ s: "other-tab-idle" }, { d: "other-tab" }]);
  assert.equal(lock.asked.filter((o) => o.steal).length, 0, "the press took no lock");
  assert.deepEqual([client.downloads.length, client.workers.length], [0, 0], "and started nothing");
  engine.takeOver();
  state("other-tab-taking");
  assert.equal(startEngine(), "off", "the take-over is in progress");
  await tick();
  assert.equal(lock.asked.filter((o) => o.steal).length, 1);
  state("downloading");
  assert.deepEqual(engine.drops(), []);
});
