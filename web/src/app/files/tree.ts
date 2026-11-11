// The file tree's plain logic (docs/design/SPEC.md, section 3.1), with no DOM and no store, so the Node tests run it:
// the rows of the tree, sizes, names and paths. FilesPane.tsx draws the rows; actions.ts changes files and tabs.
import type { FileInfo } from "../types.ts";

export interface Row {
  path: string;
  name: string; // the last part of the path
  depth: number; // 0 at the top: the row's aria-level is depth + 1
  dir: boolean;
  size: number;
  expanded?: boolean; // folders only
}

/** The last part of a path: "data/wages.dta" is "wages.dta". */
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** The folder a path is in, "" at the top. */
export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
/** `name` inside the folder `dir` ("" is the top). */
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
/** Whether `path` is `top` or lies under it. */
export const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`);
/** `path` after `from` was renamed to `to` (a path not under `from` stays). */
export const movedPath = (path: string, from: string, to: string) =>
  within(path, from) ? to + path.slice(from.length) : path;
/** The lowercased extension with its dot (".do"), or "". */
export const extOf = (path: string) => {
  const name = baseName(path),
    dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const byName = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : 1);

/** The rows of the tree: in each folder its folders first, then its files, each by name (numbers in order, case
 *  ignored). A folder that has no record of its own (the store makes them, but a list may lack one) is made up from its
 *  files' paths. The rows under a folder in `folded` are left out. */
export function treeRows(files: FileInfo[], folded: ReadonlySet<string> = new Set()): Row[] {
  const infos = new Map<string, FileInfo>();
  for (const f of files) {
    infos.set(f.path, f);
    for (let p = parentOf(f.path); p && !infos.has(p); p = parentOf(p))
      infos.set(p, { path: p, dir: true, size: 0, mtime: 0 });
  }
  const children = new Map<string, FileInfo[]>();
  for (const f of infos.values()) {
    const parent = parentOf(f.path);
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const here = (children.get(dir) ?? []).sort(
      (a, b) => Number(b.dir) - Number(a.dir) || byName(baseName(a.path), baseName(b.path)),
    );
    for (const f of here) {
      const row: Row = { path: f.path, name: baseName(f.path), depth, dir: f.dir, size: f.size };
      if (f.dir) row.expanded = !folded.has(f.path);
      rows.push(row);
      if (f.dir && row.expanded) walk(f.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** A file's size as the tree shows it, in decimal units: "512 B", "41 KB", "1.2 MB", "3.4 GB". */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 999_500) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 999_500_000) return `${(bytes / 1e6).toFixed(bytes < 9_950_000 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** A name in folder `dir` that no path in `taken` has: `name`, else "untitled-2.do", "untitled-3.do", ... (the number
 *  before the extension). */
export function freeName(dir: string, name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const dot = name.lastIndexOf("."),
    stem = dot > 0 ? name.slice(0, dot) : name,
    ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = joinPath(dir, n === 1 ? name : `${stem}-${n}${ext}`);
    if (!used.has(candidate)) return candidate;
  }
}

/** What is wrong with `name` as a new name in folder `dir`, in the words the inline rename shows, or null when it can be
 *  used. `taken`: the paths in the store. The path itself (`self`) does not count as taken. */
export function nameProblem(name: string, dir: string, taken: Iterable<string>, self?: string): string | null {
  if (name.trim() === "") return "Type a name.";
  if (name.includes("/") || name.includes("\\")) return "A name can't contain / or \\.";
  if (name === "." || name === "..") return "That name isn't allowed.";
  if (!dir && name === ".dofile") return "That name is dofile's own.";
  const path = joinPath(dir, name);
  for (const t of taken) if (t === path && t !== self) return `${name} already exists here.`;
  return null;
}

/** The label of each open file's tab: its name, and where two open files share a name, the folder too ("wages.dta ·
 *  data"; "wages.dta" alone for one at the top). */
export function tabLabels(paths: string[]): string[] {
  const count = new Map<string, number>();
  for (const p of paths) count.set(baseName(p), (count.get(baseName(p)) ?? 0) + 1);
  return paths.map((p) => {
    const name = baseName(p);
    return (count.get(name) ?? 0) > 1 && parentOf(p) ? `${name} · ${parentOf(p)}` : name;
  });
}

/** The text of a .csv or .tsv's first bar: how many rows (lines that are not empty), with thousands separators. */
export function rowCount(text: string): string {
  const n = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").length;
  return `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;
}

/** The command that reads `path`, with the path in quotes (compound quotes when it holds a double quote). */
export function quoted(path: string) {
  return path.includes('"') ? `\`"${path}"'` : `"${path}"`;
}

/** A day as the clash dialog shows it: "9 Nov". */
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
