// The open tabs and their documents (src/app/editor/documents.ts) with no view, and with a stand-in view: one record
// per tab, `tabs`, `activeTab`, `selection` and the dot derived from the records.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { effect } from "@preact/signals-core";

const { S } = await import("./state-all.ts");
const D = await import("../src/app/editor/documents.ts");

const type = (path: string, at: number, insert: string) => D.update(path, { changes: { from: at, insert } });

beforeEach(() => {
  for (const t of D.tabs.value) D.close(t.path);
  for (const b of S.banners.value) S.dismiss(b);
  S.closeDialog();
});

test("addText and addDta open tabs at the end, each text tab with its document from the start; activate makes one active", () => {
  D.addText("a.do", "display 1\n");
  D.addDta("w.dta");
  D.addText("b.do", "x");
  D.addText("a.do", "again"); // open already: nothing
  assert.deepEqual(D.tabs.value, [
    { path: "a.do", kind: "text", dirty: false },
    { path: "w.dta", kind: "dta", dirty: false },
    { path: "b.do", kind: "text", dirty: false },
  ]);
  assert.equal(D.activeTab.value, null, "opening is not activating");
  D.activate("w.dta");
  assert.equal(D.activeTab.value, "w.dta");
  D.activate("gone.do");
  assert.equal(D.activeTab.value, "w.dta", "a path with no tab changes nothing");
  assert.equal(D.textOf("a.do"), "display 1\n");
  assert.equal(D.stateOf("w.dta"), undefined, "a .dta tab has no document");
  assert.equal(D.textOf("w.dta"), null);
});

test("a file's form is kept: the editor's text has \\n and no BOM, textOf gives it back as the file had it", () => {
  D.addText("win.csv", "﻿a\r\nb\r\n");
  assert.equal(D.stateOf("win.csv")!.doc.toString(), "a\nb\n");
  assert.equal(D.textOf("win.csv"), "﻿a\r\nb\r\n");
  assert.equal(D.tabs.value[0].dirty, false);
});

test("the dot is derived: an edit sets it; a second keystroke or a selection leaves `tabs` as it was; undoing to the saved text clears it", () => {
  D.addText("a.do", "abc");
  D.addText("b.do", "xyz");
  let changes = 0;
  const stop = effect(() => {
    D.tabs.value;
    changes++;
  });
  type("b.do", 3, "1");
  assert.deepEqual(
    D.tabs.value.map((t) => t.dirty),
    [false, true],
  );
  const before = D.tabs.value;
  type("b.do", 4, "2");
  D.update("b.do", { selection: { anchor: 0, head: 2 } });
  assert.equal(D.tabs.value, before, "no change, no new list");
  D.update("b.do", { changes: { from: 3, to: 5 } });
  assert.equal(D.tabs.value[1].dirty, false, "the saved text again: clean");
  assert.equal(changes, 3, "once at the start, once per flip of the dot");
  stop();
});

test("close: the tab to the right becomes active, else the one to the left; its banners go; askClose asks about unsaved edits", () => {
  for (const p of ["a.do", "b.do", "c.do"]) D.addText(p, p);
  D.activate("b.do");
  S.addBanner({ b: "save-failed", path: "b.do", message: "full" });
  S.addBanner({ b: "run-changed", path: "c.do" });
  assert.equal(D.askClose("b.do"), true);
  assert.equal(D.activeTab.value, "c.do");
  assert.equal(D.stateOf("b.do"), undefined);
  assert.deepEqual(S.banners.value, [{ b: "run-changed", path: "c.do" }], "only the closed tab's banner goes");
  D.close("c.do");
  assert.equal(D.activeTab.value, "a.do");
  type("a.do", 0, "!");
  assert.equal(D.askClose("a.do"), false);
  assert.deepEqual(S.dialog.value, { d: "close-tab", path: "a.do" });
  assert.equal(D.textOf("a.do"), "!a.do", "asked: nothing closed");
  D.close("a.do");
  assert.equal(D.activeTab.value, null);
  assert.equal(D.askClose("a.do"), false, "no such tab");
});

test("closeUnder closes the tabs of a folder and the files under it, and the not-text banner under it", () => {
  for (const p of ["data/x.do", "data/raw/y.csv", "database.do"]) D.addText(p, "1");
  S.addBanner({ b: "not-text", path: "data/z.xlsx" });
  D.closeUnder("data");
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["database.do"],
  );
  assert.deepEqual(S.banners.value, []);
});

test("moved: a folder's tabs take their new paths with their edits; the active tab follows; banners follow; the language name changes", () => {
  D.addText("data/x.do", "1");
  D.addText("data/raw/y.csv", "2");
  D.addText("database.do", "3");
  D.activate("data/raw/y.csv");
  type("data/x.do", 0, "edited ");
  S.addBanner({ b: "run-changed", path: "data/x.do" });
  assert.deepEqual(D.moved("data", "input"), ["input/x.do", "input/raw/y.csv"]);
  assert.deepEqual(D.tabs.value, [
    { path: "input/x.do", kind: "text", dirty: true },
    { path: "input/raw/y.csv", kind: "text", dirty: false },
    { path: "database.do", kind: "text", dirty: false },
  ]);
  assert.equal(D.activeTab.value, "input/raw/y.csv");
  assert.equal(D.textOf("input/x.do"), "edited 1");
  assert.equal(D.stateOf("data/x.do"), undefined);
  assert.deepEqual(S.banners.value, [{ b: "run-changed", path: "input/x.do" }]);
  const label = (p: string) =>
    D.stateOf(p)!
      .facet(EditorView.contentAttributes)
      .map((a) => (typeof a === "function" ? null : a["aria-label"]))
      .filter(Boolean);
  assert.deepEqual(label("input/x.do"), ["Editor: x.do"]);
});

test("retype: a text tab becomes a .dta tab and back in its place, the active tab kept", () => {
  D.addText("a.do", "1");
  D.addText("w.do", "2");
  D.addText("c.do", "3");
  D.activate("c.do");
  D.retype("w.do");
  assert.deepEqual(D.tabs.value[1], { path: "w.do", kind: "dta", dirty: false });
  assert.equal(D.stateOf("w.do"), undefined);
  D.retype("w.do", "a,b\n");
  assert.deepEqual(D.tabs.value[1], { path: "w.do", kind: "text", dirty: false });
  assert.equal(D.textOf("w.do"), "a,b\n");
  assert.equal(D.activeTab.value, "c.do");
});

test("reload drops the edits and the banners, with a new document; a .dta or closed tab is left alone", () => {
  D.addText("a.csv", "old");
  D.addDta("w.dta");
  type("a.csv", 3, " edit");
  const before = D.stateOf("a.csv");
  S.addBanner({ b: "run-changed", path: "a.csv" });
  S.addBanner({ b: "save-failed", path: "a.csv", message: "full" });
  D.reload("a.csv", "﻿new\r\n");
  assert.notEqual(D.stateOf("a.csv"), before);
  assert.equal(D.stateOf("a.csv")!.doc.toString(), "new\n");
  assert.equal(D.textOf("a.csv"), "﻿new\r\n", "the reloaded file's form");
  assert.equal(D.tabs.value[0].dirty, false);
  assert.deepEqual(S.banners.value, []);
  D.reload("w.dta", "x");
  D.reload("gone.do", "x");
  assert.deepEqual(
    D.tabs.value.map((t) => t.kind),
    ["text", "dta"],
  );
});

test("ranOver: a clean tab shows the run's text with its caret kept; edits are kept; a version that is not text keeps the text and the dot", () => {
  D.addText("a.do", "line 1\nline 2\n");
  D.update("a.do", { selection: { anchor: 3 } });
  assert.equal(D.ranOver("a.do", "line 1\nline 2\nline 3\n"), "shown");
  assert.equal(D.textOf("a.do"), "line 1\nline 2\nline 3\n");
  assert.equal(D.stateOf("a.do")!.selection.main.head, 3, "the caret stays");
  assert.equal(D.tabs.value[0].dirty, false);
  assert.equal(D.ranOver("a.do", "line 1\nline 2\nline 3\n"), "same", "the same text again");
  type("a.do", 0, "* ");
  assert.equal(D.ranOver("a.do", "other\r\n"), "kept");
  assert.equal(D.textOf("a.do"), "* line 1\r\nline 2\r\nline 3\r\n", "the edits, in the run's form");
  assert.equal(D.tabs.value[0].dirty, true);
  assert.equal(D.ranOver("a.do", null), "kept");
  assert.equal(D.savedIsText("a.do"), false);
  assert.equal(D.ranOver("gone.do", "x"), "same");
});

test("selection: the shown text tab's whole selected lines, the same array while they stay; null for a .dta tab or none", () => {
  D.addText("a.do", "1\n2\n3\n4\n");
  D.addDta("w.dta");
  D.activate("a.do");
  assert.equal(D.selection.value, null);
  D.update("a.do", { selection: { anchor: 2, head: 5 } });
  const lines = D.selection.value;
  assert.deepEqual(lines, [2, 3]);
  D.update("a.do", { selection: { anchor: 3, head: 5 } });
  assert.equal(D.selection.value, lines, "the same lines: the same array");
  D.activate("w.dta");
  assert.equal(D.selection.value, null);
});

test("attachView: a tab opened before it gets the view's extensions; the view shows the active text tab, keeps a hidden tab's place, hands a reload's new state the place it had, and shows a retyped tab from the top", () => {
  D.addText("a.do", "a");
  const At = StateEffect.define<number>(); // a stand-in for the view's scroll snapshots
  const shows: [string | null, number | null][] = [];
  let top: StateEffect<unknown> | null = null;
  let shown: EditorState | null = null;
  const detach = D.attachView({
    extensions: EditorState.tabSize.of(7),
    show(state, scroll) {
      shown = state;
      shows.push([state?.doc.toString() ?? null, scroll && (scroll.value as number)]);
    },
    dispatch(spec) {
      shown = shown!.update(spec).state;
      D.edited(shown);
    },
    scrollSnapshot: () => top,
  });
  try {
    D.addText("b.do", "b");
    D.addDta("w.dta");
    assert.deepEqual(
      ["a.do", "b.do"].map((p) => D.stateOf(p)!.tabSize),
      [7, 7],
    );
    D.activate("a.do");
    top = At.of(120);
    D.activate("b.do");
    top = null;
    D.activate("a.do");
    type("a.do", 1, "!");
    assert.equal(D.stateOf("a.do"), shown, "an edit goes through the view, and the document has the view's state");
    top = At.of(130);
    D.reload("a.do", "new a");
    D.activate("w.dta");
    D.activate("a.do");
    D.retype("a.do");
    D.retype("a.do", "text again");
    assert.deepEqual(shows, [
      ["a", null],
      ["b", null],
      ["a", 120],
      ["new a", 130],
      [null, null],
      ["new a", 130],
      [null, null],
      ["text again", null],
    ]);
  } finally {
    detach();
  }
});
