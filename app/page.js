'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { US_REGION_LABELS, projectIN } from '../lib/regions';
import { getRegion, buildContext, analyse, comparePlans, allocate, routeWithAlternative, routeRisks, planFacts, cutOf, ACTION_LABEL } from '../lib/engine';

// ALL NETWORK AND ORDER DATA IS SAMPLE DATA (invented for this demo) unless real operational data is loaded from Supabase.
// Saved scenarios are illustrative approximations, not official records.
const OPT_KEYS = ['div', 'cap', 'pri', 'prm'];
const NONE = { div: false, cap: false, pri: false, prm: false };
const col = u => u > 1 ? 'var(--bad)' : u > .85 ? 'var(--warn)' : 'var(--ok)';
const MEANING = { 'Rip Current Statement': 'Dangerous currents for swimmers at beaches. Does not affect trucks or lanes.', 'Flood Watch': 'Flooding is possible but has not started. Some roads could be affected later.', 'Flood Warning': 'Flooding is happening, usually along rivers. A few local roads may close.', 'Coastal Flood Advisory': 'Minor flooding near the coast at high tide. Low impact on trucking.', 'Coastal Flood Statement': 'Update on minor coastal flooding. Low impact on trucking.', 'High Surf Advisory': 'Large waves at beaches. Does not affect trucks or lanes.', 'Tropical Cyclone Local Statement': 'Local impacts expected from a tropical storm or hurricane. Check whether coastal lanes could be hit.' };
const SEVERE = /hurricane|tropical|tornado|storm surge|high wind|extreme wind|blizzard|ice storm|winter storm/i;
const tm = iso => iso ? new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

function LiveBox({ live, Rg, us, region = 'all', gap, word }) {
  if (!live) return <p className="note">Loading current conditions...</p>;
  if (live.error) return <p className="note">{live.error} Pick a saved scenario instead.</p>;
  const ids = Object.keys(live.nodes), N = Rg.NM, metric = Rg.units === 'metric';
  const gu = g => metric ? `${Math.round(g * 1.609)} km/h` : `${Math.round(g)} mph`;
  const gid = ids.reduce((a, b) => live.nodes[b].gust > live.nodes[a].gust ? b : a), rid = ids.reduce((a, b) => live.nodes[b].rain > live.nodes[a].rain ? b : a);
  const g = live.nodes[gid].gust, rn = live.nodes[rid].rain, hit = ids.filter(i => cutOf(live.nodes[i]) > 0);
  const lvl = hit.length ? (gap > 0 ? 'Disruptive' : 'Watch') : g >= 20 ? 'Breezy' : 'Calm', color = gap > 0 ? 'var(--bad)' : hit.length || g >= 20 ? 'var(--warn)' : 'var(--ok)';
  const sev = (live.alerts || []).filter(a => SEVERE.test(a.event));
  return (<div className="verdict" style={{ borderLeft: '5px solid ' + color }}>
    <b>Live weather right now: {lvl}</b>
    <div className="note" style={{ color: 'var(--ink)' }}>{hit.length ? `Weather is cutting capacity at: ${hit.map(i => N[i]).join(', ')}.${gap > 0 ? '' : ' Today\'s volume still fits, so no action is needed yet.'}` : `No hub is hit hard enough to lose capacity. The windiest hub is ${N[gid]} at ${gu(g)} gusts (capacity only starts dropping above ${metric ? '56 km/h' : '35 mph'}). The wettest is ${N[rid]} at ${rn.toFixed(1)} mm of rain per hour (heavy rain starts at about 2).`}</div>
    <div className="note" style={{ color: 'var(--ink)', marginTop: 6 }}><b>Network impact:</b> {gap > 0 ? 'Yes. Look at the map and the numbers below.' : hit.length || sev.length ? 'Capacity is reduced but nothing overflows yet. See the early warning below.' : `None. The network runs normally, so overflow is 0.`}</div>
    {us ? <><div className="note" style={{ marginTop: 6 }}><b>Official US alerts ({US_REGION_LABELS[region] || 'selected region'})</b> (National Weather Service, as of {new Date(live.fetchedAt).toLocaleTimeString()}):</div>
      {live.alerts.length ? <ul className="why">{live.alerts.map(a => <li key={a.event}><b>{a.event}{a.count > 1 ? ' (x' + a.count + ')' : ''}:</b> {MEANING[a.event] || 'See weather.gov for details.'} <i>{SEVERE.test(a.event) ? 'Could disrupt lanes.' : 'Not a trucking threat.'}</i></li>)}</ul> : <div className="note">No active alerts.</div>}
      <div className="note">Alerts are shown for context. The model uses weather readings only.</div></>
      : <>{live.flags?.length ? <ul className="why" style={{ marginTop: 6 }}>{live.flags.map((f, i) => <li key={i}><b>{N[f.hub]}:</b> {f.type} ({f.detail})</li>)}</ul> : null}
        <div className="note" style={{ marginTop: 6 }}>Conditions from Open-Meteo as of {tm(live.fetchedAt)}. {metric ? 'Risk flags come from the readings (gusts, rain, visibility). Official IMD warnings are not included.' : 'Official German weather alerts are not included.'}</div></>}
  </div>);
}

function Forecast({ Rg, lanes }) {
  const ids = Object.keys(Rg.P), [hub, setHub] = useState(null), [gr, setGr] = useState(3);
  const h = ids.includes(hub) ? hub : ids.includes('ATL') ? 'ATL' : ids.includes('DEL') ? 'DEL' : ids[0];
  const inc = lanes.filter(l => l.a === h || l.b === h), base = inc.reduce((s, l) => s + l.v, 0) / inc.reduce((s, l) => s + l.c, 0);
  const pts = Array.from({ length: 14 }, (_, d) => base * Math.pow(1 + gr / 100, d) + .02 * Math.sin(d * 2 * Math.PI / 7));
  const br = pts.findIndex(v => v > 1), W = 700, H = 150, pad = 28, x = d => pad + d * (W - 2 * pad) / 13, y = v => H - 24 - (Math.min(v, 1.3) - .6) * (H - 44) / .7;
  const word = Rg.id === 'in' ? 'parcels' : 'packages';
  return (<section className="card"><h2>Look ahead: capacity forecast for the next 14 days</h2>
    <div className="row"><label className="note">Hub: <select value={h} onChange={e => setHub(e.target.value)}>{ids.map(i => <option key={i} value={i}>{Rg.NM[i]}</option>)}</select></label>
      <label className="note" style={{ flex: 1, minWidth: 200 }}>Assumed demand growth (peak season): {gr}% per day<input type="range" min="0" max="5" step=".5" value={gr} onChange={e => setGr(+e.target.value)} style={{ width: '100%' }} /></label></div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Forecast load versus capacity for 14 days">
      <line x1={pad} x2={W - pad} y1={y(1)} y2={y(1)} strokeDasharray="5 4" style={{ stroke: 'var(--bad)' }} /><text className="lbl" x={W - pad} y={y(1) - 5} textAnchor="end" style={{ fill: 'var(--bad)' }}>100% of capacity</text>
      <polyline fill="none" strokeWidth="3" style={{ stroke: 'var(--ok)' }} points={pts.map((v, d) => x(d) + ',' + y(v)).join(' ')} />
      {pts.map((v, d) => <g key={d}><circle cx={x(d)} cy={y(v)} r={v > 1 ? 5 : 3} style={{ fill: v > 1 ? 'var(--bad)' : 'var(--ok)' }}><title>{`Day ${d + 1}: ${Math.round(v * 100)}% of capacity`}</title></circle>{d % 2 === 0 && <text x={x(d)} y={H - 6} fontSize="11" textAnchor="middle" style={{ fill: 'var(--mute)' }}>D{d + 1}</text>}</g>)}
    </svg>
    <p className="verdict">{br >= 0 ? `${Rg.NM[h]} is forecast to pass 100% of capacity on day ${br + 1}. That gives the planner about ${br} days to add capacity or shift volume before ${word} are at risk.` : `${Rg.NM[h]} stays under capacity for the next 14 days at this growth rate.`}</p>
    <p className="note">Simulated: starts from {Rg.NM[h]}'s current load ({Math.round(base * 100)}% of capacity) and grows at the rate you set. It is a simple growth rule, not a trained forecast.</p></section>);
}

function Evidence({ items }) {
  if (!items?.length) return null;
  const seen = new Set(), list = items.filter(e => { const k = e.metric + e.source; if (seen.has(k)) return false; seen.add(k); return true; });
  return <details className="note" style={{ marginTop: 6 }}><summary>Sources for these numbers ({list.length})</summary><ul className="why">{list.map((e, i) => <li key={i}><b>{e.metric}</b>{e.value ? `: ${e.value}` : ''} — {e.source}{e.at ? `, ${tm(e.at)}` : ''}</li>)}</ul></details>;
}

export default function Home() {
  const [rg, setRg] = useState('in'), [usRegion, setUsRegion] = useState('all'), [sid, setSid] = useState('agra'), [liveD, setLiveD] = useState({}), [k, setK] = useState(100);
  const [sel, setSel] = useState(NONE), [ex, setEx] = useState(null), [rec, setRec] = useState(null);
  const [data, setData] = useState(null), [traffic, setTraffic] = useState(null), [useTraffic, setUseTraffic] = useState(true), [od, setOd] = useState(null);
  const [from, setFrom] = useState('JAI'), [to, setTo] = useState('DEL'), [settings, setSettings] = useState({ windowH: 12, slackH: 6 });
  const [chat, setChat] = useState([]), [q, setQ] = useState(''), [asking, setAsking] = useState(false), [proposal, setProposal] = useState(null);
  const [decisions, setDecisions] = useState({ stored: false, items: [] }), [approver, setApprover] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false), [saveMsg, setSaveMsg] = useState(null);
  const chatEnd = useRef(null);
  const india = rg === 'in';

  // Operational data (Supabase or sample) and decision history, once.
  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData).catch(() => setData({ source: 'sample', reason: 'Data service unavailable, using built-in sample data.' }));
    fetch('/api/decisions').then(r => r.json()).catch(() => ({ stored: false, items: [] })).then(d => setDecisions({ ...d, local: store.get('nw-decisions') || [] }));
  }, []);
  const loadTraffic = (force) => { setTraffic(t => force ? { ...(t || {}), loading: true } : t); fetch('/api/traffic').then(r => r.json()).then(j => setTraffic({ ...j, loadedAt: new Date().toISOString() })).catch(() => setTraffic({ live: false, reason: 'Traffic service unavailable. Travel times are estimated.' })); };
  useEffect(() => { if (india && !traffic) loadTraffic(); }, [india]);

  const overrides = india && data?.source === 'supabase' ? data.overrides : null;
  const Rg = useMemo(() => getRegion(rg, { usRegion, overrides }), [rg, usRegion, overrides]);
  const liveKey = rg === 'us' ? `us:${usRegion}` : rg, live = liveD[liveKey];
  const loadLive = () => {
    const set = v => setLiveD(d => ({ ...d, [liveKey]: v })), fail = () => set({ error: 'Live weather is unavailable right now.' });
    if (india) { fetch('/api/weather?country=in').then(r => r.json()).then(j => { if (j.error || !j.nodes) throw 0; set(j); }).catch(fail); return; }
    const ids = Object.keys(Rg.C);
    const om = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ids.map(i => Rg.C[i][0]).join(',')}&longitude=${ids.map(i => Rg.C[i][1]).join(',')}&current=wind_gusts_10m,precipitation,snowfall&wind_speed_unit=mph`).then(r => r.json());
    const al = rg === 'us' ? fetch(`/api/weather?region=${encodeURIComponent(usRegion)}`).then(r => r.json()).then(j => j.alerts || []).catch(() => []) : Promise.resolve([]);
    Promise.all([om, al]).then(([j, alerts]) => { if (!Array.isArray(j) && j.error) throw 0; const a = Array.isArray(j) ? j : [j], nodes = {}; ids.forEach((id, i) => { const c = a[i]?.current || {}; nodes[id] = { gust: c.wind_gusts_10m ?? 0, rain: c.precipitation ?? 0, snow: c.snowfall ?? 0 }; }); set({ nodes, alerts, fetchedAt: new Date().toISOString() }); }).catch(fail);
  };
  useEffect(() => { if (sid === 'live' && !liveD[liveKey]) loadLive(); }, [sid, liveKey]);
  useEffect(() => { if (india && from && to) { setOd(null); fetch(`/api/traffic?from=${from}&to=${to}`).then(r => r.json()).then(setOd).catch(() => setOd(null)); } }, [india, from, to]);
  useEffect(() => setEx(null), [sid, rg, k, sel]);
  useEffect(() => setRec(null), [sid, rg, k]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [chat]);

  const scenario = sid === 'live' ? null : Rg.SC[sid];
  const wx = sid === 'live' ? live?.nodes : scenario?.wx;
  const intensity = sid === 'live' ? 100 : k; // Live mode always uses actual readings.
  const trafficLanes = india && useTraffic && traffic?.live ? traffic.lanes : {};
  const orders = india && data?.orders && Object.keys(data.orders).length ? data.orders : null;
  const ctxArgs = { wx, scenario, traffic: trafficLanes, settings: india ? settings : {} };
  const baseOrders = useMemo(() => buildContext(Rg, {}).orders, [Rg]);
  const mergedOrders = orders ? { ...baseOrders, ...orders } : baseOrders;
  const an = useMemo(() => analyse(Rg, buildContext(Rg, { ...ctxArgs, intensity, orders: mergedOrders, sel })), [Rg, wx, scenario, intensity, trafficLanes, settings, sel, mergedOrders]);
  const cmp = useMemo(() => comparePlans(Rg, an), [an]);
  const plan = an.plan, N = Rg.NM, C = Rg.costs, cur = C.cur, word = india ? 'parcels' : 'packages';
  const f = n => Math.round(n).toLocaleString(india ? 'en-IN' : 'en-US'), money = n => cur + f(n);
  const nsel = Object.values(sel).filter(Boolean).length, atRisk = an.atRisk, t = Math.max(1, atRisk);
  const w = an.lanes.filter(l => l.over > 0).sort((a, b) => b.over - a.over).slice(0, 4), uc = an.sol.total ? an.sol.cost / an.sol.total : 0;
  const route = useMemo(() => india ? routeWithAlternative(an, from, to) : { best: null }, [an, from, to, india]);
  const risks = route.best ? routeRisks(an, route.best, wx) : [];

  const tog = key => setSel(s => ({ ...s, [key]: !s[key] }));
  const pick = x => { setRg(x); setSid(x === 'us' ? 'ian' : x === 'de' ? 'snow' : 'agra'); if (x === 'us') setUsRegion('all'); setSel(NONE); setRec(null); setK(100); setProposal(null); };
  const pickUSRegion = x => { const next = getRegion('us', { usRegion: x }), preferred = { all: 'ian', west: 'west', midwest: 'blizzard', northeast: 'blizzard', southeast: 'ian', plains: 'plains' }[x]; setUsRegion(x); setSid(c => c === 'live' ? 'live' : (next.SC[preferred] ? preferred : Object.keys(next.SC)[0] || 'live')); setSel(NONE); setRec(null); setK(100); };

  // Option descriptions from the current analysis.
  const lanePool = C.laneTemp.share * an.items.filter(i => i.kind === 'lane' && i.tempOK).reduce((s, i) => s + i.lost, 0);
  const ltUse = plan.timing.laneTemp.usableShare, shUse = plan.timing.shift?.usableShare;
  const shiftHubs = an.items.filter(i => i.kind === 'hub');
  const tooSlow = Object.entries(an.sol.byLane).filter(([, v]) => v.tooSlow);
  const critPct = Math.round(100 * an.items.reduce((s, i) => s + i.amount * i.cs, 0) / Math.max(1, atRisk));
  const desc = {
    div: `${an.sol.total >= 1 ? `Cheapest detours through lanes${an.hubs.length ? ' and hubs' : ''} that still have room: up to ${f(an.sol.total)} ${word}/day at about ${cur}${uc.toFixed(2)} each.` : `No usable detour right now${an.laneGap > 0 ? ': the lanes around the damaged ones have no spare room' : ': no lane is over capacity'}.`}${atRisk > 0 && an.sol.total >= 1 && an.sol.total < an.gap * .25 ? ' Little room because most nearby lanes are also damaged.' : ''}${tooSlow.length ? ` Detours for ${tooSlow.map(([k]) => k.split('-').map(x => N[x]).join('–')).join(', ')} are too slow to keep the promise.` : ''}`,
    cap: india ? `Market trucks: ${lanePool < 1 ? 'no damaged lane needs them' : `up to ${f(lanePool * ltUse)} ${word}/day`} at ${cur}${C.laneTemp.cost} each, ready in ${C.laneTemp.activationH} h (helps ${Math.round(ltUse * 100)}% of the ${settings.windowH} h window)${an.items.some(i => i.viaBypass) ? '; on a closed road they run the bypass' : ''}. ${C.shift ? `Extra sort shift: ${shiftHubs.length ? `up to ${f(shiftHubs.reduce((s, i) => s + (C.shift.capByHub?.[i.hub] ?? C.shift.share * Rg.H[i.hub].cap) * shUse, 0))} at ${shiftHubs.map(i => N[i.hub]).join(', ')}` : 'no hub needs one'}, ${cur}${C.shift.cost} each, ready in ${C.shift.activationH} h.` : ''}` : `Recovers up to ${f(lanePool)} packages/day. $1.60 each. Takes hours to stand up.`,
    pri: `SLA-critical ${word} (about ${critPct || Math.round(C.critShare * 100)}% of those at risk) get the scarce capacity first; the rest are rescheduled or late. Free.`,
    prm: `Gives a new date to the ${word} nothing else can carry, before customers are let down. ${cur}${C.credit} credit each${india ? `, plus an assumed ${cur}${C.trust} trust cost (double for SLA-critical)` : ''}.`
  };
  const OPTS = [['div', 'Divert volume to unaffected lanes'], ['cap', india ? 'Add temporary capacity (market trucks, extra sort shift)' : 'Add temporary capacity'], ['pri', `Prioritize SLA-critical ${word}`], ['prm', 'Adjust delivery promises (+1 day)']];
  const selText = s => OPT_KEYS.filter(x => s[x]).map(x => ACTION_LABEL[x]).join(' + ') || 'Do nothing';
  const best = cmp.best, nextAlt = cmp.ranked[1];
  const recommend = () => { setSel(best.sel); setRec(!atRisk ? 'Nothing to fix: every lane and hub is within capacity.' : `The optimiser compared all 16 combinations and picked: ${selText(best.sel)}. It keeps ${f(best.onTime)} on time, gives ${f(best.prm)} a new date and leaves ${f(best.late)} late, for ${money(best.cost.total)} per day. Operational fixes come before promise changes because each revised promise carries an assumed ${cur}${C.trust} trust cost on top of the ${cur}${C.credit} credit. You can switch any response on or off to override this.`); };

  // Early warning when nothing overflows (original feature).
  const calm = atRisk < .5, anyCut = Object.values(an.ctx.cuts).some(v => v > 0);
  let worse = null; if (calm && anyCut) for (let x = 1.1; x <= 3.01; x += .1) { if (analyse(Rg, buildContext(Rg, { ...ctxArgs, intensity: intensity * x, orders: mergedOrders })).gap > 0) { worse = x; break; } }
  const sx = worse ? Math.min(3, worse + .5) : null;
  const stAn = sx ? analyse(Rg, buildContext(Rg, { ...ctxArgs, intensity: intensity * sx, orders: mergedOrders })) : null, st = stAn ? comparePlans(Rg, stAn).best : null;
  const tight = [...an.lanes].filter(l => l.eff > 0).sort((a, b) => b.v / b.eff - a.v / a.eff).slice(0, 3);

  // Sources (shown on screen and sent to the copilot).
  const dataSource = india && data?.source === 'supabase' ? { source: data.sample ? 'Supabase (rows marked as sample data)' : 'Supabase operational data', at: data.fetchedAt } : { source: 'Built-in sample data', at: null };
  const wxSource = sid === 'live' && live?.fetchedAt ? { source: 'Open-Meteo live', at: live.fetchedAt } : null;
  const trafficSource = india && useTraffic && traffic?.live ? { source: traffic.source, at: traffic.at, live: true } : { live: false };
  const scName = sid === 'live' ? 'Live conditions' : scenario?.name;
  const facts = { scenario: scName, intensityPercent: intensity, ...planFacts(an, plan) };

  const template = () => !atRisk ? `Under "${scName}", every lane and hub stays within capacity, so no ${word} are at risk.` : `Under "${scName}", about ${f(an.gap)} ${word} a day no longer fit${w.length ? `, mainly on ${w.slice(0, 2).map(l => `${N[l.a]}–${N[l.b]}`).join(' and ')}` : ''}${an.hubGap ? `, with ${f(an.hubGap)} more than ${an.hubs.filter(h => h.over > 0).map(h => N[h.id]).join(', ')} can sort` : ''}.${an.etaRisk ? ` Road delays push another ${f(an.etaRisk)} past their promise.` : ''} ${nsel ? `Your plan (${selText(sel).toLowerCase()}) keeps ${f(plan.onTime)} on time, gives ${f(plan.prm)} a new date and leaves ${f(plan.late)} late, at ${money(plan.cost.total)} per day.` : `You have not chosen a response yet, so all of them would be late.`} ${sel.prm ? 'Revising promises is cheap but spends customer trust.' : plan.late > 0 ? 'No option here is free: you trade cost against late parcels and customer trust.' : 'Everything is protected, but check what that costs.'} This is a simulation with sample data.`;
  const explain = async () => { setEx({ loading: true }); try { const res = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(facts) }); const j = await res.json(); if (res.ok && j.text) return setEx({ text: j.text, source: 'Gemini AI' }); throw 0; } catch (e) { setEx({ text: template(), source: 'Template (Gemini not available)' }); } };

  const copilotState = () => ({
    region: rg, usRegion, scenarioId: sid, intensity, wx: sid === 'live' ? live?.nodes : undefined, wxSource,
    traffic: Object.fromEntries(Object.entries(trafficLanes || {}).map(([key, v]) => [key, { travelMin: v.travelMin, freeMin: v.freeMin, source: v.source, at: v.at, live: v.live }])),
    trafficSource, orders, overrides, dataSource, sel, settings: india ? settings : {}, route: { from, to }
  });
  const ask = async (text) => {
    const question = (text ?? q).trim(); if (!question || asking) return;
    setQ(''); setAsking(true); const hist = chat.slice(-6).map(m => ({ role: m.role, text: m.text }));
    setChat(c => [...c, { role: 'user', text: question }]);
    try {
      const r = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: hist, state: copilotState() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed');
      setChat(c => [...c, { role: 'assistant', text: j.text, evidence: j.evidence, mode: j.mode, note: j.note }]);
      if (j.proposal) setProposal({ ...j.proposal, from: 'copilot' });
    } catch (e) { setChat(c => [...c, { role: 'assistant', text: `The copilot is unavailable right now (${e.message}). The numbers on this page are still current.`, mode: 'error' }]); }
    setAsking(false);
  };
  const proposeCurrent = (s, why) => { const p = allocate(Rg, an, s); setProposal({ sel: s, reason: why, facts: { scenario: scName, ...planFacts(an, p) }, from: 'optimiser' }); setSaveMsg(null); };
  const decide = async (decision) => {
    if (!proposal) return; setSaving(true);
    const p = allocate(Rg, an, proposal.sel), pf = { scenario: scName, ...planFacts(an, p) };
    const payload = { decision, approver: approver || 'Manager', note, scenario: scName, route: india ? { from, to } : null, facts: pf, alternatives: cmp.ranked.slice(0, 4).map(x => ({ actions: selText(x.sel), cost: Math.round(x.cost.total), onTime: Math.round(x.onTime), revised: Math.round(x.prm), late: Math.round(x.late) })), sources: { data: dataSource, weather: wxSource || { source: 'Saved scenario (illustrative)' }, traffic: trafficSource } };
    let res; try { res = await (await fetch('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).json(); } catch { res = { stored: false, reason: 'Decision service unavailable.' }; }
    const entry = { decision, approver: payload.approver, note, decided_at: res.at || new Date().toISOString(), plan: { scenario: scName, actions: pf.actions, incremental_cost: pf.incrementalCostPerDay, on_time: pf.onTime, revised_promise: pf.revisedPromise, still_late: pf.stillLate, currency: cur }, stored: !!res.stored };
    if (res.stored) setDecisions(d => ({ ...d, stored: true, items: [entry, ...(d.items || [])] }));
    else { const local = [entry, ...(store.get('nw-decisions') || [])].slice(0, 20); store.set('nw-decisions', local); setDecisions(d => ({ ...d, local })); }
    setSaveMsg(res.stored ? `Decision recorded in Supabase (${tm(entry.decided_at)}). No real route, staffing or promise was changed.` : `${res.reason || 'Not saved to the database.'} Kept in this browser only. No real route, staffing or promise was changed.`);
    setProposal(null); setNote(''); setSaving(false);
  };

  const hint = { fontSize: '13px', margin: '0 0 8px' };
  const P = Rg.P, proj = ([la, lo]) => projectIN(la, lo);
  const geom = key => india && traffic?.live && trafficLanes[key]?.geometry?.length > 1 ? trafficLanes[key].geometry.map(proj) : null;
  const routeKeys = new Set(route.best?.legs.map(x => x.lane.key) || []);
  const divPaths = sel.div ? an.sol.plans.filter(p => p.units >= 1).slice(0, 6) : [];
  const wxRows = india && route.best ? route.best.hubs : Object.keys(P);
  const metric = Rg.units === 'metric';

  return (<main>
    <h1>Network Watch</h1>
    <p className="sub">When weather, road traffic or a sort-centre overload hits the network, which {word} miss their promise, and what should the manager do? Decision support for a {india ? 'North India parcel network' : 'simulated transportation network'}.</p>
    <section className="card warnbox"><b>{india && data?.source === 'supabase' && !data.sample ? 'Operational data from Supabase.' : 'Sample data.'}</b> {india && data?.source === 'supabase' && !data.sample ? 'Hubs, lanes and orders come from Supabase where present; anything missing falls back to sample values.' : 'The networks (hubs, lanes, volumes, costs) and order profiles are invented for this demo.'} Saved scenarios are illustrative; "Live now" uses real current weather{india ? ' and live traffic comes from TomTom when available' : ''}. All outcomes are model estimates, not actual delayed-order counts. The model is rule-based, not machine learning.
      {india && <div className="note" style={{ marginTop: 6 }}>Data: {dataSource.source}{dataSource.at ? ` (${tm(dataSource.at)})` : ''}{data?.source === 'sample' && data?.reason ? ` — ${data.reason}` : ''} · Traffic: {traffic?.live ? `${traffic.source}, ${tm(traffic.at)}` : traffic?.reason || 'loading...'} · Weather: {sid === 'live' ? (live?.fetchedAt ? `Open-Meteo, ${tm(live.fetchedAt)}` : 'loading...') : 'saved scenario'}</div>}
    </section>
    <section className="card steps"><h2>Plan through a disruption</h2><ol>
      <li><b>Detect.</b> Pick a region and scenario (or "Live now"){india ? ', and an origin and destination. The map shows lanes, closures, live traffic and the weather on your route.' : '. The map shows lane load under weather.'}</li>
      <li><b>Quantify.</b> See the {word} without capacity{india ? ', those pushed past their promise by road delay,' : ''} and the lanes and hubs behind it.</li>
      <li><b>Optimise.</b> Compare diversion, temporary capacity, SLA prioritisation and promise changes, alone or combined. "Recommend a plan" runs all 16 combinations.</li>
      <li><b>Recommend.</b> The best feasible plan with its cost, delivery outcome, capacity impact and alternatives.</li>
      <li><b>Explain and approve.</b> Ask the copilot, check the sources, and record the manager's approval.</li></ol></section>

    <div className="grid">
      <section className="card"><h2>1. Detect — {Rg.name}: lane load{india ? ', closures and route' : ' under weather'}</h2>
        <svg viewBox={Rg.vb} role="img" aria-label="Map of hubs and lanes colored by utilization">
          {an.lanes.map(l => {
            const g = geom(l.key), u = l.v / Math.max(1, l.eff), sw = l.c / 1400 + 1;
            const style = { stroke: l.roadClosed ? 'var(--bad)' : col(u), fill: 'none' }, dash = l.roadClosed ? '6 6' : undefined;
            const title = <title>{`${N[l.a]} to ${N[l.b]}: ${l.roadClosed ? 'ROAD CLOSED (simulated). ' : ''}${f(l.v)} ${word} vs ${f(l.eff)} capacity${india ? `, ${Math.round(l.travelMin)} min (${l.traffic.source})` : ''}`}</title>;
            return g ? <polyline key={l.key} points={g.map(p => p.join(',')).join(' ')} strokeLinecap="round" strokeLinejoin="round" strokeWidth={sw} strokeDasharray={dash} style={style}>{title}</polyline>
              : <line key={l.key} x1={P[l.a][0]} y1={P[l.a][1]} x2={P[l.b][0]} y2={P[l.b][1]} strokeLinecap="round" strokeWidth={sw} strokeDasharray={dash} style={style}>{title}</line>;
          })}
          {route.best?.legs.map(({ lane: l }) => { const g = geom(l.key) || [P[l.a], P[l.b]], ratio = l.travelMin / Math.max(1, l.freeMin); return <polyline key={'r' + l.key} points={g.map(p => p.join(',')).join(' ')} fill="none" strokeWidth={l.c / 1400 + 6} strokeOpacity=".35" strokeLinecap="round" style={{ stroke: ratio > 1.3 ? 'var(--bad)' : ratio > 1.1 ? 'var(--warn)' : 'var(--ink)' }}><title>{`Your route: ${N[l.a]}–${N[l.b]}, ${Math.round(l.travelMin)} min, delay ${Math.round(l.delayMin)} min`}</title></polyline>; })}
          {divPaths.map((p, i) => <polyline key={'d' + i} points={[p.from, ...p.via, p.to].map(h => P[h].join(',')).join(' ')} fill="none" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" style={{ stroke: 'var(--ink)' }}><title>{`Diversion: ${f(p.units)} ${word} ${N[p.from]}→${N[p.to]} via ${p.via.map(x => N[x]).join(', ')}`}</title></polyline>)}
          {Object.entries(P).map(([id, [x, y]]) => { const c = an.ctx.cuts[id], hs = an.hubs.find(h => h.id === id); return <g key={id}><circle cx={x} cy={y} r={hs && hs.over > 0 ? 12 : 9} strokeWidth="3" style={{ fill: hs && hs.over > 0 ? 'var(--bad)' : 'var(--panel)', stroke: c > .5 ? 'var(--bad)' : c > .15 ? 'var(--warn)' : 'var(--ok)' }}><title>{`${N[id]}${hs ? `: sorting ${f(hs.load)} of ${f(hs.eff)} capacity` : ''}`}</title></circle><text className="lbl" x={x + 14} y={y + 4} style={Rg.vb === "0 0 900 600" || india ? { fontSize: 14 } : undefined}>{N[id]}</text></g>; })}
        </svg>
        <div className="legend">Teal: under 85% of remaining capacity. Amber: 85-100%. Red: over capacity. Line width: original capacity. Hub ring: weather cut.{india ? ' Filled red hub: sort centre over capacity. Red dashed lane: road closed (simulated). Shaded band: your route (darker amber/red = more traffic delay). Dotted: diversions in your plan.' : ''}{india && traffic?.live ? ' Lanes follow real road geometry from TomTom.' : ''}</div>
        {india && <>
          <h2 style={{ marginTop: 12 }}>Route: origin and destination</h2>
          <div className="row">
            <label className="note">From <select value={from} onChange={e => setFrom(e.target.value)}>{Object.keys(P).map(i => <option key={i} value={i}>{N[i]}</option>)}</select></label>
            <label className="note">To <select value={to} onChange={e => setTo(e.target.value)}>{Object.keys(P).map(i => <option key={i} value={i}>{N[i]}</option>)}</select></label>
            <button className="chip" onClick={() => { const a = from; setFrom(to); setTo(a); }}>Swap</button>
          </div>
          {route.best ? <div className="verdict" style={{ borderLeft: `5px solid ${risks.some(r => r.level === 'bad') ? 'var(--bad)' : risks.length ? 'var(--warn)' : 'var(--ok)'}` }}>
            <b>{route.best.hubs.map(h => N[h]).join(' → ')}</b>
            <div className="note" style={{ color: 'var(--ink)' }}>{(route.best.minutes / 60).toFixed(1)} h for {f(route.best.km)} km ({(route.best.freeMinutes / 60).toFixed(1)} h without traffic). {route.directClosed ? `The direct ${N[route.directClosed.a]}–${N[route.directClosed.b]} lane is closed, so the route goes around it. ` : ''}{route.alt ? `Alternative: ${route.alt.hubs.map(h => N[h]).join(' → ')} (${(route.alt.minutes / 60).toFixed(1)} h).` : ''}</div>
            {risks.length ? <ul className="why" style={{ marginTop: 6 }}>{risks.map((r, i) => <li key={i} style={{ color: r.level === 'bad' ? 'var(--bad)' : 'var(--ink)' }}>{r.text}</li>)}</ul> : <div className="note">No weather, traffic or capacity risk on this route right now.</div>}
          </div> : <p className="verdict">No open route between {N[from]} and {N[to]}.</p>}
          {route.best && <table><thead><tr><th>Leg</th><th>Travel</th><th>Delay</th><th>Capacity used</th><th>Source</th></tr></thead><tbody>{route.best.legs.map(({ from: a, to: b, lane: l }) => <tr key={l.key}><td>{N[a]} → {N[b]}</td><td>{Math.round(l.travelMin)} min</td><td>{Math.round(l.delayMin)} min</td><td style={{ color: col(l.v / Math.max(1, l.eff)) }}>{Math.round(l.v / Math.max(1, l.eff) * 100)}%</td><td>{l.traffic.live ? `TomTom ${tm(l.traffic.at)}` : 'Estimate'}</td></tr>)}</tbody></table>}
          {od?.live && od.routes?.length > 0 && <p className="note" style={{ marginTop: 6 }}><b>Direct road options (TomTom, {tm(od.at)}):</b> {od.routes.map((r, i) => `${i ? 'alt ' + i : 'fastest'} ${Math.round(r.km)} km, ${(r.travelMin / 60).toFixed(1)} h (+${Math.round(r.delayMin)} min traffic)${r.events.length ? ', ' + r.events.map(e => `${e.count} ${e.type.toLowerCase().replace(/_/g, ' ')}`).join(', ') : ''}`).join(' · ')}. Live road events are shown for context and are separate from the simulated lane closures.</p>}
          <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
            <button className="chip" onClick={() => loadTraffic(true)} disabled={traffic?.loading}>{traffic?.loading ? 'Refreshing traffic...' : 'Refresh live traffic'}</button>
            <label className="note"><input type="checkbox" checked={useTraffic} onChange={e => setUseTraffic(e.target.checked)} disabled={!traffic?.live} /> Apply live traffic to the analysis</label>
          </div>
          <p className="note">{traffic?.live ? `Live traffic for ${Object.keys(traffic.lanes).length} lanes from TomTom (${tm(traffic.at)}${traffic.cached ? ', cached up to 10 min' : ''}). Road delay changes ETAs and detour costs; it does not change sort or line-haul capacity.` : (traffic?.reason || 'Loading traffic...')}</p>
        </>}
      </section>

      <section className="card"><h2>{india ? 'Region & scenario' : '1. Country, US region & weather'}</h2>
        <label className="note">Region: <select value={rg} onChange={e => pick(e.target.value)} style={{ font: 'inherit', marginLeft: 4, marginBottom: 8 }}><option value="in">North India</option><option value="us">United States</option><option value="de">Germany</option></select></label>
        {rg === 'us' && <label className="note" style={{ display: 'block', marginBottom: 8 }}>US region: <select value={usRegion} onChange={e => pickUSRegion(e.target.value)} style={{ font: 'inherit', marginLeft: 4, marginBottom: 4 }}>{Object.entries(US_REGION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><span style={{ display: 'block', fontSize: 12, marginTop: 2 }}>Regional views filter hubs and lanes; boundary hubs may appear in more than one view.</span></label>}
        <p className="note" style={hint}>{Rg.hint}</p>
        <div className="row">{[...Object.entries(Rg.SC).map(([id, s]) => [id, s.name]), ['live', 'Live now']].map(([id, n]) => <button key={id} className="chip" aria-pressed={sid === id} onClick={() => setSid(id)}>{n}</button>)}</div>
        {sid === 'live' ? <><LiveBox live={live} Rg={Rg} us={rg === 'us'} region={usRegion} gap={an.gap} word={word} />{live && !live.error && <button className="chip" onClick={() => { setLiveD(d => ({ ...d, [liveKey]: null })); setTimeout(loadLive, 0); }}>Refresh live weather</button>}</> : <p className="note">{scenario?.note}</p>}
        <label className="note">{sid === 'live' ? 'Live weather intensity: actual readings (not adjustable)' : `Saved-scenario intensity: ${k}%`}<input type="range" min="0" max="100" value={k} disabled={sid === 'live'} onChange={e => setK(+e.target.value)} style={{ width: '100%', opacity: sid === 'live' ? .55 : 1 }} /></label>
        {india && <div className="row" style={{ marginTop: 6 }}>
          <label className="note" style={{ flex: 1, minWidth: 150 }}>Hours left in today's dispatch window: {settings.windowH} h<input type="range" min="4" max="24" value={settings.windowH} onChange={e => setSettings(s => ({ ...s, windowH: +e.target.value }))} style={{ width: '100%' }} /></label>
          <label className="note" style={{ flex: 1, minWidth: 150 }}>Extra hours a detour may add: {settings.slackH} h<input type="range" min="1" max="12" value={settings.slackH} onChange={e => setSettings(s => ({ ...s, slackH: +e.target.value }))} style={{ width: '100%' }} /></label>
        </div>}

        <h2 style={{ marginTop: 8 }}>2. Quantify</h2>
        <div className="stats" aria-live="polite" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>{[['Over capacity / day', f(an.gap)], ...(india ? [['Past promise from road delay', f(an.etaRisk)]] : []), ['Delivered on time', f(plan.onTime)], ['Given a new date', f(plan.prm)], ['Still late', f(plan.late)], ['Plan cost / day', money(plan.cost.total)]].map(([a, b]) => <div key={a}><small>{a}</small><span className="big">{b}</span></div>)}</div>
        <div className="bar" aria-hidden="true">{[[plan.div, 'var(--ok)'], [plan.temp + plan.shift, 'var(--mute)'], [plan.prm, 'var(--warn)'], [plan.late, 'var(--bad)']].map(([v, c], i) => <i key={i} style={{ width: v / t * 100 + '%', background: c }} />)}</div>
        <p className="note">{word[0].toUpperCase() + word.slice(1)} are counted per lane{india ? ' and per hub' : ''}, so one that crosses two damaged lanes is counted twice. Treat totals as an upper bound.{india ? ' All figures are estimates.' : ''}</p>
        <p className="verdict" aria-live="polite">{!atRisk ? 'No overflow with these conditions. Try another scenario or raise intensity.' : nsel ? `With your plan: ${f(plan.late)} ${word} still late${plan.lateCrit >= .5 ? ` (${f(plan.lateCrit)} SLA-critical)` : ''}, ${f(plan.prm)} given a new date, cost ${money(plan.cost.total)} per day.` : `Doing nothing: ${f(atRisk)} ${word} per day miss their promise. Pick a response below.`}</p>
        {calm && <div className="verdict" style={{ borderLeft: '5px solid var(--warn)' }}><b>Early warning: nothing to fix right now</b>
          <div className="note" style={{ color: 'var(--ink)' }}>{anyCut ? (worse ? `Weather is cutting capacity, but today's volume still fits. Overflow would start if conditions got about ${Math.round((worse - 1) * 100)}% worse.` : 'Weather is cutting capacity, but volume still fits even if conditions got much worse.') : 'Weather is not reducing capacity anywhere, so there is nothing for the planner to do.'}</div>
          <div className="note">Closest to capacity: {tight.map(l => `${N[l.a]} to ${N[l.b]} (${Math.round(l.v / Math.max(1, l.eff) * 100)}% used, room for ${f(l.spare)} more)`).join('; ')}.</div>
          {st && stAn.atRisk > 0 && <div className="note" style={{ color: 'var(--ink)' }}>If conditions got about {Math.round((sx - 1) * 100)}% worse: about {f(stAn.gap)} {word}/day over capacity. Suggested response: {selText(st.sel).toLowerCase()}, costing about {money(st.cost.total)} per day.</div>}
          <div className="note" style={{ marginTop: 6 }}>To see the responses in action, try a saved scenario:</div>
          <div className="row" style={{ marginTop: 4 }}>{Object.entries(Rg.SC).filter(([id]) => id !== 'calm').map(([id, sc]) => <button key={id} className="chip" onClick={() => setSid(id)}>{sc.name}</button>)}</div></div>}

        <h2>3. Optimise — choose your response</h2>
        <button type="button" className="chip" onClick={recommend} style={{ marginBottom: 8, fontWeight: 700 }}>Recommend a plan</button>
        {rec && <p className="verdict">{rec}</p>}
        {OPTS.map(([key, n]) => <button key={key} className="opt" aria-pressed={sel[key]} onClick={() => tog(key)}><b>{n}</b><span>{desc[key]}</span></button>)}
        {sel.div && an.sol.plans.length > 0 && <><h2>Reroutes the solver chose</h2><ul className="why">{an.sol.plans.slice(0, 4).map((p, i) => <li key={i}>{N[p.from]} to {N[p.to]} via {p.via.map(x => N[x]).join(' and ')}: {f(p.units)} {word} at {cur}{p.unit.toFixed(2)} each{india ? `, ${(p.minutes / 60).toFixed(1)} h vs ${(p.directMin / 60).toFixed(1)} h direct` : ''}.</li>)}</ul></>}
        <h2 style={{ marginTop: 12 }}>Why these lanes{india ? ' and hubs' : ''}</h2><ul className="why">{w.length || an.hubs.some(h => h.over > 0) ? <>{w.map(l => <li key={l.key}>{N[l.a]} to {N[l.b]}: {l.roadClosed ? 'road closed (simulated)' : `capacity down ${Math.round((1 - l.eff / l.c) * 100)}% (${f(l.c)} to ${f(l.eff)})`}, volume {f(l.v)}{l.v > l.v0 + .5 ? ` (surge from ${f(l.v0)})` : ''}, short by {f(l.over)}.</li>)}{an.hubs.filter(h => h.over > 0).map(h => <li key={h.id}>{N[h.id]} sort centre: {f(h.load)} to sort vs capacity {f(h.eff)} (normally {f(h.cap)}), short by {f(h.over)}.</li>)}</> : <li>All lanes{india ? ' and hubs' : ''} within capacity.</li>}{an.etaRisk > 0 && <li>Road delay: about {f(an.etaRisk)} {word} on {an.items.filter(i => i.kind === 'eta').map(i => i.key.split('-').map(x => N[x]).join('–')).join(', ')} would arrive after their promise (estimate from order slack).</li>}</ul>
      </section>
    </div>

    <section className="card" style={{ borderLeft: '5px solid var(--ok)' }}><h2>4. Recommended plan</h2>
      {!atRisk ? <p className="verdict">Nothing to fix: every lane and hub is within capacity. Do nothing.</p> : <>
        <p className="verdict" style={{ fontSize: 17 }}>{selText(best.sel)}</p>
        <table><tbody>
          <tr><th>Route changes</th><td>{[...an.lanes.filter(l => l.roadClosed).map(l => `${N[l.a]}–${N[l.b]} closed`), ...an.lanes.filter(l => !l.roadClosed && l.over > 0).slice(0, 4).map(l => `${N[l.a]}–${N[l.b]} reduced to ${f(l.eff)}/day`)].join('; ') || 'No lane closed or reduced'}.{best.sel.div && best.div > .5 ? ` Divert ${f(best.div)}: ${an.sol.plans.slice(0, 3).map(p => `${N[p.from]}→${N[p.to]} via ${p.via.map(x => N[x]).join(', ')}`).join('; ')}.` : ' No diversion.'}</td></tr>
          <tr><th>Incremental cost</th><td><b>{money(best.cost.total)} / day</b>: transport {money(best.cost.transport)}, temporary capacity {money(best.cost.temporary)}, promise credits {money(best.cost.credits)}. Assumed customer-trust and late costs: {money(best.shadow.trust + best.shadow.late)}.</td></tr>
          <tr><th>Delivery impact</th><td>{f(best.onTime)} on time, {f(best.prm)} rescheduled, {f(best.late)} still late{best.lateCrit >= .5 ? ` (${f(best.lateCrit)} SLA-critical)` : ''}. Doing nothing: {f(cmp.doNothing.late)} late ({f(cmp.doNothing.lateCrit)} SLA-critical).</td></tr>
          <tr><th>Capacity impact</th><td>Restored {f(best.temp + best.shift)} {word}/day with temporary capacity{best.temp > .5 && india ? ` (market trucks ready in ${C.laneTemp.activationH} h)` : ''}{best.shift > .5 ? ` (sort shift ready in ${C.shift.activationH} h)` : ''}; diverted {f(best.div)}. Remaining bottlenecks: {[...an.lanes.filter(l => l.over > 0).slice(0, 3).map(l => `${N[l.a]}–${N[l.b]}`), ...an.hubs.filter(h => h.over > 0).map(h => N[h.id] + ' hub')].join(', ') || 'none'}; {f(Math.max(0, an.gap - best.onTime))} {word} still need a new date or will be late.</td></tr>
          <tr><th>Why this plan</th><td>Lowest total modelled cost of the 16 combinations{nextAlt ? `: ${money(nextAlt.objective - best.objective)} per day better than the next option (${selText(nextAlt.sel)}), once the assumed trust cost of revised promises and the cost of late ${word} are counted` : ''}. {best.sel.pri ? 'SLA-critical parcels get capacity first. ' : ''}{best.sel.prm && best.prm > .5 ? `Promise changes are used only for the ${f(best.prm)} that no physical fix can carry in time.` : ''}</td></tr>
        </tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="chip" onClick={() => setSel(best.sel)}>Apply to my selection</button>
          <button className="chip" style={{ fontWeight: 700 }} onClick={() => proposeCurrent(best.sel, 'Lowest total modelled cost')}>Send for approval</button>
          {nsel > 0 && JSON.stringify(sel) !== JSON.stringify(best.sel) && <button className="chip" onClick={() => proposeCurrent(sel, 'Manager-selected plan')}>Send my selection for approval</button>}
        </div>
        <h2 style={{ marginTop: 12 }}>Alternatives</h2>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Plan</th><th>On time</th><th>New date</th><th>Late (SLA-critical)</th><th>Cost / day</th><th>Total modelled</th><th></th></tr></thead>
          <tbody>{[...cmp.ranked.slice(0, 6), ...(cmp.ranked.slice(0, 6).includes(cmp.doNothing) ? [] : [cmp.doNothing])].map((p, i) => <tr key={i} style={p === best ? { fontWeight: 700 } : undefined}><td>{p === best ? '★ ' : ''}{selText(p.sel)}</td><td>{f(p.onTime)}</td><td>{f(p.prm)}</td><td>{f(p.late)} ({f(p.lateCrit)})</td><td>{money(p.cost.total)}</td><td>{money(p.objective)}</td><td><button className="chip" style={{ padding: '2px 8px' }} onClick={() => setSel(p.sel)}>Use</button></td></tr>)}</tbody></table></div>
        <p className="note">Total modelled = cost per day + assumed trust cost of revised promises ({cur}{C.trust} each, double for SLA-critical) + assumed cost of a late {word.slice(0, -1)} ({cur}{C.lateStd}; {cur}{C.lateCrit} SLA-critical). The allocation is a min-cost flow over all at-risk {word}; diversion paths come from a greedy min-cost reroute. All costs are assumptions.</p>
      </>}
    </section>

    <section className="card"><h2>5. Explain and approve</h2>
      <button className="go" type="button" onClick={explain} disabled={ex?.loading} style={{ font: 'inherit', fontWeight: 700, background: 'var(--sel)', color: 'var(--selt)', border: 0, borderRadius: 6, padding: '10px 16px', cursor: 'pointer', width: '100%' }}>{ex?.loading ? 'Writing...' : 'Explain my current plan'}</button>
      {ex?.text && <div className="verdict"><div>{ex.text}</div><div className="note">Source: {ex.source}. Written only from the numbers above.</div></div>}

      <h2 style={{ marginTop: 14 }}>Operations copilot</h2>
      <p className="note" style={hint}>Ask in English or Hinglish. Answers come from the same data and optimiser as this page, with sources. The copilot can propose a plan; only you can approve it.</p>
      <div className="row">{['Why is Lucknow backing up tonight?', 'Which lanes between Jaipur and Delhi are at risk?', 'What is the lowest-cost feasible recovery plan?', 'How much extra will rerouting cost?', 'How many parcels will miss their delivery promise if we do nothing?', 'What if we add an extra shift instead of diverting all the parcels?'].map(s => <button key={s} className="chip" style={{ fontSize: 13 }} onClick={() => ask(s)} disabled={asking}>{s}</button>)}</div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>{chat.map((m, i) => <div key={i} className="verdict" style={{ fontWeight: m.role === 'user' ? 700 : 400, borderLeft: m.role === 'user' ? '5px solid var(--line)' : '5px solid var(--ok)', whiteSpace: 'pre-wrap' }}>
        {m.text}{m.role === 'assistant' && m.mode && <div className="note" style={{ marginTop: 4 }}>{m.mode === 'gemini' ? 'Gemini, grounded in tool results' : m.mode === 'rules' ? (m.note || 'Rule-based answer') : ''}</div>}<Evidence items={m.evidence} /></div>)}<div ref={chatEnd} /></div>
      <form className="row" onSubmit={e => { e.preventDefault(); ask(); }}><input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Agra corridor mein kitne parcels late honge?" aria-label="Ask the copilot" style={{ flex: 1, minWidth: 200, font: 'inherit', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg)', color: 'var(--ink)' }} /><button className="chip" type="submit" disabled={asking || !q.trim()} style={{ fontWeight: 700 }}>{asking ? 'Thinking...' : 'Ask'}</button></form>

      {proposal && <div className="verdict" style={{ borderLeft: '5px solid var(--warn)' }}>
        <b>Waiting for approval: {selText(proposal.sel)}</b>
        <div className="note" style={{ color: 'var(--ink)' }}>{(() => { const p = allocate(Rg, an, proposal.sel); return `${f(p.onTime)} on time, ${f(p.prm)} rescheduled, ${f(p.late)} late, ${money(p.cost.total)} per day under current conditions.`; })()} Proposed by the {proposal.from}{proposal.reason ? `: ${proposal.reason}` : ''}.</div>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="Your name" aria-label="Approver name" style={{ font: 'inherit', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)', color: 'var(--ink)' }} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note" style={{ flex: 1, minWidth: 160, font: 'inherit', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)', color: 'var(--ink)' }} />
          <button className="chip" style={{ fontWeight: 700 }} disabled={saving} onClick={() => decide('approved')}>Approve</button>
          <button className="chip" disabled={saving} onClick={() => decide('rejected')}>Reject</button>
        </div>
        <div className="note">Approval records the decision only. It does not change any real route, staffing or delivery promise.</div>
      </div>}
      {saveMsg && <p className="note" style={{ color: 'var(--ink)' }}>{saveMsg}</p>}
      <h2 style={{ marginTop: 12 }}>Decision history</h2>
      {(() => { const items = [...(decisions.items || []).map(d => ({ ...d, stored: true })), ...(decisions.local || [])].sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at)).slice(0, 10); return items.length ? <ul className="why">{items.map((d, i) => <li key={i}><b>{d.decision}</b> by {d.approver} on {tm(d.decided_at)}: {(d.plan?.actions || []).join(' + ') || 'Do nothing'}{d.plan?.scenario ? ` (${d.plan.scenario})` : ''}{d.plan?.incremental_cost != null ? `, ${d.plan.currency || ''}${Number(d.plan.incremental_cost).toLocaleString('en-IN')}/day` : ''}{d.note ? ` — "${d.note}"` : ''} <i>{d.stored ? 'Supabase' : 'this browser only'}</i></li>)}</ul> : <p className="note">No decisions yet.{decisions.reason ? ` ${decisions.reason}` : ''}</p>; })()}
    </section>

    <Forecast Rg={Rg} lanes={an.lanes} />
    <section className="card"><details open={!india}><summary><h2 style={{ display: 'inline' }}>{india && route.best ? `Weather on your route (${route.best.hubs.map(h => N[h]).join(' → ')})` : 'Weather at each hub'}</h2></summary>
      {wx ? <table style={{ marginTop: 8 }}><thead><tr><th>Hub</th><th>Gust ({metric ? 'km/h' : 'mph'})</th><th>Rain (mm/h)</th>{metric ? <th>Visibility (m)</th> : <th>Snow (cm/h)</th>}<th>Capacity cut</th></tr></thead><tbody>{wxRows.map(id => <tr key={id}><td>{N[id]}</td><td>{wx[id] ? Math.round(wx[id].gust * (metric ? 1.609 : 1)) : (sid === 'live' ? 'no data' : 'calm')}</td><td>{wx[id] ? (+(wx[id].rain || 0)).toFixed(1) : '—'}</td>{metric ? <td>{wx[id]?.vis != null ? Math.round(wx[id].vis) : '—'}</td> : <td>{wx[id] ? (+(wx[id].snow || 0)).toFixed(1) : '—'}</td>}<td>{Math.round(an.ctx.cuts[id] * 100)}%</td></tr>)}</tbody></table> : <p className="note">No weather data loaded.</p>}
      {india && route.best && wx && <details style={{ marginTop: 8 }}><summary className="note">All North India hubs</summary><table><tbody>{Object.keys(P).filter(id => !wxRows.includes(id)).map(id => <tr key={id}><td>{N[id]}</td><td>{wx[id] ? `${Math.round(wx[id].gust * 1.609)} km/h` : '—'}</td><td>{wx[id] ? `${(+(wx[id].rain || 0)).toFixed(1)} mm/h` : '—'}</td><td>{wx[id]?.vis != null ? `${Math.round(wx[id].vis)} m` : '—'}</td><td>{Math.round(an.ctx.cuts[id] * 100)}%</td></tr>)}</tbody></table></details>}
      <p className="note">Rule: gusts above {metric ? '56 km/h (35 mph)' : '35 mph'} start cutting a hub's capacity (full cut at {metric ? '145 km/h' : '90 mph'}). Heavy rain cuts up to 50%{metric ? ', fog or dust below 1,000 m visibility up to 50%' : ' and heavy snow up to 60%'}. A lane loses capacity based on its worse end{india ? '; a sort centre loses half of its own weather cut' : ''}. {sid === 'live' && live?.fetchedAt ? `Readings: Open-Meteo, ${tm(live.fetchedAt)}.` : 'Readings: saved scenario (illustrative).'}</p>
    </details></section>
  </main>);
}
