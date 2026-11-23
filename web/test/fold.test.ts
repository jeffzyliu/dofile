// The folded file list's moves: the Files button opens it and takes the focus back when Esc or the button folds it.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { filesOpen, foldFiles, holdFilesToggle, onFilesKey } from "../src/app/files/fold.ts";
import { focusWanted } from "../src/app/files/tree-state.ts";

const toggle = (rects = 1) => {
  const t = { focused: 0, focus: () => t.focused++, getClientRects: () => ({ length: rects }) };
  return t;
};
const key = (k: string, defaultPrevented = false) => {
  const e = { key: k, defaultPrevented, prevented: 0, preventDefault: () => e.prevented++ };
  return e;
};
/** The tree's focus request: what the fold asked for, or null. */
const listFocus = () => (focusWanted.value ? [focusWanted.value.anywhere] : []);

beforeEach(() => {
  filesOpen.value = false;
  holdFilesToggle(null);
  focusWanted.value = null;
});

test("opening shows the list and focuses it from anywhere, leaving the button alone", () => {
  const t = toggle();
  holdFilesToggle(t);
  foldFiles(true);
  assert.deepEqual([filesOpen.value, listFocus(), t.focused], [true, [true], 0]);
});

test("folding hides the list and focuses the button, not the list; with no button held it moves nothing", () => {
  const t = toggle();
  holdFilesToggle(t);
  filesOpen.value = true;
  foldFiles(false);
  assert.deepEqual([filesOpen.value, listFocus(), t.focused], [false, [], 1]);
  holdFilesToggle(null);
  foldFiles(false);
  assert.deepEqual([filesOpen.value, listFocus()], [false, []]);
});

test("Esc in the open, folded list folds it, takes the key and focuses the button", () => {
  const t = toggle();
  holdFilesToggle(t);
  filesOpen.value = true;
  const e = key("Escape");
  onFilesKey(e);
  assert.deepEqual([filesOpen.value, e.prevented, t.focused, listFocus()], [false, 1, 1, []]);
});

test("Esc does nothing for another key, a handler that used it, a closed list, an undrawn or missing button", () => {
  const cases: [string, ReturnType<typeof key>, boolean, ReturnType<typeof toggle> | null][] = [
    ["another key", key("Enter"), true, toggle()],
    ["used already", key("Escape", true), true, toggle()],
    ["closed", key("Escape"), false, toggle()],
    ["button not drawn (a wide screen, a phone)", key("Escape"), true, toggle(0)],
    ["no button", key("Escape"), true, null],
  ];
  for (const [why, e, open, t] of cases) {
    filesOpen.value = open;
    holdFilesToggle(t);
    onFilesKey(e);
    assert.deepEqual([filesOpen.value, e.prevented, t?.focused ?? 0, listFocus()], [open, 0, 0, []], why);
  }
});
