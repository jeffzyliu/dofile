// The e2e tests' shared `test`: Playwright's, with storage kept by default. In a Playwright browser
// navigator.storage.persisted() is false, so every page would add the storage banner as soon as the files change. Here
// every page of the test's context answers true to persisted() and persist(), unless the test turns it off:
//   import { test, expect } from "./fixtures";
//   test.use({ persisted: false });   // in a file or a describe: the browser's own answers
// A context the test makes itself (launchPersistentContext, browser.newContext) is not covered: call keepFiles(context).
// Every page goto is retried once when a fresh page's first navigation stalls (retryFirstGoto, below). A page the test
// makes itself (context.newPage()) is not covered: call retryFirstGoto(page).
import { type BrowserContext, test as base, errors, expect, type Locator, type Page } from "@playwright/test";

export { expect };

/** Get past the download prompt on a page opened with `?test` (not `?test=manual`): wait until the page has decided
 *  (the state is no longer `checking-lock` or `checking-cache`), and if it asks (the start files are not all in the
 *  Cache, as in a fresh context), press Download through the test hook's start(). Call it after each goto and reload
 *  that should start the engine. */
export async function startEngine(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = document.documentElement.dataset.engine;
          return Boolean(s) && !s!.startsWith("checking");
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.evaluate(() => {
    if (document.documentElement.dataset.engine === "asking") window.__dofile.start();
  });
}

/** Make storage.persisted() and persist() answer true in every page of `context` (none of its pages may be open yet). */
export const keepFiles = (context: BrowserContext) =>
  context.addInitScript(() => {
    const storage = navigator.storage;
    if (!storage) return;
    storage.persisted = async () => true;
    storage.persist = async () => true;
  });

/** Make `page.goto` retry once when it times out while the page is still at about:blank. On Linux, WebKit now and then
 *  cancels a fresh page's first navigation (WebKit bug 325840) and goto waits out its timeout with nothing loaded.
 *  Nothing else is retried: another error, a timeout on a page that has left about:blank, a second timeout. */
export function retryFirstGoto(page: Page) {
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    try {
      return await goto(url, options);
    } catch (e) {
      if (!(e instanceof errors.TimeoutError) || page.url() !== "about:blank") throw e;
      console.log(`page.goto(${url}) timed out on a fresh page (still about:blank): retrying once`);
      return goto(url, options);
    }
  };
}

/** The toast and the banner (by its words) have no role; the status bar is the page's footer. */
export const toastOf = (page: Page) => page.locator(".toast");
export const bannerOf = (scope: Page | Locator, hasText?: string | RegExp) =>
  scope.locator(".banner", hasText === undefined ? undefined : { hasText });
export const statusBar = (page: Page) => page.getByRole("contentinfo");

/** The viewport is under the phone breakpoint (700 px). */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;

/** The engine's state name, from `<html data-engine>`. */
export const engineState = (page: Page) => page.evaluate(() => document.documentElement.dataset.engine ?? "");

/** Wait for the engine to be ready (a start can take minutes without a snapshot in the Cache). */
export const ready = (page: Page) => expect.poll(() => engineState(page), { timeout: 300_000 }).toBe("ready");

/** Two animation frames: what a signal change renders has been laid out. */
export const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Wait until the tab lock has answered, so the store takes writes. */
export const unblocked = (page: Page) => page.waitForFunction(() => window.__dofile?.store.blocked === false);

/** Write files into the store: text, or bytes as an array of numbers. */
export async function putFiles(page: Page, files: Record<string, string | number[]>) {
  await unblocked(page);
  await page.evaluate(async (files) => {
    for (const [path, data] of Object.entries(files))
      await window.__dofile.store.write(
        path,
        typeof data === "string" ? new TextEncoder().encode(data) : Uint8Array.from(data),
      );
  }, files);
}

/** A file's text in the store. */
export const storedText = (page: Page, path: string) =>
  page.evaluate(async (p) => new TextDecoder().decode(await window.__dofile.store.read(p)), path);

/** A do-file that fits a model and draws one graph. */
export const SAMPLE =
  "clear\nset obs 200\nset seed 1\ngenerate x = rnormal()\ngenerate y = 1 + 2*x + rnormal()\nregress y x, robust\nscatter y x\n";

export const test = base.extend<{ persisted: boolean }>({
  persisted: [true, { option: true }],
  page: async ({ page }, use) => {
    retryFirstGoto(page);
    await use(page);
  },
  context: async ({ context, persisted }, use) => {
    if (persisted) await keepFiles(context);
    await use(context);
  },
});
