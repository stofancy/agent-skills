// 这些函数在浏览器里执行，所以保持自包含。
// 这是静态报告审计，不是通用的恶意 HTML 消毒器。
export function checkDocument(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const errors = [];
  const ids = new Set();
  const forbidden = new Set('script iframe frame frameset object embed base link form input button textarea select audio video source track animate animatemotion animatetransform set foreignobject template noscript'.split(' '));
  const raster = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
  const bundledFont = /url\(\s*(['"]?)data:font\/woff2;base64,[a-z0-9+/=\s]+\1\s*\)/gi;
  const cssCheck = css => {
    // 片段描绘服务器、标记，以及本 skill 自己内联的 woff2 都算本地资源；其余 CSS 不受限制。
    const rest = css.replace(/url\(\s*(['"]?)#[a-z0-9_.:-]+\1\s*\)/gi, '').replace(bundledFont, '');
    if (/@import\b|url\s*\(|image-set\s*\(|\\/i.test(rest)) errors.push('CSS must be self-contained; external URLs, imports and CSS escapes are not supported');
  };
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.localName.toLowerCase();
    if (forbidden.has(tag)) errors.push(`Unsupported active/resource element: ${tag}`);
    if (tag === 'meta' && el.hasAttribute('http-equiv') && el.getAttribute('http-equiv').toLowerCase() !== 'content-security-policy') errors.push('Meta refresh/HTTP directives are not allowed');
    if (el.id) {
      if (ids.has(el.id)) errors.push(`Duplicate id: ${el.id}`);
      ids.add(el.id);
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase(), value = attr.value.trim();
      if (/^on/.test(name) || ['srcdoc', 'ping', 'action', 'formaction', 'srcset'].includes(name)) errors.push(`Unsupported active attribute: ${name}`);
      if (name === 'style' || /^(fill|stroke|marker-start|marker-mid|marker-end|filter|clip-path|mask)$/.test(name)) cssCheck(value);
      if (!['href', 'xlink:href', 'src', 'poster', 'background', 'data'].includes(name)) continue;
      if (value.startsWith('#')) continue;
      if (['img', 'image'].includes(tag) && raster.test(value)) continue;
      if (tag === 'a' && name === 'href') {
        try {
          const url = new URL(value, 'https://report.invalid/');
          if (value && !/[\u0000-\u0020\\]/.test(value) && !value.startsWith('//') && ['http:', 'https:'].includes(url.protocol)) continue;
        } catch { /* 在下方统一报错 */ }
      }
      errors.push(`Nonlocal resource or unsafe link: ${tag}[${name}]`);
    }
    if (tag === 'style') cssCheck(el.textContent);
  }
  for (const el of doc.querySelectorAll('[href^="#"], [aria-labelledby], [aria-describedby]')) {
    const href = el.getAttribute('href');
    const refs = [href?.startsWith('#') ? href.slice(1) : null, ...(el.getAttribute('aria-labelledby') || '').split(/\s+/), ...(el.getAttribute('aria-describedby') || '').split(/\s+/)];
    for (const id of refs.filter(Boolean)) if (!ids.has(id)) errors.push(`Missing fragment/ARIA target: ${id}`);
  }
  return [...new Set(errors)];
}

// SVG 内容常被旋转、缩放：getBoundingClientRect() 给的是轴对齐外接矩形，旋转 45° 后会被放大两三倍，
// 于是"相邻但不接触"的两个标签会被判成重叠、贴边的文字会被判成越界。改成取元素自身几何框
// (getBBox) 经 getScreenCTM() 变换后的有向四边形，再做分离轴测试与点内判定。
const orientedQuad = el => {
  const box = el?.getBBox?.(), m = el?.getScreenCTM?.();
  if (!box || !m || !box.width || !box.height) return null;
  return [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
    .map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
};
const rectQuad = r => [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }];
const axesOf = q => [0, 1].map(i => { const p = q[i], n = q[(i + 1) % 4]; return { x: -(n.y - p.y), y: n.x - p.x }; });
const projected = (q, ax) => q.map(p => p.x * ax.x + p.y * ax.y);
// 分离轴测试返回最小重叠深度；<= 0 表示两个四边形不相交。
const overlapDepth = (a, b) => Math.min(...[...axesOf(a), ...axesOf(b)].map(ax => {
  const pa = projected(a, ax), pb = projected(b, ax);
  return Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
}));
// 凸四边形包含判定：inner 的四角都在 outer 内（tol 像素容差）。四角按 (x,y)→(x+w,y)→(x+w,y+h)→(x,y+h)
// 排列时，内侧点的叉积为正，所以越界项是"叉积 < -tol"。
const covers = (outer, inner, tol) => {
  const edges = outer.map((p, i) => [p, outer[(i + 1) % 4]]);
  return inner.every(pt => edges.every(([p, n]) => {
    const ex = n.x - p.x, ey = n.y - p.y, len = Math.hypot(ex, ey) || 1;
    return (ex * (pt.y - p.y) - ey * (pt.x - p.x)) / len >= -tol;
  }));
};

export function checkLayout({ fontFamily } = {}) {
  const errors = [], warnings = [];
  const root = document.documentElement;
  const label = el => `${el.localName}${el.id ? '#' + el.id : ''}${el.classList?.length ? '.' + [...el.classList].join('.') : ''}`;
  const visible = el => {
    const b = el.getBoundingClientRect(), s = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  if (root.scrollWidth > root.clientWidth + 1) errors.push('Page has horizontal overflow');
  for (const el of document.body.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    const style = getComputedStyle(el);
    if (el.clientWidth && el.scrollWidth > el.clientWidth + 2) errors.push(`Local horizontal overflow: ${label(el)}`);
    if (el.clientHeight && el.scrollHeight > el.clientHeight + 2 && ['hidden', 'clip'].includes(style.overflowY)) errors.push(`Clipped vertical content: ${label(el)}`);
    if (style.display === 'inline') continue;
    const box = el.getBoundingClientRect();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some(r => r.left < box.left - 2 || r.right > box.right + 2)) errors.push(`Text exceeds its own container: ${label(el)}`);
      if (parseFloat(style.fontSize) < 13) warnings.push(`Small text (<13px): ${label(el)}`);
    }
  }
  for (const svg of document.querySelectorAll('svg')) {
    const texts = [...svg.querySelectorAll('text')].filter(visible);
    const svgQuad = rectQuad(svg.getBoundingClientRect());
    for (const text of texts) {
      const q = orientedQuad(text), m = text.getScreenCTM();
      if (q && !covers(svgQuad, q, 2)) errors.push('SVG text exceeds viewport');
      if (m && parseFloat(getComputedStyle(text).fontSize) * Math.hypot(m.a, m.b) < 13) warnings.push('SVG text renders below 13px');
      const group = text.closest('[data-node]'), rect = group?.querySelector('rect');
      if (q && rect && !covers(orientedQuad(rect), q, 2)) errors.push('SVG text exceeds data-node box');
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = orientedQuad(texts[i]), b = orientedQuad(texts[j]);
      if (a && b && overlapDepth(a, b) > 1) errors.push('SVG text labels overlap');
    }
  }
  // 内联字体只覆盖 GB2312 常用字与常见符号，其余字符会回退到宿主字体，同一份报告因此可能产出不同
  // 的 PNG。document.fonts.check() 对未知族名同样返回 true，所以按像素判断：与不存在的族名渲染结果
  // 相同，说明内联字体没有画出这个字。
  if (fontFamily) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext('2d');
    const signature = (char, family) => {
      ctx.clearRect(0, 0, 24, 24);
      ctx.font = `20px ${family}`;
      ctx.fillText(char, 1, 20);
      const alpha = ctx.getImageData(0, 0, 24, 24).data;
      let hash = 0;
      for (let i = 3; i < alpha.length; i += 4) hash = (hash * 31 + alpha[i]) | 0;
      return hash;
    };
    const missing = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const char of node.textContent) {
        if (char.codePointAt(0) < 0x80 || /\s/.test(char) || missing.has(char)) continue;
        if (signature(char, `"${fontFamily}"`) === signature(char, '"__report-absent-font__"')) missing.add(char);
      }
    }
    if (missing.size) warnings.push(`Text outside the bundled font (PNG may differ across machines): ${[...missing].join('')}`);
  }
  const contentBottom = Math.max(document.body.getBoundingClientRect().bottom, ...[...document.body.querySelectorAll('*')].filter(visible).map(el => el.getBoundingClientRect().bottom));
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], width: root.clientWidth, height: root.scrollHeight, contentHeight: Math.max(1, Math.ceil(contentBottom)), closedEvidence: document.querySelectorAll('details:not([open])').length };
}
