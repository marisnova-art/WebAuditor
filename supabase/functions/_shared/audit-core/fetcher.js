// Network layer: URL validation, SSRF guard, robots.txt, bounded fetches.

export class AuditError extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? ': ' + detail : ''}`); this.code = code; this.detail = detail; }
}

export const USER_AGENT = 'Mozilla/5.0 (compatible; AIDesignAuditor/1.0; +https://github.com/your-org/ai-design-auditor)';
const BOT_TOKEN = 'aidesignauditor';

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function normalizeUrl(input, { allowPrivate = false } = {}) {
  let raw = String(input || '').trim();
  if (!raw) throw new AuditError('INVALID_URL', 'empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { throw new AuditError('INVALID_URL', raw); }
  if (!/^https?:$/.test(u.protocol)) throw new AuditError('INVALID_URL', 'protocol');
  if (u.username || u.password) throw new AuditError('INVALID_URL', 'credentials');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && host !== 'localhost') throw new AuditError('INVALID_URL', 'host');
  if (!allowPrivate) {
    const blocked = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || PRIVATE_V4.some((r) => r.test(host)) || host.includes(':') /* raw IPv6 */
      || host === 'metadata.google.internal';
    if (blocked) throw new AuditError('BLOCKED_HOST', host);
    if (u.port && !['80', '443'].includes(u.port)) throw new AuditError('BLOCKED_HOST', 'port');
  }
  u.hash = '';
  return u;
}

async function readCapped(res, maxBytes) {
  if (!res.body) return { buf: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { truncated = true; chunks.push(value.slice(0, value.length - (size - maxBytes))); try { await reader.cancel(); } catch { /* noop */ } break; }
    chunks.push(value);
  }
  const buf = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return { buf, truncated };
}

// Fetch with manual redirects so every hop is re-validated (SSRF guard).
export async function safeFetch(url, { timeout = 12000, maxBytes = 3_000_000, method = 'GET', allowPrivate = false, accept = '*/*', binary = false } = {}) {
  let current = normalizeUrl(url, { allowPrivate });
  const started = Date.now();
  for (let hop = 0; hop < 6; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(current.href, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en,ko;q=0.8' } });
    } catch (e) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') throw new AuditError('TIMEOUT', current.href);
      throw new AuditError('UNREACHABLE', String(e?.message || e));
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      current = normalizeUrl(new URL(res.headers.get('location'), current).href, { allowPrivate });
      continue;
    }
    const ttfb = Date.now() - started;
    let body = null, truncated = false;
    if (method !== 'HEAD') {
      try { ({ buf: body, truncated } = await readCapped(res, maxBytes)); }
      catch (e) { clearTimeout(timer); throw new AuditError(e?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE', current.href); }
    }
    clearTimeout(timer);
    return {
      status: res.status, ok: res.ok, url: current.href, headers: res.headers, ttfb, ms: Date.now() - started, truncated,
      bytes: body ? body.length : +(res.headers.get('content-length') || 0),
      body: binary ? body : null,
      text: !binary && body ? new TextDecoder('utf-8', { fatal: false }).decode(body) : '',
    };
  }
  throw new AuditError('UNREACHABLE', 'too many redirects');
}

// Minimal robots.txt evaluation for our bot and '*'.
export function robotsAllows(robotsTxt, path) {
  if (!robotsTxt) return true;
  const groups = [];
  let cur = null;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, '').trim();
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && cur) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const pick = groups.find((g) => g.agents.some((a) => a.includes(BOT_TOKEN))) || groups.find((g) => g.agents.includes('*'));
  if (!pick) return true;
  let best = { len: -1, allow: true };
  for (const r of pick.rules) {
    if (!r.path) continue;
    const pat = '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(pat).test(path) && r.path.length > best.len) best = { len: r.path.length, allow: r.allow };
  }
  return best.allow;
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
