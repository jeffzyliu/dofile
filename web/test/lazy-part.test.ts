// The worker's decisions about the lazy graphics part (src/engine/lazy-part.ts); worker.ts acts on them.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartRead } from "../src/engine/lazy-part.ts";
import {
  failPart,
  PART_HEADER,
  partReason,
  partRegion,
  partSnapshot,
  retryPart,
  useNative,
  waitStep,
} from "../src/engine/lazy-part.ts";
import type { SeqRead, SeqReader } from "../src/engine/seqlock.ts";
import { readSeq } from "../src/engine/seqlock.ts";

const idle = { interrupted: false, unpacked: false, unpacking: false, askedOn: null };
const offline = partReason("offline");
// a read that counts how often it is made
const reader = (part: PartRead) => {
  const r = {
    reads: 0,
    read: (): SeqRead<PartRead> => {
      r.reads++;
      return { seq: 0, value: part };
    },
  };
  return r;
};
const readOf = (part: PartRead) => () => ({ seq: 0, value: part });
const landed = (copy = 0): PartRead => ({ state: "landed", copy, bytes: null });
const pending = (copy = 0): PartRead => ({ state: "pending", copy });
const failed = (copy = 0): PartRead => ({ state: "failed", copy, reason: offline });

test("waitStep: a Break comes first, then an unpacked part is written, then an unpack goes on; none of them reads the part", () => {
  const r = reader(landed());
  assert.equal(waitStep({ ...idle, interrupted: true, unpacked: true, unpacking: true }, r.read), "break");
  assert.equal(waitStep({ ...idle, unpacked: true, unpacking: true }, r.read), "write");
  assert.equal(waitStep({ ...idle, unpacking: true }, r.read), "unpack-more");
  assert.equal(r.reads, 0, "the part (a copy of up to 33 MB) is not read");
});

test("waitStep: a part that landed is unpacked; one that is pending, or a busy read, waits", () => {
  const r = reader(landed());
  assert.equal(waitStep(idle, r.read), "unpack");
  assert.equal(r.reads, 1);
  assert.equal(waitStep(idle, readOf(pending())), "wait");
  assert.equal(waitStep({ ...idle, askedOn: 3 }, readOf(pending(4))), "wait");
  assert.equal(
    waitStep(idle, () => ({ seq: 7, busy: true })),
    "wait",
    "the page is writing it",
  );
});

test("waitStep: a failed part is asked for again once per run; that fetch's failure (the copy moved on) is final, with its reason", () => {
  assert.equal(waitStep(idle, readOf(failed(2))), "ask-again", "first: ask the page (askedOn := 2)");
  assert.equal(waitStep({ ...idle, askedOn: 2 }, readOf(failed(2))), "wait", "the page has not begun");
  assert.deepEqual(
    waitStep({ ...idle, askedOn: 2 }, readOf(failed(3))),
    { giveUp: offline },
    "the asked-for fetch failed",
  );
  assert.equal(waitStep({ ...idle, askedOn: 2 }, readOf(pending(3))), "wait", "the asked-for fetch is on its way");
});

test('races 1 to 3: a page retry anywhere inside a graph\'s read of a failed part gives a whole snapshot or busy, never the reason "" (the answer for written)', () => {
  // copy, length, state, then the reason's bytes: the retry comes after each read in turn
  for (let after = 1; after <= 4; after++) {
    for (const waitMs of [100, 0]) {
      const sab = new SharedArrayBuffer(PART_HEADER + 64);
      const part = partRegion(sab);
      failPart(part, offline);
      retryPart(part); // the graph asked again at copy 0
      failPart(part, partReason("offline again"));

      // the browser comes back online midway: #retryGraphics
      let readCount = 0;
      const online = () => {
        if (++readCount === after) retryPart(part);
      };
      const read = readSeq(
        part,
        (r: SeqReader) =>
          partSnapshot(
            {
              readWord(word) {
                const value = r.readWord(word);
                online();
                return value;
              },
              readBytes(count) {
                const bytes = r.readBytes(count);
                online();
                return bytes;
              },
            },
            { withBytes: true },
          ),
        waitMs,
      );
      const step = waitStep({ ...idle, askedOn: 0 }, () => read);

      const where = `retry after read ${after}, waitMs ${waitMs}`;
      assert.ok(readCount >= after, `${where}: the retry was made`);
      if (waitMs === 0) assert.ok("busy" in read, `${where}: busy`);
      else assert.deepEqual("value" in read && read.value, { state: "pending", copy: 2 }, `${where}: the new snapshot`);
      const answer = typeof step === "object" ? step.giveUp : "pending";
      assert.notEqual(answer, "", `${where}: never the answer for written`);
    }
  }
});

test("useNative: the browser's decoder where there is one, unless mount forced brotli-wasm", () => {
  assert.equal(useNative(undefined, true, null, 0), true);
  assert.equal(useNative("native", true, null, 0), true);
  assert.equal(useNative(undefined, false, null, 0), false, "no native decoder (Chromium)");
  assert.equal(useNative("wasm", true, null, 0), false, "forced");
  assert.equal(useNative("wasm", true, 1, 2), false, "forced, a fresh copy too");
});

test("useNative: after the native decoder failed on a copy, that copy goes to brotli-wasm, and a fresh copy is native again", () => {
  assert.equal(useNative(undefined, true, 0, 0), false, "the copy it failed on");
  assert.equal(useNative(undefined, true, 0, 1), true, "the page fetched it again (or the worker did)");
  assert.equal(useNative(undefined, false, 0, 1), false, "still only where there is a native decoder");
});
