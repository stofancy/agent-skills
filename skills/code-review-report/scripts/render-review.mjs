#!/usr/bin/env node
// 旧 JSON 调用方的兼容适配层；新报告应当直接创作 HTML。
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assemble, escapeHTML as esc, baseCSS, distinctPaths, atomicWrite, hasCJK } from './report-core.mjs';

const string = (v, path) => { if (typeof v !== 'string') throw new Error(`${path} must be a string`); return v; };
const array = (v, path) => { if (!Array.isArray(v)) throw new Error(`${path} must be an array`); return v; };
const strings = (v, path) => array(v, path).map((x, i) => string(x, `${path}[${i}]`));
const links = (v, path) => array(v, path).map((x, i) => ({ label: string(x?.label, `${path}[${i}].label`), url: string(x?.url, `${path}[${i}].url`) }));

export function safeHref(value) {
  const href = value.trim();
  if (!href || /[\u0000-\u0020\\"'<>]/.test(href) || href.startsWith('//')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)) return '';
  try { if (!['http:', 'https:'].includes(new URL(href, 'https://report.invalid/').protocol)) return ''; } catch { return ''; }
  return href;
}
const link = item => {
  const href = safeHref(item.url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>` : `<span>${esc(item.label)}</span>`;
};
const paragraph = text => `<p>${esc(text)}</p>`;

export function legacyBody(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Report must be an object');
  for (const k of ['title', 'subtitle', 'date', 'decision', 'scope']) string(report.meta?.[k], `meta.${k}`);
  if (!report.meta.title.trim()) throw new Error('meta.title must not be empty');
  const sources = links(report.sources, 'sources'), prs = links(report.prs, 'prs');
  report.prs.forEach((pr, i) => { if (pr.head !== undefined) string(pr.head, `prs[${i}].head`); });
  string(report.lead?.text, 'lead.text');
  const terms = array(report.lead.terms === undefined ? [] : report.lead.terms, 'lead.terms').map((t, i) => ({ name: string(t?.name, `lead.terms[${i}].name`), meaning: string(t?.meaning, `lead.terms[${i}].meaning`) }));
  const sections = array(report.sections, 'sections');
  if (!sections.length) throw new Error('sections must not be empty');
  string(report.closing?.text, 'closing.text'); string(report.closing?.boundary, 'closing.boundary');
  const actions = strings(report.closing.actions, 'closing.actions');
  const used = new Set();
  const reserve = id => { if (used.has(id)) throw new Error(`Duplicate normalized id: ${id}`); used.add(id); return id; };
  // 先占住显式 section id，再分配自动生成的图注 id。
  const ids = sections.map((s, i) => {
    if (s?.id !== undefined) string(s.id, `sections[${i}].id`);
    return reserve((s?.id || '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || `section-${i + 1}`);
  });
  const content = sections.map((s, i) => {
    const p = `sections[${i}]`;
    string(s?.title, `${p}.title`);
    const paragraphs = strings(s.paragraphs, `${p}.paragraphs`);
    let diagram = '', table = '', evidence = '';
    if (s.note !== undefined) string(s.note, `${p}.note`);
    if (s.diagram !== undefined) {
      const d = s.diagram;
      if (d?.type !== 'branch') throw new Error(`${p}.diagram requires type branch`);
      for (const k of ['start', 'end', 'caption']) string(d[k], `${p}.diagram.${k}`);
      const branches = array(d.branches, `${p}.diagram.branches`);
      if (!branches.length) throw new Error(`${p}.diagram.branches must not be empty`);
      const items = branches.map((b, j) => `<article class="branch"><h3>${esc(string(b?.title, `${p}.diagram.branches[${j}].title`))}</h3>${paragraph(string(b?.text, `${p}.diagram.branches[${j}].text`))}</article>`).join('');
      let captionId = `${ids[i]}-caption`;
      while (used.has(captionId)) captionId += '-figure';
      reserve(captionId);
      diagram = `<figure class="diagram" aria-labelledby="${esc(captionId)}"><div class="flow-node">${esc(d.start)}</div><div class="flow-arrow" aria-hidden="true"></div><div class="branch-grid">${items}</div><div class="flow-arrow" aria-hidden="true"></div><div class="flow-node">${esc(d.end)}</div><figcaption id="${esc(captionId)}">${esc(d.caption)}</figcaption></figure>`;
    }
    if (s.table !== undefined) {
      const headers = strings(s.table?.headers, `${p}.table.headers`);
      if (!headers.length) throw new Error(`${p}.table.headers must not be empty`);
      const rows = array(s.table.rows, `${p}.table.rows`).map((r, j) => {
        strings(r, `${p}.table.rows[${j}]`);
        if (r.length !== headers.length) throw new Error(`${p}.table.rows[${j}] column count mismatch`);
        return `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`;
      });
      table = `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    }
    if (s.evidence !== undefined) {
      const items = links(s.evidence, `${p}.evidence`);
      if (items.length) evidence = `<details><summary>展开证据（${items.length}）</summary><ul>${items.map(x => `<li>${link(x)}</li>`).join('')}</ul></details>`;
    }
    return `<section class="report-section" id="${esc(ids[i])}"><h2>${esc(s.title)}</h2>${paragraphs.map(paragraph).join('')}${diagram}${table}${s.note ? `<aside class="note">${esc(s.note)}</aside>` : ''}${evidence}</section>`;
  }).join('\n');
  const m = report.meta;
  return `<main class="report"><header><h1>${esc(m.title)}</h1><p class="meta">${esc(m.subtitle)}</p><p class="meta">日期：${esc(m.date)} · 判断：${esc(m.decision)}</p><p class="meta">${prs.map((x, i) => `${link(x)}${report.prs[i].head ? ` <code>${esc(report.prs[i].head)}</code>` : ''}`).join(' · ')}</p><p class="meta">${sources.map(link).join(' · ')}</p></header><section class="lead">${paragraph(report.lead.text)}${terms.length ? `<dl class="terms">${terms.map(t => `<div class="term"><dt>${esc(t.name)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl>` : ''}</section>${content}<section class="closing"><h2>结论</h2>${paragraph(report.closing.text)}${actions.length ? `<ul>${actions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="boundary"><strong>边界：</strong>${esc(report.closing.boundary)}</p></section><footer>${esc(m.scope)}</footer></main>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (!input || !output || extra.length) throw new Error('Usage: node render-review.mjs INPUT.json OUTPUT.html');
    await distinctPaths([input, output]);
    const report = JSON.parse(await readFile(input, 'utf8'));
    const body = legacyBody(report);
    await atomicWrite(output, assemble(body, report.meta.title, await baseCSS(hasCJK(body))));
    console.log(`Rendered legacy JSON: ${output}`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
