import { HUBS } from './network';

// Small in-memory cache to avoid calling public routing providers repeatedly
// while comparing a few alternative paths. It is best-effort per server instance.
const CACHE_TTL_MS = 3 * 60 * 1000;
const routeCache = new Map();

async function tomtomRoute(origin, destination, key) {
  const points = `${origin.lat},${origin.lon}:${destination.lat},${destination.lon}`;
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${points}/json?traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`TomTom routing returned ${response.status}`);

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('TomTom did not return a route');

  const coordinates = (route.legs || []).flatMap(leg =>
    (leg.points || []).map(point => [point.longitude, point.latitude])
  );
  if (coordinates.length < 2) throw new Error('TomTom returned no route geometry');

  const summary = route.summary || {};
  const delaySeconds = summary.trafficDelayInSeconds;
  const noTrafficSeconds = summary.noTrafficTravelTimeInSeconds;
  const trafficAvailable = Number.isFinite(delaySeconds) ||
    Number.isFinite(summary.liveTrafficIncidentsTravelTimeInSeconds);

  return {
    source: 'TomTom Routing',
    trafficRequested: true,
    trafficAvailable,
    distanceKm: Math.round((summary.lengthInMeters || 0) / 100) / 10,
    durationMinutes: Math.round((summary.travelTimeInSeconds || 0) / 60),
    trafficDelayMinutes: Number.isFinite(delaySeconds)
      ? Math.max(0, Math.round(delaySeconds / 60))
      : null,
    noTrafficDurationMinutes: Number.isFinite(noTrafficSeconds)
      ? Math.round(noTrafficSeconds / 60)
      : null,
    coordinates,
    note: trafficAvailable
      ? 'TomTom returned a traffic-aware travel-time estimate for this leg.'
      : 'TomTom returned road routing, but did not provide a usable traffic-delay field for this leg.',
  };
}

async function osrmRoute(origin, destination, fallbackReason = null) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(9000),
    headers: { 'User-Agent': 'NetworkWatchPortfolioPrototype/1.0' },
  });
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
    noTrafficDurationMinutes: Math.round(route.duration / 60),
    coordinates: route.geometry.coordinates,
    note: fallbackReason
      ? `Traffic provider unavailable (${fallbackReason}); using baseline OSRM road estimates.`
      : 'Baseline driving estimate from OSRM/OpenStreetMap; no live traffic is included.',
  };
}

export async function getRoadRoute(originId, destinationId) {
  const origin = HUBS[originId];
  const destination = HUBS[destinationId];
  if (!origin || !destination) throw new Error('Unknown origin or destination');

  if (originId === destinationId) {
    return {
      source: 'OSRM / OpenStreetMap',
      trafficRequested: false,
      trafficAvailable: false,
      distanceKm: 0,
      durationMinutes: 0,
      trafficDelayMinutes: 0,
      noTrafficDurationMinutes: 0,
      coordinates: [[origin.lon, origin.lat]],
      note: 'Origin and destination are the same hub.',
    };
  }

  const trafficKey = process.env.TOMTOM_API_KEY;
  const cacheKey = `${originId}>${destinationId}:${trafficKey ? 'tomtom' : 'osrm'}`;
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) routeCache.delete(cacheKey);

  let result;
  if (trafficKey) {
    try {
      result = await tomtomRoute(origin, destination, trafficKey);
    } catch (error) {
      result = await osrmRoute(origin, destination, error.message);
    }
  } else {
    result = await osrmRoute(origin, destination);
  }

  routeCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
