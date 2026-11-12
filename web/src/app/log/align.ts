// Where a line of the code a run sent is echoed in its log, so the log can put things after it: each graph's link after
// the echo of its line (RunResult.graph_lines, OQ-3), and S 15's note after the echo of a nested `do` of a file with
// unsaved edits. The echoes carry no line numbers, so the echoes are walked beside the code: an echo is a line of the
// code (`. ` + the line as written; `  2. ` + the line inside a loop or a program; `> ` + a continued line), and an echo
// that is not the next line the code would echo is passed over. The line numbers decide where a link goes; the text is
// only used to keep the two walks in step:
//  - a nested do-file (`. do sub.do` ... `end of do-file`) is passed over whole, when its `do` (or `include`) is a line
//    of the code outside any block and shows its echoes (no prefix, or `noisily` the last of capture, quietly, noisily);
//  - a `do` inside a block (`{ }`, a program, a mata block) is echoed once where the block is, and runs later or never:
//    it opens nothing, and its file's echoes, when they come, are passed over one by one (they match no line of the code
//    but by chance, and none is jumped to while they may come);
//  - a top-level echo (`. x`) that is not the next line is looked for further down (outside blocks), so the walk gets back
//    in step after lines that are echoed in another form (a mata block's `: ` lines) or not at all.
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).
import type { LogLine } from "./classify.ts";

const BODY = /^\s+\d+\. ?/;
// capture, quietly and noisily, as a prefix (abbreviated, with or without a colon)
const PREFIX = /^(cap(?:t|tu|tur|ture)?|qui(?:e|et|etl|etly)?|noi(?:s|si|sil|sily)?)(?:\s*:\s*|\s+)/;

/** A `do` or `include` command: the rest of its line, and whether its echoes show (no prefix, or noisily the last). */
function nested(command: string): { arg: string; shown: boolean } | null {
  let rest = command.trim(),
    shown = true;
  for (let m = PREFIX.exec(rest); m; m = PREFIX.exec(rest)) {
    shown = m[1].startsWith("noi");
    rest = rest.slice(m[0].length);
  }
  const m = /^(?:do|include)\s+(.+)$/.exec(rest);
  return m ? { arg: m[1], shown } : null;
}
/** Whether `command` runs a do-file whose echoes show in the log. */
const opens = (command: string) => nested(command)?.shown === true;

/** The code's line as an echo shows it, or null for a line that is not an echo. */
function echoed(l: LogLine): string | null {
  if (l.kind !== "echo") return null;
  const t = l.text;
  if (t === "." || t === ">") return "";
  if (t.startsWith(". ") || t.startsWith("> ")) return t.slice(2);
  const m = BODY.exec(t);
  return m ? t.slice(m[0].length) : null;
}

/** Whether each code line could be left out of the echoes: empty, or inside (or opening) a block comment. */
function skippable(code: string[]): boolean[] {
  let depth = 0;
  return code.map((line) => {
    const open = depth > 0;
    const startsComment = /^\s*\/\*/.test(line);
    for (let i = 0; i < line.length; i++) {
      if (line.startsWith("/*", i)) {
        depth++;
        i++;
      } else if (depth && line.startsWith("*/", i)) {
        depth--;
        i++;
      }
    }
    return !line.trim() || open || startsComment;
  });
}

const PROGRAM =
  /^\s*(?:(?:cap(?:t|tu|tur|ture)?|qui(?:e|et|etl|etly)?|noi(?:s|si|sil|sily)?)\s+)*pr(?:o|og|ogr|ogra|ogram)?\s+(?:de(?:f|fi|fin|fine)?\s+)?(?!(?:drop|dir|list)\b)[A-Za-z_]/;
const MATA = /^\s*mata\s*:?\s*$/;

/** Whether each code line is inside a block: braces (`forvalues ... {` to `}`; the closing line is inside), a program
 *  (`program define` to `end`) or a mata block (`mata:` to `end`). Braces in strings and comments are not counted. */
export function inBlocks(code: string[]): boolean[] {
  let braces = 0,
    ends = 0, // programs and mata blocks open: each closes at an `end`
    comment = false;
  return code.map((line) => {
    const inside = braces > 0 || ends > 0;
    let text = "";
    for (let i = 0; i < line.length; i++) {
      if (comment) {
        if (line.startsWith("*/", i)) {
          comment = false;
          i++;
        }
      } else if (line.startsWith("/*", i)) {
        comment = true;
        i++;
      } else if (line.startsWith("//", i)) break;
      else text += line[i];
    }
    text = text.replace(/`"[\s\S]*?"'/g, "").replace(/"[^"]*"/g, "");
    if (/^\s*\*/.test(text)) text = "";
    if (ends > 0 && /^\s*end\s*$/.test(text)) ends--;
    else if (PROGRAM.test(text) || MATA.test(text)) ends++;
    else for (const c of text) braces = Math.max(0, braces + (c === "{" ? 1 : c === "}" ? -1 : 0));
    return inside;
  });
}

/** For each 1-based line of `code`, the index in `lines` of its echo. A line with no echo found is not in the map. */
export function echoLines(lines: readonly LogLine[], code: string): Map<number, number> {
  const src = code.split(/\r?\n/);
  const skip = skippable(src);
  const block = inBlocks(src);
  const found = new Map<number, number>();
  let p = 0; // the next code line to find
  let depth = 0; // nested do-files open
  let jump = true; // whether an echo may be looked for further down: not while a nested file's echoes may come unannounced
  for (let i = 0; i < lines.length; i++) {
    const x = echoed(lines[i]);
    if (depth > 0) {
      if (lines[i].text === "end of do-file") depth--;
      else if (x !== null && opens(x)) depth++;
      continue;
    }
    if (x === null) {
      if (lines[i].text === "end of do-file") jump = false; // a do-file run from a block, or a program, just ended
      continue;
    }
    if (!x.trim()) continue;
    const same = (j: number) => src[j].trimEnd() === x.trimEnd();
    let j = p;
    while (j < src.length && !same(j) && skip[j]) j++;
    let jumped = false;
    if (j >= src.length || !same(j)) {
      const k =
        jump && lines[i].text.startsWith(". ")
          ? src.findIndex((_, n) => n > p && !block[n] && !skip[n] && same(n))
          : -1;
      if (k < 0) {
        if (opens(x)) depth++; // a do inside a nested file we did not see open: keep the count anyway
        continue;
      }
      j = k;
      jumped = true;
    }
    found.set(j + 1, i);
    p = j + 1;
    if (!jumped && !block[j]) jump = true;
    if (opens(x)) {
      if (block[j])
        jump = false; // its file's echoes come later, or never: pass them over one by one
      else depth++;
    }
  }
  return found;
}

/** The last line of the command whose echo starts at `at` (its `> ` continued lines follow it). */
export function commandEnd(lines: readonly LogLine[], at: number): number {
  let e = at;
  while (lines[e + 1]?.kind === "echo" && lines[e + 1].text.startsWith(">")) e++;
  return e;
}

/** The file a `do` or `include` line names, as the store would have it (`.do` added when it has no extension, `\` as `/`,
 *  a leading `./` dropped), or null for another command. */
export function nestedTarget(command: string): string | null {
  const m = nested(command);
  if (!m) return null;
  let arg = m.arg.replace(/\s*\/\/.*$/, "").trim();
  const q = /^`"(.*)"'/.exec(arg) ?? /^"([^"]*)"/.exec(arg);
  arg = q ? q[1] : arg.split(/[\s,]/)[0];
  if (!arg) return null;
  arg = arg.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/\.[^/.]+$/.test(arg)) arg += ".do";
  return arg;
}

/** Which of `paths` (the open files with unsaved edits) a nested do of `target` runs: the same path, else the one path
 *  with that file name (the path shim finds a file named for another computer by its name). */
export function unsavedTarget(target: string, paths: readonly string[]): string | null {
  if (paths.includes(target)) return target;
  const name = target.slice(target.lastIndexOf("/") + 1);
  const same = paths.filter((p) => p.slice(p.lastIndexOf("/") + 1) === name);
  return same.length === 1 ? same[0] : null;
}
