// The shared buffer the page hands the lazy graphics part over in: what the page writes, the worker reads
// (src/engine/lazy-part.ts; client.ts writes, worker.ts reads).

import assert from "node:assert/strict";
import { test } from "node:test";
import { PART_FAILED, PART_LANDED, PART_PENDING } from "../src/engine/lazy-part.ts";
import { PART_HEADER } from "../src/engine/snapshot.ts";

// Today's layout, written as the page writes it and read as the worker reads it: Int32 [state, length, tries, 0]
const land = (sab: SharedArrayBuffer, bytes: Uint8Array) => {
  new Uint8Array(sab, PART_HEADER).set(bytes);
  const hdr = new Int32Array(sab, 0, 4);
  Atomics.store(hdr, 1, bytes.length);
  Atomics.store(hdr, 0, PART_LANDED);
  Atomics.notify(hdr, 0);
};
const fail = (sab: SharedArrayBuffer, why: string) => {
  const text = new TextEncoder().encode(why).subarray(0, sab.byteLength - PART_HEADER),
    hdr = new Int32Array(sab, 0, 4);
  new Uint8Array(sab, PART_HEADER).set(text);
  Atomics.store(hdr, 1, text.length);
  Atomics.store(hdr, 0, PART_FAILED);
  Atomics.notify(hdr, 0);
};
const retry = (sab: SharedArrayBuffer) => {
  const hdr = new Int32Array(sab, 0, 4);
  Atomics.store(hdr, 1, 0);
  Atomics.add(hdr, 2, 1);
  Atomics.store(hdr, 0, PART_PENDING);
  Atomics.notify(hdr, 0);
};
const see = (sab: SharedArrayBuffer) => {
  const hdr = new Int32Array(sab, 0, 4);
  const tries = Atomics.load(hdr, 2),
    state = Atomics.load(hdr, 0);
  return { state, tries, data: new Uint8Array(sab, PART_HEADER, hdr[1]).slice() };
};

test("a new buffer is pending, with no bytes and no tries", () => {
  const r = see(new SharedArrayBuffer(PART_HEADER + 8));
  assert.deepEqual([r.state, r.tries, r.data.length], [PART_PENDING, 0, 0]);
});

test("a landed part is read back byte for byte", () => {
  const sab = new SharedArrayBuffer(PART_HEADER + 8);
  land(sab, Uint8Array.of(1, 2, 3));
  const r = see(sab);
  assert.equal(r.state, PART_LANDED);
  assert.deepEqual([...r.data], [1, 2, 3]);
});

test("a reason longer than the buffer is cut to fit", () => {
  const sab = new SharedArrayBuffer(PART_HEADER + 5);
  fail(sab, "abcdefghij");
  const r = see(sab);
  assert.equal(r.state, PART_FAILED);
  assert.equal(new TextDecoder().decode(r.data), "abcde");
});

test("a retry counts a try, clears the length and is pending again", () => {
  const sab = new SharedArrayBuffer(PART_HEADER + 8);
  fail(sab, "no");
  retry(sab);
  const r = see(sab);
  assert.deepEqual([r.state, r.tries, r.data.length], [PART_PENDING, 1, 0]);
  land(sab, Uint8Array.of(9));
  assert.deepEqual([...see(sab).data], [9]);
  assert.equal(see(sab).tries, 1);
});
