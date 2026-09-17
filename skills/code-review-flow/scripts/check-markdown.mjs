// 两份 Markdown 产物的机械检查：把「归属规则」和「必填字段」从口头纪律变成可执行规则。
// 只检查能被机械判定的东西（归属、必填节与列、证据标记、台账形态）；语义判断仍归人。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const UNDERSTANDING_REQUIRED = ['原始需求', '需求落点', '覆盖范围', '未查方向'];
const FINDINGS_REQUIRED = ['验证边界'];
const FINDINGS_TABLE_COLUMNS = ['结论', '严重度', '行动', '证据', '覆盖范围', '证伪条件'];
const SEVERITY = /^(阻塞|重要|次要|提示)/;
// 理解包不得替读者下判断。引用卡/PR 原文的行（以 > 开头）不算。
const JUDGMENT_TOKENS = ['严重度', '阻塞合入', '建议合入', '必须改', '不建议合入', '合入意见'];
const EVIDENCE = /\[(跑过|读过|推断)\]/;

const lines = text => text.split('\n');
const hasHeading = (text, name) => new RegExp(`^#{1,6}\\s*\\d*\\.?\\s*${name}`, 'm').test(text);

function tables(text) {
  const out = [];
  let current = null;
  for (const line of lines(text)) {
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (!current) { current = { header: cells, rows: [] }; out.push(current); }
      else if (/^[\s:-]+$/.test(cells.join(''))) continue;
      else current.rows.push(cells);
    } else current = null;
  }
  return out;
}

function conclusionTable(text) {
  return tables(text).find(t => FINDINGS_TABLE_COLUMNS.every(c => t.header.some(h => h.includes(c))));
}

export function checkUnderstanding(text) {
  const errors = [];
  if (!/^#\s+\S/m.test(text)) errors.push('缺少 H1 标题（应含仓库/编号/标题/head）');
  for (const section of UNDERSTANDING_REQUIRED)
    if (!hasHeading(text, section) && !new RegExp(section).test(text)) errors.push(`缺少必填节：${section}`);
  for (const [i, line] of lines(text).entries()) {
    if (/^\s*>/.test(line)) continue;
    const hit = JUDGMENT_TOKENS.find(t => line.includes(t));
    if (hit) errors.push(`第 ${i + 1} 行出现判断词「${hit}」，判断属于结论包：${line.trim().slice(0, 60)}`);
  }
  return errors;
}

export function checkFindings(text) {
  const errors = [];
  if (!/^#\s+\S/m.test(text)) errors.push('缺少 H1 标题');
  for (const section of FINDINGS_REQUIRED)
    if (!hasHeading(text, section)) errors.push(`缺少必填节：${section}`);
  const table = conclusionTable(text);
  if (!table) errors.push(`结论表必须同时含列：${FINDINGS_TABLE_COLUMNS.join(' / ')}（不写"置信度"，用覆盖范围+证伪条件表达强弱）`);
  else for (const [i, row] of table.rows.entries()) {
    if (!row.some(c => EVIDENCE.test(c))) errors.push(`结论表第 ${i + 1} 行缺证据标记（[跑过]/[读过]/[推断]）：${row[0]?.slice(0, 40)}`);
    if (row.some(c => /^(高|中|低)$/.test(c))) errors.push(`结论表第 ${i + 1} 行仍是置信度档位，请改成覆盖范围与证伪条件`);
    const severity = row[table.header.findIndex(h => h.includes('严重度'))];
    if (severity && !SEVERITY.test(severity)) errors.push(`结论表第 ${i + 1} 行严重度取值非法（阻塞/重要/次要/提示）：${severity}`);
  }
  if (/```text/.test(text)) errors.push('结论包出现 ```text 链路图：机制属于理解包');
  if (/^#{1,6}.*(变更地图|数据流)/.test(text)) errors.push('结论包出现机制节（变更地图/数据流）');
  const ledger = tables(text).find(t => t.header.some(h => h.includes('问句')));
  if (ledger && !ledger.header.some(h => h.includes('阻塞'))) errors.push('追问台账缺「是否阻塞合入」列');
  return errors;
}

export function checkProducts({ understanding, findings }) {
  const report = { understanding: checkUnderstanding(understanding ?? ''), findings: checkFindings(findings ?? '') };
  return { ok: !report.understanding.length && !report.findings.length, report };
}

async function main(argv) {
  const target = argv[0];
  if (!target) {
    console.error('用法：node scripts/check-markdown.mjs <留档目录 | 00-understanding.md 01-findings.md>');
    return 2;
  }
  let understandingPath = join(target, '00-understanding.md');
  let findingsPath = join(target, '01-findings.md');
  if (target.endsWith('.md')) [understandingPath, findingsPath] = argv.length > 1 ? argv : [target, target];
  const [understanding, findings] = await Promise.all([readFile(understandingPath, 'utf8'), readFile(findingsPath, 'utf8')]);
  const { ok, report } = checkProducts({ understanding, findings });
  for (const [name, errors] of Object.entries(report))
    for (const e of errors) console.error(`${name}: ${e}`);
  console.log(ok ? 'OK：两份产物通过机械检查。' : `FAIL：${Object.values(report).flat().length} 处越界或缺失。`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
