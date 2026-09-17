import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assemble, baseCSS } from '../scripts/report-core.mjs';
import { launchBrowser, inspectReport } from '../scripts/browser.mjs';
import { legacyBody } from '../scripts/render-review.mjs';

const enabled = process.env.RUN_BROWSER_TESTS === '1';
let browser;
const css = await baseCSS();
before(async () => { if (enabled) browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });
const check = (body, custom = '') => inspectReport(browser, assemble(body, 'test', css + custom));
const browserTest = (name, fn) => test(name, { skip: !enabled }, fn);

for (const name of ['mechanism', 'decision', 'improvement', 'short']) browserTest(`authored ${name}: layout, static audit and real PNG`, async () => {
  const body = await readFile(new URL(`../examples/${name}.body.html`, import.meta.url), 'utf8');
  const result = await inspectReport(browser, assemble(body, name, css), { screenshot: true });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []); assert.deepEqual(result.blocked, []);
  assert.equal(result.png.subarray(1, 4).toString(), 'PNG'); assert.equal(result.width, 1100);
  if (name === 'short') assert.ok(result.png.readUInt32BE(20) < 600, 'short report should not have viewport-sized blank space');
});
browserTest('legacy long identifiers wrap without overlap', async () => {
  const contract = await readFile(new URL('../references/report-input.md', import.meta.url), 'utf8');
  const f = JSON.parse(contract.match(/```json\s*([\s\S]*?)```/)[1]);
  f.lead.terms = [{ name: 'LongIdentifier'.repeat(12), meaning: 'meaning' }, { name: 'other', meaning: 'next column' }];
  f.sections[0].diagram.branches[0].text = 'LongIdentifier'.repeat(15);
  const result = await check(legacyBody(f)); assert.deepEqual(result.errors, []);
});
browserTest('detects local overflow even when page width does not overflow', async () => {
  const r = await check('<main class="report"><div style="width:300px"><p style="white-space:nowrap">LongIdentifierLongIdentifierLongIdentifierLongIdentifierLongIdentifier</p></div></main>');
  assert.ok(r.errors.some(x => /Local horizontal|own container/.test(x)), JSON.stringify(r));
  assert.ok(!r.errors.includes('Page has horizontal overflow'));
});
browserTest('does not accept hiding overflow as a layout fix', async () => {
  const r = await check('<p style="height:15px;width:70px;overflow:hidden">lots of words on several lines</p>');
  assert.ok(r.errors.some(x => /Clipped vertical/.test(x)));
});
browserTest('SVG text/node boundary and tiny text diagnostics', async () => {
  const r = await check('<svg viewBox="0 0 1000 120"><g data-node="x"><rect x="0" y="0" width="30" height="80"/><text x="0" y="25" font-size="18">Label exceeds the node box</text></g><text x="0" y="100" font-size="9">too small</text></svg>');
  assert.ok(r.errors.includes('SVG text exceeds data-node box')); assert.ok(r.warnings.includes('SVG text renders below 13px'));
});
browserTest('SVG overlapping labels detected', async () => {
  const r = await check('<svg viewBox="0 0 1000 100"><text x="10" y="30" font-size="20">first label</text><text x="15" y="30" font-size="20">second label</text></svg>');
  assert.ok(r.errors.includes('SVG text labels overlap'));
});
// 旋转/缩放过的文字，其轴对齐外接矩形会被放大，导致相邻但不接触的标签被判成重叠。
const rotated = (offset) => `<svg viewBox="0 0 900 400" width="900" height="400"><text x="250" y="300" font-size="14" transform="rotate(-45 250 300)">alpha label one two three four five</text><g transform="translate(${offset},${offset})"><text x="250" y="300" font-size="14" transform="rotate(-45 250 300)">bravo label one two three four five</text></g></svg>`;
browserTest('rotated labels that do not touch are not reported as overlapping', async () => {
  const r = await check(rotated(28));
  assert.ok(!r.errors.includes('SVG text labels overlap'), JSON.stringify(r));
});
browserTest('rotation does not hide a real label overlap', async () => {
  const r = await check(rotated(4));
  assert.ok(r.errors.includes('SVG text labels overlap'), JSON.stringify(r));
});
browserTest('bundled font covers Chinese text and stays silent', async () => {
  const r = await check('<main class="report"><p>取消确认后不再发布结果，例如 worker 启动时只读取一次状态。</p></main>');
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
});
browserTest('flags text the bundled font cannot render', async () => {
  const r = await inspectReport(browser, assemble('<main class="report"><p>取消确认后不再发布结果</p></main>', 'test', ''));
  assert.ok(r.warnings.some(x => /outside the bundled font/.test(x)), JSON.stringify(r));
});
browserTest('closed evidence remains closed and is counted', async () => {
  const r = await check('<p>Important condition stays visible</p><details><summary>Evidence</summary><p>hidden details</p></details>');
  assert.equal(r.closedEvidence, 1); assert.deepEqual(r.errors, []);
});
for (const [name, body] of [
  ['script', '<script>globalThis.bad = true</script>'], ['event', '<p onclick="bad()">x</p>'],
  ['encoded link', '<a href="java&#x73;cript:bad()">x</a>'], ['remote image', '<img src="https://example.invalid/x.png">'],
  ['refresh', '<meta http-equiv="refresh" content="0;url=https://example.invalid">'],
  ['embedded frame', '<iframe srcdoc="bad"></iframe>'], ['SVG animation', '<svg><set attributeName="href" to="bad"/></svg>'],
  ['CSS import', '<style>@import "https://example.invalid/a.css";</style>'],
  ['CSS remote URL', '<p style="background:url(https://example.invalid/a)">x</p>'],
  ['CSS remote font', '<style>@font-face{font-family:"X";src:url(https://example.invalid/a.woff2)}</style>'],
  ['duplicate ids', '<p id="a">x</p><p id="a">y</p>'], ['missing anchor', '<a href="#absent">x</a>'],
]) browserTest(`rejects ${name} before capture`, async () => {
  const r = await check(body); assert.ok(r.errors.length > 0); assert.equal(r.png, undefined);
});
browserTest('custom layout, local SVG markers and evidence links are not a closed vocabulary', async () => {
  const r = await check('<article class="anything"><a href="https://example.invalid/evidence">Evidence</a><svg viewBox="0 0 1000 100"><defs><marker id="m"><path d="M0 0L5 5"/></marker></defs><path d="M0 0L10 10" marker-end="url(#m)"/></svg></article>', '.anything { display:grid; padding:20px; }');
  assert.deepEqual(r.errors, []); assert.deepEqual(r.blocked, []);
});
