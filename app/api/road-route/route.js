import {HUBS} from '../../../lib/network';
export const dynamic = 'force-dynamic';

async function tomtomRoute(origin, destination, key) {
  const points = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json?traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`TomTom routing returned ${response.status}`);
  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('TomTom did not return a route');
  const coordinates = (route.legs || []).flatMap(leg => (leg.points || []).map(p => [p.longitude, p.latitude]));
  const summary = route.summary || {};
  return {
    source: 'TomTom Routing', trafficAvailable: true,
    distanceKm: Math.round((summary.lengthInMeters || 0) / 100) / 10,
    durationMinutes: Math.round((summary.travelTimeInSeconds || 0) / 60),
    coordinates,
    note: 'TomTom traffic-aware route estimate. Traffic coverage and ETA accuracy vary by road and location; this is not a commercial-vehicle guarantee.'
  };
}

async function osrmRoute(origin, destination) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(12000), headers:{'User-Agent':'NetworkWatchPortfolioPrototype/1.0'}});
  if (!response.ok) throw new Error(`OSRM routing returned ${response.status}`);
  const data = await response.json();
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route) throw new Error('No road route returned by OSRM');
  return {
    source: 'OSRM / OpenStreetMap', trafficAvailable: false,
    distanceKm: Math.round(route.distance / 100) / 10,
    durationMinutes: Math.round(route.duration / 60),
    coordinates: route.geometry.coordinates,
    note: 'Road geometry and baseline driving estimate from the public OSRM demo using OpenStreetMap data. This does not include live traffic.'
  };
}

export async function GET(req) {
  const {searchParams} = new URL(req.url);
  const origin = HUBS[searchParams.get('origin') || 'DEL'];
  const destination = HUBS[searchParams.get('destination') || 'JAI'];
  if (!origin || !destination) return Response.json({error:'Unknown origin or destination'}, {status:400});
  if (origin.id === destination.id) return Response.json({source:'OSRM / OpenStreetMap',trafficAvailable:false,distanceKm:0,durationMinutes:0,coordinates:[[origin.lon,origin.lat]],note:'Origin and destination are the same hub.'});

  const trafficKey = process.env.TOMTOM_API_KEY;
  if (trafficKey) {
    try { return Response.json(await tomtomRoute(origin, destination, trafficKey)); }
    catch (error) {
      // If the paid/limited traffic provider is unavailable, preserve road geometry via OSRM and label the fallback honestly.
      try {
        const fallback = await osrmRoute(origin, destination);
        return Response.json({...fallback, note:`Traffic provider unavailable (${error.message}); showing baseline OSRM route without live traffic.`});
      } catch (fallbackError) {
        return Response.json({source:'unavailable',error:'Road routing is temporarily unavailable.',detail:fallbackError.message},{status:502});
      }
    }
  }
  try { return Response.json(await osrmRoute(origin, destination)); }
  catch (error) { return Response.json({source:'unavailable',error:'Real road routing is temporarily unavailable. The network graph remains available.',detail:error.message},{status:502}); }
}
