import {COORD} from '../../../lib/network';
export const dynamic='force-dynamic';

const REGION_STATES={
 west:['WA','OR','CA','NV','AZ','CO'],
 midwest:['MN','WI','IL','MI','MO','KS'],
 northeast:['NY','PA','MA','NJ','CT'],
 southeast:['NC','SC','GA','FL','AL','TN'],
 plains:['TX','OK','KS','NM','CO']
};

export async function GET(request){
 try{
  const {searchParams}=new URL(request.url),region=searchParams.get('region')||'all';
  const ids=Object.keys(COORD);
  const lat=ids.map(i=>COORD[i][0]).join(','),lon=ids.map(i=>COORD[i][1]).join(',');
  const omPromise=fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_gusts_10m,precipitation&wind_speed_unit=mph`,{cache:'no-store'}).catch(()=>null);
  const states=REGION_STATES[region];
  const alertUrls=states
   ? states.map(state=>`https://api.weather.gov/alerts/active?area=${state}`)
   : ['https://api.weather.gov/alerts/active'];
  const alertPromises=alertUrls.map(url=>fetch(url,{headers:{'User-Agent':'network-watch-portfolio-demo','Accept':'application/geo+json'},cache:'no-store'}).catch(()=>null));
  const [om,...alertResponses]=await Promise.all([omPromise,...alertPromises]);
  const nodes={};
  if(om?.ok){
   const j=await om.json(),arr=Array.isArray(j)?j:[j];
   ids.forEach((id,i)=>{const current=arr[i]?.current||{};nodes[id]={gust:current.wind_gusts_10m??0,rain:current.precipitation??0}});
  }
  const events=new Map(),seen=new Set();
  for(const response of alertResponses){
   if(!response?.ok)continue;
   const payload=await response.json();
   for(const feature of (payload.features||[])){
    const p=feature.properties||{},event=p.event||'Weather alert';
    const key=feature.id||`${event}:${p.headline||p.sent||''}`;
    if(seen.has(key))continue;
    seen.add(key);events.set(event,(events.get(event)||0)+1);
   }
  }
  const alerts=[...events.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([event,count])=>({event,count}));
  return Response.json({nodes,alerts,region,fetchedAt:new Date().toISOString()});
 }catch(e){return Response.json({error:'Live weather alerts are unavailable right now.'},{status:502})}
}
