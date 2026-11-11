// Prototype 1, step 4a: the file tree, the editor's tabs, upload and its name clashes, the row menus, opening files
// (docs/design/SPEC.md, sections 3.1, 3.2, 3.10, 3.11). No engine is needed (?test=manual): files go in through the test
// hook's store or the upload inputs. There is no editor until step 4b, so no tab can become dirty by typing: the tests
// make the edits with the hook's state.setDirty(path, true), and the close-tab dialog's Save leaves the tab open (the
// stand-in editor's save resolves false).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  state: {
    setDirty(path: string, on: boolean): void;
    tabs: { value: { path: string; dirty: boolean }[] };
    activeTab: { value: string | null };
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
  await page.goto("/?test=manual");
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

test("tabs: a second file opens a second tab; a tab with no edits closes at once, one with unsaved edits asks (Cancel, Don't save; Save keeps it with no editor)", async ({
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
  await again();
  await ask.getByRole("button", { name: "Save", exact: true }).click(); // no editor (step 4b): save resolves false, the tab stays
  await expect(ask).toBeHidden();
  expect(await openTabs(page)).toEqual(["a.do", "b.do"]);
  await again();
  await ask.getByRole("button", { name: "Don't save" }).click();
  await expect.poll(() => openTabs(page)).toEqual(["b.do"]);
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
  await expect(page.getByText("b.do already exists here.")).toBeVisible();
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

test("the row menu (Shift+F10, right click, the ⋯): Delete asks, Cancel is the default; a folder's menu; Delete all files asks with the count", async ({
  page,
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
  await expect(ask).toContainText("It's kept only in this browser; there is no undo.");
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
    "RenameF2",
    "Download (.zip)",
    "Delete…",
  ]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "File actions" }).click();
  const head = page.getByRole("menu", { name: "File actions" });
  await expect(head.getByRole("menuitem")).toHaveText([
    "New .do file",
    "New folder",
    "Upload a folder",
    "Download all (.zip)",
    "Delete all files…",
  ]);
  await head.getByRole("menuitem", { name: "Delete all files…" }).click();
  const all = page.getByRole("alertdialog", { name: "Delete all 2 files?" });
  await expect(all).toContainText("This removes every file dofile keeps in this browser. It can't be undone.");
  await expect(all.getByRole("button", { name: "Cancel" })).toBeFocused();
  await all.getByRole("button", { name: "Delete all" }).click();
  await expect(tree(page)).toHaveCount(0);
  await page.getByRole("button", { name: "File actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete all files…" })).toHaveAttribute("aria-disabled", "true");
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
  await row(page, /^a\.do/).focus();
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

test("New .do file: untitled.do in inline rename, then it opens", async ({ page }) => {
  await setUp(page, {});
  await page.getByRole("button", { name: "New .do file" }).click();
  const field = page.getByRole("textbox", { name: "New name for untitled.do" });
  await expect(field).toBeFocused();
  await page.keyboard.type("clean");
  await page.keyboard.press("Enter");
  await expect.poll(() => openTabs(page)).toEqual(["clean.do"]);
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
  await input.setInputFiles(["a.do", "b.do", "z.do"].map(file));
  await expect(page.getByRole("alertdialog", { name: "a.do is already here" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("1 file uploaded");
  expect(await textOf(page, "a.do")).toBe("old a");
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

test("a drop on the Files pane: the pane is the drop target while a drag is over it, and the files are uploaded", async ({
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
      const target = document.querySelector(".files-pane .dropzone")!;
      target.dispatchEvent(new DragEvent(type, { dataTransfer: w.__dt, bubbles: true, cancelable: true }));
    }, type);
  await fire("dragenter");
  await expect(pane).toHaveAttribute("data-drop", "");
  await fire("drop");
  await expect(pane).not.toHaveAttribute("data-drop");
  await expect(row(page, /^dropped\.do/)).toBeVisible();
  await expect(page.locator(".toast")).toHaveText("1 file uploaded");
});
