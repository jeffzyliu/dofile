// Prototype 1, step 5: the sample project (docs/design/SPEC.md, section 3.12; web/sample/) in real browsers. A first visit
// to an empty store writes it and opens analysis.do; a visitor's own files are never written over; "Restore the sample"
// is in the file menu and is an upload of the sample (a file that differs is asked in the clash dialog). The first-visit load is off under `?test` unless the
// URL also has `?sample` (every other spec starts from an empty store). One test runs the sample in the real engine.
import type { Page } from "@playwright/test";
import { EDITOR_BASE } from "../scripts/urls.ts";
import { expect, startEngine, test } from "./fixtures";

// the test hook (window.__dofile) is untyped here: the specs of step 4 declare theirs per file
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;
/** The files in the store (not folders), by path. */
const stored = (page: Page) =>
  page.evaluate(async () =>
    ((await (window as any).__dofile.store.list()) as { path: string; dir: boolean }[])
      .filter((f) => !f.dir)
      .map((f) => f.path)
      .sort(),
  );
const textOf = (page: Page, path: string) =>
  page.evaluate(async (p) => new TextDecoder().decode(await (window as any).__dofile.store.read(p)), path);
const put = (page: Page, path: string, text: string) =>
  page.evaluate(([p, t]) => (window as any).__dofile.store.write(p, new TextEncoder().encode(t)), [path, text]);
const unblocked = (page: Page) => page.waitForFunction(() => (window as any).__dofile.store.blocked === false);

async function menu(page: Page) {
  if (phone(page)) {
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  }
  await page.getByRole("button", { name: "File actions" }).click(); // on a phone the "Files ⋯" button in the strip
  return page.getByRole("menu", { name: "File actions" });
}

const ALL = ["analysis.do", "data/wages.dta", "helpers.do"];

test("a first visit lists the sample and opens its main do-file; a later visit does not write it again", async ({
  page,
}) => {
  await page.goto("?test=manual&sample");
  await unblocked(page);
  await expect.poll(() => stored(page)).toEqual(ALL);
  await expect.poll(() => page.evaluate(() => (window as any).__dofile.state.activeTab.value)).toBe("analysis.do");
  await expect(page.locator(".cm-content")).toContainText("A first look at wages, age and schooling");
  if (phone(page))
    await expect(page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  else
    await expect(
      page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /helpers\.do/ }),
    ).toBeVisible();

  // the visitor deletes one; a reload does not bring it back (the mark is kept), nor does it open the tab again
  await page.evaluate(() => (window as any).__dofile.store.remove("helpers.do"));
  await page.reload();
  await unblocked(page);
  await page.waitForTimeout(500);
  expect(await stored(page)).toEqual(["analysis.do", "data/wages.dta"]);
});

test("never over a visitor's own files, and not under ?test alone", async ({ page }) => {
  await page.goto("?test=manual"); // no ?sample: nothing is written
  await unblocked(page);
  await page.waitForTimeout(500);
  expect(await stored(page)).toEqual([]);
  await put(page, "mine.do", "display 1\n");
  await page.goto("?test=manual&sample"); // not empty: the sample stays out
  await unblocked(page);
  await page.waitForTimeout(500);
  expect(await stored(page)).toEqual(["mine.do"]);
});

test("Restore the sample is an upload of the sample: what is missing comes back with a toast; a changed file is asked about in the clash dialog (Keep mine, Replace with the sample); other files stay; analysis.do opens", async ({
  page,
}) => {
  await page.goto("?test=manual&sample");
  await unblocked(page);
  await expect.poll(() => stored(page)).toEqual(ALL);
  const active = () => page.evaluate(() => (window as any).__dofile.state.activeTab.value);
  await put(page, "mine.do", "display 1\n");
  await page.evaluate(() => (window as any).__dofile.store.remove("helpers.do"));
  await expect.poll(() => stored(page)).toEqual(["analysis.do", "data/wages.dta", "mine.do"]);
  const restore = async () => (await menu(page)).getByRole("menuitem", { name: "Restore the sample" }).click();
  // the visitor is in mine.do when they restore
  await (await menu(page)).press("Escape");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /mine\.do/ })
    .click();
  await expect.poll(active).toBe("mine.do");

  // it sits above "Delete all files…"
  const items = await (await menu(page)).getByRole("menuitem").allInnerTexts();
  expect(items.indexOf("Restore the sample")).toBeGreaterThan(-1);
  expect(items.indexOf("Restore the sample")).toBe(items.findIndex((t) => t.startsWith("Delete all files")) - 1);
  await page.getByRole("menuitem", { name: "Restore the sample" }).click();
  await expect(page.locator(".toast")).toHaveText("Sample restored");
  expect(await stored(page)).toEqual([...ALL, "mine.do"].sort());
  expect(await textOf(page, "mine.do")).toBe("display 1\n");
  await expect.poll(active).toBe("analysis.do"); // the sample's main do-file is shown, mine.do stays open

  // nothing differs, nothing is missing: not asked, not written
  await restore();
  await expect(page.locator(".toast")).toHaveText("The sample is already here");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // a file of the sample the visitor changed: asked first, in the clash dialog with the sample's words
  await put(page, "helpers.do", "* mine\n");
  await restore();
  const dlg = page.getByRole("alertdialog", { name: "helpers.do differs from the sample" });
  await expect(dlg).toContainText("clash 1 of 1");
  await expect(dlg.getByRole("button", { name: "Keep mine" })).toBeFocused();
  await dlg.getByRole("button", { name: "Keep mine" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await textOf(page, "helpers.do")).toBe("* mine\n");
  await restore();
  await dlg.getByRole("button", { name: "Replace with the sample" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("Sample restored");
  await expect.poll(() => textOf(page, "helpers.do")).toContain("a small program that compares");
  expect(await textOf(page, "mine.do")).toBe("display 1\n");
});

test("the sample runs in the real engine to a table and a graph", async ({ page }) => {
  await page.goto("?test&sample");
  expect(new URL(page.url()).pathname).toBe(EDITOR_BASE); // the editor at its own path, under the landing page
  await unblocked(page);
  await expect.poll(() => stored(page)).toEqual(ALL);
  await startEngine(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 300_000 })
    .toBe("ready");
  const r = await page.evaluate(async () => {
    const w = (window as any).__dofile;
    const text = new TextDecoder().decode(await w.store.read("analysis.do"));
    const r = await w.run(text);
    return r && { rc: r.rc, log: r.log as string, images: r.images.length };
  });
  expect(r?.rc).toBe(0);
  expect(r?.images).toBe(1);
  expect(r?.log).toContain("Number of obs   =       500");
  expect(r?.log).toMatch(/difference:\s+-1\.17/);
});

test.describe("where the browser does not keep storage", () => {
  test.use({ persisted: false }); // the browser's own answers: persisted() is false in a test browser
  test("the sample's first write brings no storage banner; the visitor's own change does", async ({ page }) => {
    await page.goto("?test=manual&sample");
    await unblocked(page);
    await expect.poll(() => stored(page)).toEqual(ALL);
    await page.waitForTimeout(500);
    const banner = page.getByText("This browser may clear your files");
    await expect(banner).toHaveCount(0);
    await put(page, "mine.do", "display 1\n");
    await expect(banner).toBeVisible();
  });
});
