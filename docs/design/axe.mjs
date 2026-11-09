// Accessibility check of the design pages with axe-core (@axe-core/playwright, from web/node_modules).
// node docs/design/axe.mjs [page.html ...] [--browser chromium|firefox|webkit] [--json out.json]
// Default pages: the mockups. Each page runs light and dark, at 1440 x 900 and 390 x 844 (and with ?running where
// the mockup has that state). Exit code 1 if any violation. Rules: WCAG 2.0/2.1/2.2 A and AA, plus axe best practices.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const playwright = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const flagValues = new Set(['--browser', '--json'].flatMap(f => (args.includes(f) ? [args[args.indexOf(f) + 1]] : [])));
const pages = args.filter(a => a.endsWith('.html') && !flagValues.has(a));
const dir = new URL('./mockups/', import.meta.url);
const targets = pages.length ? pages.map(p => path.resolve(p))
  : readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.resolve(dir.pathname, f));

const sizes = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const schemes = ['light', 'dark'];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const browser = await playwright[opt('browser', 'chromium')].launch();
const report = [];
let violations = 0;
for (const file of targets) {
  const queries = ['', ...(file.endsWith('editor.html') || file.endsWith('phone-log.html') ? ['running'] : [])];
  for (const query of queries) for (const size of sizes) for (const colorScheme of schemes) {
    const label = `${path.basename(file)}${query ? '?' + query : ''} ${size.name} ${colorScheme}`;
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme });
    const page = await ctx.newPage();
    const url = pathToFileURL(file);
    if (query) url.search = query;
    await page.goto(url.href);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    const { violations: v } = await new AxeBuilder({ page }).withTags(tags).analyze();
    violations += v.length;
    console.log(`${v.length ? 'FAIL' : 'ok  '} ${label}${v.length ? `: ${v.length} rule(s)` : ''}`);
    for (const r of v) {
      console.log(`  - ${r.id} (${r.impact}): ${r.help}, ${r.nodes.length} node(s)`);
      for (const n of r.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}\n        ${(n.failureSummary || '').split('\n').slice(0, 3).join(' | ')}`);
    }
    report.push({ label, violations: v.map(r => ({ id: r.id, impact: r.impact, help: r.help, nodes: r.nodes.map(n => ({ target: n.target, html: n.html, summary: n.failureSummary })) })) });
    await ctx.close();
  }
}
await browser.close();
if (opt('json', '')) writeFileSync(opt('json'), JSON.stringify(report, null, 2));
console.log(`\n${violations} violation(s) in ${report.length} runs`);
process.exit(violations ? 1 : 0);
