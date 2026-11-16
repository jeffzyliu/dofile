// inflate and unpack (src/engine/snapshot.ts): the brotli decoding of the snapshot's two big files, with the same
// brotli-wasm module the worker loads. No snapshot needs to be built for these.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import zlib from "node:zlib";
import {
  hasNativeBrotli,
  inflate,
  inflateNative,
  isDeadWeight,
  isStorageRefusal,
  packGraphics,
  type SnapshotPy,
  unpack,
  unpackAsync,
  unpackSteps,
  writeGraphics,
  zeroFreeMemory,
  zeroLibraryCopies,
} from "../src/engine/snapshot.ts";

const brotli = createRequire(import.meta.url)("brotli-wasm");
const compress = (data: Uint8Array, quality = 5) =>
  new Uint8Array(zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } }));

// incompressible, repetitive and zero-filled parts, longer than the decoder's input and output steps
const random = crypto.randomBytes(3_000_000);
const data = Buffer.concat([random, Buffer.alloc(9_000_000, "dofile snapshot "), Buffer.alloc(5_000_000), random]);
const packed = compress(data);

test("inflate gives back the original bytes, in steps of any size", () => {
  for (const steps of [{}, { inStep: 1000, outStep: 1 << 20 }, { inStep: 1 << 24, outStep: 5000 }]) {
    const out = inflate(brotli, packed, data.length, steps);
    assert.equal(Buffer.compare(Buffer.from(out.buffer, out.byteOffset, out.length), data), 0, JSON.stringify(steps));
  }
});

test("unpackSteps decodes in steps (the lazy graphics part: a run or a Break between two), to the same bytes", () => {
  const file = { raw: data.length, size: packed.length };
  const it = unpackSteps(brotli, packed, file, 64 << 10);
  let steps = 0,
    r = it.next();
  for (; !r.done; r = it.next()) steps++;
  assert.ok(steps >= Math.floor(packed.length / (64 << 10)) - 1, `${steps} steps`);
  assert.ok(Buffer.from(r.value).equals(data));
  assert.equal(unpackSteps(brotli, data, file, 1024).next().value, data); // already decoded: as it is, no step
  assert.throws(() => unpackSteps(brotli, packed.subarray(1), file, 1024).next(), /the manifest says/);
});

test("inflate refuses a damaged, truncated or wrongly sized file", () => {
  assert.throws(() => inflate(brotli, packed.subarray(0, packed.length - 1000), data.length), /truncated or damaged/);
  assert.throws(() => inflate(brotli, new Uint8Array(crypto.randomBytes(5000)), data.length), /decompress/i);
  assert.throws(() => inflate(brotli, packed, data.length - 1), /larger than the/);
  assert.throws(() => inflate(brotli, packed, data.length + 1), /truncated or damaged/);
});

test("unpack decodes a file, passes through one a host already decoded, and checks the manifest's size", () => {
  const file = { raw: data.length, size: packed.length };
  assert.equal(Buffer.compare(Buffer.from(unpack(brotli, packed, file)), data), 0);
  const decoded = new Uint8Array(data);
  assert.equal(unpack(brotli, decoded, file), decoded, "bytes of the raw length are used as they are");
  assert.throws(() => unpack(brotli, packed.subarray(0, 100), file), /manifest says .*npm run snapshot/);
});

// the browser's own decoder (DecompressionStream("brotli")); skipped where the runtime has none
test("inflateNative and unpackAsync give the same bytes as brotli-wasm, and a damaged file falls back to the wasm error", {
  skip: !hasNativeBrotli() && "no native brotli here",
}, async () => {
  const out = await inflateNative(packed, data.length);
  assert.equal(Buffer.compare(Buffer.from(out.buffer, out.byteOffset, out.length), data), 0);
  await assert.rejects(inflateNative(packed.subarray(0, packed.length - 1000), data.length));
  await assert.rejects(inflateNative(packed, data.length - 1), /larger than the/);
  const file = { raw: data.length, size: packed.length };
  const [viaNative, how] = await unpackAsync(brotli, packed, file, true);
  assert.equal(how, "native");
  assert.equal(Buffer.compare(Buffer.from(viaNative), data), 0);
  const [viaWasm, how2] = await unpackAsync(brotli, packed, file, false);
  assert.equal(how2, "wasm");
  assert.equal(Buffer.compare(Buffer.from(viaWasm), data), 0);
  // a truncated file the manifest agrees with: the native decoder fails, then brotli-wasm gives the error
  const cut = packed.subarray(0, packed.length - 1000);
  await assert.rejects(unpackAsync(brotli, cut, { raw: data.length, size: cut.length }, true), /truncated or damaged/);
});

test("only the browser refusing storage is carried on from; every other cache error is a bug and is not swallowed", () => {
  const named = (name: string, msg = "x") => Object.assign(new Error(msg), { name });
  for (const name of ["QuotaExceededError", "SecurityError", "NotAllowedError", "NoCacheAPI", "UnknownError"])
    assert.equal(isStorageRefusal(named(name)), true, name);
  for (const e of [
    new TypeError("Request scheme 'blob' is unsupported"),
    named("InvalidStateError"),
    named("AbortError"),
    new Error("boom"),
    undefined,
    null,
    "QuotaExceededError",
  ] as any[])
    assert.equal(isStorageRefusal(e), false, String(e?.name ?? e));
});

test("the bundle leaves out test folders and type stubs, and nothing that runs", () => {
  for (const p of [
    "scipy/io/tests/data/a.mat",
    "scipy/stats/tests/test_x.py",
    "pkg/test/data.npy",
    "numpy/__init__.pyi",
    "numpy/py.typed",
  ])
    assert.equal(isDeadWeight(p), true, p);
  for (const p of [
    "numpy/testing/_private/utils.py",
    "numpy/core/_multiarray_umath.so",
    "pkg/latest/a.py",
    "pytest.py",
    "pkg/tests.py",
    "pkg/typed_py.typed.py",
  ])
    assert.equal(isDeadWeight(p), false, p);
});

// a stand-in for Pyodide's module: a small heap, and the parts of it the two scrub steps use
const fakePy = (module: object): SnapshotPy => ({ _module: module }) as unknown as SnapshotPy;

test("zeroLibraryCopies zeroes every handle's copy that equals its file, the unlogged ones too, and no other", () => {
  const heap = new Uint8Array(4096).fill(7),
    u32 = new Uint32Array(heap.buffer),
    files: Record<string, Uint8Array> = { "/a.so": new Uint8Array(100).fill(7), "/b.so": new Uint8Array(100).fill(9) };
  const handle = (at: number, path: string, ptr: number, size: number) => {
    u32[(at + 28) >> 2] = ptr;
    u32[(at + 32) >> 2] = size;
    heap.set(new TextEncoder().encode(`${path}\0`), at + 36);
  };
  handle(256, "/a.so", 1024, 100); // identical to its file
  handle(512, "/b.so", 2048, 100); // differs from its file
  handle(768, "/a.so", 0, 0); // no buffer
  const py = fakePy({
    HEAPU8: heap,
    HEAPU32: u32,
    LDSO: { loadedLibsByHandle: { 0: {}, 256: {}, 512: {}, 768: {} } },
    FS: { readFile: (path: string) => files[path] },
    UTF8ToString: (at: number) => new TextDecoder().decode(heap.subarray(at, heap.indexOf(0, at))),
  });
  assert.deepEqual(zeroLibraryCopies(py), { zeroed: 1, bytes: 100, kept: 1 });
  assert.ok(heap.subarray(1024, 1124).every((b) => b === 0));
  assert.ok(heap.subarray(2048, 2148).every((b) => b === 7));
  assert.equal(heap[1124], 7);
});

test("zeroFreeMemory zeroes the free blocks only, frees them all again, and lifts its heap cap afterwards", () => {
  const heap = new Uint8Array(1 << 22).fill(5),
    free: { at: number; len: number }[] = [{ at: 100_000, len: 3_000_000 }]; // everything else is in use
  const mod: any = {
    HEAPU8: heap,
    _sbrk: () => heap.length,
    _malloc(size: number) {
      assert.equal(mod.dofileHeapMax, heap.length, "the cap is on while the step runs");
      const r = free.find((f) => f.len >= size);
      if (!r) return 0;
      const at = r.at;
      r.at += size;
      r.len -= size;
      return at;
    },
    _free(at: number) {
      freed.push(at);
    },
  };
  const freed: number[] = [];
  const out = zeroFreeMemory(fakePy(mod));
  assert.ok(out.bytes >= 2_999_000 && out.bytes <= 3_000_000 && out.blocks > 0);
  assert.equal(freed.length, out.blocks);
  assert.equal(mod.dofileHeapMax, undefined);
  assert.ok(heap.subarray(100_000, 100_000 + out.bytes).every((b) => b === 0));
  assert.equal(heap[99_999], 5);
  assert.equal(heap[100_000 + out.bytes + 20], 5); // past what malloc handed out (under 16 bytes left)

  // growth of the heap is an error, and the cap comes off anyway
  const growing: any = { HEAPU8: heap, _sbrk: () => 0, _malloc: () => 0, _free() {} };
  Object.defineProperty(growing, "HEAPU8", { get: () => new Uint8Array(growing.n++ ? 2 : 1) });
  growing.n = 0;
  assert.throws(() => zeroFreeMemory(fakePy(growing)), /grew the heap/);
  assert.equal(growing.dofileHeapMax, undefined);
});

test("the graphics part (a lazy snapshot): packGraphics, then writeGraphics puts each file back, and refuses one that does not add up", () => {
  const written = new Map<string, Uint8Array>(),
    dirs: string[] = [],
    ran: string[] = [];
  const py = {
    FS: {
      mkdirTree: (d: string) => dirs.push(d),
      writeFile: (p: string, b: Uint8Array) => written.set(p, b.slice()),
    },
    runPython: (code: string) => ran.push(code),
  } as unknown as Parameters<typeof writeGraphics>[0];
  const index = [
    { path: "/lib/site/a/x.py", size: 3 },
    { path: "/lib/site/a/b/y.so", size: 0 },
    { path: "/lib/site/z.pyc", size: 2 },
  ];
  const raw = packGraphics(index, new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(writeGraphics(py, raw), 3);
  assert.deepEqual([...written.get("/lib/site/a/x.py")!], [1, 2, 3]);
  assert.deepEqual([...written.get("/lib/site/a/b/y.so")!], []);
  assert.deepEqual([...written.get("/lib/site/z.pyc")!], [4, 5]);
  assert.deepEqual(dirs, ["/lib/site/a", "/lib/site/a/b", "/lib/site"]);
  assert.match(ran.join(), /invalidate_caches/); // Python must look again for the new files
  assert.throws(() => writeGraphics(py, raw.subarray(0, raw.length - 1)), { name: "SnapshotError" });
});
