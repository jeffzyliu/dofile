// The landing and commands pages' plain logic (scripts/site-pages.ts, src/site/filter.ts) and what their source says:
// the commands list is made from src/stata/commands.json and nothing else, the placeholders are all known, the numbers
// are the build's, and the clean-room greps.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bigFiles, LIMIT, NEAR } from "../scripts/check-sizes.ts";
import {
  type CommandData,
  canonicalURL,
  commandsHtml,
  deniedInBrowser,
  engineMB,
  fillCommands,
  fillTokens,
  headersFile,
  OWN_PREFIXES,
  sitePageFor,
} from "../scripts/site-pages.ts";
import { problems } from "../scripts/smoke.ts";
import {
  DEV_EDITOR_PORT,
  DEV_SITE_PORT,
  devURL,
  EDITOR_BASE,
  EDITOR_OUT,
  LOCAL_EDITOR_URL,
  LOCAL_SITE_URL,
  PRODUCTION_EDITOR_URL,
  PRODUCTION_SITE_URL,
  SITE_OUT,
} from "../scripts/urls.ts";
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
  const tokens = { version: "9.9.9", engineMB: "50", editorURL: LOCAL_EDITOR_URL };
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
    // a preload's href is a file of the page's own (the build rewrites ./src/ to the hashed asset), not a link
    const preloads = [...html.matchAll(/<link rel="preload" href="([^"]*)"/g)].map((m) => m[1]);
    for (const h of preloads) assert.match(h, /^\.\/src\/styles\/fonts\/[\w-]+\.woff2$/, `${f}: preload ${h}`);
    // so is an icon's (the editor's are checked in the next test)
    const icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]*)"/g)].map((m) => m[1]);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((h) => !preloads.includes(h) && !icons.includes(h));
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

test("the three pages have the same icons, each a file of the page's own (./src/icons/, hashed by the build), and they exist", () => {
  const iconLinks = (html: string) =>
    [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map((m) => m[0]);
  const editor = iconLinks(web("index.html"));
  assert.deepEqual(
    editor.map((l) => l.match(/rel="([^"]*)"/)![1]),
    ["icon", "icon", "apple-touch-icon"],
    "a PNG and an SVG icon, and the apple-touch icon",
  );
  for (const f of ["landing.html", "commands.html"])
    assert.deepEqual(iconLinks(web(f)), editor, `${f}: the editor's icons`);
  for (const l of editor) {
    const href = l.match(/href="([^"]*)"/)![1];
    // relative, never root-absolute: the editor's base is the build's (BASE_URL), and each origin serves its own copy
    assert.match(href, /^\.\/src\/icons\/[\w-]+\.(svg|png)$/, href);
    assert.ok(web(href.slice(2)).length > 0, `${href} exists`);
  }
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
  // a build that is not production's: noindex on every path, in the editor's one block when it is at the root
  assert.doesNotMatch(headersFile("/"), /X-Robots-Tag/, "a production build is indexed");
  assert.match(
    headersFile("/", true),
    /^\/\*\n {2}Cross-Origin-Opener-Policy: same-origin\n {2}Cross-Origin-Embedder-Policy: require-corp\n {2}X-Robots-Tag: noindex$/m,
  );
  assert.equal(headersFile("/", true).match(/^\/\*$/gm)?.length, 1, "one block for every path");
  assert.match(headersFile("/editor/", true), /^\/\*\n {2}X-Robots-Tag: noindex$/m);
  assert.match(headersFile(null, true), /^\/\*\n {2}X-Robots-Tag: noindex\n$/m, "the pages' folder: noindex only");
  assert.doesNotMatch(headersFile(null, true), /Cross-Origin/);
  assert.equal(headersFile(null), "", "the pages' folder of a production build has no headers file");
});

test("a production build's canonical links: each page's production address", () => {
  const [site, editor] = [PRODUCTION_SITE_URL, PRODUCTION_EDITOR_URL];
  assert.equal(canonicalURL("landing.html", site, editor), site);
  assert.equal(canonicalURL("commands.html", site, editor), `${site}commands/`);
  assert.equal(canonicalURL("index.html", site, editor), editor);
});

test("the editor's location is one setting: scripts/urls.ts, read by the config, the e2e config and the scripts", () => {
  // the editor is at the root of its own origin; the two addresses the pages link each other by are whole URLs ending
  // in a slash (links are joined to them), the production ones unless the environment says otherwise
  assert.match(EDITOR_BASE, /^\/(.*\/)?$/);
  assert.match(
    web("scripts/urls.ts"),
    /export const EDITOR_BASE = process\.env\.DOFILE_EDITOR_BASE \?\? "\/(?:[^"]*\/)?";/,
  );
  assert.equal(PRODUCTION_SITE_URL, "https://dofile.dev/");
  assert.equal(PRODUCTION_EDITOR_URL, "https://app.dofile.dev/");
  for (const url of [LOCAL_SITE_URL, LOCAL_EDITOR_URL]) assert.match(url, /^https?:\/\/.*\/$/, url);
  assert.notEqual(LOCAL_SITE_URL, LOCAL_EDITOR_URL, "two origins: the servers need two ports");
  assert.notEqual(DEV_SITE_PORT, DEV_EDITOR_PORT, "two dev servers: two ports");
  for (const f of [
    "vite.config.ts",
    "playwright.config.ts",
    "e2e/global-setup.ts",
    "scripts/start-files.ts",
    "scripts/measure-startup.mjs",
  ])
    assert.match(web(f), /from "\.{1,2}\/(scripts\/)?urls\.ts"/, f);
  // Nothing else spells the editor's path where a program reads it: after a quote, a backquote, `(` (CSS url()) or `=`
  // (an HTML attribute), followed by anything but a letter or digit ("/app/", "/app?test", "/app.html", "/app#x").
  // Comments may name it. Read: the sources (CSS and JSON too), the scripts, the e2e tests, the configs, the pages, the
  // workflows and the local actions (.github/actions/). A path made by joining strings ("/" + "app") is not caught:
  // never write one. The editor is at the root of its own origin, so the check runs on "/app/", where it was before it
  // had an origin.
  const walk = (dir: string): string[] =>
    readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : /\.(ts|tsx|mjs|html|css|json|jsonc|yml)$/.test(e.name)
          ? [`${dir}/${e.name}`]
          : [],
    );
  const files = [
    ...["src", "scripts", "e2e", "../.github/workflows", "../.github/actions"]
      .flatMap(walk)
      .filter((f) => f !== "scripts/urls.ts"),
    ...["vite.config.ts", "playwright.config.ts", "index.html", "landing.html", "commands.html"],
    ...["wrangler.jsonc", "wrangler.app.jsonc", "package.json", "biome.json", "tsconfig.json"],
  ];
  assert.ok(files.length > 50, "the walk found the sources");
  assert.ok(
    files.some((f) => f.endsWith(".css")) && files.some((f) => f.endsWith(".yml")),
    "CSS and workflows are read",
  );
  const path = EDITOR_BASE === "/" ? "/app" : EDITOR_BASE.slice(0, -1);
  const spelled = new RegExp(`["'\`(=]${esc(path)}(?![\\w-])`);
  for (const probe of ['"/app/"', "'/app?test'", "`/app.html`", "url(/app/x.woff2)", "href=/app#x", '"/app"'])
    assert.match(probe.replace("/app", path), spelled, probe);
  assert.doesNotMatch(`"${path}s/"`, spelled, "another name that starts the same");
  for (const f of files) assert.doesNotMatch(web(f), spelled, f);
  // Nor the origins: the production addresses are scripts/urls.ts's, and a link to another origin is made from SITE_URL
  // and EDITOR_URL (the Wrangler configs spell the two domains without a scheme, and a test below compares them)
  const origin = /["'`]https?:\/\/(?:app\.)?dofile\.dev/;
  for (const probe of ['"https://dofile.dev/"', "`https://app.dofile.dev`", "'http://dofile.dev'"])
    assert.match(probe, origin, probe);
  for (const f of files) assert.doesNotMatch(web(f), origin, `${f}: an address of the site's origins`);
  // and no e2e test opens the editor's flags at the site's root when the editor is under a path ("/?test" is the
  // landing page there): the editor's addresses are relative to Playwright's baseURL
  if (EDITOR_BASE !== "/")
    for (const f of files.filter((f) => f.startsWith("e2e/")))
      assert.doesNotMatch(
        web(f),
        /["'`]\/\?(test|sample|snapshot|brotli)\b/,
        `${f}: an editor address at the site's root`,
      );
});

/** Runs `args` in web/ with the environment's DOFILE_URLS, DOFILE_SITE_URL and DOFILE_EDITOR_URL replaced by
 *  `env`'s. */
const withURLs = (env: Record<string, string>, args: string[]) => {
  const inherited: Record<string, string | undefined> = { ...process.env, ...env };
  for (const k of ["DOFILE_URLS", "DOFILE_SITE_URL", "DOFILE_EDITOR_URL"]) if (!(k in env)) delete inherited[k];
  return spawnSync(args[0], args.slice(1), {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: inherited,
    encoding: "utf8",
  });
};

test("the URLs the build is given must end with a slash: a link is joined to them", () => {
  const load = (env: Record<string, string>) =>
    withURLs(env, [process.execPath, "--input-type=module", "-e", 'import "./scripts/urls.ts"']);
  const bad = load({ DOFILE_SITE_URL: "https://x.workers.dev" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /DOFILE_SITE_URL must end with "\/"/);
  assert.match(load({ DOFILE_EDITOR_URL: "https://x.workers.dev" }).stderr, /DOFILE_EDITOR_URL must end with "\/"/);
  // without a scheme the link would be relative, and the build would take both for one origin
  assert.match(load({ DOFILE_EDITOR_URL: "x.workers.dev/" }).stderr, /DOFILE_EDITOR_URL must be a whole http\(s\) URL/);
  assert.match(load({ DOFILE_SITE_URL: "/" }).stderr, /DOFILE_SITE_URL must be a whole http\(s\) URL/);
  assert.equal(
    load({ DOFILE_SITE_URL: "https://x.workers.dev/", DOFILE_EDITOR_URL: "https://y.workers.dev/" }).status,
    0,
  );
});

test("no default addresses: production, local or both URLs, said outright; a build refuses to start without them", () => {
  const urls = (env: Record<string, string>) => {
    const r = withURLs(env, [
      process.execPath,
      "--input-type=module",
      "-e",
      // the module's path as an argument: a test reads `import(` in this file's text as an import of its own
      "const u = await import(process.argv[1]); console.log(JSON.stringify([u.SITE_URL ?? null, u.EDITOR_URL ?? null, u.PRODUCTION]))",
      "./scripts/urls.ts",
    ]);
    return r.status === 0 ? JSON.parse(r.stdout) : r.stderr;
  };
  // nothing (or only empty values: a workflow's input that was not given) is no addresses, and no production build
  assert.deepEqual(urls({}), [null, null, false]);
  assert.deepEqual(urls({ DOFILE_URLS: "", DOFILE_SITE_URL: "", DOFILE_EDITOR_URL: "" }), [null, null, false]);
  assert.deepEqual(urls({ DOFILE_URLS: "production" }), [PRODUCTION_SITE_URL, PRODUCTION_EDITOR_URL, true]);
  assert.deepEqual(urls({ DOFILE_URLS: "local" }), [LOCAL_SITE_URL, LOCAL_EDITOR_URL, false]);
  const pair = {
    DOFILE_SITE_URL: "https://pr-1-dofile.x.workers.dev/",
    DOFILE_EDITOR_URL: "https://pr-1-dofile-app.x.workers.dev/",
  };
  assert.deepEqual(urls(pair), [pair.DOFILE_SITE_URL, pair.DOFILE_EDITOR_URL, false]);
  // the production addresses given one by one are a production build too
  assert.deepEqual(urls({ DOFILE_SITE_URL: PRODUCTION_SITE_URL, DOFILE_EDITOR_URL: PRODUCTION_EDITOR_URL })[2], true);
  assert.match(urls({ DOFILE_URLS: "prod" }), /DOFILE_URLS must be "production" or "local": prod/);
  assert.match(urls({ DOFILE_SITE_URL: pair.DOFILE_SITE_URL }), /go together: give both/);
  assert.match(urls({ DOFILE_EDITOR_URL: pair.DOFILE_EDITOR_URL }), /go together: give both/);
  assert.match(urls({ DOFILE_URLS: "production", ...pair }), /give one or the other/);
  // both builds (the editor's, the pages') stop before they start, with the choices in the message
  const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  for (const mode of [[], ["--mode", "site"]]) {
    const r = withURLs({}, [process.execPath, vite, "build", ...mode, "--outDir", "dist/never-written"]);
    assert.notEqual(r.status, 0, `vite build ${mode.join(" ")}`);
    assert.match(r.stderr + r.stdout, /Say which addresses the two builds link each other by: DOFILE_URLS=production/);
  }
});

test("a dev server finds the other at the host name the browser used, on the other's port", () => {
  assert.equal(devURL("localhost:5174", 5173), "http://localhost:5173/");
  assert.equal(devURL("192.168.1.5:5173", 5174), "http://192.168.1.5:5174/");
  assert.equal(devURL("[::1]:5174", 5173), "http://[::1]:5173/");
  assert.equal(devURL("mac.local", 5174), "http://mac.local:5174/", "a Host header without a port");
});

test("the two Wrangler configs agree with scripts/urls.ts: the folder each Worker serves, its domain, and each other's settings", () => {
  const config = (f: string) => JSON.parse(web(f).replace(/^\s*\/\/.*$/gm, ""));
  const site = config("wrangler.jsonc"),
    app = config("wrangler.app.jsonc");
  assert.equal(site.name, "dofile");
  assert.equal(app.name, "dofile-app");
  assert.equal(site.assets.directory, `./${SITE_OUT}`);
  assert.equal(app.assets.directory, `./${EDITOR_OUT}`);
  // a custom domain is a host name: the production URL's
  assert.deepEqual(site.routes, [{ pattern: new URL(PRODUCTION_SITE_URL).hostname, custom_domain: true }]);
  assert.deepEqual(app.routes, [{ pattern: new URL(PRODUCTION_EDITOR_URL).hostname, custom_domain: true }]);
  // previews are workers.dev addresses; a Worker with routes would not have one unless it says so
  assert.equal(site.workers_dev, true);
  assert.equal(app.workers_dev, true);
  assert.equal(site.compatibility_date, app.compatibility_date);
  assert.equal(site.assets.html_handling, "auto-trailing-slash");
  assert.equal(app.assets.html_handling, site.assets.html_handling);
  assert.equal(site.assets.not_found_handling, "none");
  assert.equal(app.assets.not_found_handling, "none");
});

test("the size check before a deploy: an error over 25 MiB, a warning within 2 MiB of it", () => {
  const dir = mkdtempSync(join(tmpdir(), "dofile-sizes-"));
  try {
    mkdirSync(join(dir, "snapshot"));
    const sized = (name: string, bytes: number) => {
      writeFileSync(join(dir, name), "");
      truncateSync(join(dir, name), bytes); // sparse: no real 25 MB written
    };
    sized("small.js", 1000);
    sized("snapshot/near.br", NEAR + 1);
    sized("snapshot/limit.br", LIMIT);
    sized("snapshot/over.br", LIMIT + 1);
    const found = Object.fromEntries(bigFiles([dir]).map((f) => [relative(dir, f.file), f.over]));
    assert.deepEqual(found, { "snapshot/near.br": false, "snapshot/limit.br": false, "snapshot/over.br": true });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the smoke check after a deploy: both pages 200, the landing page links to the editor, the editor is isolated", async () => {
  const [site, editor] = ["https://pr-1-dofile.x.workers.dev/", "https://pr-1-dofile-app.x.workers.dev/"];
  const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
  const fake =
    (pages: Record<string, Response | Error>): typeof fetch =>
    async (url) => {
      const page = pages[String(url)];
      if (page instanceof Error) throw page;
      return page ?? new Response("", { status: 404 });
    };
  const good = () => ({
    [site]: new Response(`<a class="btn primary try" href="${editor}">Open the editor</a>`),
    [editor]: new Response("<div id=root>", { headers: isolated }),
  });
  assert.deepEqual(await problems(site, editor, fake(good())), []);
  const cases: [Record<string, Response | Error>, RegExp][] = [
    [{ ...good(), [site]: new Response("", { status: 302 }) }, /pr-1-dofile\.x\.workers\.dev\/ answered 302/],
    [{ ...good(), [site]: new Response('<a href="https://elsewhere.example/">') }, /does not link to/],
    [{ ...good(), [editor]: new Response("") }, /Cross-Origin-Opener-Policy is missing/],
    [
      {
        ...good(),
        [editor]: new Response("", { headers: { ...isolated, "Cross-Origin-Embedder-Policy": "credentialless" } }),
      },
      /Cross-Origin-Embedder-Policy is credentialless, not require-corp/,
    ],
    [{ ...good(), [editor]: new Error("getaddrinfo ENOTFOUND") }, /ENOTFOUND/],
  ];
  for (const [pages, wrong] of cases) assert.match((await problems(site, editor, fake(pages))).join("\n"), wrong);
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

// ---- clean room (LICENSE-POLICY.md): what the checks can see ----

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
