// Plans & limits — single source of truth for the server.
// The frontend keeps a display copy in index.html (PLANS); keep both in sync.
export const PLANS = {
  free: {
    name: 'Free', priceUsd: 0, monthlyAudits: 2,
    features: {
      // AI reviews only these categories; everything else is rule-based.
      aiCategories: ['visual', 'ux', 'conversion', 'content'],
      detailedRecommendations: false, history: true, compare: false,
      pdfExport: false, shareableReports: false, whiteLabel: false, team: false,
    },
  },
  pro: {
    name: 'Pro', priceUsd: 19, monthlyAudits: 20,
    features: {
      aiCategories: 'all', detailedRecommendations: true, history: true, compare: true,
      pdfExport: true, shareableReports: false, whiteLabel: false, team: false,
    },
  },
  studio: {
    name: 'Studio', priceUsd: 49, monthlyAudits: 100,
    features: {
      aiCategories: 'all', detailedRecommendations: true, history: true, compare: true,
      pdfExport: true, shareableReports: true, whiteLabel: true, team: true,
    },
  },
};

// Anonymous visitors (not signed in) may run a small number of audits per day.
export const ANON_DAILY_LIMIT = 1;

export function planOf(id) { return PLANS[id] || PLANS.free; }
