// Keyboard check of the design pages: press Tab through each page and fail if focus lands on something a sighted
// user can't see (clipped to 1 px, covered, or off the page). axe checks markup; it can't see where focus goes.
// node docs/design/tabwalk.mjs [page.html ...] [--verbose]   (or: cd web && npm run tabwalk)
// Default pages: the landing page (1440 and 390 wide), the editor (and ?running) and the phone Log tab.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('playwright');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dir = path.dirname(new URL(import.meta.url).pathname);
const given = args.filter(a => a.endsWith('.html')).map(p => [path.resolve(p), '', 1440, 900]);
const runs = given.length ? given : [
  ['mockups/landing.html', '', 1440, 900], ['mockups/landing.html', '', 390, 844],
  ['mockups/editor.html', '', 1440, 900], ['mockups/editor.html', 'running', 1440, 900],
  ['mockups/phone-log.html', '', 390, 844], ['mockups/phone-log.html', 'running', 390, 844],
].map(([f, ...rest]) => [path.join(dir, f), ...rest]);

const browser = await playwright.chromium.launch();
let bad = 0;
for (const [file, query, width, height] of runs) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const url = pathToFileURL(file);
  if (query) url.search = query;
  await page.goto(url.href);
  console.log(`== ${path.basename(file)}${query ? '?' + query : ''} ${width}`);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const b = e.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      // visible: a real box, and the element (or something inside it) is what's drawn at its centre
      const visible = b.width >= 4 && b.height >= 4 && !!hit && (hit === e || e.contains(hit));
      const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return { key: e.outerHTML.slice(0, 200), tag: e.tagName.toLowerCase(), name, w: Math.round(b.width), h: Math.round(b.height), visible };
    });
    if (!f || seen.has(f.key)) break;   // back to the start
    seen.add(f.key);
    if (!f.visible) bad++;
    if (verbose || !f.visible) console.log(`  ${f.visible ? 'ok  ' : 'HIDDEN'} ${f.tag} "${f.name}" ${f.w}x${f.h}`);
  }
  console.log(`  ${seen.size} stops`);
}
await browser.close();
console.log(`\n${bad} focus stop(s) not visible`);
process.exit(bad ? 1 : 0);
