// The worker's decisions about the lazy graphics part (src/engine/lazy-part.ts); worker.ts acts on them.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartRead } from "../src/engine/lazy-part.ts";
import {
  failPart,
  PART_FAILED,
  PART_HEADER,
  PART_LANDED,
  PART_PENDING,
  partData,
  partHeader,
  partState,
  partTries,
  retryPart,
  useNative,
  waitStep,
} from "../src/engine/lazy-part.ts";

const idle = { interrupted: false, decoded: false, decoding: false, askedAt: null, fetchSaid: false };
// a read that counts how often it is made
const reader = (part: PartRead) => {
  const r = {
    reads: 0,
    read: () => {
      r.reads++;
      return part;
    },
  };
  return r;
};
const shared = (state: number, tries = 0): PartRead => ({ state, tries, shared: true });

test("waitStep: a Break comes first, then a decoded part is written, then a decode goes on; none of them reads the part", () => {
  const r = reader(shared(PART_LANDED));
  assert.equal(waitStep({ ...idle, interrupted: true, decoded: true, decoding: true }, r.read), "break");
  assert.equal(waitStep({ ...idle, decoded: true, decoding: true }, r.read), "write");
  assert.equal(waitStep({ ...idle, decoding: true }, r.read), "decode-more");
  assert.equal(r.reads, 0, "the part (a copy of up to 33 MB) is not read");
});

test("waitStep: a part that landed is decoded, with a shared buffer or without; one that is pending waits", () => {
  for (const part of [shared(PART_LANDED), { state: PART_LANDED, tries: 0, shared: false }]) {
    const r = reader(part);
    assert.equal(waitStep(idle, r.read), "decode");
    assert.equal(r.reads, 1);
  }
  assert.equal(
    waitStep(idle, () => shared(PART_PENDING)),
    "wait-pending",
  );
  assert.equal(
    waitStep({ ...idle, askedAt: 3 }, () => shared(PART_PENDING, 4)),
    "wait-pending",
  );
});

test("waitStep: a failed part is asked for again once per run; that fetch's failure (tries moved on) is final", () => {
  assert.equal(
    waitStep(idle, () => shared(PART_FAILED, 2)),
    "ask-again",
    "first: ask the page (askedAt := 2)",
  );
  assert.equal(
    waitStep({ ...idle, askedAt: 2 }, () => shared(PART_FAILED, 2)),
    "wait-failed",
    "the page has not begun",
  );
  assert.equal(
    waitStep({ ...idle, askedAt: 2 }, () => shared(PART_FAILED, 3)),
    "give-up",
    "the asked-for fetch failed",
  );
  assert.equal(
    waitStep({ ...idle, askedAt: 2 }, () => shared(PART_PENDING, 3)),
    "wait-pending",
    "the asked-for fetch is on its way",
  );
});

test('race 3: a page retry between a graph\'s read of a failed part and of its reason never answers "" (the answer for written)', () => {
  const sab = new SharedArrayBuffer(PART_HEADER + 64);
  failPart(sab, "offline");
  retryPart(sab); // the graph asked again at tries 0
  failPart(sab, "offline again");

  // the graph reads the part as waitGraphics does; the browser comes back online after the state
  const hdr = partHeader(sab);
  const tries = partTries(hdr);
  const state = partState(hdr);
  retryPart(sab);
  const reason = new TextDecoder().decode(partData(sab, hdr));
  const step = waitStep({ ...idle, askedAt: 0 }, () => ({ state, tries, shared: true }));

  const answer = step === "give-up" ? reason : "pending";
  assert.notEqual(answer, "", "a give-up answers a whole reason, never the empty one");
});

test("waitStep: without a shared buffer, a graph says it waits first, then fetches the part itself (pending or failed)", () => {
  for (const state of [PART_PENDING, PART_FAILED]) {
    const part = { state, tries: 0, shared: false };
    assert.equal(
      waitStep(idle, () => part),
      "say-fetching",
    );
    assert.equal(
      waitStep({ ...idle, fetchSaid: true }, () => part),
      "fetch",
    );
    assert.equal(
      waitStep({ ...idle, fetchSaid: true, askedAt: 0 }, () => part),
      "fetch",
      "askedAt is the page's",
    );
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
