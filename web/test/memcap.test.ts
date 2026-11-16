// The memory cap's rule (src/engine/memcap.ts): which devices are capped, and the ?memcap flag. And the loader patch that
// makes the cap possible (snapshot.ts): it applies to this Pyodide's pyodide.asm.mjs, and fails when the text changes.
// The cap at work, in a real engine: engine.test.ts ("a heap cap").

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { capLine, chooseCap, type DeviceFacts, factsOf, PHONE_CAP_MB } from "../src/engine/memcap.ts";
import { patchAsm, patchHeapMax } from "../src/engine/snapshot.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const device = (more: Partial<DeviceFacts> = {}): DeviceFacts => ({ userAgent: DESKTOP, maxTouchPoints: 0, ...more });

test("an iPhone, an iPad and a touch Mac (an iPad asking for the desktop site) are capped", () => {
  assert.equal(chooseCap(device({ userAgent: IPHONE, maxTouchPoints: 5 }), null).mb, PHONE_CAP_MB);
  assert.equal(chooseCap(device({ userAgent: IPHONE.replace("iPhone", "iPad") }), null).mb, PHONE_CAP_MB);
  assert.equal(chooseCap(device({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }), null).mb, PHONE_CAP_MB);
  assert.match(chooseCap(device({ userAgent: IPHONE }), null).why, /iOS/);
});

test("a Mac with no touch screen, and a desktop browser, are not capped", () => {
  assert.equal(chooseCap(device({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }), null).mb, 0);
  assert.equal(
    chooseCap(device({ userAgent: IPAD_AS_MAC, maxTouchPoints: 1 }), null).mb,
    0,
    "one touch point is not an iPad",
  );
  assert.equal(chooseCap(device(), null).mb, 0);
  assert.equal(chooseCap(device({ mobile: false, deviceMemory: 8 }), null).mb, 0);
  assert.match(chooseCap(device(), null).why, /not iOS/);
});

test("a mobile browser (userAgentData.mobile) and a device with 4 GB or less are capped, by the device and not the width", () => {
  assert.equal(chooseCap(device({ mobile: true }), null).mb, PHONE_CAP_MB);
  assert.equal(chooseCap(device({ deviceMemory: 4 }), null).mb, PHONE_CAP_MB);
  assert.equal(chooseCap(device({ deviceMemory: 2 }), null).mb, PHONE_CAP_MB);
  assert.equal(chooseCap(device({ deviceMemory: 8 }), null).mb, 0);
  assert.match(chooseCap(device({ deviceMemory: 4 }), null).why, /deviceMemory 4/);
});

test("?memcap=<MB> overrides the rule in both directions, and 0 is no cap; anything else is ignored with a say", () => {
  assert.deepEqual(chooseCap(device(), "400"), { mb: 400, why: "?memcap=400" });
  assert.equal(chooseCap(device({ userAgent: IPHONE }), "0").mb, 0);
  assert.equal(chooseCap(device({ userAgent: IPHONE }), "1500").mb, 1500);
  for (const bad of ["", "abc", "-5", "1.5", "400MB", " 400"]) {
    const c = chooseCap(device({ userAgent: IPHONE }), bad);
    assert.equal(c.mb, PHONE_CAP_MB, `"${bad}" falls back to the device rule`);
    assert.match(c.why, /ignored/);
  }
  assert.equal(chooseCap(device(), "abc").mb, 0);
});

test("factsOf reads the navigator, and the console line says the cap and why", () => {
  const facts = factsOf({ userAgent: IPHONE, maxTouchPoints: 5, userAgentData: { mobile: true }, deviceMemory: 4 });
  assert.deepEqual(facts, { userAgent: IPHONE, maxTouchPoints: 5, mobile: true, deviceMemory: 4 });
  assert.equal(capLine({ mb: 750, why: "iOS or iPadOS" }), "[dofile] engine memory cap: 750 MB, iOS or iPadOS");
  assert.match(capLine(chooseCap(device(), null)), /cap: none .*not iOS/);
});

// the loader's text, from the pyodide package the page and the build use (the CDN's file is the same version)
const asm = readFileSync(fileURLToPath(new URL("../node_modules/pyodide/pyodide.asm.mjs", import.meta.url)), "utf8");

test("the heap cap patch applies to this Pyodide's loader (in the snapshot's and in the normal boot's), once, and fails on another text", () => {
  const capped = patchHeapMax(asm);
  assert.equal(capped.split('getHeapMax=()=>Module["dofileHeapMax"]??4294901760').length, 2);
  assert.ok(!capped.includes("getHeapMax=()=>4294901760"));
  assert.ok(patchAsm(asm).includes('Module["dofileHeapMax"]'), "the snapshot's loader has it too");
  assert.throws(() => patchHeapMax("var other=1"), { name: "SnapshotError", message: /not the version/ });
});
