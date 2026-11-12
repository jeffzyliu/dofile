// The landing and commands pages' plain logic (scripts/site-pages.ts, src/site/filter.ts) and what their source says:
// the commands list is made from src/stata/commands.json and nothing else, the placeholders are all known, the
// numbers are the build's, and the clean-room greps (docs/prototype1-plan.md, "Clean-room check of the site's text").

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CommandData,
  commandsHtml,
  deniedInBrowser,
  engineMB,
  fillCommands,
  fillTokens,
  OWN_PREFIXES,
} from "../scripts/site-pages.ts";
import { filterNames } from "../src/site/filter.ts";
import data from "../src/stata/commands.json" with { type: "json" };

const web = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("fillTokens fills the version and the size, each only when given", () => {
  const html = "v{{version}} about {{engine-mb}} MB, {{engine-mb}}";
  assert.equal(fillTokens(html, { version: "0.1.0" }), "v0.1.0 about {{engine-mb}} MB, {{engine-mb}}");
  assert.equal(fillTokens(html, { engineMB: "49" }), "v{{version}} about 49 MB, 49");
  assert.equal(engineMB(48_600_000), "49", "rounded as the editor's prompt does (Math.round of MB)");
});

test("the commands in the page are the registry's: every name of commands.json, in its order, with its shortest form in bold", () => {
  const { list, count } = commandsHtml(data as CommandData, []);
  const names = [...list.matchAll(/data-name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, Object.keys(data.commands));
  assert.equal(count, Object.keys(data.commands).length);
  // summarize's shortest form is `su`: "su" in bold, then the rest
  const min = (data.commands as Record<string, number>).summarize;
  assert.ok(list.includes(`<b>${"summarize".slice(0, min)}</b>${"summarize".slice(min)}`));
  // a command that cannot be shortened has no bold
  const whole = Object.entries(data.commands).find(([n, m]) => m === n.length)!;
  assert.ok(list.includes(`<code>${whole[0]}</code>`));
});

test("the commands the page switches off are read from browser.py's DENIED, and marked in the list", () => {
  const denied = deniedInBrowser();
  assert.deepEqual(denied, ["shell", "webuse"]);
  const { list } = commandsHtml(data as CommandData, denied);
  for (const d of denied) assert.match(list, new RegExp(`data-name="${d}" class="off"`));
  assert.doesNotMatch(list, /data-name="regress" class="off"/);
  assert.throws(() => deniedInBrowser("no tuple here"), /DENIED/);
});

test("the six prefixes the interpreter handles itself are the highlighter's (language.ts), and the registry's prefixes follow", () => {
  const language = web("src/stata/language.ts");
  for (const p of OWN_PREFIXES) assert.match(language, new RegExp(`\\b${p}: \\d`), `${p} in language.ts`);
  const { prefixes } = commandsHtml(data as CommandData, []);
  const shown = [...prefixes.matchAll(/data-name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(shown, [...OWN_PREFIXES, ...data.prefixes]);
});

test("commands.html and landing.html: no placeholder is left once filled, and every placeholder is one the build knows", () => {
  const commands = fillCommands(
    fillTokens(web("commands.html"), { version: "9.9.9", engineMB: "50" }),
    data as CommandData,
    ["shell", "webuse"],
  );
  assert.doesNotMatch(commands, /\{\{|<!--COMMANDS-->|<!--PREFIXES-->/);
  const landing = fillTokens(web("landing.html"), { version: "9.9.9", engineMB: "50" });
  assert.doesNotMatch(landing, /\{\{/);
  assert.match(landing, /about 50 MB/);
  const known = new Set(["version", "engine-mb", "command-count", "denied"]);
  for (const f of ["landing.html", "commands.html"])
    for (const m of web(f).matchAll(/\{\{([^}]*)\}\}/g)) assert.ok(known.has(m[1]), `${f}: unknown {{${m[1]}}}`);
});

test("the landing page's links: the editor is ./ , the commands page and the section the editor's banner links to exist", () => {
  const landing = web("landing.html");
  assert.match(landing, /<a class="btn primary try" href=".\/">Open the editor/);
  assert.match(landing, /href="commands.html"/);
  assert.match(landing, /<section class="browsers" id="browsers"/);
  assert.match(web("src/app/env.ts"), /landing\.html/);
});

test("the filter keeps the names that contain what was typed, ignoring case and outer spaces", () => {
  const names = ["regress", "reshape", "summarize", "xtreg"];
  assert.deepEqual(filterNames(names, ""), names);
  assert.deepEqual(
    filterNames(names, "  RE "),
    ["regress", "reshape", "xtreg"].filter((n) => n.includes("re")),
  );
  assert.deepEqual(filterNames(names, "reg"), ["regress", "xtreg"]);
  assert.deepEqual(filterNames(names, "zzz"), []);
});

// ---- clean room (LICENSE-POLICY.md): what the checks can see; the record is in docs/prototype1-plan.md ----

test("clean room: the pages say Stata only as the policy allows, name no real dataset, and keep the trademark line", () => {
  for (const f of ["landing.html", "commands.html"]) {
    const text = web(f);
    assert.match(
      text,
      /Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp\./,
      f,
    );
    assert.doesNotMatch(text, /public CDN|from a CDN/, `${f}: the runtime is the page's own now`);
    assert.doesNotMatch(
      text,
      /\b(auto|nlsw88|census|lifeexp|citytemp)\.dta\b|sysuse|webuse/i,
      `${f}: a Stata example dataset`,
    );
  }
  // the sample: our own comments, our own variable names; no Stata dataset or help text
  for (const f of ["sample/analysis.do", "sample/helpers.do", "sample/make_sample.py"]) {
    const text = web(f);
    assert.doesNotMatch(text, /sysuse|webuse|\bauto\b.*\.dta|nlsw88|census|lifeexp/i, f);
  }
});
