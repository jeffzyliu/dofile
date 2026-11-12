// The .log tokenizer (OQ-4): the engine sends its log as plain text, and the page tells the kinds of line apart here. The
// Log pane (log/LogView.tsx) and a .log file in the editor (editor/cm.ts) both use it, so a line looks the same in both:
//  - echo: a command as run, `. regress wage educ`; a loop's or a program's body line, `  2.   scatter y x`, and a
//    continued line, `>   y x` (`///`), but only right after another echo: a `list` row `  1. | 3 |` is output;
//  - err: `r(111);`, `--Break--`, and the error's message, the line right before the hint (or before `r(111);` when
//    there is none), unless that line is an echo, empty, indented or `end of do-file`;
//  - hint: the engine's explanation under an error, from `  → ` down to the line before `r(111);`; its `How to fix:` and
//    `Learn more:` are shown bold, and `help summarize` after `Learn more:` runs as a command (OQ-20);
//  - note: what the page's own engine code adds: the path shim's `(path C:\… is cps.dta in the working folder)`, `(cd …
//    in the working folder)`, the tempfile note, and the header a `log using` file starts with (`name:`, `log:`, ...),
//    only before the file's first echo: the same lines in a run's output (`log using` prints them) are output;
//  - out: everything else, at normal weight.
// Plain TypeScript, no DOM: tested in Node (test/editor.test.ts).

export type LineKind = "echo" | "out" | "err" | "hint" | "note";
export interface LogLine {
  kind: LineKind;
  text: string;
}

const ECHO = /^\.( |$)/;
const BODY = /^\s+\d+\.( |$)/; // a loop's or a program's body, echoed once
const MORE = /^>( |$)/; // a continued line (///)
const RC = /^r\(\d+\);$/;
const HINT = /^ {2}→ /;
const NOTE = [
  /^\(path .* in the working folder\)$/,
  /^\(cd .* (in|ignored: no such folder in) the working folder\)$/,
  /^\(a tempfile lasts one run/,
];
const HEADER = /^\s*(name|log|log type|opened on|closed on|Log):\s/;
const RULE = /^-{20,}$/;

/** The kind of each line of `text` (split at "\n"; a final empty line is kept, so the lines join back to the text). */
export function classify(text: string): LogLine[] {
  const lines = text.split("\n");
  const out: LogLine[] = [];
  let hintFrom = -1; // the first line of the hint block in progress, or -1
  let echoed = false; // an echo seen: no log file's head after it
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const prev = out[i - 1];
    let kind: LineKind = "out";
    if (ECHO.test(t)) kind = "echo";
    else if ((BODY.test(t) || MORE.test(t)) && prev?.kind === "echo") kind = "echo";
    else if (t === "--Break--" || RC.test(t)) kind = "err";
    else if (HINT.test(t)) kind = "hint";
    else if (hintFrom >= 0 && /^ {4}/.test(t)) kind = "hint";
    else if (NOTE.some((re) => re.test(t))) kind = "note";
    else if (!echoed && (HEADER.test(t) || RULE.test(t))) kind = "note"; // a log file's head
    if (kind === "echo") echoed = true;
    if (kind === "hint" && hintFrom < 0) hintFrom = i;
    if (kind !== "hint") {
      // an error's r(N); (or a hint block, which only comes under an error): its message is the line right above
      if (RC.test(t)) markMessage(out, hintFrom >= 0 ? hintFrom - 1 : i - 1);
      hintFrom = -1;
    }
    out.push({ kind, text: t });
  }
  return out;
}

function markMessage(out: LogLine[], at: number) {
  const l = out[at];
  if (l?.kind !== "out" || !l.text.trim() || /^\s/.test(l.text) || l.text === "end of do-file") return;
  l.kind = "err";
}

/** The error a run ended with: its last error line that is not `r(N);` (an error caught earlier, by `capture noisily`,
 *  comes before it), or null. OQ-10's note under it is chosen from this line. */
export function runError(lines: readonly LogLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--)
    if (lines[i].kind === "err" && !/^r\(\d+\);$/.test(lines[i].text)) return lines[i].text;
  return null;
}

/** A hint line in pieces: plain text, the bold words (`How to fix:`, `Learn more:`), and a `help x` to run. */
export type HintPart = { t: "text" | "bold"; text: string } | { t: "help"; text: string };
export function hintParts(line: string): HintPart[] {
  const parts: HintPart[] = [];
  const m = /^(\s*(?:→ )?)(How to fix:|Learn more:)(.*)$/.exec(line);
  if (!m) return [{ t: "text", text: line }];
  parts.push({ t: "text", text: m[1] }, { t: "bold", text: m[2] });
  const help = m[2] === "Learn more:" ? /^(\s+)(help \w+)(.*)$/.exec(m[3]) : null;
  if (help) {
    parts.push({ t: "text", text: help[1] }, { t: "help", text: help[2] });
    if (help[3]) parts.push({ t: "text", text: help[3] });
  } else parts.push({ t: "text", text: m[3] });
  return parts;
}

/** The text a log download holds: the runs' own log, without the page's head, run-heads and notes (S 15). */
export const plainLog = (items: readonly { t: string; text?: string }[]) =>
  items
    .filter((i) => i.t === "text")
    .map((i) => i.text ?? "")
    .join("");
