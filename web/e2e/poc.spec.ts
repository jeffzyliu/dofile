// Phase 2 step 4: the proof-of-concept page in a real browser. What Node can't check: cross-origin isolation, Break
// through the real interrupt buffer, files kept in IndexedDB across a reload and a new engine, load times.
import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = new URL("../../tests/conformance/data/", import.meta.url);
const ref = JSON.parse(readFileSync(new URL("ref.json", data), "utf8"));

// The page starts from the memory snapshot by default (`npm run snapshot`, then the build copies public/snapshot/); ?snapshot=0
// is the normal boot. Both helpers check the status line's breakdown, so a page that silently started the other way fails.
const SNAPSHOT_BOOT = /\[(download|read from cache) [\d.]+ s, unpack [\d.]+ s \(heap [\d.]+ s, site-packages [\d.]+ s, decoder (native|wasm)\), restore [\d.]+ s, files [\d.]+ s, engine [\d.]+ s/;
const NORMAL_BOOT = /\[runtime [\d.]+ s, files [\d.]+ s, packages [\d.]+ s, engine [\d.]+ s\]/;

async function ready(page: Page, { normal = false } = {}): Promise<number> {
  await expect(page.locator("#status")).toHaveText(normal ? /ready in [\d.]+ s \[/ : /ready in [\d.]+ s \(snapshot\)/, { timeout: 300_000 });
  await expect(page.locator("#status")).toContainText(normal ? NORMAL_BOOT : SNAPSHOT_BOOT);
  return Number((await page.locator("#status").textContent())!.match(/ready in ([\d.]+) s/)![1]);
}

// Replace the editor's whole text with one CodeMirror transaction (main.ts exposes the view as window.__editor). Ctrl+A then
// insertText left the last line behind in WebKit on Linux (the iPhone profile): `display "EDITED"scatter y x`. No key
// events either, so no auto-closed brackets; the change listener still runs, so the file counts as edited.
async function setEditor(page: Page, text: string) {
  await page.evaluate(t => {
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

test("the page runs .do code on uploaded files, breaks, and keeps files", async ({ page, browserName }) => {
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/");
  const cold = await ready(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.locator("#upload").setInputFiles(new URL("cps.dta", data).pathname);
  await expect(page.locator("#files")).toContainText("cps.dta");

  await run(page, String.raw`use C:\Users\me\proj\cps, clear
generate double lwage = ln(wage_hr)
generate double exper = age - yrsed - 6
generate double exper2 = exper^2
regress lwage yrsed exper exper2
display "B=" %20.12g _b[yrsed]
scatter lwage yrsed`);
  const log = (await page.locator("#log").textContent())!;
  expect(log).toContain(String.raw`(path C:\Users\me\proj\cps.dta is cps.dta in the working folder)`);
  const b = Number(log.match(/^B=\s*(\S+)/m)![1]);
  expect(Math.abs(b - ref.ols_b_yrsed)).toBeLessThan(1e-6 * Math.abs(ref.ols_b_yrsed));
  await expect(page.locator("#graphs img")).toHaveCount(1);

  // Break: the interrupt buffer stops the loop at a safe point; the data stays
  await setEditor(page, "while 1 {\n quietly replace exper = exper + 1\n}");
  await page.locator("#run").click();
  await expect(page.locator("#break")).toBeEnabled();
  await page.waitForTimeout(1500);
  await page.locator("#break").click();
  await expect(page.locator("#status")).toHaveText(/^rc 1 in/, { timeout: 10_000 });
  await run(page, 'display "N=" _N');
  await expect(page.locator("#log")).toContainText("N=15528");

  // Run doesn't save: the edit is still unsaved. Save, then reload: files and the editor's text come back from IndexedDB
  await expect(page.locator("#save")).toBeEnabled();
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("saved main.do");
  await expect(page.locator("#save")).toBeDisabled();
  await page.reload();
  const warm = await ready(page);
  await expect(page.locator("#files")).toContainText("cps.dta");
  await expect(page.locator(".cm-content")).toContainText('display "N=" _N');

  // a new engine: data gone, files kept
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toHaveText(/new engine/, { timeout: 300_000 });
  await run(page, 'display "N=" _N\nuse cps, clear\ndisplay "M=" _N');
  await expect(page.locator("#log")).toContainText("N=0");
  await expect(page.locator("#log")).toContainText("M=15528");

  console.log(`${browserName}: ready in ${cold} s cold, ${warm} s after a reload`);
});

test("the editor never rewrites a file it didn't change", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("console", m => { if (m.type() !== "log") console.log(`[${m.type()}] ${m.text().slice(0, 400)}`); });
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  page.on("dialog", d => { dialogs.push(d.message()); d.type() === "prompt" ? d.accept("main.do") : d.accept(); });
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
  page.on("dialog", d => { dialogs.push({ type: d.type(), message: d.message() }); answer === "accept" ? d.accept() : d.dismiss(); });
  await page.goto("/");
  await ready(page);
  const row = (name: string) => page.locator("#files li", { hasText: name });
  const download = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), row(name).getByTitle("Download").click()]);
    return readFileSync((await dl.path())!, "utf8");
  };
  await page.locator("#upload").setInputFiles({ name: "other.do", mimeType: "text/plain", buffer: Buffer.from("display 2\n") });
  await expect(row("other.do")).toBeVisible();

  // an edit: marked, Save enabled, and Run uses it without writing it
  await expect(page.locator("#save")).toBeDisabled();
  await setEditor(page, 'display "EDITED"');
  await expect(page.locator("#save")).toBeEnabled();
  await expect(page.locator("#files .open")).toHaveClass(/dirty/);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/, { timeout: 120_000 });
  await expect(page.locator("#log")).toContainText("EDITED");
  expect(await download("main.do")).toContain("dofile: Stata-syntax code");   // the file is as it was

  // another file: asked; Cancel stays on the edit
  await row("other.do").locator(".name").click();
  await expect.poll(() => dialogs.at(-1)?.message).toContain("unsaved changes");
  await expect(page.locator(".cm-content")).toContainText("EDITED");

  // closing the page: the browser's own beforeunload prompt
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true });   // doesn't wait for the page: the dialog arrives afterwards
  await expect.poll(() => dialogs.map(d => d.type)).toEqual(["beforeunload"]);
});

test("Save writes the file; Discard opens the other file", async ({ page }) => {
  page.on("dialog", d => d.accept());
  await page.goto("/");
  await ready(page);
  const row = (name: string) => page.locator("#files li", { hasText: name });
  await page.locator("#upload").setInputFiles({ name: "other.do", mimeType: "text/plain", buffer: Buffer.from("display 2\n") });
  await expect(row("other.do")).toBeVisible();
  await setEditor(page, 'display "KEPT"');
  await page.keyboard.press("ControlOrMeta+s");   // not the browser's "save page"
  await expect(page.locator("#status")).toHaveText("saved main.do");
  await expect(page.locator("#files .open")).not.toHaveClass(/dirty/);
  await row("other.do").locator(".name").click();   // nothing unsaved: no prompt needed
  await expect(page.locator(".cm-content")).toContainText("display 2");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\ndisplay 3");   // an edit to discard
  await row("main.do").locator(".name").click();   // the dialog is accepted: Discard
  await expect(page.locator(".cm-content")).toContainText('display "KEPT"');
});

// The two package gaps of 2026-11-09, in every browser: xlwt/xlrd (legacy .xls, from PyPI by micropip) and pyreadstat (built for
// Pyodide, web/wheels/), which reads SAS transport and SPSS files here without pandas. The two fixtures were written by
// `pyreadstat.write_xport` / `write_sav` from x = 1.5, 3, 4.5, 6 and s = a1..a4. `export sasxport` needs pandas, which the page
// leaves out (docs/pyodide-snapshot.md): it must say so with rc 199 (ODT-32), not crash.
test("legacy .xls and the ReadStat formats work: xlwt, xlrd and pyreadstat are installed", async ({ page }) => {
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/");
  await ready(page);
  await page.locator("#upload").setInputFiles([new URL("small.xpt", data).pathname, new URL("small.sav", data).pathname]);
  await expect(page.locator("#files")).toContainText("small.sav");
  await run(page, `clear
set obs 4
generate x = _n * 1.5
export excel using t.xls, firstrow(variables) replace
clear
import excel using t.xls, firstrow clear
display "XLS=" _N " " x[4]
clear
import sasxport small
display "XPT=" _N " " x[4] " " s[2]
import spss using small.sav, clear
display "SAV=" _N " " x[4] " " s[2]`);
  const log = (await page.locator("#log").textContent())!;
  expect(log).toContain("XLS=4 6");
  expect(log).toContain("XPT=4 6 a2");
  expect(log).toContain("SAV=4 6 a2");
  await run(page, "export sasxport out, replace", 199);
  expect(await page.locator("#log").textContent()).toContain("it needs the pandas package");
});

// The page starts from the Pyodide memory snapshot `npm run snapshot` builds (public/snapshot/, copied by the build). No
// skip when there is none: a missing snapshot fails every test here, as it does for a visitor. A second visit reads it from
// the Cache API instead of downloading it again.
test("the default start: from the memory snapshot, runs native code and a graph, and caches it", async ({ playwright, browserName }, testInfo) => {
  // A persistent profile on disk, as a real browser has. Playwright's default context keeps storage in memory, and WebKit
  // drops the whole Cache API when such a page is reloaded (a 1 KB entry too; entries survive a reload in a persistent
  // profile), so "read from cache" below could never hold there.
  const dir = mkdtempSync(join(tmpdir(), "dofile-e2e-"));
  const u = testInfo.project.use;
  const context = await playwright[browserName].launchPersistentContext(dir, {
    baseURL: u.baseURL, userAgent: u.userAgent, viewport: u.viewport, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch });
  try {
  const page = await context.newPage();
  const notes: string[] = [];
  page.on("console", m => { if (m.text().includes("[dofile] snapshot start")) notes.push(m.text()); });
  page.on("pageerror", e => console.log(`page error: ${e.message}`));

  await page.goto("/");
  await ready(page);
  await page.locator("#run").click();   // the sample program: regress, robust, and a scatter plot
  await expect(page.locator("#status")).toHaveText(/^rc 0 in [\d.]+ s \(engine [\d.]+, encode [\d.]+, json [\d.]+, save [\d.]+, other -?[\d.]+\)$/, { timeout: 120_000 });   // the run's breakdown (a snapshot built from an older wheel has none: rebuild it)
  await expect(page.locator("#graphs img")).toHaveCount(1);
  expect(notes.at(-1)).toContain("download");

  await page.reload();
  await ready(page);
  await expect.poll(() => notes.length).toBe(2);
  expect(notes.at(-1)).toContain("read from cache");
  expect(notes.at(-1)).toContain("decompress");
  expect(notes.join("\n")).not.toContain("NOT CACHED");   // the browser took the files; a refusal would be said here

  // what the browser keeps is the compressed files (about 46 MB), not the 229 MB they decompress to
  const stored = await page.evaluate(async () => {
    let bytes = 0;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) bytes += (await (await cache.match(req))!.blob()).size;
    }
    return bytes;
  });
  expect(stored).toBeGreaterThan(10e6);
  expect(stored).toBeLessThan(80e6);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// A snapshot built from other code than the page's wheel is refused with a message, not run: the wheel's file name stays the
// same while its code changes, so the manifest carries a hash of the wheel.
test("a snapshot from a different build of the wheel is refused, and the message names ?snapshot=0", async ({ page, request }) => {
  const res = await request.get("/snapshot/manifest.json");
  expect(res.ok(), "no snapshot: run npm run snapshot, then npm run build").toBe(true);
  const manifest = await res.json();
  await page.route("**/snapshot/manifest.json", route => route.fulfill({ json: { ...manifest, wheelHash: "0".repeat(64) } }));
  await page.goto("/");
  await expect(page.locator("#status")).toContainText(/the engine did not start: the snapshot was built from a different build.*npm run snapshot.*\?snapshot=0/, { timeout: 120_000 });
});

// ?snapshot=0 is the normal boot (Pyodide's runtime and packages from the CDN): the way the page started before the
// snapshot became the default, and what a visitor gets when the snapshot is unwanted. One run of the sample is enough here;
// the other tests cover the page through the snapshot.
test("?snapshot=0: the normal boot still starts and runs the sample", async ({ page }) => {
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/?snapshot=0");
  await ready(page, { normal: true });
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/, { timeout: 120_000 });
  await expect(page.locator("#graphs img")).toHaveCount(1);
});
