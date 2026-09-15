#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';

if (process.argv.length !== 4) {
  console.error('Usage: node capture-report.mjs INPUT.html OUTPUT.png');
  process.exit(1);
}
const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
if (input === output) throw new Error('Input and output must differ');
await access(input);
const require = createRequire(resolve(process.cwd(), 'package.json'));
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  throw new Error('Playwright unavailable. Use an existing browser screenshot tool, or set PLAYWRIGHT_MODULE to an installed Playwright module.');
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
  await page.route(/^https?:\/\//, route => route.abort());
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth ||
      [...document.querySelectorAll('.table-wrap')].some(el => el.scrollWidth > el.clientWidth),
    height: document.documentElement.scrollHeight,
  }));
  if (layout.overflow) throw new Error('Horizontal overflow detected; shorten or restructure the content before capture.');
  await page.screenshot({ path: output, fullPage: true, type: 'png' });
  console.log(`Captured ${output} (${layout.width} x ${layout.height})`);
} finally {
  await browser.close();
}
