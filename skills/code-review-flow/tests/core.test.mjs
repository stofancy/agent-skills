import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assemble, baseCSS, distinctPaths, atomicWrite } from '../scripts/report-core.mjs';
import { legacyBody, safeHref } from '../scripts/render-review.mjs';
import { checkProducts, checkUnderstanding, checkFindings } from '../scripts/check-markdown.mjs';

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
test('CJK reports inline the bundled font, Latin-only reports stay small', async t => {
  const d = await temp(t), cjk = join(d, 'cjk.body.html'), latin = join(d, 'latin.body.html'), a = join(d, 'a.html'), b = join(d, 'b.html');
  await writeFile(cjk, '<main class="report"><p>取消确认后不再发布</p></main>');
  await writeFile(latin, '<main class="report"><p>Cancellation stops publishing.</p></main>');
  assert.equal(cli('build-report.mjs', [cjk, a, '--title', '中文']).status, 0);
  assert.equal(cli('build-report.mjs', [latin, b, '--title', 'Latin']).status, 0);
  const withFont = await readFile(a, 'utf8');
  assert.ok(withFont.includes('font-src data:') && withFont.includes('data:font/woff2;base64,'));
  assert.ok((await readFile(b, 'utf8')).length < withFont.length / 50);
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

// —— 两份 Markdown 产物的机械检查 ——
const understanding = (extra = '') => `# repo#1 · 标题（head abc1234）

## 1. 原始需求（原文，不转述）
> 卡里的原句
## 2. 需求落点
| 需求 | 落点 | 证据 |
|---|---|---|
| 传字段 | a.ts:41 | [读过] |
## 3. 变更地图
| 事实 | 内容 | 来源 |
|---|---|---|
| 覆盖范围 | 工程内、非测试 | [跑过] |
| 未查方向 | 跨仓 | — |
${extra}`;
const findings = (rows = '| 1 | 那条结论 | 重要 | 重新生成客户端 | [读过] | 工程内、非测试调用点 | 若出现消费方即不成立 | a.ts:41 |') => `# repo#1 · 标题（head abc1234）

| # | 结论 | 严重度 | 行动 | 证据 | 覆盖范围 | 证伪条件 | 依据 |
|---|---|---|---|---|---|---|---|
${rows}

## 验证边界
- 未跑构建`;

test('markdown products pass when ownership and required fields hold', () => {
  const { ok, report } = checkProducts({ understanding: understanding(), findings: findings() });
  assert.deepEqual(report, { understanding: [], findings: [] }); assert.equal(ok, true);
});
test('understanding rejects verdict words but tolerates quoted source text', () => {
  assert.match(checkUnderstanding(understanding('- 这不阻塞合入')).join(), /阻塞合入/);
  assert.deepEqual(checkUnderstanding(understanding('> 卡里写着「严重度：高」')), []);
  assert.match(checkUnderstanding(understanding().replace('| 未查方向 | 跨仓 | — |', '')).join(), /未查方向/);
});
test('findings requires coverage and falsification columns instead of a confidence column', () => {
  assert.match(checkFindings(findings('| 1 | 那条结论 | 高 | a.ts:41 |')).join(), /证伪条件/);
  assert.match(checkFindings(findings('| 1 | 那条结论 | 重要 | 无需动作 | 未标注 | 工程内 | 若出现消费方即不成立 | a.ts:41 |')).join(), /缺证据标记/);
  assert.match(checkFindings(findings('| 1 | 那条结论 | 高风险 | 重新生成 | [读过] | 工程内 | 若出现消费方即不成立 | a.ts:41 |')).join(), /严重度取值非法/);
});
test('findings rejects mechanism diagrams and ledger without a blocking column', () => {
  assert.match(checkFindings(findings() + '\n```text\nA → B\n```').join(), /链路图/);
  assert.match(checkFindings(findings() + '\n| # | 问句 | 挂在 |\n|---|---|---|\n| 1 | 是这样吗 | 结论 1 |').join(), /阻塞/);
});
