// Calls into the native libraries (scipy's LAPACK, sparse, fft, matplotlib's fonts, ...) from an engine restored from a
// built snapshot. A restore that links a library wrong shows up here as "cannot resolve symbol" or "table index is out of
// bounds" at the first call (the first one found: scipy.linalg.solve failed with a missing dsytrf_), which can end the
// whole process, so it is a test of its own. Skipped when `npm run snapshot` has not been run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { bootFromSnapshot, defaultDir, NATIVE_CHECKS } from "../scripts/snapshot-node.ts";

test("native-library calls work in an engine restored from the snapshot", { timeout: 120_000, skip: !existsSync(`${defaultDir}/manifest.json`) && "no snapshot: npm run snapshot" }, async t => {
  const { py } = await bootFromSnapshot();
  for (const [label, expr, want] of NATIVE_CHECKS) {
    await t.test(label, () => {
      const got = py.runPython(expr);
      if (want !== null) assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${got} is not ${want}`);
    });
  }
});
