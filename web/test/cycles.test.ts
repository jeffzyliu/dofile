// The import graph of src has no cycle, type-only imports included: a module that imports back a module that
// imports it can be loaded half-made, and a type that lives in the registry (dialogs.tsx, banners.tsx) pulls every view
// into the cycle. A file lists what it imports from; a cycle is a group of files that each reach the others.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src", import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

/** The files of src each file imports or re-exports from (a view may leave the extension out). */
function graph(files: string[]): Map<string, string[]> {
  const known = new Set(files);
  return new Map(
    files.map((f) => {
      const text = readFileSync(f, "utf8");
      const specs = [...text.matchAll(/^\s*(?:import|export)\b[^;'"]*?\sfrom\s+["'](\.[^"']*)["']/gm)].map((m) => m[1]);
      const to = specs
        .filter((s) => !/\.(json|css)$/.test(s))
        .map((s) => {
          const base = resolve(dirname(f), s);
          const hit = [base, `${base}.ts`, `${base}.tsx`].find((p) => known.has(p));
          assert.ok(hit, `${relative(src, f)}: cannot resolve ${s}`);
          return hit;
        });
      return [f, to];
    }),
  );
}

/** The groups of two or more files that reach one another (strongly connected components, Tarjan), as paths from src. */
export function cycles(g: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const out: string[][] = [];
  let next = 0;
  const visit = (v: string) => {
    index.set(v, next);
    low.set(v, next++);
    stack.push(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (stack.includes(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w) group.push(relative(src, w));
      } while (w !== v);
      if (group.length > 1) out.push(group.sort());
    }
  };
  for (const v of g.keys()) if (!index.has(v)) visit(v);
  return out;
}

test("the cycle finder finds a cycle and leaves a chain alone", () => {
  const g = new Map([
    [join(src, "a.ts"), [join(src, "b.ts")]],
    [join(src, "b.ts"), [join(src, "c.ts")]],
    [join(src, "c.ts"), [join(src, "b.ts")]],
    [join(src, "d.ts"), [join(src, "a.ts")]],
  ]);
  assert.deepEqual(cycles(g), [["b.ts", "c.ts"]]);
});

test("src has no import cycle, type-only imports included", () => {
  const files = sources(src);
  assert.ok(files.length > 50 && statSync(join(src, "app/engine.ts")).isFile(), "the walk found src");
  assert.deepEqual(cycles(graph(files)), []);
});
