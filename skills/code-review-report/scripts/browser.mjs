import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { checkDocument, checkLayout } from './browser-checks.mjs';

export async function launchBrowser() {
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
  catch { throw new Error('Playwright unavailable. Use an existing browser tool or set PLAYWRIGHT_MODULE to its installed module entry; do not silently install it.'); }
  return chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
}

export async function inspectReport(browser, html, { screenshot = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
  const blocked = [];
  try {
    const page = await context.newPage();
    await context.route('**/*', async route => {
      blocked.push(route.request().url());
      await route.abort();
    });
    // DOMParser is inert; audit before loading. In-memory content avoids file://,
    // navigation permissions, listening sockets, and network access entirely.
    const errors = await page.evaluate(checkDocument, html);
    if (errors.length) return { errors, warnings: [], blocked };
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(checkLayout);
    result.blocked = blocked;
    if (blocked.length) result.errors.push('Report attempted an external resource request/navigation');
    if (screenshot && !result.errors.length) {
      // Do not inflate short reports to the initial 1000px viewport. Keep authored padding.
      const area = result.contentHeight < 1000 ? { clip: { x: 0, y: 0, width: 1100, height: result.contentHeight } } : { fullPage: true };
      result.png = await page.screenshot({ ...area, type: 'png', animations: 'disabled' });
    }
    return result;
  } finally { await context.close(); }
}
