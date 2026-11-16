// What the build puts into the landing and commands pages (web/landing.html, web/commands.html), as plain functions so a
// test can run them (test/site.test.ts). vite.config.ts calls them from a plugin.
import { readFileSync } from "node:fs";

export type CommandData = { commands: Record<string, number>; prefixes: string[] };

/** Prefixes the interpreter handles itself (not in the registry); src/stata/language.ts has the same six. */
export const OWN_PREFIXES = ["quietly", "noisily", "capture", "by", "bysort", "version"];

export const engineMB = (bytes: number) => String(Math.round(bytes / 1e6));

/** Each page's source (web/) and the file it is served as, from the site's root. */
export const SITE_FILES: Record<string, string> = {
  "landing.html": "index.html",
  "commands.html": "commands/index.html",
};

/** The page's source for a request path of the site, or null: "/" and "/index.html" the landing page, "/commands/" and
 *  "/commands/index.html" the commands page. The query is not part of `path`. */
export function sitePageFor(path: string): string | null {
  for (const [source, served] of Object.entries(SITE_FILES))
    if (path === `/${served}` || path === `/${served.replace(/index\.html$/, "")}`) return source;
  return null;
}

export function fillTokens(html: string, tokens: { version?: string; engineMB?: string; editorURL?: string }): string {
  let out = html;
  if (tokens.version !== undefined) out = out.replaceAll("{{version}}", tokens.version);
  if (tokens.engineMB !== undefined) out = out.replaceAll("{{engine-mb}}", tokens.engineMB);
  if (tokens.editorURL !== undefined) out = out.replaceAll("{{editor-url}}", tokens.editorURL);
  return out;
}

/** A _headers file (Cloudflare's format), or "" when there is nothing to say.
 *  @param editorBase - the editor's path: cross-origin isolation, which the editor's Break needs, on every file under it
 *  (every path when the editor is at the root of its own origin). null: a folder without the editor.
 *  @param noindex - `X-Robots-Tag: noindex` on every path, for a build that is not production's (a preview, a local
 *  build). In the same block as the isolation when both are on every path. */
export function headersFile(editorBase: string | null, noindex = false): string {
  const rules = new Map<string, string[]>();
  if (editorBase !== null)
    rules.set(`${editorBase}*`, [
      "Cross-Origin-Opener-Policy: same-origin",
      "Cross-Origin-Embedder-Policy: require-corp",
    ]);
  if (noindex) rules.set("/*", [...(rules.get("/*") ?? []), "X-Robots-Tag: noindex"]);
  if (!rules.size) return "";
  const what = [
    editorBase === null ? "" : `the editor (${editorBase}) is cross-origin isolated`,
    noindex ? "a build that is not production's is not indexed" : "",
  ].filter(Boolean);
  let text = `# Made by the build (scripts/site-pages.ts, headersFile): ${what.join("; ")}.\n`;
  for (const [path, headers] of rules) text += `${path}\n${headers.map((h) => `  ${h}\n`).join("")}`;
  return text;
}

/** The address a production build gives a page as its canonical link: the site's address joined to the path a site page
 *  is served at (`SITE_FILES`), else (the editor's index.html) the editor's address. */
export function canonicalURL(source: string, siteURL: string, editorURL: string): string {
  const served = SITE_FILES[source];
  return served === undefined ? editorURL : `${siteURL}${served.replace(/index\.html$/, "")}`;
}

/** The commands src/dofile/browser.py turns off in the page (its DENIED tuple), read from the source text. */
export function deniedInBrowser(
  pySource = readFileSync(new URL("../../src/dofile/browser.py", import.meta.url), "utf8"),
) {
  const m = /^DENIED = \(([^)]*)\)/m.exec(pySource);
  if (!m) throw new Error("site-pages: no DENIED tuple in browser.py");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One name: the part you must type in bold. */
function nameHtml(name: string, min: number): string {
  return min > 0 && min < name.length ? `<b>${esc(name.slice(0, min))}</b>${esc(name.slice(min))}` : esc(name);
}

/** The page's lists: every registry command (those off in the browser marked), and the prefixes. */
export function commandsHtml(data: CommandData, denied: string[]): { list: string; prefixes: string; count: number } {
  const names = Object.keys(data.commands);
  const list = names
    .map((n) => {
      const off = denied.includes(n);
      return `<li data-name="${esc(n)}"${off ? ' class="off"' : ""}><code>${nameHtml(n, data.commands[n])}</code>${off ? ' <span class="note">off in the browser</span>' : ""}</li>`;
    })
    .join("\n");
  const prefixes = [...OWN_PREFIXES, ...data.prefixes.filter((p) => !OWN_PREFIXES.includes(p))]
    .map((p) => `<li data-name="${esc(p)}"><code>${esc(p)}</code></li>`)
    .join("\n");
  return { list, prefixes, count: names.length };
}

/** commands.html with its two placeholders filled. */
export function fillCommands(html: string, data: CommandData, denied: string[]): string {
  const { list, prefixes, count } = commandsHtml(data, denied);
  const off = denied.map((d) => `<code>${esc(d)}</code>`).join(" and ");
  return html
    .replace("<!--COMMANDS-->", list)
    .replace("<!--PREFIXES-->", prefixes)
    .replaceAll("{{command-count}}", String(count))
    .replaceAll("{{denied}}", off);
}
