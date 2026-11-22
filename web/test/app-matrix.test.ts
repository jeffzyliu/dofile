// The Results tab's matrix protocol (src/app/output/matrix.ts): a read's answer, the answer that is stale, an error,
// Copy of an open and a closed matrix, and the copied check's timer.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { ResultRow } from "../src/app/output/format.ts";
import { COPIED_MS, closeMatrix, copyRow, matrixFor, NO_ENGINE, readMatrix } from "../src/app/output/matrix.ts";
import { copiedRow, openMatrices } from "../src/app/output/view.ts";
import type { Results } from "../src/app/types.ts";
import { client, readyEngine, S, tick, useWiring, writable } from "./wiring.ts";

useWiring();
beforeEach(() => {
  openMatrices.value = {}; // view.ts's signals are not state.ts's: resetState() leaves them
  copiedRow.value = null;
});

const results = (): Results => ({ e: {}, r: {}, e_changed: false, r_changed: false }) as unknown as Results;
const MATRIX = { rows: ["r1"], cols: ["c1", "c2"], data: [[1, 2]] };
const asked = () => client.calls.filter(([op]) => op === "matrix").length;
const setResults = (rs: Results | null) => {
  writable(S.results).value = rs;
};
async function held() {
  await readyEngine();
  client.hold = true;
  const rs = results();
  setResults(rs);
  return rs;
}

test("a read writes loading, then the answer; an error from the engine is the entry's message", async () => {
  const rs = await held();
  const read = readMatrix("e(b)");
  assert.deepEqual(openMatrices.value["e(b)"], { for: rs, status: "loading" });
  client.waiting[0].ok(MATRIX);
  const entry = await read;
  assert.deepEqual(entry, { for: rs, status: "ready", matrix: MATRIX });
  assert.equal(matrixFor("e(b)", rs), entry);
  assert.equal(matrixFor("e(b)", results()), null, "for other results: not open");

  const bad = readMatrix("e(V)");
  client.waiting[1].ok({ error: "no such matrix" });
  assert.deepEqual(await bad, { for: rs, status: "error", message: "no such matrix" });
});

test("a call that throws is NO_ENGINE; no results is no read", async () => {
  const rs = await held();
  const read = readMatrix("e(b)");
  client.waiting[0].no(new Error("reset"));
  assert.deepEqual(await read, { for: rs, status: "error", message: NO_ENGINE });

  setResults(null);
  assert.equal(await readMatrix("e(V)"), null);
  assert.equal(asked(), 1);
});

test("an answer for replaced results, for a matrix hidden meanwhile, or for an earlier read is not written", async () => {
  const rs = await held();
  const replaced = readMatrix("e(b)");
  setResults(results()); // another run
  client.waiting[0].ok(MATRIX);
  assert.equal(await replaced, null);
  assert.equal(openMatrices.value["e(b)"]?.for, rs, "the old entry is left; matrixFor does not show it");
  assert.equal(matrixFor("e(b)", S.results.value), null);

  openMatrices.value = {};
  const hidden = readMatrix("e(b)");
  closeMatrix("e(b)");
  client.waiting[1].ok(MATRIX);
  assert.equal(await hidden, null);
  assert.equal(openMatrices.value["e(b)"], undefined, "not reopened");

  const first = readMatrix("e(b)");
  const second = readMatrix("e(b)");
  client.waiting[2].ok({ rows: ["old"], cols: [], data: [[]] });
  client.waiting[3].ok(MATRIX);
  assert.equal(await first, null, "the first answer is ignored");
  assert.equal((await second)?.status, "ready");
  assert.deepEqual(S.results.value && matrixFor("e(b)", S.results.value), {
    for: S.results.value,
    status: "ready",
    matrix: MATRIX,
  });
});

// Copy: the clipboard stand-in
const copies: string[] = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (t: string) => {
        copies.push(t);
      },
    },
  },
});
const row = (key: string, matrix?: string) =>
  ({ key, name: key, value: "1", matrix, group: "r" }) as unknown as ResultRow;

test("Copy reads a closed matrix without opening it, copies an open one as it is, and says when it could not read", async () => {
  const rs = await held();
  copies.length = 0;
  const closed = copyRow(row("a", "e(b)"));
  await tick();
  client.waiting[0].ok(MATRIX);
  await closed;
  assert.equal(copies.length, 1);
  assert.equal(openMatrices.value["e(b)"], undefined, "not opened");
  assert.equal(copiedRow.value?.key, "a");

  openMatrices.value = { "e(b)": { for: rs, status: "ready", matrix: MATRIX } };
  await copyRow(row("a", "e(b)"));
  assert.equal(asked(), 1, "an open matrix is not read again");
  assert.equal(copies.length, 2);

  const failing = copyRow(row("b", "e(V)"));
  await tick();
  client.waiting[1].ok({ error: "gone" });
  await failing;
  assert.equal(S.toast.value, "Couldn't read the matrix");
  assert.equal(copiedRow.value?.key, "a", "a failed copy leaves the check as it was");
});

test("the copied check clears after COPIED_MS, and a second copy restarts the timer", async (t) => {
  await readyEngine();
  setResults(results());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await copyRow(row("a"));
  assert.equal(copiedRow.value?.key, "a");
  t.mock.timers.tick(COPIED_MS - 1);
  await copyRow(row("b"));
  t.mock.timers.tick(COPIED_MS - 1);
  assert.equal(copiedRow.value?.key, "b", "the first timer was cleared");
  t.mock.timers.tick(1);
  assert.equal(copiedRow.value, null);
});
