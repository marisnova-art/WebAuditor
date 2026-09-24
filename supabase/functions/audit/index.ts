// Supabase Edge Function: POST /functions/v1/audit
// Body: { url: string, lang?: 'en' | 'ko' }
// Streams Server-Sent Events: stages → stage* → done | error
// Deploy: supabase functions deploy audit --no-verify-jwt
//   (the function verifies the user JWT itself so anonymous trials also work)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAudit, STAGES } from '../_shared/audit-core/pipeline.js';
import { sha256, normalizeUrl } from '../_shared/audit-core/fetcher.js';
import { planOf, ANON_DAILY_LIMIT } from '../_shared/audit-core/plans.js';

const ENV_KEYS = ['AI_ENGINE', 'AI_API_KEY', 'AI_MODEL', 'AI_VISION', 'AI_PRICE_INPUT_PER_MTOK', 'AI_PRICE_OUTPUT_PER_MTOK', 'SCREENSHOT_URL_TEMPLATE', 'RENDER_URL_TEMPLATE', 'RESPECT_ROBOTS', 'ALLOW_PRIVATE_HOSTS'];
const env: Record<string, string> = Object.fromEntries(ENV_KEYS.map((k) => [k, Deno.env.get(k) ?? '']).filter(([, v]) => v));
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CACHE_HOURS = +(Deno.env.get('AUDIT_CACHE_HOURS') || 12);
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '*').split(',').map((s) => s.trim());

const MESSAGES: Record<string, string> = { en: 'The audit could not be completed.', ko: '분석을 완료하지 못했습니다.' };

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes('*') ? '*' : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { code: 'METHOD_NOT_ALLOWED' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let body: { url?: string; lang?: string } = {};
  try { body = await req.json(); } catch { return json(req, 400, { code: 'INVALID_URL' }); }
  const lang = body.lang === 'ko' ? 'ko' : 'en';

  // ── Identify the caller ───────────────────────────────────
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let user: { id: string; email?: string } | null = null;
  if (token) {
    const { data } = await admin.auth.getUser(token);
    user = data?.user ?? null;
  }

  // ── Enforce limits before any expensive work ─────────────
  let tier = 'free';
  let ipHash = '';
  if (user) {
    const { data: profile } = await admin.from('profiles').select('plan').eq('id', user.id).single();
    tier = profile?.plan || 'free';
    const plan = planOf(tier);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const { count } = await admin.from('audits').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).neq('status', 'failed').gte('created_at', monthStart);
    if ((count ?? 0) >= plan.monthlyAudits) return json(req, 402, { code: 'PLAN_LIMIT', limit: plan.monthlyAudits });
  } else {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    ipHash = await sha256(`${ip}|${Deno.env.get('ANON_SALT') || 'ada'}`);
    const since = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await admin.from('anon_usage').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
    if ((count ?? 0) >= ANON_DAILY_LIMIT) return json(req, 429, { code: 'RATE_LIMIT' });
  }

  // Scoring weights can be tuned by admins without redeploying.
  const { data: weightsRow } = await admin.from('app_settings').select('value').eq('key', 'audit_weights').maybeSingle();

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});

  (async () => {
    let auditId: string | null = null;
    let websiteId: string | null = null;
    try {
      await send('stages', { stages: STAGES });

      const target = normalizeUrl(body.url, { allowPrivate: env.ALLOW_PRIVATE_HOSTS === '1' });
      if (user) {
        const { data: site } = await admin.from('websites')
          .upsert({ user_id: user.id, url: target.origin + target.pathname, domain: target.host }, { onConflict: 'user_id,url' })
          .select('id').single();
        websiteId = site?.id ?? null;
        const { data: audit } = await admin.from('audits')
          .insert({ website_id: websiteId, user_id: user.id, url: target.href, status: 'running' }).select('id').single();
        auditId = audit?.id ?? null;
      } else {
        await admin.from('anon_usage').insert({ ip_hash: ipHash });
      }

      const report = await runAudit(body.url, {
        env, lang, tier,
        weightsOverride: weightsRow?.value ?? null,
        onStage: (s: unknown) => send('stage', s),
        hooks: {
          log: (...a: unknown[]) => console.warn('[audit]', ...a),
          cacheGet: async (key: string) => {
            const since = new Date(Date.now() - CACHE_HOURS * 3600_000).toISOString();
            const { data } = await admin.from('audit_cache').select('report').eq('key', key).gte('created_at', since).maybeSingle();
            return data?.report ?? null;
          },
          cacheSet: async (key: string, rep: unknown) => { await admin.from('audit_cache').upsert({ key, report: rep, created_at: new Date().toISOString() }); },
          storeScreenshot: async (view: string, bytes: Uint8Array, mime: string, key: string) => {
            const path = `${new Date().toISOString().slice(0, 7)}/${key.slice(0, 24)}-${view}.${mime.includes('png') ? 'png' : 'jpg'}`;
            const { error } = await admin.storage.from('screenshots').upload(path, bytes, { contentType: mime, upsert: true });
            if (error) throw error;
            return admin.storage.from('screenshots').getPublicUrl(path).data.publicUrl;
          },
        },
      });

      let reportId: string | null = null;
      if (user && auditId) {
        const now = new Date().toISOString();
        await admin.from('audits').update({
          overall_score: report.overall.score, status: 'completed', completed_at: now,
          scoring_version: report.scoringVersion, prompt_version: report.promptVersion, ai_engine: `${report.engine.name}:${report.engine.model}`,
        }).eq('id', auditId);
        if (websiteId && report.title) await admin.from('websites').update({ title: report.title.slice(0, 200) }).eq('id', websiteId);
        await admin.from('audit_categories').insert(Object.entries(report.categories).map(([category, c]: [string, any]) => ({
          audit_id: auditId, category, score: c.score, confidence: c.confidence, summary: c.note || null,
        })));
        if (report.issues.length) {
          await admin.from('audit_issues').insert(report.issues.map((i: any) => ({
            audit_id: auditId, category: i.category, title: i.title, severity: i.severity, priority: i.priority,
            impact: i.impact, reason: i.why, recommendation: i.recommendation, confidence: i.confidence,
            evidence_type: i.evidence.type, evidence: i.evidence.detail, source: i.source,
          })));
        }
        const { data: rep } = await admin.from('reports').insert({ audit_id: auditId, user_id: user.id, report_data: report }).select('id').single();
        reportId = rep?.id ?? null;
        if (report.engine.name !== 'mock' && !report.cached) {
          await admin.from('ai_usage').insert({
            audit_id: auditId, user_id: user.id, engine: report.engine.name, model: report.engine.model,
            input_tokens: report.engine.usage.input, output_tokens: report.engine.usage.output, est_cost_usd: report.engine.costUsd,
          });
        }
      }
      await send('done', { auditId, reportId, report });
    } catch (e) {
      const code = (e as { code?: string })?.code || 'INTERNAL';
      console.error('[audit] failed', code, (e as Error)?.message);
      if (auditId) await admin.from('audits').update({ status: 'failed', error_code: code }).eq('id', auditId);
      await send('error', { code, message: MESSAGES[lang] });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: { ...cors(req), 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
});
