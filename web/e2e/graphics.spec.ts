// A lazy snapshot's graphics part (experiment E1c, docs/lazy-matplotlib.md): matplotlib is not in the snapshot but in
// graphics.brotli.bin, which the page fetches after the start files and hands to the worker. Only a graph waits for it: a
// run at "ready" that draws nothing does not, a Break while a graph waits is an ordinary Break (rc 1, data kept, the part
// not fetched again), a graph after it lands draws, and without it (offline on a first visit) a graph fails with a clear
// error, and the part is fetched again for the next graph. A return visit's run at "ready" does not wait for the part's
// unpack or import (they start after the engine has been idle a while). Without a SharedArrayBuffer (no cross-origin
// isolation) graphs still draw: the worker alone fetches the part, the page never does, yet the page shows the download
// (the worker tells it) and a graph that fetches it in a run says it is waiting; a damaged part is not taken from the HTTP
// cache again. While the part downloads
// after the start, "Graphs loading" and a ring show (the status bar; the phone's strip). The part's request is held or
// refused with page.route (the route sees the page's requests and its worker's).
import type { Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures";

type Hook = { run(code: string): Promise<any>; breakRun(): void; state: { engine: { value: { s: string } } } };
declare global {
  interface Window {
    __dofile: Hook;
  }
}

const PART = "**/snapshot/graphics.brotli.bin";
const ready = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 300_000 }).toBe("ready");
const run = (page: Page, code: string) => page.evaluate((code) => window.__dofile.run(code), code);

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
  page.on("console", (m) => {
    if (m.text().includes("[dofile] graphics part")) lines.push(m.text());
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

  // WebKit drops the Cache API of Playwright's in-memory context on a reload (engine.spec.ts uses a profile on disk for that)
  if (browserName === "webkit") return;
  lines.length = 0;
  await page.reload();
  await startEngine(page);
  await ready(page);
  // a run at "ready" ends before the part is unpacked: nothing of it happens before the engine has been idle a while
  const first = await run(page, "display 1");
  expect(first.rc, first.log).toBe(0);
  expect(lines.join("\n")).not.toMatch(/written/);
  await expect
    .poll(() => lines.join("\n"), { timeout: 60_000 })
    .toMatch(/landed \(cache\)[\s\S]*written while idle[\s\S]*warmed/);
  const again = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  expect(again.images).toHaveLength(1);
  expect(seen.hits, "read from the Cache, not fetched again").toBe(1);
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

test("without a SharedArrayBuffer (no cross-origin isolation): the worker alone fetches the part; a graph at ready that finds its fetch on the way fetches it itself and draws; other runs work", async ({
  page,
}) => {
  await withoutIsolation(page);
  // every fetch() of the part is held (the worker's own, started once the engine is ready); the graph's synchronous XHR
  // goes through. The graph must not wait for the held fetch, and the page must not fetch the part at all (one owner)
  const types: string[] = [];
  await page.route(PART, async (route) => {
    const type = route.request().resourceType();
    types.push(type);
    if (type === "fetch") await new Promise((ok) => setTimeout(ok, 15_000));
    await route.continue().catch(() => {}); // the graph stopped that fetch meanwhile
  });
  const lines: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("graphics part")) lines.push(m.text());
  });
  await page.goto("?test");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await startEngine(page);
  await ready(page);
  await expect.poll(() => types.length, { message: "the worker's own fetch began" }).toBeGreaterThan(0);
  // the download is shown although the page does not fetch it: the worker says it began (the maintainer's rule: a download
  // is never hidden from the user)
  await expect(page.getByRole("progressbar", { name: /^Graphs loading, \d+\.\d of \d+\.\d MB$/ })).toBeVisible();
  const t0 = Date.now();
  const r = await run(page, "clear\nset obs 5\ngen x = _n\nscatter x x");
  expect(r.rc, r.log).toBe(0);
  expect(r.images).toHaveLength(1);
  expect(r.log, "the graph that fetches it in a run says it waits, as with a shared buffer").toContain(
    "(waiting for the graphics files to download)",
  );
  expect(Date.now() - t0, "the graph did not wait for the held fetch").toBeLessThan(12_000);
  await expect(page.locator("[data-graphics]"), "landed: the ring goes").toHaveCount(0);
  const said = lines.join("\n");
  expect(said).toContain("the worker's own fetch was still on its way");
  expect(said).toMatch(/fetched by the worker in a run/);
  expect(said, "the page never fetched the part").not.toMatch(/landed \(/);
  expect(
    types.filter((t) => t === "fetch"),
    "one fetch(), the worker's",
  ).toHaveLength(1);
  expect(
    types.filter((t) => t === "xhr"),
    "the graph's own request",
  ).toHaveLength(1);
  const ok = await run(page, "summarize x");
  expect(ok.rc, ok.log).toBe(0);
});

test("a damaged part: the graph says it will be fetched again, the Cache entry is dropped, the next graph fetches it and draws", async ({
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
  await run(page, "clear\nset obs 5\ngen x = _n");
  const bad = await run(page, "scatter x x");
  expect(bad.rc, bad.log).toBe(199);
  expect(bad.log).toContain("arrived damaged");
  expect(bad.log).toContain("fetched again for the next graph");
  expect(bad.log).not.toContain("reload the page");
  const ok = await run(page, "count");
  expect(ok.rc).toBe(0);
  const drawn = await run(page, "scatter x x"); // waits for the fresh fetch
  expect(drawn.rc, drawn.log).toBe(0);
  expect(drawn.images).toHaveLength(1);
  expect(hits, "the damaged entry was not read again: the part came from the network once more").toBe(2);
});

test("without a SharedArrayBuffer, a damaged part is not taken from the HTTP cache again: the retry has an address of its own", async ({
  page,
}) => {
  const list = await (await page.request.get("start-files.json")).json();
  await withoutIsolation(page);
  const requests: string[] = [];
  // PART's glob matches the whole address, so not the retry's `?fresh=`
  await page.route(/\/snapshot\/graphics\.brotli\.bin(\?.*)?$/, async (route) => {
    // the first request answers a part of the right size that is not brotli; later ones are the real file
    requests.push(route.request().url());
    if (requests.length === 1)
      await route.fulfill({
        body: Buffer.alloc(list.snapshot.graphics.size, 7),
        contentType: "application/octet-stream",
      });
    else await route.continue();
  });
  const lines: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("graphics part")) lines.push(m.text());
  });
  await page.goto("?test");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await startEngine(page);
  await ready(page);
  await expect
    .poll(() => lines.join("\n"), { message: "the worker's own fetch landed" })
    .toMatch(/fetched by the worker/);
  await run(page, "clear\nset obs 5\ngen x = _n");
  const bad = await run(page, "scatter x x");
  expect(bad.rc, bad.log).toBe(199);
  expect(bad.log).toContain("arrived damaged");
  const drawn = await run(page, "scatter x x"); // fetches it again, in the run
  expect(drawn.rc, drawn.log).toBe(0);
  expect(drawn.images).toHaveLength(1);
  expect(requests, "one more request").toHaveLength(2);
  expect(requests[0]).not.toContain("fresh=");
  expect(requests[1], "the retry is not an address the HTTP cache may hold").toContain("fresh=");
  await expect(page.locator("[data-graphics]")).toHaveCount(0);
});
