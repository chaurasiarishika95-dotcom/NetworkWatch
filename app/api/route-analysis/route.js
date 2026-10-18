import {
  HUBS,
  SCENARIOS,
  findCandidatePaths,
  getHubWeatherRisk,
  getLaneState,
  haversineKm,
} from '../../../lib/network';
import { getRoadRoute } from '../../../lib/road-routing';
import { persistObservations } from '../../../lib/supabase-observations';
import { loadSupabaseOperationalData } from '../../../lib/supabase-operations';

export const dynamic = 'force-dynamic';

function numericMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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
    const operations = await loadSupabaseOperationalData({ origin, destination });
    const operationalLaneByKey = new Map(operations.laneMetrics.map(row => [row.lane_key, row]));

    // Candidate-path screening uses actual Supabase capacity/cost/transit metrics when present.
    // If a value is absent, do not pretend it is operational data; use the configured graph only
    // to enumerate connected candidates, then rank them on returned road/weather signals.
    const candidateLanes = lanes.map(lane => {
      const row = operationalLaneByKey.get(lane.key);
      const dbCapacity = numericMetric(row?.capacity_parcels_per_day);
      const dbCost = numericMetric(row?.transport_cost_per_parcel_inr);
      const dbMinutes = numericMetric(row?.average_transit_minutes);
      const effectiveCapacity = row && row.is_active === false
        ? 0
        : dbCapacity == null
          ? lane.effectiveCapacity
          : Math.max(0, Math.round(dbCapacity * (1 - (lane.cut || 0))));
      const weatherCut = lane.weatherCut || 0;
      return {
        ...lane,
        graphTransitHours: lane.transitHours,
        capacity: dbCapacity == null ? lane.capacity : dbCapacity,
        effectiveCapacity,
        closed: effectiveCapacity <= 0,
        // Prefer imported average lane transit when available; otherwise retain graph estimates
        // only for candidate enumeration and clearly disclose route-provider/fallback coverage.
        transitHours: dbMinutes == null ? lane.transitHours : dbMinutes / 60,
        effectiveTransitHours: dbMinutes == null
          ? lane.effectiveTransitHours
          : (dbMinutes / 60) * (1 + weatherCut),
        costPerParcel: dbCost == null ? lane.costPerParcel : dbCost,
        effectiveCostPerParcel: dbCost == null
          ? lane.effectiveCostPerParcel
          : dbCost * (1 + weatherCut * 0.5),
        operationalCapacityAvailable: dbCapacity != null,
        operationalCostAvailable: dbCost != null,
        operationalTransitAvailable: dbMinutes != null,
      };
    });
    const candidates = findCandidatePaths(origin, destination, candidateLanes, 4);

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
      let operationalCostPerParcel = 0;
      let costLegsAvailable = 0;
      let capacityLegsAvailable = 0;
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
        // Base (weather-free) lane time: weather slowdown is added once, below, via legWeatherPenalty.
        const modeledHours = lane.graphTransitHours ?? lane.transitHours;
        const dbLane = operationalLaneByKey.get(lane.key);
        const actualCapacity = numericMetric(dbLane?.capacity_parcels_per_day);
        const actualVolume = numericMetric(dbLane?.current_volume_parcels_per_day);
        const modeledCost = numericMetric(dbLane?.transport_cost_per_parcel_inr);
        const effectiveActualCapacity = actualCapacity == null ? null : Math.max(0, Math.round(actualCapacity * (1 - (lane.cut || 0))));
        const estimatedVolume = actualVolume;
        const overflow = actualVolume != null && effectiveActualCapacity != null ? Math.max(0, actualVolume - effectiveActualCapacity) : null;
        if (actualCapacity != null && actualVolume != null && effectiveActualCapacity != null) capacityLegsAvailable += 1;
        if (modeledCost != null) { operationalCostPerParcel += modeledCost; costLegsAvailable += 1; }
        const weatherCut = lane.weatherCut || 0;

        const legMinutes = road && Number.isFinite(road.durationMinutes)
          ? road.durationMinutes
          : Math.round(modeledHours * 60);
        drivingMinutes += legMinutes;
        distanceKm += road && Number.isFinite(road.distanceKm)
          ? road.distanceKm
          : haversineKm(HUBS[from], HUBS[to]);
        maxLaneWeatherCut = Math.max(maxLaneWeatherCut, weatherCut);
        // Illustrative: weather at either end hub slows the leg in proportion to its drive time
        // (weatherCut is capped at 0.35, so at most +35% on that leg). Not a validated speed model.
        const legWeatherPenalty = legMinutes * weatherCut;
        weatherPenaltyMinutes += legWeatherPenalty;
        if (overflow != null && overflow > 0) {
          capacityPressureCount += 1;
          estimatedOverflow += overflow;
          capacityPenaltyMinutes += 20 + Math.min(30, (overflow / Math.max(1, actualCapacity || 1)) * 30);
        } else if (effectiveActualCapacity != null && actualCapacity != null && effectiveActualCapacity < actualCapacity * 0.55) {
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
          modeledLaneCapacity: actualCapacity,
          effectiveCapacity: effectiveActualCapacity,
          estimatedDemand: estimatedVolume,
          estimatedOverflow: overflow,
          scenarioCut: lane.scenarioCut || 0,
          weatherCut,
          weatherRiskLabel: riskLabel(weatherCut),
          weatherPenaltyMinutes: Math.round(legWeatherPenalty),
          modeledMinutes: Math.round(modeledHours * 60),
          distanceKm: road?.distanceKm ?? null,
          durationMinutes: road?.durationMinutes ?? null,
          noTrafficDurationMinutes: road?.noTrafficDurationMinutes ?? null,
          trafficAvailable: road?.trafficAvailable === true,
          trafficDelayMinutes: road?.trafficDelayMinutes ?? null,
          trafficDelayRatio: road?.trafficDelayRatio ?? null,
          trafficLengthKm: road?.trafficLengthKm ?? null,
          trafficSeverity: road?.trafficSeverity || 'unknown',
          trafficIncidentCount: road?.trafficIncidentCount || 0,
          // Preserve actual route geometry per hub-to-hub leg so the map can color
          // the affected roads, not just draw one solid line for the whole journey.
          coordinates: legCoordinates,
          trafficSections: road?.trafficSections || [],
          source: road?.source || 'Unavailable',
          error: providerFailed ? providerResult?.error || 'Road routing unavailable' : null,
        });
      }

      const legCount = Math.max(1, candidate.nodes.length - 1);
      const trafficCoveragePct = Math.round((trafficLegs / legCount) * 100);
      const avgWeatherRisk = routeHubRisks.length
        ? routeHubRisks.reduce((sum, value) => sum + value, 0) / routeHubRisks.length
        : 0;
      // Only use transport cost and lane-capacity terms when actual operational rows exist in Supabase.
      const costDataAvailable = costLegsAvailable === legCount;
      const capacityDataAvailable = capacityLegsAvailable === legCount;
      const totalTransportCostPerParcel = costDataAvailable ? operationalCostPerParcel : null;
      const costPenaltyMinutes = costDataAvailable ? operationalCostPerParcel * 4 : 0;
      const score = drivingMinutes + weatherPenaltyMinutes + (capacityDataAvailable ? capacityPenaltyMinutes : 0) + costPenaltyMinutes;
      const sourceSet = [...new Set(segments.map(segment => segment.source))];
      const trafficStatus = trafficCoveragePct === 100
        ? 'Live traffic returned for every leg'
        : trafficCoveragePct > 0
          ? `Live traffic returned for ${trafficLegs}/${legCount} legs`
          : 'Baseline road times; live traffic unavailable';
      const trafficIncidentCount = segments.reduce((sum, segment) => sum + (segment.trafficIncidentCount || 0), 0);
      const trafficLengthKm = segments.reduce((sum, segment) => sum + (segment.trafficLengthKm || 0), 0);
      const trafficSeverityRank = { unknown: 0, freeflow: 1, slow: 2, moderate: 3, heavy: 4, closure: 5 };
      const trafficSeverity = segments.reduce((worst, segment) =>
        (trafficSeverityRank[segment.trafficSeverity] || 0) > (trafficSeverityRank[worst] || 0)
          ? segment.trafficSeverity
          : worst, 'unknown');

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
        trafficSeverity,
        trafficIncidentCount,
        trafficLengthKm: Math.round(trafficLengthKm * 10) / 10,
        source: sourceSet.length === 1 ? sourceSet[0] : 'Mixed / fallback routing',
        // Kept under this legacy field name for UI compatibility; it is null unless every lane cost comes from Supabase.
        syntheticCostPerParcel: totalTransportCostPerParcel == null ? null : Math.round(totalTransportCostPerParcel * 100) / 100,
        operationalCostPerParcelINR: totalTransportCostPerParcel == null ? null : Math.round(totalTransportCostPerParcel * 100) / 100,
        costDataAvailable,
        costSource: costDataAvailable ? 'Supabase lane_operating_metrics' : null,
        costCoveragePct: Math.round((costLegsAvailable / legCount) * 100),
        capacityDataAvailable,
        capacityCoveragePct: Math.round((capacityLegsAvailable / legCount) * 100),
        avgWeatherRiskPct: Math.round(avgWeatherRisk * 100),
        maxWeatherRiskPct: Math.round(Math.max(0, ...routeHubRisks) * 100),
        weatherStatus: riskLabel(Math.max(maxLaneWeatherCut, ...routeHubRisks)),
        weatherHubIds: candidate.nodes.filter(id => weatherReadings?.[id]),
        hubWeather: candidate.nodes.map((id, i) => ({
          id,
          name: HUBS[id].name,
          role: i === 0 ? 'origin' : i === candidate.nodes.length - 1 ? 'destination' : 'via',
          riskPct: Math.round(routeHubRisks[i] * 100),
          reading: weatherReadings?.[id] || null,
        })),
        weatherReadings: weatherReadingsOnPath,
        weatherPenaltyMinutes: Math.round(weatherPenaltyMinutes),
        capacityPenaltyMinutes: Math.round(capacityPenaltyMinutes),
        capacityPressureCount,
        estimatedOverflowParcelsPerDay: capacityDataAvailable ? estimatedOverflow : null,
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
    const observedAt = new Date().toISOString();
    const trafficRows = edgeResponses
      .filter(item => item?.route)
      .map(item => ({
        kind: 'traffic',
        entity_key: `${item.from}>${item.to}`,
        source: item.route.source || 'road-routing-provider',
        observed_at: observedAt,
        is_live: item.route.trafficAvailable === true,
        data: {
          from: item.from, to: item.to,
          distanceKm: item.route.distanceKm ?? null,
          durationMinutes: item.route.durationMinutes ?? null,
          noTrafficDurationMinutes: item.route.noTrafficDurationMinutes ?? null,
          trafficDelayMinutes: item.route.trafficDelayMinutes ?? null,
          trafficSeverity: item.route.trafficSeverity || 'unknown',
          trafficIncidentCount: item.route.trafficIncidentCount || 0,
          trafficSections: (item.route.trafficSections || []).map(section => ({
            category: section.category, severity: section.severity,
            delayMinutes: section.delayMinutes, effectiveSpeedKmh: section.effectiveSpeedKmh,
          })),
          note: item.route.note || null,
        },
      }));
    const recommended = options.find(option => option.id === recommendedOptionId) || null;
    const persistence = await persistObservations([
      ...trafficRows,
      {
        kind: 'route_analysis',
        entity_key: `${origin}>${destination}`,
        source: 'Network Watch ranking model',
        observed_at: observedAt,
        is_live: false,
        data: {
          origin, destination, scenario,
          recommendedPath: recommended?.hubNames || [],
          recommendedScore: recommended?.score ?? null,
          candidates: options.map(option => ({
            path: option.hubNames, score: option.score,
            drivingMinutes: option.drivingMinutes, distanceKm: option.distanceKm,
            trafficCoveragePct: option.trafficCoveragePct,
            trafficDelayMinutes: option.trafficDelayMinutes,
            weatherPenaltyMinutes: option.weatherPenaltyMinutes,
            capacityPenaltyMinutes: option.capacityPenaltyMinutes,
            operationalCostPerParcelINR: option.operationalCostPerParcelINR,
            costDataAvailable: option.costDataAvailable,
            capacityDataAvailable: option.capacityDataAvailable,
          })),
          dataLimitations: 'Live traffic/weather are external observations. Candidate hub topology is configured for this prototype. Lane capacity, parcel demand, delivery orders and transport costs are sourced from Supabase only when corresponding operational records exist; missing values remain unavailable.',
        },
      },
    ]);

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
      rankingMethod: 'Estimated driving time (traffic-aware where the provider returns it) + modelled weather exposure; operational capacity and cost penalties are added only when Supabase lane metrics cover every leg.',
      operationalData: { source: operations.configured ? 'Supabase' : 'not configured', laneMetricRows: operations.laneMetrics.length, laneMetricCoverageNote: 'Lane capacity, current volume and transport cost are read from Supabase where present; missing operational inputs remain unavailable. Configured graph topology only enumerates candidate paths.' },
      note: 'Candidates are generated from the configured North India hub topology. Delivery-order counts, lane volumes, capacity and costs are not fabricated; operational cost/capacity scoring is enabled only where actual Supabase lane metrics are available. Weather at hub coordinates does not confirm road closures.',
      generatedAt: observedAt,
      observationsPersisted: persistence.persisted,
      dataSourceNote: 'Traffic/weather are live external-provider observations where explicitly marked. Parcel orders, lane volume, capacity and cost inputs are not generated by the app; they are read from Supabase and remain unavailable until authorised operational rows are imported.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      error: 'Could not analyse routes for this journey.',
      detail: error.message?.slice(0, 240) || 'Unknown error',
    }, { status: 500 });
  }
}
