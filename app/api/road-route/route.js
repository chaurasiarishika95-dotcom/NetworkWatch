import { HUBS } from '../../../lib/network';

export const dynamic = 'force-dynamic';

async function tomtomRoute(origin, destination, key) {
  const points = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json?traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`TomTom routing returned ${response.status}`);

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('TomTom did not return a route');

  const coordinates = (route.legs || []).flatMap(leg => (leg.points || []).map(point => [point.longitude, point.latitude]));
  const summary = route.summary || {};
  const trafficDelaySeconds = summary.trafficDelayInSeconds;
  const noTrafficSeconds = summary.noTrafficTravelTimeInSeconds;

  return {
    source: 'TomTom Routing',
    trafficRequested: true,
    trafficAvailable: Number.isFinite(trafficDelaySeconds) || Number.isFinite(summary.liveTrafficIncidentsTravelTimeInSeconds),
    distanceKm: Math.round((summary.lengthInMeters || 0) / 100) / 10,
    durationMinutes: Math.round((summary.travelTimeInSeconds || 0) / 60),
    trafficDelayMinutes: Number.isFinite(trafficDelaySeconds) ? Math.max(0, Math.round(trafficDelaySeconds / 60)) : null,
    noTrafficDurationMinutes: Number.isFinite(noTrafficSeconds) ? Math.round(noTrafficSeconds / 60) : null,
    coordinates,
    note: 'TomTom routing requested current traffic information. Whether live traffic data is available varies by road and area; journey times are estimates, not a commercial-vehicle guarantee.',
  };
}

async function osrmRoute(origin, destination, reason = null) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'NetworkWatchPortfolioPrototype/1.0' } });
  if (!response.ok) throw new Error(`OSRM routing returned ${response.status}`);
  const data = await response.json();
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route) throw new Error('No road route returned by OSRM');

  return {
    source: 'OSRM / OpenStreetMap',
    trafficRequested: false,
    trafficAvailable: false,
    distanceKm: Math.round(route.distance / 100) / 10,
    durationMinutes: Math.round(route.duration / 60),
    trafficDelayMinutes: null,
    noTrafficDurationMinutes: null,
    coordinates: route.geometry.coordinates,
    note: reason
      ? `Traffic provider unavailable (${reason}); showing baseline OSRM road geometry without live traffic.`
      : 'Road geometry and baseline driving estimate from the public OSRM demo using OpenStreetMap data. This does not include live traffic.',
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const origin = HUBS[searchParams.get('origin') || 'DEL'];
  const destination = HUBS[searchParams.get('destination') || 'JAI'];

  if (!origin || !destination) {
    return Response.json({ error: 'Unknown origin or destination' }, { status: 400 });
  }

  if (origin.id === destination.id) {
    return Response.json({ source: 'OSRM / OpenStreetMap', trafficRequested: false, trafficAvailable: false, distanceKm: 0, durationMinutes: 0, trafficDelayMinutes: null, noTrafficDurationMinutes: null, coordinates: [[origin.lon, origin.lat]], note: 'Origin and destination are the same hub.' });
  }

  const trafficKey = process.env.TOMTOM_API_KEY;
  if (trafficKey) {
    try {
      return Response.json(await tomtomRoute(origin, destination, trafficKey), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      try {
        const fallback = await osrmRoute(origin, destination, error.message);
        return Response.json(fallback, { headers: { 'Cache-Control': 'no-store' } });
      } catch (fallbackError) {
        return Response.json({ source: 'unavailable', error: 'Road routing is temporarily unavailable.', detail: fallbackError.message }, { status: 502 });
      }
    }
  }

  try {
    return Response.json(await osrmRoute(origin, destination), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ source: 'unavailable', error: 'Real road routing is temporarily unavailable. The network graph remains available.', detail: error.message }, { status: 502 });
  }
}
