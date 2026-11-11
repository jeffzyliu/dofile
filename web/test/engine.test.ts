// The engine worker and client, run in Node: worker.js in a worker thread (as a browser Web Worker), Pyodide, the
// built dofile wheel. Run `uv build --wheel` in the repo first. These tests use the worker's own file ops, which are
// views of /work; the file store and the page's side of the files are in files.test.mjs and store.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineClient, RC_RESET } from "../src/engine/client.ts";
import type { Transferable as NodeTransferable } from "node:worker_threads";
import type { DataSummary, Matrix } from "../src/engine/types.ts";

/** An op's answer that is not `{ error }` (the tests read the fields of one they expect to succeed). */
type Ok<T> = Exclude<T, { error: string }>;

const root = fileURLToPath(new URL("../..", import.meta.url));
const wheels = readdirSync(`${root}/dist`).filter(f => f.endsWith(".whl")).sort();
assert.ok(wheels.length, "no wheel in dist/: run `uv build --wheel` first");
const wheel = { name: wheels.at(-1)!, bytes: readFileSync(`${root}/dist/${wheels.at(-1)}`) };
const extraWheels = readdirSync(`${root}/web/wheels`).filter(f => f.endsWith(".whl")).map(f => ({ name: f, bytes: readFileSync(`${root}/web/wheels/${f}`) }));

// Every worker started here is ended when the file's tests are done, passed or failed: a failing assertion skips the
// `eng.worker.terminate()` at the end of its test, and a live worker keeps the process (and so `npm test`) from exiting.
const started = new Set<Worker>();
after(() => { for (const w of started) w.terminate(); });

function nodeWorker() {
  const w = new Worker(new URL("./node-worker.ts", import.meta.url),
    { workerData: { script: new URL("../src/engine/worker.ts", import.meta.url).href } });
  started.add(w);
  const port = { postMessage: (m: unknown, t?: readonly NodeTransferable[]) => w.postMessage(m, t), terminate: () => w.terminate(),
    onmessage: null as null | ((e: { data: unknown }) => void), onerror: null as null | ((e: unknown) => void) };
  w.on("message", data => port.onmessage?.({ data }));
  w.on("error", e => port.onerror?.(e));
  return port as typeof port & globalThis.Worker;   // what client.ts wants of a (Web) Worker
}

test("engine worker: files, run, describe, matrix, Break, restart", { timeout: 180_000 }, async t => {
  const statuses: string[] = [];
  const eng = new EngineClient({ createWorker: nodeWorker, wheel, extraWheels, onStatus: s => statuses.push(s) });
  const about = await eng.start();
  assert.match(JSON.stringify(about), /opendta/i);
  assert.deepEqual(statuses, ["loading Python", "loading your files", "loading packages", "starting the engine"]);

  await t.test("files: write, list, read, rename, remove, and nothing outside /work", async () => {
    await eng.call("write", { path: "data/cps.dta", data: readFileSync(`${root}/tests/conformance/data/cps.dta`) });
    await eng.call("write", { path: "notes.txt", data: new TextEncoder().encode("hi") });
    const files = await eng.call("files");
    assert.deepEqual(files.map(f => f.path).sort(), ["data", "data/cps.dta", "notes.txt"]);
    assert.equal(new TextDecoder().decode(await eng.call("read", { path: "notes.txt" })), "hi");
    await eng.call("rename", { from: "notes.txt", to: "old/notes.txt" });
    await eng.call("remove", { path: "old" });
    assert.deepEqual((await eng.call("files")).map(f => f.path).sort(), ["data", "data/cps.dta"]);
    await assert.rejects(eng.call("read", { path: "../etc/passwd" }), /not in the working folder/);
  });

  await t.test("run with a Windows path, results, describe, matrix, graph, denied shell", async () => {
    const r = await eng.run('use "C:\\Users\\me\\proj\\data\\cps", clear\ngenerate double lwage = ln(wage_hr)\nscatter lwage yrsed');
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /\(path C:\\Users\\me\\proj\\data\\cps\.dta is data\/cps\.dta in the working folder\)/);
    assert.equal(r.images.length, 1);
    const d = await eng.call("describe", { vars: "lwage yrsed" }) as Ok<DataSummary>;
    assert.deepEqual(d.variables.map(v => v.name), ["lwage", "yrsed"]);
    const reg = await eng.run("regress lwage yrsed, robust");
    assert.equal(reg.rc, 0, reg.log);
    assert.equal(reg.results!.e.macros.vcetype, "Robust");
    const b = await eng.call("matrix", { name: "e(b)" }) as Ok<Matrix>;
    assert.deepEqual(b.cols, ["yrsed", "_cons"]);
    assert.equal((await eng.run("shell ls")).rc, 199);
  });

  await t.test("Break stops at a safe point and keeps the data", async () => {
    await eng.run("clear\nset obs 100\ngen x = 0");
    const running = eng.run("while 1 {\n quietly replace x = x + 1\n}");
    setTimeout(() => eng.breakRun(), 1000);
    const r = await running;
    assert.equal(r.rc, 1, r.log);
    const after = await eng.run("summarize x");
    assert.equal(after.rc, 0);
    assert.equal(after.nobs, 100);
  });

  await t.test("restart: the run in progress ends with rc 9998 and a new worker answers", async () => {
    const running = eng.run("while 1 {\n}");
    await new Promise(r => setTimeout(r, 300));
    await eng.restart("test");
    const r = await running;
    assert.equal(r.rc, RC_RESET);
    assert.match(r.error!, /session reset: test/);
    assert.equal((await eng.run("display 1")).rc, 0);
  });

  eng.worker!.terminate();
});

test("a worker that fails to load is replaced, and start() still finishes", { timeout: 120_000 }, async () => {
  let first = true;
  const blocked = () => {   // as WebKit's refusal of a worker script: an error event, no messages
    const port = { onmessage: null, onerror: null as null | ((e: Error) => void), terminate() {}, postMessage() { setTimeout(() => port.onerror?.(new Error("blocked")), 10); } };
    return port as unknown as globalThis.Worker;
  };
  const eng = new EngineClient({ createWorker: () => (first ? ((first = false), blocked()) : nodeWorker()), wheel, extraWheels });
  assert.match(JSON.stringify(await eng.start()), /opendta/i);
  assert.equal((await eng.run("display 1")).rc, 0);
  eng.worker!.terminate();
});

test("a worker that always fails to load ends start() with an error instead of restarting forever", { timeout: 20_000 }, async () => {
  let made = 0;
  const createWorker = () => {
    made++;
    const port = { onmessage: null, onerror: null as null | ((e: Error) => void), terminate() {}, postMessage() { setTimeout(() => port.onerror?.(new Error("blocked")), 10); } };
    return port as unknown as globalThis.Worker;
  };
  const eng = new EngineClient({ createWorker, wheel, extraWheels });
  await assert.rejects(eng.start(), /failed twice/);
  assert.equal(made, 2);
});

test("files can be listed, written and read while the engine is still loading, and a run sees them", { timeout: 180_000 }, async () => {
  const eng = new EngineClient({ createWorker: nodeWorker, wheel, extraWheels });
  const starting = eng.start();   // not awaited: the page shows the files without waiting for this
  let booted = false;
  starting.then(() => { booted = true; });
  // posted straight after start(): they queue behind "mount" in the worker, so the order holds without waiting
  const before = eng.call("files");
  const write = eng.call("write", { path: "early.do", data: new TextEncoder().encode("display 6*7") });
  assert.deepEqual(await before, []);
  await write;
  assert.equal(new TextDecoder().decode(await eng.call("read", { path: "early.do" })), "display 6*7");
  assert.equal(booted, false, "the files were answered before the engine finished loading");
  // a run asked for before the engine is up waits for it (it does not fail)
  const r = await eng.run("do early.do");
  assert.equal(r.rc, 0, r.log);
  assert.match(r.log, /42/);
  await starting;
  eng.worker!.terminate();
});

// The snapshot start (npm run snapshot builds public/snapshot/). Skipped when it has not been built; the build script
// is deterministic enough that a stale one is caught by the wheel name check below.
const snapshotDir = fileURLToPath(new URL("../public/snapshot/", import.meta.url));
const snapshot = new URL("../public/snapshot/", import.meta.url).href;
const haveSnapshot = existsSync(`${snapshotDir}manifest.json`) &&
  JSON.parse(readFileSync(`${snapshotDir}manifest.json`, "utf8")).wheel === wheel.name;

test("engine from a memory snapshot: native code, graphs, files, Break", { timeout: 180_000, skip: !haveSnapshot && "no current snapshot: npm run snapshot" }, async t => {
  const statuses: string[] = [];
  const eng = new EngineClient({ createWorker: nodeWorker, wheel, extraWheels, snapshot, onStatus: s => statuses.push(s) });
  const t0 = performance.now();
  const about = await eng.start();
  console.log(`snapshot start: ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  assert.match(JSON.stringify(about), /opendta/i);
  assert.deepEqual(statuses, ["downloading the engine", "unpacking the engine", "loading Python", "loading your files", "starting the engine"]);

  await t.test("regress, scipy, a graph and a file after the restore", async () => {
    const r = await eng.run("clear\nset obs 80\ngen x = _n\ngen y = 2*x + mod(_n, 5)\nregress y x\ndisplay \"B=\" %12.8f _b[x]\nscatter y x\ndisplay normal(1.96)");
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /B=\s+2\.00000000|B=\s+1\.99\d+|B=\s+2\.0\d+/);
    assert.match(r.log, /\.97500\d+/);
    assert.equal(r.images.length, 1);
    await eng.call("write", { path: "notes.txt", data: new TextEncoder().encode("hi") });
    assert.equal(new TextDecoder().decode(await eng.call("read", { path: "notes.txt" })), "hi");
  });

  await t.test("Break stops at a safe point and keeps the data", async () => {
    await eng.run("clear\nset obs 100\ngen x = 0");
    const running = eng.run("while 1 {\n quietly replace x = x + 1\n}");
    setTimeout(() => eng.breakRun(), 1000);
    const r = await running;
    assert.equal(r.rc, 1, r.log);
    assert.equal((await eng.run("summarize x")).nobs, 100);
  });
  eng.worker!.terminate();
});

test("a snapshot built for another wheel is refused with a message", { timeout: 60_000, skip: !existsSync(`${snapshotDir}manifest.json`) && "no snapshot" }, async () => {
  const eng = new EngineClient({ createWorker: nodeWorker, wheel: { ...wheel, name: "dofile-0.0.0-py3-none-any.whl" }, snapshot });
  await assert.rejects(eng.start(), { kind: "failed", reason: "unknown", name: "UpdatedError", message: /snapshot is for .* but the page has dofile-0\.0\.0.*npm run snapshot/ });
  assert.equal(eng.worker, null, "the worker that could not start is ended");
});
