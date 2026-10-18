// Operational data from Supabase (hubs, lanes, open orders, temporary capacity).
// Falls back to clearly labelled built-in sample data when Supabase or the tables are unavailable.
import { sbConfig, sbSelect } from '../../../lib/supabase.js';
export const dynamic = 'force-dynamic';

const H = 3600000;
export async function GET() {
  if (!sbConfig()) return Response.json({ source: 'sample', reason: 'Supabase is not configured, so built-in sample data is used.' });
  const [hubs, lanes, orders, temp] = await Promise.all([
    sbSelect('nw_hubs', 'select=code,name,capacity_per_day,is_sample'),
    sbSelect('nw_lanes', 'select=origin_code,dest_code,capacity_per_day,volume_per_day,road_km,is_sample'),
    sbSelect('nw_orders', "select=origin_code,dest_code,parcels,sla_tier,promised_at,eta_at,is_sample&status=neq.delivered&limit=20000"),
    sbSelect('nw_temp_capacity', 'select=hub_code,kind,capacity_parcels,activation_hours,cost_per_parcel,available,is_sample&available=eq.true')
  ]);
  const missing = Object.entries({ nw_hubs: hubs, nw_lanes: lanes, nw_orders: orders, nw_temp_capacity: temp }).filter(([, r]) => !r.ok).map(([t, r]) => `${t} (${r.missing ? 'table not found' : r.error})`);
  const any = [hubs, lanes, orders, temp].some(r => r.ok && r.data.length);
  if (!any) return Response.json({ source: 'sample', reason: missing.length ? 'Supabase is connected but the Network Watch tables are missing or empty. Run supabase/schema.sql and supabase/seed_sample.sql.' : 'Supabase tables are empty, so built-in sample data is used.', missing });

  const overrides = { lanes: {}, hubs: {}, costs: {} };
  for (const h of hubs.data || []) if (h.capacity_per_day) overrides.hubs[h.code] = { cap: +h.capacity_per_day };
  for (const l of lanes.data || []) overrides.lanes[`${l.origin_code}-${l.dest_code}`] = { cap: +l.capacity_per_day || undefined, vol: +l.volume_per_day || undefined, km: +l.road_km || undefined };

  // Temporary capacity: cheapest available option of each kind; sort shifts can carry a capacity per hub.
  const t = temp.data || [];
  const pick = kind => t.filter(r => r.kind === kind).sort((a, b) => a.cost_per_parcel - b.cost_per_parcel);
  const shifts = pick('shift'), vehicles = pick('vehicle');
  if (shifts.length) overrides.costs.shift = { cost: +shifts[0].cost_per_parcel, activationH: +shifts[0].activation_hours, capByHub: Object.fromEntries(shifts.map(s => [s.hub_code, +s.capacity_parcels])) };
  if (vehicles.length) overrides.costs.laneTemp = { cost: +vehicles[0].cost_per_parcel, activationH: +vehicles[0].activation_hours };

  // Orders -> per-lane profile: SLA-critical share and cumulative share of parcels by promise slack.
  const byLane = {};
  for (const o of orders.data || []) {
    const k = `${o.origin_code}-${o.dest_code}`, p = +o.parcels || 1;
    const slackH = o.promised_at && o.eta_at ? (new Date(o.promised_at) - new Date(o.eta_at)) / H : 24;
    const b = (byLane[k] ||= { total: 0, crit: 0, b: [0, 0, 0, 0] });
    b.total += p; if (o.sla_tier === 'critical') b.crit += p;
    [2, 4, 8, 24].forEach((lim, i) => { if (slackH < lim) b.b[i] += p; });
  }
  const sampleFlag = [hubs, lanes, orders, temp].some(r => (r.data || []).some(x => x.is_sample));
  const orderProfiles = Object.fromEntries(Object.entries(byLane).map(([k, b]) => [k, {
    critShare: b.crit / b.total, slackCum: [2, 4, 8, 24].map((lim, i) => [lim, b.b[i] / b.total]), source: sampleFlag ? 'Supabase (sample rows)' : 'Supabase', parcels: b.total
  }]));
  return Response.json({
    source: 'supabase', sample: sampleFlag, fetchedAt: new Date().toISOString(), missing,
    counts: { hubs: hubs.data?.length || 0, lanes: lanes.data?.length || 0, orders: orders.data?.length || 0, tempCapacity: t.length },
    overrides, orders: orderProfiles
  });
}
