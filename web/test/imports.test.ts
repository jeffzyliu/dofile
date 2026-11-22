// The contracts that no type and no lint rule can hold, checked on the source text and the import graph of web/src (and,
// where said, the whole of web/). The text is read with comments removed, and where a rule counts a word in code, with the
// strings' contents removed too. Rules a file path can state (who imports whom, who calls what, who names a writer) are
// in biome.json and biome/architecture.grit; the writable signals are checked by test/signals.types.ts.

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
/** The imports of a file: what it names (a path from web/ when it is a file of ours), and whether only types come. */
type Import = { from: string; file: string | null; typeOnly: boolean };
function importsOf(path: string): Import[] {
  const text = source(path),
    out: Import[] = [];
  const add = (spec: string, typeOnly: boolean) => {
    let file: string | null = null;
    if (spec.startsWith(".")) {
      const base = resolve(web, dirname(path), spec);
      // a view may leave the extension out
      const found = [base, `${base}.ts`, `${base}.tsx`].find((p) => existsSync(p) && statSync(p).isFile());
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

const LAYER = {
  views: "src/app", // its .tsx files
  transport: /^src\/engine\/(client|worker)/, // the page's transport and the Worker's entry
  pageTransport: /^src\/engine\/client/, // the page's side of it
  entry: "src/main.tsx",
  machine: "src/engine/machine.ts", // the one pure file
  runController: "src/app/run.ts", // decides nothing about the engine's state
};

const SRC = files("src");

test("the scanner: comments go, strings stay (or are blanked), and a regular expression or a template is not taken for code", () => {
  assert.equal(code("a // b\nc /* d */ e"), "a \nc   e");
  assert.equal(code('x = "http://a" + `b${c + "//"}d` // e'), 'x = "http://a" + `b${c + "//"}d` ');
  assert.equal(code('x = "http://a" + `b${c + "//"}d` // e', true), 'x = "" + `${c + ""}` ');
  assert.equal(code("m = /\\/\\/ as [/]/.test(s) /* c */", true), "m = //.test(s)  ");
  assert.equal(code("a = b / c; // d"), "a = b / c; ");
  assert.equal(code("f(`a ${`b ${c} d`} e`) as T", true), "f(`${`${c}`}`) as T");
});

test("the import graph: no view reaches the transport or the worker through value imports", () => {
  const views = files(LAYER.views, /\.tsx$/);
  assert.ok(views.length > 15, `${views.length} views`);
  const reach = (from: string, seen = new Set<string>()): Set<string> => {
    for (const i of importsOf(from))
      if (i.file && !i.typeOnly && !seen.has(i.file)) {
        seen.add(i.file);
        reach(i.file, seen);
      }
    return seen;
  };
  for (const view of views)
    assert.deepEqual(
      [...reach(view)].filter((f) => LAYER.transport.test(f)),
      [],
      `${view} reaches the transport through value imports`,
    );
  // and the views do reach what they should: the check above is not empty
  const reached = new Set(views.flatMap((v) => [...reach(v)]));
  assert.ok(
    [...reached].some((f) => f.startsWith("src/app/") && f.endsWith(".ts")),
    "views reach the controllers",
  );
  assert.ok(reached.has("src/app/state.ts"), "views reach the state");
  assert.ok(
    [...reach(LAYER.entry)].some((f) => LAYER.transport.test(f)),
    "main.tsx is where the transport comes in",
  );
});

test("the landing and commands pages (src/site/) load only their own scripts and styles, and the editor's HTML loads nothing of theirs", () => {
  assert.ok(SRC.filter((f) => f.startsWith("src/site/")).length >= 4, "src/site/ has the pages' scripts");
  // the pages' HTML loads only their own entries
  for (const page of ["landing.html", "commands.html"]) {
    const scripts = [...readFileSync(join(web, page), "utf8").matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(scripts.length > 0, page);
    for (const s of scripts) assert.match(s, /^\/src\/site\/[a-z-]+\.ts$/, `${page} loads ${s}`);
  }
  // and the editor's HTML loads nothing of theirs: no script and no stylesheet under src/site/
  const editorHtml = readFileSync(join(web, "index.html"), "utf8");
  const loads = [...editorHtml.matchAll(/<(?:script|link)[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(loads.includes("/src/main.tsx"), "index.html loads the editor's entry");
  for (const l of loads) assert.ok(!l.includes("/site/"), `index.html loads ${l}`);
  // CSS: an @import or url() of a stylesheet in src/site/ only from src/site/; src/site/'s CSS only of src/site/ and
  // src/styles/
  const css = files("src", /\.css$/);
  assert.ok(css.includes("src/site/site.css") && css.includes("src/styles/ui.css"), "the walk found the stylesheets");
  for (const f of css) {
    const text = readFileSync(join(web, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const refs = [...text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')\s]+)/g)]
      .map((m) => m[1] ?? m[2])
      .filter((r) => !/^(data:|https?:|#)/.test(r));
    for (const r of refs.filter((r) => r.endsWith(".css"))) {
      const target = relative(web, resolve(web, dirname(f), r));
      if (f.startsWith("src/site/")) assert.match(target, /^src\/(site|styles)\//, `${f} imports ${target}`);
      else assert.ok(!target.startsWith("src/site/"), `${f} imports ${target}`);
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

test("machine.ts has no variable at the top level and two casts (its imports and globals: Biome)", () => {
  const text = source(LAYER.machine, true);
  assert.equal(count(text, /^(export\s+)?(let|var)\s/m), 0, "a variable at the top level");
  assert.equal(count(text, /\bas\b/), 2, "two casts in the whole file: mint() and the table lookup");
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
  // in the text as it is, comments and strings too: grep -r must find one
  const found = Object.fromEntries(
    all.map((f) => [f, count(readFileSync(join(web, f), "utf8"), cast)] as const).filter(([, c]) => c),
  );
  assert.deepEqual(found, { [LAYER.machine]: 1 });
  // and no angle-bracket cast to Ticket in web/src or in the machine's own test (a cast to any or never: Biome)
  assert.deepEqual(having([...SRC, "test/machine.test.ts"], /<Ticket>/), {});
});

test("the transport knows no state name, and run.ts does not read the engine's state", () => {
  const client = SRC.filter((f) => LAYER.pageTransport.test(f));
  assert.ok(client.length > 0, "the walk found the transport");
  const names = /"(ready|running|breaking|waiting|starting-list|starting-worker|asking|declined|downloading)"/;
  for (const f of client) assert.equal(count(source(f), names), 0, `${f} names a state`);
  assert.equal(
    count(source(LAYER.runController, true), /S\.engine\b|\.subscribe\(/),
    0,
    "run.ts subscribes to nothing",
  );
});

test("no CSS reads data-engine, and no view spells a set of engine state names", () => {
  for (const f of files("src", /\.css$/))
    assert.equal(count(readFileSync(join(web, f), "utf8"), /data-engine/), 0, `${f} reads data-engine`);
  const names =
    "(?:ready|running|breaking|waiting|starting-list|starting-worker|downloading|other-tab-idle|other-tab-taking)";
  const set = new RegExp(`"${names}"\\s*(?:\\|\\||&&|,)\\s*(?:[\\w.]+\\s*===?\\s*)?"${names}"`);
  for (const f of SRC.filter((f) => f.endsWith(".tsx")))
    assert.equal(count(source(f), set), 0, `${f} spells a set of state names: src/app/states/predicates.ts has them`);
});

// A tap on iOS leaves :hover on until the next tap elsewhere (the Files pane's caret and ⋯ and the heads' "+" stayed
// gray), so every :hover rule of the stylesheets is inside `@media (hover: hover)`.
test("every :hover rule is inside (hover: hover)", () => {
  const outside: string[] = [];
  for (const file of ["../src/styles/ui.css", "../src/styles/app.css", "../src/site/site.css"]) {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const stack: string[] = [];
    let buf = "";
    for (const ch of css) {
      if (ch === "{") {
        const sel = buf.trim();
        stack.push(sel);
        if (/:hover/.test(sel) && !stack.some((s) => /hover:\s*hover/.test(s))) outside.push(`${file}: ${sel}`);
        buf = "";
      } else if (ch === "}") {
        stack.pop();
        buf = "";
      } else if (ch === ";") buf = "";
      else buf += ch;
    }
  }
  assert.deepEqual(outside, []);
});

test("one door: in src/app/ the store keeps its name (no renamed or namespace import, no copy, no destructuring), so the Biome rule on its writes sees each one", () => {
  const app = SRC.filter((f) => f.startsWith("src/app/") && f !== "src/app/files/turns.ts");
  const renamed = /\bstore\s+as\s+[A-Za-z_$]|\*\s*as\s+[A-Za-z_$][\w$]*\s+from\s*["'][^"']*\/store\.ts["']/;
  const copied = /\{[^{}]*\}\s*=\s*store\b|(?<![=!<>])=\s*store\s*!?\s*[;,)\]]/;
  assert.deepEqual(having(app, renamed, false), {}, "renamed");
  assert.deepEqual(having(app, copied), {}, "copied or destructured");
});
