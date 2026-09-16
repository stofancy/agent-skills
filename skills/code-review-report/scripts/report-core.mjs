import { readFile, writeFile, rename, rm, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'";
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const baseCSS = () => readFile(new URL('../assets/report.css', import.meta.url), 'utf8');

// These are authoring checks, NOT an HTML sanitizer. Browser checks are separate.
export function assemble(body, title, css = '', lang = 'zh-CN') {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Report body must not be empty');
  if (typeof title !== 'string' || !title.trim()) throw new Error('Report title must not be empty');
  if (/<\/?(?:html|head|body)\b|<!doctype/i.test(body)) throw new Error('Use a body fragment, not a complete HTML document');
  if (/<\/style/i.test(css)) throw new Error('CSS must not contain a closing style tag');
  return `<!doctype html>\n<html lang="${escapeHTML(lang)}">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${escapeHTML(CSP)}">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHTML(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// Check aliases as well as spelling. In particular, an output must not replace an input.
export async function distinctPaths(paths) {
  const seen = new Set();
  for (const path of paths.filter(Boolean)) {
    const full = resolve(path);
    let canonical, inode;
    try {
      canonical = await realpath(full);
      const s = await stat(full);
      if (!s.isFile()) throw new Error(`Not a regular file: ${full}`);
      inode = `${s.dev}:${s.ino}`;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      canonical = resolve(await realpath(dirname(full)), basename(full));
    }
    if (seen.has(canonical) || (inode && seen.has(inode))) throw new Error('Input and output paths must differ (including aliases)');
    seen.add(canonical);
    if (inode) seen.add(inode);
  }
}

export async function atomicWrite(path, content) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
