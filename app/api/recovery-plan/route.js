import { HUBS, LANES, SCENARIOS, getLaneState } from '../../../lib/network';
import { loadSupabaseOperationalData } from '../../../lib/supabase-operations';

export const dynamic = 'force-dynamic';
const PRIORITY = new Set(['sla_critical', 'critical', 'priority', 'express', 'premium', 'vip']);
const num = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const rnd = value => Math.round((Number(value) || 0) * 100) / 100;
const money = value => rnd(value);
const DONE = new Set(['delivered', 'completed', 'complete', 'cancelled', 'canceled', 'returned', 'closed']);

function prepareLanes(scenario, weatherReadings, dbRows, trafficByLane = new Map()) {
  const overlays = new Map(getLaneState(scenario, weatherReadings).map(lane => [lane.key, lane]));
  const byKey = new Map(dbRows.map(row => [row.lane_key, row]));
  return LANES.map(topology => {
    const row = byKey.get(topology.key);
    const overlay = overlays.get(topology.key);
    if (!row) return { ...topology, dbPresent: false, active: false, baseCapacity: null, volume: null, capacity: 0, spare: 0, gap: 0, cost: null, minutes: null, delayMinutesPer100: null, cut: overlay?.cut || 0, isClosed: true };
    const baseCapacity = num(row.capacity_parcels_per_day);
    const volume = num(row.current_volume_parcels_per_day);
    const cut = overlay?.cut || 0;
    const capacity = row.is_active === false || baseCapacity == null ? 0 : Math.max(0, Math.round(baseCapacity * (1 - cut)));
    const routeTraffic = trafficByLane.get(topology.key);
    const providerMinutes = num(routeTraffic?.durationMinutes);
    const databaseMinutes = num(row.average_transit_minutes);
    return {
      ...topology,
      dbPresent: baseCapacity != null && volume != null && num(row.transport_cost_per_parcel_inr) != null,
      active: row.is_active !== false && baseCapacity != null && volume != null,
      baseCapacity,
      volume,
      capacity,
      spare: Math.max(0, capacity - (volume || 0)),
      gap: Math.max(0, (volume || 0) - capacity),
      cost: num(row.transport_cost_per_parcel_inr),
      minutes: providerMinutes ?? databaseMinutes,
      timeSource: providerMinutes != null ? (routeTraffic?.source || 'road routing provider') : databaseMinutes != null ? 'Supabase average_transit_minutes' : null,
      trafficAvailable: routeTraffic?.trafficAvailable === true,
      trafficDelayMinutes: num(routeTraffic?.trafficDelayMinutes),
      delayMinutesPer100: num(row.delay_minutes_per_100_over_capacity),
      cut,
      scenarioCut: overlay?.scenarioCut || 0,
      weatherCut: overlay?.weatherCut || 0,
      isClosed: row.is_active === false || capacity <= 0,
      updatedAt: row.updated_at || null,
    };
  });
}

function cheapestFeasiblePath(from, to, blockedLaneKey, edges) {
  let best = null;
  let visited = 0;
  function walk(node, nodes, pathEdges, cost, minutes) {
    if (++visited > 4000 || pathEdges.length > 8) return;
    if (node === to) {
      const option = { nodes: [...nodes], edges: [...pathEdges], cost, minutes };
      if (!best || option.cost < best.cost || (option.cost === best.cost && (option.minutes ?? Infinity) < (best.minutes ?? Infinity))) best = option;
      return;
    }
    for (const edge of edges) {
      if (edge.key === blockedLaneKey || !edge.active || edge.spare <= 0 || edge.cost == null) continue;
      const next = edge.from === node ? edge.to : edge.to === node ? edge.from : null;
      if (!next || nodes.includes(next)) continue;
      const nextMinutes = minutes == null || edge.minutes == null ? null : minutes + edge.minutes;
      walk(next, [...nodes, next], [...pathEdges, edge], cost + edge.cost, nextMinutes);
    }
  }
  walk(from, [from], [], 0, 0);
  return best;
}

function planDiversions(lanes) {
  const edges = lanes.map(lane => ({ ...lane, spare: lane.spare || 0 }));
  const gaps = lanes.filter(lane => lane.gap > 0).sort((a, b) => b.gap - a.gap);
  const byDamagedLane = {};
  const routes = [];
  let total = 0;
  let incrementalCost = 0;
  for (const damaged of gaps) {
    let need = damaged.gap;
    byDamagedLane[damaged.key] = 0;
    for (let iteration = 0; need > 0 && iteration < 20; iteration += 1) {
      const path = cheapestFeasiblePath(damaged.from, damaged.to, damaged.key, edges);
      if (!path || !path.edges.length) break;
      const units = Math.min(need, ...path.edges.map(edge => edge.spare));
      if (!Number.isFinite(units) || units <= 0) break;
      path.edges.forEach(edge => { edge.spare -= units; });
      need -= units;
      byDamagedLane[damaged.key] += units;
      total += units;
      const extraCostPerParcel = path.cost - (damaged.cost || 0);
      incrementalCost += units * extraCostPerParcel;
      routes.push({
        disruptedLaneKey: damaged.key,
        from: damaged.from,
        to: damaged.to,
        divertedParcelsPerDay: units,
        path: path.nodes,
        alternateLaneKeys: path.edges.map(edge => edge.key),
        baselineCostPerParcelINR: damaged.cost,
        alternateCostPerParcelINR: rnd(path.cost),
        incrementalCostPerParcelINR: rnd(extraCostPerParcel),
        trafficCoveragePct: Math.round((path.edges.filter(edge => edge.trafficAvailable).length / Math.max(1, path.edges.length)) * 100),
        timeSources: [...new Set(path.edges.map(edge => edge.timeSource).filter(Boolean))],
        additionalMinutes: path.minutes == null || damaged.minutes == null ? null : Math.max(0, Math.round(path.minutes - damaged.minutes)),
      });
    }
  }
  return { total, byDamagedLane, routes, incrementalCostINR: rnd(incrementalCost) };
}

function allocateTemporaryCapacity(gaps, hubRows, residualByLane) {
  const affectedHubs = [...new Set(gaps.flatMap(lane => [lane.from, lane.to]))];
  const resources = affectedHubs.map(id => {
    const row = hubRows.find(hub => hub.hub_id === id);
    return {
      hubId: id,
      remaining: Math.max(0, num(row?.temporary_capacity_parcels_per_day) || 0),
      unitCost: num(row?.temporary_capacity_cost_per_parcel_inr),
    };
  }).filter(row => row.remaining > 0 && row.unitCost != null);
  const allocations = {};
  let total = 0;
  let cost = 0;
  for (const lane of gaps) {
    let need = residualByLane[lane.key] || 0;
    for (const resource of resources) {
      if (need <= 0) break;
      const used = Math.min(need, resource.remaining);
      if (!used) continue;
      resource.remaining -= used;
      need -= used;
      allocations[lane.key] = (allocations[lane.key] || 0) + used;
      total += used;
      cost += used * resource.unitCost;
    }
    residualByLane[lane.key] = need;
  }
  return { allocations, total, cost: rnd(cost), available: resources.reduce((sum, resource) => sum + resource.remaining, total) };
}

function simulateOrderOutcomes({ orders, gaps, diversion, temporaryAllocations, residualGapByLane, actions, promisePolicy }) {
  const gapKeys = new Set(gaps.map(lane => lane.key));
  const affected = orders.filter(order => gapKeys.has(String(order.current_lane_key || '').toUpperCase()));
  const allHaveSla = affected.length > 0 && affected.every(order => order.promised_delivery_at && order.current_eta_at);
  const allHaveDelayModel = gaps.length > 0 && gaps.every(lane => lane.delayMinutesPer100 != null);
  const diversionRoutes = diversion.routes || [];
  const diversionTimeAvailable = !actions.includes('divert') || diversionRoutes.every(route => route.additionalMinutes != null);
  const projectedMetricsAvailable = allHaveSla && allHaveDelayModel && diversionTimeAvailable;
  const promiseEnabled = actions.includes('promise_adjustment') && promisePolicy && promisePolicy.enabled !== false &&
    (num(promisePolicy.cost_per_order_inr) != null || num(promisePolicy.cost_per_parcel_inr) != null);

  let affectedParcels = 0;
  let currentLateParcels = 0;
  let adjustedParcels = 0;
  let adjustedOrderCount = 0;
  let onTime = 0;
  let late = 0;
  let criticalAffected = 0;
  let criticalProtected = 0;
  let affectedOrderCount = 0;
  const details = [];

  for (const gap of gaps) {
    const laneOrders = affected.filter(order => String(order.current_lane_key || '').toUpperCase() === gap.key);
    laneOrders.sort((a, b) => {
      if (actions.includes('prioritize_sla')) {
        const aCritical = PRIORITY.has(String(a.priority_class || '').toLowerCase()) ? 0 : 1;
        const bCritical = PRIORITY.has(String(b.priority_class || '').toLowerCase()) ? 0 : 1;
        if (aCritical !== bCritical) return aCritical - bCritical;
      }
      return new Date(a.promised_delivery_at || '2999-12-31').getTime() - new Date(b.promised_delivery_at || '2999-12-31').getTime();
    });

    let divertedRemaining = actions.includes('divert') ? (diversion.byDamagedLane[gap.key] || 0) : 0;
    let temporaryRemaining = actions.includes('temporary_capacity') ? (temporaryAllocations[gap.key] || 0) : 0;
    const residualGap = Math.max(0, residualGapByLane?.[gap.key] ?? gap.gap);
    const queueDelay = gap.delayMinutesPer100 == null ? null : Math.ceil(residualGap * gap.delayMinutesPer100 / 100);
    const routesForLane = diversionRoutes.filter(route => route.disruptedLaneKey === gap.key);
    const extraMinutes = routesForLane.length
      ? (routesForLane.every(route => route.additionalMinutes != null)
          ? Math.max(...routesForLane.map(route => route.additionalMinutes))
          : null)
      : 0;

    for (const order of laneOrders) {
      const parcels = Math.max(1, Math.round(num(order.parcel_count) || 1));
      const promise = order.promised_delivery_at ? new Date(order.promised_delivery_at) : null;
      const eta = order.current_eta_at ? new Date(order.current_eta_at) : null;
      const hasSla = promise && eta && !Number.isNaN(promise.getTime()) && !Number.isNaN(eta.getTime());
      const lateNow = hasSla && eta > promise;
      const isCritical = PRIORITY.has(String(order.priority_class || '').toLowerCase());
      affectedParcels += parcels;
      affectedOrderCount += 1;
      if (lateNow) currentLateParcels += parcels;
      if (isCritical) criticalAffected += parcels;

      // Allocate rescued parcel volume to the highest-priority orders first when requested.
      const divertedParcels = Math.min(parcels, divertedRemaining);
      divertedRemaining -= divertedParcels;
      const temporaryParcels = Math.min(Math.max(0, parcels - divertedParcels), temporaryRemaining);
      temporaryRemaining -= temporaryParcels;
      const untreatedParcels = Math.max(0, parcels - divertedParcels - temporaryParcels);

      const divertedEta = hasSla && extraMinutes != null
        ? new Date(eta.getTime() + extraMinutes * 60000)
        : null;
      // Temporary capacity is modelled as removing the queue penalty for the allocated portion.
      const temporaryEta = eta;
      const untreatedEta = hasSla && queueDelay != null
        ? new Date(eta.getTime() + queueDelay * 60000)
        : null;

      let shifted = 0;
      if (promiseEnabled && hasSla && untreatedParcels > 0 && untreatedEta) {
        const oneDayLater = new Date(promise.getTime() + 24 * 60 * 60 * 1000);
        if (untreatedEta > promise && untreatedEta <= oneDayLater) {
          shifted = untreatedParcels;
          adjustedParcels += shifted;
          adjustedOrderCount += 1;
        }
      }

      if (projectedMetricsAvailable && hasSla) {
        const divertedOnTime = divertedParcels > 0 && divertedEta && divertedEta <= promise ? divertedParcels : 0;
        const divertedLate = divertedParcels - divertedOnTime;
        const temporaryOnTime = temporaryParcels > 0 && temporaryEta <= promise ? temporaryParcels : 0;
        const temporaryLate = temporaryParcels - temporaryOnTime;
        const untreatedOnTime = untreatedParcels > 0 && untreatedEta && untreatedEta <= promise ? untreatedParcels : 0;
        const untreatedLate = Math.max(0, untreatedParcels - shifted - untreatedOnTime);
        onTime += divertedOnTime + temporaryOnTime + untreatedOnTime;
        late += divertedLate + temporaryLate + untreatedLate;
      }

      if (isCritical) criticalProtected += Math.min(parcels, divertedParcels + temporaryParcels);
      if (details.length < 200) details.push({
        orderId: order.order_id,
        laneKey: gap.key,
        parcelCount: parcels,
        priorityClass: order.priority_class || 'standard',
        divertedParcels,
        temporaryCapacityParcels: temporaryParcels,
        promiseAdjustedParcels: shifted,
        remainingExposedParcels: Math.max(0, untreatedParcels - shifted),
        currentEta: order.current_eta_at || null,
        promisedAt: order.promised_delivery_at || null,
      });
    }
  }

  return {
    affectedOrderCount,
    affectedParcels,
    currentLateParcels,
    projectedOnTimeParcels: projectedMetricsAvailable ? onTime : null,
    projectedLateParcels: projectedMetricsAvailable ? late : null,
    promisesAdjustedParcels: promiseEnabled ? adjustedParcels : null,
    promisesAdjustedOrders: promiseEnabled ? adjustedOrderCount : null,
    slaCriticalParcelsAtRisk: criticalAffected,
    slaCriticalProtectedParcels: actions.includes('prioritize_sla') ? criticalProtected : null,
    slaMetricsAvailable: projectedMetricsAvailable,
    delayModelAvailable: allHaveDelayModel,
    promiseAdjustmentAvailable: Boolean(promiseEnabled),
    orderDetails: details,
  };
}

function evaluatePlan(actions, laneState, orders, hubRows, promisePolicy) {
  const gaps = laneState.filter(lane => lane.gap > 0).sort((a, b) => b.gap - a.gap);
  const overCapacity = gaps.reduce((sum, lane) => sum + lane.gap, 0);
  const capacityLost = laneState.reduce((sum, lane) => sum + (lane.baseCapacity == null ? 0 : Math.max(0, lane.baseCapacity - lane.capacity)), 0);
  const diversion = actions.includes('divert') ? planDiversions(laneState) : { total: 0, byDamagedLane: {}, routes: [], incrementalCostINR: 0 };
  const remaining = Object.fromEntries(gaps.map(lane => [lane.key, Math.max(0, lane.gap - (diversion.byDamagedLane[lane.key] || 0))]));
  const temp = actions.includes('temporary_capacity') ? allocateTemporaryCapacity(gaps, hubRows, remaining) : { allocations: {}, total: 0, cost: 0, available: 0 };
  const remainingOverflow = Math.max(0, overCapacity - diversion.total - temp.total);
  const orderImpact = simulateOrderOutcomes({ orders, gaps, diversion, temporaryAllocations: temp.allocations, residualGapByLane: remaining, actions, promisePolicy });
  const promiseCost = orderImpact.promisesAdjustedParcels == null ? null : money(
    orderImpact.promisesAdjustedParcels * (num(promisePolicy?.cost_per_parcel_inr) || 0) +
    orderImpact.promisesAdjustedOrders * (num(promisePolicy?.cost_per_order_inr) || 0)
  );
  const operatingCost = money(diversion.incrementalCostINR + temp.cost + (promiseCost || 0));
  const customerPenalty = orderImpact.promisesAdjustedOrders == null ? null : money(
    orderImpact.promisesAdjustedOrders * (num(promisePolicy?.customer_impact_penalty_per_order_inr) || 0)
  );
  const objectiveCost = customerPenalty == null ? null : money(operatingCost + customerPenalty);

  return {
    id: actions.length ? [...actions].sort().join('+') : 'none',
    actions,
    isRecommended: false,
    affectedLanes: gaps.length,
    overCapacityParcelsPerDay: overCapacity,
    capacityLostParcelsPerDay: capacityLost,
    divertedParcelsPerDay: diversion.total,
    temporaryCapacityUsedParcelsPerDay: temp.total,
    remainingOverflowParcelsPerDay: remainingOverflow,
    promisesAdjustedParcels: orderImpact.promisesAdjustedParcels,
    promisesAdjustedOrders: orderImpact.promisesAdjustedOrders,
    currentLateParcels: orderImpact.currentLateParcels,
    projectedOnTimeParcels: orderImpact.projectedOnTimeParcels,
    projectedLateParcels: orderImpact.projectedLateParcels,
    slaMetricsAvailable: orderImpact.slaMetricsAvailable,
    ordersInAffectedLanes: orderImpact.affectedOrderCount,
    affectedOrderParcels: orderImpact.affectedParcels,
    slaCriticalParcelsAtRisk: orderImpact.slaCriticalParcelsAtRisk,
    slaCriticalProtectedParcels: orderImpact.slaCriticalProtectedParcels,
    diversionIncrementalCostINR: diversion.incrementalCostINR,
    temporaryCapacityCostINR: temp.cost,
    promiseAdjustmentCostINR: promiseCost,
    customerImpactPenaltyINR: customerPenalty,
    operationalCostINR: operatingCost,
    objectiveCostINR: objectiveCost,
    diversions: diversion.routes,
    queueDelayModelConfigured: orderImpact.delayModelAvailable,
    promiseAdjustmentAvailable: orderImpact.promiseAdjustmentAvailable,
    notes: [
      orderImpact.affectedOrderCount === 0 ? 'No Supabase delivery orders are mapped to the currently over-capacity lanes, so order-level outcomes cannot be calculated for this disruption.' : null,
      !orderImpact.slaMetricsAvailable ? 'Projected on-time/late counts require promised_delivery_at, current_eta_at, and a configured delay_minutes_per_100_over_capacity on every affected lane.' : null,
      !orderImpact.promiseAdjustmentAvailable ? 'Promise adjustment is available only when a costed promise_adjustment policy exists and affected orders include current ETA/promised timestamps plus delay-model values for the affected lanes.' : null,
    ].filter(Boolean),
    _orderDetails: orderImpact.orderDetails,
  };
}

function objective(plan) {
  const late = plan.projectedLateParcels == null ? plan.remainingOverflowParcelsPerDay : plan.projectedLateParcels;
  const promiseAdjustments = plan.promisesAdjustedParcels == null ? 0 : plan.promisesAdjustedParcels;
  return [late, promiseAdjustments, plan.objectiveCostINR == null ? plan.operationalCostINR : plan.objectiveCostINR];
}
function comparePlans(a, b) {
  const left = objective(a);
  const right = objective(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const origin = String(body.origin || '').toUpperCase();
    const destination = String(body.destination || '').toUpperCase();
    const scenario = SCENARIOS[body.scenario] ? body.scenario : 'baseline';
    const weatherReadings = body.weatherReadings && typeof body.weatherReadings === 'object' ? body.weatherReadings : null;
    if (!HUBS[origin] || !HUBS[destination] || origin === destination) {
      return Response.json({ ready: false, error: 'Choose two different valid hubs.' }, { status: 400 });
    }

    const data = await loadSupabaseOperationalData({ origin, destination });
    const trafficByLane = new Map();
    for (const leg of Array.isArray(body.trafficLegs) ? body.trafficLegs : []) {
      const key = String(leg.laneKey || '').toUpperCase();
      const durationMinutes = num(leg.durationMinutes);
      if (key && durationMinutes != null) {
        const previous = trafficByLane.get(key);
        // Prefer a leg for which the provider explicitly returned live traffic.
        if (!previous || (!previous.trafficAvailable && leg.trafficAvailable === true)) {
          trafficByLane.set(key, {
            durationMinutes,
            trafficAvailable: leg.trafficAvailable === true,
            trafficDelayMinutes: num(leg.trafficDelayMinutes),
            source: leg.source || null,
          });
        }
      }
    }
    const required = ['delivery_orders', 'lane_operating_metrics', 'hub_operating_metrics', 'intervention_costs'];
    const missingTables = required.filter(table => !data.tableStatus?.[table]?.available);
    const topologyKeys = LANES.map(lane => lane.key);
    const metricsByKey = new Map(data.laneMetrics.map(row => [row.lane_key, row]));
    const missingLaneKeys = topologyKeys.filter(key => !metricsByKey.has(key));
    const incompleteLaneKeys = topologyKeys.filter(key => {
      const row = metricsByKey.get(key);
      return row && (row.capacity_parcels_per_day == null || row.current_volume_parcels_per_day == null || row.transport_cost_per_parcel_inr == null);
    });
    const activeOrders = data.orders.filter(order => !DONE.has(String(order.status || '').toLowerCase()));
    const ordersWithLane = activeOrders.filter(order => topologyKeys.includes(String(order.current_lane_key || '').toUpperCase()));
    const missingRequirements = [];
    if (!data.configured) missingRequirements.push('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
    if (missingTables.length) missingRequirements.push(`Create these operational tables in Supabase: ${missingTables.join(', ')}.`);
    if (missingLaneKeys.length) missingRequirements.push(`Import actual capacity, current daily volume and transport cost for all modelled lanes. Missing lane keys: ${missingLaneKeys.join(', ')}.`);
    if (incompleteLaneKeys.length) missingRequirements.push(`Complete capacity, current volume and transport cost fields for: ${incompleteLaneKeys.join(', ')}.`);
    if (!activeOrders.length) missingRequirements.push(`No active delivery orders found in Supabase for ${origin} → ${destination}. Import authorised order records with current_lane_key and SLA timestamps.`);
    if (activeOrders.length && !ordersWithLane.length) missingRequirements.push('Active orders were found, but none has current_lane_key mapped to this network. Expected keys include JAI-AGR, BHW-JAI and DEL-AGR.');

    const tableStatus = Object.fromEntries(required.map(table => [table, data.tableStatus?.[table] || { available: false, rowCount: 0, error: 'not checked' }]));
    const baseResponse = {
      source: 'Supabase operational data', origin, destination, scenario,
      tableStatus,
      counts: {
        activeOrders: activeOrders.length,
        activeOrderParcels: activeOrders.reduce((sum, order) => sum + (num(order.parcel_count) || 1), 0),
        laneMetricRows: data.laneMetrics.length,
        hubMetricRows: data.hubMetrics.length,
        interventionCostRows: data.interventionCosts.length,
      },
      missingRequirements,
      fetchedAt: data.fetchedAt,
    };

    // Explicitly refuse to invent delivery/order metrics when real records are absent.
    if (missingTables.length || missingLaneKeys.length || incompleteLaneKeys.length || !activeOrders.length || !ordersWithLane.length) {
      return Response.json({ ready: false, ...baseResponse, message: 'Recovery recommendations need actual Supabase operational records. No synthetic delivery orders, lane loads, costs, or SLA outcomes have been generated.' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const laneState = prepareLanes(scenario, weatherReadings, data.laneMetrics, trafficByLane);
    const gaps = laneState.filter(lane => lane.gap > 0);
    const enabledPolicies = data.interventionCosts.filter(row => row.enabled !== false);
    const promisePolicy = enabledPolicies.find(row => row.action_key === 'promise_adjustment') || null;
    const affectedLaneKeys = new Set(gaps.map(lane => lane.key));
    const ordersOnAffectedLanes = ordersWithLane.filter(order => affectedLaneKeys.has(String(order.current_lane_key || '').toUpperCase()));
    const allAffectedOrdersHaveSla = ordersOnAffectedLanes.length > 0 && ordersOnAffectedLanes.every(order => order.promised_delivery_at && order.current_eta_at);
    const allGapsHaveDelayModel = gaps.length > 0 && gaps.every(lane => lane.delayMinutesPer100 != null);
    const temporaryCapacityAvailable = Object.values(HUBS).some(hub => {
      const row = data.hubMetrics.find(metric => metric.hub_id === hub.id);
      return (num(row?.temporary_capacity_parcels_per_day) || 0) > 0 && num(row?.temporary_capacity_cost_per_parcel_inr) != null;
    });
    const actions = [
      { key: 'divert', title: 'Divert volume to unaffected lanes', description: 'Use spare capacity in other Supabase-recorded lanes. Additional cost is calculated from actual lane transport rates.', available: laneState.every(lane => lane.cost != null) },
      { key: 'temporary_capacity', title: 'Add temporary capacity', description: 'Use only temporary capacity and unit costs configured in hub_operating_metrics.', available: temporaryCapacityAvailable },
      { key: 'prioritize_sla', title: 'Prioritize SLA-critical packages', description: 'Allocate recovered capacity to SLA-critical/priority orders before standard orders.', available: ordersOnAffectedLanes.some(order => PRIORITY.has(String(order.priority_class || '').toLowerCase())) },
      { key: 'promise_adjustment', title: 'Adjust delivery promises (+1 day)', description: 'Move eligible promises by 24 hours only when ETAs indicate the adjustment could contain the delay and the policy is costed.', available: Boolean(promisePolicy && (num(promisePolicy.cost_per_order_inr) != null || num(promisePolicy.cost_per_parcel_inr) != null) && allAffectedOrdersHaveSla && allGapsHaveDelayModel) },
    ];

    const availableActionKeys = actions.filter(action => action.available).map(action => action.key);
    const plans = [];
    for (let mask = 0; mask < (1 << availableActionKeys.length); mask += 1) {
      const enabled = availableActionKeys.filter((_, index) => (mask & (1 << index)) !== 0);
      plans.push(evaluatePlan(enabled, laneState, ordersWithLane, data.hubMetrics, promisePolicy));
    }
    plans.sort(comparePlans);
    if (plans.length) plans[0].isRecommended = true;
    // Do not return per-order internal details to the browser; keep only aggregated metrics.
    const cleanPlans = plans.map(({ _orderDetails, ...plan }) => plan);
    const recommendedPlan = cleanPlans[0] || null;

    return Response.json({
      ready: true,
      ...baseResponse,
      ordersMappedToKnownLanes: ordersWithLane.length,
      modelDataCompleteness: {
        allLaneRowsLoaded: missingLaneKeys.length === 0,
        actualTransportCostsAvailable: laneState.every(lane => lane.cost != null),
        delayModelAvailable: gaps.every(lane => lane.delayMinutesPer100 != null),
        orderEtasAndPromisesAvailable: ordersWithLane.length > 0 && ordersWithLane.every(order => order.current_eta_at && order.promised_delivery_at),
        temporaryCapacityAvailable: temporaryCapacityAvailable,
        promiseAdjustmentAvailable: actions.some(action => action.key === 'promise_adjustment' && action.available),
      },
      laneGaps: gaps.map(lane => ({
        laneKey: lane.key, from: lane.from, to: lane.to,
        currentVolumeParcelsPerDay: lane.volume,
        effectiveCapacityParcelsPerDay: lane.capacity,
        overflowParcelsPerDay: lane.gap,
        scenarioCut: lane.scenarioCut,
        weatherCut: lane.weatherCut,
      })),
      trafficInputs: { legsReceived: trafficByLane.size, liveTrafficLegs: [...trafficByLane.values()].filter(leg => leg.trafficAvailable).length },
      laneState: laneState.map(lane => ({
        key: lane.key, from: lane.from, to: lane.to,
        baseCapacity: lane.baseCapacity,
        effectiveCapacity: lane.capacity,
        currentVolume: lane.volume,
        spare: lane.spare,
        gap: lane.gap,
        costPerParcelINR: lane.cost,
        isActive: lane.active,
        isClosed: lane.isClosed,
        cut: lane.cut,
        scenarioCut: lane.scenarioCut,
        weatherCut: lane.weatherCut,
        operationalDataAvailable: lane.dbPresent,
        updatedAt: lane.updatedAt,
        timeSource: lane.timeSource || null,
        trafficAvailable: Boolean(lane.trafficAvailable),
        trafficDelayMinutes: lane.trafficDelayMinutes ?? null,
      })),
      actions,
      recommendedPlan,
      plans: cleanPlans,
      rankingMethod: 'Rank combinations by projected late parcel units when SLA/queue-delay data is complete; otherwise rank by remaining modelled capacity gap, then promise changes and configured incremental cost. Diversion allocation is a greedy capacity-feasible approximation, not a global multi-commodity optimum.',
      note: 'Daily lane volumes, capacities, costs and in-scope order records are read from Supabase. Weather and selected scenario are overlays. No synthetic delivery-order records or cost rates are generated by this endpoint.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: 'Could not build a recovery plan from Supabase operational data.', detail: error.message?.slice(0, 240) || 'Unknown error' }, { status: 500 });
  }
}
