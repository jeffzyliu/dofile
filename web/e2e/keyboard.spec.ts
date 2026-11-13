// The phone's on-screen keyboard (app/viewport.ts, the ?kblog overlay app/kblog.ts; the iPhone measurements behind them:
// docs/phone-keyboard-experiment.md). No profile here has a real on-screen keyboard, so these tests guard the layout
// with viewport.ts's attributes set by script, the editor's caret with a stand-in visualViewport, and the overlay; what
// Safari does is for the real iPhone. Every profile runs them at a phone's size (the phone layout is under 700 px).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures"; // storage kept by default (fixtures.ts)

const PHONE = { width: 390, height: 844 };
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** The editor page at a phone's size with the test hook and no engine, `query` added to the URL. */
async function open(page: Page, query = "") {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" }); // places, not their way in
  await page.goto(`?test=manual${query}`);
  await page.waitForFunction(() => "__dofile" in window);
}
/** What viewport.ts sets while the keyboard is open: the visible area, `height` px tall from the top. */
const keyboard = (page: Page, height: number) =>
  page.evaluate((h) => {
    const root = document.documentElement;
    root.style.setProperty("--vv-height", `${h}px`);
    root.dataset.keyboard = "";
  }, height);
const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const b = document.querySelector(s)?.getBoundingClientRect();
    return b?.width ? { top: b.top, bottom: b.bottom, height: b.height } : null;
  }, sel);

test("the keyboard's layout: with the keyboard open, .app is the visible area from the top, the command line at its foot, the toast above it; no overlay without ?kblog", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("#kblog")).toHaveCount(0);
  await page.evaluate(() => {
    const s = (window as any).__dofile.state;
    s.phoneTab.value = "log";
    s.showToast("Saved analysis.do");
  });
  await keyboard(page, 400);
  await settled(page);
  expect(await rect(page, ".app")).toEqual({ top: 0, bottom: 400, height: 400 });
  expect(await rect(page, ".views")).toBeNull(); // the tab bar is hidden
  const cmdline = (await rect(page, ".cmdline"))!;
  expect(cmdline.bottom).toBeCloseTo(400, 0);
  const toast = (await rect(page, ".toast"))!;
  expect(toast.bottom).toBeLessThanOrEqual(cmdline.top);
  expect(toast.top).toBeGreaterThanOrEqual(0);
  // the keyboard closes: .app fills the window again
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.removeProperty("--vv-height");
    delete root.dataset.keyboard;
  });
  await settled(page);
  expect(await rect(page, ".app")).toEqual({ top: 0, bottom: PHONE.height, height: PHONE.height });
});

test("the keyboard's layout: the full-size graph view covers the visible area with the keyboard open", async ({
  page,
}) => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await open(page);
  await page.evaluate((png) => {
    const s = (window as any).__dofile.state;
    s.runWriter.graphs.value = [{ n: 1, png, theme: "light", from: "run", run: 1, command: "scatter y x", line: 1 }];
    s.graphFull.value = true;
  }, PNG);
  await expect(page.getByRole("dialog", { name: "Full-size graph" })).toBeVisible();
  await settled(page); // the view takes the focus, and viewport.ts looks again (no keyboard here) before the next line
  await keyboard(page, 400);
  await settled(page);
  const viewer = (await rect(page, ".viewer"))!;
  expect(viewer.top).toBeLessThanOrEqual(0); // the visible area, 0 to 400 px, is covered
  expect(viewer.bottom).toBeGreaterThanOrEqual(400);
});

// The command line takes a tap's focus itself, with preventScroll, so iOS does not pan the page up to it
// (log/CommandLine.tsx); only the profiles with touch tap.
test("a tap on the phone's command line focuses it without scrolling the page, the caret at the end", async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch, "taps need a touch profile");
  await open(page);
  await page.evaluate(() => {
    (window as any).__dofile.state.phoneTab.value = "log";
  });
  const field = page.locator(".cmdline input");
  await field.fill("display 1");
  await field.evaluate((el) => (el as HTMLInputElement).blur());
  await field.tap();
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.value.length])).toEqual([9, 9]);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("?kblog: the overlay lists the events, takes no taps, and is not there without the flag", async ({ page }) => {
  await open(page, "&kblog");
  const log = page.locator("#kblog");
  await expect(log).toBeVisible();
  await expect(log).toContainText("start");
  // the taps go through it, to what is under it
  const through = await page.evaluate(() => {
    const box = document.getElementById("kblog")!.getBoundingClientRect();
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + 5);
    return { pointer: getComputedStyle(document.getElementById("kblog")!).pointerEvents, under: under?.id ?? "" };
  });
  expect(through.pointer).toBe("none");
  expect(through.under).not.toBe("kblog");
  // a focus is listed
  await page.evaluate(() => {
    (window as any).__dofile.state.phoneTab.value = "log";
  });
  await page.locator(".cmdline input").focus();
  await expect(log).toContainText("focusin");
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("kblog");
});

// With the keyboard open, the editor's caret is scrolled above it, at once when the keyboard is first seen (and again
// once it has settled). A stand-in visualViewport (set before the page loads) plays the keyboard: its height drops to
// 400 px and it fires a resize. Three taps under the coming keyboard: a line of text, an empty line (a DOM range has no
// box there; a first build that measured one missed it) and the file's last line.
for (const tap of ["a low line", "an empty line", "the last line"] as const)
  test(`the editor's caret on ${tap}, under the keyboard, is scrolled above it when the keyboard opens`, async ({
    page,
  }) => {
    await page.addInitScript((height) => {
      const vv = Object.assign(new EventTarget(), { height, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
      (window as any).__vv = vv;
    }, PHONE.height);
    await open(page, "&sample");
    const content = page.locator(".cm-content");
    await expect(content).toContainText("summarize");
    if (tap === "a low line") await content.click({ position: { x: 40, y: 600 - (await content.boundingBox())!.y } });
    else {
      const lines = content.locator(".cm-line");
      const index = await lines.evaluateAll(
        (ls, empty) =>
          empty
            ? ls
                .map((l, i) => [l, i] as const)
                .filter(([l]) => !l.textContent && l.getBoundingClientRect().top > 420)
                .at(-1)![1]
            : ls.length - 1,
        tap === "an empty line",
      );
      await lines.nth(index).click();
    }
    await settled(page);
    // the bottom of the caret's line (the caret's own box is empty on an empty line), and whether it is shown above the
    // keyboard: 20 px clear (the line is a few px taller than the caret, whose margin is 24), or, with the editor
    // scrolled to its end so it can go no further, inside the editor
    const caret = () =>
      page.evaluate(() => {
        const node = getSelection()!.focusNode!;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement!;
        const bottom = el.closest(".cm-line")!.getBoundingClientRect().bottom;
        const scroller = document.querySelector(".cm-scroller")!;
        const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
        return { bottom, shown: bottom <= 400 - 20 || (atEnd && bottom <= scroller.getBoundingClientRect().bottom) };
      });
    expect((await caret()).bottom).toBeGreaterThan(400); // under the coming keyboard
    await page.evaluate(() => {
      const vv = (window as any).__vv;
      vv.height = 400;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(await page.evaluate(() => "keyboard" in document.documentElement.dataset)).toBe(true);
    await settled(page); // CodeMirror scrolls in its next measure
    expect((await caret()).shown).toBe(true);
    expect((await caret()).bottom).toBeGreaterThan(300); // just above the keyboard, not further
  });
