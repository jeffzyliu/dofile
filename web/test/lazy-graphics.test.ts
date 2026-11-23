// The lazy graphics part with a shared buffer, end to end in Node: the page's half (EngineClient), worker.ts in a worker
// thread, and the `[dofile]` lines both write. Skipped without a current snapshot that has a graphics part.

import assert from "node:assert/strict";
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, type TestContext, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";
import { buildId, inputs, readManifest, staleness } from "../scripts/build-id.ts";
import { EngineClient } from "../src/engine/client.ts";
import type { ConsoleLine } from "./harness.ts";
import { endWorkers, extraWheels, live, nodeWorker, runOn, sleep, startWorker, wheel } from "./harness.ts";

after(endWorkers);

// how long the engine is idle before the part's next step: worker.ts's own
const IDLE_MS = Number(
  readFileSync(new URL("../src/engine/worker.ts", import.meta.url), "utf8").match(/const IDLE_MS = (\d+);/)![1],
);
const snapshotDir = fileURLToPath(new URL("../public/snapshot/", import.meta.url));
const manifest = readManifest();
const current = inputs();
const part = manifest?.files.graphics;
const skip =
  !manifest || staleness(manifest, current) !== null
    ? "no current snapshot: npm run snapshot"
    : !part && "the snapshot has no graphics part (SNAPSHOT_NO_MPL)";
const STAMP = "lazy-graphics.test.ts";
const startFiles = manifest && {
  built: manifest.built,
  buildId: buildId(STAMP, manifest),
  snapshot: manifest.files,
  files: [],
  size: 0,
  compressed: 0,
  download: 0,
};
const now = () => performance.timeOrigin + performance.now(); // the clock of ConsoleLine's `at`

type Line = ConsoleLine & { from: "page" | "worker" };

/** The page's and the worker's `[dofile]` lines, in the order they came. The page's are taken from this thread's console
 *  for the test's length. */
function dofileLines(t: TestContext): Line[] {
  const lines: Line[] = [];
  for (const level of ["info", "warn"] as const)
    t.mock.method(console, level, (...args: unknown[]) => {
      const text = format(...args);
      if (text.includes("[dofile]")) lines.push({ level, text, at: now(), from: "page" });
    });
  return lines;
}

const shown = (lines: Line[]) => lines.map((l) => `${l.from}: ${l.text}`).join("\n");
const matching = (lines: Line[], pattern: RegExp) => lines.filter((l) => pattern.test(l.text));

/** Waits until `check()`; fails after `ms` with what `said()` gives. */
async function until(check: () => boolean, said: () => string, ms = 60_000) {
  const end = now() + ms;
  while (!check()) {
    if (now() > end) assert.fail(`not within ${ms} ms:\n${said()}`);
    await sleep(50);
  }
}

/** Waits for the `count`th line that matches, and returns it. */
async function line(lines: Line[], pattern: RegExp, count = 1): Promise<Line> {
  await until(
    () => matching(lines, pattern).length >= count,
    () => `${count} of ${pattern}:\n${shown(lines)}`,
  );
  return matching(lines, pattern)[count - 1];
}

/** A transport whose workers send their `[dofile]` lines to `lines`. `fetch`: the page's; with it the snapshot is
 *  served (served()). */
function client(snapshot: string, lines: Line[], fetch?: typeof globalThis.fetch) {
  const served = fetch && { url: snapshot, dir: pathToFileURL(snapshotDir).href };
  const onConsole = (l: ConsoleLine) => {
    if (l.text.includes("[dofile]")) lines.push({ ...l, from: "worker" });
  };
  return new EngineClient({
    createWorker: () => nodeWorker({ onConsole, served }),
    wheel,
    extraWheels,
    buildId: buildId(STAMP, current),
    startFiles: startFiles!,
    snapshot,
    ...(fetch && { fetch }),
  });
}

/** The snapshot's folder over HTTP, so that the page fetches the part with its `fetch` (a `file:` part is read from
 *  disk). @returns its URL */
async function served(t: TestContext): Promise<string> {
  const names = readdirSync(snapshotDir).filter((f) => f !== "manifest.json");
  const server = createServer((req, res) => {
    const name = new URL(req.url!, "http://localhost").pathname.slice(1);
    if (!names.includes(name)) res.writeHead(404).end();
    else createReadStream(join(snapshotDir, name)).pipe(res.writeHead(200));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

/** The page's `fetch`, which notes the cache mode of each fetch of the part (`modes`), can hold the next one until
 *  released (`hold`), and can answer the next one with a damaged copy of the same size (`damage`). */
function partFetch() {
  const modes: (RequestCache | undefined)[] = [];
  let held = Promise.resolve();
  let isDamagedNext = false;
  const good = readFileSync(join(snapshotDir, part!.name));
  const middle = good.length / 2;
  const damaged = Uint8Array.from(good, (b, i) => (Math.abs(i - middle) < 32_768 ? b ^ 0xff : b));

  // Node's fetch has no HTTP cache: the mode is only noted
  async function fetch(input: RequestInfo | URL, { cache, ...init }: RequestInit = {}): Promise<Response> {
    if (!String(input).endsWith(`/${part!.name}`)) return globalThis.fetch(input, init);
    modes.push(cache);
    await held;
    if (!isDamagedNext) return globalThis.fetch(input, init);
    isDamagedNext = false;
    return new Response(damaged);
  }

  return {
    fetch,
    modes,
    hold() {
      let release = () => {};
      held = new Promise((ok) => {
        release = ok;
      });
      return release;
    },
    damage() {
      isDamagedNext = true;
    },
  };
}

const GRAPH = "clear\nset obs 10\ngen x = _n\nscatter x x";

test("a graph at started waits for the part and writes it in its run, then it is warmed while idle; a restarted worker gets the landed part with no fetch and writes it while idle, with no run after its start, and no sooner than IDLE_MS after the last run", {
  timeout: 240_000,
  skip,
}, async (t) => {
  const lines = dofileLines(t);
  // the snapshot's files without manifest.json, as the page has them (engine.test.ts)
  const bare = mkdtempSync(join(tmpdir(), "dofile-lazy-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  for (const f of readdirSync(snapshotDir)) if (f !== "manifest.json") symlinkSync(join(snapshotDir, f), join(bare, f));
  const eng = client(`${pathToFileURL(bare).href}/`, lines);
  await startWorker(eng, await eng.build());

  // the page fetches the part once the worker has started: this graph is there first
  const graph = await runOn(eng, GRAPH);
  await line(lines, /warmed/);
  const first = lines.length;

  assert.equal(graph.rc, 0, graph.log);
  assert.equal(graph.images.length, 1);
  assert.match(
    shown(lines),
    /page: .*landed \(network\)[\s\S]*worker: .*written in a run[\s\S]*worker: .*in the run, after the write[\s\S]*worker: .*warmed/,
  );
  assert.equal(matching(lines, /written while idle/).length, 0, shown(lines));

  // restarted, and no run: the start alone begins the part's work
  eng.end(live(eng), { kind: "reset", reset: "user", reason: "session reset: test." });
  await startWorker(eng, await eng.build());
  await line(lines, /written while idle/);
  await line(lines, /warmed/, 2);
  const second = lines.length;

  eng.end(live(eng), { kind: "reset", reset: "user", reason: "session reset: test." });
  await startWorker(eng, await eng.build());
  // runs IDLE_MS / 5 apart for 1.5 s (room for a slow machine): no step of the part's comes between them (the browser's
  // decoder may run)
  let lastSent = 0;
  let lastAnswered = 0;
  for (const end = now() + 1500; now() < end; await sleep(IDLE_MS / 5)) {
    lastSent = now();
    const r = await runOn(eng, "display 1");
    lastAnswered = now();
    assert.equal(r.rc, 0, r.log);
  }
  const written = await line(lines, /written while idle/, 2);
  await line(lines, /warmed/, 3);
  const restarted = lines.slice(first);
  const third = lines.slice(second);

  assert.equal(matching(lines, /landed/).length, 1, `fetched once:\n${shown(lines)}`);
  assert.match(shown(restarted), /(worker: .*written while idle[\s\S]*worker: .*warmed[\s\S]*){2}/);
  assert.equal(matching(restarted, /written in a run/).length, 0, shown(restarted));
  assert.ok(written.at > lastAnswered, `written after the last run's answer:\n${shown(third)}`);
  // the written line's own work: the write, and a brotli-wasm unpack in idle steps (the browser's decoder unpacks off
  // the thread from the start)
  const [, decoder, unpackS, writeS] = written.text.match(/unpack \((\w+)\) ([\d.]+)s.*write \d+ files ([\d.]+)s/)!;
  const firstStep = written.at - 1000 * (Number(writeS) + (decoder === "wasm" ? Number(unpackS) : 0));
  assert.ok(
    firstStep - lastSent > IDLE_MS - 20, // 20 ms: the line's seconds are rounded to 10 ms
    `the first step ${(firstStep - lastSent).toFixed(0)} ms after the last run was sent:\n${shown(third)}`,
  );
  eng.worker!.terminate();
});

test("a Break while a graph waits for a part held on its way is rc 1 within seconds, with the data kept; once the part lands, a graph draws, and the part was fetched once", {
  timeout: 240_000,
  skip,
}, async (t) => {
  const lines = dofileLines(t);
  const net = partFetch();
  const release = net.hold();
  const eng = client(await served(t), lines, net.fetch);
  await startWorker(eng, await eng.build());

  let log = "";
  const running = runOn(eng, GRAPH, {
    onLog(text) {
      log += text;
    },
  });
  await until(
    () => log.includes("(waiting for the graphics files to download)"),
    () => log,
  );
  eng.interrupt(live(eng));
  const pressed = now();
  const broken = await running;
  const breakMs = now() - pressed;
  const kept = await runOn(eng, "summarize x");
  release();
  await line(lines, /landed \(network\)/);
  const drawn = await runOn(eng, "scatter x x");

  assert.equal(broken.rc, 1, broken.log);
  assert.ok(breakMs < 5000, `the Break took ${breakMs.toFixed(0)} ms`); // the graph waits in slices of 100 ms
  assert.equal(broken.images.length, 0);
  assert.equal(kept.nobs, 10, kept.log);
  assert.equal(drawn.rc, 0, drawn.log);
  assert.equal(drawn.images.length, 1);
  assert.deepEqual(net.modes, ["no-cache"]);
  eng.worker!.terminate();
});

test("a damaged copy: the graph that finds it says so (r(199)), the page fetches the part again past the HTTP cache, and the next graph draws", {
  timeout: 240_000,
  skip,
}, async (t) => {
  const lines = dofileLines(t);
  const net = partFetch();
  net.damage();
  const eng = client(await served(t), lines, net.fetch);
  await startWorker(eng, await eng.build());

  const found = await runOn(eng, GRAPH);
  await line(lines, /landed \(network\)/, 2);
  const drawn = await runOn(eng, "scatter x x");

  assert.equal(found.rc, 199, found.log);
  assert.match(found.log, /graphs are not available: the graphics files arrived damaged/);
  assert.deepEqual(net.modes, ["no-cache", "reload"]);
  assert.equal(drawn.rc, 0, drawn.log);
  assert.equal(drawn.images.length, 1);
  eng.worker!.terminate();
});
