import { readFile, writeFile, rename, rm, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'";
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 报告要在没有中日韩字体的机器上渲染出同一张 PNG，所以字体随 skill 内联，而不是靠宿主系统。
// 来源：notofonts/noto-cjk 的 Sans/SubsetOTF/SC/NotoSansSC-Regular.otf，用 pyftsubset 取 GB2312
// 常用汉字（6763 字）加拉丁、标点、箭头与常用符号，woff2 约 1.1MB；许可全文见 assets/OFL.txt。
// 族名用别名，免得与宿主安装的同名字体混为一谈。
export const FONT_FAMILY = 'Report Sans SC';
const FONT_URL = new URL('../assets/NotoSansSC-Regular.gb2312-subset.woff2', import.meta.url);
export const hasCJK = text => /[\u3000-\u303F\u3040-\u30FF\u3400-\u9FFF\uFF00-\uFFEF]/.test(text);

let fontCSS;
const inlineFont = async () => fontCSS ??= `@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${(await readFile(FONT_URL)).toString('base64')}) format("woff2")}`;

export async function baseCSS(withFont = true) {
  const css = await readFile(new URL('../assets/report.css', import.meta.url), 'utf8');
  return withFont ? `${await inlineFont()}\n${css}` : css;
}

// 这些是创作期检查，不是 HTML 消毒器；浏览器检查另算。
export function assemble(body, title, css = '', lang = 'zh-CN') {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Report body must not be empty');
  if (typeof title !== 'string' || !title.trim()) throw new Error('Report title must not be empty');
  if (/<\/?(?:html|head|body)\b|<!doctype/i.test(body)) throw new Error('Use a body fragment, not a complete HTML document');
  if (/<\/style/i.test(css)) throw new Error('CSS must not contain a closing style tag');
  return `<!doctype html>\n<html lang="${escapeHTML(lang)}">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${escapeHTML(CSP)}">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHTML(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// 别名和拼写都要查：尤其输出不得替换输入。
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
