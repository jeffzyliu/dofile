// The page's controllers (src/app/engine.js, run.js, files.js) on a stand-in client, store and tab lock: the engine
// states of docs/design/SPEC.md section 5 built from what the client reports, asking or not from cached(), the tab lock,
// the streamed log and what a run leaves in the state (section 8), and section 7's test 13 (a false persisted() reaches
// the `persisted` signal). The real client and worker are tested in client.test.mjs and the e2e tests.
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { sleep } from "./harness.ts";
import type { Signal } from "@preact/signals-core";
import type { EngineClient } from "../src/engine/client.ts";
import type { About, FileInfo, Progress, ResetKind, Results, RunOptions, StatusText } from "../src/engine/types.ts";
import type { Banner, EngineStateName, FailReason, LastRun, LogItem, RunHead, Stage } from "../src/app/types.ts";

// The engine state, a log item and a banner with every member's fields, for reading in assertions: a test reads the fields
// of the member it expects, and an assertion on `s` must not narrow the signal's value for the rest of the test.
type AnyEngineState = { s: EngineStateName } & Partial<{ forRun: boolean, received: number, total: number, t0: number, stage: Stage,
  done: Partial<Record<Stage, number>>, run: RunHead, resetAt: number, reason: FailReason, message: string, detail: string }>;
type AnyLogItem = { t: LogItem["t"] } & Partial<{ run: RunHead | number, first: boolean, text: string, streaming: boolean, unsaved: string[],
  end: LastRun, n: number }>;
type AnyBanner = { b: Banner["b"] } & Partial<{ reason: string, kind: ResetKind, path: string, message: string }>;

// localStorage, as the page has it (Node's needs a file)
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (k: string) => (stored.has(k) ? stored.get(k) : null), setItem: (k: string, v: unknown) => stored.set(k, String(v)),
  removeItem: (k: string) => stored.delete(k) } });

const S = await import("../src/app/state.ts") as unknown as Omit<typeof import("../src/app/state.ts"), "engine" | "log" | "banners"> &
  { engine: Signal<AnyEngineState>, log: Signal<AnyLogItem[]>, banners: Signal<AnyBanner[]> };
const engine = await import("../src/app/engine.ts");
const { runCode, runCommand, clearLog, addFileGraph, MAX_GRAPHS } = await import("../src/app/run.ts");
const { keep, connectFiles, afterRun, downloadAll } = await import("../src/app/files.ts");
const { cycleTheme, applyTheme } = await import("../src/app/theme.ts");
const { decodeText } = await import("../src/app/files/open.ts");
const { watchViewport, KEYBOARD } = await import("../src/app/viewport.ts");

const tick = () => sleep(0);
/** A promise the test settles: ok(value), no(error). */
type Later<T = unknown> = Promise<T> & { ok(value?: T | PromiseLike<T>): void, no(error: unknown): void };
const later = <T = unknown>(): Later<T> => { let ok!: (value: T | PromiseLike<T>) => void, no!: (error: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; no = b; }); return Object.assign(p, { ok, no }); };
const ABOUT = { dofile: "0.1.0", engine: "OpenDTA", engine_commit: "abc", engine_patches: [], stata_version: 14 };
const result = (more: object = {}) => ({ rc: 0, error: null, error_command: null, log: "", results: { e: {}, r: {}, e_changed: false, r_changed: false },
  nobs: 0, nvars: 0, new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [], files: [], ...more });

// A client that does what the test says, when it says: each download(), start() and run() waits on a promise the test settles.
class FakeClient {
  declare onStatus: (status: StatusText) => void;
  declare onRestart: (reason: string, started: Promise<About>, kind: ResetKind) => void;
  declare resetAt: number | null;
  declare stopped: string[];
  declare restarts: [string, ResetKind][];
  declare runs: { code: string, options: RunOptions & { onLog?: (text: string) => void }, done: Later }[];
  declare calls: [string, object | undefined][];
  declare downloads: number;
  declare starts: number;
  declare forgot: number;
  declare downloading: Later;
  declare starting: Later;
  declare isCached: boolean | Promise<boolean>;
  declare signal: AbortSignal | undefined;
  declare progress: ((progress: Progress) => void) | undefined;
  constructor() {
    Object.assign(this, { onStatus: () => {}, onRestart: () => {}, resetAt: null, stopped: [], restarts: [], runs: [], calls: [],
      downloads: 0, starts: 0, forgot: 0 });
    this.downloading = later(); this.starting = later();
    this.isCached = (false);   // what cached() answers
  }
  async cached() { return this.isCached; }
  async forgetDownload() { this.forgot++; }
  download({ signal, onProgress }: { signal?: AbortSignal, onProgress?: (progress: Progress) => void }) {
    this.downloads++;
    this.signal = signal;
    signal?.addEventListener("abort", () => this.downloading.no(new DOMException("stopped", "AbortError")));
    this.progress = onProgress;
    return this.downloading;
  }
  start() { this.starts++; return this.starting; }
  run(code: string, options: RunOptions & { onLog?: (text: string) => void }) { const r = later(); this.runs.push({ code, options, done: r }); return r; }
  call(op: string, args?: object) { this.calls.push([op, args]); return Promise.resolve({ op }); }
  breakRun() { this.resetAt = 12345; }
  keepWaiting() { this.resetAt = null; }
  restart(reason: string, kind: ResetKind) {
    const old = this.starting;
    this.starting = later();
    this.restarts.push([reason, kind]);
    old.ok(this.starting);   // as client.js end(): a start in progress ends with the new worker's start
    this.onRestart(reason, this.starting as Promise<About>, kind);
    return this.starting;
  }
  stop(reason: string) {
    this.stopped.push(reason);
    this.starting.catch(() => {});   // as client.js end(): a start in progress rejects (kind "stopped"); none may be waiting
    this.starting.no(Object.assign(new Error(reason), { kind: "stopped" }));
  }
}
/** The page's store as files.ts and engine.ts use it; a test gives it a zip() when it needs one. */
type FakeStore = { blocked: boolean, onChange: null | (() => void), list: () => Promise<FileInfo[]>, zip?: () => Promise<Blob> };
const fakeStore = (paths: string[] = []): FakeStore => ({ blocked: false, onChange: null, list: async () => paths.map(path => ({ path, dir: false, size: 1, mtime: 1 })) });
const fakeLock = (free = true) => ({ asked: [] as { steal?: boolean }[], async take(o: { steal?: boolean } = {}) { this.asked.push(o); return free || Boolean(o.steal); } });

let client: FakeClient, store: ReturnType<typeof fakeStore>, lock: ReturnType<typeof fakeLock>;
function setUp({ free = true, snapshot = true, files = [], cached = false }:
  { free?: boolean, snapshot?: boolean, files?: string[], cached?: boolean | Promise<boolean> } = {}) {
  client = new FakeClient(); store = fakeStore(files); lock = fakeLock(free);
  client.isCached = cached;
  connectFiles(store as Parameters<typeof connectFiles>[0]);
  engine.connectEngine({ client: client as unknown as EngineClient, store, lock, snapshot, manual: false, storage: { persist: async () => true, persisted: async () => true } });
}
beforeEach(() => {
  stored.clear();
  Object.assign(S.engine, { value: { s: "none" } });
  S.dialog.value = null; S.banners.value = []; S.results.value = null; S.data.value = null; S.lastRun.value = null;
  S.about.value = null; S.memory.value = null; S.rows.value = null; S.macros.value = null; S.history.value = [];
  S.tabs.value = []; S.persisted.value = null; S.theme.value = "system";
  S.log.value = [];
  clearLog();
});

/** What the live region says over the next window(s). */
async function heard() {
  await sleep(70);
  return S.announce.value;
}

test("with nothing cached the page asks; Download counts bytes, the stages come from onStatus, then ready", async () => {
  setUp({ files: ["a.do"] });
  await engine.open();
  assert.deepEqual(S.engine.value, { s: "asking", forRun: false });
  assert.deepEqual(S.dialog.value, { d: "download", forRun: false });
  assert.deepEqual(S.files.value.map(f => f.path), ["a.do"], "the store was listed before the engine");
  const started = engine.start();
  assert.equal(S.engine.value.s, "downloading");
  client.progress!({ received: 10, total: 100 });
  assert.deepEqual([S.engine.value.received, S.engine.value.total], [10, 100]);
  client.downloading.ok({ cached: true, received: 100, total: 100 });
  await tick();
  assert.equal(S.engine.value.s, "starting");
  assert.equal(S.engine.value.stage, "download");
  assert.ok(S.engine.value.done!.download! >= 0, "the download's time is the first stage's");
  client.onStatus("downloading the engine");   // the cache read after download(): the same stage
  client.onStatus("unpacking the engine");
  client.onStatus("loading Python");
  assert.equal(S.engine.value.stage, "python");
  assert.deepEqual(Object.keys(S.engine.value.done!).sort(), ["download", "unpack"]);
  client.starting.ok(ABOUT);
  await started;
  assert.deepEqual(S.engine.value, { s: "ready" });
  assert.equal(S.about.value!.dofile, "0.1.0");
  assert.equal(S.dialog.value, null, "the dialog closed by itself");
  assert.deepEqual(client.calls.at(-1), ["memory", undefined]);
});

test("start files all cached: the page starts with no dialog", async () => {
  setUp({ cached: true });
  await engine.open();
  assert.equal(S.engine.value.s, "downloading");
  assert.equal(S.dialog.value, null);
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(S.engine.value.s, "ready");
});

test("Stop download declines; Run then asks for a run, and runs once the engine is ready", async () => {
  setUp();
  await engine.open();
  const started = engine.start();
  engine.stopDownload();
  await started;
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(S.dialog.value, null);
  assert.equal(await runCode("display 1", { kind: "file", path: "a.do", fresh_locals: true }), null);
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  client.downloading = later();
  engine.start();
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(client.runs.length, 1, "the run waited for the engine");
  assert.equal(client.runs[0].code, "display 1");
  assert.equal(client.runs[0].options.fresh_locals, true);
});

test("a failed download goes on to start(); a failed start is `failed` with its cause, a second failure `failed-twice`", async () => {
  setUp();
  await engine.open();
  let started = engine.start();
  client.downloading.no(Object.assign(new Error("offline"), { kind: "failed", reason: "download" }));
  await tick();
  assert.equal(S.engine.value.s, "starting", "start() reads what is cached");
  client.starting.no(Object.assign(new Error("no snapshot at /snapshot/"), { kind: "failed", reason: "download", name: "DownloadError" }));
  await started;
  assert.equal(S.engine.value.s, "failed");
  assert.equal(S.engine.value.reason, "download");
  assert.equal(S.engine.value.message, engine.FAILED.download, "plain words for the visitor");
  assert.equal(S.engine.value.detail, "no snapshot at /snapshot/", "the cause, for a developer");
  assert.equal(client.forgot, 0, "one failure keeps the cached files");

  client.downloading = later(); client.starting = later();
  started = engine.start();
  client.downloading.ok({ cached: true });
  client.starting.no(Object.assign(new Error("the engine's worker failed twice"), { kind: "failed-twice", reason: "memory" }));
  await started;
  assert.deepEqual(S.engine.value, { s: "failed-twice", reason: "memory", message: engine.FAILED_TWICE, detail: "the engine's worker failed twice" });
  assert.equal(client.forgot, 0, "memory: the files are not at fault, the cache stays");
  // failed twice is not started again by the page: a reload is the way out
  engine.start();
  assert.equal(S.engine.value.s, "failed-twice");
});

test("failed twice for reason unknown or download deletes the cached start files, so a reload downloads them fresh", async () => {
  for (const reason of ["unknown", "download"]) {
    setUp({ cached: true });
    await engine.open();
    client.downloading.ok({ cached: true });
    client.starting.no(Object.assign(new Error("the engine's worker failed twice"), { kind: "failed-twice", reason }));
    await sleep(5);
    assert.equal(S.engine.value.s, "failed-twice", reason);
    assert.equal(client.forgot, 1, reason);
    Object.assign(S.engine, { value: { s: "none" } });
  }
});

test("an empty or partial cache asks; the lock lost while cached() is pending starts nothing", async () => {
  setUp({ cached: false });   // cached() is false for an empty cache and for a partly filled one alike
  await engine.open();
  assert.deepEqual(S.engine.value, { s: "asking", forRun: false });
  assert.equal(client.downloads, 0, "nothing downloads before the visitor says so");

  Object.assign(S.engine, { value: { s: "none" } });
  S.dialog.value = null;
  const answer = later<boolean>();
  setUp({ cached: answer });
  const opening = engine.open();
  await sleep(5);
  engine.lost();   // another tab takes the lock while the cache is checked
  answer.ok(true);
  await opening;
  assert.deepEqual(S.engine.value, { s: "other-tab" });
  assert.equal(client.downloads, 0, "no download, no worker");
  assert.equal(client.starts, 0);
});

test("tab lock: without it the tab is blocked and asks; taking over steals the lock and starts; losing it stops the worker", async () => {
  setUp({ free: false, cached: true });
  await engine.open();
  assert.deepEqual(S.engine.value, { s: "other-tab" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.equal(store.blocked, true);
  assert.equal(S.files.value.length, 0, "a blocked tab does not even list");
  await engine.takeOver();
  assert.deepEqual(lock.asked.at(-1), { steal: true });
  assert.equal(store.blocked, false);
  assert.equal(S.dialog.value, null);
  assert.equal(S.engine.value.s, "downloading");
  engine.lost();
  assert.deepEqual(client.stopped, ["another tab took over"]);
  assert.equal(store.blocked, true);
  assert.deepEqual(S.engine.value, { s: "other-tab" });
});

async function readyEngine(opts?: Parameters<typeof setUp>[0]) {
  setUp({ cached: true, ...opts });
  await engine.open();
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(S.engine.value.s, "ready");
}

test("a run: the streamed log grows one item and the result's log replaces it; graphs, lastRun, results and the after-run calls", async () => {
  await readyEngine();
  const head: RunHead = { kind: "selection", path: "a.do", lines: [11, 14], fresh_locals: false };
  const done = runCode("x", head);
  assert.equal(S.engine.value.s, "running");
  const { options, done: answer } = client.runs[0];
  options.onLog!(". display 1\n");
  options.onLog!("1\n");
  const texts = () => S.log.value.filter(i => i.t === "text");
  assert.equal(texts().length, 1);
  assert.equal(texts()[0].text, ". display 1\n1\n");
  assert.equal(texts()[0].streaming, true);
  assert.deepEqual(S.log.value.find(i => i.t === "runhead"), { t: "runhead", run: head, first: true });
  answer.ok(result({ rc: 111, log: ". display 1\n1\n(the complete log)\n", error_line: 3, images: ["PNG"], graph_commands: ["scatter y x"],
    graph_lines: [2], files: [{ name: "out.png", status: "created", bytes: 3 }] }));
  await done;
  assert.equal(texts()[0].text, ". display 1\n1\n(the complete log)\n", "replaced, not appended");
  assert.equal(texts()[0].streaming, false);
  assert.deepEqual(S.graphs.value.map(g => [g.n, g.command, g.line, g.theme]), [[1, "scatter y x", 2, "light"]]);
  assert.deepEqual(S.log.value.at(-1), { t: "graph", n: 1 });
  assert.deepEqual(S.lastRun.value, { ...head, rc: 111, line: 13, seconds: S.lastRun.value!.seconds }, "the error line in the file");
  assert.deepEqual([...S.fresh.value], ["out.png"]);
  assert.deepEqual(client.calls.slice(-4).map(c => c[0]), ["describe", "browse", "macros", "memory"]);
  assert.deepEqual(S.data.value, { op: "describe" });
  assert.equal(S.engine.value.s, "ready");
  // the next run in the same session is not the first
  runCode("y", { kind: "file", path: "a.do", fresh_locals: true });
  assert.equal(S.log.value.filter(i => i.t === "runhead").at(-1)!.first, false);
  client.runs[1].done.ok(result());
});

test("a reset cuts a run: `starting` first, the reset banner, results cleared; the cut run keeps what streamed and says why", async () => {
  await readyEngine();
  S.results.value = { e: {}, r: {}, e_changed: true, r_changed: false } as Results;
  const done = runCode("loop", { kind: "file", path: "a.do", fresh_locals: true });
  client.runs[0].options.onLog!("pass 1\n");
  client.restart("the engine crashed", "crash");
  assert.equal(S.engine.value.s, "starting");
  assert.deepEqual(S.banners.value, [{ b: "reset", reason: "the engine crashed", kind: "crash" }]);
  assert.equal(S.results.value, null);
  client.runs[0].done.ok(result({ rc: 9998, error: "session reset: the engine crashed. Data in memory is gone; your files are kept.",
    log: "", results: null, kind: "crash" }));
  await done;
  assert.equal(S.engine.value.s, "starting", "the cut run left the state to the restart");
  assert.equal(S.log.value.find(i => i.t === "text")!.text, "pass 1\n");
  assert.match(S.log.value.at(-1)!.text!, /session reset: the engine crashed/);
  assert.equal(S.results.value, null);
  assert.equal(S.lastRun.value!.rc, 9998, "the cut run is the last run");
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(S.engine.value.s, "ready");
  // the new engine has no locals yet: its first run says so, although the cut run ended after the reset began
  runCode("display 1", { kind: "selection", path: "a.do", lines: [1, 1], fresh_locals: false });
  assert.equal(S.log.value.filter(i => i.t === "runhead").at(-1)!.first, true);
  client.runs[1].done.ok(result());
});

test("Break: `breaking` with the deadline, then `waiting` on Don't reset; the run's end makes it `ready`", async () => {
  await readyEngine();
  const done = runCode("long", { kind: "file", path: "a.do", fresh_locals: true });
  engine.breakRun();
  assert.equal(S.engine.value.s, "breaking");
  assert.equal(S.engine.value.resetAt, 12345);
  engine.keepWaiting();
  assert.equal(S.engine.value.s, "waiting");
  assert.equal(client.resetAt, null);
  client.runs[0].done.ok(result({ rc: 1, log: "--Break--\nr(1);\n" }));
  await done;
  assert.equal(S.engine.value.s, "ready");
  assert.equal(S.lastRun.value!.rc, 1);
});

// SPEC section 7, test 13: keepFiles answers at once with persisted(), and again when persist() is answered; the page's
// signal gets each answer
test("a false persisted() reaches the `persisted` signal, and persist()'s answer follows it", async () => {
  const asked = later<boolean>();
  const storage = { persisted: async () => false, persist: () => asked };
  S.persisted.value = null;
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
  const done = runCode("x", { kind: "file", path: "a.do", fresh_locals: true });
  client.runs[0].done.ok(result({ results: { e: {}, r: {}, e_changed: true, r_changed: false } }));
  await done;
  const left = ["results", "macros", "data", "rows", "memory", "about", "lastRun"] as const;
  for (const k of left) assert.notEqual(S[k].value, null, k);
  engine.lost();
  for (const k of left) assert.equal(S[k].value, null, `${k} after the lock was lost`);
  client.downloading = later(); client.starting = later();
  await engine.takeOver();
  client.downloading.ok({ cached: true });
  await tick();
  assert.equal(S.engine.value.s, "starting");
  for (const k of ["results", "data", "rows", "macros", "lastRun"] as const) assert.equal(S[k].value, null, `${k} after the take-over`);
});

test("a crash during the first start: ready once, no reset banner and no \"Engine reset\" (no engine had been ready)", async () => {
  setUp({ cached: true });
  await engine.open();
  await heard();
  let readies = 0;
  const off = S.engine.subscribe(st => { if (st.s === "ready") readies++; });
  client.downloading.ok({ cached: true });
  await tick();
  client.onStatus("unpacking the engine");
  client.restart("the engine crashed (x)", "crash");   // the client restarts a worker that failed by itself
  assert.equal(S.engine.value.s, "starting");
  assert.deepEqual(S.banners.value, []);
  client.starting.ok(ABOUT);   // the first start() and the restart's `started` both end with this
  await sleep(5);
  off();
  assert.equal(S.engine.value.s, "ready");
  assert.equal(readies, 1, "ready() ran once");
  assert.equal(client.calls.filter(c => c[0] === "memory").length, 1);
  const words = await heard();
  assert.doesNotMatch(words, /Engine reset/);
  assert.match(words, /Engine ready/);
});

test("start() runs only from none, asking, declined or failed; a second take-over press steals the lock once", async () => {
  setUp();
  await engine.open();
  assert.equal(S.engine.value.s, "asking");
  engine.start();
  engine.start();   // a second press of Download while it downloads
  assert.equal(client.downloads, 1, "one download");
  client.downloading.ok({ cached: true });
  await tick();
  engine.start();   // while starting
  assert.equal(client.downloads, 1);
  assert.equal(client.starts, 1);

  setUp({ free: false, cached: true });
  await engine.open();
  await Promise.all([engine.takeOver(), engine.takeOver()]);
  assert.equal(lock.asked.filter(o => o.steal).length, 1, "the lock was stolen once");
  assert.equal(S.engine.value.s, "downloading");
  await engine.takeOver();   // not from other-tab: nothing
  assert.equal(lock.asked.filter(o => o.steal).length, 1);
});

test("an updated site fails with reason \"updated\", from download() at once or from the worker's UpdatedError, in plain words; no message names ?snapshot=0", async () => {
  setUp();
  await engine.open();
  let started = engine.start();
  client.downloading.no(Object.assign(new Error("dofile was updated: reload the page"), { kind: "updated" }));
  await tick();
  assert.equal(S.engine.value.s, "failed");
  assert.equal(S.engine.value.reason, "updated");
  assert.equal(S.engine.value.message, engine.UPDATED, "plain words: a newer version, reload");
  assert.match(engine.UPDATED, /newer version.*reload the page/);
  assert.equal(client.starts, 0, "no start after an updated download");
  await started;

  const fail = (more: object) => {
    client.downloading = later(); client.starting = later();
    started = engine.start();
    client.downloading.ok({ cached: true });
    client.starting.no(Object.assign(new Error("it failed"), { kind: "failed", reason: "unknown", ...more }));
    return started;
  };
  const stale = "the snapshot was built from a different build of dofile.whl than this page has: run `npm run snapshot` again";
  await fail({ name: "UpdatedError", message: stale });
  assert.equal(S.engine.value.reason, "updated");
  assert.equal(S.engine.value.message, engine.UPDATED, "the plain words");
  assert.equal(S.engine.value.detail, stale, "the cause, for a developer");
  await fail({ name: "SnapshotError", message: "snapshot: a file is 10 bytes, the manifest says 99" });
  assert.equal(S.engine.value.reason, "unknown");
  assert.equal(S.engine.value.message, engine.FAILED.unknown);
  assert.equal(S.engine.value.detail, "snapshot: a file is 10 bytes, the manifest says 99");
  await fail({ name: "Error", reason: "memory", message: "dofile has a newer version (not from the text)" });
  assert.equal(S.engine.value.reason, "memory", "the reason comes from the name and reason, not the text");
  await fail({ name: "DownloadError", reason: "download", message: "a start file did not arrive" });
  assert.equal(S.engine.value.message, engine.FAILED.download);
  assert.equal(S.engine.value.detail, "a start file did not arrive");

  setUp({ snapshot: false });
  await engine.open();
  await fail({ name: "UpdatedError", message: stale });
  assert.deepEqual([S.engine.value.message, S.engine.value.detail], [engine.UPDATED, stale], "the same on the normal start");
});

test("a failed start's message is plain words for every reason, with no developer terms; the cause is `detail` and goes to the console", async () => {
  const dev = /npm|snapshot|manifest|bytes|worker|wheel|\.js|\.json|\?|`/i;
  for (const m of [...Object.values(engine.FAILED), engine.FAILED_TWICE]) assert.doesNotMatch(m, dev, m);
  const warn = mock.method(console, "warn", () => {});
  try {
    for (const [kind, reason, name] of [["failed", "no-wasm"], ["failed", "download", "DownloadError"], ["failed", "memory"],
      ["failed", "unknown", "UpdatedError"], ["failed", "unknown", "SnapshotError"], ["failed", "unknown"], ["failed", "odd"],
      ["failed-twice", "memory"], ["failed-twice", "unknown"]]) {
      setUp();
      await engine.open();
      const started = engine.start();
      client.downloading.ok({ cached: true });
      const cause = "snapshot: a file is 10 bytes, the manifest says 99; run `npm run snapshot` again";
      client.starting.no(Object.assign(new Error(cause), { kind, reason, name: name ?? "Error" }));
      await started;
      const st = S.engine.value;
      assert.equal(st.s, kind);
      assert.doesNotMatch(st.message!, dev, `${kind} ${reason}`);
      assert.equal(st.detail, cause);
      assert.match(String(warn.mock.calls.at(-1)!.arguments[0]), /npm run snapshot/);
    }
  } finally {
    warn.mock.restore();
  }
});

test("Reset: the banner carries the kind; the reason is the user's", async () => {
  await readyEngine();
  engine.reset();
  assert.deepEqual(S.banners.value, [{ b: "reset", reason: "reset by you", kind: "user" }]);
  assert.deepEqual(client.restarts, [["reset by you", "user"]]);
});

test("say(): what is said in one tick is heard together; a reset says \"Engine reset\", not \"Download the engine\"", async () => {
  await heard();
  S.say("Engine reset");
  S.say("Run ended: the engine was reset");
  assert.equal(await heard(), "Engine reset. Run ended: the engine was reset");
  S.say("Run finished");
  assert.equal(S.announce.value, "", "the empty step: the same words again are a change");
  assert.equal(await heard(), "Run finished");
  await readyEngine();
  await heard();
  client.restart("the engine crashed", "crash");
  assert.equal(await heard(), "Engine reset");
});

test("the page's store is blocked until the tab lock answers", async () => {
  const { store } = await import("../src/app/store.ts");
  assert.equal(store.blocked, true);
  await assert.rejects(store.write("a.do", new Uint8Array(1)), /another tab/);
});

test("runCode while a run is on does nothing; a queued run is dropped by Not now and by a failed start", async () => {
  await readyEngine();
  const head: RunHead = { kind: "file", path: "a.do", fresh_locals: true };
  const first = runCode("a", head);
  assert.equal(await runCode("b", head), null);
  assert.equal(client.runs.length, 1);
  client.runs[0].done.ok(result());
  await first;

  setUp();   // nothing cached: the prompt
  await engine.open();
  engine.decline();
  assert.equal(await runCode("queued", head), null);
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  engine.decline();
  engine.start();
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(S.engine.value.s, "ready");
  assert.equal(client.runs.length, 0, "Not now dropped the run");

  stored.clear();
  setUp();
  await engine.open();
  await runCode("queued", head);
  let started = engine.start();
  client.downloading.ok({ cached: true });
  client.starting.no(Object.assign(new Error("no"), { kind: "failed", reason: "unknown" }));
  await started;
  client.downloading = later(); client.starting = later();
  started = engine.start();
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.equal(S.engine.value.s, "ready");
  assert.equal(client.runs.length, 0, "the failed start dropped the run");
});

test("Clear log during a run keeps the run's text item, so its log still arrives; the graph numbers start again", async () => {
  await readyEngine();
  const done = runCode("x", { kind: "file", path: "a.do", fresh_locals: true });
  client.runs[0].options.onLog!("1\n");
  clearLog();
  assert.deepEqual(S.log.value.map(i => i.t), ["text"]);
  client.runs[0].done.ok(result({ log: "1\n2\n", images: ["PNG"], graph_commands: ["scatter y x"], graph_lines: [1] }));
  await done;
  assert.equal(S.log.value[0].text, "1\n2\n");
  assert.equal(S.graphs.value[0].n, 1);
});

test("a run whose op failed in the worker (run-failed) is not a reset: the data is asked again, and no reset is said", async () => {
  await readyEngine();
  await heard();
  S.results.value = { e: {}, r: {}, e_changed: true, r_changed: false } as Results;
  const before = client.calls.length;
  const done = runCode("x", { kind: "file", path: "a.do", fresh_locals: true });
  client.runs[0].options.onLog!("partial\n");
  client.runs[0].done.ok(result({ rc: 9998, error: "no memory for the result", log: "", results: null, kind: "run-failed" }));
  await done;
  assert.equal(S.log.value.find(i => i.t === "text")!.text, "partial\n");
  assert.equal(S.log.value.at(-1)!.text, "no memory for the result");
  assert.notEqual(S.results.value, null, "the results are not cleared");
  assert.deepEqual(client.calls.slice(before).map(c => c[0]), ["describe", "browse", "macros", "memory"]);
  assert.doesNotMatch(await heard(), /reset/);
});

test("a run's graphs keep the theme the run was sent, not the one at its end", async () => {
  await readyEngine();
  S.theme.value = "light";
  const done = runCode("x", { kind: "file", path: "a.do", fresh_locals: true });
  assert.equal(client.runs[0].options.plot_theme, "light");
  S.theme.value = "dark";
  client.runs[0].done.ok(result({ images: ["PNG"], graph_commands: ["scatter y x"], graph_lines: [1] }));
  await done;
  assert.equal(S.graphs.value.at(-1)!.theme, "light");
});

test("each run's text item keeps how it ended (rc, line, skipped, store_error) and the files unsaved when it started", async () => {
  await readyEngine();
  S.tabs.value = [{ path: "a.do", kind: "text", dirty: false }, { path: "clean.do", kind: "text", dirty: true }];
  const head: RunHead = { kind: "selection", path: "a.do", lines: [5, 9], fresh_locals: false };
  const done = runCode("x", head);
  assert.deepEqual(S.log.value.find(i => i.t === "text")!.unsaved, ["clean.do"]);
  client.runs[0].done.ok(result({ rc: 1, error_line: 2, skipped: ["gone/out.csv"], store_error: "quota" }));
  await done;
  const end = S.log.value.find(i => i.t === "text")!.end;
  assert.deepEqual({ ...end, seconds: 0 }, { ...head, rc: 1, line: 6, seconds: 0, skipped: ["gone/out.csv"], store_error: "quota" });
  assert.equal(S.lastRun.value, end, "lastRun is the same record");
  runCode("y", { kind: "file", path: "a.do", fresh_locals: true });
  assert.equal(S.log.value.filter(i => i.t === "text")[0].end!.rc, 1, "an older run keeps its own");
  client.runs[1].done.ok(result());
});

test("runCommand: added to history (not twice in a row), run as a command with the locals kept, no run-head", async () => {
  await readyEngine();
  const heads = S.log.value.filter(i => i.t === "runhead").length;
  assert.equal(runCommand("  summarize  ").accepted, true);
  assert.deepEqual(S.history.value, ["summarize"]);
  assert.equal(client.runs[0].code, "summarize");
  assert.equal(client.runs[0].options.fresh_locals, false);
  assert.equal(S.log.value.filter(i => i.t === "runhead").length, heads);
  client.runs[0].done.ok(result());
  await sleep(5);
  const again = runCommand("summarize");
  assert.deepEqual(S.history.value, ["summarize"]);
  client.runs[1].done.ok(result());
  assert.equal((await again.done)!.rc, 0, "done resolves with the result");
  const empty = runCommand("   ");
  assert.equal(empty.accepted, false);
  assert.equal(await empty.done, null);
});

test("runCommand: a command that does not run is refused (not in history, so the field keeps it); one that runs or is queued is accepted, an error too", async () => {
  await readyEngine();
  const first = runCommand("regress y x");
  assert.equal(first.accepted, true);
  // a run is on: refused, nothing sent, history unchanged
  const busy = runCommand("describe");
  assert.equal(busy.accepted, false);
  assert.equal(await busy.done, null);
  assert.equal(client.runs.length, 1);
  assert.deepEqual(S.history.value, ["regress y x"]);
  client.runs[0].done.ok(result({ rc: 111, log: "r(111);\n" }));
  await first.done;
  assert.deepEqual(S.history.value, ["regress y x"], "a command that ran and failed stays in history");

  // starting (a reset): refused
  engine.reset();
  assert.equal(S.engine.value.s, "starting");
  assert.equal(runCommand("summarize").accepted, false);
  assert.deepEqual(S.history.value, ["regress y x"]);

  // no engine (declined): queued, which counts as accepted; while the prompt asks, refused
  stored.clear();
  setUp();
  await engine.open();
  engine.decline();
  S.history.value = [];
  const queued = runCommand("use wages");
  assert.equal(queued.accepted, true);
  assert.deepEqual(S.dialog.value, { d: "download", forRun: true });
  assert.deepEqual(S.history.value, ["use wages"]);
  assert.equal(runCommand("summarize").accepted, false, "asking: refused");
  assert.deepEqual(S.history.value, ["use wages"]);
  engine.start();
  client.downloading.ok({ cached: true });
  client.starting.ok(ABOUT);
  await sleep(5);
  assert.deepEqual(client.runs.map(r => r.code), ["use wages"], "the queued command ran once the engine was ready");
  client.runs[0].done.ok(result());
});

test("addFileGraph: the same .png opened again replaces its entry (new image, same n) and is selected", async () => {
  await readyEngine();
  const a = addFileGraph("a.png", "A1");
  addFileGraph("b.png", "B");
  assert.equal(S.graphIndex.value, 1);
  const again = addFileGraph("a.png", "A2");
  assert.deepEqual(S.graphs.value.map(g => [g.n, g.path, g.png]), [[a.n, "a.png", "A2"], [a.n + 1, "b.png", "B"]], "no duplicate");
  assert.equal(again.n, a.n);
  assert.equal(S.graphIndex.value, 0, "the reopened one is shown");
  assert.equal(S.graphs.value[S.graphIndex.value], again);
});

test("addFileGraph: a .png gets the next number after the run's graphs; graphs keep the last 20, so look one up by n", async () => {
  await readyEngine();
  const done = runCode("x", { kind: "file", path: "a.do", fresh_locals: true });
  client.runs[0].done.ok(result({ images: ["A", "B"], graph_commands: ["a", "b"], graph_lines: [1, 2] }));
  await done;
  const g = addFileGraph("plots/p.png", "PNG");
  assert.deepEqual([g.n, g.from, g.path], [3, "file", "plots/p.png"]);
  assert.equal(S.graphs.value[S.graphIndex.value], g);
  for (let i = 0; i < MAX_GRAPHS; i++) addFileGraph(`p${i}.png`, "PNG");
  assert.equal(S.graphs.value.length, MAX_GRAPHS);
  assert.equal(S.graphs.value.findIndex(x => x.n === 3), -1, "the oldest went");
  assert.equal(S.graphs.value[0].n, 4);
});

test("the storage banner: once per visit, when persisted() is false and the files change", async () => {
  setUp();
  S.persisted.value = true;
  store.onChange!();
  assert.deepEqual(S.banners.value, []);
  S.persisted.value = false;
  store.onChange!();
  assert.deepEqual(S.banners.value, [{ b: "storage" }]);
  S.dismiss({ b: "storage" });
  store.onChange!();
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(S.banners.value, [], "once per visit");
  setUp();   // a new visit
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(S.banners.value, [{ b: "storage" }], "a run's files count too");
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
  assert.deepEqual(S.banners.value.map(b => b.path ?? b.reason), ["a.xlsx", "b.xlsx", "two"]);
  S.dismiss({ b: "not-text", path: "a.xlsx" });
  assert.deepEqual(S.banners.value.map(b => b.path ?? b.reason), ["b.xlsx", "two"]);
});

test("Download all with nothing to download (no files, or folders only) makes no zip, says nothing and resolves false", async () => {
  setUp();
  await heard();
  S.announce.value = "";
  let zips = 0;
  store.zip = async () => { zips++; return new Blob([]); };
  assert.equal(await downloadAll(), false);
  store.list = async () => [{ path: "data", dir: true, size: 0, mtime: 1 }];
  await afterRun([]);   // lists the store again
  assert.equal(S.hasFiles.value, false, "a folder is not a file");
  assert.equal(await downloadAll(), false);
  assert.equal(zips, 0, "no empty zip");
  assert.equal(await heard(), "", "nothing said");
  assert.deepEqual(S.banners.value, [], "nothing shown");
  store.list = async () => [{ path: "data", dir: true, size: 0, mtime: 1 }, { path: "data/a.dta", dir: false, size: 1, mtime: 1 }];
  await afterRun([]);
  assert.equal(S.hasFiles.value, true);
});

test("Download all: a store that cannot make the zip adds one banner (a second failure replaces it) and says so once; a download that works removes it", async () => {
  setUp({ files: ["a.do"] });
  await heard();
  S.toast.value = null;
  const warn = mock.method(console, "warn", () => {});
  store.zip = async () => { throw new Error("the database is closed"); };
  const doc = globalThis.document;
  try {
    assert.equal(await downloadAll(), false);
    assert.deepEqual(S.banners.value, [{ b: "download-failed" }]);
    assert.equal(S.toast.value, null, "a toast only confirms (SPEC 3.10)");
    assert.equal(await heard(), "Your files couldn't be downloaded");
    assert.match(String(warn.mock.calls[0].arguments[0]), /the database is closed/);
    assert.equal(await downloadAll(), false);   // "Try again", failing again
    assert.deepEqual(S.banners.value, [{ b: "download-failed" }], "replaced, not stacked");
    // a download that works: the zip goes to the browser and the banner goes
    let clicked = 0;
    globalThis.document = { createElement: () => ({ click: () => { clicked++; }, remove() {} }), body: { append() {} } } as unknown as Document;
    store.zip = async () => new File(["zip"], "dofile.zip");
    assert.equal(await downloadAll(), true);
    assert.equal(clicked, 1);
    assert.deepEqual(S.banners.value, []);
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
  S.tabs.value = [{ path: "a.do", kind: "text", dirty: false }, { path: "b.do", kind: "text", dirty: false }];
  S.setDirty("b.do", true);
  assert.deepEqual(S.tabs.value.map(t => t.dirty), [false, true]);
  const before = S.tabs.value;
  S.setDirty("b.do", true);
  S.setDirty("gone.do", true);
  assert.equal(S.tabs.value, before, "no change, no new list");
  assert.equal(decodeText(new TextEncoder().encode("café\n")), "café\n");
  assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])), null, "Latin-1 is not text");
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])), "a", "a leading BOM is dropped, as before");
});

// ---- the second review of step 3 ----

test("A1: a tab that loses the lock while open() lists the files starts no engine; \"Use dofile in this tab\" still works", async () => {
  setUp({ cached: true });
  const listed = later<FileInfo[]>();
  store.list = () => listed;
  const opening = engine.open();
  await tick();
  engine.lost();   // another tab takes the lock during refresh()
  listed.ok([]);
  await opening;
  assert.deepEqual(S.engine.value, { s: "other-tab" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.equal(store.blocked, true);
  assert.equal(client.downloads, 0, "no download, no worker");
  assert.equal(client.starts, 0);
  await engine.takeOver();   // the dialog's button acts
  assert.equal(S.engine.value.s, "downloading");
  assert.equal(S.dialog.value, null);
  assert.equal(store.blocked, false);
});

test("A1: a take-over whose lock is taken back while it waits for the lock starts no engine; a second press acts", async () => {
  setUp({ free: false, cached: true });
  await engine.open();
  assert.deepEqual(S.engine.value, { s: "other-tab" });
  const granted = later<boolean>();
  lock.take = async o => { lock.asked.push(o ?? {}); return o?.steal ? granted : false; };
  const taking = engine.takeOver();
  await tick();
  engine.lost();   // the other tab steals it back
  granted.ok(true);
  await taking;
  assert.deepEqual(S.engine.value, { s: "other-tab" });
  assert.deepEqual(S.dialog.value, { d: "other-tab" }, "the dialog stays");
  assert.equal(store.blocked, true);
  assert.equal(client.downloads, 0);
  lock.take = async o => { lock.asked.push(o ?? {}); return true; };
  await engine.takeOver();
  assert.equal(lock.asked.filter(o => o.steal).length, 2, "the second press stole again");
  assert.equal(S.engine.value.s, "downloading");
  assert.equal(S.dialog.value, null);
});

test("A2: reset() acts only in ready, running, breaking and waiting; never in failed-twice or while downloading", async () => {
  setUp();
  await engine.open();
  let started = engine.start();
  assert.equal(S.engine.value.s, "downloading");
  await engine.reset();
  assert.deepEqual(client.restarts, [], "not during a download");
  assert.equal(S.engine.value.s, "downloading");
  client.downloading.ok({ cached: true });
  client.starting.no(Object.assign(new Error("the engine's worker failed twice"), { kind: "failed-twice", reason: "memory" }));
  await started;
  assert.equal(S.engine.value.s, "failed-twice");
  await engine.reset();   // the Reset dialog confirmed after the engine failed twice
  assert.deepEqual(client.restarts, [], "a worker that must stay stopped is not restarted");
  assert.equal(S.engine.value.s, "failed-twice");
  await readyEngine();
  engine.reset();
  assert.deepEqual(client.restarts, [["reset by you", "user"]], "ready: it resets");
});

// reset() is refused in `starting` (A2), so the second restart is the client's own: the new worker crashed while it started
test("A3: two restarts in a row, then one start resolves: ready once", async () => {
  await readyEngine();
  engine.reset();
  let readies = 0;
  const off = S.engine.subscribe(st => { if (st.s === "ready") readies++; });   // it calls at once: now `starting`
  client.restart("the engine crashed", "crash");   // the first restart's `started` ends with the second one's
  client.starting.ok(ABOUT);
  await sleep(5);
  off();
  assert.equal(S.engine.value.s, "ready");
  assert.equal(readies, 1, "ready() ran once");
});

test("C1: a run cut by losing the tab lock does not set lastRun", async () => {
  await readyEngine();
  const done = runCode("long", { kind: "file", path: "a.do", fresh_locals: true });
  engine.lost();
  assert.equal(S.lastRun.value, null);
  client.runs[0].done.ok(result({ rc: 9998, error: "session reset: another tab took over", log: "", results: null, kind: "stopped" }));
  await done;
  assert.equal(S.lastRun.value, null, "not after the other-tab clear");
  assert.equal(S.log.value.find(i => i.t === "text")!.end!.rc, 9998, "the log keeps how it ended");
});

test("C2: \"Not now\" during the download aborts it: no start follows", async () => {
  setUp();
  await engine.open();
  const started = engine.start();
  assert.equal(S.engine.value.s, "downloading");
  engine.decline();
  assert.equal(client.signal!.aborted, true);
  client.downloading.ok({ cached: true });   // too late: the abort rejected it
  await started;
  await tick();
  assert.deepEqual(S.engine.value, { s: "declined" });
  assert.equal(client.starts, 0);
});

test("the phone keyboard: watchViewport sets data-keyboard and --vv-height/--vv-top while the visual viewport is clearly shorter, not when zoomed or off the phone", () => {
  // a visualViewport as iOS Safari reports it: the layout viewport stays 844 px tall when the keyboard opens
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = { dataset: {} as DOMStringMap, style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) } };
  let phone = true;
  const { update, stop } = watchViewport({ vv: vv as VisualViewport, root: root as unknown as HTMLElement, layoutHeight: () => 844, enabled: () => phone });
  const move = (height: number, offsetTop = 0, scale = 1) => { Object.assign(vv, { height, offsetTop, scale }); vv.dispatchEvent(new Event("resize")); };
  assert.equal("keyboard" in root.dataset, false, "closed at the start");
  assert.equal(vars.size, 0);

  move(844 - KEYBOARD + 10);   // Safari's toolbars, not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508);                   // the keyboard opens
  assert.equal("keyboard" in root.dataset, true);
  assert.equal(vars.get("--vv-height"), "508px");
  assert.equal(vars.get("--vv-top"), "0px");
  Object.assign(vv, { offsetTop: 120 }); vv.dispatchEvent(new Event("scroll"));   // Safari pans to the field
  assert.equal(vars.get("--vv-top"), "120px");
  move(844);                   // closed again: nothing set
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  move(422, 200, 2);           // a pinch to 2x: smaller, but no keyboard
  assert.equal("keyboard" in root.dataset, false);
  move(508);
  phone = false; update();     // the layout is no longer the phone's
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  stop();
  phone = true; move(508);     // no longer listening
  assert.equal("keyboard" in root.dataset, false);
  assert.deepEqual(watchViewport({ vv: null, root: root as unknown as HTMLElement }).update(), undefined, "no visualViewport: nothing to do");
});

test("the phone keyboard where the browser shrinks the layout viewport: open while a text field has the focus and the page is well below its tallest at this width; not on a rotation or without focus", () => {
  // an older Android browser: the layout and visual viewports shrink together, so they never differ
  let h = 800, w = 390, focused = false;
  const vv = Object.assign(new EventTarget(), { height: h, offsetTop: 0, scale: 1 });
  const vars = new Map<string, string>();
  const root = { dataset: {} as DOMStringMap, style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) } };
  const { stop } = watchViewport({ vv: vv as VisualViewport, root: root as unknown as HTMLElement, layoutHeight: () => h, layoutWidth: () => w, typing: () => focused });
  const resize = (height: number, width = w) => { h = height; w = width; vv.height = height; vv.dispatchEvent(new Event("resize")); };

  focused = true;
  resize(800 - KEYBOARD + 10);   // the toolbar hides or shows: not a keyboard
  assert.equal("keyboard" in root.dataset, false);
  resize(450);                   // the keyboard opens with a field focused
  assert.equal("keyboard" in root.dataset, true);
  assert.equal(vars.get("--vv-height"), "450px");
  assert.equal(vars.get("--vv-top"), "0px");
  resize(800);                   // closed
  assert.equal("keyboard" in root.dataset, false);
  assert.equal(vars.size, 0);

  focused = false;
  resize(450);                   // shorter, but nothing takes typing (a split screen, say)
  assert.equal("keyboard" in root.dataset, false);
  focused = true;
  resize(390, 800);              // a rotation to landscape: a new width starts again from this height
  assert.equal("keyboard" in root.dataset, false);
  resize(390 - KEYBOARD - 50, 800);   // then the keyboard in landscape
  assert.equal("keyboard" in root.dataset, true);
  stop();
});
