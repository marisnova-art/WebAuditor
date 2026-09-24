// Turns raw HTML (+ fetched CSS) into a structured `signals` object.
// Everything here is *observed* — no guessing.
import { prepare, tags, elements, headings, visibleText, bodyRange, stripTags } from './parse.js';

const CTA_WORDS = /\b(get started|start|try|sign ?up|join|buy|shop|order|book|subscribe|download|request|contact|demo|register|get|free trial|apply|reserve|add to cart|learn more)\b|시작|무료|가입|구매|주문|예약|구독|다운로드|문의|신청|체험|상담|장바구니/i;
const GENERIC_LINK = /^(click here|here|read more|more|learn more|details|link|this|자세히|더보기|여기|클릭)$/i;
const SOCIAL_PROOF = /testimonial|review|rating|stars?\b|customers|clients|trusted by|used by|case stud|as seen|award|partners|후기|리뷰|고객사|평점|수상|파트너/i;

export function extractSignals({ html, url, finalUrl, ttfb, htmlBytes, headers }) {
  const { clean, scripts, styles } = prepare(html);
  const all = tags(clean);
  const byName = (n) => all.filter((t) => t.name === n);
  const { start: bodyStart, end: bodyEnd } = bodyRange(clean);
  const bodyLen = Math.max(1, bodyEnd - bodyStart);
  const rel = (idx) => Math.max(0, Math.min(1, (idx - bodyStart) / bodyLen));
  const base = new URL(finalUrl || url);

  const metas = byName('meta');
  const meta = (k) => (metas.find((m) => (m.attrs.name || m.attrs.property || '').toLowerCase() === k) || {}).attrs?.content || '';
  const linksTags = byName('link');
  const linkRel = (r) => linksTags.filter((l) => (l.attrs.rel || '').toLowerCase().split(/\s+/).includes(r));

  const htmlTag = byName('html')[0]?.attrs || {};
  const titleEl = elements(clean, 'title')[0];
  const hs = headings(clean);
  const text = visibleText(clean);
  const words = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)) : [];
  // CJK text has no spaces: approximate words as chars/2 when it dominates.
  const cjkChars = (text.match(/[\u3131-\uD79D\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
  const wordCount = Math.max(words.length, Math.round(cjkChars / 2.2) + words.filter((w) => !/[\u3131-\uD79D]/.test(w)).length);
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const avgSentence = sentences.length ? sentences.reduce((a, s) => a + s.split(/\s+/).length, 0) / sentences.length : 0;
  const paragraphs = elements(clean, 'p').map((p) => p.text).filter(Boolean);

  // Navigation
  const navs = elements(clean, 'nav');
  const headerEl = elements(clean, 'header')[0];
  const navHtml = navs[0]?.inner || headerEl?.inner || '';
  const navLinks = [...navHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  const footerEl = elements(clean, 'footer').pop();
  const footerLinks = footerEl ? [...footerEl.inner.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1])).filter(Boolean) : [];

  // Links & CTAs
  const anchors = elements(clean, 'a').map((a) => {
    const href = a.attrs.href || '';
    let abs = null;
    try { abs = href && !/^(javascript:|mailto:|tel:|#)/i.test(href) ? new URL(href, base) : null; } catch { /* noop */ }
    const imgAlt = (a.inner.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)/i) || [])[1] || '';
    const name = a.text || a.attrs['aria-label'] || a.attrs.title || imgAlt;
    return { href, abs: abs?.href || null, internal: abs ? abs.host === base.host : href.startsWith('#'), text: a.text.slice(0, 80), name, cls: a.attrs.class || '', pos: rel(a.index), target: a.attrs.target, relAttr: a.attrs.rel || '' };
  });
  const buttons = elements(clean, 'button').map((b) => ({ text: b.text.slice(0, 80), name: b.text || b.attrs['aria-label'] || b.attrs.title || '', type: b.attrs.type || '', pos: rel(b.index) }));
  const inputButtons = byName('input').filter((i) => /^(submit|button)$/i.test(i.attrs.type || '')).map((i) => ({ text: i.attrs.value || '', name: i.attrs.value || i.attrs['aria-label'] || '', pos: rel(i.index) }));
  const navSet = new Set(navLinks.map((t) => t.toLowerCase()));
  const ctaCandidates = [
    ...buttons.filter((b) => b.type !== 'reset'),
    ...inputButtons,
    ...anchors.filter((a) => /\b(btn|button|cta)\b/i.test(a.cls) || (CTA_WORDS.test(a.text) && !navSet.has(a.text.toLowerCase()))),
  ].filter((c) => c.text && c.text.length <= 40 && CTA_WORDS.test(c.text));

  // Images
  const imgs = byName('img').map((i) => {
    let src = i.attrs.src || i.attrs['data-src'] || '';
    try { src = src && !src.startsWith('data:') ? new URL(src, base).href : src; } catch { /* noop */ }
    return { src, alt: i.attrs.alt, hasAlt: 'alt' in i.attrs, lazy: (i.attrs.loading || '').toLowerCase() === 'lazy' || 'data-src' in i.attrs, srcset: !!i.attrs.srcset, dims: !!(i.attrs.width && i.attrs.height), cls: i.attrs.class || '' };
  });
  const pictures = byName('picture').length + byName('source').filter((s) => s.attrs.srcset).length;

  // Forms
  const labels = elements(clean, 'label');
  const labelFor = new Set(labels.map((l) => l.attrs.for).filter(Boolean));
  const fieldTags = all.filter((t) => ['input', 'select', 'textarea'].includes(t.name) && !/^(hidden|submit|button|reset|image)$/i.test(t.attrs.type || ''));
  const wrappedCount = labels.reduce((n, l) => n + (l.inner.match(/<(input|select|textarea)\b/gi) || []).length, 0);
  const unlabeled = fieldTags.filter((f) => !(f.attrs.id && labelFor.has(f.attrs.id)) && !f.attrs['aria-label'] && !f.attrs['aria-labelledby'] && !f.attrs.title);
  const formBlocks = elements(clean, 'form').map((f) => ({ fields: (f.inner.match(/<(input|select|textarea)\b(?![^>]*type\s*=\s*["']?(hidden|submit|button)\b)/gi) || []).length }));

  // Scripts / styles / resources
  const headEnd = clean.search(/<\/head>/i);
  const scriptTags = all.filter((t) => t.name === 'script');
  const extScripts = scriptTags.filter((s) => s.attrs.src);
  const renderBlocking = extScripts.filter((s) => (headEnd < 0 || s.index < headEnd) && !('async' in s.attrs) && !('defer' in s.attrs) && (s.attrs.type || '').toLowerCase() !== 'module');
  const stylesheetHrefs = linkRel('stylesheet').map((l) => { try { return new URL(l.attrs.href, base).href; } catch { return null; } }).filter(Boolean);
  const inlineCss = styles.map((s) => s.body).join('\n');
  const styleAttrs = all.filter((t) => t.attrs.style).map((t) => `x{${t.attrs.style}}`).join('\n');
  const jsonLd = scripts.filter((s) => /ld\+json/i.test(s.attrs.type || '')).flatMap((s) => {
    try { const d = JSON.parse(s.body); return Array.isArray(d) ? d : d['@graph'] || [d]; } catch { return []; }
  });
  const ldTypes = [...new Set(jsonLd.flatMap((d) => [].concat(d?.['@type'] || [])).map(String))];
  const inlineScriptBytes = scripts.filter((s) => !s.attrs.src).reduce((a, s) => a + s.body.length, 0);

  const viewport = meta('viewport');
  const questionHeadings = hs.filter((h) => /\?\s*$|？\s*$/.test(h.text)).length;
  const firstH1 = hs.find((h) => h.level === 1);

  const lowerText = text.toLowerCase();
  const hrefs = anchors.map((a) => (a.href + ' ' + a.text).toLowerCase());
  const hasLink = (re) => hrefs.some((h) => re.test(h));

  const appShell = /<div[^>]+id\s*=\s*["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(clean);

  return {
    url, finalUrl: finalUrl || url, host: base.host, https: base.protocol === 'https:',
    ttfb, htmlBytes, server: headers?.get?.('server') || '',
    lang: htmlTag.lang || '',
    title: titleEl ? titleEl.text : '',
    metaDescription: meta('description'),
    robotsMeta: meta('robots'),
    viewport,
    zoomDisabled: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport),
    canonical: linkRel('canonical')[0]?.attrs.href || '',
    hreflang: linksTags.filter((l) => l.attrs.hreflang).length,
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image'), siteName: meta('og:site_name'), type: meta('og:type') },
    twitterCard: meta('twitter:card'),
    themeColor: meta('theme-color'),
    favicon: linkRel('icon').length + linkRel('shortcut').length + linkRel('apple-touch-icon').length > 0,
    author: meta('author') || (jsonLd.find((d) => d?.author)?.author?.name ?? ''),
    published: meta('article:published_time') || jsonLd.find((d) => d?.datePublished)?.datePublished || '',
    headings: hs,
    h1Count: hs.filter((h) => h.level === 1).length,
    h1Text: firstH1?.text || '',
    headingSkips: hs.reduce((n, h, i) => n + (i > 0 && h.level > hs[i - 1].level + 1 ? 1 : 0), 0),
    questionHeadings,
    detailsCount: byName('details').length,
    text: text.slice(0, 6000),
    wordCount,
    avgSentenceWords: +avgSentence.toFixed(1),
    longParagraphs: paragraphs.filter((p) => p.split(/\s+/).length > 120).length,
    paragraphCount: paragraphs.length,
    landmarks: { main: byName('main').length + all.filter((t) => t.attrs.role === 'main').length, nav: navs.length + all.filter((t) => t.attrs.role === 'navigation').length, header: byName('header').length, footer: byName('footer').length },
    navLinks: navLinks.slice(0, 40),
    footerLinks: footerLinks.slice(0, 60),
    breadcrumb: /breadcrumb/i.test(clean),
    search: byName('input').some((i) => (i.attrs.type || '') === 'search' || /search|검색/i.test(i.attrs.name || i.attrs.placeholder || '')) || all.some((t) => t.attrs.role === 'search'),
    links: { total: anchors.length, internal: anchors.filter((a) => a.internal).length, external: anchors.filter((a) => a.abs && !a.internal).length, emptyHash: anchors.filter((a) => a.href === '#' || a.href === '').length, unnamed: anchors.filter((a) => !a.name.trim()).length, generic: anchors.filter((a) => GENERIC_LINK.test(a.text.trim())).map((a) => a.text).slice(0, 10), blankNoopener: anchors.filter((a) => a.target === '_blank' && !/noopener|noreferrer/i.test(a.relAttr)).length },
    buttons: { total: buttons.length + inputButtons.length, unnamed: buttons.filter((b) => !b.name.trim()).length },
    ctas: ctaCandidates.map((c) => ({ text: c.text, pos: +c.pos.toFixed(3) })).slice(0, 30),
    images: { total: imgs.length, withAlt: imgs.filter((i) => i.hasAlt).length, emptyAlt: imgs.filter((i) => i.hasAlt && !i.alt).length, lazy: imgs.filter((i) => i.lazy).length, srcset: imgs.filter((i) => i.srcset).length + pictures, withDims: imgs.filter((i) => i.dims).length, modern: imgs.filter((i) => /\.(webp|avif)(\?|$)/i.test(i.src)).length + (/type\s*=\s*["']image\/(webp|avif)/i.test(clean) ? 1 : 0), list: imgs.slice(0, 60) },
    logo: imgs.some((i) => /logo/i.test(i.src + ' ' + (i.alt || '') + ' ' + i.cls)) || /class\s*=\s*["'][^"']*logo/i.test(clean),
    svgCount: byName('svg').length,
    forms: { count: formBlocks.length, maxFields: Math.max(0, ...formBlocks.map((f) => f.fields)), fields: fieldTags.length, unlabeled: Math.max(0, unlabeled.length - wrappedCount) },
    tabindexPositive: all.filter((t) => +t.attrs.tabindex > 0).length,
    scripts: { external: extScripts.length, inline: scriptTags.length - extScripts.length, inlineBytes: inlineScriptBytes, renderBlocking: renderBlocking.length, modules: scriptTags.filter((s) => s.attrs.type === 'module').length },
    stylesheets: stylesheetHrefs,
    inlineCss: inlineCss + '\n' + styleAttrs,
    fonts: { googleFonts: linksTags.some((l) => /fonts\.googleapis/i.test(l.attrs.href || '')), googleSwap: linksTags.some((l) => /fonts\.googleapis[^"']*display=swap/i.test(l.attrs.href || '')), preconnect: linkRel('preconnect').length, preload: linkRel('preload').length },
    iframes: byName('iframe').length,
    jsonLdTypes: ldTypes,
    socialProof: SOCIAL_PROOF.test(lowerText),
    pricingLink: hasLink(/pricing|plans|price|요금|가격/),
    aboutLink: hasLink(/about|company|team|소개|회사/),
    contactLink: hasLink(/contact|mailto:|tel:|문의|연락/) || /mailto:|tel:/i.test(clean),
    privacyLink: hasLink(/privacy|개인정보/),
    termsLink: hasLink(/terms|이용약관/),
    faqPresent: ldTypes.includes('FAQPage') || /\bfaq\b|frequently asked|자주 묻는/i.test(lowerText) || questionHeadings >= 2 || byName('details').length >= 3,
    appShell,
    iconFont: /font-?awesome|material-icons|material-symbols|bootstrap-icons|ionicons/i.test(clean),
    requestCount: extScripts.length + stylesheetHrefs.length + imgs.filter((i) => i.src && !i.src.startsWith('data:')).length + byName('iframe').length,
  };
}
