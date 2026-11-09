// Font check of the design pages: every font face loads, and no text asks for a weight we don't ship (the browser
// would fake it: a smeared bold or a substituted face). We load Plex Sans 400/600 and Plex Mono 400/700 only, no italics.
// node docs/design/fonts.mjs [page.html ...] [--browser chromium|firefox|webkit]   (or: cd web && npm run fonts)
// Default pages: the mockups and the component sheet. Exit code 1 on a face that failed or a text node in another weight.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('playwright');

const args = process.argv.slice(2);
const bi = args.indexOf('--browser');
const browserName = bi < 0 ? 'chromium' : args[bi + 1];
const here = path.dirname(new URL(import.meta.url).pathname);
const pages = args.filter(a => a.endsWith('.html')).map(p => path.resolve(p));
const targets = pages.length ? pages : ['mockups', 'system'].flatMap(d =>
  readdirSync(path.join(here, d)).filter(f => f.endsWith('.html')).map(f => path.join(here, d, f)));
const SHIPPED = { 'IBM Plex Sans': [400, 600], 'IBM Plex Mono': [400, 700] };

const browser = await playwright[browserName].launch();
let bad = 0;
for (const file of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const url = pathToFileURL(file);
  await page.goto(url.href);
  await page.waitForLoadState('networkidle');
  const found = await page.evaluate(async shipped => {
    await Promise.all([...document.fonts].map(f => f.load().catch(() => {})));
    const failed = [...document.fonts].filter(f => f.status !== 'loaded').map(f => `${f.family} ${f.weight}`);
    const wrong = new Map();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || el.closest('[aria-hidden=true] svg, script, style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.visually-hidden')) continue;
      const family = cs.fontFamily.split(',')[0].trim().replace(/["']/g, '');
      const weight = Number(cs.fontWeight);
      const ok = (shipped[family] || []).includes(weight) && cs.fontStyle === 'normal';
      if (!ok) {
        const sel = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
        const key = `${family} ${weight}${cs.fontStyle === 'normal' ? '' : ' ' + cs.fontStyle}: ${sel}`;
        if (!wrong.has(key)) wrong.set(key, n.textContent.trim().slice(0, 40));
      }
    }
    return { failed, wrong: [...wrong] };
  }, SHIPPED);
  const n = found.failed.length + found.wrong.length;
  bad += n;
  console.log(`${n ? 'FAIL' : 'ok  '} ${path.relative(here, file)}`);
  for (const f of found.failed) console.log(`  - face did not load: ${f}`);
  for (const [k, text] of found.wrong) console.log(`  - ${k}  "${text}"`);
  await page.close();
}
await browser.close();
console.log(`\n${bad} problem(s) in ${targets.length} page(s) (${browserName})`);
process.exit(bad ? 1 : 0);
