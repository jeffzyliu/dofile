// The focus targets of the file tree, Find and the folded list's button, and where the focus goes after a tab closes
// (files/tree-state.ts, files/close-focus.ts, log/find.ts): what each call asks the registry for, and which element takes it.
// The elements are stand-ins with the members the registry and the requests' `from` rules read.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { filesOpen } from "../src/app/files/fold.ts";

const D = await import("../src/app/editor/documents.ts");
const { focusAfterClose } = await import("../src/app/files/close-focus.ts");
const TS = await import("../src/app/files/tree-state.ts");
const { findOpen, openFind } = await import("../src/app/log/find.ts");
const { cancel, focusRequest, register, takeRequest } = await import("../src/app/ui/focus-targets.ts");

const doc = { activeElement: null as unknown, body: {} as { ownerDocument?: unknown } };
doc.body.ownerDocument = doc;
/** An element: `inside` are the selectors its ancestors match (what closest() finds). */
const fake = ({ shown = true, inside = [] as string[] } = {}) => {
  const el = {
    isConnected: true,
    ownerDocument: doc,
    getClientRects: () => ({ length: shown ? 1 : 0 }),
    closest: (selector: string) => (inside.includes(selector) ? {} : null),
    focus: () => {
      doc.activeElement = el;
    },
  };
  return el as typeof el & HTMLElement;
};
const TREE = '[role="tree"]';

const undo: (() => void)[] = [];
const reg = (...args: Parameters<typeof register>) => {
  undo.push(register(...args));
};
afterEach(() => {
  for (const u of undo.splice(0)) u();
  for (const name of ["editor", "open-file-tab", "tree", "find-field"] as const) cancel(name);
  for (const t of D.tabs.value) D.close(t.path);
  doc.activeElement = doc.body;
  filesOpen.value = false;
  findOpen.value = false;
  TS.rovingPath.value = null;
});

// ---- the tree ----

test("focusRow makes the row the roving one and asks for it by path; focusTree asks for the row in the tab order", () => {
  TS.focusRow("a.do");

  assert.equal(TS.rovingPath.value, "a.do");
  assert.deepEqual(TS.focusWanted.value, { path: "a.do" });

  TS.focusTree();

  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: false });

  TS.focusTree(true);

  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: true });
});

test("the row in the tab order takes a request with no path, though other rows come first", () => {
  const rows = ["a.do", "b.do", "c.do"].map(() => fake({ inside: [TREE] }));
  rows.forEach((row, i) => {
    reg("tree", () => row, ["a.do", "b.do", "c.do"][i]);
  });
  reg("tree", () => rows[1]);
  TS.focusTree();

  const moved = takeRequest("tree");

  assert.equal(moved, true);
  assert.equal(doc.activeElement, rows[1]);
});

test("a request for a row waits until that row is registered, and the other rows leave it", () => {
  const a = fake({ inside: [TREE] });
  reg("tree", () => a, "a.do");
  TS.focusRow("b.do");

  assert.equal(takeRequest("tree", "a.do"), false);
  assert.deepEqual(TS.focusWanted.value, { path: "b.do" });

  const b = fake({ inside: [TREE] });
  reg("tree", () => b, "b.do");

  assert.equal(takeRequest("tree", "b.do"), true);
  assert.equal(doc.activeElement, b);
  assert.equal(TS.focusWanted.value, null);
});

test("a tree request takes the focus from nothing or from inside the tree, not from the editor; from anywhere it takes it from the editor too", () => {
  const row = fake({ inside: [TREE] });
  reg("tree", () => row);
  const editor = fake();
  doc.activeElement = editor;
  TS.focusTree();

  takeRequest("tree");

  assert.equal(doc.activeElement, editor);

  doc.activeElement = fake({ inside: [TREE] });
  TS.focusTree();

  takeRequest("tree");

  assert.equal(doc.activeElement, row);

  doc.activeElement = editor;
  TS.focusTree(true);

  takeRequest("tree");

  assert.equal(doc.activeElement, row);
});

test("rove ends a request for another row and for the row in the tab order, and keeps one for its own row", () => {
  TS.focusRow("b.do");
  TS.rove("b.do");

  assert.deepEqual(TS.focusWanted.value, { path: "b.do" });

  TS.rove("c.do");

  assert.equal(TS.focusWanted.value, null);
  assert.equal(TS.rovingPath.value, "c.do");

  TS.focusTree();
  TS.rove("c.do");

  assert.equal(TS.focusWanted.value, null);
});

test("rove leaves another target's request alone", () => {
  const field = fake();
  reg("find-field", () => field);
  openFind(fake());

  TS.rove("c.do");

  assert.equal(focusRequest.value?.name, "find-field");
});

test("the tree is shown when a row inside it is, not for File actions alone", () => {
  assert.equal(TS.treeShown(), false);

  let at = fake();
  reg("tree", () => at);

  assert.equal(TS.treeShown(), false, "File actions is not in the tree");

  at = fake({ inside: [TREE], shown: false });

  assert.equal(TS.treeShown(), false, "a row not drawn");

  at = fake({ inside: [TREE] });

  assert.equal(TS.treeShown(), true);
});

// ---- Find ----

test("openFind opens Find and asks the field for the focus from anywhere, once", () => {
  const field = fake();
  reg("find-field", () => field);
  const opener = fake();
  doc.activeElement = opener;

  openFind(opener);

  assert.equal(findOpen.value, true);
  assert.equal(focusRequest.value?.name, "find-field");
  assert.equal(takeRequest("find-field"), true);
  assert.equal(doc.activeElement, field);
  assert.equal(takeRequest("find-field"), false, "a Find drawn again takes no focus");
});

// ---- after a tab closes ----

const strip = ".file-tabs";
const open = (...paths: string[]) => {
  for (const p of paths) D.addText(p, "x");
};

test("after a close the selected tab takes the focus when the focus is on nothing or in the tab strip", () => {
  open("a.do");
  D.activate("a.do");
  const tab = fake();
  reg("open-file-tab", () => tab);

  focusAfterClose();

  assert.equal(focusRequest.value?.name, "open-file-tab");
  assert.equal(takeRequest("open-file-tab"), true);
  assert.equal(doc.activeElement, tab);

  doc.activeElement = fake({ inside: [strip] });
  focusAfterClose();

  assert.equal(takeRequest("open-file-tab"), true);
  assert.equal(doc.activeElement, tab);

  doc.activeElement = fake();
  focusAfterClose();

  assert.equal(takeRequest("open-file-tab"), false, "not from elsewhere");
});

test("after the last tab closed the tree's row in the tab order is asked when the tree is shown, else the editor from anywhere", () => {
  reg("tree", () => fake({ inside: [TREE] }));

  focusAfterClose();

  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: false });
  cancel("tree");
  undo.splice(0).forEach((u) => {
    u();
  });
  const editor = fake();
  reg("editor", () => editor);
  doc.activeElement = fake();

  focusAfterClose();

  assert.equal(focusRequest.value?.name, "editor");
  assert.equal(takeRequest("editor"), true, "from anywhere");
  assert.equal(doc.activeElement, editor);
});

test("with no tab left selected, the closed tab's element still in the page is not asked", () => {
  reg("open-file-tab", () => fake());
  reg("tree", () => fake({ inside: [TREE] }));

  focusAfterClose();

  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: false });
});

test("with the tab strip not drawn (a phone) the focus goes to the tree or the editor, not a tab", () => {
  open("a.do");
  D.activate("a.do");
  reg("open-file-tab", () => fake({ shown: false }));

  focusAfterClose();

  assert.equal(focusRequest.value?.name, "editor");
});
