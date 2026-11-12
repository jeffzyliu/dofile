// Prototype 1, step 4d, in real browsers: the dialogs and states (docs/design/SPEC.md, sections 3.10 and 5; src/app/states/).
// With `?test=manual` the machine is in `none` and takes no step by itself, so a test sets the `engine` signal through the
// hook to show a state that is hard to reach (a failed start of each reason, Break pending, ...); that is a view test, not
// a machine test (test/machine.test.ts decides the states). The real machine is used where it is cheap: the prompt's
// "Not now" and the declined banner's "Download the engine" go through ask() and decline(). One test starts a real engine
// for Reset: its dialog (asked only with data in memory), Cancel, Reset, the reset banner.
import type { Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  run(code: string): Promise<{ rc: number; log: string } | null>;
  state: any; // the signals of src/app/state.ts
};
declare global {
  interface Window {
    __dofile: Hook;
  }
}

const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;
const engineIs = (page: Page) => page.evaluate(() => document.documentElement.dataset.engine);
/** Set the engine signal to show a state (the machine stays in `none`). */
const show = (page: Page, value: object) => page.evaluate((v) => (window.__dofile.state.engine.value = v), value);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await expect.poll(() => engineIs(page)).toBe("none");
});

test("no engine: the banner brings the prompt back; Not now leads to the banner again", async ({ page }) => {
  await show(page, { s: "declined" });
  const banner = page.locator(".banner", { hasText: "The engine isn't downloaded." });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You can open, edit, upload and download files; running code needs the engine");
  await expect(banner.getByRole("button", { name: "Download the engine" })).toBeVisible();
  // the real machine is in `none`, where ask() is valid: the prompt opens
  await banner.getByRole("button", { name: "Download the engine" }).click();
  await expect.poll(() => engineIs(page)).toBe("asking");
  const prompt = page.getByRole("dialog", { name: "Download the engine?" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: /^Download/ })).toBeFocused(); // Download is the default (UX-037)
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => engineIs(page)).toBe("declined");
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".banner", { hasText: "The engine isn't downloaded." })).toBeVisible();
});

test("the progress dialog: the download with its time and bytes, then the stages with their times", async ({
  page,
}) => {
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.engine.value = { s: "downloading", received: 14.2e6, total: 48e6, t0: Date.now() - 6000 };
    s.dialog.value = { d: "download", forRun: false };
  });
  const dlg = page.getByRole("dialog", { name: "Getting the engine ready" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText("Downloading", { exact: true })).toBeVisible();
  await expect(dlg.getByText(/^14\.2 of 48 MB · \d+ s$/)).toBeVisible();
  const bar = dlg.getByRole("progressbar", { name: "Download" });
  await expect(bar).toHaveAttribute("aria-valuetext", /^Downloading the engine, step 1 of 5$/);
  await expect(dlg.getByRole("button", { name: "Stop download" })).toBeVisible();
  await expect(dlg.locator(".stages li")).toHaveCount(5);
  await expect(dlg.locator(".stages li.now .when")).toHaveText("14.2 of 48 MB");

  await page.evaluate(() => {
    window.__dofile.state.engine.value = {
      s: "starting-worker",
      stage: "files",
      t0: Date.now() - 2000,
      done: { download: 7.1, unpack: 0.9, python: 0.1 },
    };
  });
  await expect(dlg.locator(".progress")).toHaveCount(0); // the bar is gone once the download is done
  await expect(dlg.getByText("Loading your files", { exact: true })).toBeVisible();
  await expect(dlg.getByText(/^step 4 of 5 · \d+(\.\d)? s$/)).toBeVisible();
  await expect(dlg.locator(".stages li.done")).toHaveCount(3);
  await expect(dlg.locator(".stages li.done .when").nth(0)).toContainText("7.1 s");
  await expect(dlg.locator(".stages li.done .when").nth(1)).toHaveText("0.9 s");
  await expect(dlg.getByRole("button", { name: "Stop download" })).toHaveCount(0);
  await dlg.getByRole("button", { name: "Edit files while it loads" }).click();
  await expect(dlg).toHaveCount(0);
});

test("another tab: the take-over button is aria-disabled while it is in progress, with the same label", async ({
  page,
}) => {
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.engine.value = { s: "other-tab-idle" };
    s.dialog.value = { d: "other-tab" };
  });
  const dlg = page.getByRole("alertdialog", { name: "dofile is open in another tab" });
  const use = dlg.getByRole("button", { name: "Use dofile in this tab" });
  await expect(dlg.getByRole("button", { name: "Close editor" })).toBeFocused();
  await expect(use).not.toHaveAttribute("aria-disabled", "true");
  await show(page, { s: "other-tab-taking" });
  await expect(use).toHaveAttribute("aria-disabled", "true");
  await expect(use).toHaveText("Use dofile in this tab");
});

test("a failed start: the words and the first action follow the reason", async ({ page }) => {
  const cases: [string, string, string[]][] = [
    ["no-wasm", "no WebAssembly support", ["Browsers that work"]],
    ["download", "didn't download completely", ["Try again"]],
    ["memory", "wasn't enough memory", ["Try again"]],
    ["updated", "newer version", ["Reload the page"]],
    ["unknown", "Something went wrong", ["Try again", "Reload the page"]],
  ];
  for (const [reason, words, actions] of cases) {
    await show(page, { s: "failed", reason, detail: "cause", message: `This browser: ${words}.` });
    const banner = page.getByRole("alert").filter({ hasText: "The engine didn't start." });
    await expect(banner, reason).toBeVisible();
    await expect(banner).toContainText(words);
    await expect(banner).toContainText("Your files are safe: you can still edit and download them.");
    await expect(banner).not.toContainText("cause"); // the developer's cause is never shown
    for (const a of actions) await expect(banner.locator(".btn", { hasText: a })).toBeVisible();
    if (reason === "no-wasm") await expect(banner.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Download all (.zip)" })).toBeVisible();
  }
  await show(page, { s: "failed-twice", reason: "memory", detail: "x", message: "x" });
  const twice = page.getByRole("alert").filter({ hasText: "The engine stopped after failing twice" });
  await expect(twice).toContainText("(it ran out of memory)");
  await expect(twice.getByRole("button", { name: "Reload the page" })).toBeVisible();
  await expect(twice.getByRole("button", { name: "Download all (.zip)" })).toBeVisible();
});

test("Download all is off in the failure banner while there is no file", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => window.__dofile.state.files.value.length >= 0)).toBe(true);
  const has = await page.evaluate(() => window.__dofile.state.hasFiles.value);
  await show(page, { s: "failed", reason: "download", detail: "", message: "x" });
  const button = page.getByRole("alert").getByRole("button", { name: "Download all (.zip)" });
  if (has) await expect(button).toBeEnabled();
  else await expect(button).toBeDisabled();
});

test("the banners above the log: running, stopping (focus on Don't reset), waiting (takes the focus)", async ({
  page,
}) => {
  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const run = { kind: "selection", lines: [14, 15], fresh_locals: false };
  await show(page, { s: "running", run, t0: Date.now() - 3400 });
  const running = page.locator(".banner", { hasText: "Running lines 14–15" });
  await expect(running).toBeVisible();
  await expect(running).toContainText("Break stops between commands.");
  await expect(running).toContainText("the data in memory is lost");

  // Break pending for 2 s of the 5: the stopping banner, with 3 s left
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 3000 });
  const stopping = page.locator(".banner", { hasText: "Stopping…" });
  await expect(stopping).toBeVisible();
  await expect(stopping).toContainText("This command can't stop until it ends.");
  await expect(stopping).toContainText(/In [23] s the engine is reset:/);
  await expect(stopping.getByRole("button", { name: "Don't reset: wait for it" })).toBeFocused();
  // Break pending for 0.5 s only: the running banner still
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 4500 });
  await expect(stopping).toHaveCount(0);
  await expect(page.locator(".banner", { hasText: "Running lines 14–15" })).toBeVisible();

  await show(page, { s: "waiting", run, t0: Date.now() - 9000 });
  const waiting = page.locator(".banner", { hasText: "Waiting for this command to end." });
  await expect(waiting).toBeVisible();
  await expect(waiting).toBeFocused();
  await expect(waiting).toHaveAttribute("tabindex", "-1");
});

test("the storage, reset, memory and download-failed banners", async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.addBanner({ b: "storage" });
    s.addBanner({ b: "download-failed" });
  });
  const storage = page.locator(".banner", { hasText: "This browser may clear your files" });
  await expect(storage).toContainText("when it needs space. Download all to keep a copy.");
  await expect(storage.getByRole("button", { name: "Download all (.zip)" })).toBeVisible();
  const failed = page.locator(".banner", { hasText: "Your files couldn't be downloaded." });
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
  await failed.getByRole("button", { name: "Dismiss" }).click();
  await expect(failed).toHaveCount(0);
  await storage.getByRole("button", { name: "Dismiss" }).click();
  await expect(storage).toHaveCount(0);

  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.addBanner({ b: "reset", reason: "the code did not stop at Break", kind: "break" });
  });
  const reset = page.locator(".banner", { hasText: "The engine was reset:" });
  await expect(reset).toContainText("The engine was reset: the code did not stop at Break.");
  await expect(reset).toContainText("The data in memory is gone; your files are kept.");
  await expect(reset.getByRole("button", { name: "Run the file again" })).toBeDisabled(); // no engine, no open file
  await reset.getByRole("button", { name: "Dismiss" }).click();
  await expect(reset).toHaveCount(0);
  await page.evaluate(() => window.__dofile.state.addBanner({ b: "memory" }));
  await expect(page.locator(".banner", { hasText: "of about 2 GB." })).toContainText(
    "A bigger dataset may reset the engine.",
  );
});

test("Reset asks only with data in memory; Cancel keeps it; Reset clears it and the banner says so", async ({
  page,
}) => {
  await page.goto("/?test");
  await startEngine(page);
  await expect.poll(() => engineIs(page), { timeout: 300_000 }).toBe("ready");
  const more = async () => {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Reset the engine…" }).click();
  };
  // with data: the dialog; Cancel has the focus, Esc and Cancel keep the data
  const r = await page.evaluate(() => window.__dofile.run("set obs 5\ngen x = _n\nscalar k = 3"));
  expect(r?.rc, r?.log).toBe(0);
  await more();
  const dlg = page.getByRole("alertdialog", { name: "Reset the engine?" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Your files are kept.");
  await expect(dlg.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  expect(await engineIs(page)).toBe("ready");
  // Reset: the engine restarts, the data is gone, the banner stays until dismissed
  await more();
  await dlg.getByRole("button", { name: "Reset" }).click();
  await expect(dlg).toHaveCount(0);
  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const banner = page.locator(".banner", { hasText: "You reset the engine." });
  await expect(banner).toBeVisible();
  await expect.poll(() => engineIs(page), { timeout: 300_000 }).toBe("ready");
  expect(await page.evaluate(() => window.__dofile.state.data.value?.nobs ?? 0)).toBe(0);
  // with nothing to lose: no question, the engine resets at once
  await page.evaluate(() => window.__dofile.state.dismiss({ b: "reset" }));
  await more();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => engineIs(page)).not.toBe("ready");
  await expect(page.locator(".banner", { hasText: "You reset the engine." })).toBeVisible();
});
