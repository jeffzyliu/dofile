// Prototype 1, step 4d, in real browsers: the dialogs and states (docs/design/SPEC.md, sections 3.10 and 5; src/app/states/).
// With `?test=manual` the machine is in `none` and takes no step by itself, so a test sets the `engine` signal through the
// hook to show a state that is hard to reach (a failed start of each reason, Break pending, ...); that is a view test, not
// a machine test (test/machine.test.ts decides the states). The real machine is used where it is cheap: the prompt's
// "Not now" and the declined banner's "Start engine" go through ask() and decline(). One test starts a real engine
// for Reset: its dialog (asked once anything has run on the engine), Cancel, Reset, the reset banner. Where the focus goes when a
// banner that holds it goes away is checked as `activeElement.closest("[data-editor]")`, so it holds for the stand-in and
// for 4b's CodeMirror (whose focused `.cm-content` carries the attribute or sits inside it).
import type { Locator, Page } from "@playwright/test";
import { expect, retryFirstGoto, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  run(code: string): Promise<{ rc: number; log: string } | null>;
  state: any; // the signals of src/app/state.ts
  store: { blocked: boolean; write(path: string, bytes: Uint8Array): Promise<unknown> };
  drops(): unknown[];
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
/** The focus is in the editor: on `[data-editor]` or inside it (4b's CodeMirror focuses its `.cm-content`). */
const inEditor = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest("[data-editor]")));

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("?test=manual");
  await expect.poll(() => engineIs(page)).toBe("none");
});

test("no engine: the banner brings the prompt back; Not now leads to the banner again", async ({ page }) => {
  await show(page, { s: "declined" });
  const banner = page.locator(".banner", { hasText: "The engine isn't downloaded." });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You can open, edit, upload and download files; running code needs the engine");
  await expect(banner.getByRole("button", { name: "Start engine" })).toBeVisible();
  // the real machine is in `none`, where ask() is valid: the prompt opens
  await banner.getByRole("button", { name: "Start engine" }).click();
  await expect.poll(() => engineIs(page)).toBe("asking");
  const prompt = page.getByRole("dialog", { name: "Download the engine?" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: /^Download/ })).toBeFocused(); // Download is the default (UX-037)
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => engineIs(page)).toBe("declined");
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".banner", { hasText: "The engine isn't downloaded." })).toBeVisible();
  // the banner's button was gone while the prompt was open: the prompt gives the focus back to the editor, not to <body>
  await expect.poll(() => inEditor(page)).toBe(true);
});

test("the progress dialog: the download with its time and bytes, then the stages with their times", async ({
  page,
}) => {
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.engine.value = { s: "downloading", received: 14.2e6, total: 48e6, t0: Date.now() - 6000 };
    s.dialog.value = { d: "download" };
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
  await expect(dlg.locator("b", { hasText: "Loading your files" })).toBeVisible();
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
  await expect(use).toHaveClass(/\boff\b/); // ui.css's disabled look, as Run's while a run is on
  await expect(use).toHaveText("Use dofile in this tab");
  // a press while it is in progress does nothing: no take-over reaches the machine (it would record a drop)
  const before = await page.evaluate(() => window.__dofile.drops().length);
  await use.click({ force: true }); // force: Playwright treats an aria-disabled button as not clickable
  expect(await page.evaluate(() => window.__dofile.drops().length)).toBe(before);
});

test("a second tab: Start engine goes into the take-over dialog, never straight to a start; the dialog's button takes over", async ({
  page,
  context,
}) => {
  // `page` holds the tab lock (the real machine, in `none`). A second tab of the same browser does not get it.
  const second = await context.newPage();
  retryFirstGoto(second);
  await second.goto("?test=manual");
  await expect.poll(() => engineIs(second)).toBe("other-tab-idle");
  const dlg = second.getByRole("alertdialog", { name: "dofile is open in another tab" });
  await expect(dlg).toBeVisible();
  // the dialog is blocking, so the buttons under it cannot be pressed; should another dialog have taken its place and
  // closed, the page offers "Start engine" (the toolbar's buttons are hidden while another tab has the engine: the
  // command line's is there)
  await second.evaluate(() => {
    window.__dofile.state.dialog.value = null;
  });
  await expect(dlg).toHaveCount(0);
  if (phone(second)) await second.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Log" }).click();
  const field = second.getByRole("textbox", { name: "Command" });
  await expect(field).toBeDisabled();
  await expect(field).toHaveAttribute("placeholder", "Start the engine to run code");
  await second.locator(".cmdline").getByRole("button", { name: "Start engine" }).click();
  // the take-over dialog again; nothing started, here or in the first tab, which still has the lock
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Close editor" })).toBeFocused();
  expect(await engineIs(second)).toBe("other-tab-idle");
  expect(await engineIs(page)).toBe("none");
  expect(await second.evaluate(() => window.__dofile.drops())).toEqual([]);
  // the visitor's choice in the dialog takes over
  await dlg.getByRole("button", { name: "Use dofile in this tab" }).click();
  await expect.poll(() => engineIs(second)).toBe("none"); // ?test=manual: the lock is this tab's, and nothing starts
  await expect.poll(() => engineIs(page)).toBe("other-tab-idle");
  await expect(dlg).toHaveCount(0);
  await second.close();
});

test("where nothing can start the engine from the page (a failed start that needs a reload or another browser, failed twice, a take-over in progress): the command line and its Start engine are off, and say so; the help link's toast says the engine isn't running", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__dofile.state.runWriter.log.value = [
      { t: "head" },
      {
        t: "text",
        run: 1,
        text: '. summarize sex\nsex not found\n  → "sex" is not a variable.\n    Learn more: help summarize\nr(111);\n',
        end: { kind: "command", fresh_locals: false, rc: 111, line: null, seconds: 0.1 },
      },
    ];
  });
  if (phone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Log" }).click();
  const field = page.getByRole("textbox", { name: "Command" });
  const start = page.locator(".cmdline").getByRole("button", { name: "Start engine" });
  const help = page.getByRole("log", { name: "Log" }).getByRole("button", { name: "help summarize" });
  const toast = page.locator(".toast");
  const clear = () =>
    page.evaluate(() => {
      window.__dofile.state.toast.value = null;
    });
  const failed = (reason: string) => ({ s: "failed", reason, detail: "cause", message: "words" });
  const cases: [string, object][] = [
    ["failed, updated", failed("updated")],
    ["failed, no-wasm", failed("no-wasm")],
    ["failed-twice", { s: "failed-twice", reason: "memory", detail: "cause", message: "words" }],
    ["other-tab-taking", { s: "other-tab-taking" }],
  ];
  for (const [name, st] of cases) {
    await show(page, st);
    // off, not `disabled`: still focusable, read-only, with the hint that says why
    await expect(field, name).toHaveAttribute("aria-disabled", "true");
    await expect(field, name).not.toHaveAttribute("disabled");
    await expect(field, name).toHaveJSProperty("readOnly", true);
    await expect(field, name).toHaveAttribute("placeholder", "The engine isn't running");
    await expect(start, name).toHaveAttribute("aria-disabled", "true");
    await expect(start, name).toHaveClass(/\boff\b/);
    await expect(start, name).not.toHaveAttribute("disabled");
    await expect(page.getByRole("button", { name: "Run command" })).toHaveCount(0);
    // a press is not swallowed in silence, and reaches no machine
    await clear();
    await start.click({ force: true }); // force: Playwright treats an aria-disabled button as not clickable
    await expect(toast, name).toHaveText("The engine isn't running");
    await clear();
    await help.click({ force: true });
    await expect(toast, name).toHaveText("The engine isn't running: can't see help summarize");
    // Enter in the off field says its hint
    await clear();
    await field.focus();
    await page.keyboard.press("Enter");
    await expect(toast, name).toHaveText("The engine isn't running");
    await expect(field).toBeFocused();
  }
  expect(await page.evaluate(() => window.__dofile.drops())).toEqual([]);
  expect(await page.evaluate(() => window.__dofile.state.history.value)).toEqual([]);
  // where a start is offered the words say to start it
  await show(page, failed("download"));
  await expect(field).toHaveAttribute("placeholder", "Start the engine to run code");
  await expect(start).not.toHaveAttribute("aria-disabled", "true");
  await clear();
  await help.click({ force: true });
  await expect(toast).toHaveText("Start the engine to see help summarize");
});

test("the phone's command line at 320 px with no engine: the hint shows whole beside Start engine, and the row is no wider than the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await show(page, { s: "declined" });
  await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Log" }).click();
  const field = page.getByRole("textbox", { name: "Command" });
  await expect(field).toHaveAttribute("placeholder", "Start the engine to run code");
  await expect(page.locator(".cmdline").getByRole("button", { name: "Start engine" })).toBeVisible();
  const room = await field.evaluate((el: HTMLInputElement) => {
    const c = document.createElement("canvas").getContext("2d")!;
    const hint = getComputedStyle(el, "::placeholder"),
      box = getComputedStyle(el);
    c.font = `${hint.fontStyle} ${hint.fontWeight} ${hint.fontSize} ${hint.fontFamily}`;
    const line = document.querySelector(".cmdline")!;
    return {
      hint: c.measureText(el.placeholder).width,
      field: el.clientWidth - Number.parseFloat(box.paddingLeft) - Number.parseFloat(box.paddingRight),
      over: line.scrollWidth - line.clientWidth,
      page: document.scrollingElement!.scrollWidth,
    };
  });
  expect(room.hint).toBeGreaterThan(50);
  expect(room.hint, `the hint (${room.hint} px) in the field (${room.field} px)`).toBeLessThanOrEqual(room.field);
  expect(room.over).toBeLessThanOrEqual(0);
  expect(room.page).toBe(320);
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
    const banner = page.locator(".banner").filter({ hasText: "The engine didn't start." });
    await expect(banner, reason).toBeVisible();
    await expect(page.getByRole("alert"), "the live region says it once; the banner is no alert (C 5)").toHaveCount(0);
    await expect(banner).toContainText(words);
    await expect(banner).toContainText("Your files are safe: you can still edit and download them.");
    await expect(banner).not.toContainText("cause"); // the developer's cause is never shown
    for (const a of actions) await expect(banner.locator(".btn", { hasText: a })).toBeVisible();
    if (reason === "no-wasm") await expect(banner.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Download all (.zip)" })).toBeVisible();
  }
  await show(page, { s: "failed-twice", reason: "memory", detail: "x", message: "x" });
  const twice = page.locator(".banner").filter({ hasText: "The engine stopped after failing twice" });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(twice).toContainText("(out of memory)");
  await expect(twice).toContainText("Your files are safe: you can still edit and download them."); // as the failed banner says
  await expect(twice.getByRole("button", { name: "Reload the page" })).toBeVisible();
  await expect(twice.getByRole("button", { name: "Download all (.zip)" })).toBeVisible();
});

test("Download all in the failure banner is off while the store has no file, and on once it has one", async ({
  page,
}) => {
  // the store answers once the tab lock has (own-files lists it); a new context's store is empty
  await page.waitForFunction(() => window.__dofile.store.blocked === false);
  expect(await page.evaluate(() => window.__dofile.state.files.value.length)).toBe(0);
  await show(page, { s: "failed", reason: "download", detail: "", message: "x" });
  const button = page.locator(".banner").getByRole("button", { name: "Download all (.zip)" });
  await expect(button).toBeDisabled();
  await page.evaluate(() => window.__dofile.store.write("a.do", new TextEncoder().encode("display 1\n")));
  await expect(button).toBeEnabled();
});

test("Reset during a run always asks, even before the run has any data or results", async ({ page }) => {
  // the first run of a visit: no data and no results until it ends; a Reset that did not ask would cut it
  await show(page, { s: "running", run: { kind: "file", path: "a.do", fresh_locals: true }, t0: Date.now() });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Reset the engine…" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Reset the engine?" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
});

test("a banner that goes with the focus in it hands the focus on: the editor, or More actions when it is hidden", async ({
  page,
}) => {
  const ph = phone(page);
  // on a phone the log is its own view, so the editor is hidden there: More actions takes the focus
  if (ph) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const more = page.getByRole("button", { name: "More actions" });
  const handedOn = async () => {
    if (ph) await expect(more).toBeFocused();
    else await expect.poll(() => inEditor(page)).toBe(true);
  };
  const run = { kind: "command", fresh_locals: false };
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 3000 });
  const wait = page.getByRole("button", { name: "Don't reset: wait for it" });
  await expect(wait).toBeFocused();
  await show(page, { s: "ready" }); // the run ended while the focus was on "Don't reset"
  await expect(wait).toHaveCount(0);
  await handedOn();

  await page.evaluate(() =>
    window.__dofile.state.addBanner({ b: "reset", reason: "reset by you", kind: "user", run: null }),
  );
  const dismiss = page
    .locator(".banner", { hasText: "You reset the engine." })
    .getByRole("button", { name: "Dismiss" });
  await dismiss.focus(); // the keyboard's way: a click does not focus a button in Safari
  await page.keyboard.press("Enter");
  await expect(dismiss).toHaveCount(0);
  await handedOn();
});

test("the editor's and the Files pane's banners hand the focus on too: save-failed, run-changed (Dismiss, Reload from the run), not-text", async ({
  page,
}) => {
  const ph = phone(page);
  const more = page.getByRole("button", { name: "More actions" });
  // run-changed with no such file open or stored: "Reload from the run" reads nothing and only dismisses it
  const cases = [
    { banner: { b: "save-failed", path: "a.do", message: "the disk is full" }, words: "a.do couldn't be saved" },
    { banner: { b: "run-changed", path: "t.csv" }, words: "The run changed t.csv." },
    { banner: { b: "run-changed", path: "t.csv" }, words: "The run changed t.csv.", button: "Reload from the run" },
    { banner: { b: "not-text", path: "s.xlsx" }, words: "s.xlsx can't be opened in the editor.", view: "files" },
  ];
  for (const { banner, words, button = "Dismiss", view = "editor" } of cases) {
    if (ph) await page.evaluate((v) => (window.__dofile.state.phoneTab.value = v), view);
    await page.evaluate((b) => window.__dofile.state.addBanner(b), banner);
    const press = page.locator(".banner", { hasText: words }).getByRole("button", { name: button });
    await press.focus(); // the keyboard's way: a click does not focus a button in Safari
    await page.keyboard.press("Enter");
    await expect(press).toHaveCount(0);
    // on a phone the Files view hides the editor: More actions takes the focus there
    if (ph && view !== "editor") await expect(more, `${banner.b}: ${button}`).toBeFocused();
    else await expect.poll(() => inEditor(page), `${banner.b}: ${button}`).toBe(true);
  }
});

test("a dialog whose opener has left the page gives the focus to the editor, or More actions, not to the page", async ({
  page,
}) => {
  const ph = phone(page);
  if (ph) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const run = { kind: "command", fresh_locals: false };
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 3000 });
  await expect(page.getByRole("button", { name: "Don't reset: wait for it" })).toBeFocused();
  // another tab takes the lock during the Break: the stopping banner goes, the other-tab dialog opens over it
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.engine.value = { s: "other-tab-idle" };
    s.dialog.value = { d: "other-tab" };
  });
  const dlg = page.getByRole("alertdialog", { name: "dofile is open in another tab" });
  await expect(dlg.getByRole("button", { name: "Close editor" })).toBeFocused();
  // "Use dofile in this tab" went through: the dialog closes, and its opener (Don't reset) is gone
  await page.evaluate(() => {
    const s = window.__dofile.state;
    s.dialog.value = null;
    s.engine.value = { s: "none" };
  });
  await expect(dlg).toHaveCount(0);
  if (ph) await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();
  else await expect.poll(() => inEditor(page)).toBe(true);
});

test("with a .dta tab active, a banner that goes with the focus hands it to that tab, in one move", async ({
  page,
}) => {
  test.skip(phone(page), "a phone's banner sits on the Log view, where the Editor view's tab is hidden");
  await page.waitForFunction(() => window.__dofile.store.blocked === false);
  await page.evaluate(() => window.__dofile.store.write("d.dta", new TextEncoder().encode("not read here")));
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^d\.dta/ })
    .click();
  const tab = page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: /^d\.dta/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() =>
    window.__dofile.state.addBanner({ b: "reset", reason: "reset by you", kind: "user", run: null }),
  );
  const dismiss = page
    .locator(".banner", { hasText: "You reset the engine." })
    .getByRole("button", { name: "Dismiss" });
  await dismiss.focus();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__focused = seen;
    document.addEventListener("focusin", (e) =>
      seen.push((e.target as Element).getAttribute("role") ?? (e.target as Element).tagName),
    );
  });
  await page.keyboard.press("Enter");
  await expect(tab).toBeFocused();
  expect(await page.evaluate(() => (window as any).__focused)).toEqual(["tab"]); // not the tab, then More actions
});

test("from the stopping banner to the waiting banner the focus goes straight across, never through the editor", async ({
  page,
}) => {
  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const run = { kind: "command", fresh_locals: false };
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 3000 });
  await expect(page.getByRole("button", { name: "Don't reset: wait for it" })).toBeFocused();
  // every element that takes the focus from here on, by where it is
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__focused = seen;
    document.addEventListener("focusin", (e) => {
      const t = e.target as Element;
      seen.push(
        t.closest("[data-editor]")
          ? "editor"
          : t.closest(".banner")
            ? "banner"
            : (t.getAttribute("aria-label") ?? t.tagName),
      );
    });
  });
  await show(page, { s: "waiting", run, t0: Date.now() - 9000 }); // "Don't reset: wait for it" was pressed
  const waiting = page.locator(".banner", { hasText: "Waiting for this command to end." });
  await expect(waiting).toBeFocused();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(waiting).toBeFocused();
  expect(await page.evaluate(() => (window as any).__focused)).toEqual(["banner"]);
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
  // Break pending for 0.5 s only: "Stopping…" already, but no button and no focus moved yet (SPEC OQ-21)
  await show(page, { s: "breaking", run, t0: Date.now() - 9000, resetAt: Date.now() + 4500 });
  await expect(stopping).toBeVisible();
  await expect(stopping.getByRole("button")).toHaveCount(0);

  await show(page, { s: "waiting", run, t0: Date.now() - 9000 });
  const waiting = page.locator(".banner", { hasText: "Waiting for this command to end." });
  await expect(waiting).toBeVisible();
  await expect(waiting).toBeFocused();
  await expect(waiting).toHaveAttribute("tabindex", "-1");
});

// A fake clock, so the page's one clock (editor/clock.ts) is read between its ticks, not across them. The Break pill (a
// phone) or the status bar (else) and the banner must show the same time at every tick, with the same rounding.
test("one clock: the Break pill, the status bar and the banners agree, and Stopping… shows from the press", async ({
  page,
}) => {
  const T = 1_900_000_000_000;
  await page.clock.install({ time: T });
  await page.clock.pauseAt(T + 60_000);
  const at = T + 60_000;
  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const run = { kind: "selection", lines: [14, 15], fresh_locals: false };
  const pill = page.locator(".btn.stop.pill .label:not([aria-hidden]) .pill-time");
  const status = page.locator('.statusbar [data-state="running"]');
  const banner = page.locator(".banner", { hasText: "Running lines 14–15" });
  const fmt = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 1000)} s`);

  // 9 s to 14 s in steps of 100 ms: the tenths below 10 s, then whole seconds, floored, on both
  await show(page, { s: "running", run, t0: at - 9000 });
  for (let k = 0; k <= 50; k++) {
    const t = fmt(9000 + 100 * k);
    await expect(banner.locator("b").first()).toHaveText(t);
    if (phone(page)) await expect(pill).toHaveText(t);
    else await expect(status).toHaveText(new RegExp(`· ${t.replace(".", "\\.")}$`));
    await page.clock.runFor(100);
  }

  // Break pressed: both say "Stopping…" at once, the button waits 1 s, the countdowns agree, and it lasts until the
  // engine confirms (here: ready)
  const pressed = at + 5100;
  await show(page, { s: "breaking", run, t0: pressed - 20_000, resetAt: pressed + 5000 });
  const stopping = page.locator(".banner", { hasText: "Stopping…" });
  const breakBtn = page.getByRole("button", { name: "Stopping…" });
  const keep = stopping.getByRole("button", { name: "Don't reset: wait for it" });
  for (let k = 0; k <= 40; k++) {
    const left = Math.ceil((5000 - 100 * k) / 1000);
    await expect(stopping).toBeVisible();
    await expect(breakBtn).toBeVisible();
    await expect(stopping).toContainText(
      left > 0 ? `In ${left} s the engine is reset:` : "The engine is being reset now:",
    );
    if (!phone(page)) {
      await expect(page.locator(".statusbar")).toContainText(`resets in ${left} s`);
      await expect(page.locator(".statusbar")).toContainText(` ${fmt(20_000 + 100 * k)}`); // the run's time, in `ticking`'s words
    }
    if (k < 10) await expect(keep).toHaveCount(0);
    else if (k > 10) await expect(keep).toBeFocused();
    await page.clock.runFor(100);
  }
  await show(page, { s: "ready" });
  await expect(stopping).toHaveCount(0);
  await expect(breakBtn).toHaveCount(0);
});

test("the storage, reset and download-failed banners", async ({ page }) => {
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
    s.addBanner({ b: "reset", reason: "the code did not stop at Break", kind: "break", run: null });
  });
  const reset = page.locator(".banner", { hasText: "The engine was reset:" });
  await expect(reset).toContainText("The engine was reset: the code did not stop at Break.");
  await expect(reset).toContainText("The data in memory is lost; your files are kept.");
  await expect(reset.getByRole("button", { name: "Run the file again" })).toHaveCount(0); // no run was cut: only Dismiss
  // a cut run of a file, with no engine to run it: the button is there and off
  await page.evaluate(() => {
    window.__dofile.state.addBanner({
      b: "reset",
      reason: "the code did not stop at Break",
      kind: "break",
      run: { kind: "file", path: "gone.do", fresh_locals: true },
    });
  });
  await expect(reset.getByRole("button", { name: "Run the file again" })).toBeDisabled();
  await reset.getByRole("button", { name: "Dismiss" }).click();
  await expect(reset).toHaveCount(0);
});

test("Reset asks once anything has run on the engine (data, a global, a scalar); Cancel keeps it; Reset clears it and the banner says so", async ({
  page,
}) => {
  await page.goto("?test");
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

  // anything a run leaves counts, not only data and e() or r() results: a run that made only a global and a Stata scalar asks
  await expect.poll(() => engineIs(page), { timeout: 300_000 }).toBe("ready");
  expect(await page.evaluate(() => window.__dofile.state.engineRuns.value)).toBe(0); // a new engine: nothing has run
  expect((await page.evaluate(() => window.__dofile.run("global g hello\nscalar k = 3")))?.rc).toBe(0);
  expect(await page.evaluate(() => window.__dofile.state.data.value?.nobs ?? 0)).toBe(0); // no data
  const res = await page.evaluate(() => window.__dofile.state.results.value);
  for (const k of ["e", "r"]) {
    const r = res?.[k] ?? { scalars: {}, macros: {}, matrices: {} };
    expect(Object.keys({ ...r.scalars, ...r.macros, ...r.matrices }), k).toEqual([]); // and no e() or r() results
  }
  await more();
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
  expect(await engineIs(page)).toBe("ready");
  expect((await page.evaluate(() => window.__dofile.run('display "$g"')))?.rc).toBe(0); // Cancel kept the global

  // "Run the file again" with 4b's editor: it runs the file whose run the reset cut, not the active tab; it is on with the
  // engine ready and that file open as text, and it is not offered after a Reset the visitor asked for
  await page.evaluate(() => window.__dofile.store.write("again.do", new TextEncoder().encode("display 40+2\n")));
  await page.evaluate(() => window.__dofile.store.write("other.do", new TextEncoder().encode("display 7\n")));
  for (const name of ["again.do", "other.do"]) {
    if (phone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
    await page
      .getByRole("tree", { name: "Files" })
      .getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) })
      .click();
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", `Editor: ${name}`);
  }
  await page.evaluate(() => {
    window.__dofile.state.dismiss({ b: "reset" });
    window.__dofile.state.addBanner({
      b: "reset",
      reason: "reset by you",
      kind: "user",
      run: { kind: "file", path: "again.do", fresh_locals: true },
    });
  });
  if (phone(page)) await page.evaluate(() => (window.__dofile.state.phoneTab.value = "log"));
  const asked = page.locator(".banner", { hasText: "You reset the engine." });
  await expect(asked).toBeVisible();
  await expect(asked.getByRole("button", { name: "Run the file again" })).toHaveCount(0);
  await page.evaluate(() => {
    window.__dofile.state.addBanner({
      b: "reset",
      reason: "the code did not stop at Break",
      kind: "break",
      run: { kind: "file", path: "again.do", fresh_locals: true },
    });
  });
  const again = page.locator(".banner", { hasText: "The engine was reset:" });
  // the engine is ready, but the cut file is not open as a tab: the button is off until it is
  await page.evaluate(() => {
    window.__dofile.state.addBanner({
      b: "reset",
      reason: "the code did not stop at Break",
      kind: "break",
      run: { kind: "file", path: "closed.do", fresh_locals: true },
    });
  });
  await expect(again.getByRole("button", { name: "Run the file again" })).toBeDisabled();
  await page.evaluate(() => {
    window.__dofile.state.addBanner({
      b: "reset",
      reason: "the code did not stop at Break",
      kind: "break",
      run: { kind: "file", path: "again.do", fresh_locals: true },
    });
  });
  await expect(again.getByRole("button", { name: "Run the file again" })).toBeEnabled();
  await again.getByRole("button", { name: "Run the file again" }).click();
  await expect(again).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.path)).toBe("again.do");
  expect(await page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(0);
  await expect(page.getByRole("log", { name: "Log" })).toContainText("42");
});

test("a hint's help link pressed while a run is on or a start is on its way says why in a toast, and runs nothing", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__dofile.state.runWriter.log.value = [
      { t: "head" },
      {
        t: "text",
        run: 1,
        text: '. summarize sex\nsex not found\n  → "sex" is not a variable.\n    Learn more: help summarize\nr(111);\n',
        end: { kind: "command", fresh_locals: false, rc: 111, line: null, seconds: 0.1 },
      },
    ];
  });
  if (phone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Log" }).click();
  const help = page.getByRole("log", { name: "Log" }).getByRole("button", { name: "help summarize" });
  const toast = page.locator(".toast");
  const cases: [string, object, string][] = [
    [
      "running",
      { s: "running", run: { kind: "file", path: "a.do", fresh_locals: true }, t0: Date.now() },
      "Run is not available until the current run ends",
    ],
    [
      "downloading",
      { s: "downloading", received: 1e6, total: 48e6, t0: Date.now() },
      "The engine is starting. Try again when it is ready.",
    ],
  ];
  for (const [name, st, words] of cases) {
    await show(page, st);
    await page.evaluate(() => {
      window.__dofile.state.toast.value = null;
    });
    // a live link, not an off one: it is pressed as a visitor does
    await expect(help, name).not.toHaveAttribute("aria-disabled", "true");
    await help.click();
    await expect(toast, name).toHaveText(words);
  }
  expect(await page.evaluate(() => window.__dofile.state.history.value)).toEqual([]);
});

test("a held Enter on a Run button presses it once: the repeats of the key click nothing (the toolbar's Run, the phone's Run, the command line's Start engine and Run command)", async ({
  page,
}) => {
  const clear = () =>
    page.evaluate(() => {
      window.__dofile.state.toast.value = null;
    });
  const toastNow = () => page.evaluate(() => window.__dofile.state.toast.value);
  /** Enter held on the button: the first keydown clicks it, the repeats (Playwright sends a second `down` of a held key
   *  as a repeat) must not. */
  const held = async (button: Locator, words: string, name: string) => {
    await clear();
    await button.focus();
    await page.keyboard.down("Enter");
    await expect.poll(toastNow, name).toBe(words);
    await clear();
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    expect(await toastNow(), `${name}: a repeat clicked the button`).toBeNull();
  };
  const views = page.getByRole("tablist", { name: "Views" });
  // a file is open (the toolbar's Run is there then)
  await page.evaluate(() => window.__dofile.store.write("held.do", new TextEncoder().encode("display 1\n")));
  if (phone(page)) await views.getByRole("tab", { name: "Files" }).click();
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^held\.do/ })
    .click();
  await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", "Editor: held.do");
  // a start is on its way: the toolbar's Run (the phone's too) is off, "Starting…", and a press says why
  await show(page, { s: "downloading", received: 1e6, total: 48e6, t0: Date.now() });
  if (phone(page)) await views.getByRole("tab", { name: "Editor" }).click();
  await held(
    page.locator(".toolbar .btn.primary.run-ctl"),
    "The engine is starting. Try again when it is ready.",
    "the toolbar's Run",
  );
  // no engine from here (a failed start twice): the command line's Start engine is off, and a press says why
  await show(page, { s: "failed-twice", reason: "memory", detail: "cause", message: "words" });
  if (phone(page)) await views.getByRole("tab", { name: "Log" }).click();
  await held(
    page.locator(".cmdline").getByRole("button", { name: "Start engine" }),
    "The engine isn't running",
    "the command line's Start engine",
  );
  // a run is on: the command line's Run command is off, and a press says why
  await show(page, { s: "running", run: { kind: "file", path: "a.do", fresh_locals: true }, t0: Date.now() });
  await held(
    page.locator(".cmdline").getByRole("button", { name: "Run command" }),
    "Run is not available until the current run ends",
    "the command line's Run command",
  );
});
