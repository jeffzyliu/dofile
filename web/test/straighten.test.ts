// Straight quotes for typed text (src/stata/straighten.ts): the mapping, which input types count as typing, and the
// insertion fix that keeps the caret and leaves the text already there alone.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isTypedInput, straighten, straightenInserted } from "../src/stata/straighten.ts";

test("straighten: curly quotes and the em dash go back to what was typed; the en dash and plain text stay", () => {
  assert.equal(straighten("‘’"), "''");
  assert.equal(straighten("“hello”"), '"hello"');
  assert.equal(straighten("a—b"), "a--b");
  assert.equal(straighten("display “`x’”"), 'display "`x\'"');
  assert.equal(straighten("1–2"), "1–2");
  assert.equal(straighten('display 1 // it\'s "ok"'), 'display 1 // it\'s "ok"');
  assert.equal(straighten(""), "");
});

test("isTypedInput: typing and replacement text; not a paste, a drop, a composition, a deletion or an undo", () => {
  for (const t of ["insertText", "insertReplacementText"]) assert.equal(isTypedInput(t), true, t);
  for (const t of [
    "insertFromPaste",
    "insertFromDrop",
    "insertFromYank",
    "insertCompositionText",
    "insertLineBreak",
    "deleteContentBackward",
    "historyUndo",
    "",
  ])
    assert.equal(isTypedInput(t), false, t);
});

test("straightenInserted: only the text just inserted changes, and the caret stays after it", () => {
  // typed a curly quote at the end
  assert.deepEqual(straightenInserted("display “", 9, "“"), { value: 'display "', caret: 9 });
  // typed in the middle: the text after the caret is kept, and so is the caret's place after the quote
  assert.deepEqual(straightenInserted("ab’cd", 3, "’"), { value: "ab'cd", caret: 3 });
  // the em dash is two characters, so the caret moves one further
  assert.deepEqual(straightenInserted("a—b", 2, "—"), { value: "a--b", caret: 3 });
  // text already there is not touched, even when it holds curly quotes
  assert.deepEqual(straightenInserted("“old” x’", 8, "’"), {
    value: "“old” x'",
    caret: 8,
  });
  // nothing to change: no smart character, or the value does not hold the data before the caret
  assert.equal(straightenInserted("abc", 3, "c"), null);
  assert.equal(straightenInserted("abc’", 2, "’"), null);
  assert.equal(straightenInserted("", 0, "’"), null);
  // a whole replacement word with a smart character in it
  assert.deepEqual(straightenInserted("it’s", 4, "it’s"), { value: "it's", caret: 4 });
});
