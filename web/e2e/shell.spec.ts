// Prototype 1, step 3: the app shell in real browsers. The layouts, the theme button, the ⋯ menu (Esc and Tab), the
// download prompt's "Not now" and a run's way back to it (through the run controller); and two cases moved from the proof of concept's poc.spec.ts that do not need the
// editor: a stale snapshot is refused with reason "updated" (plain words in its message, the cause in its detail), and
// ?snapshot=0 still starts. Also the phone toast's place and the failed "Download all" banner. Step 6 replaces these with
// the flows' tests.
import type { Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

const state = (page: Page) => page.evaluate(() => document.documentElement.dataset.engine);
const SAMPLE =
  "clear\nset obs 200\nset seed 1\ngenerate x = rnormal()\ngenerate y = 1 + 2*x + rnormal()\nregress y x, robust\nscatter y x\n";
type Hook = {
  run(code: string): Promise<{ rc: number; images: string[] } | null>;
  engine: { startup: { mode: string } | null };
  state: { engine: { value: { s: string; message?: string; detail?: string; reason?: string } } };
};
type Signals = Record<string, { value: unknown }>;
type FullHook = {
  state: Signals;
  selection: { value: unknown };
  store: { blocked: boolean; write(path: string, bytes: Uint8Array): Promise<void> };
};

/** Write a file into the store through the hook, once the tab lock has unblocked it. */
async function writeFile(page: Page, path: string) {
  await page.waitForFunction(() => (window as unknown as { __dofile: FullHook }).__dofile.store.blocked === false);
  await page.evaluate(
    (p) =>
      (window as unknown as { __dofile: FullHook }).__dofile.store.write(p, new TextEncoder().encode("display 1\n")),
    path,
  );
}

/** Two animation frames: what a signal change renders has been laid out. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test("first visit: Esc does not dismiss the prompt; Not now leaves the page usable with no engine; a run asks again, titled for a run, and runs nothing", async ({
  page,
}) => {
  await page.goto("?test");
  const prompt = page.getByRole("dialog", { name: "Download the engine?" });
  await expect(prompt).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: /^Download/ })).toBeFocused(); // the default (UX-037)
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toBeHidden();
  expect(await state(page)).toBe("declined");
  if ((page.viewportSize()?.width ?? 0) >= 700) {
    await expect(page.locator(".statusbar")).toContainText("No engine · Run downloads it first");
  }
  const run = page.locator(".toolbar").getByRole("button", { name: /^Run$/ });
  await expect(run).toBeEnabled();
  expect(await page.evaluate(() => caches.keys())).toEqual([]); // nothing downloaded: the next visit asks again
  // a run through the run controller, as Run does it: the prompt again, for a run; the run is not kept, so its promise
  // settles with null at once, before the prompt is answered
  const asked = await page.evaluate(() => (window as unknown as { __dofile: Hook }).__dofile.run('display "RAN"'));
  expect(asked).toBeNull();
  const forRun = page.getByRole("dialog", { name: "Download the engine to run code" });
  await expect(forRun).toBeVisible();
  await forRun.getByRole("button", { name: "Not now" }).click();
  await expect(forRun).toBeHidden();
  expect(await state(page)).toBe("declined");
});

test("the layout: desktop panes or the phone's views; the theme button cycles and is kept; the ⋯ menu works by keyboard", async ({
  page,
}) => {
  await page.goto("?test=manual"); // no engine: the shell alone
  const phone = (page.viewportSize()?.width ?? 0) < 700;
  if (phone) {
    const views = page.getByRole("tablist", { name: "Views" });
    await expect(views.getByRole("tab")).toHaveText(["Files", "Editor", "Log", "Data", "Results"]);
    await expect(views.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
    await views.getByRole("tab", { name: "Log" }).click();
    await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
    await expect(page.getByRole("log")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(views.getByRole("tab", { name: "Data" })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Data" })).toBeVisible();
    // the theme is in the phone's ⋯ menu (OQ-14); the file actions are the Files view's "Files ⋯", not in it
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Download all (.zip)" })).toHaveCount(0);
    // Theme cycles and keeps the menu open, the focus on it and its name updated; Enter cycles again
    const themeItem = page.getByRole("menuitem", { name: /^Theme:/ });
    await expect(themeItem).toHaveAccessibleName("Theme: System");
    await themeItem.click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
    await expect(themeItem).toHaveAccessibleName("Theme: Light");
    await expect(themeItem).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(themeItem).toHaveAccessibleName("Theme: Dark");
    await expect(themeItem).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    return;
  }
  await expect(page.getByRole("region", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Editor" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Log" })).toBeVisible();
  const output = page.getByRole("tablist", { name: "Output" });
  await expect(output.getByRole("tab")).toHaveText(["Graph", "Data", "Results"]);
  // Unsplit: one pane with Log first; the choice is kept
  await page.getByRole("button", { name: "Unsplit" }).click();
  await expect(output.getByRole("tab")).toHaveText(["Log", "Graph", "Data", "Results"]);
  await output.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByRole("tabpanel", { name: "Data" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Split" })).toBeVisible();
  await page.getByRole("button", { name: "Split" }).click();

  // the theme: System, Light, Dark, System; kept across a reload
  const theme = page.getByRole("button", { name: /^Theme:/ });
  await expect(theme).toHaveAccessibleName("Theme: follows the system. Press for light, then dark.");
  await theme.click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await theme.click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();

  // the ⋯ menu: with no files "Download all (.zip)" is disabled, so ArrowDown opens it on "Wrap lines"
  const more = page.getByRole("button", { name: "More actions" });
  const menu = page.getByRole("menu", { name: "More actions" });
  await more.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Download all (.zip)" })).toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Wrap lines" })).toBeFocused();
  await page.keyboard.press("Escape");
  await writeFile(page, "a.do");
  await page.waitForFunction(
    () => (window as unknown as { __dofile: FullHook }).__dofile.state.hasFiles.value === true,
  );
  // with a file: ArrowDown opens it on the first item, arrows move, Esc closes it and gives the focus back
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Download all (.zip)" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Wrap lines" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // Tab out of the open menu closes it and moves on from its trigger, not to the page's start
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  const after = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      body: a === document.body,
      trigger: a?.getAttribute("aria-label") === "More actions",
      inPage: Boolean(a?.closest(".app")),
    };
  });
  expect(after).toEqual({ body: false, trigger: false, inPage: true });
});

// A list of another build (the site deployed again since the page loaded; in development, a stale snapshot) is refused with a
// message, not run (moved from poc.spec.ts).
test('a snapshot from a different build of the wheel is refused with reason "updated"; the message says reload in plain words, and the detail gives the cause', async ({
  page,
  request,
}) => {
  const res = await request.get("start-files.json");
  expect(res.ok(), "no build: run npm run snapshot, then npm run build").toBe(true);
  const list = await res.json();
  expect(list.built, "no snapshot: run npm run snapshot, then npm run build").toBeTruthy();
  // the build's list is the one statement of the build: a list of another build id is a site updated since the page loaded
  await page.route("**/start-files.json", (route) => route.fulfill({ json: { ...list, buildId: "0".repeat(64) } }));
  await page.goto("?test");
  await startEngine(page);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as unknown as { __dofile: Hook }).__dofile.state.engine.value;
          return s.s === "failed" ? s.detail : s.s;
        }),
      { timeout: 120_000 },
    )
    .toMatch(
      /^dofile was updated: reload the page \(the site's start files are of the build 000000000000.*npm run snapshot/,
    );
  expect(
    await page.evaluate(
      () => (window as unknown as { __dofile: { engine: { worker: unknown } } }).__dofile.engine.worker,
    ),
    "no worker",
  ).toBeNull();
  // the visitor's case is a site updated since the page loaded: the reason says so, for "Reload the page"
  const st = await page.evaluate(() => (window as unknown as { __dofile: Hook }).__dofile.state.engine.value);
  expect(st.reason).toBe("updated");
  expect(st.message).toBe("dofile has a newer version on this site. Reload the page to use it.");
});

// ?snapshot=0 is the normal boot (Pyodide's runtime and packages from the CDN), moved from poc.spec.ts.
test("?snapshot=0: the normal boot still starts and runs the sample", async ({ page }) => {
  // This test has failed now and then in Firefox, cause unknown: a failed start must say why (the state's reason and detail,
  // and what the page logged) instead of waiting out the poll and reporting only that the state was not "ready".
  const logged: string[] = [];
  page.on("console", (m) => logged.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => {
    logged.push(`page error: ${e.message}`);
    console.log(`page error: ${e.message}`);
  });
  const engineNow = () =>
    page.evaluate(() => {
      const { s, reason, detail, message } = (window as unknown as { __dofile: Hook }).__dofile.state.engine.value;
      return { s, reason, detail, message };
    });
  const output = () => `the page's console (${logged.length} messages):\n${logged.join("\n")}`;
  await page.goto("?snapshot=0&test");
  await startEngine(page);
  const starting = /^(checking-|asking|downloading|starting-)/;
  try {
    await expect.poll(async () => starting.test((await engineNow()).s), { timeout: 300_000 }).toBe(false);
  } catch (e) {
    throw new Error(`the engine never left a starting state: ${JSON.stringify(await engineNow())}\n${output()}`, {
      cause: e,
    });
  }
  const now = await engineNow();
  expect(
    now.s,
    `the engine is ${now.s}, reason ${now.reason}, detail ${now.detail}, message ${now.message}\n${output()}`,
  ).toBe("ready");
  const r = await page.evaluate(async (code) => {
    const d = (window as unknown as { __dofile: Hook }).__dofile,
      r = await d.run(code);
    return { mode: d.engine.startup?.mode, rc: r?.rc, images: r?.images.length };
  }, SAMPLE);
  expect(r).toEqual({ mode: "normal", rc: 0, images: 1 });
});

// The toolbar keeps one size (each button holds all its labels): no engine state, selection or unsaved edit changes the
// toolbar's box or any of its buttons' boxes, at a desktop, a mid and a phone width; and the page never gets wider.
test("the toolbar does not move: its box and every button's box are the same in every engine state, with or without a selection or unsaved edits", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  const head = { kind: "file", fresh_locals: true };
  // the sixteen states of the engine's state machine (src/app/types.ts, EngineState)
  const states = [
    { s: "checking-lock" },
    { s: "checking-cache" },
    { s: "none" },
    { s: "asking", forRun: false },
    { s: "declined" },
    { s: "downloading", received: 1, total: 2, t0: 0 },
    { s: "starting-list", stage: "download", t0: 0, done: {} },
    { s: "starting-worker", stage: "python", t0: 0, done: {} },
    { s: "ready" },
    { s: "running", run: head, t0: 0 },
    { s: "breaking", run: head, t0: 0, resetAt: 0 },
    { s: "waiting", run: head, t0: 0 },
    { s: "failed", reason: "download", message: "x", detail: "x" },
    { s: "failed-twice", reason: "memory", message: "x", detail: "x" },
    { s: "other-tab-idle" },
    { s: "other-tab-taking" },
  ];
  expect(states).toHaveLength(16);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const seen = new Map<string, string>();
    for (const st of states) {
      for (const [tab, dirty, sel] of [
        [null, false, null],
        ["a.do", false, null],
        ["a.do", true, [6, 7]],
        ["a.do", true, [1234, 1240]],
      ] as const) {
        await page.evaluate(
          ([st, tab, dirty, sel]) => {
            const d = (window as unknown as { __dofile: FullHook }).__dofile;
            d.state.dialog.value = null; // the boxes, not the dialogs
            d.state.engine.value = st;
            d.state.tabs.value = tab ? [{ path: tab, kind: "text", dirty }] : [];
            d.state.activeTab.value = tab;
            d.selection.value = sel;
          },
          [st, tab, dirty, sel] as const,
        );
        await settled(page);
        const boxes = await page.evaluate(() => {
          const box = (e: Element) => {
            const r = e.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(",");
          };
          const bar = document.querySelector("header.toolbar")!,
            doc = document.scrollingElement!;
          return [
            `bar ${box(bar)}`,
            `page ${doc.scrollWidth}x${doc.scrollHeight}`,
            ...[...bar.querySelectorAll("a, button")].map(box),
          ].join(" | ");
        });
        seen.set(boxes, `${st.s}${tab ? " tab" : ""}${dirty ? " unsaved" : ""}${sel ? ` lines ${sel.join("-")}` : ""}`);
      }
    }
    expect(
      [...seen.entries()].map(([b, who]) => `${b} (${who})`),
      `at ${width} px the toolbar moved`,
    ).toHaveLength(1);
    expect([...seen.keys()][0]).toContain(`page ${width}x800`); // never wider or taller than the window
  }
});

// One height for the desktop toolbar's buttons (key chips or not), and one for the pane heads' controls.
test("the desktop toolbar's buttons are all one height, and so are the pane heads' controls", async ({ page }) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const sel of [null, [6, 7]]) {
      await page.evaluate((sel) => {
        const d = (window as unknown as { __dofile: FullHook }).__dofile;
        d.state.dialog.value = null;
        d.state.engine.value = { s: "ready" };
        d.state.tabs.value = [{ path: "a.do", kind: "text", dirty: true }];
        d.state.activeTab.value = "a.do";
        d.selection.value = sel;
      }, sel);
      await settled(page);
      const heights = (selector: string) =>
        page.evaluate(
          (s) =>
            [...document.querySelectorAll(s)]
              .filter((e) => e.getClientRects().length)
              .map((e) => e.getBoundingClientRect().height.toFixed(1)),
          selector,
        );
      const bar = await heights("header.toolbar button");
      expect(bar.length, `at ${width} px`).toBe(6); // Run, Run selection, Break, Save, the theme, ⋯
      expect(new Set(bar).size, `at ${width} px: ${bar.join(", ")}`).toBe(1);
      const head = await heights(".pane-head :is(.head-link, .fold-toggle)");
      expect(new Set(head).size, `at ${width} px: ${head.join(", ")}`).toBe(1);
    }
  }
});

// One tree for every width: the editor's slot and the log are the same nodes after a change of layout (not mounted twice).
test("the editor and the log are never mounted again when the layout changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("?test=manual");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".editor-slot, .log-body"))
      (el as HTMLElement & { tagged?: boolean }).tagged = true;
  });
  for (const width of [1024, 390, 699, 700, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await settled(page);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll(".editor-slot, .log-body")].map(
          (el) => (el as HTMLElement & { tagged?: boolean }).tagged === true,
        ),
      ),
      `at ${width} px`,
    ).toEqual([true, true]);
  }
});

// 700 to 1199 px: the file list is folded away behind a labelled "Files" button with the count of files (OQ-14).
test("the folded file list: the Files button says what it does and how many files; it opens by keyboard, focus goes in, Esc folds it and gives the focus back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("?test=manual");
  const button = page.getByRole("button", { name: "Files", exact: true });
  const pane = page.getByRole("region", { name: "Files" });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toHaveAttribute("aria-controls", "files-pane");
  await expect(pane).toBeHidden();
  await writeFile(page, "a.do");
  await writeFile(page, "data/b.do");
  await expect(page.getByRole("button", { name: "Files 2" })).toBeVisible();
  const files = page.getByRole("button", { name: "Files 2" });
  await files.focus();
  await page.keyboard.press("Enter");
  await expect(files).toHaveAttribute("aria-expanded", "true");
  await expect(pane).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("#files-pane")))).toBe(true);
  await expect(pane.getByRole("tree").locator('[tabindex="0"]')).toBeFocused(); // the tree's row, not the head's menu
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
  await expect(files).toHaveAttribute("aria-expanded", "false");
  await expect(files).toBeFocused();
  // at 1200 px and up the list is always there, and the button is not
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(files).toBeHidden();
  await expect(pane).toBeVisible();
});

// On a phone the page itself never scrolls: only panes do (an iPhone scrolled the page a few px). The emulated iPhone has
// no real keyboard or toolbars, and Playwright cannot make a real touch scroll, so this guards the layout: the document is
// no taller or wider than the window, and a scroll by script (and a wheel, where the browser takes one) leaves it at the
// top. app/viewport.ts's keyboard handling is tested in test/app.test.ts.
test("phone: the page cannot scroll; only panes do", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the iPhone profile");
  await page.goto("?test=manual");
  await settled(page);
  for (const view of ["files", "editor", "log", "data", "results"]) {
    await page.evaluate((v) => {
      (window as unknown as { __dofile: FullHook }).__dofile.state.phoneTab.value = v;
    }, view);
    await settled(page);
    const sizes = await page.evaluate(() => {
      const d = document.scrollingElement!;
      return { h: d.scrollHeight - d.clientHeight, w: d.scrollWidth - d.clientWidth };
    });
    expect(sizes, `${view} view`).toEqual({ h: 0, w: 0 });
    // a wheel over the view (where the browser takes one) and a scroll by script: the page stays at the top
    const box = (await page.locator(".main").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const wheel = await page.mouse.wheel(0, 400).then(
      () => "ran",
      (e: Error) => `not supported: ${e.message.split("\n")[0]}`,
    );
    test.info().annotations.push({ type: "wheel", description: `${view}: ${wheel}` });
    await page.evaluate(() => {
      window.scrollBy(0, 400);
      document.scrollingElement!.scrollTop = 400;
    });
    expect(await page.evaluate(() => [window.scrollY, window.scrollX]), `${view} view`).toEqual([0, 0]);
  }
  // text fields are 16 px or more there, so iOS does not zoom in on focus (an input stands in for 4b's command line)
  const size = await page.evaluate(() => {
    const input = Object.assign(document.createElement("input"), { className: "field" });
    document.querySelector(".cmdline")!.append(input);
    const px = parseFloat(getComputedStyle(input).fontSize);
    input.remove();
    return px;
  });
  expect(size).toBeGreaterThanOrEqual(16);
});

// A "Download all" that fails shows a banner above the editor (one, however often it fails), whose "Try again" downloads
// again; a download that works removes it. On a phone it shows on every view (each view draws it; the hidden ones are
// display: none). The store's zip is made to fail through the hook.
test("a failed Download all shows one banner with Try again, on every phone view; a download that works removes it", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await writeFile(page, "a.do");
  await page.waitForFunction(
    () => (window as unknown as { __dofile: FullHook }).__dofile.state.hasFiles.value === true,
  );
  type Failing = { __dofile: { store: { zip?(): Promise<File> } }; zipFailed: number };
  await page.evaluate(() => {
    const w = window as unknown as Failing;
    w.zipFailed = 0;
    w.__dofile.store.zip = () => {
      w.zipFailed++;
      return Promise.reject(new Error("the database would not open"));
    };
  });
  const failed = () => page.evaluate(() => (window as unknown as Failing).zipFailed);
  if ((page.viewportSize()?.width ?? 0) < 700) {
    // on a phone "Download all (.zip)" is in the Files view's "Files ⋯" menu
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
    await page.getByRole("button", { name: "File actions" }).click();
  } else await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Download all (.zip)" }).click();
  // the shown view's banner (on a phone every view has a copy)
  const banner = page.locator(".pane:not([hidden]) .banner", { hasText: "Your files couldn't be downloaded" });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Your files couldn't be downloaded"); // said once, in the live region
  expect(await failed()).toBe(1);
  // at 390 px, in every browser: the banner on each of the five views
  await page.setViewportSize({ width: 390, height: 800 });
  for (const view of ["Files", "Editor", "Log", "Data", "Results"]) {
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: view }).click();
    await expect(banner, `${view} view`).toBeVisible();
    await expect(banner, `${view} view`).toHaveCount(1);
    // the hidden views' copies are not in the accessibility tree: one "Try again" to reach
    await expect(page.getByRole("button", { name: "Try again" }), `${view} view`).toHaveCount(1);
  }
  await banner.getByRole("button", { name: "Try again" }).click();
  await expect.poll(failed).toBe(2); // "Try again" called downloadAll() again
  await expect(page.getByRole("status")).toHaveText("Your files couldn't be downloaded");
  await expect(banner).toHaveCount(1); // replaced, not stacked
  await page.evaluate(() => {
    delete (window as unknown as Failing).__dofile.store.zip;
  });
  const download = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Try again" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await expect(banner).toHaveCount(0);
});

// The phone's toast sits above the command line and the tab bar; with the keyboard open (viewport.ts's attributes, set by
// script: a real keyboard cannot be opened here) it sits above the command line at the foot of the visible area.
test("phone: the toast is above the command line and the tab bar, and above the keyboard when it is open", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the iPhone profile");
  await page.emulateMedia({ reducedMotion: "reduce" }); // the toast's place, not its way in
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  await page.evaluate(() => {
    const s = (window as unknown as { __dofile: { state: Signals & { showToast(t: string): void } } }).__dofile.state;
    s.phoneTab.value = "log";
    s.showToast("Saved analysis.do");
  });
  await settled(page);
  const rects = () =>
    page.evaluate(() => {
      const r = (sel: string) => {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        return b?.width ? { top: b.top, bottom: b.bottom } : null;
      };
      return { toast: r(".toast"), cmdline: r(".cmdline"), views: r(".views") };
    });
  const closed = await rects();
  expect(closed.toast!.bottom).toBeLessThanOrEqual(closed.cmdline!.top);
  expect(closed.toast!.bottom).toBeLessThanOrEqual(closed.views!.top);
  // the keyboard: the visible area is the top 400 px, panned 100 px down
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty("--vv-height", "400px");
    root.style.setProperty("--vv-top", "100px");
    root.dataset.keyboard = "";
  });
  await settled(page);
  const open = await rects();
  expect(open.views).toBeNull(); // the tab bar is hidden
  expect(open.cmdline!.bottom).toBeCloseTo(500, 0); // the command line sits at the visible area's foot
  expect(open.toast!.bottom).toBeLessThanOrEqual(open.cmdline!.top);
  expect(open.toast!.top).toBeGreaterThanOrEqual(100);
});

test("key hints: none in sight on a phone (the top bar, a file's menu, the ⋯ menus, the Editor and Log views with a nested do's note), the shortcuts still stated; shown on the desktop", async ({
  page,
  isMobile,
}) => {
  await page.goto("?test=manual");
  await writeFile(page, "a.do");
  // a run's log with a nested do of a file that has unsaved edits: its note says how to save
  await page.evaluate(() => {
    const W = (window as any).__dofile.state.runWriter;
    W.log.value = [{ t: "text", run: 1, text: ". do a.do\n\n. display 1\n1\n\nend of do-file\n", unsaved: ["a.do"] }];
  });
  // every text in sight that names a key: a text node in the page (.app) whose element and all its ancestors up to .app
  // that have a box (not display: contents) are bigger than the 1 px of a visually hidden one, and which is not
  // visibility: hidden (a toolbar label not shown)
  const keysInSight = () =>
    page.evaluate(() => {
      const KEY = /⌘|\bCtrl\b|\bEsc\b|\bF\d{1,2}\b|↵|↩/;
      const app = document.querySelector(".app")!;
      const seen = (el: Element | null) => {
        if (!el || getComputedStyle(el).visibility === "hidden") return false;
        for (let e: Element | null = el; e && e !== app.parentElement; e = e.parentElement) {
          if (getComputedStyle(e).display === "contents") continue; // no box of its own (the phone's .out)
          const r = e.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) return false;
        }
        return true;
      };
      const out: string[] = [];
      const walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode())
        if (KEY.test(n.textContent ?? "") && seen(n.parentElement)) out.push((n.textContent ?? "").trim());
      return out;
    });
  const note = /Save it \((⌘|Ctrl) S\) to run your edits\.$/;
  const tree = page.getByRole("tree", { name: "Files" });
  if (isMobile) {
    const views = page.getByRole("tablist", { name: "Views" });
    await views.getByRole("tab", { name: "Files" }).click();
    await tree.getByRole("treeitem", { name: /^a\.do/ }).click();
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", "Editor: a.do");
    expect(await keysInSight()).toEqual([]); // the top bar and the Editor view
    // a file's menu: its Rename keeps "F2" in its name, out of sight
    await views.getByRole("tab", { name: "Files" }).click();
    await page.locator(".row-more").first().click();
    const rename = page.getByRole("menuitem", { name: "Rename F2" });
    await expect(rename).toBeVisible();
    const f2 = await rename.locator("span", { hasText: /^F2$/ }).boundingBox();
    expect(f2!.width).toBeLessThanOrEqual(1);
    expect(await keysInSight()).toEqual([]);
    await page.keyboard.press("Escape");
    for (const view of ["Editor", "Log"]) {
      await views.getByRole("tab", { name: view }).click();
      expect(await keysInSight()).toEqual([]);
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await keysInSight()).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
    // the nested do's note names the ⋯ menu's Save instead
    await expect(page.getByRole("log", { name: "Log" })).toContainText(
      "Note: a.do has unsaved edits in the editor; do runs the saved file. Save it (⋯ › Save) to run your edits.",
    );
  } else {
    await tree.getByRole("treeitem", { name: /^a\.do/ }).click();
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", "Editor: a.do");
    // the toolbar's Save shows its chip and states its key; the note names the key
    const save = page.locator(".toolbar").getByRole("button", { name: "Save" });
    await expect(save).toHaveAttribute("aria-keyshortcuts", /^(Meta|Control)\+S$/);
    expect((await keysInSight()).some((t) => /^(⌘|Ctrl) S$/.test(t))).toBe(true);
    expect((await keysInSight()).some((t) => note.test(t))).toBe(true);
    // a file's menu shows "F2"
    await tree.getByRole("treeitem", { name: /^a\.do/ }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Rename F2" })).toBeVisible();
    expect(await keysInSight()).toContain("F2");
    await page.keyboard.press("Escape");
  }
});

test("the status bar's 'Not affiliated with StataCorp': in sight from 1200 px with the full sentence for screen readers and as its title, no link and no tab stop; at 1200 px the bar holds it beside the longest last run and every state's words without overflowing; none under 1200 px or on a phone", async ({
  page,
  isMobile,
}) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  const note = page.locator(".statusbar .affiliation");
  if (isMobile) {
    await expect(page.locator(".statusbar")).toHaveCount(0); // the phone has no status bar
    await expect(note).toHaveCount(0);
    await expect(page.getByText("Not affiliated with StataCorp")).toHaveCount(0);
    return;
  }
  const full = "Stata is a registered trademark of StataCorp LLC; dofile is not affiliated with StataCorp.";
  const bar = page.locator(".statusbar");
  const height = async () => (await bar.boundingBox())!.height;
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(note).toBeVisible();
  await expect(note.locator("[aria-hidden='true']")).toHaveText("Not affiliated with StataCorp");
  await expect(note.locator("[aria-hidden='true']")).toHaveAttribute("title", full);
  await expect(note.locator(".visually-hidden")).toHaveText(full);
  expect(await note.locator("a, button, [tabindex]").count()).toBe(0);
  const shown = await height();
  // under 1200 px: none, and the bar keeps its height
  await page.setViewportSize({ width: 1199, height: 900 });
  await expect(note).toBeHidden();
  expect(await height()).toBe(shown);

  // at 1200 px: the longest last run, memory and "Files may be cleared", and each state's words: nothing overflows or
  // wraps, the last run and the state's words are not cut
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => {
    const S = (window as any).__dofile.state;
    S.persisted.value = false;
    S.memory.value = { heap_bytes: 4_096e6, data_bytes: 0 };
    S.lastRun.value = { kind: "file", path: "a.do", fresh_locals: true, rc: 9999, line: 9999, seconds: 3599 };
  });
  const t0 = Date.now() - 3_599_000;
  const run = { kind: "selection", path: "a.do", lines: [1234, 5678], fresh_locals: false };
  for (const st of [
    { s: "ready" },
    { s: "starting-worker", stage: "packages", t0, done: {} },
    { s: "running", run, t0 },
    { s: "breaking", run, t0, resetAt: Date.now() + 5000 },
    { s: "waiting", run, t0 },
    { s: "declined" },
    { s: "failed-twice" },
  ]) {
    await page.evaluate((v) => ((window as any).__dofile.state.engine.value = v), st);
    await expect(bar.locator("[data-state]")).toHaveAttribute("data-state", st.s);
    await expect(note).toBeVisible();
    const fit = await bar.evaluate((el) => {
      const cut = (e: Element | null) => !!e && e.scrollWidth > e.clientWidth;
      return {
        overflow: el.scrollWidth > el.clientWidth,
        state: cut(el.querySelector("[data-state]")),
        lastRun: cut(el.querySelector(".last-run")),
      };
    });
    expect(fit, st.s).toEqual({ overflow: false, state: false, lastRun: false });
    expect(await height(), st.s).toBe(shown);
    if (st.s === "ready")
      await expect(bar).toContainText(
        "Last run: whole file (started with no locals) · r(9999) at line 9999 · 59 min 59 s",
      );
  }
});
