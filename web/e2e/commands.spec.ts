// Prototype 1, step 5: the commands page (docs/design/SPEC.md, section 3.12, OQ-18) in real browsers. The list is written
// into the page by the build from src/stata/commands.json, so it is there with no script; the script adds the filter.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/stata/commands.json", import.meta.url)), "utf8"),
) as {
  commands: Record<string, number>;
  prefixes: string[];
};
const total = Object.keys(data.commands).length;
const names = (page: Page) => page.locator("#names li:not([hidden])");

test("the page lists every command of the engine's registry, once, in columns", async ({ page }) => {
  await page.goto("/commands/");
  await expect(page.getByRole("heading", { level: 1, name: "Commands" })).toBeVisible();
  await expect(page.locator("#names li")).toHaveCount(total);
  const shown = await page.locator("#names li").evaluateAll((lis) => lis.map((l) => (l as HTMLElement).dataset.name));
  expect(shown).toEqual(Object.keys(data.commands));
  expect(new Set(shown).size).toBe(total);
  await expect(page.locator("main")).toContainText(`The ${total} commands`);
  // columns: the first and the last name of the first screen are not in one column
  const xs = await page
    .locator("#names li")
    .evaluateAll((lis) => [...new Set(lis.map((l) => Math.round(l.getBoundingClientRect().left)))]);
  expect(xs.length).toBeGreaterThan(1);
  // the shortest form is in bold: `regress` can be typed `reg`
  const abbreviation = data.commands.regress;
  await expect(page.locator('#names li[data-name="regress"] b')).toHaveText("regress".slice(0, abbreviation));
  // the prefixes, and the two commands this page switches off
  await expect(page.locator("#prefixes li")).toHaveCount(6 + data.prefixes.length);
  await expect(page.locator('#names li[data-name="shell"]')).toContainText("off in the browser");
  await expect(page.locator('#names li[data-name="webuse"]')).toContainText("off in the browser");
});

test("the filter keeps the names that contain the text, says how many, and brings the list back", async ({ page }) => {
  await page.goto("/commands/");
  const field = page.getByRole("searchbox", { name: "Filter" });
  await expect(field).toBeVisible();
  await field.fill("regress");
  const expected = Object.keys(data.commands).filter((n) => n.includes("regress"));
  await expect(names(page)).toHaveCount(expected.length);
  await expect(names(page).first()).toContainText("regress");
  await expect(page.locator("#count")).toHaveText(`${expected.length} of ${total} commands`);
  await field.fill("  REG ");
  await expect(names(page)).toHaveCount(Object.keys(data.commands).filter((n) => n.includes("reg")).length);
  // a prefix only: the commands' section goes, the prefixes' stays with its note, and the count says both
  await field.fill("quietly");
  await expect(names(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Command names", level: 2 })).toBeHidden();
  await expect(page.locator("#prefixes li:not([hidden])")).toHaveText(["quietly"]);
  await expect(page.getByText("A prefix goes before another command")).toBeVisible();
  await expect(page.locator("#count")).toHaveText(`0 of ${total} commands, 1 prefix`);
  await expect(page.getByText("No command starts with or contains that.")).toBeHidden();
  await field.fill("zzzzz");
  await expect(names(page)).toHaveCount(0);
  await expect(page.getByText("No command starts with or contains that.")).toBeVisible();
  await expect(page.locator("#prefixes")).toBeHidden();
  await expect(page.getByText("A prefix goes before another command")).toBeHidden(); // the note goes with its list
  await field.fill("");
  await expect(names(page)).toHaveCount(total);
  await expect(page.locator("#prefixes")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("");
});

test("the page has no link to a help page, and its text names no Stata manual or help file", async ({ page }) => {
  await page.goto("/commands/");
  const hrefs = await page.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  for (const h of hrefs) expect(new URL(h).hostname).toMatch(/^(localhost|github\.com)$/);
  expect(await page.locator("main").textContent()).not.toMatch(/stata\.com|\.sthlp|\bmanual\b/i);
});
