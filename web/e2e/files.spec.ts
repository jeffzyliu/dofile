// Prototype 1, step 4a: the file tree, the editor's tabs, upload and its name clashes, the row menus, opening files
// (docs/design/SPEC.md, sections 3.1, 3.2, 3.10, 3.11). No engine is needed (?test=manual): files go in through the test
// hook's store or the upload inputs. There is no editor until step 4b, so no tab can become dirty by typing: the tests
// make the edits with the hook's state.setDirty(path, true); the close-tab dialog's Save saves through step 4b's editor
// and closes the tab (e2e/editor.spec.ts types real edits).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  state: {
    setDirty(path: string, on: boolean): void;
    tabs: { value: { path: string; dirty: boolean }[] };
    activeTab: { value: string | null };
    phoneTab: { value: string };
    files: { value: { path: string }[] };
  };
  store: {
    blocked: boolean;
    write(path: string, bytes: Uint8Array): Promise<unknown>;
    read(path: string): Promise<Uint8Array>;
    list(): Promise<{ path: string }[]>;
  };
};

/** Open the page with no engine and write `files` (text, or bytes as an array of numbers) into the store. */
async function setUp(page: Page, files: Record<string, string | number[]>) {
  await page.goto("?test=manual");
  await page.waitForFunction(() => (window as unknown as { __dofile: Hook }).__dofile.store.blocked === false);
  await page.evaluate(async (files) => {
    const { store } = (window as unknown as { __dofile: Hook }).__dofile;
    for (const [path, data] of Object.entries(files))
      await store.write(path, typeof data === "string" ? new TextEncoder().encode(data) : Uint8Array.from(data));
  }, files);
  if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
}
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 700;
const tree = (page: Page) => page.getByRole("tree", { name: "Files" });
const row = (page: Page, name: string | RegExp) => tree(page).getByRole("treeitem", { name });
const textOf = (page: Page, path: string) =>
  page.evaluate(
    async (p) => new TextDecoder().decode(await (window as unknown as { __dofile: Hook }).__dofile.store.read(p)),
    path,
  );
const setDirty = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __dofile: Hook }).__dofile.state.setDirty(p, true), path);
const openTabs = (page: Page) =>
  page.evaluate(() => (window as unknown as { __dofile: Hook }).__dofile.state.tabs.value.map((t) => t.path));

/** From now on, record every element outside a dialog that takes the focus (`moves`, read them with movesOf). */
const recordMoves = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { moves: string[]; recording?: boolean };
    w.moves = [];
    if (w.recording) return;
    w.recording = true;
    document.addEventListener(
      "focusin",
      (e) => {
        const el = e.target as HTMLElement;
        if (!el.closest("dialog")) w.moves.push(`${el.getAttribute("role") ?? el.tagName}:${el.textContent?.trim()}`);
      },
      true,
    );
  });
const movesOf = (page: Page) => page.evaluate(() => (window as unknown as { moves: string[] }).moves);

/** Open the file actions menu: the Files head's "File actions"; on a phone the "Files ⋯" button at the right of the strip
 *  under the top bar, on the Files view. */
async function fileActions(page: Page) {
  await page.getByRole("button", { name: "File actions" }).click();
  return page.getByRole("menu", { name: "File actions" });
}

test("the tree: folders first with their levels, sizes, folding by keyboard; Enter opens a file in a tab", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n", "data/raw/survey.csv": "a,b\n1,2\n", "data/wages.dta": "x".repeat(8000) });
  const items = tree(page).getByRole("treeitem");
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toHaveAttribute("aria-level", "1");
  await expect(items.nth(0)).toHaveAttribute("aria-expanded", "true");
  await expect(items.nth(1)).toHaveAttribute("aria-level", "2"); // data/raw/
  await expect(items.nth(2)).toHaveAttribute("aria-level", "3"); // survey.csv
  await expect(row(page, /^wages\.dta/)).toContainText("8 KB");
  // one row in the tab order: the first, as nothing is open
  await expect(tree(page).locator('[tabindex="0"]')).toHaveCount(1);
  await items.nth(0).focus();
  await page.keyboard.press("ArrowLeft"); // fold data/
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight"); // unfold
  await expect(items).toHaveCount(5);
  await expect(tree(page).locator("[aria-current]")).toHaveCount(0); // the keys fold and unfold, and select nothing
  await page.keyboard.press("ArrowRight"); // into it: raw/
  await expect(row(page, /^raw\//)).toBeFocused();
  await page.keyboard.press("End");
  await expect(row(page, /^a\.do/)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => openTabs(page)).toEqual(["a.do"]);
  if (isPhone(page)) {
    // the phone shows the Editor view, titled with the file
    await expect(page.locator(".topbar .title")).toContainText("a.do");
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  } else {
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: "a.do" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await expect(row(page, /^a\.do/)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, /^a\.do/)).toHaveClass(/\bopen\b/);
});

test("tabs: a second file opens a second tab; a tab with no edits closes at once, one with unsaved edits asks (Cancel; Save that fails closes the dialog and keeps the tab open; Save; Don't save); the focus goes to a tab or the tree, never the page, in one move after Save and Don't save", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n", "b.do": "2\n", "c.do": "3\n" });
  for (const name of ["a.do", "b.do", "c.do"]) {
    await row(page, new RegExp(`^${name}`)).click();
    if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  }
  await expect.poll(() => openTabs(page)).toEqual(["a.do", "b.do", "c.do"]);
  await setDirty(page, "a.do");
  await expect(row(page, /^a\.do/).getByRole("img", { name: "unsaved changes" })).toBeVisible();
  const ask = page.getByRole("dialog", { name: "Save changes to a.do?" });
  if (isPhone(page)) {
    // the phone has no ×: the top bar's file switcher lists the open files and closes the open one
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Editor" }).click();
    const switcher = page.getByRole("button", { name: /c\.do\. Open files/ });
    await switcher.click();
    await expect(page.getByRole("menu", { name: "Open files" })).toBeVisible();
    await switcher.click(); // a second tap closes it, a third opens it again
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(switcher).toHaveAttribute("aria-expanded", "false");
    await switcher.click();
    await page.getByRole("menuitem", { name: "Close c.do" }).click();
    await expect.poll(() => openTabs(page)).toEqual(["a.do", "b.do"]);
    await page.getByRole("button", { name: /\. Open files/ }).click();
    await page.getByRole("menuitem", { name: /^a\.do/ }).click();
    await page.getByRole("button", { name: /a\.do, unsaved changes\. Open files/ }).click();
    await page.getByRole("menuitem", { name: "Close a.do" }).click();
  } else {
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await tabs.getByRole("tab", { name: "c.do" }).focus();
    await page.keyboard.press("Delete"); // no edits: closes, and the tab to its left is selected and focused
    await expect.poll(() => openTabs(page)).toEqual(["a.do", "b.do"]);
    await expect(tabs.getByRole("tab", { name: "b.do" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.getByRole("tab", { name: /^a\.do/ })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: /^a\.do/ }).getByRole("img", { name: "unsaved changes" })).toBeVisible();
    await page.keyboard.press("Delete");
  }
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); // Esc is Cancel
  await expect(ask).toBeHidden();
  expect(await openTabs(page)).toEqual(["a.do", "b.do"]);
  const again = async () => {
    if (isPhone(page)) {
      await page.getByRole("button", { name: /a\.do, unsaved changes\. Open files/ }).click();
      await page.getByRole("menuitem", { name: "Close a.do" }).click();
    } else
      await page
        .getByRole("tablist", { name: "Open files" })
        .getByRole("tab", { name: /^a\.do/ })
        .press("Delete");
    await expect(ask).toBeVisible();
  };
  // Save fails (the store's write rejects): the tab stays open with its edits, and the save-failed banner says so
  await page.evaluate(() => {
    const s = (window as unknown as { __dofile: Hook }).__dofile.store as Hook["store"] & Record<string, unknown>;
    s.realWrite = s.write;
    s.write = () => Promise.reject(new Error("the disk is full"));
  });
  await again();
  await ask.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator(".banner", { hasText: "a.do couldn't be saved" })).toBeVisible();
  expect(await openTabs(page)).toEqual(["a.do", "b.do"]);
  expect(await textOf(page, "a.do")).toBe("1\n");
  await page.evaluate(() => {
    const s = (window as unknown as { __dofile: Hook }).__dofile.store as Hook["store"] & Record<string, unknown>;
    s.write = s.realWrite as Hook["store"]["write"];
  });
  await again();
  await recordMoves(page);
  await ask.getByRole("button", { name: "Save", exact: true }).click(); // step 4b's editor saves it, then the tab closes
  await expect(ask).toBeHidden();
  await expect.poll(() => openTabs(page)).toEqual(["b.do"]);
  await expect(page.locator(".toast")).toHaveText("Saved a.do");
  // one move, once the file is written: to the tab now selected (the phone: the editor), not first back to a.do's tab
  if (!isPhone(page))
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: "b.do" })).toBeFocused();
  else await expect(page.locator(".cm-content")).toBeFocused();
  await page.waitForTimeout(100); // any later move would come by now
  expect(await movesOf(page)).toEqual(isPhone(page) ? ["textbox:2"] : ["tab:b.do×"]);
  // open it again, with edits, for Don't save
  if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  await row(page, /^a\.do/).click();
  await expect.poll(() => openTabs(page)).toEqual(["b.do", "a.do"]);
  await setDirty(page, "a.do");
  if (!isPhone(page))
    await page
      .getByRole("tablist", { name: "Open files" })
      .getByRole("tab", { name: /^a\.do/ })
      .focus();
  await again();
  await recordMoves(page); // every element outside the dialog that takes the focus from here on
  await ask.getByRole("button", { name: "Don't save" }).click();
  await expect.poll(() => openTabs(page)).toEqual(["b.do"]);
  if (!isPhone(page)) {
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await expect(tabs.getByRole("tab", { name: "b.do" })).toBeFocused(); // the tab now selected, not the page
    await page.waitForTimeout(100); // any later move would come by now
    // one move: straight to that tab, not through the editor first (the dialog leaves the focus to the close)
    expect(await movesOf(page)).toEqual(["tab:b.do×"]); // the tab holds its × button
    await page.keyboard.press("Delete"); // the last tab: the focus goes to the file tree
    await expect.poll(() => openTabs(page)).toEqual([]);
    await expect(tree(page).locator('[tabindex="0"]')).toBeFocused();
  } else {
    // the phone shows no tabs: one move, to the editor, which focusAfterClose chooses (not first back to the switcher)
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.waitForTimeout(100);
    expect(await movesOf(page)).toEqual(["textbox:2"]);
  }
});

test("rename in place: F2; a name in use keeps the field open with the reason; Esc cancels; Enter renames, and the open tab follows", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n", "b.do": "2\n" });
  await row(page, /^a\.do/).click();
  if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  await row(page, /^a\.do/).focus();
  await page.keyboard.press("F2");
  const field = page.getByRole("textbox", { name: "New name for a.do" });
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 1]); // "a"
  await page.keyboard.type("b");
  await page.keyboard.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  // in the tree: the live region says the same words 50 ms later (state.ts say), and two matches fail the locator
  await expect(tree(page).getByText("b.do already exists here.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field).toBeHidden();
  await expect(row(page, /^a\.do/)).toBeFocused();
  await page.keyboard.press("F2");
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("main.do");
  await page.keyboard.press("Enter");
  await expect(row(page, /^main\.do/)).toBeFocused();
  await expect.poll(() => openTabs(page)).toEqual(["main.do"]);
  expect(await textOf(page, "main.do")).toBe("1\n");
});

test("a renamed row drawn after the visitor clicked into the editor leaves the focus in the editor", async ({
  page,
}) => {
  test.skip(isPhone(page), "a phone shows the tree and the editor in separate views: a hidden row takes no focus");
  await setUp(page, { "a.do": "1\n" });
  await row(page, /^a\.do/).click();
  // the store's lists wait for the test, so the renamed row is drawn only when the test says
  await page.evaluate(() => {
    const s = (window as any).__dofile.store;
    const real = s.list;
    let answer!: () => void;
    const gate = new Promise<void>((ok) => (answer = ok));
    (window as any).__answer = () => {
      s.list = real;
      answer();
    };
    s.list = (...a: unknown[]) => gate.then(() => real.apply(s, a));
  });
  await row(page, /^a\.do/).focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "New name for a.do" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("b.do");
  await page.keyboard.press("Enter");
  await expect.poll(() => openTabs(page)).toEqual(["b.do"]);
  const editor = page.locator(".cm-content");
  await editor.click();
  await expect(editor).toBeFocused();
  await page.evaluate(() => (window as any).__answer());
  await expect(row(page, /^b\.do/)).toBeVisible();
  await page.waitForTimeout(300); // a late focus of the row would have come by now
  await expect(editor).toBeFocused();
  await page.keyboard.type("z");
  await expect(editor).toContainText("z");
});

test("a renamed row drawn after the visitor clicked another row leaves the focus on that row", async ({ page }) => {
  test.skip(
    isPhone(page),
    "a phone shows the tree and the editor in separate views: a click on a row opens it and leaves",
  );
  await setUp(page, { "a.do": "1\n", "c.do": "3\n" });
  // the store's lists wait for the test, so the renamed row is drawn only when the test says
  await page.evaluate(() => {
    const s = (window as any).__dofile.store;
    const real = s.list;
    let answer!: () => void;
    const gate = new Promise<void>((ok) => (answer = ok));
    (window as any).__answer = () => {
      s.list = real;
      answer();
    };
    s.list = (...a: unknown[]) => gate.then(() => real.apply(s, a));
  });
  await row(page, /^a\.do/).focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "New name for a.do" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("b.do");
  await page.keyboard.press("Enter");
  await row(page, /^c\.do/).click();
  await expect(row(page, /^c\.do/)).toBeFocused();
  await page.evaluate(() => (window as any).__answer());
  await expect(row(page, /^b\.do/)).toBeVisible();
  await page.waitForTimeout(300); // a late focus of the renamed row would have come by now
  await expect(row(page, /^c\.do/)).toBeFocused();
  // the request was ended when b.do was drawn, not left to fire when b.do is made the roving row some other way
  expect(await page.evaluate(() => (window as any).__dofile.focusWanted.value)).toBeNull();
});

test("a menu's arrow keys skip a disabled item in the middle or at the end, and wrap around", async ({ page }) => {
  await setUp(page, {}); // no files: "Download all (.zip)" and "Delete all files…" are disabled
  const menu = await fileActions(page);
  const item = (name: string) => menu.getByRole("menuitem", { name });
  await expect(item("Download all (.zip)")).toHaveAttribute("aria-disabled", "true");
  await expect(item("Delete all files…")).toHaveAttribute("aria-disabled", "true");
  await expect(item("New .do file")).toBeFocused();
  await page.keyboard.press("End"); // the last item is not the disabled one at the end
  await expect(item("Restore the sample")).toBeFocused();
  await page.keyboard.press("ArrowUp"); // past the disabled one in the middle
  await expect(item("Upload a folder")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Restore the sample")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // past the disabled last one, round to the first
  await expect(item("New .do file")).toBeFocused();
  await page.keyboard.press("ArrowUp"); // and back round to the last
  await expect(item("Restore the sample")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(item("New .do file")).toBeFocused();
});

test("an item that turns enabled while a menu is open does not move the focus", async ({ page }) => {
  await setUp(page, {}); // no files: "Download all (.zip)", before the focused item, is disabled
  const menu = await fileActions(page);
  const item = (name: string) => menu.getByRole("menuitem", { name });
  await page.keyboard.press("End");
  await expect(item("Restore the sample")).toBeFocused();
  await page.evaluate(async () => {
    const { store } = (window as unknown as { __dofile: Hook }).__dofile; // as a run's output would
    await store.write("a.do", new TextEncoder().encode("display 1\n"));
  });
  await expect(item("Download all (.zip)")).not.toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(300); // a late move of the focus would have come by now
  await expect(item("Restore the sample")).toBeFocused();
  await page.keyboard.press("ArrowUp"); // the keys go on from the focused item, and the one that turned enabled takes part
  await expect(item("Download all (.zip)")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Restore the sample")).toBeFocused();
});

test("after a click on a disabled item, Home and the arrows go on from it", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "a click on a button focuses nothing in Safari, so no key reaches the menu");
  await setUp(page, {});
  const menu = await fileActions(page);
  const item = (name: string) => menu.getByRole("menuitem", { name });
  await expect(item("New .do file")).toBeFocused();
  await item("Download all (.zip)").click({ force: true }); // aria-disabled, so not "actionable": force; a browser may focus the clicked button, and the menu stays open
  await expect(menu).toBeVisible();
  await page.keyboard.press("Home");
  await expect(item("New .do file")).toBeFocused();
  await item("Download all (.zip)").click({ force: true });
  await expect(item("Download all (.zip)")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // from the clicked item, not from the one before the click
  await expect(item("Restore the sample")).toBeFocused();
});

test("the row menu (Shift+F10, right click, the ⋯): Delete asks, Cancel is the default; a folder's menu; Delete all files asks with the count", async ({
  page,
  isMobile,
}) => {
  await setUp(page, { "a.do": "1\n", "b.do": "2\n", "data/c.do": "3\n" });
  await row(page, /^b\.do/).focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Actions for b.do" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Open", "RenameF2", "Download", "Delete…"]);
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("alertdialog", { name: "Delete b.do?" });
  await expect(ask).toContainText("It exists only in this browser. This can't be undone.");
  await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter"); // the default is Cancel
  await expect(ask).toBeHidden();
  await expect(row(page, /^b\.do/)).toBeVisible();
  await row(page, /^b\.do/).click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for b.do" }).getByRole("menuitem", { name: "Delete…" }).click();
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect(row(page, /^b\.do/)).toHaveCount(0);
  await expect(tree(page).locator('[tabindex="0"]')).toBeFocused(); // the focus goes back to the tree, not the page
  // a folder: Rename, Download (.zip), Delete…
  await row(page, /^data\//).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for data/" }).getByRole("menuitem")).toHaveText([
    "New file here",
    "New folder",
    "RenameF2",
    "Download (.zip)",
    "Delete…",
  ]);
  await page.keyboard.press("Escape");
  // the file actions: the Files head's menu; on a phone that head is hidden and the same menu is the "Files ⋯" button in the strip
  const head = await fileActions(page);
  if (isMobile) await expect(page.locator(".files-pane > .pane-head")).toBeHidden();
  await expect(head.getByRole("menuitem")).toHaveText([
    "New .do file",
    "New folder",
    "Upload a folder",
    "Download all (.zip)",
    "Restore the sample", // step 5, above Delete all files… (OQ-13)
    "Delete all files…",
  ]);
  await head.getByRole("menuitem", { name: "Delete all files…" }).click();
  const all = page.getByRole("alertdialog", { name: "Delete all 2 files?" });
  await expect(all).toContainText("This removes every file dofile keeps in this browser. This can't be undone.");
  await expect(all.getByRole("button", { name: "Cancel" })).toBeFocused();
  await all.getByRole("button", { name: "Delete all" }).click();
  await expect(tree(page)).toHaveCount(0);
  await fileActions(page);
  await expect(page.getByRole("menuitem", { name: "Delete all files…" })).toHaveAttribute("aria-disabled", "true");
});

/** Press arrow, Home, End and Delete keys with Alt, then Ctrl, then Cmd (Meta) held, as events made in the page on the element
 *  that has the focus (a real Alt+Left could take a browser Back, which a test must not). A `keydown` listener on the
 *  document records whether each was default-prevented, after the widget's own handlers have run. Returns what went wrong:
 *  the keys that were prevented (the browser's Back is then swallowed) and the keys that moved the focus. */
const modifierKeys = (page: Page) =>
  page.evaluate(() => {
    const prevented: string[] = [];
    const moved: string[] = [];
    let last = false;
    const listen = (e: KeyboardEvent) => {
      last = e.defaultPrevented;
    };
    document.addEventListener("keydown", listen);
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) {
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End", "Delete"]) {
        const before = document.activeElement;
        last = false;
        before?.dispatchEvent(new KeyboardEvent("keydown", { key, [mod]: true, bubbles: true, cancelable: true }));
        if (last) prevented.push(`${mod}+${key}`);
        if (document.activeElement !== before) moved.push(`${mod}+${key}`);
        (before as HTMLElement | null)?.focus(); // the next key starts where this one did, whatever happened
      }
    }
    document.removeEventListener("keydown", listen);
    return { prevented, moved };
  });

test("arrow, Home, End and Delete keys with Alt, Ctrl or Cmd are left to the browser (Alt+Left is Back on Windows): the tree, a tablist, the open-file tabs and the menus keep the focus and leave the event alone", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n", "b.do": "2\n", "data/c.do": "3\n" });
  const none = { prevented: [], moved: [] };
  // the file tree: the middle row, so Up and Down would move
  await row(page, /^a\.do/).focus();
  expect(await modifierKeys(page)).toEqual(none);
  await expect(row(page, /^a\.do/)).toBeFocused();
  // a tablist (Tablist.tsx): the Output tabs on the desktop, the Views bar on a phone
  const tablist = page.getByRole("tablist", { name: isPhone(page) ? "Views" : "Output" });
  await tablist.getByRole("tab", { selected: true }).focus();
  expect(await modifierKeys(page)).toEqual(none);
  // the open-file tabs (the desktop only: a phone's switcher is a menu); Delete would close one
  if (!isPhone(page)) {
    for (const name of [/^a\.do/, /^b\.do/]) await row(page, name).click();
    await expect.poll(() => openTabs(page)).toEqual(["a.do", "b.do"]);
    await page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { selected: true }).focus();
    expect(await modifierKeys(page)).toEqual(none);
    expect(await openTabs(page)).toEqual(["a.do", "b.do"]);
    await row(page, /^a\.do/).focus();
  }
  // the menu button (ArrowDown opens its menu) and the open menu (ArrowDown, Home and End move in it)
  await page.getByRole("button", { name: "File actions" }).focus();
  expect(await modifierKeys(page)).toEqual(none);
  await expect(page.getByRole("menu", { name: "File actions" })).toHaveCount(0);
  await row(page, /^a\.do/).focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Actions for a.do" });
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  expect(await modifierKeys(page)).toEqual(none);
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

// 700 to 1199 px the list is folded away, and Esc in it folds it (App.tsx): an Esc that cancels a rename must not.
test("the folded file list: Esc in an inline rename cancels the rename and leaves the list open", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the folded list is a desktop width");
  await page.setViewportSize({ width: 1024, height: 800 });
  await setUp(page, { "a.do": "1\n" });
  const toggle = page.getByRole("button", { name: "Files 1" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // the unfolded list gives the focus to the tree's row after its render (App.tsx): wait for it, or that late focus
  // would take the focus from the rename field below (a blur ends the rename) on a loaded machine
  await expect(row(page, /^a\.do/)).toBeFocused();
  await page.keyboard.press("F2");
  const field = page.getByRole("textbox", { name: "New name for a.do" });
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, /^a\.do/)).toBeFocused();
  await page.keyboard.press("Escape"); // an Esc nobody used folds the list
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

// New .do file and New folder draw the name field at once, with nothing written (docs/web-page-flows.md, section 1, rule 8);
// the file or folder is written when the field is left
const nameField = (page: Page, name: string) => page.getByRole("textbox", { name: `New name for ${name}` });
const storePaths = (page: Page) =>
  page.evaluate(async () =>
    (await (window as unknown as { __dofile: Hook }).__dofile.store.list()).map((f) => f.path).sort(),
  );
const newFile = (page: Page) => page.getByRole("button", { name: "New .do file" });
// opening a file takes a phone to the Editor view: the Files view again, for what is drawn there
const listHas = (page: Page, path: string) =>
  page.waitForFunction(
    (p) => (window as unknown as { __dofile: Hook }).__dofile.state.files.value.some((f) => f.path === p),
    path,
  );
const phoneTab = (page: Page) =>
  page.evaluate(() => (window as unknown as { __dofile: Hook }).__dofile.state.phoneTab.value);
const showFiles = async (page: Page) => {
  if (isPhone(page)) await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
};

test("New .do file: the name field is drawn with nothing written; Enter writes the typed name and opens it", async ({
  page,
}) => {
  await setUp(page, {});
  await newFile(page).click();
  const field = nameField(page, "untitled.do");
  await expect(field).toBeFocused();
  expect(await storePaths(page)).toEqual([]);
  await page.keyboard.type("clean");
  await page.keyboard.press("Enter");
  await expect.poll(() => openTabs(page)).toEqual(["clean.do"]);
  expect(await storePaths(page)).toEqual(["clean.do"]);
  await showFiles(page);
  await expect(row(page, /^clean\.do/)).toHaveAttribute("aria-selected", "true");
});

// An iPhone raises the keyboard only for a focus made while it handles the tap: the field is in the page, focused,
// before the microtask after the click ends (nothing is awaited between the tap and the field). No test here shows the keyboard.
test("New .do file and New folder: the name field has the focus within the tap's microtasks, from the link and from the menu", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  const inTheTap = (target: ReturnType<Page["locator"]>) =>
    target.evaluate(async (el) => {
      (el as HTMLElement).click();
      await null;
      const at = document.activeElement as HTMLInputElement | null;
      return at?.matches("input.rename-field") ? at.value : null;
    });
  expect(await inTheTap(newFile(page))).toBe("untitled.do");
  await page.keyboard.press("Escape");
  await expect(nameField(page, "untitled.do")).toBeHidden();
  let menu = await fileActions(page);
  expect(await inTheTap(menu.getByRole("menuitem", { name: "New .do file" }))).toBe("untitled.do");
  await page.keyboard.press("Escape");
  menu = await fileActions(page);
  expect(await inTheTap(menu.getByRole("menuitem", { name: "New folder" }))).toBe("folder");
  await page.keyboard.press("Escape");
  expect(await inTheTap(page.getByRole("button", { name: "New file", exact: true }))).toBe("untitled.do"); // the "+"
  expect(await storePaths(page)).toEqual(["a.do"]);
});

test("a new file: Esc writes nothing and the focus goes back to the tree; Enter on an empty or unchanged name writes untitled.do", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  await expect(nameField(page, "untitled.do")).toBeFocused();
  await page.keyboard.type("zzz");
  await page.keyboard.press("Escape");
  await expect(nameField(page, "untitled.do")).toBeHidden();
  await expect(row(page, /^a\.do/)).toBeFocused();
  expect(await storePaths(page)).toEqual(["a.do"]);
  await newFile(page).click();
  await page.keyboard.press("Enter"); // unchanged
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  await showFiles(page);
  await newFile(page).click();
  await expect(nameField(page, "untitled-2.do")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter"); // empty: the free default, not "Enter a name."
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled-2.do", "untitled.do"]);
});

test("a new file: leaving the field writes it (the typed name, else untitled.do) and opens nothing", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  await page.keyboard.type("b");
  await row(page, /^a\.do/).click();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "b.do"]);
  await listHas(page, "b.do");
  expect(await openTabs(page)).toEqual(["a.do"]); // the tap opened a.do; the new file is only written
  await showFiles(page);
  await newFile(page).click();
  await row(page, /^a\.do/).click();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "b.do", "untitled.do"]);
});

// Leaving the field writes the file and does not open it or move the focus or the view: what the visitor tapped stays
// (docs/web-page-flows.md, rule 8). The tests wait for the list to hold the new file, which is when the commit's tail ran.
test("a new file left by a tap on a row: the tapped file is the active one, and untitled.do is written, not opened", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  await row(page, /^a\.do/).click();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  await listHas(page, "untitled.do");
  expect(await page.evaluate(() => (window as unknown as { __dofile: Hook }).__dofile.state.activeTab.value)).toBe(
    "a.do",
  );
  expect(await openTabs(page)).toEqual(["a.do"]);
});

test("on a phone, a new file left by a tap on the Log view: the view stays Log", async ({ page }) => {
  test.skip(!isPhone(page), "the phone's views");
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Log" }).click();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  await listHas(page, "untitled.do");
  expect(await phoneTab(page)).toBe("log");
  expect(await openTabs(page)).toEqual([]);
});

test("on a phone, a new file left by a tap on Files ⋯: the Files view stays, with the menu open", async ({ page }) => {
  test.skip(!isPhone(page), "the phone's Files ⋯");
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  const menu = await fileActions(page);
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  await listHas(page, "untitled.do");
  expect(await phoneTab(page)).toBe("files");
  await expect(menu).toBeVisible();
  expect(await openTabs(page)).toEqual([]);
});

test("a new file named a file that exists: Enter keeps the field open with the reason and writes nothing over it; leaving makes untitled.do and says so", async ({
  page,
}) => {
  await setUp(page, { "a.do": "mine" });
  await newFile(page).click();
  const field = nameField(page, "untitled.do");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("a.do");
  await page.keyboard.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("a.do already exists here.").first()).toBeVisible();
  expect(await storePaths(page)).toEqual(["a.do"]);
  expect(await textOf(page, "a.do")).toBe("mine");
  await row(page, /^a\.do 4 B/).click(); // the file's row; the draft's has the field
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  expect(await textOf(page, "a.do")).toBe("mine");
  await expect(page.getByRole("status").filter({ hasText: "Made untitled.do instead." })).toHaveCount(1);
});

test("a file with the offered name written while the field is open: Enter makes untitled-2.do and leaves it alone", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  await newFile(page).click();
  await expect(nameField(page, "untitled.do")).toBeFocused();
  await page.evaluate(async () => {
    const { store } = (window as unknown as { __dofile: Hook }).__dofile; // as a run's output would
    await store.write("untitled.do", new TextEncoder().encode("a run wrote me"));
  });
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled-2.do", "untitled.do"]);
  expect(await textOf(page, "untitled.do")).toBe("a run wrote me");
});

test("a second New while the first one is being written: the second field stays, and the two files get two names", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  await page.evaluate(async () => {
    const link = [...document.querySelectorAll("button")].find((b) => b.textContent === "New .do file") as HTMLElement;
    link.click();
    await null;
    (document.activeElement as HTMLElement).blur(); // the first one is written from here, and takes its time
    link.click(); // the second offers untitled.do too: the list does not have the first yet
    await null;
  });
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled.do"]);
  await expect(nameField(page, "untitled.do")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "untitled-2.do", "untitled.do"]);
});

test("a new file the store cannot write: the live region says so and no field is left", async ({ page }) => {
  await setUp(page, { "a.do": "1\n" });
  await page.evaluate(() => {
    const { store } = (window as unknown as { __dofile: Hook }).__dofile;
    store.write = () => Promise.reject(new Error("the quota"));
  });
  await newFile(page).click();
  await page.keyboard.press("Enter");
  await expect(nameField(page, "untitled.do")).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Couldn't create the file" })).toHaveCount(1);
  expect(await storePaths(page)).toEqual(["a.do"]);
});

test("New folder: a draft too; Enter writes the typed name and opens no tab; Esc writes nothing; leaving writes `folder`", async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n" });
  const menuItem = async () => (await fileActions(page)).getByRole("menuitem", { name: "New folder" });
  await (await menuItem()).click();
  await expect(nameField(page, "folder")).toBeFocused();
  expect(await storePaths(page)).toEqual(["a.do"]);
  await page.keyboard.press("Escape");
  await expect(nameField(page, "folder")).toBeHidden();
  expect(await storePaths(page)).toEqual(["a.do"]);
  await (await menuItem()).click();
  await page.keyboard.type("data");
  await page.keyboard.press("Enter");
  await expect(row(page, /^data\//)).toBeVisible();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "data"]);
  expect(await openTabs(page)).toEqual([]);
  await (await menuItem()).click();
  await row(page, /^a\.do/).click();
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "data", "folder"]);
});

// A draft in a folder (docs/web-page-flows.md, section 1, rule 8): the folder's menu and the "+" unfold it and draw the
// field inside, at its depth; the name is joined to the folder.
const plus = (page: Page) => page.getByRole("button", { name: /^New file( in .+)?$/ });
const levelOf = (field: ReturnType<Page["locator"]>) =>
  field.evaluate((el) => el.closest("li")?.getAttribute("aria-level"));
const tree3 = { "a.do": "1\n", "data/c.do": "3\n", "data/deep/d.do": "4\n" };

test("a folder's menu: New file here and New folder unfold a folded folder, draw the field inside it, and write the name under it", async ({
  page,
}) => {
  await setUp(page, tree3);
  const data = row(page, /^data\//);
  const ask = async (item: string) => {
    await data.locator(".caret").click(); // folds it
    await expect(data).toHaveAttribute("aria-expanded", "false");
    await data.click({ button: "right" });
    await page.getByRole("menu", { name: "Actions for data/" }).getByRole("menuitem", { name: item }).click();
    await expect(data).toHaveAttribute("aria-expanded", "true");
    await expect(data).toHaveAttribute("aria-current", "true"); // the folder it was made in is the current one
  };
  await ask("New file here");
  const field = nameField(page, "untitled.do");
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("2");
  expect(await storePaths(page)).toEqual(["a.do", "data", "data/c.do", "data/deep", "data/deep/d.do"]);
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect.poll(() => openTabs(page)).toEqual(["data/x.do"]);
  expect(await storePaths(page)).toContain("data/x.do");
  await showFiles(page);
  await ask("New folder");
  const folder = nameField(page, "folder");
  await expect(folder).toBeFocused();
  expect(await levelOf(folder)).toBe("2");
  await page.keyboard.type("sub");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("data/sub");
  await expect(row(page, /^sub\//)).toBeVisible();
  expect(await openTabs(page)).toEqual(["data/x.do"]); // a folder opens nothing
});

test('the "+": the current folder (a tap on a folder\'s name, or on a file in it), else the top; its label names the folder', async ({
  page,
}) => {
  await setUp(page, tree3);
  const field = nameField(page, "untitled.do");
  // nothing tapped yet: the top
  await expect(plus(page)).toHaveAccessibleName("New file");
  await plus(page).click();
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("1");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("untitled.do");
  await showFiles(page);
  // a tap on a folder's name: that folder, unfolded
  const data = row(page, /^data\//);
  await data.locator(".caret").click(); // folds it; selects nothing
  await expect(data).toHaveAttribute("aria-expanded", "false");
  await expect(plus(page)).toHaveAccessibleName("New file");
  await data.click();
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(plus(page)).toHaveAccessibleName("New file in data/");
  await plus(page).click();
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("2");
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("data/x.do");
  await showFiles(page);
  // a tap on a file in a deeper folder: that folder
  await row(page, /^d\.do/).click();
  await showFiles(page);
  await expect(plus(page)).toHaveAccessibleName("New file in data/deep/");
  await plus(page).click();
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("3");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("data/deep/untitled.do");
});

// docs/web-page-flows.md, section 1: the folder row's caret folds and unfolds and selects nothing; a tap on the rest of the
// row selects and unfolds, never folds; folding the current folder, or one above it, makes the folded folder's parent current.
test("a folder's caret folds without selecting, a tap on its name selects and never folds; folding the current folder or one above it", async ({
  page,
}) => {
  await setUp(page, tree3);
  const data = row(page, /^data\//);
  const deep = row(page, /^deep\//);
  const current = tree(page).locator('[aria-current="true"]');
  await data.locator(".caret").click();
  await expect(data).toHaveAttribute("aria-expanded", "false");
  await expect(current).toHaveCount(0);
  await data.locator(".caret").click();
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(current).toHaveCount(0);
  await data.click();
  await data.click(); // a second tap on the name: still open
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(current).toHaveText(/^data\//);
  // the current folder is data/deep/; folding data/ (above it) makes the top current
  await deep.click();
  await expect(current).toHaveText(/^deep\//);
  await data.locator(".caret").click();
  await expect(current).toHaveCount(0);
  await expect(plus(page)).toHaveAccessibleName("New file");
  // folding the current folder itself: its parent
  await data.locator(".caret").click();
  await deep.click();
  await expect(plus(page)).toHaveAccessibleName("New file in data/deep/");
  await deep.locator(".caret").click();
  await expect(deep).toHaveAttribute("aria-expanded", "false");
  await expect(data).toHaveAttribute("aria-current", "true");
  await expect(plus(page)).toHaveAccessibleName("New file in data/");
  // Left on the current top-level folder folds it, and the top is current
  await data.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(data).toHaveAttribute("aria-expanded", "false");
  await expect(current).toHaveCount(0);
  await expect(plus(page)).toHaveAccessibleName("New file");
});

test("Enter and Space on a folder select and unfold it, and never fold it; a tap on the empty space makes the top current", async ({
  page,
}) => {
  await setUp(page, tree3);
  const data = row(page, /^data\//);
  await data.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(data).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(data).toHaveAttribute("aria-current", "true");
  await page.keyboard.press(" ");
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(plus(page)).toHaveAccessibleName("New file in data/");
  // the arrow keys move the focus only
  await page.keyboard.press("End");
  await expect(data).toHaveAttribute("aria-current", "true");
  // the empty space under the rows (the Files head is hidden on a phone, so this is its way back to the top)
  const body = page.locator(".files-body");
  const box = (await body.boundingBox())!;
  await body.click({ position: { x: 3, y: box.height - 3 } });
  await expect(tree(page).locator("[aria-current]")).toHaveCount(0);
  await expect(plus(page)).toHaveAccessibleName("New file");
});

test("a tap on a file makes its folder current; renaming the current folder keeps it current, deleting it makes the top", async ({
  page,
}) => {
  await setUp(page, tree3);
  const data = row(page, /^data\//);
  await row(page, /^c\.do/).click();
  await showFiles(page);
  await expect(data).toHaveAttribute("aria-current", "true");
  await expect(row(page, /^c\.do/)).not.toHaveAttribute("aria-current", "true"); // a file's mark is aria-selected (the open one)
  await row(page, /^a\.do/).click();
  await showFiles(page);
  await expect(tree(page).locator("[aria-current]")).toHaveCount(0);
  // rename: the current folder follows its new name
  await data.click();
  await data.focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("info");
  await page.keyboard.press("Enter");
  await expect(row(page, /^info\//)).toHaveAttribute("aria-current", "true");
  await expect(plus(page)).toHaveAccessibleName("New file in info/");
  // delete: the nearest folder that exists, here the top
  await row(page, /^info\//).click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for info/" }).getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog", { name: "Delete info/?" }).getByRole("button", { name: "Delete" }).click();
  await expect(row(page, /^info\//)).toHaveCount(0);
  await expect(plus(page)).toHaveAccessibleName("New file");
});

// the "+" label and the highlight agree: a deleted nested current folder is its nearest folder above it
test("deleting a nested current folder makes the folder above it current, in the highlight and in the label", async ({
  page,
}) => {
  await setUp(page, tree3);
  await row(page, /^deep\//).click();
  await expect(plus(page)).toHaveAccessibleName("New file in data/deep/");
  await row(page, /^deep\//).click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for data/deep/" }).getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(page, /^deep\//)).toHaveCount(0);
  await expect(plus(page)).toHaveAccessibleName("New file in data/");
  await expect(row(page, /^data\//)).toHaveAttribute("aria-current", "true");
});

test("the current folder in forced colors: the system's selected colors (Chromium's emulation)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Playwright's forced-colors emulation is Chromium's");
  await setUp(page, tree3);
  await page.emulateMedia({ forcedColors: "active" });
  await row(page, /^data\//).click();
  // Chromium's emulated palette has SelectedItemText and CanvasText both black, so the fill (SelectedItem, a light color, not
  // the page's Canvas) is what shows the pair is applied; the name takes the row's text color
  const style = (loc: ReturnType<typeof row>) =>
    loc.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      fg: getComputedStyle(el).color,
      name: getComputedStyle(el.querySelector(".name")!).color,
    }));
  const picked = await style(row(page, /^data\//));
  expect(picked.bg).not.toBe((await style(row(page, /^a\.do/))).bg);
  expect(picked.name).toBe(picked.fg);
});

// The row last focused may be a draft's path (the draft is not in the list), or a row that has gone: it counts as its folder.
test('the "+" twice from a folder\'s file row: both drafts are in the folder (the first is a row that is not written yet)', async ({
  page,
}) => {
  await setUp(page, tree3);
  await row(page, /^c\.do/).click();
  await showFiles(page);
  await plus(page).click();
  const field = page.locator("input.rename-field");
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("2");
  // the store's write waits for the test, so the first draft is still not in the list at the second click, on every profile
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__dofile.store;
    const write = s.write.bind(s);
    const held = new Promise<void>((ok) => (w.__release = ok));
    s.write = (...a: unknown[]) => held.then(() => write(...a));
  });
  await plus(page).click(); // the mousedown leaves the first field: it is written (when released)
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("2");
  await page.evaluate(() => (window as any).__release());
  await expect.poll(() => storePaths(page)).toContain("data/untitled.do"); // Enter while the first is written does nothing
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page).then((p) => p.filter((f) => f.includes("untitled")))).toHaveLength(2);
  expect((await storePaths(page)).filter((f) => f.includes("untitled")).every((f) => f.startsWith("data/"))).toBe(true);
});

test('the "+" after a typed name was written by leaving the field: the next draft is in the same folder', async ({
  page,
}) => {
  await setUp(page, tree3);
  await row(page, /^a\.do/).click(); // the open file
  await showFiles(page);
  await row(page, /^c\.do/).click();
  await showFiles(page);
  await plus(page).click();
  await page.keyboard.type("x");
  await nameField(page, "untitled.do").blur(); // on a phone: a tap on the Log tab
  await expect.poll(() => storePaths(page)).toContain("data/x.do");
  await expect(page.locator("input.rename-field")).toBeHidden(); // the draft is gone: one row matches x.do
  await expect(row(page, /^x\.do/)).toBeVisible();
  await showFiles(page);
  await plus(page).click();
  const field = nameField(page, "untitled.do");
  await expect(field).toBeFocused();
  expect(await levelOf(field)).toBe("2");
  await page.keyboard.press("Escape"); // the focus is back on c.do (not the open file's row), and the next "+" is in the folder
  await expect(row(page, /^c\.do/)).toBeFocused();
  await plus(page).click();
  expect(await levelOf(nameField(page, "untitled.do"))).toBe("2");
});

// Esc in a draft started from a folder gives the focus back to the row the visitor came from (the open file's row is only
// the row in the tab order when no row was focused).
test("a draft's Esc, from a folder's menu or the \"+\": the focus goes back to the row it came from, not the open file's", async ({
  page,
}) => {
  await setUp(page, tree3);
  await row(page, /^a\.do/).click(); // the open file
  await showFiles(page);
  const data = row(page, /^data\//);
  await data.click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for data/" }).getByRole("menuitem", { name: "New file here" }).click();
  await expect(nameField(page, "untitled.do")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(nameField(page, "untitled.do")).toBeHidden();
  await expect(data).toBeFocused();
  await row(page, /^c\.do/).click();
  await showFiles(page);
  await plus(page).click();
  await expect(nameField(page, "untitled.do")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row(page, /^c\.do/)).toBeFocused();
  await plus(page).click(); // the next "+" is in the folder again
  expect(await levelOf(nameField(page, "untitled.do"))).toBe("2");
});

test('the "+" and a name with "/": the missing folders are made, and a folder the name goes through is unfolded', async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n", "data/c.do": "3\n" });
  await plus(page).click();
  await page.keyboard.type("sub/x");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toEqual(["a.do", "data", "data/c.do", "sub", "sub/x.do"]);
  await expect.poll(() => openTabs(page)).toEqual(["sub/x.do"]);
  await showFiles(page);
  await expect(row(page, /^sub\//)).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, /^x\.do/)).toBeVisible();
  // a tap on the file: under its folder, nested folders at once
  await row(page, /^x\.do/).click();
  await showFiles(page);
  await plus(page).click();
  await page.keyboard.type("a/b/y");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("sub/a/b/y.do");
  expect(await storePaths(page)).toEqual(expect.arrayContaining(["sub/a", "sub/a/b"]));
  await showFiles(page);
  await expect(row(page, /^y\.do/)).toBeVisible();
  // a folder the name goes through that is folded
  const data = row(page, /^data\//);
  await data.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(data).toHaveAttribute("aria-expanded", "false");
  await row(page, /^a\.do/).click(); // the top is current again
  await showFiles(page);
  await plus(page).click();
  await page.keyboard.type("data/z");
  await page.keyboard.press("Enter");
  await expect.poll(() => storePaths(page)).toContain("data/z.do");
  await showFiles(page);
  await expect(data).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, /^z\.do/)).toBeVisible();
});

test('a draft\'s name is checked part by part (a file in the way, an empty part, a backslash); a rename still refuses "/"', async ({
  page,
}) => {
  await setUp(page, { "a.do": "1\n", "data/c.do": "3\n" });
  await row(page, /^a\.do/).focus();
  await plus(page).click();
  const field = nameField(page, "untitled.do");
  const tryName = async (name: string, why: string) => {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(tree(page).getByText(why)).toBeVisible();
  };
  await tryName("a.do/x.do", "a.do is a file, not a folder.");
  await tryName("x//y.do", "Enter a name.");
  await tryName("x\\y.do", "A name can't contain / or \\.");
  await tryName("data/c.do", "c.do already exists here.");
  expect(await storePaths(page)).toEqual(["a.do", "data", "data/c.do"]);
  await page.keyboard.press("Escape");
  await row(page, /^a\.do/).focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("sub/b.do");
  await page.keyboard.press("Enter");
  await expect(nameField(page, "a.do")).toHaveAttribute("aria-invalid", "true");
  await expect(tree(page).getByText("A name can't contain / or \\.")).toBeVisible();
  expect(await storePaths(page)).toEqual(["a.do", "data", "data/c.do"]);
});

test("upload with name clashes: Enter keeps mine; Do the same with Replace replaces the rest; Esc keeps every one left; the toast counts", async ({
  page,
}) => {
  await setUp(page, { "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  const input = page.locator('input[data-upload="files"]');
  const file = (name: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`new ${name}`) });
  await input.setInputFiles(["a.do", "b.do", "c.do", "new.do"].map(file));
  const first = page.getByRole("alertdialog", { name: "a.do is already here" });
  await expect(first).toBeVisible();
  await expect(first).toContainText("clash 1 of 3 · the other file is uploaded.");
  await expect(first.getByRole("button", { name: "Keep mine" })).toBeFocused();
  await page.keyboard.press("Enter");
  const second = page.getByRole("alertdialog", { name: "b.do is already here" });
  await expect(second).toContainText("clash 2 of 3");
  await second.getByRole("checkbox", { name: "Do the same for the other clash" }).check();
  await second.getByRole("button", { name: "Replace with uploaded" }).click();
  await expect(page.locator(".toast")).toHaveText("3 files uploaded");
  expect(await Promise.all(["a.do", "b.do", "c.do", "new.do"].map((p) => textOf(page, p)))).toEqual([
    "old a",
    "new b.do",
    "new c.do",
    "new new.do",
  ]);
  // other bytes from here on, so a.do and b.do are both clashes again
  const again = (name: string) => ({ ...file(name), buffer: Buffer.from(`newer ${name}`) });
  await input.setInputFiles(["a.do", "b.do", "z.do"].map(again));
  await expect(page.getByRole("alertdialog", { name: "a.do is already here" })).toContainText("clash 1 of 2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("1 file uploaded"); // z.do; Esc kept a.do and b.do
  expect(await Promise.all(["a.do", "b.do"].map((p) => textOf(page, p)))).toEqual(["old a", "new b.do"]);
  // another dialog put over the question (another tab took the engine, say) unmounts it: that answers as Esc does
  await input.setInputFiles(["a.do", "b.do", "y.do", "y2.do"].map(again));
  await expect(page.getByRole("alertdialog", { name: "a.do is already here" })).toContainText("clash 1 of 2");
  await page.evaluate(() => {
    (window as unknown as { __dofile: { state: { dialog: { value: unknown } } } }).__dofile.state.dialog.value = {
      d: "delete",
      paths: ["c.do"],
    };
  });
  await expect(page.locator(".toast")).toHaveText("2 files uploaded"); // y.do and y2.do; both clashes kept
  const other = page.getByRole("alertdialog", { name: "Delete c.do?" });
  await expect(other).toBeVisible(); // the upload's end leaves the other dialog open
  await page.keyboard.press("Escape");
  await expect(other).toBeHidden();
  expect(await Promise.all(["a.do", "b.do"].map((p) => textOf(page, p)))).toEqual(["old a", "new b.do"]);
});

test("an upload of a file whose bytes are already stored is not asked about, and counts in the toast; the clash left says 'clash 1 of 1'", async ({
  page,
}) => {
  await setUp(page, { "a.do": "same a", "b.do": "old b" });
  const file = (name: string, text: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.locator('input[data-upload="files"]').setInputFiles([file("a.do", "same a"), file("b.do", "new b")]);
  const dlg = page.getByRole("alertdialog", { name: "b.do is already here" });
  await expect(dlg).toContainText("clash 1 of 1 · the other file is uploaded.");
  await dlg.getByRole("button", { name: "Replace with uploaded" }).click();
  await expect(page.locator(".toast")).toHaveText("2 files uploaded");
  expect(await Promise.all(["a.do", "b.do"].map((p) => textOf(page, p)))).toEqual(["same a", "new b"]);
});

test("a clash dialog that follows another (Keep mine, then the next clash at once): the focus goes back to what had it before the first, not the page", async ({
  page,
}) => {
  await setUp(page, { "a.do": "old a", "b.do": "old b" });
  const opener = row(page, /^a\.do/);
  await opener.focus();
  await expect(opener).toBeFocused();
  const file = (name: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`new ${name}`) });
  await page.locator('input[data-upload="files"]').setInputFiles(["a.do", "b.do"].map(file));
  for (const name of ["a.do", "b.do"]) {
    const clash = page.getByRole("alertdialog", { name: `${name} is already here` });
    await expect(clash.getByRole("button", { name: "Keep mine" })).toBeFocused();
    await page.keyboard.press("Enter"); // the next clash opens before this one has given the focus back
  }
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await Promise.all(["a.do", "b.do"].map((p) => textOf(page, p)))).toEqual(["old a", "old b"]);
});

test("the clash over an open file with unsaved edits says so", async ({ page }) => {
  await setUp(page, { "a.do": "old a" });
  await row(page, /^a\.do/).click();
  await expect.poll(() => openTabs(page)).toEqual(["a.do"]); // the file is read before its tab opens
  await setDirty(page, "a.do");
  await page
    .locator('input[data-upload="files"]')
    .setInputFiles({ name: "a.do", mimeType: "text/plain", buffer: Buffer.from("new") });
  await expect(page.getByRole("alertdialog", { name: "a.do is already here" })).toContainText(
    "a.do is open with unsaved edits; replacing it discards them.",
  );
});

test("a file that isn't UTF-8 opens no tab: the Files pane's banner offers Download; Dismiss closes it", async ({
  page,
}) => {
  await setUp(page, { "survey.xlsx": [0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00] });
  await row(page, /^survey\.xlsx/).click();
  const banner = page.locator(".banner.warn", { hasText: "survey.xlsx can't be opened in the editor." });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("It isn't UTF-8 text, so the editor would change it.");
  expect(await openTabs(page)).toEqual([]);
  const download = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("survey.xlsx");
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toBeHidden();
});

test("Upload a folder keeps its folders (Chromium: Playwright gives a folder to a webkitdirectory input there only)", async ({
  page,
  browserName,
}, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "chromium", "a folder upload: Chromium only");
  const dir = info.outputPath("pkg");
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "main.do"), "use data/w.dta\n");
  writeFileSync(join(dir, "data", "w.csv"), "a\n1\n");
  await setUp(page, {});
  await page.locator('input[data-upload="folder"]').setInputFiles(dir);
  await expect(page.locator(".toast")).toHaveText("2 files uploaded");
  await expect(row(page, /^pkg\//)).toBeVisible();
  await expect(row(page, /^w\.csv/)).toHaveAttribute("aria-level", "3");
});

test("a drop anywhere on the page: the Files pane is marked while a drag is over the page, and the files are uploaded", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await setUp(page, {});
  const pane = page.locator(".files-pane");
  // a synthetic drag, made in the page (locator.dispatchEvent with a DataTransfer handle hangs in WebKit)
  const fire = (type: string) =>
    page.evaluate((type) => {
      const w = window as unknown as { __dt?: DataTransfer };
      if (!w.__dt) {
        w.__dt = new DataTransfer();
        w.__dt.items.add(new File(["display 1\n"], "dropped.do", { type: "text/plain" }));
      }
      const target = document.querySelector(".editor-pane")!; // not the Files pane: a drop anywhere uploads
      target.dispatchEvent(new DragEvent(type, { dataTransfer: w.__dt, bubbles: true, cancelable: true }));
    }, type);
  await fire("dragenter");
  await expect(pane).toHaveAttribute("data-drop", "");
  await fire("drop");
  await expect(pane).not.toHaveAttribute("data-drop");
  await expect(row(page, /^dropped\.do/)).toBeVisible();
  await expect(page.locator(".toast")).toHaveText("1 file uploaded");
  // the page's listener takes the drop in the capture phase: an element under it never sees it
  const seen = await page.evaluate(() => {
    let reached = false;
    document.querySelector(".editor-pane")!.addEventListener("drop", () => {
      reached = true;
    });
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.do", { type: "text/plain" }));
    document
      .querySelector(".editor-pane")!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    return reached;
  });
  expect(seen).toBe(false);
  // while a dialog is open a drop uploads nothing
  await page.evaluate(() => {
    (window as unknown as { __dofile: { state: { dialog: { value: unknown } } } }).__dofile.state.dialog.value = {
      d: "delete",
      paths: ["dropped.do"],
    };
    const w = window as unknown as { __dt?: DataTransfer };
    w.__dt = new DataTransfer();
    w.__dt.items.add(new File(["display 2\n"], "later.do", { type: "text/plain" }));
  });
  await fire("drop");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(page, /^x\.do/)).toBeVisible(); // the capture-phase drop above was uploaded
  await expect(row(page, /^later\.do/)).toHaveCount(0);
});

test("a drag that began in the page (a graph image, which Chromium and WebKit list as Files) uploads nothing; after its end a drop of files does", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await setUp(page, {});
  const pane = page.locator(".files-pane");
  // synthetic events, made in the page: `type` on the editor pane, with a DataTransfer that holds a file
  const fire = (type: string, name = "in-page.do") =>
    page.evaluate(
      ([type, name]) => {
        const dt = new DataTransfer();
        dt.items.add(new File(["display 1\n"], name, { type: "text/plain" }));
        const target = document.querySelector(
          type === "dragstart" || type === "dragend" ? ".files-pane" : ".editor-pane",
        )!;
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      [type, name],
    );
  await fire("dragstart"); // a drag starts in the page
  await fire("dragenter");
  await expect(pane).not.toHaveAttribute("data-drop");
  await fire("drop");
  await fire("dragend");
  await fire("dragenter", "outside.do"); // a drag from outside the page
  await expect(pane).toHaveAttribute("data-drop", "");
  await fire("drop", "outside.do");
  await expect(row(page, /^outside\.do/)).toBeVisible();
  await fire("dragstart");
  await page.mouse.move(10, 10); // its dragend never came (the dragged element was removed): the mouse moving ends it
  await page.mouse.move(20, 20);
  await fire("drop", "later.do");
  await expect(row(page, /^later\.do/)).toBeVisible();
  await expect(row(page, /^in-page\.do/)).toHaveCount(0);
});

test("the phone's strip is one height with or without the ⋯ button, and the button's tap target is 44 px", async ({
  page,
}) => {
  test.skip(!isPhone(page), "the phone's strip");
  await setUp(page, { "a.do": "1\n" }); // the Files view
  const views = page.getByRole("tablist", { name: "Views" });
  const strip = page.locator(".phone-strip");
  const height = async () => (await strip.boundingBox())!.height;
  const withMore = await height();
  // the 44 px is a hit area, not only a box: the button sticks out of the strip, so a tap 2 px inside its top and bottom
  // edges must land on it and not on the bar above or the view below
  const tapTarget = async (name: string) => {
    const b = page.getByRole("button", { name });
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    for (const y of [box.y + 2, box.y + box.height - 2])
      expect(
        await b.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [box.x + box.width / 2, y]),
      ).toBe(true);
  };
  await tapTarget("New file");
  await tapTarget("File actions");
  await views.getByRole("tab", { name: "Log" }).click();
  await tapTarget("Log actions");
  expect(await height()).toBe(withMore);
  for (const name of ["Editor", "Data", "Results"]) {
    await views.getByRole("tab", { name }).click();
    await expect(strip.locator(".strip-actions")).toHaveCount(0);
    expect(await height(), name).toBe(withMore);
  }
});

test("the phone's file dropdown: Save (on for a text file) at the top, Close and Show all files below, and the tab list scrolls between them", async ({
  page,
}) => {
  test.skip(!isPhone(page), "the phone's file dropdown");
  const names = Array.from({ length: 14 }, (_, i) => `file${String(i + 1).padStart(2, "0")}.do`);
  await setUp(page, Object.fromEntries(names.map((n) => [n, "1\n"])));
  for (const n of names) {
    await row(page, new RegExp(`^${n}`)).click();
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  }
  await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Editor" }).click();
  await page.getByRole("button", { name: /\. Open files/ }).click();
  const menu = page.getByRole("menu", { name: "Open files" });
  const save = menu.getByRole("menuitem", { name: "Save", exact: true });
  const close = menu.getByRole("menuitem", { name: "Close file14.do" });
  const first = menu.getByRole("menuitem", { name: /^file01\.do/ });
  await expect(save).toBeVisible();
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByRole("menuitem", { name: /^file14\.do/ })).toBeInViewport({ ratio: 1 }); // the open file, in view
  await expect(first).not.toBeInViewport(); // ... so the top of the list is the part that is scrolled away
  const box = async (l: typeof save) => (await l.boundingBox())!;
  const view = page.viewportSize()!;
  // the list scrolls: it is cut at 60-70% of the window, and Save and Close stay inside the window
  const list = await box(menu.locator(".menu-scroll"));
  expect(list.height).toBeLessThanOrEqual(view.height * 0.7);
  expect(list.height).toBeGreaterThan(view.height * 0.5);
  expect(await menu.locator(".menu-scroll").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  expect((await box(save)).y + (await box(save)).height).toBeLessThanOrEqual(list.y); // above the tabs
  expect((await box(close)).y).toBeGreaterThanOrEqual(list.y + list.height); // below them, not between
  expect((await box(close)).y + (await box(close)).height).toBeLessThanOrEqual(view.height);
  // roving focus walks every item, the pinned ones too: Home is Save, End is the last item, a Down from Save is the first tab
  await expect(save).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Show all files" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(close).toBeFocused();
  // Save is in the dropdown, not in the global ⋯
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Save", exact: true })).toHaveCount(0);
});

test("the phone's file dropdown on a landscape phone: Save, the tab list, Close and Show all files all fit in the window", async ({
  page,
}) => {
  test.skip(!isPhone(page), "the phone's file dropdown");
  await page.setViewportSize({ width: 667, height: 375 });
  const names = Array.from({ length: 14 }, (_, i) => `file${String(i + 1).padStart(2, "0")}.do`);
  await setUp(page, Object.fromEntries(names.map((n) => [n, "1\n"])));
  await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  for (const n of names) {
    await row(page, new RegExp(`^${n}`)).click();
    await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Files" }).click();
  }
  await page.getByRole("tablist", { name: "Views" }).getByRole("tab", { name: "Editor" }).click();
  await page.getByRole("button", { name: /\. Open files/ }).click();
  const menu = page.getByRole("menu", { name: "Open files" });
  await expect(menu).toBeVisible();
  const view = page.viewportSize()!;
  for (const item of [
    menu.getByRole("menuitem", { name: "Save", exact: true }),
    menu.getByRole("menuitem", { name: "Close file14.do" }),
    menu.getByRole("menuitem", { name: "Show all files" }),
  ]) {
    const b = (await item.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(view.height);
  }
  const list = (await menu.locator(".menu-scroll").boundingBox())!;
  expect(list.height).toBeGreaterThan(60); // and the list keeps a usable height
  expect(list.y + list.height).toBeLessThanOrEqual(view.height);
});

test("desktop is unchanged: the open files are tabs, the ⋯ menu has no Save and no scroll box", async ({ page }) => {
  test.skip(isPhone(page), "the desktop layout");
  await setUp(page, { "a.do": "1\n" });
  await row(page, /^a\.do/).click();
  await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: "a.do" })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Download all (.zip)",
    "Reset the engine…",
    "Commands",
    /^About dofile/,
  ]);
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText("Wrap lines");
  await expect(menu.locator(".menu-scroll")).toHaveCount(0);
});
