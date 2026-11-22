// The shared buffer the page hands the lazy graphics part over in: what the page writes, the worker reads
// (src/engine/lazy-part.ts; client.ts writes, worker.ts reads), both through the module's names.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  failPart,
  HDR_LENGTH,
  HDR_STATE,
  HDR_TRIES,
  landPart,
  PART_FAILED,
  PART_HEADER,
  PART_LANDED,
  PART_PENDING,
  partData,
  partHeader,
  partState,
  partTries,
  retryPart,
} from "../src/engine/lazy-part.ts";

// what the worker sees, in the order it reads (tries before state)
const see = (sab: SharedArrayBuffer) => {
  const hdr = partHeader(sab),
    tries = partTries(hdr),
    state = partState(hdr);
  return { state, tries, data: partData(sab, hdr) };
};
const land = landPart,
  fail = failPart,
  retry = retryPart;

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

test("the layout: Int32 state, length, tries, then the bytes from PART_HEADER", () => {
  const sab = new SharedArrayBuffer(PART_HEADER + 8);
  land(sab, Uint8Array.of(7, 8));
  retry(sab);
  land(sab, Uint8Array.of(5, 6, 4));
  const raw = new Int32Array(sab, 0, 4);
  assert.deepEqual([HDR_STATE, HDR_LENGTH, HDR_TRIES], [0, 1, 2]);
  assert.deepEqual([...raw], [PART_LANDED, 3, 1, 0]);
  assert.equal(PART_HEADER, 16);
  assert.deepEqual([...new Uint8Array(sab, PART_HEADER, 3)], [5, 6, 4]);
});
