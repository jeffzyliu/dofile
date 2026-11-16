// Time until the web demo's engine is ready, normal boot vs memory snapshot, by network speed, for a first visit (new
// browser context: cold caches) and a return visit (a reload in the same context: warm). Chromium (default) or WebKit
// (--engine webkit: unthrottled only, the throttle is Chromium's DevTools protocol). The built editor (run
// `npm run build:local` after `npm run snapshot`), the network throttled through the DevTools protocol. Writes
// docs/img/startup-times.json, which docs/img/make-startup-times.mjs draws.
//
//   node scripts/measure-startup.mjs [--reps 3] [--nets unthrottled,100,30] [--modes normal,snapshot] [--out FILE]
//                                    [--first-run display,graph] [--during-import display,graph] [--import-delay-ms 100]
//                                    [--engine chromium|webkit]
//
// Each return visit then draws a graph (time from submit to the image in the page). With a lazy snapshot the cold visit
// waits for the graphics part to land before the reload, and the warm graph waits for the warm visit's "warmed" line.
// --first-run: `display 1` or a scatter submitted the moment the engine is ready, timed to the result and to its image,
// on the cold visit and on the return visit, which does not wait for "warmed": what a return visitor who runs at once
// gets.
// --during-import: a run sent on the return visit while the background import runs (a lazy build only): after the
// worker's "written" line plus --import-delay-ms. `warmedBeforeSubmit` true means the import was over already, and the
// row is not the measure. `writtenAtMs` is a rough guide (script clock). A graph here also imports, inside the run,
// what the background import had not reached.
//
// The page is served by a small static server that does what a real host does: brotli (quality 5) for text and wasm, long
// caching for the hashed assets, the isolation headers, and the snapshot's .bin files as they are (already compressed).
// `vite preview` does none of that and gives other numbers (docs/pyodide-snapshot.md). Pyodide's runtime and packages come
// from the real jsDelivr CDN, throttled with the rest, so the unthrottled rows depend on this machine's connection.
// The time is from the page's start (performance.now() = 0) to <html data-engine="ready">: an init script notes the
// moment the attribute changes. When the page asks first (the download prompt: nothing cached, and always with
// ?snapshot=0), the same script presses Download at once through the test hook's start().

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium, webkit } from "@playwright/test";
import { EDITOR_BASE, EDITOR_OUT } from "./urls.ts";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "..", EDITOR_OUT); // the editor's folder, served at the root of its own origin (EDITOR_BASE)
const out = arg("--out", join(here, "../../docs/img/startup-times.json"));
const reps = Number(arg("--reps", 3));
const modes = arg("--modes", "normal,snapshot").split(",");
const NETS = {
  unthrottled: { label: "Unthrottled", latency: 0, mbps: 0 },
  100: { label: "100 Mbps, 20 ms", latency: 20, mbps: 100 },
  30: { label: "30 Mbps, 50 ms", latency: 50, mbps: 30 },
};
const engine = arg("--engine", "chromium");
if (engine !== "chromium" && engine !== "webkit") throw new Error(`--engine ${engine}: chromium or webkit`);
const importDelayMs = Number(arg("--import-delay-ms", 100));
const nets = arg("--nets", "unthrottled,100,30")
  .split(",")
  .map((k) => ({ key: k, ...NETS[k] }));
if (engine === "webkit" && nets.some((n) => n.mbps))
  throw new Error("--engine webkit: --nets unthrottled only (the throttle is Chromium's)");
if (!existsSync(join(dist, EDITOR_BASE, "index.html")))
  throw new Error(`no web/${EDITOR_OUT}: run \`npm run build:local\` (after \`npm run snapshot\`)`);

// ---- the host ----------------------------------------------------------------------------------------------------------
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".whl": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".css": "text/css",
};
const COMPRESS = new Set([".html", ".js", ".mjs", ".json", ".wasm", ".svg", ".css"]); // a host does not recompress .bin or .whl
const memo = new Map(); // path -> { raw, br }
const body = (path) => {
  if (!memo.has(path)) {
    const raw = readFileSync(path);
    memo.set(path, {
      raw,
      br: COMPRESS.has(extname(path))
        ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
        : null,
    });
  }
  return memo.get(path);
};
const served = { bytes: 0 };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let path = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!path.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  const ext = extname(path);
  const { raw, br } = body(path);
  const useBr = br && /\bbr\b/.test(req.headers["accept-encoding"] ?? "");
  const payload = useBr ? br : raw;
  const hashed = url.pathname.includes("/assets/");
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": payload.length,
    ...(useBr ? { "Content-Encoding": "br" } : {}),
    Vary: "Accept-Encoding",
    "Cache-Control": hashed
      ? "public, max-age=31536000, immutable"
      : url.pathname.endsWith("start-files.json")
        ? "no-cache"
        : "public, max-age=3600",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  served.bytes += payload.length;
  res.end(payload);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- the measurements --------------------------------------------------------------------------------------------------------
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const profiles = []; // WebKit: a profile folder per visit, removed at the end
// In the page, before its own scripts: the moment <html data-engine> becomes ready, failed or failed-twice; Download pressed
// at once when the page asks
const watchEngine = () => {
  new MutationObserver(() => {
    const s = document.documentElement.dataset.engine;
    if (s === "asking") window.__dofile.start();
    if ((s === "ready" || s === "failed" || s === "failed-twice") && !window.__engineAt)
      window.__engineAt = { s, at: performance.now() };
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-engine"] }); // <html> may not exist yet
};
const readyIn = async (page) => {
  await page.waitForFunction(() => window.__engineAt, null, { timeout: 300_000 });
  const { s, at } = await page.evaluate(() => window.__engineAt);
  if (s !== "ready") {
    const why = await page.evaluate(() => window.__dofile?.state.engine.value.message ?? "");
    throw new Error(`the engine did not start (${s}): ${why}`);
  }
  return Number((at / 1000).toFixed(2));
};

// With a lazy snapshot the cold visit waits for the "graphics part: landed" line before the reload (a reload at ready
// would kill that fetch, and the warm visit would download it again).
const startList = JSON.parse(readFileSync(join(dist, EDITOR_BASE, "start-files.json"), "utf8"));
const lazy = Boolean(startList.snapshot?.graphics);
const GRAPH = "clear\nset obs 10\ngen x = _n\nscatter x x";
const CODES = { display: "display 1", graph: GRAPH };
// a run through the test hook: resolves with when its result came back and when an image of it showed in the page
const runAndTime = (code) =>
  new Promise((done) => {
    const shown = () =>
      [...document.querySelectorAll("img")].filter(
        (i) => /^(data:image\/png|blob:)/.test(i.src) && i.complete && i.naturalWidth > 0,
      ).length;
    const before = shown(),
      t0 = performance.now();
    window.__dofile.run(code).then((r) => {
      const resultAt = performance.now();
      const n = r?.images?.length ?? 0;
      const out = { t0, resultAt, rc: r?.rc, images: n, newGraphs: r?.new_graphs ?? 0 };
      if (!n) return done(out);
      const poll = () => {
        if (shown() > before) done({ ...out, imageAt: performance.now() });
        else if (performance.now() - resultAt > 30_000) done(out);
        else requestAnimationFrame(poll);
      };
      poll();
    });
  });
// In the page: run `code` the moment the engine is ready
const runAtReady = (code) => {
  new MutationObserver((_, obs) => {
    if (document.documentElement.dataset.engine !== "ready" || window.__runStarted) return;
    window.__runStarted = true;
    obs.disconnect();
    window.__runAndTime(code).then((r) => {
      window.__firstRun = r;
    });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-engine"] });
};
const sec = (ms) => Number((ms / 1000).toFixed(2));

// `job`: { firstRun } (a run at ready), { during } (a run during the return visit's import), or none
async function visit(mode, net, job = {}) {
  const { firstRun, during } = job;
  let ctx;
  if (engine === "webkit") {
    const dir = mkdtempSync(join(tmpdir(), "measure-startup-"));
    profiles.push(dir);
    ctx = await webkit.launchPersistentContext(dir); // Playwright's in-memory WebKit context drops the Cache API on a reload
  } else ctx = await browser.newContext(); // a new context: nothing cached
  await ctx.addInitScript(watchEngine);
  await ctx.addInitScript(`window.__runAndTime = ${runAndTime.toString()};`);
  if (firstRun) await ctx.addInitScript(runAtReady, CODES[firstRun]);
  // the graphics part's request: to see that the throttle reaches the worker's fetch
  const partRequests = [];
  ctx.on("requestfinished", async (req) => {
    if (!req.url().includes("graphics.brotli.bin")) return;
    const sizes = await req.sizes().catch(() => null);
    const t = req.timing();
    partRequests.push({
      bytes: sizes?.responseBodySize ?? null,
      requestToEndMs: t.responseEnd >= 0 ? Math.round(t.responseEnd) : null,
      firstByteMs: t.responseStart >= 0 ? Math.round(t.responseStart) : null,
      fromServiceWorkerOrCache: (await req.response())?.fromServiceWorker() ?? null,
    });
  });
  const page = await ctx.newPage();
  if (net.mbps) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.mbps * 125_000,
      uploadThroughput: net.mbps * 125_000,
    });
  }
  const notes = []; // the snapshot start's own breakdown ("download 12.0s, decompress 0.6s, ..."), from the worker's console
  const partNotes = []; // a lazy build's "[dofile] graphics part: landed|written|warmed ..." lines
  page.on("console", (m) => {
    if (m.text().includes("[dofile] snapshot start")) notes.push(m.text().replace("[dofile] snapshot start: ", ""));
    if (m.text().includes("[dofile] graphics part")) partNotes.push(m.text().replace("[dofile] ", ""));
  });
  // waits for a "graphics part: <what>" line at or after index `from` of partNotes
  const partLine = async (what, from = 0, limitMs = 300_000) => {
    const t = Date.now();
    while (!partNotes.slice(from).some((n) => n.startsWith(`graphics part: ${what}`))) {
      if (Date.now() - t > limitMs) throw new Error(`no "graphics part: ${what}" line in ${limitMs / 1000} s`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  };
  const url = `${base}${EDITOR_BASE}?test${mode === "snapshot" ? "" : "&snapshot=0"}`; // the snapshot is the page's default; ?test: its state, for a failure's message
  served.bytes = 0;
  await page.goto(url);
  const cold = await readyIn(page);
  const coldBytes = served.bytes; // at ready: a lazy build's part may not be in yet
  if (during) {
    if (!lazy) throw new Error("--during-import needs a lazy build (a graphics part in start-files.json)");
    await partLine("landed");
    const coldParts = partNotes.length;
    await page.reload();
    const warm = await readyIn(page);
    const t = Date.now();
    await partLine("written", coldParts); // the import's idle steps follow
    const writtenAtMs = Date.now() - t;
    await new Promise((ok) => setTimeout(ok, importDelayMs));
    const warmedBeforeSubmit = partNotes.slice(coldParts).some((n) => n.startsWith("graphics part: warmed"));
    const x = await page.evaluate((code) => window.__runAndTime(code), CODES[during]);
    await partLine("warmed", coldParts, 30_000).catch(() => {}); // only for its notes
    await ctx.close();
    return {
      ready: warm,
      writtenAtMs,
      importDelayMs,
      warmedBeforeSubmit,
      result: sec(x.resultAt - x.t0),
      image: x.imageAt ? sec(x.imageAt - x.t0) : null,
      rc: x.rc,
      images: x.images,
      coldPartNotes: partNotes.slice(0, coldParts),
      warmPartNotes: partNotes.slice(coldParts),
      partRequests,
    };
  }
  if (firstRun) {
    // the run submitted at ready (init script)
    await page.waitForFunction(() => window.__firstRun, null, { timeout: 300_000 });
    const r = await page.evaluate(() => window.__firstRun);
    if (lazy) await partLine("landed");
    const coldParts = partNotes.length;
    // the return visit: the init script submits the same run again
    await page.reload();
    const warm = await readyIn(page);
    await page.waitForFunction(() => window.__firstRun, null, { timeout: 300_000 });
    const w = await page.evaluate(() => window.__firstRun);
    if (lazy) await partLine("warmed", coldParts); // only for its notes: the run above did not wait for it
    await ctx.close();
    const timed = (x, ready) => ({
      ready,
      result: sec(x.resultAt),
      image: x.imageAt ? sec(x.imageAt) : null,
      submittedAt: sec(x.t0),
      rc: x.rc,
      images: x.images,
    });
    return {
      ...timed(r, cold),
      partNote: partNotes[0],
      coldPartNotes: partNotes.slice(0, coldParts),
      partRequests,
      warm: timed(w, warm),
      warmPartNotes: partNotes.slice(coldParts),
    };
  }
  if (lazy) await partLine("landed");
  const coldParts = partNotes.length;
  await page.reload(); // the same context: its HTTP cache and Cache API are kept
  const warm = await readyIn(page);
  // the return visit's first graph: after the part is written and imported (lazy), or at ready
  if (lazy) await partLine("warmed", coldParts);
  const g = await page.evaluate((code) => window.__runAndTime(code), GRAPH);
  await ctx.close();
  return {
    cold,
    warm,
    coldBytesFromHost: coldBytes,
    coldNote: notes[0],
    warmNote: notes[1],
    coldPartNotes: partNotes.slice(0, coldParts),
    warmPartNotes: partNotes.slice(coldParts),
    partRequests,
    warmGraph: {
      rc: g.rc,
      images: g.images,
      result: sec(g.resultAt - g.t0),
      image: g.imageAt ? sec(g.imageAt - g.t0) : null,
    },
  };
}

const firstRuns = arg("--first-run", "").split(",").filter(Boolean);
const duringRuns = arg("--during-import", "").split(",").filter(Boolean);
const jobs = [
  ...firstRuns.map((f) => ({ key: f, firstRun: f })),
  ...duringRuns.map((f) => ({ key: `import-${f}`, during: f })),
];
const results = Object.fromEntries(
  modes.map((m) => [
    m,
    Object.fromEntries(
      nets.map((n) => [
        n.key,
        jobs.length
          ? Object.fromEntries(jobs.map((j) => [j.key, []]))
          : { cold: [], warm: [], coldBytesFromHost: 0, coldNotes: [], warmNotes: [], visits: [] },
      ]),
    ),
  ]),
);
for (let rep = 1; rep <= reps; rep++) {
  for (const net of nets) {
    for (const mode of modes) {
      if (jobs.length) {
        for (const job of jobs) {
          const r = await visit(mode, net, job);
          results[mode][net.key][job.key].push(r);
          if (job.during) {
            console.log(
              `rep ${rep}  ${net.label.padEnd(16)} ${mode.padEnd(8)} ${job.key.padEnd(14)} ready ${r.ready.toFixed(2)} s  sent ${r.importDelayMs} ms after "written" (warmed already: ${r.warmedBeforeSubmit})  result ${r.result.toFixed(2)} s  image ${r.image ?? "-"}  rc ${r.rc} images ${r.images} | ${r.warmPartNotes.join("; ")}`,
            );
            continue;
          }
          console.log(
            `rep ${rep}  ${net.label.padEnd(16)} ${mode.padEnd(8)} ${job.key.padEnd(7)} cold: ready ${r.ready.toFixed(2)} s  result ${r.result.toFixed(2)} s  image ${r.image ?? "-"}  rc ${r.rc} images ${r.images} | warm: ready ${r.warm.ready.toFixed(2)} s  result ${r.warm.result.toFixed(2)} s  image ${r.warm.image ?? "-"}  rc ${r.warm.rc} images ${r.warm.images}  part ${(r.coldPartNotes ?? []).join("; ")} | ${(r.warmPartNotes ?? []).join("; ")}  req ${JSON.stringify(r.partRequests)}`,
          );
        }
        continue;
      }
      const r = await visit(mode, net);
      const cell = results[mode][net.key];
      cell.cold.push(r.cold);
      cell.warm.push(r.warm);
      cell.coldBytesFromHost = r.coldBytesFromHost;
      if (r.coldNote) {
        cell.coldNotes.push(r.coldNote);
        cell.warmNotes.push(r.warmNote);
      }
      cell.visits.push({
        coldPartNotes: r.coldPartNotes,
        warmPartNotes: r.warmPartNotes,
        partRequests: r.partRequests,
        warmGraph: r.warmGraph,
      });
      console.log(
        `rep ${rep}  ${net.label.padEnd(16)} ${mode.padEnd(8)} cold ${r.cold.toFixed(2)} s  warm ${r.warm.toFixed(2)} s  (host sent ${(r.coldBytesFromHost / 1e6).toFixed(1)} MB on the cold visit)  warm graph ${JSON.stringify(r.warmGraph)}  part ${(r.coldPartNotes ?? []).join("; ")} | ${(r.warmPartNotes ?? []).join("; ")}  req ${JSON.stringify(r.partRequests)}`,
      );
    }
  }
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
for (const m of modes)
  for (const n of nets) {
    const c = results[m][n.key];
    if (jobs.length) continue;
    c.medianCold = median(c.cold);
    c.medianWarm = median(c.warm);
  }
const list = startList; // the snapshot's manifest.json is not deployed
writeFileSync(
  out,
  JSON.stringify(
    {
      measured: new Date().toISOString().slice(0, 10),
      browser: `${engine === "webkit" ? "WebKit" : "Chromium"} ${browser.version()}`,
      reps,
      networks: nets.map((n) => ({ key: n.key, label: n.label })),
      snapshot: { built: list.built, compressedMB: Object.values(list.snapshot).reduce((s, f) => s + f.size, 0) / 1e6 },
      results,
    },
    null,
    1,
  ),
);
console.log(`written to ${out}`);
await browser.close();
for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
server.close();
