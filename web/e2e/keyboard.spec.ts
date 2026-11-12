// The phone keyboard experiment (?kb=…, ?slide, ?kblog; app/viewport.ts, app/kblog.ts, docs/phone-keyboard-experiment.md).
// No profile here has a real on-screen keyboard, so these tests guard the layout each strategy gives with viewport.ts's
// attributes set by script, the pre strategy's prediction (which needs only a focus), and the overlay; what Safari does
// is for the real iPhone. Every profile runs them at a phone's size (the phone layout is under 700 px).
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
/** What viewport.ts sets while the keyboard is open: the visible area `height` px tall, `top` px down. */
const keyboard = (page: Page, height: number, top: number) =>
  page.evaluate(
    ([h, t]) => {
      const root = document.documentElement;
      root.style.setProperty("--vv-height", `${h}px`);
      root.style.setProperty("--vv-top", `${t}px`);
      root.dataset.keyboard = "";
    },
    [height, top],
  );
const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const b = document.querySelector(s)?.getBoundingClientRect();
    return b?.width ? { top: b.top, bottom: b.bottom, height: b.height } : null;
  }, sel);

// height, unpan and pre keep --vv-top at 0 (viewport.ts), so they are set so here; the others follow the pan
const MODES = [
  { query: "", kb: undefined, top: 100 },
  { query: "&kb=top", kb: undefined, top: 100 },
  { query: "&kb=transform", kb: "transform", top: 100 },
  { query: "&kb=transform&slide", kb: "transform", top: 100 },
  { query: "&kb=focus", kb: "focus", top: 100 },
  { query: "&kb=height", kb: "height", top: 0 },
  { query: "&kb=unpan", kb: "unpan", top: 0 },
  { query: "&kb=pre", kb: "pre", top: 0 },
  { query: "&kb=nonsense", kb: undefined, top: 100 },
];

test("the keyboard strategies' layout: with the keyboard open, .app is the visible area, the command line at its foot, the toast above it; data-kb only with a known ?kb other than top; no overlay without ?kblog", async ({
  page,
}) => {
  for (const m of MODES) {
    await open(page, m.query);
    expect(await page.evaluate(() => document.documentElement.dataset.kb), m.query).toBe(m.kb);
    expect(await page.evaluate(() => "kbSlide" in document.documentElement.dataset), m.query).toBe(
      m.query.includes("slide"),
    );
    await expect(page.locator("#kblog")).toHaveCount(0);
    await page.evaluate(() => {
      const s = (window as any).__dofile.state;
      s.phoneTab.value = "log";
      s.showToast("Saved analysis.do");
    });
    await keyboard(page, 400, m.top);
    await settled(page);
    const app = (await rect(page, ".app"))!;
    expect(app.top, m.query).toBeCloseTo(m.top, 0);
    expect(app.height, m.query).toBeCloseTo(400, 0);
    const moved = await page.evaluate(() => getComputedStyle(document.querySelector(".app")!).transform);
    expect(moved === "none", `${m.query}: moved by a transform`).toBe(m.kb !== "transform");
    expect(await rect(page, ".views"), m.query).toBeNull(); // the tab bar is hidden
    const cmdline = (await rect(page, ".cmdline"))!;
    expect(cmdline.bottom, m.query).toBeCloseTo(m.top + 400, 0);
    const toast = (await rect(page, ".toast"))!;
    expect(toast.bottom, m.query).toBeLessThanOrEqual(cmdline.top);
    expect(toast.top, m.query).toBeGreaterThanOrEqual(m.top);
    // the keyboard closes: .app fills the window again
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      delete root.dataset.keyboard;
    });
    await settled(page);
    expect(await rect(page, ".app"), m.query).toEqual({ top: 0, bottom: PHONE.height, height: PHONE.height });
  }
});

// A transformed .app holds its fixed children: the full-size graph view fills .app (the visible area) under ?kb=transform,
// and the layout viewport (which holds the visible area) otherwise.
test("the keyboard strategies' layout: the full-size graph view covers the visible area with the keyboard open, under top and transform", async ({
  page,
}) => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  for (const [query, expected] of [
    ["", { top: 0, bottom: PHONE.height, height: PHONE.height }],
    ["&kb=transform", { top: 100, bottom: 500, height: 400 }],
  ] as const) {
    await open(page, query);
    await page.evaluate((png) => {
      const s = (window as any).__dofile.state;
      s.runWriter.graphs.value = [{ n: 1, png, theme: "light", from: "run", run: 1, command: "scatter y x", line: 1 }];
      s.graphFull.value = true;
    }, PNG);
    await expect(page.getByRole("dialog", { name: "Full-size graph" })).toBeVisible();
    await settled(page); // the view takes the focus, and viewport.ts looks again (no keyboard here) before the next line
    await keyboard(page, 400, 100);
    await settled(page);
    const viewer = (await rect(page, ".viewer"))!;
    expect(viewer.top, query).toBeCloseTo(expected.top, 0);
    expect(viewer.height, query).toBeCloseTo(expected.height, 0);
    expect(viewer.top).toBeLessThanOrEqual(100); // the visible area, 100 to 500 px, is covered
    expect(viewer.bottom).toBeGreaterThanOrEqual(500);
  }
});

// ?kb=pre: a text field's focus sets the area above a predicted keyboard at once (55 % of the layout viewport before a
// keyboard was seen); with no keyboard (none opens here) it goes after the hold, 1 s.
test("?kb=pre: the command line's focus sets the predicted area at once, and it goes when no keyboard comes", async ({
  page,
}) => {
  await open(page, "&kb=pre");
  await page.evaluate(() => {
    (window as any).__dofile.state.phoneTab.value = "log";
  });
  await settled(page);
  const atFocus = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>(".cmdline input")!;
    field.focus();
    const root = document.documentElement;
    return {
      open: "keyboard" in root.dataset,
      height: root.style.getPropertyValue("--vv-height"),
      top: root.style.getPropertyValue("--vv-top"),
      bottom: document.querySelector(".cmdline")!.getBoundingClientRect().bottom,
    };
  });
  const predicted = Math.round(PHONE.height * 0.55);
  expect({ ...atFocus, bottom: undefined }).toEqual({
    open: true,
    height: `${predicted}px`,
    top: "0px",
    bottom: undefined,
  });
  expect(atFocus.bottom).toBeCloseTo(predicted, 0); // the command line at the predicted area's foot
  await page.waitForFunction(() => !("keyboard" in document.documentElement.dataset));
  expect(await rect(page, ".app")).toEqual({ top: 0, bottom: PHONE.height, height: PHONE.height });
});

test("?kblog: the overlay lists the events with the strategy's name, takes no taps, and is not there without the flag", async ({
  page,
}) => {
  await open(page, "&kb=transform&slide&kblog");
  const log = page.locator("#kblog");
  await expect(log).toBeVisible();
  await expect(log).toContainText("kb=transform slide");
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
