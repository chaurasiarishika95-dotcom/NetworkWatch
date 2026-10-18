// Live road traffic from TomTom Routing (truck mode, traffic-aware).
//   GET /api/traffic             -> every North India lane: travel time, free-flow time, delay, road events, geometry
//   GET /api/traffic?from=JAI&to=DEL -> door-to-door road route with up to 2 alternatives
// Road traffic is kept separate from logistics capacity: a live road event is reported, but only simulated
// scenarios close lanes. Without a TomTom key the route returns { live:false } and the page uses estimates.
import { REGIONS } from '../../../lib/regions.js';
import { sbInsert } from '../../../lib/supabase.js';
export const dynamic = 'force-dynamic';

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
async function pool(tasks, n = 6) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const my = i++; out[my] = await tasks[my]().catch(() => null); } })); return out; }

export async function GET(request) {
  const k = key(); const Rg = REGIONS.in; const at = new Date().toISOString();
  if (!k) return Response.json({ live: false, reason: 'No TomTom key configured. Travel times are estimated from road distance at 45 km/h.' });
  const { searchParams } = new URL(request.url), from = searchParams.get('from'), to = searchParams.get('to');
  try {
    if (from && to) {
      if (!Rg.C[from] || !Rg.C[to]) return Response.json({ error: 'Unknown hub' }, { status: 400 });
      const ck = `od:${from}-${to}`, hit = cache.get(ck);
      if (hit && Date.now() - hit.t < TTL) return Response.json(hit.v);
      const routes = await route(k, Rg.C[from], Rg.C[to], 2);
      const v = { live: true, source: 'TomTom Routing (truck, live traffic)', at, from, to, routes };
      cache.set(ck, { t: Date.now(), v }); return Response.json(v);
    }
    const hit = cache.get('lanes');
    if (hit && Date.now() - hit.t < TTL) return Response.json({ ...hit.v, cached: true });
    const res = await pool(Rg.L.map(([a, b]) => () => route(k, Rg.C[a], Rg.C[b]).then(r => r[0])));
    const lanes = {};
    Rg.L.forEach(([a, b], i) => { const r = res[i]; if (r) lanes[`${a}-${b}`] = { ...r, source: 'TomTom live traffic', at, live: true }; });
    if (!Object.keys(lanes).length) throw new Error('no routes');
    const v = { live: true, source: 'TomTom Routing (truck, live traffic)', at, lanes, failed: Rg.L.length - Object.keys(lanes).length };
    cache.set('lanes', { t: Date.now(), v });
    // Best-effort observation log in Supabase (ignored if the table does not exist).
    sbInsert('nw_traffic_observations', Object.entries(lanes).map(([lane_key, l]) => ({ lane_key, travel_min: Math.round(l.travelMin), free_flow_min: Math.round(l.freeMin), delay_min: Math.round(l.delayMin), road_events: l.events, source: 'tomtom', observed_at: at }))).catch(() => {});
    return Response.json(v);
  } catch (e) {
    return Response.json({ live: false, reason: 'TomTom traffic is unavailable right now. Travel times are estimated.' }, { status: 200 });
  }
}
