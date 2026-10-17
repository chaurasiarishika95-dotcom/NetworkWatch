import {
  HUBS,
  SCENARIOS,
  findCandidatePaths,
  getHubWeatherRisk,
  getLaneState,
  haversineKm,
} from '../../../lib/network';
import { getRoadRoute } from '../../../lib/road-routing';

export const dynamic = 'force-dynamic';

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error.message || 'Route request failed' };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function riskLabel(risk) {
  if (risk >= 0.2) return 'High modelled weather exposure';
  if (risk >= 0.12) return 'Elevated modelled weather exposure';
  if (risk >= 0.05) return 'Weather watch';
  return 'Lower weather exposure by prototype thresholds';
}

export async function POST(request) {
  try {
    const body = await request.json();
    const origin = body.origin;
    const destination = body.destination;
    const scenario = SCENARIOS[body.scenario] ? body.scenario : 'baseline';
    const weatherReadings = body.weatherReadings && typeof body.weatherReadings === 'object'
      ? body.weatherReadings
      : null;

    if (!HUBS[origin] || !HUBS[destination]) {
      return Response.json({ error: 'Choose a valid origin and destination.' }, { status: 400 });
    }

    const lanes = getLaneState(scenario, weatherReadings);
    const scenarioData = SCENARIOS[scenario] || SCENARIOS.baseline;
    const candidates = findCandidatePaths(origin, destination, lanes, 3);

    if (!candidates.length) {
      return Response.json({
        origin,
        destination,
        scenario,
        options: [],
        recommendedOptionId: null,
        message: 'No connected path is available under the selected scenario and modelled lane conditions.',
        generatedAt: new Date().toISOString(),
      });
    }

    // Only request road-routing data for legs in the top candidate hub paths.
    // getRoadRoute caches each directed leg briefly to reduce repeated provider calls.
    const edgeMap = new Map();
    for (const candidate of candidates) {
      for (let index = 0; index < candidate.nodes.length - 1; index += 1) {
        const from = candidate.nodes[index];
        const to = candidate.nodes[index + 1];
        const key = `${from}>${to}`;
        if (!edgeMap.has(key)) edgeMap.set(key, { key, from, to });
      }
    }

    const edgeItems = [...edgeMap.values()];
    const edgeResponses = await mapWithConcurrency(edgeItems, 3, async edge => ({
      ...edge,
      route: await getRoadRoute(edge.from, edge.to),
    }));
    const routeByEdge = new Map();
    edgeResponses.forEach((result, index) => {
      const edge = edgeItems[index];
      routeByEdge.set(edge.key, result?.route ? result : { ...edge, error: result?.error || 'Road routing unavailable' });
    });

    const options = [];
    for (const candidate of candidates) {
      const segments = [];
      const coordinates = [];
      let allGeometryAvailable = true;
      let drivingMinutes = 0;
      let distanceKm = 0;
      let trafficLegs = 0;
      let trafficDelayMinutes = 0;
      let knownDelayLegs = 0;
      let baselineMinutes = 0;
      let baselineLegs = 0;
      let syntheticCostPerParcel = 0;
      let weatherPenaltyMinutes = 0;
      let capacityPenaltyMinutes = 0;
      let maxLaneWeatherCut = 0;
      let capacityPressureCount = 0;
      let estimatedOverflow = 0;
      const routeHubRisks = candidate.nodes.map(id => getHubWeatherRisk(weatherReadings?.[id]));
      const weatherReadingsOnPath = {};

      for (const id of candidate.nodes) {
        if (weatherReadings?.[id]) weatherReadingsOnPath[id] = weatherReadings[id];
      }

      for (let index = 0; index < candidate.nodes.length - 1; index += 1) {
        const from = candidate.nodes[index];
        const to = candidate.nodes[index + 1];
        const lane = candidate.lanes[index];
        const providerResult = routeByEdge.get(`${from}>${to}`);
        const road = providerResult?.route || null;
        const providerFailed = !road;
        const modeledHours = lane.effectiveTransitHours ?? lane.transitHours;
        const modeledCost = lane.effectiveCostPerParcel ?? lane.costPerParcel;
        const estimatedVolume = Math.round(lane.capacity * (scenarioData.demandMultiplier || 1) * 0.82);
        const overflow = Math.max(0, estimatedVolume - lane.effectiveCapacity);
        const weatherCut = lane.weatherCut || 0;

        drivingMinutes += road && Number.isFinite(road.durationMinutes)
          ? road.durationMinutes
          : Math.round(modeledHours * 60);
        distanceKm += road && Number.isFinite(road.distanceKm)
          ? road.distanceKm
          : haversineKm(HUBS[from], HUBS[to]);
        syntheticCostPerParcel += modeledCost;
        maxLaneWeatherCut = Math.max(maxLaneWeatherCut, weatherCut);
        weatherPenaltyMinutes += weatherCut * 45;
        if (overflow > 0) {
          capacityPressureCount += 1;
          estimatedOverflow += overflow;
          capacityPenaltyMinutes += 20 + Math.min(30, (overflow / Math.max(1, lane.capacity)) * 30);
        } else if (lane.effectiveCapacity < lane.capacity * 0.55) {
          capacityPressureCount += 1;
          capacityPenaltyMinutes += 12;
        }

        if (road?.trafficAvailable) trafficLegs += 1;
        if (Number.isFinite(road?.trafficDelayMinutes)) {
          trafficDelayMinutes += road.trafficDelayMinutes;
          knownDelayLegs += 1;
        }
        if (Number.isFinite(road?.noTrafficDurationMinutes)) {
          baselineMinutes += road.noTrafficDurationMinutes;
          baselineLegs += 1;
        }

        const legCoordinates = road?.coordinates || [];
        if (legCoordinates.length < 2) allGeometryAvailable = false;
        else coordinates.push(...(coordinates.length ? legCoordinates.slice(1) : legCoordinates));

        segments.push({
          from,
          to,
          fromName: HUBS[from].name,
          toName: HUBS[to].name,
          laneKey: lane.key,
          modeledLaneCapacity: lane.capacity,
          effectiveCapacity: lane.effectiveCapacity,
          estimatedDemand: estimatedVolume,
          estimatedOverflow: overflow,
          scenarioCut: lane.scenarioCut || 0,
          weatherCut,
          weatherRiskLabel: riskLabel(weatherCut),
          distanceKm: road?.distanceKm ?? null,
          durationMinutes: road?.durationMinutes ?? null,
          trafficAvailable: road?.trafficAvailable === true,
          trafficDelayMinutes: road?.trafficDelayMinutes ?? null,
          source: road?.source || 'Unavailable',
          error: providerFailed ? providerResult?.error || 'Road routing unavailable' : null,
        });
      }

      const legCount = Math.max(1, candidate.nodes.length - 1);
      const trafficCoveragePct = Math.round((trafficLegs / legCount) * 100);
      const avgWeatherRisk = routeHubRisks.length
        ? routeHubRisks.reduce((sum, value) => sum + value, 0) / routeHubRisks.length
        : 0;
      // The generalised score transparently trades estimated drive time against
      // illustrative weather/capacity penalties and synthetic parcel cost.
      const costPenaltyMinutes = syntheticCostPerParcel * 4;
      const score = drivingMinutes + weatherPenaltyMinutes + capacityPenaltyMinutes + costPenaltyMinutes;
      const sourceSet = [...new Set(segments.map(segment => segment.source))];
      const trafficStatus = trafficCoveragePct === 100
        ? 'Live traffic returned for every leg'
        : trafficCoveragePct > 0
          ? `Live traffic returned for ${trafficLegs}/${legCount} legs`
          : 'Baseline road times; live traffic unavailable';

      options.push({
        id: candidate.nodes.join('>'),
        nodes: candidate.nodes,
        hubNames: candidate.nodes.map(id => HUBS[id].name),
        laneKeys: candidate.lanes.map(lane => lane.key),
        segments,
        coordinates: allGeometryAvailable ? coordinates : [],
        geometryAvailable: allGeometryAvailable,
        distanceKm: Math.round(distanceKm * 10) / 10,
        drivingMinutes: Math.round(drivingMinutes),
        trafficDelayMinutes: knownDelayLegs > 0 ? Math.round(trafficDelayMinutes) : null,
        trafficDelayCoveragePct: Math.round((knownDelayLegs / legCount) * 100),
        noTrafficDurationMinutes: baselineLegs === legCount ? Math.round(baselineMinutes) : null,
        trafficAvailable: trafficCoveragePct === 100,
        trafficCoveragePct,
        trafficStatus,
        source: sourceSet.length === 1 ? sourceSet[0] : 'Mixed / fallback routing',
        syntheticCostPerParcel: Math.round(syntheticCostPerParcel * 100) / 100,
        avgWeatherRiskPct: Math.round(avgWeatherRisk * 100),
        maxWeatherRiskPct: Math.round(Math.max(0, ...routeHubRisks) * 100),
        weatherStatus: riskLabel(Math.max(maxLaneWeatherCut, ...routeHubRisks)),
        weatherHubIds: candidate.nodes.filter(id => weatherReadings?.[id]),
        weatherReadings: weatherReadingsOnPath,
        weatherPenaltyMinutes: Math.round(weatherPenaltyMinutes),
        capacityPenaltyMinutes: Math.round(capacityPenaltyMinutes),
        capacityPressureCount,
        estimatedOverflowParcelsPerDay: estimatedOverflow,
        score: Math.round(score),
        scoreParts: {
          drivingMinutes: Math.round(drivingMinutes),
          weatherPenaltyMinutes: Math.round(weatherPenaltyMinutes),
          capacityPenaltyMinutes: Math.round(capacityPenaltyMinutes),
          syntheticCostPenaltyMinutes: Math.round(costPenaltyMinutes),
        },
      });
    }

    options.sort((a, b) => a.score - b.score);
    const recommendedOptionId = options[0]?.id || null;
    const responseWeatherHubs = [...new Set(options.flatMap(option => option.nodes))];

    return Response.json({
      origin,
      destination,
      originName: HUBS[origin].name,
      destinationName: HUBS[destination].name,
      scenario,
      scenarioName: scenarioData.name,
      recommendedOptionId,
      options: options.map((option, index) => ({ ...option, isRecommended: index === 0 })),
      candidateHubs: responseWeatherHubs,
      weatherSource: body.weatherSource || (weatherReadings ? 'weather-readings' : 'unavailable'),
      weatherFetchedAt: body.weatherFetchedAt || null,
      rankingMethod: 'Estimated driving time + modelled weather/capacity penalties + synthetic parcel-cost weighting',
      note: 'Recommendation is ranked among the candidate hub paths returned by the synthetic network. It is not a globally optimal parcel-flow plan. Weather risk is inferred from readings at modelled hubs; it does not confirm road closures.',
      generatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      error: 'Could not analyse routes for this journey.',
      detail: error.message?.slice(0, 240) || 'Unknown error',
    }, { status: 500 });
  }
}
