// Phase 2 step 4: the proof-of-concept page in a real browser. What Node can't check: cross-origin isolation, Break
// through the real interrupt buffer, files kept in IndexedDB across a reload and a new engine, load times.

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The proof-of-concept page is gone (prototype 1, step 3): these four tests need its editor and file list (#run,
// #status, #files, window.__editor, confirm()) and are rewritten against the new page's flows in step 6
// (docs/prototype1-plan.md). Until then they are marked fixme. The cases that need no editor moved: Break, reload and
// reset, the package formats and the cached snapshot start to e2e/engine.spec.ts; the stale snapshot and the
// ?snapshot=0 start to e2e/shell.spec.ts. The half of the old first test that needs the editor is the fourth test here.
test.fixme(true, "bound to the proof-of-concept page; step 6 rewrites it against the new page");

// The page starts from the memory snapshot by default (`npm run snapshot`, then the build copies public/snapshot/); ?snapshot=0
// is the normal boot. Both helpers check the status line's breakdown, so a page that silently started the other way fails.
const SNAPSHOT_BOOT =
  /\[(download|read from cache) [\d.]+ s, unpack [\d.]+ s \(heap [\d.]+ s, site-packages [\d.]+ s, decoder (native|wasm)\), restore [\d.]+ s, files [\d.]+ s, engine [\d.]+ s/;
const NORMAL_BOOT = /\[runtime [\d.]+ s, files [\d.]+ s, packages [\d.]+ s, engine [\d.]+ s\]/;

async function ready(page: Page, { normal = false } = {}): Promise<number> {
  await expect(page.locator("#status")).toHaveText(normal ? /ready in [\d.]+ s \[/ : /ready in [\d.]+ s \(snapshot\)/, {
    timeout: 300_000,
  });
  await expect(page.locator("#status")).toContainText(normal ? NORMAL_BOOT : SNAPSHOT_BOOT);
  return Number((await page.locator("#status").textContent())!.match(/ready in ([\d.]+) s/)![1]);
}

// Replace the editor's whole text with one CodeMirror transaction (main.ts exposes the view as window.__editor). Ctrl+A then
// insertText left the last line behind in WebKit on Linux (the iPhone profile): `display "EDITED"scatter y x`. No key
// events either, so no auto-closed brackets; the change listener still runs, so the file counts as edited.
async function setEditor(page: Page, text: string) {
  await page.evaluate((t) => {
    const v = (window as unknown as { __editor: import("@codemirror/view").EditorView }).__editor;
    v.focus();
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  }, text);
}

async function run(page: Page, code: string, rc = 0) {
  await setEditor(page, code);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(new RegExp(`^rc ${rc} in`), { timeout: 120_000 });
}

test("the editor never rewrites a file it didn't change", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "log") console.log(`[${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.type() === "prompt" ? d.accept("main.do") : d.accept();
  });
  await page.goto("/");
  await ready(page);
  const row = (name: string) => page.locator("#files li", { hasText: name });
  const download = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), row(name).getByTitle("Download").click()]);
    return readFileSync((await dl.path())!);
  };
  const latin1 = Buffer.from("x\ncaf\xe9\n", "latin1");
  const crlf = Buffer.from("display 1\r\ndisplay 2\r\n");
  await page.locator("#upload").setInputFiles([
    { name: "latin1.csv", mimeType: "text/csv", buffer: latin1 },
    { name: "crlf.do", mimeType: "text/plain", buffer: crlf },
  ]);
  await expect(row("crlf.do")).toBeVisible();

  // not UTF-8: refused, the editor keeps main.do
  await row("latin1.csv").locator(".name").click();
  await expect.poll(() => dialogs.at(-1)).toContain("is not UTF-8");
  await expect(page.locator(".cm-content")).toContainText("dofile: Stata-syntax code");

  // opened and run without an edit: the bytes stay as uploaded (CRLF kept)
  await row("crlf.do").locator(".name").click();
  await expect(page.locator(".cm-content")).toContainText("display 2");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/);
  expect(await download("crlf.do")).toEqual(crlf);
  expect(await download("latin1.csv")).toEqual(latin1);

  // an upload of the open file wins over the editor's copy
  const newer = Buffer.from("display 3\r\n");
  await page.locator("#upload").setInputFiles({ name: "crlf.do", mimeType: "text/plain", buffer: newer });
  await expect(page.locator(".cm-content")).toContainText("display 3");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/);
  expect(await download("crlf.do")).toEqual(newer);

  // "New" with an existing name is refused and doesn't empty it
  await page.locator("#new").click();
  await expect.poll(() => dialogs.at(-1)).toContain("already exists");
  expect((await download("main.do")).length).toBeGreaterThan(50);
});

test("Save is explicit: Run doesn't save, a switch or closing the page warns about unsaved edits", async ({ page }) => {
  const dialogs: { type: string; message: string }[] = [];
  let answer = "dismiss";
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    answer === "accept" ? d.accept() : d.dismiss();
  });
  await page.goto("/");
  await ready(page);
  const row = (name: string) => page.locator("#files li", { hasText: name });
  const download = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), row(name).getByTitle("Download").click()]);
    return readFileSync((await dl.path())!, "utf8");
  };
  await page
    .locator("#upload")
    .setInputFiles({ name: "other.do", mimeType: "text/plain", buffer: Buffer.from("display 2\n") });
  await expect(row("other.do")).toBeVisible();

  // an edit: marked, Save enabled, and Run uses it without writing it
  await expect(page.locator("#save")).toBeDisabled();
  await setEditor(page, 'display "EDITED"');
  await expect(page.locator("#save")).toBeEnabled();
  await expect(page.locator("#files .open")).toHaveClass(/dirty/);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/, { timeout: 120_000 });
  await expect(page.locator("#log")).toContainText("EDITED");
  expect(await download("main.do")).toContain("dofile: Stata-syntax code"); // the file is as it was

  // another file: asked; Cancel stays on the edit
  await row("other.do").locator(".name").click();
  await expect.poll(() => dialogs.at(-1)?.message).toContain("unsaved changes");
  await expect(page.locator(".cm-content")).toContainText("EDITED");

  // closing the page: the browser's own beforeunload prompt
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true }); // doesn't wait for the page: the dialog arrives afterwards
  await expect.poll(() => dialogs.map((d) => d.type)).toEqual(["beforeunload"]);
});

test("Save writes the file; Discard opens the other file", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await ready(page);
  const row = (name: string) => page.locator("#files li", { hasText: name });
  await page
    .locator("#upload")
    .setInputFiles({ name: "other.do", mimeType: "text/plain", buffer: Buffer.from("display 2\n") });
  await expect(row("other.do")).toBeVisible();
  await setEditor(page, 'display "KEPT"');
  await page.keyboard.press("ControlOrMeta+s"); // not the browser's "save page"
  await expect(page.locator("#status")).toHaveText("saved main.do");
  await expect(page.locator("#files .open")).not.toHaveClass(/dirty/);
  await row("other.do").locator(".name").click(); // nothing unsaved: no prompt needed
  await expect(page.locator(".cm-content")).toContainText("display 2");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\ndisplay 3"); // an edit to discard
  await row("main.do").locator(".name").click(); // the dialog is accepted: Discard
  await expect(page.locator(".cm-content")).toContainText('display "KEPT"');
});

// The editor half of the proof of concept's first test ("the page runs .do code on uploaded files, breaks, and keeps
// files"), kept for step 6: Run does not save, Save does, and a reload brings the saved text back into the editor.
test("Run doesn't save; Save writes the file, and a reload brings the editor's text back", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await run(page, 'display "N=" _N');
  // Run doesn't save: the edit is still unsaved. Save, then reload: the editor's text comes back from IndexedDB
  await expect(page.locator("#save")).toBeEnabled();
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("saved main.do");
  await expect(page.locator("#save")).toBeDisabled();
  await page.reload();
  await ready(page);
  await expect(page.locator(".cm-content")).toContainText('display "N=" _N');
});
