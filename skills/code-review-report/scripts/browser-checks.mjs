// These functions execute in the browser, so keep them self-contained.
// This is a static-report audit, not a general-purpose hostile-HTML sanitizer.
export function checkDocument(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const errors = [];
  const ids = new Set();
  const forbidden = new Set('script iframe frame frameset object embed base link form input button textarea select audio video source track animate animatemotion animatetransform set foreignobject template noscript'.split(' '));
  const raster = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
  const bundledFont = /url\(\s*(['"]?)data:font\/woff2;base64,[a-z0-9+/=\s]+\1\s*\)/gi;
  const cssCheck = css => {
    // Fragment paint servers/markers and the skill's own inlined woff2 are local. Other CSS stays free.
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
        } catch { /* reported below */ }
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
    const bounds = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')].filter(visible);
    for (const text of texts) {
      const b = text.getBoundingClientRect(), m = text.getScreenCTM();
      if (b.left < bounds.left - 2 || b.right > bounds.right + 2 || b.top < bounds.top - 2 || b.bottom > bounds.bottom + 2) errors.push('SVG text exceeds viewport');
      if (m && parseFloat(getComputedStyle(text).fontSize) * Math.hypot(m.a, m.b) < 13) warnings.push('SVG text renders below 13px');
      const group = text.closest('[data-node]'), rect = group?.querySelector('rect');
      if (rect) {
        const r = rect.getBoundingClientRect();
        if (b.left < r.left - 2 || b.right > r.right + 2 || b.top < r.top - 2 || b.bottom > r.bottom + 2) errors.push('SVG text exceeds data-node box');
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].getBoundingClientRect(), b = texts[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) errors.push('SVG text labels overlap');
    }
  }
  // The inlined font covers GB2312 hanzi and common symbols only; anything else falls back to the host, so
  // the same report can produce different PNGs. document.fonts.check() also returns true for unknown
  // families, so glyph coverage is decided by pixels: matching an absent family means the inlined font
  // did not draw this character.
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
