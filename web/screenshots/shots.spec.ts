// The screenshot run's states (docs/web-audit-plan.md, N7): one test for each state of the fixed list, in the editor at
// its test hook, one screenshot each (compared with the baseline folder, screenshots.config.ts). Every state that does
// not need a real engine is seeded through e2e/seed.ts (the page's `?test=manual`: no engine, nothing time-dependent);
// "the engine walk" starts a real engine for the states that need one (a results table, a .dta view, a graph) and masks
// the status bar, which shows the last run's time and the memory in use. A state that would not hold still between
// two baselines of one commit is not in this file (the report says which, and why).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, isPhone, ready, settle, startEngine, test, unblocked } from "../e2e/fixtures";
import {
  addBanner,
  openDialog,
  type PhoneTab,
  seedLastRun,
  seedLog,
  seedStatusBar,
  showEngine,
  showGraphFull,
  showPhoneTab,
  showTabs,
} from "../e2e/seed";
import { FAILED, FAILED_TWICE } from "../src/app/states/words.ts";

// light, so "system" cannot differ between machines; no motion
test.use({ colorScheme: "light", reducedMotion: "reduce" });

/** No animation, no transition, no caret, whatever the page draws (toHaveScreenshot also disables animations). */
const FREEZE =
  "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }";

const analysis = readFileSync(new URL("../sample/analysis.do", import.meta.url), "utf8");

/** The editor with the sample in the store and its main do-file open (the page's first-visit load), no engine. */
async function open(page: Page, url = "?test=manual&sample") {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto(url);
  if (url.startsWith("?test=manual"))
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  await unblocked(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.activeTab.value)).toBe("analysis.do");
  await expect(page.locator(".cm-content")).toContainText("A first look at wages, age and schooling");
  await expect(
    page.getByRole("tree", { name: "Files" }).or(page.getByRole("tablist", { name: "Views" })),
  ).toBeVisible();
  await page.addStyleTag({ content: FREEZE });
  await settle(page, { store: true });
}

/** A phone shows one view at a time; on a desktop every pane is in sight and this does nothing. */
const view = (page: Page, tab: PhoneTab) => (isPhone(page) ? showPhoneTab(page, tab) : Promise.resolve());

/** The pixels a state may differ by on Chromium (0 for a state not listed; WebKit's shots, the "iphone" project, were
 *  identical in every measured compare, so it has none). Each is twice the most that state differed in 3 compares of one
 *  build against its baseline with the flags of screenshots.config.ts (docs/test-map.md has the table): a margin of 2 on
 *  a sample of 3. A change of a colour, size or glyph moves hundreds of pixels. */
const ALLOW: Record<string, number> = {
  "banner-not-text": 2,
  "banner-reset": 6,
  "banner-reset-crash": 2,
  "banner-save-failed": 6,
  "banner-storage": 10,
  "banner-store-failed-open": 12,
  "csv-command-bar": 8,
  "data-tab": 20,
  "dialog-clash": 2,
  "dialog-clear-log": 2,
  "dialog-close-tab": 2,
  "dialog-delete": 2,
  "dialog-delete-all": 8,
  "dialog-download-prompt": 8,
  "dialog-other-tab": 6,
  "dialog-progress": 4,
  "dialog-reset": 14,
  "dta-view": 16,
  "dta-view-no-engine": 8,
  "engine-declined": 10,
  "engine-failed-twice": 6,
  "engine-failed-updated": 8,
  graph: 20,
  "log-after-run": 16,
  "menu-file-actions": 12,
  "menu-more": 10,
  "menu-row-file": 2,
  "menu-row-folder": 2,
  "ready-sample": 14,
  "results-table": 20,
  "tabs-one-unsaved": 6,
  "tree-draft": 2,
  "tree-rename": 10,
};

/** SHOTS_DIFFS: one JSON line for each shot (project, state, pixels that differ, allowance), which `npm run shots` reads
 *  for its report of near-misses (a diff of 1 to the allowance passes, and a small real change must still be seen). */
const diffsFile = process.env.SHOTS_DIFFS;
function record(name: string, diff: number, allow: number) {
  if (!diffsFile) return;
  mkdirSync(dirname(diffsFile), { recursive: true });
  const project = test.info().project.name;
  appendFileSync(diffsFile, `${JSON.stringify({ project, name, diff, allow })}\n`);
}

async function shot(page: Page, name: string, mask: Locator[] = []) {
  await page.mouse.move(0, 0); // no hover look from where the last click left the pointer
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const allow = test.info().project.name === "chromium" ? (ALLOW[name] ?? 0) : 0;
  const expected = `${name}.png`;
  try {
    // First with no allowance, to count the pixels of a small difference (a pass with a diff is a near-miss).
    await expect(page, name).toHaveScreenshot(expected, { mask, maxDiffPixels: 0 });
    record(name, 0, allow);
  } catch (e) {
    const m = /(\d+) pixels? \(ratio [\d.]+ of all image pixels\) (?:is|are) different/.exec(String(e));
    const diff = m ? Number(m[1]) : -1; // -1: not a count (no baseline, another size)
    record(name, diff, allow);
    // over the allowance (or not a count): the same comparison again, soft, so the failure is the run's
    if (diff < 0 || diff > allow)
      await expect.soft(page, name).toHaveScreenshot(expected, { mask, maxDiffPixels: allow });
  }
}

/** The status bar's inputs a run measures (its time, the memory) put back to fixed values, and then the shot. */
const ran = { kind: "file", path: "analysis.do", fresh_locals: true, rc: 0, line: null, seconds: 1 } as const;

async function pinned(page: Page, name: string, lastRun: Parameters<typeof seedStatusBar>[1]["lastRun"]) {
  await seedStatusBar(page, { persisted: true, memory: { heap_bytes: 160e6, data_bytes: 1e6 }, lastRun });
  await shot(page, name);
}

const tree = (page: Page) => page.getByRole("tree", { name: "Files" });
const row = (page: Page, name: RegExp) => tree(page).getByRole("treeitem", { name });
const toolbar = (page: Page) => page.getByRole("banner");

test("ready with the sample, then a run: the engine walk (log, results table, graph, full-size graph, .dta view)", async ({
  page,
}) => {
  await open(page, "?test&sample");
  await startEngine(page);
  await ready(page);
  await settle(page, { store: true });
  await pinned(page, "ready-sample", null);

  const r = await page.evaluate((code) => window.__dofile.run(code), analysis);
  expect(r?.rc, r?.log.slice(-1500)).toBe(0);
  await view(page, "log");
  await pinned(page, "log-after-run", ran);

  if (isPhone(page)) await showPhoneTab(page, "results");
  else await page.getByRole("tab", { name: "Results", exact: true }).click();
  await pinned(page, "results-table", ran);

  if (isPhone(page)) await showPhoneTab(page, "data");
  else await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(page.getByRole("table").first()).toBeVisible();
  await pinned(page, "data-tab", ran);

  if (!isPhone(page)) {
    await page.getByRole("tab", { name: "Graph", exact: true }).click();
    await pinned(page, "graph", ran);
  }
  await showGraphFull(page);
  await pinned(page, "graph-full", ran);
  await page.keyboard.press("Escape");

  await showTabs(
    page,
    [
      { path: "analysis.do", kind: "text", dirty: false },
      { path: "data/wages.dta", kind: "dta", dirty: false },
    ],
    "data/wages.dta",
    "editor",
  );
  await expect(page.locator(".dta-view tbody tr").first()).toBeVisible();
  await pinned(page, "dta-view", ran);
});

test("several tabs, one with an unsaved edit", async ({ page }) => {
  await open(page);
  await view(page, "files");
  await row(page, /^helpers\.do/).click();
  await expect(page.locator(".cm-content")).toContainText("program");
  await page.locator(".cm-content").click();
  await page.keyboard.type("* an edit");
  await view(page, "files");
  await row(page, /^wages\.dta/).click();
  await expect(page.locator(".dta-view")).toBeVisible();
  await view(page, "editor");
  await shot(page, "tabs-one-unsaved");
});

test("a .dta tab with no engine: its two bars, no table, Load off", async ({ page }) => {
  await open(page);
  await showTabs(page, [{ path: "data/wages.dta", kind: "dta", dirty: false }], "data/wages.dta", "editor");
  await expect(page.locator(".dta-view")).toBeVisible();
  await shot(page, "dta-view-no-engine");
});

test("a .csv tab: its command bar (Import)", async ({ page }) => {
  await open(page);
  const csv = Array.from({ length: 12 }, (_, i) => `${i},${i * 2},x${i}`).join("\n");
  await page.evaluate(
    (t) => window.__dofile.store.write("data/small.csv", new TextEncoder().encode(`a,b,c\n${t}\n`)),
    csv,
  );
  await view(page, "files");
  await row(page, /^data\//).focus();
  await page.keyboard.press("ArrowRight"); // opens the folder
  await row(page, /^small\.csv/).click();
  await expect(page.locator(".filebar").last()).toBeVisible();
  await view(page, "editor");
  await shot(page, "csv-command-bar");
});

const DIALOGS: [string, (page: Page) => Promise<unknown>][] = [
  ["dialog-download-prompt", (p) => showEngine(p, { s: "asking" }, { d: "download" })],
  ["dialog-clash", (p) => openDialog(p, { d: "clash", path: "analysis.do", index: 1, total: 2 })],
  ["dialog-delete", (p) => openDialog(p, { d: "delete", paths: ["helpers.do"] })],
  ["dialog-delete-all", (p) => openDialog(p, { d: "delete-all", count: 2 })],
  ["dialog-clear-log", (p) => openDialog(p, { d: "clear-log" })],
  ["dialog-reset", (p) => openDialog(p, { d: "reset" })],
  ["dialog-close-tab", (p) => openDialog(p, { d: "close-tab", path: "analysis.do" })],
  ["dialog-other-tab", (p) => showEngine(p, { s: "other-tab-idle" }, { d: "other-tab" })],
];
for (const [name, show] of DIALOGS)
  test(name, async ({ page }) => {
    await open(page);
    await show(page);
    await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible();
    await shot(page, name);
  });

test("dialog-progress: the download with its bar", async ({ page }) => {
  await open(page);
  // t0 in the future: the elapsed time is clamped at 0 s and does not tick (a past t0 would show a changing time)
  await showEngine(
    page,
    { s: "downloading", received: 14.2e6, total: 48e6, t0: Date.now() + 3_600_000 },
    { d: "download" },
  );
  const dlg = page.getByRole("dialog", { name: "Getting the engine ready" });
  await expect(dlg).toBeVisible();
  await shot(page, "dialog-progress", [dlg.locator(".when")]);
});

const MENUS: [string, PhoneTab, (page: Page) => Locator][] = [
  ["menu-more", "editor", (p) => toolbar(p).getByRole("button", { name: "More actions" })],
  ["menu-file-actions", "files", (p) => p.getByRole("button", { name: "File actions" })],
  ["menu-log-actions", "log", (p) => p.getByRole("button", { name: "Log actions" })],
];
for (const [name, phoneView, button] of MENUS)
  test(name, async ({ page }) => {
    test.skip(
      name === "menu-log-actions" && !isPhone(page),
      "the desktop log head has no menu: Find, Download log and Clear are in it",
    );
    await open(page);
    await view(page, phoneView);
    await button(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await shot(page, name);
  });

test("menu-row: a file's actions, and a folder's", async ({ page }) => {
  await open(page);
  await view(page, "files");
  await row(page, /^helpers\.do/).focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Actions for helpers.do" })).toBeVisible();
  await shot(page, "menu-row-file");
  await page.keyboard.press("Escape");
  await row(page, /^data\//).focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Actions for data/" })).toBeVisible();
  await shot(page, "menu-row-folder");
});

test("the tree with a rename field", async ({ page }) => {
  await open(page);
  await view(page, "files");
  await row(page, /^helpers\.do/).focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "New name for helpers.do" })).toBeFocused();
  await shot(page, "tree-rename");
});

test("the tree with a draft row", async ({ page }) => {
  await open(page);
  await view(page, "files");
  await page.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "New .do file" }).click();
  await expect(page.getByRole("textbox", { name: /^New name for / })).toBeFocused();
  await shot(page, "tree-draft");
});

test("a log with an error", async ({ page }) => {
  await open(page);
  const end = { kind: "file" as const, path: "analysis.do", fresh_locals: true, rc: 111, line: 15, seconds: 0.38 };
  await seedLog(page, [
    { t: "runhead", run: { kind: "file", path: "analysis.do", fresh_locals: true }, first: true },
    {
      t: "text",
      run: 1,
      text: ". use data/wages, clear\n. summarize wage age educ\n\n    Variable |        Obs        Mean    Std. dev.       Min        Max\n-------------+---------------------------------------------------------\n        wage |        160    22.41      8.32       7.5       61.2\n. regress wage agee educ female\nvariable agee not found\nr(111);\n",
      end,
    },
  ]);
  await seedLastRun(page, end);
  await view(page, "log");
  await shot(page, "log-error");
});

const BANNERS: [string, Parameters<typeof addBanner>[1]][] = [
  ["banner-reset", { b: "reset", reason: "reset by you", kind: "user", cause: null, run: null }],
  ["banner-reset-crash", { b: "reset", reason: "crash", kind: "crash", cause: "storage", run: null }],
  ["banner-store-failed-open", { b: "store-failed", cause: "open" }],
  ["banner-store-failed-copy", { b: "store-failed", cause: "copy" }],
  ["banner-storage", { b: "storage" }],
  ["banner-download-failed", { b: "download-failed" }],
  ["banner-not-text", { b: "not-text", path: "data/wages.dta" }],
  ["banner-save-failed", { b: "save-failed", path: "analysis.do", message: "The disk is full." }],
  ["banner-run-changed", { b: "run-changed", path: "analysis.do" }],
];
for (const [name, banner] of BANNERS)
  test(name, async ({ page }) => {
    await open(page);
    await addBanner(page, banner);
    // a phone's banner is in the views that show its kind (the reset banner is not in the Editor view): the first that has it
    const seen = page.locator(".banner:visible");
    for (const tab of ["editor", "log", "files", "data", "results"] as const) {
      await view(page, tab);
      if (await seen.count()) break;
    }
    await expect(seen.first()).toBeVisible();
    await shot(page, name);
  });

// the engine's states that put a banner above the editor (failed with each kind of first action, failed twice, declined)
const FAILED_STATES: [string, Parameters<typeof showEngine>[1]][] = [
  ["engine-failed-unknown", { s: "failed", reason: "unknown", detail: "cause", message: FAILED.unknown }],
  ["engine-failed-updated", { s: "failed", reason: "updated", detail: "cause", message: FAILED.updated }],
  ["engine-failed-twice", { s: "failed-twice", reason: "memory", detail: "cause", message: FAILED_TWICE }],
  ["engine-declined", { s: "declined" }],
];
for (const [name, state] of FAILED_STATES)
  test(name, async ({ page }) => {
    await open(page);
    await view(page, "editor");
    await showEngine(page, state);
    await expect(page.locator(".banner:visible").first()).toBeVisible();
    await shot(page, name);
  });

// the phone's three views (the desktop's panes are in "ready-sample" and the states above)
for (const tab of ["files", "editor", "log"] as const)
  test(`phone view: ${tab}`, async ({ page }) => {
    test.skip(!isPhone(page), "the phone's views");
    await open(page);
    await showPhoneTab(page, tab);
    await shot(page, `phone-view-${tab}`);
  });
