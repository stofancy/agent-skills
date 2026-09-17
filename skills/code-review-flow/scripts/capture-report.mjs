#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { distinctPaths, atomicWrite } from './report-core.mjs';
import { launchBrowser, inspectReport } from './browser.mjs';

let browser;
try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: node capture-report.mjs INPUT.html OUTPUT.png | --check');
  const checkOnly = output === '--check';
  await distinctPaths([input, checkOnly ? null : output]);
  const html = await readFile(input, 'utf8');
  browser = await launchBrowser();
  const result = await inspectReport(browser, html, { screenshot: !checkOnly });
  const { png, ...diagnostics } = result;
  console.log(JSON.stringify(diagnostics, null, 2));
  if (result.errors.length) throw new Error('Report checks failed; existing output was not changed');
  if (png) await atomicWrite(output, png);
  console.log(checkOnly ? 'Mechanical checks passed; editorial/visual review remains required.' : `Captured ${output}; inspect the image before delivery.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally { if (browser) await browser.close(); }
