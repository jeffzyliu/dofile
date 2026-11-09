// Contrast check of the design tokens (web/src/styles/tokens.css), WCAG 2.1.
// node docs/design/contrast.mjs [--matrix]   (or: cd web && npm run contrast)
// Reads each token as the browser resolves it (var() aliases included) in four modes: the system's light and dark,
// and [data-theme] forcing each against the other. Fails if a forced theme differs from the system one (the dark
// values are written twice in tokens.css), or if a pair below is under its minimum: 4.5 for text, 3 for the edges
// and fills a control needs to be seen (WCAG 1.4.11). The list is every foreground/background pair the components in
// docs/design/mockups/ui.css use; add a line when a component uses a new one. --matrix prints every token on every
// background too, for picking colors (most of those pairs are never used, so they aren't checked).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('playwright');
const tokensFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/src/styles/tokens.css');

const css = readFileSync(tokensFile, 'utf8');
const names = [...new Set([...css.matchAll(/(?<![\w-])--([\w-]+)\s*:/g)].map(m => m[1]))];
const TEXT = 4.5, UI = 3;
// [foreground, background, minimum, where]
const PAIRS = [
  ['ink', 'bg', TEXT, 'page text'],
  ['ink', 'surface', TEXT, 'pane text, editor, log'],
  ['ink', 'surface-2', TEXT, 'pane heads, status bar, Browse headers'],
  ['ink', 'accent-soft', TEXT, 'open file, selected line, picked row, menu hover, info banner'],
  ['ink', 'error-soft', TEXT, 'error line, error banner'],
  ['ink', 'warn-soft', TEXT, 'lint message, warning banner'],
  ['muted', 'bg', TEXT, 'secondary text on the page'],
  ['muted', 'surface', TEXT, 'line numbers, comments, notes, sizes'],
  ['muted', 'surface-2', TEXT, 'pane titles, status bar, key chips'],
  ['muted', 'accent-soft', TEXT, 'line numbers on a selected line, a size on the open file'],
  ['muted', 'error-soft', TEXT, 'a hint inside an error banner'],
  ['muted', 'warn-soft', TEXT, 'a hint inside a warning banner'],
  ['accent', 'bg', TEXT, 'links on the page'],
  ['accent', 'surface', TEXT, 'links, keywords, badges, the wordmark\'s accent'],
  ['accent', 'surface-2', TEXT, 'links in pane heads'],
  ['accent', 'accent-soft', TEXT, 'keywords and the running line number on a selected line'],
  ['on-accent', 'accent', TEXT, 'primary button'],
  ['error', 'surface', TEXT, 'error lines in the log, Break button, Delete in menus'],
  ['error', 'surface-2', TEXT, 'rc in the status bar'],
  ['error', 'error-soft', TEXT, 'the error line\'s number'],
  ['surface', 'error', TEXT, 'Break while running'],
  ['on-accent', 'accent-hover', TEXT, 'primary button, hovered'],
  ['surface', 'error-hover', TEXT, 'Break while running, hovered'],
  ['surface', 'ink', TEXT, 'toast'],
  ['warn', 'surface', TEXT, 'warnings in the log, the lint line number'],
  ['warn', 'warn-soft', TEXT, 'warning text in a warning banner'],
  ['ok', 'surface', TEXT, 'done stages, "picked" notes'],
  ['tok-string', 'surface', TEXT, 'strings'],
  ['tok-string', 'accent-soft', TEXT, 'strings on a selected line'],
  ['tok-macro', 'surface', TEXT, 'macros'],
  ['tok-macro', 'accent-soft', TEXT, 'macros on a selected line'],
  ['tok-number', 'surface', TEXT, 'numbers'],
  ['border-strong', 'bg', UI, 'control borders on the page'],
  ['border-strong', 'surface', UI, 'control and input borders'],
  ['border-strong', 'surface-2', UI, 'key chips, progress track edge'],
  ['accent', 'surface-2', UI, 'the active tab\'s underline, the progress fill on its track'],
  ['error', 'error-soft', UI, 'the error bar'],
  ['warn', 'warn-soft', UI, 'the lint and warning bar'],
  ['ok', 'surface-2', UI, 'the idle dot in the status bar'],
];

const modes = [
  { name: 'light', scheme: 'light', theme: null },
  { name: 'dark', scheme: 'dark', theme: null },
  { name: 'forced light', scheme: 'dark', theme: 'light', same: 'light' },
  { name: 'forced dark', scheme: 'light', theme: 'dark', same: 'dark' },
];

const hex = s => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  return m && [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
};
const lum = rgb => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await playwright.chromium.launch();
const values = {};
for (const m of modes) {
  const page = await browser.newPage({ colorScheme: m.scheme });
  // the CSS as text (a file:// sheet's rules can't be read from about:blank); colors only, so the font URLs don't matter
  await page.setContent(`<!doctype html><html${m.theme ? ` data-theme="${m.theme}"` : ''}><head></head><body></body></html>`);
  await page.addStyleTag({ content: css });
  values[m.name] = await page.evaluate(names => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map(n => [n, cs.getPropertyValue('--' + n).trim()]));
  }, names);
  await page.close();
}
await browser.close();

let failures = 0;
for (const m of modes.filter(m => m.same)) {
  const diff = Object.keys(values[m.same]).filter(k => values[m.same][k] !== values[m.name][k]);
  if (diff.length) {
    failures += diff.length;
    console.log(`FAIL ${m.name} differs from the system's ${m.same}: ${diff.map(k => `--${k} ${values[m.name][k]} vs ${values[m.same][k]}`).join(', ')}`);
  } else console.log(`ok   ${m.name} matches the system's ${m.same}`);
}

for (const name of ['light', 'dark']) {
  const v = values[name];
  console.log(`\n${name}`);
  let lowest = null;
  for (const [fg, bg, min, where] of PAIRS) {
    const a = hex(v[fg] || ''), b = hex(v[bg] || '');
    if (!a || !b) { failures++; console.log(`FAIL --${fg} on --${bg}: not a #rrggbb color (${v[fg]}, ${v[bg]})`); continue; }
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failures++;
    if (min === TEXT && (!lowest || r < lowest[0])) lowest = [r, fg, bg];
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} >= ${min}  ${`--${fg} on --${bg}`.padEnd(32)} ${where}`);
  }
  console.log(`lowest text pair: --${lowest[1]} on --${lowest[2]}, ${lowest[0].toFixed(2)}:1`);
  if (process.argv.includes('--matrix')) {
    const colors = Object.keys(v).filter(k => hex(v[k]));
    const bgs = ['bg', 'surface', 'surface-2', 'accent-soft', 'error-soft', 'warn-soft', 'accent', 'error'];
    console.log(`\n${''.padEnd(16)}${bgs.map(b => b.padStart(12)).join('')}`);
    for (const fg of colors) console.log(fg.padEnd(16) + bgs.map(bg => ratio(hex(v[fg]), hex(v[bg])).toFixed(2).padStart(12)).join(''));
  }
}
console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
