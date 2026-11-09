// Screenshot a design page (moodboard, wireframe, mockup) with Playwright from web/node_modules.
// node docs/design/shot.mjs <page.html> <out.png> [--width 1440] [--height 900] [--dark] [--full]
//   [--query norefs] [--browser chromium|firefox|webkit]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('playwright');

const [page_, out, ...rest] = process.argv.slice(2);
if (!page_ || !out) {
  console.error('usage: node docs/design/shot.mjs <page.html> <out.png> [--width N] [--height N] [--dark] [--full] [--query q] [--browser b]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? fallback : rest[i + 1];
};
const url = pathToFileURL(path.resolve(page_));
const query = opt('query', '');
if (query) url.search = query;

const browser = await playwright[opt('browser', 'chromium')].launch();
const page = await browser.newPage({
  viewport: { width: Number(opt('width', 1440)), height: Number(opt('height', 900)) },
  colorScheme: rest.includes('--dark') ? 'dark' : 'light',
});
await page.goto(url.href);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, fullPage: rest.includes('--full') });
await browser.close();
console.log(out);
