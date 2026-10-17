// Synthetic India logistics network for a portfolio prototype. This is not Delhivery operational data.
export const HUBS = {
  DEL:{id:'DEL',name:'Delhi NCR',city:'Delhi',lat:28.6139,lon:77.2090,x:360,y:95,type:'Gateway',capacity:12000,demand:10500},
  JAI:{id:'JAI',name:'Jaipur',city:'Jaipur',lat:26.9124,lon:75.7873,x:275,y:190,type:'Regional hub',capacity:6200,demand:5200},
  AGR:{id:'AGR',name:'Agra',city:'Agra',lat:27.1767,lon:78.0081,x:425,y:205,type:'Sort centre',capacity:4500,demand:3500},
  LKO:{id:'LKO',name:'Lucknow',city:'Lucknow',lat:26.8467,lon:80.9462,x:565,y:245,type:'Regional hub',capacity:7200,demand:6500},
  KNP:{id:'KNP',name:'Kanpur',city:'Kanpur',lat:26.4499,lon:80.3319,x:490,y:300,type:'Sort centre',capacity:5000,demand:4100},
  CHD:{id:'CHD',name:'Chandigarh',city:'Chandigarh',lat:30.7333,lon:76.7794,x:250,y:40,type:'Regional hub',capacity:4800,demand:3900},
  LUD:{id:'LUD',name:'Ludhiana',city:'Ludhiana',lat:30.9010,lon:75.8573,x:140,y:65,type:'Sort centre',capacity:4000,demand:3100},
  BHW:{id:'BHW',name:'Bhiwadi',city:'Bhiwadi',lat:28.2102,lon:76.8606,x:240,y:135,type:'Sort centre',capacity:4200,demand:3600},
  AJM:{id:'AJM',name:'Ajmer',city:'Ajmer',lat:26.4499,lon:74.6399,x:125,y:240,type:'Delivery centre',capacity:2600,demand:1900},
  VAR:{id:'VAR',name:'Varanasi',city:'Varanasi',lat:25.3176,lon:82.9739,x:690,y:330,type:'Regional hub',capacity:5200,demand:4400},
  GWL:{id:'GWL',name:'Gwalior',city:'Gwalior',lat:26.2183,lon:78.1828,x:390,y:270,type:'Sort centre',capacity:3400,demand:2500},
};
// Lanes are modeled connections, not a claim about Delhivery's actual network. Capacity in parcels/day; costs are synthetic INR/parcel.
export const LANES = [
 ['DEL','CHD',5000,8.5,4.8],['CHD','LUD',2600,4.2,2.1],['DEL','LUD',3200,9.1,3.2],['DEL','BHW',4200,4.8,3.4],['BHW','JAI',3000,5.2,2.7],['DEL','JAI',5200,7.2,5.1],['DEL','AGR',3600,5.4,3.0],['JAI','AGR',2200,5.0,1.8],['AGR','GWL',2100,4.6,1.7],['AGR','KNP',2800,5.7,2.5],['KNP','LKO',3500,4.3,2.9],['AGR','LKO',2500,7.1,2.4],['LKO','VAR',3000,5.8,2.8],['KNP','VAR',1900,6.4,1.9],['GWL','KNP',1800,5.5,1.6],['JAI','AJM',1800,4.4,1.5],['DEL','GWL',2200,8.0,2.0],['CHD','DEL',4400,8.6,4.2],['LUD','CHD',2100,4.4,1.7],['VAR','LKO',2600,5.9,2.2],['BHW','AGR',1700,4.6,1.5],['AJM','BHW',1500,6.8,1.3]
].map(([from,to,capacity,transitHours,costPerParcel])=>({from,to,capacity,transitHours,costPerParcel,key:`${from}-${to}`}));
export const SCENARIOS = {
 monsoon:{name:'Monsoon downpour',description:'Simulated heavy rainfall affects the Delhi–Agra–Kanpur corridor.',weather:{DEL:{rain:8,gust:30},AGR:{rain:24,gust:35},GWL:{rain:18,gust:28},KNP:{rain:22,gust:32},LKO:{rain:12,gust:25}},laneCuts:{'DEL-AGR':0.55,'AGR-KNP':0.6,'AGR-GWL':0.35,'KNP-LKO':0.25}},
 closure:{name:'Road closure near Agra',description:'Simulated closure disables the Agra–Kanpur lane and reduces adjacent corridor capacity.',weather:{AGR:{rain:2,gust:20}},laneCuts:{'AGR-KNP':1,'DEL-AGR':0.15,'JAI-AGR':0.1}},
 surge:{name:'Festive demand surge',description:'Simulated parcel demand surge raises volume on the Delhi NCR–Jaipur–Agra lanes.',weather:{},laneCuts:{},demandMultiplier:1.35},
 hub:{name:'Delhi hub capacity loss',description:'Simulated operational incident reduces Delhi NCR throughput by 40%.',weather:{DEL:{rain:0,gust:0}},hubCuts:{DEL:0.4},laneCuts:{'DEL-CHD':0.2,'DEL-JAI':0.2,'DEL-AGR':0.2}}
};
export function haversineKm(a,b){const rad=x=>x*Math.PI/180;const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
export function getLaneState(scenario){const s=SCENARIOS[scenario]||SCENARIOS.monsoon;return LANES.map(l=>({...l,effectiveCapacity:Math.max(0,Math.round(l.capacity*(1-(s.laneCuts?.[l.key]||0)))),cut:s.laneCuts?.[l.key]||0,closed:(s.laneCuts?.[l.key]||0)>=1}));}
export function findPath(origin,destination,lanes,avoidClosed=true){
 const dist={},prev={},visited=new Set();Object.keys(HUBS).forEach(id=>dist[id]=Infinity);dist[origin]=0;
 while(true){let u=null;for(const id of Object.keys(HUBS))if(!visited.has(id)&&(u===null||dist[id]<dist[u]))u=id;if(u===null||dist[u]===Infinity||u===destination)break;visited.add(u);
  for(const l of lanes){if(avoidClosed&&l.effectiveCapacity<=0)continue;let v=null;if(l.from===u)v=l.to;else if(l.to===u)v=l.from;if(!v||visited.has(v))continue;const weight=l.transitHours + l.costPerParcel*0.12 + (l.effectiveCapacity<1000?4:0);if(dist[u]+weight<dist[v]){dist[v]=dist[u]+weight;prev[v]={from:u,lane:l};}}
 }
 if(dist[destination]===Infinity)return null;const path=[],pathLanes=[];let n=destination;while(n!==origin){const p=prev[n];if(!p)return null;path.unshift(n);pathLanes.unshift(p.lane);n=p.from;}path.unshift(origin);return{nodes:path,lanes:pathLanes,score:dist[destination],hours:pathLanes.reduce((s,l)=>s+l.transitHours,0),cost:pathLanes.reduce((s,l)=>s+l.costPerParcel,0)};
}
export function buildPlan(scenario){const s=SCENARIOS[scenario]||SCENARIOS.monsoon,lanes=getLaneState(scenario),multiplier=s.demandMultiplier||1;const affected=lanes.filter(l=>l.cut>0||l.capacity*multiplier*0.82>l.effectiveCapacity);const plans=[];let atRisk=0,capacityLost=0;for(const l of affected){capacityLost+=Math.round(l.capacity-l.effectiveCapacity);const volume=Math.round(l.capacity*multiplier*0.82);const overflow=Math.max(0,volume-l.effectiveCapacity);atRisk+=overflow;if(overflow>0){const alt=findPath(l.from,l.to,lanes.filter(x=>x.key!==l.key));plans.push({lane:l.key,from:l.from,to:l.to,volume,overflow,alternative:alt?alt.nodes:null,alternativeHours:alt?.hours??null,extraCost:alt?Math.max(0,alt.cost-l.costPerParcel)*overflow:null,status:alt?'Alternative path found':'No feasible alternate path'});}}
 const activeHubs=Object.keys(HUBS).map(id=>({id,name:HUBS[id].name,capacity:Math.round(HUBS[id].capacity*(1-(s.hubCuts?.[id]||0))),demand:Math.round(HUBS[id].demand*(s.demandMultiplier||1))}));return{scenario,scenarioName:s.name,lanes,affectedLanes:affected.length,capacityLost,atRisk,plans,activeHubs,generatedAt:new Date().toISOString(),synthetic:true};}
