// The shared region the lazy graphics part is handed over in (src/engine/lazy-part.ts, on seqlock.ts): what the page's
// writers leave, as the worker's readPart sees it, and the layout.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartRead } from "../src/engine/lazy-part.ts";
import {
  failPart,
  HDR_COPY,
  HDR_LENGTH,
  HDR_SEQ,
  HDR_STATE,
  landPart,
  PART_HEADER,
  PART_LANDED,
  partReason,
  partRegion,
  readPart,
  retryPart,
} from "../src/engine/lazy-part.ts";

const make = (room: number) => {
  const sab = new SharedArrayBuffer(PART_HEADER + room);
  return { sab, part: partRegion(sab) };
};
// what the worker sees: one whole snapshot, the bytes copied
const see = (part: ReturnType<typeof partRegion>): PartRead => {
  const read = readPart(part, 0, { withBytes: true });
  assert.ok("value" in read, "not busy: no write is under way");
  return read.value;
};

test("a new region is pending, at copy 0", () => {
  assert.deepEqual(see(make(8).part), { state: "pending", copy: 0 });
});

test("a landed part is read back byte for byte, its bytes only when asked for", () => {
  const { part } = make(8);
  landPart(part, Uint8Array.of(1, 2, 3));

  assert.deepEqual(see(part), { state: "landed", copy: 0, bytes: Uint8Array.of(1, 2, 3) });
  assert.deepEqual(readPart(part, 0), { seq: 2, value: { state: "landed", copy: 0, bytes: null } });
});

test("a reason longer than the room is cut to fit; an empty reason is never read back empty", () => {
  const { part } = make(5);
  failPart(part, partReason("abcdefghij"));
  assert.deepEqual(see(part), { state: "failed", copy: 0, reason: "abcde" });

  failPart(part, partReason(""));
  const read = see(part);
  assert.ok(read.state === "failed" && read.reason !== "", "partReason gives a fixed text for an empty one");
});

test("a retry counts a copy and is pending again; the copy that lands keeps its number", () => {
  const { part } = make(8);
  failPart(part, partReason("no"));
  retryPart(part);
  assert.deepEqual(see(part), { state: "pending", copy: 1 });

  landPart(part, Uint8Array.of(9));
  assert.deepEqual(see(part), { state: "landed", copy: 1, bytes: Uint8Array.of(9) });
});

test("the layout: Int32 state, length, copy, the seqlock's counter, then the bytes from PART_HEADER", () => {
  const { sab, part } = make(8);
  landPart(part, Uint8Array.of(7, 8));
  retryPart(part);
  landPart(part, Uint8Array.of(5, 6, 4));

  assert.deepEqual([HDR_STATE, HDR_LENGTH, HDR_COPY, HDR_SEQ], [0, 1, 2, 3]);
  assert.deepEqual([...new Int32Array(sab, 0, 4)], [PART_LANDED, 3, 1, 6], "three writes, the counter 2 each");
  assert.equal(PART_HEADER, 16);
  assert.deepEqual([...new Uint8Array(sab, PART_HEADER, 3)], [5, 6, 4]);
});
