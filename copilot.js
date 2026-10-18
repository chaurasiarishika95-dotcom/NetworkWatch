// Operations copilot tools. Each tool runs the Network Watch engine and returns numbers plus evidence
// (metric, value, source, timestamp). Gemini only chooses tools and explains their results; the rule-based
// fallback answers the same questions without Gemini.
import { getRegion, buildContext, analyse, comparePlans, allocate, routeWithAlternative, routeRisks, planFacts, ACTION_LABEL } from './engine.js';

const r0 = n => Math.round(n);
const fmt = (n, cur = '') => cur + Math.round(n).toLocaleString('en-IN');

// Rebuild the exact analysis the page is showing, from the state the page sends.
export function rebuild(state) {
  const Rg = getRegion(state.region || 'in', { usRegion: state.usRegion, overrides: state.overrides || null });
  const scenario = state.scenarioId === 'live' ? null : Rg.SC[state.scenarioId] || null;
  const wx = state.scenarioId === 'live' ? state.wx || {} : scenario?.wx || {};
  const ctx = buildContext(Rg, { wx, scenario, intensity: state.scenarioId === 'live' ? 100 : state.intensity ?? 100, traffic: state.traffic || {}, orders: state.orders ? { ...buildContext(Rg, {}).orders, ...state.orders } : undefined, sel: state.sel, settings: state.settings });
  const an = analyse(Rg, ctx);
  const now = new Date().toISOString();
  const src = {
    data: { source: state.dataSource?.source || 'Built-in sample data', at: state.dataSource?.at || null },
    weather: state.scenarioId === 'live' ? { source: state.wxSource?.source || 'Open-Meteo live', at: state.wxSource?.at || null } : { source: `Saved scenario "${scenario?.name || '—'}" (illustrative, ${state.intensity ?? 100}% intensity)`, at: null },
    traffic: state.trafficSource?.live ? { source: state.trafficSource.source, at: state.trafficSource.at } : { source: 'Estimate (road km at assumed speed, no live traffic)', at: null },
    calc: { source: 'Network Watch optimiser (calculated)', at: now }
  };
  return { Rg, an, wx, scenario, src, state };
}

const ev = (metric, value, s) => ({ metric, value, source: s.source, at: s.at });
const hubIds = (Rg, text) => {
  const t = ` ${String(text).toLowerCase()} `, hits = [];
  for (const [id, name] of Object.entries(Rg.NM)) {
    const variants = [name.toLowerCase(), name.toLowerCase().split(' ')[0], id.toLowerCase()];
    let best = -1; for (const v of variants) { const m = t.search(new RegExp(`[^a-z]${v}[^a-z]`)); if (m >= 0 && (best < 0 || m < best)) best = m; }
    if (best >= 0) hits.push([best, id]);
  }
  return [...new Set(hits.sort((a, b) => a[0] - b[0]).map(h => h[1]))];
};
const resolveHub = (Rg, s) => s && (Rg.NM[String(s).toUpperCase()] ? String(s).toUpperCase() : hubIds(Rg, s)[0]);
const selFrom = a => ({ div: !!a.divert, cap: !!a.temporary_capacity, pri: !!a.prioritise_sla, prm: !!a.adjust_promises });
const selLabel = sel => Object.entries(sel).filter(([, v]) => v).map(([k]) => ACTION_LABEL[k]).join(' + ') || 'Do nothing';
function planSummary(Rg, p) {
  const cur = Rg.costs.cur;
  return { actions: selLabel(p.sel), onTime: r0(p.onTime), diverted: r0(p.div), temporaryCapacity: r0(p.temp + p.shift), revisedPromise: r0(p.prm), stillLate: r0(p.late), slaCriticalLate: r0(p.lateCrit), incrementalCost: fmt(p.cost.total, cur), assumedTrustAndLateCost: fmt(p.shadow.trust + p.shadow.late, cur), totalModelledCost: fmt(p.objective, cur) };
}

export const TOOL_DECLS = [
  { name: 'network_status', description: 'Current disruption across the whole network: parcels over capacity, overloaded hubs, closed roads, worst lanes, data sources.', parameters: { type: 'object', properties: {} } },
  { name: 'route_risk', description: 'Risk on the journey between two hubs: fastest hub sequence, alternative, per-leg traffic delay, weather and capacity.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'Origin hub name or code' }, to: { type: 'string', description: 'Destination hub name or code' } }, required: ['from', 'to'] } },
  { name: 'hub_status', description: 'Why a hub is backing up: sort-centre load vs capacity, weather, inbound/outbound lanes over capacity.', parameters: { type: 'object', properties: { hub: { type: 'string' } }, required: ['hub'] } },
  { name: 'compare_recovery_plans', description: 'Run the optimiser over all combinations of the four interventions and rank them by total modelled cost. Returns the recommended plan, alternatives and the do-nothing baseline.', parameters: { type: 'object', properties: {} } },
  { name: 'evaluate_plan', description: 'Evaluate one specific combination of interventions (what-if).', parameters: { type: 'object', properties: { divert: { type: 'boolean' }, temporary_capacity: { type: 'boolean', description: 'Extra sort shift and/or hired market trucks' }, prioritise_sla: { type: 'boolean' }, adjust_promises: { type: 'boolean' } }, required: ['divert', 'temporary_capacity', 'prioritise_sla', 'adjust_promises'] } },
  { name: 'propose_intervention', description: 'Put a plan in front of the manager for approval. Does not execute anything.', parameters: { type: 'object', properties: { divert: { type: 'boolean' }, temporary_capacity: { type: 'boolean' }, prioritise_sla: { type: 'boolean' }, adjust_promises: { type: 'boolean' }, reason: { type: 'string' } }, required: ['divert', 'temporary_capacity', 'prioritise_sla', 'adjust_promises'] } }
];

export function runTool(ctxAll, name, args = {}) {
  const { Rg, an, wx, src } = ctxAll, N = Rg.NM, cur = Rg.costs.cur;
  if (name === 'network_status') {
    const worst = an.lanes.filter(l => l.over > 0).sort((a, b) => b.over - a.over).slice(0, 5);
    const hubs = an.hubs.filter(h => h.over > 0);
    return {
      result: {
        region: Rg.name, parcelsWithoutCapacityPerDay: r0(an.gap), laneShortfall: r0(an.laneGap), hubShortfall: r0(an.hubGap), parcelsPastPromiseFromRoadDelay: r0(an.etaRisk),
        closedRoads: an.lanes.filter(l => l.roadClosed).map(l => `${N[l.a]}–${N[l.b]} (simulated closure)`),
        worstLanes: worst.map(l => ({ lane: `${N[l.a]}–${N[l.b]}`, capacity: r0(l.eff), originalCapacity: l.c, volume: r0(l.v), short: r0(l.over), reason: l.reason })),
        overloadedHubs: hubs.map(h => ({ hub: N[h.id], load: r0(h.load), capacity: r0(h.eff), short: r0(h.over) })),
        note: 'Counts are per lane and per hub, so totals are an upper bound. Estimates, not actual delayed-order counts.'
      },
      evidence: [ev('Parcels without capacity / day', fmt(an.gap), src.calc), ev('Lane capacities and volumes', Rg.name, src.data), ev('Weather inputs', '', src.weather), ...(an.etaRisk ? [ev('Parcels past promise from road delay', fmt(an.etaRisk), src.traffic)] : [])]
    };
  }
  if (name === 'route_risk') {
    const a = resolveHub(Rg, args.from), b = resolveHub(Rg, args.to);
    if (!a || !b) return { result: { error: `Unknown hub. Known hubs: ${Object.values(N).join(', ')}` }, evidence: [] };
    const { best, alt, directClosed } = routeWithAlternative(an, a, b);
    if (!best) return { result: { error: `No open route between ${N[a]} and ${N[b]}.` }, evidence: [] };
    const leg = x => ({ leg: `${N[x.from]}→${N[x.to]}`, travelMin: r0(x.lane.travelMin), delayMin: r0(x.lane.delayMin), weatherCapacityCutPct: r0(x.lane.wcut * 95), utilisationPct: r0(x.lane.v / Math.max(1, x.lane.eff) * 100), short: r0(x.lane.over), trafficSource: x.lane.traffic.source });
    return {
      result: {
        route: best.hubs.map(h => N[h]).join(' → '), totalHours: +(best.minutes / 60).toFixed(1), freeFlowHours: +(best.freeMinutes / 60).toFixed(1), km: r0(best.km), legs: best.legs.map(leg),
        directLaneClosed: directClosed ? `${N[directClosed.a]}–${N[directClosed.b]} is closed (simulated)` : null,
        alternative: alt ? { route: alt.hubs.map(h => N[h]).join(' → '), totalHours: +(alt.minutes / 60).toFixed(1) } : null,
        risks: routeRisks(an, best, wx).map(x => x.text),
        lanesAtRisk: an.lanes.filter(l => [l.a, l.b].every(h => best.hubs.includes(h)) && (l.over > 0 || l.wcut > 0 || l.delayMin > 10)).map(l => `${N[l.a]}–${N[l.b]}`)
      },
      evidence: [ev(`Travel time ${N[a]}→${N[b]}`, `${(best.minutes / 60).toFixed(1)} h`, best.legs.some(x => x.lane.traffic.live) ? { source: best.legs[0].lane.traffic.source, at: best.legs[0].lane.traffic.at } : src.traffic), ev('Weather on route', best.hubs.map(h => N[h]).join(', '), src.weather), ev('Lane capacity', '', src.data)]
    };
  }
  if (name === 'hub_status') {
    const h = resolveHub(Rg, args.hub);
    if (!h) return { result: { error: `Unknown hub. Known hubs: ${Object.values(N).join(', ')}` }, evidence: [] };
    const hs = an.hubs.find(x => x.id === h), inc = an.lanes.filter(l => l.a === h || l.b === h), w = wx?.[h];
    const surge = an.ctx.surge[h] ? `${r0((an.ctx.surge[h] - 1) * 100)}% above normal volume` : null;
    return {
      result: {
        hub: N[h], sortLoad: hs ? r0(hs.load) : null, sortCapacity: hs ? r0(hs.eff) : null, normalSortCapacity: hs?.cap ?? null, shortPerDay: hs ? r0(hs.over) : 0,
        capacityCutPct: hs ? r0(hs.cut * 95) : r0((an.ctx.cuts[h] || 0) * 95), volumeSurge: surge,
        weather: w ? { gustKmh: r0((w.gust || 0) * 1.609), rainMmH: +(w.rain || 0).toFixed(1), visibilityM: w.vis ?? null } : 'no weather reading',
        lanes: inc.map(l => ({ lane: `${N[l.a]}–${N[l.b]}`, volume: r0(l.v), capacity: r0(l.eff), short: r0(l.over), delayMin: r0(l.delayMin), closed: l.roadClosed }))
      },
      evidence: [ev(`${N[h]} sort load vs capacity`, hs ? `${fmt(hs.load)} / ${fmt(hs.eff)}` : '', src.data), ev(`${N[h]} weather`, '', src.weather), ev('Shortfall', hs ? fmt(hs.over) : '0', src.calc)]
    };
  }
  if (name === 'compare_recovery_plans') {
    const cmp = comparePlans(Rg, an);
    return {
      result: { recommended: planSummary(Rg, cmp.best), alternatives: cmp.ranked.slice(1, 5).map(p => planSummary(Rg, p)), doNothing: planSummary(Rg, cmp.doNothing), rule: `Ranked by incremental cost + assumed trust cost of a revised promise (${cur}${Rg.costs.trust} each, double for SLA-critical) + assumed cost of a late parcel (${cur}${Rg.costs.lateStd}, ${cur}${Rg.costs.lateCrit} SLA-critical). These costs are assumptions.` },
      evidence: [ev('Recommended plan cost / day', fmt(cmp.best.cost.total, cur), src.calc), ev('Parcels at risk if nothing is done', fmt(cmp.doNothing.late), src.calc), ev('Capacities, volumes, temporary capacity', '', src.data)],
      _best: cmp.best
    };
  }
  if (name === 'evaluate_plan' || name === 'propose_intervention') {
    const sel = selFrom(args), p = allocate(Rg, an, sel);
    const out = { result: planSummary(Rg, p), evidence: [ev(`${selLabel(sel)}: cost / day`, fmt(p.cost.total, cur), src.calc), ev('Temporary capacity timing', `trucks ${Rg.costs.laneTemp.activationH} h${Rg.costs.shift ? `, shift ${Rg.costs.shift.activationH} h` : ''} to activate`, src.data)] };
    if (name === 'propose_intervention') { out.proposal = { sel, reason: args.reason || '', summary: planSummary(Rg, p), facts: planFacts(an, p) }; out.result = { ...out.result, status: 'Proposed. Waiting for manager approval. Nothing has been executed.' }; }
    return out;
  }
  return { result: { error: 'Unknown tool' }, evidence: [] };
}

// ---------- Rule-based fallback (no Gemini) ----------
export function ruleAnswer(ctxAll, question) {
  const { Rg, an } = ctxAll, N = Rg.NM, cur = Rg.costs.cur, q = String(question).toLowerCase();
  const ids = hubIds(Rg, q), used = [], evid = [];
  const call = (n, a) => { const r = runTool(ctxAll, n, a); used.push(n); evid.push(...r.evidence); return r; };
  let text = '', proposal = null;
  const cmp = () => call('compare_recovery_plans', {});
  const propose = best => { if (best && best.objective > 0 && Object.values(best.sel).some(Boolean)) { const p = call('propose_intervention', { divert: best.sel.div, temporary_capacity: best.sel.cap, prioritise_sla: best.sel.pri, adjust_promises: best.sel.prm }); proposal = p.proposal; } };
  const planLine = s => `${s.actions}: ${s.onTime.toLocaleString('en-IN')} on time, ${s.revisedPromise.toLocaleString('en-IN')} given a new date, ${s.stillLate.toLocaleString('en-IN')} still late, ${s.incrementalCost} per day`;

  if (/do nothing|miss|kuch nahi|bina kuch|if we don.t/.test(q)) {
    const c = cmp(); const dn = c.result.doNothing;
    text = `If nothing is done, about ${dn.stillLate.toLocaleString('en-IN')} parcels a day miss their delivery promise (${dn.slaCriticalLate.toLocaleString('en-IN')} of them SLA-critical). The recommended plan brings that to ${c.result.recommended.stillLate.toLocaleString('en-IN')}: ${planLine(c.result.recommended)}.`;
    propose(c._best);
  } else if (/shift|instead|bajaye|ki jagah/.test(q)) {
    const capOnly = call('evaluate_plan', { divert: false, temporary_capacity: true, prioritise_sla: true, adjust_promises: true }).result;
    const divOnly = call('evaluate_plan', { divert: true, temporary_capacity: false, prioritise_sla: true, adjust_promises: true }).result;
    const c = cmp();
    text = `Extra capacity instead of diversion → ${planLine(capOnly)}.\nDiversion without extra capacity → ${planLine(divOnly)}.\nBest combination → ${planLine(c.result.recommended)}.`;
    propose(c._best);
  } else if (/rerout|divert|diversion/.test(q)) {
    const d = call('evaluate_plan', { divert: true, temporary_capacity: false, prioritise_sla: false, adjust_promises: false }).result;
    const avg = an.sol.total ? an.sol.cost / an.sol.total : 0;
    text = an.sol.total
      ? `Rerouting can move up to ${fmt(an.sol.total)} parcels a day through lanes with spare room, at about ${cur}${avg.toFixed(2)} per parcel (${d.incrementalCost} per day for the ${d.diverted.toLocaleString('en-IN')} the optimiser would divert). ${an.sol.plans.slice(0, 3).map(p => `${N[p.from]}→${N[p.to]} via ${p.via.map(i => N[i]).join(', ')}: ${fmt(p.units)} parcels`).join('; ')}.`
      : `Rerouting cannot help here: every usable alternative lane is also short of capacity, or the detour is too slow to keep the promise.`;
    const c = cmp(); text += ` Recommended overall: ${planLine(c.result.recommended)}.`; propose(c._best);
  } else if (/lowest|cheapest|best|recommend|sasta|kya karna|what should/.test(q)) {
    const c = cmp(); const b = c.result.recommended;
    text = an.gap + an.etaRisk < 0.5 ? 'Nothing needs fixing: every lane and hub is within capacity.' : `Lowest-cost feasible plan: ${planLine(b)}. Next best: ${c.result.alternatives.slice(0, 2).map(planLine).join(' | ')}. Doing nothing leaves ${c.result.doNothing.stillLate.toLocaleString('en-IN')} parcels late.`;
    propose(c._best);
  } else if (ids.length >= 2) {
    const r = call('route_risk', { from: ids[0], to: ids[1] }).result;
    text = r.error || `${r.route}: about ${r.totalHours} h (${r.freeFlowHours} h without traffic). ${r.directLaneClosed ? r.directLaneClosed + '. ' : ''}${r.risks.length ? 'Risks: ' + r.risks.join(' ') : 'No weather, traffic or capacity risk on this route right now.'}${r.alternative ? ` Alternative: ${r.alternative.route} (${r.alternative.totalHours} h).` : ''}`;
  } else if (ids.length === 1) {
    const h = call('hub_status', { hub: ids[0] }).result;
    const badLanes = h.lanes.filter(l => l.short > 0 || l.closed);
    text = `${h.hub}: ${h.sortLoad != null ? `sorting ${h.sortLoad.toLocaleString('en-IN')} parcels against capacity of ${h.sortCapacity.toLocaleString('en-IN')} (short by ${h.shortPerDay.toLocaleString('en-IN')}). ` : ''}${h.volumeSurge ? `Volume is ${h.volumeSurge}. ` : ''}${h.capacityCutPct ? `Capacity is cut ${h.capacityCutPct}%. ` : ''}${badLanes.length ? `Lanes short: ${badLanes.map(l => `${l.lane}${l.closed ? ' (closed)' : ` (${l.short.toLocaleString('en-IN')})`}`).join(', ')}.` : 'Its lanes have enough capacity.'}`;
    if (h.shortPerDay > 0 || badLanes.length) { const c = cmp(); text += ` Recommended: ${planLine(c.result.recommended)}.`; propose(c._best); }
  } else {
    const s = call('network_status', {}).result;
    text = s.parcelsWithoutCapacityPerDay + s.parcelsPastPromiseFromRoadDelay < 1 ? `${s.region}: no disruption. Every lane and hub is within capacity.` : `${s.region}: about ${s.parcelsWithoutCapacityPerDay.toLocaleString('en-IN')} parcels a day have no capacity${s.parcelsPastPromiseFromRoadDelay ? ` and ${s.parcelsPastPromiseFromRoadDelay.toLocaleString('en-IN')} more are pushed past their promise by road delay` : ''}. ${s.closedRoads.length ? 'Closed: ' + s.closedRoads.join(', ') + '. ' : ''}${s.worstLanes.length ? 'Worst lanes: ' + s.worstLanes.slice(0, 3).map(l => `${l.lane} short ${l.short.toLocaleString('en-IN')} (${l.reason})`).join('; ') + '. ' : ''}${s.overloadedHubs.length ? 'Overloaded hubs: ' + s.overloadedHubs.map(h => `${h.hub} short ${h.short.toLocaleString('en-IN')}`).join('; ') + '.' : ''}`;
  }
  return { text: text + (proposal ? '\n\nI have put this plan up for your approval below. Nothing changes until you approve it, and approval only records the decision.' : ''), evidence: evid, proposal, tools: used };
}
