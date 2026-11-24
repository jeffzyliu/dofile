// The Run gate (src/app/editor/runnable.ts): which tabs Run is offered for, by their path, and how it combines with the
// engine's state. No DOM.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { S } = await import("./state-all.ts");
const D = await import("../src/app/editor/documents.ts");
const G = await import("../src/app/editor/runnable.ts");

beforeEach(() => {
  for (const t of D.tabs.value) D.close(t.path);
});

test("runRefusal: a .do or .ado path runs (any case, any folder); every other kind gets the reason", () => {
  for (const p of ["a.do", "dir/b.ado", "C.DO", "x/y.Ado", ".hidden.do"]) assert.equal(G.runRefusal(p), null, p);
  for (const p of ["a.txt", "b.csv", "c.dta", "d.log", "do", "a.do.txt", "adofile", "dir.do/notes.md", "a.do ", ".do"])
    assert.equal(G.runRefusal(p), G.NOT_RUNNABLE, p);
  assert.equal(G.NOT_RUNNABLE, "Only .do and .ado files can run");
});

test("runRefusal: no tab is no refusal (Run's own toast says no file is open)", () => {
  assert.equal(G.runRefusal(null), null);
});

test("activeRunRefusal follows the active tab", () => {
  D.addText("a.do", "x");
  D.addText("n.txt", "x");
  D.addDta("w.dta");
  assert.equal(G.activeRunRefusal.value, null, "no tab active");
  D.activate("n.txt");
  assert.equal(G.activeRunRefusal.value, G.NOT_RUNNABLE);
  D.activate("a.do");
  assert.equal(G.activeRunRefusal.value, null);
  D.activate("w.dta");
  assert.equal(G.activeRunRefusal.value, G.NOT_RUNNABLE);
});

test("canRunFile: the engine must take a run and the path must be runnable", () => {
  const ready = { s: "ready" } as typeof S.engine.value;
  const busy = { s: "waiting" } as typeof S.engine.value;
  assert.equal(G.canRunFile(ready, "a.do"), true);
  assert.equal(G.canRunFile(ready, "a.txt"), false);
  assert.equal(G.canRunFile(busy, "a.do"), false);
  assert.equal(G.canRunFile(busy, "a.txt"), false);
});
