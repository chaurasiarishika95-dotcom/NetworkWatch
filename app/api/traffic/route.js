// Live road traffic from TomTom Routing (truck mode, traffic-aware).
//   GET /api/traffic[?lanes=A-B,C-D] -> North India lanes (all, or the listed ones): travel time, free-flow time, delay, road events, geometry
//   GET /api/traffic?from=JAI&to=DEL -> door-to-door road route with up to 2 alternatives
// Road traffic is kept separate from logistics capacity: a live road event is reported, but only simulated
// scenarios close lanes. Without a TomTom key the route returns { live:false } and the page uses estimates.
import { REGIONS } from '../../../lib/regions.js';
import { sbInsert } from '../../../lib/supabase.js';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // seconds (Vercel); lanes are fetched slowly to respect TomTom's rate limit

const key = () => process.env.TOMTOM_API_KEY || process.env.TOMTOM_KEY || process.env.NEXT_PUBLIC_TOMTOM_API_KEY || process.env.NEXT_PUBLIC_TOMTOM_KEY;
const cache = new Map(); const TTL = 10 * 60 * 1000; // 10 minutes, protects the free-tier quota
const thin = (pts, max = 60) => { const step = Math.max(1, Math.ceil(pts.length / max)); const out = pts.filter((_, i) => i % step === 0); if (pts.length) out.push(pts[pts.length - 1]); return out.map(p => [+p.latitude.toFixed(4), +p.longitude.toFixed(4)]); };

async function route(k, a, b, alternatives = 0) {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${a[0]},${a[1]}:${b[0]},${b[1]}/json?key=${k}&traffic=true&travelMode=truck&routeType=fastest&computeTravelTimeFor=all&sectionType=traffic&routeRepresentation=polyline&maxAlternatives=${alternatives}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('tomtom ' + r.status);
  const j = await r.json();
  return (j.routes || []).map(rt => {
    const s = rt.summary || {};
    const events = (rt.sections || []).filter(x => x.sectionType === 'TRAFFIC').map(x => x.simpleCategory || 'OTHER');
    return {
      km: (s.lengthInMeters || 0) / 1000, travelMin: (s.travelTimeInSeconds || 0) / 60,
      freeMin: (s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0)) / 60,
      delayMin: (s.trafficDelayInSeconds || 0) / 60,
      events: Object.entries(events.reduce((m, e) => (m[e] = (m[e] || 0) + 1, m), {})).map(([type, count]) => ({ type, count })),
      geometry: thin((rt.legs || []).flatMap(l => l.points || []))
    };
  });
}
// TomTom's free tier allows only a few requests per second, so calls are spaced out and 429s are retried.
// Each lane is cached separately for 10 minutes, so a refresh only re-fetches what is stale or missing.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function routeRetry(k, a, b, alt = 0) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await route(k, a, b, alt); }
    catch (e) { if (!String(e.message).includes('429') || attempt === 2) throw e; await sleep(700 * (attempt + 1)); }
  }
}
async function fetchLanes(k, keys, budgetMs = 20000) {
  const Rg = REGIONS.in, t0 = Date.now(), at = new Date().toISOString(), out = {}, failed = [];
  for (let i = 0; i < keys.length; i += 2) {
    if (Date.now() - t0 > budgetMs) { failed.push(...keys.slice(i)); break; }
    await Promise.all(keys.slice(i, i + 2).map(async key => {
      const [a, b] = key.split('-');
      try { const r = (await routeRetry(k, Rg.C[a], Rg.C[b]))[0]; if (r) { const v = { ...r, source: 'TomTom live traffic', at, live: true }; out[key] = v; cache.set('lane:' + key, { t: Date.now(), v }); } else failed.push(key); }
      catch { failed.push(key); }
    }));
    await sleep(450); // stay under ~5 requests per second
  }
  return { out, failed };
}

export async function GET(request) {
  const k = key(); const Rg = REGIONS.in; const at = new Date().toISOString();
  if (!k) return Response.json({ live: false, reason: 'No TomTom key configured. Travel times are estimated from road distance at 45 km/h.' });
  const { searchParams } = new URL(request.url), from = searchParams.get('from'), to = searchParams.get('to');
  try {
    if (from && to) {
      if (!Rg.C[from] || !Rg.C[to]) return Response.json({ error: 'Unknown hub' }, { status: 400 });
      const ck = `od:${from}-${to}`, hit = cache.get(ck);
      if (hit && Date.now() - hit.t < TTL) return Response.json(hit.v);
      const routes = await routeRetry(k, Rg.C[from], Rg.C[to], 2);
      const v = { live: true, source: 'TomTom Routing (truck, live traffic)', at, from, to, routes };
      cache.set(ck, { t: Date.now(), v }); return Response.json(v);
    }
    // ?lanes=DEL-AGR,AGR-LKO fetches those lanes first (the selected route); otherwise every lane.
    const all = Rg.L.map(([a, b]) => `${a}-${b}`);
    const want = (searchParams.get('lanes') || '').split(',').filter(x => all.includes(x));
    const keys = want.length ? want : all;
    const lanes = {}, stale = [];
    for (const key of keys) { const h = cache.get('lane:' + key); if (h && Date.now() - h.t < TTL) lanes[key] = h.v; else stale.push(key); }
    const { out, failed } = stale.length ? await fetchLanes(k, stale) : { out: {}, failed: [] };
    Object.assign(lanes, out);
    if (!Object.keys(lanes).length) throw new Error('no routes');
    const v = { live: true, source: 'TomTom Routing (truck, live traffic)', at: Object.values(lanes).map(x => x.at).sort().pop(), lanes, failed, requested: keys.length };
    // Best-effort observation log in Supabase (ignored if the table does not exist).
    sbInsert('nw_traffic_observations', Object.entries(out).map(([lane_key, l]) => ({ lane_key, travel_min: Math.round(l.travelMin), free_flow_min: Math.round(l.freeMin), delay_min: Math.round(l.delayMin), road_events: l.events, source: 'tomtom', observed_at: at }))).catch(() => {});
    return Response.json(v);
  } catch (e) {
    return Response.json({ live: false, reason: 'TomTom traffic is unavailable right now. Travel times are estimated.' }, { status: 200 });
  }
}
