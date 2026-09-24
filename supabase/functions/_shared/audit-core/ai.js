// AI_ENGINE abstraction. Every adapter exposes:
//   analyze({ system, user, images: [{mime, base64}], schema }) → { data, usage }
// Select with env AI_ENGINE = claude | openai | gemini | mock, key in AI_API_KEY.

const DEFAULT_MODELS = { claude: 'claude-sonnet-5', openai: 'gpt-4.1', gemini: 'gemini-2.5-flash' };

async function postJson(url, headers, body, timeoutMs = 90000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      if (attempt) throw new Error(`AI request failed: ${e?.name === 'AbortError' ? 'timeout' : e?.message}`);
      continue;
    }
    clearTimeout(t);
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 2500)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 200)}`);
    return json;
  }
  throw new Error('AI request failed');
}

function parseJsonText(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  return JSON.parse(start > 0 ? clean.slice(start) : clean);
}

const adapters = {
  claude: (key, model) => ({
    async analyze({ system, user, images, schema }) {
      const content = [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: user }];
      const json = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
        model, max_tokens: 8000, system,
        tools: [{ name: 'submit_audit', description: 'Submit the structured website audit.', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'submit_audit' },
        messages: [{ role: 'user', content }],
      });
      const block = (json.content || []).find((b) => b.type === 'tool_use');
      if (!block) throw new Error('AI returned no structured output');
      return { data: block.input, usage: { input: json.usage?.input_tokens || 0, output: json.usage?.output_tokens || 0 } };
    },
  }),
  openai: (key, model) => ({
    async analyze({ system, user, images, schema }) {
      const content = [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))];
      const json = await postJson('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
        model, messages: [{ role: 'system', content: system }, { role: 'user', content }],
        response_format: { type: 'json_schema', json_schema: { name: 'website_audit', schema, strict: false } },
      });
      return { data: parseJsonText(json.choices?.[0]?.message?.content), usage: { input: json.usage?.prompt_tokens || 0, output: json.usage?.completion_tokens || 0 } };
    },
  }),
  gemini: (key, model) => ({
    async analyze({ system, user, images, schema }) {
      const parts = [{ text: `${user}\n\nReturn JSON matching this JSON Schema exactly:\n${JSON.stringify(schema)}` }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } }))];
      const json = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {}, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      });
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      return { data: parseJsonText(text), usage: { input: json.usageMetadata?.promptTokenCount || 0, output: json.usageMetadata?.candidatesTokenCount || 0 } };
    },
  }),
  // Mock adapter: no network, no invented findings. The report is built from
  // rule checks only and every AI-dependent score is marked as unavailable.
  mock: () => ({ async analyze() { return { data: null, usage: { input: 0, output: 0 }, skipped: true }; } }),
};

export function createAIEngine(env = {}) {
  let name = String(env.AI_ENGINE || 'mock').toLowerCase();
  if (name !== 'mock' && !env.AI_API_KEY) name = 'mock';
  if (!adapters[name]) name = 'mock';
  const model = env.AI_MODEL || DEFAULT_MODELS[name] || 'none';
  const vision = String(env.AI_VISION ?? 'true') !== 'false';
  const priceIn = +(env.AI_PRICE_INPUT_PER_MTOK || 3);
  const priceOut = +(env.AI_PRICE_OUTPUT_PER_MTOK || 15);
  return {
    name, model, vision,
    cost: (u) => +(((u.input * priceIn) + (u.output * priceOut)) / 1e6).toFixed(5),
    ...adapters[name](env.AI_API_KEY, model),
  };
}

// Validate & normalize the model output — never trust shape blindly.
const SEV = ['critical', 'high', 'medium', 'low'];
const PRI = ['P1', 'P2', 'P3'];
const CONF = ['high', 'medium', 'low'];
const s = (v, max = 1200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateAIResponse(raw, categories) {
  if (!raw || typeof raw !== 'object') throw new Error('AI response is not an object');
  const cats = new Set(categories);
  const clamp = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(100, Math.round(+n))) : null);
  const dimensions = {};
  for (const [c, dims] of Object.entries(raw.dimensions || {})) {
    if (!cats.has(c) || typeof dims !== 'object') continue;
    dimensions[c] = {};
    for (const [d, v] of Object.entries(dims)) { const n = clamp(v); if (n !== null) dimensions[c][d] = n; }
  }
  const issues = (Array.isArray(raw.issues) ? raw.issues : []).filter((i) => i && cats.has(i.category) && s(i.title) && s(i.recommendation)).slice(0, 14).map((i) => ({
    category: i.category, title: s(i.title, 160),
    severity: SEV.includes(i.severity) ? i.severity : 'medium',
    priority: PRI.includes(i.priority) ? i.priority : 'P2',
    impact: s(i.impact), why: s(i.why), recommendation: s(i.recommendation),
    steps: (Array.isArray(i.steps) ? i.steps : []).map((x) => s(x, 300)).filter(Boolean).slice(0, 5),
    evidenceType: i.evidence_type === 'observed' ? 'observed' : 'inferred',
    evidence: s(i.evidence, 400),
    confidence: CONF.includes(i.confidence) ? i.confidence : 'medium',
    view: ['desktop', 'mobile'].includes(i.view) ? i.view : null,
  }));
  return {
    summary: s(raw.summary, 1500),
    strengths: (Array.isArray(raw.strengths) ? raw.strengths : []).filter((x) => x && cats.has(x.category) && s(x.title)).slice(0, 8).map((x) => ({ category: x.category, title: s(x.title, 160), detail: s(x.detail, 400) })),
    dimensions,
    notes: Object.fromEntries(Object.entries(raw.category_notes || {}).filter(([c]) => cats.has(c)).map(([c, v]) => [c, s(v, 600)])),
    issues,
    priorities: (Array.isArray(raw.priorities) ? raw.priorities : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 3),
  };
}
