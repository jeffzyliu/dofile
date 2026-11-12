// The sample project (web/sample/) run in the page's own engine (Pyodide in a worker thread, the built wheel): its do-files
// end with rc 0 and draw a graph, and the run the landing page shows ("What a run looks like") is the one it makes.
// Run `uv build --wheel` first. test/sample.test.ts has the page's logic (the first visit, Restore the sample).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { SAMPLE } from "../src/app/sample-files.ts";
import { EngineClient } from "../src/engine/client.ts";
import { openStore } from "../src/engine/store.ts";
import { endWorkers, runOn, startWorker, nodeWorker as storeWorker } from "./harness.ts";

after(endWorkers);

const root = fileURLToPath(new URL("../..", import.meta.url));
const wheel = (() => {
  const name = readdirSync(`${root}/dist`)
    .filter((f) => f.endsWith(".whl"))
    .sort()
    .at(-1)!;
  return { name, bytes: readFileSync(`${root}/dist/${name}`) };
})();
const extraWheels = readdirSync(`${root}/web/wheels`)
  .filter((f) => f.endsWith(".whl"))
  .map((f) => ({ name: f, bytes: readFileSync(`${root}/web/wheels/${f}`) }));

const bytes = (f: (typeof SAMPLE)[number]) =>
  f.base64 !== undefined ? Uint8Array.from(Buffer.from(f.base64, "base64")) : new TextEncoder().encode(f.text);

test("the sample's do-files run with rc 0 in the page's engine, draw a graph, and make the run the landing page shows", {
  timeout: 240_000,
}, async () => {
  const store = openStore({ indexedDB: new IDBFactory() });
  const eng = new EngineClient({ createWorker: () => storeWorker({ store }), wheel, extraWheels, store });
  const starting = startWorker(eng);
  for (const f of SAMPLE) await store.write(f.path, bytes(f));
  await starting;

  const main = SAMPLE.find((f) => f.path === "analysis.do")!.text!;
  // the whole file, as the editor's Run sends it (the text, no locals), and the second file by itself
  const r = await runOn(eng, main, { fresh_locals: true });
  assert.equal(r.rc, 0, `analysis.do: rc ${r.rc} ${r.error}\n${r.log}`);
  assert.equal(r.new_graphs, 1, "the scatter draws one graph");
  assert.equal(r.images.length, 1);
  assert.match(r.log, /difference:\s+-1\.17/, "the program from helpers.do ran");
  assert.match(r.log, /wage and educ: correlation 0\.665/, "the loop ran");
  const h = await runOn(eng, "do helpers.do", { fresh_locals: true });
  assert.equal(h.rc, 0, h.log);

  // the landing page's output is this run's: every line of its <pre> is in the log
  const html = readFileSync(`${root}/web/landing.html`, "utf8");
  const pre = /<pre class="sample">([\s\S]*?)<\/pre>/.exec(html)![1];
  const text = pre
    .replace(/<[^>]+>/g, "")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<");
  const log = new Set(r.log.split("\n").map((l) => l.trimEnd()));
  for (const line of text.split("\n").filter((l) => l.trim() && !l.startsWith(". "))) {
    assert.ok(log.has(line.trimEnd()), `the landing page shows a line the sample's run does not make: ${line}`);
  }
  eng.worker!.terminate();
});
