// The transport (src/engine/client.ts) alone, without an engine and without the state machine: the counted download into
// the Cache and the build's list, with a stand-in fetch and Cache (Node has no Cache API; the real ones are checked in the
// browsers, e2e/step2.spec.ts), and the worker's messages, with a stand-in worker. SPEC.md section 7, test 10, and section
// 6 (the {id, log} chunks). The transport decides nothing: when a worker starts and ends is the machine's
// (test/machine.test.ts), and the controller on a stand-in transport is test/app.test.ts. The workers here are numbered
// 1, 2, 3 by the test (harness.ts, startWorker).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineClient } from "../src/engine/client.ts";
import { fakeWorker, live, runOn, sleep, startWorker, starts } from "./harness.ts";
import type { FakePort, Message, Post } from "./harness.ts";
import { buildId } from "../scripts/build-id.ts";
import type { Answer } from "../src/engine/machine.ts";
import type { StartFiles } from "../src/engine/types.ts";
import type { FileStore } from "../src/engine/store.ts";

type ClientOptions = ConstructorParameters<typeof EngineClient>[0];
/** What the stand-in fetch is called with. */
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// ---- download ----

function fakeCaches({ refuse = false } = {}) {
  const all = new Map<string, Map<string, Response>>();   // cache name -> Map(url -> Response)
  return {
    all,
    async keys() { return [...all.keys()]; },
    async has(name: string) { return all.has(name); },
    async delete(name: string) { return all.delete(name); },
    async open(name: string) {
      if (!all.has(name)) all.set(name, new Map());
      const entries = all.get(name)!;
      return {
        async match(url: string) { return entries.get(url)?.clone(); },
        async put(url: string, response: Response) {
          if (refuse) throw new DOMException("the quota has been exceeded", "QuotaExceededError");
          entries.set(url, response);
        },
      };
    },
  };
}

const BASE = "https://dofile.test/app/";
const content = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 7 + seed) % 256);
const FILES: Record<string, [Uint8Array<ArrayBuffer>, string]> = {   // path -> [bytes, type]
  "snapshot/heap.bin": [content(10_000, 1), "application/octet-stream"],
  "pyodide/pyodide.asm.wasm": [content(8_000, 2), "application/octet-stream"],   // a host that does not know the type
  "snapshot/dso.json": [content(600, 3), "application/json"],
};
const LIST = { built: 777, size: 19_100, compressed: 13_300,
  snapshot: { snapshot: { name: "heap.bin", raw: 40_000, size: 10_000 }, bundle: { name: "bundle.bin", raw: 900, size: 300 } }, files: [
  { path: "index.html", size: 500, compressed: 200, download: false },   // came with the page
  { path: "snapshot/heap.bin", size: 10_000, compressed: 10_000, download: true },
  { path: "pyodide/pyodide.asm.wasm", size: 8_000, compressed: 3_000, download: true },
  { path: "snapshot/dso.json", size: 600, compressed: 100, download: true },
] };

// A fetch that sends each file in 1,000-byte pieces. `hold`: a path whose answer stops after its first piece until the
// request is aborted. `missing`: a path that is a 404. `offline`: a path whose fetch fails as with no network. `short`: a
// path that arrives 100 bytes short, with status 200. `calls`: the URLs asked for; `modes`: the cache mode of each.
function fakeFetch({ hold, missing, offline, short }: { hold?: string, missing?: string, offline?: string, short?: string } = {}) {
  const calls: string[] = [], modes: (RequestCache | undefined)[] = [];
  const fetch = async (url: string, { signal, cache }: RequestInit = {}) => {
    calls.push(url);
    modes.push(cache);
    signal?.throwIfAborted();
    const path = url.slice(BASE.length);
    if (path === "start-files.json") return Response.json(LIST);
    if (path === offline) throw new TypeError("fetch failed");
    if (path === missing || !FILES[path]) return new Response("no", { status: 404 });
    const [whole, type] = FILES[path], data = path === short ? whole.subarray(0, whole.length - 100) : whole;
    let at = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (at >= data.length) return controller.close();
        if (path === hold && at > 0) {
          return new Promise(() => { signal?.addEventListener("abort", () => controller.error(signal!.reason)); });
        }
        await sleep(1);
        controller.enqueue(data.subarray(at, at += 1000));
      },
    });
    signal?.addEventListener("abort", () => { try { body.cancel(signal!.reason).catch(() => {}); } catch { /* locked: the reader gets the error */ } });
    return new Response(body, { headers: { "Content-Type": type } });
  };
  return { fetch, calls, modes };
}

const BUILD = { built: LIST.built, files: LIST.snapshot };   // what mount needs of the list
const noWorker = () => { throw new Error("download() must not start a worker"); };
const client = (fetch: Fetch, caches: object | null | undefined, more: Partial<ClientOptions> = {}) => new EngineClient({ createWorker: noWorker,
  wheel: "dofile.whl", snapshot: `${BASE}snapshot/`, startFiles: { base: `${BASE}start-files.json`, ...LIST } as StartFiles & { base: string },
  fetch: fetch as typeof globalThis.fetch, caches: caches as CacheStorage | null | undefined, ...more });
const cached = async (caches: ReturnType<typeof fakeCaches>, name = "dofile-snapshot-777") => [...(caches.all.get(name) ?? new Map()).keys()].map(u => u.slice(BASE.length)).sort();

test("download: every start file goes into the Cache, the counts rise to the total, before any worker exists", async () => {
  const caches = fakeCaches(), { fetch, calls, modes } = fakeFetch();
  await (await caches.open("dofile-snapshot-1")).put(`${BASE}snapshot/heap.bin`, new Response("an older build"));
  const seen: { received: number, total: number }[] = [];
  const done = await client(fetch, caches).download({ onProgress: p => seen.push(p) });
  assert.deepEqual(done, { cached: true, received: 13_300, total: 13_300, build: BUILD }, "with what mount needs of the list it has just checked");
  assert.deepEqual(seen[0], { received: 200, total: 13_300 }, "the page's own files are here already");
  assert.deepEqual(seen.at(-1), { received: 13_300, total: 13_300 });
  assert.ok(seen.length > 10, "progress while the bytes arrive, not once per file");
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].received > seen[i - 1].received && seen[i].total === 13_300);
  assert.deepEqual(calls.map(u => u.slice(BASE.length)).sort(), ["pyodide/pyodide.asm.wasm", "snapshot/dso.json", "snapshot/heap.bin"]);
  assert.deepEqual([...caches.all.keys()], ["dofile-snapshot-777"], "the older build's cache is dropped");
  const cache = await caches.open("dofile-snapshot-777");
  for (const [path, [data, type]] of Object.entries(FILES)) {
    const kept = await cache.match(BASE + path);
    assert.deepEqual(new Uint8Array(await kept!.arrayBuffer()), data, path);
    // a .wasm is compiled from the cached answer only with this type, whatever the host sent
    assert.equal(kept!.headers.get("Content-Type"), path.endsWith(".wasm") ? "application/wasm" : type);
  }
  assert.deepEqual(modes, ["no-cache", "no-cache", "no-cache"], "each file is asked for fresh, not taken from the HTTP cache of an older build");
});

test("download: the list can be a URL (start-files.json), fetched fresh, and its paths are relative to it", async () => {
  const caches = fakeCaches(), { fetch, calls } = fakeFetch();
  const eng = client(fetch, caches, { startFiles: `${BASE}start-files.json` });
  assert.equal((await eng.download()).cached, true);
  assert.equal(calls[0], `${BASE}start-files.json`);
  assert.deepEqual(await cached(caches), ["pyodide/pyodide.asm.wasm", "snapshot/dso.json", "snapshot/heap.bin"]);
});

test("download: abort stops the fetches and rejects; a second try keeps the finished files and fetches the rest", async () => {
  const caches = fakeCaches(), first = fakeFetch({ hold: "snapshot/heap.bin" });
  const eng = client(first.fetch, caches), stop = new AbortController(), seen: number[] = [];
  const downloading = eng.download({ signal: stop.signal, onProgress: p => { seen.push(p.received); } });
  while ((await cached(caches)).length < 2) await sleep(5);   // the two small files are in; the big one waits
  stop.abort();
  await assert.rejects(downloading, { name: "AbortError" });
  assert.deepEqual(await cached(caches), ["pyodide/pyodide.asm.wasm", "snapshot/dso.json"], "finished files are kept, the unfinished one is not");
  assert.equal(seen.at(-1), 200 + 3_000 + 100 + 1_000, "it had counted the big file's first piece");
  assert.equal(eng.worker, null, "no worker: the page goes back to having no engine");

  const second = fakeFetch(), again: number[] = [];
  eng.fetch = second.fetch as typeof globalThis.fetch;
  const done = await eng.download({ onProgress: p => again.push(p.received) });
  assert.deepEqual(second.calls, [`${BASE}snapshot/heap.bin`], "only the unfinished file is fetched, from its start");
  assert.equal(again[0], 200);
  assert.ok(again.includes(3_300), "the kept files count at once");
  assert.equal(again.at(-1), 13_300);
  assert.equal(done.cached, true);

  // already aborted: nothing is fetched
  const third = fakeFetch(), aborted = new AbortController();
  aborted.abort();
  caches.all.clear();
  eng.fetch = third.fetch as typeof globalThis.fetch;
  await assert.rejects(eng.download({ signal: aborted.signal }), { name: "AbortError" });
  assert.deepEqual(await cached(caches), []);
});

test("download: a failed fetch rejects (kind failed, reason download) and stops the others", async () => {
  const caches = fakeCaches(), { fetch } = fakeFetch({ missing: "pyodide/pyodide.asm.wasm", hold: "snapshot/heap.bin" });
  await assert.rejects(client(fetch, caches).download(), { kind: "failed", reason: "download", message: /pyodide\.asm\.wasm: 404/ });
  assert.ok(!(await cached(caches)).includes("snapshot/heap.bin"));
  // no network
  const offline = fakeFetch({ offline: "snapshot/dso.json", hold: "snapshot/heap.bin" });
  await assert.rejects(client(offline.fetch, fakeCaches()).download(), { kind: "failed", reason: "download", message: /fetch failed/ });
});

test("download: a file that is not the size the build's list says is refused and not cached", async () => {
  // a short answer with status 200 (a cut connection, an error page, a file of another build)
  const caches = fakeCaches(), { fetch } = fakeFetch({ short: "snapshot/dso.json" });
  await assert.rejects(client(fetch, caches).download(), { kind: "failed", reason: "download", message: /dso\.json: 500 bytes arrived, the build's list says 600/ });
  assert.ok(!(await cached(caches)).includes("snapshot/dso.json"), "the wrong bytes are not kept");
  // the next try, with the right file, finishes
  const good = fakeFetch(), eng = client(good.fetch, caches);
  assert.equal((await eng.download()).cached, true);
  assert.deepEqual(await cached(caches), ["pyodide/pyodide.asm.wasm", "snapshot/dso.json", "snapshot/heap.bin"]);
});

test("cached(): true only when every download file of the list's build is in its Cache; it writes nothing", async () => {
  const caches = fakeCaches(), { fetch } = fakeFetch();
  assert.equal(await client(fetch, caches).cached(), false, "an empty Cache Storage");
  assert.deepEqual([...caches.all.keys()], [], "no empty cache was made");
  // another build's complete cache does not count, and is not deleted
  const other = await caches.open("dofile-snapshot-1");
  for (const path of Object.keys(FILES)) await other.put(BASE + path, new Response("x"));
  assert.equal(await client(fetch, caches).cached(), false, "another build's cache");
  assert.deepEqual([...caches.all.keys()], ["dofile-snapshot-1"]);
  // partly filled (a stopped download): false; complete: true
  const mine = await caches.open("dofile-snapshot-777");
  await mine.put(`${BASE}snapshot/heap.bin`, new Response("x"));
  assert.equal(await client(fetch, caches).cached(), false, "a partial cache");
  await client(fetch, caches).download();
  assert.equal(await client(fetch, caches).cached(), true, "a complete cache");
  // the list as a URL, fetched; when it cannot be fetched (offline): false
  assert.equal(await client(fetch, caches, { startFiles: `${BASE}start-files.json` }).cached(), true);
  const offline = async () => { throw new TypeError("fetch failed"); };
  assert.equal(await client(offline, caches, { startFiles: `${BASE}start-files.json` }).cached(), false, "offline");
  // no Cache API, or no snapshot start (?snapshot=0)
  assert.equal(await client(fetch, null).cached(), false, "no Cache API");
  assert.equal(await client(fetch, caches, { snapshot: undefined }).cached(), false, "no snapshot start");
});

test("forgetDownload(): every dofile-snapshot-* Cache is deleted, nothing else; it never rejects", async () => {
  const caches = fakeCaches(), { fetch } = fakeFetch();
  await client(fetch, caches).download();
  await caches.open("dofile-snapshot-1");
  await caches.open("someone-else");
  await client(fetch, caches).forgetDownload();
  assert.deepEqual([...caches.all.keys()], ["someone-else"]);
  assert.equal(await client(fetch, caches).cached(), false);
  await client(fetch, null).forgetDownload();   // no Cache API: nothing to do
  const broken = { ...caches, keys: async () => { throw new DOMException("damaged", "UnknownError"); } };
  const warn = console.warn;
  console.warn = () => {};
  try { await client(fetch, broken).forgetDownload(); } finally { console.warn = warn; }
});

test("download: a list from another build than the page says so before anything is fetched", async () => {
  const caches = fakeCaches(), { fetch, calls } = fakeFetch();
  const eng = client(fetch, caches, { buildId: "the page's build", startFiles: { base: `${BASE}start-files.json`, ...LIST, buildId: "a newer build" } });
  await assert.rejects(eng.download(), { kind: "updated", message: /^dofile was updated: reload the page \(.*npm run snapshot/ });
  assert.deepEqual(calls, []);
  assert.deepEqual(await cached(caches), []);
  // the same build: fine
  const same = client(fetch, caches, { buildId: "w", startFiles: { base: `${BASE}start-files.json`, ...LIST, buildId: "w" } });
  assert.equal((await same.download()).cached, true);
});

// The id is scripts/build-id.ts's: the page's from the stamp and the files it is built from, the list's from the stamp and
// the snapshot's record (vite.config.ts). Here both come from the real function.
test("checkBuild: a list of another stamp, extra wheel, Pyodide version or dofile wheel is \"updated\"; the same stamp and inputs pass", () => {
  const inputs: { wheelHash: string, extraWheels: Record<string, string>, pyodide: string } = { wheelHash: "a".repeat(64), extraWheels: { "pyreadstat.whl": "b".repeat(64), "other.whl": "d".repeat(64) }, pyodide: "314.0.7" };
  const page = client(fakeFetch().fetch, fakeCaches(), { buildId: buildId("stamp 1", inputs) });
  const list = (stamp: string, record: typeof inputs) => ({ ...LIST, buildId: buildId(stamp, record) }) as unknown as StartFiles;
  // equal inputs, the extra wheels in another order (as a manifest read back may have them): the same id
  page.checkBuild(list("stamp 1", { ...inputs, extraWheels: { "other.whl": "d".repeat(64), "pyreadstat.whl": "b".repeat(64) } }));
  const others: [string, StartFiles][] = [
    ["another stamp (another build run, or a restarted dev server)", list("stamp 2", inputs)],
    ["another extra wheel", list("stamp 1", { ...inputs, extraWheels: { ...inputs.extraWheels, "pyreadstat.whl": "c".repeat(64) } })],
    ["one extra wheel fewer", list("stamp 1", { ...inputs, extraWheels: { "pyreadstat.whl": "b".repeat(64) } })],
    ["another Pyodide version", list("stamp 1", { ...inputs, pyodide: "314.0.8" })],
    ["another dofile wheel", list("stamp 1", { ...inputs, wheelHash: "e".repeat(64) })],
  ];
  for (const [what, other] of others) {
    assert.throws(() => page.checkBuild(other), { kind: "updated", message: /^dofile was updated: reload the page \(the site's start files are of the build [0-9a-f]{12}, this page of [0-9a-f]{12}; in development: `npm run snapshot`.*restart the dev server\)$/ }, what);
  }
});

test("download: with nowhere to keep the files it resolves with the reason; a build with no snapshot rejects", async () => {
  const { fetch, calls } = fakeFetch();
  assert.deepEqual(await client(fetch, undefined).download(), { cached: false, why: "there is no Cache API here (not a secure context?)", build: BUILD });
  const refused = await client(fetch, fakeCaches({ refuse: true })).download();
  assert.equal(refused.cached, false);
  assert.match((refused as { why: string }).why, /QuotaExceededError/);
  assert.deepEqual(refused.build, BUILD, "the list was checked all the same: the start that follows needs no second fetch");
  calls.length = 0;
  assert.deepEqual(await client(fetch, fakeCaches(), { snapshot: undefined }).download(), { cached: false, why: "the normal start loads from the CDN", build: null },
    "the normal start (?snapshot=0) has nothing to download here, and no list");
  assert.deepEqual(calls, []);
  await assert.rejects(client(fetch, fakeCaches(), { startFiles: { ...LIST, built: null } as unknown as StartFiles }).download(), /no snapshot in this build: run `npm run snapshot`/);
});

// ---- messages ----

/** What a worker's start said, for a test that reads it. */
type Said = Answer<"start-worker">[];

test("a {id, log} message goes to the run's onLog and never settles the call; the result does", async () => {
  let finish!: () => void;
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: () => fakeWorker((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "run") {
      post({ id: m.id, log: ". display 1\n" });
      post({ id: m.id, log: "" });
      post({ id: m.id, log: "1\n" });
      finish = () => { post({ id: m.id, log: "late\n" }); post({ id: m.id, result: { rc: 0, log: ". display 1\n1\nlate\n" } }); };
      if (m.args.code === "quick") finish();
    } else if (m.op === "describe") {
      post({ id: m.id, log: "not a run" });   // a chunk for a call with no onLog is dropped, and settles nothing
      setTimeout(() => post({ id: m.id, result: { nobs: 3 } }), 5);
    }
  }) });
  await startWorker(eng);
  assert.deepEqual([eng.about, eng.startup, eng.storeError], [{ dofile: "test" }, { mode: "normal" }, null], "the facts of the start");
  const chunks: string[] = [];
  let settled = false;
  const running = runOn(eng, "display 1", { onLog: c => chunks.push(c), fresh_locals: true, plot_theme: "dark" });
  running.then(() => { settled = true; });
  await sleep(20);
  assert.deepEqual(chunks, [". display 1\n", "", "1\n"]);
  assert.equal(settled, false, "three log messages with the call's id, and the call is still pending");
  finish();
  assert.deepEqual(await running, { rc: 0, log: ". display 1\n1\nlate\n" });
  assert.deepEqual(chunks, [". display 1\n", "", "1\n", "late\n"]);
  assert.deepEqual(await eng.query("describe"), { nobs: 3 });
  assert.deepEqual(await runOn(eng, "quick"), { rc: 0, log: ". display 1\n1\nlate\n" });
});

test("run sends its options; what an ended worker still says settles no call of the next worker, and its stage goes to its own reply", async () => {
  const sent: Message[] = [], workers: FakePort[] = [];
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: () => {
    const w = fakeWorker((m, post) => { sent.push(m); starts(m, post); });
    workers.push(w);
    return w;
  } });
  const first: Said = [], second: Said = [];
  await startWorker(eng, null, first);
  const running = runOn(eng, "while 1 {\n}", { fresh_locals: true, plot_theme: "dark" });
  await sleep(10);
  assert.deepEqual(sent.at(-1)!.args, { code: "while 1 {\n}", fresh_locals: true, plot_theme: "dark" });
  eng.end(1, { kind: "reset", reset: "break", reason: "the code did not stop" });
  await assert.rejects(running, { kind: "reset", reset: "break", message: "the code did not stop" });
  assert.equal(workers[0].terminated, true);
  await startWorker(eng, null, second);
  assert.equal(workers.length, 2);
  // the new worker's run has the next id; the old worker answers it, and names a stage
  const next = runOn(eng, "display 1");
  let settled = false;
  next.then(() => { settled = true; }, () => { settled = true; });
  workers[0].onmessage!({ data: { id: eng.nextId, result: "from the old worker" } });
  workers[0].onmessage!({ data: { stage: "engine" } });
  await sleep(10);
  assert.equal(settled, false, "the old worker's answer is not taken for the new worker's call");
  assert.deepEqual(first.at(-1), { type: "stage", stage: "engine" }, "said through the first worker's reply: its ticket is out of date, and the machine drops it");
  assert.deepEqual(second, [{ type: "started" }]);
  workers[1].onmessage!({ data: { id: eng.nextId, result: { rc: 0 } } });
  assert.deepEqual(await next, { rc: 0 });
});

// ---- starts that fail, kinds of error ----

const fakeStore = () => ({ sync: undefined as FileStore["sync"] | undefined, attach(sync: FileStore["sync"]) { this.sync = sync; } });
// a client whose workers answer as `script` says; `workers` collects them
function scripted(script: (message: Message, post: Post, port: FakePort, index: number) => unknown, more: Partial<ClientOptions> = {}) {
  const workers: FakePort[] = [];
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: () => {
    const w = fakeWorker((m, post, port) => script(m, post, port, workers.indexOf(port)));
    workers.push(w);
    return w;
  }, ...more });
  return { eng, workers };
}

test("a start that fails at mount or boot says start-failed with the reason; the worker is ended by end(), which detaches the store and fails the calls made meanwhile", async () => {
  for (const [op, name, message, reason] of [
    ["mount", "DownloadError", "https://dofile.test/pyodide/pyodide.asm.wasm: 503", "download"],
    ["mount", "RangeError", "WebAssembly.Memory(): could not allocate memory", "memory"],
    ["boot", "PythonError", "MemoryError", "memory"],
    ["boot", "PythonError", "ModuleNotFoundError: No module named 'dofile'", "unknown"],
    ["mount", "SomeOtherError", "the snapshot was built from a different build of dofile.whl than this page has", "unknown"]]) {
    const store = fakeStore();
    const { eng, workers } = scripted((m, post) => {
      if (m.op === op) post({ id: m.id, error: message, name });
      else starts(m, post);
    }, { store });
    const starting = startWorker(eng);
    const files = eng.query("files");   // a call made while it starts: never answered by this worker
    await assert.rejects(starting, { type: "start-failed", reason, detail: message });
    assert.equal(workers.length, 1, "no second try by itself");
    assert.deepEqual([workers[0].terminated, eng.worker, typeof store.sync], [false, workers[0], "function"], "the transport ends nothing by itself");
    eng.end(1, { kind: "failed", reason: message });   // the machine's FAIL
    await assert.rejects(files, { kind: "failed", message });
    assert.equal(workers[0].terminated, true, "the worker that could not start is ended");
    assert.equal(eng.worker, null);
    assert.equal(store.sync, null, "the store no longer tells it of the page's changes");
    await assert.rejects(eng.query("files"), { kind: "no-engine" });
  }
});

test("no WebAssembly: start-failed with reason no-wasm, and no worker is made", async () => {
  const { eng, workers } = scripted(starts, { wasm: null });
  await assert.rejects(startWorker(eng), { type: "start-failed", reason: "no-wasm" });
  assert.equal(workers.length, 0);
  assert.equal(eng.worker, null);
  eng.end(1, { kind: "failed", reason: "no WebAssembly" });   // the machine's FAIL ends a worker that never was: nothing to do
});

test("start() with a worker still live throws; end() of another worker than the live one throws; after end() the next start works", async () => {
  const store = fakeStore();
  const { eng, workers } = scripted((m, post, _port, index) => { if (index === 1) starts(m, post); }, { store });   // the first worker never answers
  const said: Said = [];
  eng.start(1, null, a => said.push(a));
  await sleep(5);
  assert.throws(() => eng.start(2, null, a => said.push(a)), /start\(2\): worker 1 is still live/);
  assert.equal(workers.length, 1, "no second worker was made");
  assert.throws(() => eng.end(2, { kind: "stopped", reason: "x" }), /end\(2\): the live worker is 1/);
  assert.equal(workers[0].terminated, false);
  eng.end(1, { kind: "stopped", reason: "another tab took over" });
  eng.end(1, { kind: "stopped", reason: "again" });   // no live worker: nothing to do
  assert.deepEqual(said, [], "a start that was ended says nothing");
  await new Promise<void>((ok, no) => eng.start(2, null, a => (a.type === "started" ? ok() : no(a))));
  assert.deepEqual(workers.map(w => w.terminated), [true, false]);
  assert.equal(typeof store.sync, "function", "the store tells the new worker");
});

test("error kinds: an op's error keeps the worker's name; end() fails the pending calls with the ending's kind, the run too", async () => {
  const { eng, workers } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "matrix") post({ id: m.id, error: "file system error ENOENT", name: "ErrnoError" });
  });
  await startWorker(eng);
  await assert.rejects(eng.query("matrix", { name: "e(b)" }), { kind: "op", name: "ErrnoError", message: "file system error ENOENT" });

  const endings = [
    [{ kind: "reset", reset: "user", reason: "session reset: reset by you." }, { kind: "reset", reset: "user", message: "session reset: reset by you." }],
    [{ kind: "reset", reset: "crash", reason: "session reset: the engine crashed." }, { kind: "reset", reset: "crash" }],
    [{ kind: "stopped", reason: "session reset: another tab took over." }, { kind: "stopped", message: "session reset: another tab took over." }],
    [{ kind: "failed-twice", reason: "the engine's worker failed twice" }, { kind: "failed-twice" }],
  ] as const;
  for (const [ending, error] of endings) {
    const running = runOn(eng, "while 1 {\n}"), waiting = eng.query("describe");
    eng.end(live(eng), ending);
    await assert.rejects(running, error, `${ending.kind}: the run`);   // the machine has cut the run already: its performer says nothing
    await assert.rejects(waiting, error, `${ending.kind}: a query`);
    assert.equal(eng.worker, null);
    await assert.rejects(runOn(eng, "display 1"), { kind: "no-engine" }, "run() with no live worker");
    await assert.rejects(eng.query("describe"), { kind: "no-engine" });
    await startWorker(eng);
  }
  assert.equal(workers.length, endings.length + 1, "one worker for each start, and none the transport made by itself");
  await assert.rejects(eng.run(live(eng) - 1, { code: "display 1" }, () => {}), { kind: "no-engine" }, "run() for a worker that is not the live one");
});

test("a worker's error is said as `crashed`, with the reason; the transport neither ends the worker nor makes another", async () => {
  let made = 0;
  const failing = () => { made++; const port = { onmessage: null, onerror: null as null | ((e: Error) => void), terminated: false, terminate() { port.terminated = true; }, postMessage() { setTimeout(() => port.onerror?.(new RangeError("Out of memory")), 5); } }; return port as unknown as Worker; };
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: failing });
  await assert.rejects(startWorker(eng), { type: "crashed", cause: "error", reason: "memory", detail: "Out of memory" });
  assert.equal(made, 1, "no restart: that is the machine's to say (RESET, then TWICE)");
  assert.notEqual(eng.worker, null, "and it is not ended until the machine says so");
  // a crash of a worker that is up, with another error
  const { eng: other, workers } = scripted(starts);
  const said: Said = [];
  await startWorker(other, null, said);
  workers[0].onerror!(new Error("the script stopped"));
  assert.deepEqual(said.at(-1), { type: "crashed", cause: "error", reason: "unknown", detail: "the script stopped" });
});

test("interrupt(n) puts SIGINT into the buffer the live worker was given at boot; another number, or no worker, does nothing", async () => {
  let buffer!: Int32Array;
  const { eng } = scripted((m, post) => { if (m.op === "boot") buffer = m.args.interruptBuffer; starts(m, post); });
  eng.interrupt(1);   // no worker yet
  await startWorker(eng);
  assert.equal(buffer[0], 0);
  eng.interrupt(2);
  assert.equal(buffer[0], 0, "not the live worker's number");
  eng.interrupt(1);
  assert.equal(Atomics.load(buffer, 0), 2, "SIGINT");
  eng.end(1, { kind: "stopped", reason: "x" });
  buffer[0] = 0;
  eng.interrupt(1);
  assert.equal(buffer[0], 0, "the worker was ended");
});

test("the store's sync posts `sync`, with nothing in it, to the live worker; a sync that fails or that end() cuts is not an error of the page's; a closed database is `crashed`, cause storage", async () => {
  const store = { sync: null as FileStore["sync"], onClosed: null as null | (() => void),
    attach(sync: FileStore["sync"], o: { onClosed?: null | (() => void) } = {}) { store.sync = sync; store.onClosed = o.onClosed ?? null; } };
  const syncs: Message[] = [];
  const { eng } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "sync") { syncs.push(m); if (syncs.length === 1) post({ id: m.id, error: "file system error ENOTDIR", name: "ErrnoError" }); }
  }, { store });
  const said: Said = [];
  await startWorker(eng, null, said);
  const warn = console.warn, warned: unknown[] = [];
  console.warn = (...a: unknown[]) => { warned.push(a.join(" ")); };
  try {
    store.sync!();   // the worker answers it with an error: said on the console, and nothing else happens
    await sleep(20);
    assert.deepEqual(syncs.map(m => [m.op, m.args]), [["sync", undefined]], "one op, with no arguments");
    assert.deepEqual(warned, ["[dofile] the engine's folder could not take a change to your files: file system error ENOTDIR"]);
    store.onClosed!();   // the browser closed the database under the page
    assert.deepEqual(said.at(-1), { type: "crashed", cause: "storage", reason: "unknown", detail: "the browser closed the file storage" });
    store.sync!();   // never answered: cut by the end
    await sleep(5);
    eng.end(1, { kind: "reset", reset: "crash", reason: "x" });
    await sleep(10);
    assert.equal(syncs.length, 2);
    assert.equal(warned.length, 1, "a sync cut by end() says nothing");
  } finally {
    console.warn = warn;
  }
  assert.deepEqual([store.sync, store.onClosed], [null, null], "detached: with no worker a closed database says nothing");
});

// ---- every failure has a kind ----

test("a run whose op fails in the worker rejects with kind op; the worker stays and the next run works", async () => {
  const { eng, workers } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "run") post(m.args.code === "bad" ? { id: m.id, error: "MemoryError", name: "PythonError" } : { id: m.id, result: { rc: 0, log: "ok" } });
  });
  await startWorker(eng);
  await assert.rejects(runOn(eng, "bad"), { kind: "op", name: "PythonError", message: "MemoryError" });   // the performer then says run-failed
  assert.equal(eng.worker, workers[0], "the worker is the same");
  assert.deepEqual(await runOn(eng, "good"), { rc: 0, log: "ok" });
});

test("download: no network for the list, an HTML page for the list, a Cache that breaks: each has a kind", async () => {
  const offline = client(async () => { throw new TypeError("Failed to fetch"); }, fakeCaches(), { startFiles: `${BASE}start-files.json` });
  await assert.rejects(offline.download(), { kind: "failed", reason: "download", message: /Failed to fetch/ });
  const html = client(async () => new Response("<!doctype html><title>dofile</title>", { headers: { "Content-Type": "text/html" } }), fakeCaches(),
    { startFiles: `${BASE}start-files.json` });
  await assert.rejects(html.download(), { kind: "failed", reason: "download" });
  const broken = { keys: async () => [], delete: async () => true, open: async () => { throw new Error("the cache is broken"); } };
  await assert.rejects(client(fakeFetch().fetch, broken).download(), { kind: "failed", reason: "unknown", message: "the cache is broken" });
});

test("download: an abort with a reason of the caller's own still rejects as an AbortError", async () => {
  for (const reason of ["the user stopped it", new Error("stop"), undefined]) {
    const caches = fakeCaches(), { fetch } = fakeFetch({ hold: "snapshot/heap.bin" }), stop = new AbortController();
    const downloading = client(fetch, caches).download({ signal: stop.signal });
    while ((await cached(caches)).length < 2) await sleep(5);
    reason === undefined ? stop.abort() : stop.abort(reason);
    await assert.rejects(downloading, (e: any) => e?.name === "AbortError" && !e.kind, String(reason));
    // aborted before it starts
    const early = new AbortController();
    early.abort(reason);
    await assert.rejects(client(fakeFetch().fetch, fakeCaches(), { startFiles: `${BASE}start-files.json` }).download({ signal: early.signal }),
      (e: any) => e?.name === "AbortError" && !e.kind, `early: ${reason}`);
  }
});

// ---- the snapshot start: the build's time (`built`) and its two big files from the list, in mount's arguments ----

// A fetch that answers only the list, with `buildId` (or fails as offline); `calls`: what was asked.
function listFetch({ buildId = "w", offline = false }: { buildId?: string, offline?: boolean } = {}) {
  const calls: [string, RequestCache | undefined][] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push([url, init.cache]);
    if (offline) throw new TypeError("Failed to fetch");
    return url === `${BASE}start-files.json` ? Response.json({ ...LIST, buildId }) : new Response("no", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const snapshotStart = (fetch: typeof globalThis.fetch, store = fakeStore()) => scripted((m, post) => { starts(m, post); },
  { snapshot: `${BASE}snapshot/`, startFiles: `${BASE}start-files.json`, buildId: "w", fetch, store, indexURL: "https://cdn.test/" });

test("build(): the list, fetched fresh, gives what mount needs; start() puts it in mount's arguments and fetches nothing, no manifest", async () => {
  const { fetch, calls } = listFetch(), sent: Message[] = [];
  const { eng, workers } = scripted((m, post) => { sent.push(m); starts(m, post); },
    { snapshot: `${BASE}snapshot/`, startFiles: `${BASE}start-files.json`, buildId: "w", fetch, indexURL: "https://cdn.test/", brotli: "wasm" });
  const build = await eng.build();
  assert.deepEqual(build, BUILD);
  assert.deepEqual(calls, [[`${BASE}start-files.json`, "no-cache"]], "the page fetches the list, fresh, and nothing else");
  assert.equal(workers.length, 0, "build() makes no worker");
  await startWorker(eng, build);
  assert.equal(workers.length, 1);
  assert.deepEqual(sent.find(m => m.op === "mount")!.args,
    { indexURL: "https://cdn.test/", brotli: "wasm", snapshot: `${BASE}snapshot/`, built: 777, files: LIST.snapshot });
  assert.equal(calls.length, 1, "start() fetches nothing: the list came in as `build`");
  // ?snapshot=0: no list, no snapshot arguments
  const other = listFetch();
  const normal = scripted((m, post) => { sent.push(m); starts(m, post); }, { fetch: other.fetch, indexURL: "https://cdn.test/" });
  assert.equal(await normal.eng.build(), null);
  assert.deepEqual(other.calls, [], "the normal start has no list");
  await startWorker(normal.eng, null);
  assert.deepEqual(sent.filter(m => m.op === "mount").at(-1)!.args, { indexURL: "https://cdn.test/", brotli: undefined });
});

test("build(): a list of another build rejects with kind updated; one that does not arrive with kind failed, reason download; a build with no snapshot, reason unknown", async () => {
  const { eng, workers } = snapshotStart(listFetch({ buildId: "a newer build" }).fetch);
  await assert.rejects(eng.build(), { kind: "updated", message: /^dofile was updated: reload the page/ });
  const offline = snapshotStart(listFetch({ offline: true }).fetch);
  await assert.rejects(offline.eng.build(), { kind: "failed", reason: "download" });
  const none = scripted(starts, { snapshot: `${BASE}snapshot/`, fetch: listFetch().fetch });   // a snapshot start with no list
  await assert.rejects(none.eng.build(), { kind: "failed", reason: "unknown", message: /no snapshot in this build/ });
  // a list of another build that also lacks the snapshot is "updated": the comparison comes first
  const both = scripted(starts, { snapshot: `${BASE}snapshot/`, buildId: "w", startFiles: { ...LIST, buildId: "newer", snapshot: undefined } as unknown as StartFiles });
  await assert.rejects(both.eng.build(), { kind: "updated" });
  assert.deepEqual([workers.length, offline.workers.length, none.workers.length, both.workers.length], [0, 0, 0, 0], "no worker is made");
});

test("start: a worker that cannot be made is start-failed, reason unknown; the store is not attached", async () => {
  const store = fakeStore();
  const eng = new EngineClient({ wheel: "dofile.whl", store, createWorker: () => { throw new SyntaxError("the worker script is broken"); } });
  await assert.rejects(startWorker(eng), { type: "start-failed", reason: "unknown", detail: "the worker script is broken" });
  assert.equal(eng.worker, null);
  assert.equal(store.sync, undefined);
});

// The live worker's record keeps what end() said (`ended`). It is for the moment a step's answer and end() come in the
// same tick: the step is settled already, so end() finds nothing pending to reject, and the start's next line runs after
// end() returned.
test("a start whose step is answered in the same tick as end(): nothing more is posted or said, the facts stay, and the store is not attached to the dead worker", async () => {
  for (const at of ["mount", "startup"] as const) {
    const store = fakeStore(), sent: Message[] = [], held: Message[] = [], said: Said = [];
    const { eng, workers } = scripted(m => { sent.push(m); if (m.op === at) held.push(m); else if (m.op === "mount") workers[0].onmessage!({ data: { id: m.id, result: undefined } });
      else if (m.op === "boot") workers[0].onmessage!({ data: { id: m.id, result: { dofile: "test" } } }); }, { store });
    eng.start(1, null, a => said.push(a));
    while (!held.length) await sleep(1);
    // the worker's answer and the machine's end-worker, one after the other with nothing between
    workers[0].onmessage!({ data: { id: held[0].id, result: at === "startup" ? { mode: "normal", storeError: "the files are not saved" } : undefined } });
    eng.end(1, { kind: "stopped", reason: "another tab took over" });
    await sleep(20);
    assert.deepEqual(said, [], `${at}: not started, and not start-failed`);
    assert.deepEqual(sent.map(m => m.op), at === "mount" ? ["mount"] : ["mount", "boot", "startup"], `${at}: nothing was posted to the worker after it was ended`);
    assert.deepEqual([eng.about, eng.startup, eng.storeError], [null, null, null], `${at}: the facts are a live worker's`);
    assert.equal(store.sync, null, `${at}: the store is not attached again`);
    assert.deepEqual([eng.worker, workers[0].terminated], [null, true]);
  }
});

test("a start that is ended while it waits for `startup` says nothing more, and does not write over the next start's facts", async () => {
  const { eng } = scripted((m, post, _port, index) => {
    if (m.op === "mount") post({ id: m.id, result: undefined });
    else if (m.op === "boot") post({ id: m.id, result: { dofile: `worker ${index}` } });
    else if (m.op === "startup" && index > 0) post({ id: m.id, result: { mode: "normal", worker: index } });   // the first never answers
  });
  const first: Said = [];
  eng.start(1, null, a => first.push(a));
  await sleep(20);   // mount and boot are answered; startup waits
  assert.equal(eng.about, null, "the facts are written when the start is complete");
  eng.end(1, { kind: "reset", reset: "user", reason: "reset by you" });
  await new Promise<void>((ok, no) => eng.start(2, null, a => (a.type === "started" ? ok() : no(a))));
  await sleep(10);
  assert.deepEqual(first, [], "the first start said nothing: not started, and not start-failed");
  assert.deepEqual(eng.startup, { mode: "normal", worker: 1 });
  assert.equal(eng.about!.dofile, "worker 1");
});
