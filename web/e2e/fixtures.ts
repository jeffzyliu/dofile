// The e2e tests' shared `test`: Playwright's, with storage kept by default. In a Playwright browser
// navigator.storage.persisted() is false, so every page would add the storage banner (S 19) as soon as the files change.
// Here every page of the test's context answers true to persisted() and persist(), unless the test turns it off:
//   import { test, expect } from "./fixtures";
//   test.use({ persisted: false });   // in a file or a describe: the browser's own answers
// A context the test makes itself (launchPersistentContext, browser.newContext) is not covered: call keepFiles(context).
// Every page goto is retried once when a fresh page's first navigation stalls (retryFirstGoto, below). A page the test
// makes itself (context.newPage()) is not covered: call retryFirstGoto(page).
import { type BrowserContext, test as base, errors, expect, type Page } from "@playwright/test";

export { expect };

/** Get past the download prompt on a page opened with `?test` (not `?test=manual`): wait until the page has decided (the
 *  page load is over: the state is no longer `checking-lock` or `checking-cache`), and if it asks (this build's start
 *  files are not all in the Cache, as in a fresh context), press Download through the test hook's start(). If they are
 *  cached the page has started by itself and this does nothing. Call it after each goto and reload that should start the
 *  engine. */
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
    if (document.documentElement.dataset.engine === "asking") (window as any).__dofile.start();
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
 *  cancels a fresh page's first navigation (WebKit bug 325840) and goto waits out its timeout with nothing loaded. Nothing
 *  else is retried: another error, a timeout on a page that has already left about:blank, a second timeout. */
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
