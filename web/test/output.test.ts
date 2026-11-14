// The Output tabs' logic (src/app/output/format.ts, step 4c; docs/design/SPEC.md, sections 3.7 to 3.9): how a number is
// shown, a matrix as text, the Results tab's sections and groups, a long Browse cell cut short, a graph's label and alt
// text, sizes. The views themselves are checked in the browser (e2e/output.spec.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bytes,
  CELL_MAX,
  copiedNote,
  count,
  cutCell,
  full,
  graphAlt,
  graphCounter,
  graphTitle,
  matrixTsv,
  sections,
  shown,
  sizeLabel,
} from "../src/app/output/format.ts";
import type { Graph } from "../src/app/types.ts";
import type { Macros, Results } from "../src/engine/types.ts";

test("a value shows 8 significant digits, with no trailing zeros and no leading zero", () => {
  assert.equal(shown(500), "500");
  assert.equal(shown(172.07152221761643), "172.07152");
  assert.equal(shown(0.40913736123), ".40913736");
  assert.equal(shown(-0.5), "-.5");
  assert.equal(shown(3046.98519), "3046.9852");
  assert.equal(shown(-1253.17740001), "-1253.1774");
  assert.equal(shown(2.5), "2.5");
  assert.equal(shown(0), "0");
  assert.equal(shown(12345678), "12345678");
  assert.equal(shown(0.00001234), ".00001234");
});

test("a very large or very small value goes to exponent form, as %g would", () => {
  assert.equal(shown(123456789), "1.2345679e+08");
  assert.equal(shown(1e8), "1e+08");
  assert.equal(shown(99999999.6), "1e+08", "rounding up to 1e8 is exponent form too");
  assert.equal(shown(0.000001234), "1.234e-06");
  assert.equal(shown(-2.5e-10), "-2.5e-10");
  assert.equal(shown(1.5e100), "1.5e+100");
});

test("a missing value is a dot, and the extended missings stay as the engine sent them", () => {
  assert.equal(shown(null), ".");
  assert.equal(shown(".a"), ".a");
  assert.equal(shown(Infinity), ".");
  assert.equal(full(null), ".");
  assert.equal(full(".z"), ".z");
  assert.equal(shown("age educ"), "age educ", "a macro's text stays");
});

test("the full form keeps every digit the engine sent, and drops only the leading zero", () => {
  assert.equal(full(172.07152221761643), "172.07152221761643");
  assert.equal(full(0.40913736123), ".40913736123");
  assert.equal(full(-0.25), "-.25");
  assert.equal(full(3), "3");
});

test("the engine's size 1x3 reads 1 x 3", () => {
  assert.equal(sizeLabel("1x3"), "1 x 3");
  assert.equal(sizeLabel("16x16"), "16 x 16");
  assert.equal(sizeLabel("weird"), "weird");
});

test("a matrix copies as tab-separated text: a header of the columns, then each row's name and full values", () => {
  const text = matrixTsv({
    rows: ["y1", "y2"],
    cols: ["age", "educ", "_cons"],
    data: [
      [0.1111234567, 0.85941383, 4.8575414],
      [null, ".a", 3],
    ],
  });
  assert.equal(text, "\tage\teduc\t_cons\ny1\t.1111234567\t.85941383\t4.8575414\ny2\t.\t.a\t3");
  assert.equal(matrixTsv({ rows: [], cols: ["a"], data: [] }), "\ta");
});

test("sizes and counts read as a person writes them", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(900), "900 B");
  assert.equal(bytes(6 * 1024), "6 KB");
  assert.equal(bytes(1536), "1.5 KB");
  assert.equal(bytes(12 * 1024 + 300), "12 KB");
  assert.equal(bytes(1.2 * 1024 * 1024), "1.2 MB");
  assert.equal(count(1204), "1,204");
});

test("a long Browse cell is cut to one line; a line break shows as an arrow; the title holds the value", () => {
  const short = cutCell("Hourly wage");
  assert.deepEqual(short, { text: "Hourly wage", cut: false, title: "Hourly wage" });
  const long = cutCell("x".repeat(5000));
  assert.equal(long.text.length, CELL_MAX);
  assert.ok(long.text.endsWith("…") && long.cut);
  assert.ok(long.title.length <= 1001 && long.title.endsWith("…"));
  const lines = cutCell("first\nsecond\r\nthird");
  assert.equal(lines.text, "first↵ second↵ third");
  assert.ok(lines.cut, "a value with line breaks is one click from its whole form");
  assert.equal(lines.title, "first\nsecond\r\nthird");
  assert.equal(cutCell("y".repeat(CELL_MAX)).cut, false, "exactly the limit is not cut");
});

const graph = (n: number, command?: string, extra: Partial<Graph> = {}): Graph => ({
  n,
  png: "",
  theme: "light",
  from: "run",
  command,
  ...extra,
});

test("a graph's alt text is its command; graphs from one command say their number", () => {
  const one = [graph(1, "scatter wage educ")];
  assert.equal(graphAlt(one[0], one), "Graph: scatter wage educ");
  const loop = [graph(1, "scatter y x"), graph(2, "scatter y x"), graph(3, "scatter y x"), graph(4, "histogram z")];
  assert.equal(graphAlt(loop[0], loop), "Graph 1: scatter y x");
  assert.equal(graphAlt(loop[2], loop), "Graph 3: scatter y x");
  assert.equal(graphAlt(loop[3], loop), "Graph: histogram z");
  const named = [graph(1, undefined)];
  assert.equal(graphAlt(named[0], named), "Graph 1", "no command: the number");
  const file = [graph(1, undefined, { from: "file", path: "output/scatter.png" })];
  assert.equal(graphAlt(file[0], file), "Graph: output/scatter.png");
});

test("the graph's title says its number of the newest, and its command or file", () => {
  const list = [graph(3, "scatter wage educ"), graph(5, undefined, { from: "file", path: "a.png" })];
  assert.equal(graphCounter(list[0], list), "graph 3 of 5");
  assert.equal(graphTitle(list[0], list), "graph 3 of 5 · scatter wage educ");
  assert.equal(graphTitle(list[1], list), "graph 5 of 5 · a.png");
  assert.equal(graphTitle(graph(1), [graph(1)]), "graph 1 of 1");
});

const NONE = { scalars: {}, macros: {}, matrices: {} };
const results = (
  e: Partial<typeof NONE> = {},
  r: Partial<typeof NONE> = {},
  flags = { e: false, r: false },
): Results => ({
  e: { ...NONE, ...e },
  r: { ...NONE, ...r },
  e_changed: flags.e,
  r_changed: flags.r,
});
const macros = (
  locals: Record<string, string> = {},
  globals: Record<string, string> = {},
  system: string[] = [],
): Macros => ({
  locals,
  globals,
  system_globals: system,
});

test("no section when there is nothing to show: no results, or only the engine's own globals", () => {
  assert.deepEqual(sections(null, null), []);
  assert.deepEqual(sections(results(), macros()), []);
  assert.deepEqual(sections(results(), macros({}, { S_ADO: "x", S_OS: "y" }, ["S_ADO", "S_OS"])), []);
});

test("e() is titled with its command, groups only when they hold something, and only the e() scalars start open", () => {
  const rs = results(
    { scalars: { N: 500, r2: 0.409 }, macros: { cmd: "regress" }, matrices: { b: "1x3", V: "3x3" } },
    { scalars: { mean: 3 } },
    { e: true, r: false },
  );
  const out = sections(rs, macros());
  assert.deepEqual(
    out.map((s) => [s.id, s.title, s.changed, s.groups.map((g) => [g.id, g.note, g.open])]),
    [
      [
        "e",
        "e() · regress",
        true,
        [
          ["e.scalars", "2", true],
          ["e.macros", "1", false],
          ["e.matrices", "2", false],
        ],
      ],
      ["r", "r()", false, [["r.scalars", "1", false]]],
    ],
  );
  const [scalars, , matrices] = out[0].groups;
  assert.deepEqual(scalars.rows[0], { key: "e(N)", name: "e(N)", value: 500 });
  assert.deepEqual(matrices.rows[1], { key: "e(V)", name: "e(V)", value: "3x3", matrix: "e(V)" });
  assert.equal(
    out.some((s) => s.groups.some((g) => g.title === "Functions")),
    false,
    "no Functions group in P1 (OQ-7)",
  );
});

test("with no e() scalars, the r() scalars start open, so summarize alone shows its numbers", () => {
  const out = sections(results({}, { scalars: { N: 10, mean: 2.5 } }, { e: false, r: true }), macros());
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].title, out[0].changed, out[0].groups[0].open], ["r()", true, true]);
});

test("locals and globals: names as written in the code, globals sorted, the engine's unchanged presets left out", () => {
  // F1 still holds its preset (in system_globals); S_ADO is a preset the user changed, so the engine does not list it
  const out = sections(
    results(),
    macros({ controls: "age educ", v: "educ" }, { zeta: "1", F1: "help advice;", S_ADO: "mine", alpha: "2" }, ["F1"]),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Locals and globals");
  const [locals, globals] = out[0].groups;
  assert.deepEqual([locals.title, locals.note, locals.open], ["Locals", "2", true]);
  assert.deepEqual(
    locals.rows.map((r) => r.name),
    ["`controls'", "`v'"],
  );
  assert.deepEqual([globals.title, globals.note, globals.open], ["Globals", "3", false]);
  assert.deepEqual(
    globals.rows.map((r) => r.name),
    ["$S_ADO", "$alpha", "$zeta"],
  );
  const next = sections(results({ scalars: { N: 1 } }), macros({ v: "1" }, { S_ADO: "a" }, ["S_ADO"]));
  assert.deepEqual(
    next[1].groups.map((g) => g.title),
    ["Locals"],
    "only unchanged presets: no Globals group, also with an e() result",
  );
});

test("the toast after a copy names the row as it shows it", () => {
  const [e, m] = sections(
    results({ scalars: { r2: 0.409 }, matrices: { b: "1x3" } }),
    macros({ controls: "age" }, { mygl: "5" }),
  );
  const names = [...e.groups, ...m.groups].flatMap((g) => g.rows.map(copiedNote));
  assert.deepEqual(names, ["Copied e(r2)", "Copied e(b)", "Copied `controls'", "Copied $mygl"]);
});
