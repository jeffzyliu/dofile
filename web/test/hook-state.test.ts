// The e2e hook's `state` has every name the specs read or call: a name a spec uses that no state module exports fails here
// (the type check sees it only through a spec that compiles).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import "./wiring.ts";

const { hookState } = await import("../src/app/hook-state.ts");
const e2e = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e");

// Two specs name a local engine state `state` and read its `s` and `message`.
const NOT_THE_HOOK = new Set(["s", "message"]);

test("hookState() has every name the e2e specs use as state.<name>", () => {
  const used = new Set<string>();
  for (const f of readdirSync(e2e).filter((n) => n.endsWith(".ts"))) {
    for (const m of readFileSync(join(e2e, f), "utf8").matchAll(/\bstate\.([A-Za-z]+)/g)) {
      if (!NOT_THE_HOOK.has(m[1]!)) used.add(m[1]!);
    }
  }
  assert.ok(used.size > 20, "the scan found the specs' names");
  const has = Object.keys(hookState());
  assert.deepEqual(
    [...used].filter((n) => !has.includes(n)),
    [],
  );
});
