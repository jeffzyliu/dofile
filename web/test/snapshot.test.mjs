// inflate and unpack (src/engine/snapshot.js): the brotli decoding of the snapshot's two big files, with the same
// brotli-wasm module the worker loads. No snapshot needs to be built for these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { inflate, isStorageRefusal, unpack } from "../src/engine/snapshot.js";

const brotli = createRequire(import.meta.url)("brotli-wasm");
const compress = (data, quality = 5) => new Uint8Array(zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } }));

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

test("only the browser refusing storage is carried on from; every other cache error is a bug and is not swallowed", () => {
  const named = (name, msg = "x") => Object.assign(new Error(msg), { name });
  for (const name of ["QuotaExceededError", "SecurityError", "NotAllowedError", "NoCacheAPI", "UnknownError"]) assert.equal(isStorageRefusal(named(name)), true, name);
  for (const e of [new TypeError("Request scheme 'blob' is unsupported"), named("InvalidStateError"), named("AbortError"), new Error("boom"), undefined, null, "QuotaExceededError"])
    assert.equal(isStorageRefusal(e), false, String(e?.name ?? e));
});
