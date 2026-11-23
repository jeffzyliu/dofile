// scripts/stage.ts writes public/ and build-id.ts's staged() reads it back: a stale or damaged staging is told with its fix.
// Stages into a temporary folder, never into public/. Needs the wheel `npm test` builds (pretest).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inputs, staged } from "../scripts/build-id.ts";
import { stage } from "../scripts/stage.ts";
import { RUNTIME_FILES } from "../scripts/start-files.ts";

test("stage: the wheels and Pyodide's runtime are copied, the record is written last, and nothing older is left", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dofile-stage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = inputs();
  // what an earlier stage left: another dofile wheel, a Pyodide file the runtime no longer has, a record of other inputs
  mkdirSync(`${dir}/pyodide`);
  writeFileSync(`${dir}/dofile-0.0.1-py3-none-any.whl`, "old");
  writeFileSync(`${dir}/pyodide/gone.js`, "old");
  writeFileSync(`${dir}/stage.json`, "{}");
  mkdirSync(`${dir}/snapshot`);
  writeFileSync(`${dir}/snapshot/manifest.json`, "{}");

  const record = stage(dir, now);
  assert.equal(staged(now, dir), null, "a fresh stage is current");
  assert.deepEqual(
    Object.keys(record.files).sort(),
    [now.wheel, ...Object.keys(now.extraWheels), ...RUNTIME_FILES.map((f) => `pyodide/${f}`)].sort(),
  );
  assert.deepEqual(JSON.parse(readFileSync(`${dir}/stage.json`, "utf8")), record);
  assert.equal(existsSync(`${dir}/dofile-0.0.1-py3-none-any.whl`), false, "the older wheel is gone");
  assert.equal(existsSync(`${dir}/pyodide/gone.js`), false, "so is the other runtime file");
  assert.equal(existsSync(`${dir}/snapshot/manifest.json`), true, "the snapshot is not the stage's");
});

test("staged: no record, another wheel, extra wheel or Pyodide, and a missing or cut-short file each give a reason with the fix", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dofile-staged-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = inputs();
  assert.match(staged(now, dir)!, /nothing is staged in .*Run `npm run stage` in web\/$/, "no stage.json");

  stage(dir, now);
  const wasm = `${dir}/pyodide/pyodide.asm.wasm`;
  const original = readFileSync(wasm);
  const stale = (what: string, reason: RegExp) => {
    const why = staged(now, dir);
    assert.match(why ?? "", reason, what);
    assert.match(why!, /^the staged files are stale: .*Run `npm run stage` in web\/$/, what);
  };

  rmSync(wasm);
  stale("a deleted runtime file", /pyodide\/pyodide\.asm\.wasm is missing/);
  writeFileSync(wasm, original.subarray(0, 100));
  stale("a cut-short file", new RegExp(`pyodide/pyodide\\.asm\\.wasm is 100 bytes, staged as ${original.length}`));
  writeFileSync(wasm, original);
  assert.equal(staged(now, dir), null, "restored");

  assert.match(
    staged({ ...now, wheelHash: "c".repeat(64) }, dir)!,
    /the dofile wheel differs \(staged [0-9a-f]{12}, build cccccccccccc\)/,
  );
  assert.match(
    staged({ ...now, extraWheels: { ...now.extraWheels, "new.whl": "d".repeat(64) } }, dir)!,
    /the extra wheel new\.whl differs \(staged none, build dddddddddddd\)/,
  );
  assert.match(staged({ ...now, pyodide: "0.0.0" }, dir)!, /the Pyodide version differs \(staged .*, build 0\.0\.0\)/);

  rmSync(`${dir}/stage.json`);
  assert.match(staged(now, dir)!, /nothing is staged/, "a stage that died before its record was written");
});
