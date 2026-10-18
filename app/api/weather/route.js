// Live weather.
//   GET /api/weather?country=in -> Open-Meteo current conditions for every North India hub (gusts, rain, visibility),
//                                  with simple risk flags; logged to Supabase when the table exists.
//   GET /api/weather?region=<us region> -> National Weather Service alerts for the US view (original feature).
import { REGIONS } from '../../../lib/regions.js';
import { sbInsert } from '../../../lib/supabase.js';
export const dynamic = 'force-dynamic';

const REGION_STATES = {
  west: ['WA', 'OR', 'CA', 'NV', 'AZ', 'CO'], midwest: ['MN', 'WI', 'IL', 'MI', 'MO', 'KS'],
  northeast: ['NY', 'PA', 'MA', 'NJ', 'CT'], southeast: ['NC', 'SC', 'GA', 'FL', 'AL', 'TN'], plains: ['TX', 'OK', 'KS', 'NM', 'CO']
};

async function india() {
  const C = REGIONS.in.C, ids = Object.keys(C);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${ids.map(i => C[i][0]).join(',')}&longitude=${ids.map(i => C[i][1]).join(',')}&current=wind_gusts_10m,precipitation,visibility,weather_code&wind_speed_unit=mph&timezone=Asia%2FKolkata`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('open-meteo');
  const j = await r.json(), arr = Array.isArray(j) ? j : [j], nodes = {}, flags = [];
  ids.forEach((id, i) => {
    const c = arr[i]?.current || {};
    nodes[id] = { gust: c.wind_gusts_10m ?? 0, rain: c.precipitation ?? 0, vis: c.visibility ?? null, code: c.weather_code ?? null, time: c.time || null };
    const n = nodes[id], kmh = n.gust * 1.609;
    if (kmh >= 56) flags.push({ hub: id, type: 'Strong gusts', detail: `${Math.round(kmh)} km/h` });
    if (n.rain >= 2) flags.push({ hub: id, type: 'Heavy rain', detail: `${n.rain.toFixed(1)} mm/h` });
    if (n.vis != null && n.vis < 1000) flags.push({ hub: id, type: n.vis < 200 ? 'Dense fog / dust' : 'Low visibility', detail: `${Math.round(n.vis)} m` });
    if ([95, 96, 99].includes(n.code)) flags.push({ hub: id, type: 'Thunderstorm', detail: 'reported now' });
  });
  const fetchedAt = new Date().toISOString();
  sbInsert('nw_weather_observations', ids.map(id => ({ hub_code: id, gust_mph: nodes[id].gust, rain_mm_h: nodes[id].rain, visibility_m: nodes[id].vis, weather_code: nodes[id].code, source: 'open-meteo', observed_at: fetchedAt }))).catch(() => {});
  return { nodes, flags, alerts: [], source: 'Open-Meteo', fetchedAt };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get('country') === 'in') return Response.json(await india());
    const region = searchParams.get('region') || 'all', states = REGION_STATES[region];
    const urls = states ? states.map(s => `https://api.weather.gov/alerts/active?area=${s}`) : ['https://api.weather.gov/alerts/active'];
    const responses = await Promise.all(urls.map(u => fetch(u, { headers: { 'User-Agent': 'network-watch-portfolio-demo', Accept: 'application/geo+json' }, cache: 'no-store' }).catch(() => null)));
    const events = new Map(), seen = new Set();
    for (const res of responses) {
      if (!res?.ok) continue;
      const payload = await res.json();
      for (const ft of (payload.features || [])) {
        const p = ft.properties || {}, event = p.event || 'Weather alert', key = ft.id || `${event}:${p.headline || p.sent || ''}`;
        if (seen.has(key)) continue; seen.add(key); events.set(event, (events.get(event) || 0) + 1);
      }
    }
    const alerts = [...events.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([event, count]) => ({ event, count }));
    return Response.json({ alerts, region, fetchedAt: new Date().toISOString() });
  } catch (e) { return Response.json({ error: 'Live weather is unavailable right now.' }, { status: 502 }); }
}
