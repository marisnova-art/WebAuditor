// URL → capture → structure → visual → UX → accessibility → AI → report
import { AuditError, normalizeUrl, safeFetch, robotsAllows, toBase64, sha256 } from './fetcher.js';
import { extractSignals } from './extract.js';
import { analyzeCss } from './parse.js';
import { runRules } from './rules.js';
import { buildAuditPrompt, buildResponseSchema, PROMPT_VERSION } from './prompts.js';
import { createAIEngine, validateAIResponse } from './ai.js';
import { AUDIT_WEIGHTS, CATEGORIES, SCORING_VERSION, mergeWeights } from './weights.js';
import { planOf } from './plans.js';

export { AuditError };
export const STAGES = ['fetch', 'structure', 'visual', 'ux', 'accessibility', 'recommendations', 'report'];
const UX_STAGE_CATS = new Set(['visual', 'ui', 'ux', 'ia', 'typography', 'color', 'responsive', 'conversion', 'content', 'brand']);
const VISUAL_CATS = new Set(['visual', 'ui', 'brand', 'color', 'typography', 'responsive']);
const CONF = ['low', 'medium', 'high'];
const down = (c) => CONF[Math.max(0, CONF.indexOf(c) - 1)];

export async function runAudit(input, opts = {}) {
  const { env = {}, lang = 'en', tier = 'free', onStage = () => {}, hooks = {}, weightsOverride = null } = opts;
  const W = mergeWeights(AUDIT_WEIGHTS, weightsOverride);
  const L = lang === 'ko' ? 1 : 0;
  const allowPrivate = env.ALLOW_PRIVATE_HOSTS === '1';
  const plan = planOf(tier);
  const engine = opts.aiEngine || createAIEngine(env);
  const warnings = [];
  const stage = (id, status, extra = {}) => onStage({ id, status, ...extra });

  // 01 Fetch ─────────────────────────────────────────────────
  stage('fetch', 'running');
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(input || '').trim());
  let target = normalizeUrl(input, { allowPrivate });
  const cacheKey = await sha256([target.href, SCORING_VERSION, PROMPT_VERSION, lang, tier, engine.name, engine.model].join('|'));
  if (hooks.cacheGet) {
    const hit = await hooks.cacheGet(cacheKey).catch(() => null);
    if (hit) { for (const s of STAGES) stage(s, 'done', { cached: true }); return { ...hit, cached: true }; }
  }
  const origin = target.origin;
  const robotsRes = await safeFetch(`${origin}/robots.txt`, { timeout: 6000, maxBytes: 200_000, allowPrivate }).catch(() => null);
  const robotsTxt = robotsRes?.ok && !/<html/i.test(robotsRes.text.slice(0, 300)) ? robotsRes.text : '';
  if (String(env.RESPECT_ROBOTS ?? 'true') !== 'false' && !robotsAllows(robotsTxt, target.pathname + target.search)) {
    throw new AuditError('ROBOTS_DISALLOWED', target.href);
  }
  const pageOpts = { timeout: 15000, maxBytes: 3_000_000, allowPrivate, accept: 'text/html,application/xhtml+xml' };
  let page;
  try { page = await safeFetch(target.href, pageOpts); }
  catch (e) {
    // No scheme typed and HTTPS failed: retry once over HTTP.
    if (hadScheme || e.code !== 'UNREACHABLE' || target.protocol !== 'https:') throw e;
    target = normalizeUrl('http://' + target.host + target.pathname + target.search, { allowPrivate });
    page = await safeFetch(target.href, pageOpts);
  }
  if (page.status === 429) throw new AuditError('SITE_RATE_LIMITED', String(page.status));
  if (page.status === 401 || page.status === 403) throw new AuditError('BLOCKED_BY_SITE', String(page.status));
  if (!page.ok) throw new AuditError('HTTP_ERROR', String(page.status));
  const ctype = page.headers.get('content-type') || '';
  if (ctype && !/html|xml/i.test(ctype)) throw new AuditError('NOT_HTML', ctype);
  stage('fetch', 'done', { detail: `${page.status} · ${page.ttfb} ms` });

  // 02 Structure ─────────────────────────────────────────────
  stage('structure', 'running');
  let html = page.text;
  let signals = extractSignals({ html, url: target.href, finalUrl: page.url, ttfb: page.ttfb, htmlBytes: page.bytes, headers: page.headers });
  let jsHeavy = signals.appShell || (signals.wordCount < 60 && signals.scripts.external >= 3);
  if (jsHeavy && env.RENDER_URL_TEMPLATE) {
    try {
      const r = await fetch(env.RENDER_URL_TEMPLATE.replace('{url}', encodeURIComponent(page.url)), { signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        html = await r.text();
        signals = extractSignals({ html, url: target.href, finalUrl: page.url, ttfb: page.ttfb, htmlBytes: page.bytes, headers: page.headers });
        jsHeavy = signals.wordCount < 60;
        warnings.push('RENDERED');
      }
    } catch { /* fall through */ }
  }
  if (jsHeavy) warnings.push('JS_HEAVY');

  const cssTexts = [signals.inlineCss];
  const sheetResults = await Promise.all(signals.stylesheets.slice(0, 5).map((href) =>
    safeFetch(href, { timeout: 8000, maxBytes: 500_000, allowPrivate, accept: 'text/css' }).then((r) => (r.ok ? r.text : '')).catch(() => '')));
  cssTexts.push(...sheetResults);
  const cssText = cssTexts.join('\n');
  const cssFetched = cssText.replace(/\s/g, '').length > 200;

  const sitemapLine = (robotsTxt.match(/^\s*sitemap:\s*(\S+)/im) || [])[1];
  const sitemapRes = await safeFetch(sitemapLine || `${new URL(page.url).origin}/sitemap.xml`, { timeout: 6000, maxBytes: 60_000, allowPrivate }).catch(() => null);
  const sitemap = !!(sitemapRes?.ok && /<(urlset|sitemapindex)\b/i.test(sitemapRes.text));

  const imageSizes = (await Promise.all(signals.images.list.filter((i) => /^https?:/.test(i.src)).slice(0, 8).map((i) =>
    safeFetch(i.src, { method: 'HEAD', timeout: 5000, allowPrivate }).then((r) => ({ url: i.src, bytes: r.bytes })).catch(() => null)))).filter((x) => x && x.bytes > 0);

  if (signals.wordCount < 15 && signals.images.total === 0 && !cssFetched && !jsHeavy) throw new AuditError('INSUFFICIENT_DATA', 'empty document');
  stage('structure', 'done', { detail: `${signals.headings.length} headings · ${signals.links.total} links · ${signals.images.total} images` });

  // 03 Visual ────────────────────────────────────────────────
  stage('visual', 'running');
  const css = analyzeCss(cssText);
  const screenshots = [];
  if (env.SCREENSHOT_URL_TEMPLATE) {
    for (const [view, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      try {
        const u = env.SCREENSHOT_URL_TEMPLATE.replace('{url}', encodeURIComponent(page.url)).replace('{width}', width).replace('{height}', height);
        const r = await fetch(u, { signal: AbortSignal.timeout(45000) });
        const mime = (r.headers.get('content-type') || '').split(';')[0];
        if (!r.ok || !/^image\//.test(mime)) throw new Error(String(r.status));
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 4_500_000) throw new Error('too large');
        screenshots.push({ view, width, mime, bytes });
      } catch { warnings.push(`SCREENSHOT_FAILED_${view.toUpperCase()}`); }
    }
  }
  stage('visual', 'done', { detail: `${css.colors.size} colors · ${css.fontFamilies.size} typefaces · ${screenshots.length} screenshots` });

  // 04 UX + 05 Accessibility (rule engine) ──────────────────
  const ctx = { s: signals, css, x: { robotsTxt: !!robotsTxt, sitemap, cssFetched, imageSizes } };
  stage('ux', 'running');
  const all = runRules(ctx);
  const uxCount = all.filter((r) => UX_STAGE_CATS.has(r.cat)).length;
  stage('ux', 'done', { detail: `${uxCount} checks` });
  stage('accessibility', 'running');
  const techCount = all.length - uxCount;
  stage('accessibility', 'done', { detail: `${techCount} checks` });

  // 06 AI recommendations ────────────────────────────────────
  stage('recommendations', 'running');
  const aiCats = (plan.features.aiCategories === 'all' ? CATEGORIES : plan.features.aiCategories).filter((c) => (W.blend[c]?.ai || 0) > 0);
  let ai = null;
  let aiStatus = engine.name === 'mock' ? 'skipped' : 'pending';
  let usage = { input: 0, output: 0 };
  const ruleFindings = all.filter((r) => r.issue).map((r) => ({ id: r.id, cat: r.cat, detail: r.issue.detail }));
  if (engine.name !== 'mock') {
    try {
      const digest = buildDigest(signals, css, jsHeavy);
      const { system, user } = buildAuditPrompt({ categories: aiCats, digest, ruleFindings, lang, screenshots: engine.vision ? screenshots : [], weights: W });
      const images = engine.vision ? screenshots.map((s) => ({ mime: s.mime, base64: toBase64(s.bytes) })) : [];
      const out = await engine.analyze({ system, user, images, schema: buildResponseSchema(aiCats, W) });
      usage = out.usage || usage;
      if (out.data) { ai = validateAIResponse(out.data, aiCats); aiStatus = 'ok'; } else aiStatus = 'skipped';
    } catch (e) {
      aiStatus = 'failed';
      warnings.push('AI_FAILED');
      if (hooks.log) hooks.log('ai_error', String(e?.message || e));
    }
  }
  stage('recommendations', 'done', { detail: aiStatus === 'ok' ? `${ai.issues.length} AI findings` : aiStatus });

  // 07 Report ────────────────────────────────────────────────
  stage('report', 'running');
  const pick = (pair) => (Array.isArray(pair) ? pair[L] ?? pair[0] : pair);
  const categories = {};
  for (const cat of CATEGORIES) {
    const rr = all.filter((r) => r.cat === cat && r.v !== null && r.v !== undefined);
    const wsum = rr.reduce((a, r) => a + r.w, 0);
    const ruleScore = wsum ? (rr.reduce((a, r) => a + r.w * r.v, 0) / wsum) * 100 : null;
    const dims = ai?.dimensions?.[cat] || {};
    const dw = W.aiDimensions[cat] || {};
    const dkeys = Object.keys(dims).filter((k) => dw[k]);
    const aiScore = dkeys.length ? dkeys.reduce((a, k) => a + dims[k] * dw[k], 0) / dkeys.reduce((a, k) => a + dw[k], 0) : null;
    const b = W.blend[cat] || { rules: 1, ai: 0 };
    let score = null;
    if (ruleScore !== null && aiScore !== null) score = (b.rules * ruleScore + b.ai * aiScore) / (b.rules + b.ai);
    else score = ruleScore ?? aiScore;
    const covered = (ruleScore !== null ? b.rules : 0) + (aiScore !== null ? b.ai : 0);
    let confidence = covered >= 0.9 ? 'high' : covered >= 0.5 ? 'medium' : 'low';
    if (aiScore !== null && !screenshots.length && VISUAL_CATS.has(cat)) confidence = down(confidence);
    if (jsHeavy) confidence = down(confidence);
    categories[cat] = {
      score: score === null ? null : Math.round(score), confidence,
      ruleScore: ruleScore === null ? null : Math.round(ruleScore), aiScore: aiScore === null ? null : Math.round(aiScore),
      checks: { total: rr.length, passed: rr.filter((r) => r.v >= 0.9).length },
      subscores: dims, note: ai?.notes?.[cat] || '',
    };
  }
  const scored = CATEGORIES.filter((c) => categories[c].score !== null);
  const ow = scored.reduce((a, c) => a + (W.overall[c] || 0), 0);
  const overall = ow ? Math.round(scored.reduce((a, c) => a + categories[c].score * (W.overall[c] || 0), 0) / ow) : 0;
  const highShare = scored.reduce((a, c) => a + (categories[c].confidence !== 'low' ? W.overall[c] : 0), 0) / (Object.values(W.overall).reduce((a, v) => a + v, 0) || 1);
  const overallConfidence = highShare >= 0.75 ? 'high' : highShare >= 0.45 ? 'medium' : 'low';

  const detailed = plan.features.detailedRecommendations;
  const issues = [
    ...all.filter((r) => r.issue).map((r) => ({
      id: `r-${r.id}`, source: 'rule', category: r.cat,
      title: pick(r.issue.title), severity: r.issue.severity, priority: r.issue.priority,
      impact: pick(r.issue.impact), why: pick(r.issue.why), recommendation: pick(r.issue.rec), steps: [],
      evidence: { type: 'observed', detail: r.issue.detail }, confidence: r.issue.confidence, view: r.issue.view,
    })),
    ...(ai?.issues || []).map((i, n) => ({
      id: `a-${n + 1}`, source: 'ai', category: i.category, title: i.title, severity: i.severity, priority: i.priority,
      impact: i.impact, why: i.why, recommendation: i.recommendation, steps: detailed ? i.steps : [],
      evidence: { type: i.evidenceType, detail: i.evidence }, confidence: screenshots.length || i.evidenceType !== 'observed' ? i.confidence : down(i.confidence), view: i.view,
    })),
  ].sort((a, b) => (W.priorityRank[b.priority] - W.priorityRank[a.priority]) || (W.severityRank[b.severity] - W.severityRank[a.severity]) || ((W.overall[b.category] || 0) - (W.overall[a.category] || 0)));

  const strengths = [
    ...(ai?.strengths || []).map((x) => ({ ...x, source: 'ai' })),
    ...all.filter((r) => r.strength).map((r) => ({ category: r.cat, title: pick(r.strength.title), detail: r.strength.detail, source: 'rule' })),
  ].slice(0, 10);

  const ranked = [...scored].sort((a, b) => categories[b].score - categories[a].score);
  const catName = (c) => (L ? CAT_KO : CAT_EN)[c];
  const summaryText = ai?.summary || (L
    ? `${signals.host}의 종합 점수는 ${overall}점입니다. 상대적으로 강한 영역은 ${ranked.slice(0, 2).map(catName).join('·')}이며, ${issues.filter((i) => i.priority === 'P1').length}개의 즉시 개선 항목과 ${issues.length}개의 개선 항목이 확인되었습니다. ${aiStatus === 'ok' ? '' : '이 결과는 HTML·CSS에서 관찰된 규칙 기반 분석이며, 시각·브랜드 판단은 AI 분석이 연결되면 추가됩니다.'}`
    : `${signals.host} scores ${overall} overall. Its strongest areas are ${ranked.slice(0, 2).map(catName).join(' and ')}; the audit found ${issues.filter((i) => i.priority === 'P1').length} issues to fix immediately among ${issues.length} total. ${aiStatus === 'ok' ? '' : 'These results come from rule-based checks of the HTML and CSS; visual and brand judgments are added once an AI engine is connected.'}`).trim();

  const shots = {};
  for (const s of screenshots) {
    try {
      shots[s.view] = hooks.storeScreenshot ? await hooks.storeScreenshot(s.view, s.bytes, s.mime, cacheKey)
        : s.bytes.length < 1_200_000 ? `data:${s.mime};base64,${toBase64(s.bytes)}` : null;
    } catch { warnings.push('SCREENSHOT_STORE_FAILED'); }
  }

  const report = {
    version: 1, scoringVersion: SCORING_VERSION, promptVersion: PROMPT_VERSION,
    url: target.href, finalUrl: page.url, domain: signals.host, title: signals.title,
    auditedAt: new Date().toISOString(), lang, tier, limited: !detailed,
    overall: { score: overall, confidence: overallConfidence },
    categories,
    summary: {
      text: summaryText,
      strengths: strengths.slice(0, 3).map((x) => x.title),
      keyIssues: issues.slice(0, 3).map((i) => i.title),
      priorities: ai?.priorities?.length ? ai.priorities : issues.slice(0, 3).map((i) => i.recommendation),
    },
    strengths, issues,
    screenshots: shots,
    technical: {
      status: page.status, ttfbMs: signals.ttfb, htmlKB: Math.round(signals.htmlBytes / 1024), words: signals.wordCount,
      requests: signals.requestCount, scripts: signals.scripts.external, renderBlocking: signals.scripts.renderBlocking,
      stylesheets: signals.stylesheets.length, cssKB: Math.round(cssText.length / 1024), images: signals.images.total,
      mediaQueries: css.widthMediaQueries, fonts: [...css.fontFamilies].slice(0, 6),
      colors: [...css.colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c),
      jsonLd: signals.jsonLdTypes, robotsTxt: !!robotsTxt, sitemap, lang: signals.lang, https: signals.https,
      headings: signals.headings.slice(0, 30).map((h) => ({ level: h.level, text: h.text })),
    },
    checks: all.map((r) => ({ id: r.id, category: r.cat, value: r.v === null || r.v === undefined ? null : +r.v.toFixed(2) })),
    engine: { name: engine.name, model: engine.model, status: aiStatus, usage, costUsd: engine.cost ? engine.cost(usage) : 0 },
    warnings: [...new Set(warnings)],
    redesign: null, // Phase 2: AI redesign attaches { current, recommended } here.
  };
  if (hooks.cacheSet && aiStatus !== 'failed') await hooks.cacheSet(cacheKey, report).catch(() => {});
  stage('report', 'done');
  return report;
}

const CAT_EN = { visual: 'visual design', ui: 'UI', ux: 'UX', ia: 'information architecture', typography: 'typography', color: 'color', responsive: 'responsive design', accessibility: 'accessibility', seo: 'SEO', aeo: 'AEO', conversion: 'conversion', performance: 'performance', content: 'content', brand: 'brand' };
const CAT_KO = { visual: '비주얼 디자인', ui: 'UI', ux: 'UX', ia: '정보 구조', typography: '타이포그래피', color: '컬러', responsive: '반응형', accessibility: '접근성', seo: 'SEO', aeo: 'AEO', conversion: '전환', performance: '성능', content: '콘텐츠', brand: '브랜드' };

function buildDigest(s, css, jsHeavy) {
  return {
    url: s.finalUrl, title: s.title, metaDescription: s.metaDescription, lang: s.lang, h1: s.h1Text,
    headings: s.headings.slice(0, 40).map((h) => `H${h.level} ${h.text}`),
    navigation: s.navLinks, footer: s.footerLinks.slice(0, 25),
    ctas: s.ctas.slice(0, 12).map((c) => `${c.text} @${Math.round(c.pos * 100)}%`),
    forms: s.forms, images: { total: s.images.total, withAlt: s.images.withAlt }, logo: s.logo,
    trust: { socialProof: s.socialProof, pricing: s.pricingLink, about: s.aboutLink, contact: s.contactLink, privacy: s.privacyLink, faq: s.faqPresent },
    structuredData: s.jsonLdTypes, words: s.wordCount, avgSentenceWords: s.avgSentenceWords,
    css: { typefaces: [...css.fontFamilies].slice(0, 8), fontSizeValues: css.fontSizes.size, topColors: [...css.colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c), widthMediaQueries: css.widthMediaQueries, radii: [...css.radii].slice(0, 8), customProperties: css.customProps },
    visibleText: s.text.slice(0, 3500),
    note: jsHeavy ? 'Page appears to be client-rendered; initial HTML contains little content.' : undefined,
  };
}
