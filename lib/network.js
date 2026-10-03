// All network data below is SYNTHETIC. Only the weather inputs can be real (live mode).
export const P={CLT:[500,90],BNA:[200,70],BHM:[150,200],ATL:[320,200],SAV:[510,235],JAX:[520,330],MCO:[480,420],TPA:[360,440],RSW:[400,510],MIA:[590,500]};
export const NM={CLT:'Charlotte',BNA:'Nashville',BHM:'Birmingham',ATL:'Atlanta',SAV:'Savannah',JAX:'Jacksonville',MCO:'Orlando',TPA:'Tampa',RSW:'Fort Myers',MIA:'Miami'};
export const COORD={CLT:[35.22,-80.84],BNA:[36.16,-86.78],BHM:[33.52,-86.80],ATL:[33.75,-84.39],SAV:[32.08,-81.09],JAX:[30.33,-81.66],MCO:[28.54,-81.38],TPA:[27.95,-82.46],RSW:[26.64,-81.87],MIA:[25.76,-80.19]};
export const L=[['BNA','ATL',6000,4300],['BNA','BHM',3000,1900],['BHM','ATL',5000,3600],['CLT','ATL',7000,5200],['CLT','SAV',3500,2300],['ATL','SAV',5500,3900],['ATL','JAX',9000,6400],['SAV','JAX',5000,3300],['JAX','MCO',8000,5900],['JAX','TPA',6000,4100],['ATL','TPA',5000,3200],['ATL','MCO',6500,4200],['MCO','TPA',4500,3000],['MCO','RSW',4000,2800],['TPA','RSW',4000,2900],['MCO','MIA',6000,4300],['RSW','MIA',3500,2100]];
const ALT=['ATL-JAX','SAV-JAX','ATL-MCO','JAX-MCO'];
// gust = mph, rain = mm/hour. Saved scenarios are illustrative approximations, not official records.
export const SCENARIOS={
 ian:{name:'Hurricane Ian replay',note:'Approximate, illustrative conditions modeled on the 2022 Florida landfall. Not an official record.',wx:{RSW:{gust:150,rain:25},TPA:{gust:90,rain:15},MCO:{gust:80,rain:12},MIA:{gust:35,rain:6},JAX:{gust:45,rain:5},SAV:{gust:25,rain:1},ATL:{gust:15,rain:0}}},
 rain:{name:'Heavy rain day',note:'Illustrative: steady heavy rain across central and south Florida, little wind.',wx:{MCO:{gust:25,rain:14},TPA:{gust:20,rain:12},MIA:{gust:22,rain:16},RSW:{gust:20,rain:10},JAX:{gust:15,rain:8},ATL:{gust:10,rain:6},SAV:{gust:12,rain:6}}},
 wind:{name:'Heavy wind front',note:'Illustrative: strong gusts from a cold front across Georgia, the Carolinas and Alabama.',wx:{ATL:{gust:65,rain:1},CLT:{gust:70,rain:1},BHM:{gust:60,rain:0},BNA:{gust:55,rain:0},SAV:{gust:62,rain:0},JAX:{gust:58,rain:0},MCO:{gust:45,rain:0},TPA:{gust:40,rain:0}}}
};
const cl=x=>Math.max(0,Math.min(1,x));
// Rule: wind above 35 mph starts cutting capacity (full cut at 90 mph); heavy rain cuts up to 50%.
export const cutOf=w=>Math.max(cl((w.gust-35)/55),.5*cl((w.rain-2)/18));
export function calc(cuts,sel){
 const lanes=L.map(([a,b,c,v])=>{const cut=Math.max(cuts[a]||0,cuts[b]||0);const eff=c*(1-Math.min(.95,cut*.95));return{a,b,c,v,eff,over:Math.max(0,v-eff),spare:Math.max(0,eff-v),key:a+'-'+b}});
 const gap=lanes.reduce((s,l)=>s+l.over,0);
 const lost=lanes.filter(l=>l.over>0).reduce((s,l)=>s+(l.c-l.eff),0);
 const spare=lanes.filter(l=>ALT.includes(l.key)).reduce((s,l)=>s+l.spare,0);
 let rem=gap;
 const div=sel.div?Math.min(rem,spare):0;rem-=div;
 const cap=sel.cap?Math.min(rem,.35*lost):0;rem-=cap;
 const prm=sel.prm?rem:0,late=sel.prm?0:rem,crit=sel.pri?0:rem*.35;
 return{lanes,gap,lost,spare,div,cap,rem,prm,late,crit,cost:div*.95+cap*1.6+prm*.3};
}
