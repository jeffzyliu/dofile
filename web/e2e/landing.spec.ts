// Prototype 1, step 5: the landing page and its links (docs/design/SPEC.md, section 3.12) in real browsers. The landing page
// is static HTML at /landing.html; the editor is the page at /. The tests assert the landing page's own content after each
// link, not only the URL: a host that answers a missing page with the editor would pass a URL check with no landing page.
// Also: the build's numbers in the text, the theme button (one choice for the whole site), the Copy buttons, and axe on the
// real page in both themes (the design checks `npm run axe` etc. read the mockups from file: URLs; the built pages need a
// server, so the same rules run here).
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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
  await page.goto("/landing.html");
  await expect(landingHeading(page)).toHaveCount(1);
  await expect(page).toHaveTitle(/dofile: run Stata-syntax code in your browser/);
  await expect(page.locator("#browsers")).toContainText("Browsers that work");
  await expect(
    page.getByText("Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp."),
  ).toBeVisible();
  // the version is the package's, not a literal
  await expect(page.locator("body")).toContainText(/\b0\.1\.0\S*/);
  expect((await request.get("/nope.html")).status()).toBe(404);
  const landing = await request.get("/landing.html");
  expect(landing.status()).toBe(200);
  expect(landing.headers()["cross-origin-opener-policy"]).toBe("same-origin"); // the site's headers are on every page
  expect(await landing.text()).not.toContain("{{"); // every placeholder is filled by the build
});

test("Open the editor leads to the editor; its wordmark (or, on a phone, About dofile) leads back to the landing page", async ({
  page,
}) => {
  await page.goto("/landing.html");
  await openEditor(page).click();
  await expect(page).toHaveURL(/\/$/);
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
  await expect(page).toHaveURL(/\/landing\.html$/);
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the other-tab dialog's Close editor leaves for the landing page", async ({ page }) => {
  await page.goto("/?test=manual");
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
  await expect(page).toHaveURL(/\/landing\.html$/);
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the failed-start banner's Browsers that work opens the landing page's section in a new tab", async ({
  page,
  context,
}) => {
  await page.goto("/?test=manual");
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
  expect(new URL(tab.url()).pathname).toBe("/landing.html");
  expect(new URL(tab.url()).hash).toBe("#browsers");
  await expect(tab.getByRole("heading", { level: 2, name: "Browsers that work" })).toBeVisible();
  await expect(tab.locator("#browsers")).toBeInViewport();
});

test("the commands page is one link away, and back", async ({ page }) => {
  await page.goto("/landing.html");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Commands" }).click();
  await expect(page).toHaveURL(/\/commands\.html$/);
  await expect(page.getByRole("heading", { level: 1, name: "Commands" })).toBeVisible();
  await page.getByRole("link", { name: "dofile", exact: true }).click();
  await expect(landingHeading(page)).toHaveCount(1);
});

test("the download size in the text is the build's: the editor prompt's number, rounded the same way", async ({
  page,
  request,
}) => {
  const list = await (await request.get("/start-files.json")).json();
  const mb = String(Math.round(list.compressed / 1e6));
  await page.goto("/landing.html");
  const text = (await page.locator("main").textContent()) ?? "";
  const found = [...text.matchAll(/about (\d+) MB/g)].map((m) => m[1]);
  expect(found.length).toBeGreaterThanOrEqual(2);
  for (const n of found) expect(n).toBe(mb);
  expect(await page.locator("main").innerHTML()).not.toMatch(/CDN/);
});

test("the theme button cycles System, Light, Dark; the choice is the editor's too", async ({ page }) => {
  await page.goto("/landing.html");
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
  await page.goto("/?test=manual");
  expect(await theme()).toBe("dark"); // the same key as the editor's button
  await page.goto("/landing.html");
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
  await page.goto("/landing.html");
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
    for (const url of ["/landing.html", "/commands.html"]) {
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
  for (const url of ["/landing.html", "/commands.html"]) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
  }
  if (browserName === "webkit") return; // Playwright's forced-colors emulation is not in WebKit
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/landing.html");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // the banner takes the system's text color, not the accent (site.css, forced-colors block)
  const same = await page.evaluate(() => {
    const art = document.querySelector(".art-ink:not([hidden])") as HTMLElement;
    return getComputedStyle(art).color === getComputedStyle(document.body).color;
  });
  expect(same).toBe(true);
});
