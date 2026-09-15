#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

if (process.argv.length !== 4) {
  console.error("Usage: node render-review.mjs INPUT.json OUTPUT.html");
  process.exit(1);
}
const inputPath = resolve(process.argv[2]);
const outputPath = resolve(process.argv[3]);
if (inputPath === outputPath) throw new Error("Input and output must differ");
const raw = await readFile(inputPath, "utf8");
const report = JSON.parse(raw);

const isObject = value => value && typeof value === "object" && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Validate before writing, so malformed input cannot silently produce a partial report.
if (
  !isObject(report) ||
  !isObject(report.meta) ||
  !has(report.meta, "title") ||
  !has(report.meta, "subtitle") ||
  !has(report.meta, "date") ||
  !has(report.meta, "decision") ||
  !has(report.meta, "scope") ||
  !Array.isArray(report.sources) ||
  !Array.isArray(report.prs) ||
  !isObject(report.lead) ||
  !Array.isArray(report.lead.terms) ||
  !Array.isArray(report.sections) ||
  !isObject(report.closing) ||
  !Array.isArray(report.closing.actions)
) {
  throw new Error("Expected report shape: meta/sources/prs/lead/sections/closing");
}

const requireString = (value, path) => {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
};
const requireStrings = (values, path) => {
  if (!Array.isArray(values)) throw new Error(`${path} must be an array`);
  values.forEach((value, i) => requireString(value, `${path}[${i}]`));
};
const requireLinks = (values, path) => {
  if (!Array.isArray(values)) throw new Error(`${path} must be an array`);
  values.forEach((value, i) => {
    requireString(value?.label, `${path}[${i}].label`);
    requireString(value?.url, `${path}[${i}].url`);
  });
};
for (const key of ["title", "subtitle", "date", "decision", "scope"]) requireString(report.meta[key], `meta.${key}`);
if (!report.meta.title.trim()) throw new Error("meta.title must not be empty");
requireLinks(report.sources, "sources");
requireLinks(report.prs, "prs");
report.prs.forEach((pr, i) => { if (pr.head !== undefined) requireString(pr.head, `prs[${i}].head`); });
requireString(report.lead.text, "lead.text");
report.lead.terms.forEach((term, i) => {
  requireString(term?.name, `lead.terms[${i}].name`);
  requireString(term?.meaning, `lead.terms[${i}].meaning`);
});
if (!report.sections.length) throw new Error("sections must not be empty");
report.sections.forEach((section, i) => {
  const path = `sections[${i}]`;
  requireString(section?.title, `${path}.title`);
  requireStrings(section?.paragraphs, `${path}.paragraphs`);
  if (section.note !== undefined) requireString(section.note, `${path}.note`);
  if (section.evidence !== undefined) requireLinks(section.evidence, `${path}.evidence`);
  if (section.diagram !== undefined) {
    const d = section.diagram;
    if (d?.type !== "branch" || !Array.isArray(d.branches) || !d.branches.length) throw new Error(`${path}.diagram requires type branch and nonempty branches`);
    for (const key of ["start", "end", "caption"]) requireString(d[key], `${path}.diagram.${key}`);
    d.branches.forEach((branch, j) => {
      requireString(branch?.title, `${path}.diagram.branches[${j}].title`);
      requireString(branch?.text, `${path}.diagram.branches[${j}].text`);
    });
  }
  if (section.table !== undefined) {
    const t = section.table;
    requireStrings(t?.headers, `${path}.table.headers`);
    if (!t.headers.length || !Array.isArray(t.rows)) throw new Error(`${path}.table requires headers and rows`);
    t.rows.forEach((row, j) => {
      requireStrings(row, `${path}.table.rows[${j}]`);
      if (row.length !== t.headers.length) throw new Error(`${path}.table.rows[${j}] column count mismatch`);
    });
  }
});
requireString(report.closing.text, "closing.text");
requireStrings(report.closing.actions, "closing.actions");
requireString(report.closing.boundary, "closing.boundary");

const digest = createHash("sha256").update(raw).digest("hex").slice(0, 12);

const esc = (value = "") => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const text = value => esc(value);

const safeHref = value => {
  const href = String(value ?? "").trim();
  if (!href || /[\u0000-\u0020"'<>]/.test(href)) return "";
  if (/^https?:\/\//i.test(href)) return href;
  // Only same-site-ish relative references are accepted for non-http links.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "";
  if (href.startsWith("//")) return "";
  if (
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    href.startsWith("#") ||
    href.startsWith("?") ||
    /^[A-Za-z0-9][A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]*$/.test(href)
  ) return href;
  return "";
};

const renderLink = item => {
  const label = text(item?.label ?? item?.url ?? "");
  const href = safeHref(item?.url);
  if (!href) return `<span class="link-label">${label}</span>`;
  return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${label}</a>`;
};

const renderLinks = (items, separator = " · ") => items
  .map(renderLink)
  .filter(Boolean)
  .join(separator);

const safeId = (value, fallback) => {
  const id = String(value ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return id || fallback;
};

const renderTerms = terms => {
  if (!terms.length) return "";
  return `<dl class="terms">${terms.map(term => `<div class="term">
    <dt>${text(term?.name)}</dt>
    <dd>${text(term?.meaning)}</dd>
  </div>`).join("")}</dl>`;
};

const renderDiagram = (diagram, sectionIndex) => {
  if (!diagram || diagram.type !== "branch") return "";
  const branches = Array.isArray(diagram.branches) ? diagram.branches : [];
  if (!branches.length) return "";
  const figureId = `diagram-${sectionIndex + 1}`;
  return `<figure class="diagram" aria-labelledby="${figureId}-caption">
    <div class="flow-node flow-start"><strong>${text(diagram.start)}</strong></div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="branch-grid">
      ${branches.map((branch, index) => `<article class="branch branch-${index % 4}">
        <h3>${text(branch?.title)}</h3>
        <p>${text(branch?.text)}</p>
      </article>`).join("")}
    </div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="flow-node flow-end"><strong>${text(diagram.end)}</strong></div>
    <figcaption id="${figureId}-caption">${text(diagram.caption)}</figcaption>
  </figure>`;
};

const renderTable = (table, sectionIndex) => {
  if (!table || !Array.isArray(table.headers) || !table.headers.length) return "";
  const headers = table.headers;
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return `<div class="table-wrap" role="region" aria-label="${text(`表 ${sectionIndex + 1}`)}" tabindex="0">
    <table>
      <thead><tr>${headers.map(header => `<th scope="col">${text(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${headers.map((header, index) => `<td>${text(Array.isArray(row) ? row[index] : "")}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  </div>`;
};

const renderEvidence = evidence => {
  if (!Array.isArray(evidence) || !evidence.length) return "";
  return `<details class="evidence">
    <summary>展开证据（${evidence.length}）</summary>
    <ul>${evidence.map(item => `<li>${renderLink(item)}</li>`).join("")}</ul>
  </details>`;
};

const renderSection = (section, index) => {
  const id = safeId(section?.id, `section-${index + 1}`);
  const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
  return `<section class="report-section" id="${esc(id)}">
    <h2>${text(section?.title)}</h2>
    <div class="explanation">${paragraphs.map(paragraph => `<p>${text(paragraph)}</p>`).join("")}</div>
    ${renderDiagram(section?.diagram, index)}
    ${renderTable(section?.table, index)}
    ${section?.note ? `<aside class="note"><p>${text(section.note)}</p></aside>` : ""}
    ${renderEvidence(section?.evidence)}
  </section>`;
};

const meta = report.meta;
const prs = report.prs;
const closingActions = report.closing.actions;
const sourceLinks = renderLinks(report.sources);
const prLinks = prs.map(pr => `<span>${renderLink(pr)}${pr?.head ? ` <code>${text(pr.head)}</code>` : ""}</span>`).join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text(meta.title)} · ${text(meta.subtitle)}</title>
<style>
  :root {
    --bg: #f5f7fa;
    --paper: #ffffff;
    --ink: #202831;
    --muted: #5f6b78;
    --line: #d8dee6;
    --blue: #2f6698;
    --blue-soft: #edf4fa;
    --purple: #6c579c;
    --purple-soft: #f1eef8;
    --orange: #a86426;
    --orange-soft: #fff3e6;
    --green: #327653;
    --green-soft: #eaf5ee;
    --red: #a83d3d;
    --red-soft: #fceded;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.78 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  a { color: var(--blue); text-underline-offset: 3px; overflow-wrap: anywhere; }
  .link-label { color: var(--muted); }
  code {
    font: 12px/1.5 var(--mono);
    background: #edf0f3;
    padding: 2px 5px;
    border-radius: 4px;
    overflow-wrap: anywhere;
  }
  .page { width: min(calc(100% - 40px), 1060px); margin: 0 auto; padding: 40px 0 72px; }
  .masthead { padding-bottom: 24px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.28; letter-spacing: .01em; }
  .subtitle { margin: 0; color: var(--muted); font-size: 17px; }
  .meta-line { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 14px; color: var(--muted); font-size: 14px; }
  .meta-line span + span { position: relative; }
  .meta-line span + span::before { content: ""; position: absolute; left: -10px; top: .55em; width: 3px; height: 3px; border-radius: 50%; background: var(--line); }
  .pr-links, .sources { margin-top: 12px; color: var(--muted); font-size: 14px; }
  .pr-links { display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .pr-links span { overflow-wrap: anywhere; }
  .pr-links span + span { position: relative; }
  .pr-links span + span::before { content: ""; position: absolute; left: -10px; top: .65em; width: 3px; height: 3px; border-radius: 50%; background: var(--line); }
  .lead {
    margin-top: 28px;
    padding: 20px 24px 21px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-left: 4px solid var(--blue);
  }
  .lead-text { margin: 0; font-size: 19px; line-height: 1.7; }
  .terms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin: 20px 0 0; }
  .term { margin: 0; padding-top: 10px; border-top: 2px solid var(--line); }
  .term:nth-child(4n + 1) { border-top-color: var(--blue); }
  .term:nth-child(4n + 2) { border-top-color: var(--purple); }
  .term:nth-child(4n + 3) { border-top-color: var(--orange); }
  .term dt { font-weight: 700; }
  .term dd { margin: 3px 0 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
  .report-section { margin-top: 42px; scroll-margin-top: 18px; }
  h2 { margin: 0 0 14px; font-size: 23px; line-height: 1.35; }
  .explanation { max-width: 920px; }
  p { margin: 0 0 12px; }
  .explanation p:last-child { margin-bottom: 0; }
  .diagram {
    margin: 22px 0 0;
    padding: 22px 24px 18px;
    background: var(--paper);
    border: 1px solid var(--line);
  }
  .flow-node {
    width: min(100%, 620px);
    margin: 0 auto;
    padding: 13px 18px;
    text-align: center;
    font-size: 17px;
    line-height: 1.5;
    border: 1px solid var(--blue);
    border-radius: 8px;
    background: var(--blue-soft);
  }
  .flow-end { border-color: #aab9cb; background: #f0f4f8; }
  .flow-arrow { position: relative; height: 30px; width: 100%; }
  .flow-arrow::before { content: ""; position: absolute; left: 50%; top: 0; height: 20px; border-left: 2px solid #9ba8b5; }
  .flow-arrow::after {
    content: "";
    position: absolute;
    left: calc(50% - 5px);
    top: 16px;
    width: 8px;
    height: 8px;
    border-right: 2px solid #9ba8b5;
    border-bottom: 2px solid #9ba8b5;
    transform: rotate(45deg);
  }
  .branch-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .branch { min-width: 0; padding: 16px 18px; border: 1px solid var(--line); border-top: 3px solid var(--purple); background: var(--purple-soft); }
  .branch-1 { border-top-color: var(--orange); background: var(--orange-soft); }
  .branch-2 { border-top-color: var(--green); background: var(--green-soft); }
  .branch-3 { border-top-color: var(--blue); background: var(--blue-soft); }
  .branch h3 { margin: 0 0 5px; font-size: 17px; line-height: 1.45; }
  .branch p { margin: 0; font-size: 16px; line-height: 1.7; }
  figcaption { margin-top: 13px; color: var(--muted); text-align: center; font-size: 14px; }
  .table-wrap { margin-top: 22px; overflow-x: auto; background: var(--paper); border: 1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; font-size: 15px; line-height: 1.6; }
  th, td { padding: 11px 13px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  th { background: #eef2f5; font-weight: 700; }
  tr:last-child td { border-bottom: 0; }
  .note { margin-top: 14px; padding: 2px 0 2px 14px; border-left: 2px solid #b8c6d6; color: #526277; font-size: 15px; }
  .note strong { display: block; margin-bottom: 2px; }
  .note p { margin: 0; }
  .evidence { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 11px; }
  summary { cursor: pointer; color: var(--blue); font-size: 14px; font-weight: 700; }
  .evidence ul { margin: 9px 0 0; padding-left: 22px; color: var(--muted); font-size: 14px; }
  .evidence li + li { margin-top: 5px; }
  .closing { margin-top: 46px; padding: 21px 24px; background: var(--paper); border: 1px solid var(--line); border-left: 4px solid var(--red); }
  .closing h2 { margin-bottom: 10px; }
  .closing ul { margin: 10px 0 15px; padding-left: 23px; }
  .closing li + li { margin-top: 5px; }
  .boundary { margin-top: 15px; padding: 12px 15px; background: #f6f7f8; color: var(--muted); }
  .boundary strong { color: var(--ink); }
  footer { margin-top: 42px; padding-top: 13px; border-top: 1px solid var(--line); color: var(--muted); font: 11px/1.6 var(--mono); overflow-wrap: anywhere; }
</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    <h1>${text(meta.title)}</h1>
    <p class="subtitle">${text(meta.subtitle)}</p>
    <div class="meta-line">
      <span>日期：${text(meta.date)}</span>
      <span>判断：${text(meta.decision)}</span>

    </div>
    ${prLinks ? `<div class="pr-links">${prLinks}</div>` : ""}
    ${sourceLinks ? `<div class="sources">来源：${sourceLinks}</div>` : ""}
  </header>

  <section class="lead" aria-label="审查摘要">
    <p class="lead-text">${text(report.lead.text)}</p>
    ${renderTerms(report.lead.terms)}
  </section>

  ${report.sections.map(renderSection).join("")}

  <section class="closing" aria-label="结论与边界">
    <h2>结论</h2>
    <p>${text(report.closing.text)}</p>
    ${closingActions.length ? `<ul>${closingActions.map(action => `<li>${text(action)}</li>`).join("")}</ul>` : ""}
    <div class="boundary"><strong>边界：</strong>${text(report.closing.boundary)}</div>
  </section>

  <footer>${text(meta.scope)}</footer>
</main>
</body>
</html>`;

await writeFile(outputPath, html, "utf8");
console.log(`Rendered ${outputPath}`);
console.log(`Source sha256 ${digest}`);
