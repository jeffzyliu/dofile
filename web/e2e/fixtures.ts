// The e2e tests' shared `test`: Playwright's, with storage kept by default. In a Playwright browser
// navigator.storage.persisted() is false, so every page would add the storage banner (S 19) as soon as the files change.
// Here every page of the test's context answers true to persisted() and persist(), unless the test turns it off:
//   import { test, expect } from "./fixtures";
//   test.use({ persisted: false });   // in a file or a describe: the browser's own answers
// A context the test makes itself (launchPersistentContext, browser.newContext) is not covered: call keepFiles(context).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

export { expect };

/** Get past the download prompt on a page opened with `?test` (not `?test=manual`): wait until the page has decided, and
 *  if it asks (this build's start files are not all in the Cache, as in a fresh context), press Download through the test
 *  hook's start(). If they are cached the page has started by itself and this does nothing. Call it after each goto and
 *  reload that should start the engine. */
export async function startEngine(page: Page) {
  await expect.poll(() => page.evaluate(() => { const s = document.documentElement.dataset.engine; return Boolean(s) && s !== "none"; }),
    { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => { if (document.documentElement.dataset.engine === "asking") (window as any).__dofile.start(); });
}

/** Make storage.persisted() and persist() answer true in every page of `context` (none of its pages may be open yet). */
export const keepFiles = (context: BrowserContext) => context.addInitScript(() => {
  const storage = navigator.storage;
  if (!storage) return;
  storage.persisted = async () => true;
  storage.persist = async () => true;
});

export const test = base.extend<{ persisted: boolean }>({
  persisted: [true, { option: true }],
  context: async ({ context, persisted }, use) => {
    if (persisted) await keepFiles(context);
    await use(context);
  },
});
