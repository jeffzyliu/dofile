// barButton (src/app/start.ts): the off and disabled rule of the Import and Load buttons.
import assert from "node:assert/strict";
import { test } from "node:test";

import { barButton } from "../src/app/start.ts";

test("a bar's button is off with no engine (still focusable), disabled when the engine takes no run or there is no command", () => {
  assert.deepEqual(barButton("prompt", "use x", false), { off: true, disabled: false });
  assert.deepEqual(barButton(null, "use x", true), { off: false, disabled: false });
  assert.deepEqual(barButton(null, "use x", false), { off: false, disabled: true });
  assert.deepEqual(barButton("off", null, true), { off: true, disabled: true });
});
