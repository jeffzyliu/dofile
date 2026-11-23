// worker-graphics.ts's record with a fake engine: the shared region is real (lazy-part.ts) and the part a small brotli
// file; Python, the engine's calls and the page are fakes. Node has the browser's decoder (DecompressionStream "brotli");
// heldDecoder holds it until the test lets it go. Each test's worker gets its own fakes, so a timer it leaves behind
// touches nothing another test reads.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, type TestContext, test } from "node:test";
import { format } from "node:util";
import { brotliCompressSync } from "node:zlib";
import { IDLE_MS, landPart, PART_HEADER, partRegion, retryPart } from "../src/engine/lazy-part.ts";
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
 */
function part({ brotli, failWrites = 0, page = false }: { brotli?: "wasm"; failWrites?: number; page?: boolean } = {}) {
  const sab = new SharedArrayBuffer(PART_HEADER + SIZE);
  const region = partRegion(sab);
  const posted: FromWorker[] = [];
  const written: number[] = []; // each write's copy (its file's first byte), the ones that threw too
  const warmed: number[] = []; // each warm_graphics step's `at`
  let fails = failWrites;
  let warmThrows = false;
  let waitGraphics: (ms: number) => string = () => assert.fail("lazy_graphics was not called");
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
    interrupt: () => null,
    errorOf: (e) => ({ message: e instanceof Error ? e.message : String(e) }),
    post(m) {
      posted.push(m);
      if (page && "graphics" in m && m.graphics === "damaged") retryPart(region);
    },
  });
  g.mounted({ snapshotURL: "", built: 0, brotliWasm, brotliMode: brotli });
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
