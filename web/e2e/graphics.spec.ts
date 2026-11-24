// A lazy snapshot's graphics part (docs/lazy-matplotlib.md): matplotlib is in a file the page fetches after the start
// files. Only a graph waits for it: a run at "ready" that draws nothing does not, a Break while a graph waits is an
// ordinary Break (rc 1, data kept), and without the part (offline on a first visit) a graph fails with a clear error
// and the part is fetched again for the next graph. A return visit reads it from the Cache while the engine starts, and
// a run at "ready" does not wait for its unpack or import. Without a SharedArrayBuffer (no cross-origin isolation)
// the part is a start file instead: downloaded with the others and written before "ready", so no graph waits for it. The part's
// request is held or refused with page.route (it sees the page's requests and its worker's).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, keepFiles, ready, retryFirstGoto, startEngine, test } from "./fixtures";

declare global {
  interface Window {
    __partSeen: { ready: number; lines: [number, string][] }; // the return-visit test's clock (its init script)
    __runAtReady: Promise<any>; // `display 1`, sent by an init script the moment the page says "ready"
    __runAtReadySent: number; // when, Date.now()
  }
}

const PART = "**/snapshot/graphics.brotli.bin";
const run = async (page: Page, code: string) => {
  const result = await page.evaluate((code) => window.__dofile.run(code), code);
  if (!result) throw new Error(`no result: ${code}`);
  return result;
};

/** Hold the part's request until release(); count its requests. */
async function holdPart(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((ok) => {
    release = ok;
  });
  const seen = { hits: 0 };
  await page.route(PART, async (route) => {
    seen.hits++;
    await held;
    await route.continue();
  });
  return { release, seen };
}

/** The page's document without its isolation headers (as over plain http on a LAN address): no SharedArrayBuffer. */
async function withoutIsolation(page: Page) {
  await page.route(
    (url) => url.searchParams.has("test"),
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["cross-origin-opener-policy"];
      delete headers["cross-origin-embedder-policy"];
      await route.fulfill({ response, headers });
    },
  );
}

test.beforeEach(async ({ page }) => {
  const list = await (await page.request.get("start-files.json")).json();
  test.skip(!list.snapshot?.graphics, "this build has no graphics part (SNAPSHOT_NO_MPL=0)");
});

test("a run at ready that draws nothing does not wait for the graphics part; a Break while a graph waits is rc 1 with the data kept; the part is written and imported while idle, the graph draws, and a return visit reads it from the Cache", async ({
  page,
  browserName,
}) => {
  const { release, seen } = await holdPart(page);
  const lines: string[] = [];
  const stamped: [number, string][] = []; // Date.now(): stamped by the browser, a Firefox worker's line on arrival (later)
  page.on("console", (m) => {
    if (!m.text().includes("[dofile] graphics part")) return;
    lines.push(m.text());
    stamped.push([m.timestamp(), m.text()]);
  });
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  await expect.poll(() => seen.hits, { timeout: 60_000 }).toBe(1); // asked for after the start files, held here

  const t0 = Date.now();
  const r = await run(page, "clear\nset obs 5\ngen x = _n\ndisplay 1");
  expect(r.rc, r.log).toBe(0);
  expect(Date.now() - t0).toBeLessThan(20_000); // not held: the part is still held below
  // "Graphs loading" and its ring show the part still coming (the status bar; the phone's strip), with its size as its name
  await expect(page.locator("[data-graphics=fetching]")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /^Graphs loading, \d+\.\d of \d+\.\d MB$/ })).toBeVisible();

  const graph = run(page, "scatter x x");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.engine.value.s)).toBe("running");
  await page.waitForTimeout(1000); // inside the wait
  await page.evaluate(() => window.__dofile.breakRun());
  const broken = await graph;
  expect(broken.rc, broken.log).toBe(1);
  expect(broken.log).toContain("(waiting for the graphics files to download)");
  expect(broken.log).toContain("--Break--");
  await ready(page); // no reset: the same engine
  const kept = await run(page, "count");
  expect(kept.rc).toBe(0);
  expect(kept.log).toContain("5");

  release();
  await expect(page.locator("[data-graphics]")).toHaveCount(0, { timeout: 120_000 }); // landed: the status bar says nothing more
  // the engine was idle: written there (the browser's decoder), then imported in the background
  await expect
    .poll(() => lines.join("\n"), { timeout: 60_000 })
    .toMatch(/landed \(network\)[\s\S]*written[\s\S]*warmed/);
  const drawn = await run(page, "scatter x x, title(t)");
  expect(drawn.rc, drawn.log).toBe(0);
  expect(drawn.images).toHaveLength(1);
  expect(seen.hits, "the part is fetched once, the Break did not reset the engine").toBe(1);

  // WebKit drops the Cache API of Playwright's in-memory context on a reload
  if (browserName === "webkit") return;
  lines.length = stamped.length = 0;
  // sent from the page itself: a poll notices "ready" up to 1 s late, past the part's idle wait (IDLE_MS)
  await page.addInitScript(() => {
    window.__runAtReady = new Promise((done) => {
      new MutationObserver((_, observer) => {
        if (document.documentElement?.dataset.engine !== "ready") return;
        observer.disconnect();
        window.__runAtReadySent = Date.now();
        done(window.__dofile.run("display 1"));
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-engine"] });
    });
  });
  await page.reload();
  await startEngine(page);
  // a run at "ready" ends before the part is unpacked: nothing of it happens before the engine has been idle a while
  const first = await page.evaluate(() => window.__runAtReady);
  expect(first.rc, first.log).toBe(0);
  expect(lines.join("\n")).not.toMatch(/written/);
  await expect
    .poll(() => lines.join("\n"), { timeout: 60_000 })
    .toMatch(/landed \(cache\)[\s\S]*written while idle[\s\S]*warmed/);
  // The wait itself: no step before the run's end + IDLE_MS, so not before it was sent + IDLE_MS (from the part's
  // landing instead, a part landing inside the wait would fail it). After the wait, on the worker's thread: the write
  // and a brotli-wasm unpack's steps; a native unpack runs during it. Timers do not fire early: a lower bound.
  const sent = await page.evaluate(() => window.__runAtReadySent);
  const [writtenAt, written] = stamped.find(([, l]) => l.includes("written while idle"))!;
  const [, how, unpackS, writeS] = written.match(/unpack \((\w+)\) ([\d.]+)s.*write \d+ files ([\d.]+)s/)!;
  const idle = (writtenAt - sent) / 1000 - Number(writeS) - (how === "wasm" ? Number(unpackS) : 0);
  const timeline = stamped.map(([t, l]) => `${((t - sent) / 1000).toFixed(3)}s ${l}`).join("\n");
  expect(idle, `idle before the written line's work, after the run was sent:\n${timeline}`).toBeGreaterThan(0.15);
  const again = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  expect(again.images).toHaveLength(1);
  expect(seen.hits, "read from the Cache, not fetched again").toBe(1);
});

// A persistent profile on disk, so that the reload is a real return visit on every project (WebKit's in-memory context
// drops the Cache API). The order is read off the page's own clock (an init script), not the order console events
// arrive in.
test("a return visit reads the part from the Cache before ready; a graph sent at ready draws", async ({
  playwright,
  browserName,
}, testInfo) => {
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
    await keepFiles(context);
    await context.addInitScript(() => {
      const seen: Window["__partSeen"] = { ready: 0, lines: [] };
      window.__partSeen = seen;
      const info = console.info.bind(console);
      console.info = (...args: unknown[]) => {
        const text = args.map(String).join(" ");
        if (text.includes("[dofile] graphics part")) seen.lines.push([performance.now(), text]);
        info(...args);
      };
      // the document, not its <html>: an init script may run before the parser has made that element
      new MutationObserver(() => {
        if (!seen.ready && document.documentElement?.dataset.engine === "ready") seen.ready = performance.now();
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-engine"] });
    });
    const page = await context.newPage();
    retryFirstGoto(page);
    const seen = { hits: 0 };
    await page.route(PART, async (route) => {
      seen.hits++;
      await route.continue();
    });
    const worker: string[] = []; // the worker's lines ("written"), as console events
    page.on("console", (m) => {
      if (m.text().includes("[dofile] graphics part: written")) worker.push(m.text());
    });
    const partSeen = () => page.evaluate(() => window.__partSeen);

    // a first visit: the part is fetched after the start files and kept in the Cache
    await page.goto("?test");
    await startEngine(page);
    await ready(page);
    await expect
      .poll(async () => (await partSeen()).lines.map(([, l]) => l).join("\n"), { timeout: 120_000 })
      .toMatch(/landed \(network\)/);

    // the first visit's worker has written the part (its line comes after "landed"), so none of its lines is left to
    // arrive after the count is reset
    await expect.poll(() => worker.length, { timeout: 120_000 }).toBeGreaterThan(0);

    // the return visit: a graph as soon as the engine is ready
    worker.length = 0;
    await page.reload();
    await startEngine(page);
    await ready(page);
    const drawn = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
    expect(drawn.rc, drawn.log).toBe(0);
    expect(drawn.images).toHaveLength(1);
    const after = await partSeen();
    const lines = after.lines.map(([, l]) => l).join("\n");
    const landed = after.lines.find(([, l]) => l.includes("landed (cache)"));
    expect(landed, lines).toBeTruthy();
    expect(after.ready, "ready was seen").toBeGreaterThan(0);
    expect(landed![0], `read from the Cache before "ready" (${landed![0]} < ${after.ready} ms)`).toBeLessThan(
      after.ready,
    );
    expect(seen.hits, "read from the Cache, not fetched again").toBe(1);
    await expect.poll(() => worker.length).toBe(1);
    expect(worker.length, "written once").toBe(1);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a graph submitted while the part downloads waits for it and draws", async ({ page }) => {
  const { release } = await holdPart(page);
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  const graph = run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.engine.value.s)).toBe("running");
  await page.waitForTimeout(500);
  release(); // lands while the graph waits in Python: the worker unpacks it there
  const r = await graph;
  expect(r.rc, r.log).toBe(0);
  expect(r.images).toHaveLength(1);
});

test("offline on a first visit: the part never arrives, a graph fails with a clear error, other runs work; online again, the next graph fetches it and draws", async ({
  page,
}) => {
  await page.route(PART, (route) => route.abort());
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("graphics part: the graphics files could not be downloaded")) failed.push(m.text());
  });
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  await expect.poll(() => failed.length, { timeout: 60_000 }).toBeGreaterThan(0);
  // no lasting "unavailable" label: the graph's own error says why
  await expect(page.locator("[data-graphics]")).toHaveCount(0);
  await expect(page.getByText(/unavailable/i)).toHaveCount(0);
  const ok = await run(page, "clear\nset obs 5\ngen x = _n\nsummarize x");
  expect(ok.rc, ok.log).toBe(0);
  const r = await run(page, "scatter x x");
  expect(r.rc, r.log).toBe(199);
  expect(r.log).toContain("graphs are not available: the graphics files could not be downloaded");
  expect(r.log).toContain("r(199);");
  const again = await run(page, "count");
  expect(again.rc).toBe(0); // the engine goes on
  await page.unroute(PART); // online again: the failed graph asked for the part, the next one waits for it
  const drawn = await run(page, "scatter x x");
  expect(drawn.rc, drawn.log).toBe(0);
  expect(drawn.images).toHaveLength(1);
});

test("without a SharedArrayBuffer (no cross-origin isolation): the part is a start file, written before ready; a graph at ready draws with no waiting line and no Graphs loading ring; other runs work", async ({
  page,
}) => {
  await withoutIsolation(page);
  const types: string[] = [];
  await page.route(PART, async (route) => {
    types.push(route.request().resourceType());
    await route.continue();
  });
  const lines: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("graphics part")) lines.push(m.text());
  });
  await page.goto("?test");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await startEngine(page);
  await ready(page);
  await expect.poll(() => lines.join("\n"), { message: "the worker wrote it in boot" }).toMatch(/written at the start/);
  await expect(page.locator("[data-graphics]"), "no ring: nothing downloads after the start").toHaveCount(0);
  const r = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  expect(r.rc, r.log).toBe(0);
  expect(r.images).toHaveLength(1);
  expect(r.log, "the graph did not wait for the part").not.toContain("(waiting for the graphics files to download)");
  await expect(page.locator("[data-graphics]")).toHaveCount(0);
  const said = lines.join("\n");
  expect(said, "not written by a graph or while idle").not.toMatch(/written (in a run|while idle)/);
  expect(said, "the page did not fetch it after the start").not.toMatch(/landed \(/);
  expect(types, "one request for the part: the start's download, whose Cache entry the worker read").toHaveLength(1);
  const ok = await run(page, "summarize x");
  expect(ok.rc, ok.log).toBe(0);
});

test("a damaged part found while idle: the Cache entry is dropped and the part fetched again at once, and a graph draws without saying the damage (race 11)", async ({
  page,
}) => {
  const list = await (await page.request.get("start-files.json")).json();
  let hits = 0;
  await page.route(PART, async (route) => {
    // the first request answers a part of the right size that is not brotli; later ones are the real file
    if (++hits === 1)
      await route.fulfill({
        body: Buffer.alloc(list.snapshot.graphics.size, 7),
        contentType: "application/octet-stream",
      });
    else await route.continue();
  });
  await page.goto("?test");
  await startEngine(page);
  await ready(page);
  // no run: the idle steps find the damage, and the page fetches the part again
  await expect.poll(() => hits, { timeout: 30_000 }).toBe(2);
  await run(page, "clear\nset obs 5\ngen x = _n");
  const drawn = await run(page, "scatter x x"); // the fresh copy, or a wait for it
  expect(drawn.rc, drawn.log).toBe(0);
  expect(drawn.log).not.toContain("arrived damaged");
  expect(drawn.images).toHaveLength(1);
  expect(hits, "the damaged entry was not read again: the part came from the network once more").toBe(2);
});

test("without a SharedArrayBuffer, a damaged part fails the start as a damaged heap does: it is dropped from the Cache, and the next start fetches it again and a graph draws", async ({
  page,
}) => {
  const list = await (await page.request.get("start-files.json")).json();
  await withoutIsolation(page);
  let hits = 0;
  await page.route(PART, async (route) => {
    // the first request answers a part of the right size that is not brotli; later ones are the real file
    if (++hits === 1)
      await route.fulfill({
        body: Buffer.alloc(list.snapshot.graphics.size, 7),
        contentType: "application/octet-stream",
      });
    else await route.continue();
  });
  await page.goto("?test=manual");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.waitForFunction(() => window.__dofile && !window.__dofile.store.blocked); // the tab lock answered
  const partCached = () =>
    page.evaluate(
      async ([name, built]) =>
        (await (await caches.open(`dofile-snapshot-${built}`)).keys()).some((r) => r.url.endsWith(`/snapshot/${name}`)),
      [list.snapshot.graphics.name, list.built] as const,
    );
  await page.evaluate(() => {
    window.__dofile.start();
  });
  await expect
    .poll(() => page.evaluate(() => window.__dofile.state.engine.value.s), { timeout: 120_000 })
    .toBe("failed");
  expect(await partCached(), "the damaged part is not read again").toBe(false);
  await page.evaluate(() => {
    window.__dofile.start();
  });
  await ready(page);
  expect(await partCached()).toBe(true);
  expect(hits, "the next start's download fetched it again").toBe(2);
  const r = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  expect(r.rc, r.log).toBe(0);
  expect(r.images).toHaveLength(1);
});
