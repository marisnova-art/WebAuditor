// Dependency-free HTML / CSS parsing that runs in Deno, Node and browsers.
// It is deliberately tolerant: we audit real-world markup, not valid markup.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®' };

export function decode(s = '') {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const squash = (s = '') => s.replace(/\s+/g, ' ').trim();
export const stripTags = (s = '') => squash(decode(s.replace(/<[^>]*>/g, ' ')));

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
export function parseAttrs(raw = '') {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

// Prepare a document: remove comments and blank out the *content* of
// script/style/template so their text can't be mistaken for markup.
export function prepare(html) {
  const scripts = [];
  const styles = [];
  let clean = html.replace(/<!--[\s\S]*?-->/g, '');
  clean = clean.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_, a, body) => {
    scripts.push({ attrs: parseAttrs(a), body });
    return `<script${a}></script>`;
  });
  clean = clean.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_, a, body) => {
    styles.push({ attrs: parseAttrs(a), body });
    return `<style${a}></style>`;
  });
  clean = clean.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, '');
  return { clean, scripts, styles };
}

// All opening tags with attributes and position.
export function tags(clean) {
  const out = [];
  const re = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(clean))) out.push({ name: m[1].toLowerCase(), attrs: parseAttrs(m[2] || ''), index: m.index });
  return out;
}

// Elements whose inner HTML we need (non-nesting elements only).
export function elements(clean, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
  let m;
  while ((m = re.exec(clean))) out.push({ attrs: parseAttrs(m[1]), inner: m[2], text: stripTags(m[2]), index: m.index });
  return out;
}

export function headings(clean) {
  const out = [];
  const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  while ((m = re.exec(clean))) out.push({ level: +m[1], text: stripTags(m[3]).slice(0, 160), index: m.index });
  return out;
}

export function visibleText(clean) {
  const body = (clean.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, clean])[1];
  return stripTags(
    body
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(br|p|div|li|h[1-6]|section|article|td|tr)\b/gi, ' \n<$1'),
  );
}

export function bodyRange(clean) {
  const open = clean.search(/<body\b/i);
  const close = clean.search(/<\/body>/i);
  return { start: open < 0 ? 0 : open, end: close < 0 ? clean.length : close };
}

// ── CSS ───────────────────────────────────────────────────────
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', orange: '#ffa500', yellow: '#ffff00', purple: '#800080', teal: '#008080', maroon: '#800000' };

export function normColor(v) {
  if (!v) return null;
  v = v.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && h[3] === '0') return null;
      h = h.slice(0, 3).split('').map((c) => c + c).join('');
    } else if (h.length === 8) {
      if (h.slice(6) === '00') return null;
      h = h.slice(0, 6);
    } else if (h.length !== 6) return null;
    return '#' + h;
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join('');
  }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

export function analyzeCss(css) {
  const out = {
    bytes: css.length, rules: 0, mediaQueries: 0, widthMediaQueries: 0,
    fontFamilies: new Set(), fontSizes: new Set(), relFontSizes: 0, absFontSizes: 0,
    colors: new Map(), customProps: 0, colorTokens: 0,
    radii: new Set(), shadows: new Set(), spacings: new Set(),
    hover: false, focus: false, focusVisible: false, outlineNone: 0,
    reducedMotion: false, animations: 0, fontFaces: 0, fontDisplay: false,
    fixedWidths: [], contrastPairs: [], lineHeights: 0,
  };
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  out.mediaQueries = (noComments.match(/@media\b/gi) || []).length;
  out.widthMediaQueries = (noComments.match(/@media[^{]*(?:min|max)-width/gi) || []).length;
  out.reducedMotion = /prefers-reduced-motion/i.test(noComments);
  out.fontFaces = (noComments.match(/@font-face/gi) || []).length;
  out.fontDisplay = /font-display\s*:/i.test(noComments);
  out.hover = /:hover\b/.test(noComments);
  out.focus = /:focus\b/.test(noComments);
  out.focusVisible = /:focus-visible\b/.test(noComments);

  const blockRe = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(noComments))) {
    out.rules++;
    const sel = m[1].trim();
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).replace(/!important/i, '').trim();
      if (!prop || !val) continue;
      decls[prop] = val;
      if (prop.startsWith('--')) {
        out.customProps++;
        if (normColor(val)) out.colorTokens++;
      }
      for (const c of val.match(COLOR_TOKEN) || []) {
        const n = normColor(c);
        if (n) out.colors.set(n, (out.colors.get(n) || 0) + 1);
      }
      if (prop === 'font-family') out.fontFamilies.add(val.split(',')[0].replace(/["']/g, '').trim().toLowerCase());
      if (prop === 'font') {
        const fam = val.split(/\d(?:px|rem|em|%)?(?:\/[\d.]+\w*)?\s+/).pop();
        if (fam && !/^var\(/.test(fam)) out.fontFamilies.add(fam.split(',')[0].replace(/["']/g, '').trim().toLowerCase());
      }
      if (prop === 'font-size') {
        out.fontSizes.add(val);
        if (/(r?em|%|clamp|vw|var)\b|\(/.test(val)) out.relFontSizes++; else if (/px|pt/.test(val)) out.absFontSizes++;
      }
      if (prop === 'line-height') out.lineHeights++;
      if (prop === 'border-radius' && !/^0(px)?$/.test(val)) out.radii.add(val);
      if (prop === 'box-shadow' && val !== 'none') out.shadows.add(val);
      if (/^(margin|padding|gap)(-top|-bottom|-left|-right)?$/.test(prop)) for (const t of val.split(/\s+/)) if (/^\d/.test(t) && t !== '0') out.spacings.add(t);
      if ((prop === 'outline' || prop === 'outline-style') && /^(none|0)\b/.test(val) && /focus/.test(sel)) out.outlineNone++;
      if ((prop === 'outline' || prop === 'outline-style') && /^(none|0)\b/.test(val) && /^(\*|a|button|input)\b/.test(sel)) out.outlineNone++;
      if (prop === 'animation' || prop === 'animation-name') out.animations++;
      if (prop === 'width') {
        const w = val.match(/^(\d{3,5})px$/);
        if (w && +w[1] >= 1024) out.fixedWidths.push({ sel: sel.slice(0, 60), px: +w[1] });
      }
    }
    const fg = normColor(decls.color || '');
    const bgRaw = decls['background-color'] || (decls.background && (decls.background.match(COLOR_TOKEN) || [])[0]) || '';
    const bg = normColor(bgRaw.split(/\s/)[0] || '');
    if (fg && bg && !/:hover|:focus|:active|::selection|::placeholder/.test(sel)) {
      out.contrastPairs.push({ sel: sel.replace(/\s+/g, ' ').slice(0, 60), fg, bg, ratio: +contrast(fg, bg).toFixed(2) });
    }
  }
  return out;
}
