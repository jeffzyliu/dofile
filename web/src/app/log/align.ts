// Where a line of the code a run sent is echoed in its log, so the log can put things after it: each graph's link after
// the echo of its line (RunResult.graph_lines, OQ-3), and S 15's note after the echo of a nested `do` of a file with
// unsaved edits. The echoes carry no line numbers, so the echoes are walked beside the code: an echo is a line of the
// code (`. ` + the line as written; `  2. ` + the line inside a loop or a program; `> ` + a continued line), and an echo
// that is not the next line the code would echo is passed over. The line numbers decide where a link goes; the text is
// only used to keep the two walks in step. Where the walk cannot know which echo is a line's, the line has none (its
// link goes to the run's end): a link in the wrong place is worse than one at the end.
//  - a nested do-file (`. do sub.do` ... `end of do-file`) is passed over whole, when its `do` (or `include`) is a line
//    of the code outside any block and shows its echoes (no prefix, or `noisily` the last of capture, quietly, noisily);
//  - a `do` inside a block (`{ }`, a program, a mata block) is echoed once where the block is, and runs later or never:
//    it opens nothing, and its file's echoes, when they come, are passed over: after it, and after any nested file's
//    end, a top-level echo is taken only when no `end of do-file` comes before the next `do` (endFirst below);
//  - a top-level echo (`. x`) that is not the next line is looked for further down (outside blocks), so the walk gets back
//    in step after lines that are echoed in another form (a mata block's `: ` lines) or not at all;
//  - lines never echoed are passed over: blank lines, the inside of a `/* */` comment (echoed only as a `> ` line when
//    the comment began in a command), and the body of a `quietly { }` or `capture { }` block outside a loop or program.
// The code is indexed by text, so the walk is linear in the log (LogView also keeps each run's answer).
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).
import type { LogLine } from "./classify.ts";

const BODY = /^\s+\d+\. ?/;
// capture, quietly and noisily, as a prefix (abbreviated: cap, qui, n; with or without a colon)
const PREFIX = /^(cap(?:t|tu|tur|ture)?|qui(?:e|et|etl|etly)?|n(?:o|oi|ois|oisi|oisil|oisily)?)(?:\s*:\s*|\s+)/;

/** A command without its capture, quietly and noisily prefixes; `shown`: its echoes show (no prefix, or noisily the
 *  last); `any`: it had a prefix. */
function prefixed(command: string): { rest: string; shown: boolean; any: boolean } {
  let rest = command.trim(),
    shown = true,
    any = false;
  for (let m = PREFIX.exec(rest); m; m = PREFIX.exec(rest)) {
    shown = m[1][0] === "n";
    any = true;
    rest = rest.slice(m[0].length);
  }
  return { rest, shown, any };
}

/** A `do` or `include` command: the rest of its line, and whether its echoes show (no prefix, or noisily the last). */
function nested(command: string): { arg: string; shown: boolean } | null {
  const { rest, shown } = prefixed(command);
  const m = /^(?:do|include)\s+(.+)$/.exec(rest);
  return m ? { arg: m[1], shown } : null;
}
/** Whether `command` runs a do-file whose echoes show in the log. */
const opens = (command: string) => nested(command)?.shown === true;

const PROGRAM = /^pr(?:o|og|ogr|ogra|ogram)?\s+(?:de(?:f|fi|fin|fine)?\s+)?(?!(?:drop|dir|list)\b)[A-Za-z_]/;
const MATA = /^mata\s*:?\s*$/;
const LOOP = /^(?:foreach|forv(?:a|al|alu|alue|alues)?|while)\b/;
const MACRO = /^(?:loc(?:a|al)?|gl(?:o|ob|oba|obal)?)\s/; // local and global: a brace there is the macro's text

/** Whether a line (comments and strings left in) opens a block that closes at an `end` line: `program define` or `mata`
 *  on its own (`mata: x = 1` is one line). */
export const opensEndBlock = (line: string) => {
  const { rest } = prefixed(line.replace(/\s*\/\/.*$/, ""));
  return PROGRAM.test(rest) || MATA.test(rest);
};

/** The code's line as an echo shows it, in any of the echo's forms (`. `, a loop's or program's body `  2. `, a continued
 *  `> `), or null for a line that is not an echo. LogView reads a nested `do` from it for S 15's note. */
export function echoed(l: LogLine): string | null {
  if (l.kind !== "echo") return null;
  const t = l.text;
  if (t === "." || t === ">") return "";
  if (t.startsWith(". ") || t.startsWith("> ")) return t.slice(2);
  const m = BODY.exec(t);
  return m ? t.slice(m[0].length) : null;
}

/** Per code line: `skip`, it may be left out of the echoes (empty, or inside or opening a block comment); `inside`, it
 *  is inside a block comment opened on an earlier line (then echoed only as a continued `> ` line). */
function comments(code: string[]): { skip: boolean[]; inside: boolean[] } {
  let depth = 0;
  const skip: boolean[] = [],
    inside: boolean[] = [];
  for (const line of code) {
    const open = depth > 0;
    for (let i = 0; i < line.length; i++) {
      if (line.startsWith("/*", i)) {
        depth++;
        i++;
      } else if (depth && line.startsWith("*/", i)) {
        depth--;
        i++;
      }
    }
    skip.push(!line.trim() || open || /^\s*\/\*/.test(line));
    inside.push(open);
  }
  return { skip, inside };
}

/** Per code line: `inside` a block (braces, `forvalues ... {` to `}`, the closing line inside; a program, `program
 *  define` to `end`; a mata block, `mata:` to `end`), and `silent`, never echoed: the body and closing brace of a
 *  `quietly {` or `capture {` block that is not in a loop or a program (whose lines are echoed as they are read).
 *  Braces in strings, comments and a local's or global's text are not counted. */
function blocks(code: string[]): { inside: boolean[]; silent: boolean[] } {
  const open: ("loop" | "silent" | "other")[] = []; // the brace blocks open, innermost last
  let ends = 0, // programs and mata blocks open: each closes at an `end`
    comment = false;
  const inside: boolean[] = [],
    silent: boolean[] = [];
  for (const line of code) {
    inside.push(open.length > 0 || ends > 0);
    silent.push(open.includes("silent"));
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
    const { rest, shown, any } = prefixed(text);
    if (ends > 0 && /^\s*end\s*$/.test(text)) ends--;
    else if (PROGRAM.test(rest) || MATA.test(rest)) ends++;
    else if (!MACRO.test(rest))
      for (const c of text) {
        if (c === "}") open.pop();
        else if (c === "{")
          open.push(
            LOOP.test(rest)
              ? "loop"
              : any && !shown && rest === "{" && ends === 0 && !open.includes("loop")
                ? "silent"
                : "other",
          );
      }
  }
  return { inside, silent };
}

/** Whether each code line is inside a block (see blocks()). */
export const inBlocks = (code: string[]): boolean[] => blocks(code).inside;

/** The first index in the ascending `list` that is at least `from`. */
function atLeast(list: readonly number[], from: number): number {
  let lo = 0,
    hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** For each 1-based line of `code`, the index in `lines` of its echo. A line with no echo found is not in the map. */
export function echoLines(lines: readonly LogLine[], code: string): Map<number, number> {
  const src = code.split(/\r?\n/).map((l) => l.trimEnd());
  const { skip, inside: inComment } = comments(src);
  const { inside: block, silent } = blocks(src);
  const n = src.length;
  // the next line that is surely echoed (not skippable, not silent), from each line
  const real = new Array<number>(n + 1).fill(n);
  for (let j = n - 1; j >= 0; j--) real[j] = skip[j] || silent[j] ? real[j + 1] : j;
  // the code's lines by text: all of them, and those the look-ahead may jump to (outside blocks, surely echoed)
  const all = new Map<string, number[]>(),
    far = new Map<string, number[]>();
  const add = (by: Map<string, number[]>, t: string, j: number) => {
    const list = by.get(t);
    if (list) list.push(j);
    else by.set(t, [j]);
  };
  src.forEach((t, j) => {
    add(all, t, j);
    if (!block[j] && !skip[j] && !silent[j]) add(far, t, j);
  });
  // for each log line: whether an `end of do-file` comes before the next echo of a `do` (a nested file's end first:
  // the line may be inside a file a block or a program ran)
  const endFirst = new Array<boolean>(lines.length);
  let e = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    endFirst[i] = e;
    const x = echoed(lines[i]);
    if (lines[i].text === "end of do-file") e = true;
    else if (x !== null && opens(x)) e = false;
  }

  const found = new Map<number, number>();
  let p = 0; // the next code line to find
  let depth = 0; // nested do-files open
  let jump = true; // whether a top-level echo may be taken, and looked for further down: not while a nested file's
  // echoes may come unannounced (after a `do` in a block, or after a nested file's end)
  for (let i = 0; i < lines.length; i++) {
    const x = echoed(lines[i]);
    if (depth > 0) {
      if (lines[i].text === "end of do-file") {
        depth--;
        if (depth === 0) jump = false; // more ends than were seen opening may follow (a `do` in a loop of that file)
      } else if (x !== null && opens(x)) depth++;
      continue;
    }
    if (x === null) {
      if (lines[i].text === "end of do-file") jump = false; // a do-file run from a block, or a program, just ended
      continue;
    }
    const t = x.trimEnd();
    if (!t.trim()) continue;
    const dot = lines[i].text.startsWith(". ");
    if (!jump && dot && !opens(x)) {
      if (endFirst[i]) continue; // perhaps inside a do-file a block or a program ran: not known, so passed over
      jump = true; // no nested file's end before the next `do`: the walk is at the top again
    }
    // in step: the next line, or a line before it that may be left out but is echoed here
    const continued = lines[i].text.startsWith(">");
    const r = real[p];
    let j = -1;
    const same = all.get(t) ?? [];
    for (let k = atLeast(same, p); k < same.length && same[k] <= r; k++) {
      const c = same[k];
      if (c === r || (!silent[c] && (!inComment[c] || continued))) {
        j = c;
        break;
      }
    }
    let jumped = false;
    if (j < 0) {
      const ahead = jump && dot ? (far.get(t) ?? []) : [];
      const k = atLeast(ahead, p + 1);
      if (k >= ahead.length) {
        if (opens(x)) depth++; // a do inside a nested file we did not see open: keep the count anyway
        continue;
      }
      j = ahead[k];
      jumped = true;
    }
    found.set(j + 1, i);
    p = j + 1;
    if (!jumped && !block[j]) jump = true;
    if (opens(x)) {
      if (block[j])
        jump = false; // its file's echoes come later, or never: pass them over
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
