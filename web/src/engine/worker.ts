// The engine's Web Worker: Pyodide, the dofile wheel, and the user's files in /work (an in-memory folder kept by
// work-mirror.ts; the files live in store.ts). Protocol: types.ts (Ops, ToWorker, FromWorker); the page's side is
// client.ts. One op at a time; `boot` and `graphics` run outside the queue. A new op gets an entry in `table` (its type,
// OpTable in worker-dispatch.ts, comes from Ops).

import type { SnapshotPy } from "./snapshot.ts";
import { openStore } from "./store.ts";
import type { About, RunOptions, Stage, Startup, ToWorker } from "./types.ts";
import type { MirrorStore } from "./work-mirror.ts";
import { WorkMirror } from "./work-mirror.ts";
import type { Browser } from "./worker-boot.ts";
import { since, startEngine, startPython } from "./worker-boot.ts";
import type { OpTable } from "./worker-dispatch.ts";
import { dispatcher, errorForPage as pageError } from "./worker-dispatch.ts";
import { graphicsWorker } from "./worker-graphics.ts";

declare global {
  var dofileStore: MirrorStore | undefined; // in the Node tests, a stand-in for the store (test/node-worker.ts)
}
// The DOM types make `self` a Window, which has no postMessage(message, transfer).
declare const self: Window & typeof globalThis & { postMessage(message: unknown, transfer: Transferable[]): void };

let py: SnapshotPy;
let browser: Browser;
let interrupt: Int32Array | null = null;
let fromSnapshot = false;
let mirror: WorkMirror | undefined; // /work: made in mount, once Pyodide is there
let resultsRunId = 0; // the run that made the engine's results now: counted as each run starts

const stage = (id: Stage) => self.postMessage({ stage: id });

const errorForPage = (e: unknown) => pageError(e, py?.ERRNO_CODES);

// Starting is two steps so the page can show the user's files early. `mount` is an ordinary queued op, so every `sync`
// posted after it waits for it. `boot` runs outside the queue, so `sync`, `files` and `read` are answered while it
// loads; the ops that need the engine (run, describe, matrix) wait for it.
let bootDone: { ok: () => void; err: (e: unknown) => void };
const booted = new Promise<void>((ok, err) => {
  bootDone = { ok, err };
});
booted.catch(() => {}); // the error reaches the page through boot's own answer

// ---- a lazy snapshot's graphics part: its record and its work are in worker-graphics.ts ----
const graphics = graphicsWorker({
  py: () => py,
  browser: () => browser,
  interrupt: () => interrupt,
  errorOf: errorForPage,
  post: (message) => self.postMessage(message),
});

// Where the start's time went, in seconds, for the page's status line (the "startup" op). storeError: the files could
// not be copied from the store, so the engine runs and nothing it writes is kept.
const startup: Partial<Startup> = {};

// Each op's entry: the lifecycle ops, then the read ops, then the journal's (the three sets of Ops, types.ts).
export const table: OpTable = {
  mount: {
    queued: true,
    async handle(args) {
      fromSnapshot = Boolean(args.snapshot);
      const python = await startPython(args, stage, startup);
      py = python.py;
      // mount's `brotli`: "wasm" forces brotli-wasm
      graphics.mounted({
        snapshotURL: args.snapshot ?? "",
        built: args.built ?? 0,
        brotliWasm: python.brotli,
        brotliMode: args.brotli,
      });
      mirror = new WorkMirror(py.FS, py.PATH, errorForPage);
      const tFiles = performance.now();
      stage("files");
      await mirror.copyStore(() => self.dofileStore ?? openStore());
      startup.filesS = since(tFiles);
      if (mirror.storeError) startup.storeError = mirror.storeError;
    },
  },
  // Outside the queue (see `booted`); its answer settles `booted`.
  // wheel: URL or {name, bytes}; extraWheels: the same, installed with it; interruptBuffer: Int32Array or null
  boot: {
    queued: false,
    async handle(args) {
      interrupt = args.interruptBuffer ?? null;
      let about: About;
      ({ browser, about } = await startEngine(py, args, {
        fromSnapshot,
        stage,
        startup,
        ...graphics.bootHooks(),
      }));
      return about;
    },
    answered(failed, error) {
      if (failed) bootDone.err(error);
      else bootDone.ok();
    },
  },
  startup: {
    queued: true,
    async handle() {
      graphics.startupAnswered(); // the part's work may begin
      // mode, filesS and engineS are set by now: the page asks only after boot's answer
      return startup as Startup;
    },
  },
  // {id, log} chunks go to the page while the run prints.
  run: {
    queued: true,
    arrived() {
      graphics.runArrived();
    },
    async handle({ code, fresh_locals, plot_theme }, id) {
      try {
        await booted;
        graphics.runStarts();
        // counted before the engine runs: a run whose op fails after it ran changed e() and r() too
        const resultsId = ++resultsRunId;
        const result = await runNow({ code, fresh_locals, plot_theme }, id);
        if (result.results) result.results.runId = resultsId;
        return result;
      } finally {
        graphics.runEnded();
      }
    },
  },
  // the page's graphics part landed, failed, or is fetched again. Outside the queue: it only notes the part, so a run
  // sent after it does not wait for it
  graphics: {
    queued: false,
    handle() {
      graphics.pageWrote();
    },
  },
  // undefined becomes Python's None (null would become JsNull)
  describe: {
    queued: true,
    async handle({ vars, offset = 0, limit }) {
      await booted;
      return JSON.parse(browser.describe(vars, offset, limit));
    },
  },
  // a .dta in /work, without loading it
  describe_file: {
    queued: true,
    async handle({ path }) {
      await booted;
      mirror!.inRoot(path);
      return JSON.parse(browser.describe_file(path));
    },
  },
  matrix: {
    queued: true,
    async handle({ name, runId }) {
      await booted;
      if (runId !== resultsRunId) return { changed: true }; // the ops run in order: a run ahead of this one made newer results
      return JSON.parse(browser.matrix(name));
    },
  },
  macros: {
    queued: true,
    async handle() {
      await booted;
      return JSON.parse(browser.macros());
    },
  },
  browse: {
    queued: true,
    async handle({ vars, offset, limit }) {
      await booted;
      return JSON.parse(browser.browse(vars ?? undefined, offset ?? 0, limit ?? 50));
    },
  },
  // heap_bytes: the size of this worker's WebAssembly memory
  memory: {
    queued: true,
    async handle() {
      await booted;
      return { ...JSON.parse(browser.memory()), heap_bytes: py._module.HEAPU8.length };
    },
  },
  // views of /work, for the tests: the page lists and reads the store
  files: {
    queued: true,
    handle() {
      return mirror!.walk();
    },
  },
  read: {
    queued: true,
    handle({ path }) {
      return py.FS.readFile(mirror!.inRoot(path));
    },
  },
  // no mirror (before mount, or after one that failed): no store either, so nothing to take
  sync: {
    queued: true,
    async handle() {
      await mirror?.sync();
    },
  },
};

/** Pyodide's type takes only a TypedArray; undefined turns its reading of the buffer off (its docs). */
function readInterrupts(buffer: Int32Array | null) {
  (py.setInterruptBuffer as (b: Int32Array | undefined) => void)(buffer ?? undefined);
}

async function runNow({ code, fresh_locals, plot_theme }: { code: string } & RunOptions, id: number) {
  {
    const before = mirror!.beforeRun();
    const t0 = performance.now();
    // Positional: a plain Pyodide call passes no keyword arguments; undefined (not null) is Python's None.
    // Python reads the buffer only during a run: a Break pressed while an op ahead of the run was answered waits there
    // for it (Python would take it as no run's and drop it), and the page clears it when it sends a run
    readInterrupts(interrupt);
    let text: string;
    try {
      text = browser.run(code, true, fresh_locals === true, plot_theme ?? undefined, (log) =>
        self.postMessage({ id, log }),
      );
    } finally {
      readInterrupts(null);
    }
    const result = JSON.parse(text);
    const t1 = performance.now();
    Object.assign(result, await mirror!.saveRun(before));
    // The Python side gave engine and encode; save is writing the run's files to the store.
    const k = result.timing;
    if (k)
      result.timing = { ...k, parse: (t1 - t0) / 1000 - k.engine - k.encode, save: (performance.now() - t1) / 1000 };
    return result;
  }
}

const dispatch = dispatcher(table, {
  post(message, transfer) {
    self.postMessage(message, transfer);
  },
  errorOf: errorForPage,
  afterResult() {
    const outOfStep = mirror?.takeOutOfStep();
    if (outOfStep) self.postMessage({ folderError: outOfStep }); // after the run's answer, so the page keeps its result
  },
});
self.onmessage = ({ data }: MessageEvent<ToWorker>) => dispatch(data);
