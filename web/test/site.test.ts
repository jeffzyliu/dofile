// The landing and commands pages' plain logic (scripts/site-pages.ts, src/site/filter.ts) and what their source says:
// the commands list is made from src/stata/commands.json and nothing else, the placeholders are all known, the
// numbers are the build's, and the clean-room greps (docs/prototype1-plan.md, "Clean-room check of the site's text").

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CommandData,
  commandsHtml,
  deniedInBrowser,
  engineMB,
  fillCommands,
  fillTokens,
  headersFile,
  OWN_PREFIXES,
  sitePageFor,
} from "../scripts/site-pages.ts";
import { EDITOR_BASE, EDITOR_URL, SITE_URL } from "../scripts/urls.ts";
import { countText, filterNames } from "../src/site/filter.ts";
import data from "../src/stata/commands.json" with { type: "json" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
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
  const tokens = { version: "9.9.9", engineMB: "50", editorURL: EDITOR_URL };
  const commands = fillCommands(fillTokens(web("commands.html"), tokens), data as CommandData, ["shell", "webuse"]);
  assert.doesNotMatch(commands, /\{\{|<!--COMMANDS-->|<!--PREFIXES-->/);
  const landing = fillTokens(web("landing.html"), tokens);
  assert.doesNotMatch(landing, /\{\{/);
  assert.match(landing, /about 50 MB/);
  const known = new Set(["version", "engine-mb", "editor-url", "command-count", "denied"]);
  for (const f of ["landing.html", "commands.html"])
    for (const m of web(f).matchAll(/\{\{([^}]*)\}\}/g)) assert.ok(known.has(m[1]), `${f}: unknown {{${m[1]}}}`);
});

test("the pages' links: the editor's address from the build, the site's pages by absolute path, the section the editor's banner links to", () => {
  for (const f of ["landing.html", "commands.html"]) {
    const html = web(f);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const h of hrefs)
      assert.ok(
        ["/", "/commands/", "{{editor-url}}"].includes(h) || h.startsWith("https://"),
        `${f}: ${h} (the site's pages are / and /commands/; the editor's address is the build's)`,
      );
    assert.ok(hrefs.includes("{{editor-url}}"), `${f} links to the editor`);
  }
  assert.match(web("landing.html"), /<section class="browsers" id="browsers"/);
  assert.match(web("src/app/env.ts"), /LANDING_URL = __SITE_URL__/);
  assert.match(web("src/app/states/banners.tsx"), /BROWSERS_URL = `\$\{LANDING_URL\}#browsers`/);
});

test("where each page is served, and the headers file: isolation on the editor's path only", () => {
  assert.equal(sitePageFor("/"), "landing.html");
  assert.equal(sitePageFor("/index.html"), "landing.html");
  assert.equal(sitePageFor("/commands/"), "commands.html");
  assert.equal(sitePageFor("/commands/index.html"), "commands.html");
  for (const p of [
    "/commands",
    "/commands.html",
    "/landing.html",
    "/nope/",
    ...(EDITOR_BASE === "/" ? [] : [EDITOR_BASE]),
  ])
    assert.equal(sitePageFor(p), null, p);
  const rule = (base: string) =>
    new RegExp(
      `^${esc(base)}\\*\\n {2}Cross-Origin-Opener-Policy: same-origin\\n {2}Cross-Origin-Embedder-Policy: require-corp$`,
      "m",
    );
  assert.match(headersFile("/editor/"), rule("/editor/"));
  assert.doesNotMatch(headersFile("/editor/"), /^\/\*$/m, "no rule for the whole site");
  assert.match(headersFile(EDITOR_BASE), rule(EDITOR_BASE));
  assert.match(headersFile("/"), rule("/"), "an editor at the root of its own origin: every path");
});

test("the editor's location is one setting: scripts/urls.ts, read by the config, the e2e config and the scripts", () => {
  // the defaults follow the setting: a path with a slash at each end, the links the same origin's unless the environment
  // gives whole URLs (so moving the editor to another path is a change of EDITOR_BASE alone)
  assert.match(EDITOR_BASE, /^\/(.*\/)?$/);
  assert.match(web("scripts/urls.ts"), /export const EDITOR_BASE = process\.env\.DOFILE_EDITOR_BASE \?\? "\/[^"]*\/";/);
  assert.equal(EDITOR_URL, process.env.DOFILE_EDITOR_URL ?? EDITOR_BASE);
  assert.equal(SITE_URL, process.env.DOFILE_SITE_URL ?? "/");
  for (const f of [
    "vite.config.ts",
    "playwright.config.ts",
    "e2e/global-setup.ts",
    "scripts/start-files.ts",
    "scripts/measure-startup.mjs",
  ])
    assert.match(web(f), /from "\.{1,2}\/(scripts\/)?urls\.ts"/, f);
  // Nothing else spells the editor's path where a program reads it: after a quote, a backquote, `(` (CSS url()) or `=` (an
  // HTML attribute), followed by anything but a letter or digit ("/app/", "/app?test", "/app.html", "/app#x"). Comments may
  // name it. Read: the sources (CSS and JSON too), the scripts, the e2e tests, the configs, the pages and the workflows.
  // A path made by joining strings ("/" + "app") is not caught: never write one.
  if (EDITOR_BASE === "/") return; // the editor at the root of its own origin: nothing to spell
  const walk = (dir: string): string[] =>
    readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : /\.(ts|tsx|mjs|html|css|json|jsonc|yml)$/.test(e.name)
          ? [`${dir}/${e.name}`]
          : [],
    );
  const files = [
    ...["src", "scripts", "e2e", "../.github/workflows"].flatMap(walk).filter((f) => f !== "scripts/urls.ts"),
    ...["vite.config.ts", "playwright.config.ts", "index.html", "landing.html", "commands.html", "wrangler.jsonc"],
    ...["package.json", "biome.json", "tsconfig.json"],
  ];
  assert.ok(files.length > 50, "the walk found the sources");
  assert.ok(
    files.some((f) => f.endsWith(".css")) && files.some((f) => f.endsWith(".yml")),
    "CSS and workflows are read",
  );
  const spelled = new RegExp(`["'\`(=]${esc(EDITOR_BASE.slice(0, -1))}(?![\\w-])`);
  for (const probe of ['"/app/"', "'/app?test'", "`/app.html`", "url(/app/x.woff2)", "href=/app#x", '"/app"'])
    assert.match(probe.replace("/app", EDITOR_BASE.slice(0, -1)), spelled, probe);
  assert.doesNotMatch(`"${EDITOR_BASE.slice(0, -1)}s/"`, spelled, "another name that starts the same");
  for (const f of files) assert.doesNotMatch(web(f), spelled, f);
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

test("the filter's count names the commands of the total and, when there are any, the prefixes shown", () => {
  assert.equal(countText("", 515, 515, 18), "", "nothing typed: no count");
  assert.equal(countText("  ", 515, 515, 18), "");
  assert.equal(countText("regress", 9, 515, 0), "9 of 515 commands");
  assert.equal(countText("quietly", 0, 515, 1), "0 of 515 commands, 1 prefix");
  assert.equal(countText("reg", 30, 515, 2), "30 of 515 commands, 2 prefixes");
});

test("the theme button of the landing and commands pages has the editor's words, order and key", async () => {
  const app = await import("../src/app/theme.ts");
  const site = await import("../src/site/theme.ts");
  assert.deepEqual(site.WORD, app.THEME_LABEL);
  assert.deepEqual(site.ARIA, app.THEME_ARIA);
  assert.deepEqual(site.NEXT, app.THEME_NEXT);
  assert.match(web("src/app/theme.ts"), new RegExp(`saved\\.set\\("${site.KEY}"`));
  // the pages' first-paint script reads the same key
  for (const f of ["landing.html", "commands.html", "index.html"])
    assert.ok(web(f).includes(`localStorage.getItem("${site.KEY}")`), f);
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
  // all five: no manual, no help file or ado-file, no link to StataCorp's site
  for (const f of ["landing.html", "commands.html", "sample/analysis.do", "sample/helpers.do", "sample/make_sample.py"])
    assert.doesNotMatch(web(f), /\bmanuals?\b|\.sthlp\b|\.ado\b|stata\.com/i, f);
});
