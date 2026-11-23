// The worker's decisions about the lazy graphics part (src/engine/lazy-part.ts); worker.ts acts on them.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartEvent, PartFacts, PartRead, PartStep, PartWork, UnpackPhase } from "../src/engine/lazy-part.ts";
import {
  failPart,
  IDLE_MS,
  idleStep,
  nativeGate,
  PART_HEADER,
  partReason,
  partRegion,
  partSnapshot,
  partStep,
  retryPart,
  useNative,
  waitStep,
} from "../src/engine/lazy-part.ts";
import type { SeqRead, SeqReader } from "../src/engine/seqlock.ts";
import { readSeq } from "../src/engine/seqlock.ts";

const idle = { interrupted: false, unpacked: false, unpacking: false, askedOn: null, damage: null };
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

test("race 11: damage blocks only its own copy; it is said once, by a graph whose read gives that copy, and that copy is not unpacked again", () => {
  const damage = { copy: 2, said: false };
  assert.equal(waitStep({ ...idle, damage }, readOf(landed(2))), "say");
  assert.equal(waitStep({ ...idle, damage }, readOf(failed(2))), "say", "a failed copy too (decision B)");
  assert.equal(waitStep({ ...idle, damage }, readOf(landed(3))), "unpack", "the copy moved on: not said");
  assert.equal(waitStep({ ...idle, damage }, readOf(pending(3))), "wait");
  const said = { copy: 2, said: true };
  assert.equal(waitStep({ ...idle, damage: said }, readOf(landed(2))), "wait", "the page's fetch moves the counter");
  assert.equal(waitStep({ ...idle, damage: said }, readOf(failed(2))), "ask-again", "a failed part's own rules");
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

      // the browser comes back online midway: the page retries
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

// The part's work for the native gate and the idle step: brotli-sized is 4 bytes of a 10-byte part; the native decoder
// failed on copy 9.
const work: PartWork = {
  started: true,
  phase: "none",
  nativeRunning: false,
  damagedOn: null,
  useNative: (copy) => copy !== 9,
  file: { size: 4, raw: 10 },
};
const landedBytes = (n: number, copy = 0): PartRead => ({ state: "landed", copy, bytes: new Uint8Array(n) });

test("nativeGate: started, nothing unpacked or under way, the decoder not running; else the part is not read", () => {
  const r = reader(landedBytes(4));
  assert.deepEqual(nativeGate(work, r.read), landedBytes(4));
  assert.equal(r.reads, 1);
  const closed: [string, Partial<PartWork>][] = [
    ["before startup is answered", { started: false }],
    ["the browser's decoder is under way", { nativeRunning: true }],
    ...(["native", "unpacking", "unpacked", "written", "warming", "warmed"] as UnpackPhase[]).map(
      (phase): [string, Partial<PartWork>] => [phase, { phase }],
    ),
  ];
  for (const [why, flags] of closed) {
    const shut = reader(landedBytes(4));
    assert.equal(nativeGate({ ...work, ...flags }, shut.read), null, why);
    assert.equal(shut.reads, 0, `${why}: not read`);
  }
});

test("nativeGate: only a landed, brotli-sized copy the decoder has not failed on; a read without the bytes passes on its copy", () => {
  assert.equal(
    nativeGate(work, () => ({ seq: 3, busy: true })),
    null,
    "busy",
  );
  assert.equal(nativeGate(work, readOf(pending())), null, "pending");
  assert.equal(nativeGate(work, readOf(failed())), null, "failed");
  assert.equal(nativeGate(work, readOf(landedBytes(4, 9))), null, "the copy the decoder failed on");
  assert.deepEqual(nativeGate(work, readOf(landedBytes(4, 10))), landedBytes(4, 10), "a fresh copy after it");
  assert.equal(nativeGate(work, readOf(landedBytes(3))), null, "not the compressed size");
  assert.equal(nativeGate({ ...work, file: { size: 4, raw: 4 } }, readOf(landedBytes(4))), null, "stored, not brotli");
  assert.deepEqual(nativeGate(work, readOf(landed())), landed(), "without the bytes: the copy decides");
  assert.equal(nativeGate(work, readOf(landed(9))), null, "without the bytes, the failed copy");
  assert.equal(nativeGate({ ...work, damagedOn: 10 }, readOf(landedBytes(4, 10))), null, "race 11: damage on its copy");
  assert.deepEqual(
    nativeGate({ ...work, damagedOn: 10 }, readOf(landedBytes(4, 11))),
    landedBytes(4, 11),
    "race 11: not on a fresh one",
  );
});

test("idleStep: a run in flight, then IDLE_MS of idle, then the phase decides; none of them reads the part", () => {
  const at = { ...work, runsInFlight: 0, idleFor: IDLE_MS };
  const r = reader(landedBytes(4));
  assert.equal(idleStep({ ...at, runsInFlight: 1, phase: "unpacked" }, r.read), "run");
  assert.equal(idleStep({ ...at, idleFor: IDLE_MS - 1, phase: "unpacked" }, r.read), "later");
  const byPhase: [UnpackPhase, string][] = [
    ["unpacked", "write"],
    ["unpacking", "unpack-more"],
    ["written", "warm"],
    ["warming", "warm"],
    ["warmed", "none"],
    ["native", "none"],
  ];
  for (const [phase, step] of byPhase) assert.equal(idleStep({ ...at, phase }, r.read), step, phase);
  assert.equal(r.reads, 0, "the part (a copy of up to 33 MB) is not read");
});

test("idleStep: with nothing unpacked, a landed copy goes to the native gate when it fits, else to brotli-wasm", () => {
  const at = { ...work, runsInFlight: 0, idleFor: IDLE_MS };
  assert.equal(idleStep(at, readOf(landedBytes(4))), "native");
  assert.equal(
    idleStep({ ...at, nativeRunning: true }, readOf(landedBytes(4))),
    "native",
    "the gate, not a second unpack",
  );
  assert.equal(idleStep(at, readOf(landedBytes(4, 9))), "unpack", "the copy the decoder failed on");
  assert.equal(idleStep(at, readOf(landedBytes(3))), "unpack", "not brotli-sized: brotli-wasm says what is wrong");
  assert.equal(idleStep({ ...at, useNative: () => false }, readOf(landedBytes(4))), "unpack", "no native decoder");
  for (const useNative of [() => true, () => false]) {
    const damaged = { ...at, useNative, damagedOn: 5 };
    assert.equal(idleStep(damaged, readOf(landedBytes(4, 5))), "none", "race 11: damage on the read's copy");
    assert.notEqual(idleStep(damaged, readOf(landedBytes(4, 6))), "none", "race 11: not on a fresh copy");
  }
  assert.equal(
    idleStep(at, () => ({ seq: 1, busy: true })),
    "none",
    "busy",
  );
  assert.equal(idleStep(at, readOf(pending())), "none");
  assert.equal(idleStep(at, readOf(failed())), "none");
});

test("partStep: the page's table, row by row, with the events it drops", () => {
  const facts = (o: Partial<PartFacts> = {}): PartFacts => ({
    fetch: null,
    fresh: false,
    damagedCopy: null,
    listening: false,
    ...o,
  });
  const fetchOf = (copy: number) => ({ copy, downloading: false, received: 0 });
  const pending = (copy: number) => ({ state: "pending" as const, copy });
  const landed = (copy: number) => ({ state: "landed" as const, copy });
  const failed = (copy: number) => ({ state: "failed" as const, copy });
  const bytes = new Uint8Array(1);
  const rows: [string, Pick<PartRead, "state" | "copy">, PartFacts, PartEvent, PartStep][] = [
    [
      "want: a fetch of the region's copy",
      pending(0),
      facts(),
      { type: "want" },
      { effect: "fetch", facts: facts({ fetch: fetchOf(0) }) },
    ],
    [
      "want, a fetch on its way",
      pending(0),
      facts({ fetch: fetchOf(0) }),
      { type: "want" },
      { effect: "none", facts: facts({ fetch: fetchOf(0) }) },
    ],
    ["want, landed", landed(0), facts(), { type: "want" }, { effect: "none", facts: facts() }],
    [
      "fetched: landed, fresh cleared",
      pending(1),
      facts({ fetch: fetchOf(1), fresh: true }),
      { type: "fetched", copy: 1, bytes },
      { effect: "land", facts: facts() },
    ],
    [
      "fetch failed: failed, the online listener set",
      pending(1),
      facts({ fetch: fetchOf(1), fresh: true }),
      { type: "fetch-failed", copy: 1, why: "x" },
      { effect: "fail", facts: facts({ fresh: true, listening: true }) },
    ],
    [
      "fetch failed, the listener already set",
      pending(1),
      facts({ fetch: fetchOf(1), listening: true }),
      { type: "fetch-failed", copy: 1, why: "x" },
      { effect: "fail", facts: facts({ listening: true }) },
    ],
    [
      "a result for a fetch not on its way",
      pending(1),
      facts({ fetch: fetchOf(1) }),
      { type: "fetched", copy: 0, bytes },
      { effect: "none", facts: facts({ fetch: fetchOf(1) }) },
    ],
    [
      "a result the region has moved past: the fetch ends, nothing written",
      landed(1),
      facts({ fetch: fetchOf(1) }),
      { type: "fetched", copy: 1, bytes },
      { effect: "none", facts: facts() },
    ],
    [
      "again naming the failed copy: one copy more",
      failed(1),
      facts({ listening: true }),
      { type: "again", copy: 1 },
      { effect: "retry", facts: facts({ fetch: fetchOf(2), listening: true }) },
    ],
    [
      "again naming a replaced copy",
      failed(2),
      facts(),
      { type: "again", copy: 1 },
      { effect: "none", facts: facts() },
    ],
    ["again, landed", landed(1), facts(), { type: "again", copy: 1 }, { effect: "none", facts: facts() }],
    [
      "online, failed: one copy more, the listener spent",
      failed(1),
      facts({ listening: true }),
      { type: "online" },
      { effect: "retry", facts: facts({ fetch: fetchOf(2) }) },
    ],
    [
      "online, not failed: the listener spent",
      landed(1),
      facts({ listening: true }),
      { type: "online" },
      { effect: "none", facts: facts() },
    ],
    [
      "damaged copy 0, none before (null, not -1)",
      landed(0),
      facts(),
      { type: "damaged", copy: 0 },
      { effect: "retry", facts: facts({ fetch: fetchOf(1), fresh: true, damagedCopy: 0 }) },
    ],
    [
      "damaged, not right after a damaged copy",
      landed(3),
      facts({ damagedCopy: 1 }),
      { type: "damaged", copy: 3 },
      { effect: "retry", facts: facts({ fetch: fetchOf(4), fresh: true, damagedCopy: 3 }) },
    ],
    [
      "damaged right after a damaged copy: decision B",
      landed(2),
      facts({ damagedCopy: 1 }),
      { type: "damaged", copy: 2 },
      { effect: "fail-damaged", facts: facts({ fresh: true, damagedCopy: 2, listening: true }) },
    ],
    [
      "damaged naming a replaced copy (race 13)",
      landed(1),
      facts({ damagedCopy: 0 }),
      { type: "damaged", copy: 0 },
      { effect: "none", facts: facts({ damagedCopy: 0 }) },
    ],
    [
      "damaged, failed by decision B already",
      failed(2),
      facts({ damagedCopy: 2 }),
      { type: "damaged", copy: 2 },
      { effect: "none", facts: facts({ damagedCopy: 2 }) },
    ],
    [
      "damaged, pending",
      pending(1),
      facts({ fetch: fetchOf(1) }),
      { type: "damaged", copy: 1 },
      { effect: "none", facts: facts({ fetch: fetchOf(1) }) },
    ],
  ];
  for (const [name, now, before, event, step] of rows) assert.deepEqual(partStep(now, before, event), step, name);
});
