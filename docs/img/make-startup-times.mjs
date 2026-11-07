// Draws startup-times.svg: time until the web demo's engine is ready, normal boot vs memory snapshot, by network speed,
// for a first visit (cold cache) and a return visit (warm cache). Run: node docs/img/make-startup-times.mjs
// The numbers are the measurements in docs/pyodide-snapshot.md (Chromium, brotli-served, CDP-throttled); edit them there
// and here together. Colors: the dataviz reference palette (slots 1-2, validated for light and dark), light/dark by
// prefers-color-scheme, on a surface of the chart's own so it stays legible on any page background.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const networks = ["Unthrottled", "100 Mbps", "30 Mbps"];
const panels = [
  { title: "First visit (cold cache)", normal: [6.0, 7.2, 14.1], snapshot: [1.7, 5.8, 16.0] },
  { title: "Return visit (warm cache)", normal: [5.3, 5.5, 9.4], snapshot: [1.3, 1.3, 1.3] },
];
const series = [{ key: "normal", name: "Normal boot (install and import)", cls: "a" }, { key: "snapshot", name: "From the snapshot", cls: "b" }];

const W = 900, H = 430, M = { left: 56, right: 24, top: 118, bottom: 56 };
const gapBetweenPanels = 56;
const panelW = (W - M.left - M.right - gapBetweenPanels) / 2, plotH = H - M.top - M.bottom;
const YMAX = 20, y = v => M.top + plotH - (v / YMAX) * plotH;
const BAR = 24, GAP = 2, R = 4;   // bar thickness cap, surface gap between touching bars, rounded data-end

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// a bar from the baseline up, 4px rounded at the top only
const bar = (x, v) => {
  const top = y(v), base = y(0), r = Math.min(R, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + BAR - r}Q${x + BAR},${top} ${x + BAR},${top + r}V${base}Z`;
};

let body = "";
panels.forEach((p, pi) => {
  const x0 = M.left + pi * (panelW + gapBetweenPanels);
  body += `<text class="ink2" x="${x0}" y="${M.top - 22}" font-size="14" font-weight="600">${esc(p.title)}</text>`;
  for (let t = 0; t <= YMAX; t += 5) {
    body += `<line class="${t ? "grid" : "axis"}" x1="${x0}" x2="${x0 + panelW}" y1="${y(t)}" y2="${y(t)}"/>`;
    body += `<text class="muted" x="${x0 - 8}" y="${y(t) + 4}" font-size="12" text-anchor="end">${t}</text>`;
  }
  networks.forEach((n, ni) => {
    const band = panelW / networks.length, cx = x0 + band * ni + band / 2, left = cx - BAR - GAP / 2;
    series.forEach((s, si) => {
      const v = p[s.key][ni], x = left + si * (BAR + GAP);
      body += `<path class="${s.cls}" d="${bar(x, v)}"><title>${esc(`${n}, ${p.title.toLowerCase()}: ${s.name} ${v} s`)}</title></path>`;
      if (s.key === "snapshot") body += `<text class="ink" x="${x + BAR / 2}" y="${y(v) - 7}" font-size="13" font-weight="600" text-anchor="middle">${v} s</text>`;
    });
    body += `<text class="ink2" x="${cx}" y="${y(0) + 22}" font-size="13" text-anchor="middle">${n}</text>`;
  });
});

const legendY = 74;
const legend = series.map((s, i) => {
  const x = M.left + i * 290;
  return `<rect class="${s.cls}" x="${x}" y="${legendY - 10}" width="12" height="12" rx="2"/><text class="ink2" x="${x + 20}" y="${legendY}" font-size="13">${esc(s.name)}</text>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<title id="t">Time until the engine is ready: normal boot vs memory snapshot</title>
<desc id="d">Grouped bars in seconds, Chromium. First visit: normal boot 6.0, 7.2 and 14.1 s at unthrottled, 100 Mbps and 30 Mbps; snapshot 1.7, 5.8 and 16.0 s. Return visit: normal boot 5.3, 5.5 and 9.4 s; snapshot 1.3, 1.3 and 1.3 s.</desc>
<style>
  :root { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --a:#2a78d6; --b:#eb6834; }
  @media (prefers-color-scheme: dark) { :root { --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --a:#3987e5; --b:#d95926; } }
  .surface { fill: var(--surface); } .ink { fill: var(--ink); } .ink2 { fill: var(--ink2); } .muted { fill: var(--muted); }
  .grid { stroke: var(--grid); stroke-width: 1; } .axis { stroke: var(--axis); stroke-width: 1; }
  path.a, rect.a { fill: var(--a); } path.b, rect.b { fill: var(--b); }
</style>
<rect class="surface" width="${W}" height="${H}" rx="8"/>
<text class="ink" x="${M.left}" y="34" font-size="18" font-weight="600">Time until the engine is ready, seconds (lower is better)</text>
<text class="ink2" x="${M.left}" y="54" font-size="13">Web demo in Chromium; the snapshot is 46.5 MB (brotli, kept compressed in the browser), the normal boot about 25 MB of wheels</text>
${legend}
${body}
</svg>
`;
writeFileSync(fileURLToPath(new URL("startup-times.svg", import.meta.url)), svg);
console.log("wrote startup-times.svg");
