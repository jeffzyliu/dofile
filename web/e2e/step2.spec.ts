// Prototype 1, step 2, in real browsers: what Node cannot check (docs/design/SPEC.md, section 7, tests 9 and 10). The tab
// lock between two pages; the counted download into the Cache, and a start that then uses those bytes; no request to
// another origin; the store's zip. The page is still the proof of concept: these tests reach the client and the store
// through the page's test hook, and move to the real page's flows in step 6.
// The hook (main.ts), which the real page must keep for them: with ?test in the URL, window.__dofile =
// { engine, store, start, persisted, engineBytes }; with ?test=manual the page starts no engine until start() is called.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

type StartFiles = { built: number; wheelHash: string; compressed: number; files: { path: string; size: number; compressed: number; download: boolean }[] };
type Progress = { received: number; total: number };
type Handle = {
  engine: { worker: unknown; start(): Promise<unknown>; run(code: string): Promise<{ rc: number; log: string }>; download(o?: { onProgress?: (p: Progress) => void; signal?: AbortSignal }): Promise<{ cached: boolean; received: number; total: number; why?: string }> };
  store: { list(): Promise<{ path: string }[]>; write(path: string, data: Uint8Array): Promise<unknown>; zip(): Promise<File> };
  start(): Promise<void>; persisted(): boolean | null | undefined; engineBytes: number | null;
};
declare global { interface Window { __dofile: Handle; __persistCalls?: number } }

const PAUSED = /dofile is open in another tab: this tab is paused/;
const ready = (page: Page) => expect(page.locator("#status")).toHaveText(/ready in [\d.]+ s \(snapshot\)/, { timeout: 300_000 });

// every request the pages of this context make, their workers' included
function requests(context: BrowserContext) {
  const urls: string[] = [];
  context.on("request", r => urls.push(r.url()));
  return urls;
}
const elsewhere = (urls: string[], origin: string) => urls.filter(u => !u.startsWith(`${origin}/`) && !u.startsWith(`blob:${origin}/`) && !u.startsWith("data:"));
const pathOf = (url: string) => new URL(url).pathname;   // a start file by its path on the server: its URL can carry a ?v=

async function runSample(page: Page) {
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/^rc 0 in/, { timeout: 120_000 });
  await expect(page.locator("#graphs img")).toHaveCount(1);
}

test("the default start asks nothing of another origin; persist() is asked once; the download size is in the page; the zip is made in the page", async ({ page, context, request, baseURL }) => {
  const urls = requests(context);
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.addInitScript(() => {   // count the page's calls of storage.persist()
    const storage = navigator.storage, real = storage?.persist?.bind(storage);
    if (!real) return;
    window.__persistCalls = 0;
    storage.persist = () => { window.__persistCalls!++; return real(); };
  });
  await page.goto("/?test");
  await ready(page);
  await runSample(page);
  expect(urls.some(u => u.endsWith("/pyodide/pyodide.asm.wasm")), "the runtime came from the page's own origin").toBe(true);
  expect(elsewhere(urls, new URL(baseURL!).origin)).toEqual([]);

  // storage.persist() was asked, once, and the page has what persisted() says (null: the browser has no such API).
  // Firefox asks the user and leaves persist() unanswered: the page has the state all the same.
  const kept = await page.evaluate(async () => ({
    answer: window.__dofile.persisted(), calls: window.__persistCalls ?? null,
    now: navigator.storage?.persist ? await navigator.storage.persisted() : null }));
  expect(kept.answer).toBe(kept.now);
  expect(kept.calls).toBe(kept.now === null ? null : 1);

  // the download size is written into the page by the build: the list's total, with no request for it
  const list: StartFiles = await (await request.get("/start-files.json")).json();
  expect(list.compressed).toBeGreaterThan(30e6);
  expect(await page.evaluate(() => window.__dofile.engineBytes)).toBe(list.compressed);
  expect(await page.locator('meta[name="dofile-engine-bytes"]').getAttribute("content")).toBe(String(list.compressed));
  expect(list.wheelHash).toMatch(/^[0-9a-f]{64}$/);

  // "Download all (.zip)": from the store, no Python
  await page.locator("#upload").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello\n") });
  await expect(page.locator("#files")).toContainText("notes.txt");
  const zip = await page.evaluate(async () => {
    const z = await window.__dofile.store.zip();
    return { name: z.name, type: z.type, size: z.size, head: [...new Uint8Array(await z.slice(0, 4).arrayBuffer())] };
  });
  expect(zip.name).toMatch(/^dofile-\d{4}-\d\d-\d\d\.zip$/);
  expect(zip.head).toEqual([0x50, 0x4b, 3, 4]);
  expect(zip.size).toBeGreaterThan(200);
});

test("the page has no test hook unless the URL asks for it", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  expect(await page.evaluate(() => typeof window.__dofile)).toBe("undefined");
});

test("download: the counts reach the total, abort keeps the finished files, and the start then uses the cached bytes", async ({ page, context, request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const list: StartFiles = await (await request.get("/start-files.json")).json();
  const wanted = list.files.filter(f => f.download).map(f => `/${f.path}`);
  expect(wanted.length).toBeGreaterThanOrEqual(8);   // the snapshot's five, the runtime's three, the brotli decoder
  const urls = requests(context);
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile);

  // files work with no engine at all, and are in the folder the engine later runs in
  await page.locator("#upload").setInputFiles({ name: "early.do", mimeType: "text/plain", buffer: Buffer.from('display "EARLY " 6*7\n') });
  await expect(page.locator("#files")).toContainText("early.do");
  expect(await page.evaluate(() => window.__dofile.engine.worker)).toBeNull();

  // a first try, stopped a third of the way in
  const first = await page.evaluate(async () => {
    const stop = new AbortController(), seen: number[] = [];
    try {
      await window.__dofile.engine.download({ signal: stop.signal, onProgress: p => { seen.push(p.received); if (p.received > p.total / 3) stop.abort(); } });
      return { error: "not aborted", seen };
    } catch (e) {
      const kept: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) kept.push(r.url);
      return { error: (e as Error).name, seen, kept, worker: window.__dofile.engine.worker };
    }
  });
  expect(first.error).toBe("AbortError");
  expect(first.worker).toBeNull();   // no engine: the page is where "Not now" leaves it
  const kept = first.kept!.map(pathOf);
  expect(kept.length).toBeLessThan(wanted.length);
  for (const path of kept) expect(wanted).toContain(path);
  const asked = urls.length;

  // the second try: the finished files are not fetched again, and the counts end at the list's total
  const second = await page.evaluate(async () => {
    const seen: Progress[] = [];
    const done = await window.__dofile.engine.download({ onProgress: p => seen.push(p) });
    return { done, first: seen[0], last: seen.at(-1)!, steps: seen.length, rising: seen.every((p, i) => i === 0 || p.received > seen[i - 1].received) };
  });
  expect(second.done).toEqual({ cached: true, received: list.compressed, total: list.compressed });
  expect(second.last).toEqual({ received: list.compressed, total: list.compressed });
  expect(second.first.received).toBeGreaterThan(0);   // the page's own files, and what the first try kept
  expect(second.rising).toBe(true);
  expect(second.steps).toBeGreaterThan(3);   // WebKit hands a local file over in a few big pieces
  const again = urls.slice(asked).map(pathOf);
  for (const path of kept) expect(again, `${path} was kept by the first try`).not.toContain(path);

  // The start: from the cache. The files download() fetched are now unreachable, so a start that asked the network for
  // one of them would fail.
  await context.route(url => wanted.includes(url.pathname), route => route.abort());
  const before = urls.length;
  await page.evaluate(() => { window.__dofile.start(); });
  await ready(page);
  await expect(page.locator("#status")).toContainText("read from cache");
  const during = urls.slice(before).map(pathOf);
  for (const path of wanted) expect(during, `${path} was fetched again by the start`).not.toContain(path);
  expect(elsewhere(urls, origin)).toEqual([]);

  // and the engine it started works: native code, a graph, the file uploaded before it existed
  await runSample(page);
  await page.evaluate(() => {
    const v = (window as unknown as { __editor: import("@codemirror/view").EditorView }).__editor;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "do early.do" } });
  });
  await page.locator("#run").click();
  await expect(page.locator("#log")).toContainText("EARLY 42", { timeout: 120_000 });
});

// A cached file that is not what the manifest says (damaged, or cut short) must not stay: the start says so and drops it,
// the worker that could not start is ended, and the next start fetches the file again.
test("a damaged file in the cache fails the start once and is fetched again by the next one", async ({ page, request }) => {
  const list: StartFiles = await (await request.get("/start-files.json")).json();
  const heap = list.files.find(f => f.path.startsWith("snapshot/heap"))!.path;
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile);
  const cached = () => page.evaluate(async ([path, built]) =>
    Boolean(await (await caches.open(`dofile-snapshot-${built}`)).match(new URL(path as string, location.href).href)), [heap, list.built] as const);
  await page.evaluate(async ([path, built]) => {
    await (await caches.open(`dofile-snapshot-${built}`)).put(new URL(path as string, location.href).href, new Response(new Uint8Array(10)));
  }, [heap, list.built] as const);
  expect(await cached()).toBe(true);
  await page.evaluate(() => { window.__dofile.start(); });
  await expect(page.locator("#status")).toContainText(/the engine did not start: snapshot: a file is 10 bytes, the manifest says \d+/, { timeout: 120_000 });
  expect(await cached()).toBe(false);
  expect(await page.evaluate(() => window.__dofile.engine.worker), "the worker that could not start is ended").toBeNull();
  await page.evaluate(() => { window.__dofile.start(); });
  await ready(page);
  expect(await cached()).toBe(true);
  await runSample(page);
});

// download() is the one writer of the Cache: a start without it works, and keeps nothing (a host's error page for a
// missing file, sent with status 200, could otherwise end up in the cache for good).
test("a start without download() works and writes nothing to the Cache", async ({ page }) => {
  page.on("pageerror", e => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile);
  const kept = await page.evaluate(async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    await window.__dofile.engine.start();
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return urls;
  });
  expect(kept).toEqual([]);
  expect(await page.evaluate(async () => (await window.__dofile.engine.run('display "N=" 6*7')).log)).toContain("N=42");
});

test("tab lock: a second tab gets no engine and writes nothing; taking over ends the first tab's engine", async ({ page, context }) => {
  page.on("pageerror", e => console.log(`first tab error: ${e.message}`));
  await page.goto("/?test");
  await ready(page);
  await page.locator("#upload").setInputFiles({ name: "first-tab.do", mimeType: "text/plain", buffer: Buffer.from("display 1\n") });
  await expect(page.locator("#files")).toContainText("first-tab.do");

  // a second tab; its question ("Use dofile in this tab?") is answered no
  const second = await context.newPage();
  second.on("pageerror", e => console.log(`second tab error: ${e.message}`));
  const asked: string[] = [];
  let takeOver = false;
  second.on("dialog", d => { asked.push(d.message()); takeOver ? d.accept() : d.dismiss(); });
  await second.goto("/?test");
  await expect(second.locator("#status")).toHaveText(PAUSED);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("dofile is open in another tab");
  expect(await second.evaluate(() => window.__dofile.engine.worker)).toBeNull();   // no engine
  await expect(second.locator("#run")).toBeDisabled();
  const refused = await second.evaluate(() => window.__dofile.store.write("second-tab.do", new Uint8Array([49])).then(() => "written", e => (e as Error).message));
  expect(refused).toContain("open in another tab");
  // the first tab is untouched: its engine runs, and its files are as they were
  await runSample(page);
  expect((await page.evaluate(() => window.__dofile.store.list())).map(f => f.path).sort()).toEqual(["first-tab.do", "main.do"]);

  // "Use dofile in this tab": the second tab takes the lock; the first one ends its worker and says so
  takeOver = true;
  await second.reload();
  await expect(page.locator("#status")).toHaveText(PAUSED, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__dofile.engine.worker)).toBeNull();
  await expect(page.locator("#run")).toBeDisabled();
  await ready(second);
  await expect(second.locator("#files")).toContainText("first-tab.do");   // the same files
  await runSample(second);
  // the tab that lost the lock writes nothing now
  const late = await page.evaluate(() => window.__dofile.store.write("late.do", new Uint8Array([49])).then(() => "written", e => (e as Error).message));
  expect(late).toContain("open in another tab");
  expect((await second.evaluate(() => window.__dofile.store.list())).map(f => f.path).sort()).toEqual(["first-tab.do", "main.do"]);
});
