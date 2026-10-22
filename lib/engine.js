// Network Watch analysis engine. Shared by the page (browser) and the copilot API (server),
// so every number the copilot quotes comes from the same calculation the screen shows.
// Rule-based model, not machine learning. All thresholds and costs are assumptions (see lib/regions.js).
import { REGIONS, US_REGION_HUBS, US_REGION_LABELS } from './regions.js';

export const cl = x => Math.max(0, Math.min(1, x));

// Weather -> hub capacity cut (0..1).
// Gusts above 35 mph start cutting (full at 90). Rain cuts up to 50%. Snow up to 60%.
// Fog: visibility below 1000 m starts cutting, up to 50% at 100 m (North India addition).
export const cutOf = w => !w ? 0 : Math.max(
  cl(((w.gust || 0) - 35) / 55),
  0.5 * cl(((w.rain || 0) - 2) / 18),
  0.6 * cl(((w.snow || 0) - 0.5) / 3.5),
  w.vis == null ? 0 : 0.5 * cl((1000 - w.vis) / 900)
);

const kmStraight = (Rg, a, b) => {
  const [la1, lo1] = Rg.C[a], [la2, lo2] = Rg.C[b];
  return Math.hypot((lo1 - lo2) * Math.cos((la1 + la2) * Math.PI / 360), la1 - la2) * 111;
};
const laneKey = (a, b) => a + '-' + b;

// ---------- Region set-up ----------
function scopedUSRegion(base, key) {
  if (!key || key === 'all') return base;
  const allowed = new Set(US_REGION_HUBS[key] || US_REGION_HUBS.all);
  const ids = Object.keys(base.P).filter(id => allowed.has(id));
  const raw = ids.map(id => base.P[id]), xs = raw.map(v => v[0]), ys = raw.map(v => v[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(760 / Math.max(1, maxX - minX), 455 / Math.max(1, maxY - minY));
  const usedW = (maxX - minX) * scale, usedH = (maxY - minY) * scale, startX = (900 - usedW) / 2, startY = (600 - usedH) / 2;
  const P = Object.fromEntries(ids.map(id => [id, [Math.round(startX + (base.P[id][0] - minX) * scale), Math.round(startY + (base.P[id][1] - minY) * scale)]]));
  const keepWx = wx => Object.fromEntries(Object.entries(wx).filter(([id]) => allowed.has(id)));
  const SC = Object.fromEntries(Object.entries(base.SC).filter(([, sc]) => Object.entries(sc.wx).some(([id, w]) => allowed.has(id) && cutOf(w) > 0)).map(([id, sc]) => [id, { ...sc, wx: keepWx(sc.wx) }]));
  return {
    ...base, name: `United States — ${US_REGION_LABELS[key]}`,
    hint: `Viewing ${US_REGION_LABELS[key]} hubs and connecting lanes. "Live now" loads current weather for these hubs; saved scenarios are illustrative stress tests.`,
    P, NM: Object.fromEntries(ids.map(id => [id, base.NM[id]])), C: Object.fromEntries(ids.map(id => [id, base.C[id]])),
    L: base.L.filter(([a, b]) => allowed.has(a) && allowed.has(b)), SC
  };
}

// overrides = { lanes: { 'A-B': {cap, vol, km} }, hubs: { ID: {cap} }, costs: {shift:{...}, laneTemp:{...}} } from Supabase (optional).
export function getRegion(id, { usRegion = 'all', overrides = null } = {}) {
  let Rg = REGIONS[id] || REGIONS.in;
  if (Rg.id === 'us') Rg = scopedUSRegion(Rg, usRegion);
  if (overrides) {
    const lo = overrides.lanes || {}, ho = overrides.hubs || {};
    Rg = {
      ...Rg,
      L: Rg.L.map(l => {
        const o = lo[laneKey(l[0], l[1])] || lo[laneKey(l[1], l[0])];
        return o ? [l[0], l[1], o.cap ?? l[2], o.vol ?? l[3], o.km ?? l[4], l[5]] : l;
      }),
      H: Rg.H ? Object.fromEntries(Object.entries(Rg.H).map(([h, v]) => [h, ho[h]?.cap ? { cap: ho[h].cap } : v])) : Rg.H,
      costs: overrides.costs ? {
        ...Rg.costs,
        laneTemp: { ...Rg.costs.laneTemp, ...(overrides.costs.laneTemp || {}) },
        shift: Rg.costs.shift ? { ...Rg.costs.shift, ...(overrides.costs.shift || {}) } : null
      } : Rg.costs
    };
  }
  return Rg;
}

// ---------- Orders (sample unless real order data is supplied) ----------
// Profile per lane: share of SLA-critical parcels and the cumulative share of parcels whose promise slack
// is under 2/4/8/24 hours. Used to estimate how many parcels a road delay pushes past their promise.
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
export function sampleOrders(Rg) {
  return Object.fromEntries(Rg.L.map(([a, b]) => {
    const k = laneKey(a, b), r = hash(k), r2 = hash(k + 'x');
    return [k, { critShare: Math.round((0.22 + 0.16 * r) * 100) / 100, slackCum: [[2, 0.06 + 0.05 * r2], [4, 0.16 + 0.06 * r2], [8, 0.36 + 0.08 * r], [24, 0.74 + 0.08 * r]], source: 'sample' }];
  }));
}
function slackShareUnder(profile, hours) {
  if (!profile || hours <= 0) return 0;
  const pts = [[0, 0], ...profile.slackCum];
  for (let i = 1; i < pts.length; i++) {
    const [h1, s1] = pts[i - 1], [h2, s2] = pts[i];
    if (hours <= h2) return s1 + (s2 - s1) * (hours - h1) / (h2 - h1);
  }
  return pts[pts.length - 1][1];
}

// ---------- Context from scenario / live data ----------
// wx: weather by hub; scenario: saved scenario object (closed lanes, surge, hub cuts); intensity 0..100.
export function buildContext(Rg, { wx, scenario, intensity = 100, traffic = {}, orders, sel, settings = {} }) {
  const k = intensity / 100;
  const cuts = Object.fromEntries(Object.keys(Rg.P).map(id => [id, wx && wx[id] ? Math.min(1, cutOf(wx[id]) * k) : 0]));
  const surge = Object.fromEntries(Object.entries(scenario?.surge || {}).map(([h, s]) => [h, 1 + (s - 1) * k]));
  const hubCut = Object.fromEntries(Object.entries(scenario?.hubCut || {}).map(([h, c]) => [h, c * k]));
  const closed = new Set(k > 0 ? (scenario?.closed || []) : []);
  return {
    cuts, surge, hubCut, closed, scenarioName: scenario?.name || '', traffic: traffic || {}, orders: orders || sampleOrders(Rg),
    sel: sel || { div: false, cap: false, pri: false, prm: false },
    settings: { windowH: settings.windowH ?? Rg.defaults?.windowH ?? 12, slackH: settings.slackH ?? Rg.defaults?.slackH ?? Infinity }
  };
}

// ---------- Lanes and hubs under disruption ----------
function laneState(Rg, ctx) {
  const speed = Rg.id === 'in' ? 45 : 60; // assumed average truck speed km/h when no live traffic is available
  return Rg.L.map(([a, b, c, v0, kmRoad, laneSpeed]) => {
    const key = laneKey(a, b);
    const vol = v0 * Math.max(ctx.surge[a] || 1, ctx.surge[b] || 1);
    const wcut = Math.max(ctx.cuts[a] || 0, ctx.cuts[b] || 0);
    const tr = ctx.traffic[key] || ctx.traffic[laneKey(b, a)];
    const roadClosed = ctx.closed.has(key) || ctx.closed.has(laneKey(b, a)) || !!tr?.closed;
    const eff = roadClosed ? 0 : c * (1 - Math.min(0.95, wcut)); // a lane loses exactly the worse end's weather cut (never more than 95%)
    const km = kmRoad ?? kmStraight(Rg, a, b);
    const freeMin = tr?.freeMin ?? km / (laneSpeed || speed) * 60;
    const travelMin = tr?.travelMin ?? freeMin;
    return {
      a, b, key, c, v0, v: vol, eff, km, wcut, roadClosed, freeMin, travelMin,
      delayMin: Math.max(0, travelMin - freeMin),
      over: Math.max(0, vol - eff), spare: Math.max(0, eff - vol), moved: Math.min(vol, eff),
      reason: roadClosed ? 'road closed' : wcut > 0 && vol > eff ? 'weather' : vol > eff ? 'volume surge' : null,
      traffic: tr ? { source: tr.source, at: tr.at, live: !!tr.live } : { source: 'Estimate (no live traffic)', at: null, live: false }
    };
  });
}
function hubState(Rg, ctx, lanes) {
  if (!Rg.H) return [];
  return Object.keys(Rg.P).map(id => {
    const inc = lanes.filter(l => l.a === id || l.b === id);
    const load = inc.reduce((s, l) => s + l.moved, 0);
    const cut = Math.max(ctx.hubCut[id] || 0, 0.5 * (ctx.cuts[id] || 0)); // sort centres are indoors: half the weather effect
    const cap = Rg.H[id].cap, eff = cap * (1 - Math.min(0.95, cut));
    return { id, cap, eff, load, cut, over: Math.max(0, load - eff), spare: Math.max(0, eff - load), util: load / Math.max(1, eff) };
  });
}

// ---------- Diversion: min-cost rerouting (greedy, one damaged lane at a time) ----------
// For each damaged lane (largest shortfall first) repeatedly find the cheapest path (Bellman-Ford) through lanes
// with spare capacity and hubs with spare sort capacity, then push as much as the bottleneck allows.
// Path cost = per-km + per-hop handling + per-hour time cost (traffic-aware travel time).
// A path is only used if its travel time stays within the promise slack. Greedy approximation, not a proven optimum.
function reroute(Rg, lanes, hubs, ctx) {
  const C = Rg.costs, ids = Object.keys(Rg.P), cap = {}, hubSpare = {}, plans = [], byLane = {};
  lanes.forEach(l => cap[l.key] = l.spare);
  ids.forEach(id => hubSpare[id] = Infinity);
  hubs.forEach(h => hubSpare[h.id] = h.spare);
  const E = lanes.filter(l => !l.roadClosed).map(l => ({ ...l, w: C.perKm * l.km + C.perHop + C.perHour * l.travelMin / 60 }));
  let total = 0, cost = 0;
  for (const d of lanes.filter(l => l.over > 0).sort((x, y) => y.over - x.over)) {
    let need = d.over;
    for (let guard = 0; need > 0.5 && guard < 20; guard++) {
      const dist = Object.fromEntries(ids.map(i => [i, Infinity])), mins = {}, prev = {};
      dist[d.a] = 0; mins[d.a] = 0;
      for (let i = 0; i < ids.length; i++) for (const e of E) {
        if (e.key === d.key || cap[e.key] < 1) continue;
        for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) {
          if (v === d.a || hubSpare[v] < 1) continue;
          if (dist[u] + e.w < dist[v]) { dist[v] = dist[u] + e.w; mins[v] = mins[u] + e.travelMin; prev[v] = [u, e]; }
        }
      }
      if (dist[d.b] === Infinity) break;
      if (mins[d.b] > d.freeMin + ctx.settings.slackH * 60) { (byLane[d.key] ||= { units: 0, cost: 0 }).tooSlow = Math.round(mins[d.b]); break; }
      const path = []; let n = d.b; while (n !== d.a) { const [u, e] = prev[n]; path.push({ e, n }); n = u; }
      const push = Math.min(need, ...path.map(p => cap[p.e.key]), ...path.map(p => hubSpare[p.n]));
      if (push < 0.5) break;
      path.forEach(p => { cap[p.e.key] -= push; hubSpare[p.n] -= push; });
      need -= push; total += push; cost += push * dist[d.b];
      const bl = (byLane[d.key] ||= { units: 0, cost: 0 }); bl.units += push; bl.cost += push * dist[d.b];
      plans.push({ from: d.a, to: d.b, via: path.slice(1).map(p => p.n).reverse(), units: push, unit: dist[d.b], minutes: Math.round(mins[d.b]), directMin: Math.round(d.freeMin) });
    }
  }
  return { total, cost, plans, byLane };
}

// ---------- Min-cost flow (successive shortest paths, SPFA) ----------
const INF = 1e15;
function addEdge(g, from, to, cap, cost, meta = null) {
  g[from].push({ to, rev: g[to].length, cap, cost, cap0: cap, meta });
  g[to].push({ to: from, rev: g[from].length - 1, cap: 0, cost: -cost, cap0: 0, meta: null });
}
function minCostFlow(g, s, t, required) {
  let flow = 0, cost = 0; const n = g.length;
  while (flow < required - 1e-6) {
    const dist = Array(n).fill(INF), prev = Array(n).fill(null), inQ = Array(n).fill(false), q = [s];
    dist[s] = 0; inQ[s] = true;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi]; inQ[u] = false;
      g[u].forEach((e, ei) => {
        if (e.cap <= 1e-9) return;
        const nd = dist[u] + e.cost;
        if (nd < dist[e.to] - 1e-9) { dist[e.to] = nd; prev[e.to] = [u, ei]; if (!inQ[e.to]) { q.push(e.to); inQ[e.to] = true; } }
      });
    }
    if (!prev[t]) break;
    let add = required - flow;
    for (let v = t; v !== s;) { const [u, ei] = prev[v]; add = Math.min(add, g[u][ei].cap); v = u; }
    for (let v = t; v !== s;) { const [u, ei] = prev[v]; const e = g[u][ei]; e.cap -= add; g[v][e.rev].cap += add; v = u; }
    flow += add; cost += add * dist[t];
  }
  return { flow, cost };
}

// ---------- Shortfall items ----------
// lane: parcels that no longer fit on a lane; hub: parcels a sort centre cannot process;
// eta: parcels that physically move but whose road delay pushes them past their promise.
function buildItems(Rg, ctx, lanes, hubs, sol) {
  const C = Rg.costs, items = [];
  const crit = key => ctx.orders[key]?.critShare ?? C.critShare;
  for (const l of lanes) if (l.over > 0.5) {
    const d = sol.byLane[l.key];
    // Hired trucks can serve a closed road only if a usable bypass exists (the diversion search found one).
    items.push({ id: 'lane:' + l.key, kind: 'lane', key: l.key, amount: l.over, cs: crit(l.key), div: d?.units || 0, divUnit: d?.units ? d.cost / d.units : 0, tempOK: !l.roadClosed || (d?.units > 0), viaBypass: l.roadClosed && d?.units > 0, lost: l.c - l.eff });
  }
  for (const h of hubs) if (h.over > 0.5) {
    const inc = lanes.filter(l => l.a === h.id || l.b === h.id);
    const cs = inc.reduce((s, l) => s + crit(l.key) * l.v, 0) / Math.max(1, inc.reduce((s, l) => s + l.v, 0));
    items.push({ id: 'hub:' + h.id, kind: 'hub', hub: h.id, amount: h.over, cs });
  }
  const etaItems = [];
  for (const l of lanes) if (l.delayMin > 1 && l.moved > 0) {
    const share = slackShareUnder(ctx.orders[l.key], l.delayMin / 60);
    if (l.moved * share > 0.5) etaItems.push({ id: 'eta:' + l.key, kind: 'eta', key: l.key, amount: l.moved * share, cs: crit(l.key), delayMin: l.delayMin });
  }
  // ETA exposure can overlap with parcels already counted in an overloaded hub. Aggregate sample data
  // cannot identify individual parcels, so conservatively subtract an explicitly estimated overlap only
  // for ETA lanes touching overloaded hubs. This avoids presenting overlapping risk buckets as unique parcels.
  const exposedEta = etaItems.filter(it => {
    const l = lanes.find(x => x.key === it.key);
    return l && hubs.some(h => h.over > 0.5 && (h.id === l.a || h.id === l.b));
  });
  const eligibleEta = exposedEta.reduce((s, it) => s + it.amount, 0);
  const hubOverflow = hubs.reduce((s, h) => s + h.over, 0);
  const overlapEstimate = Math.min(eligibleEta, hubOverflow);
  if (eligibleEta > 0 && overlapEstimate > 0) {
    const factor = (eligibleEta - overlapEstimate) / eligibleEta;
    for (const it of exposedEta) it.amount *= factor;
  }
  return items.concat(etaItems.filter(it => it.amount > 0.5));
}
const timeFactor = (opt, windowH) => !opt ? 0 : opt.activationH ? cl((windowH - opt.activationH) / windowH) : 1;

// ---------- Intervention allocation (min-cost flow) ----------
// Every parcel at risk must end in exactly one outcome: diverted, carried by temporary capacity (market trucks
// or an extra sort shift), given a revised promise, or late. Edges carry the cost of each outcome; the flow
// minimises total modelled cost. With prioritisation ON, SLA-critical parcels are modelled separately and,
// because they cost more when late, receive scarce capacity first. With it OFF, capacity is shared pro rata.
export function allocate(Rg, an, sel) {
  const C = Rg.costs, { items, ctx } = an;
  const g = [[], [], []]; const S = 0, T = 1, LT = 2; const node = () => (g.push([]), g.length - 1);
  const ltFactor = timeFactor(C.laneTemp, ctx.settings.windowH);
  const staffingShortfall = /staffing shortfall/i.test(ctx.scenarioName || '');
  const shFactor = staffingShortfall ? 0 : timeFactor(C.shift, ctx.settings.windowH);
  const poolCap = sel.cap ? C.laneTemp.share * ltFactor * items.filter(i => i.kind === 'lane' && i.tempOK).reduce((s, i) => s + i.lost, 0) : 0;
  addEdge(g, LT, T, poolCap, C.laneTemp.cost, { ch: 'temp' });
  const rec = [];
  let required = 0;
  for (const it of items) {
    const X = node();
    const classes = sel.pri ? [['crit', it.amount * it.cs, 1], ['std', it.amount * (1 - it.cs), 0]] : [['mix', it.amount, it.cs]];
    for (const [cls, amt, cshare] of classes) {
      if (amt <= 1e-6) continue;
      const K = node(); required += amt;
      addEdge(g, S, K, amt, 0);
      if (it.kind !== 'eta' || it.div > 0) { const e = g[K].length; addEdge(g, K, X, INF, 0); rec.push({ it, cls, cshare, ch: 'protect', u: K, ei: e }); }
      if (sel.prm) { const e = g[K].length; addEdge(g, K, T, INF, C.credit + C.trust * (1 + cshare)); rec.push({ it, cls, cshare, ch: 'prm', u: K, ei: e }); }
      const e = g[K].length; addEdge(g, K, T, INF, C.lateStd * (1 - cshare) + C.lateCrit * cshare); rec.push({ it, cls, cshare, ch: 'late', u: K, ei: e });
    }
    if (sel.div && it.div > 0) { const e = g[X].length; addEdge(g, X, T, it.div, it.divUnit); rec.push({ it, ch: 'div', u: X, ei: e }); }
    if (sel.cap && it.kind === 'lane' && it.tempOK) { const e = g[X].length; addEdge(g, X, LT, INF, 0); rec.push({ it, ch: 'temp', u: X, ei: e }); }
    if (sel.cap && it.kind === 'hub' && C.shift) { const e = g[X].length; addEdge(g, X, T, (it.shiftCap ?? C.shift.capByHub?.[it.hub] ?? C.shift.share * Rg.H[it.hub].cap) * shFactor, C.shift.cost); rec.push({ it, ch: 'shift', u: X, ei: e }); }
  }
  minCostFlow(g, S, T, required);
  const fl = r => { const e = g[r.u][r.ei]; return e.cap0 - e.cap; };
  const out = { div: 0, temp: 0, shift: 0, prm: 0, prmCrit: 0, late: 0, lateCrit: 0, protectedCrit: 0, divCost: 0, byItem: {} };
  for (const r of rec) {
    const f = fl(r); if (f <= 1e-6) continue;
    const bi = (out.byItem[r.it.id] ||= { div: 0, temp: 0, shift: 0, prm: 0, late: 0 });
    const critPart = f * (r.cshare ?? 0);
    if (r.ch === 'div') { out.div += f; out.divCost += f * r.it.divUnit; bi.div += f; }
    else if (r.ch === 'temp') { out.temp += f; bi.temp += f; }
    else if (r.ch === 'shift') { out.shift += f; bi.shift += f; }
    else if (r.ch === 'prm') { out.prm += f; out.prmCrit += critPart; bi.prm += f; }
    else if (r.ch === 'late') { out.late += f; out.lateCrit += critPart; bi.late += f; }
    else if (r.ch === 'protect') out.protectedCrit += critPart;
  }
  // Round the four mutually exclusive parcel outcomes together using largest remainders.
  // Independent rounding can create or lose parcels. Preserve the rounded at-risk total.
  const outcomeKeys = ['div', 'temp', 'shift', 'prm', 'late'];
  const rawOutcomes = Object.fromEntries(outcomeKeys.map(key => [key, Math.max(0, out[key])]));
  const targetTotal = Math.max(0, Math.round(items.reduce((sum, item) => sum + item.amount, 0)));
  const rounded = Object.fromEntries(outcomeKeys.map(key => [key, Math.floor(rawOutcomes[key])]));
  let remainder = targetTotal - outcomeKeys.reduce((sum, key) => sum + rounded[key], 0);
  const byFraction = [...outcomeKeys].sort((a, b) =>
    (rawOutcomes[b] - Math.floor(rawOutcomes[b])) - (rawOutcomes[a] - Math.floor(rawOutcomes[a]))
  );
  for (let i = 0; i < remainder && i < byFraction.length; i++) rounded[byFraction[i]] += 1;
  // Guard against numerical residuals: if the flow's raw total differs slightly from targetTotal,
  // reconcile only to the target total and never allow a negative outcome.
  while (outcomeKeys.reduce((sum, key) => sum + rounded[key], 0) > targetTotal) {
    const key = [...outcomeKeys].sort((a, b) => rounded[b] - rawOutcomes[b] - (rounded[a] - rawOutcomes[a]))[0];
    if (!key || rounded[key] <= 0) break;
    rounded[key] -= 1;
  }
  Object.assign(out, rounded);
  out.prmCrit = Math.min(out.prm, Math.max(0, Math.round(out.prmCrit)));
  out.lateCrit = Math.min(out.late, Math.max(0, Math.round(out.lateCrit)));
  out.protectedCrit = Math.max(0, Math.round(out.protectedCrit));
  // Reconcile diversion counts per item to whole parcels before calculating transport cost.
  // This prevents fractional flow (e.g. 160.22 parcels) leaking into currency totals.
  const itemById = new Map(items.map(item => [item.id, item]));
  const divRows = Object.entries(out.byItem).map(([id, row]) => ({ id, raw: Math.max(0, row.div || 0), unit: itemById.get(id)?.divUnit || 0 }));
  const divTarget = Math.max(0, Math.round(out.div));
  const divCounts = divRows.map(row => Math.floor(row.raw));
  let divRemainder = divTarget - divCounts.reduce((sum, n) => sum + n, 0);
  divRows.map((row, index) => ({ index, fraction: row.raw - Math.floor(row.raw) }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, Math.max(0, divRemainder))
    .forEach(({ index }) => { divCounts[index] += 1; });
  out.divCost = divRows.reduce((sum, row, index) => sum + divCounts[index] * row.unit, 0);
  const tempCost = Math.round(out.temp) * C.laneTemp.cost + Math.round(out.shift) * (C.shift?.cost || 0);
  const credits = Math.round(out.prm * C.credit);
  const trustCost = Math.round((out.prm + out.prmCrit) * C.trust);
  const latePenalty = Math.round((out.late - out.lateCrit) * C.lateStd + out.lateCrit * C.lateCrit);
  const opsCost = out.divCost + tempCost + credits;
  return {
    sel, ...out, onTime: out.div + out.temp + out.shift, poolCap,
    cost: { transport: out.divCost, temporary: tempCost, credits, total: opsCost },
    shadow: { trust: trustCost, late: latePenalty },
    objective: opsCost + trustCost + latePenalty,
    timing: { laneTemp: { activationH: C.laneTemp.activationH, usableShare: ltFactor }, shift: C.shift ? { activationH: C.shift.activationH, usableShare: shFactor } : null }
  };
}

// Checklist describes constraints enforced by the current model; it is not a real-world execution guarantee.
export function feasibilityChecks(an, plan) {
  const C = an.Rg.costs;
  const divertedWithinComputedPaths = (plan.div || 0) <= (an.sol?.total || 0) + 1e-4;
  // Independently check aggregate diverted volume against the computed spare sort capacity
  // of the intermediate hubs represented by the selected reroute paths. This remains a
  // synthetic-model check, not a live hub-capacity guarantee.
  const pathPlans = (an.sol?.plans || []).filter(p => (p.units || 0) > 0);
  const intermediateHubIds = [...new Set(pathPlans.flatMap(p => p.via || []))];
  const intermediateHubRoom = intermediateHubIds.reduce((sum, id) => {
    const hub = (an.hubs || []).find(h => h.id === id);
    return sum + Math.max(0, hub ? hub.eff - hub.load : 0);
  }, 0);
  const routedUnits = pathPlans.reduce((sum, p) => sum + (p.units || 0), 0);
  const downstreamHubCapacityChecked = intermediateHubIds.length === 0 || routedUnits <= intermediateHubRoom + 1e-4;
  // The min-cost-flow solver can leave tiny floating-point residuals when allocating
  // shared temporary capacity. Use a scale-aware tolerance for this comparison.
  const tempCapacity = plan.poolCap || 0;
  const tempTolerance = Math.max(1e-4, Math.abs(tempCapacity) * 1e-4);
  const tempWithinWindow = (plan.temp || 0) <= tempCapacity + tempTolerance;
  const shiftCap = an.items.filter(i => i.kind === 'hub').reduce((s, i) => s + (i.shiftCap ?? C.shift?.capByHub?.[i.hub] ?? (C.shift ? C.shift.share * an.Rg.H[i.hub].cap : 0)), 0) * (plan.timing?.shift?.usableShare || 0);
  const shiftWithinCapacity = (plan.shift || 0) <= shiftCap + 1e-4;
  const detoursWithinSlack = (an.sol?.plans || []).every(p => p.minutes <= p.directMin + (an.ctx.settings.slackH * 60) + 1);
  const tempActivationMet = !(plan.temp > 0) || (plan.timing?.laneTemp?.usableShare || 0) > 0;
  const shiftActivationMet = !(plan.shift > 0) || (plan.timing?.shift?.usableShare || 0) > 0;
  return [
    { label: 'Diversions use computed spare lane capacity', pass: Math.round(plan.div || 0) < 1 ? null : divertedWithinComputedPaths, detail: Math.round(plan.div || 0) < 1 ? 'N/A: this recommendation does not divert parcels.' : 'The reroute search allocates only against lane capacity remaining in its model.' },
    { label: 'Downstream hub sort capacity checked', pass: (plan.div || 0) < 1 ? null : downstreamHubCapacityChecked, detail: Math.round(plan.div || 0) < 1 ? 'N/A: this recommendation does not divert parcels.' : intermediateHubIds.length ? `Checks ${intermediateHubIds.length} intermediate hub(s) against modelled spare sort capacity; not a live capacity feed.` : 'No intermediate hub is used by the computed reroute paths.' },
    { label: 'Detour time stays within configured slack', pass: (plan.div || 0) < 1 ? null : detoursWithinSlack, detail: Math.round(plan.div || 0) < 1 ? 'N/A: this recommendation does not divert parcels.' : `Configured delivery slack: ${an.ctx.settings.slackH} h.` },
    { label: 'Temporary transport activation window met', pass: Math.round(plan.temp || 0) < 1 ? null : tempActivationMet && tempWithinWindow, detail: Math.round(plan.temp || 0) < 1 ? 'N/A: this recommendation does not use temporary transport capacity.' : `Activation: ${C.laneTemp.activationH} h; capacity available within the selected ${an.ctx.settings.windowH} h window.` },
    { label: 'Extra shift activation and capacity checked', pass: Math.round(plan.shift || 0) < 1 ? null : (shiftActivationMet && shiftWithinCapacity), detail: /staffing shortfall/i.test(an.ctx.scenarioName || '') ? 'N/A: this scenario models a staffing shortage, so spare shift capacity is disabled.' : Math.round(plan.shift || 0) < 1 ? 'N/A: this recommendation does not use an extra shift.' : C.shift ? `Activation: ${C.shift.activationH} h; capacity is assumed, not roster-verified.` : 'Not configured for this region.' }
  ];
}

// ---------- Full analysis ----------
export function analyse(Rg, ctx) {
  const lanes = laneState(Rg, ctx), hubs = hubState(Rg, ctx, lanes);
  const sol = reroute(Rg, lanes, hubs, ctx);
  const an = { Rg, ctx, lanes, hubs, sol };
  an.items = buildItems(Rg, ctx, lanes, hubs, sol);
  an.laneGap = an.items.filter(i => i.kind === 'lane').reduce((s, i) => s + i.amount, 0);
  an.hubGap = an.items.filter(i => i.kind === 'hub').reduce((s, i) => s + i.amount, 0);
  an.etaRisk = an.items.filter(i => i.kind === 'eta').reduce((s, i) => s + i.amount, 0);
  an.gap = an.laneGap + an.hubGap;          // lane overflow and hub overflow are separate modelled buckets
  an.atRisk = an.gap + an.etaRisk;          // ETA risk adjusted for estimated overlap with overloaded hubs
  an.riskAccountingNote = 'ETA exposure on lanes touching overloaded hubs is reduced by an estimated overlap capped at total hub overflow. Aggregate sample data cannot identify individual parcels; treat total at-risk volume as an estimate, not a unique parcel count.';
  an.lost = lanes.filter(l => l.over > 0).reduce((s, l) => s + (l.c - l.eff), 0);
  an.plan = allocate(Rg, an, ctx.sel);
  return an;
}

export const OPTION_KEYS = ['div', 'cap', 'pri', 'prm'];
// Compare all 16 combinations of the four interventions and rank them by total modelled cost
// (operating cost + assumed trust cost of revised promises + assumed cost of late parcels).
export function comparePlans(Rg, an) {
  const all = [];
  for (let m = 0; m < 16; m++) {
    const sel = Object.fromEntries(OPTION_KEYS.map((k, i) => [k, !!(m & (1 << i))]));
    all.push(allocate(Rg, an, sel));
  }
  const n = p => Object.values(p.sel).filter(Boolean).length;
  all.sort((x, y) => (x.objective - y.objective) || (n(x) - n(y)));
  const seen = new Set(), unique = [];
  for (const p of all) {
    const sig = [p.onTime, p.prm, p.late, p.lateCrit, p.cost.total].map(v => Math.round(v)).join('|');
    if (seen.has(sig)) continue; seen.add(sig); unique.push(p);
  }
  const doNothing = all.find(p => n(p) === 0);
  return { best: unique[0], ranked: unique, doNothing };
}

// ---------- Route (selected origin -> destination) ----------
// Fastest hub sequence using traffic-aware travel times, avoiding closed roads and lanes with no capacity.
export function routePath(an, from, to, banned = new Set()) {
  const { lanes, Rg } = an, ids = Object.keys(Rg.P);
  if (!from || !to || from === to || !Rg.P[from] || !Rg.P[to]) return null;
  const dist = Object.fromEntries(ids.map(i => [i, Infinity])), prev = {}, done = new Set();
  dist[from] = 0;
  while (true) {
    let u = null; for (const i of ids) if (!done.has(i) && dist[i] < Infinity && (u === null || dist[i] < dist[u])) u = i;
    if (u === null || u === to) break; done.add(u);
    for (const l of lanes) {
      if (l.roadClosed || l.eff < 1 || banned.has(l.key)) continue;
      const v = l.a === u ? l.b : l.b === u ? l.a : null; if (!v || done.has(v)) continue;
      if (dist[u] + l.travelMin < dist[v]) { dist[v] = dist[u] + l.travelMin; prev[v] = [u, l]; }
    }
  }
  if (dist[to] === Infinity) return null;
  const legs = []; let n = to; while (n !== from) { const [u, l] = prev[n]; legs.unshift({ from: u, to: n, lane: l }); n = u; }
  return {
    hubs: [from, ...legs.map(x => x.to)], legs,
    minutes: legs.reduce((s, x) => s + x.lane.travelMin, 0), freeMinutes: legs.reduce((s, x) => s + x.lane.freeMin, 0),
    km: legs.reduce((s, x) => s + x.lane.km, 0)
  };
}
export function routeWithAlternative(an, from, to) {
  const best = routePath(an, from, to); if (!best) return { best: null, alt: null, directClosed: null };
  let alt = null;
  for (const leg of best.legs) {
    const r = routePath(an, from, to, new Set([leg.lane.key]));
    if (r && (!alt || r.minutes < alt.minutes)) alt = r;
  }
  const direct = an.lanes.find(l => (l.a === from && l.b === to) || (l.a === to && l.b === from));
  return { best, alt, directClosed: direct && direct.roadClosed ? direct : null };
}
// Plain-language risk notes for the legs of a route (weather, capacity, traffic, hub load).
export function routeRisks(an, route, wx) {
  if (!route) return [];
  const N = an.Rg.NM, out = [];
  for (const { from, to, lane } of route.legs) {
    const nm = `${N[from]} → ${N[to]}`;
    if (lane.roadClosed) { out.push({ level: 'bad', text: `${nm}: road closed (simulated), so there is no travel time on this leg.` }); continue; }
    if (lane.wcut > 0) out.push({ level: lane.wcut > 0.3 ? 'bad' : 'warn', text: `${nm}: weather cuts lane capacity by ${Math.round(lane.wcut * 100)}%.` });
    if (lane.over > 0) out.push({ level: 'bad', text: `${nm}: ${Math.round(lane.over).toLocaleString('en-IN')} parcels/day more than the lane can carry.` });
    else if (lane.v / Math.max(1, lane.eff) > 0.85) out.push({ level: 'warn', text: `${nm}: ${Math.round(lane.v / Math.max(1, lane.eff) * 100)}% of remaining capacity used.` });
    if (lane.delayMin > 10) out.push({ level: lane.delayMin > 45 ? 'bad' : 'warn', text: `${nm}: road delay of ${Math.round(lane.delayMin)} min (${lane.traffic.source}).` });
  }
  for (const h of route.hubs) {
    const hs = an.hubs.find(x => x.id === h);
    if (hs && hs.over > 0) out.push({ level: 'bad', text: `${N[h]} sort centre: ${Math.round(hs.over).toLocaleString('en-IN')} parcels/day over processing capacity.` });
    const w = wx?.[h];
    if (w && w.vis != null && w.vis < 1000) out.push({ level: w.vis < 300 ? 'bad' : 'warn', text: `${N[h]}: visibility ${Math.round(w.vis)} m (fog/dust).` });
  }
  return out;
}

// ---------- Facts (grounded numbers for the explainer and copilot) ----------
export const ACTION_LABEL = { div: 'Divert parcels to alternate lanes', cap: 'Add temporary capacity', pri: 'Prioritise SLA-critical parcels', prm: 'Adjust delivery promises' };
export function planFacts(an, plan) {
  const { Rg } = an, N = Rg.NM, cur = Rg.costs.cur, r = n => Math.round(n);
  const route = an.scope === 'route' ? { shipment: `${N[an.from]} → ${N[an.to]}`, parcelsPerDay: r(an.shipVol), plannedRoute: an.planned.hubs.map(h => N[h]).join(' → '), routeDelayMin: r(an.delayMin), worstLeg: an.worstLeg ? `${N[an.worstLeg.a]}–${N[an.worstLeg.b]} (${an.worstLeg.reason})` : null, overloadedHubOnRoute: an.worstHub ? N[an.worstHub.id] : null } : null;
  return {
    region: Rg.name, currency: cur, ...(route ? { scope: 'shipment', ...route } : { scope: 'whole network' }),
    actions: Object.entries(plan.sel).filter(([, v]) => v).map(([k]) => ACTION_LABEL[k]),
    parcelsOverCapacityPerDay: r(an.gap), laneShortfall: r(an.laneGap), hubShortfall: r(an.hubGap), etaRiskFromRoadDelay: r(an.etaRisk),
    onTime: r(plan.onTime), diverted: r(plan.div), temporaryCapacity: r(plan.temp + plan.shift), revisedPromise: r(plan.prm), stillLate: r(plan.late), slaCriticalStillLate: r(plan.lateCrit),
    incrementalCostPerDay: r(plan.cost.total), transportCost: r(plan.cost.transport), temporaryCapacityCost: r(plan.cost.temporary), promiseCredits: r(plan.cost.credits),
    assumedTrustCost: r(plan.shadow.trust), assumedLatePenalty: r(plan.shadow.late),
    detourNotes: an.altNotes || [],
    closedRoads: an.lanes.filter(l => l.roadClosed).map(l => `${N[l.a]}–${N[l.b]}`),
    worstLanes: an.lanes.filter(l => l.over > 0).sort((a, b) => b.over - a.over).slice(0, 4).map(l => `${N[l.a]}–${N[l.b]}: capacity ${r(l.c)}→${r(l.eff)}, volume ${r(l.v)}, short ${r(l.over)} (${l.reason})`),
    overloadedHubs: an.hubs.filter(h => h.over > 0).map(h => `${N[h.id]}: load ${r(h.load)} vs capacity ${r(h.eff)}, short ${r(h.over)}`),
    reroutes: an.sol.plans.slice(0, 4).map(p => `${N[p.from]}→${N[p.to]} via ${p.via.map(i => N[i]).join(', ')}: ${r(p.units)} parcels at ${cur}${p.unit.toFixed(2)} each, ${Math.round(p.minutes / 6) / 10} h`)
  };
}

// ---------- Shipment view: one origin -> destination flow ----------
// The planned route is the normal-day fastest path (free-flow time), so a disruption on it stays visible.
// The shipment takes its share of every bottleneck on that route:
//   lane:  worst leg shortfall (weather cut, closure, surge) as a share of that leg's volume
//   hub:   extra share lost at an overloaded sort centre on the route
//   eta:   parcels that still move but whose road delay on the route exceeds their promise slack
// Diversion options are alternative hub sequences under current conditions, limited by their spare lane and
// hub capacity and by the allowed extra hours. The same min-cost-flow allocation then picks the plan.
function shortest(lanes, ids, from, to, weight, usable) {
  const dist = Object.fromEntries(ids.map(i => [i, Infinity])), prev = {}, done = new Set(); dist[from] = 0;
  while (true) {
    let u = null; for (const i of ids) if (!done.has(i) && dist[i] < Infinity && (u === null || dist[i] < dist[u])) u = i;
    if (u === null || u === to) break; done.add(u);
    for (const l of lanes) {
      if (!usable(l)) continue;
      const v = l.a === u ? l.b : l.b === u ? l.a : null; if (!v || done.has(v) || !usable(l, v)) continue;
      const w = weight(l); if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = [u, l]; }
    }
  }
  if (dist[to] === Infinity) return null;
  const legs = []; let n = to; while (n !== from) { const [u, l] = prev[n]; legs.unshift({ from: u, to: n, lane: l }); n = u; }
  return { hubs: [from, ...legs.map(x => x.to)], legs, minutes: legs.reduce((s, x) => s + x.lane.travelMin, 0), freeMinutes: legs.reduce((s, x) => s + x.lane.freeMin, 0), km: legs.reduce((s, x) => s + x.lane.km, 0) };
}
const avgProfile = (ctx, keys) => {
  const ps = keys.map(k => ctx.orders[k]).filter(Boolean); if (!ps.length) return null;
  return { critShare: ps.reduce((s, p) => s + p.critShare, 0) / ps.length, slackCum: ps[0].slackCum.map(([h], i) => [h, ps.reduce((s, p) => s + p.slackCum[i][1], 0) / ps.length]) };
};
export function analyseRoute(an, from, to, shipVol = 1000) {
  const { Rg, ctx, lanes, hubs } = an, C = Rg.costs, ids = Object.keys(Rg.P);
  if (!from || !to || from === to || !Rg.P[from] || !Rg.P[to]) return null;
  const vol = Math.max(0, +shipVol || 0);
  const planned = shortest(lanes, ids, from, to, l => l.freeMin, () => true);
  if (!planned) return null;
  const legs = planned.legs, hubOf = id => hubs.find(h => h.id === id);
  const pathCost = p => p.legs.reduce((s, x) => s + C.perKm * x.lane.km + C.perHop + C.perHour * x.lane.travelMin / 60, 0);

  // Bottlenecks on the planned route.
  const legShare = legs.map(x => x.lane.v > 0 ? x.lane.over / x.lane.v : 0);
  const iL = legShare.indexOf(Math.max(...legShare)), fL = legShare[iL] || 0, worstLeg = fL > 0 ? legs[iL].lane : null;
  const routeHubs = planned.hubs.map(hubOf).filter(Boolean);
  const hubShare = routeHubs.map(h => h.load > 0 ? h.over / h.load : 0);
  const iH = hubShare.indexOf(Math.max(...hubShare, 0)), fH = hubShare[iH] || 0, worstHub = fH > 0 ? routeHubs[iH] : null;
  const laneAmt = vol * Math.min(1, fL), hubAmt = vol * Math.max(0, Math.min(1, fH) - Math.min(1, fL));
  const delayMin = legs.filter(x => !x.lane.roadClosed).reduce((s, x) => s + x.lane.delayMin, 0);
  const profile = avgProfile(ctx, legs.map(x => x.lane.key)) || { critShare: C.critShare, slackCum: sampleOrders(Rg)[legs[0].lane.key].slackCum };
  const etaAmt = Math.max(0, vol - laneAmt - hubAmt) * slackShareUnder(profile, delayMin / 60);
  const cs = profile.critShare;

  // Alternative hub sequences under current conditions (avoid closed and zero-capacity lanes).
  const open = l => !l.roadClosed && l.eff >= 1;
  const cands = [shortest(lanes, ids, from, to, l => l.travelMin, open)];
  for (const x of legs) cands.push(shortest(lanes, ids, from, to, l => l.travelMin, l => open(l) && l.key !== x.lane.key));
  for (const h of planned.hubs.slice(1, -1)) cands.push(shortest(lanes, ids, from, to, l => l.travelMin, (l, v) => open(l) && v !== h));
  const sig = p => p.hubs.join('>'), seen = new Set([sig(planned)]), base = pathCost(planned);
  const alts = cands.filter(Boolean).filter(p => !seen.has(sig(p)) && seen.add(sig(p))).map(p => ({
    ...p, unit: Math.max(0, pathCost(p) - base) + C.perHop,
    timeOK: p.minutes <= planned.freeMinutes + ctx.settings.slackH * 60,
    usesLane: k => p.legs.some(x => x.lane.key === k), usesHub: h => p.hubs.includes(h), used: 0
  })).sort((a, b) => a.unit - b.unit);

  // Shared spare capacity on alternatives, used greedily: lane item, then hub item, then delayed parcels.
  const spareL = Object.fromEntries(lanes.map(l => [l.key, l.spare])), spareH = Object.fromEntries(hubs.map(h => [h.id, h.spare]));
  const room = p => Math.min(...p.legs.map(x => spareL[x.lane.key]), ...p.hubs.slice(1).map(h => spareH[h] ?? Infinity));
  const plans = [];
  // Spare room on each alternative before anything is diverted, and the leg or hub that limits it.
  const tightest = p => { let b = null; p.legs.forEach(x => { const r = spareL[x.lane.key]; if (!b || r < b.room) b = { room: r, label: `${Rg.NM[x.lane.a]}–${Rg.NM[x.lane.b]}` }; }); p.hubs.slice(1).forEach(h => { if (h in spareH && (!b || spareH[h] < b.room)) b = { room: spareH[h], label: `${Rg.NM[h]} sort centre` }; }); return b; };
  alts.forEach(p => { p.room0 = Math.max(0, room(p)); p.bottleneck = tightest(p); });
  const divert = (need, ok) => {
    let got = 0, cost = 0;
    for (const p of alts) {
      if (need - got < 0.5 || !ok(p)) continue;
      const take = Math.min(need - got, room(p)); if (take < 0.5) continue;
      p.legs.forEach(x => spareL[x.lane.key] -= take); p.hubs.slice(1).forEach(h => { if (h in spareH) spareH[h] -= take; });
      got += take; cost += take * p.unit; p.used += take;
      plans.push({ from, to, via: p.hubs.slice(1, -1), units: take, unit: p.unit, minutes: Math.round(p.minutes), directMin: Math.round(planned.freeMinutes) });
    }
    return { units: got, unit: got ? cost / got : 0 };
  };
  const items = [];
  if (laneAmt > 0.5) {
    const d = divert(laneAmt, p => p.timeOK && !p.usesLane(worstLeg.key));
    const bypass = alts.some(p => p.timeOK && !p.usesLane(worstLeg.key));
    items.push({ id: 'lane:' + worstLeg.key, kind: 'lane', key: worstLeg.key, amount: laneAmt, cs, div: d.units, divUnit: d.unit, tempOK: !worstLeg.roadClosed || bypass, viaBypass: worstLeg.roadClosed && bypass, lost: (worstLeg.c - worstLeg.eff) * Math.min(1, vol / Math.max(1, worstLeg.v)) });
  }
  if (hubAmt > 0.5) {
    const d = divert(hubAmt, p => p.timeOK && !p.usesHub(worstHub.id));
    const shiftBase = C.shift ? (C.shift.capByHub?.[worstHub.id] ?? C.shift.share * Rg.H[worstHub.id].cap) : 0;
    items.push({ id: 'hub:' + worstHub.id, kind: 'hub', hub: worstHub.id, amount: hubAmt, cs, div: d.units, divUnit: d.unit, shiftCap: shiftBase * Math.min(1, vol / Math.max(1, worstHub.load)) });
  }
  if (etaAmt > 0.5) {
    const d = divert(etaAmt, p => p.minutes <= planned.freeMinutes + 30);
    items.push({ id: 'eta:route', kind: 'eta', key: 'route', amount: etaAmt, cs, div: d.units, divUnit: d.unit, delayMin });
  }
  const divTotal = plans.reduce((s, p) => s + p.units, 0);
  // Why was a faster alternative not used (or only partly)? Say plainly whether it is capacity, cost or both.
  const altNotes = [], hrs = p => (p.minutes / 60).toFixed(1), pname = p => p.hubs.map(h => Rg.NM[h]).join(' → '), num = n => Math.round(n).toLocaleString('en-IN');
  const usedAlts = alts.filter(p => p.used > 0.5), totalDiverted = usedAlts.reduce((s, p) => s + p.used, 0);
  if (usedAlts.length) {
    const slow = usedAlts.reduce((a, b) => b.minutes > a.minutes ? b : a);
    alts.filter(p => p !== slow && p.timeOK && p.minutes < slow.minutes - 1).sort((a, b) => a.minutes - b.minutes).slice(0, 2).forEach(p => {
      const why = [];
      if (p.room0 < totalDiverted - 0.5) why.push(p.room0 < 1 ? 'has no spare room' : `has room for only ${num(p.room0)} parcels/day${p.bottleneck ? ` (tightest: ${p.bottleneck.label})` : ''}`);
      if (p.unit > slow.unit + 0.005) why.push(`costs ${C.cur}${(p.unit - slow.unit).toFixed(2)} more per parcel`);
      if (!why.length) return;
      altNotes.push(`${pname(p)} is faster (${hrs(p)} h vs ${hrs(slow)} h) but ${why.join(' and ')}, so ${p.used > 0.5 ? `${num(p.used)} use it and the other ${num(slow.used)} go` : `all ${num(slow.used)} go`} via ${pname(slow)}.`);
    });
  }
  const ra = {
    Rg, ctx, scope: 'route', from, to, shipVol: vol, planned, alts, altNotes, worstLeg, worstHub, delayMin, profile,
    lanes: legs.map(x => x.lane), hubs: routeHubs, items,
    laneGap: laneAmt, hubGap: hubAmt, etaRisk: etaAmt, gap: laneAmt + hubAmt, atRisk: laneAmt + hubAmt + etaAmt,
    lost: worstLeg ? worstLeg.c - worstLeg.eff : 0,
    sol: { total: divTotal, cost: plans.reduce((s, p) => s + p.units * p.unit, 0), plans, byLane: {} }
  };
  ra.plan = allocate(Rg, ra, ctx.sel);
  return ra;
}
