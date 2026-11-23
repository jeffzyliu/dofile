// What the log draws after a run's lines (log/run-parts.ts): graph links, the unsaved-do note, a phone's hint block and
// wide-table hint, Go to line, the end notes. No DOM: the view that draws the parts is LogParts.tsx.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunPart, RunPartsInput, TextItem } from "../src/app/log/run-parts.ts";
import { runParts } from "../src/app/log/run-parts.ts";
import type { Graph, LastRun } from "../src/app/types.ts";

const desktop: RunPartsInput = { head: null, phone: false, graphs: [], mac: false, sentCode: () => undefined };
const phone: RunPartsInput = { ...desktop, phone: true };

const text = (t: string, more: Partial<TextItem> = {}): TextItem => ({ t: "text", text: t, run: 1, ...more });
const graph = (n: number, line: number): Graph => ({ n, from: "run", run: 1, line, png: "", theme: "light" }) as Graph;
const ended = (rc: number, more: Partial<LastRun> = {}): LastRun =>
  ({ kind: "file", path: "a.do", rc, line: 3, seconds: 1, ...more }) as LastRun;

/** The parts in a form a test can read: `kind:text` for a line, the line break as \n, the rest by their tag. */
const shapeOf = (p: RunPart): string => {
  switch (p.t) {
    case "line":
      return `${p.kind}:${p.text}`;
    case "space":
      return p.text === "\n" ? "\\n" : `space(${p.text.length})`;
    case "graph":
      return `graph ${p.graph.n}`;
    case "unsaved":
    case "endnote":
      return `${p.t}:${p.text}`;
    case "jump":
      return `jump ${p.line}`;
    case "wide":
      return "wide";
    case "explain":
      return `explain:${p.pieces.map((x) => `${x.before}|${x.text}`).join("/")}`;
    case "stopped":
      return `stopped:${p.text}${p.jump ? ` jump ${p.jump.line}` : ""}`;
  }
};
const shape = (parts: RunPart[]) => parts.map(shapeOf);

test("a run's lines are parts in order, each followed by its line break; the text's own last break draws nothing", () => {
  assert.deepEqual(shape(runParts(text(". display 1\n1\n"), desktop)), ["echo:. display 1", "\\n", "out:1", "\\n"]);
  assert.deepEqual(shape(runParts(text("1"), desktop)), ["out:1"]);
});

test("a graph's link goes after the end of its command's echo, or after the last line with text", () => {
  const log = text(". scatter x y\n. display 1\n1\n");
  const placed = (line: number | undefined) =>
    shape(runParts(log, { ...desktop, graphs: [{ ...graph(1, line ?? 0), line } as Graph] }));
  // the code's line 1 is the first command: no sent code for a run-head, so the one echo of a command run is its code
  assert.deepEqual(placed(undefined), [
    "echo:. scatter x y",
    "\\n",
    "echo:. display 1",
    "\\n",
    "out:1",
    "\\n",
    "graph 1",
    "\\n",
  ]);
  const withCode: RunPartsInput = {
    ...desktop,
    head: { kind: "file" } as never,
    sentCode: () => "scatter x y\ndisplay 1",
  };
  const second = shape(runParts(log, { ...withCode, graphs: [graph(1, 2)] }));
  assert.deepEqual(second.slice(0, 5), ["echo:. scatter x y", "\\n", "echo:. display 1", "\\n", "graph 1"]);
  const other = { ...graph(2, 1), run: 2 } as Graph;
  assert.deepEqual(
    shape(runParts(log, { ...withCode, graphs: [other] })).filter((x) => x.startsWith("graph")),
    [],
  );
});

test("an unsaved do-file gets one note after the echo of the do that runs it, in the words of the layout", () => {
  const log = text(". do clean.do\nend of do-file\n", { unsaved: ["code/clean.do"] });
  const note = (input: RunPartsInput) => shape(runParts(log, input)).filter((x) => x.startsWith("unsaved"));
  assert.deepEqual(note(desktop), [
    "unsaved:Note: clean.do has unsaved edits in the editor; do runs the saved file. Save it (Ctrl S) to run your edits.",
  ]);
  assert.match(note({ ...desktop, mac: true })[0], /\(⌘ S\)/);
  assert.match(note(phone)[0], /\(the file name's menu › Save\)/);
  assert.deepEqual(
    shape(runParts(text(". do clean.do\n", { unsaved: ["other.do"] }), desktop)).filter((x) => x.startsWith("unsaved")),
    [],
  );
});

const HINTED =
  ". foo\ncommand foo is unrecognized\n  → It is not a command.\n    How to fix: check the spelling.\n    Learn more: help foo\nr(199);\n";

test("on a phone the hint lines are one block, a line break before How to fix and Learn more; on a desktop each is a line", () => {
  const onDesktop = shape(runParts(text(HINTED), desktop));
  assert.equal(onDesktop.filter((x) => x.startsWith("hint:")).length, 3);
  const onPhone = shape(runParts(text(HINTED), phone));
  assert.equal(onPhone.filter((x) => x.startsWith("hint:")).length, 0);
  assert.deepEqual(
    onPhone.filter((x) => x.startsWith("explain")),
    ["explain:|It is not a command./br|How to fix: check the spelling./br|Learn more: help foo"],
  );
});

test("on a phone a hint's continuation line follows its first with a space, not a line break", () => {
  const log = text(". foo\ncommand foo is unrecognized\n  → It is not\n    a command.\nr(199);\n");
  assert.deepEqual(
    shape(runParts(log, phone)).filter((x) => x.startsWith("explain")),
    ["explain:|It is not/space|a command."],
  );
});

test("a graph's link after a last line with no line break of its own starts a line of its own", () => {
  const streaming = text(". scatter x y\n1");
  const parts = shape(runParts(streaming, { ...desktop, graphs: [{ ...graph(1, 1), line: undefined } as Graph] }));
  assert.deepEqual(parts, ["echo:. scatter x y", "\\n", "out:1", "\\n", "graph 1", "\\n"]);
});

test("a phone says a wide block of output scrolls sideways, once, after its last line", () => {
  const wide = "x".repeat(49);
  const log = text(`. list\n${wide}\n${wide}\n. display 1\n1\n`);
  assert.deepEqual(
    shape(runParts(log, phone)).filter((x) => x === "wide"),
    ["wide"],
  );
  assert.deepEqual(
    shape(runParts(log, desktop)).filter((x) => x === "wide"),
    [],
  );
  assert.deepEqual(
    shape(runParts(text(`. list\n${"x".repeat(48)}\n`), phone)).filter((x) => x === "wide"),
    [],
  );
});

test("a failed run's Go to line goes beside its r(N); with no r(N) line it goes after the text", () => {
  const log = text(". foo\ncommand foo is unrecognized\nr(199);\n", { end: ended(199) });
  const parts = shape(runParts(log, desktop));
  assert.deepEqual(parts.slice(-4), ["err:r(199);", "space(2)", "jump 3", "\\n"]);
  const bare = shape(runParts(text("hello\n", { end: ended(1 + 1) }), desktop));
  assert.deepEqual(bare.slice(-2), ["jump 3", "\\n"]);
  assert.equal(
    shape(runParts(text("hello\n", { end: ended(0) }), desktop)).some((x) => x.startsWith("jump")),
    false,
  );
});

test("the end notes: Break, the note under an error, files not kept, files the browser could not keep", () => {
  const broke = shape(runParts(text(". sleep\n--Break--\nr(1);\n", { end: ended(1) }), desktop));
  assert.equal(
    broke.at(-1),
    "stopped:Stopped by Break before line 3. The data is as the last complete command left it. jump 3",
  );
  const command = shape(runParts(text("--Break--\n", { end: ended(1, { kind: "command", line: null }) }), desktop));
  assert.equal(command.at(-1), "stopped:Stopped by Break. The data is as the last complete command left it.");

  const community = text(". esttab\ncommand esttab is unrecognized\nr(199);\n", {
    end: ended(199, { kind: "command" }),
  });
  assert.match(shape(runParts(community, desktop)).at(-1) ?? "", /^endnote:esttab is a community command/);

  const lost = shape(runParts(text("ok\n", { end: ended(0, { skipped: ["a.dta"], store_error: "full" }) }), desktop));
  assert.deepEqual(lost.slice(-2), [
    "endnote:Not kept: a.dta. Its folder was renamed or deleted during the run.",
    "endnote:The files this run wrote couldn't be kept in this browser: full",
  ]);
  const two = shape(runParts(text("ok\n", { end: ended(0, { skipped: ["a", "b"] }) }), desktop));
  assert.match(two.at(-1) ?? "", /^endnote:Not kept: a, b\. Their folder/);
});
