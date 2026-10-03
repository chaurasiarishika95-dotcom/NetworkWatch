'use client';
import {useState,useEffect,useMemo} from 'react';

// ALL NETWORK DATA IS SYNTHETIC (invented for this demo, not Amazon data).
const P={CLT:[500,90],BNA:[200,70],BHM:[150,200],ATL:[320,200],SAV:[510,235],JAX:[520,330],MCO:[480,420],TPA:[360,440],RSW:[400,510],MIA:[590,500]};
const NM={CLT:'Charlotte',BNA:'Nashville',BHM:'Birmingham',ATL:'Atlanta',SAV:'Savannah',JAX:'Jacksonville',MCO:'Orlando',TPA:'Tampa',RSW:'Fort Myers',MIA:'Miami'};
const L=[['BNA','ATL',6000,4300],['BNA','BHM',3000,1900],['BHM','ATL',5000,3600],['CLT','ATL',7000,5200],['CLT','SAV',3500,2300],['ATL','SAV',5500,3900],['ATL','JAX',9000,6400],['SAV','JAX',5000,3300],['JAX','MCO',8000,5900],['JAX','TPA',6000,4100],['ATL','TPA',5000,3200],['ATL','MCO',6500,4200],['MCO','TPA',4500,3000],['MCO','RSW',4000,2800],['TPA','RSW',4000,2900],['MCO','MIA',6000,4300],['RSW','MIA',3500,2100]];
const ALT=['ATL-JAX','SAV-JAX','ATL-MCO','JAX-MCO'];

// gust = mph, rain = mm/hour.
// Saved scenarios are illustrative approximations, not official records.
const SCENARIOS={
 ian:{
  name:'Hurricane Ian replay',
  note:'Approximate, illustrative conditions modeled on the 2022 Florida landfall. Not an official record.',
  wx:{RSW:{gust:150,rain:25},TPA:{gust:90,rain:15},MCO:{gust:80,rain:12},MIA:{gust:35,rain:6},JAX:{gust:45,rain:5},SAV:{gust:25,rain:1},ATL:{gust:15,rain:0},CLT:{gust:10,rain:0},BNA:{gust:10,rain:0},BHM:{gust:10,rain:0}}
 },
 rain:{
  name:'Heavy rain day',
  note:'Illustrative: steady heavy rain across central and south Florida, little wind.',
  wx:{MCO:{gust:25,rain:14},TPA:{gust:20,rain:12},MIA:{gust:22,rain:16},RSW:{gust:20,rain:10},JAX:{gust:15,rain:8},ATL:{gust:10,rain:6},SAV:{gust:12,rain:6},CLT:{gust:8,rain:2},BNA:{gust:8,rain:1},BHM:{gust:8,rain:2}}
 },
 wind:{
  name:'Heavy wind front',
  note:'Illustrative: strong gusts from a cold front across Georgia, the Carolinas and Alabama.',
  wx:{ATL:{gust:65,rain:1},CLT:{gust:70,rain:1},BHM:{gust:60,rain:0},BNA:{gust:55,rain:0},SAV:{gust:62,rain:0},JAX:{gust:58,rain:0},MCO:{gust:45,rain:0},TPA:{gust:40,rain:0},RSW:{gust:30,rain:0},MIA:{gust:25,rain:0}}
 }
};

const cl=x=>Math.max(0,Math.min(1,x));

// Rule: wind above 35 mph starts cutting capacity.
const cutOf=w=>Math.max(
 cl((w.gust-35)/55),
 .5*cl((w.rain-2)/18)
);

function calc(cuts,sel){
 const lanes=L.map(([a,b,c,v])=>{
  const cut=Math.max(cuts[a]||0,cuts[b]||0);
  const eff=c*(1-Math.min(.95,cut*.95));
  return {
   a,b,c,v,eff,
   over:Math.max(0,v-eff),
   spare:Math.max(0,eff-v),
   key:a+'-'+b
  };
 });

 const gap=lanes.reduce((s,l)=>s+l.over,0);
 const lost=lanes
  .filter(l=>l.over>0)
  .reduce((s,l)=>s+(l.c-l.eff),0);

 const spare=lanes
  .filter(l=>ALT.includes(l.key))
  .reduce((s,l)=>s+l.spare,0);

 let rem=gap;

 const div=sel.div?Math.min(rem,spare):0;
 rem-=div;

 const cap=sel.cap?Math.min(rem,.35*lost):0;
 rem-=cap;

 const prm=sel.prm?rem:0;
 const late=sel.prm?0:rem;

 return {
  lanes,
  gap,
  lost,
  spare,
  div,
  cap,
  rem,
  prm,
  late,
  cost:div*.95+cap*1.6+prm*.3
 };
}

const MEANING={
 'Rip Current Statement':'Dangerous currents for swimmers at beaches. Does not affect trucks or lanes.',
 'Flood Watch':'Flooding is possible but has not started. Some roads could be affected later.',
 'Flood Warning':'Flooding is happening, usually along rivers. A few local roads may close.',
 'Coastal Flood Advisory':'Minor flooding near the coast at high tide. Low impact on trucking.',
 'Coastal Flood Statement':'Update on minor coastal flooding. Low impact on trucking.'
};

const SEVERE=/hurricane|tropical|tornado|storm surge|high wind|extreme wind|blizzard|ice storm|winter storm/i;

function LiveBox({live}){
 if(!live)return <p className="note">Loading current conditions...</p>;

 if(live.error)
  return <p className="note">{live.error} Pick a saved scenario instead.</p>;

 const ids=Object.keys(live.nodes);

 const gid=ids.reduce((a,b)=>
  live.nodes[b].gust>live.nodes[a].gust?b:a
 );

 const rid=ids.reduce((a,b)=>
  live.nodes[b].rain>live.nodes[a].rain?b:a
 );

 const g=live.nodes[gid].gust;
 const rn=live.nodes[rid].rain;
 const hit=ids.filter(i=>cutOf(live.nodes[i])>0);

 const lvl=hit.length?'Disruptive':g>=20?'Breezy':'Calm';
 const color=hit.length?'var(--bad)':g>=20?'var(--warn)':'var(--ok)';
 const sev=live.alerts.filter(a=>SEVERE.test(a.event));

 return(
  <div className="verdict" style={{borderLeft:'5px solid '+color}}>
   <b>Live weather right now: {lvl}</b>

   <div className="note" style={{color:'var(--ink)'}}>
    {hit.length
     ?`Wind or rain is strong enough to cut capacity at: ${hit.map(i=>NM[i]).join(', ')}.`
     :`No hub is hit hard enough to lose capacity. The windiest hub is ${NM[gid]} at ${Math.round(g)} mph gusts (capacity only starts dropping above 35 mph). The wettest is ${NM[rid]} at ${rn.toFixed(1)} mm of rain per hour (heavy rain starts at about 2).`
    }
   </div>

   <div className="note" style={{color:'var(--ink)',marginTop:6}}>
    <b>Network impact:</b>{' '}
    {hit.length||sev.length
     ?'Possible. Look at the map and the numbers below.'
     :'None. The network runs normally, so overflow is 0.'
    }
   </div>

   <div className="note" style={{marginTop:6}}>
    <b>Official alerts in Florida</b>{' '}
    (National Weather Service, as of {new Date(live.fetchedAt).toLocaleTimeString()}):
   </div>

   {live.alerts.length
    ?<ul className="why">
      {live.alerts.map(a=>
       <li key={a.event}>
        <b>{a.event}{a.count>1?' (x'+a.count+')':''}:</b>{' '}
        {MEANING[a.event]||'See weather.gov for details.'}{' '}
        <i>{SEVERE.test(a.event)?'Could disrupt lanes.':'Not a trucking threat.'}</i>
       </li>
      )}
     </ul>
    :<div className="note">No active alerts.</div>
   }

   <div className="note">
    Alerts are shown for context. The model uses wind and rain only.
   </div>
  </div>
 );
}

const f=n=>Math.round(n).toLocaleString('en-US');

const OPTS=[
 ['div','Divert volume to unaffected lanes'],
 ['cap','Add temporary capacity'],
 ['pri','Prioritize SLA-critical packages'],
 ['prm','Adjust delivery promises (+1 day)']
];

const col=u=>u>1?'var(--bad)':u>.85?'var(--warn)':'var(--ok)';

export default function Home(){

 const [sid,setSid]=useState('ian');
 const [live,setLive]=useState(null);
 const [k,setK]=useState(100);

 const [sel,setSel]=useState({
  div:false,
  cap:false,
  pri:false,
  prm:false
 });

 // Gemini states
 const [explain,setExplain]=useState(null);
 const [explaining,setExplaining]=useState(false);

 useEffect(()=>{
  if(sid!=='live'||live)return;

  fetch('/api/weather')
   .then(r=>r.json())
   .then(setLive)
   .catch(()=>
    setLive({error:'Live weather is unavailable right now.'})
   );
 },[sid,live]);

 const wx=sid==='live'
  ?live?.nodes
  :SCENARIOS[sid].wx;

 const cuts=useMemo(()=>
  Object.fromEntries(
   Object.keys(P).map(id=>[
    id,
    wx&&wx[id]
     ?cutOf(wx[id])*k/100
     :0
   ])
 ),[wx,k]);

 const r=calc(cuts,sel);

 const nsel=Object.values(sel).filter(Boolean).length;
 const t=Math.max(1,r.gap);

 const w=r.lanes
  .filter(l=>l.over>0)
  .sort((a,b)=>b.over-a.over)
  .slice(0,4);

 const tog=key=>
  setSel(s=>({...s,[key]:!s[key]}));

 // Gemini function
 async function askGemini(){

  setExplaining(true);
  setExplain(null);

  try{

   const payload={
    scenario:sid==='live'
     ?'Live weather'
     :SCENARIOS[sid]?.name,

    weather:sid==='live'
     ?live?.nodes
     :wx,

    intensity:k,

    overCapacityPerDay:r.gap,

    stillLatePerDay:r.late,

    planCostPerDay:r.cost,

    selectedResponses:Object.entries(sel)
     .filter(([,v])=>v)
     .map(([key])=>
      OPTS.find(o=>o[0]===key)?.[1]
     )
     .filter(Boolean),

    priorityLanes:w.map(l=>({
     lane:`${NM[l.a]} to ${NM[l.b]}`,
     capacity:l.c,
     effectiveCapacity:Math.round(l.eff),
     volume:l.v,
     shortfall:Math.round(l.over)
    }))
   };

   const res=await fetch('/api/explain',{
    method:'POST',
    headers:{
     'Content-Type':'application/json'
    },
    body:JSON.stringify(payload)
   });

   const data=await res.json();

   if(!res.ok)
    throw new Error(data.error||'Gemini request failed');

   setExplain(data.text);

  }catch(e){

   setExplain(
    'Gemini explanation is unavailable right now. Check that GEMINI_API_KEY is configured in Vercel and redeploy the app.'
   );

  }finally{

   setExplaining(false);

  }
 }

 const desc={
  div:`Up to ${f(r.spare)} packages/day of spare room on Atlanta and Savannah lanes into Florida. $0.95 each.${r.gap>0&&r.spare<r.gap*.25?' Little room here because most lanes into Florida are also damaged.':''}`,

  cap:`Recovers up to ${f(.35*r.lost)} packages/day. $1.60 each. Takes hours to stand up.`,

  pri:'Critical packages (about 35% of overflow) go first. Free, but the rest still arrive late.',

  prm:`Resets dates on ${f(r.rem)} remaining packages before customers are let down. $0.30 each in credits.`
 };

 const hint={
  fontSize:'13px',
  margin:'0 0 8px'
 };

 return(
  <main>

   <h1>Network Watch</h1>

   <p className="sub">
    When bad weather closes lanes, which packages miss their promise,
    and what should the planner do? Simulated Southeast network with
    weather scenarios.
   </p>

   <section className="card warnbox">
    <b>Synthetic data.</b> The network (hubs, lanes, volumes, costs)
    is invented for this demo and is not Amazon data. Weather scenarios
    are illustrative approximations; "Live now" uses real current
    conditions. The model is rule-based, not machine learning.
   </section>

   <section className="card steps">
    <h2>You are a network planner. Weather is hitting the network.</h2>

    <ol>
     <li>
      <b>Pick a scenario</b> and watch lines turn red where lanes
      can no longer carry the volume.
     </li>

     <li>
      <b>Read the damage:</b> "Still late" is how many packages per day
      will miss their promised date.
     </li>

     <li>
      <b>Click responses</b> and watch late fall while cost rises.
      You are trading cost against customer trust.
     </li>
    </ol>
   </section>

   <div className="grid">

    <section className="card">

     <h2>Network: lane load under weather</h2>

     <svg
      viewBox="0 0 700 560"
      role="img"
      aria-label="Map of hubs and lanes colored by utilization"
     >

      {r.lanes.map(l=>{
       const[x1,y1]=P[l.a];
       const[x2,y2]=P[l.b];

       return(
        <line
         key={l.key}
         x1={x1}
         y1={y1}
         x2={x2}
         y2={y2}
         strokeLinecap="round"
         strokeWidth={l.c/1400+1}
         style={{
          stroke:col(l.v/Math.max(1,l.eff))
         }}
        >
         <title>
          {NM[l.a]} to {NM[l.b]}:
          {' '}{f(l.v)} packages vs {f(l.eff)} capacity
         </title>
        </line>
       );
      })}

      {Object.entries(P).map(([id,[x,y]])=>{
       const c=cuts[id];

       return(
        <g key={id}>

         <circle
          cx={x}
          cy={y}
          r="9"
          strokeWidth="3"
          style={{
           fill:'var(--panel)',
           stroke:
            c>.5
             ?'var(--bad)'
             :c>.15
             ?'var(--warn)'
             :'var(--ok)'
          }}
         />

         <text
          className="lbl"
          x={x+14}
          y={y+4}
         >
          {NM[id]}
         </text>

        </g>
       );
      })}

     </svg>

     <div className="legend">
      Teal: under 85% of remaining capacity.
      Amber: 85-100%.
      Red: over capacity.
      Line width: original capacity.
     </div>

    </section>

    <section className="card">

     <h2>1. Weather scenario</h2>

     <p className="note" style={hint}>
      Start with Hurricane Ian to see the full effect.
      "Live now" shows today's real weather, which is often calm.
     </p>

     <div className="row">

      {[
       ...Object.entries(SCENARIOS).map(([id,s])=>[id,s.name]),
       ['live','Live now']
      ].map(([id,n])=>
       <button
        key={id}
        className="chip"
        aria-pressed={sid===id}
        onClick={()=>setSid(id)}
       >
        {n}
       </button>
      )}

     </div>

     {sid==='live'
      ?<LiveBox live={live}/>
      :<p className="note">{SCENARIOS[sid].note}</p>
     }

     <label className="note">
      Weather intensity: {k}%

      <input
       type="range"
       min="0"
       max="100"
       value={k}
       onChange={e=>setK(+e.target.value)}
       style={{width:'100%'}}
      />
     </label>

     <div className="stats" aria-live="polite">

      <div>
       <small>Over capacity / day</small>
       <span className="big">{f(r.gap)}</span>
      </div>

      <div>
       <small>Still late</small>
       <span className="big">{f(r.late)}</span>
      </div>

      <div>
       <small>Plan cost / day</small>
       <span className="big">${f(r.cost)}</span>
      </div>

     </div>

     <div className="bar" aria-hidden="true">
      {[
       [r.div,'var(--ok)'],
       [r.cap,'var(--mute)'],
       [r.prm,'var(--warn)'],
       [r.late,'var(--bad)']
      ].map(([v,c],i)=>
       <i
        key={i}
        style={{
         width:v/t*100+'%',
         background:c
        }}
       />
      )}
     </div>

     <p className="note">
      Packages are counted per lane, so one that crosses two damaged
      lanes is counted twice. Treat totals as an upper bound.
     </p>

     <p className="verdict" aria-live="polite">
      {!r.gap
       ?'No overflow with these conditions. Try another scenario or raise intensity.'
       :nsel
       ?`With your plan: ${f(r.late)} packages still late, ${f(r.prm)} given a new date, cost $${f(r.cost)} per day.`
       :`Doing nothing: ${f(r.gap)} packages per day miss their promise. Pick a response below.`
      }
     </p>

     <h2>2. Choose your response</h2>

     {OPTS.map(([key,n])=>
      <button
       key={key}
       className="opt"
       aria-pressed={sel[key]}
       onClick={()=>tog(key)}
      >
       <b>{n}</b>
       <span>{desc[key]}</span>
      </button>
     )}

     <h2>Why these lanes</h2>

     <ul className="why">
      {w.length
       ?w.map(l=>
        <li key={l.key}>
         {NM[l.a]} to {NM[l.b]}:
         capacity down {Math.round((1-l.eff/l.c)*100)}%
         ({f(l.c)} to {f(l.eff)}),
         volume {f(l.v)},
         short by {f(l.over)}.
        </li>
       )
       :<li>All lanes within capacity.</li>
      }
     </ul>

     {/* GEMINI COPILOT */}

     <div
      className="verdict"
      style={{marginTop:16}}
     >

      <b>✨ Network Watch Copilot</b>

      <p
       className="note"
       style={{color:'var(--ink)'}}
      >
       Ask Gemini to explain the disruption, selected responses,
       cost, and customer trade-off using only the numbers shown above.
      </p>

      <button
       className="chip"
       onClick={askGemini}
       disabled={explaining}
      >
       {explaining
        ?'Explaining...'
        :'✨ Explain with Gemini'
       }
      </button>

      {explain&&
       <p
        className="note"
        style={{
         whiteSpace:'pre-wrap',
         color:'var(--ink)',
         marginTop:12
        }}
       >
        {explain}
       </p>
      }

     </div>

    </section>

   </div>

   <section className="card">

    <h2>Weather at each hub</h2>

    {wx
     ?<table>

       <thead>
        <tr>
         <th>Hub</th>
         <th>Gust (mph)</th>
         <th>Rain (mm/h)</th>
         <th>Capacity cut</th>
        </tr>
       </thead>

       <tbody>

        {Object.keys(P).map(id=>
         <tr key={id}>
          <td>{NM[id]}</td>
          <td>{wx[id]?Math.round(wx[id].gust):'no data'}</td>
          <td>{wx[id]?(+wx[id].rain).toFixed(1):'no data'}</td>
          <td>{Math.round(cuts[id]*100)}%</td>
         </tr>
        )}

       </tbody>

      </table>

     :<p className="note">No weather data loaded.</p>
    }

    <p className="note">
     Rule: gusts above 35 mph start cutting a hub's capacity
     (full cut at 90 mph). Heavy rain cuts up to 50%.
     A lane loses capacity based on its worse end.
    </p>

   </section>

  </main>
 );
}
