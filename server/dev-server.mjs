// Local development server — no dependencies (Node 18+).
//   node server/dev-server.mjs
// Serves the SPA and exposes POST /api/audit with the SAME audit core the
// Supabase Edge Function uses. Audits are not persisted server-side here;
// the frontend stores history in the browser when Supabase is not configured.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, STAGES } from '../supabase/functions/_shared/audit-core/pipeline.js';
import { createAIEngine } from '../supabase/functions/_shared/audit-core/ai.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = process.env;
const PORT = +(env.PORT || 8787);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const MESSAGES = { en: 'The audit could not be completed.', ko: '분석을 완료하지 못했습니다.' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/health') {
    const e = createAIEngine(env);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, engine: e.name, model: e.model, screenshots: !!env.SCREENSHOT_URL_TEMPLATE }));
  }
  if (url.pathname === '/api/audit' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 10_000) break; }
    let input = {};
    try { input = JSON.parse(body || '{}'); } catch { /* noop */ }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('stages', { stages: STAGES });
    try {
      const report = await runAudit(input.url, { env, lang: input.lang === 'ko' ? 'ko' : 'en', tier: env.DEV_TIER || 'pro', onStage: (s) => send('stage', s), hooks: { log: (...a) => console.warn('[audit]', ...a) } });
      send('done', { report });
    } catch (e) {
      console.warn('[audit] failed', e?.code || '', e?.message);
      send('error', { code: e?.code || 'INTERNAL', message: MESSAGES[input.lang] || MESSAGES.en });
    }
    return res.end();
  }
  // Static files with SPA fallback.
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  let file = join(ROOT, p || 'index.html');
  try {
    const st = await stat(file);
    if (st.isDirectory()) { file = join(file, 'index.html'); await stat(file).catch(() => { file = join(ROOT, 'index.html'); }); }
  } catch {
    if (extname(p)) { res.writeHead(404); return res.end('Not found'); }
    file = join(ROOT, 'index.html');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});

server.listen(PORT, () => {
  const e = createAIEngine(env);
  console.log(`AI Design & Website Auditor → http://localhost:${PORT}`);
  console.log(`AI engine: ${e.name}${e.name === 'mock' ? ' (set AI_ENGINE + AI_API_KEY in .env for AI analysis)' : ' / ' + e.model}`);
});
