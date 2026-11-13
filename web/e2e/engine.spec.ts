// The engine in real browsers, through the page's test hook (main.tsx): the cases of the proof of concept's poc.spec.ts
// that need no editor, moved here in prototype 1, step 3. Files go in with store.write, code runs through the run
// controller (window.__dofile.run), Break and Reset through the engine controller (breakRun, reset). Step 6 turns them
// into the flows' tests.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, keepFiles, retryFirstGoto, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

const data = new URL("../../tests/conformance/data/", import.meta.url);
const ref = JSON.parse(readFileSync(new URL("ref.json", data), "utf8"));
const SAMPLE =
  "clear\nset obs 200\nset seed 1\ngenerate x = rnormal()\ngenerate y = 1 + 2*x + rnormal()\nregress y x, robust\nscatter y x\n";

type RunResult = {
  rc: number;
  log: string;
  error: string | null;
  nobs: number;
  images: string[];
  timing?: Record<string, number>;
};
type Hook = {
  engine: { startup: { mode: string; fetched?: string } | null; query(op: "memory"): Promise<{ heap_bytes: number }> };
  store: {
    blocked: boolean;
    list(): Promise<{ path: string }[]>;
    write(path: string, data: Uint8Array): Promise<unknown>;
  };
  run(code: string): Promise<RunResult | null>;
  breakRun(): void;
  reset(): void; // the engine controller's Break and Reset
  state: { engine: { value: { s: string } }; banners: { value: { b: string; kind?: string }[] } };
};
declare global {
  interface Window {
    __dofile: Hook;
  }
}

const engineState = (page: Page) => page.evaluate(() => document.documentElement.dataset.engine ?? "");
const ready = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 300_000 }).toBe("ready");
async function upload(page: Page, name: string) {
  const b64 = readFileSync(new URL(name, data)).toString("base64");
  await page.evaluate(
    ([name, b64]) =>
      window.__dofile.store.write(
        name,
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      ),
    [name, b64] as const,
  );
}
async function run(page: Page, code: string, rc = 0) {
  const r = await page.evaluate((code) => window.__dofile.run(code), code);
  expect(r, "the engine was ready").not.toBeNull();
  expect(r!.rc, r!.log.slice(-2000)).toBe(rc);
  return r!;
}

test("runs .do code on stored files, breaks at a safe point with the data kept, and keeps the files across a reload and a reset", async ({
  page,
}) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await upload(page, "cps.dta");

  let r = await run(
    page,
    String.raw`use C:\Users\me\proj\cps, clear
generate double lwage = ln(wage_hr)
generate double exper = age - yrsed - 6
generate double exper2 = exper^2
regress lwage yrsed exper exper2
display "B=" %20.12g _b[yrsed]
scatter lwage yrsed`,
  );
  expect(r.log).toContain(String.raw`(path C:\Users\me\proj\cps.dta is cps.dta in the working folder)`);
  const b = Number(r.log.match(/^B=\s*(\S+)/m)![1]);
  expect(Math.abs(b - ref.ols_b_yrsed)).toBeLessThan(1e-6 * Math.abs(ref.ols_b_yrsed));
  expect(r.images).toHaveLength(1);

  // Break, as the toolbar's Break does it (the engine controller): `breaking`, then the interrupt buffer stops the loop at
  // a safe point, rc 1; the data stays, and no reset happened
  const loop = page.evaluate(() => window.__dofile.run("while 1 {\n quietly replace exper = exper + 1\n}"));
  await expect.poll(() => page.evaluate(() => window.__dofile.state.engine.value.s)).toBe("running");
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => {
      window.__dofile.breakRun();
      return window.__dofile.state.engine.value.s;
    }),
  ).toBe("breaking");
  expect((await loop)?.rc).toBe(1);
  expect(await page.evaluate(() => window.__dofile.state.engine.value.s)).toBe("ready");
  expect(await page.evaluate(() => window.__dofile.state.banners.value)).toEqual([]); // no reset; no storage banner (fixtures.ts)
  expect((await run(page, 'display "N=" _N')).log).toContain("N=15528");

  // a reload: the files come back from the store
  await page.reload();
  await startEngine(page); // WebKit's in-memory context drops the Cache on a reload: the page asks again there
  await ready(page);
  expect((await page.evaluate(() => window.__dofile.store.list())).map((f) => f.path)).toContain("cps.dta");

  // Reset, as the dialog's Reset does it (the engine controller): a new engine, the reset banner; data gone, files kept
  await page.evaluate(() => window.__dofile.reset());
  await ready(page);
  expect(await page.evaluate(() => window.__dofile.state.banners.value)).toEqual([
    { b: "reset", reason: "reset by you", kind: "user" },
  ]);
  r = await run(page, 'display "N=" _N\nuse cps, clear\ndisplay "M=" _N');
  expect(r.log).toContain("N=0");
  expect(r.log).toContain("M=15528");
});

// The two package gaps of 2026-11-09, in every browser: xlwt/xlrd (legacy .xls) and pyreadstat (built for Pyodide,
// web/wheels/), which reads SAS transport and SPSS files without pandas. `export sasxport` needs pandas, which the page
// leaves out: it must say so with rc 199 (ODT-32), not crash.
test("legacy .xls and the ReadStat formats work: xlwt, xlrd and pyreadstat are installed", async ({ page }) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  await upload(page, "small.xpt");
  await upload(page, "small.sav");
  const r = await run(
    page,
    `clear
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
display "SAV=" _N " " x[4] " " s[2]`,
  );
  expect(r.log).toContain("XLS=4 6");
  expect(r.log).toContain("XPT=4 6 a2");
  expect(r.log).toContain("SAV=4 6 a2");
  expect((await run(page, "export sasxport out, replace", 199)).log).toContain("it needs the pandas package");
});

// The default start, from the memory snapshot: download() fills the Cache before each start, so the start reads it from
// there, a reload too, with no download prompt; what the browser keeps is the compressed files; with the Cache deleted,
// a reload asks again.
test("the default start: from the memory snapshot, runs native code and a graph, and caches it; the prompt only when nothing is cached", async ({
  playwright,
  browserName,
}, testInfo) => {
  // A persistent profile on disk, as a real browser has. Playwright's default context keeps storage in memory, and WebKit
  // drops the whole Cache API when such a page is reloaded, so "read from cache" after a reload could never hold there.
  const dir = mkdtempSync(join(tmpdir(), "dofile-e2e-"));
  const u = testInfo.project.use;
  const context = await playwright[browserName].launchPersistentContext(dir, {
    baseURL: u.baseURL,
    userAgent: u.userAgent,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  });
  try {
    await keepFiles(context); // the fixture covers only the test's own context
    const page = await context.newPage();
    retryFirstGoto(page);
    const notes: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[dofile] snapshot start")) notes.push(m.text());
    });
    page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
    await page.goto("?test");
    await startEngine(page);
    await ready(page);
    const r = await run(page, SAMPLE);
    expect(r.images).toHaveLength(1);
    // the run's breakdown (a snapshot built from an older wheel has none: rebuild it)
    expect(Object.keys(r.timing ?? {}).sort()).toEqual(["encode", "engine", "parse", "save"]);
    expect(await page.evaluate(() => window.__dofile.engine.startup)).toMatchObject({
      mode: "snapshot",
      fetched: "read from cache",
    });
    expect(notes.at(-1)).toContain("read from cache"); // download() filled the Cache just before

    // a reload: the start files are all in the Cache, so the page starts without the download prompt
    await page.reload();
    await expect.poll(() => engineState(page)).not.toMatch(/^(none)?$/);
    expect(await engineState(page), "no prompt: the Cache holds the start files").not.toBe("asking");
    await ready(page);
    await expect.poll(() => notes.length).toBe(2);
    expect(notes.at(-1)).toContain("read from cache");
    expect(notes.at(-1)).toContain("decompress");
    expect(notes.join("\n")).not.toContain("NOT CACHED"); // the browser took the files; a refusal would be said here

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

    // the start files deleted (evicted, cleared): the next load asks again before it downloads
    await page.evaluate(async () => {
      for (const name of await caches.keys()) if (name.startsWith("dofile-snapshot-")) await caches.delete(name);
    });
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Download the engine?" })).toBeVisible({ timeout: 30_000 });
    expect(await engineState(page)).toBe("asking");
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The cap on the engine's heap (engine/memcap.ts, snapshot.ts HEAP_MAX): the page passes ?memcap=<MB> to the worker, a big
// allocation fails inside Python as MemoryError, which the engine reports as r(909), and the data and the engine stay. The
// iPhone project is capped by its user agent (750 MB) in every other test too. 400 MB is above the restored heap (130 MB)
// and under what 10 million doubles and the copies `generate` makes need (about 1 GB uncapped).
const CAP_MB = 400;
async function overTheCap(page: Page, query: string) {
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto(query);
  await startEngine(page);
  await ready(page);
  expect(logged).toContain(`[dofile] engine memory cap: ${CAP_MB} MB, ?memcap=${CAP_MB}`);
  await run(page, "clear\nset obs 10000000");
  const r = await run(page, "generate double x1 = runiform()", 909);
  expect(r.error).toBe("op. sys. refuses to provide memory");
  expect(r.log).toContain("r(909);");
  const { heap_bytes } = await page.evaluate(() => window.__dofile.engine.query("memory"));
  expect(heap_bytes).toBeLessThanOrEqual(CAP_MB * 1024 * 1024);
  // an ordinary error: the engine is alive and ready (no reset), the data is kept, and a small command runs
  expect(await engineState(page)).toBe("ready");
  const after = await run(page, "describe, short\ndisplay 1+1");
  expect(after.nobs).toBe(10_000_000);
  expect(after.log).toMatch(/^2$/m);
  // and it does real work again (a new small dataset: another 10-million-row generate would not fit under this cap either)
  const small = await run(page, "clear\nset obs 1000\ngenerate x = _n\nsummarize x");
  expect(small.nobs).toBe(1000);
}

test("?memcap=400: a big allocation fails as r(909) with the data kept and the engine alive", async ({ page }) => {
  test.setTimeout(120_000);
  await overTheCap(page, `?test&memcap=${CAP_MB}`);
});

// The same cap on the normal boot (Pyodide's own loader from the CDN, patched in the worker). Chromium only: the normal boot
// loads about 60 MB from the CDN, and in WebKit it stalls now and then (see shell.spec.ts); the cap's code is the same there.
test("?snapshot=0&memcap=400: the normal boot is capped too", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "the normal boot is slow and CDN-bound; the cap's code does not differ by browser",
  );
  test.setTimeout(300_000);
  await overTheCap(page, `?snapshot=0&test&memcap=${CAP_MB}`);
});
