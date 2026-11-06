// The engine worker and client, run in Node: worker.js in a worker thread (as a browser Web Worker), Pyodide, the
// built dofile wheel. Run `uv build --wheel` in the repo first. In Node, /work is in memory (no IndexedDB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineClient, RC_RESET } from "../src/engine/client.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const wheels = readdirSync(`${root}/dist`).filter(f => f.endsWith(".whl")).sort();
assert.ok(wheels.length, "no wheel in dist/: run `uv build --wheel` first");
const wheel = { name: wheels.at(-1), bytes: readFileSync(`${root}/dist/${wheels.at(-1)}`) };

function nodeWorker() {
  const w = new Worker(new URL("./node-worker.mjs", import.meta.url),
    { workerData: { script: new URL("../src/engine/worker.js", import.meta.url).href } });
  const port = { postMessage: (m, t) => w.postMessage(m, t), terminate: () => w.terminate(), onmessage: null, onerror: null };
  w.on("message", data => port.onmessage?.({ data }));
  w.on("error", e => port.onerror?.(e));
  return port;
}

test("engine worker: files, run, describe, matrix, Break, restart", { timeout: 180_000 }, async t => {
  const statuses = [];
  const eng = new EngineClient({ createWorker: nodeWorker, wheel, onStatus: s => statuses.push(s) });
  const about = await eng.start();
  assert.match(JSON.stringify(about), /opendta/i);
  assert.deepEqual(statuses, ["loading Python", "loading packages", "loading your files", "starting the engine"]);

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
    const d = await eng.call("describe", { vars: "lwage yrsed" });
    assert.deepEqual(d.variables.map(v => v.name), ["lwage", "yrsed"]);
    const reg = await eng.run("regress lwage yrsed, robust");
    assert.equal(reg.rc, 0, reg.log);
    assert.equal(reg.results.e.macros.vcetype, "Robust");
    const b = await eng.call("matrix", { name: "e(b)" });
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
    assert.match(r.error, /session reset: test/);
    assert.equal((await eng.run("display 1")).rc, 0);
  });

  eng.worker.terminate();
});
