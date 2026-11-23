// The Output tabs (Graph, Data, Results), the full-size graph view and a .dta file's tab in real browsers
// (src/app/output/). The tests reach the page through its test hook: `run` runs code through the run controller, `state`
// holds the signals (a test sets `tabs`, `activeTab`, `phoneTab` and `graphFull` itself, which views may write). The
// clipboard is replaced by a recorder in every page (reading the real one needs a permission each browser handles its own
// way), so a test reads what the page copied.
//  - The empty states and a .dta tab with no engine need none: `?test=manual`.
//  - Everything else is one test with an engine (each start costs a while): one run draws three graphs, fits a model and
//    leaves a wide dataset, and the tabs are checked against that. On the phone profile there is no Graph tab (graphs
//    show in the log), so only the full-size view is checked there, opened through `graphFull`.
import type { Page } from "@playwright/test";
import { engineState, expect, isPhone, putFiles, ready, startEngine, test, toastOf } from "./fixtures"; // storage kept by default (fixtures.ts)
import { addBanner, type PhoneTab, seedGraphs, showGraphFull, showPhoneTab, showTabs, showTheme } from "./seed";

declare global {
  interface Window {
    __copied: string[];
    __clip: Clipboard; // the recorder, kept while a test takes the clipboard API away
  }
}

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
  if (isPhone(page))
    await showPhoneTab(page, tab as PhoneTab); // never "graph": the phone has no Graph tab
  else await page.getByRole("tab", { name: tab[0].toUpperCase() + tab.slice(1), exact: true }).click();
}
const copied = (page: Page) => page.evaluate(() => window.__copied);
const toastText = (page: Page) => page.evaluate(() => document.querySelector(".toast")?.textContent ?? null);
const logLength = (page: Page) => page.evaluate(() => window.__dofile.state.log.value.length);
async function run(page: Page, code: string) {
  const r = await page.evaluate((code) => window.__dofile.run(code), code);
  expect(r, "the engine was ready").not.toBeNull();
  expect(r!.rc, r!.log.slice(-1500)).toBe(0);
}

test("the empty states, and the reset wording of the Data tab", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  if (!isPhone(page)) {
    await showTab(page, "graph");
    await expect(page.getByText("No graphs yet")).toBeVisible();
    await expect(page.locator(".empty code")).toHaveText("scatter wage educ");
    await expect(page.getByText("A .png from the file list opens here too.", { exact: false })).toBeVisible();
  }
  await showTab(page, "data");
  await expect(page.getByText("No data in memory")).toBeVisible();
  await expect(page.getByText("Load a .dta from the file list, or run", { exact: false })).toBeVisible();
  await addBanner(page, { b: "reset", reason: "test", kind: "user", cause: null, run: null });
  await expect(page.getByText("The engine was reset, so no data is in memory")).toBeVisible();
  await showTab(page, "results");
  await expect(page.getByText("No results yet")).toBeVisible();
  await expect(page.getByText("e() and r() appear after an estimation", { exact: false })).toBeVisible();
});

test("Copy image twice in the full-size view: the first 'Copied' timer does not clear the second", async ({ page }) => {
  await page.clock.install({ time: 1_900_000_000_000 });
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  await seedGraphs(page, [{ n: 1, png, theme: "light", from: "run", command: "scatter y x" }], { full: true });
  const viewer = page.getByRole("dialog", { name: "Full-size graph" });
  const copy = viewer.getByRole("button", { name: "Copy image" });
  test.skip(!(await copy.isEnabled()), "this browser cannot put an image on the clipboard");
  await copy.click();
  await expect(viewer.locator(".vsaid")).toHaveText("Copied");
  await page.clock.fastForward(2000);
  await copy.click();
  await page.clock.fastForward(1000); // 3 s after the first copy: its timer (2.5 s) has fired, the second's (4.5 s) has not
  await expect(viewer.locator(".vsaid")).toHaveText("Copied");
  await page.clock.fastForward(2000);
  await expect(viewer.locator(".vsaid")).toHaveText("");
});

test("a .png from the files is on the light card in the dark theme: its colors are its own", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await showTheme(page, "dark");
  await page.evaluate(async () => {
    await window.__dofile.store.write("g.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
  });
  if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^g\.png/ })
    .click();
  // desktop: the Graph tab; phone: the full-size view
  const card = isPhone(page) ? page.locator(".viewer .graph-card") : page.locator(".graph-wrap .graph-card");
  await expect(card).toHaveAttribute("data-theme", "light");
});

test("a .dta tab whose name a command can't hold says so, and Load and Copy are off", async ({ page }) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await putFiles(page, { "a`b'.dta": new Array(16).fill(0) });
  await showTabs(page, [{ path: "a`b'.dta", kind: "dta", dirty: false }], "a`b'.dta", "editor");
  const view = page.locator(".dta-view");
  await expect(view.locator(".why")).toHaveText("Its name has a character a command can't use: rename the file.");
  await expect(view.locator(".cmd")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Load" })).toBeDisabled();
  await expect(view.getByRole("button", { name: "Copy the use command" })).toBeDisabled();
});

test("a .dta tab with no engine shows its two bars, copies the use command, and no table; Load is off and a press only says why", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  await expect.poll(() => page.evaluate(() => window.__dofile.store.blocked)).toBe(false);
  await page.evaluate(() => window.__dofile.store.write("data/wages.dta", new Uint8Array(2048)));
  await expect
    .poll(() =>
      page.evaluate(() => window.__dofile.state.files.value.some((f: { path: string }) => f.path === "data/wages.dta")),
    )
    .toBe(true);
  await showTabs(page, [{ path: "data/wages.dta", kind: "dta", dirty: false }], "data/wages.dta", "editor");
  const view = page.locator(".dta-view");
  await expect(view.locator(".bar").first()).toHaveText("data/wages.dta · 2 KB"); // 2048 bytes, as the file tree says
  await expect(view.locator(".cmd")).toHaveText('use "data/wages.dta", clear');
  // Load is off with no engine: aria-disabled and `.off`, not disabled, so it can still be focused; a press reaches no
  // machine (no drop, no prompt, no run) and a toast says what to do
  const load = view.getByRole("button", { name: "Load" });
  await expect(load).toHaveAttribute("aria-disabled", "true");
  await expect(load).toHaveClass(/\boff\b/);
  await expect(load).not.toHaveAttribute("disabled");
  await load.focus();
  await expect(load).toBeFocused();
  await load.click({ force: true }); // force: Playwright treats an aria-disabled button as not clickable
  await expect(toastOf(page)).toHaveText("Start the engine to load wages.dta");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  expect(await page.evaluate(() => window.__dofile.drops())).toEqual([]);
  expect(await page.evaluate(() => window.__dofile.state.history.value)).toEqual([]);
  await expect(view.locator("table")).toHaveCount(0);
  await view.getByRole("button", { name: "Copy the use command" }).click();
  expect(await copied(page)).toEqual(['use "data/wages.dta", clear']);
  await expect(toastOf(page)).toHaveText("Copied");
});

test("Copy of a closed matrix pressed while a run goes on is refused when that run replaces the results", async ({
  page,
}) => {
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  await run(page, "clear\nset obs 20\ngenerate x = _n\ngenerate y = x + mod(_n, 3)\nquietly regress y x");
  await showTab(page, "results");
  await page
    .getByRole("button", { name: /^Matrices/ })
    .first()
    .click();
  const copyBtn = page.getByRole("button", { name: "Copy e(b)", exact: true });
  await expect(copyBtn).toBeVisible();
  const before = (await copied(page)).length;

  // the matrix is read after the run that is on its way (the engine answers one op at a time, in order)
  const slow = page.evaluate(() => window.__dofile.run("sleep 1500\nquietly regress y"));
  await expect.poll(() => engineState(page)).toBe("running");
  await showTab(page, "results"); // a phone's run opened the Log
  await copyBtn.click();
  expect((await slow)!.rc).toBe(0);
  await expect(toastOf(page)).toHaveText("The results changed: copy again");
  expect(await copied(page), "nothing was copied").toHaveLength(before);

  await copyBtn.click(); // pressed again: the new results' matrix (the constant only)
  await expect(toastOf(page)).toHaveText("Copied e(b)");
  expect((await copied(page)).at(-1)).toMatch(/^\t_cons\n\S+\t[-.\d]+$/);
});

test("the Graph, Data and Results tabs and a .dta tab, after a run through the hook", async ({ page, browserName }) => {
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
  if (!isPhone(page)) {
    await showTab(page, "graph");
    const img = page.locator(".graph-wrap .graph-card img");
    await expect(img).toHaveAttribute("alt", "Graph 3: scatter wage educ"); // two graphs share a command: the number is added
    await expect(page.locator(".foot-title")).toHaveText("graph 3 of 3 · scatter wage educ");
    await expect(page.getByRole("button", { name: /^Show graph/ })).toHaveCount(3);
    await page
      .getByRole("button", { name: /^Show graph/ })
      .first()
      .click();
    await expect(img).toHaveAttribute("alt", "Graph: histogram wage");
    await expect(page.locator(".foot-title")).toHaveText("graph 1 of 3 · histogram wage");
    await expect(page.getByRole("button", { name: /^Show graph/ }).first()).toHaveAttribute("aria-current", "true");
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
    await expect(page.getByRole("status")).toHaveText(/Graph 2: scatter wage educ$/); // said
    const copyImage = viewer.getByRole("button", { name: "Copy image" });
    if (await copyImage.isEnabled()) {
      // off in a browser that cannot put an image on the clipboard: a click would wait for it to be enabled
      await copyImage.click();
      await expect(viewer.locator(".vsaid")).toHaveText("Copied");
      expect(await copied(page)).toContain("image:1");
      await expect(toastOf(page)).toBeVisible(); // the toast shows over the view, not under it
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
    await showGraphFull(page);
    const viewer = page.getByRole("dialog", { name: "Full-size graph" });
    await expect(viewer.locator(".vtitle")).toHaveText("graph 3 of 3 · scatter wage educ");
    await expect(viewer.getByRole("button", { name: "Next" })).toBeDisabled();
    await viewer.getByRole("button", { name: "Previous" }).click();
    await expect(viewer.locator(".vtitle")).toHaveText("graph 2 of 3 · scatter wage educ");
    await expect(viewer.getByRole("img")).toHaveAttribute("alt", "Graph 2: scatter wage educ");
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
  // with Alt, Ctrl or Cmd the keys are the browser's (Alt+Left is Back): the focus stays and the key is not cancelled
  const withModifier = await page.evaluate(() => {
    const prevented: string[] = [];
    const moved: string[] = [];
    let last = false;
    const listen = (e: KeyboardEvent) => {
      last = e.defaultPrevented;
    };
    document.addEventListener("keydown", listen);
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) {
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
        const before = document.activeElement as HTMLElement;
        last = false;
        before.dispatchEvent(new KeyboardEvent("keydown", { key, [mod]: true, bubbles: true, cancelable: true }));
        if (last) prevented.push(`${mod}+${key}`);
        if (document.activeElement !== before) moved.push(`${mod}+${key}`);
        before.focus();
      }
    }
    document.removeEventListener("keydown", listen);
    return { prevented, moved };
  });
  expect(withModifier).toEqual({ prevented: [], moved: [] });
  await expect(names.nth(1)).toBeFocused();
  // the list's own axis: Up and Down stop at the ends (no wrap), Home and End jump, Left and Right are not its keys
  await page.keyboard.press("ArrowUp");
  await expect(names.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(names.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(names.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(names.nth(34)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(names.nth(34)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(names.nth(34)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(names.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(names.nth(1)).toBeFocused();
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
  await expect(page.locator(".rs .row", { hasText: "`controls'" })).toContainText("age educ");
  // Globals: the user's own; the engine's presets still at their value (F1 "help advice;" ...) are left out
  const globalsHead = page.getByRole("button", { name: /^Globals/ });
  await expect(globalsHead.locator(".count")).toHaveText("1");
  await globalsHead.click();
  await expect(page.locator(".rs .row", { hasText: "$mygl" })).toContainText("5");
  await expect(page.locator(".rs .row", { hasText: "$F1" })).toHaveCount(0);
  await globalsHead.click();
  // a value: 8 digits, every digit copied by the row's icon; the toast names the row
  const rowOf = (name: string) =>
    page.locator(".rs .row").filter({ has: page.getByRole("button", { name: `Copy ${name}`, exact: true }) });
  const copyBtn = (name: string) => page.getByRole("button", { name: `Copy ${name}`, exact: true });
  const tint = (name: string) =>
    rowOf(name)
      .locator("td")
      .first()
      .evaluate((td) => getComputedStyle(td).backgroundColor);
  // The act cell holds its icon, whole: a 44 px column for a 24 px icon (a 44 px one on touch). Another font must not cut it
  const room = async (name: string) => {
    const m = await rowOf(name)
      .locator("td.act")
      .evaluate((td) => {
        const b = td.querySelector("button")!.getBoundingClientRect();
        return { spare: td.clientWidth - b.width, cut: td.scrollWidth > td.clientWidth };
      });
    return { ...m, spare: m.cut ? -1 : m.spare };
  };
  const plain = await tint("e(rank)"); // a row the pointer has not been on
  await copyBtn("e(N)").click();
  expect((await copied(page)).at(-1)).toBe("160");
  await expect(toastOf(page)).toHaveText("Copied e(N)");
  const r2 = rowOf("e(r2)").locator(".val");
  const whole = (await r2.locator(".full").textContent())!; // the digits in sight are .short; .full has all
  const short = (await r2.locator(".short").textContent())!;
  expect(short.length).toBeLessThanOrEqual(10);
  expect(whole.length).toBeGreaterThan(short.length);
  // the icon: named "Copy e(r2)", tooltip "Copy"; a screen reader's description is the whole value
  await expect(copyBtn("e(r2)")).toHaveAttribute("title", "Copy");
  await expect(copyBtn("e(r2)")).toHaveAccessibleDescription(whole);
  // a click on it copies every digit, and the icon is a check for about 2 s
  await copyBtn("e(r2)").click();
  expect((await copied(page)).at(-1)).toBe(whole);
  await expect(toastOf(page)).toHaveText("Copied e(r2)");
  await expect(copyBtn("e(r2)").locator(".i-check")).toBeVisible();
  await expect(copyBtn("e(r2)")).toHaveCSS("opacity", "1");
  const r2Room = await room("e(r2)");
  expect(r2Room.spare, "the icon is not cut").toBeGreaterThanOrEqual(0);
  await page.mouse.move(1, 1);
  await expect(copyBtn("e(r2)").locator(".i-check")).toHaveCount(0, { timeout: 4000 });
  await expect(copyBtn("e(r2)").locator(".i-copy")).toHaveCount(1);
  await expect(r2).toHaveText(short, { useInnerText: true });
  expect(await tint("e(r2)")).toBe(plain);
  // the icon is a 24 px square (44 px on touch), seen on a hovered row, always on touch
  const sizes = await copyBtn("e(rank)").evaluate((b) => [
    b.getBoundingClientRect().width,
    b.getBoundingClientRect().height,
  ]);
  expect(sizes).toEqual(isPhone(page) ? [44, 44] : [24, 24]);
  await expect(copyBtn("e(rank)")).toHaveCSS("cursor", "pointer");
  // a scalar row has no click of its own: the default cursor on the name, the text cursor over the value
  await expect(rowOf("e(rank)").locator("td").first()).toHaveCSS("cursor", "auto");
  await expect(rowOf("e(rank)").locator(".val")).toHaveCSS("cursor", "text");
  const copiesBefore = (await copied(page)).length;
  const toastBefore = await toastText(page);
  if (isPhone(page)) {
    await expect(copyBtn("e(rank)")).toHaveCSS("opacity", "1");
    await rowOf("e(rank)").locator("td").first().tap();
  } else {
    await expect(copyBtn("e(rank)")).toHaveCSS("opacity", "0");
    await rowOf("e(rank)").hover();
    await expect(copyBtn("e(rank)")).toHaveCSS("opacity", "1");
    expect(await tint("e(rank)")).not.toBe(plain);
    await rowOf("e(r2)").hover();
    await expect(r2.locator(".full")).toBeVisible(); // every digit on the hovered row
    await expect(r2.locator(".short")).toBeHidden();
    await rowOf("e(rank)").hover();
    await rowOf("e(rank)").locator("td").first().click(); // a click on the row does nothing
    // a drag over a name selects it and copies nothing
    const box = (await rowOf("e(rank)").locator("td").first().boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toContain("e(rank)");
    await page.evaluate(() => getSelection()?.removeAllRanges());
    // a double-click on a value selects it (the whole text of a short value)
    await rowOf("e(N)").locator(".val").dblclick();
    expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toContain("160");
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.mouse.move(1, 1);
    await expect(copyBtn("e(rank)")).toHaveCSS("opacity", "0");
  }
  expect((await copied(page)).length, "a click on a scalar row copies nothing").toBe(copiesBefore);
  expect(await toastText(page)).toBe(toastBefore);
  // each row's icon is a Tab stop: Tab from a later group's head reaches its first row's icon, the row tinted, all digits
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab"; // Safari's Tab skips buttons unless Option is held
  await page.getByRole("button", { name: /^Locals/ }).focus();
  await page.keyboard.press(tab);
  const firstLocalRow = page
    .locator(".rs tr.grp")
    .filter({ hasText: /^Locals/ })
    .locator("xpath=following-sibling::tr[1]");
  const firstLocal = firstLocalRow.getByRole("button", { name: /^Copy / });
  const digitsOf = (row: ReturnType<typeof rowOf>) =>
    row.evaluate((tr) => (tr.querySelector(".val .full") ?? tr.querySelector(".val"))!.textContent!);
  await expect(firstLocal).toBeFocused();
  await expect(firstLocal).toHaveCSS("opacity", "1");
  const local = (await firstLocal.getAttribute("aria-label"))!.slice("Copy ".length);
  const value = await digitsOf(firstLocalRow);
  await expect(firstLocal).toHaveAccessibleDescription(value);
  expect(await tint(local)).not.toBe(plain);
  await page.keyboard.press("Enter");
  expect((await copied(page)).at(-1)).toBe(value);
  await expect(toastOf(page)).toHaveText(`Copied ${local}`);
  await page.keyboard.press(tab); // the next row's icon
  await expect(page.locator(".rs .row button.copy:focus")).toHaveCount(1);
  const nextValue = await digitsOf(page.locator(".rs .row").filter({ has: page.locator("button.copy:focus") }));
  await page.keyboard.press("ControlOrMeta+c");
  expect((await copied(page)).at(-1)).toBe(nextValue);
  // without the clipboard API (plain http, as on a LAN), the old way copies; a click leaves no focus ring, a key the focus
  await page.evaluate(() => {
    window.__clip = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await page.mouse.move(1, 1);
  await copyBtn("e(r2)").click();
  await page.mouse.move(1, 1);
  await expect(toastOf(page)).toHaveText("Copied e(r2)");
  expect(await page.evaluate(() => document.querySelector(".rs :focus-visible")?.outerHTML ?? null)).toBeNull();
  expect(await tint("e(r2)")).toBe(plain);
  await page.getByRole("button", { name: /^Locals/ }).focus();
  await page.keyboard.press(tab);
  await expect(firstLocal).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toastOf(page)).toHaveText(`Copied ${local}`);
  await expect(firstLocal).toBeFocused();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", { value: window.__clip, configurable: true }),
  );
  // a matrix: a caret before the name ("e(b), 1 x 3", aria-expanded) and a click anywhere on the row open it in place or
  // fold it; the copy icon copies it as tab-separated text without opening or toggling it; a click on a cell copies that cell
  const log = await logLength(page);
  await page
    .getByRole("button", { name: /^Matrices/ })
    .first()
    .click();
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  const caret = page.getByRole("button", { name: "e(b), 1 x 3", exact: true });
  await expect(caret).toHaveAttribute("aria-expanded", "false");
  await expect(rowOf("e(b)")).toContainText("1 x 3");
  await expect(rowOf("e(b)")).toHaveCSS("cursor", "pointer");
  // the caret sits one step in from the group head's, and every matrix name starts at the same place
  const lefts = await page.evaluate(() => {
    const left = (el: Element | null) => el!.getBoundingClientRect().left;
    const head = [...document.querySelectorAll(".rs tr.grp")].find((g) => /^Matrices/.test(g.textContent!))!;
    return {
      head: left(head.querySelector(".ico")),
      rows: [...document.querySelectorAll(".rs .rowfold .ico")].map(left),
    };
  });
  expect(lefts.rows.length).toBeGreaterThan(1);
  expect(lefts.rows[0], "the matrix caret is in from the group head's").toBeGreaterThan(lefts.head + 8);
  expect(new Set(lefts.rows.map((x) => Math.round(x))).size, "all matrix names shift together").toBe(1);
  const beforeView = (await copied(page)).length;
  await caret.click();
  const grid = page.locator(".rs .mat table.grid");
  await expect(grid.locator("th")).toHaveText(["Row", "age", "educ", "_cons"]);
  await expect(grid.locator("tbody tr")).toHaveCount(1);
  await expect(caret).toHaveAttribute("aria-expanded", "true");
  expect(await logLength(page)).toBe(log);
  await caret.click(); // the caret toggles: it closes
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  await rowOf("e(b)").locator("td").nth(1).click(); // anywhere on the row: it opens
  await expect(grid).toBeVisible();
  await rowOf("e(b)").locator("td").nth(1).click(); // and closes
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  await caret.focus(); // Enter and Space on the caret toggle once
  await page.keyboard.press("Space");
  await expect(grid).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  expect((await copied(page)).length, "the caret and the row's clicks copy nothing").toBe(beforeView);
  const matRoom = await room("e(b)");
  expect(matRoom.spare, "the icon is not cut").toBeGreaterThanOrEqual(0);
  await copyBtn("e(b)").click();
  await expect.poll(async () => (await copied(page)).length, "the icon copies once").toBe(beforeView + 1);
  await expect(toastOf(page)).toHaveText("Copied e(b)");
  await expect(copyBtn("e(b)").locator(".i-check")).toBeVisible(); // the same check as a scalar's
  expect((await copied(page)).at(-1)).toMatch(/^\tage\teduc\t_cons\n\S+\t[-.\d]+\t[-.\d]+\t[-.\d]+$/);
  await expect(page.locator(".rs .mat"), "a copy that read the matrix leaves it closed").toHaveCount(0);
  await caret.click();
  await expect(grid).toBeVisible();
  await copyBtn("e(b)").click(); // on an open matrix too, the icon does not toggle
  await expect(toastOf(page)).toHaveText("Copied e(b)");
  await expect(grid).toBeVisible();
  await caret.focus(); // Ctrl/Cmd+C on the caret copies the whole matrix
  const afterIcon = (await copied(page)).length;
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(async () => (await copied(page)).length).toBe(afterIcon + 1);
  expect((await copied(page)).at(-1)).toMatch(/^\tage\teduc\t_cons\n/);
  await expect(grid).toBeVisible();
  const cell = grid.locator("tbody td.cell").nth(1);
  const full = await cell.getAttribute("title");
  await cell.click();
  await expect(toastOf(page)).toHaveText(/^Copied e\(b\)\[\S+, educ\]$/);
  expect((await copied(page)).at(-1), "a cell copies its own full value").toBe(full);
  await expect(grid, "a cell's click does not fold the grid").toBeVisible();
  await caret.click();
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  // an open matrix closes when another run replaces the results
  await caret.click();
  await expect(grid).toBeVisible();
  await run(page, "quietly summarize wage");
  await showTab(page, "results");
  await expect(page.locator(".rs .mat")).toHaveCount(0);
  await expect(caret).toHaveAttribute("aria-expanded", "false");
  await expect(sect.filter({ hasText: /^r\(\)/ })).toHaveCount(1);

  // ---- a .dta tab, with an engine ----
  await run(page, 'save "wages.dta", replace\nclear');
  await showTabs(page, [{ path: "wages.dta", kind: "dta", dirty: false }], "wages.dta", "editor");
  const view = page.locator(".dta-view");
  await expect(view.locator(".bar").first()).toContainText("wages.dta · 160 obs · 35 vars");
  await expect(view.locator("tbody tr")).toHaveCount(35);
  await expect(view.locator("tbody tr").nth(2)).toContainText("Hourly wage");
  await expect(view.getByText("the data in memory is untouched until you press Load.", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const data = window.__dofile.state.data.value;
      return data && "nvars" in data ? data.nvars : undefined;
    }),
    "describe_file leaves the data in memory",
  ).toBe(0);
  await view.getByRole("button", { name: "Copy the use command" }).click();
  expect((await copied(page)).at(-1)).toBe('use "wages.dta", clear');
  await view.getByRole("button", { name: "Load" }).click();
  await expect(toastOf(page)).toHaveText("Loaded wages.dta");
  expect(await page.evaluate(() => window.__dofile.state.history.value.at(-1))).toBe('use "wages.dta", clear');
  await showTab(page, "data");
  await expect(page.locator(".facts")).toContainText("160 obs");
  await expect(page.locator(".facts")).toContainText("from wages.dta");
});
