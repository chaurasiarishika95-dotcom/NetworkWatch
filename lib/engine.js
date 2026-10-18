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
        return o ? [l[0], l[1], o.cap ?? l[2], o.vol ?? l[3], o.km ?? l[4]] : l;
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
    cuts, surge, hubCut, closed, traffic: traffic || {}, orders: orders || sampleOrders(Rg),
    sel: sel || { div: false, cap: false, pri: false, prm: false },
    settings: { windowH: settings.windowH ?? Rg.defaults?.windowH ?? 12, slackH: settings.slackH ?? Rg.defaults?.slackH ?? Infinity }
  };
}

// ---------- Lanes and hubs under disruption ----------
function laneState(Rg, ctx) {
  const speed = Rg.id === 'in' ? 45 : 60; // assumed average truck speed km/h when no live traffic is available
  return Rg.L.map(([a, b, c, v0, kmRoad]) => {
    const key = laneKey(a, b);
    const vol = v0 * Math.max(ctx.surge[a] || 1, ctx.surge[b] || 1);
    const wcut = Math.max(ctx.cuts[a] || 0, ctx.cuts[b] || 0);
    const tr = ctx.traffic[key] || ctx.traffic[laneKey(b, a)];
    const roadClosed = ctx.closed.has(key) || ctx.closed.has(laneKey(b, a)) || !!tr?.closed;
    const eff = roadClosed ? 0 : c * (1 - Math.min(0.95, wcut * 0.95));
    const km = kmRoad ?? kmStraight(Rg, a, b);
    const freeMin = tr?.freeMin ?? km / speed * 60;
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
    const cap = Rg.H[id].cap, eff = cap * (1 - Math.min(0.95, cut * 0.95));
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
  for (const l of lanes) if (l.delayMin > 1 && l.moved > 0) {
    const share = slackShareUnder(ctx.orders[l.key], l.delayMin / 60);
    if (l.moved * share > 0.5) items.push({ id: 'eta:' + l.key, kind: 'eta', key: l.key, amount: l.moved * share, cs: crit(l.key), delayMin: l.delayMin });
  }
  return items;
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
  const ltFactor = timeFactor(C.laneTemp, ctx.settings.windowH), shFactor = timeFactor(C.shift, ctx.settings.windowH);
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
      if (it.kind !== 'eta') { const e = g[K].length; addEdge(g, K, X, INF, 0); rec.push({ it, cls, cshare, ch: 'protect', u: K, ei: e }); }
      if (sel.prm) { const e = g[K].length; addEdge(g, K, T, INF, C.credit + C.trust * (1 + cshare)); rec.push({ it, cls, cshare, ch: 'prm', u: K, ei: e }); }
      const e = g[K].length; addEdge(g, K, T, INF, C.lateStd * (1 - cshare) + C.lateCrit * cshare); rec.push({ it, cls, cshare, ch: 'late', u: K, ei: e });
    }
    if (sel.div && it.div > 0) { const e = g[X].length; addEdge(g, X, T, it.div, it.divUnit); rec.push({ it, ch: 'div', u: X, ei: e }); }
    if (sel.cap && it.kind === 'lane' && it.tempOK) { const e = g[X].length; addEdge(g, X, LT, INF, 0); rec.push({ it, ch: 'temp', u: X, ei: e }); }
    if (sel.cap && it.kind === 'hub' && C.shift) { const e = g[X].length; addEdge(g, X, T, (C.shift.capByHub?.[it.hub] ?? C.shift.share * Rg.H[it.hub].cap) * shFactor, C.shift.cost); rec.push({ it, ch: 'shift', u: X, ei: e }); }
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
  const tempCost = out.temp * C.laneTemp.cost + out.shift * (C.shift?.cost || 0);
  const credits = out.prm * C.credit;
  const trustCost = (out.prm + out.prmCrit) * C.trust;
  const latePenalty = (out.late - out.lateCrit) * C.lateStd + out.lateCrit * C.lateCrit;
  const opsCost = out.divCost + tempCost + credits;
  return {
    sel, ...out, onTime: out.div + out.temp + out.shift, poolCap,
    cost: { transport: out.divCost, temporary: tempCost, credits, total: opsCost },
    shadow: { trust: trustCost, late: latePenalty },
    objective: opsCost + trustCost + latePenalty,
    timing: { laneTemp: { activationH: C.laneTemp.activationH, usableShare: ltFactor }, shift: C.shift ? { activationH: C.shift.activationH, usableShare: shFactor } : null }
  };
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
  an.gap = an.laneGap + an.hubGap;          // parcels with no capacity (per lane / per hub: upper bound)
  an.atRisk = an.gap + an.etaRisk;          // plus parcels pushed past promise by road delay
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
    if (lane.wcut > 0) out.push({ level: lane.wcut > 0.3 ? 'bad' : 'warn', text: `${nm}: weather cuts lane capacity by ${Math.round(lane.wcut * 95)}%.` });
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
  return {
    region: Rg.name, currency: cur,
    actions: Object.entries(plan.sel).filter(([, v]) => v).map(([k]) => ACTION_LABEL[k]),
    parcelsOverCapacityPerDay: r(an.gap), laneShortfall: r(an.laneGap), hubShortfall: r(an.hubGap), etaRiskFromRoadDelay: r(an.etaRisk),
    onTime: r(plan.onTime), diverted: r(plan.div), temporaryCapacity: r(plan.temp + plan.shift), revisedPromise: r(plan.prm), stillLate: r(plan.late), slaCriticalStillLate: r(plan.lateCrit),
    incrementalCostPerDay: r(plan.cost.total), transportCost: r(plan.cost.transport), temporaryCapacityCost: r(plan.cost.temporary), promiseCredits: r(plan.cost.credits),
    assumedTrustCost: r(plan.shadow.trust), assumedLatePenalty: r(plan.shadow.late),
    closedRoads: an.lanes.filter(l => l.roadClosed).map(l => `${N[l.a]}–${N[l.b]}`),
    worstLanes: an.lanes.filter(l => l.over > 0).sort((a, b) => b.over - a.over).slice(0, 4).map(l => `${N[l.a]}–${N[l.b]}: capacity ${r(l.c)}→${r(l.eff)}, volume ${r(l.v)}, short ${r(l.over)} (${l.reason})`),
    overloadedHubs: an.hubs.filter(h => h.over > 0).map(h => `${N[h.id]}: load ${r(h.load)} vs capacity ${r(h.eff)}, short ${r(h.over)}`),
    reroutes: an.sol.plans.slice(0, 4).map(p => `${N[p.from]}→${N[p.to]} via ${p.via.map(i => N[i]).join(', ')}: ${r(p.units)} parcels at ${cur}${p.unit.toFixed(2)} each, ${Math.round(p.minutes / 6) / 10} h`)
  };
}
