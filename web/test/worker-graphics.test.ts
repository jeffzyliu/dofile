// worker-graphics.ts's record with a fake engine: the shared region is real (lazy-part.ts) and the part a small brotli
// file; Python, the engine's calls and the page are fakes. Node has the browser's decoder (DecompressionStream "brotli");
// heldDecoder holds it until the test lets it go. Each test's worker gets its own fakes, so a timer it leaves behind
// touches nothing another test reads.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { TestContext } from "node:test";
import { mock, test } from "node:test";
import { format } from "node:util";
import { brotliCompressSync } from "node:zlib";
import {
  failPart,
  IDLE_MS,
  landPart,
  PART_HEADER,
  partReason,
  partRegion,
  retryPart,
} from "../src/engine/lazy-part.ts";
import { packGraphics } from "../src/engine/snapshot.ts";
import type { FromWorker } from "../src/engine/types.ts";
import { graphicsWorker } from "../src/engine/worker-graphics.ts";

const brotliWasm = createRequire(import.meta.url)("brotli-wasm");
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// the worker's [dofile] lines, kept out of the test's output
const said: string[] = [];
for (const level of ["info", "warn"] as const)
  mock.method(console, level, (...args: unknown[]) => {
    said.push(format(...args));
  });

const until = async (ok: () => boolean, what: string, ms = 20 * IDLE_MS) => {
  for (const end = performance.now() + ms; !ok(); await sleep(5))
    if (performance.now() > end) assert.fail(`not within ${ms} ms: ${what}`);
};

// Copy n of the part: one file whose first byte is n and the rest noise (so every copy compresses to the same size, the
// size the build's list gives), packed as the build packs it and brotli-compressed.
const FILE_SIZE = 4096;
let seed = 1;
const NOISE = Uint8Array.from({ length: FILE_SIZE }, () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 24; // xorshift32: brotli stores it as is
});
const fileOf = (n: number) => NOISE.map((b, i) => (i ? b : n));
const packedOf = (n: number) => packGraphics([{ path: "/lib/mpl/a.py", size: FILE_SIZE }], fileOf(n));
const copyOf = (n: number) => new Uint8Array(brotliCompressSync(packedOf(n)));
const RAW = packedOf(0).length;
const SIZE = copyOf(1).length;
assert.ok([1, 2, 3].every((n) => copyOf(n).length === SIZE) && SIZE !== RAW);

/**
 * A worker's part with a lazy snapshot's shared region, booted and mounted.
 * @param brotli - mount's `brotli`: "wasm" forces brotli-wasm
 * @param failWrites - how many writes of the part throw first (the part's damage, as the worker sees it)
 * @param page - the page answers `damaged` as it does: one more copy, pending (retryPart)
 * @param breakInUnpack - a Break arrives as the brotli-wasm unpack begins (the interrupt is set)
 */
function part({
  brotli,
  failWrites = 0,
  page = false,
  breakInUnpack = false,
}: {
  brotli?: "wasm";
  failWrites?: number;
  page?: boolean;
  breakInUnpack?: boolean;
} = {}) {
  const sab = new SharedArrayBuffer(PART_HEADER + SIZE);
  const region = partRegion(sab);
  const posted: FromWorker[] = [];
  const written: number[] = []; // each write's copy (its file's first byte), the ones that threw too
  const warmed: number[] = []; // each warm_graphics step's `at`
  let fails = failWrites;
  let warmThrows = false;
  let waitGraphics: (ms: number) => string = () => assert.fail("lazy_graphics was not called");
  const interrupt = new Int32Array(new SharedArrayBuffer(4));
  const wasm = breakInUnpack
    ? {
        ...brotliWasm,
        DecompressStream: new Proxy(brotliWasm.DecompressStream, {
          construct(Real, args) {
            Atomics.store(interrupt, 0, 1);
            return new Real(...args);
          },
        }),
      }
    : brotliWasm;
  const py = {
    FS: {
      mkdirTree() {},
      writeFile(_path: string, data: Uint8Array) {
        written.push(data[0]);
        if (fails-- > 0) throw new Error("the file does not unpack");
      },
    },
    runPython() {},
  };
  const engine = {
    lazy_graphics(f: typeof waitGraphics) {
      waitGraphics = f;
    },
    graphics_written() {},
    warm_graphics(at: number) {
      warmed.push(at);
      if (warmThrows) throw new Error("No module named 'pyparsing'");
      return at < 2 ? at + 1 : -1;
    },
  };
  const g = graphicsWorker({
    py: () => py as never,
    browser: () => engine as never,
    interrupt: () => interrupt,
    errorOf: (e) => ({ message: e instanceof Error ? e.message : String(e) }),
    post(m) {
      posted.push(m);
      if (page && "graphics" in m && m.graphics === "damaged") retryPart(region);
    },
  });
  g.mounted({ snapshotURL: "", built: 0, brotliWasm: wasm, brotliMode: brotli });
  g.bootHooks().lazyGraphics(engine as never, { file: { name: "graphics.bin", raw: RAW, size: SIZE } } as never, sab);
  return {
    g,
    region,
    posted,
    written,
    warmed,
    land: (n: number) => landPart(region, copyOf(n)),
    wait: (ms = 10) => waitGraphics(ms),
    warmThrows() {
      warmThrows = true;
    },
  };
}

/** Each copy of the part's bytes out of the region (a read with them) throws, as an allocation that fails would, until restored. */
function failReads(t: TestContext) {
  const slice = Uint8Array.prototype.slice;
  return t.mock.method(Uint8Array.prototype, "slice", function (this: Uint8Array, start?: number, end?: number) {
    if (end === SIZE) throw new RangeError("Array buffer allocation failed");
    return slice.call(this, start, end);
  });
}

/** The browser's decoder, each unpack held until release() (in the order they began). `started`: unpacks begun; `most`:
 *  the most under way at once. */
function heldDecoder(t: TestContext) {
  const Real = globalThis.DecompressionStream;
  const gates: (() => void)[] = [];
  const held = { started: 0, running: 0, most: 0, release: () => gates.shift()!() };
  class Held {
    writable: WritableStream<BufferSource>;
    #out: ReadableStream<Uint8Array>;
    constructor(format: CompressionFormat) {
      const real = new Real(format);
      this.writable = real.writable;
      this.#out = real.readable;
    }
    // read once per unpack, by its pipeThrough (hasNativeBrotli only constructs one)
    get readable() {
      held.started++;
      held.most = Math.max(held.most, ++held.running);
      const gate = new Promise<void>((ok) => gates.push(ok));
      return this.#out.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, out) {
            await gate;
            out.enqueue(chunk);
          },
          async flush() {
            await gate;
            held.running--;
          },
        }),
      );
    }
  }
  t.mock.property(globalThis, "DecompressionStream", Held as unknown as typeof DecompressionStream);
  return held;
}

test("the idle steps stop for a run in flight and go on when it ends, with nothing else to wake them", async () => {
  const w = part({ brotli: "wasm" });
  w.land(1);
  w.g.startupAnswered();
  w.g.runArrived();
  await sleep(3 * IDLE_MS); // the idle step meets the run and stops
  assert.deepEqual(w.written, [], "nothing while a run is in flight");
  w.g.runStarts();
  w.g.runEnded();
  await until(() => w.warmed.at(-1) === 2, "written and warmed while idle");
  assert.deepEqual(w.written, [1]);
});

test("a graph after the write answers at once: the part is not unpacked or written again", () => {
  const w = part({ brotli: "wasm" });
  w.land(1);
  w.g.runArrived();
  w.g.runStarts();
  assert.equal(w.wait(), "");
  assert.equal(w.wait(), "");
  assert.deepEqual(w.written, [1]);
  w.g.runEnded();
});

test("a graph that finds the part failed asks the page once for another fetch, naming the copy it read; that fetch failing too is its answer", () => {
  const w = part();
  failPart(w.region, partReason("the graphics files could not be downloaded (offline)"));
  w.g.startupAnswered();
  w.g.runArrived();
  w.g.runStarts();

  assert.equal(w.wait(), "pending");
  assert.deepEqual(w.posted, [{ graphics: "again", copy: 0 }]);
  retryPart(w.region);
  failPart(w.region, partReason("the graphics files could not be downloaded (offline again)"));
  assert.match(w.wait(), /offline again/);
  assert.deepEqual(w.posted, [{ graphics: "again", copy: 0 }], "asked once");
  w.g.runEnded();
});

test("race 13: a graph that finds a copy damaged while the browser's decoder unpacks it: the decoder's late result is dropped, not written again", async (t) => {
  const native = heldDecoder(t);
  const w = part({ failWrites: 1, page: true });
  w.land(1);
  w.g.startupAnswered();
  await until(() => native.started === 1, "the browser's decoder began");
  w.g.runArrived();
  w.g.runStarts();
  assert.match(w.wait(), /arrived damaged/, "the graph unpacks it with brotli-wasm, and the write throws");
  w.g.runEnded();
  native.release();
  await sleep(3 * IDLE_MS);
  assert.deepEqual(w.written, [1], "copy 1 written once");
  assert.deepEqual(w.posted, [{ graphics: "damaged", copy: 0 }]);
});

test("one browser decode at a time: a fresh copy that lands while the decoder still runs on a damaged one waits for it, then is unpacked and written", async (t) => {
  const native = heldDecoder(t);
  const w = part({ failWrites: 1, page: true });
  w.land(1);
  w.g.startupAnswered();
  await until(() => native.started === 1, "the browser's decoder began");
  w.g.runArrived();
  w.g.runStarts();
  assert.match(w.wait(), /arrived damaged/);
  w.g.runEnded();
  w.land(2); // the page's fetch again, as the op graphics says
  w.g.pageWrote();
  await sleep(3 * IDLE_MS);
  assert.equal(native.started, 1, "no second decode while the first runs");
  native.release(); // copy 1's result: dropped
  await until(() => native.started === 2, "the decoder takes copy 2");
  native.release();
  await until(() => w.written.length === 2, "copy 2 written while idle");
  assert.deepEqual(w.written, [1, 2]);
  assert.equal(native.most, 1);
});

test("a Break during a graph's own unpack while the browser's decoder still runs: the idle steps wait for the decoder's end before they write", async (t) => {
  const native = heldDecoder(t);
  const w = part({ breakInUnpack: true });
  w.land(1);
  w.g.startupAnswered();
  await until(() => native.started === 1, "the browser's decoder began");
  w.g.runArrived();
  w.g.runStarts();
  assert.equal(w.wait(), "break", "the graph's brotli-wasm unpack took over, then the Break");
  w.g.runEnded();
  await sleep(3 * IDLE_MS);
  assert.deepEqual(w.written, [], "nothing written while the decoder runs");
  native.release(); // its result: dropped
  await until(() => w.written.length === 1, "written after the decoder's end");
  assert.deepEqual(w.written, [1]);
  assert.equal(native.started, 1);
});

for (const brotli of [undefined, "wasm"] as const)
  test(`race 11 (${brotli ?? "native"} decoder): damage an idle step finds blocks only its copy: a graph before the fresh copy lands waits for it, not saying the damage, and the fresh copy is unpacked and written while idle`, async () => {
    const w = part({ brotli, failWrites: 1, page: true });
    w.land(1);
    w.g.startupAnswered();
    await until(() => w.posted.length === 1, "the idle steps found copy 1 damaged");
    w.g.runArrived();
    w.g.runStarts();
    assert.equal(w.wait(), "pending", "the page fetches again: the graph waits");
    w.g.runEnded();
    w.land(2);
    w.g.pageWrote();
    await until(() => w.written.length === 2, "copy 2 written while idle");
    assert.deepEqual(w.written, [1, 2]);
    assert.equal(w.wait(), "");
    assert.deepEqual(w.posted, [{ graphics: "damaged", copy: 0 }]);
  });

test("damage the page has not acted on yet: the next graph says it, and the one after waits rather than unpack that copy again", async () => {
  const w = part({ brotli: "wasm", failWrites: 1 });
  w.land(1);
  w.g.startupAnswered();
  await until(() => w.posted.length === 1, "the idle steps found copy 1 damaged");
  w.g.runArrived();
  w.g.runStarts();
  assert.match(w.wait(), /arrived damaged/);
  assert.equal(w.wait(), "pending");
  w.g.runEnded();
  await sleep(3 * IDLE_MS);
  assert.deepEqual(w.written, [1], "copy 1 is not unpacked or written again");
});

test("a read of the part that throws (its bytes copied out, a copy a phone may not allocate) is not damage: nothing is posted, the graph says so without promising a fetch, and the next graph draws that copy", (t) => {
  const w = part({ brotli: "wasm", page: true });
  w.land(1);
  w.g.startupAnswered();
  w.g.runArrived();
  w.g.runStarts();
  const slice = Uint8Array.prototype.slice;
  const copyOut = t.mock.method(
    Uint8Array.prototype,
    "slice",
    function (this: Uint8Array, start?: number, end?: number) {
      if (end === SIZE) throw new RangeError("Array buffer allocation failed");
      return slice.call(this, start, end);
    },
  );
  const why = w.wait();
  copyOut.mock.restore();
  assert.match(why, /could not be read \(Array buffer allocation failed\)/);
  assert.doesNotMatch(why, /fetched again/);
  assert.deepEqual(w.posted, []);
  assert.equal(w.wait(), "");
  assert.deepEqual(w.written, [1]);
  w.g.runEnded();
});

test("a read that throws in the browser decoder's own task is not damage and does not escape: nothing is posted, and a graph draws that copy", async (t) => {
  const w = part({ page: true });
  w.land(1);
  const reads = failReads(t);
  w.g.startupAnswered();
  await sleep(IDLE_MS / 2);
  reads.mock.restore();
  assert.deepEqual(w.posted, []);
  w.g.runArrived();
  w.g.runStarts();
  assert.equal(w.wait(), "");
  assert.deepEqual(w.written, [1]);
  w.g.runEnded();
});

test("a read that throws in an idle step is not damage: nothing is posted or written, and the next run's end unpacks and writes that copy", async (t) => {
  const w = part({ brotli: "wasm", page: true });
  w.land(1);
  const reads = failReads(t);
  w.g.startupAnswered();
  await sleep(3 * IDLE_MS);
  reads.mock.restore();
  assert.deepEqual(w.posted, []);
  assert.deepEqual(w.written, []);
  w.g.runArrived();
  w.g.runStarts();
  w.g.runEnded();
  await until(() => w.written.length === 1, "the idle steps wrote copy 1");
  assert.deepEqual(w.posted, []);
});

test("finding 15: a warm step's throw is a warning that stops the warm-up, not damage: nothing is posted, no further step is tried, and a graph draws", async () => {
  const w = part({ brotli: "wasm" });
  w.warmThrows();
  w.land(1);
  const from = said.length;
  w.g.startupAnswered();
  await until(() => w.warmed.length === 1, "the first warm step");
  w.g.runArrived();
  w.g.runStarts();
  w.g.runEnded(); // a run's end and a page write wake the idle steps
  w.g.pageWrote();
  await sleep(3 * IDLE_MS);
  assert.deepEqual(w.warmed, [0]);
  assert.deepEqual(w.posted, []);
  assert.match(said.slice(from).join("\n"), /warm-up stopped \(No module named 'pyparsing'\)/);
  w.g.runArrived();
  w.g.runStarts();
  assert.equal(w.wait(), "");
  assert.deepEqual(w.written, [1]);
});
