// The contracts that no type can hold, checked on the source text and the import graph of web/src (and, where said, the
// whole of web/). docs/prototype1-step3.5-c-design.md: items 5.1 (tickets and replies), 6 (the contracts), 7.2 (the
// worker is posted to in one place) and 7.4 (single instances). The text is read with comments removed, and where a rule
// counts a word in code, with the strings' contents removed too. A definition is not a call.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", "dist", "public", "test-results", "playwright-report", "wheels", ".vite"]);

/** Every source file under web/`dir`, as paths from web/. */
function files(dir: string, ext = /\.(ts|tsx|mjs)$/): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(web, d), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(join(d, e.name));
      } else if (ext.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out.sort();
}

/** The code of a source text: comments removed; with `blank`, the contents of strings, templates and regular
 *  expressions removed too (the quotes stay). A scanner for this code base, not a parser: a `/` starts a regular
 *  expression where a value is expected. */
function code(text: string, blank = false): string {
  let out = "";
  const n = text.length,
    templates: number[] = []; // the brace depth at which each open `${` closes
  let depth = 0,
    last = ""; // last: the last character of code that is not a space
  const value = () =>
    last === "" ||
    "(,=:[!&|?{};+-*%<>~^".includes(last) ||
    /\b(return|typeof|case|in|of|void|throw|new|delete|do|else)$/.test(out.trimEnd());
  for (let i = 0; i < n; ) {
    const c = text[i],
      d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += blank ? c + c : text.slice(i, j + 1);
      i = j + 1;
      last = c;
      continue;
    }
    if (c === "`" || (c === "}" && templates.at(-1) === depth)) {
      // a template starts, or goes on after `${ … }`
      if (c === "}") templates.pop();
      let j = i + 1;
      while (j < n && text[j] !== "`" && !(text[j] === "$" && text[j + 1] === "{")) j += text[j] === "\\" ? 2 : 1;
      const open = text[j] === "$";
      out += blank ? (c === "`" ? "`" : "}") + (open ? "${" : "`") : text.slice(i, j + (open ? 2 : 1));
      if (open) templates.push(depth);
      i = j + (open ? 2 : 1);
      last = open ? "{" : "`";
      continue;
    }
    if (c === "/" && value()) {
      // a regular expression
      let j = i + 1,
        set = false;
      while (j < n && (set || text[j] !== "/") && text[j] !== "\n") {
        if (text[j] === "[") set = true;
        else if (text[j] === "]") set = false;
        j += text[j] === "\\" ? 2 : 1;
      }
      out += blank ? "//" : text.slice(i, j + 1);
      i = j + 1;
      last = "/";
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") depth--;
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}
const source = (path: string, blank = false) => code(readFileSync(join(web, path), "utf8"), blank);
/** How many times `pattern` occurs in `text`. */
const count = (text: string, pattern: RegExp) =>
  [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))]
    .length;
/** The files of `list` whose code has `pattern`, with how often. */
const having = (list: string[], pattern: RegExp, blank = true) =>
  Object.fromEntries(list.map((f) => [f, count(source(f, blank), pattern)] as const).filter(([, c]) => c));
/** The body of the function that starts at `marker` (the text up to and with its `{`), braces matched. */
function bodyOf(text: string, marker: string): string {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `no "${marker}"`);
  let i = at + marker.length,
    depth = 1;
  for (; i < text.length && depth; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
  }
  return text.slice(at + marker.length, i - 1);
}

/** The imports of a file: what it names (a path from web/ when it is a file of ours), and whether only types come. */
type Import = { from: string; file: string | null; typeOnly: boolean };
function importsOf(path: string): Import[] {
  const text = source(path),
    out: Import[] = [];
  const add = (spec: string, typeOnly: boolean) => {
    let file: string | null = null;
    if (spec.startsWith(".")) {
      const base = resolve(web, dirname(path), spec);
      const found = [base, `${base}.ts`, `${base}.tsx`].find((p) => existsSync(p) && statSync(p).isFile()); // a view may leave the extension out
      assert.ok(found, `${path}: cannot resolve ${spec}`);
      file = relative(web, found);
    }
    out.push({ from: spec, file, typeOnly });
  };
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm))
    add(m[3], Boolean(m[2]));
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], false);
  return out;
}

const SRC = files("src"),
  ENGINE = "src/app/engine.ts",
  MAIN = "src/main.tsx";

test("the scanner: comments go, strings stay (or are blanked), and a regular expression or a template is not taken for code", () => {
  assert.equal(code("a // b\nc /* d */ e"), "a \nc   e");
  assert.equal(code('x = "http://a" + `b${c + "//"}d` // e'), 'x = "http://a" + `b${c + "//"}d` ');
  assert.equal(code('x = "http://a" + `b${c + "//"}d` // e', true), 'x = "" + `${c + ""}` ');
  assert.equal(code("m = /\\/\\/ as [/]/.test(s) /* c */", true), "m = //.test(s)  ");
  assert.equal(code("a = b / c; // d"), "a = b / c; ");
  assert.equal(code("f(`a ${`b ${c} d`} e`) as T", true), "f(`${`${c}`}`) as T");
});

test("the import graph: no view reaches the transport or the worker; no .tsx imports the machine or main.tsx; the controller takes only types from client.ts", () => {
  const views = files("src/app", /\.tsx$/);
  assert.ok(views.length > 15, `${views.length} views`);
  const reach = (from: string, seen = new Set<string>()): Set<string> => {
    for (const i of importsOf(from))
      if (i.file && !i.typeOnly && !seen.has(i.file)) {
        seen.add(i.file);
        reach(i.file, seen);
      }
    return seen;
  };
  for (const view of views) {
    const reached = reach(view);
    for (const banned of ["src/engine/client.ts", "src/engine/worker.ts"])
      assert.ok(!reached.has(banned), `${view} reaches ${banned} through value imports`);
  }
  for (const f of SRC.filter((f) => f.endsWith(".tsx"))) {
    for (const i of importsOf(f)) {
      assert.notEqual(i.file, "src/engine/machine.ts", `${f} imports the machine`);
      assert.notEqual(i.file, MAIN, `${f} imports main.tsx`);
    }
  }
  const fromClient = importsOf(ENGINE).filter((i) => i.file === "src/engine/client.ts");
  assert.deepEqual(
    fromClient.map((i) => i.typeOnly),
    [true],
    "app/engine.ts: one import from client.ts, of types",
  );
  // and the views do reach what they should: the check above is not empty
  assert.ok(reach("src/app/editor/RunControls.tsx").has(ENGINE) && reach("src/app/App.tsx").has("src/app/state.ts"));
  assert.ok(reach(MAIN).has("src/engine/client.ts"), "main.tsx is where the transport comes in");
});

test("the import graph: engine/ never imports app/; no .ts file imports a .tsx; every relative import in a .ts file spells its extension", () => {
  for (const f of [...SRC, ...files("test"), ...files("scripts", /\.ts$/)]) {
    for (const i of importsOf(f)) {
      if (!i.file) continue;
      if (f.startsWith("src/engine/")) assert.ok(!i.file.startsWith("src/app/"), `${f} imports ${i.file}`);
      if (f.endsWith(".ts")) {
        assert.ok(!i.file.endsWith(".tsx"), `${f} (a .ts file: Node runs it as it is) imports ${i.file}`);
        assert.match(i.from, /\.(ts|json|mjs|css)$/, `${f}: "${i.from}" must spell its extension`);
      }
    }
  }
});

test("TypeScript as Node runs it: only syntax that can be erased, and no JSDoc types", () => {
  const options = JSON.parse(readFileSync(join(web, "tsconfig.json"), "utf8")).compilerOptions;
  assert.deepEqual(
    [options.erasableSyntaxOnly, options.verbatimModuleSyntax, options.allowImportingTsExtensions, options.strict],
    [true, true, true, true],
  );
  const jsdoc = /@(typedef|param|type|returns?|template)\s*\{/;
  for (const f of [...SRC, ...files("test")])
    assert.doesNotMatch(readFileSync(join(web, f), "utf8"), jsdoc, `${f} has a JSDoc type`);
});

test("machine.ts is pure: only type imports, no clock, timer, console or random number, no variable at the top level, and two casts", () => {
  const path = "src/engine/machine.ts",
    text = source(path, true);
  const imports = importsOf(path);
  assert.ok(imports.length >= 1);
  for (const i of imports) assert.equal(i.typeOnly, true, `machine.ts imports a value from ${i.from}`);
  for (const name of [
    "Date",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "console",
    "Math.random",
    "performance",
    "globalThis",
    "window",
    "document",
    "signal",
  ]) {
    assert.equal(count(text, new RegExp(`\\b${name.replace(".", "\\.")}\\b`)), 0, `machine.ts names ${name}`);
  }
  assert.equal(count(text, /^(export\s+)?(let|var)\s/m), 0, "a variable at the top level");
  assert.equal(count(text, /\bas\b/), 2, "two casts in the whole file: mint() and the table lookup");
  assert.equal(
    count(bodyOf(text, "export function transition(m: Machine, e: Event): Step {"), /\bas\b/),
    1,
    "one of them in transition()",
  );
});

test("a ticket is made in one place: the cast to Ticket occurs once in the whole of web/, in machine.ts", () => {
  const cast = new RegExp(["\\bas", "Ticket\\b"].join("\\s+")); // put together here, so that this file does not have it
  const all = [
    ...SRC,
    ...files("test"),
    ...files("e2e"),
    ...files("scripts"),
    "vite.config.ts",
    "playwright.config.ts",
  ];
  // in the text as it is, comments and strings too: `grep -r` must find one
  const found = Object.fromEntries(
    all.map((f) => [f, count(readFileSync(join(web, f), "utf8"), cast)] as const).filter(([, c]) => c),
  );
  assert.deepEqual(found, { "src/engine/machine.ts": 1 });
  assert.match(
    source("src/engine/machine.ts"),
    new RegExp(`const mint = \\(n: number\\): Ticket => n ${cast.source.replace(/\\b/g, "")};`),
  );
  // and no other way round the brand: no cast to `any` or `never`, and no angle-bracket cast to Ticket, anywhere in
  // web/src or in the machine's own test (which copies every ticket from an effect, a state or a machine)
  const loose = new RegExp(["\\bas\\s+(any|never)\\b", "<Ticket>"].join("|"));
  assert.deepEqual(having([...SRC, "test/machine.test.ts"], loose), {});
});

test("events get in through two doors: enqueue() is called only in dispatch() and reply(); reply() has no cast; transition() is called once", () => {
  const text = source(ENGINE, true);
  assert.equal(count(text, /\benqueue\(/), 3, "its definition and two calls");
  assert.equal(count(text, /\bfunction enqueue\(/), 1);
  assert.equal(
    count(bodyOf(text, "function dispatch(event: PlainEvent): Step | null {"), /\benqueue\(/),
    1,
    "in dispatch()",
  );
  const reply = bodyOf(text, "const reply = <K extends Answered>(effect: TicketedEffect & { do: K }): Reply<K> => {");
  assert.equal(count(reply, /\benqueue\(/), 1, "in reply()");
  assert.equal(count(reply, /\bas\b/), 0, "reply() has no cast");
  assert.match(reply, /if \(mine !== wiring\) return;/, "a reply of an earlier wiring does nothing");
  assert.match(reply, /enqueue\(\{ \.\.\.said, n: effect\.n \}\)/, "the one place a ticket is put on an event");
  assert.equal(count(text, /\bn: effect\.n\b/), 1, "and nowhere else");
  // the queue has one way in, enqueue(): it is pushed to in one place, there, and nothing else puts an event into it
  assert.equal(count(text, /\bqueue\.(push|unshift|splice|concat)\(|\bqueue\[/), 1);
  assert.equal(
    count(
      bodyOf(text, "function enqueue(happening: PlainEvent | (AnyAnswer & { n: Ticket })): Step | null {"),
      /\bqueue\.push\(event\)/,
    ),
    1,
    "in enqueue()",
  );
  assert.equal(count(text, /\bqueue = /), 1, "and it is emptied in one place, connectEngine()");
  assert.equal(count(bodyOf(text, "export function connectEngine("), /\bqueue = \[\]/), 1);
  // view() takes the machine's State and gives the views' EngineState: its return type is the third check on EngineState
  assert.equal(count(text, /\bfunction view\(state: State\): EngineState \{/), 1);
  assert.equal(
    count(text, /\bengineWriter\.engine\.value = view\(/),
    1,
    "the one writer of the `engine` signal writes what view() gives",
  );
  assert.equal(count(text, /\bengineWriter\b/), 2, "its import, and that one write");
  assert.deepEqual(
    having(SRC, /\btransition\(/),
    { [ENGINE]: 1, "src/engine/machine.ts": 1 },
    "the one call, and the definition",
  );
  assert.deepEqual(
    having(SRC, /\binitial\(/),
    { [ENGINE]: 1, "src/engine/machine.ts": 1 },
    "open() is the one caller of initial()",
  );
});

test("the worker is posted to in one place: postMessage occurs once in client.ts, in #send", () => {
  const text = source("src/engine/client.ts", true);
  assert.equal(count(text, /\bpostMessage\(/), 1);
  assert.equal(count(bodyOf(text, "#send<K extends Op>("), /\bpostMessage\(/), 1);
  // and the lifecycle ops leave it only from start() and run()
  for (const op of ["mount", "boot", "startup", "run"])
    assert.equal(count(source("src/engine/client.ts"), new RegExp(`#send\\(live, "${op}"`)), 1, op);
  // and the one op of JournalOps from the function start() gives to store.attach, with nothing in it
  assert.equal(count(source("src/engine/client.ts"), /#send\(live, "sync", undefined\)/), 1, "sync");
  assert.equal(count(source("src/engine/client.ts"), /#send\(live, "sync"/), 1, "sync");
});

test("single instances: main.tsx is the only module that constructs or connects; the store is opened in two places, one for each thread", () => {
  assert.deepEqual(having(SRC, /\bnew EngineClient\(/), { [MAIN]: 1 });
  assert.deepEqual(having(SRC, /\bnew Worker\(/), { [MAIN]: 1 });
  const calls = (name: string) => having(SRC, new RegExp(`(?<!function )\\b${name}\\(`));
  assert.deepEqual(calls("connectEngine"), { [MAIN]: 1 });
  assert.deepEqual(calls("connectFiles"), { [MAIN]: 1 });
  assert.deepEqual(calls("connectRun"), { [MAIN]: 1 });
  assert.deepEqual(calls("tabLock"), { [MAIN]: 1 });
  assert.deepEqual(calls("openStore"), { "src/app/store.ts": 1, "src/engine/worker.ts": 1 });
  // the page load: open() is called once, in main.tsx (not `x.open()`, and not its definition, which has a return type)
  assert.deepEqual(having(SRC, /(?<![.\w])open\(\)(?!\s*:)/), { [MAIN]: 1 });
  assert.equal(
    count(source(ENGINE, true), /\bexport function open\(\): void \{/),
    1,
    "open is defined in the controller",
  );
  // the definitions, which the counts above leave aside
  for (const [name, file] of [
    ["connectEngine", ENGINE],
    ["connectRun", ENGINE],
    ["connectFiles", "src/app/files.ts"],
    ["tabLock", "src/engine/tab.ts"],
    ["openStore", "src/engine/store.ts"],
  ]) {
    assert.equal(
      count(source(file, true), new RegExp(`\\bexport (function ${name}\\(|const ${name} = )`)),
      1,
      `${name} is defined in ${file}`,
    );
  }
});

test("each signal has one writer: a writer object is named only by state.ts and its owner", () => {
  const owners = { engineWriter: ENGINE, runWriter: "src/app/run.ts", filesWriter: "src/app/files.ts" };
  for (const [writer, owner] of Object.entries(owners)) {
    assert.deepEqual(
      Object.keys(having(SRC, new RegExp(`\\b${writer}\\b`))).sort(),
      [owner, "src/app/state.ts"].sort(),
      writer,
    );
  }
  // a signal that is in a writer object is exported read-only, and the views' own signals are not in one
  const state = source("src/app/state.ts", true);
  for (const name of [
    "engine",
    "files",
    "fresh",
    "persisted",
    "log",
    "lastRun",
    "history",
    "results",
    "macros",
    "data",
    "rows",
    "memory",
    "graphs",
    "toast",
    "banners",
    "announce",
  ]) {
    assert.match(state, new RegExp(`export const ${name}: ReadonlySignal<`), `${name} is exported read-only`);
  }
  for (const name of [
    "dialog",
    "tabs",
    "activeTab",
    "split",
    "outputTab",
    "phoneTab",
    "pickedVar",
    "theme",
    "layout",
    "isolated",
    "graphIndex",
    "graphFull",
  ]) {
    assert.match(state, new RegExp(`export const ${name} = signal[<(]`), `${name} stays writable`);
  }
  assert.equal(count(state, /export const \w+ = signal[<(]/), 12, "no other signal is exported writable");
});

test("no counter or flag outside the machine decides a state: the old ones are gone from web/src", () => {
  const gone =
    /\b(gen|attempt|lockGen|errorRestarts|taking|was|queued|hadEngine|stageAt|STAGE_OF|StatusText|onRestart|onStatus|resetResult|breakTimer|resetAt|STARTABLE|RESETTABLE)\b/;
  const found = having(SRC, gone);
  // What is left of those names. The machine's own: the `queued` field of its states, and `resetAt` of `breaking`, which
  // views read. The controller's handle on the Break timer, which decides no state. And in the worker, `was`, a local
  // name in saveRun for the files as they were before a run.
  assert.deepEqual(Object.keys(found).sort(), [
    "src/app/engine.ts",
    "src/app/states/banners.tsx", // reads `resetAt` of `breaking` for the Break countdown
    "src/app/types.ts",
    "src/engine/machine.ts",
    "src/engine/worker.ts",
  ]);
  assert.equal(
    count(source("src/engine/worker.ts", true), gone),
    count(source("src/engine/worker.ts", true), /\bwas\b/),
  );
  assert.match(source("src/engine/worker.ts"), /const was = new Map\(before\.map/);
  assert.equal(count(source(ENGINE, true), gone), count(source(ENGINE, true), /\b(breakTimer|resetAt|queued)\b/));
  assert.equal(count(source("src/app/types.ts", true), gone), count(source("src/app/types.ts", true), /\bresetAt\b/));
  assert.equal(
    count(source("src/app/states/banners.tsx", true), gone),
    count(source("src/app/states/banners.tsx", true), /\bresetAt\b/),
  );
  assert.equal(
    count(source("src/engine/machine.ts", true), gone),
    count(source("src/engine/machine.ts", true), /\b(queued|resetAt)\b/),
  );
  // run.ts does not read the engine's state, and the transport knows no state name
  assert.equal(count(source("src/app/run.ts", true), /S\.engine\b|\.subscribe\(/), 0, "run.ts subscribes to nothing");
  assert.equal(
    count(
      source("src/engine/client.ts"),
      /"(ready|running|breaking|waiting|starting-list|starting-worker|asking|declined|downloading)"/,
    ),
    0,
  );
});

test("the CSS that keys on the engine's state names matches both other-tab states", () => {
  const css = readFileSync(join(web, "src/styles/app.css"), "utf8");
  const keyed = [...css.matchAll(/\[data-engine([^\]]*)\]/g)].map((m) => m[1]);
  assert.deepEqual(keyed, ['^="other-tab"'], "one rule, by prefix: other-tab-idle and other-tab-taking");
});
