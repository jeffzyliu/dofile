// Prototype 1, step 5: the landing page and its links (docs/design/SPEC.md, sections 3.12 and 8) in real browsers. The
// landing page is static HTML at the site's root, /, the commands page at /commands/, and the editor a single-page app at
// EDITOR_BASE, /app/ today (Playwright's baseURL, so a relative URL is the editor's and an absolute one the site's). The tests
// assert the landing page's own content after each link, not only the URL: a host that answers a missing page with the
// editor would pass a URL check with no landing page.
// Also: the build's numbers in the text, the theme button (one choice for the whole site), the Copy buttons, and axe on the
// real page in both themes (the design checks `npm run axe` etc. read the mockups from file: URLs; the built pages need a
// server, so the same rules run here).
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { EDITOR_BASE } from "../scripts/urls.ts";
import { expect, test } from "./fixtures";

const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;
const landingHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "dofile: run Stata-syntax do-files in your browser" });
/** The visible "Open the editor →": the desktop card's or the phone's hero (the other is display: none). */
const openEditor = (page: Page) => page.getByRole("link", { name: "Open the editor →" }).locator("visible=true");

test("the landing page shows its content, and the pages that do not exist are 404, not the editor", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(landingHeading(page)).toHaveCount(1);
  await expect(page).toHaveTitle(/dofile: run Stata-syntax code in your browser/);
  await expect(page.locator("#browsers")).toContainText("Browsers that work");
  await expect(
    page.getByText("Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp."),
  ).toBeVisible();
  // the version is the package's, not a literal
  await expect(page.locator("body")).toContainText(/\b0\.1\.0\S*/);
  const landing = await request.get("/");
  expect(landing.status()).toBe(200);
  expect(await landing.text()).not.toContain("{{"); // every placeholder is filled by the build
});

test("Open the editor leads to the editor; its wordmark (or, on a phone, About dofile) leads back to the landing page", async ({
  page,
}) => {
  await page.goto("/");
  await openEditor(page).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(EDITOR_BASE);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBeTruthy(); // the editor
  await expect(landingHeading(page)).toHaveCount(0);
  // a first visit: the download prompt is over the page until it is answered, and the sample's analysis.do is open
  await page.getByRole("dialog", { name: "Download the engine?" }).getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".cm-content")).toContainText("A first look at wages, age and schooling");
  if (phone(page)) {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /About dofile/ }).click();
  } else {
    await page.getByRole("link", { name: "dofile", exact: true }).click();
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the other-tab dialog's Close editor leaves for the landing page", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  await page.evaluate(() => {
    const s = (window as any).__dofile.state;
    s.engine.value = { s: "other-tab-idle" };
    s.dialog.value = { d: "other-tab" };
  });
  await page
    .getByRole("alertdialog", { name: "dofile is open in another tab" })
    .getByRole("button", { name: "Close editor" })
    .click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the failed-start banner's Browsers that work opens the landing page's section in a new tab", async ({
  page,
  context,
}) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  await page.evaluate(() => {
    (window as any).__dofile.state.engine.value = {
      s: "failed",
      reason: "no-wasm",
      detail: "",
      message: "This browser has no WebAssembly support.",
    };
  });
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Browsers that work" }).click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/");
  expect(new URL(tab.url()).hash).toBe("#browsers");
  await expect(tab.getByRole("heading", { level: 2, name: "Browsers that work" })).toBeVisible();
  await expect(tab.locator("#browsers")).toBeInViewport();
});

test("the commands page is one link away, and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Commands" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/commands/");
  await expect(page.getByRole("heading", { level: 1, name: "Commands" })).toBeVisible();
  await page.getByRole("link", { name: "dofile", exact: true }).click();
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the download size in the text is the build's: the editor prompt's number, rounded the same way", async ({
  page,
  request,
}) => {
  const list = await (await request.get("start-files.json")).json();
  const mb = String(Math.round(list.compressed / 1e6));
  await page.goto("/");
  const text = (await page.locator("main").textContent()) ?? "";
  const found = [...text.matchAll(/about (\d+) MB/g)].map((m) => m[1]);
  expect(found.length).toBeGreaterThanOrEqual(2);
  for (const n of found) expect(n).toBe(mb);
  expect(await page.locator("main").innerHTML()).not.toMatch(/CDN/);
});

test("the theme button cycles System, Light, Dark; the choice is the editor's too", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: /^Theme:/ });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? null);
  expect(await theme()).toBeNull();
  await expect(button).toHaveAccessibleName("Theme: follows the system. Press for light, then dark.");
  await button.click();
  expect(await theme()).toBe("light");
  await button.click();
  expect(await theme()).toBe("dark");
  await expect(button).toHaveAccessibleName("Theme: dark. Press to follow the system, then light.");
  // the first paint: the inline script in <head> sets it, before any module runs (here no module runs at all)
  await page.route("**/*.js", (route) => route.abort());
  await page.reload();
  expect(await theme()).toBe("dark");
  await expect(button).toBeHidden(); // with no script, no theme button
  await page.unroute("**/*.js");
  await page.goto("?test=manual");
  expect(await theme()).toBe("dark"); // the same key as the editor's button
  await page.goto("/");
  await page.getByRole("button", { name: /^Theme:/ }).click(); // dark -> system
  expect(await theme()).toBeNull();
});

test("Copy: the text is copied, Copied shows beside the button, and the live region says it once", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => (window as any).copied.push(t) },
      configurable: true,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Copy pip install dofile" }).click();
  await expect(page.locator(".copied").first()).toBeVisible();
  await expect(page.locator("#copy-status")).toHaveText("Copied to the clipboard");
  await page.getByRole("button", { name: "Copy the MCP command" }).click();
  const copied = await page.evaluate(() => (window as any).copied);
  expect(copied[0]).toBe("pip install dofile");
  expect(copied[1]).toBe(
    'claude mcp add dofile -- uv run --directory /path/to/dofile --extra mcp dofile-mcp --workdir "$PWD"',
  );
  await expect(page.locator(".copied").first()).toBeHidden({ timeout: 4000 }); // after 2 s
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds nothing on the landing and commands pages, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of ["/", "/commands/"]) {
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`),
        url,
      ).toEqual([]);
    }
  });
}

test("the pages do not scroll sideways at this width, light or in forced colors", async ({ page, browserName }) => {
  for (const url of ["/", "/commands/"]) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
  }
  if (browserName === "webkit") return; // Playwright's forced-colors emulation is not in WebKit
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // the banner takes the system's text color, not the accent (site.css, forced-colors block)
  const same = await page.evaluate(() => {
    const art = document.querySelector(".art-ink:not([hidden])") as HTMLElement;
    return getComputedStyle(art).color === getComputedStyle(document.body).color;
  });
  expect(same).toBe(true);
});

test("the site's addresses: the pages at / and /commands/, the editor at its base, a folder without its slash redirected, a missing or old page a 404, the isolation headers on the editor only", async ({
  request,
}) => {
  const get = (url: string) => request.get(url, { maxRedirects: 0 });
  for (const url of ["/", "/commands/"]) {
    const r = await get(url);
    expect(r.status(), url).toBe(200);
    expect(await r.text(), url).not.toContain("{{");
    expect(r.headers()["content-type"], url).toContain("text/html");
    expect(r.headers()["cross-origin-opener-policy"], `${url}: a static page needs no isolation`).toBeUndefined();
  }
  for (const url of [EDITOR_BASE, `${EDITOR_BASE}?test`, `${EDITOR_BASE}start-files.json`]) {
    const r = await get(url);
    expect(r.status(), url).toBe(200);
    expect(r.headers()["cross-origin-opener-policy"], url).toBe("same-origin");
    expect(r.headers()["cross-origin-embedder-policy"], url).toBe("require-corp");
  }
  expect(await (await get(EDITOR_BASE)).text()).toContain('name="dofile-engine-bytes"'); // the editor's page
  // a folder's other addresses go to the folder, the query kept, as the host does (Cloudflare's auto-trailing-slash)
  for (const [from, to] of [
    [EDITOR_BASE.slice(0, -1), EDITOR_BASE],
    [`${EDITOR_BASE.slice(0, -1)}?test`, `${EDITOR_BASE}?test`],
    [`${EDITOR_BASE}index.html?test`, `${EDITOR_BASE}?test`],
    ["/commands", "/commands/"],
    ["/commands.html", "/commands/"],
    ["/index.html", "/"],
  ]) {
    const r = await get(from);
    expect([301, 302, 307, 308], from).toContain(r.status());
    expect(r.headers().location, from).toBe(to);
  }
  // nothing that is not a page of the site is answered with one: 404, never the editor
  for (const url of ["/nope.html", "/nope/", `${EDITOR_BASE}nope.html`, "/landing.html", "/_headers"])
    expect((await get(url)).status(), url).toBe(404);
});

test("the landing and commands pages load none of the editor's files: only their own script, stylesheet and fonts", async ({
  page,
}) => {
  for (const url of ["/", "/commands/"]) {
    const requested: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path !== "/favicon.ico") requested.push(path); // a browser's own guess, not something the page asks for
    });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    page.removeAllListeners("request");
    expect(requested[0], url).toBe(url);
    const rest = requested.slice(1);
    expect(rest.length, url).toBeGreaterThan(0);
    for (const path of rest) {
      expect(path.startsWith(EDITOR_BASE), `${url} asked for the editor's ${path}`).toBe(false);
      expect(path, url).toMatch(/^\/assets\/[\w.-]+\.(js|css|woff2)$/);
    }
    // the scripts are the pages' own (site.ts with the theme and Copy buttons, and the commands page's filter)
    for (const js of rest.filter((p) => p.endsWith(".js")))
      expect(js, url).toMatch(/^\/assets\/(site|landing|commands)-/);
  }
});

test.describe("with scripts off", () => {
  test.use({ javaScriptEnabled: false });
  test("both pages are complete: every word and link, the whole commands list; no button that needs a script", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(landingHeading(page)).toHaveCount(1);
    await expect(page.locator("#browsers")).toContainText("Browsers that work");
    await expect(openEditor(page)).toHaveAttribute("href", EDITOR_BASE);
    await expect(page.locator("main")).toContainText("pip install dofile");
    await expect(page.getByRole("button")).toHaveCount(0); // Copy and the theme button work only with the script
    await page.goto("/commands/");
    await expect(page.getByRole("heading", { level: 1, name: "Commands" })).toBeVisible();
    await expect(page.locator("#names li")).not.toHaveCount(0);
    await expect(page.locator("#names li:visible")).toHaveCount(await page.locator("#names li").count());
    await expect(page.getByRole("searchbox")).toHaveCount(0); // the filter needs the script
    await expect(page.getByRole("link", { name: "Open the editor" })).toHaveAttribute("href", EDITOR_BASE);
  });
});
