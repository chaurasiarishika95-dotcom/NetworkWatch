import { HUBS } from '../../../lib/network';

export const dynamic = 'force-dynamic';

const CURRENT_FIELDS = 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

function toReading(current) {
  if (!current) return null;
  return {
    temperature: current.temperature_2m ?? null,
    precipitation: current.precipitation ?? null,
    windSpeed: current.wind_speed_10m ?? null,
    windGusts: current.wind_gusts_10m ?? null,
    time: current.time ?? null,
  };
}

async function fetchSingleHub(hub) {
  const params = new URLSearchParams({
    latitude: String(hub.lat),
    longitude: String(hub.lon),
    current: CURRENT_FIELDS,
    timezone: 'Asia/Kolkata',
  });

  const response = await fetch(`${WEATHER_BASE}?${params}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  const data = await response.json();
  const reading = toReading(data.current);
  if (!reading) throw new Error('No current weather in response');
  return reading;
}

async function fetchAllHubs(hubs) {
  // Try one multi-location request first to reduce API calls.
  const params = new URLSearchParams({
    latitude: hubs.map(hub => hub.lat).join(','),
    longitude: hubs.map(hub => hub.lon).join(','),
    current: CURRENT_FIELDS,
    timezone: 'Asia/Kolkata',
  });

  const response = await fetch(`${WEATHER_BASE}?${params}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);

  const result = await response.json();
  const rows = Array.isArray(result) ? result : [result];
  const readings = {};
  hubs.forEach((hub, index) => {
    const reading = toReading(rows[index]?.current);
    if (reading) readings[hub.id] = reading;
  });
  if (!Object.keys(readings).length) throw new Error('No hub readings in batch response');
  return readings;
}

export async function GET() {
  const hubs = Object.values(HUBS);
  let readings = {};
  let batchFailed = false;

  try {
    readings = await fetchAllHubs(hubs);
  } catch {
    batchFailed = true;
  }

  // If the multi-location response fails or is incomplete, retry missing hubs individually.
  if (batchFailed || Object.keys(readings).length < hubs.length) {
    const missing = hubs.filter(hub => !readings[hub.id]);
    const results = await Promise.allSettled(missing.map(fetchSingleHub));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') readings[missing[index].id] = result.value;
    });
  }

  const successfulHubs = Object.keys(readings).length;
  const source = successfulHubs === hubs.length
    ? 'open-meteo'
    : successfulHubs > 0
      ? 'open-meteo-partial'
      : 'unavailable';

  return Response.json({
    source,
    readings,
    successfulHubs,
    totalHubs: hubs.length,
    failedHubs: hubs.filter(hub => !readings[hub.id]).map(hub => hub.id),
    fetchedAt: new Date().toISOString(),
    note: successfulHubs
      ? 'Weather is current Open-Meteo context for hub coordinates; it does not confirm road closures or unsafe roads.'
      : 'Live weather unavailable. Simulated scenarios remain usable.',
  }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
