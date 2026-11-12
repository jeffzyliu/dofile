// The page's controllers (src/app/engine.ts, run.ts, files.ts) on a stand-in transport, store and tab lock: the engine
// controller feeding the state machine and performing its effects (the `engine` signal with the machine's sixteen state
// names, asking or not from cached(), the tab lock, the Break timer, the drop record), the streamed log and what a run
// leaves in the state (SPEC section 8), and section 7's test 13 (a false persisted() reaches the `persisted` signal).
// The machine's table is tested in machine.test.ts, the real transport in client.test.ts, the worker in engine.test.ts
// and files.test.ts, and all of it together in the e2e tests.
//
// Every wiring ends with the drop record as the test expects it: empty, unless the test provokes a race and names the
// events that must be dropped (expectDrops). It is asserted when the wiring is replaced (setUp) and when the test ends
// (afterEach), so an event that is stale or not valid in an earlier wiring of a test fails it too.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import type { Banner, EngineState, EngineStateName, LastRun, LogItem, RunHead } from "../src/app/types.ts";
import type { Builds, Lifecycle, Reader } from "../src/engine/client.ts";
import { EngineClient } from "../src/engine/client.ts";
import type { Ending, Reply } from "../src/engine/machine.ts";
import type {
  Build,
  Downloaded,
  FileInfo,
  Ops,
  Progress,
  ReadOps,
  ResetKind,
  Results,
  RunResult,
} from "../src/engine/types.ts";
import { fakeWorker, sleep, starts } from "./harness.ts";

// A log item and a banner with every member's fields, for reading in assertions: a test reads the fields of the member
// it expects.
type AnyLogItem = { t: LogItem["t"] } & Partial<{
  run: RunHead | number;
  first: boolean;
  text: string;
  streaming: boolean;
  unsaved: string[];
  end: LastRun;
  n: number;
}>;
type AnyBanner = { b: Banner["b"] } & Partial<{ reason: string; kind: ResetKind; path: string; message: string }>;

// localStorage, as the page has it (Node's needs a file)
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k: string, v: unknown) => stored.set(k, String(v)),
    removeItem: (k: string) => stored.delete(k),
  },
});

const S = await import("../src/app/state.ts");
const engine = await import("../src/app/engine.ts");
const { runCode, runCommand, clearLog, addFileGraph, moreRows, handlers, MAX_GRAPHS } = await import(
  "../src/app/run.ts"
);
const { keep, connectFiles, afterRun, downloadAll } = await import("../src/app/files.ts");
const { cycleTheme, applyTheme } = await import("../src/app/theme.ts");
const { decodeText } = await import("../src/app/files/open.ts");
const { watchViewport, KEYBOARD } = await import("../src/app/viewport.ts");

/** The engine's state, which must be `name`: that member of EngineState, with its own fields. */
function state<N extends EngineStateName>(name: N): Extract<EngineState, { s: N }> {
  const st = S.engine.value;
  assert.equal(st.s, name);
  return st as Extract<EngineState, { s: N }>;
}
const logItems = (): AnyLogItem[] => S.log.value;
const banners = (): AnyBanner[] => S.banners.value;
/** A read-only signal, to set up or clear in a test what only its owner writes in the page. */
const writable = <T>(signal: ReadonlySignal<T>) => signal as Signal<T>;

const tick = () => sleep(0);
/** A promise the test settles: ok(value), no(error). A rejection nobody waits for is not an error. */
type Later<T = unknown> = Promise<T> & { ok(value?: T | PromiseLike<T>): void; no(error: unknown): void };
const later = <T = unknown>(): Later<T> => {
  let ok!: (value: T | PromiseLike<T>) => void, no!: (error: unknown) => void;
  const p = new Promise<T>((a, b) => {
    ok = a;
    no = b;
  });
  p.catch(() => {});
  return Object.assign(p, { ok, no }) as Later<T>;
};
const result = (more: object = {}) =>
  ({
    rc: 0,
    error: null,
    error_command: null,
    log: "",
    results: { e: {}, r: {}, e_changed: false, r_changed: false },
    nobs: 0,
    nvars: 0,
    new_graphs: 0,
    images: [],
    error_line: null,
    graph_commands: [],
    graph_lines: [],
    files: [],
    ...more,
  }) as unknown as RunResult;
const failure = (message: string, more: object) => Object.assign(new Error(message), more);
const SENTENCE = (reason: string) => `session reset: ${reason}. Data in memory is gone; your files are kept.`;
const BUILD: Build = {
  built: 777,
  files: { snapshot: { name: "heap.bin", raw: 4, size: 2 }, bundle: { name: "bundle.bin", raw: 4, size: 2 } },
};
/** What download() resolves with when the files are in the Cache. */
const DONE: Downloaded = { cached: true, received: 100, total: 100, build: BUILD };
const CRASH = { type: "crashed", cause: "error", reason: "unknown", detail: "boom" } as const;
const FILE: RunHead = { kind: "file", path: "a.do", fresh_locals: true };

type FakeRun = { args: Ops["run"]["args"]; onLog: (text: string) => void; done: Later<RunResult> };
type FakeWorker = {
  n: number;
  build: Build | null;
  reply: Reply<"start-worker">;
  ended: Ending | null;
  runs: FakeRun[];
};
type FakeDownload = { signal: AbortSignal; progress: (progress: Progress) => void; done: Later<Downloaded> };

// A transport that does what the test says, when it says: each download(), build() and run() waits on a promise the test
// settles, and a worker says what the test makes it say (worker.reply). It keeps the transport's own rules: start() with a
// worker still live throws, end() fails the ended worker's run and its waiting read ops with the ending's kind.
class FakeTransport implements Reader, Lifecycle, Builds {
  isCached: boolean | Promise<boolean> = false; // what cached() answers
  deaf = false; // download() does not hear its abort: the test can still complete it
  hold = false; // read ops wait (until their worker is ended)
  downloads: FakeDownload[] = [];
  lists: Later<Build | null>[] = [];
  workers: FakeWorker[] = [];
  calls: [string, unknown][] = [];
  interrupted: number[] = [];
  forgot = 0;
  live: FakeWorker | null = null;
  waiting: Later<unknown>[] = [];
  /** The latest download, list fetch and worker. */
  get dl() {
    return this.downloads.at(-1)!;
  }
  get list() {
    return this.lists.at(-1)!;
  }
  get worker() {
    return this.workers.at(-1)!;
  }
  /** The latest run of the latest worker. */
  get run1() {
    return this.worker.runs.at(-1)!;
  }

  async cached() {
    return this.isCached;
  }
  async forgetDownload() {
    this.forgot++;
  }
  download({ signal, onProgress }: { signal?: AbortSignal; onProgress?: (progress: Progress) => void }) {
    const done = later<Downloaded>();
    if (!this.deaf) signal!.addEventListener("abort", () => done.no(new DOMException("stopped", "AbortError")));
    this.downloads.push({ signal: signal!, progress: onProgress!, done });
    return done;
  }
  build() {
    const list = later<Build | null>();
    this.lists.push(list);
    return list;
  }

  start(n: number, build: Build | null, reply: Reply<"start-worker">) {
    if (this.live) throw new Error(`start(${n}): worker ${this.live.n} is still live`);
    this.live = { n, build, reply, ended: null, runs: [] };
    this.workers.push(this.live);
  }
  end(n: number, ending: Ending) {
    const worker = this.live;
    if (!worker) return;
    if (worker.n !== n) throw new Error(`end(${n}): the live worker is ${worker.n}`);
    this.live = null;
    worker.ended = ending;
    const error = failure(ending.reason, { kind: ending.kind });
    for (const run of worker.runs) run.done.no(error);
    for (const call of this.waiting.splice(0)) call.no(error);
  }
  run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void) {
    const done = later<RunResult>();
    if (this.live?.n === n) this.live.runs.push({ args, onLog, done });
    else done.no(failure("the engine is not running", { kind: "no-engine" }));
    return done;
  }
  interrupt(n: number) {
    this.interrupted.push(n);
  }

  query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
    this.calls.push([op, args]);
    if (!this.live) return Promise.reject(failure("the engine is not running", { kind: "no-engine" }));
    const answer = this.hold ? later() : Promise.resolve({ op });
    if (this.hold) this.waiting.push(answer as Later<unknown>);
    return answer as Promise<ReadOps[K]["result"]>;
  }
}
/** The page's store as files.ts uses it; a test gives it a zip() when it needs one. */
type FakeStore = {
  blocked: boolean;
  onChange: null | (() => void);
  list: () => Promise<FileInfo[]>;
  zip?: () => Promise<Blob>;
  read: (path: string) => Promise<Uint8Array>;
  texts: Map<string, string>; // what read() gives; a test sets it
};
const fakeStore = (paths: string[] = []): FakeStore => {
  const texts = new Map<string, string>();
  return {
    blocked: true,
    onChange: null,
    list: async () => paths.map((path) => ({ path, dir: false, size: 1, mtime: 1 })),
    texts,
    read: async (path) => {
      if (!texts.has(path)) throw new Error(`${path} not found`);
      return new TextEncoder().encode(texts.get(path));
    },
  };
};
const fakeLock = (free = true) => ({
  asked: [] as { steal?: boolean }[],
  async take(o: { steal?: boolean } = {}) {
    this.asked.push(o);
    return free || Boolean(o.steal);
  },
});

/** What the drop record of the wiring in use must hold when that wiring ends: nothing, unless the test says. */
let dropsWanted: ReturnType<typeof engine.drops> = [];
const expectDrops = (wanted: typeof dropsWanted) => {
  dropsWanted = wanted;
};
/** The wiring in use ends here: its drop record is what the test expects. */
function checkDrops(when: string) {
  const wanted = dropsWanted;
  dropsWanted = [];
  assert.deepEqual(engine.drops(), wanted, `the drop record ${when}`);
}

type Wiring = {
  free?: boolean;
  snapshot?: boolean;
  files?: string[];
  cached?: boolean | Promise<boolean>;
  manual?: boolean;
  graceMs?: number;
  canInterrupt?: boolean;
  transport?: Reader & Lifecycle & Builds;
};
let client: FakeTransport, store: ReturnType<typeof fakeStore>, lock: ReturnType<typeof fakeLock>;
/** A new wiring: a transport (the stand-in, unless the test gives one), a store (blocked, as app/store.ts opens it) and a
 *  tab lock. open() then starts the machine. */
function wire({
  free = true,
  snapshot = true,
  files = [],
  cached = false,
  manual = false,
  graceMs = undefined,
  canInterrupt = true,
  transport = undefined,
}: Wiring = {}) {
  client = new FakeTransport();
  store = fakeStore(files);
  lock = fakeLock(free);
  client.isCached = cached;
  connectFiles(store as unknown as Parameters<typeof connectFiles>[0], {
    persist: async () => true,
    persisted: async () => true,
  });
  engine.connectRun(handlers);
  engine.connectEngine({ client: transport ?? client, lock, snapshot, manual, graceMs, canInterrupt });
}
/** Replace the wiring in a test: the one that ends must have dropped only what the test said it would. */
function setUp(opts: Wiring = {}) {
  checkDrops("of the wiring that is replaced");
  wire(opts);
}

beforeEach(() => {
  stored.clear();
  dropsWanted = [];
  wire(); // a new wiring for every test (not opened): nothing of the last test's can act, and the drop record is empty
  handlers.engineGone(); // results, macros, data, rows, memory, lastRun, and the count of the session's runs
  S.dialog.value = null;
  S.tabs.value = [];
  S.theme.value = "system";
  for (const b of S.banners.value) S.dismiss(b);
  writable(S.history).value = [];
  writable(S.persisted).value = null;
  writable(S.files).value = [];
  writable(S.log).value = [];
  clearLog();
});
afterEach(() => {
  checkDrops("at the end of the test");
});

/** What the live region says over the next window(s). */
async function heard() {
  await sleep(70);
  return S.announce.value;
}

/** The page load: the tab lock answers, and (with the lock) the cache check. */
async function load(opts?: Wiring) {
  setUp(opts);
  engine.open();
  await tick();
}
/** A worker that starts: from `downloading`, the download completes; from `starting-list`, the list arrives. */
async function begin() {
  if (S.engine.value.s === "downloading") client.dl.done.ok(DONE);
  else client.list.ok(BUILD);
  await tick();
  state("starting-worker");
}
async function readyEngine(opts?: Wiring) {
  await load({ cached: true, ...opts });
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
}

test("with nothing cached the page asks; Download counts bytes, the stages come from the worker's typed ids, then ready", async () => {
  setUp({ files: ["a.do"] });
  engine.open();
  assert.deepEqual(S.engine.value, { s: "checking-lock" }, "the page load is a state of its own");
  assert.equal(store.blocked, true, "nothing is written before the lock answers");
  await tick();
  assert.deepEqual(S.engine.value, { s: "asking", forRun: false });
  assert.deepEqual(S.dialog.value, { d: "download", forRun: false });
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
  assert.deepEqual(client.calls.at(-1), ["memory", undefined]);
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
    message: engine.FAILED["no-wasm"],
    detail: "this browser has no WebAssembly support",
  });
  assert.deepEqual(client.worker.ended, { kind: "failed", reason: "this browser has no WebAssembly support" });
  assert.equal(
    await heard(),
    "Download the engine. The engine didn't start",
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
  assert.deepEqual(banners(), [{ b: "reset", reason: "reset by you", kind: "user" }]);
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
  const workers: ReturnType<typeof fakeWorker>[] = [],
    answerRun: ((result: RunResult) => void)[] = [];
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

  // the worker crashes during a run, with a read op waiting: the real end() fails both, and the machine's own result ends the run
  const cutRun = runCode("long", FILE),
    waiting = engine.call("describe_file", { path: "d.dta" });
  await sleep(10);
  workers[0].onerror!(new Error("boom"));
  state("starting-list");
  await assert.rejects(waiting, { kind: "reset", reset: "crash", message: SENTENCE("the engine crashed (boom)") });
  const cut = (await cutRun)!;
  assert.deepEqual([cut.rc, cut.kind, cut.error], [9998, "crash", SENTENCE("the engine crashed (boom)")]);
  await until("ready"); // the real build() (no list: null), then start(): it would throw if the old worker were still live
  assert.deepEqual([workers.length, workers[0].terminated, transport.worker === workers[1]], [2, true, true]);
  assert.deepEqual(banners(), [{ b: "reset", reason: "the engine crashed (boom)", kind: "crash" }]);
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
    message: engine.FAILED_TWICE,
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

  // a start that fails before a worker exists (no WebAssembly): the machine's end-worker finds no worker, and that is not an error
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

test("Stop download declines; Run then asks for a run, and the run starts with the engine: `ready` is not shown in between", async () => {
  await load();
  engine.start();
  engine.stopDownload();
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(client.dl.signal.aborted, true);
  assert.equal(S.dialog.value, null);
  const queuedRun = runCode("display 1", FILE); // settles once the run has run
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  assert.deepEqual(S.engine.value, { s: "asking", forRun: true });
  engine.start();
  await begin();
  const seen: string[] = [];
  const off = S.engine.subscribe((st) => {
    seen.push(st.s);
  });
  client.worker.reply({ type: "started" });
  off();
  assert.deepEqual(seen, ["starting-worker", "running"], "straight to running");
  assert.equal(client.worker.runs.length, 1, "the run waited for the engine");
  assert.deepEqual([client.run1.args.code, client.run1.args.fresh_locals], ["display 1", true]);
  assert.deepEqual(client.calls.at(-1), ["memory", undefined], "engine-ready all the same");
  assert.equal(logItems().find((i) => i.t === "runhead")!.first, true);
  client.run1.done.ok(result());
  assert.equal((await queuedRun)?.rc, 0, "the queued run's promise settles with its result");
});

test("a failed download is `failed` (reason download) with no worker; a failed start is `failed` with its cause; a second crash is `failed-twice`", async () => {
  await load();
  engine.start();
  client.dl.done.no(failure("https://dofile.test/snapshot/heap.bin: 503", { kind: "failed", reason: "download" }));
  await tick();
  const failed = state("failed"); // no offline start: a failed download ends there
  assert.deepEqual(
    [failed.reason, failed.message, failed.detail],
    ["download", engine.FAILED.download, "https://dofile.test/snapshot/heap.bin: 503"],
    "plain words for the visitor, and the cause for a developer",
  );
  assert.equal(client.workers.length, 0, "no worker is made");
  // whatever reason download() gives (a Cache that breaks, a build with no snapshot), the download failed
  engine.start();
  client.dl.done.no(failure("the cache is broken", { kind: "failed", reason: "unknown" }));
  await tick();
  assert.deepEqual([state("failed").reason, client.workers.length], ["download", 0]);

  engine.start();
  await begin();
  client.worker.reply({ type: "start-failed", reason: "download", detail: "no snapshot at /snapshot/" });
  assert.deepEqual(S.engine.value, {
    s: "failed",
    reason: "download",
    message: engine.FAILED.download,
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
    message: engine.FAILED_TWICE,
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
  assert.deepEqual(S.engine.value, { s: "asking", forRun: false });
  assert.equal(client.downloads.length, 0, "nothing downloads before the visitor says so");

  S.dialog.value = null;
  const answer = later<boolean>();
  await load({ cached: answer });
  assert.deepEqual(S.engine.value, { s: "checking-cache" });
  // Download or Run pressed now is refused: the page has not decided yet whether to ask
  engine.start();
  assert.equal(runCommand("display 1").accepted, false);
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
  assert.deepEqual(banners(), [{ b: "reset", reason: "the engine crashed (x)", kind: "crash" }]);
  const cut = (await done)!;
  assert.deepEqual([cut.rc, cut.kind, cut.results], [9998, "crash", null], "the machine's own result");
  assert.equal(cut.error, SENTENCE("the engine crashed (x)"));
  state("starting-list");
  assert.equal(logItems().find((i) => i.t === "text")!.text, "pass 1\n");
  assert.match(logItems().at(-1)!.text!, /session reset: the engine crashed/);
  assert.equal(S.results.value, null);
  assert.equal(S.lastRun.value!.rc, 9998, "the cut run is the last run");
  assert.equal(client.lists.length, 1, "a restart fetches the build's list fresh");
  await begin();
  assert.deepEqual(client.worker.build, BUILD);
  client.worker.reply({ type: "started" });
  state("ready");
  // the new engine has no locals yet: its first run says so, although the cut run ended after the reset began
  runCode("display 1", { kind: "selection", path: "a.do", lines: [1, 1], fresh_locals: false });
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
  const ended = result({ rc: 0, log: "the last command finished\n" }); // the run had ended before a safe point: its own rc
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
  assert.deepEqual(banners(), [{ b: "reset", reason, kind: "break" }]);
  const r = (await done)!;
  assert.deepEqual([r.rc, r.kind, r.error], [9998, "break", SENTENCE(reason)]);
});

// Addition A4: the one answer the stale guard does not protect. Two runs on one worker share its ticket, so a timer left
// from the first run would reset the second. Every exit from `breaking` emits cancel-break-timer (a property of the
// machine); this pins that the controller performs it.
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
    client.run1.done.ok(result({ rc: 1, log: "--Break--\nr(1);\n" })); // the engine takes the Break, before the deadline
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
    assert.deepEqual(banners(), [{ b: "reset", reason: "the code did not stop at Break", kind: "break" }]);
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

// SPEC section 7, test 13: keepFiles answers at once with persisted(), and again when persist() is answered; the page's
// signal gets each answer
test("a false persisted() reaches the `persisted` signal, and persist()'s answer follows it", async () => {
  const asked = later<boolean>();
  const storage = { persisted: async () => false, persist: () => asked };
  await keep(storage);
  assert.equal(S.persisted.value, false);
  storage.persisted = async () => true;
  asked.ok(true);
  await sleep(5);
  assert.equal(S.persisted.value, true);
});

// ---- the review of step 3 ----

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
    ["updated", engine.UPDATED],
    "plain words: a newer version, reload",
  );
  assert.match(engine.UPDATED, /newer version.*reload the page/);
  assert.equal(client.workers.length, 0, "no worker after an updated download");

  // a page that was open when the site was deployed again: its next restart finds the list of another build
  const stale =
    "dofile was updated: reload the page (the site's start files are of the build 0123456789ab, this page of ba9876543210; in development: `npm run snapshot`)";
  await readyEngine();
  const cut = runCode("x", FILE);
  engine.reset();
  client.list.no(failure(stale, { kind: "updated" }));
  await tick();
  assert.deepEqual(S.engine.value, { s: "failed", reason: "updated", message: engine.UPDATED, detail: stale });
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
      message: engine.FAILED[reason],
      detail: "dofile was updated (not from the text)",
    });
  }
  // and a download that fails with such words is reason download
  await load();
  engine.start();
  client.dl.done.no(failure("dofile was updated (not from the text)", { kind: "failed", reason: "unknown" }));
  await tick();
  assert.equal(state("failed").reason, "download");
});

test("a failed start's message is plain words for every reason, with no developer terms; the cause is `detail` and goes to the console", async () => {
  const dev = /npm|snapshot|manifest|bytes|worker|wheel|\.js|\.json|\?|`/i;
  for (const m of [...Object.values(engine.FAILED), engine.FAILED_TWICE]) assert.doesNotMatch(m, dev, m);
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
  assert.deepEqual(banners(), [{ b: "reset", reason: "reset by you", kind: "user" }]);
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

test("runCode while a run is on does nothing; a queued run is dropped by Not now and by a failed start, and its promise then settles with null", async () => {
  await readyEngine();
  const first = runCode("a", FILE);
  assert.equal(await runCode("b", FILE), null);
  assert.equal(client.worker.runs.length, 1);
  client.run1.done.ok(result());
  await first;
  expectDrops([{ type: "run", row: "running", why: "not-valid" }]);

  await load(); // nothing cached: the prompt
  engine.decline();
  let pending: Promise<unknown> | null = runCode("queued", FILE);
  let settled = false;
  pending.then(() => (settled = true));
  await Promise.resolve();
  assert.equal(settled, false, "a queued run's promise waits for its fate");
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  engine.decline();
  assert.equal(await pending, null, "Not now: dropped, null");
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(client.worker.runs.length, 0, "Not now dropped the run");

  await load();
  engine.decline();
  pending = runCode("queued", FILE);
  assert.deepEqual(S.engine.value, { s: "asking", forRun: true });
  engine.start();
  await begin();
  client.worker.reply({ type: "start-failed", reason: "unknown", detail: "no" });
  assert.equal(await pending, null, "the failed start: dropped, null");
  pending = null;
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  assert.equal(client.worker.runs.length, 0, "the failed start dropped the run");
});

// Addition A3
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
  assert.equal(engine.run("the next one", FILE), "started");
  client.run1.done.ok(result());
});

// Addition A2: every machine counts its tickets from 1 along the same path, so a late answer of an earlier wiring would
// present a ticket the new machine has issued too.
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

// Scenario 11 of the design: a wrong ticket. The old download's reply is bound to its own ticket.
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

// Scenario 15 of the design: a read op is outside the machine. It raises no event in any of these steps.
test("call(): a read op with no worker is rejected (no-engine); one that waits behind a run is cut by a reset (kind reset), or answered after the run", async () => {
  await load();
  engine.decline();
  await assert.rejects(engine.call("matrix", { name: "e(b)" }), { kind: "no-engine" });
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

test("Clear log during a run keeps the run's text item, so its log still arrives; the graph numbers start again", async () => {
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
  S.tabs.value = [
    { path: "a.do", kind: "text", dirty: false },
    { path: "clean.do", kind: "text", dirty: true },
  ];
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
  assert.equal(runCommand("  summarize  ").accepted, true);
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
  assert.equal(empty.accepted, false);
  assert.equal(await empty.done, null);
});

test("runCommand: a command that does not run is refused (not in history, so the field keeps it); one that runs or is queued is accepted, an error too", async () => {
  // the page load: refused, in both of its states
  setUp();
  engine.open();
  assert.deepEqual([S.engine.value.s, runCommand("display 1").accepted], ["checking-lock", false]);
  expectDrops([{ type: "run", row: "checking-lock", why: "not-valid" }]);

  await readyEngine();
  const first = runCommand("regress y x");
  assert.equal(first.accepted, true);
  // a run is on: refused, nothing sent, history unchanged
  const busy = runCommand("describe");
  assert.equal(busy.accepted, false);
  assert.equal(await busy.done, null);
  assert.equal(client.worker.runs.length, 1);
  assert.deepEqual(S.history.value, ["regress y x"]);
  client.run1.done.ok(result({ rc: 111, log: "r(111);\n" }));
  await first.done;
  assert.deepEqual(S.history.value, ["regress y x"], "a command that ran and failed stays in history");

  // starting (a reset): refused
  engine.reset();
  state("starting-list");
  assert.equal(runCommand("summarize").accepted, false);
  await begin();
  assert.equal(runCommand("summarize").accepted, false);
  assert.deepEqual(S.history.value, ["regress y x"]);
  expectDrops([
    { type: "run", row: "running", why: "not-valid" },
    { type: "run", row: "starting-list", why: "not-valid" },
    { type: "run", row: "starting-worker", why: "not-valid" },
  ]);

  // no engine (declined): queued, which counts as accepted; while the prompt asks, refused
  await load();
  engine.decline();
  writable(S.history).value = [];
  const queued = runCommand("use wages");
  assert.equal(queued.accepted, true);
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  assert.deepEqual(S.history.value, ["use wages"]);
  assert.equal(runCommand("summarize").accepted, false, "asking: refused");
  assert.deepEqual(S.history.value, ["use wages"]);
  engine.start();
  await begin();
  client.worker.reply({ type: "started" });
  assert.deepEqual(
    client.worker.runs.map((r) => r.args.code),
    ["use wages"],
    "the queued command ran once the engine was ready",
  );
  client.run1.done.ok(result());
  assert.equal((await queued.done)?.rc, 0, "a queued command's done settles with its result once it has run");
  expectDrops([{ type: "run", row: "asking", why: "not-valid" }]);
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

test("the storage banner: once per visit, when persisted() is false and the files change", async () => {
  setUp();
  store.blocked = false;
  writable(S.persisted).value = true;
  store.onChange!();
  assert.deepEqual(banners(), []);
  writable(S.persisted).value = false;
  store.onChange!();
  assert.deepEqual(banners(), [{ b: "storage" }]);
  S.dismiss({ b: "storage" });
  store.onChange!();
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(banners(), [], "once per visit");
  setUp(); // a new visit
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(banners(), [{ b: "storage" }], "a run's files count too");
});

test("a run that rewrites an open file: the editor follows it (ranOver); the banner when it keeps the tab's text: edits, or a version that is not text; nothing for the same text", async () => {
  setUp();
  store.blocked = false;
  const { editorCommands } = await import("../src/app/editor/commands.ts");
  const calls: string[] = [];
  const kept = { reload: editorCommands.reload, ranOver: editorCommands.ranOver };
  // the editor's answers, as Editor.tsx gives them: the same text again, a clean tab shown, edits (or not text) kept
  const answers: Record<string, "same" | "shown" | "kept"> = {
    "t.csv": "shown",
    "out.log": "kept",
    "same.log": "same",
    "bin.csv": "kept",
  };
  editorCommands.reload = (path, text) => calls.push(`reload ${path} ${text}`);
  editorCommands.ranOver = (path, text) => {
    calls.push(`ranOver ${path} ${text}`);
    return answers[path];
  };
  const read = store.read;
  store.read = async (path) => (path === "bin.csv" ? new Uint8Array([0x9e, 0xff, 0x00]) : read(path));
  try {
    writable(S.tabs).value = [
      { path: "t.csv", kind: "text", dirty: false },
      { path: "out.log", kind: "text", dirty: true },
      { path: "same.log", kind: "text", dirty: true },
      { path: "bin.csv", kind: "text", dirty: false },
      { path: "d.dta", kind: "dta", dirty: false },
    ];
    for (const p of ["t.csv", "out.log", "same.log", "d.dta", "other.csv"]) store.texts.set(p, `new ${p}`);
    await afterRun([
      { name: "t.csv", status: "modified", bytes: 9 },
      { name: "out.log", status: "modified", bytes: 9 },
      { name: "same.log", status: "modified", bytes: 9 },
      { name: "bin.csv", status: "modified", bytes: 3 },
      { name: "d.dta", status: "modified", bytes: 9 },
      { name: "other.csv", status: "created", bytes: 9 },
      { name: "gone.do", status: "removed", bytes: 0 },
    ]);
    assert.deepEqual(calls.sort(), [
      "ranOver bin.csv null", // not text: null, not left alone
      "ranOver out.log new out.log",
      "ranOver same.log new same.log",
      "ranOver t.csv new t.csv",
    ]);
    assert.deepEqual(
      banners()
        .map((b) => b.path)
        .sort(),
      ["bin.csv", "out.log"],
      "a banner where the editor kept its text; none for the same text or a clean tab shown",
    );
    // a store that cannot be read: nothing is known of the run's version, so nothing is done
    calls.length = 0;
    store.read = async () => {
      throw new Error("the store failed");
    };
    await afterRun([{ name: "t.csv", status: "modified", bytes: 9 }]);
    assert.deepEqual(calls, []);
  } finally {
    Object.assign(editorCommands, kept);
    store.read = read;
    writable(S.tabs).value = [];
  }
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
  } finally {
    mock.timers.reset();
  }
  S.addBanner({ b: "not-text", path: "a.xlsx" });
  S.addBanner({ b: "not-text", path: "b.xlsx" });
  S.addBanner({ b: "reset", reason: "one", kind: "crash" });
  S.addBanner({ b: "reset", reason: "two", kind: "user" });
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

test("Download all with nothing to download (no files, or folders only) makes no zip, says nothing and resolves false", async () => {
  setUp();
  store.blocked = false;
  await heard();
  writable(S.announce).value = "";
  let zips = 0;
  store.zip = async () => {
    zips++;
    return new Blob([]);
  };
  assert.equal(await downloadAll(), false);
  store.list = async () => [{ path: "data", dir: true, size: 0, mtime: 1 }];
  await afterRun([]); // lists the store again
  assert.equal(S.hasFiles.value, false, "a folder is not a file");
  assert.equal(await downloadAll(), false);
  assert.equal(zips, 0, "no empty zip");
  assert.equal(await heard(), "", "nothing said");
  assert.deepEqual(banners(), [], "nothing shown");
  store.list = async () => [
    { path: "data", dir: true, size: 0, mtime: 1 },
    { path: "data/a.dta", dir: false, size: 1, mtime: 1 },
  ];
  await afterRun([]);
  assert.equal(S.hasFiles.value, true);
});

test("Download all: a store that cannot make the zip adds one banner (a second failure replaces it) and says so once; a download that works removes it", async () => {
  setUp({ files: ["a.do"] });
  await heard();
  writable(S.toast).value = null;
  const warn = mock.method(console, "warn", () => {});
  store.zip = async () => {
    throw new Error("the database is closed");
  };
  const doc = globalThis.document;
  try {
    assert.equal(await downloadAll(), false);
    assert.deepEqual(banners(), [{ b: "download-failed" }]);
    assert.equal(S.toast.value, null, "no toast: the failure offers Try again, so it is a banner (SPEC 3.10)");
    assert.equal(await heard(), "Your files couldn't be downloaded");
    assert.match(String(warn.mock.calls[0].arguments[0]), /the database is closed/);
    assert.equal(await downloadAll(), false); // "Try again", failing again
    assert.deepEqual(banners(), [{ b: "download-failed" }], "replaced, not stacked");
    // a download that works: the zip goes to the browser and the banner goes
    let clicked = 0;
    globalThis.document = {
      createElement: () => ({
        click: () => {
          clicked++;
        },
        remove() {},
      }),
      body: { append() {} },
    } as unknown as Document;
    store.zip = async () => new File(["zip"], "dofile.zip");
    assert.equal(await downloadAll(), true);
    assert.equal(clicked, 1);
    assert.deepEqual(banners(), []);
  } finally {
    globalThis.document = doc;
    warn.mock.restore();
  }
});

test("the theme button cycles System, Light, Dark; applyTheme keeps <html data-theme> and localStorage in step", () => {
  const root = { dataset: {} as DOMStringMap };
  const off = applyTheme(root as HTMLElement);
  assert.equal(root.dataset.theme, undefined);
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.get("dofile.theme")], ["light", "light", "light"]);
  assert.equal(S.resolvedTheme.value, "light");
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.get("dofile.theme")], ["dark", "dark", "dark"]);
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.has("dofile.theme")], ["system", undefined, false]);
  off();
});

test("setDirty sets one tab's dot; decodeText takes strict UTF-8 only", () => {
  S.tabs.value = [
    { path: "a.do", kind: "text", dirty: false },
    { path: "b.do", kind: "text", dirty: false },
  ];
  S.setDirty("b.do", true);
  assert.deepEqual(
    S.tabs.value.map((t) => t.dirty),
    [false, true],
  );
  const before = S.tabs.value;
  S.setDirty("b.do", true);
  S.setDirty("gone.do", true);
  assert.equal(S.tabs.value, before, "no change, no new list");
  assert.equal(decodeText(new TextEncoder().encode("café\n")), "café\n");
  assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])), null, "Latin-1 is not text");
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])), "a", "a leading BOM is dropped, as before");
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), true), "\uFEFFa", "or kept, for the editor");
});

// ---- the second review of step 3 ----

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

// reset() is refused while a start is in progress (A2), so the second restart is the machine's own: the new worker crashed
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

test("the phone keyboard: watchViewport sets data-keyboard and --vv-height/--vv-top while the visual viewport is clearly shorter, not when zoomed or off the phone", () => {
  // a visualViewport as iOS Safari reports it: the layout viewport stays 844 px tall when the keyboard opens
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = {
    dataset: {} as DOMStringMap,
    style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
  };
  let phone = true;
  const { update, stop } = watchViewport({
    vv: vv as VisualViewport,
    root: root as unknown as HTMLElement,
    layoutHeight: () => 844,
    enabled: () => phone,
  });
  const move = (height: number, offsetTop = 0, scale = 1) => {
    Object.assign(vv, { height, offsetTop, scale });
    vv.dispatchEvent(new Event("resize"));
  };
  assert.equal("keyboard" in root.dataset, false, "closed at the start");
  assert.equal(vars.size, 0);

  move(844 - KEYBOARD + 10); // Safari's toolbars, not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508); // the keyboard opens
  assert.equal("keyboard" in root.dataset, true);
  assert.equal(vars.get("--vv-height"), "508px");
  assert.equal(vars.get("--vv-top"), "0px");
  Object.assign(vv, { offsetTop: 120 });
  vv.dispatchEvent(new Event("scroll")); // Safari pans to the field
  assert.equal(vars.get("--vv-top"), "120px");
  move(844); // closed again: nothing set
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  move(422, 200, 2); // a pinch to 2x: smaller, but no keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508);
  phone = false;
  update(); // the layout is no longer the phone's
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  stop();
  phone = true;
  move(508); // no longer listening
  assert.equal("keyboard" in root.dataset, false);
  assert.deepEqual(
    watchViewport({ vv: null, root: root as unknown as HTMLElement }).update(),
    undefined,
    "no visualViewport: nothing to do",
  );
});

test("the phone keyboard where the browser shrinks the layout viewport: open while a text field has the focus and the page is well below its tallest at this width; not on a rotation or without focus", () => {
  // an older Android browser: the layout and visual viewports shrink together, so they never differ
  let h = 800,
    w = 390,
    focused = false;
  const vv = Object.assign(new EventTarget(), { height: h, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = {
    dataset: {} as DOMStringMap,
    style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
  };
  const { stop } = watchViewport({
    vv: vv as VisualViewport,
    root: root as unknown as HTMLElement,
    layoutHeight: () => h,
    layoutWidth: () => w,
    typing: () => focused,
  });
  const resize = (height: number, width = w) => {
    h = height;
    w = width;
    vv.height = height;
    vv.dispatchEvent(new Event("resize"));
  };

  focused = true;
  resize(800 - KEYBOARD + 10); // the toolbar hides or shows: not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  resize(450); // the keyboard opens with a field focused
  assert.equal("keyboard" in root.dataset, true);
  assert.equal(vars.get("--vv-height"), "450px");
  assert.equal(vars.get("--vv-top"), "0px");
  resize(800); // closed
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  focused = false;
  resize(450); // shorter, but nothing takes typing (a split screen, say)
  assert.equal("keyboard" in root.dataset, false);
  focused = true;
  resize(390, 800); // a rotation to landscape: a new width starts again from this height
  assert.equal("keyboard" in root.dataset, false);
  resize(390 - KEYBOARD - 50, 800); // then the keyboard in landscape
  assert.equal("keyboard" in root.dataset, true);
  stop();
});

// ---- the review of the step 4 join ----

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
  engine.lost(); // another tab takes the engine: the line's run is cut (rc 9998, kind "stopped"), and lastRun is not written
  state("other-tab-idle");
  await sleep(20);
  // "Use dofile in this tab", the engine starts again, and the visitor runs something
  engine.takeOver();
  await tick();
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
  const next = runCommand("display 2");
  assert.equal(next.accepted, true);
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

test("J5: a run's promise settles even when the after-run work throws (an open tab's follow-up fails)", async () => {
  await readyEngine();
  store.blocked = false;
  const { editorCommands } = await import("../src/app/editor/commands.ts");
  const kept = { ranOver: editorCommands.ranOver, reload: editorCommands.reload };
  const fail = () => {
    throw new Error("the editor failed");
  };
  Object.assign(editorCommands, { ranOver: fail, reload: fail });
  try {
    writable(S.tabs).value = [{ path: "t.csv", kind: "text", dirty: false }];
    store.texts.set("t.csv", "new");
    const done = runCode("x", FILE);
    client.run1.done.ok(result({ files: [{ name: "t.csv", status: "modified", bytes: 3 }] }));
    const settled = await Promise.race([done.then(() => "settled"), sleep(100).then(() => "pending")]);
    assert.equal(settled, "settled");
    state("ready");
  } finally {
    Object.assign(editorCommands, kept);
    writable(S.tabs).value = [];
  }
});
