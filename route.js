import {COORD} from '../../../lib/network';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  const ids=Object.keys(COORD);
  const lat=ids.map(i=>COORD[i][0]).join(','),lon=ids.map(i=>COORD[i][1]).join(',');
  const [om,al]=await Promise.all([
   fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_gusts_10m,precipitation&wind_speed_unit=mph`,{cache:'no-store'}),
   fetch('https://api.weather.gov/alerts/active?area=FL',{headers:{'User-Agent':'network-watch-portfolio-demo','Accept':'application/geo+json'},cache:'no-store'}).catch(()=>null)
  ]);
  if(!om.ok)throw new Error('weather');
  const j=await om.json(),arr=Array.isArray(j)?j:[j],nodes={};
  ids.forEach((id,i)=>{const c=arr[i]?.current||{};nodes[id]={gust:c.wind_gusts_10m??0,rain:c.precipitation??0}});
  let alerts=[];
  if(al&&al.ok){const g=await al.json(),m={};(g.features||[]).forEach(f=>{const e=f.properties?.event;if(e)m[e]=(m[e]||0)+1});alerts=Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([event,count])=>({event,count}))}
  return Response.json({nodes,alerts,fetchedAt:new Date().toISOString()});
 }catch(e){return Response.json({error:'Live weather is unavailable right now.'},{status:502})}
}
