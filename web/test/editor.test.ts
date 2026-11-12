// The editor's and the log's logic with no DOM (step 4b; docs/design/SPEC.md, sections 3.3 to 3.6 and 4): the .log
// tokenizer (src/app/log/classify.ts), where a code line is echoed (log/align.ts: the graph links, the nested-do note),
// the pasted lines of the command line (log/paste.ts), the .csv columns (editor/csv.ts) and the words of the run-head,
// the status bar and the Break pill (editor/words.ts). The views are checked in the browser (e2e/editor.spec.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeSet, Text } from "@codemirror/state";
import { CSV_COLORS, csvFields } from "../src/app/editor/csv.ts";
import { lineDeleted, onLastRun, onRunStart } from "../src/app/editor/errormark.ts";
import {
  jumpLine,
  lastRunWords,
  linesWords,
  memoryWords,
  pillTime,
  runheadWords,
  seconds,
  ticking,
} from "../src/app/editor/words.ts";
import { commandEnd, echoLines, inBlocks, nestedTarget, unsavedTarget } from "../src/app/log/align.ts";
import { classify, hintParts, plainLog } from "../src/app/log/classify.ts";
import { matches } from "../src/app/log/find.ts";
import { inTurnWords, opensBlock, pastedLines, type RunOne, runInTurn } from "../src/app/log/paste.ts";
import type { LastRun, RunHead } from "../src/app/types.ts";

// a log as the engine writes it (the engine's own text: hints on, as browser.py runs it)
const LOG = `. clear

. set obs 3
number of observations (_N) was 0, now 3

. forvalues i=1/2 {
  2.   scatter y x
  3. }

. list x

     +---+
     | x |
     |---|
  1. | 1 |
     +---+

. scatter ///
>   y x

. use C:\\Users\\me\\cps.dta
(path C:\\Users\\me\\cps.dta is cps.dta in the working folder)

. summarize x if sex == 1
sex not found
  → "sex" is not a variable, scalar or other known name.
    A word without quotes inside an expression is read as a name.
    How to fix: if it is a text value, write "sex" with the quotes.
    Learn more: help summarize
r(111);
`;

const kinds = (text: string) => classify(text).map((l) => `${l.kind}:${l.text}`);

test("the .log tokenizer: echoes, a loop's body and continued lines are echoes; output is out; a list row is not an echo", () => {
  const k = kinds(LOG);
  for (const echo of [". clear", ". forvalues i=1/2 {", "  2.   scatter y x", "  3. }", ". scatter ///", ">   y x"])
    assert.ok(k.includes(`echo:${echo}`), echo);
  assert.ok(k.includes("out:number of observations (_N) was 0, now 3"));
  assert.ok(k.includes("out:  1. | 1 |"), "a list row after a rule is output, not an echo");
  assert.ok(k.includes("out:"), "an empty line is output");
});

test("the .log tokenizer: an error's message and r(N); are errors, the hint is a hint, the path shim's line a note", () => {
  const k = kinds(LOG);
  assert.ok(k.includes("err:sex not found"));
  assert.ok(k.includes("err:r(111);"));
  assert.ok(k.includes('hint:  → "sex" is not a variable, scalar or other known name.'));
  assert.ok(k.includes("hint:    Learn more: help summarize"));
  assert.ok(k.includes("note:(path C:\\Users\\me\\cps.dta is cps.dta in the working folder)"));
  // without a hint, the line right above r(N); is the message
  assert.deepEqual(kinds(". foo\ncommand foo is unrecognized\nr(199);"), [
    "echo:. foo",
    "err:command foo is unrecognized",
    "err:r(199);",
  ]);
  // Break: --Break-- and r(1); are errors, nothing above them is
  assert.deepEqual(kinds(". display 1\n1\n--Break--\nr(1);"), [
    "echo:. display 1",
    "out:1",
    "err:--Break--",
    "err:r(1);",
  ]);
  // an error in a nested do-file: "end of do-file" above the outer r(N); is not a message
  assert.deepEqual(kinds("end of do-file\nr(111);").slice(0, 1), ["out:end of do-file"]);
  // an echo right above r(N) is not a message either
  assert.deepEqual(kinds(". exit 498\nr(498);"), ["echo:. exit 498", "err:r(498);"]);
  // the lines join back to the text
  assert.equal(
    classify(LOG)
      .map((l) => l.text)
      .join("\n"),
    LOG,
  );
});

test("the .log tokenizer: a log file's head is muted", () => {
  const head = `${"-".repeat(50)}\n      name:  <unnamed>\n       log:  /work/out.log\n  log type:  text\n opened on:   9 Nov 2026\n\n. display 1`;
  const k = kinds(head);
  assert.equal(k[0].split(":")[0], "note");
  assert.ok(k.slice(1, 5).every((x) => x.startsWith("note:")));
  assert.equal(k.at(-1), "echo:. display 1");
  // after an echo the same lines are a run's output (the engine's own log of `log using` and a display), not muted
  const run = kinds(
    `. log using t.log, replace text\n${"-".repeat(79)}\n      name:  <unnamed>\n       log:  /work/t.log\n  log type:  text\n opened on:  11 Nov 2026, 17:23:25\n\n. display "name: Ann"\nname: Ann\n`,
  );
  assert.ok(run.includes("out:      name:  <unnamed>"));
  assert.ok(run.includes(`out:${"-".repeat(79)}`));
  assert.ok(run.includes("out:name: Ann"));
});

test("a hint line's bold words, and its help command as a link", () => {
  assert.deepEqual(hintParts("    Learn more: help summarize"), [
    { t: "text", text: "    " },
    { t: "bold", text: "Learn more:" },
    { t: "text", text: " " },
    { t: "help", text: "help summarize" },
  ]);
  assert.deepEqual(hintParts("    How to fix: write it"), [
    { t: "text", text: "    " },
    { t: "bold", text: "How to fix:" },
    { t: "text", text: " write it" },
  ]);
  assert.deepEqual(hintParts("    plain"), [{ t: "text", text: "    plain" }]);
});

test("Download log holds the runs' text only: no head, run-head or note", () => {
  const text = plainLog([
    { t: "head" },
    { t: "runhead" },
    { t: "text", text: ". display 1\n1\n" },
    { t: "note", text: "the engine was reset" },
    { t: "graph" },
    { t: "text", text: ". display 2\n2\n" },
  ]);
  assert.equal(text, ". display 1\n1\n. display 2\n2\n");
});

test("echoLines: each code line finds its echo; blank lines and block comments are passed over", () => {
  const code =
    "clear\n\n/* a\n   b */\nset obs 3\nforvalues i=1/2 {\n  scatter y x\n}\nscatter ///\n  y x\nscatter y x";
  const log = classify(
    ". clear\n\n. set obs 3\nnumber of observations (_N) was 0, now 3\n\n. forvalues i=1/2 {\n  2.   scatter y x\n  3. }\n\n. scatter ///\n>   y x\n\n. scatter y x\n",
  );
  const at = echoLines(log, code);
  const line = (n: number) => log[at.get(n)!]?.text;
  assert.equal(line(1), ". clear");
  assert.equal(at.has(2), false);
  assert.equal(line(5), ". set obs 3");
  assert.equal(line(7), "  2.   scatter y x");
  assert.equal(line(9), ". scatter ///");
  assert.equal(log[commandEnd(log, at.get(9)!)].text, ">   y x", "a link goes after the whole command");
  assert.equal(line(11), ". scatter y x");
  assert.equal(at.get(11)! > at.get(9)!, true, "the same text twice: each line its own echo");
});

test("echoLines: a nested do-file's echoes are passed over, even one with the text of a later line", () => {
  const code = "do sub.do\nscatter y x";
  const log = classify(". do sub.do\n\n. scatter y x\n\n. \nend of do-file\n\n. scatter y x\n");
  const at = echoLines(log, code);
  assert.equal(at.get(1), 0);
  assert.equal(at.get(2), 7, "the second `. scatter y x`, after end of do-file");
  // a do-file that holds another one
  const deep = classify(
    ". do a.do\n\n. do b.do\n\n. scatter y x\n\nend of do-file\n\n. scatter y x\n\nend of do-file\n\n. scatter y x\n",
  );
  const deepCode = "do a.do\nscatter y x";
  assert.equal(echoLines(deep, deepCode).get(2), deep.length - 2);
});

// The engine's own logs (run through dofile's engine, hints on), for the walk's harder cases. ok.do holds `display 1`
// and `display 2`; s2.do holds `display 7`.
const LOOP_DO = `. forvalues i = 1/2 {
  2.   do ok.do
  3. }

. display 1
1

. display 2
2

.
end of do-file

. display 1
1

. display 2
2

.
end of do-file

. display "after"
after

. scatter x x

`;
const IF_DO = `. if 0 {
.   do ok.do
. }

. display "z"
z

. scatter x x

`;
const MATA = `. clear

. mata:
------------------------------------------------- mata (type end to exit) ------
: x = 1

: x
  1

: end
--------------------------------------------------------------------------------

. display "after"
after

. #delimit ;
delimiter now ;
. display
>   "semi" ;
semi

. #delimit cr
delimiter now cr
. display "z"
z

`;
const CAPTURE_DO = `. capture noisily do s2.do

. display 7
7

.
end of do-file

. display 7
7

. quietly do s2.do

. display 8
8

`;

test("echoLines: a do-file run from a block opens nothing, and the walk stays in step after it", () => {
  // a loop that runs a do-file: its echoes come after the loop's, twice; the lines after the loop are still found
  let log = classify(LOOP_DO);
  let at = echoLines(log, 'forvalues i = 1/2 {\n  do ok.do\n}\ndisplay "after"\nscatter x x');
  assert.equal(log[at.get(3)!]?.text, "  3. }");
  assert.equal(log[at.get(4)!]?.text, '. display "after"');
  assert.equal(log[at.get(5)!]?.text, ". scatter x x");
  // a do-file in a block that does not run: echoed, and no `end of do-file` ever comes
  log = classify(IF_DO);
  at = echoLines(log, 'if 0 {\n  do ok.do\n}\ndisplay "z"\nscatter x x');
  assert.equal(log[at.get(4)!]?.text, '. display "z"');
  assert.equal(log[at.get(5)!]?.text, ". scatter x x");
  // a do in a program's body is a block too
  assert.deepEqual(inBlocks(["program define p", "  do ok.do", "end", "p", "forvalues i=1/2 {", "  x", "}", "y"]), [
    false,
    true,
    true,
    false,
    false,
    true,
    true,
    false,
  ]);
  // braces in strings and comments are not counted
  assert.deepEqual(inBlocks(['display "{"', "// {", "x /* { */", "y"]), [false, false, false, false]);
});

test("echoLines: after lines echoed in another form (a mata block) the walk finds the next line further down", () => {
  const log = classify(MATA);
  const at = echoLines(
    log,
    'clear\nmata:\nx = 1\nx\nend\ndisplay "after"\n#delimit ;\ndisplay\n  "semi" ;\n#delimit cr\ndisplay "z"',
  );
  assert.equal(log[at.get(6)!]?.text, '. display "after"');
  assert.equal(log[at.get(8)!]?.text, ". display");
  assert.equal(log[at.get(11)!]?.text, '. display "z"');
});

test("echoLines: capture noisily do shows its file's echoes, which are passed over; quietly do shows none", () => {
  const log = classify(CAPTURE_DO);
  const at = echoLines(log, "capture noisily do s2.do\ndisplay 7\nquietly do s2.do\ndisplay 8");
  assert.equal(at.get(2), 8, "the main file's `. display 7`, not the nested one at 2");
  assert.equal(log[at.get(4)!]?.text, ". display 8");
});

test("nestedTarget and unsavedTarget: the file a do or include runs, and the open file with unsaved edits it is", () => {
  assert.equal(nestedTarget("capture noisily do clean.do"), "clean.do");
  assert.equal(nestedTarget("qui: do clean"), "clean.do");
  assert.equal(nestedTarget("do clean.do"), "clean.do");
  assert.equal(nestedTarget("do clean"), "clean.do");
  assert.equal(nestedTarget('do "my files/clean.do"'), "my files/clean.do");
  assert.equal(nestedTarget('do `"a "b".do"\''), 'a "b".do');
  assert.equal(nestedTarget("include ./code/x.do // the setup"), "code/x.do");
  assert.equal(nestedTarget("do C:\\proj\\clean.do"), "C:/proj/clean.do");
  assert.equal(nestedTarget("doedit x.do"), null);
  assert.equal(nestedTarget("display 1"), null);
  assert.equal(unsavedTarget("clean.do", ["clean.do", "x.do"]), "clean.do");
  assert.equal(unsavedTarget("C:/proj/clean.do", ["code/clean.do"]), "code/clean.do");
  assert.equal(unsavedTarget("clean.do", ["a/clean.do", "b/clean.do"]), null, "two files of that name: neither");
  assert.equal(unsavedTarget("clean.do", []), null);
});

test("a paste with no line break is an ordinary paste; with breaks, each non-empty line, joined to the field's text", () => {
  assert.equal(pastedLines("", "summarize x", ""), null);
  assert.deepEqual(pastedLines("", "a\nb\n", ""), ["a", "b"]);
  assert.deepEqual(pastedLines("", "a\r\n\r\n  \rb", ""), ["a", "b"]);
  assert.deepEqual(pastedLines("sum", "marize x\ndisplay 1", " // end"), ["summarize x", "display 1 // end"]);
  assert.equal(pastedLines("", "\n\n", ""), null); // only trailing breaks: an ordinary paste
  assert.equal(pastedLines("", "summarize x\n", ""), null); // one copied line with its line break
  assert.equal(pastedLines("", "summarize x\r\n\r\n", ""), null);
  assert.deepEqual(pastedLines("", "\nsummarize x", ""), ["summarize x"]); // a break before it still counts
});

/** A runner that answers from a script: per line, accepted or not, and the rc (null: queued and not run). */
function script(answers: Record<string, { accepted?: boolean; rc?: number | null }>) {
  const ran: string[] = [];
  const runOne: RunOne = (line) => {
    const a = answers[line] ?? {};
    if (a.accepted === false) return { accepted: false, done: Promise.resolve(null) };
    ran.push(line);
    return { accepted: true, done: Promise.resolve(a.rc === undefined ? 0 : a.rc) };
  };
  return { ran, runOne };
}

test("pasted lines run in turn and stop at the first refused, not run, or failed one", async () => {
  let s = script({});
  assert.deepEqual(await runInTurn(["a", "b", "c"], s.runOne), { total: 3, ran: 3, stop: null });
  assert.deepEqual(s.ran, ["a", "b", "c"]);

  s = script({ b: { rc: 111 } });
  const failed = await runInTurn(["a", "b", "c", "d"], s.runOne);
  assert.deepEqual(failed, { total: 4, ran: 2, stop: { line: 2, why: "error", rc: 111 } });
  assert.deepEqual(s.ran, ["a", "b"]);
  assert.equal(inTurnWords(failed), "2 of 4 pasted lines not run: line 2 ended with r(111)");

  s = script({ a: { rc: 1 } }); // Break
  assert.deepEqual((await runInTurn(["a", "b"], s.runOne)).stop, { line: 1, why: "error", rc: 1 });

  s = script({ b: { accepted: false } });
  const refused = await runInTurn(["a", "b", "c"], s.runOne);
  assert.deepEqual(refused, { total: 3, ran: 1, stop: { line: 2, why: "refused" } });
  assert.equal(inTurnWords(refused), "2 of 3 pasted lines not run: the engine can't take a command now");

  s = script({ a: { rc: null } }); // queued, then the prompt was answered "Not now"
  const dropped = await runInTurn(["a", "b"], s.runOne);
  assert.deepEqual(dropped, { total: 2, ran: 0, stop: { line: 1, why: "not-run" } });
  assert.equal(inTurnWords(dropped), "2 of 2 pasted lines not run: line 1 didn't run");

  // the last line fails: nothing is left, so no toast
  s = script({ b: { rc: 111 } });
  assert.equal(inTurnWords(await runInTurn(["a", "b"], s.runOne)), null);
});

test("pasted lines stop before a block's line or a /// line, which is not sent, and the toast says to use the editor", async () => {
  assert.equal(opensBlock("forvalues i = 1/3 {"), true);
  assert.equal(opensBlock("if x > 1 {  "), true);
  assert.equal(opensBlock("regress y x /// controls"), true);
  assert.equal(opensBlock("display ${x}"), false);
  assert.equal(opensBlock("}"), false);
  const s = script({});
  const r = await runInTurn(["clear", "forvalues i = 1/3 {", "display `i'", "}"], s.runOne);
  assert.deepEqual(r, { total: 4, ran: 1, stop: { line: 2, why: "block" } });
  assert.deepEqual(s.ran, ["clear"]);
  assert.equal(
    inTurnWords(r),
    "3 of 4 pasted lines not run: line 2 starts a block or a /// command; run those from the editor",
  );
  // the block's line is the last one: still said, since it did not run
  assert.equal(
    inTurnWords(await runInTurn(["regress y x ///"], script({}).runOne)),
    "1 of 1 pasted lines not run: line 1 starts a block or a /// command; run those from the editor",
  );
});

test("Find's matches: every occurrence, case ignored, none for an empty query", () => {
  assert.deepEqual(matches("Regress y x; regress", "regress"), [
    [0, 7],
    [13, 20],
  ]);
  assert.deepEqual(matches("aaa", "aa"), [[0, 2]], "matches do not overlap");
  assert.deepEqual(matches("abc", ""), []);
  assert.deepEqual(matches("abc", "x"), []);
});

test("pasted lines: the next starts only once the one before has ended", async () => {
  const order: string[] = [];
  let finish!: (rc: number) => void;
  const runOne: RunOne = (line) => {
    order.push(`start ${line}`);
    return {
      accepted: true,
      done: new Promise<number>((ok) => {
        finish = (rc) => {
          order.push(`end ${line}`);
          ok(rc);
        };
      }),
    };
  };
  const all = runInTurn(["a", "b"], runOne);
  await Promise.resolve();
  assert.deepEqual(order, ["start a"]);
  finish(0);
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(order, ["start a", "end a", "start b"]);
  finish(0);
  assert.equal((await all).ran, 2);
});

test("csvFields: commas (or tabs) outside quotes split the columns", () => {
  const cut = (line: string, sep: "," | "\t" = ",") => csvFields(line, sep).map((f) => line.slice(f.from, f.to));
  assert.deepEqual(cut('1003,"North, coast",41,,24.80'), ["1003", '"North, coast"', "41", "", "24.80"]);
  assert.deepEqual(cut('a,"say ""hi"", ok",b'), ["a", '"say ""hi"", ok"', "b"]);
  assert.deepEqual(cut("a\tb,c\td", "\t"), ["a", "b,c", "d"]);
  assert.deepEqual(cut(""), [""]);
  assert.deepEqual(
    csvFields("a,b", ",").map((f) => f.col),
    [0, 1],
  );
  assert.equal(CSV_COLORS, 5);
});

test("the words: run-heads, lines, times, the last run, memory", () => {
  assert.deepEqual(runheadWords({ kind: "file", path: "master.do", fresh_locals: true }, false, false), [
    "Run",
    ": master.do, whole file · starts with no locals",
  ]);
  const sel: RunHead = { kind: "selection", path: "analysis.do", lines: [14, 15], fresh_locals: false };
  assert.deepEqual(runheadWords(sel, true, false), [
    "Run selection",
    ": lines 14–15 of analysis.do · keeps the locals of earlier runs (first run: none yet)",
  ]);
  assert.deepEqual(runheadWords(sel, false, true), [
    "Run selection",
    ": lines 14–15 · keeps the locals of earlier runs",
  ]);
  assert.equal(linesWords([6, 6]), "line 6");
  assert.equal(seconds(0.38), "0.38 s");
  assert.equal(seconds(18.44), "18.4 s");
  assert.equal(seconds(125), "2 min 5 s");
  assert.equal(ticking(3.42), "3.4 s");
  assert.equal(ticking(12.9), "12 s");
  assert.equal(pillTime(3.42), "3.4 s");
  assert.equal(pillTime(42), "42 s");
  assert.equal(pillTime(725), "12 min");
  const run = (o: Partial<LastRun>): LastRun => ({
    kind: "file",
    path: "analysis.do",
    fresh_locals: true,
    rc: 0,
    line: null,
    seconds: 0.38,
    ...o,
  });
  assert.deepEqual(lastRunWords(run({ rc: 111, line: 17 })), {
    what: "whole file (started with no locals)",
    rc: "r(111)",
    where: "at line 17",
    time: "0.38 s",
  });
  assert.deepEqual(lastRunWords(run({ rc: 1, line: 3, seconds: 18.4 })), {
    what: "stopped by Break",
    rc: "r(1)",
    where: null,
    time: "18.4 s",
  });
  assert.equal(lastRunWords(run({ kind: "selection", lines: [6, 7], fresh_locals: false })).what, "lines 6–7");
  assert.equal(lastRunWords(run({ kind: "command", path: undefined, rc: 111, line: 1 })).where, null);
  assert.equal(jumpLine(run({ rc: 111, line: 17 })), 17);
  assert.equal(jumpLine(run({ rc: 1, line: 3 })), 3, "Break: the line it stopped before");
  assert.equal(jumpLine(run({ rc: 0 })), null);
  assert.equal(jumpLine(run({ kind: "command", path: undefined, rc: 111, line: 1 })), null);
  assert.equal(memoryWords({ heap_bytes: 612e6, data_bytes: 0 }), "Memory 612 MB");
  assert.equal(memoryWords({ heap_bytes: 1612e6, data_bytes: 0 }, true), "Mem 1,612 MB");
});

test("the error mark's rule (editor/errormark.ts): the file's last run sets it, a new run of that file, a reset or the line's deletion clears it; a command or another file leaves it", () => {
  const file = (path: string, rc: number, line: number | null, kind: "file" | "selection" = "file"): LastRun => ({
    kind,
    path,
    fresh_locals: kind === "file",
    rc,
    line,
    seconds: 1,
  });
  assert.deepEqual(onLastRun(file("a.do", 111, 3)), { clear: "a.do", set: { path: "a.do", line: 3 } });
  assert.deepEqual(onLastRun(file("a.do", 111, 7, "selection")), { clear: "a.do", set: { path: "a.do", line: 7 } });
  assert.deepEqual(onLastRun(file("a.do", 0, null)), { clear: "a.do", set: null });
  assert.deepEqual(onLastRun(file("a.do", 1, 4)), { clear: "a.do", set: null }, "Break marks no error");
  assert.deepEqual(onLastRun(null), { clear: "all", set: null }, "the engine is gone: a reset or a restart");
  const command: LastRun = { kind: "command", fresh_locals: false, rc: 111, line: 1, seconds: 1 };
  assert.deepEqual(onLastRun(command), { clear: null, set: null }, "a command leaves every mark");
  assert.deepEqual(onRunStart({ kind: "file", path: "b.do", fresh_locals: true }), { clear: "b.do", set: null });
  assert.deepEqual(onRunStart({ kind: "command", fresh_locals: false }), { clear: null, set: null });

  const doc = Text.of(["one", "two", "", "four"]);
  const at = (n: number) => doc.line(n).from;
  const del = (from: number, to: number) => ChangeSet.of({ from, to }, doc.length);
  assert.equal(lineDeleted(del(doc.line(2).from, doc.line(2).to + 1), doc, at(2)), true, "the line and its break");
  assert.equal(lineDeleted(del(doc.line(1).to, doc.line(2).to), doc, at(2)), true, "the break before and the line");
  assert.equal(lineDeleted(del(doc.line(2).from, doc.line(2).from + 1), doc, at(2)), false, "one character of it");
  assert.equal(lineDeleted(del(doc.line(1).from, doc.line(1).to + 1), doc, at(2)), false, "the line above");
  assert.equal(lineDeleted(del(doc.line(3).from, doc.line(3).from + 1), doc, at(3)), true, "an empty line's break");
  assert.equal(lineDeleted(ChangeSet.of({ from: at(2), insert: "x" }, doc.length), doc, at(2)), false, "typing");
});
