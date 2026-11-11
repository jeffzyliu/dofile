// The engine client (src/engine/client.js) without an engine: the counted download into the Cache, with a stand-in fetch
// and Cache (Node has no Cache API; the real ones are checked in the browsers, e2e/step2.spec.ts), and the worker's
// messages, with a stand-in worker. SPEC.md section 7, test 10, and section 6 (the {id, log} chunks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineClient, RC_RESET } from "../src/engine/client.ts";
import { sleep } from "./harness.ts";
import { buildId } from "../scripts/build-id.ts";
import type { Op, ResetKind, StartFiles } from "../src/engine/types.ts";
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
  assert.deepEqual(done, { cached: true, received: 13_300, total: 13_300 });
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
  assert.deepEqual(await client(fetch, undefined).download(), { cached: false, why: "there is no Cache API here (not a secure context?)" });
  const refused = await client(fetch, fakeCaches({ refuse: true })).download();
  assert.equal(refused.cached, false);
  assert.match((refused as { why: string }).why, /QuotaExceededError/);
  calls.length = 0;
  assert.equal((await client(fetch, fakeCaches(), { snapshot: undefined }).download()).cached, false, "the normal start (?snapshot=0) has nothing to download here");
  assert.deepEqual(calls, []);
  await assert.rejects(client(fetch, fakeCaches(), { startFiles: { ...LIST, built: null } as unknown as StartFiles }).download(), /no snapshot in this build: run `npm run snapshot`/);
});

// ---- messages ----

// A worker that answers as `script(message, post)` says, a moment later, like a real one.
function fakeWorker(script: Script) {
  const port: FakePort = { onmessage: null, onerror: null, terminated: false, terminate() { port.terminated = true; },
    postMessage(message) { setTimeout(() => script(message, data => port.onmessage?.({ data }), port), 1); } };
  return port as FakePort & globalThis.Worker;   // what client.ts wants of a Worker
}
/** A message the client posts; `args` as the op has them. */
type Message = { id: number, op: Op, args: any };
type Post = (data: unknown) => void;
type Script = (message: Message, post: Post, port: FakePort) => unknown;
type FakePort = { onmessage: null | ((e: { data: unknown }) => void), onerror: null | ((e: unknown) => void), terminated: boolean,
  terminate(): void, postMessage(message: Message): void };
const starts = (message: Message, post: Post) => {
  if (message.op === "mount" || message.op === "startup") post({ id: message.id, result: undefined });
  else if (message.op === "boot") post({ id: message.id, result: { dofile: "test" } });
  else return false;
  return true;
};

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
  await eng.start();
  const chunks: string[] = [];
  let settled = false;
  const running = eng.run("display 1", { onLog: c => chunks.push(c), fresh_locals: true, plot_theme: "dark" });
  running.then(() => { settled = true; });
  await sleep(20);
  assert.deepEqual(chunks, [". display 1\n", "", "1\n"]);
  assert.equal(settled, false, "three log messages with the call's id, and the call is still pending");
  assert.equal(eng.running, running);
  finish();
  assert.deepEqual(await running, { rc: 0, log: ". display 1\n1\nlate\n" });
  assert.deepEqual(chunks, [". display 1\n", "", "1\n", "late\n"]);
  assert.equal(eng.running, null);
  assert.deepEqual(await eng.call("describe"), { nobs: 3 });
  assert.deepEqual(await eng.run("quick"), { rc: 0, log: ". display 1\n1\nlate\n" }, "a run with no onLog");
});

test("run sends its options; a page that is not cross-origin isolated resets at Break, at once", async () => {
  const sent: Message[] = [], workers: FakePort[] = [];
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: () => {
    const w = fakeWorker((m, post) => { sent.push(m); starts(m, post); });
    workers.push(w);
    return w;
  } });
  await eng.start();
  eng.interrupt = null;   // as in a page with no SharedArrayBuffer
  const running = eng.run("while 1 {\n}", { fresh_locals: true, plot_theme: "dark" });
  await sleep(10);
  assert.deepEqual(sent.at(-1)!.args, { code: "while 1 {\n}", fresh_locals: true, plot_theme: "dark" });
  eng.breakRun();
  const r = await running;
  assert.equal(r.rc, RC_RESET);
  assert.equal(r.kind, "break");
  assert.match(r.error!, /^session reset: Break reset the engine, because this page is not cross-origin isolated/);
  assert.equal(eng.resetAt, null, "no countdown: there was nothing to wait for");
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
  // what the old worker still says is not taken for the new one's
  workers[0].onmessage!({ data: { id: eng.nextId, result: "from the old worker" } });
  workers[0].onmessage!({ data: { status: "old status" } });
  await sleep(10);
  assert.equal(eng.about?.dofile, "test", "the new worker started");
});

// ---- starts that fail, kinds of error, one run at a time ----

const fakeStore = () => ({ post: undefined as FileStore["post"] | undefined, attach(post: FileStore["post"]) { this.post = post; } });
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

test("a start that fails at mount or boot ends the worker, detaches the store, and says what kind of failure it was", async () => {
  for (const [op, name, message, reason] of [
    ["mount", "DownloadError", "https://dofile.test/pyodide/pyodide.asm.wasm: 503", "download"],
    ["mount", "RangeError", "WebAssembly.Memory(): could not allocate memory", "memory"],
    ["boot", "PythonError", "MemoryError", "memory"],
    ["boot", "PythonError", "ModuleNotFoundError: No module named 'dofile'", "unknown"],
    ["mount", "UpdatedError", "the snapshot was built from a different build of dofile.whl than this page has", "unknown"]]) {
    const store = fakeStore();
    const { eng, workers } = scripted((m, post) => {
      if (m.op === op) post({ id: m.id, error: message, name });
      else starts(m, post);
    }, { store });
    const queued = eng.start();
    const files = eng.call("files");   // a call made while it starts fails with the start
    await assert.rejects(queued, { kind: "failed", reason, name, message });
    await assert.rejects(files, { kind: "failed", reason });
    assert.equal(workers.length, 1, "no second try by itself");
    assert.equal(workers[0].terminated, true, "the worker that could not start is ended");
    assert.equal(eng.worker, null);
    assert.equal(store.post, null, "the store no longer sends the page's changes to it");
    await assert.rejects(eng.call("files"), { kind: "no-engine" });
  }
});

test("no WebAssembly: start() fails with reason no-wasm and makes no worker", async () => {
  const { eng, workers } = scripted(starts, { wasm: null });
  await assert.rejects(eng.start(), { kind: "failed", reason: "no-wasm" });
  assert.equal(workers.length, 0);
});

test("a second start() ends the first worker instead of leaking it", async () => {
  const store = fakeStore();
  const { eng, workers } = scripted((m, post, _port, index) => { if (index === 1) starts(m, post); }, { store });   // the first worker never answers
  const first = eng.start();
  await sleep(5);
  const second = eng.start();
  await assert.rejects(first, { kind: "stopped" });
  assert.deepEqual(await second, { dofile: "test" });
  assert.deepEqual(workers.map(w => w.terminated), [true, false]);
  assert.equal(typeof store.post, "function", "the store sends to the new worker");
});

test("error kinds: an op's error keeps the worker's name; stop, restart and a worker that fails twice are told apart", async () => {
  const restarts: [string, ResetKind][] = [], order: string[] = [];
  const { eng, workers } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "matrix") post({ id: m.id, error: "file system error ENOENT", name: "ErrnoError" });
  }, { onRestart: (reason, started, kind) => { restarts.push([reason, kind]); order.push("onRestart"); started.catch(() => {}); } });
  await eng.start();
  await assert.rejects(eng.call("matrix"), { kind: "op", name: "ErrnoError", message: "file system error ENOENT" });

  // restart(): "user" unless the client says otherwise; onRestart comes first, then the cut run's result
  let running = eng.run("while 1 {\n}"), waiting = eng.call("describe");
  running.then(() => order.push("run resolved"));
  const started = eng.restart("reset by you");
  assert.deepEqual(order, ["onRestart"], "onRestart is called before restart() returns");
  assert.deepEqual(await running, { rc: RC_RESET, error: "session reset: reset by you. Data in memory is gone; your files are kept.", error_command: null, log: "",
    results: null, nobs: 0, nvars: 0, new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [], kind: "user" });
  assert.deepEqual(order, ["onRestart", "run resolved"]);
  await assert.rejects(waiting, { kind: "reset", reset: "user" });
  await started;
  assert.deepEqual(restarts, [["reset by you", "user"]]);

  // a crash: the worker's error event
  running = eng.run("while 1 {\n}");
  workers.at(-1)!.onerror!(new Error("out of memory"));
  assert.equal((await running).kind, "crash");
  assert.deepEqual(restarts.at(-1), ["the engine crashed (out of memory)", "crash"]);
  await sleep(20);   // the new worker starts

  // stop(): no new worker; not the same kind as a failure
  running = eng.run("while 1 {\n}");
  waiting = eng.call("describe");
  eng.stop("another tab took over");
  const stopped = await running;
  assert.deepEqual([stopped.rc, stopped.kind], [RC_RESET, "stopped"]);
  assert.match(stopped.error!, /^session reset: another tab took over\./);
  await assert.rejects(waiting, { kind: "stopped" });
  assert.equal(eng.worker, null);
  assert.equal(restarts.length, 2, "stop() is not a restart");
});

test("a worker that fails twice: kind failed-twice, with the reason; stop() and restart() clear the count of failures", async () => {
  const failing = () => { const port = { onmessage: null, onerror: null as null | ((e: Error) => void), terminate() {}, postMessage() { setTimeout(() => port.onerror?.(new RangeError("Out of memory")), 5); } }; return port as unknown as Worker; };
  const eng = new EngineClient({ wheel: "dofile.whl", createWorker: failing });
  await assert.rejects(eng.start(), { kind: "failed-twice", reason: "memory", message: /failed twice \(Out of memory\); reload the page/ });
  assert.equal(eng.worker, null);
  assert.equal(eng.errorRestarts, 0);

  // one failure, then the user resets or the tab is stopped: the next failure is a first one again
  const { eng: other } = scripted(starts);
  await other.start();
  other.errorRestarts = 1;
  other.stop("another tab took over");
  assert.equal(other.errorRestarts, 0);
  await other.start();
  other.errorRestarts = 1;
  const again = other.restart("reset by you");
  assert.equal(other.errorRestarts, 0);
  await again;
});

test("one run at a time: a second run() is refused, and Break acts on the run that is running", async () => {
  const finish: (() => void)[] = [];
  const { eng, workers } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "run") finish.push(() => post({ id: m.id, result: { rc: 0, log: m.args.code } }));
  }, { graceMs: 150 });
  // with no worker, run() resolves: the result says there is no engine
  const none = await eng.run("display 1");
  assert.deepEqual([none.rc, none.kind, none.results], [RC_RESET, "no-engine", null]);
  assert.match(none.error!, /^session reset: the engine is not running\./);

  await eng.start();
  const first = eng.run("first");
  await assert.rejects(eng.run("second"), { kind: "busy", message: "a run is in progress" });
  assert.equal(eng.running, first, "the refused call changed nothing");
  await sleep(10);
  finish.shift()!();
  assert.deepEqual(await first, { rc: 0, log: "first" });
  assert.equal(finish.length, 0, "the second run never reached the worker");

  // Break counts down for the run that is running; a second Break keeps the first deadline
  const stuck = eng.run("stuck");
  await sleep(10);
  eng.breakRun();
  const deadline = eng.resetAt, timer = eng.breakTimer;
  assert.ok(deadline! > Date.now());
  await sleep(60);
  eng.breakRun();
  assert.equal(eng.resetAt, deadline, "the countdown did not start again");
  assert.equal(eng.breakTimer, timer, "the same timer: the reset comes at the first deadline");
  const r = await stuck;
  assert.deepEqual([r.rc, r.kind], [RC_RESET, "break"]);
  assert.match(r.error!, /the code did not stop at Break/);
  assert.ok(Date.now() >= deadline! - 5, "not before the deadline");
  assert.equal(workers.length, 2);
  await sleep(20);
  // after keepWaiting(), nothing counts down, and a run that ends clears the Break
  const slow = eng.run("slow");
  await sleep(10);
  eng.breakRun();
  eng.keepWaiting();
  assert.equal(eng.resetAt, null);
  await sleep(200);
  assert.equal(workers.length, 2, "no reset");
  finish.at(-1)!();
  assert.deepEqual(await slow, { rc: 0, log: "slow" });
});

test("a page change the worker could not put into its folder reaches onFileError; a restart's cut is not an error", async () => {
  const store = fakeStore(), errors: [string, string, string, string, string][] = [];
  const { eng } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "write") post({ id: m.id, error: "write q: file system error EISDIR", name: "MirrorError" });
  }, { store, onFileError: (error, op, path) => errors.push([error.name, error.kind, error.message, op, path]) });
  await eng.start();
  store.post!("write", { path: "q", data: new Uint8Array(1), seq: 1 }, []);
  await sleep(20);
  assert.deepEqual(errors, [["MirrorError", "op", "write q: file system error EISDIR", "write", "q"]]);
  store.post!("rename", { from: "a", to: "b", seq: 2 }, []);   // never answered: cut by the restart
  await eng.restart("reset by you");
  await sleep(10);
  assert.equal(errors.length, 1);
});

// ---- every failure has a kind; a run's op error is a result ----

test("a run whose op fails in the worker resolves with rc 9998, kind failed; the worker stays and the next run works", async () => {
  const { eng, workers } = scripted((m, post) => {
    if (starts(m, post)) return;
    if (m.op === "run") post(m.args.code === "bad" ? { id: m.id, error: "MemoryError", name: "PythonError" } : { id: m.id, result: { rc: 0, log: "ok" } });
  });
  await eng.start();
  assert.deepEqual(await eng.run("bad"), { rc: RC_RESET, error: "MemoryError", error_command: null, log: "", results: null, nobs: 0, nvars: 0,
    new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [], kind: "run-failed" });
  assert.equal(eng.running, null);
  assert.equal(eng.worker, workers[0], "no restart: the worker is the same");
  assert.deepEqual(await eng.run("good"), { rc: 0, log: "ok" });
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

// ---- the snapshot start: the build's identity from the list, in mount's arguments ----

// A fetch that answers only the list, with `buildId` (or fails as offline, or waits for `hold`); `calls`: what was asked.
function listFetch({ buildId = "w", offline = false, hold }: { buildId?: string, offline?: boolean, hold?: Promise<void> } = {}) {
  const calls: [string, RequestCache | undefined][] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push([url, init.cache]);
    await hold;
    if (offline) throw new TypeError("Failed to fetch");
    return url === `${BASE}start-files.json` ? Response.json({ ...LIST, buildId }) : new Response("no", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const snapshotStart = (fetch: typeof globalThis.fetch, store = fakeStore()) => scripted((m, post) => { starts(m, post); },
  { snapshot: `${BASE}snapshot/`, startFiles: `${BASE}start-files.json`, buildId: "w", fetch, store, indexURL: "https://cdn.test/" });

test("start (snapshot): the list, fetched fresh, gives mount the build id and the two big files; only the list is fetched, no manifest", async () => {
  const { fetch, calls } = listFetch(), sent: Message[] = [];
  const { eng, workers } = scripted((m, post) => { sent.push(m); starts(m, post); },
    { snapshot: `${BASE}snapshot/`, startFiles: `${BASE}start-files.json`, buildId: "w", fetch, indexURL: "https://cdn.test/", brotli: "wasm" });
  await eng.start();
  assert.equal(workers.length, 1);
  assert.deepEqual(sent.find(m => m.op === "mount")!.args,
    { indexURL: "https://cdn.test/", brotli: "wasm", snapshot: `${BASE}snapshot/`, built: 777, files: LIST.snapshot });
  assert.deepEqual(calls, [[`${BASE}start-files.json`, "no-cache"]], "the page fetches the list, fresh, and nothing else");
  // ?snapshot=0: no list, no snapshot arguments
  const normal = scripted((m, post) => { sent.push(m); starts(m, post); }, { fetch: listFetch().fetch, indexURL: "https://cdn.test/" });
  await normal.eng.start();
  assert.deepEqual(sent.filter(m => m.op === "mount").at(-1)!.args, { indexURL: "https://cdn.test/", brotli: undefined });
});

test("start (snapshot): a list of another build rejects with kind updated, and no worker is made", async () => {
  const store = fakeStore();
  store.attach((() => {}) as unknown as FileStore["post"]);   // as after a restart's end(): still attached to the old worker's sender
  const { eng, workers } = snapshotStart(listFetch({ buildId: "a newer build" }).fetch, store);
  await assert.rejects(eng.start(), { kind: "updated", message: /^dofile was updated: reload the page/ });
  assert.equal(workers.length, 0, "no worker");
  assert.equal(eng.worker, null);
  assert.equal(store.post, null, "the store sends nothing");
});

test("start (snapshot): a list that does not arrive rejects (kind failed, reason download), and no worker is made", async () => {
  const { eng, workers } = snapshotStart(listFetch({ offline: true }).fetch);
  await assert.rejects(eng.start(), { kind: "failed", reason: "download" });
  assert.equal(workers.length, 0);
  const none = scripted(starts, { snapshot: `${BASE}snapshot/`, fetch: listFetch().fetch });   // a snapshot start with no list
  await assert.rejects(none.eng.start(), { kind: "failed", reason: "unknown", message: /no snapshot in this build/ });
  assert.equal(none.workers.length, 0);
});

test("start (snapshot): stop() or a second start() while the list is fetched: the first start makes no worker", async () => {
  let open!: () => void;
  const hold = new Promise<void>(ok => { open = ok; });
  const stopped = snapshotStart(listFetch({ hold }).fetch);
  const first = stopped.eng.start();
  stopped.eng.stop("another tab took over");
  open();
  await assert.rejects(first, { kind: "stopped" });
  assert.equal(stopped.workers.length, 0, "a tab that lost the lock starts no worker");

  let open2!: () => void;
  const hold2 = new Promise<void>(ok => { open2 = ok; });
  const twice = snapshotStart(listFetch({ hold: hold2 }).fetch);
  const a = twice.eng.start(), b = twice.eng.start();
  open2();
  await assert.rejects(a, { kind: "stopped" });
  await b;
  assert.equal(twice.workers.length, 1, "one worker, the second start's");
});

test("start: a worker that cannot be made fails with kind failed, reason unknown", async () => {
  const store = fakeStore();
  const eng = new EngineClient({ wheel: "dofile.whl", store, createWorker: () => { throw new SyntaxError("the worker script is broken"); } });
  await assert.rejects(eng.start(), { kind: "failed", reason: "unknown", name: "SyntaxError", message: "the worker script is broken" });
  assert.equal(eng.worker, null);
  assert.equal(store.post, null);
});

test("a restart while start() waits for `startup` hands that start the new one's result", async () => {
  const { eng } = scripted((m, post, _port, index) => {
    if (m.op === "mount") post({ id: m.id, result: undefined });
    else if (m.op === "boot") post({ id: m.id, result: { dofile: `worker ${index}` } });
    else if (m.op === "startup" && index > 0) post({ id: m.id, result: { mode: "normal", worker: index } });   // the first never answers
  }, { onRestart: () => {} });
  const first = eng.start();
  while (![...eng.pending.values()].some(p => p.op === "startup")) await sleep(1);
  const again = eng.restart("reset by you");
  assert.deepEqual(await first, { dofile: "worker 1" });
  assert.deepEqual(await again, { dofile: "worker 1" });
  assert.deepEqual(eng.startup, { mode: "normal", worker: 1 }, "the old start did not write over the new one's startup");
  assert.equal(eng.about!.dofile, "worker 1");
});
