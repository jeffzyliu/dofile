// The engine's Web Worker: Pyodide, the dofile wheel, and the user's files in /work (an in-memory folder kept by
// work-mirror.ts; the files live in store.ts). Protocol: types.ts (Ops, ToWorker, FromWorker); the page's side is
// client.ts. One op at a time; `boot` and `graphics` run outside the queue. A new op gets an entry in `table` (its type,
// OpTable in worker-dispatch.ts, comes from Ops).

import type { BrotliWasmType } from "brotli-wasm";
import {
  PART_FAILED,
  PART_LANDED,
  PART_PENDING,
  partData,
  partHeader,
  partState,
  partTries,
  useNative,
  waitPartChange,
  waitStep,
} from "./lazy-part.ts";
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
// with boot (its layout: lazy-part.ts). A graph that finds it failed posts {graphics: "again"} and waits for the page's next fetch.
// Without one (no cross-origin isolation) this worker fetches it (prefetch, fetchPartNow): a graph blocked in Python
// could not be handed the page's bytes. Its {graphics: ...} messages let the page show the download.
// Only a graph waits for the part (waitGraphics). Nothing happens before `startup` is answered, so a return visit is no
// slower. Then the browser's own decoder unpacks it off this thread (nativeSoon); the brotli-wasm unpack, the write and
// the import of what a first graph needs run in one-task steps once the engine has been idle IDLE_MS (idleStep), so a
// run sent meanwhile waits for one step at most.
// IDLE_MS 250 vs 1000: a graph sent 0.5-1.1 s after ready was 0.2-0.5 s faster; a run meeting a step waits as long.
const IDLE_MS = 250;
const PROGRESS_MS = 100; // at most one {graphics: "progress"} this often
const DECODE_STEP = 256 << 10; // input bytes: ~1.1 MB out, ~0.12 s at the 9 MB/s brotli-wasm did on an iPhone
let share: {
  file: SnapshotFile;
  hdr: Int32Array | null;
  sab: SharedArrayBuffer | null;
  bytes?: Uint8Array;
  error?: string;
} | null = null;
let brotliWasm: BrotliWasmType | null = null;
let snapshotBase = ""; // mount's `snapshot`: where the part is, for fetchPartNow
let started = false; // `startup` was answered
let runs = 0; // runs sent and not ended (counted before the queue)
let idleSince = 0;
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
let decode: { steps: Generator<number, Uint8Array, void>; t0: number; how: string; longest: number } | null = null;
let native = false; // the browser's decoder is unpacking it (idle only)
let decoded: { raw: Uint8Array; secs: number; how: string; longest: number } | null = null; // unpacked, not yet written
let graphicsWritten = false;
let askedAt: number | null = null; // the tries when this run asked the page to fetch a failed part again
let graphicsError = ""; // the part arrived damaged; said once, by the next graph
let warmAt = 0; // the next step of browser.warm_graphics; -1: done
let tWarm = 0;
let warmLongest = 0;
let prefetching: { stop: AbortController; done: Promise<void> } | null = null; // no shared buffer: the worker's own fetch
let fetchSaid = false; // waitGraphics said "pending" before this graph's own fetch
let fresh = false; // the part arrived damaged: the next fetch must skip the HTTP cache
let copies = 0; // no shared buffer: this worker's copies of the part, counted (copyNow)
let nativeFailedOn: number | null = null; // the copy (copyNow) the browser's decoder failed on
let writtenInRun = 0; // performance.now() when a graph of this run wrote the part

// Which copy of the part is there: the page's fetches of it (each new copy follows one), or this worker's own
const copyNow = () => (share?.hdr ? partTries(share.hdr) : copies);
const nativeNow = () => useNative(brotliMode, hasNativeBrotli(), nativeFailedOn, copyNow());

// The part as the page left it: its state, and a copy of the bytes (landed) or the reason (failed)
function partNow(): [number, Uint8Array<ArrayBuffer> | string | null] {
  if (!share) return [PART_FAILED, "this build has no graphics part"];
  if (share.sab && share.hdr) {
    const state = partState(share.hdr);
    if (state === PART_PENDING) return [state, null];
    const data = partData(share.sab, share.hdr);
    return [state, state === PART_LANDED ? data : new TextDecoder().decode(data)];
  }
  if (share.bytes) return [PART_LANDED, share.bytes.slice()];
  return share.error ? [PART_FAILED, share.error] : [PART_PENDING, null];
}

// The part will not unpack or write: it is dropped (the page deletes it from the Cache and fetches it again), the graph
// that finds it (or else the next one) says why, and the idle steps stop until then.
function damaged(e: unknown): string {
  graphicsError = `the graphics files arrived damaged (${errorForPage(e).message}); they are fetched again for the next graph`;
  decode = decoded = null;
  if (share && !share.sab) {
    share.bytes = undefined; // this worker's own copy: the next graph fetches it again
    fresh = true; // and not from the browser's HTTP cache, which may hold these same bytes
  }
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
    let tries = 0;
    let part = null as Uint8Array<ArrayBuffer> | string | null; // set by read()
    const read = () => {
      // tries before the state: a retry started between the two loads must show as new tries, not as a failure
      // already the new try's (the graph would wait until a Break)
      tries = share!.hdr ? partTries(share!.hdr) : 0;
      const [state, now] = partNow();
      part = now;
      return { state, tries, shared: Boolean(share!.hdr) };
    };
    try {
      const step = waitStep(
        {
          interrupted: Boolean(interrupt && Atomics.load(interrupt, 0) !== 0),
          decoded: Boolean(decoded),
          decoding: Boolean(decode),
          askedAt,
          fetchSaid,
        },
        read,
      );
      switch (step) {
        case "break":
          Atomics.store(interrupt!, 0, 0);
          return "break";
        case "write":
          writePart("in a run");
          writtenInRun = performance.now();
          return "";
        case "decode-more":
          decodeStep();
          continue;
        case "decode":
          decodeStep(part as Uint8Array);
          continue;
        case "say-fetching":
          // the page cannot hand the part over while this graph runs. "pending" first, so that browser.py prints its
          // waiting line and sends the log before this call blocks for the download
          fetchSaid = true;
          self.postMessage({ graphics: "fetching" });
          return "pending";
        case "fetch": {
          const why = fetchPartNow();
          if (why) return why;
          continue;
        }
        case "give-up":
          return part as string;
        case "ask-again":
          askedAt = tries;
          self.postMessage({ graphics: "again" });
          waitPartChange(share!.hdr!, PART_FAILED, ms);
          return "pending";
        case "wait-failed":
          waitPartChange(share!.hdr!, PART_FAILED, ms);
          return "pending";
        case "wait-pending":
          waitPartChange(share!.hdr!, PART_PENDING, ms);
          return "pending";
      }
    } catch (e) {
      const why = damaged(e);
      graphicsError = ""; // this graph says it; the next one waits for the page's fresh fetch
      return why;
    }
  }
}

// Without a SharedArrayBuffer a message from the page cannot reach a graph blocked in Python, so the graph fetches the
// part with a synchronous request (allowed in a worker; with no shared buffer there is no Break either: the machine
// resets). Returns "" when it is here (share.bytes), else why not.
function fetchPartNow(): string {
  const at = new URL(`${snapshotBase}${share!.file.name}`, self.location.href);
  const t0 = performance.now();
  // a damaged part may sit in the HTTP cache with the right length; a synchronous XHR cannot reload, so use a new
  // address
  if (fresh) at.searchParams.set("fresh", String(Date.now()));
  const url = at.href;
  if (prefetching) {
    // its bytes could only arrive after this graph: stop it, so the part comes whole once
    prefetching.stop.abort();
    prefetching = null;
    console.info("[dofile] graphics part: the worker's own fetch was still on its way; a graph fetches it now");
  }
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.responseType = "arraybuffer";
    xhr.send();
    if (xhr.status !== 200) throw new Error(`${url}: ${xhr.status}`);
    const bytes = new Uint8Array(xhr.response as ArrayBuffer);
    if (bytes.length !== share!.file.size)
      throw new Error(`${url}: ${bytes.length} bytes arrived, the build's list says ${share!.file.size}`);
    Object.assign(share!, { bytes, error: undefined });
    copies++;
    fresh = false;
    console.info(
      `[dofile] graphics part: fetched by the worker in a run (no shared buffer) ${since(t0).toFixed(2)}s, ${bytes.length} bytes`,
    );
    self.postMessage({ graphics: "landed" });
    return "";
  } catch (e) {
    const why = `the graphics files could not be downloaded (${errorForPage(e).message}); they are fetched again for the next graph`;
    self.postMessage({ graphics: "failed", why });
    return why;
  } finally {
    fetchSaid = false; // the next graph that fetches it says it is waiting again
  }
}

// Without a shared buffer: this worker's own fetch of the part, started after `startup` is answered. A graph that comes
// first stops it and fetches the part itself.
async function prefetch(): Promise<void> {
  if (!share || share.sab || share.bytes) return Promise.resolve();
  if (prefetching) return prefetching.done;
  const stop = new AbortController();
  const url = new URL(`${snapshotBase}${share.file.name}`, self.location.href).href;
  const t0 = performance.now();
  const done = (async () => {
    try {
      self.postMessage({ graphics: "fetching" });
      // after damage: not from the HTTP cache (and the new bytes replace what it held)
      const res = await fetch(url, { signal: stop.signal, ...(fresh && { cache: "reload" as const }) });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      // read as they come, so that the page can show how much is here (throttled)
      const out = new Uint8Array(share!.file.size);
      const reader = res.body!.getReader();
      let n = 0;
      let sent = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (n + value.length > out.length) throw new Error(`${url}: more bytes than the build's list says`);
        out.set(value, n);
        n += value.length;
        const now = performance.now();
        if (now - sent >= PROGRESS_MS && !stop.signal.aborted) {
          sent = now;
          self.postMessage({ graphics: "progress", received: n });
        }
      }
      if (n !== share!.file.size)
        throw new Error(`${url}: ${n} bytes arrived, the build's list says ${share!.file.size}`);
      if (stop.signal.aborted || share!.bytes || graphicsWritten) return; // a graph fetched it meanwhile
      share!.bytes = out;
      copies++;
      fresh = false;
      console.info(
        `[dofile] graphics part: fetched by the worker (no shared buffer) ${since(t0).toFixed(2)}s, ${n} bytes`,
      );
      self.postMessage({ graphics: "landed" });
      nativeSoon();
      idleSoon();
    } catch (e: any) {
      // a graph fetches it again (fetchPartNow), and says why if that fails too
      if (!stop.signal.aborted) {
        console.warn(`[dofile] graphics part: the worker's fetch failed (${e?.message ?? e})`);
        self.postMessage({
          graphics: "failed",
          why: `the graphics files could not be downloaded (${e?.message ?? e}); they are fetched again for the next graph`,
        });
      }
    } finally {
      prefetched(stop);
    }
  })();
  prefetching = { stop, done };
  return done;
}

// the fetch `stop` belongs to has ended
function prefetched(stop: AbortController) {
  if (prefetching?.stop === stop) prefetching = null;
}

// The browser's own decoder (off this thread) unpacks the part as soon as it is here. A graph that comes meanwhile
// cannot use the result: it is blocked in Python, so this thread's event loop never delivers the promise. That graph
// unpacks with brotli-wasm itself and the result is dropped. Does nothing where there is no native decoder (Chromium).
function nativeSoon() {
  if (!started || !share || native || decode || decoded || graphicsWritten || graphicsError) return;
  if (!nativeNow()) return;
  setTimeout(startNative, 0); // a task of its own: never inside the answer to `startup`
}

function startNative() {
  if (!share || native || decode || decoded || graphicsWritten || graphicsError) return;
  const copy = copyNow(); // before the part: a fetch the page starts meanwhile must not take this copy's failure
  const [state, part] = partNow();
  if (state !== PART_LANDED) return;
  const bytes = part as Uint8Array<ArrayBuffer>;
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
      const [state, part] = partNow();
      if (state !== PART_LANDED) return; // the op graphics calls idleSoon when it lands
      const bytes = part as Uint8Array<ArrayBuffer>;
      const file = share!.file;
      // normally under way already (nativeSoon); its end calls idleSoon
      if (nativeNow() && bytes.length === file.size && bytes.length !== file.raw) return startNative();
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
      snapshotBase = args.snapshot ?? "";
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
        lazyGraphics(engine, graphics) {
          share = { ...graphics, hdr: graphics.sab ? partHeader(graphics.sab) : null };
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
      if (share && !share.sab) setTimeout(() => void prefetch(), 0); // after this answer, as nativeSoon
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
        return await runNow({ code, fresh_locals, plot_theme }, id);
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
    async handle({ name }) {
      await booted;
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
