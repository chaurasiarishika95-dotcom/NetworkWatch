'use client';
import {useState,useEffect,useMemo} from 'react';
import {P,NM,SCENARIOS,cutOf,calc} from '../lib/network';
const f=n=>Math.round(n).toLocaleString('en-US');
const OPTS=[['div','Divert volume to unaffected lanes'],['cap','Add temporary capacity'],['pri','Prioritize SLA-critical packages'],['prm','Adjust delivery promises (+1 day)']];
const col=u=>u>1?'var(--bad)':u>.85?'var(--warn)':'var(--ok)';
export default function Home(){
 const [sid,setSid]=useState('ian'),[live,setLive]=useState(null),[k,setK]=useState(100);
 const [sel,setSel]=useState({div:false,cap:false,pri:false,prm:false});
 useEffect(()=>{if(sid!=='live'||live)return;fetch('/api/weather').then(r=>r.json()).then(setLive).catch(()=>setLive({error:'Live weather is unavailable right now.'}))},[sid,live]);
 const wx=sid==='live'?live?.nodes:SCENARIOS[sid].wx;
 const cuts=useMemo(()=>Object.fromEntries(Object.keys(P).map(id=>[id,wx&&wx[id]?cutOf(wx[id])*k/100:0])),[wx,k]);
 const r=calc(cuts,sel),nsel=Object.values(sel).filter(Boolean).length,t=Math.max(1,r.gap);
 const w=r.lanes.filter(l=>l.over>0).sort((a,b)=>b.over-a.over).slice(0,4);
 const tog=key=>setSel(s=>({...s,[key]:!s[key]}));
 const desc={div:`Up to ${f(r.spare)} packages/day of spare room on Atlanta and Savannah lanes into Florida. $0.95 each.`,cap:`Recovers up to ${f(.35*r.lost)} packages/day. $1.60 each. Takes hours to stand up.`,pri:'Critical packages (about 35% of overflow) go first. Free, but the rest still arrive late.',prm:`Resets dates on ${f(r.rem)} remaining packages before customers are let down. $0.30 each in credits.`};
 const liveNote=live?.error?live.error+' Pick a saved scenario instead.':!live?'Loading current conditions...':'Real current conditions (Open-Meteo)'+(live.alerts.length?'. Active Florida NWS alerts: '+live.alerts.map(a=>`${a.event} (${a.count})`).join(', '):'. No active Florida NWS alerts.');
 return(<main>
  <h1>Network Watch</h1>
  <p className="sub">When bad weather closes lanes, which packages miss their promise, and what should the planner do? Simulated Southeast network with weather scenarios.</p>
  <section className="card warnbox"><b>Synthetic data.</b> The network (hubs, lanes, volumes, costs) is invented for this demo and is not Amazon data. Weather scenarios are illustrative approximations; "Live now" uses real current conditions. The model is rule-based, not machine learning.</section>
  <section className="card steps"><h2>You are a network planner. Weather is hitting the network.</h2><ol>
   <li><b>Pick a scenario</b> (or Live now) and watch lines turn red where lanes can no longer carry the volume.</li>
   <li><b>Read the damage:</b> "Still late" is how many packages per day will miss their promised date.</li>
   <li><b>Click responses</b> and watch late fall while cost rises. You are trading cost against customer trust.</li></ol></section>
  <div className="grid">
   <section className="card"><h2>Network: lane load under weather</h2>
    <svg viewBox="0 0 700 560" role="img" aria-label="Map of hubs and lanes colored by utilization">
     {r.lanes.map(l=>{const[x1,y1]=P[l.a],[x2,y2]=P[l.b];return <line key={l.key} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" strokeWidth={l.c/1400+1} style={{stroke:col(l.v/Math.max(1,l.eff))}}><title>{NM[l.a]} to {NM[l.b]}: {f(l.v)} packages vs {f(l.eff)} capacity</title></line>})}
     {Object.entries(P).map(([id,[x,y]])=>{const c=cuts[id];return <g key={id}><circle cx={x} cy={y} r="9" strokeWidth="3" style={{fill:'var(--panel)',stroke:c>.5?'var(--bad)':c>.15?'var(--warn)':'var(--ok)'}}/><text className="lbl" x={x+14} y={y+4}>{NM[id]}</text></g>})}
    </svg>
    <div className="legend">Teal: under 85% of remaining capacity. Amber: 85-100%. Red: over capacity. Line width: original capacity.</div></section>
   <section className="card"><h2>1. Weather scenario</h2>
    <div className="row">{[...Object.entries(SCENARIOS).map(([id,s])=>[id,s.name]),['live','Live now']].map(([id,n])=><button key={id} className="chip" aria-pressed={sid===id} onClick={()=>setSid(id)}>{n}</button>)}</div>
    <p className="note">{sid==='live'?liveNote:SCENARIOS[sid].note}</p>
    <label className="note">Weather intensity: {k}%<input type="range" min="0" max="100" value={k} onChange={e=>setK(+e.target.value)} style={{width:'100%'}}/></label>
    <div className="stats" aria-live="polite"><div><small>Over capacity / day</small><span className="big">{f(r.gap)}</span></div><div><small>Still late</small><span className="big">{f(r.late)}</span></div><div><small>Plan cost / day</small><span className="big">${f(r.cost)}</span></div></div>
    <div className="bar" aria-hidden="true">{[[r.div,'var(--ok)'],[r.cap,'var(--mute)'],[r.prm,'var(--warn)'],[r.late,'var(--bad)']].map(([v,c],i)=><i key={i} style={{width:v/t*100+'%',background:c}}/>)}</div>
    <p className="verdict" aria-live="polite">{!r.gap?'No overflow with these conditions. Try another scenario or raise intensity.':nsel?`With your plan: ${f(r.late)} packages still late, ${f(r.prm)} given a new date, cost $${f(r.cost)} per day.`:`Doing nothing: ${f(r.gap)} packages per day miss their promise. Pick a response below.`}</p>
    <h2>2. Choose your response</h2>
    {OPTS.map(([key,n])=><button key={key} className="opt" aria-pressed={sel[key]} onClick={()=>tog(key)}><b>{n}</b><span>{desc[key]}</span></button>)}
    <h2>Why these lanes</h2><ul className="why">{w.length?w.map(l=><li key={l.key}>{NM[l.a]} to {NM[l.b]}: capacity down {Math.round((1-l.eff/l.c)*100)}% ({f(l.c)} to {f(l.eff)}), volume {f(l.v)}, short by {f(l.over)}.</li>):<li>All lanes within capacity.</li>}</ul></section>
  </div>
  <section className="card"><h2>Weather at each hub</h2>
   {wx?<table><thead><tr><th>Hub</th><th>Gust (mph)</th><th>Rain (mm/h)</th><th>Capacity cut</th></tr></thead><tbody>{Object.keys(P).map(id=><tr key={id}><td>{NM[id]}</td><td>{wx[id]?Math.round(wx[id].gust):'-'}</td><td>{wx[id]?(+wx[id].rain).toFixed(1):'-'}</td><td>{Math.round(cuts[id]*100)}%</td></tr>)}</tbody></table>:<p className="note">No weather data loaded.</p>}
   <p className="note">Rule: gusts above 35 mph start cutting a hub's capacity (full cut at 90 mph). Heavy rain cuts up to 50%. A lane loses capacity based on its worse end.</p></section>
 </main>);
}
