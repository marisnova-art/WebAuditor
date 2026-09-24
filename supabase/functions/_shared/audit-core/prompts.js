// Prompt architecture: one system prompt + one module per category.
// Modules are assembled into a single request (one API call per audit)
// so each can be edited and versioned independently without raising cost.
import { AUDIT_WEIGHTS } from './weights.js';

export const PROMPT_VERSION = '2026-09-24.1';

export const AUDIT_SYSTEM_PROMPT = `You are a senior product designer and web design auditor with deep expertise in UX, UI, accessibility (WCAG 2.2), SEO, answer-engine optimization, conversion design and brand systems.
You audit a single web page from evidence supplied by an automated crawler (extracted HTML signals, CSS metrics, visible text) and, when provided, screenshots.

Rules you must follow:
1. Separate what you OBSERVED (directly visible in screenshots or in the supplied data) from what you INFER. Never state unverifiable facts (traffic, conversion rates, revenue, user behavior) as facts; use conditional language ("may create friction", "is likely to").
2. Every issue must be specific to THIS page: name the element, text, section or pattern. Generic advice ("improve the design") is not acceptable.
3. Every recommendation must be actionable: say what to change, where, and how (size, spacing, contrast, copy, order, markup).
4. Do not repeat findings that the rule engine already reported (listed under RULE_FINDINGS). Add qualitative judgment the rules cannot make.
5. Confidence: "high" only when directly observed; "medium" when strongly supported by data; "low" when inferred without screenshots.
6. Report genuine strengths too — concrete things that work.
7. Scores: 0–100 per dimension, calibrated so 50 = typical small-business site, 75 = solid professional site, 90+ = best-in-class. If you cannot judge a dimension, omit it rather than guessing.
8. Respond ONLY through the structured output. Write all human-readable text in {{LANGUAGE}}.`;

export const AUDIT_VISUAL_PROMPT = `VISUAL DESIGN — Judge visual hierarchy (does the eye land on the most important thing first?), composition, balance, whitespace, contrast, consistency, visual rhythm, modernity and brand expression. Reference specific sections (hero, feature grid, footer…).`;
export const AUDIT_UI_PROMPT = `UI DESIGN — Judge buttons (primary vs secondary distinction), forms, cards, navigation, component consistency, interactive states, spacing system, borders/radius usage and iconography.`;
export const AUDIT_UX_PROMPT = `UX — Judge the primary user flow for the page's evident goal, navigation, discoverability, interaction clarity, cognitive load, friction and whether user goals can be met quickly.`;
export const AUDIT_IA_PROMPT = `INFORMATION ARCHITECTURE — Judge navigation structure and labels, content and page hierarchy, grouping of information and findability, using the headings outline and navigation labels.`;
export const AUDIT_TYPOGRAPHY_PROMPT = `TYPOGRAPHY — Judge typeface selection and pairing, hierarchy between heading levels, sizes, weights, line-height, letter-spacing and readability.`;
export const AUDIT_COLOR_PROMPT = `COLOR — Judge the palette (primary/secondary/accent), contrast, semantic color usage and consistency with the brand.`;
export const AUDIT_RESPONSIVE_PROMPT = `RESPONSIVE — If a mobile screenshot is provided, judge layout adaptation, type scaling, navigation, touch targets, overflow and content priority on small screens. Without a mobile screenshot, rely on CSS metrics and keep confidence low.`;
export const AUDIT_ACCESSIBILITY_PROMPT = `ACCESSIBILITY — Beyond the rule findings, judge perceivability (contrast of text over images, text in images), operability (target sizes, focus visibility cues) and understandability (clear labels, error prevention).`;
export const AUDIT_SEO_PROMPT = `SEO — Judge only how well the visible content and headings match the page's apparent search intent. Technical SEO is already covered by rules.`;
export const AUDIT_AEO_PROMPT = `AEO — Judge whether answer engines (AI search) could extract clear factual statements: who this is, what they offer, for whom, where, at what price; entity clarity, Q&A structure and trust signals.`;
export const AUDIT_CONVERSION_PROMPT = `CONVERSION — Judge the value proposition (clear within 5 seconds?), CTA clarity and prominence, trust and social proof, friction, form burden, journey continuity and pricing clarity. Do not claim actual conversion rates.`;
export const AUDIT_CONTENT_PROMPT = `CONTENT — Judge clarity, readability, information density, messaging, tone, CTA copy and content hierarchy. Quote short fragments of the actual copy as evidence.`;
export const AUDIT_BRAND_PROMPT = `BRAND — Judge visual identity, consistency, tone of voice, imagery and differentiation from generic competitors in the same space.`;

export const PROMPT_MODULES = {
  visual: AUDIT_VISUAL_PROMPT, ui: AUDIT_UI_PROMPT, ux: AUDIT_UX_PROMPT, ia: AUDIT_IA_PROMPT,
  typography: AUDIT_TYPOGRAPHY_PROMPT, color: AUDIT_COLOR_PROMPT, responsive: AUDIT_RESPONSIVE_PROMPT,
  accessibility: AUDIT_ACCESSIBILITY_PROMPT, seo: AUDIT_SEO_PROMPT, aeo: AUDIT_AEO_PROMPT,
  conversion: AUDIT_CONVERSION_PROMPT, content: AUDIT_CONTENT_PROMPT, brand: AUDIT_BRAND_PROMPT,
};

export function buildResponseSchema(categories, weights = AUDIT_WEIGHTS) {
  const dimProps = {};
  for (const c of categories) {
    const dims = Object.keys(weights.aiDimensions[c] || {});
    if (!dims.length) continue;
    dimProps[c] = { type: 'object', properties: Object.fromEntries(dims.map((d) => [d, { type: 'number', minimum: 0, maximum: 100 }])) };
  }
  const str = { type: 'string' };
  return {
    type: 'object',
    required: ['summary', 'strengths', 'dimensions', 'category_notes', 'issues', 'priorities'],
    properties: {
      summary: { ...str, description: '3–4 sentence executive summary of the page.' },
      strengths: { type: 'array', maxItems: 8, items: { type: 'object', required: ['category', 'title', 'detail'], properties: { category: { type: 'string', enum: categories }, title: str, detail: str } } },
      dimensions: { type: 'object', properties: dimProps },
      category_notes: { type: 'object', properties: Object.fromEntries(categories.map((c) => [c, str])) },
      issues: {
        type: 'array', maxItems: 14,
        items: {
          type: 'object',
          required: ['category', 'title', 'severity', 'priority', 'impact', 'why', 'recommendation', 'steps', 'evidence_type', 'evidence', 'confidence'],
          properties: {
            category: { type: 'string', enum: categories },
            title: str,
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
            impact: { ...str, description: 'What happens to users because of this.' },
            why: { ...str, description: 'Root cause of the problem.' },
            recommendation: { ...str, description: 'Specific change to make.' },
            steps: { type: 'array', items: str, maxItems: 5 },
            evidence_type: { type: 'string', enum: ['observed', 'inferred'] },
            evidence: { ...str, description: 'The concrete element, copy or data point.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            view: { type: 'string', enum: ['desktop', 'mobile', 'none'] },
          },
        },
      },
      priorities: { type: 'array', maxItems: 3, items: str, description: 'Top three actions, most impactful first.' },
    },
  };
}

export function buildAuditPrompt({ categories, digest, ruleFindings, lang, screenshots, weights = AUDIT_WEIGHTS }) {
  const language = lang === 'ko' ? 'Korean (한국어)' : 'English';
  const system = AUDIT_SYSTEM_PROMPT.replace('{{LANGUAGE}}', language);
  const modules = categories.filter((c) => PROMPT_MODULES[c]).map((c) => {
    const dims = Object.keys(weights.aiDimensions[c] || {});
    return `${PROMPT_MODULES[c]}\n  Rate dimensions: ${dims.join(', ') || '(none)'}`;
  }).join('\n\n');
  const shots = screenshots.length ? `Screenshots attached: ${screenshots.map((s) => `${s.view} (${s.width}px wide)`).join(', ')}.` : 'No screenshots are available — base visual judgments on the extracted data and set confidence to "low" for purely visual claims.';
  const user = `Audit this page.

URL: ${digest.url}
${shots}

CATEGORY MODULES
${modules}

PAGE_DATA (extracted by crawler)
${JSON.stringify(digest, null, 0)}

RULE_FINDINGS (already reported — do not repeat)
${ruleFindings.map((f) => `- [${f.cat}] ${f.id}: ${f.detail}`).join('\n') || '- none'}

Return at most 14 issues, ordered by importance.`;
  return { system, user };
}
