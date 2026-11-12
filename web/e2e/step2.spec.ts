// Prototype 1, step 2, in real browsers: what Node cannot check (docs/design/SPEC.md, section 7, tests 9 and 10). The tab
// lock between two pages; the counted download into the Cache, and a start that then uses those bytes; no request to
// another origin; the store's zip. Since step 3 the page is the app shell: these tests reach the client, the store and
// the state through the page's test hook, and click the shell's own dialogs (the download prompt, the take-over). They
// move to the flows' tests in step 6.
// The hook (main.tsx): with ?test in the URL, window.__dofile = { engine (the transport: its facts `worker` and `startup`,
// cached() and download(); it starts and runs nothing by itself), store, start (the controller's: the download, then the
// worker), persisted, engineBytes, state (the signals of src/app/state.ts), run (a run through the controller), breakRun
// and reset (the engine controller's), drops (the events that changed nothing) }; with ?test=manual the page starts no
// engine until start() is called. The store is blocked until the tab lock answers.
import type { BrowserContext, Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type StartFiles = {
  built: number;
  buildId: string;
  compressed: number;
  files: { path: string; size: number; compressed: number; download: boolean }[];
  snapshot: {
    snapshot: { name: string; raw: number; size: number };
    bundle: { name: string; raw: number; size: number };
  };
};
type Progress = { received: number; total: number };
type RunResult = { rc: number; log: string; images: string[] };
type Handle = {
  engine: {
    worker: unknown;
    cached(): Promise<boolean>;
    startup: { mode: string; fetched?: string } | null;
    download(o?: {
      onProgress?: (p: Progress) => void;
      signal?: AbortSignal;
    }): Promise<{ cached: boolean; received: number; total: number; why?: string; build: unknown }>;
  };
  store: {
    blocked: boolean;
    list(): Promise<{ path: string }[]>;
    write(path: string, data: Uint8Array): Promise<unknown>;
    zip(): Promise<File>;
  };
  start(): void;
  reset(): void;
  persisted(): boolean | null | undefined;
  engineBytes: number | null;
  run(code: string): Promise<RunResult | null>;
  drops(): { type: string; n?: number; row: string; why: string }[];
  state: {
    engine: { value: { s: string; message?: string; detail?: string } };
    files: { value: { path: string }[] };
    graphs: { value: unknown[] };
  };
};
declare global {
  interface Window {
    __dofile: Handle;
    __persistCalls?: number;
  }
}

const SAMPLE =
  "clear\nset obs 200\nset seed 1\ngenerate x = rnormal()\ngenerate y = 1 + 2*x + rnormal()\nregress y x, robust\nscatter y x\n";

const state = (page: Page) => page.evaluate(() => document.documentElement.dataset.engine);
const ready = (page: Page) => expect.poll(() => state(page), { timeout: 300_000 }).toBe("ready");
const paths = (page: Page) => page.evaluate(() => window.__dofile.state.files.value.map((f) => f.path).sort());

// every request the pages of this context make, their workers' included
function requests(context: BrowserContext) {
  const urls: string[] = [];
  context.on("request", (r) => urls.push(r.url()));
  return urls;
}
const elsewhere = (urls: string[], origin: string) =>
  urls.filter((u) => !u.startsWith(`${origin}/`) && !u.startsWith(`blob:${origin}/`) && !u.startsWith("data:"));
const pathOf = (url: string) => new URL(url).pathname; // a start file by its path on the server: its URL can carry a ?v=

// the sample through the page's run controller: a regression and a graph
async function runSample(page: Page) {
  const r = await page.evaluate(async (code) => {
    const r = await window.__dofile.run(code);
    return r && { rc: r.rc, images: r.images.length, graphs: window.__dofile.state.graphs.value.length };
  }, SAMPLE);
  expect(r?.rc).toBe(0);
  expect(r?.images).toBe(1);
  expect(r?.graphs).toBeGreaterThan(0);
}

test.describe(() => {
  test.use({ persisted: false }); // this test checks the browser's own persist() and persisted()
  test("the default start asks nothing of another origin; persist() is asked once; the download size is in the page; the zip is made in the page", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const urls = requests(context);
    page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
    await page.addInitScript(() => {
      // count the page's calls of storage.persist()
      const storage = navigator.storage,
        real = storage?.persist?.bind(storage);
      if (!real) return;
      window.__persistCalls = 0;
      storage.persist = () => {
        window.__persistCalls!++;
        return real();
      };
    });
    await page.goto("/?test");
    // a first visit: the prompt, with the size from the build; Download starts the engine
    const list: StartFiles = await (await request.get("/start-files.json")).json();
    const prompt = page.getByRole("dialog", { name: "Download the engine?" });
    await expect(prompt).toBeVisible();
    const size = `${Math.round(list.compressed / 1e6)} MB`;
    await expect(prompt).toContainText(`about ${size}`);
    await prompt.getByRole("button", { name: `Download ${size}` }).click();
    await ready(page);
    await expect(prompt).toBeHidden();
    await expect(
      page.locator("[data-editor]"),
      "the dialog closed by itself and the focus went to the editor",
    ).toBeFocused();
    await runSample(page);
    expect(
      urls.some((u) => u.endsWith("/pyodide/pyodide.asm.wasm")),
      "the runtime came from the page's own origin",
    ).toBe(true);
    expect(elsewhere(urls, new URL(baseURL!).origin)).toEqual([]);
    expect(await page.evaluate(() => window.__dofile.engine.cached()), "the start files are all in the Cache now").toBe(
      true,
    );

    // storage.persist() was asked, once, and the page has what persisted() says (null: the browser has no such API).
    // Firefox asks the user and leaves persist() unanswered: the page has the state all the same.
    const kept = await page.evaluate(async () => ({
      answer: window.__dofile.persisted(),
      calls: window.__persistCalls ?? null,
      now: navigator.storage?.persist ? await navigator.storage.persisted() : null,
    }));
    expect(kept.answer).toBe(kept.now);
    expect(kept.calls).toBe(kept.now === null ? null : 1);

    // the download size is written into the page by the build: the list's total, with no request for it
    expect(list.compressed).toBeGreaterThan(30e6);
    expect(await page.evaluate(() => window.__dofile.engineBytes)).toBe(list.compressed);
    expect(await page.locator('meta[name="dofile-engine-bytes"]').getAttribute("content")).toBe(
      String(list.compressed),
    );
    expect(list.buildId).toMatch(/^[0-9a-f]{64}$/);

    // "Download all (.zip)": from the store, no Python
    await page.evaluate(() => window.__dofile.store.write("notes.txt", new TextEncoder().encode("hello\n")));
    await expect.poll(() => paths(page)).toContain("notes.txt");
    const zip = await page.evaluate(async () => {
      const z = await window.__dofile.store.zip();
      return { name: z.name, type: z.type, size: z.size, head: [...new Uint8Array(await z.slice(0, 4).arrayBuffer())] };
    });
    expect(zip.name).toMatch(/^dofile-\d{4}-\d\d-\d\d\.zip$/);
    expect(zip.head).toEqual([0x50, 0x4b, 3, 4]);
    expect(zip.size).toBeGreaterThan(100);
  });
});

test("the page has no test hook unless the URL asks for it", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("dialog", { name: "Download the engine?" })
    .getByRole("button", { name: /^Download/ })
    .click();
  await ready(page);
  expect(await page.evaluate(() => typeof window.__dofile)).toBe("undefined");
});

test("download: the counts reach the total, abort keeps the finished files, and the start then uses the cached bytes, with no manifest.json", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const list: StartFiles = await (await request.get("/start-files.json")).json();
  const wanted = list.files.filter((f) => f.download).map((f) => `/${f.path}`);
  expect(wanted.length).toBeGreaterThanOrEqual(8); // the snapshot's five, the runtime's three, the brotli decoder
  expect(
    list.files.map((f) => f.path),
    "the snapshot's manifest is not a start file",
  ).not.toContain("snapshot/manifest.json");
  expect(list.snapshot.snapshot.name).toBe(
    list.files.find((f) => f.path.startsWith("snapshot/heap"))!.path.slice("snapshot/".length),
  );
  // The start takes the build's time (`built`) and its two big files from the list: a request for the manifest would fail,
  // and is looked for below.
  await context.route("**/snapshot/manifest.json", (route) => route.abort());
  const urls = requests(context);
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile && !window.__dofile.store.blocked); // the tab lock answered

  // files work with no engine at all, and are in the folder the engine later runs in
  await page.evaluate(() =>
    window.__dofile.store.write("early.do", new TextEncoder().encode('display "EARLY " 6*7\n')),
  );
  await expect.poll(() => paths(page)).toContain("early.do");
  expect(await page.evaluate(() => window.__dofile.engine.worker)).toBeNull();
  expect(await state(page)).toBe("none");

  // a first try, stopped a third of the way in
  const first = await page.evaluate(async () => {
    const stop = new AbortController(),
      seen: number[] = [];
    try {
      await window.__dofile.engine.download({
        signal: stop.signal,
        onProgress: (p) => {
          seen.push(p.received);
          if (p.received > p.total / 3) stop.abort();
        },
      });
      return { error: "not aborted", seen };
    } catch (e) {
      const kept: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) kept.push(r.url);
      return { error: (e as Error).name, seen, kept, worker: window.__dofile.engine.worker };
    }
  });
  expect(first.error).toBe("AbortError");
  expect(first.worker).toBeNull(); // no engine: the page is where "Not now" leaves it
  const kept = first.kept!.map(pathOf);
  expect(kept.length).toBeLessThan(wanted.length);
  for (const path of kept) expect(wanted).toContain(path);
  const asked = urls.length;

  // the second try: the finished files are not fetched again, and the counts end at the list's total
  const second = await page.evaluate(async () => {
    const seen: Progress[] = [];
    const done = await window.__dofile.engine.download({ onProgress: (p) => seen.push(p) });
    return {
      done,
      first: seen[0],
      last: seen.at(-1)!,
      steps: seen.length,
      rising: seen.every((p, i) => i === 0 || p.received > seen[i - 1].received),
    };
  });
  // with what `mount` needs of the list it has just checked, so that the start which follows fetches no list
  expect(second.done).toEqual({
    cached: true,
    received: list.compressed,
    total: list.compressed,
    build: { built: list.built, files: list.snapshot },
  });
  expect(second.last).toEqual({ received: list.compressed, total: list.compressed });
  expect(second.first.received).toBeGreaterThan(0); // the page's own files, and what the first try kept
  expect(second.rising).toBe(true);
  expect(second.steps).toBeGreaterThan(3); // WebKit hands a local file over in a few big pieces
  const again = urls.slice(asked).map(pathOf);
  for (const path of kept) expect(again, `${path} was kept by the first try`).not.toContain(path);

  // The start: from the cache. The files download() fetched are now unreachable, so a start that asked the network for
  // one of them would fail.
  await context.route(
    (url) => wanted.includes(url.pathname),
    (route) => route.abort(),
  );
  const before = urls.length;
  await page.evaluate(() => {
    window.__dofile.start();
  });
  await ready(page);
  expect(await page.evaluate(() => window.__dofile.engine.startup?.fetched)).toBe("read from cache");
  const during = urls.slice(before).map(pathOf);
  for (const path of wanted) expect(during, `${path} was fetched again by the start`).not.toContain(path);
  expect(urls.map(pathOf), "no request for the snapshot's manifest, at any point").not.toContain(
    "/snapshot/manifest.json",
  );
  expect(
    during.filter((path) => path === "/start-files.json"),
    "the download fetches the build's list, fresh, and the start that follows reuses it: one fetch",
  ).toHaveLength(1);
  expect(await page.evaluate(() => window.__dofile.drops()), "no event was dropped on the way").toEqual([]);
  expect(elsewhere(urls, origin)).toEqual([]);

  // and the engine it started works: native code, a graph, the file stored before it existed
  await runSample(page);
  expect(await page.evaluate(async () => (await window.__dofile.run("do early.do"))?.log)).toContain("EARLY 42");
});

// A cached file that is not what the manifest says (damaged, or cut short) must not stay: the start says so and drops it,
// the worker that could not start is ended, and the next start fetches the file again.
test("a damaged file in the cache fails the start once and is fetched again by the next one", async ({
  page,
  request,
}) => {
  const list: StartFiles = await (await request.get("/start-files.json")).json();
  const heap = list.files.find((f) => f.path.startsWith("snapshot/heap"))!.path;
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile && !window.__dofile.store.blocked); // the tab lock answered
  const cached = () =>
    page.evaluate(
      async ([path, built]) =>
        Boolean(
          await (await caches.open(`dofile-snapshot-${built}`)).match(new URL(path as string, location.href).href),
        ),
      [heap, list.built] as const,
    );
  await page.evaluate(
    async ([path, built]) => {
      await (await caches.open(`dofile-snapshot-${built}`)).put(
        new URL(path as string, location.href).href,
        new Response(new Uint8Array(10)),
      );
    },
    [heap, list.built] as const,
  );
  expect(await cached()).toBe(true);
  await page.evaluate(() => {
    window.__dofile.start();
  });
  // the cause is the detail, for a developer; the message is plain words for the visitor
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__dofile.state.engine.value;
          return s.s === "failed" ? s.detail : s.s;
        }),
      { timeout: 120_000 },
    )
    .toMatch(/snapshot: a file is 10 bytes, the manifest says \d+/);
  expect(await page.evaluate(() => window.__dofile.state.engine.value.message)).toBe(
    "Something went wrong while starting the engine. Try again, or reload the page.",
  );
  expect(await cached()).toBe(false);
  expect(
    await page.evaluate(() => window.__dofile.engine.worker),
    "the worker that could not start is ended",
  ).toBeNull();
  await page.evaluate(() => {
    window.__dofile.start();
  });
  await ready(page);
  expect(await cached()).toBe(true);
  await runSample(page);
});

// download() is the one writer of the Cache: a worker that finds its files missing there fetches them itself, and keeps
// nothing (a host's error page for a missing file, sent with status 200, could otherwise end up in the cache for good).
// A restart is that start: it fetches the build's list fresh and downloads nothing first. Here the Cache is emptied after
// a first start (as a browser may evict it), then Reset.
test("a restart whose files are no longer in the Cache works and writes nothing to it", async ({ page }) => {
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto("/?test=manual");
  await page.waitForFunction(() => window.__dofile && !window.__dofile.store.blocked); // the tab lock answered
  await page.evaluate(() => {
    window.__dofile.start();
  });
  await ready(page);
  await page.evaluate(async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    window.__dofile.reset();
  });
  expect(await state(page), "a reset goes to starting-list at once").toMatch(/^starting-(list|worker)$/);
  await ready(page);
  const kept = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return urls;
  });
  expect(kept).toEqual([]);
  expect(await page.evaluate(async () => (await window.__dofile.run('display "N=" 6*7'))?.log)).toContain("N=42");
  expect(await page.evaluate(() => window.__dofile.drops())).toEqual([]);
});

test("tab lock: a second tab gets no engine and writes nothing; taking over ends the first tab's engine", async ({
  page,
  context,
}) => {
  page.on("pageerror", (e) => console.log(`first tab error: ${e.message}`));
  await page.goto("/?test");
  await startEngine(page);
  await ready(page);
  await page.evaluate(() => window.__dofile.store.write("first-tab.do", new TextEncoder().encode("display 1\n")));
  await expect.poll(() => paths(page)).toEqual(["first-tab.do"]);

  // a second tab: blocked, with the take-over dialog
  const second = await context.newPage();
  second.on("pageerror", (e) => console.log(`second tab error: ${e.message}`));
  await second.goto("/?test");
  const otherTab = (p: Page) => p.getByRole("alertdialog", { name: "dofile is open in another tab" });
  await expect(otherTab(second)).toBeVisible();
  expect(await state(second)).toBe("other-tab-idle");
  // two buttons; "Close editor" has the first focus, so a stray Enter does not take over
  await expect(otherTab(second).getByRole("button")).toHaveText(["Close editor", "Use dofile in this tab"]);
  await expect(otherTab(second)).toContainText("The other tab keeps its data until you take over here.");
  await expect(otherTab(second).getByRole("button", { name: "Close editor" })).toBeFocused();
  expect(await second.evaluate(() => window.__dofile.engine.worker)).toBeNull(); // no engine
  await expect(second.locator(".toolbar").getByRole("button", { name: /^Run/ })).toHaveCount(0);
  const refused = await second.evaluate(() =>
    window.__dofile.store.write("second-tab.do", new Uint8Array([49])).then(
      () => "written",
      (e) => (e as Error).message,
    ),
  );
  expect(refused).toContain("open in another tab");
  // Esc does not dismiss it
  await second.keyboard.press("Escape");
  await expect(otherTab(second)).toBeVisible();
  // the first tab is untouched: its engine runs, and its files are as they were
  await runSample(page);
  expect((await page.evaluate(() => window.__dofile.store.list())).map((f) => f.path).sort()).toEqual(["first-tab.do"]);

  // "Use dofile in this tab": the second tab takes the lock; the first one ends its worker and shows the same dialog
  await otherTab(second).getByRole("button", { name: "Use dofile in this tab" }).click();
  await expect(otherTab(page)).toBeVisible({ timeout: 30_000 });
  expect(await state(page)).toBe("other-tab-idle");
  expect(await page.evaluate(() => window.__dofile.engine.worker)).toBeNull();
  await expect.poll(() => state(second)).not.toMatch(/^(other-tab|checking)/); // it has taken over and decided
  await startEngine(second); // the first tab filled the Cache, so it starts; a browser that kept nothing asks
  await ready(second);
  await expect(otherTab(second)).toBeHidden();
  await expect.poll(() => paths(second)).toEqual(["first-tab.do"]); // the same files
  await runSample(second);
  // the tab that lost the lock writes nothing now
  const late = await page.evaluate(() =>
    window.__dofile.store.write("late.do", new Uint8Array([49])).then(
      () => "written",
      (e) => (e as Error).message,
    ),
  );
  expect(late).toContain("open in another tab");
  expect((await second.evaluate(() => window.__dofile.store.list())).map((f) => f.path).sort()).toEqual([
    "first-tab.do",
  ]);

  // "Close editor" leaves for the landing page, and the landing page is what answers (e2e/landing.spec.ts too)
  const leaving = page.waitForRequest(
    (r) => r.isNavigationRequest() && new URL(r.url()).pathname.endsWith("/landing.html"),
  );
  await otherTab(page).getByRole("button", { name: "Close editor" }).click();
  await leaving;
  await expect(page.getByRole("heading", { level: 2, name: "Browsers that work" })).toBeVisible();
});
