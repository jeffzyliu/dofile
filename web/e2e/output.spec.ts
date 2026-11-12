// Prototype 1, step 4c, in real browsers: the Output tabs (Graph, Data, Results), the full-size graph view and a .dta file's
// tab (docs/design/SPEC.md, sections 3.7 to 3.9 and 3.11; src/app/output/). Step 4a's openFile and 4b's editor are not
// built when this is written, so the tests reach the page through its test hook: `run` runs code through the run
// controller, `state` holds the signals (a test sets `tabs`, `activeTab`, `phoneTab` and `graphFull` itself, which
// views may write). The clipboard is replaced by a recorder in every page (reading the real one needs a permission each
// browser handles its own way), so a test reads what the page copied.
//  - The empty states and a .dta tab with no engine need none: `?test=manual`.
//  - Everything else is one test with an engine (each start costs a while): one run draws three graphs, fits a model and
//    leaves a wide dataset, and the tabs are checked against that. On the phone profile there is no Graph tab (graphs
//    show in the log, 4b), so only the full-size view is checked there, opened through `graphFull`.
import type { Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  run(code: string): Promise<{ rc: number; log: string; error: string | null } | null>;
  store: { blocked: boolean; write(path: string, data: Uint8Array): Promise<unknown> };
  state: any; // the signals of src/app/state.ts
};
declare global {
  interface Window {
    __dofile: Hook;
    __copied: string[];
  }
}

const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.addInitScript(() => {
    const copied: string[] = [];
    window.__copied = copied;
    const recorder = {
      writeText: async (text: string) => {
        copied.push(text);
      },
      write: async (items: unknown[]) => {
        copied.push(`image:${items.length}`);
      },
    };
    Object.defineProperty(navigator, "clipboard", { value: recorder, configurable: true });
  });
});

/** Show an Output tab: the Output tablist on a desktop, the phone's bottom bar (its `phoneTab` signal) on a phone. */
async function showTab(page: Page, tab: "graph" | "data" | "results") {
  if (phone(page)) await page.evaluate((t) => (window.__dofile.state.phoneTab.value = t), tab);
  else await page.getByRole("tab", { name: tab[0].toUpperCase() + tab.slice(1), exact: true }).click();
}
const copied = (page: Page) => page.evaluate(() => window.__copied);
const logLength = (page: Page) => page.evaluate(() => window.__dofile.state.log.value.length);
async function ready(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 300_000 })
    .toBe("ready");
}
async function run(page: Page, code: string) {
  const r = await page.evaluate((code) => window.__dofile.run(code), code);
  expect(r, "the engine was ready").not.toBeNull();
  expect(r!.rc, r!.log.slice(-1500)).toBe(0);
}

test("the empty states, and the reset wording of the Data tab", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  if (!phone(page)) {
    await showTab(page, "graph");
    await expect(page.getByText("No graphs yet")).toBeVisible();
    await expect(page.locator(".empty code")).toHaveText("scatter wage educ");
    await expect(page.getByText("A .png from the file list opens here too.", { exact: false })).toBeVisible();
  }
  await showTab(page, "data");
  await expect(page.getByText("No data in memory")).toBeVisible();
  await expect(page.getByText("Load a .dta from the file list, or run", { exact: false })).toBeVisible();
  await page.evaluate(() => window.__dofile.state.addBanner({ b: "reset", reason: "test", kind: "user" }));
  await expect(page.getByText("The engine was reset, so no data is in memory")).toBeVisible();
  await showTab(page, "results");
  await expect(page.getByText("No results yet")).toBeVisible();
  await expect(page.getByText("e() and r() appear after an estimation", { exact: false })).toBeVisible();
});

test("a .png from the files is on the light card in the dark theme: its colors are its own", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await page.evaluate(async () => {
    window.__dofile.state.theme.value = "dark";
    await window.__dofile.store.write("g.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
  });
  if (phone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^g\.png/ })
    .click();
  // desktop: the Graph tab; phone: the full-size view
  const card = phone(page) ? page.locator(".viewer .graph-card") : page.locator(".graph-wrap .graph-card");
  await expect(card).toHaveAttribute("data-theme", "light");
});

test("a .dta tab whose name a command can't hold says so, and Load and Copy are off", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await page.evaluate(async () => {
    await window.__dofile.store.write("a`b'.dta", new Uint8Array(16));
    const s = window.__dofile.state;
    s.tabs.value = [{ path: "a`b'.dta", kind: "dta", dirty: false }];
    s.activeTab.value = "a`b'.dta";
    s.phoneTab.value = "editor";
  });
  const view = page.locator(".dta-view");
  await expect(view.locator(".why")).toHaveText(
    "Its name has a character a command can't hold: rename the file to use it here.",
  );
  await expect(view.locator(".cmd")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Load" })).toBeDisabled();
  await expect(view.getByRole("button", { name: "Copy the use command" })).toBeDisabled();
});

test("a .dta tab with no engine shows its two bars, copies the use command, and no table", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await page.evaluate(() => window.__dofile.store.write("data/wages.dta", new Uint8Array(2048)));
  await expect
    .poll(() =>
      page.evaluate(() => window.__dofile.state.files.value.some((f: { path: string }) => f.path === "data/wages.dta")),
    )
    .toBe(true);
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.tabs.value = [{ path: "data/wages.dta", kind: "dta", dirty: false }];
    s.activeTab.value = "data/wages.dta";
    s.phoneTab.value = "editor";
  });
  const view = page.locator(".dta-view");
  await expect(view.locator(".bar").first()).toHaveText("data/wages.dta · 2 KB"); // 2048 bytes, as the file tree says
  await expect(view.locator(".cmd")).toHaveText('use "data/wages.dta", clear');
  await expect(view.getByRole("button", { name: "Load" })).toBeEnabled(); // the prompt opens when it is pressed, so it is not pressed here
  await expect(view.locator("table")).toHaveCount(0);
  await view.getByRole("button", { name: "Copy the use command" }).click();
  expect(await copied(page)).toEqual(['use "data/wages.dta", clear']);
  await expect(page.locator(".toast")).toHaveText("Copied");
});

test("the Graph, Data and Results tabs and a .dta tab, after a run through the hook", async ({ page }) => {
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  const note = "abcdefghij".repeat(10); // 100 characters: more than Browse shows in a cell
  await run(
    page,
    [
      "clear",
      "set seed 7",
      "set obs 160",
      "generate age = 22 + floor(40*runiform())",
      "generate educ = 10 + floor(9*runiform())",
      "generate wage = 4 + .12*age + .9*educ + 3*rnormal()",
      'label variable wage "Hourly wage"',
      'generate str20 name = "n" + string(_n)',
      `generate str100 note = "${note}"`,
      "forvalues i = 1/30 {",
      "  generate zz`i' = `i'",
      "}",
      "local controls age educ",
      "global mygl 5",
      "regress wage `controls'",
      "histogram wage",
      "forvalues i = 1/2 {",
      "  scatter wage educ",
      "}",
    ].join("\n"),
  );

  // ---- Graph, and the full-size view ----
  if (!phone(page)) {
    await showTab(page, "graph");
    const img = page.locator(".graph-wrap .graph-card img");
    await expect(img).toHaveAttribute("alt", "Graph 3: scatter wage educ"); // two graphs share a command: the number is added
    await expect(page.locator(".foot-title")).toHaveText("graph 3 of 3 · scatter wage educ");
    await expect(page.locator(".graph-foot .thumb")).toHaveCount(3);
    await page.locator(".graph-foot .thumb").first().click();
    await expect(img).toHaveAttribute("alt", "Graph: histogram wage");
    await expect(page.locator(".foot-title")).toHaveText("graph 1 of 3 · histogram wage");
    await expect(page.locator(".graph-foot .thumb").first()).toHaveAttribute("aria-current", "true");
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth > 0)).toBe(true);

    const open = page.getByRole("button", { name: "Open full size" });
    await open.click();
    const viewer = page.getByRole("dialog", { name: "Full-size graph" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator(".vtitle")).toHaveText("graph 1 of 3 · histogram wage");
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator(".vtitle")).toHaveText("graph 2 of 3 · scatter wage educ");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // the last: it does not wrap
    await expect(viewer.locator(".vtitle")).toHaveText("graph 3 of 3 · scatter wage educ");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.locator(".vtitle")).toHaveText("graph 2 of 3 · scatter wage educ");
    await expect(page.locator('.visually-hidden[role="status"]')).toHaveText(/Graph 2: scatter wage educ$/); // said
    const copyImage = viewer.getByRole("button", { name: "Copy image" });
    if (await copyImage.isEnabled()) {
      // off in a browser that cannot put an image on the clipboard: a click would wait for it to be enabled
      await copyImage.click();
      await expect(viewer.locator(".vsaid")).toHaveText("Copied");
      expect(await copied(page)).toContain("image:1");
      await expect(page.locator(".toast")).toBeVisible(); // the toast shows over the view, not under it
    }
    const download = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Export PNG" }).click();
    expect((await download).suggestedFilename()).toBe("graph-2.png");
    // Tab stays inside the view
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".viewer") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => window.__dofile.state.graphIndex.value)).toBe(1);
  } else {
    await page.evaluate(() => {
      window.__dofile.state.graphFull.value = true;
    });
    const viewer = page.getByRole("dialog", { name: "Full-size graph" });
    await expect(viewer.locator(".vtitle")).toHaveText("graph 3 of 3 · scatter wage educ");
    await expect(viewer.getByRole("button", { name: "Next" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Previous" }).click();
    await expect(viewer.locator(".vtitle")).toHaveText("graph 2 of 3 · scatter wage educ");
    await expect(viewer.locator(".graph-card img")).toHaveAttribute("alt", "Graph 2: scatter wage educ");
    await viewer.getByRole("button", { name: /^Close/ }).click();
    await expect(viewer).toHaveCount(0);
  }

  // ---- Data ----
  await showTab(page, "data");
  const facts = page.locator(".facts");
  await expect(facts).toContainText("160 obs");
  await expect(facts).toContainText("35 vars");
  await expect(facts).toContainText("in memory");
  await expect(facts).not.toContainText("from"); // made by the code, not loaded from a file
  const names = page.locator(".t button.var");
  await expect(names).toHaveCount(35);
  const filter = page.getByLabel("Filter variables");
  await filter.fill("hourly");
  await expect(names).toHaveText(["wage"]);
  await filter.fill("nothing like it");
  await expect(page.getByText("No variable matches the filter")).toBeVisible();
  await filter.fill("");
  await expect(names).toHaveCount(35);
  // one name is in the tab order; arrows move the focus without picking
  await expect(page.locator(".t button.var[tabindex='0']")).toHaveCount(1);
  await names.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(names.nth(1)).toBeFocused();
  await expect(page.locator(".t tr.picked")).toHaveCount(0);
  // Browse: 50 of 160 rows, read only
  const subhead = page.locator(".subhead", { hasText: "Browse" });
  await expect(subhead).toContainText("first 50 of 160 rows · read only");
  await expect(page.locator(".grid tbody tr")).toHaveCount(50);
  // a long cell is cut, and shows whole when pressed
  const cut = page.locator(".cell-cut").first();
  await expect(cut).toHaveText(/…$/);
  expect((await cut.textContent())!.length).toBeLessThan(note.length);
  await cut.click();
  await expect(cut).toHaveAttribute("aria-expanded", "true");
  await expect(cut).toHaveText(note);
  await cut.click();
  await expect(cut).toHaveAttribute("aria-expanded", "false");
  // picking a name marks and scrolls to its column, and runs nothing
  const before = {
    log: await logLength(page),
    history: await page.evaluate(() => window.__dofile.state.history.value.length),
  };
  await page.locator(".t button.var", { hasText: "zz30" }).click();
  await expect(page.locator(".t button.var[aria-current='true']")).toHaveText("zz30");
  await expect(page.locator(".grid th.picked")).toHaveText("zz30");
  await expect.poll(() => page.locator(".grid-wrap").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await logLength(page)).toBe(before.log);
  expect(await page.evaluate(() => window.__dofile.state.history.value.length)).toBe(before.history);
  // "Show 50 more" adds rows and runs nothing
  await page.getByRole("button", { name: "Show 50 more" }).click();
  await expect(page.locator(".grid tbody tr")).toHaveCount(100);
  await expect(subhead).toContainText("first 100 of 160 rows");
  expect(await logLength(page)).toBe(before.log);
  // the tab keeps its state when it is shown again
  await showTab(page, "results");
  await showTab(page, "data");
  await expect(page.locator(".t button.var[aria-current='true']")).toHaveText("zz30");
  await expect(page.locator(".grid tbody tr")).toHaveCount(100);

  // ---- Results ----
  await showTab(page, "results");
  const sect = page.locator(".rs .sect");
  await expect(sect.first()).toContainText("e() · regress");
  await expect(sect.first()).toContainText("changed by the last run");
  await expect(sect.nth(1)).toContainText("r()"); // histogram sets r() too
  await expect(sect.nth(2)).toHaveText("Locals and globals");
  await expect(page.getByRole("button", { name: /^Scalars/ }).first()).toHaveAttribute("aria-expanded", "true"); // e(): open
  await expect(page.getByRole("button", { name: /^Matrices/ }).first()).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^Locals/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /^Globals/ })).toContainText("set by the system");
  await expect(page.locator(".rs .row", { hasText: "`controls'" })).toContainText("age educ");
  // a value: 8 digits, every digit when focused, copied whole
  const n = page.getByRole("button", { name: "e(N): 160" });
  await n.click();
  expect((await copied(page)).at(-1)).toBe("160");
  await expect(page.locator(".toast")).toHaveText("Copied");
  const r2 = page.locator(".rs button.val[aria-label^='e(r2):']");
  const short = (await r2.textContent())!;
  expect(short.length).toBeLessThanOrEqual(10);
  await r2.focus();
  // the focused row's "↵ Copy": in sight on the desktop; a phone hides it (a tap copies, and the toast says so)
  const copyHint = page.locator(".rs .focusrow .hint");
  await expect(copyHint).toHaveText("↵ Copy");
  if (phone(page)) await expect(copyHint).toBeHidden();
  else await expect(copyHint).toBeVisible();
  const whole = (await r2.textContent())!;
  expect(whole.length).toBeGreaterThan(short.length);
  await page.keyboard.press("Enter");
  expect((await copied(page)).at(-1)).toBe(whole);
  await n.focus();
  await page.keyboard.press("ControlOrMeta+c");
  expect((await copied(page)).at(-1)).toBe("160");
  // one value in the tab order; arrows move
  await expect(page.locator(".rs button.val[tabindex='0']")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-key"))).not.toBe("e(N)");
  // a matrix: View opens it in place, Hide folds it, the size copies it as tab-separated text
  const log = await logLength(page);
  await page
    .getByRole("button", { name: /^Matrices/ })
    .first()
    .click();
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "e(b): 1 x 3" })).toBeVisible();
  await page.getByRole("button", { name: "View e(b)" }).click();
  const grid = page.locator(".rs .mat table.grid");
  await expect(grid.locator("th")).toHaveText(["Row", "age", "educ", "_cons"]);
  await expect(grid.locator("tbody tr")).toHaveCount(1);
  expect(await logLength(page)).toBe(log);
  await page.getByRole("button", { name: "e(b): 1 x 3" }).click();
  expect((await copied(page)).at(-1)).toMatch(/^\tage\teduc\t_cons\n\S+\t[-.\d]+\t[-.\d]+\t[-.\d]+$/);
  await page.getByRole("button", { name: "Hide e(b)" }).click();
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  // an open matrix closes when another run replaces the results
  await page.getByRole("button", { name: "View e(b)" }).click();
  await expect(grid).toBeVisible();
  await run(page, "quietly summarize wage");
  await showTab(page, "results");
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View e(b)" })).toBeVisible();
  await expect(sect.filter({ hasText: /^r\(\)/ })).toHaveCount(1);

  // ---- a .dta tab, with an engine ----
  await run(page, 'save "wages.dta", replace\nclear');
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.tabs.value = [{ path: "wages.dta", kind: "dta", dirty: false }];
    s.activeTab.value = "wages.dta";
    s.phoneTab.value = "editor";
  });
  const view = page.locator(".dta-view");
  await expect(view.locator(".bar").first()).toContainText("wages.dta · 160 obs · 35 vars");
  await expect(view.locator("tbody tr")).toHaveCount(35);
  await expect(view.locator("tbody tr").nth(2)).toContainText("Hourly wage");
  await expect(view.getByText("the data in memory is untouched until you press Load.", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => window.__dofile.state.data.value.nvars),
    "describe_file leaves the data in memory",
  ).toBe(0);
  await view.getByRole("button", { name: "Copy the use command" }).click();
  expect((await copied(page)).at(-1)).toBe('use "wages.dta", clear');
  await view.getByRole("button", { name: "Load" }).click();
  await expect(page.locator(".toast")).toHaveText("Loaded wages.dta");
  expect(await page.evaluate(() => window.__dofile.state.history.value.at(-1))).toBe('use "wages.dta", clear');
  await showTab(page, "data");
  await expect(page.locator(".facts")).toContainText("160 obs");
  await expect(page.locator(".facts")).toContainText("from wages.dta");
});
