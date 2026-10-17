import {HUBS} from '../../../lib/network';
export const dynamic='force-dynamic';
// Prototype integration using public OSRM demo. Use a hosted/self-hosted provider for production.
export async function GET(req){
  const {searchParams}=new URL(req.url);
  const origin=HUBS[searchParams.get('origin')||'DEL'];
  const destination=HUBS[searchParams.get('destination')||'JAI'];
  if(!origin||!destination)return Response.json({error:'Unknown origin or destination'},{status:400});
  if(origin.id===destination.id)return Response.json({source:'OSRM / OpenStreetMap',distanceKm:0,durationMinutes:0,coordinates:[[origin.lon,origin.lat]],note:'Origin and destination are the same hub.'});
  try{
    const url=`https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`;
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'NetworkWatchPortfolioPrototype/1.0'}});
    if(!response.ok)throw new Error(`Routing provider returned ${response.status}`);
    const data=await response.json(),route=data.routes?.[0];
    if(data.code!=='Ok'||!route)throw new Error('No road route returned');
    return Response.json({source:'OSRM / OpenStreetMap',distanceKm:Math.round(route.distance/100)/10,durationMinutes:Math.round(route.duration/60),coordinates:route.geometry.coordinates,note:'Road route from public OSRM demo service. ETA is an estimate, not live traffic or a commercial-vehicle guarantee.'});
  }catch(error){return Response.json({source:'unavailable',error:'Real road routing is temporarily unavailable. The network graph remains available.',detail:error.message},{status:502});}
}
