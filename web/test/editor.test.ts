// The editor's and the log's logic with no DOM (step 4b; docs/design/SPEC.md, sections 3.3 to 3.6 and 4): the .log
// tokenizer (src/app/log/classify.ts), where a code line is echoed (log/align.ts: the graph links, the nested-do note),
// the pasted lines of the command line (log/paste.ts), the .csv columns (editor/csv.ts), what a run's version of an open
// file does to its tab (editor/ranover.ts) and the words of the run-head, the status bar and the Break pill
// (editor/words.ts). The views are checked in the browser (e2e/editor.spec.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeSet, Text } from "@codemirror/state";
import { CSV_COLORS, csvFields } from "../src/app/editor/csv.ts";
import { lineDeleted, onLastRun, onRunStart } from "../src/app/editor/errormark.ts";
import { isSaveKey } from "../src/app/editor/keys.ts";
import {
  dropsBom,
  editorText,
  fileText,
  followRun,
  formOf,
  lineBreakOf,
  PLAIN,
  savedForm,
} from "../src/app/editor/ranover.ts";
import {
  jumpLine,
  lastRunWords,
  linesWords,
  memoryWords,
  pillTime,
  refusedRunWords,
  runheadWords,
  seconds,
  ticking,
} from "../src/app/editor/words.ts";
import { commandEnd, echoed, echoLines, inBlocks, nestedTarget, unsavedTarget } from "../src/app/log/align.ts";
import { classify, hintParts, plainLog, runError } from "../src/app/log/classify.ts";
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

// More of the engine's own logs (run through dofile's engine). sub.do holds `display 1`; outer.do holds `forvalues i =
// 1/2 {`, `do sub.do`, `}` and `display 1`. Where the walk cannot know which echo is a line's, it finds none (the link
// goes to the run's end): wrong is worse than late.
const nestedLog = (...lines: string[]) => `${lines.join("\n")}\n`;
const SUB = [". display 1", "1", "", ". ", "end of do-file", ""];

test("echoLines: a do-file run from a loop, then a line its file holds too: the main file's echo, after the loop's runs", () => {
  const log = classify(
    nestedLog(
      ". forvalues i = 1/2 {",
      "  2.   do sub.do",
      "  3. }",
      "",
      ...SUB,
      ...SUB,
      ". display 1",
      "1",
      "",
      ". display 2",
      "2",
      "",
    ),
  );
  const at = echoLines(log, "forvalues i = 1/2 {\n  do sub.do\n}\ndisplay 1\ndisplay 2");
  assert.equal(log[at.get(3)!]?.text, "  3. }");
  assert.equal(at.get(4), 16, "not 4 or 10, the echoes of sub.do's own `display 1`");
  assert.equal(at.get(5), 19);
});

test("echoLines: a do-file run from a program: a later line its file holds is not taken for the program's echo", () => {
  const log = classify(
    nestedLog(
      ". program define zp",
      "  1.   do sub.do",
      "  2. end",
      "",
      ". zp",
      "",
      ...SUB,
      ". display 1",
      "1",
      "",
      ". display 2",
      "2",
      "",
    ),
  );
  const at = echoLines(log, "program define zp\n  do sub.do\nend\nzp\ndisplay 1\ndisplay 2");
  assert.equal(at.get(5), 12, "not 6, sub.do's `display 1`");
  assert.equal(at.get(6), 15);
  assert.ok([undefined, 4].includes(at.get(4)), "`zp` may not be known (sub.do's echoes follow it), never wrong");
  // a program that runs a do-file, defined and not called, then a do at the top: that do still opens its file
  const top = classify(
    nestedLog(
      ". program define zp",
      "  1.   do sub.do",
      "  2. end",
      "",
      ". do sub.do",
      "",
      ...SUB,
      ". display 1",
      "1",
      "",
    ),
  );
  const t = echoLines(top, "program define zp\n  do sub.do\nend\ndo sub.do\ndisplay 1");
  assert.equal(t.get(4), 4);
  assert.equal(t.get(5), 12);
});

test("echoLines: a do-file that runs a do-file from a loop is passed over whole", () => {
  const log = classify(
    nestedLog(
      ". do outer.do",
      "",
      ". forvalues i = 1/2 {",
      "  2.   do sub.do",
      "  3. }",
      "",
      ...SUB,
      ...SUB,
      ". display 1",
      "1",
      "",
      ". ",
      "end of do-file",
      "",
      ". display 1",
      "1",
      "",
      ". display 2",
      "2",
      "",
    ),
  );
  const at = echoLines(log, "do outer.do\ndisplay 1\ndisplay 2");
  assert.equal(at.get(2), 24, "not 18, outer.do's own `display 1`");
  assert.equal(at.get(3), 27);
});

test("echoLines: `n` is noisily too (cap n do shows its file's echoes); include and noi do", () => {
  let log = classify(nestedLog(". cap n do sub.do", "", ...SUB, ". display 1", "1", "", ". display 2", "2", ""));
  let at = echoLines(log, "cap n do sub.do\ndisplay 1\ndisplay 2");
  assert.equal(at.get(2), 8);
  assert.equal(at.get(3), 11);
  assert.equal(nestedTarget("cap n: do clean"), "clean.do");
  log = classify(
    nestedLog(
      ". include sub.do",
      "",
      ...SUB,
      ". display 2",
      "2",
      "",
      ". noi do sub.do",
      "",
      ...SUB,
      ". display 2",
      "2",
      "",
    ),
  );
  at = echoLines(log, "include sub.do\ndisplay 2\nnoi do sub.do\ndisplay 2");
  assert.deepEqual([...at.values()], [0, 8, 11, 19]);
});

test("echoLines: a quietly or capture block echoes nothing inside; a line there is not taken for a later line's echo", () => {
  const log = classify(nestedLog(". display 5", "5", "", ". quietly {", "", ". display 5", "5", ""));
  const at = echoLines(log, "display 5\nquietly {\ndisplay 5\n}\ndisplay 5");
  assert.equal(at.has(3), false);
  assert.equal(at.get(5), 5);
  // capture { } too; noisily { } and if { } echo their lines
  const both = classify(
    nestedLog(
      ". capture {",
      "",
      ". noisily {",
      ". display 6",
      "6",
      ". }",
      "",
      ". if 1 {",
      ". display 7",
      "7",
      ". }",
      "",
      ". display 5",
      "5",
      "",
      ". display 6",
      "6",
      "",
      ". display 7",
      "7",
      "",
    ),
  );
  const b = echoLines(
    both,
    "capture {\ndisplay 5\n}\nnoisily {\ndisplay 6\n}\nif 1 {\ndisplay 7\n}\ndisplay 5\ndisplay 6\ndisplay 7",
  );
  assert.equal(b.has(2), false);
  assert.equal(b.get(5), 3);
  assert.equal(b.get(8), 8);
  assert.deepEqual([b.get(10), b.get(11), b.get(12)], [12, 15, 18]);
  // in a loop or a program the block's lines are echoed as they are read; in an `if` block they are not
  const read = classify(
    nestedLog(
      ". forvalues i = 1/1 {",
      "  2. quietly {",
      "  3. display 5",
      "  4. }",
      "  5. }",
      "",
      ". program define zq2",
      "  1. quietly {",
      "  2. display 6",
      "  3. }",
      "  4. end",
      "",
      ". if 1 {",
      ". quietly {",
      ". }",
      "",
      ". display 8",
      "8",
      "",
    ),
  );
  const r = echoLines(
    read,
    "forvalues i = 1/1 {\nquietly {\ndisplay 5\n}\n}\nprogram define zq2\nquietly {\ndisplay 6\n}\nend\nif 1 {\nquietly {\ndisplay 7\n}\n}\ndisplay 8",
  );
  assert.deepEqual([r.get(3), r.get(8), r.has(13), r.has(14), r.get(15), r.get(16)], [2, 8, false, false, 14, 16]);
});

test("echoLines: a line in a /* */ comment is not taken for the echo of the same line after it; a comment's continued line is", () => {
  const log = classify(nestedLog(". display 1", "1", "", ". display 2 /* start", "> more */", "2", ""));
  const at = echoLines(log, "/* a block\ndisplay 1\n*/\ndisplay 1\ndisplay 2 /* start\nmore */");
  assert.equal(at.has(2), false);
  assert.equal(at.get(4), 0);
  assert.equal(at.get(5), 3);
  assert.equal(at.get(6), 4, "the comment's line echoed as a continued line");
});

test("inBlocks: a local or global's braces open no block", () => {
  assert.deepEqual(inBlocks(["local open {", "do sub.do", "global close }", "x"]), [false, false, false, false]);
  assert.deepEqual(inBlocks(["forvalues i = 1/2 {", "  local b }", "  x", "}", "y"]), [false, true, true, true, false]);
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
  // the log's echo of a nested do in each of its forms, as LogView reads it for S 15's note: a top-level `. `, a loop's
  // or a program's body line `  2. `
  const target = (log: string) =>
    classify(log).map((l) => {
      const x = echoed(l);
      return x === null ? null : nestedTarget(x);
    });
  assert.deepEqual(target(". do a.do\n. forvalues i = 1/2 {\n  2.     do b\n  3. }\n"), [
    "a.do",
    null,
    "b.do",
    null,
    null,
  ]);
  assert.deepEqual(target(". program define p\n  1.     capture noisily do c.do\n  2. end\n"), [
    null,
    "c.do",
    null,
    null,
  ]);
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

/** A runner that answers from a script: per line, how it was taken (started unless named) and the rc. */
function script(answers: Record<string, { how?: "asked" | "refused"; rc?: number | "taken" }>) {
  const ran: string[] = [];
  const runOne: RunOne = (line) => {
    const a = answers[line] ?? {};
    if (a.how) return { how: a.how };
    ran.push(line);
    return { how: "started", done: Promise.resolve(a.rc === undefined ? 0 : a.rc) };
  };
  return { ran, runOne };
}

test("pasted lines run in turn and stop at the first refused, asked (no engine), or failed one", async () => {
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

  s = script({ b: { how: "refused" } });
  const refused = await runInTurn(["a", "b", "c"], s.runOne);
  assert.deepEqual(refused, { total: 3, ran: 1, stop: { line: 2, why: "refused" } });
  assert.equal(inTurnWords(refused), "2 of 3 pasted lines not run: the engine can't take a command now");

  s = script({ a: { how: "asked" } }); // no engine: the line opened the download prompt, and nothing runs
  const asked = await runInTurn(["a", "b"], s.runOne);
  assert.deepEqual(asked, { total: 2, ran: 0, stop: { line: 1, why: "asked" } });
  assert.deepEqual(s.ran, []);
  assert.equal(inTurnWords(asked), null, "no toast over the download prompt");

  s = script({ a: { rc: "taken" } }); // another tab took the engine during the line's run
  const taken = await runInTurn(["a", "b", "c"], s.runOne);
  assert.deepEqual(taken, { total: 3, ran: 1, stop: { line: 1, why: "taken" } });
  assert.equal(inTurnWords(taken), "2 of 3 pasted lines not run: another tab took over the engine during line 1");

  // the last line fails: nothing is left, so no toast
  s = script({ b: { rc: 111 } });
  assert.equal(inTurnWords(await runInTurn(["a", "b"], s.runOne)), null);
});

test("pasted lines stop before a block's, a comment's or a /// line, which is not sent, and the toast says to use the editor", async () => {
  assert.equal(opensBlock("forvalues i = 1/3 {"), true);
  assert.equal(opensBlock("if x > 1 {  "), true);
  assert.equal(opensBlock("regress y x /// controls"), true);
  assert.equal(opensBlock("display ${x}"), false);
  assert.equal(opensBlock("}"), false);
  // a comment that goes on to the next lines, a program and a mata block: their lines are not commands one by one
  assert.equal(opensBlock("/* the old way"), true);
  assert.equal(opensBlock("summarize x /* the old way"), true);
  assert.equal(opensBlock("/* a note */ summarize x"), false);
  assert.equal(opensBlock('display "/* not a comment"'), false);
  assert.equal(opensBlock("program define tidy"), true);
  assert.equal(opensBlock("capture program define tidy, rclass"), true);
  assert.equal(opensBlock("capture program drop tidy"), false);
  assert.equal(opensBlock("mata"), true);
  assert.equal(opensBlock("mata:"), true);
  assert.equal(opensBlock("mata: x = 1"), false);
  const s = script({});
  const r = await runInTurn(["clear", "forvalues i = 1/3 {", "display `i'", "}"], s.runOne);
  assert.deepEqual(r, { total: 4, ran: 1, stop: { line: 2, why: "block" } });
  assert.deepEqual(s.ran, ["clear"]);
  assert.equal(
    inTurnWords(r),
    "3 of 4 pasted lines not run: line 2 can't be run from the command line; run it from the editor",
  );
  // the block's line is the last one: still said, since it did not run
  assert.equal(
    inTurnWords(await runInTurn(["regress y x ///"], script({}).runOne)),
    "1 of 1 pasted lines not run: line 1 can't be run from the command line; run it from the editor",
  );
  // a commented-out command is not run: the lines stop at the comment's first line
  const c = script({});
  assert.deepEqual(await runInTurn(["/*", "drop _all", "*/"], c.runOne), {
    total: 3,
    ran: 0,
    stop: { line: 1, why: "block" },
  });
  assert.deepEqual(c.ran, []);
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
      how: "started",
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

// the engine's own log: a community command caught by capture noisily, then a typo the run ends with
const CAUGHT_THEN_TYPO = `. capture noisily {
. reghdfe y x
command reghdfe is unrecognized
  → "reghdfe" is not a command known to OpenDTA.
    The first word of each line is the command. Commands can be shortened (sum
    for summarize, gen for generate), but the letters must be in the right
    order.
    How to fix: did you mean "recode"?
    Learn more: help opendta
r(199);
. }

. regresss y x
command regresss is unrecognized
  → "regresss" is not a command known to OpenDTA.
    The first word of each line is the command. Commands can be shortened (sum
    for summarize, gen for generate), but the letters must be in the right
    order.
    How to fix: did you mean "regress", "ivregress", "etregress"?
    Learn more: help opendta
r(199);
`;

test("runError: the error a run ended with is its last error line, not one capture noisily caught before it", () => {
  assert.equal(runError(classify(CAUGHT_THEN_TYPO)), "command regresss is unrecognized");
  assert.equal(runError(classify(". display 1\n1\n")), null);
  assert.equal(runError(classify(". sleep 5000\n--Break--\nr(1);\n")), "--Break--");
});

test("a run's version of an open file (editor/ranover.ts): compared with line breaks as the editor holds them; one change where a clean tab differs; kept with edits or not text; clean again when the run wrote the editor's text", () => {
  // the change, applied to the document as CodeMirror would apply it
  const apply = (doc: string, r: ReturnType<typeof followRun>) =>
    r.t === "shown" ? doc.slice(0, r.from) + r.insert + doc.slice(r.to) : doc;
  assert.equal(editorText("a\r\nb\rc\n"), "a\nb\nc\n");
  // a clean tab of a "\r\n" file (CodeMirror holds "\n"): the run's other rows are shown, not taken as edits
  const saved = editorText("a\r\n9\r\n");
  const crlf = followRun("a\n9\n", saved, "a\r\n1\r\n2\r\n");
  assert.deepEqual(crlf, { t: "shown", from: 2, to: 3, insert: "1\n2" });
  assert.equal(apply("a\n9\n", crlf), "a\n1\n2\n");
  // the same rows with other line breaks: the same text
  assert.deepEqual(followRun("a\n9\n", saved, "a\n9\n"), { t: "same" });
  assert.deepEqual(followRun("a\n9\n", "a\n9\n", "a\r\n9\r\n"), { t: "same" });
  // a .log that grew at the end, an empty file filled, a file emptied: one change each
  assert.deepEqual(followRun("x\n", "x\n", "x\ny\n"), { t: "shown", from: 2, to: 2, insert: "y\n" });
  assert.deepEqual(followRun("", "", "abc"), { t: "shown", from: 0, to: 0, insert: "abc" });
  assert.deepEqual(followRun("abc", "abc", ""), { t: "shown", from: 0, to: 3, insert: "" });
  // a repeated character: the change never overlaps itself
  assert.equal(apply("aa", followRun("aa", "aa", "aaa")), "aaa");
  // unsaved edits: kept, and unsaved unless the run wrote the editor's own text
  assert.deepEqual(followRun("a\nmine\n", "a\n", "a\nb\n"), { t: "kept", dirty: true });
  assert.deepEqual(followRun("a\nmine\n", "a\n", "a\r\nmine\r\n"), { t: "kept", dirty: false });
  // not text: kept, unsaved; then a run that writes the editor's text makes it clean again, one with other text not
  assert.deepEqual(followRun("a\n", "a\n", null), { t: "kept", dirty: true });
  assert.deepEqual(followRun("a\n", null, "a\n"), { t: "kept", dirty: false });
  assert.deepEqual(followRun("a\n", null, "b\n"), { t: "kept", dirty: true });
});

test("a file's form (editor/ranover.ts): its line break, the more common one, \\n on a tie or with none, and its BOM; noted when it opens; Save writes it back, byte for byte", () => {
  assert.equal(lineBreakOf("a\r\nb\r\n"), "\r\n");
  assert.equal(lineBreakOf("a\nb\n"), "\n");
  // mixed: the more common one; a tie is "\n"
  assert.equal(lineBreakOf("a\r\nb\r\nc\n"), "\r\n");
  assert.equal(lineBreakOf("a\nb\nc\r\n"), "\n");
  assert.equal(lineBreakOf("a\r\nb\n"), "\n");
  // empty, or no line break at all: "\n"
  assert.equal(lineBreakOf(""), "\n");
  assert.equal(lineBreakOf("display 1"), "\n");
  // a lone "\r" (old Mac) is not counted: such a file is "\n" (the editor holds its breaks as "\n" already)
  assert.equal(lineBreakOf("a\rb\r"), "\n");
  assert.equal(lineBreakOf("a\rb\rc\r\n"), "\r\n");
  // a BOM: noted, and never in the editor's text (what Run sends and the comparisons use)
  assert.deepEqual(formOf("\uFEFFa\r\nb\r\n"), { br: "\r\n", bom: true });
  assert.deepEqual(formOf("a\nb\n"), { br: "\n", bom: false });
  assert.deepEqual(formOf(""), PLAIN);
  assert.equal(editorText("\uFEFFa\r\nb\r\n"), "a\nb\n");
  assert.equal(editorText("a\uFEFF"), "a\uFEFF", "only a leading BOM");
  assert.deepEqual(followRun("a\n", "a\n", "\uFEFFa\n"), { t: "same" }, "the same rows with a BOM: the same text");
  // writing back: the editor's text in the noted form
  assert.equal(fileText("a\nb\n", { br: "\r\n", bom: false }, "t.csv"), "a\r\nb\r\n");
  assert.equal(fileText("a\nb\n", PLAIN, "t.csv"), "a\nb\n");
  assert.equal(fileText("", { br: "\r\n", bom: false }, "t.csv"), "");
  assert.equal(fileText("a\nb\n", { br: "\r\n", bom: true }, "t.csv"), "\uFEFFa\r\nb\r\n");
  assert.equal(fileText("", { br: "\n", bom: true }, "notes.txt"), "\uFEFF");
  // a mixed file becomes uniform on its first Save
  const mixed = "a\r\nb\r\nc\n";
  assert.equal(fileText(editorText(mixed), formOf(mixed), "a.do"), "a\r\nb\r\nc\r\n");
  // a round trip of a "\r\n" or "\n" text, with or without a BOM, is byte-identical, with or without a final line break
  for (const t of ["a\r\nb\r\n", "a\r\nb", "a\nb\n", "a\nb", "\r\n", "x", "\uFEFFa\r\nb\r\n", "\uFEFFa\nb", "\uFEFF"])
    assert.equal(fileText(editorText(t), formOf(t), "data/t.csv"), t);
  // a do-file or an ado-file (by the name it is saved under, case ignored) is written without its BOM, its line break
  // kept: the engine reads a BOM as part of the first command (ODT-34)
  for (const path of ["a.do", "dir/b.DO", "prog.ado", "X.Ado"]) {
    assert.equal(dropsBom(path), true, path);
    assert.equal(fileText("a\nb", { br: "\r\n", bom: true }, path), "a\r\nb", path);
  }
  for (const path of ["t.csv", "notes.txt", "a.do.txt", "do", "a.dofile", "a.dta.log", "x.ado.bak"]) {
    assert.equal(dropsBom(path), false, path);
    assert.equal(fileText("a\nb", { br: "\n", bom: true }, path), "\uFEFFa\nb", path);
  }
  // the form noted after a Save is the one written: a do-file's BOM is gone, another file's stays
  assert.deepEqual(savedForm({ br: "\r\n", bom: true }, "a.do"), { br: "\r\n", bom: false });
  assert.deepEqual(savedForm({ br: "\r\n", bom: true }, "t.csv"), { br: "\r\n", bom: true });
});

test("Save's key (editor/keys.ts): Ctrl or Cmd with S on any layout, the key that types s or, typing no Latin letter, the key in S's place; never with Alt (AltGr) or Shift", () => {
  const press = (key: string, code: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }) =>
    isSaveKey({
      key,
      code,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift,
    });
  // QWERTY (and AZERTY, whose S is in the same place): Ctrl+S and Cmd+S; Caps Lock's "S" too
  assert.equal(press("s", "KeyS", { ctrl: true }), true);
  assert.equal(press("s", "KeyS", { meta: true }), true);
  assert.equal(press("S", "KeyS", { ctrl: true }), true);
  // Dvorak: S types "o" in S's place, and "s" sits where QWERTY has ";"
  assert.equal(press("s", "Semicolon", { ctrl: true }), true);
  assert.equal(press("o", "KeyS", { ctrl: true }), false);
  // Cyrillic (and Greek, Hebrew, Arabic): the key in S's place types no Latin letter
  assert.equal(press("ы", "KeyS", { ctrl: true }), true);
  assert.equal(press("ы", "KeyS", { meta: true }), true);
  assert.equal(press("σ", "KeyS", { ctrl: true }), true);
  assert.equal(press("в", "KeyD", { ctrl: true }), false);
  // no Ctrl or Cmd; Alt (AltGr on Windows is Ctrl+Alt); Shift
  assert.equal(press("s", "KeyS", {}), false);
  assert.equal(press("ś", "KeyS", { ctrl: true, alt: true }), false);
  assert.equal(press("s", "KeyS", { ctrl: true, alt: true }), false);
  assert.equal(press("S", "KeyS", { ctrl: true, shift: true }), false);
  assert.equal(press("Ы", "KeyS", { ctrl: true, shift: true }), false);
  // other keys
  assert.equal(press("Enter", "Enter", { ctrl: true }), false);
  assert.equal(press("d", "KeyD", { ctrl: true }), false);
});

test("a refused Ctrl/Cmd+Enter's toast: the words by the engine's state; none where a run is taken or opens the download prompt", () => {
  const by = (states: string[]) => states.map((s) => refusedRunWords(s as Parameters<typeof refusedRunWords>[0]));
  assert.deepEqual(by(["ready", "none", "declined"]), [null, null, null]);
  for (const s of by(["running", "breaking", "waiting"]))
    assert.equal(s, "Run is not available until the current run ends");
  for (const s of by(["checking-lock", "checking-cache", "asking", "downloading", "starting-list", "starting-worker"]))
    assert.equal(s, "The engine is starting. Try again when it is ready.");
  for (const s of by(["failed", "failed-twice", "other-tab-idle", "other-tab-taking"]))
    assert.equal(s, "Run is not available: the engine isn't running in this tab");
});
