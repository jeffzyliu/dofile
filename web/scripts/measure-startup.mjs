// Time until the web demo's engine is ready, normal boot vs memory snapshot, by network speed, for a first visit (new browser
// context: cold caches) and a return visit (a reload in the same context: warm). Chromium, the built page (web/dist: run
// `npm run build` after `npm run snapshot`), the network throttled through the DevTools protocol. Writes docs/img/startup-times.json,
// which docs/img/make-startup-times.mjs draws.
//
//   node scripts/measure-startup.mjs [--reps 3] [--nets unthrottled,100,30] [--modes normal,snapshot] [--out FILE]
//
// The page is served by a small static server that does what a real host does: brotli (quality 5) for text and wasm, long
// caching for the hashed assets, the isolation headers, and the snapshot's .bin files as they are (already compressed).
// `vite preview` does none of that and gives other numbers (docs/pyodide-snapshot.md). Pyodide's runtime and packages come from
// the real jsDelivr CDN, throttled with the rest, so the unthrottled rows depend on this machine's connection.
// The time is from the page's start (performance.now() = 0) to <html data-engine="ready">, as in the docs' table: an init
// script notes the moment the attribute changes. When the page asks first (the download prompt: nothing cached, and always with
// ?snapshot=0), the same script presses Download at once through the test hook's start().

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "../dist");
const out = arg("--out", join(here, "../../docs/img/startup-times.json"));
const reps = Number(arg("--reps", 3));
const modes = arg("--modes", "normal,snapshot").split(",");
const NETS = {
  unthrottled: { label: "Unthrottled", latency: 0, mbps: 0 },
  100: { label: "100 Mbps, 20 ms", latency: 20, mbps: 100 },
  30: { label: "30 Mbps, 50 ms", latency: 50, mbps: 30 },
};
const nets = arg("--nets", "unthrottled,100,30")
  .split(",")
  .map((k) => ({ key: k, ...NETS[k] }));
if (!existsSync(join(dist, "index.html")))
  throw new Error("no web/dist: run `npm run build` (after `npm run snapshot`)");

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
  const hashed = url.pathname.startsWith("/assets/");
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
const browser = await chromium.launch();
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

async function visit(mode, net) {
  const ctx = await browser.newContext(); // a new context: nothing cached
  await ctx.addInitScript(watchEngine);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (net.mbps)
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.mbps * 125_000,
      uploadThroughput: net.mbps * 125_000,
    });
  const notes = []; // the snapshot start's own breakdown ("download 12.0s, decompress 0.6s, ..."), from the worker's console
  page.on("console", (m) => {
    if (m.text().includes("[dofile] snapshot start")) notes.push(m.text().replace("[dofile] snapshot start: ", ""));
  });
  const url = `${base}/?test${mode === "snapshot" ? "" : "&snapshot=0"}`; // the snapshot is the page's default; ?test: its state, for a failure's message
  served.bytes = 0;
  await page.goto(url);
  const cold = await readyIn(page);
  const coldBytes = served.bytes;
  await page.reload(); // the same context: its HTTP cache and Cache API are kept
  const warm = await readyIn(page);
  await ctx.close();
  return { cold, warm, coldBytesFromHost: coldBytes, coldNote: notes[0], warmNote: notes[1] };
}

const results = Object.fromEntries(
  modes.map((m) => [
    m,
    Object.fromEntries(
      nets.map((n) => [n.key, { cold: [], warm: [], coldBytesFromHost: 0, coldNotes: [], warmNotes: [] }]),
    ),
  ]),
);
for (let rep = 1; rep <= reps; rep++) {
  for (const net of nets) {
    for (const mode of modes) {
      const r = await visit(mode, net);
      const cell = results[mode][net.key];
      cell.cold.push(r.cold);
      cell.warm.push(r.warm);
      cell.coldBytesFromHost = r.coldBytesFromHost;
      if (r.coldNote) {
        cell.coldNotes.push(r.coldNote);
        cell.warmNotes.push(r.warmNote);
      }
      console.log(
        `rep ${rep}  ${net.label.padEnd(16)} ${mode.padEnd(8)} cold ${r.cold.toFixed(1)} s  warm ${r.warm.toFixed(1)} s  (host sent ${(r.coldBytesFromHost / 1e6).toFixed(1)} MB on the cold visit)`,
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
    c.medianCold = median(c.cold);
    c.medianWarm = median(c.warm);
  }
const list = JSON.parse(readFileSync(join(dist, "start-files.json"), "utf8")); // the snapshot's manifest.json is not deployed
writeFileSync(
  out,
  JSON.stringify(
    {
      measured: new Date().toISOString().slice(0, 10),
      browser: `Chromium ${browser.version()}`,
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
server.close();
