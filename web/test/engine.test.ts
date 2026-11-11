// The engine worker and the transport, run in Node: worker.ts in a worker thread (as a browser Web Worker), Pyodide, the
// built dofile wheel. Run `uv build --wheel` in the repo first. No state machine here: the test starts and ends the
// workers itself (harness.ts, startWorker), as the machine's effects would. The page's file changes go through a store in
// this thread (fake-indexeddb), as in the page: its journal and the op `sync` (files.test.ts has the store with a running
// engine in full, store.test.ts the store alone); `files` and `read` are the worker's views of /work.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import "fake-indexeddb/auto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Transferable as NodeTransferable } from "node:worker_threads";
import { Worker } from "node:worker_threads";
import { IDBFactory } from "fake-indexeddb";
import { about, buildId, inputs, readManifest, staleness } from "../scripts/build-id.ts";
import { EngineClient } from "../src/engine/client.ts";
import type { Answer } from "../src/engine/machine.ts";
import { openStore } from "../src/engine/store.ts";
import type { DataSummary, Matrix, ReadOps } from "../src/engine/types.ts";
import { endWorkers, live, runOn, startWorker, nodeWorker as storeWorker } from "./harness.ts";

/** An op's answer that is not `{ error }` (the tests read the fields of one they expect to succeed). */
type Ok<T> = Exclude<T, { error: string }>;

const root = fileURLToPath(new URL("../..", import.meta.url));
const wheels = readdirSync(`${root}/dist`)
  .filter((f) => f.endsWith(".whl"))
  .sort();
assert.ok(wheels.length, "no wheel in dist/: run `uv build --wheel` first");
const wheel = { name: wheels.at(-1)!, bytes: readFileSync(`${root}/dist/${wheels.at(-1)}`) };
const extraWheels = readdirSync(`${root}/web/wheels`)
  .filter((f) => f.endsWith(".whl"))
  .map((f) => ({ name: f, bytes: readFileSync(`${root}/web/wheels/${f}`) }));

// Every worker started here is ended when the file's tests are done, passed or failed: a failing assertion skips the
// `eng.worker.terminate()` at the end of its test, and a live worker keeps the process (and so `npm test`) from exiting.
const started = new Set<Worker>();
after(() => {
  for (const w of started) w.terminate();
});
after(endWorkers);

function nodeWorker() {
  const w = new Worker(new URL("./node-worker.ts", import.meta.url), {
    workerData: { script: new URL("../src/engine/worker.ts", import.meta.url).href },
  });
  started.add(w);
  const port = {
    postMessage: (m: unknown, t?: readonly NodeTransferable[]) => w.postMessage(m, t),
    terminate: () => w.terminate(),
    onmessage: null as null | ((e: { data: unknown }) => void),
    onerror: null as null | ((e: unknown) => void),
  };
  w.on("message", (data) => port.onmessage?.({ data }));
  w.on("error", (e) => port.onerror?.(e));
  return port as typeof port & globalThis.Worker; // what client.ts wants of a (Web) Worker
}

// The page's store, in a fresh database of this thread, and a worker that uses it (harness.ts). A change resolves once
// its `sync` is posted, and the worker answers in order, so a `files` or `read` asked after it sees the change.
function pageStore() {
  const store = openStore({ indexedDB: new IDBFactory() });
  return { store, createWorker: () => storeWorker({ store }) };
}
// Everything about the engine that a visitor's code or the page can observe, gathered with the read ops and one run of
// commands that change nothing (the probe). What it does not see: a change below a variable's display format (the values
// are compared as `list` prints them), and state inside Python that no command shows (a cache, the heap).
// `graphs`: list the graphs in memory too. Only `graph dir` lists them, and it sets r(list) (as Stata's does), so it is
// in the probe only once r() is already what it leaves: the test runs `graph dir` first.
async function fingerprint(eng: EngineClient, graphs: boolean) {
  const described = await eng.query("describe"); // the variables in order, with type, format and labels; the counts; the file name
  const nobs = "nobs" in described ? described.nobs : 0;
  const rows = await eng.query("browse", { limit: Math.max(nobs, 1) }); // every value of every observation, in the data's order
  const macros = await eng.query("macros"); // the locals and the globals
  const { data_bytes } = await eng.query("memory"); // the data's size (not the heap, which may grow)
  const files = await eng.query("files"); // /work, with sizes and times
  // the sort order, the user's matrices, the graphs in memory: the probe's log. Its results: r() and e() (scalars, macros,
  // the matrices' sizes), and that the probe itself changed neither.
  const probe = await runOn(eng, `display "sorted by: \`: sortedby'"\nmatrix dir${graphs ? "\ngraph dir" : ""}`);
  assert.equal(probe.rc, 0, probe.log);
  assert.deepEqual(
    [probe.results!.r_changed, probe.results!.e_changed],
    [false, false],
    "the probe leaves r() and e() as they were",
  );
  const matrices: Record<string, Matrix> = {}; // the values of each matrix of r() and e()
  for (const set of ["e", "r"] as const) {
    for (const name of Object.keys(probe.results![set].matrices))
      matrices[`${set}(${name})`] = await eng.query("matrix", { name: `${set}(${name})` });
  }
  return { described, rows, macros, data_bytes, files, results: probe.results, matrices, log: probe.log };
}
// Each read op, with arguments other than the defaults. A new read op fails the check until it has a row here.
const READ_ARGS: { [K in keyof ReadOps]: ReadOps[K]["args"][] } = {
  describe: [{ vars: "x s", offset: 1, limit: 1 }, { vars: "nosuchvar" }],
  describe_file: [{ path: "fp.dta" }, { path: "nothing.dta" }],
  matrix: [{ name: "e(b)" }, { name: "e(V)" }, { name: "M" }, { name: "r(nothing)" }],
  macros: [undefined],
  browse: [{ vars: "y", offset: 5, limit: 7 }, { limit: 1000 }],
  memory: [undefined],
  files: [undefined],
  read: [{ path: "fp.dta" }],
};

/** The stages a start said, in order, and how it ended. */
const stagesOf = (said: Answer<"start-worker">[]) => said.map((a) => (a.type === "stage" ? a.stage : a.type));

test("engine worker: files, run, describe, matrix, Break, a new worker after end()", {
  timeout: 180_000,
}, async (t) => {
  const said: Answer<"start-worker">[] = [],
    { store, createWorker } = pageStore();
  const eng = new EngineClient({ createWorker, wheel, extraWheels, store });
  await startWorker(eng, null, said);
  assert.match(JSON.stringify(eng.about), /opendta/i);
  assert.deepEqual(
    stagesOf(said),
    ["python", "files", "packages", "engine", "started"],
    "typed stage ids, then started",
  );

  await t.test("files: write, list, read, rename, remove, and nothing outside /work", async () => {
    await store.write("data/cps.dta", readFileSync(`${root}/tests/conformance/data/cps.dta`));
    await store.write("notes.txt", new TextEncoder().encode("hi"));
    const files = await eng.query("files");
    assert.deepEqual(files.map((f) => f.path).sort(), ["data", "data/cps.dta", "notes.txt"]);
    assert.equal(new TextDecoder().decode(await eng.query("read", { path: "notes.txt" })), "hi");
    await store.rename("notes.txt", "old/notes.txt");
    await store.remove("old");
    assert.deepEqual((await eng.query("files")).map((f) => f.path).sort(), ["data", "data/cps.dta"]);
    await assert.rejects(eng.query("read", { path: "../etc/passwd" }), /not in the working folder/);
  });

  await t.test("run with a Windows path, results, describe, matrix, graph, denied shell", async () => {
    const r = await runOn(
      eng,
      'use "C:\\Users\\me\\proj\\data\\cps", clear\ngenerate double lwage = ln(wage_hr)\nscatter lwage yrsed',
    );
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /\(path C:\\Users\\me\\proj\\data\\cps\.dta is data\/cps\.dta in the working folder\)/);
    assert.equal(r.images.length, 1);
    const d = (await eng.query("describe", { vars: "lwage yrsed" })) as Ok<DataSummary>;
    assert.deepEqual(
      d.variables.map((v) => v.name),
      ["lwage", "yrsed"],
    );
    const reg = await runOn(eng, "regress lwage yrsed, robust");
    assert.equal(reg.rc, 0, reg.log);
    assert.equal(reg.results!.e.macros.vcetype, "Robust");
    const b = (await eng.query("matrix", { name: "e(b)" })) as Ok<Matrix>;
    assert.deepEqual(b.cols, ["yrsed", "_cons"]);
    assert.equal((await runOn(eng, "shell ls")).rc, 199);
  });

  await t.test("the compiled-in ABOUT (scripts/build-id.ts, about()) is what the engine itself answers at boot", () => {
    const { dofile, engine_commit, stata_version } = eng.about!;
    assert.deepEqual(
      { dofile, engine_commit, stata_version },
      about(),
      "the wheel is of this tree: its version, the vendored engine's commit, the Stata version",
    );
    assert.match(dofile, /^\d+\.\d+/);
    assert.match(engine_commit!, /^[0-9a-f]{40}$/);
  });

  // ReadOps is a declaration (types.ts): anyone may send one, at any time, because each is said to change nothing. No type
  // can prove that of a call into Python: this is the evidence.
  await t.test(
    "the read ops change nothing: the engine's fingerprint is the same after each, called twice",
    async () => {
      const setup = await runOn(
        eng,
        [
          "clear",
          "set obs 30",
          "generate x = _n",
          "generate y = mod(x * 7, 11)",
          'generate str3 s = "abc"',
          'label variable y "the outcome"',
          "sort y x",
          "save fp.dta, replace",
          "regress y x",
          "matrix M = (1, 2 \\ 3, 4)",
          "local mine 5",
          "global G hello",
          "scatter y x",
          "summarize y",
        ].join("\n"),
      );
      assert.equal(setup.rc, 0, setup.log);
      const unchangedByEveryReadOp = async (graphs: boolean) => {
        const before = await fingerprint(eng, graphs);
        // the helper itself changes nothing it reads: this covers the five read ops it is made of
        assert.deepEqual(await fingerprint(eng, graphs), before, "fingerprint() twice in a row");
        for (const op of Object.keys(READ_ARGS) as (keyof ReadOps)[]) {
          for (const args of READ_ARGS[op]) {
            const answers = [await eng.query(op, args), await eng.query(op, args)];
            assert.deepEqual(answers[1], answers[0], `${op}: the same answer twice`);
            assert.deepEqual(await fingerprint(eng, graphs), before, `${op} ${JSON.stringify(args)} changed something`);
          }
        }
        return before;
      };
      // 1. With r() as the visitor's code left it. What the fingerprint sees: data in a sort order, r() and e() with their
      // matrices, macros, a user matrix, files.
      const first = await unchangedByEveryReadOp(false);
      assert.match(first.log, /sorted by: y x/);
      assert.match(first.log, /\bM\b/, "the user's matrix");
      assert.deepEqual(Object.keys(first.matrices).sort(), ["e(V)", "e(b)"]);
      assert.ok(
        "mean" in first.results!.r.scalars && "N" in first.results!.e.scalars,
        "r() of summarize, e() of regress",
      );
      assert.deepEqual([first.macros.locals.mine, first.macros.globals.G], ["5", "hello"]);
      assert.ok("rows" in first.rows && first.rows.rows.length === 30 && first.data_bytes > 0);
      assert.ok(first.files.some((f) => f.path === "fp.dta"));
      // 2. The graphs in memory too. `graph dir` sets r(list): from here r() is that, before and after each probe.
      assert.equal((await runOn(eng, "graph dir")).results!.r_changed, true);
      const second = await unchangedByEveryReadOp(true);
      assert.match(second.log, /^\s*Graph\s*$/m, "the graph in memory");
      assert.deepEqual(second.results!.r.macros, { list: "Graph" });
      assert.deepEqual([second.described, second.rows, second.matrices], [first.described, first.rows, first.matrices]);
      // 3. And the fingerprint does see a change: each of these, made by a run, gives another one.
      let last = await fingerprint(eng, false);
      for (const change of [
        "sort x",
        "local other 1",
        "matrix N = (7)",
        "summarize x",
        'replace s = "abd" in 1',
        "regress x y",
        "save fp2.dta",
        "format x %9.2f",
      ]) {
        const r = await runOn(eng, change);
        assert.equal(r.rc, 0, r.log);
        const now = await fingerprint(eng, false);
        assert.notDeepEqual(now, last, `the fingerprint does not see: ${change}`);
        last = now;
      }
      const dropped = await runOn(eng, "graph drop _all\ngraph dir");
      assert.equal(dropped.rc, 0, dropped.log);
      assert.notEqual((await fingerprint(eng, true)).log, second.log, "the fingerprint does not see: graph drop _all");
    },
  );

  await t.test("Break stops at a safe point and keeps the data", async () => {
    await runOn(eng, "clear\nset obs 100\ngen x = 0");
    const running = runOn(eng, "while 1 {\n quietly replace x = x + 1\n}");
    setTimeout(() => eng.interrupt(live(eng)), 1000);
    const r = await running;
    assert.equal(r.rc, 1, r.log);
    const after = await runOn(eng, "summarize x");
    assert.equal(after.rc, 0);
    assert.equal(after.nobs, 100);
  });

  // the machine's RESET: end-worker, then start-worker (the run's rc 9998 result is the machine's own: machine.test.ts)
  await t.test(
    "end() during a run: the run's call fails with the ending's kind, and a new worker answers",
    async () => {
      const running = runOn(eng, "while 1 {\n}");
      await new Promise((r) => setTimeout(r, 300));
      const old = eng.worker;
      eng.end(live(eng), { kind: "reset", reset: "user", reason: "session reset: test." });
      await assert.rejects(running, { kind: "reset", reset: "user", message: "session reset: test." });
      await startWorker(eng);
      assert.notEqual(eng.worker, old);
      const r = await runOn(eng, 'display "N=" _N');
      assert.equal(r.rc, 0);
      assert.match(r.log, /N=0/, "the data in memory is gone");
    },
  );

  eng.worker!.terminate();
});

// The machine's RESET(crash) for a first crash: end-worker, then start-worker. That a worker which always fails is not
// started for ever is the machine's (machine.test.ts, scenario 6) and the controller's (app.test.ts).
test("a worker that fails to load says `crashed`; after end() the next start finishes", {
  timeout: 120_000,
}, async () => {
  let first = true;
  const blocked = () => {
    // as WebKit's refusal of a worker script: an error event, no messages
    const port = {
      onmessage: null,
      onerror: null as null | ((e: Error) => void),
      terminate() {},
      postMessage() {
        setTimeout(() => port.onerror?.(new Error("blocked")), 10);
      },
    };
    return port as unknown as globalThis.Worker;
  };
  const eng = new EngineClient({
    createWorker: () => (first ? ((first = false), blocked()) : nodeWorker()),
    wheel,
    extraWheels,
  });
  await assert.rejects(startWorker(eng), { type: "crashed", cause: "error", reason: "unknown", detail: "blocked" });
  eng.end(live(eng), { kind: "reset", reset: "crash", reason: "session reset: the engine crashed (blocked)." });
  await startWorker(eng);
  assert.match(JSON.stringify(eng.about), /opendta/i);
  assert.equal((await runOn(eng, "display 1")).rc, 0);
  eng.worker!.terminate();
});

test("files can be listed, written and read while the engine is still loading, and a run sees them", {
  timeout: 180_000,
}, async () => {
  const { store, createWorker } = pageStore();
  const eng = new EngineClient({ createWorker, wheel, extraWheels, store });
  const starting = startWorker(eng); // not awaited: the page shows the files without waiting for this
  let booted = false;
  starting.then(() => {
    booted = true;
  });
  // written straight after start(): mount's copy has it, or its sync (queued behind mount) brings it, so the ops asked
  // after it see it either way
  await store.write("early.do", new TextEncoder().encode("display 6*7"));
  assert.deepEqual(
    (await eng.query("files")).map((f) => f.path),
    ["early.do"],
  );
  assert.equal(new TextDecoder().decode(await eng.query("read", { path: "early.do" })), "display 6*7");
  assert.equal(booted, false, "the files were answered before the engine finished loading");
  // a run asked for before the engine is up waits for it (it does not fail)
  const r = await runOn(eng, "do early.do");
  assert.equal(r.rc, 0, r.log);
  assert.match(r.log, /42/);
  await starting;
  eng.worker!.terminate();
});

// The snapshot start (npm run snapshot builds public/snapshot/). Skipped when it has not been built, or is stale: built from
// other wheels or another Pyodide (a build refuses it; the page's checkBuild too: the test after this one).
const snapshotDir = fileURLToPath(new URL("../public/snapshot/", import.meta.url));
const manifest = readManifest();
const current = inputs(),
  haveSnapshot = Boolean(manifest) && staleness(manifest!, current) === null;
// What the build's list (start-files.json, scripts/start-files.ts) says of the snapshot: the transport reads it, compares
// its build id with the page's (checkBuild), and gives the worker the build's time (`built`) and the snapshot's two big
// files. The files' own entries are not needed here: the worker reads the files from disk. The page's id is made from the
// same stamp and the inputs, as vite.config.ts makes both.
const STAMP = "engine.test.ts";
const startFiles = manifest && {
  built: manifest.built,
  buildId: buildId(STAMP, manifest),
  snapshot: manifest.files,
  files: [],
  size: 0,
  compressed: 0,
};

test("engine from a memory snapshot: native code, graphs, files, Break; the worker needs no manifest.json", {
  timeout: 180_000,
  skip: !haveSnapshot && "no current snapshot: npm run snapshot",
}, async (t) => {
  // The snapshot's files, in a folder with no manifest.json: a worker that read one would fail to start.
  const bare = mkdtempSync(join(tmpdir(), "dofile-snapshot-"));
  after(() => rmSync(bare, { recursive: true, force: true }));
  for (const f of readdirSync(snapshotDir)) if (f !== "manifest.json") symlinkSync(`${snapshotDir}${f}`, join(bare, f));
  const said: Answer<"start-worker">[] = [],
    { store, createWorker } = pageStore();
  const eng = new EngineClient({
    createWorker,
    wheel,
    extraWheels,
    buildId: buildId(STAMP, current),
    startFiles: startFiles!,
    snapshot: `${pathToFileURL(bare).href}/`,
    store,
  });
  const t0 = performance.now();
  const build = await eng.build(); // the list, checked: what mount needs of it
  assert.deepEqual(build, { built: manifest!.built, files: manifest!.files });
  await startWorker(eng, build, said);
  console.log(`snapshot start: ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  assert.match(JSON.stringify(eng.about), /opendta/i);
  assert.deepEqual(stagesOf(said), ["download", "unpack", "python", "files", "engine", "started"]);

  await t.test("regress, scipy, a graph and a file after the restore", async () => {
    const r = await runOn(
      eng,
      'clear\nset obs 80\ngen x = _n\ngen y = 2*x + mod(_n, 5)\nregress y x\ndisplay "B=" %12.8f _b[x]\nscatter y x\ndisplay normal(1.96)',
    );
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /B=\s+2\.00000000|B=\s+1\.99\d+|B=\s+2\.0\d+/);
    assert.match(r.log, /\.97500\d+/);
    assert.equal(r.images.length, 1);
    await store.write("notes.txt", new TextEncoder().encode("hi"));
    assert.equal(new TextDecoder().decode(await eng.query("read", { path: "notes.txt" })), "hi");
  });

  await t.test("Break stops at a safe point and keeps the data", async () => {
    await runOn(eng, "clear\nset obs 100\ngen x = 0");
    const running = runOn(eng, "while 1 {\n quietly replace x = x + 1\n}");
    setTimeout(() => eng.interrupt(live(eng)), 1000);
    const r = await running;
    assert.equal(r.rc, 1, r.log);
    assert.equal((await runOn(eng, "summarize x")).nobs, 100);
  });
  eng.worker!.terminate();
});

test('a list of another build is refused with kind "updated" before any worker is made', {
  timeout: 60_000,
  skip: !manifest && "no snapshot",
}, async () => {
  let made = 0;
  const eng = new EngineClient({
    createWorker: () => (made++, nodeWorker()),
    wheel,
    buildId: buildId("another build run", current),
    startFiles: startFiles!,
    snapshot: new URL("../public/snapshot/", import.meta.url).href,
  });
  await assert.rejects(eng.build(), {
    kind: "updated",
    message: /^dofile was updated: reload the page.*npm run snapshot/,
  });
  assert.equal(made, 0, "no worker is made");
  assert.equal(eng.worker, null);
});
