// Minimal Supabase REST (PostgREST) client. Server-side only. No extra npm dependency.
// Reads the standard variable names set by the Vercel–Supabase integration or by hand.
export function sbConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}
function headers(key, extra = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`; // legacy JWT keys; new sb_ keys go in apikey only
  return h;
}
// Returns { ok, data, missing, error }. missing = true when the table does not exist yet.
export async function sbSelect(table, query = 'select=*') {
  const cfg = sbConfig(); if (!cfg) return { ok: false, error: 'not-configured' };
  try {
    const r = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, { headers: headers(cfg.key), cache: 'no-store' });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, missing: r.status === 404 || body?.code === 'PGRST205' || body?.code === '42P01', error: body?.message || `HTTP ${r.status}` };
    return { ok: true, data: body || [] };
  } catch (e) { return { ok: false, error: 'network' }; }
}
export async function sbInsert(table, rows) {
  const cfg = sbConfig(); if (!cfg) return { ok: false, error: 'not-configured' };
  try {
    const r = await fetch(`${cfg.url}/rest/v1/${table}`, { method: 'POST', headers: headers(cfg.key, { Prefer: 'return=representation' }), body: JSON.stringify(rows) });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, missing: r.status === 404 || body?.code === 'PGRST205', error: body?.message || `HTTP ${r.status}` };
    return { ok: true, data: body || [] };
  } catch (e) { return { ok: false, error: 'network' }; }
}
