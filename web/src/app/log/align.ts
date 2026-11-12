// Where a line of the code a run sent is echoed in its log, so the log can put things after it: each graph's link after
// the echo of its line (RunResult.graph_lines, OQ-3), and S 15's note after the echo of a nested `do` of a file with
// unsaved edits. The echoes carry no line numbers, so the echoes are walked beside the code: an echo is a line of the
// code (`. ` + the line as written; `  2. ` + the line inside a loop or a program; `> ` + a continued line), and an echo
// that is not the next line the code would echo belongs to a nested do-file (`. do sub.do` ... `end of do-file`) and
// is passed over. The line numbers decide where a link goes; the text is only used to keep the two walks in step.
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).
import type { LogLine } from "./classify.ts";

const BODY = /^\s+\d+\. ?/;
const NESTED = /^\s*(?:noi(?:s|si|sil|sily)?\s+)?(?:do|include)\s+(.+)$/;

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

/** For each 1-based line of `code`, the index in `lines` of its echo. A line with no echo found is not in the map. */
export function echoLines(lines: readonly LogLine[], code: string): Map<number, number> {
  const src = code.split(/\r?\n/);
  const skip = skippable(src);
  const found = new Map<number, number>();
  let p = 0; // the next code line to find
  let depth = 0; // nested do-files open
  for (let i = 0; i < lines.length; i++) {
    if (depth > 0) {
      if (lines[i].text === "end of do-file") depth--;
      else if (NESTED.test(echoed(lines[i]) ?? "\0")) depth++;
      continue;
    }
    const x = echoed(lines[i]);
    if (x === null || !x.trim()) continue;
    let j = p;
    while (j < src.length && src[j].trimEnd() !== x.trimEnd() && skip[j]) j++;
    if (j >= src.length || src[j].trimEnd() !== x.trimEnd()) {
      if (NESTED.test(x)) depth++; // a do inside a nested file we did not see open: keep the count anyway
      continue;
    }
    found.set(j + 1, i);
    p = j + 1;
    if (NESTED.test(x)) depth++;
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
  const m = NESTED.exec(command);
  if (!m) return null;
  let arg = m[1].replace(/\s*\/\/.*$/, "").trim();
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
