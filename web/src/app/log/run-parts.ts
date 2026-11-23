// One run's text as the parts the log draws: its lines by kind, then what goes after them (graph links, notes, Go to
// line, the end notes). LogParts.tsx draws them.

import { jumpLine } from "../editor/words.ts";
import type { Graph, LogItem, RunHead } from "../types.ts";
import { commandEnd, echoed, echoLines, nestedTarget, unsavedTarget } from "./align.ts";
import { classify, type LineKind, type LogLine, runError } from "./classify.ts";
import { noteFor } from "./notes.ts";

export type TextItem = Extract<LogItem, { t: "text" }>;

/** A phone's hint block is one span: its lines' pieces, each after a space or a line break. */
export type ExplainPiece = { before: "" | "space" | "br"; text: string };

/** `key` identifies a part within its run's parts. */
export type RunPart =
  | { t: "line"; key: number; kind: LineKind; text: string }
  | { t: "explain"; key: string; pieces: ExplainPiece[] }
  | { t: "space"; text: string }
  | { t: "graph"; key: string; graph: Graph }
  | { t: "unsaved"; key: string; text: string }
  | { t: "jump"; key: string; line: number; path?: string }
  | { t: "wide"; key: string }
  | { t: "stopped"; key: string; text: string; jump: { line: number; path?: string } | null }
  | { t: "endnote"; key: string; text: string };

export type RunPartsInput = {
  /** The run-head before this text, or null for a command typed in the command line. */
  head: RunHead | null;
  phone: boolean;
  graphs: readonly Graph[];
  /** Whether a key chip says ⌘ (true) or Ctrl. */
  mac: boolean;
  /** The code a run sent, by its head (editor/commands.ts codeOf). */
  sentCode: (run: RunHead) => string | undefined;
};

const PHONE_COLUMNS = 48; // about what a phone's log shows across; a wider block of output says it scrolls sideways

// each text item's lines, worked out once: an item is replaced when it changes
const linesByItem = new WeakMap<TextItem, LogLine[]>();
const linesOf = (item: TextItem) => {
  const known = linesByItem.get(item);
  if (known) return known;
  const l = classify(item.text);
  linesByItem.set(item, l);
  return l;
};
// each text item's echo of each code line (align.ts), worked out once for its code
const echoesByItem = new WeakMap<TextItem, { code: string; echoes: Map<number, number> }>();
const echoesOf = (item: TextItem, lines: LogLine[], code: string) => {
  const known = echoesByItem.get(item);
  if (known?.code === code) return known.echoes;
  const echoes = echoLines(lines, code);
  echoesByItem.set(item, { code, echoes });
  return echoes;
};

/** One run's text, with what goes after its lines. Pure: LogView draws the parts in the log's order, so every match of
 *  Find is numbered as it is shown.
 *  @param item - the text item, replaced by a new object whenever its text changes (the caches key on it).
 */
export function runParts(item: TextItem, input: RunPartsInput): RunPart[] {
  const { head, phone, graphs, mac, sentCode } = input;
  const lines = linesOf(item);
  const after = new Map<number, RunPart[]>();
  const addAfter = (at: number, part: RunPart) => after.set(at, [...(after.get(at) ?? []), part]);
  const lastLine = lines.length - (lines.at(-1)?.text === "" ? 2 : 1); // the last line with text

  // the code it sent: kept by the editor (codeOf); a command's is its one echo
  const code = head ? sentCode(head) : lines.find((l) => l.kind === "echo")?.text.replace(/^\. ?/, "");
  const echoes = code === undefined ? new Map<number, number>() : echoesOf(item, lines, code);
  for (const g of graphs.filter((x) => x.from === "run" && x.run === item.run)) {
    const at = g.line != null ? echoes.get(g.line) : undefined;
    addAfter(at === undefined ? lastLine : commandEnd(lines, at), { t: "graph", key: `g${g.n}`, graph: g });
  }
  // one note per `do` line of the code, after its echo: a loop's body is echoed once however many passes run the file
  if (item.unsaved?.length)
    for (const at of echoes.values()) {
      const command = echoed(lines[at]); // the echo in any of its forms: `. do x`, a loop's or program's `  2. do x`
      const target = command === null ? null : nestedTarget(command);
      const file = target ? unsavedTarget(target, item.unsaved) : null;
      if (!file) continue;
      const name = file.slice(file.lastIndexOf("/") + 1);
      const saveWords = phone ? "the file name's menu › Save" : `${mac ? "⌘" : "Ctrl"} S`;
      addAfter(commandEnd(lines, at), {
        t: "unsaved",
        key: `u${at}`,
        text: `Note: ${name} has unsaved edits in the editor; do runs the saved file. Save it (${saveWords}) to run your edits.`,
      });
    }

  const end = item.end;
  const jumpTo = end ? jumpLine(end) : null;
  let rcAt = -1; // the r(N); the jump goes beside
  if (end && end.rc !== 1 && jumpTo !== null)
    for (let i = lines.length - 1; i >= 0; i--)
      if (lines[i].kind === "err" && /^r\(\d+\);$/.test(lines[i].text)) {
        rcAt = i;
        break;
      }

  const out: RunPart[] = [];
  let explain: ExplainPiece[] | null = null; // a phone's hint block in progress
  let widest = 0;
  lines.forEach((l, i) => {
    const isLast = i === lines.length - 1;
    if (isLast && l.text === "" && !after.has(i)) return; // the text's own last line break
    if (phone && l.kind === "hint") {
      explain ??= [];
      const text = l.text.replace(/^\s*(→ )?/, "");
      const before = !explain.length ? "" : /^(How to fix:|Learn more:)/.test(text) ? "br" : "space";
      explain.push({ before, text });
      if (lines[i + 1]?.kind !== "hint") {
        out.push({ t: "explain", key: `h${i}`, pieces: explain });
        explain = null;
      }
      return;
    }
    if (l.kind === "out") widest = Math.max(widest, l.text.length);
    out.push({ t: "line", key: i, kind: l.kind, text: l.text });
    if (i === rcAt) out.push({ t: "space", text: "  " }, { t: "jump", key: "jump", line: jumpTo!, path: end!.path });
    if (!isLast) out.push({ t: "space", text: "\n" });
    if (phone && widest > PHONE_COLUMNS && lines[i + 1]?.kind !== "out") {
      out.push({ t: "wide", key: `w${i}` });
      widest = 0;
    } else if (lines[i + 1]?.kind !== "out") widest = 0;
    const extra = after.get(i);
    if (extra) {
      if (isLast) out.push({ t: "space", text: "\n" });
      for (const part of extra) out.push(part, { t: "space", text: "\n" });
    }
  });

  if (end?.rc === 1)
    out.push({
      t: "stopped",
      key: "break",
      text:
        end.line !== null && end.kind !== "command"
          ? `Stopped by Break before line ${end.line}. The data is as the last complete command left it.`
          : "Stopped by Break. The data is as the last complete command left it.",
      jump: jumpTo !== null ? { line: jumpTo, path: end.path } : null,
    });
  else if (jumpTo !== null && rcAt < 0)
    out.push({ t: "jump", key: "jump", line: jumpTo, path: end!.path }, { t: "space", text: "\n" });
  // the note under the error the run ended with (runError: not one an earlier `capture noisily` caught)
  const note = end && end.rc > 1 ? noteFor(end.rc, runError(lines)) : null;
  if (note) out.push({ t: "endnote", key: "note", text: note });
  if (end?.skipped?.length) {
    const folder = end.skipped.length === 1 ? "Its" : "Their";
    out.push({
      t: "endnote",
      key: "skipped",
      text: `Not kept: ${end.skipped.join(", ")}. ${folder} folder was renamed or deleted during the run.`,
    });
  }
  if (end?.store_error)
    out.push({
      t: "endnote",
      key: "store",
      text: `The files this run wrote couldn't be kept in this browser: ${end.store_error}`,
    });
  return out;
}
