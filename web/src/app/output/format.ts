// The Output tabs' logic, with no DOM and no component (step 4c; docs/design/SPEC.md, sections 3.7 to 3.9, 3.11): how a
// number is shown, a matrix as text, the Results tab's sections, a long Browse cell cut short, a graph's label and alt
// text, sizes. Plain TypeScript so Node tests it (test/output.test.ts).

import type { Macros, Matrix, Results, Value } from "../../engine/types.ts";
import type { Graph } from "../types.ts";

// ---- numbers ----

/** `0.5` is shown `.5` and `-0.5` `-.5`, as the engine's own output does. */
const dropZero = (s: string) => s.replace(/^(-?)0\./, "$1.");

/** At 1e8 and above, and below 1e-5, a number is shown in exponent form, as `%9.0g` would: 1.2345679e+08. */
const BIG = 1e8,
  SMALL = 1e-5;

/** A value to 8 significant digits, as the tables show it: trailing zeros and a leading zero dropped (500, .40913736,
 *  3046.9852), exponent form for 1e8 and up and below 1e-5. A missing value (null, also an infinity) is `.`; the
 *  extended missings `.a` to `.z` come as text and stay. */
export function shown(v: Value): string {
  if (v === null) return ".";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return ".";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  const plain = abs >= BIG || abs < SMALL ? "e" : v.toPrecision(8); // 99999999.6 rounds up to exponent form
  if (plain.includes("e")) {
    const [mantissa, exp] = v.toExponential(7).split("e");
    const m = mantissa.includes(".") ? mantissa.replace(/\.?0+$/, "") : mantissa;
    return `${m}e${exp[0] === "-" ? "-" : "+"}${exp.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  return dropZero(plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain);
}

/** Every digit the engine sent: what a focused or hovered value shows, and what is copied. */
export function full(v: Value): string {
  if (v === null) return ".";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return ".";
  return dropZero(String(v));
}

/** The engine's matrix size "1x3" as "1 x 3". Anything else stays as it is. */
export const sizeLabel = (size: string) => size.replace(/^(\d+)x(\d+)$/, "$1 x $2");

/** A matrix as tab-separated text: a header line of the column names (after an empty cell), then each row's name and
 *  values at full digits. */
export function matrixTsv(m: { rows: string[]; cols: string[]; data: Value[][] }): string {
  const body = m.rows.map((name, i) => [name, ...m.data[i].map(full)].join("\t"));
  return [["", ...m.cols].join("\t"), ...body].join("\n");
}

/** A `matrix` answer that has values (not the `{error}` form). */
export const hasValues = (m: Matrix): m is Exclude<Matrix, { error: string }> => !("error" in m);

// ---- sizes and counts ----

/** 6 KB, 1.2 MB: bytes as a person reads them. */
export function bytes(n: number): string {
  const unit = (value: number, name: string) => `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))} ${name}`;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return unit(n / 1024, "KB");
  if (n < 1024 ** 3) return unit(n / 1024 ** 2, "MB");
  return unit(n / 1024 ** 3, "GB");
}

/** 1,204: a count with its thousands separators. */
export const count = (n: number) => n.toLocaleString("en-US");

/** `use "data/wages.dta", clear`; a path with a double quote in it gets compound quotes. */
export const useCommand = (path: string) => (path.includes('"') ? `use \`"${path}"', clear` : `use "${path}", clear`);

// ---- Browse: a long cell ----

/** The longest a Browse cell shows before it is cut; the whole value is one click away. */
export const CELL_MAX = 60;
const TITLE_MAX = 1000;

/** A Browse cell as the grid draws it. A strL can be thousands of characters with line breaks: `text` is its first
 *  `CELL_MAX` characters on one line (a line break shows as ↵), `cut` is true when that is not the whole value, or it has
 *  a line break, and `title` is the value for a tooltip (at most 1000 characters). A short cell is as it is. */
export function cutCell(value: string): { text: string; cut: boolean; title: string } {
  const lines = value.includes("\n") || value.includes("\r");
  const flat = lines ? value.replace(/\r\n|\r|\n/g, "↵ ") : value;
  const long = flat.length > CELL_MAX;
  return {
    text: long ? `${flat.slice(0, CELL_MAX - 1)}…` : flat,
    cut: long || lines,
    title: value.length > TITLE_MAX ? `${value.slice(0, TITLE_MAX)}…` : value,
  };
}

// ---- graphs ----

/** What a graph is called after its number: its command, or the file it came from. */
export const graphSubject = (g: Graph) => g.command || g.path || null;

/** "graph 2 of 5": `n` is the graph's number in the log's links; the total is the newest graph's number. */
export function graphCounter(g: Graph, all: Graph[]) {
  return `graph ${g.n} of ${Math.max(g.n, ...all.map((x) => x.n))}`;
}

/** "graph 2 of 5 · scatter wage educ". */
export function graphTitle(g: Graph, all: Graph[]) {
  const subject = graphSubject(g);
  return subject ? `${graphCounter(g, all)} · ${subject}` : graphCounter(g, all);
}

/** The picture's alt text: "Graph: scatter wage educ". Several graphs can share one command (a loop draws three from one
 *  line, and `graph_commands` holds the unexpanded command): then each says its number, "Graph 2: scatter y x". */
export function graphAlt(g: Graph, all: Graph[]): string {
  const subject = graphSubject(g);
  if (!subject) return `Graph ${g.n}`;
  const shared = all.some((x) => x.n !== g.n && graphSubject(x) === subject);
  return shared ? `Graph ${g.n}: ${subject}` : `Graph: ${subject}`;
}

// ---- Results: sections and groups ----

export interface ResultRow {
  key: string; // unique in the tab
  name: string; // e(N), `local', $global
  value: Value; // a scalar or a macro's text; for a matrix, its size "1x3"
  matrix?: string; // a matrix: the name for the `matrix` op, e(b)
}
export interface ResultGroup {
  id: string; // e.scalars, r.macros, m.locals ...
  title: string; // Scalars, Macros, Matrices, Locals, Globals
  note: string; // after the title: the count, or "6, all set by the system"
  open: boolean; // its state until the visitor folds or unfolds it
  rows: ResultRow[];
}
export interface ResultSection {
  id: "e" | "r" | "m";
  title: string; // e() · regress, r(), Locals and globals
  changed: boolean; // "changed by the last run"
  groups: ResultGroup[];
}

/** The Results tab's sections from `results` and `macros`, empty groups left out, and no section at all when nothing is
 *  there (the empty state). Only the e() scalars start open (and the r() scalars when e() has none, so `summarize` alone
 *  shows its numbers); Locals start open, Globals folded. A matrix row's value is its size; its name is `e(b)`.
 *  OQ-7: no Functions group, and the r() section is just "r()". Globals the engine itself sets count as the system's,
 *  but a section of nothing else is no result: the empty state shows. */
export function sections(results: Results | null, macros: Macros | null): ResultSection[] {
  const out: ResultSection[] = [];
  const eScalars = results ? Object.keys(results.e.scalars).length : 0;
  for (const id of ["e", "r"] as const) {
    const set = results?.[id];
    if (!results || !set) continue;
    const groups: ResultGroup[] = [];
    const add = (kind: "scalars" | "macros" | "matrices", title: string, open: boolean) => {
      const names = Object.keys(set[kind]);
      if (!names.length) return;
      const rows = names.map((n): ResultRow => {
        const name = `${id}(${n})`;
        const value = kind === "matrices" ? set.matrices[n] : kind === "macros" ? set.macros[n] : set.scalars[n];
        return { key: name, name, value, ...(kind === "matrices" ? { matrix: name } : {}) };
      });
      groups.push({ id: `${id}.${kind}`, title, note: String(rows.length), open, rows });
    };
    add("scalars", "Scalars", id === "e" || eScalars === 0);
    add("macros", "Macros", false);
    add("matrices", "Matrices", false);
    if (!groups.length) continue;
    const cmd = id === "e" ? set.macros.cmd : undefined;
    out.push({
      id,
      title: cmd ? `e() · ${cmd}` : `${id}()`,
      changed: id === "e" ? results.e_changed : results.r_changed,
      groups,
    });
  }
  if (macros) {
    const locals = Object.entries(macros.locals);
    const globals = Object.entries(macros.globals).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const system = new Set(macros.system_globals);
    const own = globals.filter(([n]) => !system.has(n)).length;
    if (out.length || locals.length || own) {
      const groups: ResultGroup[] = [];
      if (locals.length)
        groups.push({
          id: "m.locals",
          title: "Locals",
          note: String(locals.length),
          open: true,
          rows: locals.map(([n, v]) => ({ key: `local ${n}`, name: `\`${n}'`, value: v })),
        });
      if (globals.length) {
        const sys = globals.length - own;
        groups.push({
          id: "m.globals",
          title: "Globals",
          note: sys === 0 ? `${globals.length}` : `${globals.length}, ${own === 0 ? "all" : sys} set by the system`,
          open: false,
          rows: globals.map(([n, v]) => ({ key: `global ${n}`, name: `$${n}`, value: v })),
        });
      }
      if (groups.length) out.push({ id: "m", title: "Locals and globals", changed: false, groups });
    }
  }
  return out;
}
