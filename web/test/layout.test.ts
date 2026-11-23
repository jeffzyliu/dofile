// The layout's actions: Wrap lines and Split, with what they keep in localStorage and the Output tab they leave shown.

import assert from "node:assert/strict";
import { test } from "node:test";
import { S, setSplit, stored, toggleWrap, useWiring } from "./wiring.ts";

useWiring();

test("Wrap lines flips the signal and keeps it in localStorage only while on", () => {
  assert.equal(S.wrap.value, false);
  toggleWrap();
  assert.deepEqual([S.wrap.value, stored.get("dofile.wrap")], [true, "1"]);
  toggleWrap();
  assert.deepEqual([S.wrap.value, stored.has("dofile.wrap")], [false, false]);
});

test("Unsplit keeps the choice and shows the Log, whatever tab was shown", () => {
  assert.deepEqual([S.split.value, S.outputTab.value], [true, "graph"]);
  S.outputTab.value = "data";
  setSplit(false);
  assert.deepEqual([S.split.value, S.outputTab.value, stored.get("dofile.split")], [false, "log", "0"]);
  setSplit(false);
  assert.deepEqual([S.split.value, S.outputTab.value, stored.get("dofile.split")], [false, "log", "0"]);
});

test("Split forgets the choice, and replaces the Log tab, which the split Output pane does not have, with Graph", () => {
  setSplit(false);
  setSplit(true);
  assert.deepEqual([S.split.value, S.outputTab.value, stored.has("dofile.split")], [true, "graph", false]);
});

test("Split leaves a Data or Results tab shown", () => {
  for (const tab of ["data", "results"] as const) {
    S.split.value = false;
    S.outputTab.value = tab;
    setSplit(true);
    assert.deepEqual([S.split.value, S.outputTab.value], [true, tab]);
  }
});
