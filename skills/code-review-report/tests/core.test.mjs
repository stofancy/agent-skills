import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assemble, baseCSS, distinctPaths, atomicWrite } from '../scripts/report-core.mjs';
import { legacyBody, safeHref } from '../scripts/render-review.mjs';

const skill = fileURLToPath(new URL('..', import.meta.url));
const contract = await readFile(new URL('../references/report-input.md', import.meta.url), 'utf8');
const fixture = () => JSON.parse(contract.match(/```json\s*([\s\S]*?)```/)[1]);
const temp = async t => { const d = await mkdtemp(join(tmpdir(), 'review-report-')); t.after(() => rm(d, { recursive: true, force: true })); return d; };
const cli = (script, args, options = {}) => spawnSync(process.execPath, [join(skill, 'scripts', script), ...args], { encoding: 'utf8', ...options });

test('assembly preserves arbitrary authored order, HTML emphasis and custom SVG', () => {
  const body = '<main><table><tr><td>先对照</td></tr></table><p><strong>后解释</strong></p><svg viewBox="0 0 40 40"><path d="M0 0L30 20"/></svg></main>';
  const a = assemble(body, '测试', '.custom { display:grid }');
  assert.ok(a.includes(body)); assert.equal(a, assemble(body, '测试', '.custom { display:grid }'));
});
test('short reports need no sections, diagrams or JSON', () => assert.ok(assemble('<p>一条发现</p>', '短报告').includes('<p>一条发现</p>')));
test('title/language escaped and restrictive policy assembled', () => {
  const html = assemble('<p>ok</p>', '<script>&"', '', 'x" onload="bad');
  assert.ok(html.includes('&lt;script&gt;&amp;&quot;')); assert.ok(html.includes('script-src &#39;none&#39;')); assert.ok(!html.includes('<script>'));
});
for (const [name, fn] of [
  ['empty body', () => assemble('', 'title')], ['empty title', () => assemble('<p>x</p>', '')],
  ['whole-document input', () => assemble('<html><body>x</body></html>', 'x')],
  ['CSS closing-tag escape', () => assemble('<p>x</p>', 'x', '</style><script>bad</script>')],
]) test(`rejects ${name}`, () => assert.throws(fn));
test('documented JSON fixture still renders', () => assert.ok(legacyBody(fixture()).includes('状态检查需要覆盖两种入口')));
test('legacy omitted terms accepted without mutating input', () => {
  const f = fixture(); delete f.lead.terms;
  assert.ok(legacyBody(f)); assert.equal(f.lead.terms, undefined);
});
test('legacy explicit invalid terms still rejected with precise path', () => {
  const f = fixture(); f.lead.terms = null; assert.throws(() => legacyBody(f), /lead\.terms/);
});
test('legacy duplicate normalized ids rejected', () => {
  const f = fixture(); f.sections[0].id = 'A B'; f.sections.push({ title: 'two', id: 'a-b', paragraphs: [] });
  assert.throws(() => legacyBody(f), /Duplicate normalized id/);
});
test('generated caption id avoids another explicit section id', () => {
  const f = fixture(); f.sections[0].id = 'a'; f.sections.push({ id: 'a-caption', title: 'two', paragraphs: [] });
  assert.ok(legacyBody(f).includes('id="a-caption-figure"'));
});
test('legacy table shape/type errors are actionable', () => {
  const f = fixture(); f.sections[0].table.rows[0].pop(); assert.throws(() => legacyBody(f), /column count/);
  f.sections[0].paragraphs = [4]; assert.throws(() => legacyBody(f), /paragraphs\[0\]/);
});
test('legacy empty sections and nonstring ids rejected', () => {
  const f = fixture(); f.sections[0].id = 23; assert.throws(() => legacyBody(f), /\.id/);
  f.sections = []; assert.throws(() => legacyBody(f), /sections/);
});
test('legacy body escapes source text rather than executing markup', () => {
  const f = fixture(); f.lead.text = '<script>alert(1)</script>&';
  assert.ok(legacyBody(f).includes('&lt;script&gt;')); assert.ok(!legacyBody(f).includes('<script>'));
});
for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', '//outside.invalid', '/\\outside.invalid', 'java\nscript:bad']) test(`unsafe legacy link: ${JSON.stringify(url)}`, () => assert.equal(safeHref(url), ''));
test('HTTP and relative evidence links retained', () => {
  for (const url of ['https://example.invalid/review', 'http://example.invalid', '#evidence', './evidence.html', '/source']) assert.equal(safeHref(url), url);
});
test('assembly works from unrelated cwd and includes custom CSS', async t => {
  const d = await temp(t), src = join(d, 'source.html'), out = join(d, 'out.html'), css = join(d, 'local.css');
  await writeFile(src, '<main class="report"><p>独立源</p></main>'); await writeFile(css, '.test { color: black; }');
  const run = cli('build-report.mjs', [src, out, '--title', 'test', '--css', css], { cwd: d });
  assert.equal(run.status, 0, run.stderr); assert.ok((await readFile(out, 'utf8')).includes('.test { color: black; }'));
});
test('invalid legacy input does not overwrite prior output', async t => {
  const d = await temp(t), src = join(d, 'input.json'), out = join(d, 'out.html');
  await writeFile(src, '{broken'); await writeFile(out, 'KEEP');
  assert.equal(cli('render-review.mjs', [src, out]).status, 1); assert.equal(await readFile(out, 'utf8'), 'KEEP');
});
test('invalid build options and same-path output do not mutate source', async t => {
  const d = await temp(t), src = join(d, 'body.html'); await writeFile(src, '<p>KEEP</p>');
  assert.equal(cli('build-report.mjs', [src, src, '--title', 'test']).status, 1);
  assert.equal(cli('build-report.mjs', [src, join(d, 'out'), '--typo', 'test']).status, 1);
  assert.equal(await readFile(src, 'utf8'), '<p>KEEP</p>');
});
test('symlink and hardlink aliases rejected', async t => {
  const d = await temp(t), a = join(d, 'a'), b = join(d, 'b'), c = join(d, 'c');
  await writeFile(a, 'KEEP'); await symlink(a, b); await link(a, c);
  await assert.rejects(distinctPaths([a, b]), /must differ/); await assert.rejects(distinctPaths([a, c]), /must differ/);
});
test('missing browser dependency is explicit and preserves PNG', async t => {
  const d = await temp(t), src = join(d, 'report.html'), out = join(d, 'report.png');
  await writeFile(src, assemble('<p>test</p>', 'test')); await writeFile(out, 'KEEP');
  const run = cli('capture-report.mjs', [src, out], { env: { ...process.env, PLAYWRIGHT_MODULE: join(d, 'not-installed') } });
  assert.equal(run.status, 1); assert.match(run.stderr, /Playwright unavailable/); assert.equal(await readFile(out, 'utf8'), 'KEEP');
});
test('atomic output write and complete movable CSS resource', async t => {
  const d = await temp(t), p = join(d, 'out'); await atomicWrite(p, 'complete');
  assert.equal(await readFile(p, 'utf8'), 'complete'); assert.ok((await baseCSS()).includes('overflow-wrap:anywhere'));
});
