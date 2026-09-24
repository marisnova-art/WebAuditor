// ─────────────────────────────────────────────────────────────
// AUDIT_WEIGHTS — every number that shapes a score lives here.
// Admins can override any subtree at runtime through the
// `app_settings` row with key = 'audit_weights' (deep-merged).
// ─────────────────────────────────────────────────────────────
export const SCORING_VERSION = '1.0.0';

export const CATEGORIES = [
  'visual', 'ui', 'ux', 'ia', 'typography', 'color', 'responsive',
  'accessibility', 'seo', 'aeo', 'conversion', 'performance', 'content', 'brand',
];

export const AUDIT_WEIGHTS = {
  // Contribution of each category to the overall score.
  overall: {
    visual: 1.0, ui: 0.8, ux: 1.2, ia: 0.7, typography: 0.6, color: 0.5,
    responsive: 1.0, accessibility: 1.0, seo: 0.9, aeo: 0.6,
    conversion: 1.1, performance: 0.9, content: 0.8, brand: 0.6,
  },

  // How much of a category score comes from deterministic rule checks
  // (observed in HTML/CSS) versus the AI's qualitative assessment.
  // When AI is unavailable, the category falls back to rules only.
  blend: {
    visual: { rules: 0.25, ai: 0.75 },
    ui: { rules: 0.35, ai: 0.65 },
    ux: { rules: 0.30, ai: 0.70 },
    ia: { rules: 0.50, ai: 0.50 },
    typography: { rules: 0.50, ai: 0.50 },
    color: { rules: 0.50, ai: 0.50 },
    responsive: { rules: 0.70, ai: 0.30 },
    accessibility: { rules: 0.85, ai: 0.15 },
    seo: { rules: 0.90, ai: 0.10 },
    aeo: { rules: 0.60, ai: 0.40 },
    conversion: { rules: 0.40, ai: 0.60 },
    performance: { rules: 1.00, ai: 0.00 },
    content: { rules: 0.40, ai: 0.60 },
    brand: { rules: 0.30, ai: 0.70 },
  },

  // Sub-dimensions the AI rates 0–100 for each category, with weights.
  aiDimensions: {
    visual: { hierarchy: 1.3, composition: 1, balance: 0.7, whitespace: 0.9, contrast: 0.8, consistency: 1, rhythm: 0.6, modernity: 0.6, brand_expression: 0.6 },
    ui: { buttons: 1.2, forms: 0.8, cards: 0.6, navigation: 1, components: 0.8, states: 0.7, spacing: 0.9, iconography: 0.5 },
    ux: { user_flow: 1.2, navigation: 1, discoverability: 0.9, interaction: 0.7, cognitive_load: 1, clarity: 1.2, friction: 1 },
    ia: { navigation_structure: 1.2, content_hierarchy: 1.1, grouping: 0.9, findability: 1 },
    typography: { selection: 0.8, pairing: 0.7, hierarchy: 1.3, readability: 1.2, spacing: 0.8 },
    color: { palette: 1, contrast: 1.2, brand_consistency: 0.9, semantic_usage: 0.8 },
    responsive: { layout_adaptation: 1.2, typography_scaling: 0.8, navigation: 1, content_priority: 1 },
    accessibility: { perceivable: 1, operable: 1, understandable: 1 },
    seo: { content_relevance: 1 },
    aeo: { factual_clarity: 1.2, entity_clarity: 1, qa_structure: 0.8, trust_signals: 1 },
    conversion: { value_proposition: 1.3, cta: 1.2, trust: 1, friction: 1, journey: 0.9, pricing_clarity: 0.6 },
    performance: {},
    content: { clarity: 1.2, readability: 1, density: 0.8, messaging: 1.1, tone: 0.6, cta_copy: 0.8 },
    brand: { identity: 1.1, consistency: 1.1, tone: 0.8, imagery: 0.8, differentiation: 1 },
  },

  // Score thresholds used to label results.
  bands: { excellent: 85, good: 70, fair: 55 },

  // Ordering of issues in the report.
  severityRank: { critical: 4, high: 3, medium: 2, low: 1 },
  priorityRank: { P1: 3, P2: 2, P3: 1 },
};

export function mergeWeights(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? mergeWeights(base[k], v)
      : v;
  }
  return out;
}
