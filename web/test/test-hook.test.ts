// The test-only code (the hook, the tab seeds, <html data-engine>) is one module that only a dynamic import in main.tsx
// reaches, and only under the ?test flag; e2e/start-and-lock.spec.ts checks the built page without the flag.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (path: string) => readFileSync(join(src, path), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(src, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const all = walk(".");

test("only main.tsx's flagged dynamic import reaches the test hook module", () => {
  const importers = (name: string) =>
    all.filter(
      (f) => new RegExp(`from "[^"]*/${name}\\.ts"`).test(read(f)) || read(f).includes(`import("./app/${name}.ts")`),
    );
  assert.deepEqual(importers("test-hook"), ["main.tsx"]);
  assert.match(
    read("main.tsx"),
    /if \(testMode !== null\) \(await import\("\.\/app\/test-hook\.ts"\)\)\.installTestHook\(client\)/,
  );
  assert.ok(!/^import .*test-hook/m.test(read("main.tsx")), "main.tsx imports it only dynamically");
  // the tab seeds and the hook's state join are used by the hook alone (type imports aside)
  assert.deepEqual(importers("seeds"), ["app/test-hook.ts"]);
  assert.deepEqual(importers("hook-state"), ["app/test-hook.ts"]);
});

test("nothing but the test hook module writes <html data-engine> or window.__dofile", () => {
  for (const pattern of [/dataset\.engine/, /__dofile/]) {
    const files = all.filter((f) => pattern.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    assert.deepEqual(
      files.map((f) => relative(".", f)),
      ["app/test-hook.ts"],
      String(pattern),
    );
  }
});
