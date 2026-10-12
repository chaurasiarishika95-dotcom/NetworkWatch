'use client';
import {useState,useEffect,useMemo} from 'react';

// ALL NETWORK DATA IS SYNTHETIC (invented for this demo, not Amazon data).
// gust = mph, rain = mm/hour, snow = cm/hour. Saved scenarios are illustrative approximations, not official records.
const R={
 us:{name:'United States',vb:'0 0 900 600',hint:'Start with Hurricane Ian to see the full effect. "Live now" shows today\'s real weather at every hub, which is often calm.',
  P:{SEA:[90,70],SFO:[60,250],LAX:[120,390],PHX:[250,440],DEN:[330,260],DAL:[440,440],HOU:[470,520],MSP:[470,110],KC:[480,280],CHI:[600,180],NYC:[780,190],BOS:[830,100],CLT:[760,326],BNA:[574,313],BHM:[543,394],ATL:[648,394],SAV:[766,416],JAX:[772,475],MCO:[748,530],TPA:[673,543],RSW:[698,586],MIA:[816,580]},
  NM:{SEA:'Seattle',SFO:'San Francisco',LAX:'Los Angeles',PHX:'Phoenix',DEN:'Denver',DAL:'Dallas',HOU:'Houston',MSP:'Minneapolis',KC:'Kansas City',CHI:'Chicago',NYC:'New York',BOS:'Boston',CLT:'Charlotte',BNA:'Nashville',BHM:'Birmingham',ATL:'Atlanta',SAV:'Savannah',JAX:'Jacksonville',MCO:'Orlando',TPA:'Tampa',RSW:'Fort Myers',MIA:'Miami'},
  C:{SEA:[47.61,-122.33],SFO:[37.77,-122.42],LAX:[34.05,-118.24],PHX:[33.45,-112.07],DEN:[39.74,-104.99],DAL:[32.78,-96.8],HOU:[29.76,-95.37],MSP:[44.98,-93.27],KC:[39.1,-94.58],CHI:[41.88,-87.63],NYC:[40.71,-74.01],BOS:[42.36,-71.06],CLT:[35.22,-80.84],BNA:[36.16,-86.78],BHM:[33.52,-86.8],ATL:[33.75,-84.39],SAV:[32.08,-81.09],JAX:[30.33,-81.66],MCO:[28.54,-81.38],TPA:[27.95,-82.46],RSW:[26.64,-81.87],MIA:[25.76,-80.19]},
  L:[['BNA','ATL',6000,4300],['BNA','BHM',3000,1900],['BHM','ATL',5000,3600],['CLT','ATL',7000,5200],['CLT','SAV',3500,2300],['ATL','SAV',5500,3900],['ATL','JAX',9000,6400],['SAV','JAX',5000,3300],['JAX','MCO',8000,5900],['JAX','TPA',6000,4100],['ATL','TPA',5000,3200],['ATL','MCO',6500,4200],['MCO','TPA',4500,3000],['MCO','RSW',4000,2800],['TPA','RSW',4000,2900],['MCO','MIA',6000,4300],['RSW','MIA',3500,2100],
   ['SEA','SFO',5000,3500],['SFO','LAX',7000,5000],['LAX','PHX',6000,4200],['SEA','DEN',4500,3100],['SFO','DEN',5000,3500],['PHX','DEN',4500,3000],['PHX','DAL',5500,3900],['DEN','KC',6000,4300],['DEN','MSP',4000,2800],['MSP','KC',4000,2800],['MSP','CHI',6000,4300],['KC','CHI',6500,4600],['KC','DAL',6000,4200],['DAL','HOU',6500,4600],['DAL','ATL',6500,4600],['HOU','BHM',5500,3800],['KC','BNA',5500,3800],['CHI','BNA',6000,4300],['CHI','NYC',7000,5000],['NYC','BOS',6000,4200],['NYC','CLT',6500,4600],['NYC','ATL',5500,3800]],
  SC:{
   ian:{name:'Hurricane Ian replay',note:'Approximate, illustrative conditions modeled on the 2022 Florida landfall. Not an official record.',wx:{RSW:{gust:150,rain:25},TPA:{gust:90,rain:15},MCO:{gust:80,rain:12},MIA:{gust:35,rain:6},JAX:{gust:45,rain:5},SAV:{gust:25,rain:1},ATL:{gust:15,rain:0},CLT:{gust:10,rain:0},BNA:{gust:10,rain:0},BHM:{gust:10,rain:0}}},
   rain:{name:'Heavy rain day',note:'Illustrative: steady heavy rain across central and south Florida, little wind.',wx:{MCO:{gust:25,rain:14},TPA:{gust:20,rain:12},MIA:{gust:22,rain:16},RSW:{gust:20,rain:10},JAX:{gust:15,rain:8},ATL:{gust:10,rain:6},SAV:{gust:12,rain:6},CLT:{gust:8,rain:2},BNA:{gust:8,rain:1},BHM:{gust:8,rain:2}}},
   wind:{name:'Wind front (Southeast)',note:'Illustrative: strong gusts from a cold front across Georgia, the Carolinas and Alabama.',wx:{ATL:{gust:65,rain:1},CLT:{gust:70,rain:1},BHM:{gust:60,rain:0},BNA:{gust:55,rain:0},SAV:{gust:62,rain:0},JAX:{gust:58,rain:0},MCO:{gust:45,rain:0},TPA:{gust:40,rain:0},RSW:{gust:30,rain:0},MIA:{gust:25,rain:0}}},
   blizzard:{name:'Midwest blizzard',note:'Illustrative: heavy snow and strong wind across Minnesota, Chicago, Kansas City and the Rockies.',wx:{MSP:{gust:55,rain:1,snow:5},CHI:{gust:50,rain:1,snow:4.5},KC:{gust:45,rain:0,snow:3},DEN:{gust:40,rain:0,snow:2.5},NYC:{gust:30,rain:1,snow:1}}},
   west:{name:'West Coast atmospheric river',note:'Illustrative: heavy rain and wind along the Pacific coast.',wx:{SEA:{gust:45,rain:12},SFO:{gust:50,rain:18},LAX:{gust:30,rain:10},PHX:{gust:15,rain:2}}},
   plains:{name:'Southern Plains wind event',note:'Illustrative: severe wind across Texas, Kansas and Colorado.',wx:{DAL:{gust:65,rain:3},KC:{gust:70,rain:2},DEN:{gust:60,rain:0},MSP:{gust:55,rain:0},HOU:{gust:45,rain:4},CHI:{gust:50,rain:1}}}}},
 de:{name:'Germany',vb:'0 0 700 560',hint:'Start with the snowstorm. "Live now" shows today\'s real weather (Open-Meteo), which is often calm.',
  P:{HAM:[330,60],BER:[570,110],HAN:[330,160],LEJ:[520,240],CGN:[140,260],FRA:[300,340],NUE:[480,410],STR:[300,470],MUC:[470,525]},
  NM:{HAM:'Hamburg',BER:'Berlin',HAN:'Hannover',LEJ:'Leipzig',CGN:'Cologne',FRA:'Frankfurt',NUE:'Nuremberg',STR:'Stuttgart',MUC:'Munich'},
  C:{HAM:[53.55,10.0],BER:[52.52,13.4],HAN:[52.37,9.73],LEJ:[51.34,12.37],CGN:[50.94,6.96],FRA:[50.11,8.68],NUE:[49.45,11.08],STR:[48.78,9.18],MUC:[48.14,11.58]},
  L:[['HAM','BER',5000,3600],['HAM','HAN',6000,4300],['HAN','BER',6000,4200],['HAN','LEJ',5500,3800],['BER','LEJ',5000,3500],['HAN','CGN',5500,3900],['HAN','FRA',7000,5100],['LEJ','FRA',5000,3300],['LEJ','NUE',5000,3400],['CGN','FRA',6000,4400],['FRA','NUE',6500,4600],['FRA','STR',6000,4300],['NUE','MUC',6000,4500],['STR','MUC',6000,4200],['NUE','STR',3500,2200]],
  SC:{snow:{name:'Snowstorm in northern and central Germany',note:'Illustrative: heavy snow and wind closing highways around Hannover, Berlin and Leipzig.',wx:{HAN:{gust:50,rain:2,snow:4},BER:{gust:40,rain:1,snow:3},HAM:{gust:55,rain:2,snow:3},LEJ:{gust:35,rain:1,snow:5},FRA:{gust:30,rain:0,snow:2.5},CGN:{gust:25,rain:0,snow:1},NUE:{gust:35,rain:1,snow:3.5},STR:{gust:20,rain:0,snow:1},MUC:{gust:25,rain:0,snow:2}}}}}
};

// Region views use the existing synthetic US hubs and lanes; this is a planning-demo geography, not a real operating map.
const US_REGION_LABELS={all:'All US',west:'West & Mountain',midwest:'Midwest',northeast:'Northeast & Mid-Atlantic',southeast:'Southeast',plains:'Southern Plains'};
const US_REGION_HUBS={
 all:Object.keys(R.us.P),
 west:['SEA','SFO','LAX','PHX','DEN'],
 midwest:['DEN','MSP','KC','CHI','BNA'],
 northeast:['CHI','NYC','BOS','CLT'],
 southeast:['CLT','BNA','BHM','ATL','SAV','JAX','MCO','TPA','RSW','MIA'],
 plains:['PHX','DEN','DAL','HOU','KC','BNA','BHM','ATL']
};
function scopedUSRegion(base,key){
 if(key==='all')return base;
 const allowed=new Set(US_REGION_HUBS[key]||US_REGION_HUBS.all);
 const ids=Object.keys(base.P).filter(id=>allowed.has(id));
 const raw=ids.map(id=>base.P[id]),xs=raw.map(v=>v[0]),ys=raw.map(v=>v[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min(760/Math.max(1,maxX-minX),455/Math.max(1,maxY-minY));
 const usedW=(maxX-minX)*scale,usedH=(maxY-minY)*scale,startX=(900-usedW)/2,startY=(600-usedH)/2;
 const P=Object.fromEntries(ids.map(id=>[id,[Math.round(startX+(base.P[id][0]-minX)*scale),Math.round(startY+(base.P[id][1]-minY)*scale)]]));
 const keepWx=wx=>Object.fromEntries(Object.entries(wx).filter(([id])=>allowed.has(id)));
 const SC=Object.fromEntries(Object.entries(base.SC).filter(([,sc])=>Object.entries(sc.wx).some(([id,weather])=>allowed.has(id)&&cutOf(weather)>0)).map(([id,sc])=>[id,{...sc,wx:keepWx(sc.wx)}]));
 return {...base,name:`United States — ${US_REGION_LABELS[key]}`,hint:`Viewing ${US_REGION_LABELS[key]} hubs and connecting lanes. “Live now” loads current weather for these hubs; saved scenarios are illustrative stress tests.`,P,NM:Object.fromEntries(ids.map(id=>[id,base.NM[id]])),C:Object.fromEntries(ids.map(id=>[id,base.C[id]])),L:base.L.filter(([a,b])=>allowed.has(a)&&allowed.has(b)),SC};
}
const cl=x=>Math.max(0,Math.min(1,x));
// Rule: gusts above 35 mph start cutting capacity (full at 90); rain cuts up to 50%; snow cuts up to 60%.
const cutOf=w=>Math.max(cl((w.gust-35)/55),.5*cl((w.rain-2)/18),.6*cl(((w.snow||0)-.5)/3.5));

// Min-cost rerouting: for each damaged lane (largest shortfall first), repeatedly find the cheapest path
// (Bellman-Ford) through lanes that still have spare capacity and push as much as the bottleneck allows.
// Lanes are handled one at a time, so this is a greedy approximation of the full multi-flow optimum.
const km=(Rg,a,b)=>{const[la1,lo1]=Rg.C[a],[la2,lo2]=Rg.C[b];return Math.hypot((lo1-lo2)*Math.cos((la1+la2)*Math.PI/360),la1-la2)*111};
function reroute(Rg,lanes){
 const ids=Object.keys(Rg.P),cap={},plans=[];let total=0,cost=0;
 lanes.forEach(l=>cap[l.key]=l.spare);
 const E=lanes.map(l=>({...l,w:km(Rg,l.a,l.b)/400*.5+.2}));
 for(const d of lanes.filter(l=>l.over>0).sort((x,y)=>y.over-x.over)){
  let need=d.over;
  for(let guard=0;need>.5&&guard<20;guard++){
   const dist=Object.fromEntries(ids.map(i=>[i,Infinity])),prev={};dist[d.a]=0;
   for(let i=0;i<ids.length;i++)for(const e of E){if(e.key===d.key||cap[e.key]<1)continue;for(const[u,v]of[[e.a,e.b],[e.b,e.a]])if(dist[u]+e.w<dist[v]){dist[v]=dist[u]+e.w;prev[v]=[u,e]}}
   if(dist[d.b]===Infinity)break;
   const path=[];let n=d.b;while(n!==d.a){const[u,e]=prev[n];path.push({e,n});n=u}
   const push=Math.min(need,...path.map(p=>cap[p.e.key]));
   path.forEach(p=>cap[p.e.key]-=push);need-=push;total+=push;cost+=push*dist[d.b];
   plans.push({from:d.a,to:d.b,via:path.slice(1).map(p=>p.n).reverse(),units:push,unit:dist[d.b]});
  }
 }
 return{total,cost,plans};
}
function calc(Rg,cuts,sel){
 const lanes=Rg.L.map(([a,b,c,v])=>{const cut=Math.max(cuts[a]||0,cuts[b]||0);const eff=c*(1-Math.min(.95,cut*.95));return{a,b,c,v,eff,over:Math.max(0,v-eff),spare:Math.max(0,eff-v),key:a+'-'+b}});
 const gap=lanes.reduce((s,l)=>s+l.over,0),lost=lanes.filter(l=>l.over>0).reduce((s,l)=>s+(l.c-l.eff),0);
 const sol=reroute(Rg,lanes);let rem=gap;
 const div=sel.div?Math.min(rem,sol.total):0;rem-=div;
 const cap=sel.cap?Math.min(rem,.35*lost):0;rem-=cap;
 const prm=sel.prm?rem:0,late=sel.prm?0:rem;
 return{lanes,gap,lost,sol,div,cap,rem,prm,late,cost:(sel.div&&sol.total?sol.cost*div/sol.total:0)+cap*1.6+prm*.3};
}

const scale=(cuts,x)=>Object.fromEntries(Object.entries(cuts).map(([i,v])=>[i,Math.min(1,v*x)]));
// Recommendation rule: reroute if it costs $2.30/package or less, then temporary capacity, then promise resets for the remainder.
function recPlan(Rg,cuts){const r0=calc(Rg,cuts,{}),u0=r0.sol.total?r0.sol.cost/r0.sol.total:0;let m=r0.gap;const useDiv=r0.sol.total>0&&u0<=2.3,d=useDiv?Math.min(m,r0.sol.total):0;m-=d;const useCap=m>.5,c=useCap?Math.min(m,.35*r0.lost):0;m-=c;const usePrm=m>.5;return{r0,u0,useDiv,d,useCap,c,usePrm,m,sel:{div:useDiv,cap:useCap,pri:false,prm:usePrm}}}
const f=n=>Math.round(n).toLocaleString('en-US');
const OPTS=[['div','Divert volume to unaffected lanes'],['cap','Add temporary capacity'],['pri','Prioritize SLA-critical packages'],['prm','Adjust delivery promises (+1 day)']];
const col=u=>u>1?'var(--bad)':u>.85?'var(--warn)':'var(--ok)';
const MEANING={'Rip Current Statement':'Dangerous currents for swimmers at beaches. Does not affect trucks or lanes.','Flood Watch':'Flooding is possible but has not started. Some roads could be affected later.','Flood Warning':'Flooding is happening, usually along rivers. A few local roads may close.','Coastal Flood Advisory':'Minor flooding near the coast at high tide. Low impact on trucking.','Coastal Flood Statement':'Update on minor coastal flooding. Low impact on trucking.','High Surf Advisory':'Large waves at beaches. Does not affect trucks or lanes.','Tropical Cyclone Local Statement':'Local impacts expected from a tropical storm or hurricane. Check whether coastal lanes could be hit.'};
const SEVERE=/hurricane|tropical|tornado|storm surge|high wind|extreme wind|blizzard|ice storm|winter storm/i;

function LiveBox({live,Rg,us,region='all',gap}){
 if(!live)return <p className="note">Loading current conditions...</p>;
 if(live.error)return <p className="note">{live.error} Pick a saved scenario instead.</p>;
 const ids=Object.keys(live.nodes),N=Rg.NM;
 const gid=ids.reduce((a,b)=>live.nodes[b].gust>live.nodes[a].gust?b:a),rid=ids.reduce((a,b)=>live.nodes[b].rain>live.nodes[a].rain?b:a);
 const g=live.nodes[gid].gust,rn=live.nodes[rid].rain,hit=ids.filter(i=>cutOf(live.nodes[i])>0);
 const lvl=hit.length?(gap>0?'Disruptive':'Watch'):g>=20?'Breezy':'Calm',color=gap>0?'var(--bad)':hit.length||g>=20?'var(--warn)':'var(--ok)';
 const sev=live.alerts.filter(a=>SEVERE.test(a.event));
 return(<div className="verdict" style={{borderLeft:'5px solid '+color}}>
  <b>Live weather right now: {lvl}</b>
  <div className="note" style={{color:'var(--ink)'}}>{hit.length?`Weather is cutting capacity at: ${hit.map(i=>N[i]).join(', ')}.${gap>0?'':' Today\'s volume still fits, so no action is needed yet.'}`:`No hub is hit hard enough to lose capacity. The windiest hub is ${N[gid]} at ${Math.round(g)} mph gusts (capacity only starts dropping above 35 mph). The wettest is ${N[rid]} at ${rn.toFixed(1)} mm of rain per hour (heavy rain starts at about 2).`}</div>
  <div className="note" style={{color:'var(--ink)',marginTop:6}}><b>Network impact:</b> {gap>0?'Yes. Look at the map and the numbers below.':hit.length||sev.length?'Capacity is reduced but nothing overflows yet. See the early warning below.':'None. The network runs normally, so overflow is 0.'}</div>
  {us?<><div className="note" style={{marginTop:6}}><b>Official US alerts ({US_REGION_LABELS[region]||'selected region'})</b> (National Weather Service, as of {new Date(live.fetchedAt).toLocaleTimeString()}):</div>
  {live.alerts.length?<ul className="why">{live.alerts.map(a=><li key={a.event}><b>{a.event}{a.count>1?' (x'+a.count+')':''}:</b> {MEANING[a.event]||'See weather.gov for details.'} <i>{SEVERE.test(a.event)?'Could disrupt lanes.':'Not a trucking threat.'}</i></li>)}</ul>:<div className="note">No active alerts.</div>}
  <div className="note">Alerts are shown for context. The model uses weather readings only.</div></>:<div className="note" style={{marginTop:6}}>Conditions from Open-Meteo as of {new Date(live.fetchedAt).toLocaleTimeString()}. Official German weather alerts are not included.</div>}
 </div>);
}

function Forecast({Rg,lanes}){
 const ids=Object.keys(Rg.P),[hub,setHub]=useState(null),[gr,setGr]=useState(3);
 const h=ids.includes(hub)?hub:ids.includes('ATL')?'ATL':ids[0];
 const inc=lanes.filter(l=>l.a===h||l.b===h),base=inc.reduce((s,l)=>s+l.v,0)/inc.reduce((s,l)=>s+l.c,0);
 const pts=Array.from({length:14},(_,d)=>base*Math.pow(1+gr/100,d)+.02*Math.sin(d*2*Math.PI/7));
 const br=pts.findIndex(v=>v>1),W=700,H=150,pad=28,x=d=>pad+d*(W-2*pad)/13,y=v=>H-24-(Math.min(v,1.3)-.6)*(H-44)/.7;
 return(<section className="card"><h2>Look ahead: capacity forecast for the next 14 days</h2>
  <div className="row"><label className="note">Hub: <select value={h} onChange={e=>setHub(e.target.value)}>{ids.map(i=><option key={i} value={i}>{Rg.NM[i]}</option>)}</select></label>
  <label className="note" style={{flex:1,minWidth:200}}>Assumed demand growth (peak season): {gr}% per day<input type="range" min="0" max="5" step=".5" value={gr} onChange={e=>setGr(+e.target.value)} style={{width:'100%'}}/></label></div>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Forecast load versus capacity for 14 days">
   <line x1={pad} x2={W-pad} y1={y(1)} y2={y(1)} strokeDasharray="5 4" style={{stroke:'var(--bad)'}}/><text className="lbl" x={W-pad} y={y(1)-5} textAnchor="end" style={{fill:'var(--bad)'}}>100% of capacity</text>
   <polyline fill="none" strokeWidth="3" style={{stroke:'var(--ok)'}} points={pts.map((v,d)=>x(d)+','+y(v)).join(' ')}/>
   {pts.map((v,d)=><g key={d}><circle cx={x(d)} cy={y(v)} r={v>1?5:3} style={{fill:v>1?'var(--bad)':'var(--ok)'}}><title>Day {d+1}: {Math.round(v*100)}% of capacity</title></circle>{d%2===0&&<text x={x(d)} y={H-6} fontSize="11" textAnchor="middle" style={{fill:'var(--mute)'}}>D{d+1}</text>}</g>)}
  </svg>
  <p className="verdict">{br>=0?`${Rg.NM[h]} is forecast to pass 100% of capacity on day ${br+1}. That gives the planner about ${br} days to add capacity or shift volume before packages are at risk.`:`${Rg.NM[h]} stays under capacity for the next 14 days at this growth rate.`}</p>
  <p className="note">Simulated: starts from {Rg.NM[h]}'s current load ({Math.round(base*100)}% of capacity) and grows at the rate you set. It is a simple growth rule, not a trained forecast.</p></section>);
}

export default function Home(){
 const [rg,setRg]=useState('us'),[usRegion,setUsRegion]=useState('all'),[sid,setSid]=useState('ian'),[liveD,setLiveD]=useState({}),[k,setK]=useState(100);
 const [sel,setSel]=useState({div:false,cap:false,pri:false,prm:false}),[ex,setEx]=useState(null),[rec,setRec]=useState(null);
 const Rg=useMemo(()=>rg==='us'?scopedUSRegion(R.us,usRegion):R[rg],[rg,usRegion]);
 const liveKey=rg==='us'?`us:${usRegion}`:rg,live=liveD[liveKey];
 useEffect(()=>{if(sid!=='live'||liveD[liveKey])return;const set=v=>setLiveD(d=>({...d,[liveKey]:v})),fail=()=>set({error:'Live weather is unavailable right now.'});
  const ids=Object.keys(Rg.C);
  const om=fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ids.map(i=>Rg.C[i][0]).join(',')}&longitude=${ids.map(i=>Rg.C[i][1]).join(',')}&current=wind_gusts_10m,precipitation,snowfall&wind_speed_unit=mph`).then(r=>r.json());
  const al=rg==='us'?fetch(`/api/weather?region=${encodeURIComponent(usRegion)}`).then(r=>r.json()).then(j=>j.alerts||[]).catch(()=>[]):Promise.resolve([]);
  Promise.all([om,al]).then(([j,alerts])=>{if(!Array.isArray(j)&&j.error)throw 0;const a=Array.isArray(j)?j:[j],nodes={};ids.forEach((id,i)=>{const c=a[i]?.current||{};nodes[id]={gust:c.wind_gusts_10m??0,rain:c.precipitation??0,snow:c.snowfall??0}});set({nodes,alerts,fetchedAt:new Date().toISOString()})}).catch(fail);
 },[sid,rg,usRegion,liveD,Rg,liveKey]);
 useEffect(()=>setEx(null),[sid,rg,k,sel]);
 useEffect(()=>setRec(null),[sid,rg,k]);
 const wx=sid==='live'?live?.nodes:Rg.SC[sid]?.wx;
 const intensity=sid==='live'?100:k; // Live mode always uses actual readings without the saved-scenario intensity slider.
 const cuts=useMemo(()=>Object.fromEntries(Object.keys(Rg.P).map(id=>[id,wx&&wx[id]?cutOf(wx[id])*intensity/100:0])),[wx,intensity,Rg]);
 const r=calc(Rg,cuts,sel),nsel=Object.values(sel).filter(Boolean).length,t=Math.max(1,r.gap),N=Rg.NM;
 const w=r.lanes.filter(l=>l.over>0).sort((a,b)=>b.over-a.over).slice(0,4),uc=r.sol.total?r.sol.cost/r.sol.total:0;
 const tog=key=>setSel(s=>({...s,[key]:!s[key]})),pick=x=>{setRg(x);if(x==='us'){setUsRegion('all');setSid('ian')}else setSid('snow');setSel({div:false,cap:false,pri:false,prm:false});setRec(null);setK(100)},pickUSRegion=x=>{const next=scopedUSRegion(R.us,x),preferred={all:'ian',west:'west',midwest:'blizzard',northeast:'blizzard',southeast:'ian',plains:'plains'}[x];setUsRegion(x);setSid(current=>current==='live'?'live':(next.SC[preferred]?preferred:Object.keys(next.SC)[0]||'live'));setSel({div:false,cap:false,pri:false,prm:false});setRec(null);setK(100)};
 const desc={div:`Cheapest detours through lanes that still have room: up to ${f(r.sol.total)} packages/day at about $${uc.toFixed(2)} each.${r.gap>0&&r.sol.total<r.gap*.25?' Little room because most nearby lanes are also damaged.':''}`,cap:`Recovers up to ${f(.35*r.lost)} packages/day. $1.60 each. Takes hours to stand up.`,pri:'Critical packages (about 35% of overflow) go first. Free, but the rest still arrive late.',prm:`Resets dates on ${f(r.rem)} remaining packages before customers are let down. $0.30 each in credits.`};
 const recommend=()=>{const {r0,u0,useDiv,d,useCap,c,usePrm,m,sel:ns}=recPlan(Rg,cuts);setSel(ns);setRec(!r0.gap?'Nothing to fix: every lane is within capacity.':`Used operational fixes before changing promises: ${useDiv?`reroute ${f(d)} packages (about $${u0.toFixed(2)} each), `:'rerouting was skipped because no lane has room or it costs too much, '}${useCap?`add temporary capacity for ${f(c)} ($1.60 each), `:''}${usePrm?`and reset promises only on the ${f(m)} packages nothing else can carry. Each reset is ranked at an assumed $2 trust cost on top of the $0.30 credit, so it comes last.`:'so no promise changes are needed.'} You can switch any response on or off to override this.`)};
 const chosen=OPTS.filter(([key])=>sel[key]).map(o=>o[1]);
 const facts={region:Rg.name,scenario:sid==='live'?'Live conditions':Rg.SC[sid].name,intensityPercent:intensity,overCapacityPerDay:Math.round(r.gap),stillLate:Math.round(r.late),promisesReset:Math.round(r.prm),planCostPerDay:Math.round(r.cost),responsesChosen:chosen,worstLanes:w.map(l=>`${N[l.a]} to ${N[l.b]}: capacity ${Math.round(l.c)} to ${Math.round(l.eff)}, volume ${l.v}, short ${Math.round(l.over)}`),reroutes:r.sol.plans.slice(0,3).map(p=>`${N[p.from]} to ${N[p.to]} via ${p.via.map(i=>N[i]).join(' and ')}: ${Math.round(p.units)} packages at $${p.unit.toFixed(2)} each`)};
 const template=()=>!facts.overCapacityPerDay?`Under "${facts.scenario}", every lane stays within capacity, so no packages are at risk.`:`Under "${facts.scenario}", about ${f(facts.overCapacityPerDay)} packages a day no longer fit on damaged lanes, mainly ${facts.worstLanes.slice(0,2).map(s=>s.split(':')[0]).join(' and ')}. ${chosen.length?`Your plan (${chosen.join(', ').toLowerCase()}) leaves ${f(facts.stillLate)} late and resets promises on ${f(facts.promisesReset)}, at $${f(facts.planCostPerDay)} per day.`:'You have not chosen a response yet, so all of them would be late.'} ${sel.prm?'Resetting promises is cheap but spends customer trust.':facts.stillLate>0?'No option here is free: you trade cost against late packages and customer trust.':'Everything is protected, but check what that costs.'} This is a simulation with invented data.`;
 const explain=async()=>{setEx({loading:true});try{const res=await fetch('/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(facts)});const j=await res.json();if(res.ok&&j.text)return setEx({text:j.text,source:'Gemini AI'});throw 0}catch(e){setEx({text:template(),source:'Template (Gemini not available)'})}};
 const nd=sid==='live'?'no data':'calm',calm=!r.gap,anyCut=Object.values(cuts).some(v=>v>0);
 let worse=null;if(calm&&anyCut)for(let x=1.1;x<=3.01;x+=.1){if(calc(Rg,scale(cuts,x),{}).gap>0){worse=x;break}}
 const sx=worse?Math.min(3,worse+.5):null,st=sx?recPlan(Rg,scale(cuts,sx)):null,stCost=st&&st.r0.gap>0?calc(Rg,scale(cuts,sx),st.sel).cost:0;
 const tight=[...r.lanes].sort((a,b)=>b.v/b.eff-a.v/a.eff).slice(0,3);
 const hint={fontSize:'13px',margin:'0 0 8px'};
 return(<main>
  <h1>Network Watch</h1>
  <p className="sub">When bad weather closes lanes, which packages miss their promise, and what should the planner do? Simulated transportation network with weather scenarios.</p>
  <section className="card warnbox"><b>Synthetic data.</b> The networks (hubs, lanes, volumes, costs) are invented for this demo and are not Amazon data. Weather scenarios are illustrative approximations; "Live now" uses real current conditions. The model is rule-based, not machine learning.</section>
  <section className="card steps"><h2>Plan through a weather disruption</h2><ol>
   <li><b>Choose a country and, for the US, a region.</b> The map, hubs, lanes, scenario choices, and live readings update to that view.</li>
   <li><b>Compare saved scenarios with "Live now".</b> Live now fetches current wind, rain, and snow at each hub from Open-Meteo; the US view also checks National Weather Service alerts for the selected region. Calm weather is valid—use saved scenarios to stress-test disruptions.</li>
   <li><b>Read the impact and choose a response.</b> "Still late" estimates packages per day at risk in this simulation. Compare rerouting, temporary capacity, prioritisation, and promise changes against the cost.</li>
   <li><b>Explain and look ahead.</b> Use "Explain this plan" for a plain-language summary, review weather readings by hub, and stress-test the 14-day capacity outlook (which is a simple synthetic growth scenario).</li></ol></section>
  <div className="grid">
   <section className="card"><h2>Network: {Rg.name}, lane load under weather</h2>
    <svg viewBox={Rg.vb} role="img" aria-label="Map of hubs and lanes colored by utilization">
     {r.lanes.map(l=>{const[x1,y1]=Rg.P[l.a],[x2,y2]=Rg.P[l.b];return <line key={l.key} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" strokeWidth={l.c/1400+1} style={{stroke:col(l.v/Math.max(1,l.eff))}}><title>{N[l.a]} to {N[l.b]}: {f(l.v)} packages vs {f(l.eff)} capacity</title></line>})}
     {Object.entries(Rg.P).map(([id,[x,y]])=>{const c=cuts[id];return <g key={id}><circle cx={x} cy={y} r="9" strokeWidth="3" style={{fill:'var(--panel)',stroke:c>.5?'var(--bad)':c>.15?'var(--warn)':'var(--ok)'}}/><text className="lbl" x={x+14} y={y+4} style={Rg.vb==="0 0 900 600"?{fontSize:14}:undefined}>{N[id]}</text></g>})}
    </svg>
    <div className="legend">Teal: under 85% of remaining capacity. Amber: 85-100%. Red: over capacity. Line width: original capacity.</div></section>
   <section className="card"><h2>1. Country, US region & weather</h2>
    <label className="note">Country: <select value={rg} onChange={e=>pick(e.target.value)} style={{font:'inherit',marginLeft:4,marginBottom:8}}><option value="us">United States</option><option value="de">Germany</option></select></label>
    {rg==='us'&&<label className="note" style={{display:'block',marginBottom:8}}>US region: <select value={usRegion} onChange={e=>pickUSRegion(e.target.value)} style={{font:'inherit',marginLeft:4,marginBottom:4}}>{Object.entries(US_REGION_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><span style={{display:'block',fontSize:12,marginTop:2}}>Regional views filter hubs and lanes; boundary hubs may appear in more than one view.</span></label>}
    <p className="note" style={hint}>{Rg.hint}</p>
    <div className="row">{[...Object.entries(Rg.SC).map(([id,s])=>[id,s.name]),['live','Live now']].map(([id,n])=><button key={id} className="chip" aria-pressed={sid===id} onClick={()=>setSid(id)}>{n}</button>)}</div>
    {sid==='live'?<LiveBox live={live} Rg={Rg} us={rg==='us'} region={usRegion} gap={r.gap}/>:<p className="note">{Rg.SC[sid].note}</p>}
    <label className="note">{sid==='live'?'Live weather intensity: actual readings (not adjustable)':`Saved-scenario intensity: ${k}%`}<input type="range" min="0" max="100" value={k} disabled={sid==='live'} onChange={e=>setK(+e.target.value)} style={{width:'100%',opacity:sid==='live'?.55:1}}/></label>
    <div className="stats" aria-live="polite" style={{gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))'}}>{[['Over capacity / day',f(r.gap)],['Delivered on time',f(r.div+r.cap)],['Given a new date',f(r.prm)],['Still late',f(r.late)],['Plan cost / day','$'+f(r.cost)]].map(([a,b])=><div key={a}><small>{a}</small><span className="big">{b}</span></div>)}</div>
    <div className="bar" aria-hidden="true">{[[r.div,'var(--ok)'],[r.cap,'var(--mute)'],[r.prm,'var(--warn)'],[r.late,'var(--bad)']].map(([v,c],i)=><i key={i} style={{width:v/t*100+'%',background:c}}/>)}</div>
    <p className="note">Packages are counted per lane, so one that crosses two damaged lanes is counted twice. Treat totals as an upper bound.</p>
    <p className="verdict" aria-live="polite">{!r.gap?'No overflow with these conditions. Try another scenario or raise intensity.':nsel?`With your plan: ${f(r.late)} packages still late, ${f(r.prm)} given a new date, cost $${f(r.cost)} per day.`:`Doing nothing: ${f(r.gap)} packages per day miss their promise. Pick a response below.`}</p>
    {calm&&<div className="verdict" style={{borderLeft:'5px solid var(--warn)'}}><b>Early warning: nothing to fix right now</b>
     <div className="note" style={{color:'var(--ink)'}}>{anyCut?(worse?`Weather is cutting capacity, but today's volume still fits. Overflow would start if conditions got about ${Math.round((worse-1)*100)}% worse.`:'Weather is cutting capacity, but volume still fits even if conditions got much worse.'):'Weather is not reducing capacity anywhere, so there is nothing for the planner to do.'}</div>
     <div className="note">Closest to capacity: {tight.map(l=>`${N[l.a]} to ${N[l.b]} (${Math.round(l.v/Math.max(1,l.eff)*100)}% used, room for ${f(l.spare)} more)`).join('; ')}.</div>
     {stCost>0&&<div className="note" style={{color:'var(--ink)'}}>If conditions got about {Math.round((sx-1)*100)}% worse: about {f(st.r0.gap)} packages/day over capacity. Suggested response: {[st.useDiv&&`reroute ${f(st.d)}`,st.useCap&&`add temporary capacity for ${f(st.c)}`,st.usePrm&&`reset promises on ${f(st.m)}`].filter(Boolean).join(', ')}, costing about ${f(stCost)} per day.</div>}
     <div className="note" style={{marginTop:6}}>To see the responses in action, try a saved scenario:</div>
     <div className="row" style={{marginTop:4}}>{Object.entries(Rg.SC).map(([id,sc])=><button key={id} className="chip" onClick={()=>setSid(id)}>{sc.name}</button>)}</div></div>}
    <h2>2. Choose your response</h2>
    <button type="button" className="chip" onClick={recommend} style={{marginBottom:8,fontWeight:700}}>Recommend a plan</button>
    {rec&&<p className="verdict">{rec}</p>}
    {OPTS.map(([key,n])=><button key={key} className="opt" aria-pressed={sel[key]} onClick={()=>tog(key)}><b>{n}</b><span>{desc[key]}</span></button>)}
    {sel.div&&r.sol.plans.length>0&&<><h2>Reroutes the solver chose</h2><ul className="why">{r.sol.plans.slice(0,4).map((p,i)=><li key={i}>{N[p.from]} to {N[p.to]} via {p.via.map(x=>N[x]).join(' and ')}: {f(p.units)} packages at ${p.unit.toFixed(2)} each.</li>)}</ul></>}
    <h2 style={{marginTop:12}}>Why these lanes</h2><ul className="why">{w.length?w.map(l=><li key={l.key}>{N[l.a]} to {N[l.b]}: capacity down {Math.round((1-l.eff/l.c)*100)}% ({f(l.c)} to {f(l.eff)}), volume {f(l.v)}, short by {f(l.over)}.</li>):<li>All lanes within capacity.</li>}</ul>
    <h2 style={{marginTop:12}}>3. Explain this plan</h2>
    <button className="go" type="button" onClick={explain} disabled={ex?.loading} style={{font:'inherit',fontWeight:700,background:'var(--sel)',color:'var(--selt)',border:0,borderRadius:6,padding:'10px 16px',cursor:'pointer',width:'100%'}}>{ex?.loading?'Writing...':'Explain this plan'}</button>
    {ex?.text&&<div className="verdict"><div>{ex.text}</div><div className="note">Source: {ex.source}. Written only from the numbers above.</div></div>}</section>
  </div>
  <Forecast Rg={Rg} lanes={r.lanes}/>
  <section className="card"><h2>Weather at each hub</h2>
   {wx?<table><thead><tr><th>Hub</th><th>Gust (mph)</th><th>Rain (mm/h)</th><th>Snow (cm/h)</th><th>Capacity cut</th></tr></thead><tbody>{Object.keys(Rg.P).map(id=><tr key={id}><td>{N[id]}</td><td>{wx[id]?Math.round(wx[id].gust):nd}</td><td>{wx[id]?(+wx[id].rain).toFixed(1):nd}</td><td>{wx[id]?(+(wx[id].snow||0)).toFixed(1):nd}</td><td>{Math.round(cuts[id]*100)}%</td></tr>)}</tbody></table>:<p className="note">No weather data loaded.</p>}
   <p className="note">Rule: gusts above 35 mph start cutting a hub's capacity (full cut at 90 mph). Heavy rain cuts up to 50% and heavy snow up to 60%. A lane loses capacity based on its worse end.</p></section>
 </main>);
}
