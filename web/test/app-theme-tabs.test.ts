// The theme, the open tabs and strict UTF-8 decoding.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTheme, cycleTheme, decodeText, S, stored, useWiring } from "./wiring.ts";

useWiring();

test("the theme button cycles System, Light, Dark; applyTheme keeps <html data-theme> and localStorage in step", () => {
  const root = { dataset: {} as DOMStringMap };
  const off = applyTheme(root as HTMLElement);
  assert.equal(root.dataset.theme, undefined);
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.get("dofile.theme")], ["light", "light", "light"]);
  assert.equal(S.resolvedTheme.value, "light");
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.get("dofile.theme")], ["dark", "dark", "dark"]);
  cycleTheme();
  assert.deepEqual([S.theme.value, root.dataset.theme, stored.has("dofile.theme")], ["system", undefined, false]);
  off();
});

test("decodeText takes strict UTF-8 only", () => {
  assert.equal(decodeText(new TextEncoder().encode("café\n")), "café\n");
  assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])), null, "Latin-1 is not text");
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])), "a", "a leading BOM is dropped, as before");
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), true), "\uFEFFa", "or kept, for the editor");
});
