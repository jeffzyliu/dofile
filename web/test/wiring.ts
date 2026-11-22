// The stand-in transport, store and tab lock, and the wiring of the controllers (src/app/engine.ts, run.ts, files.ts)
// that the app-*.test.ts files share.
//
// Every wiring ends with the drop record as the test expects it: empty, unless the test provokes a race and names the
// events that must be dropped (expectDrops). It is asserted when the wiring is replaced (setUp) and when the test ends
// (useWiring), so a stale or invalid event in an earlier wiring of a test fails it too.
//
// The localStorage stand-in must exist before the controllers are imported: keep these `await import`s below it.

import assert from "node:assert/strict";
import { afterEach, beforeEach } from "node:test";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import type { Banner, EngineState, EngineStateName, LastRun, LogItem, RunHead } from "../src/app/types.ts";
import type { Builds, Lifecycle, Reader } from "../src/engine/client.ts";
import type { Ending, Reply } from "../src/engine/machine.ts";
import type {
  Build,
  CrashCause,
  Downloaded,
  FileInfo,
  Ops,
  Progress,
  ReadOps,
  ResetKind,
  RunResult,
  StoreCause,
} from "../src/engine/types.ts";
import { sleep } from "./harness.ts";

// A log item and a banner with every member's fields, for reading in assertions: a test reads the fields of the member
// it expects.
export type AnyLogItem = { t: LogItem["t"] } & Partial<{
  run: RunHead | number;
  first: boolean;
  text: string;
  streaming: boolean;
  unsaved: string[];
  end: LastRun;
  n: number;
}>;
export type AnyBanner = { b: Banner["b"] } & Partial<{
  reason: string;
  kind: ResetKind;
  cause: CrashCause | StoreCause | null;
  path: string;
  message: string;
}>;

// localStorage, as the page has it (Node's needs a file)
export const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k: string, v: unknown) => stored.set(k, String(v)),
    removeItem: (k: string) => stored.delete(k),
  },
});

export const S = await import("../src/app/state.ts");
/** The open tabs and their documents. */
export const D = await import("../src/app/editor/documents.ts");
export const engine = await import("../src/app/engine.ts");
export const { runCode, runCommand, clearLog, canClearLog, moreRows, handlers } = await import("../src/app/run.ts");
export const { addFileGraph, MAX_GRAPHS } = await import("../src/app/graphs.ts");
export const { keep, connectFiles, afterRun, downloadAll } = await import("../src/app/files.ts");
export const { startEngine } = await import("../src/app/start.ts");
export const { cycleTheme, applyTheme } = await import("../src/app/theme.ts");
export const { decodeText } = await import("../src/app/files/open.ts");
export const { watchViewport, KEYBOARD, SETTLE } = await import("../src/app/viewport.ts");

/** The engine's state, which must be `name`: that member of EngineState, with its own fields. */
export function state<N extends EngineStateName>(name: N): Extract<EngineState, { s: N }> {
  const st = S.engine.value;
  assert.equal(st.s, name);
  return st as Extract<EngineState, { s: N }>;
}
export const logItems = (): AnyLogItem[] => S.log.value;
export const banners = (): AnyBanner[] => S.banners.value;
/** A read-only signal, to set up or clear in a test what only its owner writes in the page. */
export const writable = <T>(signal: ReadonlySignal<T>) => signal as Signal<T>;

export const tick = () => sleep(0);
/** A promise the test settles: ok(value), no(error). A rejection nobody waits for is not an error. */
export type Later<T = unknown> = Promise<T> & { ok(value?: T | PromiseLike<T>): void; no(error: unknown): void };
export const later = <T = unknown>(): Later<T> => {
  let ok!: (value: T | PromiseLike<T>) => void, no!: (error: unknown) => void;
  const p = new Promise<T>((a, b) => {
    ok = a;
    no = b;
  });
  p.catch(() => {});
  return Object.assign(p, { ok, no }) as Later<T>;
};
export const result = (more: object = {}) =>
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
export const failure = (message: string, more: object) => Object.assign(new Error(message), more);
export const SENTENCE = (reason: string) => `session reset: ${reason}. Data in memory is lost; your files are kept.`;
export const BUILD: Build = {
  built: 777,
  files: { snapshot: { name: "heap.bin", raw: 4, size: 2 }, bundle: { name: "bundle.bin", raw: 4, size: 2 } },
};
/** What download() resolves with when the files are in the Cache. */
export const DONE: Downloaded = { cached: true, received: 100, total: 100, build: BUILD };
export const CRASH = { type: "crashed", cause: "error", reason: "unknown", detail: "boom" } as const;
export const FILE: RunHead = { kind: "file", path: "a.do", fresh_locals: true };

export type FakeRun = { args: Ops["run"]["args"]; onLog: (text: string) => void; done: Later<RunResult> };
export type FakeWorker = {
  n: number;
  build: Build | null;
  reply: Reply<"start-worker">;
  ended: Ending | null;
  runs: FakeRun[];
};
export type FakeDownload = { signal: AbortSignal; progress: (progress: Progress) => void; done: Later<Downloaded> };

// A transport that does what the test says, when it says: each download(), build() and run() waits on a promise the
// test settles, and a worker says what the test makes it say (worker.reply). It keeps the transport's own rules:
// start() with a worker still live throws, end() fails the ended worker's run and its waiting read ops with the
// ending's kind.
export class FakeTransport implements Reader, Lifecycle, Builds {
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
export type FakeStore = {
  blocked: boolean;
  onChange: null | (() => void);
  list: () => Promise<FileInfo[]>;
  zip?: () => Promise<Blob>;
  read: (path: string) => Promise<Uint8Array>;
  texts: Map<string, string>; // what read() gives; a test sets it
};
export const fakeStore = (paths: string[] = []): FakeStore => {
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
export const fakeLock = (free = true) => ({
  asked: [] as { steal?: boolean }[],
  async take(o: { steal?: boolean } = {}) {
    this.asked.push(o);
    return free || Boolean(o.steal);
  },
});

/** What the drop record of the wiring in use must hold when that wiring ends: nothing, unless the test says. */
let dropsWanted: ReturnType<typeof engine.drops> = [];
export const expectDrops = (wanted: typeof dropsWanted) => {
  dropsWanted = wanted;
};
/** The wiring in use ends here: its drop record is what the test expects. */
export function checkDrops(when: string) {
  const wanted = dropsWanted;
  dropsWanted = [];
  assert.deepEqual(engine.drops(), wanted, `the drop record ${when}`);
}

export type Wiring = {
  free?: boolean;
  snapshot?: boolean;
  files?: string[];
  cached?: boolean | Promise<boolean>;
  manual?: boolean;
  graceMs?: number;
  canInterrupt?: boolean;
  transport?: Reader & Lifecycle & Builds;
};
export let client: FakeTransport, store: ReturnType<typeof fakeStore>, lock: ReturnType<typeof fakeLock>;
/** A new wiring: a transport (the stand-in, unless the test gives one), a store (blocked, as app/store.ts opens it) and
 *  a tab lock. open() then starts the machine. */
export function wire({
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
export function setUp(opts: Wiring = {}) {
  checkDrops("of the wiring that is replaced");
  wire(opts);
}

/** The writable signals of state.ts: every exported signal that takes an assignment (a computed one does not). */
const initial = new Map<string, unknown>();
const writables = Object.entries(S).filter(([, v]) => {
  const proto = v !== null && typeof v === "object" ? Object.getPrototypeOf(v) : null;
  return proto && "peek" in proto && Object.getOwnPropertyDescriptor(proto, "value")?.set !== undefined;
}) as [string, Signal<unknown>][];
for (const [name, signal] of writables) initial.set(name, structuredClone(signal.peek()));

/** Every writable signal of state.ts back to its value at load, the controllers' own state, the stand-ins and the drop
 *  record: a new wiring that nothing of an earlier test can reach. A signal added to state.ts is reset too. */
export function resetState() {
  stored.clear();
  dropsWanted = [];
  wire(); // not opened: nothing of the last test's can act, and the drop record is empty
  handlers.engineGone(); // the controllers' own state: the count of the session's runs, what the old engine left
  for (const [name, signal] of writables) signal.value = structuredClone(initial.get(name));
  S.holdToast(true); // no toast timer left over
  for (const t of D.tabs.value) D.close(t.path);
  clearLog();
}

/** Each test starts from resetState() and ends with the drop record as it expected. Call it once at the top of a file. */
export function useWiring() {
  beforeEach(resetState);
  afterEach(() => {
    checkDrops("at the end of the test");
  });
}
/** What the live region says over the next window(s). */
export async function heard() {
  await sleep(70);
  return S.announce.value;
}

/** The page load: the tab lock answers, and (with the lock) the cache check. */
export async function load(opts?: Wiring) {
  setUp(opts);
  engine.open();
  await tick();
}
/** A worker that starts: from `downloading`, the download completes; from `starting-list`, the list arrives. */
export async function begin() {
  if (S.engine.value.s === "downloading") client.dl.done.ok(DONE);
  else client.list.ok(BUILD);
  await tick();
  state("starting-worker");
}
export async function readyEngine(opts?: Wiring) {
  await load({ cached: true, ...opts });
  await begin();
  client.worker.reply({ type: "started" });
  state("ready");
}
