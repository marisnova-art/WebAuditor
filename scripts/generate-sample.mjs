// Builds the Sample Report by running the REAL audit pipeline against the
// bundled demo website (demo-site/). Network access is shimmed so the demo is
// served as https://tidewater-roasters.example. The AI step uses a stored,
// schema-validated analysis (scripts/sample-ai.json) instead of a live call.
//   node scripts/generate-sample.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../supabase/functions/_shared/audit-core/pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://tidewater-roasters.example';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'shots.sample') {
    const buf = await readFile(join(ROOT, 'assets', 'sample', `${url.searchParams.get('w') === '390' ? 'mobile' : 'desktop'}.jpg`));
    return new Response(buf, { headers: { 'content-type': 'image/jpeg' } });
  }
  if (url.origin !== HOST) return new Response('blocked', { status: 503 });
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(ROOT, 'demo-site', p));
    return new Response(init.method === 'HEAD' ? null : buf, { status: 200, headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'content-length': String(buf.length) } });
  } catch { return new Response('not found', { status: 404 }); }
};

const ai = JSON.parse(await readFile(join(ROOT, 'scripts', 'sample-ai.json'), 'utf8'));
ai.ko.dimensions = ai.en.dimensions;
const out = {};
for (const lang of ['en', 'ko']) {
  const engine = { name: 'claude', model: 'sample-analysis', vision: true, cost: () => 0, analyze: async () => ({ data: ai[lang], usage: { input: 0, output: 0 } }) };
  const report = await runAudit(HOST + '/', {
    lang, tier: 'pro', aiEngine: engine,
    env: { SCREENSHOT_URL_TEMPLATE: 'https://shots.sample/?u={url}&w={width}' },
    hooks: { storeScreenshot: async (view) => `/assets/sample/${view}.jpg` },
  });
  report.auditedAt = '2026-09-24T09:00:00.000Z';
  report.engine.model = 'sample-analysis';
  out[lang] = report;
  console.log(lang, 'overall', report.overall.score, 'issues', report.issues.length);
}
globalThis.fetch = realFetch;
await writeFile(join(ROOT, 'assets', 'sample', 'sample-report.json'), JSON.stringify(out));
const idx = join(ROOT, 'index.html');
const html = await readFile(idx, 'utf8');
const next = html.replace(/const SAMPLE_REPORTS = [^\n]*;/, `const SAMPLE_REPORTS = /*__SAMPLE_REPORTS__*/${JSON.stringify(out).replace(/</g, '\\u003c')};`);
await writeFile(idx, next);
console.log('Sample embedded into index.html');
