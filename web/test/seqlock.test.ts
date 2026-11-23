// The seqlock utility (src/engine/seqlock.ts): the counter's rule, the staged write, the re-checked read, and a writer
// on a second thread. Its types: test/seqlock.types.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import type { SeqReader, SeqWriter } from "../src/engine/seqlock.ts";
import { readSeq, seqRegion, waitSeq, writeSeq } from "../src/engine/seqlock.ts";

const WORDS = 4; // three words, then the counter
const SEQLOCK_URL = new URL("../src/engine/seqlock.ts", import.meta.url).href;

const counter = (sab: SharedArrayBuffer) => new Int32Array(sab, 0, WORDS)[WORDS - 1];
const fresh = (room = 8) => {
  const sab = new SharedArrayBuffer(WORDS * 4 + room);
  return { sab, region: seqRegion(sab, WORDS) };
};
const snapshot = (reader: SeqReader) => ({
  words: [0, 1, 2].map((at) => reader.readWord(at)),
  bytes: [...reader.readBytes(reader.readWord(1))],
});

// A second thread that imports seqlock.ts and runs `body` with { seqRegion, writeSeq }, the buffer and `data`
function thread(body: string, sab: SharedArrayBuffer, data: Record<string, unknown> = {}) {
  const code = `const { workerData, parentPort } = require("node:worker_threads");
import(workerData.url).then(({ seqRegion, writeSeq }) => { const region = seqRegion(workerData.sab, ${WORDS}); ${body} });`;
  return new Worker(code, { eval: true, workerData: { url: SEQLOCK_URL, sab, ...data } });
}
const ended = (worker: Worker) => new Promise((ok) => worker.once("exit", ok));

test("a new region's counter is 0; each writeSeq leaves it 2 higher and even, with the words and bytes as written", () => {
  const { sab, region } = fresh();
  assert.equal(counter(sab), 0);

  writeSeq(region, (writer) => {
    writer.setWord(0, 7);
    writer.setWord(1, 3);
    writer.setBytes(Uint8Array.of(1, 2, 3));
    return undefined;
  });
  writeSeq(region, (writer) => {
    writer.setWord(2, -5);
    return undefined;
  });

  assert.equal(counter(sab), 4);
  assert.deepEqual(readSeq(region, snapshot, 0), { seq: 4, value: { words: [7, 3, -5], bytes: [1, 2, 3] } });
  assert.deepEqual([...new Int32Array(sab, 0, WORDS)], [7, 3, -5, 4], "the layout: the words, the counter last");
});

test("a writer that throws or returns a thenable writes nothing and leaves the counter; a kept writer and the counter's index throw", () => {
  const { sab, region } = fresh();
  assert.throws(
    () =>
      writeSeq(region, (writer) => {
        writer.setWord(0, 1);
        throw new Error("halfway");
      }),
    /halfway/,
  );
  assert.throws(
    () =>
      writeSeq(region, ((writer: SeqWriter) => {
        writer.setWord(0, 1);
        return Promise.resolve();
      }) as unknown as (writer: SeqWriter) => undefined),
    TypeError,
  );
  assert.deepEqual([...new Int32Array(sab, 0, WORDS)], [0, 0, 0, 0], "nothing written, the counter where it was");

  let kept: SeqWriter | null = null;
  writeSeq(region, (writer) => {
    kept = writer;
    assert.throws(() => writer.setWord(WORDS - 1, 9), RangeError, "the counter is writeSeq's");
    assert.throws(() => writer.setBytes(new Uint8Array(9)), RangeError, "more than the room");
    assert.equal(writer.room, 8);
    return undefined;
  });
  assert.throws(() => kept!.setWord(0, 1), TypeError);
  assert.equal(counter(sab), 2);
});

test("a page write between the reader's two counter reads: the copy is read again whole, never a mix; with waitMs 0 it is busy", () => {
  const { region } = fresh();
  const write = (k: number) =>
    writeSeq(region, (writer) => {
      for (const at of [0, 1, 2]) writer.setWord(at, k);
      writer.setBytes(new Uint8Array(k).fill(k));
      return undefined;
    });
  write(1);

  // the write comes after each of the reader's steps in turn
  for (let after = 1; after <= 4; after++) {
    for (const waitMs of [100, 0]) {
      write(1);
      let steps = 0;
      let wrote = false;
      const midway = () => {
        if (++steps === after && !wrote) {
          wrote = true;
          write(2);
        }
      };
      const read = readSeq(
        region,
        (reader) => {
          const words = [0, 1, 2].map((at) => {
            const word = reader.readWord(at);
            midway();
            return word;
          });
          const bytes = [...reader.readBytes(words[1])];
          midway();
          return { words, bytes };
        },
        waitMs,
      );
      assert.ok(wrote, `the write was made after step ${after}`);
      if (waitMs === 0) assert.ok("busy" in read, `after step ${after}, no time left: busy`);
      else assert.deepEqual("value" in read && read.value, { words: [2, 2, 2], bytes: [2, 2] }, `after step ${after}`);
    }
  }
});

test("a busy read after a write moved the count gives the count its copy began at, so a waitSeq on it returns at once", () => {
  const { region } = fresh();
  let wrote = false;
  const read = readSeq(
    region,
    (reader) => {
      const word = reader.readWord(0);
      if (!wrote) {
        wrote = true;
        writeSeq(region, (writer) => {
          writer.setWord(0, 1);
          return undefined;
        });
      }
      return word;
    },
    0,
  );
  assert.deepEqual(read, { seq: 0, busy: true });

  const t0 = performance.now();
  waitSeq(region, read.seq, 2000);
  const waitedMs = performance.now() - t0;
  assert.ok(waitedMs < 500, `waitSeq on a count already passed waited ${waitedMs.toFixed(0)} ms`);
});

test("an odd counter (a writer stopped mid-section): the callback is not run, busy after about waitMs; a second thread's write wakes it", async () => {
  const { sab, region } = fresh();
  Atomics.add(new Int32Array(sab, 0, WORDS), WORDS - 1, 1);
  let calls = 0;
  const t0 = performance.now();
  const read = readSeq(region, () => ++calls, 60);
  assert.ok("busy" in read && read.seq === 1);
  assert.equal(calls, 0);
  assert.ok(performance.now() - t0 >= 55, "it waited");

  // the second thread ends the section (an add and a notify), as the stopped writer would
  const ender = thread(
    "setTimeout(() => { const w = new Int32Array(workerData.sab, 0, 4); Atomics.add(w, 3, 1); Atomics.notify(w, 3); }, 150);",
    sab,
  );
  const t1 = performance.now();
  const woken = readSeq(region, () => ++calls, 10_000);
  assert.deepEqual(woken, { seq: 2, value: 1 });
  assert.ok(performance.now() - t1 < 9_000, "woken by the notify, not the deadline");
  await ended(ender);

  // waitSeq: at once when the count has moved, and woken by another thread's writeSeq
  const t2 = performance.now();
  waitSeq(region, 0, 5_000);
  assert.ok(performance.now() - t2 < 1_000, "the count had moved");
  const writer = thread(
    "setTimeout(() => writeSeq(region, (writer) => { writer.setWord(0, 5); return undefined; }), 150);",
    sab,
  );
  const t3 = performance.now();
  waitSeq(region, 2, 10_000);
  assert.ok(performance.now() - t3 < 9_000, "woken by the write");
  assert.deepEqual(
    readSeq(region, (reader) => reader.readWord(0), 0),
    { seq: 4, value: 5 },
  );
  await ended(writer);
});

test("a kept reader throws; readBytes is a copy a later write does not change; a length past the room is clamped", () => {
  const { region } = fresh(4);
  writeSeq(region, (writer) => {
    writer.setBytes(Uint8Array.of(1, 2, 3, 4));
    return undefined;
  });
  let kept: SeqReader | null = null;
  const read = readSeq(
    region,
    (reader) => {
      kept = reader;
      return { all: reader.readBytes(1_000), none: reader.readBytes(-3), nan: reader.readBytes(Number.NaN) };
    },
    0,
  );
  assert.ok("value" in read);
  assert.throws(() => kept!.readWord(0), TypeError);
  assert.ok(read.value.all.buffer instanceof ArrayBuffer, "not a view of the shared buffer");
  assert.deepEqual([...read.value.all], [1, 2, 3, 4]);
  assert.deepEqual([read.value.none.length, read.value.nan.length], [0, 0]);

  writeSeq(region, (writer) => {
    writer.setBytes(Uint8Array.of(9, 9, 9, 9));
    return undefined;
  });
  assert.deepEqual([...read.value.all], [1, 2, 3, 4]);
});

test("a read callback that throws on a whole snapshot rethrows (a bug, not a tear); a thenable result is a TypeError", () => {
  const { region } = fresh();
  assert.throws(
    () =>
      readSeq(
        region,
        () => {
          throw new Error("bug");
        },
        0,
      ),
    /bug/,
  );
  assert.throws(() => readSeq(region, () => Promise.resolve(1) as unknown as number, 0), TypeError);
});

test("two threads, many rounds: every snapshot a reader accepts holds one write's number throughout", async () => {
  const words = 16;
  const sab = new SharedArrayBuffer(words * 4 + 256);
  const region = seqRegion(sab, words);
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const code = `const { workerData, parentPort } = require("node:worker_threads");
import(workerData.url).then(({ seqRegion, writeSeq }) => {
  const region = seqRegion(workerData.sab, workerData.words);
  const stop = new Int32Array(workerData.stop);
  const bytes = new Uint8Array(256);
  parentPort.postMessage("writing");
  for (let k = 1; Atomics.load(stop, 0) === 0; k++) {
    bytes.fill(k & 255);
    writeSeq(region, (writer) => {
      for (let at = 0; at < workerData.words - 1; at++) writer.setWord(at, k);
      writer.setBytes(bytes);
      return undefined;
    });
  }
});`;
  const writer = new Worker(code, { eval: true, workerData: { url: SEQLOCK_URL, sab, words, stop: stop.buffer } });
  await new Promise((ok) => writer.once("message", ok));

  let accepted = 0;
  let torn = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 400) {
    const read = readSeq(
      region,
      (reader) => {
        const all = [];
        for (let at = 0; at < words - 1; at++) all.push(reader.readWord(at));
        return { all, bytes: reader.readBytes(256) };
      },
      0,
    );
    if (!("value" in read)) continue;
    accepted++;
    const k = read.value.all[0];
    if (read.value.all.some((word) => word !== k) || read.value.bytes.some((b) => b !== (k & 255))) torn++;
  }
  Atomics.store(stop, 0, 1);
  await ended(writer);

  assert.ok(accepted > 100, `${accepted} snapshots accepted`);
  assert.ok(new Int32Array(sab, 0, words)[words - 1] > 100, "the writer wrote");
  assert.equal(torn, 0, `${torn} of ${accepted} accepted snapshots were torn`);
});
