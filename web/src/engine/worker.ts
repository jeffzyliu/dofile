// The engine's Web Worker: Pyodide, the dofile wheel, and the user's files in /work (an in-memory folder kept by
// work-mirror.ts; the files live in store.ts). Protocol: types.ts (Ops, ToWorker, FromWorker); the page's side is
// client.ts. One op at a time; `boot` and `graphics` run outside the queue. A new op gets an entry in `table` (its type,
// OpTable in worker-dispatch.ts, comes from Ops).

import type { BrotliWasmType } from "brotli-wasm";
import type { PartRead } from "./lazy-part.ts";
import { partRegion, readPart, useNative, waitStep } from "./lazy-part.ts";
import type { SeqRead, SeqRegion } from "./seqlock.ts";
import { waitSeq } from "./seqlock.ts";
import type { SnapshotPy } from "./snapshot.ts";
import { hasNativeBrotli, inflateNative, unpackSteps, writeGraphics } from "./snapshot.ts";
import { openStore } from "./store.ts";
import type { About, RunOptions, SnapshotFile, Stage, Startup, ToWorker } from "./types.ts";
import type { MirrorStore } from "./work-mirror.ts";
import { WorkMirror } from "./work-mirror.ts";
import type { Browser } from "./worker-boot.ts";
import { since, startEngine, startPython } from "./worker-boot.ts";
import type { OpTable } from "./worker-dispatch.ts";
import { dispatcher, errorForPage as pageError } from "./worker-dispatch.ts";

declare global {
  var dofileStore: MirrorStore | undefined; // in the Node tests, a stand-in for the store (test/node-worker.ts)
}
// The DOM types make `self` a Window, which has no postMessage(message, transfer).
declare const self: Window & typeof globalThis & { postMessage(message: unknown, transfer: Transferable[]): void };

let py: SnapshotPy;
let browser: Browser;
let interrupt: Int32Array | null = null;
let fromSnapshot = false;
let brotliMode: string | undefined; // mount's `brotli`: "wasm" forces brotli-wasm
let mirror: WorkMirror | undefined; // /work: made in mount, once Pyodide is there

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

// ---- a lazy snapshot's graphics part (docs/lazy-matplotlib.md) ----
// matplotlib is not in the heap but in one more file (files.graphics). With a SharedArrayBuffer the page fetches it
// (client.ts), because a worker busy in Python cannot advance a fetch of its own, and hands it over in the buffer given
// with boot (its layout: lazy-part.ts). A graph that finds it failed posts {graphics: "again"} and waits for the page's
// next fetch. Without one (no cross-origin isolation) it is a start file instead: boot fetches, unpacks and writes it
// (worker-boot.ts), and only its import is left for the idle steps.
// Only a graph waits for the part (waitGraphics). Nothing happens before `startup` is answered, so a return visit is no
// slower. Then the browser's own decoder unpacks it off this thread (nativeSoon); the brotli-wasm unpack, the write and
// the import of what a first graph needs run in one-task steps once the engine has been idle IDLE_MS (idleStep), so a
// run sent meanwhile waits for one step at most.
// IDLE_MS 250 vs 1000: a graph sent 0.5-1.1 s after ready was 0.2-0.5 s faster; a run meeting a step waits as long.
const IDLE_MS = 250;
const DECODE_STEP = 256 << 10; // input bytes: ~1.1 MB out, ~0.12 s at the 9 MB/s brotli-wasm did on an iPhone
let share: {
  file: SnapshotFile;
  region: SeqRegion | null; // the shared buffer's; null: there is none, and boot wrote the part
} | null = null;
let brotliWasm: BrotliWasmType | null = null;
let snapshotURL = ""; // mount's `snapshot`: where the part is, for boot's fetch of it without a shared buffer
let built = 0; // mount's `built`: the name of the snapshot's Cache, for that fetch
let started = false; // `startup` was answered
let runs = 0; // runs sent and not ended (counted before the queue)
let resultsRunId = 0; // the run that made the engine's results now: counted as each run starts
let idleSince = 0;
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
let decode: { steps: Generator<number, Uint8Array, void>; t0: number; how: string; longest: number } | null = null;
let native = false; // the browser's decoder is unpacking it (idle only)
let decoded: { raw: Uint8Array; secs: number; how: string; longest: number } | null = null; // unpacked, not yet written
let graphicsWritten = false;
let askedAt: number | null = null; // the copy when this run asked the page to fetch a failed part again
let graphicsError = ""; // the part arrived damaged; said once, by the next graph
let warmAt = 0; // the next step of browser.warm_graphics; -1: done
let tWarm = 0;
let warmLongest = 0;
let nativeFailedOn: number | null = null; // the copy the browser's decoder failed on
let writtenInRun = 0; // performance.now() when a graph of this run wrote the part

const canUseNative = (copy: number) => useNative(brotliMode, hasNativeBrotli(), nativeFailedOn, copy);

// The part now: one snapshot of the shared region (busy while the page writes it, for up to waitMs). withBytes: a copy
// of the bytes (up to 33 MB) when landed. Read only while the part is not written, so there is a region (without one,
// boot wrote it).
function readGraphics(waitMs: number, withBytes: boolean): SeqRead<PartRead> {
  return readPart(share!.region!, waitMs, { withBytes });
}

// The part will not unpack or write: it is dropped (the page deletes it from the Cache and fetches it again), the graph
// that finds it (or else the next one) says why, and the idle steps stop until then.
function damaged(e: unknown): string {
  graphicsError = `the graphics files arrived damaged (${errorForPage(e).message}); they are fetched again for the next graph`;
  decode = decoded = null;
  self.postMessage({ graphics: "damaged" });
  console.warn(`[dofile] ${graphicsError}`);
  return graphicsError;
}

// One step of the brotli-wasm decode (DECODE_STEP of input): the decoded part when done, else null. A waiting graph
// and the idle steps share one decode.
function decodeStep(part?: Uint8Array): Uint8Array | null {
  decode ??= {
    steps: unpackSteps(brotliWasm!, part!, share!.file, DECODE_STEP),
    t0: performance.now(),
    how: "wasm",
    longest: 0,
  };
  const t = performance.now();
  const r = decode.steps.next();
  decode.longest = Math.max(decode.longest, since(t));
  if (!r.done) return null;
  decoded = { raw: r.value, secs: since(decode.t0), how: decode.how, longest: decode.longest };
  decode = null;
  return r.value;
}

function writePart(where: string) {
  const d = decoded!;
  const tWrite = performance.now();
  const n = writeGraphics(py, d.raw);
  graphicsWritten = true;
  decoded = decode = null;
  console.info(
    `[dofile] graphics part: written ${where} (unpack (${d.how}) ${d.secs.toFixed(2)}s, longest step ${d.longest.toFixed(2)}s; write ${n} files ${since(tWrite).toFixed(2)}s)`,
  );
}

/**
 * Called by Python (browser.py, _LazyGraphics.ensure) while a graph waits, so synchronous.
 * @param ms - the longest wait before answering "pending"
 * @returns "" once the files are written (unpacked here if the idle steps have not done it); "break" for a Break
 * (Python takes it as the engine's Break; the unpack goes on later); "pending"; or why the graphs cannot be had
 */
function waitGraphics(ms: number): string {
  if (graphicsWritten) return "";
  if (graphicsError) {
    const why = graphicsError;
    graphicsError = ""; // said once: the page is fetching the part again, the next graph waits for it
    return why;
  }
  for (;;) {
    let read = { seq: 0, busy: true } as SeqRead<PartRead>; // set by waitStep's read
    try {
      const step = waitStep(
        {
          interrupted: Boolean(interrupt && Atomics.load(interrupt, 0) !== 0),
          unpacked: Boolean(decoded),
          unpacking: Boolean(decode),
          askedOn: askedAt,
        },
        () => (read = readGraphics(ms, true)),
      );
      if (typeof step === "object") return step.giveUp;
      switch (step) {
        case "break":
          Atomics.store(interrupt!, 0, 0);
          return "break";
        case "write":
          writePart("in a run");
          writtenInRun = performance.now();
          return "";
        case "unpack-more":
          decodeStep();
          continue;
        case "unpack":
          // waitStep unpacks only a landed read
          if ("value" in read && read.value.state === "landed") decodeStep(read.value.bytes!);
          continue;
        case "ask-again":
          if ("value" in read) askedAt = read.value.copy;
          self.postMessage({ graphics: "again" });
          waitSeq(share!.region!, read.seq, ms);
          return "pending";
        case "wait":
          // on the counter, not the state: a whole retry may end in the state it began from
          waitSeq(share!.region!, read.seq, ms);
          return "pending";
      }
    } catch (e) {
      const why = damaged(e);
      graphicsError = ""; // this graph says it; the next one waits for the page's fresh fetch
      return why;
    }
  }
}

// The browser's own decoder (off this thread) unpacks the part as soon as it is here. A graph that comes meanwhile
// cannot use the result: it is blocked in Python, so this thread's event loop never delivers the promise. That graph
// unpacks with brotli-wasm itself and the result is dropped. Does nothing where there is no native decoder (Chromium).
function nativeSoon() {
  if (!started || !share || native || decode || decoded || graphicsWritten || graphicsError) return;
  const read = readGraphics(0, false);
  // busy: the op graphics after the page's write calls this again
  if (!("value" in read) || !canUseNative(read.value.copy)) return;
  setTimeout(startNative, 0); // a task of its own: never inside the answer to `startup`
}

function startNative() {
  if (!share || native || decode || decoded || graphicsWritten || graphicsError) return;
  // the copy and its bytes from one snapshot: a failure is charged to the copy it unpacked
  const read = readGraphics(0, true);
  if (!("value" in read) || read.value.state !== "landed") return;
  const { copy } = read.value;
  const bytes = read.value.bytes!;
  const file = share.file;
  if (bytes.length !== file.size || bytes.length === file.raw) return; // not brotli: the wasm step says what is wrong
  native = true;
  const t0 = performance.now();
  inflateNative(bytes, file.raw)
    .then(
      (raw) => {
        // a graph that came meanwhile unpacked the part itself (see nativeSoon): this result is spare
        // secs: to the decode's end; the write waits for IDLE_MS more
        if (!graphicsWritten && !decode && !decoded) decoded = { raw, secs: since(t0), how: "native", longest: 0 };
      },
      (e) => {
        console.warn(`[dofile] graphics part: native brotli failed (${e?.message ?? e}); using brotli-wasm`);
        nativeFailedOn = copy; // the next step starts the brotli-wasm decode, which gives the error if it is damaged
      },
    )
    .finally(() => {
      native = false;
      idleSoon(0);
    });
}

// The one door to the part's work while idle: after `startup`, IDLE_MS after the last run.
function idleSoon(delay = Math.max(0, idleSince + IDLE_MS - performance.now())) {
  if (!started || !share || idleTimer || native || graphicsError || (graphicsWritten && warmAt < 0)) return;
  idleTimer = setTimeout(idleStep, delay);
}

// One step: a decode step (or the browser's decoder, off this thread), the write, or one import step
function idleStep() {
  idleTimer = 0;
  if (runs > 0) return; // the run's end calls idleSoon
  if (performance.now() - idleSince < IDLE_MS) return idleSoon();
  const t = performance.now();
  try {
    if (decoded) {
      writePart("while idle");
      browser.graphics_written();
    } else if (decode) decodeStep();
    else if (!graphicsWritten) {
      const read = readGraphics(0, true);
      // busy or not landed: the op graphics after the page's write calls idleSoon
      if (!("value" in read) || read.value.state !== "landed") return;
      const bytes = read.value.bytes!;
      const file = share!.file;
      // normally under way already (nativeSoon); its end calls idleSoon
      if (canUseNative(read.value.copy) && bytes.length === file.size && bytes.length !== file.raw)
        return startNative();
      decodeStep(bytes);
    } else {
      // after the write, the import of what a first graph needs: the three heavy modules one at a time, then 20 a step
      if (!tWarm) tWarm = performance.now();
      warmAt = browser.warm_graphics(warmAt, warmAt < 3 ? 1 : 20);
      warmLongest = Math.max(warmLongest, since(t));
      if (warmAt < 0)
        console.info(
          `[dofile] graphics part: warmed (imported) in ${since(tWarm).toFixed(2)}s, longest step ${warmLongest.toFixed(2)}s`,
        );
    }
  } catch (e) {
    damaged(e);
    return;
  }
  idleSoon(0);
}

// Where the start's time went, in seconds, for the page's status line (the "startup" op). storeError: the files could
// not be copied from the store, so the engine runs and nothing it writes is kept.
const startup: Partial<Startup> = {};

// Each op's entry: the lifecycle ops, then the read ops, then the journal's (the three sets of Ops, types.ts).
export const table: OpTable = {
  mount: {
    queued: true,
    async handle(args) {
      brotliMode = args.brotli;
      snapshotURL = args.snapshot ?? "";
      built = args.built ?? 0;
      fromSnapshot = Boolean(args.snapshot);
      ({ py, brotli: brotliWasm } = await startPython(args, stage, startup));
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
        part: { snapshotURL, built, brotliWasm, brotliMode },
        partWritten(graphics) {
          // no shared buffer: boot wrote it; the idle steps import it
          share = { file: graphics.file, region: null };
          graphicsWritten = true;
        },
        lazyGraphics(engine, graphics, sab) {
          // the buffer is wrapped at once and not kept
          share = { file: graphics.file, region: partRegion(sab) };
          engine.lazy_graphics(waitGraphics);
        },
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
      started = true; // the part's work may begin (nativeSoon, idleSoon)
      idleSince = performance.now();
      nativeSoon();
      idleSoon();
      // mode, filesS and engineS are set by now: the page asks only after boot's answer
      return startup as Startup;
    },
  },
  // {id, log} chunks go to the page while the run prints.
  run: {
    queued: true,
    arrived() {
      runs++; // at once, not when the queue reaches it: the part's idle steps stop for it (idleStep)
    },
    async handle({ code, fresh_locals, plot_theme }, id) {
      try {
        await booted;
        askedAt = null;
        // counted before the engine runs: a run whose op fails after it ran changed e() and r() too
        const resultsId = ++resultsRunId;
        const result = await runNow({ code, fresh_locals, plot_theme }, id);
        if (result.results) result.results.runId = resultsId;
        return result;
      } finally {
        if (writtenInRun) {
          console.info(
            `[dofile] graphics part: in the run, after the write: import and draw ${since(writtenInRun).toFixed(2)}s`,
          );
          writtenInRun = 0;
        }
        runs--; // counted as it arrived
        idleSince = performance.now();
        nativeSoon();
        idleSoon();
      }
    },
  },
  // the page's graphics part landed, failed, or is fetched again. Outside the queue: it only notes the part, so a run
  // sent after it does not wait for it
  graphics: {
    queued: false,
    handle() {
      nativeSoon();
      idleSoon();
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
